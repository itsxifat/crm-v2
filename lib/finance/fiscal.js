/**
 * lib/finance/fiscal.js — PURE fiscal-calendar helpers (Asia/Dhaka, UTC+6).
 *
 * Safe for 'use client' components. All boundaries are Dhaka midnights
 * returned as real Date instants (see lib/dhakaTime.js). Periods are
 * 'YYYY-MM' strings, days are 'YYYY-MM-DD' strings, fiscal years are labelled
 * '2026-27' (or 'YYYY' when the fiscal year starts in January).
 */

import { dhakaParts, dhakaDate, dhakaDayKey, parseDhakaDay } from '../dhakaTime'

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const PERIOD_RE = /^(\d{4})-(\d{2})$/
const DAY_RE    = /^(\d{4})-(\d{2})-(\d{2})$/
const FY_RE     = /^(\d{4})(?:-(\d{2}|\d{4}))?$/

const pad = (n) => String(n).padStart(2, '0')

function normMonth(startMonth) {
  const m = Math.trunc(Number(startMonth))
  return m >= 1 && m <= 12 ? m : 7
}

/**
 * Coerce a Date | 'YYYY-MM-DD' (Dhaka day) | 'YYYY-MM' (Dhaka month start) |
 * ISO string | epoch ms into a Date. Returns null when invalid.
 */
export function toInstant(value) {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'string') {
    const s = value.trim()
    if (DAY_RE.test(s)) return parseDhakaDay(s)?.start ?? null
    const pm = PERIOD_RE.exec(s)
    if (pm) {
      const mo = Number(pm[2])
      return mo >= 1 && mo <= 12 ? dhakaDate(Number(pm[1]), mo - 1, 1) : null
    }
  }
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** True for a well-formed 'YYYY-MM' period. */
export function isPeriod(period) {
  const m = PERIOD_RE.exec(String(period ?? ''))
  return !!m && Number(m[2]) >= 1 && Number(m[2]) <= 12
}

/** True for a valid 'YYYY-MM-DD' day key. */
export function isDayKey(value) {
  const s = String(value ?? '')
  if (!DAY_RE.test(s)) return false
  const parsed = parseDhakaDay(s)
  return !!parsed && dhakaDayKey(parsed.start) === s // rejects overflow like 2026-02-31
}

function parsePeriod(period) {
  const m = PERIOD_RE.exec(String(period ?? '').trim())
  if (!m) return null
  const year = Number(m[1]); const month = Number(m[2])
  if (month < 1 || month > 12) return null
  return { year, month } // month 1-12
}

function periodOf(year, month1) {
  // month1 may overflow (e.g. 13 → Jan next year)
  const idx = year * 12 + (month1 - 1)
  return `${Math.floor(idx / 12)}-${pad((idx % 12 + 12) % 12 + 1)}`
}

function dayKeyOf(year, monthIndex0, day) {
  return dhakaDayKey(dhakaDate(year, monthIndex0, day))
}

/** '30 Sep 2026' for a 'YYYY-MM-DD' key or any date-ish value ('' when invalid). */
export function dayKeyLabel(value) {
  let key = typeof value === 'string' && DAY_RE.test(value.trim()) ? value.trim() : null
  if (!key) {
    const d = toInstant(value)
    if (!d) return ''
    key = dhakaDayKey(d)
  }
  const [y, m, d] = key.split('-').map(Number)
  return `${pad(d)} ${MONTHS[m - 1]} ${y}`
}

/** Add `n` days to a 'YYYY-MM-DD' key. */
export function addDays(dayKey, n) {
  const m = DAY_RE.exec(String(dayKey ?? ''))
  if (!m) return null
  return dayKeyOf(Number(m[1]), Number(m[2]) - 1, Number(m[3]) + Math.trunc(Number(n) || 0))
}

// ── Fiscal years ──────────────────────────────────────────────────────────────

function fyLabel(startYear, startMonth) {
  return startMonth === 1 ? String(startYear) : `${startYear}-${pad((startYear + 1) % 100)}`
}

function fyStartYear(fy) {
  if (typeof fy === 'number' && Number.isInteger(fy)) return fy
  const m = FY_RE.exec(String(fy ?? '').trim())
  return m ? Number(m[1]) : null
}

/** Fiscal year label ('2026-27') of the Dhaka calendar date. */
export function fiscalYearOf(date = new Date(), startMonth = 7) {
  const d = toInstant(date)
  if (!d) return null
  const sm = normMonth(startMonth)
  const { year, month } = dhakaParts(d)
  const startYear = month + 1 >= sm ? year : year - 1
  return fyLabel(startYear, sm)
}

/**
 * Boundaries of a fiscal year: { start, next } (Dhaka midnights; filter with
 * $gte start / $lt next) plus startDay/endDay ('YYYY-MM-DD') and
 * startPeriod/endPeriod ('YYYY-MM'). Null for an unparseable label.
 */
export function fiscalYearRange(fy, startMonth = 7) {
  const startYear = fyStartYear(fy)
  if (startYear === null) return null
  const sm = normMonth(startMonth)
  const start = dhakaDate(startYear, sm - 1, 1)
  const next  = dhakaDate(startYear + 1, sm - 1, 1)
  return {
    fy:          fyLabel(startYear, sm),
    start,
    next,
    startDay:    dhakaDayKey(start),
    endDay:      dayKeyOf(startYear + 1, sm - 1, 0),
    startPeriod: periodOf(startYear, sm),
    endPeriod:   periodOf(startYear, sm + 11),
  }
}

/** Shift a fiscal-year label by n years ('2026-27', -1 → '2025-26'). */
export function addFiscalYears(fy, n, startMonth = 7) {
  const startYear = fyStartYear(fy)
  if (startYear === null) return null
  return fyLabel(startYear + Math.trunc(Number(n) || 0), normMonth(startMonth))
}

// ── Tax periods ('YYYY-MM') ───────────────────────────────────────────────────

/** 'YYYY-MM' of the Dhaka calendar month containing `date`. */
export function taxPeriodOf(date = new Date()) {
  const d = toInstant(date)
  if (!d) return null
  const { year, month } = dhakaParts(d)
  return `${year}-${pad(month + 1)}`
}

/** { start, next } Dhaka-midnight boundaries of a 'YYYY-MM' period (null if invalid). */
export function periodRange(period) {
  const p = parsePeriod(period)
  if (!p) return null
  return { start: dhakaDate(p.year, p.month - 1, 1), next: dhakaDate(p.year, p.month, 1) }
}

/** Last calendar day of a period as 'YYYY-MM-DD'. */
export function periodLastDay(period) {
  const p = parsePeriod(period)
  if (!p) return null
  return dayKeyOf(p.year, p.month, 0)
}

/** First calendar day of a period as 'YYYY-MM-DD'. */
export function periodFirstDay(period) {
  const p = parsePeriod(period)
  if (!p) return null
  return `${p.year}-${pad(p.month)}-01`
}

/** '2026-10' + 6 ⇒ '2027-04' (n may be negative). */
export function addPeriods(period, n) {
  const p = parsePeriod(period)
  if (!p) return null
  return periodOf(p.year, p.month + Math.trunc(Number(n) || 0))
}

/** Inclusive list of periods from a to b (empty when a > b; capped at 1200). */
export function periodsBetween(a, b) {
  const pa = parsePeriod(a); const pb = parsePeriod(b)
  if (!pa || !pb) return []
  const from = pa.year * 12 + pa.month - 1
  const to   = pb.year * 12 + pb.month - 1
  const out = []
  for (let i = from; i <= to && out.length < 1200; i++) out.push(`${Math.floor(i / 12)}-${pad(i % 12 + 1)}`)
  return out
}

/** 'Oct 2026' for '2026-10'. */
export function periodLabel(period) {
  const p = parsePeriod(period)
  if (!p) return period == null ? '' : String(period)
  return `${MONTHS[p.month - 1]} ${p.year}`
}

function rangeLabel(startPeriod, endPeriod) {
  const a = parsePeriod(startPeriod); const b = parsePeriod(endPeriod)
  if (!a || !b) return ''
  if (a.year === b.year && a.month === b.month) return periodLabel(startPeriod)
  if (a.year === b.year) return `${MONTHS[a.month - 1]}–${MONTHS[b.month - 1]} ${b.year}`
  return `${MONTHS[a.month - 1]} ${a.year}–${MONTHS[b.month - 1]} ${b.year}`
}

/**
 * VAT return period containing `period` ('YYYY-MM' or a date).
 * MONTHLY ⇒ { key:'2026-10', start, end, label:'Oct 2026', dueDate:'2026-11-15' }.
 * QUARTERLY (calendar quarters Jul–Sep / Oct–Dec / Jan–Mar / Apr–Jun) ⇒
 * { key:'2026-07..2026-09', start:'2026-07', end:'2026-09', label:'Jul–Sep 2026', dueDate:'2026-10-15' }.
 */
export function vatReturnPeriodFor(period, frequency = 'MONTHLY') {
  const pStr = isPeriod(period) ? period : taxPeriodOf(period)
  const p = parsePeriod(pStr)
  if (!p) return null
  if (String(frequency).toUpperCase() === 'QUARTERLY') {
    const qStartMonth = Math.floor((p.month - 1) / 3) * 3 + 1
    const start = periodOf(p.year, qStartMonth)
    const end   = periodOf(p.year, qStartMonth + 2)
    const after = parsePeriod(addPeriods(end, 1))
    return {
      key:       `${start}..${end}`,
      start,
      end,
      label:     rangeLabel(start, end),
      dueDate:   `${after.year}-${pad(after.month)}-15`,
      frequency: 'QUARTERLY',
    }
  }
  const after = parsePeriod(addPeriods(pStr, 1))
  return {
    key:       pStr,
    start:     pStr,
    end:       pStr,
    label:     periodLabel(pStr),
    dueDate:   `${after.year}-${pad(after.month)}-15`,
    frequency: 'MONTHLY',
  }
}

// ── Withholding (income tax) ──────────────────────────────────────────────────

function buildWhtQuarter(startYear, q, sm) {
  const qStartMonth = sm + (q - 1) * 3
  const start = periodOf(startYear, qStartMonth)
  const end   = periodOf(startYear, qStartMonth + 2)
  const after = parsePeriod(addPeriods(end, 1))
  const fy    = fyLabel(startYear, sm)
  return {
    fy,
    q,
    key:     `${fy}-Q${q}`,
    label:   rangeLabel(start, end),
    start,
    end,
    dueDate: `${after.year}-${pad(after.month)}-25`,
  }
}

/**
 * Withholding-tax return quarter (s.177) containing `date`:
 * { fy:'2026-27', q:1, key:'2026-27-Q1', label:'Jul–Sep 2026', start:'2026-07', end:'2026-09', dueDate:'2026-10-25' }.
 */
export function whtQuarterOf(date = new Date(), startMonth = 7) {
  const d = toInstant(date)
  if (!d) return null
  const sm = normMonth(startMonth)
  const { year, month } = dhakaParts(d)
  const m1 = month + 1
  const startYear = m1 >= sm ? year : year - 1
  const idx = (m1 - sm + 12) % 12
  return buildWhtQuarter(startYear, Math.floor(idx / 3) + 1, sm)
}

/** Inverse of whtQuarterOf(...).key: '2026-27-Q1' ⇒ the same object (null if invalid). */
export function whtQuarterByKey(key, startMonth = 7) {
  const m = /^(\d{4})(?:-(\d{2}|\d{4}))?-Q([1-4])$/i.exec(String(key ?? '').trim())
  if (!m) return null
  return buildWhtQuarter(Number(m[1]), Number(m[3]), normMonth(startMonth))
}

/**
 * TDS deposit deadline (Withholding Tax Rules, rule 9) for a deduction date:
 * July–May ⇒ 14 days after the end of the month of deduction;
 * 1–20 June ⇒ 7 days after deduction; 21–29 June ⇒ next day; 30 June ⇒ same day.
 */
export function tdsDepositDueDate(deductionDate) {
  const d = toInstant(deductionDate)
  if (!d) return null
  const { year, month, day } = dhakaParts(d)
  if (month === 5) { // June
    if (day <= 20) return dayKeyOf(year, month, day + 7)
    if (day <= 29) return dayKeyOf(year, month, day + 1)
    return dayKeyOf(year, month, day)
  }
  // last day of the month + 14 days = 14th of the following month
  return dayKeyOf(year, month + 1, 14)
}

/** Advance income tax instalment dates for a fiscal year: 15 Sep, 15 Dec, 15 Mar, 15 Jun. */
export function advanceTaxDueDates(fy) {
  const y = fyStartYear(fy)
  if (y === null) return []
  return [`${y}-09-15`, `${y}-12-15`, `${y + 1}-03-15`, `${y + 1}-06-15`]
}
