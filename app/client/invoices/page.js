'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { FileText, Search, DollarSign, Clock, CheckCircle, AlertCircle, ChevronLeft, ChevronRight } from 'lucide-react'

const STATUS_OPTIONS = [
  { value: 'ALL',           label: 'All' },
  { value: 'SENT',          label: 'Awaiting Payment' },
  { value: 'PARTIALLY_PAID',label: 'Partial' },
  { value: 'PAID',          label: 'Paid' },
  { value: 'OVERDUE',       label: 'Overdue' },
  { value: 'DRAFT',         label: 'Draft' },
]

const STATUS_MAP = {
  DRAFT:          { label: 'Draft',             bg: 'bg-gray-100',   text: 'text-gray-700' },
  SENT:           { label: 'Awaiting Payment',  bg: 'bg-blue-100',   text: 'text-blue-700' },
  PARTIALLY_PAID: { label: 'Partial',           bg: 'bg-yellow-100', text: 'text-yellow-700' },
  PAID:           { label: 'Paid',              bg: 'bg-green-100',  text: 'text-green-700' },
  OVERDUE:        { label: 'Overdue',           bg: 'bg-red-100',    text: 'text-red-700' },
  CANCELLED:      { label: 'Cancelled',         bg: 'bg-gray-100',   text: 'text-gray-500' },
}

function StatusBadge({ status }) {
  const s = STATUS_MAP[status] ?? STATUS_MAP.DRAFT
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  )
}

export default function ClientInvoicesPage() {
  const [invoices, setInvoices]   = useState([])
  const [loading, setLoading]     = useState(true)
  const [error, setError]         = useState(null)
  const [status, setStatus]       = useState('ALL')
  const [search, setSearch]       = useState('')
  const [page, setPage]           = useState(1)
  const [total, setTotal]         = useState(0)
  const [pages, setPages]         = useState(1)
  const limit                     = 20

  useEffect(() => {
    setLoading(true)
    const params = new URLSearchParams({ page, limit })
    if (status !== 'ALL') params.set('status', status)
    fetch(`/api/client/invoices?${params}`)
      .then(r => r.json())
      .then(d => {
        setInvoices(d.invoices ?? [])
        setTotal(d.total ?? 0)
        setPages(d.pages ?? 1)
      })
      .catch(() => setError('Failed to load invoices'))
      .finally(() => setLoading(false))
  }, [status, page])

  const filtered = search
    ? invoices.filter(i => i.invoiceNumber?.toLowerCase().includes(search.toLowerCase()))
    : invoices

  const totalPaid    = invoices.filter(i => i.status === 'PAID').reduce((s, i) => s + (i.total ?? 0), 0)
  const totalPending = invoices.filter(i => ['SENT','OVERDUE','PARTIALLY_PAID'].includes(i.status)).reduce((s, i) => s + (i.total ?? 0), 0)
  const overdue      = invoices.filter(i => i.status === 'OVERDUE').length

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Invoices</h1>
        <p className="text-sm text-gray-500 mt-0.5">{total} invoice{total !== 1 ? 's' : ''} total</p>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-4">
        <div className="bg-white border border-gray-100 rounded-xl p-4 flex items-center gap-3">
          <div className="w-9 h-9 bg-green-50 rounded-lg flex items-center justify-center shrink-0">
            <CheckCircle className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <p className="text-xs text-gray-500">Total Paid</p>
            <p className="text-base font-bold text-gray-900">${totalPaid.toLocaleString()}</p>
          </div>
        </div>
        <div className="bg-white border border-gray-100 rounded-xl p-4 flex items-center gap-3">
          <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center shrink-0">
            <Clock className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <p className="text-xs text-gray-500">Pending</p>
            <p className="text-base font-bold text-gray-900">${totalPending.toLocaleString()}</p>
          </div>
        </div>
        <div className="bg-white border border-gray-100 rounded-xl p-4 flex items-center gap-3 col-span-2 sm:col-span-1">
          <div className="w-9 h-9 bg-red-50 rounded-lg flex items-center justify-center shrink-0">
            <AlertCircle className="w-5 h-5 text-red-500" />
          </div>
          <div>
            <p className="text-xs text-gray-500">Overdue</p>
            <p className="text-base font-bold text-gray-900">{overdue}</p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search invoice #..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <div className="flex gap-2 flex-wrap">
          {STATUS_OPTIONS.map(opt => (
            <button key={opt.value} onClick={() => { setStatus(opt.value); setPage(1) }}
              className={`px-3 py-2 rounded-xl text-xs font-medium border transition-colors ${
                status === opt.value
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-600'
              }`}>
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
        {loading ? (
          <div className="divide-y divide-gray-50">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="px-6 py-4 flex items-center gap-4 animate-pulse">
                <div className="h-4 bg-gray-100 rounded w-32" />
                <div className="h-4 bg-gray-100 rounded w-24 ml-auto" />
                <div className="h-4 bg-gray-100 rounded w-20" />
                <div className="h-5 bg-gray-100 rounded-full w-16" />
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="p-12 text-center text-red-500 text-sm">{error}</div>
        ) : filtered.length === 0 ? (
          <div className="p-16 text-center">
            <FileText className="w-12 h-12 text-gray-200 mx-auto mb-3" />
            <p className="text-gray-500 font-medium">No invoices found</p>
            <p className="text-gray-400 text-sm mt-1">Invoices will appear here once your projects are billed.</p>
          </div>
        ) : (
          <table className="w-full">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Invoice</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide hidden sm:table-cell">Project</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">Due Date</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Amount</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filtered.map(inv => (
                <tr key={inv.id} className="hover:bg-gray-50/60 transition-colors">
                  <td className="px-5 py-3.5">
                    <p className="text-sm font-semibold text-gray-900">{inv.invoiceNumber}</p>
                    <p className="text-xs text-gray-400 mt-0.5">{new Date(inv.issueDate).toLocaleDateString()}</p>
                  </td>
                  <td className="px-5 py-3.5 hidden sm:table-cell">
                    <p className="text-sm text-gray-600 truncate max-w-[140px]">{inv.projectId?.name ?? '—'}</p>
                  </td>
                  <td className="px-5 py-3.5 hidden md:table-cell">
                    <p className="text-sm text-gray-600">
                      {inv.dueDate ? new Date(inv.dueDate).toLocaleDateString() : '—'}
                    </p>
                  </td>
                  <td className="px-5 py-3.5">
                    <p className="text-sm font-bold text-gray-900">${(inv.total ?? 0).toLocaleString()}</p>
                    {inv.paidAmount > 0 && inv.paidAmount < inv.total && (
                      <p className="text-xs text-green-600 mt-0.5">${inv.paidAmount.toLocaleString()} paid</p>
                    )}
                  </td>
                  <td className="px-5 py-3.5">
                    <StatusBadge status={inv.status} />
                  </td>
                  <td className="px-5 py-3.5 text-right">
                    <Link href={`/client/invoices/${inv.id}`}
                      className={`inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                        ['SENT','OVERDUE','PARTIALLY_PAID'].includes(inv.status)
                          ? 'bg-blue-600 text-white hover:bg-blue-700'
                          : 'text-blue-600 hover:text-blue-700 border border-blue-100 hover:border-blue-300'
                      }`}>
                      {['SENT','OVERDUE','PARTIALLY_PAID'].includes(inv.status) ? 'Pay Now' : 'View'}
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-500">Page {page} of {pages}</p>
          <div className="flex gap-2">
            <button onClick={() => setPage(p => Math.max(1, p - 1))} disabled={page === 1}
              className="flex items-center gap-1 px-3 py-2 text-sm border border-gray-200 rounded-xl hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              <ChevronLeft className="w-4 h-4" /> Prev
            </button>
            <button onClick={() => setPage(p => Math.min(pages, p + 1))} disabled={page === pages}
              className="flex items-center gap-1 px-3 py-2 text-sm border border-gray-200 rounded-xl hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              Next <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
