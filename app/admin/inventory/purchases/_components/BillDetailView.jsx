'use client'

import Link from 'next/link'
import { AlertTriangle, Banknote, Boxes, ExternalLink, FileText, Laptop, Receipt, UserCheck } from 'lucide-react'
import DocPreview from '@/components/ui/DocPreview'
import AssetStatusBadge, { InventoryBadge } from '@/components/inventory/AssetStatusBadge'
import { cn, formatDate, formatDateTime } from '@/lib/utils'
import { SUPPLIER_VAT_TYPE_LABELS } from '@/lib/inventory/constants'
import { PaymentStatusBadge, paymentModeLabel } from './badges'
import { num, qtyText, tk } from './billMath'

const card = 'bg-white border border-gray-100 rounded-xl'

const TYPE = {
  ASSET:      { label: 'Asset',      color: 'blue',  icon: Laptop },
  CONSUMABLE: { label: 'Consumable', color: 'teal',  icon: Boxes },
  EXPENSE:    { label: 'Expense',    color: 'gray',  icon: Receipt },
}

const EXPENSE_STATUS = {
  PENDING:    { label: 'Pending in Accounts', color: 'yellow' },
  PAID:       { label: 'Paid',                color: 'green' },
  AUTHORIZED: { label: 'Paid & authorised',   color: 'green' },
  REJECTED:   { label: 'Rejected',            color: 'red' },
}

function Field({ label, children }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] uppercase tracking-wide text-gray-400">{label}</p>
      <div className="text-sm text-gray-900 break-words">{children ?? <span className="text-gray-400">—</span>}</div>
    </div>
  )
}

function Row({ label, value, strong, muted }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm">
      <span className={cn(strong ? 'font-medium text-gray-900' : 'text-gray-500')}>{label}</span>
      <span className={cn(strong ? 'font-semibold text-gray-900' : muted ? 'text-gray-500' : 'text-gray-900', 'text-right')}>{value}</span>
    </div>
  )
}

/**
 * Read-only view of a received / cancelled bill (or a draft for users who
 * cannot edit): supplier, lines with the assets and stock they created, tax
 * and payment. Action buttons are rendered by the page via `onSettle` /
 * `onPayNow` callbacks.
 */
export default function BillDetailView({ bill, canSettle, canPayNow, canViewAccounts, onSettle, onPayNow }) {
  const lines = bill.lines ?? []
  const payment = bill.payment ?? {}
  const expense = bill.expense
  const withheld = num(bill.tds?.amount) + num(bill.vds?.amount)

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
      <div className="xl:col-span-2 space-y-4 min-w-0">
        <section className={cn(card, 'p-4')}>
          <h2 className="text-sm font-semibold text-gray-900 mb-3">Supplier & documents</h2>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
            <Field label="Supplier">{bill.vendorName}</Field>
            <Field label="Supplier BIN">{bill.supplierBin}</Field>
            <Field label="VAT status">{SUPPLIER_VAT_TYPE_LABELS[bill.supplierVatType] ?? bill.supplierVatType}</Field>
            <Field label="Supplier invoice">{bill.supplierInvoiceNo}</Field>
            <Field label="Mushak-6.3">{bill.mushakNo ? `${bill.mushakNo}${bill.mushakDay ? ` · ${formatDate(bill.mushakDay)}` : ''}` : null}</Field>
            <Field label="Bill date">{bill.billDay ? formatDate(bill.billDay) : null}</Field>
            <Field label="Received">{bill.receivedAt ? formatDateTime(bill.receivedAt) : null}</Field>
            <Field label="Recorded by">{bill.createdByName}</Field>
            <Field label="Payee">{bill.vendor ? `${bill.vendor.payeeType === 'INDIVIDUAL' ? 'Individual' : bill.vendor.payeeType === 'NON_RESIDENT' ? 'Non-resident' : 'Company'} · ${bill.vendor.hasPsr ? 'PSR shown' : 'No PSR'}` : 'One-off supplier'}</Field>
          </div>
          {bill.attachments?.length > 0 && (
            <div className="mt-4 space-y-2">
              <p className="text-[11px] uppercase tracking-wide text-gray-400">Attachments</p>
              {bill.attachments.map(url => <DocPreview key={url} url={url} compact />)}
            </div>
          )}
        </section>

        <section className={cn(card, 'overflow-hidden')}>
          <div className="px-4 py-3 border-b border-gray-100 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-900">Items</h2>
            <span className="text-xs text-gray-500">{lines.length} line{lines.length === 1 ? '' : 's'}</span>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50/60 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <th className="px-4 py-2.5">Item</th>
                  <th className="px-4 py-2.5 text-right">Qty</th>
                  <th className="px-4 py-2.5 text-right whitespace-nowrap">Unit price</th>
                  <th className="px-4 py-2.5 text-right">VAT</th>
                  <th className="px-4 py-2.5 text-right">Total</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {lines.map((l, i) => {
                  const t = TYPE[l.lineType] ?? TYPE.EXPENSE
                  return (
                    <tr key={l.id ?? i} className="align-top">
                      <td className="px-4 py-3 min-w-[260px]">
                        <div className="flex items-center gap-2 flex-wrap">
                          <InventoryBadge label={t.label} color={t.color} dot={false} />
                          <span className="font-medium text-gray-900">{l.description}</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5">
                          {[l.category?.name, [l.brand, l.model].filter(Boolean).join(' '), l.location?.name ? `@ ${l.location.name}` : null,
                            l.lineType === 'ASSET' && l.warrantyMonths ? `${l.warrantyMonths}-month warranty` : null,
                            l.lineType === 'ASSET' && typeof l.capitalize === 'boolean' ? (l.capitalize ? 'capitalised' : 'expensed') : null,
                          ].filter(Boolean).join(' · ')}
                        </p>
                        {l.lineType === 'ASSET' && l.assets?.length > 0 && (
                          <div className="mt-2 flex flex-wrap gap-1.5">
                            {l.assets.map(a => (
                              <Link key={a.id} href={`/admin/inventory/assets/${a.id}`}
                                className="inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-2 py-1 text-xs hover:border-gray-300">
                                <span className="font-mono font-medium text-gray-900">{a.assetTag}</span>
                                {a.serialNumber && <span className="text-gray-400">{a.serialNumber}</span>}
                                <AssetStatusBadge status={a.status} className="!px-1.5 !py-0.5" />
                              </Link>
                            ))}
                          </div>
                        )}
                        {l.lineType === 'ASSET' && bill.status === 'RECEIVED' && !(l.assets?.length) && (
                          <p className="mt-1 text-xs text-gray-400">No assets linked (removed or never created).</p>
                        )}
                        {l.lineType === 'ASSET' && l.assignEmployee && (
                          <p className="mt-1 inline-flex items-center gap-1 text-xs text-blue-700">
                            <UserCheck className="w-3 h-3" /> {bill.status === 'RECEIVED' ? 'Assigned to' : 'To be assigned to'} {l.assignEmployee.name}
                          </p>
                        )}
                        {l.lineType === 'CONSUMABLE' && (
                          <p className="mt-1 text-xs text-gray-500">
                            {l.stockItem ? (
                              <Link href={`/admin/inventory/stock?item=${l.stockItem.id}`} className="text-gray-700 hover:underline">
                                {l.stockItem.name} · {l.stockItem.sku}
                              </Link>
                            ) : 'New stock item on receipt'}
                            {l.stockMovement && <> · {l.stockMovement.movementNo} at {tk(l.stockMovement.unitCost)}/{l.unit || 'unit'}</>}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">{qtyText(l.qty)} {l.unit || ''}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">{tk(l.unitPrice)}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {tk(l.vatAmount)}
                        <span className="block text-[11px] text-gray-400">{num(l.vatRate)}%{num(l.sdAmount) > 0 ? ` · SD ${tk(l.sdAmount)}` : ''}</span>
                      </td>
                      <td className="px-4 py-3 text-right font-medium whitespace-nowrap">{tk(l.lineTotal)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        {bill.status === 'CANCELLED' && (bill.cancelReason || bill.cancelledAt) && (
          <section className={cn(card, 'p-4 border-red-100 bg-red-50/40')}>
            <p className="text-[11px] uppercase tracking-wide text-red-500 mb-1">Cancelled</p>
            <p className="text-sm text-gray-700">
              {[bill.cancelledAt ? formatDateTime(bill.cancelledAt) : null, bill.cancelledByName ? `by ${bill.cancelledByName}` : null].filter(Boolean).join(' ')}
            </p>
            {bill.cancelReason && <p className="text-sm text-gray-700 whitespace-pre-line mt-1">{bill.cancelReason}</p>}
          </section>
        )}

        {bill.notes && (
          <section className={cn(card, 'p-4')}>
            <p className="text-[11px] uppercase tracking-wide text-gray-400 mb-1">Notes</p>
            <p className="text-sm text-gray-700 whitespace-pre-line">{bill.notes}</p>
          </section>
        )}
      </div>

      <div className="space-y-4">
        <section className={cn(card, 'p-4 space-y-2')}>
          <h2 className="text-sm font-semibold text-gray-900 mb-1">Totals & tax</h2>
          <Row label="Subtotal (excl. VAT)" value={tk(bill.subtotal)} />
          <Row label={`VAT${bill.vatCreditable ? ' — claimed as input credit' : ' — added to cost'}`} value={tk(bill.vatTotal)} />
          {num(bill.sdTotal) > 0 && <Row label="Supplementary duty" value={tk(bill.sdTotal)} />}
          {num(bill.otherCosts) > 0 && <Row label="Other costs" value={tk(bill.otherCosts)} />}
          <div className="border-t border-gray-100 pt-2"><Row label="Bill total" value={tk(bill.total)} strong /></div>
          {num(bill.tds?.amount) > 0 && (
            <Row label={`TDS ${bill.tds.section ?? ''}${bill.tds.rate !== null && bill.tds.rate !== undefined ? ` @ ${bill.tds.rate}%` : ''}`} value={`− ${tk(bill.tds.amount)}`} muted />
          )}
          {num(bill.vds?.amount) > 0 && (
            <Row label={`VDS ${bill.vds.serviceCode ?? ''}${bill.vds.rate !== null && bill.vds.rate !== undefined ? ` @ ${bill.vds.rate}%` : ''}`} value={`− ${tk(bill.vds.amount)}`} muted />
          )}
          <div className="border-t border-gray-100 pt-2"><Row label="Net payable" value={tk(bill.netPayable)} strong /></div>
          {withheld > 0 && (
            <p className="text-[11px] text-gray-400">Withheld amounts are deposited to the government (TDS by challan, VDS through the VAT return) and certificates issued from Tax & VAT.</p>
          )}
          {bill.status === 'RECEIVED' && num(bill.capitalizedAmount) > 0 && (
            <Row label="Capitalised as fixed assets" value={tk(bill.capitalizedAmount)} muted />
          )}
        </section>

        {bill.status !== 'DRAFT' && (
          <section className={cn(card, 'p-4 space-y-3')}>
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold text-gray-900">Payment</h2>
              <PaymentStatusBadge bill={bill} />
            </div>
            <p className="text-xs text-gray-500">{paymentModeLabel(payment.mode)}</p>
            {payment.status === 'PAID' && bill.account && (
              <Row label="Paid from" value={`${bill.account.name}${bill.account.last4 ? ` ••${bill.account.last4}` : ''}`} />
            )}
            {expense && (
              <div className="rounded-lg bg-gray-50 px-3 py-2 space-y-1">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-600">{expense.expenseId ?? 'Expense'}{expense.expenseInvoiceNo ? ` · ${expense.expenseInvoiceNo}` : ''}</span>
                  <InventoryBadge label={EXPENSE_STATUS[expense.status]?.label ?? expense.status} color={EXPENSE_STATUS[expense.status]?.color ?? 'gray'} />
                </div>
                <p className="text-xs text-gray-500">{expense.category}</p>
                {expense.paidAt && <p className="text-xs text-gray-500">Paid {formatDate(expense.paidAt)}{expense.paidBy ? ` by ${expense.paidBy}` : ''}</p>}
                {expense.status === 'REJECTED' && expense.reviewNote && (
                  <p className="flex items-start gap-1 text-xs text-red-700"><AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" /> {expense.reviewNote}</p>
                )}
                {canViewAccounts && expense.status === 'PENDING' && (
                  <Link href="/admin/accounts?tab=requests" className="inline-flex items-center gap-1 text-xs font-medium text-gray-700 hover:text-gray-900">
                    Open payment requests <ExternalLink className="w-3 h-3" />
                  </Link>
                )}
              </div>
            )}
            {bill.status === 'RECEIVED' && payment.status === 'UNPAID' && (
              <div className="space-y-2">
                <p className="text-xs text-amber-700">
                  {expense?.status === 'REJECTED' ? 'Accounts rejected the payment request.' : 'No payment has been recorded for this bill.'}
                </p>
                {canSettle && (
                  <button type="button" onClick={onSettle}
                    className="w-full inline-flex items-center justify-center gap-1.5 bg-gray-900 text-white hover:bg-gray-800 rounded-lg px-4 py-2 text-sm font-medium">
                    <Banknote className="w-4 h-4" /> Settle payment
                  </button>
                )}
              </div>
            )}
            {bill.status === 'RECEIVED' && payment.status === 'REQUESTED' && canPayNow && (
              <button type="button" onClick={onPayNow}
                className="w-full inline-flex items-center justify-center gap-1.5 bg-gray-900 text-white hover:bg-gray-800 rounded-lg px-4 py-2 text-sm font-medium">
                <Banknote className="w-4 h-4" /> Pay now {tk(bill.netPayable, 0)}
              </button>
            )}
            {payment.mode === 'PAID_OUTSIDE' && payment.status === 'PAID' && (
              <p className="flex items-start gap-1.5 text-xs text-gray-500">
                <FileText className="w-3 h-3 mt-0.5 shrink-0" /> Recorded as paid outside the system — no expense or ledger entry was made.
              </p>
            )}
          </section>
        )}
      </div>
    </div>
  )
}
