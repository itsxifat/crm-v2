/**
 * lib/inventory/depreciationMath.js — PURE depreciation math (no server imports).
 *
 * Safe to import from 'use client' components and loadable directly by Node
 * (relative imports only, no '@/…' aliases). The server module
 * lib/inventory/depreciation.js re-exports everything here.
 *
 * Two books per asset:
 *
 *  BOOK (IAS 16 / BFRS) — monthly, posted by runDepreciation():
 *   - starts at asset.availableForUseDate (fallback purchase.date, createdAt);
 *     for opening/existing assets, the day after opening.asOfDate (the opening
 *     accumulated depreciation covers everything up to that day);
 *   - STRAIGHT_LINE: (cost − residual) / usefulLifeMonths per month;
 *     DECLINING_BALANCE: (cost − accumulated) × rate / 12 / 100 per month;
 *   - first month prorated by the days remaining in the month (PRORATA_DAYS:
 *     acquired 10 Mar ⇒ 22/31) or charged in full (FULL_MONTH);
 *   - disposal month prorated up to and including the disposal date, nothing after;
 *   - never exceeds cost − residual − accumulated (the last month takes the remainder).
 *
 *  TAX (Income Tax Act 2023, Third Schedule) — per income year (July–June):
 *   - written-down value at the class rate (straight-line on cost for the
 *     software classes), FULL year's allowance in the year of acquisition,
 *     NO allowance in the year of disposal (para 7), total allowances never
 *     exceed cost, motor-vehicle cost capped (para 3(1));
 *   - opening.taxWdv / opening.taxWdvFiscalYear override the starting point
 *     (taxWdv = the tax WDV brought forward at the START of that income year).
 *
 * Worked example (res_assets.md §4): laptop Tk 150,000 bought 10 Mar 2026,
 * 36-month life, class COMPUTER (25%):
 *   book: Mar 2026 = 4,166.67 × 22/31 = 2,956.99; Apr 2026 onwards 4,166.67/month;
 *   tax:  FY 2025-26 allowance 37,500 (WDV 112,500); FY 2026-27 28,125 (WDV 84,375).
 *   A Tk 20,000 repair capitalised on 5 Sep 2026 joins FY 2026-27 only:
 *   (112,500 + 20,000) × 25% = 33,125 (WDV 99,375); FY 2025-26 is unchanged.
 */

import * as catalog from '../tax/catalog.js'
import { dhakaParts, dhakaDate } from '../dhakaTime.js'

// ─── Generic helpers ────────────────────────────────────────────────────────

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const pad2 = (n) => String(n).padStart(2, '0')
const DAY_MS = 24 * 60 * 60 * 1000
/** Hard cap on month/year loops so a corrupt date can never spin forever. */
const MAX_MONTHS = 1200
const MAX_YEARS = 200

const FALLBACK_TAX_CLASS = { label: 'Other assets', rate: 10, bookLifeMonths: 60 }

/** Third Schedule class metadata for a TAX_DEPRECIATION_CLASSES key (falls back to OTHER). */
export function taxClassOf(key) {
  const classes = catalog.TAX_DEPRECIATION_CLASSES || {}
  return classes[key] || classes.OTHER || FALLBACK_TAX_CLASS
}

/**
 * Coerce a Date | ISO string | 'YYYY-MM-DD' (read as a Dhaka calendar day) |
 * timestamp into a Date. Returns null when missing or invalid.
 */
export function toDateValue(value) {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'string') {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim())
    if (m) {
      const d = dhakaDate(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
      return Number.isNaN(d.getTime()) ? null : d
    }
  }
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

// ─── Period helpers ('YYYY-MM', Dhaka calendar) ─────────────────────────────

const PERIOD_RE = /^(\d{4})-(0[1-9]|1[0-2])$/

/** true for a well-formed 'YYYY-MM' string. */
export function isValidPeriod(period) {
  return typeof period === 'string' && PERIOD_RE.test(period)
}

function parsePeriod(period) {
  const m = PERIOD_RE.exec(String(period ?? ''))
  if (!m) throw new Error(`Invalid period "${period}" (expected YYYY-MM)`)
  return { year: Number(m[1]), month: Number(m[2]) } // month 1-12
}

const periodIndex = (period) => {
  const { year, month } = parsePeriod(period)
  return year * 12 + (month - 1)
}
const periodFromIndex = (idx) => `${Math.floor(idx / 12)}-${pad2((idx % 12) + 1)}`

/** 'YYYY-MM' of the Dhaka calendar month containing `date` (null when invalid). */
export function periodOfDate(date = new Date()) {
  const d = toDateValue(date)
  if (!d) return null
  const { year, month } = dhakaParts(d)
  return `${year}-${pad2(month + 1)}`
}

/** '2026-10' shifted by n months ('2026-10', 3 ⇒ '2027-01'). */
export function shiftPeriod(period, n) {
  return periodFromIndex(periodIndex(period) + Math.trunc(Number(n) || 0))
}

/** <0 / 0 / >0 like a comparator. */
export function comparePeriods(a, b) {
  return periodIndex(a) - periodIndex(b)
}

/** Number of calendar months from a to b (b − a); 0 when equal. */
export function monthsBetween(a, b) {
  return periodIndex(b) - periodIndex(a)
}

/** Days in the month of a period ('2026-02' ⇒ 28). */
export function daysInPeriod(period) {
  const { year, month } = parsePeriod(period)
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** Dhaka midnight at the start of the period's first day. */
export function periodStartDate(period) {
  const { year, month } = parsePeriod(period)
  return dhakaDate(year, month - 1, 1)
}

/** Dhaka midnight at the start of the period's LAST day (the ledger date for a monthly posting). */
export function periodEndDate(period) {
  const { year, month } = parsePeriod(period)
  return dhakaDate(year, month - 1, daysInPeriod(period))
}

const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/** 'Oct 2026' for '2026-10'. */
export function periodLabelOf(period) {
  const { year, month } = parsePeriod(period)
  return `${MONTHS_SHORT[month - 1]} ${year}`
}

// ─── Fiscal / income-year helpers ───────────────────────────────────────────

/** Calendar year in which the fiscal year containing `date` starts (Dhaka). */
export function fiscalYearStartYear(date, startMonth = 7) {
  const d = toDateValue(date)
  if (!d) return null
  const { year, month } = dhakaParts(d)
  const sm = Math.min(12, Math.max(1, Math.trunc(Number(startMonth) || 7)))
  return month + 1 >= sm ? year : year - 1
}

/** Fiscal-year label for a start year: 2026 ⇒ '2026-27' ('2026' when the FY is the calendar year). */
export function fiscalYearLabel(startYear, startMonth = 7) {
  const y = Math.trunc(Number(startYear))
  if (Number(startMonth) === 1) return String(y)
  return `${y}-${pad2((y + 1) % 100)}`
}

/** '2026-27' (or '2026') ⇒ 2026; null when unparseable. */
export function parseFiscalYear(fy) {
  const m = /^(\d{4})/.exec(String(fy ?? '').trim())
  return m ? Number(m[1]) : null
}

/** Fiscal-year label of a date: 10 Mar 2026 ⇒ '2025-26' (July start). */
export function fiscalYearLabelOf(date, startMonth = 7) {
  const y = fiscalYearStartYear(date, startMonth)
  return y === null ? null : fiscalYearLabel(y, startMonth)
}

// ─── Asset accessors ────────────────────────────────────────────────────────

/** Useful life in months: asset override, else the Third Schedule class's book life. */
export function usefulLifeMonthsOf(asset) {
  const own = Number(asset?.depreciation?.usefulLifeMonths)
  if (own > 0) return own
  const cls = taxClassOf(asset?.taxClass)
  return Number(cls?.bookLifeMonths) > 0 ? Number(cls.bookLifeMonths) : 0
}

/** Annual declining-balance rate %: asset override, else double-declining (2 ÷ life years), else the tax rate. */
export function decliningRateOf(asset) {
  const own = Number(asset?.depreciation?.decliningRatePct)
  if (own > 0) return own
  const life = usefulLifeMonthsOf(asset)
  if (life > 0) return round2(2400 / life)
  const tax = Number(asset?.taxRatePct)
  return tax > 0 ? tax : 0
}

/** Residual value clamped to [0, cost]. */
export function residualValueOf(asset) {
  const cost = num(asset?.cost)
  return Math.min(Math.max(num(asset?.depreciation?.residualValue), 0), Math.max(cost, 0))
}

/**
 * Accumulated book depreciation to continue from. Normally
 * depreciation.accumulated; for an existing (opening) asset that has never been
 * posted, the larger of that and opening.accumulatedDepreciation — so an opening
 * register is honoured even if the creator did not copy the figure across.
 */
export function effectiveAccumulated(asset) {
  const acc = num(asset?.depreciation?.accumulated)
  const op = asset?.opening
  if (op?.isExisting && !asset?.depreciation?.lastPostedPeriod) {
    const opAcc = num(op.accumulatedDepreciation)
    if (opAcc > acc) return round2(opAcc)
  }
  return round2(acc)
}

/** Net book value = cost − accumulated (never below 0 shown as negative; rounded). */
export function bookValueOf(asset, accumulated = null) {
  const acc = accumulated === null || accumulated === undefined ? effectiveAccumulated(asset) : num(accumulated)
  return round2(num(asset?.cost) - acc)
}

/**
 * When book depreciation starts.
 * Returns { date, period, day } (day = first day charged in `period`) or null.
 *  - availableForUseDate ⇒ purchase.date ⇒ createdAt;
 *  - opening.isExisting: no earlier than the day after opening.asOfDate
 *    (createdAt when asOfDate is missing). Under FULL_MONTH an opening start
 *    that falls mid-month moves to the next month (that month is already
 *    covered by the opening accumulated depreciation);
 *  - FULL_MONTH otherwise charges the whole first month (day = 1).
 */
export function depreciationStart(asset, { convention = 'PRORATA_DAYS' } = {}) {
  if (!asset) return null
  let start = toDateValue(asset.availableForUseDate) || toDateValue(asset.purchase?.date) || null
  let fromOpening = false
  const op = asset.opening
  if (op?.isExisting) {
    const coveredUntil = toDateValue(op.asOfDate) || toDateValue(asset.createdAt)
    if (coveredUntil) {
      const after = new Date(coveredUntil.getTime() + DAY_MS)
      if (!start || after.getTime() > start.getTime()) {
        start = after
        fromOpening = true
      }
    }
  }
  if (!start) start = toDateValue(asset.createdAt)
  if (!start) return null

  const { year, month, day } = dhakaParts(start)
  let period = `${year}-${pad2(month + 1)}`
  let firstDay = day
  if (convention === 'FULL_MONTH') {
    if (fromOpening && day !== 1) period = shiftPeriod(period, 1)
    firstDay = 1
  }
  return { date: start, period, day: firstDay }
}

// ─── Book depreciation ──────────────────────────────────────────────────────

/**
 * Book depreciation for one month with the reasoning behind it.
 *
 * @param {object} asset   Asset (lean or document)
 * @param {string} period  'YYYY-MM'
 * @param {object} [opts]
 * @param {'PRORATA_DAYS'|'FULL_MONTH'} [opts.convention='PRORATA_DAYS']
 * @param {number} [opts.accumulated]  accumulated depreciation BEFORE this month
 *                                     (default effectiveAccumulated(asset)) — pass the
 *                                     running total when projecting several months
 * @param {Date|string} [opts.endDate] last day depreciated (disposal date); default
 *                                     asset.disposal.date
 * @returns {{ period, amount, days, daysInMonth, fraction, reason }}
 *   reason is null when a charge was computed, else one of NO_ASSET, METHOD_NONE,
 *   NOT_CAPITALIZED, NO_COST, FULLY_DEPRECIATED, NO_START_DATE, NOT_STARTED,
 *   DISPOSED, NO_USEFUL_LIFE, NO_RATE.
 */
export function depreciationForPeriod(asset, period, { convention = 'PRORATA_DAYS', accumulated, endDate } = {}) {
  const dim = daysInPeriod(period)
  const zero = (reason) => ({ period, amount: 0, days: 0, daysInMonth: dim, fraction: 0, reason })
  if (!asset) return zero('NO_ASSET')

  const method = asset.depreciation?.method || 'STRAIGHT_LINE'
  if (method === 'NONE') return zero('METHOD_NONE')
  if (asset.isCapitalized === false) return zero('NOT_CAPITALIZED')

  const cost = num(asset.cost)
  if (cost <= 0) return zero('NO_COST')
  const residual = residualValueOf(asset)
  const acc = accumulated === null || accumulated === undefined ? effectiveAccumulated(asset) : num(accumulated)
  const remaining = round2(cost - residual - acc)
  if (remaining <= 0.005) return zero('FULLY_DEPRECIATED')

  const start = depreciationStart(asset, { convention })
  if (!start) return zero('NO_START_DATE')
  if (comparePeriods(period, start.period) < 0) return zero('NOT_STARTED')

  // depreciationStart already returns day 1 under FULL_MONTH
  const firstDay = comparePeriods(period, start.period) === 0 ? start.day : 1
  let lastDay = dim
  const end = toDateValue(endDate) || toDateValue(asset.disposal?.date)
  if (end) {
    const endPeriod = periodOfDate(end)
    const cmp = comparePeriods(period, endPeriod)
    if (cmp > 0) return zero('DISPOSED')
    if (cmp === 0) lastDay = dhakaParts(end).day
  }
  const days = lastDay - firstDay + 1
  if (days <= 0) return zero('DISPOSED')
  const fraction = days >= dim ? 1 : days / dim

  let raw
  if (method === 'DECLINING_BALANCE') {
    const rate = decliningRateOf(asset)
    if (!(rate > 0)) return zero('NO_RATE')
    raw = (cost - acc) * (rate / 12 / 100) * fraction
  } else {
    const life = usefulLifeMonthsOf(asset)
    if (!(life > 0)) return zero('NO_USEFUL_LIFE')
    raw = ((cost - residual) / life) * fraction
  }

  let amount = round2(raw)
  if (amount > remaining) amount = remaining
  if (amount < 0) amount = 0
  return { period, amount, days, daysInMonth: dim, fraction, reason: null }
}

/**
 * Book depreciation amount (BDT) for one month — 0 when the method is NONE, the
 * month is before the start or after the disposal month, or the asset is fully
 * depreciated. See depreciationForPeriod for the options.
 */
export function monthlyDepreciationFor(asset, period, { convention = 'PRORATA_DAYS', accumulated, endDate } = {}) {
  return depreciationForPeriod(asset, period, { convention, accumulated, endDate }).amount
}

const STOP_REASONS = new Set(['NO_ASSET', 'METHOD_NONE', 'NOT_CAPITALIZED', 'NO_COST', 'NO_START_DATE', 'NO_USEFUL_LIFE', 'NO_RATE'])

/**
 * Book depreciation schedule (projection).
 *
 * basis 'posted' (default) continues from the asset's posted state: the first
 * month is the one after depreciation.lastPostedPeriod (or the start month) and
 * accumulated starts from effectiveAccumulated(asset). basis 'theoretical'
 * rebuilds the whole schedule from the start month (accumulated starts at the
 * opening accumulated depreciation, or 0).
 *
 * Rows are emitted for periods in [fromPeriod, toPeriod]. Without toPeriod the
 * schedule runs until the asset is fully depreciated or disposed.
 *
 * @returns {Array<{ period, amount, accumulated, bookValue }>}
 */
export function bookSchedule(asset, { convention = 'PRORATA_DAYS', fromPeriod, toPeriod, basis = 'posted', endDate } = {}) {
  if (!asset) return []
  const start = depreciationStart(asset, { convention })
  if (!start) return []
  if (fromPeriod && !isValidPeriod(fromPeriod)) throw new Error(`Invalid period "${fromPeriod}" (expected YYYY-MM)`)
  if (toPeriod && !isValidPeriod(toPeriod)) throw new Error(`Invalid period "${toPeriod}" (expected YYYY-MM)`)

  let begin = start.period
  let acc
  if (basis === 'theoretical') {
    acc = asset.opening?.isExisting ? round2(num(asset.opening.accumulatedDepreciation)) : 0
  } else {
    acc = effectiveAccumulated(asset)
    const last = asset.depreciation?.lastPostedPeriod
    if (isValidPeriod(last)) {
      const next = shiftPeriod(last, 1)
      if (comparePeriods(next, begin) > 0) begin = next
    }
  }
  if (toPeriod && comparePeriods(begin, toPeriod) > 0) return []

  const cost = num(asset.cost)
  const residual = residualValueOf(asset)
  const rows = []
  let p = begin
  for (let i = 0; i < MAX_MONTHS; i++) {
    if (toPeriod && comparePeriods(p, toPeriod) > 0) break
    const res = depreciationForPeriod(asset, p, { convention, accumulated: acc, endDate })
    if (STOP_REASONS.has(res.reason) || res.reason === 'DISPOSED' || res.reason === 'FULLY_DEPRECIATED') break
    acc = round2(acc + res.amount)
    if (!fromPeriod || comparePeriods(p, fromPeriod) >= 0) {
      rows.push({ period: p, amount: res.amount, accumulated: acc, bookValue: round2(cost - acc) })
    }
    if (round2(cost - residual - acc) <= 0.005) break
    p = shiftPeriod(p, 1)
  }
  return rows
}

/**
 * Unposted book depreciation from the month after depreciation.lastPostedPeriod
 * (or the start month) up to and including `date` — the disposal-date catch-up
 * used when an asset is sold, scrapped or written off. The month of `date` is
 * prorated to that day. Months already posted are never charged again.
 *
 * @returns {{ amount, months, fromPeriod, toPeriod, accumulatedBefore, accumulatedAfter,
 *             bookValueAfter, lines: Array<{ period, amount }>, alreadyPostedThrough }}
 */
export function depreciationToDate(asset, date, { convention = 'PRORATA_DAYS' } = {}) {
  const end = toDateValue(date)
  if (!end) throw new Error('Invalid date')
  const toPeriod = periodOfDate(end)
  const accBefore = effectiveAccumulated(asset)
  const last = isValidPeriod(asset?.depreciation?.lastPostedPeriod) ? asset.depreciation.lastPostedPeriod : null
  const out = {
    amount: 0, months: 0, fromPeriod: null, toPeriod,
    accumulatedBefore: accBefore, accumulatedAfter: accBefore,
    bookValueAfter: round2(num(asset?.cost) - accBefore), lines: [], alreadyPostedThrough: last,
  }
  const start = depreciationStart(asset, { convention })
  if (!start) return out
  let from = last ? shiftPeriod(last, 1) : start.period
  if (comparePeriods(from, start.period) < 0) from = start.period
  if (comparePeriods(from, toPeriod) > 0) return out
  out.fromPeriod = from

  let acc = accBefore
  let total = 0
  let p = from
  for (let i = 0; i < MAX_MONTHS && comparePeriods(p, toPeriod) <= 0; i++) {
    const amt = monthlyDepreciationFor(asset, p, { convention, accumulated: acc, endDate: end })
    if (amt > 0) {
      acc = round2(acc + amt)
      total = round2(total + amt)
      out.months += 1
      out.lines.push({ period: p, amount: amt })
    }
    p = shiftPeriod(p, 1)
  }
  out.amount = total
  out.accumulatedAfter = acc
  out.bookValueAfter = round2(num(asset?.cost) - acc)
  return out
}

/**
 * Depreciation already posted (by monthly runs) for the disposal month and
 * later months beyond what a disposal on `date` allows — to be written back
 * when the asset is disposed of in (or before) a month that is already posted.
 *
 * Uses the theoretical schedule for the months from the disposal month to
 * depreciation.lastPostedPeriod (impairments already folded into accumulated
 * stay in place); the disposal month keeps its charge up to and including
 * the disposal day. Capped at the accumulated depreciation on the asset.
 *
 * @returns {{ amount: number, lines: Array<{ period, amount }> }}  one line per over-posted month
 */
export function overPostedDepreciation(asset, date, { convention = 'PRORATA_DAYS' } = {}) {
  const none = { amount: 0, lines: [] }
  const end = toDateValue(date)
  const last = asset?.depreciation?.lastPostedPeriod
  if (!asset || !end || !isValidPeriod(last)) return none
  const dp = periodOfDate(end)
  if (!dp || comparePeriods(last, dp) < 0) return none
  const rows = bookSchedule(asset, { convention, basis: 'theoretical', toPeriod: last, endDate: null })
  const before = rows.filter(r => comparePeriods(r.period, dp) < 0)
  const prev = before.length ? before[before.length - 1] : null
  const accStart = prev ? prev.accumulated : (asset.opening?.isExisting ? round2(num(asset.opening.accumulatedDepreciation)) : 0)
  const lines = []
  for (const r of rows) {
    if (comparePeriods(r.period, dp) < 0) continue
    const keep = r.period === dp
      ? depreciationForPeriod(asset, dp, { convention, accumulated: accStart, endDate: end }).amount
      : 0
    const x = round2(r.amount - keep)
    if (x > 0.005) lines.push({ period: r.period, amount: x })
  }
  const total = round2(lines.reduce((s, l) => s + l.amount, 0))
  const cap = effectiveAccumulated(asset)
  if (total > cap) {
    // Never write back more than is on the asset: trim from the latest month.
    let excess = round2(total - cap)
    for (let i = lines.length - 1; i >= 0 && excess > 0.005; i--) {
      const cut = Math.min(lines[i].amount, excess)
      lines[i].amount = round2(lines[i].amount - cut)
      excess = round2(excess - cut)
    }
    const kept = lines.filter(l => l.amount > 0.005)
    return { amount: round2(kept.reduce((s, l) => s + l.amount, 0)), lines: kept }
  }
  return { amount: total, lines }
}

// ─── Tax depreciation (Third Schedule) ──────────────────────────────────────

const fmtTk = (n) => `Tk ${Math.round(num(n)).toLocaleString('en-IN')}`

/** First finite number among candidate values (null when none). */
function firstNumber(...vals) {
  for (const v of vals) {
    if (v === null || v === undefined || v === '') continue
    const n = Number(v)
    if (Number.isFinite(n)) return n
  }
  return null
}

/** Dhaka calendar day of a Date as 'YYYY-MM-DD'. */
const dayKeyOfDate = (d) => {
  const { year, month, day } = dhakaParts(d)
  return `${year}-${pad2(month + 1)}-${pad2(day)}`
}

/**
 * Acquisition date for tax depreciation: purchase.date ⇒ availableForUseDate ⇒
 * opening.asOfDate for an opening-register asset (it was held on that day, so
 * it is never a later addition) ⇒ createdAt. null when none is valid.
 */
export function taxAcquisitionDate(asset) {
  if (!asset) return null
  return toDateValue(asset.purchase?.date) || toDateValue(asset.availableForUseDate)
    || (asset.opening?.isExisting ? toDateValue(asset.opening.asOfDate) : null)
    || toDateValue(asset.createdAt)
}

/** AssetEvent types that can change an asset's cost after it was acquired. */
export const TAX_COST_EVENT_TYPES = ['VALUE_ADJUSTED', 'REPAIR_COMPLETED']

/**
 * Cost changes after acquisition, as taxDepreciationSchedule's `costAdditions`,
 * from one asset's events:
 *  - VALUE_ADJUSTED that changed the cost: details.costAfter − details.costBefore
 *    (fromCost / toCost), or a capitalised repair's details.amount when neither
 *    is recorded. Impairments (cost unchanged) are ignored;
 *  - REPAIR_COMPLETED with details.capitalize whose VALUE_ADJUSTED companion is
 *    missing (linked by details.repairEventId, else the same day and amount), so
 *    each capitalised repair counts once.
 * @param {Array<{ _id, type, date, amount, details }>} events
 * @returns {Array<{ date: Date, amount: number }>} sorted by date; negative = cost reduced
 */
export function taxCostAdditionsFromEvents(events) {
  const list = Array.isArray(events) ? events : []
  const out = []
  const linkedRepairs = new Set()
  const unlinked = [] // capitalised-repair adjustments without repairEventId
  for (const e of list) {
    if (e?.type !== 'VALUE_ADJUSTED') continue
    const date = toDateValue(e.date)
    if (!date) continue
    const d = e.details || {}
    const before = firstNumber(d.costBefore, d.fromCost)
    const after = firstNumber(d.costAfter, d.toCost)
    const isRepair = d.kind === 'CAPITALIZED_REPAIR'
    let amount = before !== null && after !== null ? after - before : null
    if (amount === null && isRepair) amount = firstNumber(d.amount, e.amount)
    amount = round2(num(amount))
    if (isRepair) {
      if (d.repairEventId) linkedRepairs.add(String(d.repairEventId))
      else unlinked.push({ day: dayKeyOfDate(date), amount })
    }
    if (Math.abs(amount) >= 0.005) out.push({ date, amount })
  }
  for (const e of list) {
    if (e?.type !== 'REPAIR_COMPLETED' || e.details?.capitalize !== true) continue
    const id = e._id ?? e.id
    if (id && linkedRepairs.has(String(id))) continue
    const date = toDateValue(e.date)
    const amount = round2(num(firstNumber(e.details?.cost, e.amount)))
    if (!date || !(amount > 0)) continue
    const day = dayKeyOfDate(date)
    const i = unlinked.findIndex(u => u.day === day && Math.abs(u.amount - amount) < 0.005)
    if (i >= 0) {
      unlinked.splice(i, 1)
      continue
    }
    out.push({ date, amount })
  }
  return out.sort((a, b) => a.date - b.date)
}

/**
 * Tax depreciation allowance per income year (Income Tax Act 2023, Third Schedule).
 *
 *  - Rate: asset.taxRatePct, else the class rate (TAX_DEPRECIATION_CLASSES[asset.taxClass]).
 *  - WDV classes: allowance = (opening WDV + additions) × rate. Straight-line classes
 *    (method 'SL', software): allowance = cost × rate, until fully written off.
 *  - Full year's allowance in the income year of acquisition (taxAcquisitionDate:
 *    purchase.date ⇒ availableForUseDate ⇒ opening.asOfDate for an opening asset ⇒
 *    createdAt); no allowance in the year of disposal (para 7), after which the
 *    schedule ends.
 *  - Later cost changes (opts.costAdditions — capitalised repairs, cost corrections;
 *    negative = reduction) never rewrite earlier years: the acquisition year starts
 *    from the original cost (asset.cost − all additions) and each addition joins the
 *    WDV of the income year it is dated in, with a full year's allowance on it that
 *    year (none in the year of disposal). Additions after the last year shown are
 *    left out.
 *  - Cost for tax capped at the class costCap (motor vehicle Tk 30 lakh) on the
 *    cumulative cost; total allowances never exceed that cost.
 *  - opening.taxWdv (with opening.taxWdvFiscalYear, else the income year after
 *    opening.asOfDate) replaces the computed history: it is the WDV brought
 *    forward at the start of that income year (additions dated before that year
 *    are taken to be in it).
 *  - Non-capitalized assets have no schedule.
 *
 * @param {object} asset
 * @param {object} [opts]
 * @param {number} [opts.startMonth=7]  income-year start month
 * @param {string} [opts.toFiscalYear]  last income year to include ('2026-27'); default
 *                                      the income year containing opts.asOf (today)
 * @param {Date}   [opts.asOf=new Date()]
 * @param {Array<{ date, amount }>} [opts.costAdditions]  see taxCostAdditionsFromEvents
 * @returns {Array<{ fy, openingWdv, additions, rate, allowance, closingWdv, taxCost, note }>}
 *   closingWdv = openingWdv + additions − allowance; additions are after the cost
 *   cap; taxCost is the (capped) cost for tax at the end of the year.
 */
export function taxDepreciationSchedule(asset, { startMonth = 7, toFiscalYear, asOf = new Date(), costAdditions = [] } = {}) {
  if (!asset || asset.isCapitalized === false) return []
  const cls = taxClassOf(asset.taxClass)
  const rate = Number(asset.taxRatePct) > 0 ? Number(asset.taxRatePct) : num(cls.rate)
  if (!(rate > 0)) return []
  const straightLine = cls.method === 'SL'

  const cost = num(asset.cost)
  const cap = Number(cls.costCap) > 0 ? Number(cls.costCap) : null
  const capCost = (c) => round2(Math.max(0, cap !== null ? Math.min(c, cap) : c))
  if (!(capCost(cost) > 0)) return []

  const acquired = taxAcquisitionDate(asset)
  if (!acquired) return []
  const acqYear = fiscalYearStartYear(acquired, startMonth)

  const disposedOn = toDateValue(asset.disposal?.date)
  const dispYear = disposedOn ? fiscalYearStartYear(disposedOn, startMonth) : null

  let endYear = toFiscalYear ? parseFiscalYear(toFiscalYear) : fiscalYearStartYear(asOf || new Date(), startMonth)
  if (endYear === null) return []
  if (dispYear !== null && dispYear < endYear) endYear = dispYear

  // Cost changes after acquisition, by income year; the original cost excludes all of them.
  const adds = []
  for (const x of Array.isArray(costAdditions) ? costAdditions : []) {
    const d = toDateValue(x?.date)
    const amount = round2(num(x?.amount))
    if (d && Math.abs(amount) >= 0.005) adds.push({ year: fiscalYearStartYear(d, startMonth), amount })
  }
  const sumAdds = (pred) => round2(adds.reduce((s, a) => (pred(a) ? s + a.amount : s), 0))
  const originalCost = round2(cost - sumAdds(() => true))

  // Starting point: acquisition at cost, or an opening tax WDV brought forward.
  let year = acqYear
  let openingYear = null
  let opWdvStart = null
  const op = asset.opening || {}
  const opWdv = op.taxWdv === null || op.taxWdv === undefined || op.taxWdv === '' ? null : Number(op.taxWdv)
  if (opWdv !== null && Number.isFinite(opWdv) && opWdv >= 0) {
    let y = parseFiscalYear(op.taxWdvFiscalYear)
    if (y === null) {
      const asOfDate = toDateValue(op.asOfDate)
      y = asOfDate ? fiscalYearStartYear(new Date(asOfDate.getTime() + DAY_MS), startMonth) : acqYear
    }
    year = y
    openingYear = y
    opWdvStart = opWdv
  }
  // Additions dated before the first year shown are part of its starting cost
  // (or of the opening tax WDV brought forward).
  const startYear = year
  let cumCost = round2(originalCost + sumAdds(a => a.year < startYear))
  let wdv = opWdvStart !== null ? round2(Math.min(opWdvStart, capCost(cumCost))) : capCost(cumCost)
  const hasAdditionsAfter = (y) => adds.some(a => a.year > y && a.year <= endYear)

  const rows = []
  for (let i = 0; i < MAX_YEARS && year <= endYear; i++, year++) {
    const fy = fiscalYearLabel(year, startMonth)
    const notes = []
    if (year === openingYear) notes.push('Opening tax WDV brought forward')
    else if (year === acqYear && openingYear === null) notes.push('Year of acquisition — full year allowance')

    // Cost added (or taken off) during the year joins this year's WDV.
    const isDisposalYear = dispYear !== null && year === dispYear
    const added = sumAdds(a => a.year === year)
    let addition = 0
    if (Math.abs(added) >= 0.005) {
      const capBefore = capCost(cumCost)
      cumCost = round2(cumCost + added)
      addition = round2(capCost(cumCost) - capBefore)
      if (addition < -wdv) addition = round2(-wdv) // a reduction cannot take the WDV below nil
      notes.push(`Cost ${added > 0 ? 'added' : 'reduced'} ${fmtTk(Math.abs(added))}${added > 0 && !isDisposalYear ? ' — full year allowance' : ''}`)
    }
    if (cap !== null && cumCost > cap && (rows.length === 0 || Math.abs(added) >= 0.005)) {
      notes.push(`Cost for tax capped at ${fmtTk(cap)} (cost ${fmtTk(cumCost)})`)
    }
    const taxCost = capCost(cumCost)
    const pool = round2(wdv + addition)

    if (isDisposalYear) {
      notes.push('Year of disposal — no allowance (Third Schedule para 7)')
      rows.push({ fy, openingWdv: wdv, additions: addition, rate, allowance: 0, closingWdv: pool, taxCost, note: notes.join('; ') })
      break
    }
    if (pool <= 0.005 && Math.abs(addition) < 0.005) {
      wdv = pool
      if (hasAdditionsAfter(year)) continue
      break
    }

    let allowance = straightLine ? round2(taxCost * rate / 100) : round2(pool * rate / 100)
    if (allowance > pool) allowance = pool
    if (allowance < 0) allowance = 0
    if (straightLine) notes.push('Straight-line amortisation on cost')
    const closing = round2(pool - allowance)
    if (closing <= 0.005) notes.push('Fully written off')
    rows.push({ fy, openingWdv: wdv, additions: addition, rate, allowance, closingWdv: closing, taxCost, note: notes.length ? notes.join('; ') : null })
    wdv = closing
  }
  return rows
}
