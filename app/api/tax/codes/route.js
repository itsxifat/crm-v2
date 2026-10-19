export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { TaxCode } from '@/models'
import { requirePerm, requireStaff } from '@/lib/rbac'
import { logActivity } from '@/lib/logActivity'
import { parseDhakaDay } from '@/lib/dhakaTime'
import { ensureTaxCodesSeeded, getTaxCodes, normalizeTaxCode } from '@/lib/tax/engine'
import { VAT_TREATMENT_VALUES, taxCodeProblems, treatmentForRate } from '@/lib/tax/catalog'
import { z } from 'zod'

const empty = (v) => v === undefined || v === null || v === ''
const rate = z.preprocess(v => (empty(v) ? null : v), z.coerce.number().finite().min(0).max(100).nullable())
const dayStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD')
const optText = (max) => z.preprocess(v => (empty(v) ? null : v), z.string().trim().max(max).nullable())

const createSchema = z.object({
  kind:           z.enum(['VAT_SERVICE', 'TDS_SECTION']),
  code:           z.string().trim().min(1).max(32).regex(/^[A-Za-z0-9._-]+$/, 'Use letters, digits, dot, dash or underscore'),
  label:          z.string().trim().min(1).max(200),
  description:    optText(2000).optional(),
  vatRate:        rate.optional(),
  vdsRate:        rate.optional(),
  treatment:      z.preprocess(v => (empty(v) ? null : v), z.enum(VAT_TREATMENT_VALUES).nullable()).optional(),
  section:        optText(10).optional(),
  rateCompany:    rate.optional(),
  rateIndividual: rate.optional(),
  basis:          z.enum(['GROSS', 'COMMISSION_OR_GROSS']).optional(),
  commissionRate: rate.optional(),
  grossRate:      rate.optional(),
  effectiveFrom:  dayStr,
  effectiveTo:    z.preprocess(v => (empty(v) ? null : v), dayStr.nullable()).optional(),
  isActive:       z.boolean().optional(),
  sortOrder:      z.coerce.number().int().min(0).max(100000).optional(),
  notes:          optText(2000).optional(),
})

// GET /api/tax/codes?kind=VAT_SERVICE|TDS_SECTION&asOf=YYYY-MM-DD&all=1&inactive=1
//   default: codes effective on asOf (today), active, one version per code
//   inactive=1: include deactivated codes; all=1: every version (settings table)
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireStaff(session)
    if (denied) return denied

    const { searchParams } = new URL(request.url)
    const kind = searchParams.get('kind') || null
    if (kind && !['VAT_SERVICE', 'TDS_SECTION'].includes(kind)) {
      return NextResponse.json({ error: 'kind must be VAT_SERVICE or TDS_SECTION' }, { status: 400 })
    }
    const asOfStr = searchParams.get('asOf')
    let asOf = new Date()
    if (asOfStr) {
      const parsed = parseDhakaDay(asOfStr)
      if (!parsed) return NextResponse.json({ error: 'asOf must be YYYY-MM-DD' }, { status: 400 })
      asOf = parsed.start
    }
    const all = searchParams.get('all') === '1'
    const inactive = all || searchParams.get('inactive') === '1'

    await connectDB()
    const data = await getTaxCodes(kind, { asOf, includeInactive: inactive, allVersions: all })
    return NextResponse.json({ data })
  } catch (err) {
    if (err?.status && err.status < 500) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[GET /api/tax/codes]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/tax/codes — add a custom code or a new rate version of an existing code
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'tax.manage')
    if (denied) return denied

    const body = await request.json().catch(() => null)
    const parsed = createSchema.safeParse(body ?? {})
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }
    const d = parsed.data

    const effectiveFrom = parseDhakaDay(d.effectiveFrom)?.start
    const effectiveTo = d.effectiveTo ? parseDhakaDay(d.effectiveTo)?.start : null
    if (!effectiveFrom || (d.effectiveTo && !effectiveTo)) {
      return NextResponse.json({ error: 'Invalid effective date' }, { status: 422 })
    }

    const doc = {
      kind:        d.kind,
      code:        d.code.toUpperCase(),
      label:       d.label,
      description: d.description ?? null,
      effectiveFrom,
      effectiveTo,
      isActive:    d.isActive ?? true,
      isSystem:    false,
      sortOrder:   d.sortOrder ?? 1000,
      notes:       d.notes ?? null,
    }
    if (d.kind === 'VAT_SERVICE') {
      Object.assign(doc, {
        vatRate:   d.vatRate ?? null,
        vdsRate:   d.vdsRate ?? null,
        treatment: d.treatment ?? (d.vatRate == null ? null : treatmentForRate(d.vatRate)),
        basis:     'GROSS',
      })
    } else {
      const basis = d.basis ?? 'GROSS'
      Object.assign(doc, {
        section:        d.section ?? null,
        basis,
        rateCompany:    basis === 'COMMISSION_OR_GROSS' ? (d.rateCompany ?? d.grossRate ?? null) : (d.rateCompany ?? null),
        rateIndividual: basis === 'COMMISSION_OR_GROSS' ? (d.rateIndividual ?? d.grossRate ?? null) : (d.rateIndividual ?? null),
        commissionRate: basis === 'COMMISSION_OR_GROSS' ? (d.commissionRate ?? null) : null,
        grossRate:      basis === 'COMMISSION_OR_GROSS' ? (d.grossRate ?? null) : null,
      })
    }

    const problems = taxCodeProblems(doc)
    if (Object.keys(problems).length) {
      return NextResponse.json({
        error: Object.values(problems)[0],
        details: { formErrors: [], fieldErrors: Object.fromEntries(Object.entries(problems).map(([k, v]) => [k, [v]])) },
      }, { status: 422 })
    }

    await connectDB()
    await ensureTaxCodesSeeded()

    let created
    try {
      created = await TaxCode.create(doc)
    } catch (err) {
      if (err?.code === 11000) {
        return NextResponse.json({ error: 'A version of this code with the same effective-from date already exists' }, { status: 409 })
      }
      throw err
    }

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'CREATE',
      entity:   'TAX_CODE',
      entityId: created._id.toString(),
      changes:  JSON.stringify({ kind: created.kind, code: created.code, label: created.label, effectiveFrom: d.effectiveFrom }),
      request,
    })

    return NextResponse.json({ data: normalizeTaxCode(created.toObject()) }, { status: 201 })
  } catch (err) {
    if (err?.status && err.status < 500) return NextResponse.json({ error: err.message }, { status: err.status })
    console.error('[POST /api/tax/codes]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
