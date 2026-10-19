/**
 * Shared server-side HTML helpers for the statutory VAT documents printed by
 * V2 routes (SERVER-ONLY, not a route):
 *   - Mushak-6.3 tax invoice     GET /api/invoices/[id]/mushak
 *   - Mushak-6.7 / 6.8 notes     GET /api/credit-notes/[id]/print
 *
 * Layout follows the forms in SRO 142-AIN/2020/103-VAT (bilingual labels:
 * the Bangla text of the form plus an English gloss). Documents are plain
 * HTML with a nonce'd auto-print script, like the salary slip / vouchers.
 */

import { randomBytes } from 'crypto'
import { escapeHtml } from '@/lib/html'

export const esc = escapeHtml

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** 1,00,000.00 (Bangladeshi grouping, 2 decimals). */
export function fmtNum(n) {
  return round2(num(n)).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

/** Quantity without trailing zeros (up to 4 decimals). */
export function fmtQty(n) {
  const v = Math.round(num(n) * 10000) / 10000
  return v.toLocaleString('en-BD', { maximumFractionDigits: 4 })
}

/** Rate as '15%' / '7.5%'. */
export function fmtRate(r) {
  const v = Math.round(num(r) * 10000) / 10000
  return `${v.toLocaleString('en-BD', { maximumFractionDigits: 4 })}%`
}

export function fmtDhakaDate(d) {
  if (!d) return '—'
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return '—'
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Dhaka' })
}

export function fmtDhakaTime(d) {
  if (!d) return '—'
  const dt = new Date(d)
  if (Number.isNaN(dt.getTime())) return '—'
  return dt.toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Dhaka' }).toUpperCase()
}

/**
 * Taka conversion for a document in another currency: VAT documents are in
 * Taka. Uses the invoice's own BDT equivalent (totalBDT / total).
 * @returns {{ currency: string, rate: number, converted: boolean, known: boolean }}
 */
export function fxOfInvoice(invoice) {
  const currency = String(invoice?.currency || 'BDT').toUpperCase()
  if (currency === 'BDT') return { currency, rate: 1, converted: false, known: true }
  const total = num(invoice?.total)
  const totalBDT = num(invoice?.totalBDT)
  if (total > 0 && totalBDT > 0) return { currency, rate: totalBDT / total, converted: true, known: true }
  return { currency, rate: 1, converted: false, known: false }
}

/** Amount label of the money columns: Tk, or the foreign currency when no BDT rate is known. */
export function moneyUnit(fx) {
  if (fx.converted || fx.currency === 'BDT') return { bn: 'টাকায়', en: 'Tk' }
  return { bn: fx.currency, en: fx.currency }
}

export const BASE_CSS = `
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: 'Segoe UI', 'Nirmala UI', 'Noto Sans Bengali', 'Kohinoor Bangla', 'Bangla Sangam MN', 'Vrinda', Arial, sans-serif; background: #fff; color: #111827; font-size: 11px; line-height: 1.45; }
  .page { max-width: 794px; margin: 0 auto; padding: 18px 20px 28px; position: relative; }
  .bn { font-family: 'Nirmala UI', 'Noto Sans Bengali', 'Kohinoor Bangla', 'Bangla Sangam MN', 'Vrinda', 'Segoe UI', sans-serif; }
  .en { color: #4b5563; font-size: 0.86em; }
  .muted { color: #6b7280; }
  .gov { display: grid; grid-template-columns: 1fr auto 1fr; align-items: start; gap: 8px; margin-bottom: 10px; }
  .gov .center { text-align: center; }
  .gov .formno { justify-self: end; border: 1.5px solid #111827; border-radius: 8px; padding: 6px 14px; text-align: center; font-weight: 700; font-size: 13px; }
  .title { text-align: center; margin: 6px 0 12px; }
  .title h1 { font-size: 16px; font-weight: 700; }
  .title .rule { font-size: 10.5px; font-weight: 600; margin-top: 2px; }
  .copy { display: inline-block; margin-top: 6px; padding: 2px 10px; border: 1px solid #111827; border-radius: 999px; font-size: 10px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; }
  .copy.dup { border-color: #b91c1c; color: #b91c1c; }
  .fields { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  .fields td { padding: 2px 4px; vertical-align: top; font-size: 11px; }
  .fields td.k { white-space: nowrap; width: 1%; padding-right: 8px; }
  .fields td.v { font-weight: 600; border-bottom: 1px dotted #9ca3af; }
  .grid2 { display: grid; grid-template-columns: 1.35fr 1fr; gap: 0 28px; margin-bottom: 12px; }
  table.form { width: 100%; border-collapse: collapse; table-layout: auto; }
  table.form th, table.form td { border: 1px solid #374151; padding: 4px 4px; font-size: 9.6px; vertical-align: top; }
  table.form th { font-weight: 600; text-align: center; vertical-align: middle; background: #f9fafb; }
  table.form tr.colno td { text-align: center; font-size: 9px; color: #374151; background: #f9fafb; padding: 2px; }
  table.form td.n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  table.form td.c { text-align: center; }
  table.form th.desc, table.form td.desc { min-width: 170px; width: 24%; }
  table.form td.grey { background: #d1d5db; }
  table.form tr.total td { font-weight: 700; background: #f3f4f6; }
  table.form tr.total td.grey { background: #d1d5db; }
  table.form thead { display: table-header-group; }
  table.form tr { page-break-inside: avoid; break-inside: avoid; }
  .notes { margin-top: 10px; font-size: 10.5px; }
  .notes table { border-collapse: collapse; margin-left: auto; min-width: 300px; }
  .notes td { padding: 2px 6px; }
  .notes td.n { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .notes tr.strong td { font-weight: 700; border-top: 1px solid #374151; }
  .remarks { margin-top: 8px; font-size: 10px; color: #374151; }
  .remarks li { margin-left: 14px; }
  .sign { display: grid; grid-template-columns: 1fr auto; align-items: end; gap: 24px; margin-top: 30px; }
  .sign .who td { padding: 3px 4px; font-size: 11px; }
  .sign .who td.k { white-space: nowrap; padding-right: 8px; }
  .sign .who td.v { min-width: 220px; border-bottom: 1px dotted #9ca3af; font-weight: 600; }
  .seal { width: 120px; height: 70px; border: 1px dashed #9ca3af; border-radius: 8px; display: flex; align-items: center; justify-content: center; color: #6b7280; }
  .foot { margin-top: 18px; padding-top: 6px; border-top: 1px solid #d1d5db; font-size: 9.5px; color: #4b5563; }
  .wm { position: fixed; top: 42%; left: 0; right: 0; text-align: center; transform: rotate(-28deg); font-size: 92px; font-weight: 800; letter-spacing: 0.08em; color: rgba(185, 28, 28, 0.13); pointer-events: none; z-index: 0; }
  .wm + .wm { top: 62%; }
  .toolbar { position: sticky; top: 0; z-index: 5; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; justify-content: center; padding: 10px; background: #f3f4f6; border-bottom: 1px solid #e5e7eb; font-family: 'Segoe UI', Arial, sans-serif; }
  .toolbar button, .toolbar a { font: inherit; font-size: 12px; padding: 6px 12px; border-radius: 8px; border: 1px solid #d1d5db; background: #fff; color: #111827; text-decoration: none; cursor: pointer; }
  .toolbar button.primary { background: #111827; color: #fff; border-color: #111827; }
  .alert { max-width: 794px; margin: 10px auto 0; padding: 8px 12px; border: 1px solid #fcd34d; background: #fffbeb; color: #92400e; border-radius: 8px; font-size: 11.5px; font-family: 'Segoe UI', Arial, sans-serif; }
  @media print {
    body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .no-print { display: none !important; }
    .page { padding: 0; }
  }
  @page { size: A4; margin: 10mm 9mm; }
`

/** Government / NBR banner with the form number box. */
export function govHeader({ formBn, formEn }) {
  return `
  <div class="gov">
    <div></div>
    <div class="center">
      <div class="bn" style="font-weight:600;">গণপ্রজাতন্ত্রী বাংলাদেশ সরকার</div>
      <div class="en">Government of the People's Republic of Bangladesh</div>
      <div class="bn" style="font-weight:600;margin-top:2px;">জাতীয় রাজস্ব বোর্ড</div>
      <div class="en">National Board of Revenue</div>
    </div>
    <div class="formno"><div class="bn">${esc(formBn)}</div><div class="en" style="font-weight:600;">${esc(formEn)}</div></div>
  </div>`
}

/** A label cell pair: Bangla label + English gloss → value. */
export function fieldRow(bn, en, value, { raw = false } = {}) {
  const v = value === null || value === undefined || value === '' ? '—' : (raw ? value : esc(value))
  return `<tr><td class="k"><span class="bn">${esc(bn)}</span> <span class="en">/ ${esc(en)}</span>:</td><td class="v">${v}</td></tr>`
}

/** Signature block (name, designation, signature, seal) from the company profile. */
export function signatureBlock(company, { bnTitle = 'প্রতিষ্ঠান কর্তৃপক্ষের দায়িত্বপ্রাপ্ত ব্যক্তির নাম', enTitle = 'Name of the authorised person' } = {}) {
  return `
  <div class="sign">
    <table class="who">
      ${fieldRow(bnTitle, enTitle, company?.signatoryName || '')}
      ${fieldRow('পদবি', 'Designation', company?.signatoryDesignation || '')}
      <tr><td class="k"><span class="bn">স্বাক্ষর</span> <span class="en">/ Signature</span>:</td><td class="v" style="height:28px;"></td></tr>
    </table>
    <div class="seal"><span class="bn">সিল</span>&nbsp;<span class="en">/ Seal</span></div>
  </div>`
}

/**
 * Full HTML document with optional watermarks, a screen-only toolbar and the
 * nonce'd print script.
 */
export function documentHtml({ title, origin, body, watermarks = [], toolbar = '', alerts = [], nonce, autoPrint = true }) {
  const wm = watermarks.filter(Boolean).map(w => `<div class="wm">${esc(w)}</div>`).join('')
  const alertHtml = alerts.filter(Boolean).map(a => `<div class="alert no-print">${esc(a)}</div>`).join('')
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<base href="${esc(origin)}/" />
<title>${esc(title)}</title>
<style>${BASE_CSS}</style>
</head>
<body>
${toolbar ? `<div class="toolbar no-print">${toolbar}</div>` : ''}
${alertHtml}
${wm}
<div class="page">
${body}
</div>
<script nonce="${nonce}">
  (function () {
    var b = document.getElementById('btn-print');
    if (b) b.addEventListener('click', function () { window.print(); });
    ${autoPrint ? "window.addEventListener('load', function () { setTimeout(function () { window.print(); }, 250); });" : ''}
  })();
</script>
</body>
</html>`
}

export function newNonce() {
  return randomBytes(16).toString('base64')
}

/** text/html Response with a CSP that only allows our own nonce'd script. */
export function htmlResponse(html, nonce, filename) {
  return new Response(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; script-src 'nonce-${nonce}'; base-uri 'self'; form-action 'none'; frame-ancestors 'self'`,
      'Content-Disposition': `inline; filename="${String(filename).replace(/[^\w.-]/g, '_')}.html"`,
      'Cache-Control': 'no-store',
    },
  })
}

/** Small self-contained HTML error page (the print routes open in a new tab). */
export function errorPage(status, message, origin) {
  const nonce = newNonce()
  const html = documentHtml({
    title: 'Cannot print',
    origin,
    nonce,
    autoPrint: false,
    body: `<div style="max-width:520px;margin:60px auto;text-align:center;font-family:'Segoe UI',Arial,sans-serif;">
      <p style="font-size:15px;font-weight:600;color:#111827;margin-bottom:6px;">Cannot print this document</p>
      <p style="font-size:13px;color:#4b5563;">${esc(message)}</p>
    </div>`,
  })
  return new Response(html, {
    status,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'; base-uri 'self'; form-action 'none'; frame-ancestors 'self'`,
      'Cache-Control': 'no-store',
    },
  })
}
