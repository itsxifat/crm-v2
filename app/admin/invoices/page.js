'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import {
  Plus, FileText, Eye, Pencil, Trash2, MoreHorizontal, Search, X,
  ArrowUp, ArrowDown, ArrowUpDown, Layers, List, FolderTree, ChevronRight,
  Wallet, TrendingUp, AlertTriangle, Receipt,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import TkAmt from '@/components/ui/TkAmt'
import DatePicker from '@/components/ui/DatePicker'
import Select from '@/components/ui/Select'
import { Can, usePermission } from '@/components/auth/Can'
import { useConfig } from '@/lib/useConfig'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_META = {
  DRAFT:          { dot: 'bg-gray-400',   label: 'Draft',     ring: 'border-gray-200 bg-gray-50  text-gray-600'   },
  SENT:           { dot: 'bg-blue-500',   label: 'Sent',      ring: 'border-blue-200 bg-blue-50  text-blue-700'   },
  PARTIALLY_PAID: { dot: 'bg-yellow-400', label: 'Partial',   ring: 'border-yellow-200 bg-yellow-50 text-yellow-700' },
  PAID:           { dot: 'bg-green-500',  label: 'Paid',      ring: 'border-green-200 bg-green-50  text-green-700'  },
  OVERDUE:        { dot: 'bg-red-500',    label: 'Overdue',   ring: 'border-red-200   bg-red-50    text-red-700'    },
  CANCELLED:      { dot: 'bg-gray-300',   label: 'Cancelled', ring: 'border-gray-200 bg-gray-50  text-gray-400'   },
}

const STATUS_TABS = [
  ['', 'All'],
  ['DRAFT', 'Draft'],
  ['SENT', 'Sent'],
  ['PARTIALLY_PAID', 'Partial'],
  ['PAID', 'Paid'],
  ['OVERDUE', 'Overdue'],
  ['CANCELLED', 'Cancelled'],
]

const PAGE_SIZES = [
  { value: '20',  label: '20 / page' },
  { value: '50',  label: '50 / page' },
  { value: '100', label: '100 / page' },
]

const DATE_FIELDS = [
  { value: 'issueDate', label: 'Issue date' },
  { value: 'dueDate',   label: 'Due date' },
]

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

// ─── Row 3-dot Menu ───────────────────────────────────────────────────────────

function RowMenu({ inv, onDeleted }) {
  const router = useRouter()
  const { can } = usePermission()
  const [open, setOpen] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const h = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  async function handleDelete() {
    setOpen(false)
    if (!confirm(`Delete invoice ${inv.invoiceNumber}?`)) return
    try {
      const res = await fetch(`/api/invoices/${inv.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Invoice deleted')
      onDeleted(inv.id)
    } catch (err) {
      toast.error(err.message)
    }
  }

  return (
    <div ref={ref} className="relative">
      <button onClick={(e) => { e.stopPropagation(); setOpen(o => !o) }}
        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-8 z-20 w-52 bg-white rounded-xl shadow-lg border border-gray-100 py-1 text-sm">
          <button onClick={() => { setOpen(false); router.push(`/admin/invoices/${inv.id}`) }}
            className="w-full flex items-center gap-2.5 px-4 py-2 text-gray-700 hover:bg-gray-50">
            <Eye className="w-3.5 h-3.5 text-gray-400" /> View Invoice
          </button>
          {inv.combined && (
            <button onClick={() => { setOpen(false); router.push(`/admin/invoices/combined/${inv.combined.id}`) }}
              className="w-full flex items-center gap-2.5 px-4 py-2 text-gray-700 hover:bg-gray-50">
              <Layers className="w-3.5 h-3.5 text-blue-500" /> Combined Invoice
            </button>
          )}
          {inv.status === 'DRAFT' && can('sales.invoices.update') && (
            <button onClick={() => { setOpen(false); router.push(`/admin/invoices/${inv.id}/edit`) }}
              className="w-full flex items-center gap-2.5 px-4 py-2 text-gray-700 hover:bg-gray-50">
              <Pencil className="w-3.5 h-3.5 text-gray-400" /> Edit
            </button>
          )}
          {inv.status === 'DRAFT' && can('sales.invoices.delete') && (
            <>
              <div className="border-t border-gray-100 my-1" />
              <button onClick={handleDelete}
                className="w-full flex items-center gap-2.5 px-4 py-2 text-red-600 hover:bg-red-50">
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            </>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Metrics ──────────────────────────────────────────────────────────────────
// Every figure spans the whole filtered set (server-computed), not just the page.

function MetricCards({ stats, loading }) {
  const cards = [
    { key: 'billed',      label: 'Total Billed',   icon: Receipt,       color: 'text-gray-900',  bg: 'bg-gray-100',   iconColor: 'text-gray-500',
      value: stats?.billed,      sub: `${stats?.invoiceCount ?? 0} invoice${stats?.invoiceCount === 1 ? '' : 's'}` },
    { key: 'collected',   label: 'Collected',      icon: TrendingUp,    color: 'text-green-600', bg: 'bg-green-50',   iconColor: 'text-green-600',
      value: stats?.collected,   sub: `${stats?.collectedPct ?? 0}% of billed` },
    { key: 'outstanding', label: 'Outstanding',    icon: Wallet,        color: 'text-amber-600', bg: 'bg-amber-50',   iconColor: 'text-amber-600',
      value: stats?.outstanding, sub: 'Issued & unpaid' },
    { key: 'overdue',     label: 'Overdue',        icon: AlertTriangle, color: 'text-red-500',   bg: 'bg-red-50',     iconColor: 'text-red-500',
      value: stats?.overdue,     sub: `${stats?.byStatus?.OVERDUE?.count ?? 0} invoice${stats?.byStatus?.OVERDUE?.count === 1 ? '' : 's'}` },
  ]

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
      {cards.map(c => {
        const Icon = c.icon
        return (
          <div key={c.key} className="bg-white border border-gray-100 rounded-xl p-4">
            <div className="flex items-center gap-2.5 mb-2">
              <div className={`w-8 h-8 ${c.bg} rounded-lg flex items-center justify-center shrink-0`}>
                <Icon className={`w-4 h-4 ${c.iconColor}`} />
              </div>
              <p className="text-xs text-gray-500 font-medium">{c.label}</p>
            </div>
            {loading ? (
              <div className="h-6 w-24 bg-gray-100 rounded animate-pulse" />
            ) : (
              <p className={`text-lg font-bold ${c.color}`}><TkAmt value={c.value} decimals={0} /></p>
            )}
            <p className="text-xs text-gray-400 mt-0.5">{c.sub}</p>
          </div>
        )
      })}
    </div>
  )
}

function StatusBreakdown({ stats }) {
  const byStatus = stats?.byStatus ?? {}
  const rows = [
    { key: 'PAID',           label: 'Paid',      color: 'bg-green-500'  },
    { key: 'PARTIALLY_PAID', label: 'Partial',   color: 'bg-yellow-400' },
    { key: 'OVERDUE',        label: 'Overdue',   color: 'bg-red-500'    },
    { key: 'SENT',           label: 'Sent',      color: 'bg-blue-500'   },
    { key: 'DRAFT',          label: 'Draft',     color: 'bg-gray-300'   },
    { key: 'CANCELLED',      label: 'Cancelled', color: 'bg-gray-200'   },
  ].map(r => ({ ...r, count: byStatus[r.key]?.count ?? 0, amount: byStatus[r.key]?.total ?? 0 }))

  const total = rows.reduce((s, r) => s + r.count, 0) || 1

  return (
    <div className="bg-white border border-gray-100 rounded-xl p-5">
      <div className="flex h-2 rounded-full overflow-hidden gap-px mb-4">
        {rows.filter(r => r.count > 0).map(r => (
          <div key={r.key} className={r.color} style={{ width: `${(r.count / total) * 100}%` }} title={`${r.label}: ${r.count}`} />
        ))}
        {rows.every(r => r.count === 0) && <div className="bg-gray-100 w-full" />}
      </div>
      <div className="grid grid-cols-3 sm:grid-cols-6 gap-4">
        {rows.map(r => (
          <div key={r.key}>
            <div className="flex items-center gap-1.5 mb-1">
              <span className={`w-2 h-2 rounded-full ${r.color}`} />
              <span className="text-xs text-gray-500">{r.label}</span>
            </div>
            <p className="text-base font-bold text-gray-900">{r.count}</p>
            <p className="text-xs text-gray-400 mt-0.5"><TkAmt value={r.amount} decimals={0} /></p>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Sortable header cell ─────────────────────────────────────────────────────

function SortTh({ label, field, sort, dir, onSort, align = 'left' }) {
  const active = sort === field
  const Icon   = !active ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <th className={`px-5 py-3 text-xs font-medium uppercase tracking-wide ${align === 'right' ? 'text-right' : 'text-left'}`}>
      <button onClick={() => onSort(field)}
        className={`inline-flex items-center gap-1 transition-colors ${active ? 'text-gray-900' : 'text-gray-400 hover:text-gray-600'}`}>
        {align === 'right' && <Icon className={`w-3 h-3 ${active ? '' : 'opacity-40'}`} />}
        {label}
        {align !== 'right' && <Icon className={`w-3 h-3 ${active ? '' : 'opacity-40'}`} />}
      </button>
    </th>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function InvoicesPage() {
  const router = useRouter()
  const { ventureOptions } = useConfig()

  const [view,     setView]     = useState('list')   // 'list' | 'project'
  const [invoices, setInvoices] = useState([])
  const [groups,   setGroups]   = useState([])
  const [stats,    setStats]    = useState(null)
  const [meta,     setMeta]     = useState({ page: 1, pages: 1, total: 0 })
  const [loading,  setLoading]  = useState(true)

  const [status,     setStatus]     = useState('')
  const [search,     setSearch]     = useState('')
  const [debounced,  setDebounced]  = useState('')
  const [venture,    setVenture]    = useState('')
  const [page,       setPage]       = useState(1)
  const [limit,      setLimit]      = useState(20)
  const [startDate,  setStartDate]  = useState('')
  const [endDate,    setEndDate]    = useState('')
  const [dateField,  setDateField]  = useState('issueDate')
  const [sort,       setSort]       = useState('createdAt')
  const [dir,        setDir]        = useState('desc')
  const [expanded,   setExpanded]   = useState(null)

  // Debounce the search box so typing doesn't hammer the API
  useEffect(() => {
    const t = setTimeout(() => { setDebounced(search.trim()); setPage(1) }, 350)
    return () => clearTimeout(t)
  }, [search])

  const params = useCallback(() => {
    const p = new URLSearchParams({ page: String(page), limit: String(limit) })
    if (status)    p.set('status',    status)
    if (debounced) p.set('search',    debounced)
    if (venture)   p.set('venture',   venture)
    if (startDate) p.set('startDate', startDate)
    if (endDate)   p.set('endDate',   endDate)
    if (startDate || endDate) p.set('dateField', dateField)
    return p
  }, [page, limit, status, debounced, venture, startDate, endDate, dateField])

  const load = useCallback(async () => {
    setLoading(true)
    try {
      if (view === 'project') {
        const p = params()
        p.set('groupBy', 'project')
        // The metrics come from the flat endpoint over the same filter set; ask
        // for a single row since only `stats` is used.
        const sp = params()
        sp.set('limit', '1')
        const [gRes, sRes] = await Promise.all([
          fetch(`/api/invoices?${p}`),
          fetch(`/api/invoices?${sp}`),
        ])
        const gJson = await gRes.json()
        if (!gRes.ok) throw new Error(gJson.error)
        setGroups(gJson.data ?? [])
        setMeta(gJson.meta ?? { page: 1, pages: 1, total: 0 })
        if (sRes.ok) setStats((await sRes.json()).stats ?? null)
      } else {
        const p = params()
        p.set('sort', sort)
        p.set('dir',  dir)
        const res  = await fetch(`/api/invoices?${p}`)
        const json = await res.json()
        if (!res.ok) throw new Error(json.error)
        setInvoices(json.data ?? [])
        setMeta(json.meta ?? { page: 1, pages: 1, total: 0 })
        setStats(json.stats ?? null)
      }
    } catch (err) {
      toast.error(err.message ?? 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [view, params, sort, dir])

  useEffect(() => { load() }, [load])

  function handleSort(field) {
    if (sort === field) setDir(d => (d === 'asc' ? 'desc' : 'asc'))
    else { setSort(field); setDir(field === 'invoiceNumber' || field === 'status' ? 'asc' : 'desc') }
    setPage(1)
  }

  function handleDeleted(id) {
    setInvoices(p => p.filter(i => i.id !== id))
    setMeta(m => ({ ...m, total: m.total - 1 }))
  }

  function clearFilters() {
    setStatus(''); setSearch(''); setVenture('')
    setStartDate(''); setEndDate(''); setPage(1)
  }

  const hasFilters = !!(status || debounced || venture || startDate || endDate)

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Invoices</h1>
          <p className="text-sm text-gray-400 mt-0.5">Manage client invoices, billing and collections</p>
        </div>
        <div className="flex items-center gap-2">
          {/* View switch */}
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
          <Can perm="sales.invoices.create">
            <Link href="/admin/invoices/new"
              className="flex items-center gap-1.5 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
              <Plus className="w-4 h-4" /> New Invoice
            </Link>
          </Can>
        </div>
      </div>

      {/* Metrics */}
      <MetricCards stats={stats} loading={loading && !stats} />
      <StatusBreakdown stats={stats} />

      {/* Filter bar */}
      <div className="bg-white border border-gray-100 rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative flex-1 min-w-[220px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search invoice no, client or project…"
              className="w-full pl-9 pr-8 py-2 border border-gray-200 rounded-lg text-sm placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500/30 focus:border-blue-400"
            />
            {search && (
              <button onClick={() => setSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 rounded text-gray-400 hover:text-gray-600">
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <Select value={venture} onChange={v => { setVenture(v ?? ''); setPage(1) }}
            options={ventureOptions ?? []}
            placeholder="All ventures" size="sm" className="min-w-[150px]" />

          <Select value={dateField} onChange={v => setDateField(v ?? 'issueDate')}
            options={DATE_FIELDS} size="sm" className="min-w-[120px]" />

          <DatePicker value={startDate || null} onChange={v => { setStartDate(v ?? ''); setPage(1) }} />
          <span className="text-xs text-gray-400">to</span>
          <DatePicker value={endDate || null} onChange={v => { setEndDate(v ?? ''); setPage(1) }} />

          <Select value={String(limit)} onChange={v => { setLimit(Number(v ?? 20)); setPage(1) }}
            options={PAGE_SIZES} size="sm" className="min-w-[110px]" />

          {hasFilters && (
            <button onClick={clearFilters}
              className="text-xs text-gray-500 hover:text-gray-800 px-2.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50">
              Clear all
            </button>
          )}
        </div>

        {/* Status tabs */}
        <div className="flex gap-5 border-t border-gray-100 pt-2 overflow-x-auto scrollbar-none">
          {STATUS_TABS.map(([v, l]) => {
            const count = v ? stats?.byStatus?.[v]?.count : stats?.invoiceCount
            return (
              <button key={v} onClick={() => { setStatus(v); setPage(1) }}
                className={`pb-1.5 text-sm transition-colors whitespace-nowrap ${
                  status === v
                    ? 'text-gray-900 border-b-2 border-gray-900 font-medium'
                    : 'text-gray-400 hover:text-gray-600'
                }`}>
                {l}
                {count != null && <span className="ml-1.5 text-xs text-gray-300">{count}</span>}
              </button>
            )
          })}
        </div>
      </div>

      {/* ── PROJECT-WISE VIEW ── */}
      {view === 'project' ? (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          {loading ? (
            <div className="flex justify-center py-20">
              <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : groups.length === 0 ? (
            <div className="text-center py-20">
              <FolderTree className="w-10 h-10 text-gray-200 mx-auto mb-3" />
              <p className="text-sm text-gray-500">No invoiced projects match these filters</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {groups.map(g => {
                const key    = g.projectId ?? '__none__'
                const isOpen = expanded === key
                return (
                  <div key={key}>
                    <button onClick={() => setExpanded(isOpen ? null : key)}
                      className="w-full px-5 py-4 flex items-center gap-4 hover:bg-gray-50/70 transition-colors text-left">
                      <ChevronRight className={`w-4 h-4 text-gray-300 shrink-0 transition-transform ${isOpen ? 'rotate-90' : ''}`} />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-xs font-mono text-gray-400">{g.project?.projectCode ?? '—'}</span>
                          <span className="text-sm font-medium text-gray-900 truncate">{g.project?.name ?? 'No project (standalone)'}</span>
                          {g.combined && (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-blue-50 text-blue-600 border border-blue-100">
                              <Layers className="w-3 h-3" /> {g.combined.combinedNumber}
                            </span>
                          )}
                        </div>
                        <p className="text-xs text-gray-400 mt-0.5">
                          {g.client?.company || g.client?.name || '—'}
                          {' · '}{g.invoiceCount} invoice{g.invoiceCount === 1 ? '' : 's'}
                          {g.draftCount   > 0 && ` · ${g.draftCount} draft`}
                          {g.overdueCount > 0 && <span className="text-red-500"> · {g.overdueCount} overdue</span>}
                        </p>
                      </div>
                      <div className="hidden sm:grid grid-cols-3 gap-6 shrink-0 text-right">
                        <div>
                          <p className="text-xs text-gray-400">Billed</p>
                          <p className="text-sm font-semibold text-gray-900"><TkAmt value={g.total} decimals={2} /></p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-400">Paid</p>
                          <p className="text-sm font-semibold text-green-600"><TkAmt value={g.paid} decimals={2} /></p>
                        </div>
                        <div>
                          <p className="text-xs text-gray-400">Due</p>
                          <p className={`text-sm font-semibold ${g.due > 0.01 ? 'text-red-500' : 'text-green-600'}`}>
                            <TkAmt value={g.due} decimals={2} />
                          </p>
                        </div>
                      </div>
                    </button>

                    {isOpen && (
                      <ProjectInvoiceRows group={g} onOpen={id => router.push(`/admin/invoices/${id}`)} />
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {meta.pages > 1 && (
            <Pager meta={meta} page={page} setPage={setPage} unit="projects" />
          )}
        </div>
      ) : (
        /* ── FLAT LIST VIEW ── */
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          {loading ? (
            <div className="flex justify-center py-20">
              <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
            </div>
          ) : invoices.length === 0 ? (
            <div className="text-center py-20">
              <FileText className="w-10 h-10 text-gray-200 mx-auto mb-3" />
              <p className="text-sm text-gray-500">No invoices found</p>
              {hasFilters ? (
                <button onClick={clearFilters} className="text-blue-600 text-sm mt-2 inline-block hover:underline">Clear filters</button>
              ) : (
                <Link href="/admin/invoices/new" className="text-blue-600 text-sm mt-2 inline-block hover:underline">
                  Create your first invoice
                </Link>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px]">
                <thead>
                  <tr className="bg-gray-50/60 border-b border-gray-100">
                    <SortTh label="Invoice No" field="invoiceNumber" sort={sort} dir={dir} onSort={handleSort} />
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Client</th>
                    <th className="px-5 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Project</th>
                    <SortTh label="Issued"  field="issueDate"  sort={sort} dir={dir} onSort={handleSort} />
                    <SortTh label="Due Date" field="dueDate"   sort={sort} dir={dir} onSort={handleSort} />
                    <SortTh label="Amount"  field="total"      sort={sort} dir={dir} onSort={handleSort} align="right" />
                    <SortTh label="Paid"    field="paidAmount" sort={sort} dir={dir} onSort={handleSort} align="right" />
                    <SortTh label="Due"     field="due"        sort={sort} dir={dir} onSort={handleSort} align="right" />
                    <SortTh label="Status"  field="status"     sort={sort} dir={dir} onSort={handleSort} />
                    <th className="px-5 py-3 w-12" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {invoices.map(inv => {
                    const s = STATUS_META[inv.status] ?? STATUS_META.DRAFT
                    const project = inv.projectId ?? inv.projectIds?.[0]
                    const overdue = inv.dueDate && new Date(inv.dueDate) < new Date() && !['PAID', 'CANCELLED'].includes(inv.status)

                    return (
                      <tr key={inv.id} onClick={() => router.push(`/admin/invoices/${inv.id}`)}
                        className="hover:bg-gray-50/70 cursor-pointer transition-colors">
                        <td className="px-5 py-3 whitespace-nowrap">
                          <span className="text-sm font-mono font-medium text-gray-800">{inv.invoiceNumber}</span>
                          {inv.combined && (
                            <Link href={`/admin/invoices/combined/${inv.combined.id}`} onClick={e => e.stopPropagation()}
                              title={`Part of combined invoice ${inv.combined.combinedNumber}`}
                              className="ml-2 inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-50 text-blue-600 border border-blue-100 hover:bg-blue-100">
                              <Layers className="w-2.5 h-2.5" /> Combined
                            </Link>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          <p className="text-sm font-medium text-gray-900 leading-tight">{inv.clientId?.userId?.name ?? '—'}</p>
                          {inv.clientId?.company && <p className="text-xs text-gray-400">{inv.clientId.company}</p>}
                        </td>
                        <td className="px-5 py-3">
                          {project ? (
                            <div>
                              <p className="text-xs font-mono text-gray-500">{project.projectCode}</p>
                              <p className="text-sm text-gray-700 truncate max-w-[160px]">{project.name}</p>
                            </div>
                          ) : <span className="text-xs text-gray-300">—</span>}
                        </td>
                        <td className="px-5 py-3 whitespace-nowrap text-sm text-gray-600">{fmtDate(inv.issueDate)}</td>
                        <td className="px-5 py-3 whitespace-nowrap">
                          <span className={`text-sm ${overdue ? 'text-red-500 font-medium' : 'text-gray-600'}`}>{fmtDate(inv.dueDate)}</span>
                        </td>
                        <td className="px-5 py-3 text-right whitespace-nowrap text-sm font-semibold text-gray-900">
                          <TkAmt value={inv.total} decimals={2} />
                        </td>
                        <td className="px-5 py-3 text-right whitespace-nowrap text-sm text-green-600">
                          <TkAmt value={inv.paidAmount ?? 0} decimals={2} />
                        </td>
                        <td className={`px-5 py-3 text-right whitespace-nowrap text-sm font-semibold ${inv.due > 0.01 ? 'text-red-500' : 'text-green-600'}`}>
                          <TkAmt value={inv.due} decimals={2} />
                        </td>
                        <td className="px-5 py-3">
                          <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-1 rounded-full border ${s.ring}`}>
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
                            {s.label}
                          </span>
                        </td>
                        <td className="px-5 py-3 text-right" onClick={e => e.stopPropagation()}>
                          <RowMenu inv={inv} onDeleted={handleDeleted} />
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {meta.pages > 1 && <Pager meta={meta} page={page} setPage={setPage} unit="invoices" />}
        </div>
      )}
    </div>
  )
}

// ─── Expanded project row: its invoices ───────────────────────────────────────

function ProjectInvoiceRows({ group, onOpen }) {
  const [rows,    setRows]    = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!group.projectId) { setRows([]); setLoading(false); return }
    fetch(`/api/invoices?projectId=${group.projectId}&limit=100&sort=issueDate&dir=asc`)
      .then(r => r.json())
      .then(j => setRows(j.data ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [group.projectId])

  if (loading) return (
    <div className="px-14 py-6 flex justify-center">
      <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-500 rounded-full animate-spin" />
    </div>
  )

  if (!rows?.length) return <div className="px-14 py-6 text-sm text-gray-400">No invoices to show.</div>

  return (
    <div className="bg-gray-50/50 px-5 pb-4">
      <div className="rounded-lg border border-gray-100 bg-white overflow-x-auto">
        <table className="w-full min-w-[620px]">
          <thead>
            <tr className="border-b border-gray-100">
              {['Invoice No', 'Issued', 'Due Date', 'Status', 'Amount', 'Paid', 'Due'].map((h, i) => (
                <th key={h} className={`px-4 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wide ${i >= 4 ? 'text-right' : 'text-left'}`}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map(inv => {
              const s = STATUS_META[inv.status] ?? STATUS_META.DRAFT
              return (
                <tr key={inv.id} onClick={() => onOpen(inv.id)} className="hover:bg-gray-50 cursor-pointer">
                  <td className="px-4 py-2.5 text-sm font-mono text-gray-800 whitespace-nowrap">{inv.invoiceNumber}</td>
                  <td className="px-4 py-2.5 text-sm text-gray-500 whitespace-nowrap">{fmtDate(inv.issueDate)}</td>
                  <td className="px-4 py-2.5 text-sm text-gray-500 whitespace-nowrap">{fmtDate(inv.dueDate)}</td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex items-center gap-1.5 text-xs font-medium px-2 py-0.5 rounded-full border ${s.ring}`}>
                      <span className={`w-1.5 h-1.5 rounded-full ${s.dot}`} /> {s.label}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-sm font-medium text-gray-900 whitespace-nowrap"><TkAmt value={inv.total} decimals={2} /></td>
                  <td className="px-4 py-2.5 text-right text-sm text-green-600 whitespace-nowrap"><TkAmt value={inv.paidAmount ?? 0} decimals={2} /></td>
                  <td className={`px-4 py-2.5 text-right text-sm font-medium whitespace-nowrap ${inv.due > 0.01 ? 'text-red-500' : 'text-green-600'}`}>
                    <TkAmt value={inv.due} decimals={2} />
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {group.combined && (
        <Link href={`/admin/invoices/combined/${group.combined.id}`}
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-medium text-blue-600 hover:text-blue-700">
          <Layers className="w-3.5 h-3.5" /> Open combined invoice {group.combined.combinedNumber}
        </Link>
      )}
    </div>
  )
}

// ─── Pagination ───────────────────────────────────────────────────────────────

function Pager({ meta, page, setPage, unit }) {
  return (
    <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
      <p className="text-sm text-gray-400">Page {page} of {meta.pages} · {meta.total} {unit}</p>
      <div className="flex gap-2">
        <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
          className="px-3 py-1.5 text-sm text-gray-500 disabled:opacity-40 hover:text-gray-700 transition-colors">
          Prev
        </button>
        <button disabled={page >= meta.pages} onClick={() => setPage(p => p + 1)}
          className="px-3 py-1.5 text-sm text-gray-500 disabled:opacity-40 hover:text-gray-700 transition-colors">
          Next
        </button>
      </div>
    </div>
  )
}
