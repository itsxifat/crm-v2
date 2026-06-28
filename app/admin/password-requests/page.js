'use client'

import { useState, useEffect, useCallback } from 'react'
import { KeyRound, Check, X, Loader2, ShieldCheck, Clock } from 'lucide-react'
import toast from 'react-hot-toast'

const STATUS_META = {
  PENDING:   { label: 'Pending',   cls: 'bg-amber-100 text-amber-700' },
  APPROVED:  { label: 'Approved',  cls: 'bg-blue-100 text-blue-700' },
  REJECTED:  { label: 'Rejected',  cls: 'bg-red-100 text-red-600' },
  COMPLETED: { label: 'Completed', cls: 'bg-green-100 text-green-700' },
}

function timeAgo(d) {
  if (!d) return '—'
  const mins = Math.floor((Date.now() - new Date(d).getTime()) / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return new Date(d).toLocaleDateString()
}

export default function PasswordRequestsPage() {
  const [rows, setRows]       = useState([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy]       = useState(null)
  const [forbidden, setForbidden] = useState(false)

  const load = useCallback(async () => {
    try {
      const res  = await fetch('/api/password-reset-requests')
      if (res.status === 403) { setForbidden(true); return }
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setRows(json.data ?? [])
    } catch (err) {
      toast.error(err.message ?? 'Failed to load requests')
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  async function act(row, action) {
    const verb = action === 'approve' ? 'Approve' : 'Reject'
    if (!confirm(`${verb} the password reset for ${row.email}?`)) return
    setBusy(row.id)
    try {
      const res  = await fetch(`/api/password-reset-requests/${row.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      toast.success(action === 'approve'
        ? (json.emailSent ? 'Approved — reset link emailed' : 'Approved (email failed to send)')
        : 'Request rejected')
      load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(null)
    }
  }

  if (forbidden) {
    return (
      <div className="text-center py-24">
        <ShieldCheck className="w-10 h-10 text-gray-300 mx-auto mb-3" />
        <p className="text-sm text-gray-500">You don't have permission to manage password reset requests.</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
          <KeyRound className="w-5 h-5 text-gray-500" /> Client Password Resets
        </h1>
        <p className="text-sm text-gray-400 mt-0.5">Approve a request to email the client a one-time reset link.</p>
      </div>

      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
        ) : rows.length === 0 ? (
          <div className="text-center py-16 text-sm text-gray-400">No password reset requests.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50 border-b border-gray-100 text-left text-xs uppercase tracking-wider text-gray-500">
                  <th className="px-4 py-3 font-semibold">Client</th>
                  <th className="px-4 py-3 font-semibold">Company</th>
                  <th className="px-4 py-3 font-semibold">Requested</th>
                  <th className="px-4 py-3 font-semibold">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {rows.map(r => {
                  const meta = STATUS_META[r.status] ?? STATUS_META.PENDING
                  return (
                    <tr key={r.id} className="hover:bg-gray-50/50">
                      <td className="px-4 py-3">
                        <p className="font-medium text-gray-800">{r.user?.name ?? '—'}</p>
                        <p className="text-xs text-gray-400">{r.email}</p>
                      </td>
                      <td className="px-4 py-3 text-gray-500">
                        {r.client ? `${r.client.company || r.client.clientCode}` : '—'}
                      </td>
                      <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                        <span className="inline-flex items-center gap-1"><Clock className="w-3 h-3" />{timeAgo(r.createdAt)}</span>
                      </td>
                      <td className="px-4 py-3">
                        <span className={`inline-flex text-xs font-medium px-2 py-0.5 rounded-full ${meta.cls}`}>{meta.label}</span>
                        {r.reviewedBy && <span className="block text-[11px] text-gray-400 mt-0.5">by {r.reviewedBy}</span>}
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        {r.status === 'PENDING' ? (
                          <div className="inline-flex items-center gap-2">
                            <button
                              onClick={() => act(r, 'approve')}
                              disabled={busy === r.id}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-green-700 border border-green-200 rounded-lg hover:bg-green-50 disabled:opacity-50"
                            >
                              {busy === r.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Check className="w-3.5 h-3.5" />} Approve
                            </button>
                            <button
                              onClick={() => act(r, 'reject')}
                              disabled={busy === r.id}
                              className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50"
                            >
                              <X className="w-3.5 h-3.5" /> Reject
                            </button>
                          </div>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
