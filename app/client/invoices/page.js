'use client'

import { useState, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  FileText, Clock, CheckCircle2, AlertCircle, ChevronRight,
  Layers, List, FolderTree,
} from 'lucide-react'
import { formatMoney } from '@/lib/currencies'
import PageHeader from '@/components/ui/PageHeader'
import Tabs from '@/components/ui/Tabs'
import Badge from '@/components/ui/Badge'
import StatsCard from '@/components/ui/StatsCard'
import SearchInput from '@/components/ui/SearchInput'
import Pagination from '@/components/ui/Pagination'
import EmptyState from '@/components/ui/EmptyState'
import { Card } from '@/components/ui/Card'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { buttonVariants } from '@/components/ui/Button'
import { cn } from '@/lib/utils'
import { codeIncludes } from '@/lib/searchMatch'

const STATUS_OPTIONS = [
  { value: 'ALL',            label: 'All' },
  { value: 'SENT',           label: 'Awaiting payment' },
  { value: 'PARTIALLY_PAID', label: 'Partial' },
  { value: 'PAID',           label: 'Paid' },
  { value: 'OVERDUE',        label: 'Overdue' },
]

const STATUS_MAP = {
  SENT:           { label: 'Awaiting payment', variant: 'primary' },
  PARTIALLY_PAID: { label: 'Partial',          variant: 'warning' },
  PAID:           { label: 'Paid',             variant: 'success' },
  OVERDUE:        { label: 'Overdue',          variant: 'danger'  },
  CANCELLED:      { label: 'Cancelled',        variant: 'default' },
}

// Every amount is shown in its own currency — never a hard-coded ৳.
const fmtAmt  = (n, cur) => formatMoney(n, cur)
// Summary figures: one currency → a single amount; several → one per currency
// (amounts in different currencies are never added together).
const fmtSummary = (summary, key) => {
  if (!summary) return fmtAmt(0)
  if (summary.mixedCurrency && Array.isArray(summary.byCurrency))
    return summary.byCurrency.map(c => fmtAmt(c[key], c.currency)).join(' + ')
  return fmtAmt(summary[key], summary.currency)
}
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

const isPayable = (status) => ['SENT', 'OVERDUE', 'PARTIALLY_PAID'].includes(status)

function StatusBadge({ status }) {
  const s = STATUS_MAP[status] ?? STATUS_MAP.SENT
  return <Badge variant={s.variant}>{s.label}</Badge>
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
  const [debounced, setDebounced] = useState('')
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
        // The list is paginated, so search runs on the server across all pages.
        if (debounced) p.set('search', debounced)
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
  }, [view, status, page, debounced])

  useEffect(() => { load() }, [load])

  // Debounce the search box and restart from page 1 when the term changes.
  useEffect(() => {
    const next = search.trim()
    if (next === debounced) return
    const t = setTimeout(() => { setDebounced(next); setPage(1) }, 300)
    return () => clearTimeout(t)
  }, [search, debounced])

  const q = search.trim().toLowerCase()
  const filtered = invoices
  // Codes match with separators ignored, so ENV-2610A001 finds ENV2610A001.
  const filteredGroups = q
    ? groups.filter(g =>
        (g.project?.name ?? '').toLowerCase().includes(q) ||
        codeIncludes(g.project?.projectCode, q) ||
        g.invoices.some(i => codeIncludes(i.invoiceNumber, q)))
    : groups

  const count = summary?.invoiceCount ?? total

  return (
    <div className="space-y-6">
      <PageHeader
        title="Invoices"
        description={`${count} invoice${count !== 1 ? 's' : ''}`}
        actions={
          <Tabs
            size="sm"
            value={view}
            onChange={(v) => { setView(v); setPage(1); setExpanded(null) }}
            tabs={[
              { value: 'list',    label: 'All invoices', icon: List },
              { value: 'project', label: 'By project',   icon: FolderTree },
            ]}
          />
        }
      />

      {/* Summary */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard title="Total billed" value={fmtSummary(summary, 'billed')} icon={FileText} />
        <StatsCard title="Total paid" value={fmtSummary(summary, 'collected')} icon={CheckCircle2} color="green" />
        <StatsCard title="Outstanding" value={fmtSummary(summary, 'outstanding')} icon={Clock} />
        <StatsCard
          title="Overdue"
          value={fmtSummary(summary, 'overdueAmount')}
          icon={AlertCircle}
          color={(summary?.overdueCount ?? 0) > 0 ? 'red' : 'gray'}
          changeLabel={`${summary?.overdueCount ?? 0} invoice${summary?.overdueCount === 1 ? '' : 's'}`}
        />
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={search}
          onChange={setSearch}
          debounceMs={0}
          placeholder="Search…"
          className="w-full sm:w-64"
        />
        <Tabs
          value={status}
          onChange={(v) => { setStatus(v); setPage(1) }}
          tabs={STATUS_OPTIONS}
        />
      </div>

      {/* ── PROJECT-WISE VIEW ── */}
      {view === 'project' ? (
        <Card className="overflow-hidden">
          {loading ? (
            <div className="divide-y divide-gray-100">
              {[...Array(3)].map((_, i) => (
                <div key={i} className="animate-pulse px-5 py-5">
                  <div className="mb-2 h-4 w-48 rounded-md bg-gray-100" />
                  <div className="h-3 w-32 rounded-md bg-gray-100" />
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="p-12 text-center text-sm text-red-600">{error}</div>
          ) : filteredGroups.length === 0 ? (
            <EmptyState icon={FolderTree} title="No invoiced projects yet" />
          ) : (
            <div className="divide-y divide-gray-100">
              {filteredGroups.map(g => {
                const key    = g.projectId ?? '__none__'
                const isOpen = expanded === key
                return (
                  <div key={key}>
                    <button onClick={() => setExpanded(isOpen ? null : key)}
                      aria-expanded={isOpen}
                      className="flex w-full items-center gap-3 px-4 py-3.5 text-left transition-colors hover:bg-gray-50/70">
                      <ChevronRight className={cn('size-4 shrink-0 text-gray-400 transition-transform', isOpen && 'rotate-90')} />
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-medium text-gray-900">
                            {g.project?.name ?? 'Other invoices'}
                          </span>
                          {g.project?.projectCode && (
                            <span className="font-mono text-xs text-muted-foreground">{g.project.projectCode}</span>
                          )}
                          <StatusBadge status={g.status} />
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {g.invoiceCount} invoice{g.invoiceCount === 1 ? '' : 's'}
                          {g.combined && ` · Combined ${g.combined.combinedNumber}`}
                          {g.mixedCurrency && ' · Mixed currencies (totals not converted)'}
                        </p>
                      </div>
                      <div className="hidden shrink-0 grid-cols-3 gap-6 text-right sm:grid">
                        <div>
                          <p className="text-xs text-muted-foreground">Billed</p>
                          <p className="text-sm font-medium tabular-nums text-gray-900">{fmtAmt(g.total, g.currency)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Paid</p>
                          <p className="text-sm font-medium tabular-nums text-emerald-600">{fmtAmt(g.paidAmount, g.currency)}</p>
                        </div>
                        <div>
                          <p className="text-xs text-muted-foreground">Due</p>
                          <p className={cn('text-sm font-medium tabular-nums', g.due > 0.01 ? 'text-red-600' : 'text-emerald-600')}>{fmtAmt(g.due, g.currency)}</p>
                        </div>
                      </div>
                    </button>

                    {isOpen && (
                      <div className="space-y-3 bg-gray-50/60 px-4 pb-4 pt-1">
                        {g.combined && (
                          <Link href={`/client/invoices/combined/${g.combined.id}`}
                            className="flex items-center justify-between gap-3 rounded-lg border border-gray-200/80 bg-white px-4 py-3 shadow-xs transition-colors hover:border-gray-300">
                            <div className="flex min-w-0 items-center gap-3">
                              <Layers className="size-4 shrink-0 text-gray-500" />
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-gray-900">Combined invoice {g.combined.combinedNumber}</p>
                                <p className="text-xs text-muted-foreground">
                                  {g.invoiceCount} invoices · {fmtAmt(g.due, g.currency)} due
                                </p>
                              </div>
                            </div>
                            <ChevronRight className="size-4 shrink-0 text-gray-400" />
                          </Link>
                        )}
                        <div className="divide-y divide-gray-100 rounded-lg border border-gray-200/80 bg-white">
                          {g.invoices.map(inv => (
                            <Link key={inv.id} href={`/client/invoices/${inv.id}`}
                              className="flex items-center justify-between gap-4 px-4 py-3 transition-colors hover:bg-gray-50/70">
                              <div className="min-w-0">
                                <p className="text-sm font-medium text-gray-900">{inv.invoiceNumber}</p>
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  Issued {fmtDate(inv.issueDate)}{inv.dueDate ? ` · Due ${fmtDate(inv.dueDate)}` : ''}
                                </p>
                              </div>
                              <div className="flex shrink-0 items-center gap-3 sm:gap-4">
                                <div className="text-right">
                                  <p className="text-sm font-medium tabular-nums text-gray-900">{fmtAmt(inv.total, inv.currency)}</p>
                                  <p className={cn('mt-0.5 text-xs tabular-nums', inv.due > 0.01 ? 'text-red-600' : 'text-emerald-600')}>
                                    {inv.due > 0.01 ? `${fmtAmt(inv.due, inv.currency)} due` : 'Paid in full'}
                                  </p>
                                </div>
                                <StatusBadge status={inv.status} />
                                <span className={cn(buttonVariants({ variant: isPayable(inv.status) ? 'outline' : 'ghost', size: 'xs' }), 'hidden sm:inline-flex')}>
                                  {isPayable(inv.status) ? 'Pay now' : 'View'}
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
        </Card>
      ) : (
        /* ── FLAT LIST ── */
        <Card className="overflow-hidden">
          {loading ? (
            <div className="divide-y divide-gray-100">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="flex animate-pulse items-center gap-4 px-4 py-4">
                  <div className="h-4 w-32 rounded-md bg-gray-100" />
                  <div className="ml-auto h-4 w-24 rounded-md bg-gray-100" />
                  <div className="h-4 w-20 rounded-md bg-gray-100" />
                  <div className="h-5 w-16 rounded-full bg-gray-100" />
                </div>
              ))}
            </div>
          ) : error ? (
            <div className="p-12 text-center text-sm text-red-600">{error}</div>
          ) : filtered.length === 0 ? (
            <EmptyState icon={FileText} title={status !== 'ALL' || debounced ? 'No results' : 'No invoices yet'} />
          ) : (
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Invoice</TableHead>
                  <TableHead>Project</TableHead>
                  <TableHead className="hidden md:table-cell">Due date</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead className="text-right">Paid</TableHead>
                  <TableHead className="text-right">Due</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right"><span className="sr-only">Action</span></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtered.map(inv => (
                  <TableRow key={inv.id}>
                    <TableCell>
                      <p className="font-medium text-gray-900">{inv.invoiceNumber}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{fmtDate(inv.issueDate)}</p>
                    </TableCell>
                    <TableCell>
                      <p className="max-w-[160px] truncate">{inv.projectId?.name ?? '—'}</p>
                      {inv.combined && (
                        <Link href={`/client/invoices/combined/${inv.combined.id}`}
                          className="mt-1 inline-flex items-center gap-1 text-xs font-medium text-gray-600 underline-offset-4 hover:text-gray-900 hover:underline">
                          <Layers className="size-3" /> Combined
                        </Link>
                      )}
                    </TableCell>
                    <TableCell className="hidden whitespace-nowrap md:table-cell">{fmtDate(inv.dueDate)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right font-medium tabular-nums text-gray-900">{fmtAmt(inv.total, inv.currency)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums text-emerald-600">{fmtAmt(inv.paidAmount, inv.currency)}</TableCell>
                    <TableCell className={cn('whitespace-nowrap text-right font-medium tabular-nums', inv.due > 0.01 ? 'text-red-600' : 'text-emerald-600')}>
                      {fmtAmt(inv.due, inv.currency)}
                    </TableCell>
                    <TableCell><StatusBadge status={inv.status} /></TableCell>
                    <TableCell className="text-right">
                      <Link href={`/client/invoices/${inv.id}`}
                        className={buttonVariants({ variant: isPayable(inv.status) ? 'outline' : 'ghost', size: 'xs' })}>
                        {isPayable(inv.status) ? 'Pay now' : 'View'}
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          {/* Pagination (flat list only) */}
          {pages > 1 && (
            <div className="border-t border-gray-100 px-4 py-3">
              <Pagination page={page} pages={pages} total={total} limit={limit} onPageChange={setPage} />
            </div>
          )}
        </Card>
      )}
    </div>
  )
}
