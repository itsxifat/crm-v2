'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  FileText, Search, Clock, CheckCircle, AlertCircle, ChevronLeft, ChevronRight,
  Layers, List, FolderTree, ExternalLink,
} from 'lucide-react'

const STATUS_OPTIONS = [
  { value: 'ALL',            label: 'All' },
  { value: 'SENT',           label: 'Awaiting Payment' },
  { value: 'PARTIALLY_PAID', label: 'Partial' },
  { value: 'PAID',           label: 'Paid' },
  { value: 'OVERDUE',        label: 'Overdue' },
]

const STATUS_MAP = {
  SENT:           { label: 'Awaiting Payment',  bg: 'bg-blue-100',   text: 'text-blue-700' },
  PARTIALLY_PAID: { label: 'Partial',           bg: 'bg-yellow-100', text: 'text-yellow-700' },
  PAID:           { label: 'Paid',              bg: 'bg-green-100',  text: 'text-green-700' },
  OVERDUE:        { label: 'Overdue',           bg: 'bg-red-100',    text: 'text-red-700' },
  CANCELLED:      { label: 'Cancelled',         bg: 'bg-gray-100',   text: 'text-gray-500' },
}

const fmtAmt  = (n) => `৳ ${(Number(n) || 0).toLocaleString('en-BD', { minimumFractionDigits: 2 })}`
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

const isPayable = (status) => ['SENT', 'OVERDUE', 'PARTIALLY_PAID'].includes(status)

function StatusBadge({ status }) {
  const s = STATUS_MAP[status] ?? STATUS_MAP.SENT
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  )
}

export default function ClientInvoicesPage() {
  const [view,     setView]     = useState('list')     // 'list' | 'project'
  const [invoices, setInvoices] = useState([])
  const [groups,   setGroups]   = useState([])
  const [summary,  setSummary]  = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)
  const [status,   setStatus]   = useState('ALL')
  const [search,   setSearch]   = useState('')
  const [page,     setPage]     = useState(1)
  const [total,    setTotal]    = useState(0)
  const [pages,    setPages]    = useState(1)
  const [expanded, setExpanded] = useState(null)
  const limit = 20

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      if (view === 'project') {
        const p = new URLSearchParams({ groupBy: 'project' })
        if (status !== 'ALL') p.set('status', status)
        const [gRes, sRes] = await Promise.all([
          fetch(`/api/client/invoices?${p}`),
          fetch('/api/client/invoices?limit=1'),
        ])
        const gJson = await gRes.json()
        if (!gRes.ok) throw new Error(gJson.error ?? 'Failed to load')
        setGroups(gJson.projects ?? [])
        if (sRes.ok) setSummary((await sRes.json()).summary ?? null)
      } else {
        const p = new URLSearchParams({ page: String(page), limit: String(limit) })
        if (status !== 'ALL') p.set('status', status)
        const res  = await fetch(`/api/client/invoices?${p}`)
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Failed to load')
        setInvoices(json.invoices ?? [])
        setTotal(json.total ?? 0)
        setPages(json.pages ?? 1)
        setSummary(json.summary ?? null)
      }
    } catch (err) {
      setError(err.message ?? 'Failed to load invoices')
    } finally {
      setLoading(false)
    }
  }, [view, status, page])

  useEffect(() => { load() }, [load])

  const q = search.trim().toLowerCase()
  const filtered = q
    ? invoices.filter(i =>
        i.invoiceNumber?.toLowerCase().includes(q) ||
        (i.projectId?.name ?? '').toLowerCase().includes(q))
    : invoices
  const filteredGroups = q
    ? groups.filter(g =>
        (g.project?.name ?? '').toLowerCase().includes(q) ||
        (g.project?.projectCode ?? '').toLowerCase().includes(q) ||
        g.invoices.some(i => i.invoiceNumber?.toLowerCase().includes(q)))
    : groups

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Invoices</h1>
          <p className="text-sm text-gray-500 mt-0.5">
            {summary?.invoiceCount ?? total} invoice{(summary?.invoiceCount ?? total) !== 1 ? 's' : ''} total
          </p>
        </div>
        <div className="flex items-center gap-0.5 p-0.5 bg-gray-100 rounded-lg">
          {[
            ['list',    'All Invoices', List],
            ['project', 'By Project',   FolderTree],
          ].map(([v, label, Icon]) => (
            <button key={v} onClick={() => { setView(v); setPage(1); setExpanded(null) }}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors ${
                view === v ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}>
              <Icon className="w-3.5 h-3.5" /> {label}
            </button>
          ))}
        </div>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Billed', value: fmtAmt(summary?.billed),      icon: FileText,    bg: 'bg-gray-50',  color: 'text-gray-500' },
          { label: 'Total Paid',   value: fmtAmt(summary?.collected),   icon: CheckCircle, bg: 'bg-green-50', color: 'text-green-600' },
          { label: 'Outstanding',  value: fmtAmt(summary?.outstanding), icon: Clock,       bg: 'bg-blue-50',  color: 'text-blue-600' },
          { label: 'Overdue',      value: fmtAmt(summary?.overdueAmount), icon: AlertCircle, bg: 'bg-red-50', color: 'text-red-500',
            sub: `${summary?.overdueCount ?? 0} invoice${summary?.overdueCount === 1 ? '' : 's'}` },
        ].map(c => {
          const Icon = c.icon
          return (
            <div key={c.label} className="bg-white border border-gray-100 rounded-xl p-4 flex items-center gap-3">
              <div className={`w-9 h-9 ${c.bg} rounded-lg flex items-center justify-center shrink-0`}>
                <Icon className={`w-5 h-5 ${c.color}`} />
              </div>
              <div className="min-w-0">
                <p className="text-xs text-gray-500">{c.label}</p>
                <p className="text-base font-bold text-gray-900 truncate">{c.value}</p>
                {c.sub && <p className="text-xs text-gray-400">{c.sub}</p>}
              </div>
            </div>
          )
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder={view === 'project' ? 'Search project or invoice…' : 'Search invoice # or project…'}
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

      {/* ── PROJECT-WISE VIEW ── */}
      {view === 'project' ? (
        <div className="bg-white border border-gray-100 rounded-2xl overflow-hidden">
          {loading ? (
            <div className="divide-y divide-gray-50">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="px-6 py-5 animate-pulse">
                  <div className="h-4 bg-gray-100 rounded w-48 mb-2" />
                  <div className="h-3 bg-gray-100 rounded w-32" />
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="p-12 text-center text-red-500 text-sm">{error}</div>
          ) : filteredGroups.length === 0 ? (
            <div className="p-16 text-center">
              <FolderTree className="w-12 h-12 text-gray-200 mx-auto mb-3" />
              <p className="text-gray-500 font-medium">No invoiced projects yet</p>
              <p className="text-gray-400 text-sm mt-1">Invoices will appear here once your projects are billed.</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {filteredGroups.map(g => {
                const key    = g.projectId ?? '__none__'
                const isOpen = expanded === key
                return (
                  <div key={key}>
                    <button onClick={() => setExpanded(isOpen ? null : key)}
                      className="w-full px-5 py-4 flex items-center gap-4 hover:bg-gray-50/70 transition-colors text-left">
                      <ChevronRight className={`w-4 h-4 text-gray-300 shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-semibold text-gray-900 truncate">
                            {g.project?.name ?? 'Other invoices'}
                          </span>
                          {g.project?.projectCode && (
                            <span className="text-xs font-mono text-gray-400">{g.project.projectCode}</span>
                          )}
                          <StatusBadge status={g.status} />
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {g.invoiceCount} invoice{g.invoiceCount === 1 ? '' : 's'}
                          {g.combined && ` · Combined ${g.combined.combinedNumber}`}
                        </p>
                      </div>
                      <div className="hidden sm:grid grid-cols-3 gap-6 shrink-0 text-right">
                        <div>
                          <p className="text-xs text-gray-400">Billed</p>
                          <p className="text-sm font-semibold text-gray-900">{fmtAmt(g.total)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-400">Paid</p>
                          <p className="text-sm font-semibold text-green-600">{fmtAmt(g.paidAmount)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-400">Due</p>
                          <p className={`text-sm font-semibold ${g.due > 0.01 ? 'text-red-600' : 'text-green-600'}`}>{fmtAmt(g.due)}</p>
                        </div>
                      </div>
                    </button>

                    {isOpen && (
                      <div className="bg-gray-50/60 px-5 pb-4">
                        {g.combined && (
                          <Link href={`/client/invoices/combined/${g.combined.id}`}
                            className="mb-3 flex items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50 px-4 py-3 hover:bg-blue-100 transition-colors">
                            <div className="flex items-center gap-2.5 min-w-0">
                              <Layers className="w-4 h-4 text-blue-600 shrink-0" />
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-blue-800">Combined invoice {g.combined.combinedNumber}</p>
                                <p className="text-xs text-blue-600/80">
                                  All {g.invoiceCount} invoices in one document · {fmtAmt(g.due)} still due
                                </p>
                              </div>
                            </div>
                            <ExternalLink className="w-4 h-4 text-blue-500 shrink-0" />
                          </Link>
                        )}
                        <div className="rounded-xl border border-gray-100 bg-white divide-y divide-gray-50">
                          {g.invoices.map(inv => (
                            <Link key={inv.id} href={`/client/invoices/${inv.id}`}
                              className="flex items-center justify-between gap-4 px-4 py-3 hover:bg-gray-50/70 transition-colors">
                              <div className="min-w-0">
                                <p className="text-sm font-semibold text-gray-900">{inv.invoiceNumber}</p>
                                <p className="text-xs text-gray-400 mt-0.5">
                                  Issued {fmtDate(inv.issueDate)}{inv.dueDate ? ` · Due ${fmtDate(inv.dueDate)}` : ''}
                                </p>
                              </div>
                              <div className="flex items-center gap-4 shrink-0">
                                <div className="text-right">
                                  <p className="text-sm font-bold text-gray-900">{fmtAmt(inv.total)}</p>
                                  <p className={`text-xs mt-0.5 ${inv.due > 0.01 ? 'text-red-500' : 'text-green-600'}`}>
                                    {inv.due > 0.01 ? `${fmtAmt(inv.due)} due` : 'Paid in full'}
                                  </p>
                                </div>
                                <StatusBadge status={inv.status} />
                                <span className={`inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium ${
                                  isPayable(inv.status)
                                    ? 'bg-blue-600 text-white'
                                    : 'text-blue-600 border border-blue-100'
                                }`}>
                                  {isPayable(inv.status) ? 'Pay Now' : 'View'}
                                </span>
                              </div>
                            </Link>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </div>
      ) : (
        /* ── FLAT LIST ── */
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
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px]">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Invoice</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Project</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide hidden md:table-cell">Due Date</th>
                    <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Amount</th>
                    <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Paid</th>
                    <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Due</th>
                    <th className="px-5 py-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide">Status</th>
                    <th className="px-5 py-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {filtered.map(inv => (
                    <tr key={inv.id} className="hover:bg-gray-50/60 transition-colors">
                      <td className="px-5 py-3.5">
                        <p className="text-sm font-semibold text-gray-900">{inv.invoiceNumber}</p>
                        <p className="text-xs text-gray-400 mt-0.5">{fmtDate(inv.issueDate)}</p>
                      </td>
                      <td className="px-5 py-3.5">
                        <p className="text-sm text-gray-600 truncate max-w-[160px]">{inv.projectId?.name ?? '—'}</p>
                        {inv.combined && (
                          <Link href={`/client/invoices/combined/${inv.combined.id}`}
                            className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-600 border border-blue-100 hover:bg-blue-100">
                            <Layers className="w-2.5 h-2.5" /> Combined
                          </Link>
                        )}
                      </td>
                      <td className="px-5 py-3.5 hidden md:table-cell">
                        <p className="text-sm text-gray-600">{fmtDate(inv.dueDate)}</p>
                      </td>
                      <td className="px-5 py-3.5 text-right text-sm font-bold text-gray-900 whitespace-nowrap">{fmtAmt(inv.total)}</td>
                      <td className="px-5 py-3.5 text-right text-sm text-green-600 whitespace-nowrap">{fmtAmt(inv.paidAmount)}</td>
                      <td className={`px-5 py-3.5 text-right text-sm font-semibold whitespace-nowrap ${inv.due > 0.01 ? 'text-red-600' : 'text-green-600'}`}>
                        {fmtAmt(inv.due)}
                      </td>
                      <td className="px-5 py-3.5"><StatusBadge status={inv.status} /></td>
                      <td className="px-5 py-3.5 text-right">
                        <Link href={`/client/invoices/${inv.id}`}
                          className={`inline-flex items-center px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                            isPayable(inv.status)
                              ? 'bg-blue-600 text-white hover:bg-blue-700'
                              : 'text-blue-600 hover:text-blue-700 border border-blue-100 hover:border-blue-300'
                          }`}>
                          {isPayable(inv.status) ? 'Pay Now' : 'View'}
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Pagination (flat list only) */}
      {view === 'list' && pages > 1 && (
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
