import { maskDoc, QUOTATION_PII } from '@/lib/pii'

/**
 * Populate spec for quotation responses. Only names are exposed for the linked
 * lead / client / creator — contact details are never populated here (the
 * recipient snapshot on the quotation itself is masked via QUOTATION_PII).
 */
export const QUOTATION_POPULATE = [
  { path: 'leadId',    select: 'name company' },
  { path: 'clientId',  select: 'company contactPerson', populate: { path: 'userId', select: 'name' } },
  { path: 'createdBy', select: 'name avatar' },
]

/** Serialise a hydrated quotation document for a staff response (PII-masked). */
export function quotationJSON(session, doc) {
  return maskDoc(session, doc.toJSON(), QUOTATION_PII)
}

const round2 = (n) => Math.round(n * 100) / 100

/**
 * Validate line items + tax/discount and compute totals.
 * Returns { error } (a message for a 422) or the computed financial fields.
 */
export function computeQuotation({ items, taxRate = 0, discount = 0 }) {
  if (!Array.isArray(items) || !items.length) return { error: 'At least one item required' }

  const processedItems = []
  for (const item of items) {
    if (!item || typeof item !== 'object') return { error: 'Invalid item' }
    const qty  = Number(item.quantity)
    const rate = item.rate === '' || item.rate == null ? 0 : Number(item.rate)
    if (!Number.isFinite(qty) || qty <= 0)   return { error: 'Item quantity must be greater than 0' }
    if (!Number.isFinite(rate) || rate < 0)  return { error: 'Item rate cannot be negative' }
    processedItems.push({
      description:      item.description != null ? String(item.description) : '',
      venture:          item.venture || null,
      service_category: item.service_category || null,
      service:          item.service || null,
      quantity:         qty,
      rate,
      amount:           round2(qty * rate),
    })
  }

  const tax  = taxRate === '' || taxRate == null ? 0 : Number(taxRate)
  const disc = discount === '' || discount == null ? 0 : Number(discount)
  if (!Number.isFinite(tax) || tax < 0 || tax > 100) return { error: 'Tax rate must be between 0 and 100' }
  if (!Number.isFinite(disc) || disc < 0)           return { error: 'Discount cannot be negative' }

  const subtotal  = round2(processedItems.reduce((s, i) => s + i.amount, 0))
  const taxAmount = round2(subtotal * (tax / 100))
  if (disc > subtotal + taxAmount) return { error: 'Discount cannot exceed the quotation total' }
  const total     = round2(subtotal + taxAmount - disc)

  return { items: processedItems, subtotal, taxRate: tax, taxAmount, discount: disc, total }
}
