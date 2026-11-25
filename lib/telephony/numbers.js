/**
 * lib/telephony/numbers.js — phone numbers as people type them, as Envo dials them and as
 * callers arrive. Pure functions, used by the server and the browser alike.
 *
 * Numbers in the CRM are free text ("+880 1712-345678", "01712345678", "02-9123456").
 * A caller can arrive as 8801712345678, +8801712345678, 01712345678 or 1712345678.
 * They are the same number when their last ten digits agree (an 11-digit Bangladeshi
 * mobile without its leading 0); shorter numbers (extensions, short codes) only match
 * exactly.
 */

const KEY_DIGITS = 10

/** Digits only. */
export function digitsOf(value) {
  return String(value ?? '').replace(/\D/g, '')
}

/**
 * What to send to Envo: separators dropped, Bangladeshi numbers in their local 0… form
 * (every Envo route takes it), anything else as typed with a leading + kept.
 * '' when nothing dialable is left.
 */
export function dialable(value) {
  const raw = String(value ?? '').trim()
  const plus = raw.startsWith('+')
  const cleaned = raw.replace(/[^\d*#]/g, '')
  if (!cleaned) return ''
  const bd = cleaned.match(/^(?:00)?880(\d{6,10})$/)
  if (bd) return `0${bd[1]}`
  if (cleaned.startsWith('00') && cleaned.length > 6) return `+${cleaned.slice(2)}`
  return plus ? `+${cleaned}` : cleaned
}

/** The part of a number two spellings of it share: its last ten digits, or all of a short one. */
export function numberKey(value) {
  const d = digitsOf(value)
  if (!d) return ''
  return d.length > KEY_DIGITS ? d.slice(-KEY_DIGITS) : d
}

/** Two spellings of the same number. */
export function sameNumber(a, b) {
  const ka = numberKey(a)
  return !!ka && ka === numberKey(b) && (ka.length >= 7 || digitsOf(a) === digitsOf(b))
}

/**
 * A Mongo $regex matching a stored free-text number whose digits end with this number's
 * key, whatever separators it was typed with. null for numbers too short to look up
 * (under 7 digits: extensions, short codes).
 */
export function numberRegex(value) {
  const key = numberKey(value)
  if (key.length < 7) return null
  return `${key.split('').join('\\D*')}\\D*$`
}

/** A number for people to read: 01712-345678 for Bangladeshi mobiles, else as dialled. */
export function formatNumber(value) {
  const d = dialable(value)
  const m = d.match(/^(01\d{3})(\d{6})$/)
  return m ? `${m[1]}-${m[2]}` : d || String(value ?? '')
}
