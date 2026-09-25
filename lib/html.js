/**
 * lib/html.js — Server-safe HTML escaping (no DOM needed).
 *
 * Use for EVERY user/DB-supplied value interpolated into HTML built as a string
 * (PDFs, vouchers, salary slips, emails) to prevent HTML/script injection.
 *
 *   import { escapeHtml } from '@/lib/html'
 *   const html = `<td>${escapeHtml(client.name)}</td>`
 */

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
  '`': '&#96;',
}

/**
 * Escape a value for safe use in HTML text content AND quoted attribute values.
 * null/undefined → '' ; numbers/booleans/other → String(value) then escaped.
 * @param {any} value
 * @returns {string}
 */
export function escapeHtml(value) {
  if (value === null || value === undefined) return ''
  return String(value).replace(/[&<>"'`]/g, ch => HTML_ESCAPES[ch])
}
