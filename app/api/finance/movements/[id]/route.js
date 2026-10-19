export const dynamic = 'force-dynamic'
import { randomUUID } from 'crypto'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { z } from 'zod'
import { MoneyAccount, TaxEntry, TaxFiling, Transaction } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { parseDhakaDay, dhakaDayKey } from '@/lib/dhakaTime'
import { reverseMoneyEntry } from '@/lib/finance/ledger'
import { assertBooksOpen } from '@/lib/finance/settings'
import { dayKeyLabel } from '@/lib/finance/fiscal'
import { voidTaxEntry } from '@/lib/tax/engine'
import { errorResponse } from '../../accounts/[id]/_lib/accountData'
import { linkedRowIds, movementKindOf, reverseProblem } from '../_lib/movements'

const FILED_RETURN_STATUSES = ['FILED', 'AMENDED']

const actionSchema = z.object({
  action: z.literal('reverse'),
  date:   z.string({ required_error: 'Date is required' }).regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date'),
  reason: z.string({ required_error: 'Give a reason' }).trim().min(5, 'Give a reason (at least 5 characters)').max(300),
})

const fail = (message, status = 409, field = null) => NextResponse.json(
  field ? { error: message, details: { formErrors: [], fieldErrors: { [field]: [message] } } } : { error: message },
  { status },
)

// POST /api/finance/movements/[id] { action:'reverse', date, reason }
// The ledger is immutable: a wrongly recorded money movement (capital, drawing, loan,
// bank charge, interest, other income, adjustment) is corrected by mirror rows linked
// via reversalOf and dated `date`. Every row of the movement is reversed together (a
// loan instalment's principal + interest), and the AIT credit recorded with an interest
// receipt (TDS_RECEIVABLE) is voided. If a step fails, everything written is undone.
// → 201 { data: { reversals: [tx], voidedTaxEntries: [{ entryNo, entryType, amount }] } }
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'finance.accounts.manage')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const raw = await request.json().catch(() => null)
    const parsed = actionSchema.safeParse(raw ?? {})
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }
    const { date, reason } = parsed.data

    await connectDB()
    const tx = await Transaction.findById(params.id).lean()
    if (!tx) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // The whole movement: the rows sharing its movementId (older rows stand alone).
    const group = tx.movementId && !tx.reversalOf
      ? await Transaction.find({ movementId: tx.movementId, reversalOf: null }).sort({ createdAt: 1, _id: 1 }).lean()
      : [tx]
    if (!group.length) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const linked = await linkedRowIds(group)
    for (const row of group) {
      const problem = reverseProblem(row, linked)
      if (problem) return fail(problem.message, problem.status)
    }
    const ids = group.map(r => r._id)
    const already = await Transaction.findOne({ reversalOf: { $in: ids } }).select('txnId').lean()
    if (already) return fail(`This movement has already been reversed${already.txnId ? ` (${already.txnId})` : ''}`)

    // Reversal date: a real day, not in the future, not before the movement itself.
    const day = parseDhakaDay(date)
    if (!day || dhakaDayKey(day.start) !== date) return fail('Use a valid date', 422, 'date')
    if (date > dhakaDayKey(new Date())) return fail('The reversal date cannot be in the future', 422, 'date')
    const movedOn = group.reduce((max, r) => { const k = dhakaDayKey(r.date); return k > max ? k : max }, '')
    if (date < movedOn) return fail(`The reversal cannot be dated before the movement (${dayKeyLabel(movedOn)})`, 422, 'date')

    // The account must still be usable (postMoneyEntry would refuse an archived one mid-way).
    const archived = await MoneyAccount.findOne({ _id: { $in: group.map(r => r.accountId) }, status: { $ne: 'ACTIVE' } }).select('name').lean()
    if (archived) return fail(`${archived.name} is archived — restore it to reverse this movement`)

    // Tax entries recorded with the movement: only the AIT on interest (TDS_RECEIVABLE
    // pointing back at the row). Already-void ones are skipped; the rest must still be voidable.
    const entryIds = group.flatMap(r => r.taxEntryIds ?? [])
    const entries = entryIds.length
      ? await TaxEntry.find({ _id: { $in: entryIds } }).select('entryNo entryType status amount date transactionId filingId isOpening').lean()
      : []
    const rowIds = new Set(ids.map(String))
    const foreign = entries.find(e => e.entryType !== 'TDS_RECEIVABLE' || !rowIds.has(String(e.transactionId ?? '')))
    if (foreign) return fail(`This entry carries tax entry ${foreign.entryNo} from another record — correct it where it was recorded`)
    const active = entries.filter(e => e.status === 'ACTIVE')
    for (const e of active) {
      const filing = e.filingId ? await TaxFiling.findById(e.filingId).select('status periodKey').lean() : null
      if (filing && FILED_RETURN_STATUSES.includes(filing.status)) {
        return fail(`The AIT credit ${e.entryNo} is in the filed return ${filing.periodKey} — record an adjustment instead`)
      }
      const locked = e.isOpening ? null : await assertBooksOpen(e.date)
      if (locked) return fail(`${locked} — the AIT credit ${e.entryNo} recorded with this interest cannot be voided`)
    }

    const userId = session.user.id
    const reversalId = randomUUID()
    const undo = []
    const reversals = []
    const voided = []
    try {
      // Mirror rows first: the unique index on reversalOf makes a concurrent second
      // reversal fail here (409) before anything else changes. postMoneyEntry applies
      // the books lock, the archived-account rule and the overdraft limit.
      for (const row of group) {
        const rev = await reverseMoneyEntry(row._id, { userId, date, reason, movementId: reversalId })
        undo.push(() => Transaction.deleteOne({ _id: rev._id }))
        reversals.push(rev)
      }
      for (const e of active) {
        await voidTaxEntry(e._id, {
          reason: `Money movement ${tx.txnId ?? tx._id} reversed: ${reason}`,
          userId,
          requireActive: true,
        })
        undo.push(() => TaxEntry.updateOne(
          { _id: e._id, status: 'VOID' },
          { $set: { status: 'ACTIVE', voidReason: null, voidedBy: null, voidedAt: null } },
        ))
        voided.push({ entryNo: e.entryNo, entryType: e.entryType, amount: e.amount })
      }
    } catch (err) {
      for (const step of undo.reverse()) {
        await Promise.resolve().then(step)
          .catch(e => console.error('[movements] reversal compensation step failed', String(tx._id), e))
      }
      throw err
    }

    logActivity({
      userId,
      userRole: session.user.role,
      action:   'REVERSE',
      entity:   'TRANSACTION',
      entityId: String(tx._id),
      changes:  JSON.stringify({
        movement:         movementKindOf(tx),
        original:         group.map(r => r.txnId ?? String(r._id)),
        reversals:        reversals.map(r => r.txnId),
        voidedTaxEntries: voided.map(v => v.entryNo),
        date,
        reason,
      }),
      request,
    })

    return NextResponse.json({
      data: { reversals: reversals.map(r => r.toJSON()), voidedTaxEntries: voided },
    }, { status: 201 })
  } catch (err) {
    return errorResponse(err, '[POST /api/finance/movements/[id]]')
  }
}
