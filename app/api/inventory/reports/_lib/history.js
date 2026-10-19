/**
 * Dated financial history of capitalised assets — the basis of the PPE
 * movement schedule (IAS 16.73) and the book-depreciation report.
 *
 * For each asset we rebuild two dated series from the permanent records:
 *
 *  cost:        ACQ       acquisition cost on the available-for-use date
 *               OPENING   opening-register cost, brought in on opening.asOfDate
 *               ADJ       later cost changes (capitalised repairs / revaluations)
 *  accumulated: OPENING   opening accumulated depreciation (opening.asOfDate)
 *               DEP       monthly runs (DepreciationRun lines, dated the last day
 *                         of the run period) + depreciation posted on disposal
 *               IMP       impairment
 *
 * Sources, in order of preference (never double counted):
 *  - DepreciationRun lines (POSTED runs only — reversed runs drop out);
 *  - ledger rows linked to the asset (Transaction.assetId) with category
 *    'Depreciation' / 'Asset Impairment' (reversals count negative); when an
 *    asset has none, the equivalent AssetEvents (DEPRECIATION without a runId,
 *    VALUE_ADJUSTED with an impairment) are used instead;
 *  - creation / VALUE_ADJUSTED events for cost.
 * Whatever cannot be traced (e.g. data edited directly) is attributed to the
 * acquisition date and counted in `unexplained` so reports can warn about it.
 */

import { Asset, AssetEvent, DepreciationRun, Transaction } from '@/models'
import { computeAssetCost } from '@/lib/inventory/constants'
import { effectiveAccumulated, periodEndDate, periodOfDate } from '@/lib/inventory/depreciationMath'
import { dhakaDayStart } from '@/lib/dhakaTime'
import { round2, num, idStr } from './common'

const toDate = (v) => {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/** First finite number among candidate values (null when none). */
function firstNumber(...vals) {
  for (const v of vals) {
    if (v === null || v === undefined || v === '') continue
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return null
}

/** Cost delta recorded on a VALUE_ADJUSTED event (null when the event did not change cost). */
function costDeltaOf(ev) {
  const d = ev.details || {}
  const before = firstNumber(d.costBefore, d.oldCost, d.previousCost, d.fromCost, d.cost?.before, d.cost?.from)
  const after = firstNumber(d.costAfter, d.newCost, d.toCost, d.cost?.after, d.cost?.to)
  if (before !== null && after !== null) return round2(after - before)
  const delta = firstNumber(d.costDelta, d.costChange, d.capitalizedAmount, d.capitalisedAmount, d.costIncrease)
  return delta === null ? null : round2(delta)
}

/** Impairment recorded on a VALUE_ADJUSTED event (0 when none). */
function impairmentOf(ev) {
  const d = ev.details || {}
  // Asset actions record { kind: 'IMPAIRMENT', amount } (lib adjust_value).
  const v = firstNumber(d.impairment, d.impairmentAmount, d.impairmentLoss, d.kind === 'IMPAIRMENT' ? (d.amount ?? ev.amount) : null)
  return v !== null && v > 0 ? round2(v) : 0
}

/**
 * Acquisition / available-for-use date of an asset. An opening-register asset
 * with neither date was in use by its opening as-of date (not the import day).
 */
export function acquisitionDateOf(asset) {
  return toDate(asset.availableForUseDate) || toDate(asset.purchase?.date)
    || (asset.opening?.isExisting ? toDate(asset.opening.asOfDate) : null) || toDate(asset.createdAt)
}

/** Date the opening register brings an existing asset onto the books (opening.asOfDate). */
function openingDateOf(asset) {
  return toDate(asset.opening?.asOfDate) || toDate(asset.createdAt)
}

/** End of the Dhaka day of a disposal (exclusive bound): events before it belong to the disposal. */
export function disposalEndOf(asset) {
  const d = toDate(asset.disposal?.date)
  return d ? dhakaDayStart(d, 1) : null // Dhaka midnight after the disposal day
}

/** Fields the history (and the tax-depreciation report, via the asset's own rate) needs from an Asset. */
export const HISTORY_ASSET_FIELDS = 'assetTag name categoryId status cost isCapitalized isArchived availableForUseDate purchase opening depreciation disposal createdAt taxClass taxRatePct'

/**
 * Build dated cost / accumulated-depreciation series for the given assets.
 * @param {object[]} assets lean assets (HISTORY_ASSET_FIELDS)
 * @returns {Promise<Map<string, { cost: Array<{date, amount, kind}>, acc: Array<{date, amount, kind, period}>,
 *   acquiredAt: Date|null, disposalEnd: Date|null, unexplainedCost: number, unexplainedAcc: number }>>}
 */
export async function buildAssetHistories(assets) {
  const out = new Map()
  if (!assets.length) return out
  const ids = assets.map(a => a._id)

  const [runRows, events, txs] = await Promise.all([
    DepreciationRun.aggregate([
      { $match: { status: 'POSTED', 'lines.assetId': { $in: ids } } },
      { $unwind: '$lines' },
      { $match: { 'lines.assetId': { $in: ids } } },
      { $project: { _id: 0, period: 1, assetId: '$lines.assetId', amount: '$lines.amount' } },
    ]),
    AssetEvent.find({
      assetId: { $in: ids },
      type: { $in: ['CREATED', 'RECEIVED', 'OPENING', 'DEPRECIATION', 'VALUE_ADJUSTED'] },
    }).select('assetId type date amount details transactionId createdAt').sort({ date: 1, createdAt: 1 }).lean(),
    Transaction.find({
      assetId: { $in: ids },
      category: { $in: ['Depreciation', 'Asset Impairment'] },
    }).select('assetId type category amount amountBDT plAmountBDT date reversalOf').lean(),
  ])

  const runsBy = new Map()
  for (const r of runRows) {
    const k = String(r.assetId)
    if (!runsBy.has(k)) runsBy.set(k, [])
    runsBy.get(k).push(r)
  }
  const eventsBy = new Map()
  for (const e of events) {
    const k = String(e.assetId)
    if (!eventsBy.has(k)) eventsBy.set(k, [])
    eventsBy.get(k).push(e)
  }
  const txBy = new Map()
  for (const t of txs) {
    const k = String(t.assetId)
    if (!txBy.has(k)) txBy.set(k, [])
    txBy.get(k).push(t)
  }

  for (const asset of assets) {
    const key = String(asset._id)
    const evs = eventsBy.get(key) || []
    const txList = txBy.get(key) || []
    const isOpening = Boolean(asset.opening?.isExisting)
    const acquiredAt = acquisitionDateOf(asset)
    const bookedAt = isOpening ? (openingDateOf(asset) || acquiredAt) : acquiredAt
    const cost = []
    const acc = []

    // ── cost ──
    const creation = evs.find(e => ['CREATED', 'RECEIVED', 'OPENING'].includes(e.type) && Number(e.amount) > 0)
    let initialCost = creation ? round2(num(creation.amount)) : null
    if (initialCost === null) {
      const fromPurchase = computeAssetCost(asset.purchase || {})
      initialCost = fromPurchase > 0 ? fromPurchase : null
    }
    const adjustments = []
    const opaqueAdjustDates = []
    for (const e of evs) {
      if (e.type !== 'VALUE_ADJUSTED') continue
      const delta = costDeltaOf(e)
      if (delta !== null && Math.abs(delta) > 0.004) adjustments.push({ date: toDate(e.date), amount: delta, kind: 'ADJ' })
      else if (delta === null && impairmentOf(e) === 0) opaqueAdjustDates.push(toDate(e.date))
    }
    const currentCost = round2(num(asset.cost))
    if (initialCost === null) initialCost = round2(currentCost - adjustments.reduce((s, a) => s + a.amount, 0))
    let unexplainedCost = round2(currentCost - initialCost - adjustments.reduce((s, a) => s + a.amount, 0))
    if (bookedAt) cost.push({ date: bookedAt, amount: initialCost, kind: isOpening ? 'OPENING' : 'ACQ' })
    for (const a of adjustments) if (a.date) cost.push(a)
    if (Math.abs(unexplainedCost) > 0.005) {
      const lastOpaque = opaqueAdjustDates.filter(Boolean).sort((x, y) => x - y).pop()
      if (lastOpaque) {
        cost.push({ date: lastOpaque, amount: unexplainedCost, kind: 'ADJ' })
        unexplainedCost = 0
      } else if (bookedAt) {
        cost[0].amount = round2(cost[0].amount + unexplainedCost)
      }
    } else {
      unexplainedCost = 0
    }

    // ── accumulated depreciation & impairment ──
    if (isOpening) {
      const openAcc = round2(num(asset.opening?.accumulatedDepreciation))
      if (openAcc > 0 && bookedAt) acc.push({ date: bookedAt, amount: openAcc, kind: 'OPENING', period: periodOfDate(bookedAt) })
    }
    for (const r of runsBy.get(key) || []) {
      const amt = round2(num(r.amount))
      if (amt) acc.push({ date: periodEndDate(r.period), amount: amt, kind: 'DEP', period: r.period })
    }
    const depTx = txList.filter(t => t.category === 'Depreciation')
    const impTx = txList.filter(t => t.category === 'Asset Impairment')
    const signed = (t) => round2((t.type === 'INCOME' ? -1 : 1) * num(t.amountBDT ?? t.amount))
    if (depTx.length) {
      for (const t of depTx) acc.push({ date: toDate(t.date), amount: signed(t), kind: 'DEP', period: periodOfDate(t.date) })
    } else {
      for (const e of evs) {
        if (e.type !== 'DEPRECIATION' || e.details?.runId) continue
        const amt = round2(num(e.amount))
        if (amt) acc.push({ date: toDate(e.date), amount: amt, kind: 'DEP', period: periodOfDate(e.date) })
      }
    }
    if (impTx.length) {
      for (const t of impTx) acc.push({ date: toDate(t.date), amount: signed(t), kind: 'IMP', period: periodOfDate(t.date) })
    } else {
      for (const e of evs) {
        if (e.type !== 'VALUE_ADJUSTED') continue
        const imp = impairmentOf(e)
        if (imp > 0) acc.push({ date: toDate(e.date), amount: imp, kind: 'IMP', period: periodOfDate(e.date) })
      }
    }
    // A run posted for the disposal month (or later) is dated after the disposal
    // day, as is the write-back that offsets it — both belong to the disposal.
    const disposalEnd = disposalEndOf(asset)
    if (disposalEnd) {
      const lastIn = new Date(disposalEnd.getTime() - 1)
      for (const x of acc) if (x.date && x.date >= disposalEnd) x.date = lastIn
    }
    const traced = round2(acc.reduce((s, x) => s + x.amount, 0))
    let unexplainedAcc = round2(effectiveAccumulated(asset) - traced)
    if (Math.abs(unexplainedAcc) > 0.005 && bookedAt) {
      acc.push({ date: bookedAt, amount: unexplainedAcc, kind: isOpening ? 'OPENING' : 'DEP', period: periodOfDate(bookedAt) })
    } else {
      unexplainedAcc = 0
    }

    out.set(key, {
      cost: cost.filter(c => c.date),
      acc: acc.filter(a => a.date),
      acquiredAt,
      bookedAt,
      disposalEnd,
      unexplainedCost,
      unexplainedAcc,
    })
  }
  return out
}

/** Σ amounts of a series with date < bound (optionally only some kinds). */
export function sumBefore(series, bound, kinds = null) {
  let s = 0
  for (const x of series) {
    if (kinds && !kinds.includes(x.kind)) continue
    if (x.date < bound) s += x.amount
  }
  return round2(s)
}

/** Σ amounts of a series with from <= date < to (optionally only some kinds). */
export function sumBetween(series, from, to, kinds = null) {
  let s = 0
  for (const x of series) {
    if (kinds && !kinds.includes(x.kind)) continue
    if (x.date >= from && x.date < to) s += x.amount
  }
  return round2(s)
}

/** Capitalised, non-archived assets with the fields the history needs. */
export async function loadCapitalisedAssets(extraFilter = {}) {
  return Asset.find({ isCapitalized: { $ne: false }, isArchived: { $ne: true }, ...extraFilter })
    .select(HISTORY_ASSET_FIELDS)
    .sort({ assetTag: 1 })
    .lean()
}

export { idStr }
