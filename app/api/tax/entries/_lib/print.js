/**
 * app/api/tax/entries/_lib/print.js — SERVER-ONLY HTML shell for printable tax
 * documents (Mushak-6.6, TDS certificate). Same pattern as
 * app/api/salary/[id]/slip/route.js: a self-contained HTML string, every value
 * escaped with escapeHtml, a nonce-based CSP and an auto window.print().
 */

import { randomBytes } from 'crypto'
import { escapeHtml } from '@/lib/html'
import { round2 } from '@/lib/tax/catalog'
import { dayKeyLabel } from '@/lib/finance/fiscal'
import { dhakaDayKey } from '@/lib/dhakaTime'

export const esc = escapeHtml

export const newNonce = () => randomBytes(16).toString('base64')

/** '15 Oct 2026' in Asia/Dhaka ('—' when empty). */
export function fmtDay(d) {
  if (!d) return '—'
  const t = new Date(d)
  if (Number.isNaN(t.getTime())) return '—'
  return dayKeyLabel(dhakaDayKey(t))
}

/** '1,25,000.00' (Bangladeshi grouping, 2 dp). */
export function fmtTk(n) {
  return round2(Number(n) || 0).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function headers(nonce, filename) {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    // Only our own nonce'd script may run in this document.
    'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; script-src 'nonce-${nonce}'; base-uri 'self'; form-action 'none'; frame-ancestors 'self'`,
    ...(filename ? { 'Content-Disposition': `inline; filename="${String(filename).replace(/[^\w.-]/g, '_')}.html"` } : {}),
  }
}

const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', 'Nirmala UI', 'Noto Sans Bengali', 'Vrinda', Arial, sans-serif; background: #fff; color: #0f172a; font-size: 12px; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; break-inside: avoid; }
  .page { max-width: 800px; margin: 0 auto; padding: 8px 0 24px; position: relative; }
  .page + .page { page-break-before: always; break-before: page; margin-top: 28px; }
  .bn { font-family: 'Nirmala UI', 'Noto Sans Bengali', 'Vrinda', 'Segoe UI', sans-serif; }
  .muted { color: #64748b; }
  .center { text-align: center; }
  .right { text-align: right; }
  .mono { font-family: Consolas, 'Courier New', monospace; }
  .grid { border: 1px solid #334155; }
  .grid th, .grid td { border: 1px solid #334155; padding: 5px 6px; vertical-align: top; }
  .grid th { background: #f1f5f9; font-weight: 600; font-size: 11px; text-align: center; }
  .grid td.num { text-align: right; white-space: nowrap; }
  .grid tr.total td { font-weight: 700; background: #f8fafc; }
  .grid td.grey { background: #e2e8f0; }
  .colno th { font-weight: 500; font-size: 10px; background: #fff; padding: 2px; }
  .kv td { padding: 3px 4px; vertical-align: top; }
  .kv td.k { width: 34%; color: #334155; }
  .kv td.v { font-weight: 600; }
  .copy-tag { position: absolute; top: 4px; left: 0; font-size: 10px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; color: #475569; border: 1px solid #94a3b8; padding: 2px 6px; border-radius: 4px; }
  .watermark { position: fixed; top: 42%; left: 50%; transform: translate(-50%, -50%) rotate(-28deg); font-size: 96px; font-weight: 800; color: rgba(220, 38, 38, .12); letter-spacing: .1em; pointer-events: none; z-index: 0; }
  .toolbar { max-width: 800px; margin: 12px auto 4px; padding: 10px 12px; border: 1px solid #e2e8f0; border-radius: 10px; background: #f8fafc; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 12px; }
  .toolbar button, .toolbar a { border: 1px solid #cbd5e1; background: #fff; color: #0f172a; padding: 5px 10px; border-radius: 8px; font-size: 12px; text-decoration: none; cursor: pointer; }
  .toolbar button.primary { background: #0f172a; color: #fff; border-color: #0f172a; }
  .toolbar a.active { background: #e2e8f0; font-weight: 600; }
  .notice { max-width: 800px; margin: 6px auto; padding: 8px 12px; border-radius: 8px; font-size: 12px; }
  .notice.warn { background: #fffbeb; border: 1px solid #fde68a; color: #92400e; }
  .notice.info { background: #eff6ff; border: 1px solid #bfdbfe; color: #1e40af; }
  .notice.danger { background: #fef2f2; border: 1px solid #fecaca; color: #991b1b; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none !important; }
    .page + .page { margin-top: 0; }
  }
  @page { size: A4; margin: 12mm 12mm; }
`

/**
 * Wrap document pages in the print shell.
 * @param {object} p
 * @param {string} p.title
 * @param {string} p.origin        request origin (for <base>, so /en-logo.png resolves)
 * @param {string} p.nonce
 * @param {string} p.body          HTML of the pages
 * @param {string} [p.toolbar]     extra toolbar HTML (links)
 * @param {Array<{level:'warn'|'info'|'danger', text:string}>} [p.notices]
 * @param {boolean} [p.autoPrint]
 * @param {boolean} [p.draft]      DRAFT watermark
 */
export function renderDocument({ title, origin, nonce, body, toolbar = '', notices = [], autoPrint = true, draft = false, extraCss = '' }) {
  const noticeHtml = notices.map(n => `<div class="notice ${esc(n.level)} no-print">${esc(n.text)}</div>`).join('')
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<base href="${esc(origin)}/" />
<title>${esc(title)}</title>
<style>${BASE_CSS}${extraCss}</style>
</head>
<body>
<div class="toolbar no-print">
  <button type="button" class="primary" id="print-btn">Print</button>
  <button type="button" id="close-btn">Close</button>
  ${toolbar}
</div>
${noticeHtml}
${draft ? '<div class="watermark">DRAFT</div>' : ''}
${body}
<script nonce="${nonce}">
  document.getElementById('print-btn').addEventListener('click', function () { window.print() })
  document.getElementById('close-btn').addEventListener('click', function () { window.close() })
  ${autoPrint ? 'window.onload = function () { window.print() }' : ''}
</script>
</body>
</html>`
}

export function printResponse(html, nonce, filename, status = 200) {
  return new Response(html, { status, headers: headers(nonce, filename) })
}

/** A plain message page (used when a certificate cannot be produced). */
export function messageResponse({ origin, title, message, details = [], status = 409 }) {
  const nonce = newNonce()
  const list = details.length ? `<ul style="margin:10px 0 0 18px;color:#334155;">${details.map(d => `<li style="margin:3px 0;">${esc(d)}</li>`).join('')}</ul>` : ''
  const body = `<div class="page" style="padding-top:24px;">
    <div style="border:1px solid #fecaca;background:#fef2f2;border-radius:12px;padding:18px 20px;">
      <p style="font-size:15px;font-weight:700;color:#991b1b;margin-bottom:6px;">${esc(title)}</p>
      <p style="font-size:13px;color:#7f1d1d;">${esc(message)}</p>
      ${list}
    </div>
  </div>`
  return printResponse(renderDocument({ title, origin, nonce, body, autoPrint: false }), nonce, null, status)
}

/** Mask a TIN for viewers without pii.identity.view (keeps the last 4 digits). */
export function maskTin(tin) {
  const s = String(tin ?? '')
  if (!s) return ''
  return s.length <= 4 ? '••••' : `${'•'.repeat(Math.max(4, s.length - 4))}${s.slice(-4)}`
}
