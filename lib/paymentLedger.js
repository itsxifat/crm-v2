/**
 * lib/paymentLedger.js
 *
 * Atomic money-counter updates for client payments. Every helper here is a
 * single conditional MongoDB update, so two overlapping payment operations on
 * the same project / invoice can never lose an increment (no read-modify-write
 * in JS) and an invoice can never be paid past its total.
 *
 * Money fields are stored as Mixed (legacy), so values are coerced with
 * $convert inside the update pipeline rather than relying on $inc.
 */

import mongoose from 'mongoose'
import { Invoice, Project, ProjectPayment } from '@/models'

/** Invoice statuses that can still take a payment. */
export const PAYABLE_INVOICE_STATUSES = ['SENT', 'PARTIALLY_PAID', 'OVERDUE']

const num = (field) => ({ $convert: { input: `$${field}`, to: 'double', onError: 0, onNull: 0 } })

/**
 * Sum of PENDING_CONFIRMATION payment amounts matching `filter` — money that is
 * already claimed but not yet confirmed, so it must not be requested again.
 * `filter` holds id fields only, e.g. { invoiceId } or { projectId }.
 */
export async function pendingPaymentTotal(filter, { excludeId = null } = {}) {
  // aggregate() does not cast, so id values must be real ObjectIds
  const oid = (v) => (v instanceof mongoose.Types.ObjectId ? v : new mongoose.Types.ObjectId(String(v?._id ?? v)))
  const match = { status: 'PENDING_CONFIRMATION' }
  for (const [k, v] of Object.entries(filter)) match[k] = v == null ? v : oid(v)
  if (excludeId) match._id = { $ne: oid(excludeId) }
  const [row] = await ProjectPayment.aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: '$amount' } } },
  ])
  return Number(row?.total ?? 0)
}

/**
 * Atomically apply `amount` to an invoice and recompute its status.
 * Only succeeds while the invoice is payable and the amount fits inside the
 * outstanding balance (0.01 tolerance).
 *
 * With `cap: true` an amount larger than the balance is accepted and the
 * invoice is simply capped at its total (legacy manual-ledger behaviour).
 *
 * @returns {Promise<object|null>} the updated invoice (lean), or null when the
 *          invoice is missing, not payable, or the amount exceeds its balance.
 */
export async function applyInvoicePayment(invoiceId, amount, paidAt = new Date(), { cap = false } = {}) {
  const amt = Number(amount)
  if (!invoiceId || !Number.isFinite(amt) || amt <= 0) return null
  const settled = { $lte: [{ $subtract: [num('total'), '$paidAmount'] }, 0.01] }
  const filter = { _id: invoiceId, status: { $in: PAYABLE_INVOICE_STATUSES } }
  if (!cap) filter.$expr = { $lte: [{ $add: [num('paidAmount'), amt] }, { $add: [num('total'), 0.01] }] }
  return Invoice.findOneAndUpdate(
    filter,
    [
      { $set: { paidAmount: { $round: [{ $min: [{ $add: [num('paidAmount'), amt] }, num('total')] }, 2] } } },
      { $set: {
        status: { $cond: [settled, 'PAID', 'PARTIALLY_PAID'] },
        paidAt: { $cond: [{ $and: [settled, { $eq: [{ $ifNull: ['$paidAt', null] }, null] }] }, paidAt, '$paidAt'] },
      } },
    ],
    { new: true },
  ).lean()
}

/**
 * Atomically credit `amount` (BDT) to a project's paidAmount, keeping the
 * project value at or above what has been paid (the same invariant as
 * models/Project.js growProjectValueToPaid, which only runs on doc.save()).
 */
export async function creditProjectPaid(projectId, amount) {
  const amt = Number(amount)
  if (!projectId || !Number.isFinite(amt) || amt <= 0) return
  await Project.updateOne({ _id: projectId }, [
    { $set: { paidAmount: { $round: [{ $add: [num('paidAmount'), amt] }, 2] } } },
    { $set: {
      budget: { $cond: [{ $gt: ['$paidAmount', { $add: [num('budget'), 0.01] }] }, '$paidAmount', '$budget'] },
    } },
  ])
}
