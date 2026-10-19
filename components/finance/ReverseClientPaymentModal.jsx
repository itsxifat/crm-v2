'use client'

import { useState } from 'react'
import { AlertTriangle, RotateCcw, X } from 'lucide-react'
import toast from 'react-hot-toast'
import Button from '@/components/ui/Button'
import { Label, Textarea } from '@/components/ui/Input'
import { formatMoney } from '@/lib/currencies'
import { invalidateMoneyAccounts } from '@/components/finance/MoneyAccountSelect'

/**
 * ReverseClientPaymentModal — undo a booked client receipt so it can be recorded
 * again with the right amount, account, VDS / TDS or date.
 *
 * Props (one of payment / transaction):
 *   payment      a CONFIRMED ProjectPayment  → PATCH /api/project-payments/:id { action:'reverse', reason }
 *   transaction  an INCOME ledger row booked against an invoice
 *                                            → PATCH /api/transactions/:id     { action:'reverse', reason }
 *   onClose()    close the modal
 *   onDone(json) called after a successful reversal (reload lists, invoice…)
 *
 * The server posts a reversing ledger entry dated today, voids the payment's
 * VDS / TDS entries, takes the settled amount back off the invoice and the P&L
 * amount off the project. It refuses while a VDS / TDS entry is in a filed
 * return, the books are locked, or a refund note needs the money.
 */
export default function ReverseClientPaymentModal({ payment = null, transaction = null, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const trimmed = reason.trim()

  const rec = payment ?? transaction ?? {}
  const id = rec.id ?? rec._id
  const url = payment ? `/api/project-payments/${id}` : `/api/transactions/${id}`
  const cur = rec.currency || 'BDT'
  const cash = Number(rec.amount) || 0
  const vds = payment ? Number(payment.vdsAmount) || 0 : 0
  const tds = payment ? Number(payment.tdsAmount) || 0 : 0
  const invoiceNo = payment?.invoiceId?.invoiceNumber ?? transaction?.invoiceNumber ?? null
  const projectName = payment?.projectId?.name ?? transaction?.projectId?.name ?? null

  async function submit() {
    if (trimmed.length < 5) { toast.error('Give a reason (at least 5 characters)'); return }
    setSaving(true)
    try {
      const res = await fetch(url, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reverse', reason: trimmed }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        const fe = json?.details?.fieldErrors
        const detail = fe ? Object.values(fe).flat()[0] : null
        throw new Error(json.error && json.error !== 'Validation failed' ? json.error : (detail || json.error || 'The payment could not be reversed'))
      }
      invalidateMoneyAccounts()   // the reversal takes the money back out of the account
      toast.success('Payment reversed — record it again')
      onDone?.(json)
      onClose?.()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]">
      <div className="flex max-h-[90vh] w-full max-w-lg flex-col rounded-2xl border border-gray-200/80 bg-white shadow-2xl">
        <div className="flex shrink-0 items-start justify-between gap-4 px-6 pb-3 pt-5">
          <h3 className="text-base font-semibold tracking-tight text-gray-900">
            Reverse client payment{transaction?.txnId ? ` — ${transaction.txnId}` : ''}
          </h3>
          <Button variant="ghost" size="icon-sm" onClick={onClose} disabled={saving} aria-label="Close" className="-mr-1.5 -mt-0.5 text-gray-400">
            <X />
          </Button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-6 pb-5 pt-1">
          <div className="rounded-lg bg-gray-50 px-4 py-3">
            <p className="text-sm font-semibold text-gray-900 tabular-nums">
              {cash > 0 ? formatMoney(cash, cur) : 'Tax withheld only'}
              {vds > 0 && <span className="text-xs font-normal text-muted-foreground"> + VDS {formatMoney(vds, 'BDT')}</span>}
              {tds > 0 && <span className="text-xs font-normal text-muted-foreground"> + TDS {formatMoney(tds, 'BDT')}</span>}
            </p>
            {(invoiceNo || projectName) && (
              <p className="mt-0.5 text-xs text-muted-foreground">
                {invoiceNo ? `Invoice ${invoiceNo}` : ''}{invoiceNo && projectName ? ' · ' : ''}{projectName ?? ''}
              </p>
            )}
            {(rec.description || payment?.accountId?.name) && (
              <p className="mt-0.5 text-xs text-gray-400">
                {rec.description ?? ''}{rec.description && payment?.accountId?.name ? ' · ' : ''}{payment?.accountId?.name ? `into ${payment.accountId.name}` : ''}
              </p>
            )}
          </div>
          <div
            className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800"
            title="Refused while a VDS / TDS entry is in a filed return, the books are locked, or a refund note has already paid this money back."
          >
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <p>
              Posts a reversing entry dated today — takes the money out of the account,
              {vds > 0 || tds > 0 ? ' voids its VDS / TDS entries,' : ''} removes the payment from the invoice and project, and marks it <strong className="font-semibold">Reversed</strong>.
            </p>
          </div>
          <div>
            <Label required>Reason</Label>
            <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={500}
              placeholder="e.g. Recorded into the wrong bank account"
              className="resize-none" />
          </div>
        </div>

        <div className="flex shrink-0 flex-col-reverse gap-2 rounded-b-2xl border-t border-gray-100 bg-gray-50/60 px-6 py-3.5 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={submit} loading={saving} disabled={trimmed.length < 5}>
            {!saving && <RotateCcw />} Reverse payment
          </Button>
        </div>
      </div>
    </div>
  )
}
