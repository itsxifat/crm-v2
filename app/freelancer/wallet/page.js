'use client'

import { useState, useEffect } from 'react'
import { toast } from 'react-hot-toast'
import { Wallet, Clock, Loader2 } from 'lucide-react'

const fmt = (n) => `৳${(n ?? 0).toLocaleString('en-BD', { minimumFractionDigits: 2 })}`
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

const STATUS_COLORS = {
  PENDING:  'bg-yellow-100 text-yellow-700',
  APPROVED: 'bg-green-100 text-green-700',
  PAID:     'bg-teal-100 text-teal-700',
  REJECTED: 'bg-red-100 text-red-600',
}

export default function FreelancerWalletPage() {
  const [freelancer,  setFreelancer]  = useState(null)
  const [withdrawals, setWithdrawals] = useState([])
  const [loading,     setLoading]     = useState(true)

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
      setWithdrawals(wd.data ?? [])
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  if (loading) return (
    <div className="flex justify-center py-20">
      <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
    </div>
  )

  return (
    <div className="space-y-6 max-w-4xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Wallet</h1>
        <p className="text-sm text-gray-400 mt-0.5">Your earnings overview</p>
      </div>

      {/* Balance Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-yellow-50 rounded-xl flex items-center justify-center">
              <Clock className="w-5 h-5 text-yellow-600" />
            </div>
            <p className="text-sm text-gray-500 font-medium">Pending Balance</p>
          </div>
          <p className="text-2xl font-bold text-gray-900">{fmt(freelancer?.pendingBalance)}</p>
          <p className="text-xs text-gray-400 mt-1">Awaiting admin approval</p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <div className="flex items-center gap-3 mb-3">
            <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center">
              <Wallet className="w-5 h-5 text-green-600" />
            </div>
            <p className="text-sm text-gray-500 font-medium">Withdrawable Balance</p>
          </div>
          <p className="text-2xl font-bold text-gray-900">{fmt(freelancer?.withdrawableBalance)}</p>
          <p className="text-xs text-gray-400 mt-1">Available for payment request</p>
        </div>
      </div>

      {/* Payment Request History */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Payment Request History</h2>
        </div>

        {withdrawals.length === 0 ? (
          <div className="py-16 text-center text-gray-400 text-sm">No payment requests yet</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[500px]">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  {['Date', 'Amount', 'Method', 'Status', 'Notes'].map(h => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {withdrawals.map(w => (
                  <tr key={w.id ?? w._id} className="hover:bg-gray-50/50">
                    <td className="px-5 py-3.5 text-sm text-gray-600">{fmtDate(w.createdAt)}</td>
                    <td className="px-5 py-3.5 text-sm font-medium text-gray-900">{fmt(w.amount)}</td>
                    <td className="px-5 py-3.5 text-sm text-gray-600">{w.method}</td>
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1.5">
                        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[w.status] ?? 'bg-gray-100 text-gray-600'}`}>
                          {w.status}
                        </span>
                        {w.isDirectPayment && (
                          <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-700">
                            Direct Pay
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-400">{w.adminNote ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
