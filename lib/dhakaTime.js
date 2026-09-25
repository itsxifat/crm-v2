/**
 * Business-timezone date helpers (Asia/Dhaka, UTC+6, no DST).
 *
 * Day / month boundaries for reports and dashboards must follow the business
 * timezone, not the server's (often UTC). All helpers return real Date
 * instants (UTC under the hood) that correspond to Dhaka wall-clock times.
 */

export const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000

/** Dhaka calendar parts for an instant: { year, month (0-11), day, weekday }. */
export function dhakaParts(date = new Date()) {
  const d = new Date(new Date(date).getTime() + DHAKA_OFFSET_MS)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth(), day: d.getUTCDate(), weekday: d.getUTCDay() }
}

/** 'YYYY-MM-DD' of the Dhaka calendar day containing `date` (e.g. date-input defaults). */
export function dhakaDayKey(date = new Date()) {
  const { year, month, day } = dhakaParts(date)
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

/**
 * Instant for a Dhaka wall-clock time. Month is 0-based and may overflow
 * (like Date.UTC), e.g. dhakaDate(2026, 12, 1) → 1 Jan 2027 00:00 Dhaka.
 */
export function dhakaDate(year, month, day = 1, h = 0, m = 0, s = 0, ms = 0) {
  return new Date(Date.UTC(year, month, day, h, m, s, ms) - DHAKA_OFFSET_MS)
}

/** Start of the Dhaka calendar month containing `date`, shifted by `offset` months. */
export function dhakaMonthStart(date = new Date(), offset = 0) {
  const { year, month } = dhakaParts(date)
  return dhakaDate(year, month + offset, 1)
}

/** Start of the Dhaka calendar day containing `date`, shifted by `offset` days. */
export function dhakaDayStart(date = new Date(), offset = 0) {
  const { year, month, day } = dhakaParts(date)
  return dhakaDate(year, month, day + offset)
}

/**
 * Parse a 'YYYY-MM-DD' filter value as a Dhaka calendar day.
 * Returns { start, next } (start of that day and start of the following day),
 * or null when the string is not a valid date-only value.
 */
export function parseDhakaDay(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value ?? '').trim())
  if (!m) return null
  const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])]
  const start = dhakaDate(y, mo, d)
  if (Number.isNaN(start.getTime())) return null
  return { start, next: dhakaDate(y, mo, d + 1) }
}
