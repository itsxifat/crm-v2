export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { TaxEntry } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { getFinanceSettings } from '@/lib/finance/settings'
import { voidTaxEntry } from '@/lib/tax/engine'
import { maskDoc, TAX_ENTRY_PII } from '@/lib/pii'
import { dhakaDayKey } from '@/lib/dhakaTime'
import { dayKeyLabel } from '@/lib/finance/fiscal'
import { serializeTaxEntry } from '../../_lib/data'
import { parseOpeningTaxBody, buildOpeningTaxEntry, OPENING_DIFF_FIELDS } from '../../_lib/taxOpening'
import { OPENING_TAX_TYPES } from '@/app/admin/finance/opening-balances/_lib/position'
import { requireAny, httpError, errorResponse, cleanReason, booksLockedError } from '@/app/api/finance/periods/_lib/locks'

const VIEW_PERMISSIONS = ['finance.opening.manage', 'finance.accounts.view', 'finance.periods.lock']

/**
 * Fields that carry the balance itself. Inside the books lock these (and the
 * date) stay fixed; notes, party, document and certificate details can still
 * be corrected — like the reference of a money account's opening.
 */
const LOCKED_FIGURES = ['amount', 'sdAmount', 'baseAmount', 'date', 'balanceSide', 'treatment', 'creditable', 'section', 'payeeType']

const notFound = () => NextResponse.json({ error: 'Not found' }, { status: 404 })

function pick(obj, path) {
  const v = path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj)
  if (v instanceof Date) return dhakaDayKey(v)
  return v ?? null
}

const sameValue = (a, b) => (typeof a === 'number' && typeof b === 'number'
  ? Math.abs(a - b) < 0.005
  : JSON.stringify(a) === JSON.stringify(b))

/** Duplicate-key error from the one-VAT-balance-b/f-per-side index (models/TaxEntry.js). */
const isOpeningBfDuplicate = (err) =>
  err?.code === 11000 && (!!err.keyPattern?.balanceSide || /uniq_opening_vat_bf_side/.test(String(err.message ?? '')))

/** Opening entry that may still be changed: ACTIVE, isOpening, never claimed / deposited / filed. */
async function loadEditable(id) {
  const entry = await TaxEntry.findById(id)
  if (!entry || !entry.isOpening || !OPENING_TAX_TYPES.includes(entry.entryType)) return { entry: null }
  if (entry.status !== 'ACTIVE') throw httpError(409, 'This opening balance has been voided')
  if (entry.filingId || entry.claimPeriod) {
    throw httpError(409, 'This opening balance is already included in a filed VAT return — it can no longer be changed')
  }
  // Part-paid by a challan (deposit.paidAmount) counts as deposited too.
  if (entry.deposit?.depositEntryId || entry.deposit?.status === 'DEPOSITED' || (Number(entry.deposit?.paidAmount) || 0) > 0) {
    throw httpError(409, 'This opening balance has already been deposited — void the deposit first')
  }
  return { entry }
}

// GET /api/finance/opening-balances/tax/[id]
export async function GET(_request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireAny(session, VIEW_PERMISSIONS)
    if (denied) return denied
    if (!isValidObjectId(params.id)) return notFound()

    await connectDB()
    const entry = await TaxEntry.findById(params.id).lean()
    if (!entry || !entry.isOpening) return notFound()
    return NextResponse.json({ data: maskDoc(session, serializeTaxEntry(entry), TAX_ENTRY_PII) })
  } catch (err) {
    return errorResponse(err, '[GET /api/finance/opening-balances/tax/[id]]')
  }
}

// PUT /api/finance/opening-balances/tax/[id] — edit an opening tax balance (same body as POST; entryType cannot change)
export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'finance.opening.manage')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return notFound()

    const body = await request.json().catch(() => null)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Request body must be a JSON object' }, { status: 400 })

    await connectDB()
    const settings = await getFinanceSettings()
    if (settings.openingLocked) throw httpError(409, 'Opening balances are locked — a super admin must unlock them first')

    const { entry } = await loadEditable(params.id)
    if (!entry) return notFound()
    if (body.entryType && body.entryType !== entry.entryType) {
      throw httpError(422, 'The kind of balance cannot be changed — void this line and add a new one')
    }

    // Fields left out of the body keep their stored value (the rate is always re-derived).
    const cur = serializeTaxEntry(entry.toObject())
    const base = {
      amount: cur.amount, sdAmount: cur.sdAmount, baseAmount: cur.baseAmount, date: cur.date,
      balanceSide: cur.balanceSide, treatment: cur.treatment, partyType: cur.partyType, partyName: cur.partyName,
      partyBin: cur.partyBin, partyTin: cur.partyTin, documentNo: cur.documentNo, documentDate: cur.documentDate,
      section: cur.section, payeeType: cur.payeeType, notes: cur.notes,
      certificate: { status: cur.certificate.status, number: cur.certificate.number, date: cur.certificate.date },
    }
    const overlay = Object.fromEntries(Object.entries(body).filter(([, v]) => v !== undefined))
    const input = parseOpeningTaxBody({ ...base, ...overlay, entryType: entry.entryType })
    const data = buildOpeningTaxEntry(input, { settings, existing: entry })
    const before = entry.toObject()

    const lock = settings.lockedUntil
    if (lock) {
      const fromDay = dhakaDayKey(entry.date)
      const figures = body.rate !== undefined ? [...LOCKED_FIGURES, 'rate'] : LOCKED_FIGURES
      const changed = figures.some(f => !sameValue(pick(before, f), pick(data, f)))
      if (changed && fromDay <= lock) {
        throw booksLockedError(lock, 'the amount and date of this opening balance cannot be changed (notes, party and certificate details can)')
      }
      if (changed && input.date <= lock) {
        throw booksLockedError(lock, 'an opening balance cannot be moved into the locked period', {
          details: { fieldErrors: { date: [`Books are locked up to ${dayKeyLabel(lock)}`] } },
        })
      }
    }

    if (entry.entryType === 'VAT_BALANCE_BF' && data.balanceSide !== entry.balanceSide) {
      const dup = await TaxEntry.exists({
        _id: { $ne: entry._id }, isOpening: true, status: 'ACTIVE', entryType: 'VAT_BALANCE_BF', balanceSide: data.balanceSide,
      })
      if (dup) throw httpError(409, 'There is already a VAT balance brought forward on that side — edit that one instead')
    }

    const fields = { ...data }
    delete fields.entryType
    delete fields.isOpening
    // Conditional write: only if the entry is unchanged since loadEditable checked it
    // (not voided, claimed in a filed return or deposited meanwhile).
    let saved
    try {
      saved = await TaxEntry.findOneAndUpdate(
        {
          _id: entry._id,
          status: 'ACTIVE',
          updatedAt: entry.updatedAt ?? null,
          filingId: null,
          claimPeriod: null,
          'deposit.depositEntryId': null,
          'deposit.status': { $ne: 'DEPOSITED' },
        },
        { $set: fields },
        { new: true, runValidators: true },
      )
    } catch (err) {
      // The unique index settles a side flip racing another b/f line on that side.
      if (isOpeningBfDuplicate(err)) throw httpError(409, 'There is already a VAT balance brought forward on that side — edit that one instead')
      throw err
    }
    if (!saved) throw httpError(409, 'This opening balance was changed by someone else meanwhile — reload and try again')
    const after = saved.toObject()

    const diff = {}
    for (const f of OPENING_DIFF_FIELDS) {
      const a = pick(before, f)
      const b = pick(after, f)
      if (JSON.stringify(a) !== JSON.stringify(b)) diff[f] = { from: a, to: b }
    }
    if (pick(before, 'partyTin') !== pick(after, 'partyTin')) diff.partyTin = { from: before.partyTin ? 'set' : null, to: after.partyTin ? 'updated' : null }

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'UPDATE',
      entity:   'OPENING_BALANCE',
      entityId: entry._id.toString(),
      changes:  JSON.stringify({ kind: 'TAX', entryNo: entry.entryNo, entryType: entry.entryType, ...diff }),
      request,
    })

    return NextResponse.json({ data: maskDoc(session, serializeTaxEntry(after), TAX_ENTRY_PII) })
  } catch (err) {
    if (err?.name === 'ValidationError') {
      return NextResponse.json({ error: Object.values(err.errors ?? {}).map(e => e.message).join('; ') || 'Invalid tax entry' }, { status: 422 })
    }
    return errorResponse(err, '[PUT /api/finance/opening-balances/tax/[id]]')
  }
}

// DELETE /api/finance/opening-balances/tax/[id] — void (never hard-deletes). body/query: reason
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'finance.opening.manage')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return notFound()

    const body = await request.json().catch(() => ({}))
    const { searchParams } = new URL(request.url)
    const reason = cleanReason(body?.reason ?? searchParams.get('reason') ?? '')

    await connectDB()
    const settings = await getFinanceSettings()
    if (settings.openingLocked) throw httpError(409, 'Opening balances are locked — a super admin must unlock them first')

    const { entry } = await loadEditable(params.id)
    if (!entry) return notFound()
    // voidTaxEntry exempts openings from both locks; the books lock still applies here.
    if (settings.lockedUntil && dhakaDayKey(entry.date) <= settings.lockedUntil) {
      throw booksLockedError(settings.lockedUntil, 'an opening balance dated in the locked period cannot be removed')
    }

    const voided = await voidTaxEntry(entry._id, { reason: reason || 'Opening balance removed', userId: session.user.id })

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'VOID',
      entity:   'OPENING_BALANCE',
      entityId: voided._id.toString(),
      changes:  JSON.stringify({
        kind:      'TAX',
        entryNo:   voided.entryNo,
        entryType: voided.entryType,
        amount:    voided.amount,
        date:      dhakaDayKey(voided.date),
        reason:    voided.voidReason,
      }),
      request,
    })

    return NextResponse.json({ data: maskDoc(session, serializeTaxEntry(voided.toObject()), TAX_ENTRY_PII) })
  } catch (err) {
    return errorResponse(err, '[DELETE /api/finance/opening-balances/tax/[id]]')
  }
}
