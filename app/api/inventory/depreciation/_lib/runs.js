/**
 * Depreciation-run helpers for the I3 routes (server only):
 *  - listRuns():  run history with user names (no line arrays)
 *  - reverseDepreciationRun(): undo the latest posted run — restores each asset's
 *    accumulated depreciation and last posted month, posts a reversing ledger
 *    row dated the run's last day, marks the run REVERSED (it can then be
 *    posted again), with compensation on failure.
 */

import connectDB from '@/lib/mongodb'
import { Asset, AssetEvent, DepreciationRun, Transaction, User } from '@/models'
import { getFinanceSettings, assertBooksOpen } from '@/lib/finance/settings'
import { reverseMoneyEntry } from '@/lib/finance/ledger'
import { TERMINAL_STATUSES, isStalePostingRun } from '@/lib/inventory/constants'
import { isValidPeriod, periodLabelOf, periodEndDate, residualValueOf } from '@/lib/inventory/depreciationMath'
import { dayKeyLabel } from '@/lib/finance/fiscal'
import { round2, num, httpError } from '../../reports/_lib/common'

/** API shape of a run (without lines). */
export function serializeRun(run, userMap = new Map()) {
  if (!run) return null
  const runBy = run.runBy ? String(run.runBy) : null
  const reversedBy = run.reversedBy ? String(run.reversedBy) : null
  return {
    id: String(run._id ?? run.id),
    period: run.period,
    label: isValidPeriod(run.period) ? periodLabelOf(run.period) : run.period,
    status: run.status,
    // POSTING and stale ⇒ the run was interrupted; running the month again recovers it.
    interrupted: isStalePostingRun(run),
    totalAmount: round2(num(run.totalAmount)),
    assetCount: run.assetCount ?? (Array.isArray(run.lines) ? run.lines.length : 0),
    transactionId: run.transactionId ? String(run.transactionId) : null,
    runBy,
    runByName: runBy ? (userMap.get(runBy) ?? 'User') : 'Scheduler',
    notes: run.notes ?? null,
    createdAt: run.createdAt ?? null,
    updatedAt: run.updatedAt ?? null,
    reversedAt: run.reversedAt ?? null,
    reversedBy,
    reversedByName: reversedBy ? (userMap.get(reversedBy) ?? 'User') : null,
    reversalReason: run.reversalReason ?? null,
  }
}

async function userNames(runs) {
  const ids = [...new Set(runs.flatMap(r => [r.runBy, r.reversedBy]).filter(Boolean).map(String))]
  if (!ids.length) return new Map()
  const users = await User.find({ _id: { $in: ids } }).select('name').lean()
  return new Map(users.map(u => [String(u._id), u.name]))
}

/** Most recent runs first (lines omitted). */
export async function listRuns({ limit = 36 } = {}) {
  await connectDB()
  const runs = await DepreciationRun.find({}).select('-lines').sort({ period: -1 }).limit(limit).lean()
  const names = await userNames(runs)
  return runs.map(r => serializeRun(r, names))
}

export async function serializeRunWithNames(run) {
  const plain = run?.toObject ? run.toObject() : run
  const names = await userNames([plain])
  return serializeRun(plain, names)
}

/**
 * Reverse the latest POSTED depreciation run.
 * @returns {Promise<{ run, reversalTransactionId, assetCount, amount }>}
 */
export async function reverseDepreciationRun(period, { reason, session }) {
  if (!isValidPeriod(period)) throw httpError(422, 'Invalid period — use YYYY-MM')
  const why = String(reason ?? '').trim()
  if (why.length < 5) throw httpError(422, 'Give a reason (at least 5 characters) for reversing the run')
  await connectDB()

  const label = periodLabelOf(period)
  const run = await DepreciationRun.findOne({ period }).lean()
  if (!run) throw httpError(404, `No depreciation run exists for ${label}`)
  if (run.status === 'POSTING') {
    throw httpError(409, isStalePostingRun(run)
      ? `The ${label} run was interrupted while posting — run ${label} again to recover it`
      : `The ${label} run is still being posted — wait a minute and reload`)
  }
  if (run.status !== 'POSTED') throw httpError(409, `The ${label} run is already reversed`)
  const later = await DepreciationRun.findOne({ status: 'POSTED', period: { $gt: period } }).sort({ period: -1 }).select('period').lean()
  if (later) throw httpError(409, `Depreciation is posted up to ${periodLabelOf(later.period)} — reverse the later runs first, newest first`)

  const settings = await getFinanceSettings()
  const lockedUntil = settings?.lockedUntil
  if (lockedUntil && period <= String(lockedUntil).slice(0, 7)) {
    throw httpError(409, `Books are locked up to ${dayKeyLabel(lockedUntil)} — the ${label} run can no longer be reversed`)
  }
  const postingDate = periodEndDate(period)
  const lockErr = await assertBooksOpen(postingDate)
  if (lockErr) throw httpError(409, lockErr)

  const lines = run.lines || []
  const ids = lines.map(l => l.assetId)
  const assets = ids.length
    ? await Asset.find({ _id: { $in: ids } }).select('assetTag status cost depreciation disposal').lean()
    : []
  const byId = new Map(assets.map(a => [String(a._id), a]))
  const conflicts = []
  for (const line of lines) {
    const a = byId.get(String(line.assetId))
    if (!a) { conflicts.push('(deleted asset)'); continue }
    const changed = TERMINAL_STATUSES.includes(a.status) || a.disposal?.type
      || a.depreciation?.lastPostedPeriod !== period
      || Math.abs(num(a.depreciation?.accumulated) - num(line.accumulatedAfter)) > 0.005
    if (changed) conflicts.push(a.assetTag)
  }
  if (conflicts.length) {
    const shown = conflicts.slice(0, 10).join(', ')
    const more = conflicts.length > 10 ? ` and ${conflicts.length - 10} more` : ''
    throw httpError(409, `These assets changed after the run (disposed, revalued or depreciated again): ${shown}${more}. The run can no longer be reversed automatically — correct them with a value adjustment instead.`)
  }

  // The month each asset was last posted before this run (null ⇒ never).
  const prevRows = ids.length ? await DepreciationRun.aggregate([
    { $match: { status: 'POSTED', period: { $lt: period }, 'lines.assetId': { $in: ids } } },
    { $unwind: '$lines' },
    { $match: { 'lines.assetId': { $in: ids } } },
    { $group: { _id: '$lines.assetId', period: { $max: '$period' } } },
  ]) : []
  const prevById = new Map(prevRows.map(r => [String(r._id), r.period]))

  const actorId = session?.user?.id ?? null
  const claimed = await DepreciationRun.findOneAndUpdate(
    { _id: run._id, status: 'POSTED' },
    { $set: { status: 'REVERSED', reversedAt: new Date(), reversedBy: actorId, reversalReason: why } },
    { new: true },
  )
  if (!claimed) throw httpError(409, 'The run was changed by someone else — reload and try again')

  let reversalTx = null
  const reverted = []
  try {
    if (run.transactionId) {
      const original = await Transaction.findById(run.transactionId).select('_id').lean()
      if (original) {
        reversalTx = await reverseMoneyEntry(run.transactionId, {
          userId: actorId,
          date: postingDate,
          reason: `Depreciation ${label} reversed: ${why}`,
        })
      }
    }
    for (const line of lines) {
      const a = byId.get(String(line.assetId))
      const accBefore = round2(num(line.accumulatedAfter) - num(line.amount))
      const residual = residualValueOf(a)
      const fully = round2(num(a.cost) - residual - accBefore) <= 0.005
      const res = await Asset.updateOne(
        { _id: a._id, 'depreciation.lastPostedPeriod': period, 'depreciation.accumulated': a.depreciation?.accumulated ?? 0 },
        { $set: {
          'depreciation.accumulated': accBefore,
          'depreciation.lastPostedPeriod': prevById.get(String(a._id)) ?? null,
          'depreciation.fullyDepreciated': fully,
        } },
      )
      if (res.modifiedCount !== 1) throw httpError(409, `Asset ${a.assetTag} changed while the run was being reversed — nothing was reversed`)
      reverted.push(a)
    }
  } catch (err) {
    for (const a of [...reverted].reverse()) {
      try {
        await Asset.updateOne({ _id: a._id }, { $set: {
          'depreciation.accumulated': a.depreciation?.accumulated ?? 0,
          'depreciation.lastPostedPeriod': period,
          'depreciation.fullyDepreciated': Boolean(a.depreciation?.fullyDepreciated),
        } })
      } catch (e) { console.error(`[reverseDepreciationRun] restore ${a.assetTag} failed`, e) }
    }
    if (reversalTx?._id) {
      try { await Transaction.deleteOne({ _id: reversalTx._id }) } catch (e) { console.error('[reverseDepreciationRun] reversal row delete failed', e) }
    }
    try {
      await DepreciationRun.updateOne({ _id: run._id }, { $set: { status: 'POSTED', reversedAt: null, reversedBy: null, reversalReason: null } })
    } catch (e) { console.error('[reverseDepreciationRun] run restore failed', e) }
    throw err
  }

  // Timeline note per asset (best effort; events are append-only, so the reversal is a new entry).
  if (lines.length) {
    try {
      await AssetEvent.insertMany(lines.map(line => ({
        assetId: line.assetId,
        type: 'NOTE',
        date: new Date(),
        amount: -round2(num(line.amount)),
        details: {
          depreciationReversal: true,
          period,
          reversedRunId: run._id,
          accumulatedAfter: round2(num(line.accumulatedAfter) - num(line.amount)),
        },
        notes: `Depreciation for ${label} reversed — ${why}`,
        transactionId: reversalTx?._id ?? null,
        createdBy: actorId,
        createdByName: session?.user?.name ?? null,
      })), { ordered: false })
    } catch (e) {
      console.error('[reverseDepreciationRun] timeline notes failed', e)
    }
  }

  return {
    run: await serializeRunWithNames(claimed),
    reversalTransactionId: reversalTx?._id ? String(reversalTx._id) : null,
    assetCount: lines.length,
    amount: round2(num(run.totalAmount)),
  }
}
