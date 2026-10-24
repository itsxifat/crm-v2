/**
 * lib/printAuthorization.js — the sign-and-seal block of authorizable print
 * documents (expense invoices: app/api/expenses/[id]/voucher and
 * app/api/expenses/combined-voucher).
 *
 * A printed document is only authorized when EVERY page that carries content is
 * signed and sealed, so the block cannot sit once at the end. It is the footer
 * group of a table wrapping the whole document: the browser repeats a table
 * footer at the foot of each page the table reaches, for whatever paper the
 * document is printed on, and a page only exists when content flows onto it —
 * so the block is never printed on a page of its own, and a document that fits
 * on one page gets it once.
 *
 * What the wrapped content must respect, so no page holds nothing worth signing:
 *  - Nothing trailing that is not content: the "generated on" / reference line
 *    belongs in the block (`reference`), not at the end of the body.
 *  - Small boxes stay whole (class `auth-keep`), so an empty sliver of a box's
 *    padding or border can never spill onto an extra page.
 *
 * Server-safe: builds HTML strings. Values passed in must already be escaped.
 */

export const DEFAULT_SIGNERS = ['Prepared By', 'Approved By / Account Manager', 'Authorised Signatory']

/** Styles for authorizedPages(); include once in the document's <style>. */
export const AUTH_PAGES_CSS = `
  table.auth-doc { width: 100%; border-collapse: collapse; }
  table.auth-doc > tbody > tr { break-inside: auto; page-break-inside: auto; }
  table.auth-doc > tbody > tr > td, table.auth-doc > tfoot > tr > td { padding: 0; vertical-align: top; }
  table.auth-doc > tfoot { display: table-footer-group; }
  table.auth-doc > tfoot > tr { break-inside: avoid; page-break-inside: avoid; }
  .auth-keep { break-inside: avoid; page-break-inside: avoid; }
  .auth-block { padding: 22px 0 4px; }  /* bottom room keeps descenders of the last line on their own page */
  .auth-row { display: flex; align-items: flex-start; gap: 22px; }
  .auth-sig { flex: 1; text-align: center; padding-top: 44px; }
  .auth-sig-line { border-top: 1px solid #334155; margin: 0 4px 5px; }
  .auth-sig-label { font-size: 9.5px; color: #64748b; text-transform: uppercase; letter-spacing: 0.06em; }
  .auth-seal { width: 118px; height: 74px; flex: none; border: 1px dashed #cbd5e1; border-radius: 8px;
    display: flex; align-items: center; justify-content: center; color: #94a3b8; font-size: 9.5px;
    text-transform: uppercase; letter-spacing: 0.08em; }
  .auth-ref { margin-top: 8px; padding-top: 6px; border-top: 1px solid #e2e8f0; display: flex;
    justify-content: space-between; gap: 12px; font-size: 9.5px; color: #94a3b8; }
  .auth-ref strong { color: #64748b; font-weight: 600; }
`

/**
 * Wrap a document body so the sign-and-seal block prints at the foot of every
 * page the body reaches.
 * @param {string} body                 already-escaped HTML of the whole document
 * @param {object} [opts]
 * @param {string[]} [opts.signers]     signature captions, left to right
 * @param {string} [opts.reference]     already-escaped line naming the document
 *                                      (number, generated date, company)
 */
export function authorizedPages(body, { signers = DEFAULT_SIGNERS, reference = '' } = {}) {
  const sigs = signers.map(s => `
        <div class="auth-sig"><div class="auth-sig-line"></div><div class="auth-sig-label">${s}</div></div>`).join('')
  return `
<table class="auth-doc">
  <tbody><tr><td>${body}</td></tr></tbody>
  <tfoot><tr><td>
    <div class="auth-block">
      <div class="auth-row">${sigs}
        <div class="auth-seal">Company Seal</div>
      </div>
      <div class="auth-ref"><span>${reference}</span><strong>Sign and seal every page</strong></div>
    </div>
  </td></tr></tfoot>
</table>`
}
