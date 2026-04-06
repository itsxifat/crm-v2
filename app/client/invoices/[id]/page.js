'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import {
  ArrowLeft, CheckCircle, Clock, AlertCircle, XCircle,
  FileText, CreditCard, X, Upload,
} from 'lucide-react'

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const fmtAmt  = (n) => `৳ ${(n ?? 0).toLocaleString('en-BD', { minimumFractionDigits: 2 })}`

const STATUS_MAP = {
  DRAFT:          { label: 'Draft',            bg: 'bg-gray-100',    text: 'text-gray-600',   icon: FileText },
  SENT:           { label: 'Awaiting Payment', bg: 'bg-blue-100',    text: 'text-blue-700',   icon: Clock },
  PARTIALLY_PAID: { label: 'Partially Paid',   bg: 'bg-yellow-100',  text: 'text-yellow-700', icon: Clock },
  PAID:           { label: 'Paid',             bg: 'bg-green-100',   text: 'text-green-700',  icon: CheckCircle },
  OVERDUE:        { label: 'Overdue',          bg: 'bg-red-100',     text: 'text-red-600',    icon: AlertCircle },
  CANCELLED:      { label: 'Cancelled',        bg: 'bg-gray-100',    text: 'text-gray-500',   icon: XCircle },
}

const PAYMENT_METHODS = [
  { value: 'BANK_TRANSFER', label: 'Bank Transfer' },
  { value: 'CASH',          label: 'Cash' },
  { value: 'CARD',          label: 'Card' },
  { value: 'CHEQUE',        label: 'Cheque' },
  { value: 'ONLINE',        label: 'Online Transfer' },
  { value: 'OTHER',         label: 'Other' },
]

const CONFIRM_STATUS = {
  PENDING_CONFIRMATION: { label: 'Pending Approval', bg: 'bg-yellow-100', text: 'text-yellow-700' },
  CONFIRMED:            { label: 'Confirmed',         bg: 'bg-green-100',  text: 'text-green-700' },
  REJECTED:             { label: 'Rejected',          bg: 'bg-red-100',    text: 'text-red-600' },
}

function PaymentModal({ invoice, onClose, onDone }) {
  const [form, setForm]     = useState({ amount: '', method: 'BANK_TRANSFER', date: '', notes: '', receiptUrl: '' })
  const [saving, setSaving] = useState(false)

  const balance = (invoice.total ?? 0) - (invoice.paidAmount ?? 0)

  async function submit(e) {
    e.preventDefault()
    if (!form.amount || Number(form.amount) <= 0) return toast.error('Enter a valid amount')
    setSaving(true)
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/payment-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount:        Number(form.amount),
          paymentMethod: form.method,
          paymentDate:   form.date || undefined,
          notes:         form.notes || undefined,
          receiptUrl:    form.receiptUrl || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Payment request submitted!')
      onDone()
      onClose()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">Submit Payment</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X className="w-5 h-5" /></button>
        </div>
        <p className="text-sm text-gray-500">Outstanding balance: <span className="font-semibold text-gray-800">{fmtAmt(balance)}</span></p>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Amount *</label>
            <input
              type="number" step="0.01" min="0.01" max={balance}
              value={form.amount}
              onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
              placeholder={balance.toFixed(2)}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              required
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Payment Method</label>
            <select
              value={form.method}
              onChange={e => setForm(f => ({ ...f, method: e.target.value }))}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              {PAYMENT_METHODS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Payment Date</label>
            <input
              type="date"
              value={form.date}
              onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Receipt URL (optional)</label>
            <input
              type="url"
              value={form.receiptUrl}
              onChange={e => setForm(f => ({ ...f, receiptUrl: e.target.value }))}
              placeholder="https://..."
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Notes (optional)</label>
            <textarea
              value={form.notes}
              onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
              rows={2}
              className="w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>
          <div className="flex gap-2 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2.5 border border-gray-200 rounded-xl text-sm font-medium text-gray-600 hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 px-4 py-2.5 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 disabled:opacity-60">
              {saving ? 'Submitting…' : 'Submit Payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

export default function ClientInvoiceDetailPage() {
  const { id } = useParams()
  const router  = useRouter()

  const [invoice,       setInvoice]       = useState(null)
  const [paymentReqs,   setPaymentReqs]   = useState([])
  const [loading,       setLoading]       = useState(true)
  const [showPayModal,  setShowPayModal]  = useState(false)

  async function load() {
    try {
      const [invRes, reqRes] = await Promise.all([
        fetch(`/api/client/invoices/${id}`),
        fetch(`/api/invoices/${id}/payment-request`),
      ])
      const invJson = await invRes.json()
      if (!invRes.ok) throw new Error(invJson.error ?? 'Not found')
      setInvoice(invJson.data)
      if (reqRes.ok) {
        const reqJson = await reqRes.json()
        setPaymentReqs(reqJson.data ?? [])
      }
    } catch (err) {
      toast.error(err.message)
      router.push('/client/invoices')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [id])

  if (loading) return (
    <div className="space-y-4 animate-pulse">
      <div className="h-6 bg-gray-100 rounded w-40" />
      <div className="h-48 bg-gray-100 rounded-2xl" />
      <div className="h-32 bg-gray-100 rounded-2xl" />
    </div>
  )

  if (!invoice) return null

  const status  = STATUS_MAP[invoice.status] ?? STATUS_MAP.DRAFT
  const StatusIcon = status.icon
  const balance = (invoice.total ?? 0) - (invoice.paidAmount ?? 0)
  const canPay  = ['SENT', 'OVERDUE', 'PARTIALLY_PAID'].includes(invoice.status)

  return (
    <div className="space-y-6">
      {showPayModal && (
        <PaymentModal invoice={invoice} onClose={() => setShowPayModal(false)} onDone={load} />
      )}

      {/* Header */}
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/client/invoices"
            className="p-2 rounded-xl border border-gray-200 hover:bg-gray-50 text-gray-500 transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{invoice.invoiceNumber}</h1>
            <p className="text-xs text-gray-400 mt-0.5">{invoice.projectId?.name ?? '—'}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-medium ${status.bg} ${status.text}`}>
            <StatusIcon className="w-3.5 h-3.5" />
            {status.label}
          </span>
          {canPay && (
            <button onClick={() => setShowPayModal(true)}
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white rounded-xl text-sm font-medium hover:bg-blue-700 transition-colors">
              <CreditCard className="w-4 h-4" />
              Pay Now
            </button>
          )}
        </div>
      </div>

      {/* Invoice Info */}
      <div className="bg-white border border-gray-100 rounded-2xl p-5 space-y-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-sm">
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Issue Date</p>
            <p className="font-medium text-gray-800">{fmtDate(invoice.issueDate)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Due Date</p>
            <p className="font-medium text-gray-800">{fmtDate(invoice.dueDate)}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Project</p>
            <p className="font-medium text-gray-800">{invoice.projectId?.name ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 mb-0.5">Currency</p>
            <p className="font-medium text-gray-800">{invoice.currency ?? 'BDT'}</p>
          </div>
        </div>

        {invoice.notes && (
          <div className="border-t border-gray-50 pt-3">
            <p className="text-xs text-gray-400 mb-1">Notes</p>
            <p className="text-sm text-gray-600 whitespace-pre-line">{invoice.notes}</p>
          </div>
        )}
      </div>

      {/* Line Items */}
      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
        <div className="px-5 py-3 border-b border-gray-50">
          <h2 className="text-sm font-semibold text-gray-700">Items</h2>
        </div>
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50">
              <th className="px-5 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Description</th>
              <th className="px-5 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Qty</th>
              <th className="px-5 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Rate</th>
              <th className="px-5 py-2.5 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {(invoice.items ?? []).map((item, i) => (
              <tr key={i}>
                <td className="px-5 py-3 text-gray-700">{item.description}</td>
                <td className="px-5 py-3 text-right text-gray-600">{item.quantity}</td>
                <td className="px-5 py-3 text-right text-gray-600">{fmtAmt(item.rate)}</td>
                <td className="px-5 py-3 text-right font-medium text-gray-800">{fmtAmt(item.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="border-t border-gray-100 px-5 py-4 space-y-1.5">
          <div className="flex justify-between text-sm text-gray-600">
            <span>Subtotal</span>
            <span>{fmtAmt(invoice.subtotal)}</span>
          </div>
          {(invoice.taxRate > 0) && (
            <div className="flex justify-between text-sm text-gray-600">
              <span>Tax ({invoice.taxRate}%)</span>
              <span>{fmtAmt(invoice.taxAmount)}</span>
            </div>
          )}
          {(invoice.discount > 0) && (
            <div className="flex justify-between text-sm text-green-600">
              <span>Discount</span>
              <span>-{fmtAmt(invoice.discount)}</span>
            </div>
          )}
          <div className="flex justify-between text-base font-bold text-gray-900 border-t border-gray-100 pt-2 mt-2">
            <span>Total</span>
            <span>{fmtAmt(invoice.total)}</span>
          </div>
          {invoice.paidAmount > 0 && (
            <>
              <div className="flex justify-between text-sm text-green-600">
                <span>Paid</span>
                <span>{fmtAmt(invoice.paidAmount)}</span>
              </div>
              <div className="flex justify-between text-sm font-semibold text-gray-800">
                <span>Balance Due</span>
                <span>{fmtAmt(balance)}</span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Payment Requests */}
      {paymentReqs.length > 0 && (
        <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
          <div className="px-5 py-3 border-b border-gray-50">
            <h2 className="text-sm font-semibold text-gray-700">Payment Submissions</h2>
          </div>
          <div className="divide-y divide-gray-50">
            {paymentReqs.map(req => {
              const cs = CONFIRM_STATUS[req.status] ?? CONFIRM_STATUS.PENDING_CONFIRMATION
              return (
                <div key={req._id ?? req.id} className="px-5 py-3.5 flex items-center justify-between gap-4">
                  <div>
                    <p className="text-sm font-medium text-gray-800">{fmtAmt(req.amount)}</p>
                    <p className="text-xs text-gray-400 mt-0.5">
                      {req.paymentMethod?.replace('_', ' ')} · {fmtDate(req.paymentDate ?? req.createdAt)}
                    </p>
                    {req.notes && <p className="text-xs text-gray-500 mt-0.5">{req.notes}</p>}
                  </div>
                  <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${cs.bg} ${cs.text}`}>
                    {cs.label}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
