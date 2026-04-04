'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Search, X, Loader2, Copy, Trash2, Eye, FileText } from 'lucide-react'
import toast from 'react-hot-toast'
import Link from 'next/link'

const STATUS_STYLES = {
  DRAFT:    { badge: 'bg-gray-100 text-gray-600',    label: 'Draft' },
  SENT:     { badge: 'bg-blue-100 text-blue-700',    label: 'Sent' },
  ACCEPTED: { badge: 'bg-green-100 text-green-700',  label: 'Accepted' },
  REJECTED: { badge: 'bg-red-100 text-red-600',      label: 'Rejected' },
}

const fmt     = (n) => `৳ ${(n ?? 0).toLocaleString('en-BD', { minimumFractionDigits: 2 })}`
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

export default function QuotationsPage() {
  const router = useRouter()
  const [quotations, setQuotations] = useState([])
  const [loading,    setLoading]    = useState(true)
  const [search,     setSearch]     = useState('')
  const [status,     setStatus]     = useState('')
  const [page,       setPage]       = useState(1)
  const [total,      setTotal]      = useState(0)
  const [deleting,   setDeleting]   = useState(null)
  const limit = 20

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams({ page, limit })
      if (search) p.set('search', search)
      if (status) p.set('status', status)
      const res  = await fetch(`/api/quotations?${p}`)
      const json = await res.json()
      setQuotations(json.data ?? [])
      setTotal(json.meta?.total ?? 0)
    } catch { toast.error('Failed to load') }
    finally { setLoading(false) }
  }, [page, search, status])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [search, status])

  async function duplicate(id) {
    try {
      const res  = await fetch(`/api/quotations/${id}/duplicate`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Quotation duplicated')
      router.push(`/admin/quotations/${json.data.id}`)
    } catch (err) { toast.error(err.message) }
  }

  async function del(id) {
    setDeleting(id)
    try {
      const res = await fetch(`/api/quotations/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Deleted')
      load()
    } catch (err) { toast.error(err.message) }
    finally { setDeleting(null) }
  }

  const pages = Math.ceil(total / limit)

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Quotations</h1>
          <p className="text-sm text-gray-400 mt-0.5">{total} quotation{total !== 1 ? 's' : ''}</p>
        </div>
        <Link href="/admin/quotations/new"
          className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-gray-800 transition-colors">
          <Plus className="w-4 h-4" /> New Quotation
        </Link>
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by number, name, company…"
            className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
          {search && <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2"><X className="w-4 h-4 text-gray-400" /></button>}
        </div>
        <select value={status} onChange={e => setStatus(e.target.value)}
          className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 bg-white">
          <option value="">All Status</option>
          {Object.entries(STATUS_STYLES).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
        ) : quotations.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <FileText className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No quotations yet</p>
            <Link href="/admin/quotations/new" className="mt-3 inline-block text-sm text-blue-600 hover:underline">Create your first quotation</Link>
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px]">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    {['Quotation #', 'Recipient', 'Source', 'Total', 'Issue Date', 'Valid Until', 'Status', ''].map(h => (
                      <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {quotations.map(q => {
                    const s = STATUS_STYLES[q.status] ?? STATUS_STYLES.DRAFT
                    return (
                      <tr key={q.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3">
                          <Link href={`/admin/quotations/${q.id}`} className="text-sm font-mono font-medium text-gray-900 hover:text-blue-600">
                            {q.quotationNumber}
                          </Link>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-sm font-medium text-gray-800">{q.recipientName || '—'}</p>
                          {q.recipientCompany && <p className="text-xs text-gray-400">{q.recipientCompany}</p>}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${q.sourceType === 'LEAD' ? 'bg-purple-50 text-purple-700' : 'bg-teal-50 text-teal-700'}`}>
                            {q.sourceType === 'LEAD' ? 'Lead' : 'Client'}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-sm font-semibold text-gray-800">{fmt(q.total)}</td>
                        <td className="px-4 py-3 text-xs text-gray-500">{fmtDate(q.issueDate)}</td>
                        <td className="px-4 py-3 text-xs text-gray-500">{fmtDate(q.validUntil)}</td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${s.badge}`}>{s.label}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 justify-end">
                            <Link href={`/admin/quotations/${q.id}`}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
                              <Eye className="w-3.5 h-3.5" />
                            </Link>
                            <button onClick={() => duplicate(q.id)}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
                              <Copy className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => del(q.id)} disabled={deleting === q.id}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-40">
                              {deleting === q.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
            {pages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                <p className="text-xs text-gray-400">Page {page} of {pages} · {total} total</p>
                <div className="flex gap-2">
                  <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">Previous</button>
                  <button disabled={page >= pages} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">Next</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
