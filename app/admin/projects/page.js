'use client'

import { Fragment, useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Search, Eye, Pencil, Trash2, ChevronDown, Check, FolderKanban } from 'lucide-react'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { STATUS_META } from '@/lib/ventures'
import { useConfig } from '@/lib/useConfig'
import TkAmt from '@/components/ui/TkAmt'
import Select from '@/components/ui/Select'
import DatePicker from '@/components/ui/DatePicker'
import Button from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { inputClass } from '@/components/ui/Input'
import PageHeader from '@/components/ui/PageHeader'
import Tabs from '@/components/ui/Tabs'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import ActionMenu from '@/components/ui/ActionMenu'
import EmptyState from '@/components/ui/EmptyState'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import Pagination from '@/components/ui/Pagination'
import { cn } from '@/lib/utils'
import { Can, usePermission } from '@/components/auth/Can'
import { allowedStatusTransitions, canRenewProject } from '@/lib/projectStatus'
import { dhakaDayKey } from '@/lib/dhakaTime'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n) {
  if (n == null || n === '') return '—'
  return `৳ ${Number(n).toLocaleString('en-BD', { minimumFractionDigits: 0 })}`
}
function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

const STATUS_DOT = {
  PENDING:       'bg-gray-400',
  IN_PROGRESS:   'bg-blue-500',
  IN_REVIEW:     'bg-purple-500',
  REVISION:      'bg-yellow-500',
  APPROVED:      'bg-teal-500',
  DELIVERED:     'bg-green-500',
  FEEDBACK:      'bg-orange-500',
  SUBMITTED:     'bg-indigo-500',
  ACTIVE:        'bg-green-500',
  EXPIRING_SOON: 'bg-orange-500',
  RENEWED:       'bg-blue-500',
  ON_HOLD:       'bg-yellow-400',
  CANCELLED:     'bg-red-500',
}

// Status cards to show (user-requested set)
const STATUS_OVERVIEW = [
  { key: '',            label: 'All',         filterKey: '' },
  { key: 'PENDING',     label: 'Pending',     filterKey: 'PENDING' },
  { key: 'IN_PROGRESS', label: 'In progress', filterKey: 'IN_PROGRESS' },
  { key: 'ON_HOLD',     label: 'On hold',     filterKey: 'ON_HOLD' },
  { key: 'FEEDBACK',    label: 'Feedback',    filterKey: 'FEEDBACK' },
  { key: 'SUBMITTED',   label: 'Submitted',   filterKey: 'SUBMITTED' },
  { key: 'DELIVERED',   label: 'Delivered',   filterKey: 'DELIVERED' },
  { key: 'CANCELLED',   label: 'Cancelled',   filterKey: 'CANCELLED' },
]

// ─── Status Dropdown ─────────────────────────────────────────────────────────

function StatusDropdown({ project, onUpdated }) {
  const router = useRouter()
  const [open,   setOpen]   = useState(false)
  const [saving, setSaving] = useState(false)
  const [pos,    setPos]    = useState({ top: 0, left: 0 })
  const btnRef = useRef(null)

  const { can } = usePermission()
  // Same transitions the status API enforces, for this project's lifecycle.
  // Renewal (monthly) goes through the renew endpoint and creates a new project.
  const statuses = [
    ...allowedStatusTransitions(project).map(key => ({ key, label: STATUS_META[key]?.label ?? key })),
    ...(canRenewProject(project) ? [{ key: 'RENEWED', label: 'Renewed', special: true }] : []),
  ]
  const canChange = can('projects.update') && statuses.length > 0

  useEffect(() => {
    function h(e) { if (btnRef.current && !btnRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  function handleOpen(e) {
    e.stopPropagation()
    if (!canChange) return
    const rect = btnRef.current.getBoundingClientRect()
    setPos({ top: rect.bottom + window.scrollY + 4, left: rect.left + window.scrollX })
    setOpen(o => !o)
  }

  async function handleSelect(e, status) {
    e.stopPropagation()
    if (status === project.status) { setOpen(false); return }
    setSaving(true)
    setOpen(false)

    try {
      if (status === 'RENEWED') {
        // Call renew endpoint — creates new project
        const res  = await fetch(`/api/projects/${project.id}/renew`, { method: 'POST' })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Renewal failed')
        onUpdated(project.id, 'RENEWED')
        toast.success(`Renewed — new project ${json.newProject.projectCode}`, { duration: 6000 })
        router.push(`/admin/projects/${json.newProject.id}`)
      } else {
        let note
        if (status === 'CANCELLED') {
          note = prompt('Cancellation reason (optional):')
          if (note === null) return
        }
        const res  = await fetch(`/api/projects/${project.id}/status`, {
          method:  'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ status, note: note || undefined }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Failed')
        onUpdated(project.id, status)
        toast.success(`Status → ${STATUS_META[status]?.label ?? status}`)
      }
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div ref={btnRef} className="relative inline-block">
      <button
        onClick={handleOpen}
        disabled={saving}
        className="group inline-flex h-7 items-center gap-1.5 rounded-md px-2 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50"
      >
        {saving
          ? <span className="size-1.5 rounded-full bg-gray-300 animate-pulse" />
          : <span className={`size-1.5 rounded-full shrink-0 ${STATUS_DOT[project.status] ?? 'bg-gray-400'}`} />
        }
        {STATUS_META[project.status]?.label ?? project.status}
        {canChange && <ChevronDown className="size-3.5 text-gray-400 group-hover:text-gray-600" />}
      </button>

      {open && canChange && (
        <div
          onClick={e => e.stopPropagation()}
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}
          className="w-48 rounded-xl border border-gray-200/80 bg-white p-1 shadow-lg"
        >
          {statuses.map(({ key, label, special }) => (
            <Fragment key={key}>
              {special && <div className="-mx-1 my-1 h-px bg-gray-100" />}
              <button
                onClick={e => handleSelect(e, key)}
                className={cn(
                  'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors',
                  key === project.status ? 'font-medium text-gray-900 bg-gray-100' : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                )}
              >
                <span className={`size-1.5 rounded-full shrink-0 ${STATUS_DOT[key] ?? 'bg-gray-400'}`} />
                {label}
                {special && <span className="ml-auto text-[11px] text-gray-400">New project</span>}
                {!special && key === project.status && <Check className="ml-auto size-4 text-gray-500" />}
              </button>
            </Fragment>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Row Menu ─────────────────────────────────────────────────────────────────

function RowMenu({ project, onDeleted }) {
  const router = useRouter()
  const { can, role } = usePermission()
  // DELETE /api/projects/:id is SUPER_ADMIN-only.
  const canDelete = role === 'SUPER_ADMIN' && can('projects.delete')

  async function handleDelete() {
    if (!confirm(`Delete "${project.name}"? This can't be undone.`)) return
    try {
      const res = await fetch(`/api/projects/${project.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Project deleted')
      onDeleted(project.id)
    } catch (err) {
      toast.error(err.message)
    }
  }

  return (
    <ActionMenu items={[
      { label: 'View', icon: Eye, onClick: () => router.push(`/admin/projects/${project.id}`) },
      can('projects.update') && { label: 'Edit', icon: Pencil, onClick: () => router.push(`/admin/projects/${project.id}/edit`) },
      canDelete && { label: 'Delete', icon: Trash2, danger: true, onClick: handleDelete },
    ]} />
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ProjectsPage() {
  const router  = useRouter()
  const { ventures } = useConfig()
  const [projects,  setProjects]  = useState([])
  const [meta,      setMeta]      = useState({ page: 1, pages: 1, total: 0 })
  const [stats,     setStats]     = useState(null)
  const [loading,   setLoading]   = useState(true)
  const [search,    setSearch]    = useState('')
  const [venture,   setVenture]   = useState('')
  const [type,      setType]      = useState('')
  const [status,    setStatus]    = useState('')
  const [page,      setPage]      = useState(1)
  const [startDate, setStartDate] = useState('')
  const [endDate,   setEndDate]   = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const requestSeq = useRef(0)

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search.trim()), 300)
    return () => clearTimeout(t)
  }, [search])

  useEffect(() => {
    fetch('/api/projects/stats').then(r => r.json()).then(j => { if (j.data) setStats(j.data) })
  }, [])

  const loadProjects = useCallback(async () => {
    // Only the latest request may update the list (search responses can
    // resolve out of order).
    const seq = ++requestSeq.current
    setLoading(true)
    try {
      const p = new URLSearchParams({ page, limit: 25 })
      if (debouncedSearch) p.set('search',  debouncedSearch)
      if (venture)   p.set('venture',     venture)
      if (type)      p.set('projectType', type)
      if (status)    p.set('status',      status)
      if (startDate) p.set('startDate',   startDate)
      if (endDate)   p.set('endDate',     endDate)
      const res  = await fetch(`/api/projects?${p}`)
      const json = await res.json()
      if (seq !== requestSeq.current) return
      if (!res.ok) throw new Error(json.error)
      setProjects(json.data ?? [])
      setMeta(json.meta ?? { page: 1, pages: 1, total: 0 })
    } catch (err) {
      if (seq === requestSeq.current) toast.error(err.message ?? 'Failed to load')
    } finally {
      if (seq === requestSeq.current) setLoading(false)
    }
  }, [page, debouncedSearch, venture, type, status, startDate, endDate])

  useEffect(() => { loadProjects() }, [loadProjects])

  function handleDeleted(id) {
    setProjects(prev => prev.filter(p => p.id !== id))
    setMeta(m => ({ ...m, total: m.total - 1 }))
  }

  function handleStatusUpdated(id, status) {
    setProjects(prev => prev.map(p => p.id === id ? { ...p, status } : p))
  }

  function filterByStatus(s) {
    setStatus(prev => prev === s ? '' : s)
    setPage(1)
  }

  const hasFilters = search || venture || type || status || startDate || endDate

  // Build status count map from stats — exact per-status counts so each chip's
  // number matches the list its (exact status) filter produces
  const statusCountMap = {}
  if (stats) {
    statusCountMap[''] = stats.total ?? 0
    for (const k of ['PENDING', 'IN_PROGRESS', 'ON_HOLD', 'FEEDBACK', 'SUBMITTED', 'DELIVERED', 'CANCELLED'])
      statusCountMap[k] = stats.byStatus?.[k] ?? 0
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Projects"
        actions={
          <Can perm="projects.create">
            <Button href="/admin/projects/new"><Plus /> New project</Button>
          </Can>
        }
      />

      {/* Venture tabs */}
      <Tabs
        variant="underline"
        value={venture}
        onChange={v => { setVenture(v); setPage(1) }}
        tabs={[['', 'All ventures'], ...ventures.map(v => [v.id, v.label])].map(([v, l]) => ({ value: v, label: l }))}
      />

      {/* Status filter */}
      <Tabs
        size="sm"
        value={status}
        onChange={filterByStatus}
        tabs={STATUS_OVERVIEW.map(({ label, filterKey }) => ({
          value: filterKey,
          label,
          count: stats ? (statusCountMap[filterKey] ?? 0) : undefined,
        }))}
      />

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search…"
            className={cn(inputClass, 'pl-9')}
          />
        </div>
        <Select value={type} onChange={v => { setType(v ?? ''); setPage(1) }}
          options={[
            { value: 'FIXED',   label: 'Fixed' },
            { value: 'MONTHLY', label: 'Monthly' },
          ]}
          placeholder="All types"
          className="w-36"
        />
        <div className="flex items-center gap-1.5">
          <DatePicker value={startDate || null} onChange={v => { setStartDate(v ?? ''); setPage(1) }} placeholder="From" />
          <span className="text-xs text-gray-400">–</span>
          <DatePicker value={endDate || null} onChange={v => { setEndDate(v ?? ''); setPage(1) }} placeholder="To" />
        </div>
        {hasFilters && (
          <Button variant="ghost" size="sm"
            onClick={() => { setSearch(''); setVenture(''); setType(''); setStatus(''); setStartDate(''); setEndDate(''); setPage(1) }}>
            Clear
          </Button>
        )}
        <span className="text-[13px] text-muted-foreground tabular-nums sm:ml-auto">{meta.total} project{meta.total !== 1 ? 's' : ''}</span>
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-20">
            <LoadingSpinner />
          </div>
        ) : projects.length === 0 ? (
          <EmptyState
            icon={FolderKanban}
            title={hasFilters ? 'No results' : 'No projects yet'}
            description={hasFilters ? 'Try adjusting your filters.' : undefined}
          />
        ) : (
          <Table className="min-w-[1100px]">
            <TableHeader>
              <TableRow>
                <TableHead>Project ID</TableHead>
                <TableHead>Venture</TableHead>
                <TableHead>Project</TableHead>
                <TableHead>Client</TableHead>
                <TableHead>Type</TableHead>
                <TableHead className="text-right">Net value</TableHead>
                <TableHead className="text-right">Paid</TableHead>
                <TableHead className="text-right">Due</TableHead>
                <TableHead className="text-right">Expense</TableHead>
                <TableHead className="text-right">Profit</TableHead>
                <TableHead>Due / period</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="w-10" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {projects.map(p => {
                const vm      = ventures.find(v => v.id === p.venture) ?? {}
                const due     = p.projectType === 'FIXED' ? p.deadline : p.currentPeriodEnd
                // Overdue once the due day (Asia/Dhaka) has passed; renewed retainers are never overdue.
                const isOverd = due && dhakaDayKey(due) < dhakaDayKey() && !['DELIVERED','CANCELLED','APPROVED','RENEWED'].includes(p.status)

                // Financials — profit is cash basis: what client paid minus what was spent
                const netBudget = Number(p.budget       ?? 0)   // budget IS the project value
                const paid      = Number(p.paidAmount   ?? 0)
                const expense   = Number(p.approvedExpenses ?? 0)
                const profit    = paid - expense
                const dueBal    = Math.max(0, netBudget - paid)

                return (
                  <TableRow key={p.id}
                    onClick={() => router.push(`/admin/projects/${p.id}`)}
                    className="cursor-pointer">
                    <TableCell className="whitespace-nowrap">
                      <span className="font-mono text-[13px] font-medium text-gray-900">{p.projectCode ?? '—'}</span>
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-gray-600">
                      {vm.label ?? p.venture}
                    </TableCell>
                    <TableCell className="min-w-44">
                      <p className="max-w-48 truncate font-medium text-gray-900">{p.name}</p>
                      <p className="mt-0.5 max-w-48 truncate text-xs text-muted-foreground">
                        {p.category}{p.subcategory ? ` › ${p.subcategory}` : ''}
                      </p>
                    </TableCell>
                    <TableCell>
                      <p className="max-w-28 truncate text-gray-700">{p.clientId?.userId?.name ?? '—'}</p>
                      {p.clientId?.company && (
                        <p className="max-w-28 truncate text-xs text-muted-foreground">{p.clientId.company}</p>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-gray-600">
                      {p.projectType === 'MONTHLY' ? 'Monthly' : 'Fixed'}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">
                      <TkAmt value={netBudget} className="text-gray-900" />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">
                      <TkAmt value={paid} className="text-emerald-600" />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">
                      <TkAmt value={dueBal} className={dueBal > 0 ? 'text-amber-600' : 'text-gray-400'} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">
                      <TkAmt value={expense} className="text-gray-600" />
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums">
                      <TkAmt value={profit} className={`font-medium ${profit >= 0 ? 'text-gray-900' : 'text-red-600'}`} />
                    </TableCell>
                    <TableCell className="whitespace-nowrap">
                      {isOverd ? (
                        <span className="text-xs font-medium text-red-600">Overdue · {fmtDate(due)}</span>
                      ) : (
                        <span className="text-xs text-muted-foreground">{fmtDate(due)}</span>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap py-2" onClick={e => e.stopPropagation()}>
                      <StatusDropdown project={p} onUpdated={handleStatusUpdated} />
                    </TableCell>
                    <TableCell className="py-2 text-right" onClick={e => e.stopPropagation()}>
                      <RowMenu project={p} onDeleted={handleDeleted} />
                    </TableCell>
                  </TableRow>
                )
              })}
            </TableBody>
          </Table>
        )}

        {meta.pages > 1 && (
          <div className="border-t border-gray-100 px-4 py-3">
            <Pagination page={meta.page} pages={meta.pages} onPageChange={setPage} />
          </div>
        )}
      </Card>
    </div>
  )
}
