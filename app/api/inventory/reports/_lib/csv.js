/**
 * CSV export for inventory reports (RFC 4180 quoting + spreadsheet formula
 * guard). The output starts with a UTF-8 BOM so Excel shows ৳ and Bangla text.
 */

import { STATUS_META } from '@/lib/inventory/constants'
import { dhakaDayKey } from '@/lib/dhakaTime'

const FORMULA_START = /^[=+\-@\t\r]/

/** One CSV cell. Numbers stay numeric; text is quoted when needed and guarded against formulas. */
export function csvCell(value) {
  if (value === null || value === undefined) return ''
  if (typeof value === 'number') return Number.isFinite(value) ? String(value) : ''
  if (typeof value === 'boolean') return value ? 'Yes' : 'No'
  let s = String(value)
  if (FORMULA_START.test(s)) s = `'${s}`
  if (/[",\r\n]/.test(s) || /^\s|\s$/.test(s)) s = `"${s.replace(/"/g, '""')}"`
  return s
}

export function csvLine(cells) {
  return cells.map(csvCell).join(',')
}

function cellValue(col, value) {
  if (value === null || value === undefined || value === '') return null
  switch (col.type) {
    case 'money': {
      const n = Number(value)
      return Number.isFinite(n) ? Number(n.toFixed(2)) : null
    }
    case 'number':
    case 'percent': {
      const n = Number(value)
      return Number.isFinite(n) ? n : null
    }
    case 'status':
      return STATUS_META[value]?.label ?? String(value).replace(/_/g, ' ')
    default:
      return String(value)
  }
}

/** Whole report ⇒ CSV text (with BOM). */
export function reportToCsv(report) {
  const lines = []
  lines.push(csvLine([report.title]))
  if (report.range?.label) lines.push(csvLine([`Period: ${report.range.label}`]))
  lines.push(csvLine([`Generated: ${new Date(report.generatedAt).toISOString().replace('T', ' ').slice(0, 16)} UTC`]))
  lines.push('')

  for (const s of report.sections) {
    const grouped = Array.isArray(s.groups)
    if (s.title) lines.push(csvLine([s.title]))
    const header = s.columns.map(c => (c.type === 'money' ? `${c.label} (BDT)` : c.label))
    lines.push(csvLine(grouped ? ['Group', ...header] : header))
    const rowCells = (r) => s.columns.map(c => cellValue(c, r[c.key]))
    const totalCells = (t) => s.columns.map((c, i) => {
      if (i === 0 && !grouped) return 'Total'
      return t && Object.prototype.hasOwnProperty.call(t, c.key) ? cellValue(c, t[c.key]) : null
    })
    if (grouped) {
      for (const g of s.groups) {
        for (const r of g.rows) lines.push(csvLine([g.label, ...rowCells(r)]))
        if (g.totals && Object.keys(g.totals).length) {
          lines.push(csvLine([`Subtotal — ${g.label}`, ...s.columns.map(c => (Object.prototype.hasOwnProperty.call(g.totals, c.key) ? cellValue(c, g.totals[c.key]) : null))]))
        }
      }
      if (s.totals && Object.keys(s.totals).length) {
        lines.push(csvLine(['Total', ...s.columns.map(c => (Object.prototype.hasOwnProperty.call(s.totals, c.key) ? cellValue(c, s.totals[c.key]) : null))]))
      }
    } else {
      for (const r of s.rows) lines.push(csvLine(rowCells(r)))
      if (s.totals && Object.keys(s.totals).length) lines.push(csvLine(totalCells(s.totals)))
    }
    lines.push('')
  }

  for (const w of report.warnings || []) lines.push(csvLine([`Warning: ${w}`]))
  for (const n of report.notes || []) lines.push(csvLine([`Note: ${n}`]))
  return '﻿' + lines.join('\r\n') + '\r\n'
}

/** Safe file name: inventory-<type>-<range>.csv */
export function reportFileName(report) {
  const part = report.range?.fy ? `FY${report.range.fy}`
    : report.range?.startDay ? `${report.range.startDay}_to_${report.range.endDay}`
    : dhakaDayKey(new Date(report.generatedAt))
  return `inventory-${report.type}-${part}.csv`.replace(/[^A-Za-z0-9._-]+/g, '-')
}
