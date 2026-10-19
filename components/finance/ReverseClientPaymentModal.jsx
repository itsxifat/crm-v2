'use client'

import { useState } from 'react'
import { Loader2, RotateCcw, X } from 'lucide-react'
import toast from 'react-hot-toast'
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
      toast.success('Payment reversed — record it again with the right details')
      onDone?.(json)
      onClose?.()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl border border-gray-200 w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-100 shrink-0">
          <h3 className="text-base font-semibold text-gray-900">
            Reverse client payment{transaction?.txnId ? ` — ${transaction.txnId}` : ''}
          </h3>
          <button onClick={onClose} disabled={saving} className="p-1 rounded-lg hover:bg-gray-100" aria-label="Close">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-4">
          <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3">
            <p className="text-sm font-semibold text-gray-900">
              {cash > 0 ? formatMoney(cash, cur) : 'Tax withheld only'}
              {vds > 0 && <span className="text-xs font-normal text-gray-500"> + VDS {formatMoney(vds, 'BDT')}</span>}
              {tds > 0 && <span className="text-xs font-normal text-gray-500"> + TDS {formatMoney(tds, 'BDT')}</span>}
            </p>
            {(invoiceNo || projectName) && (
              <p className="text-xs text-gray-500 mt-0.5">
                {invoiceNo ? `Invoice ${invoiceNo}` : ''}{invoiceNo && projectName ? ' · ' : ''}{projectName ?? ''}
              </p>
            )}
            {(rec.description || payment?.accountId?.name) && (
              <p className="text-xs text-gray-400 mt-0.5">
                {rec.description ?? ''}{rec.description && payment?.accountId?.name ? ' · ' : ''}{payment?.accountId?.name ? `into ${payment.accountId.name}` : ''}
              </p>
            )}
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 space-y-1">
            <p>
              This posts a reversing entry (dated today) that takes the money back out of the account,
              {vds > 0 || tds > 0 ? ' voids the VDS / TDS entries it recorded,' : ''} takes the payment back off the invoice
              (its status is recomputed) and off the project, and marks the payment <strong>Reversed</strong>.
              Then record it again with the right details.
            </p>
            <p>It is refused while a VDS / TDS entry is in a filed return, when the books are locked, or when a refund note has already paid this money back.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Reason <span className="text-red-500">*</span></label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={500}
              placeholder="e.g. Recorded into the wrong bank account"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-900" />
          </div>
        </div>

        <div className="flex gap-2 justify-end px-4 sm:px-6 py-4 border-t border-gray-100 shrink-0">
          <button onClick={onClose} disabled={saving}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={submit} disabled={saving || trimmed.length < 5}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-60 flex items-center gap-1.5">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />} Reverse payment
          </button>
        </div>
      </div>
    </div>
  )
}
