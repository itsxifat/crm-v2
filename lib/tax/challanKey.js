/**
 * lib/tax/challanKey.js — PURE helper (client-safe).
 *
 * Comparable form of a treasury challan / e-payment number: upper case, with
 * whitespace, '-', '/' and '.' removed, so 'v5a-12 / 2' and 'V5A122' are the same
 * challan. Used by the VAT return (note 58 matching) and by the unique index
 * that allows one ACTIVE deposit row per challan (TaxEntry.challanKey).
 */
export function challanKeyOf(value) {
  const s = String(value ?? '').trim()
  return s ? (s.toUpperCase().replace(/[\s\-/.]/g, '') || null) : null
}
