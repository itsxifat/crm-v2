/**
 * Client-side CSV/TSV parsing for the opening-register import (pure).
 * Handles quotes, escaped quotes, CRLF, a UTF-8 BOM and text pasted from a
 * spreadsheet (tab separated).
 */

/** Pick the delimiter that appears most often (outside quotes) in the first line. */
function detectDelimiter(text) {
  const firstLine = []
  let inQuotes = false
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes
    else if ((ch === '\n' || ch === '\r') && !inQuotes) break
    firstLine.push(ch)
  }
  const line = firstLine.join('')
  const counts = [',', '\t', ';'].map(d => [d, line.split(d).length - 1])
  counts.sort((a, b) => b[1] - a[1])
  return counts[0][1] > 0 ? counts[0][0] : ','
}

/** Text → array of rows (arrays of trimmed cells), blank lines dropped. */
export function parseDelimited(input) {
  const text = String(input ?? '').replace(/^﻿/, '')
  if (!text.trim()) return []
  const delim = detectDelimiter(text)
  const rows = []
  let row = []
  let cell = ''
  let inQuotes = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ } else inQuotes = false
      } else {
        cell += ch
      }
      continue
    }
    if (ch === '"' && cell.trim() === '') { cell = ''; inQuotes = true; continue }
    if (ch === delim) { row.push(cell.trim()); cell = ''; continue }
    if (ch === '\r') continue
    if (ch === '\n') { row.push(cell.trim()); rows.push(row); row = []; cell = ''; continue }
    cell += ch
  }
  row.push(cell.trim())
  rows.push(row)
  return rows.filter(r => r.some(c => c !== ''))
}

const norm = (h) => String(h ?? '').toLowerCase().replace(/[^a-z0-9]/g, '')

export const ASSET_FIELDS = [
  { key: 'name', label: 'name', required: true, aliases: ['name', 'assetname', 'asset', 'item', 'itemname'] },
  { key: 'categoryCode', label: 'categoryCode', required: true, aliases: ['categorycode', 'category', 'cat', 'catcode'] },
  { key: 'brand', label: 'brand', aliases: ['brand', 'make', 'manufacturer'] },
  { key: 'model', label: 'model', aliases: ['model', 'modelno'] },
  { key: 'serialNumber', label: 'serialNumber', aliases: ['serialnumber', 'serial', 'serialno', 'sn', 'imei'] },
  { key: 'purchaseDate', label: 'purchaseDate', aliases: ['purchasedate', 'purchasedon', 'acquired', 'acquisitiondate', 'dateofpurchase', 'date'] },
  { key: 'cost', label: 'cost', required: true, aliases: ['cost', 'purchasecost', 'originalcost', 'value', 'price', 'amount'] },
  { key: 'accumulatedDepreciation', label: 'accumulatedDepreciation', aliases: ['accumulateddepreciation', 'accumulated', 'accumdep', 'accdep', 'accumdepreciation', 'depreciation'] },
  { key: 'taxWdv', label: 'taxWdv', aliases: ['taxwdv', 'wdv', 'taxwrittendownvalue', 'writtendownvalue'] },
  { key: 'taxWdvFiscalYear', label: 'taxWdvFiscalYear', aliases: ['taxwdvfiscalyear', 'taxwdvyear', 'wdvyear', 'incomeyear', 'taxyear'] },
  { key: 'locationCode', label: 'locationCode', aliases: ['locationcode', 'location', 'loc'] },
  { key: 'employeeEmployeeId', label: 'employeeEmployeeId', aliases: ['employeeemployeeid', 'employeeid', 'empid', 'staffid', 'employee', 'assignedto'] },
  { key: 'condition', label: 'condition', aliases: ['condition', 'state'] },
  { key: 'warrantyExpiry', label: 'warrantyExpiry', aliases: ['warrantyexpiry', 'warranty', 'warrantyend', 'warrantyuntil', 'warrantyenddate'] },
  { key: 'capitalized', label: 'capitalized', aliases: ['capitalized', 'capitalised', 'capitalize', 'capitalise'] },
  { key: 'notes', label: 'notes', aliases: ['notes', 'note', 'remarks', 'comment', 'comments'] },
]

export const STOCK_FIELDS = [
  { key: 'sku', label: 'sku', aliases: ['sku', 'itemcode', 'code'] },
  { key: 'name', label: 'name', required: true, aliases: ['name', 'item', 'itemname', 'description'] },
  { key: 'categoryCode', label: 'categoryCode', aliases: ['categorycode', 'category', 'cat'] },
  { key: 'unit', label: 'unit', aliases: ['unit', 'uom'] },
  { key: 'qty', label: 'qty', required: true, aliases: ['qty', 'quantity', 'onhand', 'stock'] },
  { key: 'unitCost', label: 'unitCost', required: true, aliases: ['unitcost', 'cost', 'rate', 'price', 'avgcost', 'averagecost'] },
  { key: 'locationCode', label: 'locationCode', aliases: ['locationcode', 'location'] },
  { key: 'reorderLevel', label: 'reorderLevel', aliases: ['reorderlevel', 'reorder', 'minqty', 'minimum'] },
]

/**
 * Rows (first row = headers) → { records: [{...}], mapped: [{ header, key }], ignored: [header], missing: [key] }.
 */
export function mapRecords(rows, fields) {
  if (!rows.length) return { records: [], mapped: [], ignored: [], missing: fields.filter(f => f.required).map(f => f.key) }
  const headers = rows[0]
  const used = new Set()
  const colKey = headers.map(h => {
    const n = norm(h)
    const f = fields.find(x => !used.has(x.key) && x.aliases.includes(n))
    if (f) used.add(f.key)
    return f ? f.key : null
  })
  const records = rows.slice(1).map(r => {
    const rec = {}
    colKey.forEach((k, i) => { if (k) rec[k] = r[i] ?? '' })
    return rec
  })
  return {
    records,
    mapped: headers.map((h, i) => ({ header: h, key: colKey[i] })).filter(m => m.key),
    ignored: headers.filter((h, i) => !colKey[i] && String(h).trim()),
    missing: fields.filter(f => f.required && !used.has(f.key)).map(f => f.key),
  }
}

function csvEscape(v) {
  const s = String(v ?? '')
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function toCsv(rows) {
  return '﻿' + rows.map(r => r.map(csvEscape).join(',')).join('\r\n') + '\r\n'
}

export function downloadText(filename, text, type = 'text/csv;charset=utf-8') {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

export function assetTemplate({ taxFy = '2026-27' } = {}) {
  return toCsv([
    ASSET_FIELDS.map(f => f.label),
    ['Dell Latitude 5440', 'LAP', 'Dell', 'Latitude 5440', 'CN0X1234', '2025-03-10', '150000', '45000', '112500', taxFy, 'HQ-2F', 'EMP-001', 'GOOD', '2027-03-09', '', 'Opening register'],
    ['Office chair (ergonomic)', 'FUR', '', '', '', '15/08/2024', '18000', '3000', '', '', 'HQ-2F', '', 'GOOD', '', '', ''],
  ])
}

export function stockTemplate() {
  return toCsv([
    STOCK_FIELDS.map(f => f.label),
    ['', 'A4 paper (80 gsm)', 'STA', 'ream', '25', '420', 'STORE', '10'],
    ['', 'Toner HP 26A', 'TON', 'pcs', '4', '6500', 'STORE', '2'],
  ])
}
