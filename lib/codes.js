/**
 * lib/codes.js — record numbers (project codes, invoice numbers, client codes,
 * transaction ids, asset tags, …) as people type, paste or scan them.
 *
 * Record numbers are letters and digits only (ENTP2610A01, ENV2610A001). Numbers
 * issued before 2026-10 carried hyphens (ENTP-2610A01), and those still live on
 * printed invoices, emails, WhatsApp messages and asset stickers. Dropping the
 * separators turns an old number into its new form, so every lookup and search
 * compares numbers with separators ignored on BOTH sides: what is typed, and
 * what is stored (rows not yet migrated by scripts/migrate-remove-id-hyphens.js).
 *
 * Pure; safe for client and server code.
 */

// Separators found inside typed / pasted numbers: spaces, '#', '/', '.', '_'
// and every dash variant (hyphen, non-breaking hyphen, en/em dash, minus).
const SEPARATORS = /[\s#/._\-‐-―−]+/g
// The same set, as a regex class for stored values. The dashes are the
// characters themselves (JS escapes, not regex escapes): MongoDB's PCRE2
// rejects \uXXXX inside a pattern.
const SEP_CLASS = '[\\s#/._\\-‐-―−]*'

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** 'env-2610a001', '#ENV 2610A001' → 'ENV2610A001'; '' when nothing is left. */
export function compactCode(value) {
  return String(value ?? '').replace(SEPARATORS, '').toUpperCase()
}

/** Regex source matching `value` with any separators between its characters, or null. */
export function codePattern(value) {
  const c = compactCode(value)
  return c ? c.split('').map(escapeRegex).join(SEP_CLASS) : null
}

/**
 * Case-insensitive CONTAINS filter for a code field that ignores separators,
 * e.g. { projectCode: codeContains(q) }. null when the query holds no letters
 * or digits — leave the clause out then.
 */
export function codeContains(value) {
  const p = codePattern(value)
  return p ? { $regex: p, $options: 'i' } : null
}

/**
 * Case-insensitive EXACT filter for a code field that ignores separators, for
 * lookups by a number someone typed or scanned (login by client code, asset
 * sticker). Matches the stored number whether or not it still has hyphens.
 */
export function codeEquals(value) {
  const p = codePattern(value)
  return p ? { $regex: `^${p}$`, $options: 'i' } : null
}

/** True when two numbers are the same once separators and case are ignored. */
export function sameCode(a, b) {
  const x = compactCode(a)
  return x !== '' && x === compactCode(b)
}
