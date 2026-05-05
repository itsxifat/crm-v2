'use client'

import { useState, useEffect } from 'react'
import { toast } from 'react-hot-toast'
import { Send, Loader2, X, AlertCircle, Inbox } from 'lucide-react'

const fmt = (n) => `৳${(n ?? 0).toLocaleString('en-BD', { minimumFractionDigits: 2 })}`
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

const STATUS_COLORS = {
  PENDING:  'bg-yellow-100 text-yellow-700',
  APPROVED: 'bg-green-100 text-green-700',
  PAID:     'bg-teal-100 text-teal-700',
  REJECTED: 'bg-red-100 text-red-600',
}

const METHODS = ['BKASH', 'BANK', 'PAYPAL', 'OTHER']

const ic = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900'

export default function FreelancerPaymentRequestsPage() {
  const [freelancer,  setFreelancer]  = useState(null)
  const [requests,    setRequests]    = useState([])
  const [loading,     setLoading]     = useState(true)
  const [showModal,   setShowModal]   = useState(false)
  const [form,        setForm]        = useState({ amount: '', method: 'BKASH', paymentDetails: '' })
  const [submitting,  setSubmitting]  = useState(false)

  async function load() {
    try {
      const [dashRes, wdRes] = await Promise.all([
        fetch('/api/freelancer/dashboard'),
        fetch('/api/freelancer/withdrawals'),
      ])
      const dash = await dashRes.json()
      const wd   = await wdRes.json()
      if (!dashRes.ok) throw new Error(dash.error)
      setFreelancer(dash.data?.freelancer)
      setRequests(wd.data ?? [])
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function submitRequest(e) {
    e.preventDefault()
    if (!form.amount || Number(form.amount) <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    if (Number(form.amount) > (freelancer?.withdrawableBalance ?? 0)) {
      toast.error('Amount exceeds withdrawable balance')
      return
    }
    setSubmitting(true)
    try {
      const res  = await fetch('/api/freelancer/withdrawals', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          amount:         Number(form.amount),
          method:         form.method,
          paymentDetails: form.paymentDetails || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Payment request submitted!')
      setShowModal(false)
      setForm({ amount: '', method: 'BKASH', paymentDetails: '' })
      load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return (
    <div className="flex justify-center py-20">
      <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
    </div>
  )

  const withdrawable = freelancer?.withdrawableBalance ?? 0

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Payment Requests</h1>
          <p className="text-sm text-gray-400 mt-0.5">Request payment from your withdrawable balance</p>
        </div>
        <button
          onClick={() => setShowModal(true)}
          disabled={withdrawable <= 0}
          className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-40 transition-colors"
        >
          <Send className="w-4 h-4" /> New Request
        </button>
      </div>

      {/* Available balance info */}
      <div className="bg-white rounded-2xl border border-gray-100 p-5 flex items-center justify-between">
        <div>
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide">Withdrawable Balance</p>
          <p className="text-2xl font-bold text-gray-900 mt-0.5">{fmt(withdrawable)}</p>
        </div>
        {withdrawable <= 0 && (
          <div className="flex items-center gap-2 text-yellow-600 bg-yellow-50 border border-yellow-100 rounded-xl px-4 py-2.5">
            <AlertCircle className="w-4 h-4 shrink-0" />
            <p className="text-sm">No balance available yet</p>
          </div>
        )}
      </div>

      {/* Request History */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Request History</h2>
        </div>

        {requests.length === 0 ? (
          <div className="py-16 text-center">
            <Inbox className="w-10 h-10 text-gray-200 mx-auto mb-3" />
            <p className="text-sm text-gray-400">No payment requests yet</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[500px]">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  {['Date', 'Amount', 'Method', 'Status', 'Admin Note'].map(h => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {requests.map(r => (
                  <tr key={r.id ?? r._id} className="hover:bg-gray-50/50">
                    <td className="px-5 py-3.5 text-sm text-gray-600">{fmtDate(r.createdAt)}</td>
                    <td className="px-5 py-3.5 text-sm font-medium text-gray-900">{fmt(r.amount)}</td>
                    <td className="px-5 py-3.5 text-sm text-gray-600">{r.method}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1.5">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[r.status] ?? 'bg-gray-100 text-gray-600'}`}>
                          {r.status}
                        </span>
                        {r.isDirectPayment && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                            Direct Pay
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-400">{r.adminNote ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* New Payment Request Modal */}
      {showModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl border border-gray-200 w-full max-w-md p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-semibold text-gray-900">New Payment Request</h3>
              <button onClick={() => setShowModal(false)} className="p-1 rounded-lg hover:bg-gray-100">
                <X className="w-4 h-4 text-gray-400" />
              </button>
            </div>

            <div className="bg-gray-50 rounded-lg px-4 py-3">
              <p className="text-xs text-gray-500">Available balance</p>
              <p className="text-xl font-bold text-gray-900">{fmt(withdrawable)}</p>
            </div>

            <form onSubmit={submitRequest} className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Amount (৳) <span className="text-red-500">*</span>
                </label>
                <input
                  type="number"
                  step="0.01"
                  min="1"
                  max={withdrawable}
                  value={form.amount}
                  onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
                  placeholder="0.00"
                  className={ic}
                  required
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">
                  Payment Method <span className="text-red-500">*</span>
                </label>
                <select value={form.method} onChange={e => setForm(f => ({ ...f, method: e.target.value }))} className={ic} required>
                  {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-500 mb-1">Payment Details</label>
                <textarea
                  value={form.paymentDetails}
                  onChange={e => setForm(f => ({ ...f, paymentDetails: e.target.value }))}
                  placeholder="Account number, bKash number, bank details, etc."
                  rows={3}
                  className={`${ic} resize-none`}
                />
              </div>

              <div className="flex gap-2 justify-end pt-1">
                <button type="button" onClick={() => setShowModal(false)}
                  className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">
                  Cancel
                </button>
                <button type="submit" disabled={submitting}
                  className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-40 flex items-center gap-2">
                  {submitting && <Loader2 className="w-4 h-4 animate-spin" />}
                  Submit Request
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  )
}
