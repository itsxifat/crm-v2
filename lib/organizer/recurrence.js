/**
 * lib/organizer/recurrence.js — expands recurring organizer events into the
 * occurrences that overlap a query window. Pure and dependency-free.
 *
 * Event shape (an OrganizerEvent doc or plain object):
 *   { start, end, allDay, repeat: NONE|DAILY|WEEKLY|MONTHLY|YEARLY,
 *     repeatInterval, repeatUntil, exDates }
 *
 * Conventions (see models/OrganizerEvent.js):
 *   - all-day: start = UTC midnight of the first day, end = UTC midnight of the
 *     LAST day (inclusive) → its exclusive end is end + 1 day. Date math in UTC.
 *   - timed: real instants. Date math keeps the Asia/Dhaka wall-clock time fixed
 *     (UTC+6, no DST, so whole days can be added in UTC).
 *   - repeatUntil: UTC midnight of the last calendar day an occurrence may START
 *     on (inclusive) — a UTC day for all-day events, a Dhaka day for timed ones.
 *   - exDates: start instants of skipped occurrences.
 *   - MONTHLY keeps the day of month and skips months without it (the 31st);
 *     YEARLY keeps month + day (29 Feb → leap years only).
 *   - Duration of the master event is preserved for every occurrence.
 *
 * Window semantics, [from, to): an occurrence overlaps when start < to and
 *   timed:   end >= from
 *   all-day: end + 1 day > from
 */

export const DAY_MS = 86_400_000
export const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000
export const MAX_OCCURRENCES = 1000
export const REPEATS = ['NONE', 'DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']

// Belt and braces against pathological inputs (e.g. 29 Feb every 100 years).
const MAX_STEPS = 100_000

function toMs(v) {
  if (v === null || v === undefined || v === '') return NaN
  return v instanceof Date ? v.getTime() : new Date(v).getTime()
}

/** UTC epoch ms for y/m/d (month 0-based, may overflow) — safe for years 0-99 too. */
function utcMs(y, m, d) {
  const dt = new Date(0)
  dt.setUTCFullYear(y, m, d)
  return dt.getTime()
}

function daysInMonth(y, m) {
  return new Date(utcMs(y, m + 1, 0)).getUTCDate()
}

function clampInterval(v) {
  const n = Math.floor(Number(v))
  if (!Number.isFinite(n) || n < 1) return 1
  return Math.min(n, 365)
}

/** Does an occurrence [startMs, endMs] overlap [fromMs, toMs)? (see header) */
export function overlapsWindow(startMs, endMs, allDay, fromMs, toMs) {
  if (!(startMs < toMs)) return false
  return allDay ? endMs + DAY_MS > fromMs : endMs >= fromMs
}

/**
 * Exclusive upper bound on occurrence START instants implied by repeatUntil.
 * Infinity when the series never ends.
 */
export function untilBoundMs(repeatUntil, allDay) {
  const raw = toMs(repeatUntil)
  if (!Number.isFinite(raw)) return Infinity
  const day = Math.floor(raw / DAY_MS) * DAY_MS          // normalise to UTC midnight
  return allDay ? day + DAY_MS : day + DAY_MS - DHAKA_OFFSET_MS
}

/**
 * Occurrences of `event` overlapping [from, to), in start order, exDates skipped.
 * A non-recurring event yields itself when it overlaps.
 *
 * @param {object} event
 * @param {Date|string|number} from
 * @param {Date|string|number} to
 * @param {{ limit?: number }} [opts]   — max occurrences returned (default 1000)
 * @returns {{ start: Date, end: Date }[]}
 */
export function expandEvent(event, from, to, { limit = MAX_OCCURRENCES } = {}) {
  const s0 = toMs(event?.start)
  const e0 = toMs(event?.end)
  const fromMs = toMs(from)
  const toMsV = toMs(to)
  if (![s0, e0, fromMs, toMsV].every(Number.isFinite) || limit <= 0) return []

  const allDay = !!event.allDay
  const dur = Math.max(0, e0 - s0)
  const repeat = REPEATS.includes(event.repeat) ? event.repeat : 'NONE'

  if (repeat === 'NONE') {
    return overlapsWindow(s0, s0 + dur, allDay, fromMs, toMsV)
      ? [{ start: new Date(s0), end: new Date(s0 + dur) }]
      : []
  }

  const interval = clampInterval(event.repeatInterval)
  const stopAt = Math.min(toMsV, untilBoundMs(event.repeatUntil, allDay))
  const skip = new Set((Array.isArray(event.exDates) ? event.exDates : []).map(toMs).filter(Number.isFinite))
  // Occurrences starting before this instant end before `from` — jump straight past them.
  const effDur = allDay ? dur + DAY_MS : dur
  const lowStart = fromMs - effDur

  const out = []
  const consider = (st) => {
    if (skip.has(st)) return
    if (overlapsWindow(st, st + dur, allDay, fromMs, toMsV)) out.push({ start: new Date(st), end: new Date(st + dur) })
  }

  if (repeat === 'DAILY' || repeat === 'WEEKLY') {
    // Fixed-length steps: whole days in UTC keep both UTC midnights (all-day) and
    // the Dhaka wall-clock time (timed, no DST) fixed.
    const step = (repeat === 'DAILY' ? 1 : 7) * interval * DAY_MS
    let k = Math.max(0, Math.floor((lowStart - s0) / step))
    for (let n = 0; out.length < limit && n < MAX_STEPS; k++, n++) {
      const st = s0 + k * step
      if (st >= stopAt) break
      consider(st)
    }
    return out
  }

  // MONTHLY / YEARLY: calendar arithmetic on wall-clock parts — UTC for all-day,
  // Asia/Dhaka for timed (shift into "Dhaka as UTC", compute, shift back).
  const shift = allDay ? 0 : DHAKA_OFFSET_MS
  const local = new Date(s0 + shift)
  const y = local.getUTCFullYear()
  const m = local.getUTCMonth()
  const d = local.getUTCDate()
  const timeOfDay = s0 + shift - utcMs(y, m, d)
  const monthsPerStep = repeat === 'MONTHLY' ? interval : 12 * interval

  const lowLocal = new Date(lowStart + shift)
  const monthsToLow = (lowLocal.getUTCFullYear() - y) * 12 + (lowLocal.getUTCMonth() - m)
  let k = Math.max(0, Math.floor(monthsToLow / monthsPerStep) - 1)

  for (let n = 0; out.length < limit && n < MAX_STEPS; k++, n++) {
    const total = m + k * monthsPerStep
    const ty = y + Math.floor(total / 12)
    const tm = ((total % 12) + 12) % 12
    if (d > daysInMonth(ty, tm)) {
      // This month (or Feb of a non-leap year) lacks the day — skip it, but stop
      // once whole months lie past the window.
      if (utcMs(ty, tm, 1) - shift >= stopAt) break
      continue
    }
    const st = utcMs(ty, tm, d) + timeOfDay - shift
    if (st >= stopAt) break
    consider(st)
  }
  return out
}

/** True when `instant` is the start of one of the series' occurrences (exDates ignored). */
export function isOccurrenceStart(event, instant) {
  const t = toMs(instant)
  if (!Number.isFinite(t)) return false
  // Plain copy (works for Mongoose docs too), without exclusions.
  const probe = {
    start: event?.start, end: event?.end, allDay: event?.allDay, repeat: event?.repeat,
    repeatInterval: event?.repeatInterval, repeatUntil: event?.repeatUntil, exDates: [],
  }
  return expandEvent(probe, t, t + 1, { limit: MAX_OCCURRENCES }).some(o => o.start.getTime() === t)
}
