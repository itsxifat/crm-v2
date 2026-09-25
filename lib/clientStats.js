// Shared client roll-up figures for the admin client pages. Kept in one place so
// the list, detail and global stats (and the client portal) agree.

// Non-terminal project statuses — everything except DELIVERED / CANCELLED / RENEWED.
// Mirrors ACTIVE_STATUSES in app/client/page.js.
export const ACTIVE_PROJECT_STATUSES = [
  'PENDING', 'IN_PROGRESS', 'IN_REVIEW', 'REVISION', 'APPROVED',
  'FEEDBACK', 'SUBMITTED', 'ACTIVE', 'EXPIRING_SOON', 'ON_HOLD',
]

export const OUTSTANDING_INVOICE_STATUSES = ['SENT', 'PARTIALLY_PAID', 'OVERDUE']

// Fields an invoice query must select for invoiceMoneyBDT().
export const INVOICE_MONEY_FIELDS = 'total totalBDT paidAmount currency status'

/**
 * BDT-equivalent collected / outstanding amounts for one invoice. Non-BDT
 * invoices are converted with the invoice's own totalBDT / total rate.
 * @returns {{ collected: number, outstanding: number }}
 */
export function invoiceMoneyBDT(inv) {
  if (!inv || inv.status === 'CANCELLED' || inv.status === 'DRAFT') return { collected: 0, outstanding: 0 }
  const total    = Number(inv.total) || 0
  const totalBDT = inv.totalBDT != null && Number.isFinite(Number(inv.totalBDT)) ? Number(inv.totalBDT) : null
  const rate     = (!inv.currency || inv.currency === 'BDT') ? 1 : (totalBDT != null && total > 0 ? totalBDT / total : 1)
  const paid     = inv.status === 'PAID' ? Math.max(Number(inv.paidAmount) || 0, total) : (Number(inv.paidAmount) || 0)
  const collected   = paid * rate
  const outstanding = OUTSTANDING_INVOICE_STATUSES.includes(inv.status) ? Math.max(0, total - paid) * rate : 0
  return { collected, outstanding }
}

/** Sum collected (revenue) and outstanding BDT across invoices. */
export function sumInvoiceMoneyBDT(invoices) {
  let totalRevenue = 0
  let outstandingBalance = 0
  for (const inv of invoices ?? []) {
    const { collected, outstanding } = invoiceMoneyBDT(inv)
    totalRevenue       += collected
    outstandingBalance += outstanding
  }
  return { totalRevenue: Math.round(totalRevenue * 100) / 100, outstandingBalance: Math.round(outstandingBalance * 100) / 100 }
}
