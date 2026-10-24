/**
 * lib/inventory/depreciation.js — SERVER-ONLY monthly book-depreciation runs.
 *
 * Re-exports the pure math from ./depreciationMath (client components must
 * import '@/lib/inventory/depreciationMath' directly, never this file).
 *
 *   previewDepreciation(period)               what a run for 'YYYY-MM' would post
 *   runDepreciation(period, { userId, session, notes })
 *                                             post it: one DepreciationRun per period
 *                                             (idempotent), asset accumulated / lastPostedPeriod
 *                                             updated, one NON_CASH 'Depreciation' Transaction,
 *                                             a DEPRECIATION AssetEvent per asset
 *   depreciationStatus()                      last run + the next period that is due
 *   loadTaxCostAdditions(assetIds)            later cost changes per asset for the tax schedule
 *
 * Errors are thrown as Error with `.status` (409 / 422) and a user-facing message.
 */

import connectDB from '@/lib/mongodb'
import { Asset, AssetEvent, DepreciationRun, Transaction } from '@/models'
import { getFinanceSettings, assertBooksOpen } from '@/lib/finance/settings'
import { postMoneyEntry } from '@/lib/finance/ledger'
import { COMPANY_UNIT } from '@/lib/units'
import { TERMINAL_STATUSES, isStalePostingRun } from '@/lib/inventory/constants'
import { dhakaDayKey } from '@/lib/dhakaTime'
import {
  isValidPeriod, periodOfDate, periodLabelOf, periodEndDate, shiftPeriod, comparePeriods,
  depreciationStart, effectiveAccumulated, monthlyDepreciationFor, residualValueOf, taxCostAdditionsFromEvents,
} from './depreciationMath'

export * from './depreciationMath'

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const MAX_CATCH_UP_MONTHS = 1200
const IN_PROGRESS_NOTE = 'Posting in progress…'
const RECOVERING_NOTE = 'Recovering an interrupted run…'
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

/** 'YYYY-MM-DD' ⇒ '05 Oct 2026' (falls back to the raw value). */
function dayKeyLabel(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key ?? ''))
  if (!m) return String(key ?? '')
  return `${m[3]} ${MONTHS_SHORT[Number(m[2]) - 1] ?? m[2]} ${m[1]}`
}

/** Fields the depreciation math needs. */
const ASSET_FIELDS = 'assetTag name cost isCapitalized status isArchived availableForUseDate purchase.date opening depreciation taxClass taxRatePct disposal createdAt'

/** Assets that may still need book depreciation up to `period`. */
function eligibleFilter(period) {
  return {
    isCapitalized: { $ne: false },
    isArchived: { $ne: true },
    status: { $nin: TERMINAL_STATUSES },
    'disposal.type': null,
    'depreciation.method': { $ne: 'NONE' },
    cost: { $gt: 0 },
    $or: [
      { 'depreciation.lastPostedPeriod': null },
      { 'depreciation.lastPostedPeriod': { $lt: period } },
    ],
  }
}

/**
 * Unposted depreciation for one asset from the month after its lastPostedPeriod
 * (or its start month) through `period` — i.e. the run's own month plus any
 * missed months (catch-up).
 */
function planAsset(asset, period, convention) {
  const cost = Number(asset.cost) || 0
  const residual = residualValueOf(asset)
  const accBefore = effectiveAccumulated(asset)
  const plan = {
    asset,
    fromPeriod: null,
    months: 0,
    amount: 0,
    accumulatedBefore: accBefore,
    accumulatedAfter: accBefore,
    fully: round2(cost - residual - accBefore) <= 0.005,
    storedFully: Boolean(asset.depreciation?.fullyDepreciated),
  }

  const start = depreciationStart(asset, { convention })
  if (!start || comparePeriods(start.period, period) > 0) return plan

  const last = isValidPeriod(asset.depreciation?.lastPostedPeriod) ? asset.depreciation.lastPostedPeriod : null
  let from = last ? shiftPeriod(last, 1) : start.period
  if (comparePeriods(from, start.period) < 0) from = start.period
  if (comparePeriods(from, period) > 0) return plan

  let acc = accBefore
  let total = 0
  let first = null
  let p = from
  for (let i = 0; i < MAX_CATCH_UP_MONTHS && comparePeriods(p, period) <= 0; i++) {
    const amt = monthlyDepreciationFor(asset, p, { convention, accumulated: acc })
    if (amt > 0) {
      if (!first) first = p
      acc = round2(acc + amt)
      total = round2(total + amt)
      plan.months += 1
    }
    p = shiftPeriod(p, 1)
  }
  plan.fromPeriod = first
  plan.amount = total
  plan.accumulatedAfter = acc
  plan.fully = round2(cost - residual - acc) <= 0.005
  return plan
}

async function computePlans(period, convention) {
  const assets = await Asset.find(eligibleFilter(period)).select(ASSET_FIELDS).sort({ assetTag: 1 }).lean()
  return assets.map(a => planAsset(a, period, convention))
}

/** Why `period` cannot be posted right now (null when it can). */
async function runBlocker(period, settings) {
  const label = periodLabelOf(period)
  const current = periodOfDate(new Date())
  if (comparePeriods(period, current) > 0) {
    return { status: 422, message: `${label} is in the future — depreciation can be run up to ${periodLabelOf(current)}` }
  }
  const lockedUntil = settings?.lockedUntil
  if (lockedUntil && /^\d{4}-\d{2}-\d{2}$/.test(lockedUntil) && period <= lockedUntil.slice(0, 7)) {
    return { status: 409, message: `Books are locked up to ${dayKeyLabel(lockedUntil)} — depreciation for ${label} can no longer be posted` }
  }
  const own = await DepreciationRun.findOne({ period, status: { $in: ['POSTED', 'POSTING'] } }).select('_id status updatedAt createdAt').lean()
  if (own?.status === 'POSTED') return { status: 409, message: `Depreciation for ${label} has already been posted` }
  // A stale POSTING run was interrupted — running the month again recovers it.
  if (own?.status === 'POSTING' && !isStalePostingRun(own)) {
    return { status: 409, message: `Depreciation for ${label} is being posted right now — wait a minute and reload` }
  }
  const later = await DepreciationRun.findOne({ status: { $in: ['POSTED', 'POSTING'] }, period: { $gt: period } })
    .sort({ period: -1 }).select('period status').lean()
  if (later?.status === 'POSTING') {
    return {
      status: 409,
      message: `The ${periodLabelOf(later.period)} run is being posted or was interrupted — run ${periodLabelOf(later.period)} again first`,
    }
  }
  if (later) {
    return {
      status: 409,
      message: `Depreciation is already posted up to ${periodLabelOf(later.period)} — earlier months are caught up automatically by later runs`,
    }
  }
  return null
}

/**
 * Undo a run that died while POSTING (serverless timeout, restart): put back
 * every asset it had already changed (from the planned lines saved before any
 * asset was touched), delete its ledger row if one was written, and mark it
 * REVERSED so the month can be posted again. Throws (leaving the run POSTING
 * and immediately retryable) if an asset cannot be restored.
 * @returns {Promise<object>} the run (lean) as REVERSED
 */
async function recoverStaleRun(run) {
  const label = periodLabelOf(run.period)
  // Claim the recovery (only one caller wins; bumps updatedAt so the run is "fresh" again).
  const claimed = await DepreciationRun.findOneAndUpdate(
    { _id: run._id, status: 'POSTING', updatedAt: run.updatedAt },
    { $set: { notes: RECOVERING_NOTE } },
    { new: true },
  ).lean()
  if (!claimed) throw httpError(409, `Depreciation for ${label} is being posted right now — wait a minute and reload`)

  try {
    for (const l of claimed.lines || []) {
      if (l.accumulatedBefore === null || l.accumulatedBefore === undefined) continue
      // Only assets the dead run actually changed still carry its period and amount.
      await Asset.updateOne(
        { _id: l.assetId, 'depreciation.lastPostedPeriod': claimed.period, 'depreciation.accumulated': l.accumulatedAfter },
        { $set: {
          'depreciation.accumulated': l.accumulatedBefore,
          'depreciation.lastPostedPeriod': l.prevPeriod ?? null,
          'depreciation.fullyDepreciated': Boolean(l.fullyBefore),
        } },
      )
    }
    if (claimed.transactionId) await Transaction.deleteOne({ _id: claimed.transactionId })
  } catch (err) {
    // Make the run stale again so the next attempt retries the recovery straight away.
    await DepreciationRun.updateOne(
      { _id: run._id, status: 'POSTING' },
      { $set: { notes: IN_PROGRESS_NOTE, updatedAt: new Date(0) } },
      { timestamps: false },
    ).catch(e => console.error('[runDepreciation] recovery: un-claim failed', e))
    throw err
  }

  const reversed = await DepreciationRun.findOneAndUpdate(
    { _id: run._id, status: 'POSTING' },
    { $set: {
      status: 'REVERSED', totalAmount: 0, assetCount: 0, lines: [], transactionId: null,
      notes: 'Interrupted while posting — recovered',
      reversedAt: new Date(), reversedBy: null, reversalReason: 'interrupted while posting',
    } },
    { new: true },
  ).lean()
  if (!reversed) throw httpError(409, `Depreciation for ${label} is being posted right now — wait a minute and reload`)
  return reversed
}

function serializeRun(run) {
  if (!run) return null
  return {
    id: String(run._id ?? run.id),
    period: run.period,
    status: run.status,
    totalAmount: round2(run.totalAmount ?? 0),
    assetCount: run.assetCount ?? (run.lines?.length || 0),
    transactionId: run.transactionId ? String(run.transactionId) : null,
    runBy: run.runBy ? String(run.runBy) : null,
    notes: run.notes ?? null,
    createdAt: run.createdAt ?? null,
  }
}

function previewLine(plan, period) {
  const a = plan.asset
  return {
    assetId: String(a._id),
    tag: a.assetTag,
    name: a.name,
    amount: plan.amount,
    fromPeriod: plan.fromPeriod || period,
    months: plan.months || 1,
    catchUp: Boolean(plan.fromPeriod && plan.fromPeriod !== period),
    accumulatedAfter: plan.accumulatedAfter,
    bookValueAfter: round2((Number(a.cost) || 0) - plan.accumulatedAfter),
  }
}

/**
 * What a depreciation run for `period` posts (or posted).
 *
 * @param {string} period 'YYYY-MM'
 * @param {object} [opts]
 * @param {'PRORATA_DAYS'|'FULL_MONTH'} [opts.convention] override the settings convention
 * @returns {Promise<{ period, label, convention, posted, run, lines: Array<{ assetId, tag, name, amount,
 *           fromPeriod, months, catchUp, accumulatedAfter, bookValueAfter }>, total, assetCount,
 *           canRun, blockedReason, postToLedger }>}
 */
export async function previewDepreciation(period, { convention: conventionOverride } = {}) {
  if (!isValidPeriod(period)) throw httpError(422, 'Invalid period — use YYYY-MM')
  await connectDB()
  const settings = await getFinanceSettings()
  const convention = conventionOverride || settings?.inventory?.depreciationConvention || 'PRORATA_DAYS'
  const postToLedger = settings?.inventory?.postDepreciationToLedger !== false
  const label = periodLabelOf(period)

  const existing = await DepreciationRun.findOne({ period }).lean()
  if (existing?.status === 'POSTED') {
    const runLines = existing.lines || []
    const ids = runLines.map(l => l.assetId).filter(Boolean)
    const assets = ids.length ? await Asset.find({ _id: { $in: ids } }).select('assetTag name cost').lean() : []
    const byId = new Map(assets.map(a => [String(a._id), a]))
    const lines = runLines.map(l => {
      const a = byId.get(String(l.assetId))
      const acc = l.accumulatedAfter ?? null
      return {
        assetId: String(l.assetId),
        tag: a?.assetTag ?? null,
        name: a?.name ?? '(deleted asset)',
        amount: round2(l.amount ?? 0),
        fromPeriod: l.fromPeriod || period,
        months: l.months || 1,
        catchUp: Boolean(l.fromPeriod && l.fromPeriod !== period),
        accumulatedAfter: acc,
        bookValueAfter: a && acc !== null ? round2((Number(a.cost) || 0) - acc) : null,
      }
    }).sort((x, y) => String(x.tag ?? '').localeCompare(String(y.tag ?? '')))
    return {
      period, label, convention, posted: true, run: serializeRun(existing),
      lines, total: round2(existing.totalAmount ?? 0), assetCount: lines.length,
      canRun: false, blockedReason: `Depreciation for ${label} has already been posted`, postToLedger,
    }
  }

  const plans = await computePlans(period, convention)
  const lines = plans.filter(p => p.amount > 0).map(p => previewLine(p, period))
  const total = round2(lines.reduce((s, l) => s + l.amount, 0))
  const blocker = await runBlocker(period, settings)
  return {
    period, label, convention, posted: false, run: serializeRun(existing),
    lines, total, assetCount: lines.length,
    canRun: !blocker, blockedReason: blocker?.message ?? null, postToLedger,
  }
}

function buildRunNotes({ userNotes, applied, skipped, period, postToLedger, total, previous }) {
  const parts = []
  if (userNotes && String(userNotes).trim()) parts.push(String(userNotes).trim())
  const catchUps = applied.filter(p => p.fromPeriod && p.fromPeriod !== period)
  if (catchUps.length) {
    const shown = catchUps.slice(0, 20)
      .map(p => `${p.asset.assetTag} (${periodLabelOf(p.fromPeriod)} – ${periodLabelOf(period)})`)
    const more = catchUps.length > shown.length ? `, +${catchUps.length - shown.length} more` : ''
    parts.push(`Catch-up of missed months included for ${catchUps.length} asset(s): ${shown.join(', ')}${more}`)
  }
  if (skipped.length) {
    const shown = skipped.slice(0, 20).join(', ')
    const more = skipped.length > 20 ? `, +${skipped.length - 20} more` : ''
    parts.push(`Skipped because the asset changed while posting (caught up by the next run): ${shown}${more}`)
  }
  if (!postToLedger && total > 0) parts.push('Not posted to the ledger (inventory setting "Post depreciation to ledger" is off)')
  if (previous) {
    const when = previous.reversedAt ? ` reversed on ${dhakaDayKey(previous.reversedAt)}` : ' reversed'
    parts.push(`Re-posted after the earlier run was${when}${previous.reversalReason ? ` (${previous.reversalReason})` : ''}`)
  }
  return parts.length ? parts.join('\n') : null
}

/**
 * Post book depreciation for `period` ('YYYY-MM').
 *
 * - Idempotent per period (DepreciationRun.period is unique): a second run is refused (409).
 * - Refuses future periods (> current Dhaka month, 422), periods on/before the books lock,
 *   and periods earlier than an already posted run (409).
 * - Catch-up: an asset whose lastPostedPeriod is before period − 1 (or never posted) gets the
 *   missed months summed into this run's line (line.fromPeriod / line.months record it).
 * - Each asset: depreciation.accumulated += amount, lastPostedPeriod = period, fullyDepreciated.
 *   Updates are guarded on the values read, so an asset changed concurrently is skipped (and
 *   caught up by the next run) instead of being double-posted.
 * - When settings.inventory.postDepreciationToLedger (default true) and total > 0: one
 *   Transaction via postMoneyEntry — EXPENSE, kind NON_CASH, category 'Depreciation',
 *   amount = amountBDT = plAmountBDT = total, accountId null, dated the last day of the period.
 * - Writes a DEPRECIATION AssetEvent per asset (best effort).
 * - Any failure before the run is finalised rolls back the asset updates, the transaction and the run.
 * - The run is POSTING (with the planned lines and each asset's prior state) until it is
 *   finalised as POSTED. If the request dies part-way, the POSTING run goes stale after
 *   DEPRECIATION_POSTING_STALE_MS and running the month again first undoes it (recoverStaleRun).
 *
 * @param {string} period
 * @param {object} [opts]
 * @param {string} [opts.userId]   acting user id (defaults to session.user.id)
 * @param {object} [opts.session]  next-auth session (createdBy / createdByName on events)
 * @param {string} [opts.notes]    free-text note stored on the run
 * @returns {Promise<import('mongoose').Document>} the DepreciationRun document
 */
export async function runDepreciation(period, { userId = null, session = null, notes = null } = {}) {
  if (!isValidPeriod(period)) throw httpError(422, 'Invalid period — use YYYY-MM')
  await connectDB()

  const settings = await getFinanceSettings()
  const convention = settings?.inventory?.depreciationConvention || 'PRORATA_DAYS'
  const postToLedger = settings?.inventory?.postDepreciationToLedger !== false
  const label = periodLabelOf(period)
  const postingDate = periodEndDate(period)
  const actorId = userId || session?.user?.id || null
  const actorName = session?.user?.name || null

  const blocker = await runBlocker(period, settings)
  if (blocker) throw httpError(blocker.status, blocker.message)
  const lockErr = await assertBooksOpen(postingDate)
  if (lockErr) throw httpError(409, lockErr)

  // ── 1. Claim the period (the unique index makes this the idempotency gate) ──
  // The run stays POSTING until it is finalised; what it plans to change is saved
  // before any asset is touched, so an interrupted run can be undone (recoverStaleRun).
  let run
  let previous = null
  let existing = await DepreciationRun.findOne({ period }).lean()
  if (existing?.status === 'POSTING') {
    if (!isStalePostingRun(existing)) throw httpError(409, `Depreciation for ${label} is being posted right now — wait a minute and reload`)
    existing = await recoverStaleRun(existing)
  }
  if (existing) {
    if (existing.status === 'POSTED') throw httpError(409, `Depreciation for ${label} has already been posted`)
    previous = existing
    run = await DepreciationRun.findOneAndUpdate(
      { _id: existing._id, status: 'REVERSED' },
      { $set: {
        status: 'POSTING', totalAmount: 0, assetCount: 0, lines: [], transactionId: null,
        runBy: actorId, notes: IN_PROGRESS_NOTE, reversedAt: null, reversedBy: null, reversalReason: null,
      } },
      { new: true },
    )
    if (!run) throw httpError(409, `Depreciation for ${label} is already being posted`)
  } else {
    try {
      run = await DepreciationRun.create({
        period, status: 'POSTING', totalAmount: 0, assetCount: 0, lines: [], runBy: actorId, notes: IN_PROGRESS_NOTE,
      })
    } catch (err) {
      if (err?.code === 11000) throw httpError(409, `Depreciation for ${label} has already been posted`)
      throw err
    }
  }

  // ── 2. Save the plan, apply to assets, post the ledger row, finalise the run ──
  const applied = []
  const skipped = []
  let plans = []
  let tx = null
  try {
    plans = await computePlans(period, convention)

    const planned = plans.filter(p => p.amount > 0).map(p => ({
      assetId: p.asset._id,
      amount: p.amount,
      accumulatedAfter: p.accumulatedAfter,
      accumulatedBefore: p.asset.depreciation?.accumulated ?? 0,
      prevPeriod: p.asset.depreciation?.lastPostedPeriod ?? null,
      fullyBefore: p.storedFully,
      fromPeriod: p.fromPeriod && p.fromPeriod !== period ? p.fromPeriod : null,
      months: p.months || 1,
    }))
    if (planned.length) await DepreciationRun.updateOne({ _id: run._id, status: 'POSTING' }, { $set: { lines: planned } })

    for (const plan of plans) {
      if (!(plan.amount > 0)) continue
      const a = plan.asset
      const res = await Asset.updateOne(
        {
          _id: a._id,
          status: { $nin: TERMINAL_STATUSES },
          'depreciation.lastPostedPeriod': a.depreciation?.lastPostedPeriod ?? null,
          'depreciation.accumulated': a.depreciation?.accumulated ?? null,
        },
        { $set: {
          'depreciation.accumulated': plan.accumulatedAfter,
          'depreciation.lastPostedPeriod': period,
          'depreciation.fullyDepreciated': plan.fully,
        } },
      )
      if (res.modifiedCount === 1) applied.push(plan)
      else skipped.push(a.assetTag)
    }

    const total = round2(applied.reduce((s, p) => s + p.amount, 0))

    if (postToLedger && total > 0) {
      tx = await postMoneyEntry({
        type: 'EXPENSE',
        kind: 'NON_CASH',
        category: 'Depreciation',
        expenseCategory: 'Depreciation',
        amount: total,
        currency: 'BDT',
        amountBDT: total,
        plAmountBDT: total,
        date: postingDate,
        accountId: null,
        description: `Depreciation — ${label}`,
        // DEP202610 (runs posted before 2026-10 carry DEP-2026-10); runs are found
        // by DepreciationRun.period / transactionId, never by this reference.
        reference: `DEP${period.replace('-', '')}`,
        // A shared cost: depreciation is never split across ventures / products.
        unit: COMPANY_UNIT,
        createdBy: actorId,
      }, { userId: actorId })
      await DepreciationRun.updateOne({ _id: run._id, status: 'POSTING' }, { $set: { transactionId: tx._id } })
    }

    const finalised = await DepreciationRun.findOneAndUpdate(
      { _id: run._id, status: 'POSTING' },
      { $set: {
        status: 'POSTED',
        totalAmount: total,
        assetCount: applied.length,
        lines: applied.map(p => ({
          assetId: p.asset._id,
          amount: p.amount,
          accumulatedAfter: p.accumulatedAfter,
          fromPeriod: p.fromPeriod && p.fromPeriod !== period ? p.fromPeriod : null,
          months: p.months || 1,
          accumulatedBefore: p.asset.depreciation?.accumulated ?? 0,
          prevPeriod: p.asset.depreciation?.lastPostedPeriod ?? null,
          fullyBefore: p.storedFully,
        })),
        transactionId: tx?._id ?? null,
        runBy: actorId,
        notes: buildRunNotes({ userNotes: notes, applied, skipped, period, postToLedger, total, previous }),
      } },
      { new: true },
    )
    if (!finalised) throw httpError(409, `Depreciation for ${label} was changed while posting — reload and check the run`)
    run = finalised
  } catch (err) {
    await rollbackRun({ run, previous, applied, tx, period })
    throw err
  }

  // ── 3. Best-effort follow-ups (the run itself is complete) ──
  try {
    // Keep the fullyDepreciated flag honest for assets that had nothing to post.
    const flagOps = plans
      .filter(p => !(p.amount > 0) && p.fully !== p.storedFully)
      .map(p => ({ updateOne: { filter: { _id: p.asset._id }, update: { $set: { 'depreciation.fullyDepreciated': p.fully } } } }))
    if (flagOps.length) await Asset.bulkWrite(flagOps, { ordered: false })
  } catch (err) {
    console.error('[runDepreciation] fullyDepreciated flag refresh failed', err)
  }

  if (applied.length) {
    try {
      await AssetEvent.insertMany(applied.map(p => ({
        assetId: p.asset._id,
        type: 'DEPRECIATION',
        date: postingDate,
        amount: p.amount,
        details: {
          period,
          runId: run._id,
          fromPeriod: p.fromPeriod || period,
          months: p.months || 1,
          catchUp: Boolean(p.fromPeriod && p.fromPeriod !== period),
          accumulatedBefore: p.accumulatedBefore,
          accumulatedAfter: p.accumulatedAfter,
          bookValueAfter: round2((Number(p.asset.cost) || 0) - p.accumulatedAfter),
          fullyDepreciated: p.fully,
        },
        notes: p.fromPeriod && p.fromPeriod !== period
          ? `Depreciation ${periodLabelOf(p.fromPeriod)} – ${label} (catch-up)`
          : `Depreciation — ${label}`,
        transactionId: tx?._id ?? null,
        createdBy: actorId,
        createdByName: actorName,
      })), { ordered: false })
    } catch (err) {
      console.error('[runDepreciation] asset event logging failed', err)
    }
  }

  return run
}

/** Undo a partially applied run (compensating writes; never throws). */
async function rollbackRun({ run, previous, applied, tx, period }) {
  if (tx?._id) {
    try { await Transaction.deleteOne({ _id: tx._id }) } catch (e) { console.error('[runDepreciation] rollback: transaction delete failed', e) }
  }
  for (const plan of [...applied].reverse()) {
    try {
      await Asset.updateOne(
        { _id: plan.asset._id, 'depreciation.lastPostedPeriod': period, 'depreciation.accumulated': plan.accumulatedAfter },
        { $set: {
          'depreciation.accumulated': plan.asset.depreciation?.accumulated ?? 0,
          'depreciation.lastPostedPeriod': plan.asset.depreciation?.lastPostedPeriod ?? null,
          'depreciation.fullyDepreciated': plan.storedFully,
        } },
      )
    } catch (e) {
      console.error(`[runDepreciation] rollback: asset ${plan.asset.assetTag} restore failed`, e)
    }
  }
  if (!run?._id) return
  try {
    if (previous) {
      await DepreciationRun.updateOne({ _id: run._id, status: 'POSTING' }, { $set: {
        status: previous.status,
        totalAmount: previous.totalAmount ?? 0,
        assetCount: previous.assetCount ?? 0,
        lines: previous.lines ?? [],
        transactionId: previous.transactionId ?? null,
        runBy: previous.runBy ?? null,
        notes: previous.notes ?? null,
        reversedAt: previous.reversedAt ?? null,
        reversedBy: previous.reversedBy ?? null,
        reversalReason: previous.reversalReason ?? null,
      } })
    } else {
      await DepreciationRun.deleteOne({ _id: run._id, status: 'POSTING' })
    }
  } catch (e) {
    console.error('[runDepreciation] rollback: run restore failed', e)
  }
}

/**
 * Depreciation dashboard status.
 * nextPeriod = the month after the last POSTED run, or the previous Dhaka month when nothing
 * has been posted yet (catch-up then picks up any earlier months).
 * due = nextPeriod is a completed month (before the current month).
 *
 * @returns {Promise<{ currentPeriod, previousPeriod, lastRun, nextPeriod, nextLabel, due }>}
 */
export async function depreciationStatus() {
  await connectDB()
  const currentPeriod = periodOfDate(new Date())
  const previousPeriod = shiftPeriod(currentPeriod, -1)
  const last = await DepreciationRun.findOne({ status: 'POSTED' }).sort({ period: -1 }).lean()
  const nextPeriod = last ? shiftPeriod(last.period, 1) : previousPeriod
  return {
    currentPeriod,
    previousPeriod,
    lastRun: serializeRun(last),
    nextPeriod,
    nextLabel: periodLabelOf(nextPeriod),
    due: comparePeriods(nextPeriod, currentPeriod) < 0,
  }
}

/**
 * Cost changes after acquisition for each asset — the `costAdditions` that
 * taxDepreciationSchedule needs so later capitalised repairs / cost corrections
 * join the income year they happened in instead of rewriting earlier years.
 *
 * @param {Array<import('mongoose').Types.ObjectId|string>} assetIds
 * @returns {Promise<Map<string, Array<{ date: Date, amount: number }>>>} keyed by asset id
 */
export async function loadTaxCostAdditions(assetIds) {
  const out = new Map()
  const ids = (assetIds || []).filter(Boolean)
  if (!ids.length) return out
  await connectDB()
  const events = await AssetEvent.find({
    assetId: { $in: ids },
    $or: [{ type: 'VALUE_ADJUSTED' }, { type: 'REPAIR_COMPLETED', 'details.capitalize': true }],
  }).select('assetId type date amount details').sort({ date: 1, createdAt: 1 }).lean()
  const byAsset = new Map()
  for (const e of events) {
    const k = String(e.assetId)
    if (!byAsset.has(k)) byAsset.set(k, [])
    byAsset.get(k).push(e)
  }
  for (const [k, list] of byAsset) out.set(k, taxCostAdditionsFromEvents(list))
  return out
}
