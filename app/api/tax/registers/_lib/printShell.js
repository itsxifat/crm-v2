/**
 * Shared shell for the server-rendered tax prints (Mushak-9.1 working paper,
 * Mushak-6.1 / 6.2 / 6.10 registers, VDS / TDS registers).
 *
 * Same security model as app/api/salary/[id]/slip: every value is escaped,
 * only our nonce'd print script may run, no external resources.
 */
import { randomBytes } from 'crypto'
import { escapeHtml } from '@/lib/html'

const pad2 = (n) => String(n).padStart(2, '0')
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000

export { escapeHtml }

/** '15 Oct 2026' from a Date / ISO string / 'YYYY-MM-DD' (Dhaka calendar day). */
export function fmtDay(value) {
  if (value === null || value === undefined || value === '') return ''
  let y, m, d
  const s = typeof value === 'string' ? value.trim() : null
  const dm = s && /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (dm) {
    y = Number(dm[1]); m = Number(dm[2]); d = Number(dm[3])
  } else {
    const t = new Date(value).getTime()
    if (Number.isNaN(t)) return ''
    const dd = new Date(t + DHAKA_OFFSET_MS)
    y = dd.getUTCFullYear(); m = dd.getUTCMonth() + 1; d = dd.getUTCDate()
  }
  return `${pad2(d)} ${MONTHS[m - 1]} ${y}`
}

/** '15 Oct 2026, 14:05' (Dhaka). */
export function fmtDateTime(value) {
  const t = new Date(value ?? Date.now()).getTime()
  if (Number.isNaN(t)) return ''
  const dd = new Date(t + DHAKA_OFFSET_MS)
  return `${fmtDay(value)}, ${pad2(dd.getUTCHours())}:${pad2(dd.getUTCMinutes())}`
}

/** '1,23,456.70' (Bangladeshi grouping); '' for null/undefined; negative with a leading minus. */
export function fmtMoney(value, { blankZero = false } = {}) {
  if (value === null || value === undefined || value === '') return ''
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  if (blankZero && Math.abs(n) < 0.005) return ''
  const r = Math.round((Math.abs(n) + Number.EPSILON) * 100) / 100
  const s = r.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return n < -0.0049 ? `-${s}` : s
}

/** Plain quantity (up to 4 dp). */
export function fmtQty(value) {
  if (value === null || value === undefined || value === '') return ''
  const n = Number(value)
  if (!Number.isFinite(n)) return ''
  return n.toLocaleString('en-IN', { maximumFractionDigits: 4 })
}

/** Company letterhead block for statutory prints. */
export function companyBlock(company, { extra = [] } = {}) {
  const lines = [
    company?.address ? escapeHtml(company.address) : '',
    company?.bin ? `BIN: <strong>${escapeHtml(company.bin)}</strong>` : 'BIN: <span class="warn">not set — add it in Tax settings</span>',
    company?.tin ? `TIN: ${escapeHtml(company.tin)}` : '',
    company?.vatCircle ? `VAT circle: ${escapeHtml(company.vatCircle)}` : '',
    ...extra,
  ].filter(Boolean)
  return `
    <div class="co">
      <p class="co-name">${escapeHtml(company?.name || 'Company name not set')}</p>
      ${lines.map(l => `<p class="co-line">${l}</p>`).join('')}
    </div>`
}

const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', Arial, sans-serif; background: #fff; color: #0f172a; font-size: 11px; }
  .page { max-width: 1120px; margin: 0 auto; padding: 8px 4px; }
  .head { display: flex; justify-content: space-between; align-items: flex-start; gap: 16px; margin-bottom: 12px; }
  .co-name { font-size: 14px; font-weight: 700; margin-bottom: 2px; }
  .co-line { font-size: 10.5px; color: #475569; margin-bottom: 1px; }
  .form-id { text-align: right; }
  .form-no { font-size: 11px; font-weight: 700; color: #334155; letter-spacing: 0.02em; }
  .form-title { font-size: 18px; font-weight: 800; letter-spacing: -0.2px; margin-top: 2px; }
  .form-sub { font-size: 10.5px; color: #64748b; margin-top: 2px; }
  .badge { display: inline-block; margin-top: 6px; padding: 2px 8px; border-radius: 999px; font-size: 10px; font-weight: 700; text-transform: uppercase; letter-spacing: 0.04em; }
  .b-green { background: #f0fdf4; color: #15803d; } .b-amber { background: #fffbeb; color: #b45309; } .b-gray { background: #f1f5f9; color: #475569; }
  h2 { font-size: 12px; font-weight: 700; margin: 14px 0 6px; padding-bottom: 3px; border-bottom: 2px solid #0f172a; }
  h3 { font-size: 11px; font-weight: 700; margin: 10px 0 4px; color: #334155; }
  table { width: 100%; border-collapse: collapse; }
  thead { display: table-header-group; }
  tr { page-break-inside: avoid; break-inside: avoid; }
  th, td { border: 1px solid #cbd5e1; padding: 3px 5px; vertical-align: top; }
  th { background: #f1f5f9; font-weight: 600; font-size: 9.5px; text-align: center; color: #334155; }
  td { font-size: 10px; }
  td.r, th.r { text-align: right; white-space: nowrap; }
  td.c { text-align: center; }
  td.mono { font-family: Consolas, 'Courier New', monospace; font-size: 9.5px; }
  tr.colno th { background: #fff; font-weight: 500; color: #64748b; font-size: 9px; }
  tr.total td { font-weight: 700; background: #f8fafc; }
  tr.muted td { color: #94a3b8; }
  tr.hl td { background: #fefce8; font-weight: 700; }
  .grid2 { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 24px; }
  .kv { display: flex; justify-content: space-between; gap: 12px; padding: 2px 0; border-bottom: 1px dotted #e2e8f0; }
  .kv span:first-child { color: #64748b; }
  .warn { color: #b45309; font-weight: 600; }
  .note { font-size: 9.5px; color: #64748b; margin-top: 6px; line-height: 1.5; }
  .alerts li { margin: 2px 0 2px 16px; font-size: 10px; }
  .sign { display: flex; justify-content: space-between; gap: 32px; margin-top: 36px; }
  .sign div { flex: 1; border-top: 1px solid #94a3b8; padding-top: 4px; font-size: 10px; color: #475569; }
  .foot { margin-top: 18px; border-top: 1px solid #e2e8f0; padding-top: 6px; text-align: center; font-size: 9.5px; color: #94a3b8; }
  .empty { padding: 8px; text-align: center; color: #94a3b8; font-style: italic; }
  @media print { body { -webkit-print-color-adjust: exact; print-color-adjust: exact; } .noprint { display: none; } }
`

/**
 * Wrap a body in the printable document and return the Response.
 * @param {{ request: Request, title: string, body: string, landscape?: boolean, filename: string, autoPrint?: boolean }} o
 */
export function printResponse({ request, title, body, landscape = false, filename, autoPrint = true }) {
  const nonce = randomBytes(16).toString('base64')
  const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<base href="${escapeHtml(new URL(request.url).origin)}/" />
<title>${escapeHtml(title)}</title>
<style>${BASE_CSS}
  @page { size: A4${landscape ? ' landscape' : ''}; margin: 10mm 8mm; }
</style>
</head>
<body>
<div class="page">
${body}
</div>
${autoPrint ? `<script nonce="${nonce}">window.onload = () => window.print()</script>` : ''}
</body>
</html>`
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; script-src 'nonce-${nonce}'; base-uri 'self'; form-action 'none'; frame-ancestors 'self'`,
      'Content-Disposition': `inline; filename="${String(filename).replace(/[^\w.-]/g, '_')}.html"`,
      'Cache-Control': 'no-store',
    },
  })
}
