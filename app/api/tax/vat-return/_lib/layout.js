/**
 * Mushak-9.1 layout — PURE (safe for 'use client' pages and server prints).
 *
 * Every note of the eVAT return (1–68 plus 18a, SRO 271/2025) with its
 * official number, a short English label and, for totals, the formula the
 * engine (lib/tax/vatReturn.js) uses. Labels the tax catalog already defines
 * (VAT_RETURN_NOTES) take precedence so wording stays identical across the app.
 *
 * Also: return-period helpers that honour the statutory overrides
 * (e.g. the single Jul–Sep 2026 quarterly return).
 */

import { VAT_RETURN_NOTES, vatReturnOverrideFor } from '@/lib/tax/catalog'
import { vatReturnPeriodFor, isPeriod, addPeriods, periodLabel, taxPeriodOf } from '@/lib/finance/fiscal'

// ── Note labels (fallbacks for notes the catalog does not describe) ─────────

const EXTRA_LABELS = {
  '18a': 'Goods/services based on specific VAT — import',
  36: 'Net payable SD before adjusting the closing balance',
  37: 'Net payable SD after adjusting the closing balance',
  38: 'SD against debit notes',
  39: 'SD against credit notes',
  40: 'SD paid on inputs of exported goods',
  42: 'Interest on overdue SD',
  45: 'Excise duty',
  46: 'Development surcharge',
  47: 'ICT development surcharge',
  48: 'Health care surcharge',
  49: 'Environmental protection surcharge',
  51: 'Net payable SD for treasury deposit',
  53: 'Closing balance of last tax period (SD)',
  54: 'Remaining balance (VAT) from Mushak-18.6 (old law)',
  55: 'Remaining balance (SD) from Mushak-18.6 (old law)',
  56: 'Decreasing adjustment of note 54 (up to 30% of note 34)',
  57: 'Decreasing adjustment of note 55 (up to 30% of note 36)',
  59: 'Treasury deposit — SD',
  60: 'Treasury deposit — excise duty',
  61: 'Treasury deposit — development surcharge',
  62: 'Treasury deposit — ICT development surcharge',
  63: 'Treasury deposit — health care surcharge',
  64: 'Treasury deposit — environmental protection surcharge',
  66: 'Closing balance — SD (carried forward)',
  67: 'Refund requested — VAT',
  68: 'Refund requested — SD',
}

/** Formulas as computed by lib/tax/vatReturn.js (shown next to totals). */
const FORMULAS = {
  9:  'Σ 1–8',
  23: 'a: Σ 10–18a · b: 14b + 15b + 16b + 17b + 18b + 18a(b)',
  28: '24 + 25 + 26 + 27',
  33: '29 + 30 + 31 + 32',
  34: '9c − 23b + 28 − 33',
  35: '34 − (52 + 56)',
  36: '9b + 38 − (39 + 40)',
  37: '36 − (53 + 57)',
  50: '35 + 41 + 43 + 44 (0 when negative)',
  51: '37 + 42 (0 when negative)',
  65: '58 − (35 + 41 + 43 + 44) − 67, not below 0',
  66: '59 − (37 + 42) − 68, not below 0',
}

const TOTAL_NOTES = new Set([9, 23, 28, 33, 34, 35, 36, 37, 50, 51, 65, 66])

/**
 * Notes a service business normally uses. Others are hidden on screen unless
 * they carry an amount (they always print on the working paper).
 */
export const SERVICE_NOTES = new Set([
  1, 2, 3, 4, 7, 9,
  10, 12, 14, 16, 19, 20, 21, 23,
  24, 25, 26, 27, 28,
  29, 31, 32, 33,
  34, 35, 41, 43, 44, 50, 52,
  58, 65, 67,
])

export function noteLabel(n) {
  const key = String(n)
  return VAT_RETURN_NOTES[key]?.label ?? EXTRA_LABELS[key] ?? `Note ${key}`
}

export function noteFormula(n) {
  const key = String(n)
  return FORMULAS[key] ?? VAT_RETURN_NOTES[key]?.formula ?? null
}

export function isTotalNote(n) {
  return TOTAL_NOTES.has(Number(n))
}

const range = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => a + i)

/**
 * Parts of the return in official order. `columns` lists the amount columns
 * ('a','b','c' for Part 3; 'a','b' for Part 4; a single 'v' otherwise).
 */
export const VAT_RETURN_LAYOUT = [
  {
    part: 3, title: 'Part 3 — Supply (output tax)',
    columns: [{ key: 'a', label: 'Value (a)' }, { key: 'b', label: 'SD (b)' }, { key: 'c', label: 'VAT (c)' }],
    notes: range(1, 9),
  },
  {
    part: 4, title: 'Part 4 — Purchase (input tax)',
    columns: [{ key: 'a', label: 'Value (a)' }, { key: 'b', label: 'VAT (b)' }],
    notes: [10, 11, 12, 13, 14, 15, 16, 17, 18, '18a', 19, 20, 21, 22, 23],
  },
  { part: 5,  title: 'Part 5 — Increasing adjustments (VAT)', columns: [{ key: 'v', label: 'VAT' }], notes: range(24, 28) },
  { part: 6,  title: 'Part 6 — Decreasing adjustments (VAT)', columns: [{ key: 'v', label: 'VAT' }], notes: range(29, 33) },
  { part: 7,  title: 'Part 7 — Net tax calculation',          columns: [{ key: 'v', label: 'Amount' }], notes: range(34, 53) },
  { part: 8,  title: 'Part 8 — Adjustment of old account balance (Mushak-18.6)', columns: [{ key: 'v', label: 'Amount' }], notes: range(54, 57) },
  { part: 9,  title: 'Part 9 — Accounts code-wise treasury deposit', columns: [{ key: 'v', label: 'Amount' }], notes: range(58, 64) },
  { part: 10, title: 'Part 10 — Closing balance',              columns: [{ key: 'v', label: 'Amount' }], notes: [65, 66] },
  { part: 11, title: 'Part 11 — Refund',                       columns: [{ key: 'v', label: 'Amount' }], notes: [67, 68] },
]

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Values of one note for the given part columns: { a, b, c } / { a, b } / { v }. */
export function noteValues(notes, n, columns) {
  const raw = notes?.[String(n)]
  if (raw && typeof raw === 'object') {
    const out = {}
    for (const c of columns) out[c.key] = round2(num(raw[c.key]))
    return out
  }
  return { [columns[0].key]: round2(num(raw)) }
}

/** True when every value of the note is (practically) zero. */
export function noteIsZero(notes, n) {
  const raw = notes?.[String(n)]
  if (raw && typeof raw === 'object') return Object.values(raw).every(v => Math.abs(num(v)) < 0.005)
  return Math.abs(num(raw)) < 0.005
}

// ── Return periods ───────────────────────────────────────────────────────────

/**
 * The VAT return period containing `period` ('YYYY-MM' or a date): a
 * statutory override (single Jul–Sep 2026 return) wins over the configured
 * frequency. → { key, start, end, label, dueDate, frequency }
 */
export function returnPeriodFor(period, frequency = 'MONTHLY') {
  const p = isPeriod(period) ? period : taxPeriodOf(period)
  if (!p) return null
  const o = vatReturnOverrideFor(p)
  if (o) {
    return { key: o.key ?? `${o.start}..${o.end}`, start: o.start, end: o.end, label: o.label, dueDate: o.dueDate, frequency: 'OVERRIDE' }
  }
  return vatReturnPeriodFor(p, frequency)
}

/** Period object for an explicit start..end range (override and due date aware). */
export function returnPeriodForRange(start, end, frequency = 'MONTHLY') {
  const own = returnPeriodFor(start, frequency)
  if (own && own.start === start && own.end === end) return own
  const after = addPeriods(end, 1)
  return {
    key:       start === end ? start : `${start}..${end}`,
    start,
    end,
    label:     start === end ? periodLabel(start) : `${periodLabel(start)} – ${periodLabel(end)}`,
    dueDate:   `${after}-15`,
    frequency: 'CUSTOM',
  }
}

/**
 * The last `count` return periods ending with the one containing `fromPeriod`,
 * newest first, without duplicates.
 */
export function recentReturnPeriods(fromPeriod, frequency = 'MONTHLY', count = 15) {
  const out = []
  const seen = new Set()
  let p = fromPeriod
  for (let guard = 0; guard < count * 4 && out.length < count && p; guard++) {
    const rp = returnPeriodFor(p, frequency)
    if (!rp) break
    if (!seen.has(rp.key)) {
      seen.add(rp.key)
      out.push(rp)
    }
    p = addPeriods(rp.start, -1)
  }
  return out
}
