/**
 * CSV and HTML renderings of a built register (see ./registers.js).
 */
import { escapeHtml, fmtDay, fmtMoney, fmtQty, fmtDateTime, companyBlock } from './printShell'

// ── CSV ──────────────────────────────────────────────────────────────────────

/**
 * One CSV cell: money with 2 decimals, quantities as plain numbers, text quoted
 * when it holds a comma, quote, line break or edge whitespace (quotes doubled).
 * Text starting with = + - @ (or a tab / CR) is prefixed with ' so spreadsheets
 * never evaluate it as a formula.
 */
export function csvCell(value, type = 'text') {
  if (value === null || value === undefined || value === '') return ''
  let s
  if (type === 'money') {
    const n = Number(value)
    if (!Number.isFinite(n)) return ''
    s = (Math.round((n + Number.EPSILON) * 100) / 100).toFixed(2)
  } else if (type === 'qty' || type === 'serial') {
    const n = Number(value)
    s = Number.isFinite(n) ? String(n) : String(value)
  } else {
    s = String(value)
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  }
  if (/[",\r\n]/.test(s) || /^\s|\s$/.test(s)) s = `"${s.replace(/"/g, '""')}"`
  return s
}

function headerLabel(col) {
  return col.no ? `(${col.no}) ${col.label}` : col.label
}

/** Full CSV text (UTF-8 BOM, CRLF) in official column order, with a totals row. */
export function registerCsv(reg) {
  const cols = reg.columns
  const lines = [cols.map(c => csvCell(headerLabel(c))).join(',')]
  const rowLine = (r) => cols.map(c => csvCell(r[c.key], c.type)).join(',')
  const totalLine = (totals, label, extra = {}) => cols.map((c, i) => {
    if (c.total) return csvCell(totals[c.key], 'money')
    if (extra[c.key] !== undefined) return csvCell(extra[c.key])
    return i === cols.findIndex(x => x.type === 'serial') ? csvCell(label) : ''
  }).join(',')

  if (reg.type === 'disclosure') {
    for (const part of ['A', 'B']) {
      const rows = reg.rows.filter(r => r.part === part)
      rows.forEach(r => lines.push(rowLine(r)))
      lines.push(totalLine(reg.totals?.[part] ?? {}, 'Total', { part }))
    }
  } else {
    reg.rows.forEach(r => lines.push(rowLine(r)))
    if (reg.rows.length) lines.push(totalLine(reg.totals ?? {}, 'Total'))
  }
  return `﻿${lines.join('\r\n')}\r\n`
}

export function registerFilename(reg, ext) {
  const form = reg.form ? reg.form.toLowerCase().replace(/[^a-z0-9.]+/g, '-') : reg.type
  return `${form}_${reg.type}-register_${reg.start}_${reg.end}.${ext}`
}

// ── HTML print ───────────────────────────────────────────────────────────────

const e = escapeHtml

function cellHtml(value, type) {
  if (type === 'money') return fmtMoney(value)
  if (type === 'qty') return fmtQty(value)
  if (type === 'date') return e(fmtDay(value))
  return e(value ?? '')
}

function cls(type) {
  if (type === 'money' || type === 'qty') return 'r'
  if (type === 'serial') return 'c'
  return ''
}

function table(columns, rows, totals, { numbered, emptyText }) {
  const head = `
    <tr>${columns.map(c => `<th class="${c.type === 'money' ? 'r' : ''}">${e(c.label)}</th>`).join('')}</tr>
    ${numbered ? `<tr class="colno">${columns.map(c => `<th>${c.no ?? ''}</th>`).join('')}</tr>` : ''}`
  const body = rows.length
    ? rows.map(r => `<tr>${columns.map(c => `<td class="${cls(c.type)}">${cellHtml(r[c.key], c.type)}</td>`).join('')}</tr>`).join('')
    : `<tr><td colspan="${columns.length}" class="empty">${e(emptyText)}</td></tr>`
  const hasTotals = rows.length && columns.some(c => c.total)
  const foot = hasTotals
    ? `<tr class="total">${columns.map((c, i) => {
        if (c.total) return `<td class="r">${fmtMoney(totals?.[c.key] ?? 0)}</td>`
        return i === 0 ? '<td>Total</td>' : '<td></td>'
      }).join('')}</tr>`
    : ''
  return `<table><thead>${head}</thead><tbody>${body}${foot}</tbody></table>`
}

/**
 * Printable register body.
 * @param {object} reg      buildRegister() result
 * @param {object} company  getCompanyProfile()
 * @param {{ showStock?: boolean }} opts  stock columns (blank for services) are dropped unless showStock
 */
export function registerPrintBody(reg, company, { showStock = false } = {}) {
  const columns = reg.columns.filter(c => c.key !== 'part' && (showStock || !c.stock))
  const title = reg.form ? `${reg.formBn ? `${e(reg.formBn)} · ` : ''}${e(reg.form)}` : 'Register'

  let content
  if (reg.type === 'disclosure') {
    content = ['A', 'B'].map(part => {
      const meta = reg.parts?.[part] ?? { title: `Part ${part}`, partyLabel: part === 'A' ? 'Seller' : 'Buyer' }
      const cols = columns.map(c => (['partyName', 'partyAddress', 'partyBin'].includes(c.key)
        ? { ...c, label: `${meta.partyLabel} ${c.key === 'partyBin' ? 'BIN / NID' : c.label.toLowerCase()}` }
        : c))
      return `<h2>${e(meta.title)}</h2>${table(cols, reg.rows.filter(r => r.part === part), reg.totals?.[part], {
        numbered: reg.numbered, emptyText: `No ${part === 'A' ? 'purchases' : 'sales'} above Tk 2,00,000 in this period`,
      })}`
    }).join('')
  } else {
    content = table(columns, reg.rows, reg.totals, { numbered: reg.numbered, emptyText: 'No entries in this period' })
  }

  const stockNote = !showStock && reg.columns.some(c => c.stock)
    ? `<p class="note">Stock columns (${reg.columns.filter(c => c.stock).map(c => c.no).join(', ')}) are not applicable to services and are left blank.</p>`
    : ''

  return `
  <div class="head">
    ${companyBlock(company)}
    <div class="form-id">
      <p class="form-no">${title}</p>
      <p class="form-title">${e(reg.title)}</p>
      <p class="form-sub">${e(reg.rule)}</p>
      <p class="form-sub">Period: <strong>${e(reg.label)}</strong> (${e(fmtDay(reg.start))} – ${e(fmtDay(reg.end))})</p>
    </div>
  </div>
  ${content}
  ${stockNote}
  ${reg.truncated ? '<p class="note warn">Only the first 10,000 rows are shown — print a shorter period.</p>' : ''}
  <div class="sign">
    <div>Name of responsible person: <strong>${e(company?.signatoryName || '')}</strong></div>
    <div>Designation: <strong>${e(company?.signatoryDesignation || '')}</strong></div>
    <div>Signature &amp; date</div>
  </div>
  <div class="foot">Generated from the CRM tax ledger on ${e(fmtDateTime(new Date()))}. Keep VAT records for 5 years (VAT &amp; SD Act 2012).</div>`
}
