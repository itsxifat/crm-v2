/**
 * Print-friendly HTML for a report (opened in a new window and printed).
 * Built from the report data, not the on-screen table, so it is clean on paper.
 */

import { STATUS_META } from '@/lib/inventory/constants'
import { escapeHtml, fmtMoney, fmtNumber, fmtDay } from './format'
import { BENGALI_FONT_CSS } from '@/lib/printFonts'

function cellText(col, value) {
  if (value === null || value === undefined || value === '') return ''
  switch (col.type) {
    case 'money': return fmtMoney(value)
    case 'number': return fmtNumber(value)
    case 'percent': return `${fmtNumber(value)}%`
    case 'date': return fmtDay(value)
    case 'status': return STATUS_META[value]?.label ?? String(value).replace(/_/g, ' ')
    default: return String(value)
  }
}

const isNum = (col) => ['money', 'number', 'percent'].includes(col.type)

function totalsRow(cls, label, columns, totals) {
  const cells = columns.map((c, i) => {
    const has = totals && Object.prototype.hasOwnProperty.call(totals, c.key) && totals[c.key] !== null
    const content = has ? escapeHtml(cellText(c, totals[c.key])) : (i === 0 ? escapeHtml(label) : '')
    return `<td class="${isNum(c) ? 'num' : ''}">${content}</td>`
  }).join('')
  return `<tr class="${cls}">${cells}</tr>`
}

function sectionHtml(s) {
  const head = `<tr>${s.columns.map(c => `<th class="${isNum(c) ? 'num' : ''}">${escapeHtml(c.label)}</th>`).join('')}</tr>`
  const row = (r) => `<tr>${s.columns.map(c => `<td class="${isNum(c) ? 'num' : ''}${c.type === 'tag' ? ' mono' : ''}">${escapeHtml(cellText(c, r[c.key]))}</td>`).join('')}</tr>`
  let body = ''
  if (Array.isArray(s.groups)) {
    for (const g of s.groups) {
      body += `<tr class="group"><td colspan="${s.columns.length}">${escapeHtml(g.label)}${g.sublabel ? ` <span class="sub">${escapeHtml(g.sublabel)}</span>` : ''}</td></tr>`
      body += g.rows.map(row).join('')
      if (g.totals && Object.values(g.totals).some(v => v !== null)) body += totalsRow('subtotal', 'Subtotal', s.columns, g.totals)
    }
  } else {
    body += (s.rows || []).map(row).join('')
  }
  if (s.totals && Object.keys(s.totals).length && Object.values(s.totals).some(v => v !== null)) {
    body += totalsRow('total', 'Total', s.columns, s.totals)
  }
  if (!body) body = `<tr><td colspan="${s.columns.length}" class="empty">No records</td></tr>`
  return `
    ${s.title ? `<h2>${escapeHtml(s.title)}</h2>` : ''}
    ${s.description ? `<p class="desc">${escapeHtml(s.description)}</p>` : ''}
    <table><thead>${head}</thead><tbody>${body}</tbody></table>`
}

export function reportPrintHtml(report, { companyName = '', filtersText = '' } = {}) {
  const wide = Math.max(...report.sections.map(s => s.columns.length)) > 8
  const summary = (report.summary || []).map(x => `
    <div class="kpi"><div class="kl">${escapeHtml(x.label)}</div><div class="kv">${escapeHtml(x.type === 'money' ? `Tk ${fmtMoney(x.value)}` : fmtNumber(x.value))}</div></div>`).join('')
  const warnings = (report.warnings || []).map(w => `<li>${escapeHtml(w)}</li>`).join('')
  const notes = (report.notes || []).map(n => `<li>${escapeHtml(n)}</li>`).join('')
  const generated = new Date(report.generatedAt)
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8" />
<title>${escapeHtml(report.title)}</title>
<style>
  @page { size: A4 ${wide ? 'landscape' : 'portrait'}; margin: 12mm; }
  * { box-sizing: border-box; }
  ${BENGALI_FONT_CSS}
  body { font-family: 'Inter', 'Segoe UI', Arial, var(--font-bengali), sans-serif; color: #111827; font-size: 10px; margin: 0; }
  header { border-bottom: 2px solid #111827; padding-bottom: 6px; margin-bottom: 10px; }
  .company { font-size: 11px; font-weight: 600; color: #374151; }
  h1 { font-size: 16px; margin: 2px 0 0; }
  .meta { color: #4b5563; margin-top: 2px; }
  h2 { font-size: 12px; margin: 14px 0 4px; }
  .desc { color: #6b7280; margin: 0 0 4px; }
  .kpis { display: flex; flex-wrap: wrap; gap: 8px; margin: 8px 0; }
  .kpi { border: 1px solid #e5e7eb; border-radius: 6px; padding: 4px 8px; min-width: 110px; }
  .kl { color: #6b7280; font-size: 9px; } .kv { font-weight: 700; font-size: 11px; }
  table { width: 100%; border-collapse: collapse; margin-bottom: 8px; }
  th, td { border: 1px solid #e5e7eb; padding: 3px 5px; vertical-align: top; text-align: left; }
  th { background: #f3f4f6; font-weight: 600; font-size: 9px; text-transform: uppercase; letter-spacing: .02em; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .mono { font-family: Consolas, 'Courier New', monospace; white-space: nowrap; }
  tr.group td { background: #f9fafb; font-weight: 600; }
  tr.group .sub { font-weight: 400; color: #6b7280; }
  tr.subtotal td { font-weight: 600; background: #fcfcfd; }
  tr.total td { font-weight: 700; border-top: 2px solid #111827; }
  td.empty { text-align: center; color: #9ca3af; padding: 10px; }
  thead { display: table-header-group; } tr { page-break-inside: avoid; }
  ul { margin: 4px 0 0 16px; padding: 0; } li { margin: 2px 0; }
  .warn { color: #92400e; } .notes { color: #4b5563; }
  footer { margin-top: 10px; color: #9ca3af; font-size: 9px; }
</style></head>
<body>
<header>
  ${companyName ? `<div class="company">${escapeHtml(companyName)}</div>` : ''}
  <h1>${escapeHtml(report.title)}</h1>
  <div class="meta">${escapeHtml([report.range?.label, filtersText].filter(Boolean).join(' · '))}</div>
</header>
${summary ? `<div class="kpis">${summary}</div>` : ''}
${report.sections.map(sectionHtml).join('')}
${warnings ? `<div class="warn"><strong>Check:</strong><ul>${warnings}</ul></div>` : ''}
${notes ? `<div class="notes"><strong>Notes:</strong><ul>${notes}</ul></div>` : ''}
<footer>Generated ${escapeHtml(fmtDay(generated))} ${escapeHtml(generated.toTimeString().slice(0, 5))} · Amounts in BDT</footer>
</body></html>`
}
