/**
 * lib/organizer/dates.js — date-only helpers for the organizer.
 *
 * Date-only values (to-do due dates, all-day event days, repeatUntil) are stored
 * as UTC midnight of their 'YYYY-MM-DD' day and read back with toYMD(). "Today"
 * and the due presets follow Asia/Dhaka calendar days.
 */
import { dhakaDayKey } from '../dhakaTime.js'

export const DAY_MS = 86_400_000

// 'YYYY-MM-DD', optionally followed by a UTC-midnight time (what the API returns
// for all-day dates, so a value read from the API can be sent straight back).
const YMD_RE = /^(\d{4})-(\d{2})-(\d{2})(?:T00:00(?::00(?:\.0{1,3})?)?Z)?$/

/** UTC-midnight Date for 'YYYY-MM-DD' (impossible dates → null). */
export function parseYMD(value) {
  const m = YMD_RE.exec(String(value ?? '').trim())
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])]
  const dt = new Date(0)
  dt.setUTCFullYear(y, mo, d)
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== mo || dt.getUTCDate() !== d) return null
  return dt
}

/** True for a valid 'YYYY-MM-DD' (see parseYMD). */
export function isYMD(value) {
  return parseYMD(value) !== null
}

/** 'YYYY-MM-DD' of a date-only value (its UTC day), or null. */
export function toYMD(date) {
  if (!date) return null
  const d = date instanceof Date ? date : new Date(date)
  if (Number.isNaN(d.getTime())) return null
  return d.toISOString().slice(0, 10)
}

/** `date` + n whole days. */
export function addDays(date, n) {
  return new Date(new Date(date).getTime() + n * DAY_MS)
}

/** UTC midnight of the Asia/Dhaka calendar day containing `instant`. */
export function dhakaDayOf(instant = new Date()) {
  return parseYMD(dhakaDayKey(instant))
}

/** UTC midnight of today's Asia/Dhaka calendar day. */
export function dhakaToday(now = new Date()) {
  return dhakaDayOf(now)
}

export const DUE_PRESETS = ['overdue', 'today', 'week', 'month', 'none', 'has']

/**
 * Mongo filter for a to-do due preset (Asia/Dhaka days), or null for an unknown one.
 *   overdue — due before today and not DONE
 *   today   — due today
 *   week    — due today … today + 6 (the next 7 days)
 *   month   — due today … today + 29 (the next 30 days)
 *   none    — no due date;  has — any due date
 */
export function duePresetFilter(preset, now = new Date()) {
  const today = dhakaToday(now)
  switch (preset) {
    case 'overdue': return { dueDate: { $ne: null, $lt: today }, status: { $ne: 'DONE' } }
    case 'today':   return { dueDate: { $gte: today, $lt: addDays(today, 1) } }
    case 'week':    return { dueDate: { $gte: today, $lt: addDays(today, 7) } }
    case 'month':   return { dueDate: { $gte: today, $lt: addDays(today, 30) } }
    case 'none':    return { dueDate: null }
    case 'has':     return { dueDate: { $ne: null } }
    default:        return null
  }
}
