'use client'

import { useState, useEffect, useCallback } from 'react'
import {
  Plus, FileText, Eye, Pencil, Trash2, Search, X,
  ArrowUp, ArrowDown, ArrowUpDown, Layers, List, FolderTree, ChevronRight,
  Wallet, TrendingUp, AlertTriangle, Receipt,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import TkAmt from '@/components/ui/TkAmt'
import DatePicker from '@/components/ui/DatePicker'
import Select from '@/components/ui/Select'
import Button from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import PageHeader from '@/components/ui/PageHeader'
import Tabs from '@/components/ui/Tabs'
import Badge from '@/components/ui/Badge'
import StatsCard from '@/components/ui/StatsCard'
import ActionMenu from '@/components/ui/ActionMenu'
import EmptyState from '@/components/ui/EmptyState'
import Pagination from '@/components/ui/Pagination'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import { inputClass } from '@/components/ui/Input'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { Can, usePermission } from '@/components/auth/Can'
import { useConfig } from '@/lib/useConfig'
import { dhakaDayStart } from '@/lib/dhakaTime'
import { cn } from '@/lib/utils'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const STATUS_META = {
  DRAFT:          { label: 'Draft',     variant: 'default' },
  SENT:           { label: 'Sent',      variant: 'primary' },
  PARTIALLY_PAID: { label: 'Partial',   variant: 'warning' },
  PAID:           { label: 'Paid',      variant: 'success' },
  OVERDUE:        { label: 'Overdue',   variant: 'danger'  },
  CANCELLED:      { label: 'Cancelled', variant: 'outline' },
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

function StatusBadge({ status }) {
  const s = STATUS_META[status] ?? STATUS_META.DRAFT
  return <Badge variant={s.variant} dot>{s.label}</Badge>
}

// ─── Row menu ─────────────────────────────────────────────────────────────────

function RowMenu({ inv, onDeleted }) {
  const { can } = usePermission()

  async function handleDelete() {
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
    <ActionMenu
      items={[
        { label: 'View', icon: Eye, href: `/admin/invoices/${inv.id}` },
        inv.combined && { label: 'Combined invoice', icon: Layers, href: `/admin/invoices/combined/${inv.combined.id}` },
        inv.status === 'DRAFT' && can('sales.invoices.update') && { label: 'Edit', icon: Pencil, href: `/admin/invoices/${inv.id}/edit` },
        inv.status === 'DRAFT' && can('sales.invoices.delete') && { label: 'Delete', icon: Trash2, danger: true, onClick: handleDelete },
      ]}
    />
  )
}

// ─── Metrics ──────────────────────────────────────────────────────────────────
// Every figure spans the whole filtered set (server-computed), not just the page.

function MetricCards({ stats, loading }) {
  const cards = [
    { key: 'billed',      label: 'Total billed', icon: Receipt,       color: 'gray',
      value: stats?.billed,      sub: `${stats?.invoiceCount ?? 0} invoice${stats?.invoiceCount === 1 ? '' : 's'}` },
    { key: 'collected',   label: 'Collected',    icon: TrendingUp,    color: 'emerald',
      value: stats?.collected,   sub: `${stats?.collectedPct ?? 0}% of billed` },
    { key: 'outstanding', label: 'Outstanding',  icon: Wallet,        color: 'yellow',
      value: stats?.outstanding, sub: 'Issued & unpaid' },
    { key: 'overdue',     label: 'Overdue',      icon: AlertTriangle, color: 'red',
      value: stats?.overdue,     sub: `${stats?.byStatus?.OVERDUE?.count ?? 0} invoice${stats?.byStatus?.OVERDUE?.count === 1 ? '' : 's'}` },
  ]

  return (
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      {cards.map(c => (
        <StatsCard
          key={c.key}
          title={c.label}
          icon={c.icon}
          color={c.color}
          value={loading
            ? <span className="inline-block h-7 w-24 animate-pulse rounded-md bg-gray-100 align-middle" />
            : <TkAmt value={c.value} decimals={0} />}
          changeLabel={c.sub}
        />
      ))}
    </div>
  )
}

function StatusBreakdown({ stats }) {
  const byStatus = stats?.byStatus ?? {}
  const rows = [
    { key: 'PAID',           label: 'Paid',      color: 'bg-emerald-500' },
    { key: 'PARTIALLY_PAID', label: 'Partial',   color: 'bg-amber-400'   },
    { key: 'OVERDUE',        label: 'Overdue',   color: 'bg-red-500'     },
    { key: 'SENT',           label: 'Sent',      color: 'bg-blue-500'    },
    { key: 'DRAFT',          label: 'Draft',     color: 'bg-gray-400'    },
    { key: 'CANCELLED',      label: 'Cancelled', color: 'bg-gray-200'    },
  ].map(r => ({ ...r, count: byStatus[r.key]?.count ?? 0, amount: byStatus[r.key]?.total ?? 0 }))

  const total = rows.reduce((s, r) => s + r.count, 0) || 1

  return (
    <Card className="p-5">
      <div className="mb-4 flex h-1.5 gap-px overflow-hidden rounded-full bg-gray-100">
        {rows.filter(r => r.count > 0).map(r => (
          <div key={r.key} className={r.color} style={{ width: `${(r.count / total) * 100}%` }} title={`${r.label}: ${r.count}`} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-4 sm:grid-cols-6">
        {rows.map(r => (
          <div key={r.key}>
            <div className="mb-1 flex items-center gap-1.5">
              <span className={cn('size-2 rounded-full', r.color)} />
              <span className="text-xs text-muted-foreground">{r.label}</span>
            </div>
            <p className="text-base font-semibold tabular-nums text-gray-900">{r.count}</p>
            <p className="mt-0.5 text-xs text-muted-foreground"><TkAmt value={r.amount} decimals={0} /></p>
          </div>
        ))}
      </div>
    </Card>
  )
}

// ─── Sortable header cell ─────────────────────────────────────────────────────

function SortTh({ label, field, sort, dir, onSort, align = 'left' }) {
  const active = sort === field
  const Icon   = !active ? ArrowUpDown : dir === 'asc' ? ArrowUp : ArrowDown
  return (
    <TableHead className={align === 'right' ? 'text-right' : 'text-left'}>
      <button onClick={() => onSort(field)}
        className={cn('inline-flex items-center gap-1 transition-colors', active ? 'text-gray-900' : 'hover:text-gray-900')}>
        {align === 'right' && <Icon className={cn('size-3', !active && 'opacity-40')} />}
        {label}
        {align !== 'right' && <Icon className={cn('size-3', !active && 'opacity-40')} />}
      </button>
    </TableHead>
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

  const statusTabs = STATUS_TABS.map(([v, l]) => ({
    value: v,
    label: l,
    // statusCounts ignore the active tab, so every tab keeps its own count
    count: v
      ? (stats?.statusCounts?.[v] ?? stats?.byStatus?.[v]?.count)
      : (stats?.allCount ?? stats?.invoiceCount),
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Invoices"
        actions={
          <>
            <Tabs
              value={view}
              onChange={v => { setView(v); setPage(1); setExpanded(null) }}
              tabs={[
                { value: 'list',    label: 'All',        icon: List },
                { value: 'project', label: 'By project', icon: FolderTree },
              ]}
            />
            <Can perm="sales.invoices.create">
              <Button href="/admin/invoices/new"><Plus /> New invoice</Button>
            </Can>
          </>
        }
      />

      {/* Metrics */}
      <MetricCards stats={stats} loading={loading && !stats} />
      <StatusBreakdown stats={stats} />

      {/* Filters */}
      <div className="space-y-3">
        <Tabs value={status} onChange={v => { setStatus(v); setPage(1) }} tabs={statusTabs} />

        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search…"
              className={cn(inputClass, 'pl-9 pr-8')}
            />
            {search && (
              <button onClick={() => setSearch('')} aria-label="Clear search"
                className="absolute right-2 top-1/2 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700">
                <X className="size-3.5" />
              </button>
            )}
          </div>

          <Select value={venture} onChange={v => { setVenture(v ?? ''); setPage(1) }}
            options={ventureOptions ?? []}
            placeholder="All ventures" className="w-auto min-w-[150px]" />

          <Select value={dateField} onChange={v => setDateField(v ?? 'issueDate')}
            options={DATE_FIELDS} className="w-auto min-w-[120px]" />

          <div className="flex items-center gap-2">
            <DatePicker value={startDate || null} onChange={v => { setStartDate(v ?? ''); setPage(1) }} />
            <span className="text-xs text-muted-foreground">to</span>
            <DatePicker value={endDate || null} onChange={v => { setEndDate(v ?? ''); setPage(1) }} />
          </div>

          <div className="flex items-center gap-2 sm:ml-auto">
            {hasFilters && (
              <Button variant="ghost" onClick={clearFilters}>
                <X /> Clear
              </Button>
            )}
            <Select value={String(limit)} onChange={v => { setLimit(Number(v ?? 20)); setPage(1) }}
              options={PAGE_SIZES} className="w-auto min-w-[110px]" />
          </div>
        </div>
      </div>

      {/* ── PROJECT-WISE VIEW ── */}
      {view === 'project' ? (
        <Card className="overflow-hidden">
          {loading ? (
            <LoadingSpinner className="py-20" />
          ) : groups.length === 0 ? (
            <EmptyState icon={FolderTree} title="No results" description="No invoiced projects match these filters." />
          ) : (
            <div className="divide-y divide-gray-100">
              {groups.map(g => {
                const key    = g.projectId ?? `__none__:${g.client?.id ?? ''}`
                const isOpen = expanded === key
                return (
                  <div key={key}>
                    <button onClick={() => setExpanded(isOpen ? null : key)}
                      className="flex w-full items-center gap-4 px-4 py-3.5 text-left transition-colors hover:bg-gray-50/70">
                      <ChevronRight className={cn('size-4 shrink-0 text-gray-400 transition-transform', isOpen && 'rotate-90')} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-xs text-muted-foreground">{g.project?.projectCode ?? '—'}</span>
                          <span className="truncate text-sm font-medium text-gray-900">{g.project?.name ?? 'No project (standalone)'}</span>
                          {g.combined && (
                            <Badge variant="outline"><Layers className="size-3" /> {g.combined.combinedNumber}</Badge>
                          )}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {g.client?.company || g.client?.name || '—'}
                          {' · '}{g.invoiceCount} invoice{g.invoiceCount === 1 ? '' : 's'}
                          {g.draftCount   > 0 && ` · ${g.draftCount} draft`}
                          {g.overdueCount > 0 && <span className="text-red-600"> · {g.overdueCount} overdue</span>}
                        </p>
                      </div>
                      <div className="hidden shrink-0 grid-cols-3 gap-6 text-right sm:grid">
                        <div>
                          <p className="text-xs text-muted-foreground">Billed</p>
                          <p className="text-sm font-semibold text-gray-900"><TkAmt value={g.total} decimals={2} /></p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Paid</p>
                          <p className="text-sm font-semibold text-emerald-600"><TkAmt value={g.paid} decimals={2} /></p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Due</p>
                          <p className={cn('text-sm font-semibold', g.due > 0.01 ? 'text-red-600' : 'text-emerald-600')}>
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

          {meta.pages > 1 && <Pager meta={meta} setPage={setPage} />}
        </Card>
      ) : (
        /* ── FLAT LIST VIEW ── */
        <Card className="overflow-hidden">
          {loading ? (
            <LoadingSpinner className="py-20" />
          ) : invoices.length === 0 ? (
            <EmptyState
              icon={FileText}
              title={hasFilters ? 'No results' : 'No invoices yet'}
              action={hasFilters ? (
                <Button variant="outline" size="sm" onClick={clearFilters}>Clear filters</Button>
              ) : (
                <Button variant="outline" size="sm" href="/admin/invoices/new"><Plus /> New invoice</Button>
              )}
            />
          ) : (
            <Table className="min-w-[900px]">
              <TableHeader>
                <TableRow>
                  <SortTh label="Invoice no." field="invoiceNumber" sort={sort} dir={dir} onSort={handleSort} />
                  <TableHead>Client</TableHead>
                  <TableHead>Project</TableHead>
                  <SortTh label="Issued"   field="issueDate"  sort={sort} dir={dir} onSort={handleSort} />
                  <SortTh label="Due date" field="dueDate"    sort={sort} dir={dir} onSort={handleSort} />
                  <SortTh label="Amount"   field="total"      sort={sort} dir={dir} onSort={handleSort} align="right" />
                  <SortTh label="Paid"     field="paidAmount" sort={sort} dir={dir} onSort={handleSort} align="right" />
                  <SortTh label="Due"      field="due"        sort={sort} dir={dir} onSort={handleSort} align="right" />
                  <SortTh label="Status"   field="status"     sort={sort} dir={dir} onSort={handleSort} />
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {invoices.map(inv => {
                  const project = inv.projectId ?? inv.projectIds?.[0]
                  // Due date is a calendar day: overdue only from the next Dhaka day
                  const overdue = inv.dueDate && new Date(inv.dueDate) < dhakaDayStart() && !['PAID', 'CANCELLED'].includes(inv.status)

                  return (
                    <TableRow key={inv.id} onClick={() => router.push(`/admin/invoices/${inv.id}`)} className="cursor-pointer">
                      <TableCell className="whitespace-nowrap">
                        <span className="font-mono text-[13px] font-medium text-gray-900">{inv.invoiceNumber}</span>
                        {inv.combined && (
                          <Link href={`/admin/invoices/combined/${inv.combined.id}`} onClick={e => e.stopPropagation()}
                            title={`Part of combined invoice ${inv.combined.combinedNumber}`}
                            className="ml-2 inline-flex items-center gap-1 rounded-full bg-white px-1.5 py-0.5 text-[11px] font-medium text-gray-700 ring-1 ring-inset ring-gray-200 hover:bg-gray-50">
                            <Layers className="size-3" /> Combined
                          </Link>
                        )}
                      </TableCell>
                      <TableCell>
                        <p className="font-medium leading-tight text-gray-900">{inv.clientId?.userId?.name ?? '—'}</p>
                        {inv.clientId?.company && <p className="text-xs text-muted-foreground">{inv.clientId.company}</p>}
                      </TableCell>
                      <TableCell>
                        {project ? (
                          <div>
                            <p className="font-mono text-xs text-muted-foreground">{project.projectCode}</p>
                            <p className="max-w-[160px] truncate">{project.name}</p>
                          </div>
                        ) : <span className="text-gray-300">—</span>}
                      </TableCell>
                      <TableCell className="whitespace-nowrap">{fmtDate(inv.issueDate)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <span className={overdue ? 'font-medium text-red-600' : undefined}>{fmtDate(inv.dueDate)}</span>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-medium text-gray-900">
                        <TkAmt value={inv.total} decimals={2} />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right text-emerald-600">
                        <TkAmt value={inv.paidAmount ?? 0} decimals={2} />
                      </TableCell>
                      <TableCell className={cn('whitespace-nowrap text-right font-medium', inv.due > 0.01 ? 'text-red-600' : 'text-emerald-600')}>
                        <TkAmt value={inv.due} decimals={2} />
                      </TableCell>
                      <TableCell>
                        <StatusBadge status={inv.status} />
                      </TableCell>
                      <TableCell className="text-right" onClick={e => e.stopPropagation()}>
                        <RowMenu inv={inv} onDeleted={handleDeleted} />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          )}

          {meta.pages > 1 && <Pager meta={meta} setPage={setPage} />}
        </Card>
      )}
    </div>
  )
}

// ─── Expanded project row: its invoices ───────────────────────────────────────

function ProjectInvoiceRows({ group, onOpen }) {
  const [rows,    setRows]    = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Standalone group (no project) → that client's invoices without a project
    const clientKey = group.client?.id
    if (!group.projectId && !clientKey) { setRows([]); setLoading(false); return }
    const qs = group.projectId
      ? `projectId=${group.projectId}`
      : `projectId=none&clientId=${clientKey}`
    fetch(`/api/invoices?${qs}&limit=100&sort=issueDate&dir=asc`)
      .then(r => r.json())
      .then(j => setRows(j.data ?? []))
      .catch(() => setRows([]))
      .finally(() => setLoading(false))
  }, [group.projectId, group.client?.id])

  if (loading) return <LoadingSpinner size="sm" className="py-6" />

  if (!rows?.length) return <div className="px-12 py-5 text-sm text-muted-foreground">No invoices</div>

  return (
    <div className="bg-gray-50/60 px-4 pb-4 pt-1">
      <div className="overflow-hidden rounded-lg border border-gray-200/80 bg-white">
        <Table className="min-w-[620px]">
          <TableHeader>
            <TableRow>
              {['Invoice no.', 'Issued', 'Due date', 'Status', 'Amount', 'Paid', 'Due'].map((h, i) => (
                <TableHead key={h} className={cn('h-9', i >= 4 ? 'text-right' : 'text-left')}>{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map(inv => (
              <TableRow key={inv.id} onClick={() => onOpen(inv.id)} className="cursor-pointer">
                <TableCell className="whitespace-nowrap py-2.5 font-mono text-[13px] text-gray-900">{inv.invoiceNumber}</TableCell>
                <TableCell className="whitespace-nowrap py-2.5">{fmtDate(inv.issueDate)}</TableCell>
                <TableCell className="whitespace-nowrap py-2.5">{fmtDate(inv.dueDate)}</TableCell>
                <TableCell className="py-2.5"><StatusBadge status={inv.status} /></TableCell>
                <TableCell className="whitespace-nowrap py-2.5 text-right font-medium text-gray-900"><TkAmt value={inv.total} decimals={2} /></TableCell>
                <TableCell className="whitespace-nowrap py-2.5 text-right text-emerald-600"><TkAmt value={inv.paidAmount ?? 0} decimals={2} /></TableCell>
                <TableCell className={cn('whitespace-nowrap py-2.5 text-right font-medium', inv.due > 0.01 ? 'text-red-600' : 'text-emerald-600')}>
                  <TkAmt value={inv.due} decimals={2} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>
      {group.combined && (
        <Link href={`/admin/invoices/combined/${group.combined.id}`}
          className="mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium text-gray-900 underline-offset-4 hover:underline">
          <Layers className="size-4 text-gray-500" /> Open combined invoice {group.combined.combinedNumber}
        </Link>
      )}
    </div>
  )
}

// ─── Pagination ───────────────────────────────────────────────────────────────

function Pager({ meta, setPage }) {
  return (
    <div className="border-t border-gray-100 px-4 py-3">
      <Pagination meta={meta} onPageChange={setPage} />
    </div>
  )
}
