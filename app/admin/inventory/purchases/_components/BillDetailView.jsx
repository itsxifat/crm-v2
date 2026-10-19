'use client'

import Link from 'next/link'
import { AlertTriangle, Banknote, Boxes, ExternalLink, FileText, Laptop, Receipt, UserCheck } from 'lucide-react'
import DocPreview from '@/components/ui/DocPreview'
import Button from '@/components/ui/Button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import AssetStatusBadge, { InventoryBadge } from '@/components/inventory/AssetStatusBadge'
import { cn, formatDate, formatDateTime } from '@/lib/utils'
import { SUPPLIER_VAT_TYPE_LABELS } from '@/lib/inventory/constants'
import { PaymentStatusBadge, paymentModeLabel } from './badges'
import { num, qtyText, tk } from './billMath'

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
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-0.5 break-words text-sm text-gray-900">{children ?? <span className="text-gray-400">—</span>}</div>
    </div>
  )
}

function Row({ label, value, strong, muted, title }) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm" title={title}>
      <span className={cn(strong ? 'font-medium text-gray-900' : 'text-muted-foreground')}>{label}</span>
      <span className={cn(strong ? 'font-semibold text-gray-900' : muted ? 'text-gray-500' : 'text-gray-900', 'text-right tabular-nums')}>{value}</span>
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
    <div className="grid grid-cols-1 items-start gap-6 xl:grid-cols-3">
      <div className="min-w-0 space-y-6 xl:col-span-2">
        <Card>
          <CardHeader>
            <CardTitle>Supplier & documents</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-3">
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
              <div className="mt-5 space-y-2 border-t border-gray-100 pt-4">
                <p className="text-xs text-muted-foreground">Attachments</p>
                {bill.attachments.map(url => <DocPreview key={url} url={url} compact />)}
              </div>
            )}
          </CardContent>
        </Card>

        <Card className="overflow-hidden">
          <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-5 py-3.5">
            <CardTitle>Items</CardTitle>
            <span className="text-xs text-muted-foreground">{lines.length} line{lines.length === 1 ? '' : 's'}</span>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Item</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit price</TableHead>
                <TableHead className="text-right">VAT</TableHead>
                <TableHead className="text-right">Total</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {lines.map((l, i) => {
                const t = TYPE[l.lineType] ?? TYPE.EXPENSE
                return (
                  <TableRow key={l.id ?? i} className="align-top hover:bg-transparent">
                    <TableCell className="min-w-[260px] align-top">
                      <div className="flex flex-wrap items-center gap-2">
                        <InventoryBadge label={t.label} color={t.color} dot={false} />
                        <span className="font-medium text-gray-900">{l.description}</span>
                      </div>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {[l.category?.name, [l.brand, l.model].filter(Boolean).join(' '), l.location?.name ? `@ ${l.location.name}` : null,
                          l.lineType === 'ASSET' && l.warrantyMonths ? `${l.warrantyMonths}-month warranty` : null,
                          l.lineType === 'ASSET' && typeof l.capitalize === 'boolean' ? (l.capitalize ? 'capitalised' : 'expensed') : null,
                        ].filter(Boolean).join(' · ')}
                      </p>
                      {l.lineType === 'ASSET' && l.assets?.length > 0 && (
                        <div className="mt-2 flex flex-wrap gap-1.5">
                          {l.assets.map(a => (
                            <Link key={a.id} href={`/admin/inventory/assets/${a.id}`}
                              className="inline-flex items-center gap-1.5 rounded-md border border-gray-200/80 bg-white px-2 py-1 text-xs shadow-xs transition-colors hover:bg-gray-50">
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
                        <p className="mt-1.5 inline-flex items-center gap-1 text-xs text-gray-600">
                          <UserCheck className="size-3.5 text-gray-400" /> {bill.status === 'RECEIVED' ? 'Assigned to' : 'To be assigned to'} {l.assignEmployee.name}
                        </p>
                      )}
                      {l.lineType === 'CONSUMABLE' && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          {l.stockItem ? (
                            <Link href={`/admin/inventory/stock?item=${l.stockItem.id}`} className="font-medium text-gray-700 underline-offset-4 hover:underline">
                              {l.stockItem.name} · {l.stockItem.sku}
                            </Link>
                          ) : 'New stock item on receipt'}
                          {l.stockMovement && <> · {l.stockMovement.movementNo} at {tk(l.stockMovement.unitCost)}/{l.unit || 'unit'}</>}
                        </p>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right align-top tabular-nums">{qtyText(l.qty)} {l.unit || ''}</TableCell>
                    <TableCell className="whitespace-nowrap text-right align-top tabular-nums">{tk(l.unitPrice)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right align-top tabular-nums">
                      {tk(l.vatAmount)}
                      <span className="block text-xs text-gray-400">{num(l.vatRate)}%{num(l.sdAmount) > 0 ? ` · SD ${tk(l.sdAmount)}` : ''}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right align-top font-medium tabular-nums text-gray-900">{tk(l.lineTotal)}</TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        </Card>

        {bill.status === 'CANCELLED' && (bill.cancelReason || bill.cancelledAt) && (
          <div className="rounded-xl border border-red-200 bg-red-50/60 p-5">
            <p className="text-sm font-semibold text-red-700">Cancelled</p>
            <p className="mt-1 text-sm text-gray-700">
              {[bill.cancelledAt ? formatDateTime(bill.cancelledAt) : null, bill.cancelledByName ? `by ${bill.cancelledByName}` : null].filter(Boolean).join(' ')}
            </p>
            {bill.cancelReason && <p className="mt-1 whitespace-pre-line text-sm text-gray-700">{bill.cancelReason}</p>}
          </div>
        )}

        {bill.notes && (
          <Card className="p-5">
            <CardTitle>Notes</CardTitle>
            <p className="mt-2 whitespace-pre-line text-sm text-gray-700">{bill.notes}</p>
          </Card>
        )}
      </div>

      <div className="space-y-6">
        <Card className="space-y-2.5 p-5">
          <CardTitle className="mb-3">Totals & tax</CardTitle>
          <Row label="Subtotal (excl. VAT)" value={tk(bill.subtotal)} />
          <Row label={`VAT${bill.vatCreditable ? ' — claimed as input credit' : ' — added to cost'}`} value={tk(bill.vatTotal)} />
          {num(bill.sdTotal) > 0 && <Row label="Supplementary duty" value={tk(bill.sdTotal)} />}
          {num(bill.otherCosts) > 0 && <Row label="Other costs" value={tk(bill.otherCosts)} />}
          <div className="border-t border-gray-100 pt-2.5"><Row label="Bill total" value={tk(bill.total)} strong /></div>
          {num(bill.tds?.amount) > 0 && (
            <Row label={`TDS ${bill.tds.section ?? ''}${bill.tds.rate !== null && bill.tds.rate !== undefined ? ` @ ${bill.tds.rate}%` : ''}`} value={`− ${tk(bill.tds.amount)}`} muted />
          )}
          {num(bill.vds?.amount) > 0 && (
            <Row label={`VDS ${bill.vds.serviceCode ?? ''}${bill.vds.rate !== null && bill.vds.rate !== undefined ? ` @ ${bill.vds.rate}%` : ''}`} value={`− ${tk(bill.vds.amount)}`} muted />
          )}
          <div className="border-t border-gray-100 pt-2.5">
            <Row
              label="Net payable"
              value={tk(bill.netPayable)}
              strong
              title={withheld > 0 ? 'Withheld amounts are deposited to the government (TDS by challan, VDS through the VAT return); certificates are issued from Tax & VAT.' : undefined}
            />
          </div>
          {bill.status === 'RECEIVED' && num(bill.capitalizedAmount) > 0 && (
            <Row label="Capitalised as fixed assets" value={tk(bill.capitalizedAmount)} muted />
          )}
        </Card>

        {bill.status !== 'DRAFT' && (
          <Card className="space-y-3 p-5">
            <div className="flex items-center justify-between gap-2">
              <CardTitle>Payment</CardTitle>
              <PaymentStatusBadge bill={bill} />
            </div>
            <p className="text-xs text-muted-foreground">{paymentModeLabel(payment.mode)}</p>
            {payment.status === 'PAID' && bill.account && (
              <Row label="Paid from" value={`${bill.account.name}${bill.account.last4 ? ` ••${bill.account.last4}` : ''}`} />
            )}
            {expense && (
              <div className="space-y-1 rounded-lg bg-gray-50 px-3 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs text-gray-600">{expense.expenseId ?? 'Expense'}{expense.expenseInvoiceNo ? ` · ${expense.expenseInvoiceNo}` : ''}</span>
                  <InventoryBadge label={EXPENSE_STATUS[expense.status]?.label ?? expense.status} color={EXPENSE_STATUS[expense.status]?.color ?? 'gray'} />
                </div>
                <p className="text-xs text-muted-foreground">{expense.category}</p>
                {expense.paidAt && <p className="text-xs text-muted-foreground">Paid {formatDate(expense.paidAt)}{expense.paidBy ? ` by ${expense.paidBy}` : ''}</p>}
                {expense.status === 'REJECTED' && expense.reviewNote && (
                  <p className="flex items-start gap-1.5 text-xs text-red-700"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" /> {expense.reviewNote}</p>
                )}
                {canViewAccounts && expense.status === 'PENDING' && (
                  <Link href="/admin/accounts?tab=requests" className="inline-flex items-center gap-1 text-xs font-medium text-gray-900 underline-offset-4 hover:underline">
                    Open payment requests <ExternalLink className="size-3.5" />
                  </Link>
                )}
              </div>
            )}
            {bill.status === 'RECEIVED' && payment.status === 'UNPAID' && (
              <div className="space-y-3">
                <p className="text-xs text-amber-700">
                  {expense?.status === 'REJECTED' ? 'Accounts rejected the payment request.' : 'No payment recorded yet.'}
                </p>
                {canSettle && (
                  <Button onClick={onSettle} className="w-full">
                    <Banknote /> Settle payment
                  </Button>
                )}
              </div>
            )}
            {bill.status === 'RECEIVED' && payment.status === 'REQUESTED' && canPayNow && (
              <Button onClick={onPayNow} className="w-full">
                <Banknote /> Pay now {tk(bill.netPayable, 0)}
              </Button>
            )}
            {payment.mode === 'PAID_OUTSIDE' && payment.status === 'PAID' && (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <FileText className="mt-0.5 size-3.5 shrink-0" /> Paid outside the system — no expense or ledger entry.
              </p>
            )}
          </Card>
        )}
      </div>
    </div>
  )
}
