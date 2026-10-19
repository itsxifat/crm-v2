/**
 * Pure purchase-bill maths and form-state helpers shared by the bill form,
 * the receive dialog and the detail view. Mirrors the server rules in
 * app/api/inventory/purchases/_lib/purchases.js (the server recomputes and wins).
 */

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
export const round4 = (n) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000
export const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const blank = (v) => v === undefined || v === null || v === ''

/** ৳ 1,234.50 (2 decimals) */
export function tk(n, decimals = 2) {
  return `৳ ${num(n).toLocaleString('en-BD', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })}`
}

/** Plain number for qty display (up to 4 decimals). */
export function qtyText(n) {
  return num(n).toLocaleString('en-BD', { maximumFractionDigits: 4 })
}

let _seq = 0
export const tempKey = () => `l${Date.now().toString(36)}${(++_seq).toString(36)}`

export function emptyLine(lineType = 'ASSET', patch = {}) {
  return {
    key: tempKey(),
    id: null,
    lineType,
    categoryId: '',
    stockItemId: '',
    description: '',
    brand: '',
    model: '',
    qty: 1,
    unit: lineType === 'ASSET' ? 'pcs' : 'pcs',
    unitPrice: '',
    vatRate: '',
    vatAmount: '',          // '' ⇒ computed from the rate
    sdAmount: '',
    capitalize: null,       // null ⇒ category policy + threshold
    serialText: '',
    locationId: '',
    assignee: null,         // PeoplePicker person { id, name, … }
    warrantyMonths: '',
    expanded: false,
    ...patch,
  }
}

export function serialsOf(line) {
  return String(line.serialText ?? '').split(/[\r\n,]+/).map(s => s.trim()).filter(Boolean)
}

/** { base, vatAmount, sdAmount, lineTotal, vatComputed } for a form line. */
export function computeLine(line) {
  const base = round2(num(line.qty) * num(line.unitPrice))
  const sdAmount = round2(num(line.sdAmount))
  // VAT is charged on the SD-inclusive value (same as the server and lib/invoiceTotals).
  const vatComputed = round2((base + sdAmount) * num(line.vatRate) / 100)
  const vatAmount = blank(line.vatAmount) ? vatComputed : round2(num(line.vatAmount))
  return { base, vatAmount, sdAmount, vatComputed, lineTotal: round2(base + vatAmount + sdAmount) }
}

export function computeTotals(lines, otherCosts, { tdsAmount = 0, vdsAmount = 0 } = {}) {
  let subtotal = 0
  let vatTotal = 0
  let sdTotal = 0
  for (const l of lines) {
    const c = computeLine(l)
    subtotal += c.base
    vatTotal += c.vatAmount
    sdTotal += c.sdAmount
  }
  subtotal = round2(subtotal)
  vatTotal = round2(vatTotal)
  sdTotal = round2(sdTotal)
  const other = round2(num(otherCosts))
  const total = round2(subtotal + vatTotal + sdTotal + other)
  const withheld = round2(num(tdsAmount) + num(vdsAmount))
  return {
    subtotal, vatTotal, sdTotal, otherCosts: other, total,
    taxableBase: round2(total - vatTotal),
    withheld,
    netPayable: round2(total - withheld),
  }
}

/** Other costs shared over goods lines pro rata to value (whole paisa), like the server. */
export function allocateOtherCosts(lines, otherCosts) {
  const out = lines.map(() => 0)
  const cents = Math.round(round2(num(otherCosts)) * 100)
  if (cents <= 0) return out
  const goods = lines
    .map((l, i) => ({ i, base: l.lineType === 'EXPENSE' ? 0 : round2(num(l.qty) * num(l.unitPrice)) }))
    .filter(g => g.base > 0)
  const sum = goods.reduce((s, g) => s + g.base, 0)
  if (!(sum > 0)) return out
  let used = 0
  goods.forEach((g, k) => {
    const share = k === goods.length - 1 ? cents - used : Math.floor((cents * g.base) / sum)
    used += share
    out[g.i] = share / 100
  })
  return out
}

/** Cost of one unit as it will be booked (unit price + non-creditable VAT + SD + share of other costs). */
export function unitCostOf(line, { vatCreditable, otherShare }) {
  const qty = num(line.qty) || 1
  const c = computeLine(line)
  const vat = vatCreditable ? 0 : c.vatAmount
  return round2(num(line.unitPrice) + (vat + c.sdAmount + num(otherShare)) / qty)
}

/** Detail (API) bill → form state. */
export function billToForm(bill) {
  return {
    vendor: bill.vendor ?? null,
    vendorName: bill.vendorName ?? '',
    supplierBin: bill.supplierBin ?? '',
    supplierVatType: bill.supplierVatType ?? 'REGISTERED',
    supplierInvoiceNo: bill.supplierInvoiceNo ?? '',
    mushakNo: bill.mushakNo ?? '',
    mushakDate: bill.mushakDay ?? null,
    billDate: bill.billDay ?? null,
    otherCosts: bill.otherCosts ? String(bill.otherCosts) : '',
    vatCreditable: Boolean(bill.vatCreditable),
    vatCreditableTouched: true,
    bankingChannel: true,
    withholding: {
      tdsSection: bill.tds?.section ?? null,
      tdsRate: bill.tds?.rate ?? null,
      tdsAmount: num(bill.tds?.amount),
      vatServiceCode: bill.vds?.serviceCode ?? null,
      vdsRate: bill.vds?.rate ?? null,
      vdsAmount: num(bill.vds?.amount),
      higherRateApplied: Boolean(bill.tds?.higherRateApplied),
    },
    attachments: bill.attachments ?? [],
    notes: bill.notes ?? '',
    lines: (bill.lines ?? []).map(l => emptyLine(l.lineType, {
      id: l.id ?? null,
      categoryId: l.categoryId ?? '',
      stockItemId: l.stockItemId ?? '',
      description: l.description ?? '',
      brand: l.brand ?? '',
      model: l.model ?? '',
      qty: l.qty ?? 1,
      unit: l.unit ?? 'pcs',
      unitPrice: l.unitPrice ?? '',
      vatRate: l.vatRate ? String(l.vatRate) : '',
      // Keep a supplier-entered VAT amount only when it differs from the computed one.
      vatAmount: Math.abs(round2((round2(num(l.qty) * num(l.unitPrice)) + round2(num(l.sdAmount))) * num(l.vatRate) / 100) - num(l.vatAmount)) >= 0.005 ? String(l.vatAmount) : '',
      sdAmount: l.sdAmount ? String(l.sdAmount) : '',
      capitalize: typeof l.capitalize === 'boolean' ? l.capitalize : null,
      serialText: (l.serialNumbers ?? []).join('\n'),
      locationId: l.locationId ?? '',
      assignee: l.assignEmployee ?? null,
      warrantyMonths: l.warrantyMonths ?? '',
    })),
  }
}

/** Form state → API body. */
export function formToPayload(form) {
  return {
    vendorId: form.vendor?.id ?? null,
    vendorName: form.vendorName?.trim() || form.vendor?.company || null,
    supplierBin: form.supplierBin?.trim() || null,
    supplierVatType: form.supplierVatType || 'REGISTERED',
    supplierInvoiceNo: form.supplierInvoiceNo?.trim() || null,
    mushakNo: form.mushakNo?.trim() || null,
    mushakDate: form.mushakDate || null,
    billDate: form.billDate || null,
    currency: 'BDT',
    otherCosts: num(form.otherCosts),
    vatCreditable: Boolean(form.vatCreditable),
    tds: {
      section: form.withholding?.tdsSection ?? null,
      rate: form.withholding?.tdsRate ?? null,
      amount: num(form.withholding?.tdsAmount),
      higherRateApplied: Boolean(form.withholding?.higherRateApplied),
    },
    vds: {
      serviceCode: form.withholding?.vatServiceCode ?? null,
      rate: form.withholding?.vdsRate ?? null,
      amount: num(form.withholding?.vdsAmount),
    },
    attachments: form.attachments ?? [],
    notes: form.notes?.trim() || null,
    lines: form.lines.map(l => ({
      ...(l.id ? { id: l.id } : {}),
      lineType: l.lineType,
      categoryId: l.categoryId || null,
      stockItemId: l.lineType === 'CONSUMABLE' ? (l.stockItemId || null) : null,
      description: l.description,
      brand: l.lineType === 'ASSET' ? (l.brand || null) : null,
      model: l.lineType === 'ASSET' ? (l.model || null) : null,
      qty: num(l.qty),
      unit: l.unit || null,
      unitPrice: num(l.unitPrice),
      vatRate: num(l.vatRate),
      vatAmount: blank(l.vatAmount) ? null : num(l.vatAmount),
      sdAmount: num(l.sdAmount),
      capitalize: l.lineType === 'ASSET' ? l.capitalize : null,
      serialNumbers: l.lineType === 'ASSET' ? serialsOf(l) : [],
      locationId: l.lineType === 'EXPENSE' ? null : (l.locationId || null),
      assignEmployeeId: l.lineType === 'ASSET' ? (l.assignee?.id ?? null) : null,
      warrantyMonths: l.lineType === 'ASSET' && !blank(l.warrantyMonths) ? num(l.warrantyMonths) : null,
    })),
  }
}

/** Problems that block saving, per line (client-side, before the server says so). */
export function lineProblems(line) {
  const out = []
  if (!String(line.description ?? '').trim()) out.push('Description is required')
  if (!(num(line.qty) > 0)) out.push('Quantity must be more than 0')
  if (line.lineType === 'ASSET') {
    if (!line.categoryId) out.push('Choose the asset category')
    if (!Number.isInteger(num(line.qty))) out.push('Asset quantity must be a whole number')
    const serials = serialsOf(line)
    if (serials.length > num(line.qty)) out.push(`${serials.length} serial numbers for ${num(line.qty)} units`)
  }
  if (line.lineType === 'CONSUMABLE' && !line.categoryId && !line.stockItemId) out.push('Choose the category or stock item')
  if (blank(line.unitPrice) || num(line.unitPrice) < 0) out.push('Enter the unit price')
  return out
}
