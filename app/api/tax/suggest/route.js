export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { canDoAny } from '@/lib/rbac'
import { parseDhakaDay } from '@/lib/dhakaTime'
import { getFinanceSettings } from '@/lib/finance/settings'
import { suggestTds, suggestVds, inputVatCreditability } from '@/lib/tax/engine'
import { INPUT_NON_CREDIT_REASONS } from '@/lib/tax/catalog'
import { z } from 'zod'

const ALLOWED = ['tax.view', 'tax.manage', 'finance.payments.confirm', 'finance.transactions.create', 'inventory.purchase']

const TRUE_VALUES = ['1', 'true', 'yes', 'on']
const FALSE_VALUES = ['0', 'false', 'no', 'off']
const empty = (v) => v === undefined || v === null || v === ''

/** Query-string boolean with a default ('1'/'true'/'yes'/'on' vs '0'/'false'/'no'/'off'). */
const bool = (def) => z.preprocess((v) => {
  if (empty(v)) return def
  const s = String(v).toLowerCase()
  if (TRUE_VALUES.includes(s)) return true
  if (FALSE_VALUES.includes(s)) return false
  return v
}, z.boolean())

const money = z.preprocess(v => (empty(v) ? 0 : v), z.coerce.number().finite().min(0).max(1e12))
const optMoney = z.preprocess(v => (empty(v) ? null : v), z.coerce.number().finite().min(0).max(1e12).nullable())
const day = z.preprocess(v => (empty(v) ? null : v), z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD').nullable())
const mode = z.preprocess(v => (empty(v) ? 'PAYEE' : String(v).toUpperCase()), z.enum(['PAYEE', 'CUSTOMER']))

const tdsSchema = z.object({
  section:    z.string().trim().min(1, 'Select a TDS section').max(40),
  payeeType:  z.preprocess(v => (empty(v) ? 'COMPANY' : String(v).toUpperCase()), z.enum(['COMPANY', 'INDIVIDUAL', 'NON_RESIDENT'])),
  base:       money,
  commission: optMoney,
  hasPsr:     bool(true),
  bank:       bool(true),
  date:       day,
  mode,
})

const vdsSchema = z.object({
  serviceCode:     z.preprocess(v => (empty(v) ? null : v), z.string().trim().max(40).nullable()),
  base:            money,
  vat:             optMoney,
  supplierVatType: z.preprocess(v => (empty(v) ? 'REGISTERED' : String(v).toUpperCase()), z.enum(['REGISTERED', 'TURNOVER', 'UNREGISTERED', 'FOREIGN'])),
  date:            day,
  mode,
})

const itcSchema = z.object({
  ourTreatment:    z.preprocess(v => (empty(v) ? null : String(v).toUpperCase()), z.enum(['STANDARD', 'REDUCED', 'ZERO_RATED', 'EXEMPT', 'NONE']).nullable()),
  supplierVatType: z.preprocess(v => (empty(v) ? 'REGISTERED' : String(v).toUpperCase()), z.enum(['REGISTERED', 'TURNOVER', 'UNREGISTERED', 'FOREIGN'])),
  hasMushak:       bool(true),
  excludedItem:    bool(false),
  gross:           money,
  bank:            bool(true),
})

function dateOf(s) {
  return s ? parseDhakaDay(s)?.start ?? null : new Date()
}

// GET /api/tax/suggest?type=tds|vds|itc&...
//   tds: section, payeeType, base, commission, hasPsr=1, bank=1, date, mode=PAYEE|CUSTOMER
//   vds: serviceCode, base (excl. VAT), vat, supplierVatType, date, mode=PAYEE|CUSTOMER
//   itc: ourTreatment (default: company's sales treatment), supplierVatType, hasMushak, excludedItem, gross, bank
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canDoAny(session, ALLOWED)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const params = Object.fromEntries(searchParams.entries())
    const type = String(params.type ?? '').toLowerCase()

    if (type === 'tds') {
      const parsed = tdsSchema.safeParse(params)
      if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
      const p = parsed.data
      const date = dateOf(p.date)
      if (!date) return NextResponse.json({ error: 'Invalid date' }, { status: 422 })
      await connectDB()
      const data = await suggestTds({
        sectionCode:      p.section,
        payeeType:        p.payeeType,
        baseAmount:       p.base,
        commissionAmount: p.commission,
        hasPsr:           p.hasPsr,
        bankingChannel:   p.bank,
        date,
        perspective:      p.mode,
      })
      return NextResponse.json({ data })
    }

    if (type === 'vds') {
      const parsed = vdsSchema.safeParse(params)
      if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
      const p = parsed.data
      const date = dateOf(p.date)
      if (!date) return NextResponse.json({ error: 'Invalid date' }, { status: 422 })
      await connectDB()
      const data = await suggestVds({
        serviceCode:     p.serviceCode,
        baseAmount:      p.base,
        vatAmount:       p.vat,
        supplierVatType: p.supplierVatType,
        date,
        perspective:     p.mode,
      })
      return NextResponse.json({ data })
    }

    if (type === 'itc') {
      const parsed = itcSchema.safeParse(params)
      if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
      const p = parsed.data
      let ourTreatment = p.ourTreatment
      if (!ourTreatment) {
        await connectDB()
        const settings = await getFinanceSettings()
        ourTreatment = settings.vat?.registrationType === 'REGISTERED'
          ? (settings.vat?.defaultSalesTreatment || 'STANDARD')
          : 'NONE'
      }
      const result = inputVatCreditability({
        ourTreatment,
        supplierVatType: p.supplierVatType,
        hasMushak:       p.hasMushak,
        excludedItem:    p.excludedItem,
        grossAmount:     p.gross,
        bankingChannel:  p.bank,
      })
      return NextResponse.json({
        data: { ...result, ourTreatment, reasonLabel: result.reason ? INPUT_NON_CREDIT_REASONS[result.reason] ?? result.reason : null },
      })
    }

    return NextResponse.json({ error: "type must be 'tds', 'vds' or 'itc'" }, { status: 400 })
  } catch (err) {
    if (err?.status && err.status < 500) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[GET /api/tax/suggest]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
