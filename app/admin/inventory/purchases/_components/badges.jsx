'use client'

import { InventoryBadge } from '@/components/inventory/AssetStatusBadge'
import {
  PURCHASE_BILL_STATUS_META, PURCHASE_PAYMENT_STATUS_META, PURCHASE_PAYMENT_MODE_LABELS,
} from '@/lib/inventory/constants'

export function BillStatusBadge({ status, className }) {
  const m = PURCHASE_BILL_STATUS_META[status] ?? { label: status ?? '—', color: 'gray' }
  return <InventoryBadge label={m.label} color={m.color} className={className} />
}

/** Payment status of a bill; drafts show nothing meaningful yet. */
export function PaymentStatusBadge({ bill, className }) {
  if (!bill) return null
  if (bill.status === 'DRAFT') return <span className="text-xs text-gray-400">Not received</span>
  if (bill.status === 'CANCELLED') return <span className="text-xs text-gray-400">—</span>
  const status = bill.payment?.status ?? 'UNPAID'
  const m = PURCHASE_PAYMENT_STATUS_META[status] ?? { label: status, color: 'gray' }
  let label = m.label
  if (status === 'PAID' && bill.payment?.mode === 'PAID_OUTSIDE') label = 'Paid outside'
  if (status === 'REQUESTED') label = 'With Accounts'
  return <InventoryBadge label={label} color={status === 'PAID' && bill.payment?.mode === 'PAID_OUTSIDE' ? 'gray' : m.color} className={className} />
}

export function paymentModeLabel(mode) {
  return PURCHASE_PAYMENT_MODE_LABELS[mode] ?? mode ?? '—'
}
