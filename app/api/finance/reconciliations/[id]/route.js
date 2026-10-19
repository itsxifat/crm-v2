export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { z } from 'zod'
import { MoneyAccount, Reconciliation, Transaction } from '@/models'
import { canDoAny, requirePerm } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { parseDhakaDay, dhakaDayKey, dhakaDayStart } from '@/lib/dhakaTime'
import { errorResponse, optMoney, loadAccount } from '../../accounts/[id]/_lib/accountData'
import {
  liveSummary, storedSummary, sessionRows, statementDateProblem, statementWindow, lastCompleted,
  syncAccountLastReconciled, shapeRecon, userNames, round2, EPS,
} from '../_lib/reconcile'
import { UPLOAD_URL_RE } from '@/lib/inventory/constants'

const VIEW_PERMS = ['finance.accounts.reconcile', 'finance.accounts.view', 'finance.accounts.manage']
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/
const emptyToNull = (v) => (typeof v === 'string' && v.trim() === '' ? null : v)

const actionSchema = z.discriminatedUnion('action', [
  z.object({
    action:         z.literal('toggle'),
    transactionIds: z.array(z.string().refine(isValidObjectId, 'Invalid transaction id')).min(1, 'Select at least one transaction').max(5000),
    cleared:        z.boolean(),
  }),
  z.object({
    action:           z.literal('save'),
    statementBalance: optMoney(),
    statementDate:    z.preprocess(emptyToNull, z.string().regex(DAY_RE, 'Enter a valid statement date').nullable().optional()),
    notes:            z.preprocess(emptyToNull, z.string().trim().max(1000).nullable().optional()),
    attachmentUrl:    z.preprocess(emptyToNull, z.string().trim().max(500).nullable().optional()),
  }),
  z.object({ action: z.literal('complete') }),
  z.object({
    action: z.literal('undo'),
    reason: z.string({ required_error: 'Give a reason' }).trim().min(5, 'Give a reason (at least 5 characters)').max(500),
  }),
  z.object({ action: z.literal('cancel') }),
])

async function canUndo(recon) {
  if (recon.status !== 'COMPLETED') return false
  const [latest, busy] = await Promise.all([
    lastCompleted(recon.accountId),
    Reconciliation.exists({ accountId: recon.accountId, status: 'IN_PROGRESS' }),
  ])
  return !!latest && String(latest._id) === String(recon._id) && !busy
}

async function respond(session, recon, account, extra = {}) {
  const summary = recon.status === 'IN_PROGRESS' ? await liveSummary(recon, account) : storedSummary(recon)
  const users = await userNames([recon])
  return {
    reconciliation: shapeRecon(recon, users),
    summary,
    canUndo: await canUndo(recon),
    ...extra,
  }
}

// GET /api/finance/reconciliations/[id]
// → { data: { reconciliation, account, summary, rows, total, truncated, laterUncleared, canUndo } }
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canDoAny(session, VIEW_PERMS)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()
    const recon = await Reconciliation.findById(params.id).lean()
    if (!recon) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const account = await MoneyAccount.findById(recon.accountId).lean()
    if (!account) return NextResponse.json({ error: 'Money account not found' }, { status: 404 })

    const [rowsInfo, accountView] = await Promise.all([
      sessionRows(recon, account),
      loadAccount(session, String(account._id)),
    ])
    const body = await respond(session, recon, account, { account: accountView, ...rowsInfo })
    return NextResponse.json({ data: body })
  } catch (err) {
    return errorResponse(err, '[GET /api/finance/reconciliations/[id]]')
  }
}

// PUT /api/finance/reconciliations/[id]
//   { action:'toggle', transactionIds, cleared } | { action:'save', statementBalance?, statementDate?, notes?, attachmentUrl? }
//   { action:'complete' } | { action:'undo', reason } | { action:'cancel' }
export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'finance.accounts.reconcile')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const raw = await request.json().catch(() => null)
    const parsed = actionSchema.safeParse(raw ?? {})
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }
    const body = parsed.data

    await connectDB()
    const recon = await Reconciliation.findById(params.id)
    if (!recon) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const account = await MoneyAccount.findById(recon.accountId).lean()
    if (!account) return NextResponse.json({ error: 'Money account not found' }, { status: 404 })

    const log = (action, changes) => logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action,
      entity:   'RECONCILIATION',
      entityId: recon._id.toString(),
      changes:  JSON.stringify({ account: account.name, statementDate: dhakaDayKey(recon.statementDate), ...changes }),
      request,
    })

    const needInProgress = () => (recon.status !== 'IN_PROGRESS'
      ? NextResponse.json({ error: 'This reconciliation is no longer in progress' }, { status: 409 })
      : null)

    // ── toggle ──────────────────────────────────────────────────────────────
    if (body.action === 'toggle') {
      const blocked = needInProgress()
      if (blocked) return blocked
      const ids = [...new Set(body.transactionIds)]
      let changed = 0
      if (body.cleared) {
        const win = statementWindow(recon.statementDate, account)
        const date = { $lt: win.next }
        if (account.openingDate) date.$gte = dhakaDayStart(account.openingDate)
        const eligible = await Transaction.find({
          _id: { $in: ids },
          accountId: account._id,
          date,
          $or: [{ reconciliationId: null, clearStatus: { $ne: 'RECONCILED' } }, { reconciliationId: recon._id }],
        }).select('_id').lean()
        const okIds = eligible.map(e => e._id)
        if (!okIds.length) {
          return NextResponse.json({ error: 'None of the selected transactions can be cleared in this statement (wrong account, dated after the statement, or already reconciled)' }, { status: 422 })
        }
        const res = await Transaction.updateMany(
          { _id: { $in: okIds }, $or: [{ reconciliationId: null, clearStatus: { $ne: 'RECONCILED' } }, { reconciliationId: recon._id }] },
          { $set: { clearStatus: 'CLEARED', clearedDate: recon.statementDate, reconciliationId: recon._id } },
        )
        changed = res.modifiedCount ?? okIds.length
        await Reconciliation.updateOne({ _id: recon._id }, { $addToSet: { transactionIds: { $each: okIds } } })
      } else {
        const res = await Transaction.updateMany(
          { _id: { $in: ids }, reconciliationId: recon._id, clearStatus: 'CLEARED' },
          { $set: { clearStatus: 'UNCLEARED', clearedDate: null, reconciliationId: null } },
        )
        changed = res.modifiedCount ?? 0
        await Reconciliation.updateOne({ _id: recon._id }, { $pull: { transactionIds: { $in: ids } } })
      }
      const fresh = await Reconciliation.findById(recon._id)
      const summary = await liveSummary(fresh, account)
      fresh.openingBalance = summary.openingBalance
      fresh.clearedBalance = summary.clearedBalance
      fresh.difference = summary.difference
      await fresh.save()
      return NextResponse.json({ data: await respond(session, fresh.toObject(), account, { changed }) })
    }

    // ── save (statement details) ────────────────────────────────────────────
    if (body.action === 'save') {
      const blocked = needInProgress()
      if (blocked) return blocked
      // A new statement link must be an uploaded file; the stored one may be sent back unchanged.
      if (body.attachmentUrl && body.attachmentUrl !== (recon.attachmentUrl ?? null) && !UPLOAD_URL_RE.test(body.attachmentUrl)) {
        return NextResponse.json({ error: 'Attach the statement with the upload button' }, { status: 422 })
      }
      const changes = {}
      if (body.statementDate && body.statementDate !== dhakaDayKey(recon.statementDate)) {
        const problem = await statementDateProblem(body.statementDate, account, { excludeId: recon._id })
        if (problem) {
          return NextResponse.json({ error: problem, details: { formErrors: [], fieldErrors: { statementDate: [problem] } } }, { status: 422 })
        }
        const newStart = parseDhakaDay(body.statementDate).start
        const newNext = parseDhakaDay(body.statementDate).next
        // Moving the date earlier releases ticked rows that now fall after the statement.
        const released = await Transaction.find({ reconciliationId: recon._id, date: { $gte: newNext } }).select('_id').lean()
        if (released.length) {
          const relIds = released.map(r => r._id)
          // Rows that were already cleared before this session stay cleared — only detached.
          const preSet = new Set((recon.get('preTickedIds') ?? []).map(String))
          const preRel = relIds.filter(id => preSet.has(String(id)))
          if (preRel.length) {
            await Transaction.updateMany(
              { _id: { $in: preRel }, reconciliationId: recon._id, clearStatus: 'CLEARED' },
              { $set: { reconciliationId: null } },
            )
          }
          await Transaction.updateMany(
            { _id: { $in: relIds }, reconciliationId: recon._id, clearStatus: 'CLEARED' },
            { $set: { clearStatus: 'UNCLEARED', clearedDate: null, reconciliationId: null } },
          )
          recon.transactionIds = (recon.transactionIds ?? []).filter(id => !relIds.some(r => String(r) === String(id)))
          changes.released = relIds.length
        }
        await Transaction.updateMany({ reconciliationId: recon._id, clearStatus: 'CLEARED' }, { $set: { clearedDate: newStart } })
        changes.statementDate = { from: dhakaDayKey(recon.statementDate), to: body.statementDate }
        recon.statementDate = newStart
      }
      if (body.statementBalance !== undefined && body.statementBalance !== null
        && Math.abs(round2(body.statementBalance) - round2(recon.statementBalance)) > EPS) {
        changes.statementBalance = { from: round2(recon.statementBalance), to: round2(body.statementBalance) }
        recon.statementBalance = round2(body.statementBalance)
      }
      if (body.notes !== undefined) recon.notes = body.notes ?? null
      if (body.attachmentUrl !== undefined) recon.attachmentUrl = body.attachmentUrl ?? null
      const summary = await liveSummary(recon, account)
      recon.openingBalance = summary.openingBalance
      recon.clearedBalance = summary.clearedBalance
      recon.difference = summary.difference
      await recon.save()
      if (Object.keys(changes).length) log('UPDATE', changes)
      return NextResponse.json({ data: await respond(session, recon.toObject(), account) })
    }

    // ── complete ────────────────────────────────────────────────────────────
    if (body.action === 'complete') {
      const blocked = needInProgress()
      if (blocked) return blocked
      const summary = await liveSummary(recon, account)
      if (Math.abs(summary.difference) > EPS) {
        return NextResponse.json({
          error: `The difference must be zero to finish (currently ${summary.difference.toFixed(2)})`,
          summary,
        }, { status: 409 })
      }
      const now = new Date()
      const claimed = await Reconciliation.findOneAndUpdate(
        { _id: recon._id, status: 'IN_PROGRESS' },
        { $set: {
          status: 'COMPLETED', completedBy: session.user.id, completedAt: now,
          openingBalance: summary.openingBalance, clearedBalance: summary.clearedBalance, difference: 0,
        } },
        { new: true },
      )
      if (!claimed) return NextResponse.json({ error: 'This reconciliation is no longer in progress' }, { status: 409 })

      await Transaction.updateMany({ reconciliationId: recon._id, clearStatus: 'CLEARED' }, { $set: { clearStatus: 'RECONCILED' } })
      // Re-check against the ledger (a toggle may have raced the claim).
      const check = await liveSummary(claimed, account)
      if (Math.abs(check.difference) > EPS) {
        await Transaction.updateMany({ reconciliationId: recon._id, clearStatus: 'RECONCILED' }, { $set: { clearStatus: 'CLEARED' } })
        await Reconciliation.updateOne({ _id: recon._id }, { $set: { status: 'IN_PROGRESS', completedBy: null, completedAt: null, difference: check.difference } })
        return NextResponse.json({ error: 'The cleared items changed while finishing — review the difference and try again' }, { status: 409 })
      }
      const tickedIds = (await Transaction.find({ reconciliationId: recon._id }).select('_id').lean()).map(t => t._id)
      claimed.transactionIds = tickedIds
      await claimed.save()
      await syncAccountLastReconciled(account._id)

      log('RECONCILE', {
        statementBalance: round2(claimed.statementBalance), openingBalance: summary.openingBalance,
        items: tickedIds.length, clearedIn: summary.clearedIn, clearedOut: summary.clearedOut,
      })
      return NextResponse.json({ data: await respond(session, claimed.toObject(), account) })
    }

    // ── undo ────────────────────────────────────────────────────────────────
    if (body.action === 'undo') {
      if (recon.status !== 'COMPLETED') return NextResponse.json({ error: 'Only a completed reconciliation can be undone' }, { status: 409 })
      if (await Reconciliation.exists({ accountId: account._id, status: 'IN_PROGRESS' })) {
        return NextResponse.json({ error: 'Finish or cancel the reconciliation in progress first' }, { status: 409 })
      }
      const latest = await lastCompleted(account._id)
      if (!latest || String(latest._id) !== String(recon._id)) {
        return NextResponse.json({ error: 'Only the latest reconciliation can be undone — undo the later ones first' }, { status: 409 })
      }
      const claimed = await Reconciliation.findOneAndUpdate(
        { _id: recon._id, status: 'COMPLETED' },
        { $set: { status: 'UNDONE', undoneBy: session.user.id, undoneAt: new Date(), undoReason: body.reason } },
        { new: true },
      )
      if (!claimed) return NextResponse.json({ error: 'This reconciliation was changed by someone else — reload' }, { status: 409 })
      // Items go back to "cleared" (not reconciled) so the next session can pick them up again.
      const res = await Transaction.updateMany(
        { reconciliationId: recon._id, clearStatus: 'RECONCILED' },
        { $set: { clearStatus: 'CLEARED', reconciliationId: null } },
      )
      await syncAccountLastReconciled(account._id)
      log('UNDO', { reason: body.reason, items: res.modifiedCount ?? null, statementBalance: round2(claimed.statementBalance) })
      return NextResponse.json({ data: await respond(session, claimed.toObject(), account) })
    }

    // ── cancel (discard an in-progress session) ─────────────────────────────
    if (body.action === 'cancel') {
      const blocked = needInProgress()
      if (blocked) return blocked
      // Discard is a no-op on the ledger: rows that were already CLEARED before this
      // session (pre-ticked on start) go back exactly as they were — CLEARED, free of
      // any session, with their original cleared date — whether they are still ticked,
      // were unticked, re-ticked, or released by a statement-date change. Each row is
      // matched on its statement line as it was at the start, so a row edited after
      // being unticked (amount, date, account…) stays uncleared rather than being
      // marked as matched to the bank with figures the bank never saw.
      const snapshot = recon.toObject().preTickedRows ?? []
      const pre = recon.get('preTickedIds') ?? []
      let restored = 0
      if (snapshot.length) {
        const res = await Transaction.bulkWrite(snapshot.map(s => ({
          updateOne: {
            filter: {
              _id: s.txId,
              accountId: account._id,
              reconciliationId: { $in: [recon._id, null] },
              clearStatus: { $ne: 'RECONCILED' },
              type: s.type,
              date: s.date,
              amount: s.amount,
              accountAmount: s.accountAmount ?? null,
              amountBDT: s.amountBDT ?? null,
              currency: s.currency ?? null,
            },
            update: { $set: { clearStatus: 'CLEARED', reconciliationId: null, clearedDate: s.clearedDate ?? null } },
          },
        })), { ordered: false })
        restored = res.modifiedCount ?? 0
      } else if (pre.length) {
        // Session started before the snapshot existed: detach the pre-ticked rows still ticked.
        await Transaction.updateMany(
          { _id: { $in: pre }, reconciliationId: recon._id, clearStatus: 'CLEARED' },
          { $set: { reconciliationId: null } },
        )
      }
      // Only rows ticked during the session are left: they become uncleared.
      const res = await Transaction.updateMany(
        { reconciliationId: recon._id, clearStatus: 'CLEARED' },
        { $set: { clearStatus: 'UNCLEARED', clearedDate: null, reconciliationId: null } },
      )
      await Reconciliation.deleteOne({ _id: recon._id, status: 'IN_PROGRESS' })
      log('CANCEL', { statementBalance: round2(recon.statementBalance), releasedItems: res.modifiedCount ?? null, restoredItems: restored })
      return NextResponse.json({ success: true })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
  } catch (err) {
    return errorResponse(err, '[PUT /api/finance/reconciliations/[id]]')
  }
}
