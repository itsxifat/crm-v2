/**
 * lib/paymentSettlement.js — what one payment SETTLED on its invoice, for the
 * payment-history rows of invoice prints (server PDFs, InvoicePrintView,
 * CombinedInvoicePrintView, the client invoice page).
 *
 * PURE module: imported by client components as well as API routes, so it must
 * never import server code (no '@/' alias, no models).
 *
 * A ProjectPayment's `amount` is the CASH only (0 for a withholding-only
 * settlement, paymentMethod 'WITHHOLDING'); the invoice is credited with
 * `settledAmount` = cash + VDS + TDS withheld by the client (null on legacy
 * rows ⇒ cash + VDS + TDS). Showing the settled figure per row makes the rows
 * add up to the invoice's "Amount paid / settled" (credit notes are listed in
 * the totals block only).
 */

const WITHHOLDING_METHOD = 'WITHHOLDING'

/** Label for a withholding-only settlement (no cash changed hands). */
export const WITHHOLDING_LABEL = 'Tax withheld at source'

const num = (v) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

/**
 * @param {object} p  a ProjectPayment (lean / JSON) or a legacy Payment
 * @returns {{ settled: number, cash: number, vds: number, tds: number, withholdingOnly: boolean, hasWithholding: boolean }}
 *   settled — credited to the invoice (invoice currency)
 *   cash    — the cash part of it (settled − VDS − TDS)
 */
export function paymentSettlement(p) {
  const vds = round2(Math.max(0, num(p?.vdsAmount)))
  const tds = round2(Math.max(0, num(p?.tdsAmount)))
  const stored = p?.settledAmount
  const settled = stored !== null && stored !== undefined && stored !== '' && Number.isFinite(Number(stored))
    ? round2(Number(stored))
    : round2(num(p?.amount) + vds + tds)
  return {
    settled,
    cash: round2(Math.max(0, settled - vds - tds)),
    vds,
    tds,
    withholdingOnly: p?.paymentMethod === WITHHOLDING_METHOD,
    hasWithholding: vds + tds > 0.005,
  }
}

/** Method label for a payment row: a withholding-only settlement reads as such. */
export function paymentMethodLabel(method) {
  if (method === WITHHOLDING_METHOD) return WITHHOLDING_LABEL
  return method ? String(method).replace(/_/g, ' ') : '—'
}

/**
 * The non-zero parts of a settlement, e.g. [['Cash', 50000], ['VDS', 9000], ['TDS', 6000]]
 * — for the small breakdown line under a row that had tax withheld.
 */
export function settlementParts(s) {
  return [['Cash', s.cash], ['VDS', s.vds], ['TDS', s.tds]].filter(([, v]) => v > 0.005)
}
