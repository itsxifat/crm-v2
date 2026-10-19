/**
 * lib/quotation.js — quotation line / total calculation, validation and the
 * display helpers shared by the quotation pages and the quotation API.
 *
 * PURE module: the quotation pages import it in the browser for live totals, so
 * it must never import server code. It reaches lib/invoiceTotals.js through a
 * relative path (no '@/' alias) so plain Node scripts can load it as well.
 *
 * The server-only pieces that used to live here (QUOTATION_POPULATE and
 * quotationJSON, which need lib/pii → lib/rbac) are in
 * app/api/quotations/_lib/server.js.
 *
 * Money model — identical to invoices (lib/invoiceTotals.js does the maths):
 *   amount        = quantity × rate                         (per line)
 *   subtotal      = Σ amount
 *   discount      = flat amount, shared pro-rata across the lines by amount
 *   taxableValue  = amount − discountShare                   (per line, VAT base)
 *   sdAmount      = taxableValue × sdRate%                   (supplementary duty)
 *   vatAmount     = (taxableValue + sdAmount) × vatRate%
 *   taxAmount     = subtotal × taxRate%  — the "MFS Charge" (mobile-payment
 *                   surcharge). It is NOT VAT; formula unchanged.
 *   total         = subtotal − discount + Σ sdAmount + Σ vatAmount + taxAmount
 *
 * Backward compatibility
 * ──────────────────────
 * Without `vatTreatment` (or with 'NONE') computeQuotation returns exactly what
 * the pre-VAT implementation returned — same item shape
 * ({ description, venture, service_category, service, quantity, rate, amount }),
 * same numbers, same rounding and the same validation (a blank rate is 0; the
 * discount may not exceed subtotal + MFS charge) — plus the new top-level VAT
 * fields (vatTreatment 'NONE', vatAmount 0, sdAmount 0, taxableValue).
 * The only wording change is the MFS-charge range message.
 */

import {
  computeInvoiceTotals,
  previewInvoiceTotals,
  isVatInvoice,
  taxableValueOf,
  invoiceVatLabel,
  uniformVatRate,
  INVOICE_VAT_TREATMENTS,
} from './invoiceTotals.js'

export { uniformVatRate }

/** Treatments a quotation may carry (same as invoices). */
export const QUOTATION_VAT_TREATMENTS = INVOICE_VAT_TREATMENTS

/** Treatments whose lines carry a VAT rate. */
export const RATED_TREATMENTS = ['STANDARD', 'REDUCED']

const MFS_RANGE_ERROR = 'MFS charge must be between 0 and 100%'

// Rounding used by the pre-VAT implementation (kept for its fields).
const legacyRound = (n) => Math.round(n * 100) / 100

const blank = (v) => v === '' || v === null || v === undefined

/** 'standard' / ' STANDARD ' → 'STANDARD'; blank → 'NONE'. */
export function normaliseVatTreatment(v) {
  if (blank(v)) return 'NONE'
  return String(v).trim().toUpperCase() || 'NONE'
}

/** True when a quotation is a VAT quotation or carries any VAT / SD. */
export function isVatQuotation(q) {
  return isVatInvoice(q)
}

/** Taxable value (VAT base) with the legacy fallback subtotal − discount. */
export function quotationTaxableValue(q) {
  return taxableValueOf(q)
}

/** Label for the VAT totals row: "VAT (15%)", "VAT (zero-rated)", "VAT (exempt)" or "VAT". */
export function quotationVatLabel(q) {
  return invoiceVatLabel(q)
}

/** Line amount for display: the stored amount, else quantity × rate. */
export function quotationLineAmount(item) {
  const stored = Number(item?.amount)
  if (item?.amount !== undefined && item?.amount !== null && item?.amount !== '' && Number.isFinite(stored)) return stored
  return legacyRound((Number(item?.quantity) || 0) * (Number(item?.rate) || 0))
}

// Invoice-worded messages from lib/invoiceTotals → quotation wording.
function quotationMessage(msg) {
  if (msg === 'Discount must be between 0 and the invoice subtotal') return 'Discount cannot exceed the quotation total'
  return msg
}

/**
 * Legacy line rules: an object, quantity > 0, rate >= 0 with a blank rate
 * meaning 0. Returns { error } or { line } in the stored quotation shape.
 */
function legacyLine(item) {
  if (!item || typeof item !== 'object') return { error: 'Invalid item' }
  const quantity = Number(item.quantity)
  const rate     = item.rate === '' || item.rate == null ? 0 : Number(item.rate)
  if (!Number.isFinite(quantity) || quantity <= 0) return { error: 'Item quantity must be greater than 0' }
  if (!Number.isFinite(rate) || rate < 0)          return { error: 'Item rate cannot be negative' }
  return {
    line: {
      description:      item.description != null ? String(item.description) : '',
      venture:          item.venture || null,
      service_category: item.service_category || null,
      service:          item.service || null,
      quantity,
      rate,
    },
  }
}

/** A quotation line as lib/invoiceTotals expects it (VAT inputs passed through). */
function toCalcItem(line, raw) {
  return {
    description: line.description,
    quantity:    line.quantity,
    rate:        line.rate,
    vatRate:     raw?.vatRate,
    sdRate:      raw?.sdRate,
    serviceCode: raw?.serviceCode,
  }
}

/** Calculated invoice line → stored quotation line. Non-VAT lines keep the legacy shape exactly. */
function toQuotationItem(line, calcLine, isVat) {
  const out = {
    description:      line.description,
    venture:          line.venture,
    service_category: line.service_category,
    service:          line.service,
    quantity:         line.quantity,
    rate:             line.rate,
    amount:           calcLine.amount,
  }
  if (!isVat) return out
  return {
    ...out,
    serviceCode:   calcLine.serviceCode,
    vatRate:       calcLine.vatRate,
    sdRate:        calcLine.sdRate,
    discountShare: calcLine.discountShare,
    taxableValue:  calcLine.taxableValue,
    sdAmount:      calcLine.sdAmount,
    vatAmount:     calcLine.vatAmount,
    lineTotal:     calcLine.lineTotal,
  }
}

/**
 * Validate line items + MFS charge / discount / VAT and compute the totals.
 *
 * @param {object} p
 * @param {Array}  p.items           [{ description, venture?, service_category?, service?, quantity, rate, vatRate?, sdRate?, serviceCode? }]
 * @param {number} p.taxRate         MFS charge % (0–100) — legacy field name
 * @param {number} p.discount        flat discount amount
 * @param {string} p.vatTreatment    'STANDARD'|'REDUCED'|'ZERO_RATED'|'EXEMPT'|'NONE' (default 'NONE')
 * @param {number} p.defaultVatRate  rate for lines without their own vatRate (0–100)
 * @returns {{ error: string } | {
 *   items, subtotal, taxRate, taxAmount, discount, total,
 *   vatTreatment, taxableValue, vatAmount, sdAmount }}
 */
export function computeQuotation({ items, taxRate = 0, discount = 0, vatTreatment = 'NONE', defaultVatRate = 0 } = {}) {
  if (!Array.isArray(items) || !items.length) return { error: 'At least one item required' }

  const lines = []
  for (const item of items) {
    const r = legacyLine(item)
    if (r.error) return { error: r.error }
    lines.push(r.line)
  }

  const tax  = taxRate === '' || taxRate == null ? 0 : Number(taxRate)
  const disc = discount === '' || discount == null ? 0 : Number(discount)
  if (!Number.isFinite(tax) || tax < 0 || tax > 100) return { error: MFS_RANGE_ERROR }
  if (!Number.isFinite(disc) || disc < 0)           return { error: 'Discount cannot be negative' }

  const treatment = normaliseVatTreatment(vatTreatment)
  if (!QUOTATION_VAT_TREATMENTS.includes(treatment)) return { error: 'Invalid VAT treatment' }
  const isVat = treatment !== 'NONE'

  if (!isVat) {
    // Legacy rule, applied exactly as before: discount <= subtotal + MFS charge.
    const subtotal  = legacyRound(lines.reduce((s, l) => s + legacyRound(l.quantity * l.rate), 0))
    const taxAmount = legacyRound(subtotal * (tax / 100))
    if (disc > subtotal + taxAmount) return { error: 'Discount cannot exceed the quotation total' }
  }

  const calc = computeInvoiceTotals({
    items: lines.map((l, i) => toCalcItem(l, items[i])),
    taxRate: tax,
    discount: disc,
    vatTreatment: treatment,
    defaultVatRate: blank(defaultVatRate) ? 0 : defaultVatRate,
  })
  if (calc.error) return { error: quotationMessage(calc.error) }

  return {
    items:        lines.map((l, i) => toQuotationItem(l, calc.items[i], isVat)),
    subtotal:     calc.subtotal,
    taxRate:      calc.taxRate,
    taxAmount:    calc.taxAmount,
    discount:     calc.discount,
    total:        calc.total,
    vatTreatment: calc.vatTreatment,
    taxableValue: calc.taxableValue,
    vatAmount:    calc.vatAmount,
    sdAmount:     calc.sdAmount,
  }
}

/**
 * Lenient variant for live totals in the quotation forms: never fails. Blank
 * or invalid inputs are replaced by safe values and every problem is listed in
 * `issues` (quotation wording). Lines keep the invoice calculator's shape
 * ({ amount, vatRate, taxableValue, vatAmount, sdAmount, lineTotal, … }) so the
 * form can show per-line VAT.
 *
 * @returns {{ items, subtotal, discount, taxableValue, sdAmount, vatAmount, taxRate, taxAmount, total, vatTreatment, issues: string[] }}
 */
export function previewQuotation({ items, taxRate, discount, vatTreatment, defaultVatRate } = {}) {
  const list = Array.isArray(items) ? items : []
  const lines = list.map(item => ({
    description: item?.description,
    quantity:    item?.quantity,
    rate:        blank(item?.rate) ? 0 : item.rate,   // a blank rate means 0 on quotations
    vatRate:     item?.vatRate,
    sdRate:      item?.sdRate,
    serviceCode: item?.serviceCode,
  }))
  const p = previewInvoiceTotals({
    items: lines,
    taxRate,
    discount,
    vatTreatment: normaliseVatTreatment(vatTreatment),
    defaultVatRate: blank(defaultVatRate) ? 0 : defaultVatRate,
  })
  return { ...p, issues: p.issues.map(quotationMessage) }
}
