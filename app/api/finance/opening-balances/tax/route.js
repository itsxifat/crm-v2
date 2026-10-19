export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { TaxEntry } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { logActivity } from '@/lib/logActivity'
import { getFinanceSettings } from '@/lib/finance/settings'
import { recordTaxEntry } from '@/lib/tax/engine'
import { maskDoc, maskList, TAX_ENTRY_PII } from '@/lib/pii'
import { dhakaDayKey } from '@/lib/dhakaTime'
import { dayKeyLabel } from '@/lib/finance/fiscal'
import { serializeTaxEntry } from '../_lib/data'
import { parseOpeningTaxBody, buildOpeningTaxEntry } from '../_lib/taxOpening'
import { OPENING_TAX_TYPES, summarizeOpeningTax } from '@/app/admin/finance/opening-balances/_lib/position'
import { requireAny, httpError, errorResponse, booksLockedError } from '@/app/api/finance/periods/_lib/locks'

const VIEW_PERMISSIONS = ['finance.opening.manage', 'finance.accounts.view', 'finance.periods.lock']

// GET /api/finance/opening-balances/tax?entryType= — ACTIVE opening tax balances (+ totals)
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireAny(session, VIEW_PERMISSIONS)
    if (denied) return denied

    const { searchParams } = new URL(request.url)
    const entryType = searchParams.get('entryType')
    if (entryType && !OPENING_TAX_TYPES.includes(entryType)) {
      return NextResponse.json({ error: 'Unknown entry type' }, { status: 400 })
    }

    await connectDB()
    const docs = await TaxEntry.find({
      isOpening: true,
      status: 'ACTIVE',
      entryType: entryType ? entryType : { $in: OPENING_TAX_TYPES },
    }).sort({ entryType: 1, date: 1, createdAt: 1 }).lean()

    const data = maskList(session, docs.map(serializeTaxEntry), TAX_ENTRY_PII)
    return NextResponse.json({ data, summary: summarizeOpeningTax(data) })
  } catch (err) {
    return errorResponse(err, '[GET /api/finance/opening-balances/tax]')
  }
}

// POST /api/finance/opening-balances/tax — create an opening TaxEntry (isOpening:true)
// body { entryType, amount, date, sdAmount?, baseAmount?, balanceSide?, treatment?, partyName?, partyBin?, partyTin?,
//        documentNo?, section?, payeeType?, certificate?:{ status, number, date }, notes? }
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'finance.opening.manage')
    if (denied) return denied

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 })
    const input = parseOpeningTaxBody(body)

    await connectDB()
    const settings = await getFinanceSettings()
    if (settings.openingLocked) throw httpError(409, 'Opening balances are locked — a super admin must unlock them first')
    // Exempt from the VAT lock (every return after go-live covers it), not from the books lock.
    if (settings.lockedUntil && input.date <= settings.lockedUntil) {
      throw booksLockedError(settings.lockedUntil, 'this opening balance is dated in the locked period', {
        details: { fieldErrors: { date: [`Books are locked up to ${dayKeyLabel(settings.lockedUntil)}`] } },
      })
    }

    const data = buildOpeningTaxEntry(input, { settings })

    // Friendly message for the normal case; the partial unique index
    // uniq_opening_vat_bf_side (mapped to 409 in recordTaxEntry) settles a double submit.
    if (data.entryType === 'VAT_BALANCE_BF') {
      const dup = await TaxEntry.exists({ isOpening: true, status: 'ACTIVE', entryType: 'VAT_BALANCE_BF', balanceSide: data.balanceSide })
      if (dup) {
        throw httpError(409, data.balanceSide === 'PAYABLE'
          ? 'A VAT payable brought forward already exists — edit it instead'
          : 'A VAT credit brought forward already exists — edit it instead')
      }
    }

    const entry = await recordTaxEntry(data, { userId: session.user.id })

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'CREATE',
      entity:   'OPENING_BALANCE',
      entityId: entry._id.toString(),
      changes:  JSON.stringify({
        kind:      'TAX',
        entryNo:   entry.entryNo,
        entryType: entry.entryType,
        amount:    entry.amount,
        ...(entry.sdAmount ? { sdAmount: entry.sdAmount } : {}),
        date:      dhakaDayKey(entry.date),
        party:     entry.partyName ?? null,
        ...(entry.balanceSide ? { balanceSide: entry.balanceSide } : {}),
      }),
      request,
    })

    return NextResponse.json({ data: maskDoc(session, serializeTaxEntry(entry.toObject()), TAX_ENTRY_PII) }, { status: 201 })
  } catch (err) {
    return errorResponse(err, '[POST /api/finance/opening-balances/tax]')
  }
}
