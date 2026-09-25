/**
 * Server-side invoice line/total calculation + validation, shared by invoice
 * create (POST /api/invoices) and edit (PUT /api/invoices/:id) so both apply
 * the same rules as the form.
 *
 * Rules: at least one item; quantity > 0; rate >= 0; 0 <= taxRate <= 100;
 * 0 <= discount <= subtotal + tax (so a total can never go negative).
 *
 * @returns {{ error: string } | { items, subtotal, taxRate, taxAmount, discount, total }}
 */
export function computeInvoiceTotals({ items, taxRate, discount }) {
  if (!Array.isArray(items) || items.length === 0) return { error: 'At least one item required' }

  const round2 = n => Math.round(n * 100) / 100
  const num    = v => (v === '' || v === null || v === undefined ? NaN : Number(v))

  const processed = []
  for (const [i, item] of items.entries()) {
    const quantity = num(item?.quantity)
    const rate     = num(item?.rate ?? 0)
    if (!Number.isFinite(quantity) || quantity <= 0) return { error: `Item ${i + 1}: quantity must be greater than 0` }
    if (!Number.isFinite(rate) || rate < 0)          return { error: `Item ${i + 1}: rate must be 0 or more` }
    processed.push({
      description: item?.description,
      quantity,
      rate,
      amount: round2(quantity * rate),
    })
  }

  const tax  = taxRate === '' || taxRate == null ? 0 : Number(taxRate)
  const disc = discount === '' || discount == null ? 0 : Number(discount)
  if (!Number.isFinite(tax) || tax < 0 || tax > 100) return { error: 'Tax rate must be between 0 and 100' }

  const subtotal  = round2(processed.reduce((s, i) => s + i.amount, 0))
  const taxAmount = round2(subtotal * (tax / 100))
  if (!Number.isFinite(disc) || disc < 0 || disc > subtotal + taxAmount + 0.001)
    return { error: 'Discount must be between 0 and the invoice subtotal' }

  const total = round2(subtotal + taxAmount - disc)
  return { items: processed, subtotal, taxRate: tax, taxAmount, discount: disc, total }
}
