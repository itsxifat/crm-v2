'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import {
  Search, Plus, ChevronDown, Circle, CheckCircle2, Check,
  Loader2, Flag, AlertTriangle, Clock, MoreHorizontal, Trash2,
} from 'lucide-react'
import Select from '@/components/ui/Select'
import { usePermission } from '@/components/auth/Can'
import TaskDetailModal from '@/components/admin/projects/TaskDetailModal'
import Button from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { inputClass } from '@/components/ui/Input'
import PageHeader from '@/components/ui/PageHeader'
import Tabs from '@/components/ui/Tabs'
import Badge from '@/components/ui/Badge'
import EmptyState from '@/components/ui/EmptyState'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import Pagination from '@/components/ui/Pagination'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { cn } from '@/lib/utils'

// ─── Config ───────────────────────────────────────────────────────────────────

const STATUS_TABS = [
  { key: '',            label: 'All' },
  { key: 'TODO',        label: 'To do' },
  { key: 'IN_PROGRESS', label: 'In progress' },
  { key: 'IN_REVIEW',   label: 'In review' },
  { key: 'COMPLETED',   label: 'Completed' },
  { key: 'CANCELLED',   label: 'Cancelled' },
]

const STATUS_CFG = {
  TODO:        { label: 'To do',       dot: 'bg-gray-400',    variant: 'default', cls: 'bg-gray-100 text-gray-700 ring-gray-500/10' },
  IN_PROGRESS: { label: 'In progress', dot: 'bg-blue-500',    variant: 'primary', cls: 'bg-blue-50 text-blue-700 ring-blue-600/15' },
  IN_REVIEW:   { label: 'In review',   dot: 'bg-violet-500',  variant: 'purple',  cls: 'bg-violet-50 text-violet-700 ring-violet-600/15' },
  COMPLETED:   { label: 'Completed',   dot: 'bg-emerald-500', variant: 'success', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-600/15' },
  CANCELLED:   { label: 'Cancelled',   dot: 'bg-red-400',     variant: 'danger',  cls: 'bg-red-50 text-red-700 ring-red-600/15' },
}

const PRIORITY_CFG = {
  LOW:    { label: 'Low',    icon: Circle,        color: 'text-gray-400' },
  MEDIUM: { label: 'Medium', icon: Flag,          color: 'text-blue-500' },
  HIGH:   { label: 'High',   icon: AlertTriangle, color: 'text-orange-500' },
  URGENT: { label: 'Urgent', icon: Flag,          color: 'text-red-500' },
}

const fmtDate  = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' }) : '—'
const daysLeft = (d) => d ? Math.ceil((new Date(d) - new Date()) / 86400000) : null

// ─── Status dropdown ──────────────────────────────────────────────────────────

function StatusDropdown({ taskId, current, onUpdated }) {
  const [open, setOpen]     = useState(false)
  const [busy, setBusy]     = useState(false)
  const ref                 = useRef(null)
  const cfg                 = STATUS_CFG[current] ?? STATUS_CFG.TODO

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  async function change(status) {
    if (status === current) { setOpen(false); return }
    setBusy(true)
    setOpen(false)
    try {
      const res  = await fetch(`/api/tasks/${taskId}/status`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
      const json = await res.json()
      if (res.ok) onUpdated(json.data)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen(o => !o)}
        className={cn('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset transition-opacity hover:opacity-80', cfg.cls)}
        disabled={busy}>
        {busy ? <Loader2 className="size-3 animate-spin" /> : <span className={`size-1.5 rounded-full ${cfg.dot}`} />}
        {cfg.label}
        <ChevronDown className="size-3 opacity-60" />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-20 mt-1 w-44 rounded-xl border border-gray-200/80 bg-white p-1 shadow-lg">
          {Object.entries(STATUS_CFG).map(([key, c]) => (
            <button key={key} onClick={() => change(key)}
              className={cn(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-[13px] transition-colors hover:bg-gray-100',
                key === current ? 'font-medium text-gray-900' : 'text-gray-700'
              )}>
              <span className={`size-1.5 rounded-full ${c.dot}`} />
              {c.label}
              {key === current && <Check className="ml-auto size-4 text-gray-500" />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Row menu ─────────────────────────────────────────────────────────────────

function RowMenu({ taskId, onDeleted }) {
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const ref             = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  async function del() {
    if (!confirm('Delete this task?')) return
    setBusy(true)
    setOpen(false)
    const res = await fetch(`/api/tasks/${taskId}`, { method: 'DELETE' })
    if (res.ok) onDeleted(taskId)
    else setBusy(false)
  }

  return (
    <div ref={ref} className="relative">
      <Button variant="ghost" size="icon-sm" onClick={() => setOpen(o => !o)} aria-label="Actions" className="text-gray-400 hover:text-gray-900">
        {busy ? <Loader2 className="animate-spin" /> : <MoreHorizontal />}
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-20 mt-1 w-40 rounded-xl border border-gray-200/80 bg-white p-1 shadow-lg">
          <button onClick={del} disabled={busy}
            className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-red-600 transition-colors hover:bg-red-50">
            <Trash2 className="size-4" />
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TasksPage() {
  const [tasks,    setTasks]    = useState([])
  const [loading,  setLoading]  = useState(true)
  const [total,    setTotal]    = useState(0)
  const [page,     setPage]     = useState(1)
  const [statusTab,setStatusTab]= useState('')
  const [priority, setPriority] = useState('')
  const [search,   setSearch]   = useState('')
  const [searchQ,  setSearchQ]  = useState('')
  const [openTaskId, setOpenTaskId] = useState(null)
  const limit                   = 30

  const { can } = usePermission()
  const canCreateTask = can('tasks.create')
  const canUpdateTask = can('tasks.update')
  const canDeleteTask = can('tasks.delete')

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ page, limit })
    if (statusTab) params.set('status', statusTab)
    if (priority)  params.set('priority', priority)
    if (searchQ)   params.set('search', searchQ)
    const res  = await fetch(`/api/tasks?${params}`)
    const json = await res.json()
    setTasks(json.data ?? [])
    setTotal(json.meta?.total ?? 0)
    setLoading(false)
  }, [page, statusTab, priority, searchQ])

  useEffect(() => { load() }, [load])

  // debounce search
  useEffect(() => {
    const t = setTimeout(() => { setSearchQ(search); setPage(1) }, 350)
    return () => clearTimeout(t)
  }, [search])

  function handleStatusChange(tab) { setStatusTab(tab); setPage(1) }
  function handleUpdated(updated)  { setTasks(ts => ts.map(t => t.id === updated.id ? { ...t, ...updated, projectId: t.projectId } : t)) }
  function handleDeleted(id)       { setTasks(ts => ts.filter(t => t.id !== id)); setTotal(n => n - 1) }

  const pages = Math.ceil(total / limit)

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tasks"
        description={`${total} task${total !== 1 ? 's' : ''}`}
        actions={canCreateTask && (
          <Button href="/admin/projects"><Plus /> New task</Button>
        )}
      />

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          size="sm"
          value={statusTab}
          onChange={handleStatusChange}
          tabs={STATUS_TABS.map(t => ({ value: t.key, label: t.label }))}
        />
        <div className="relative w-full sm:w-64">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search…"
            className={cn(inputClass, 'pl-9')}
          />
        </div>
        <Select value={priority} onChange={v => { setPriority(v ?? ''); setPage(1) }}
          options={[
            { value: 'LOW',    label: 'Low' },
            { value: 'MEDIUM', label: 'Medium' },
            { value: 'HIGH',   label: 'High' },
            { value: 'URGENT', label: 'Urgent' },
          ]}
          placeholder="All priorities"
          className="w-36"
        />
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        <Table className="min-w-[760px]">
          <TableHeader>
            <TableRow>
              <TableHead>Task</TableHead>
              <TableHead>Project</TableHead>
              <TableHead>Assignee</TableHead>
              <TableHead>Priority</TableHead>
              <TableHead>Due date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="w-12" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={7} className="py-16">
                  <LoadingSpinner />
                </TableCell>
              </TableRow>
            ) : tasks.length === 0 ? (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={7} className="p-0">
                  <EmptyState
                    icon={CheckCircle2}
                    title={searchQ || statusTab || priority ? 'No results' : 'No tasks yet'}
                    description={searchQ || statusTab || priority ? 'Try adjusting your filters.' : undefined}
                  />
                </TableCell>
              </TableRow>
            ) : tasks.map(task => {
              const dl       = daysLeft(task.dueDate)
              const dlLabel  = dl == null ? '—' : dl < 0 ? `${Math.abs(dl)}d late` : dl === 0 ? 'Today' : fmtDate(task.dueDate)
              const dlColor  = dl == null ? 'text-gray-300' : dl < 0 ? 'text-red-600 font-medium' : dl === 0 ? 'text-amber-600 font-medium' : 'text-gray-600'
              const pCfg     = PRIORITY_CFG[task.priority] ?? PRIORITY_CFG.MEDIUM
              const PIcon    = pCfg.icon
              const assignee = task.assignedEmployeeId?.userId?.name ?? task.assignedFreelancerId?.userId?.name ?? null

              return (
                <TableRow key={task.id}>
                  {/* Task */}
                  <TableCell className="max-w-[280px]">
                    <button type="button" onClick={() => setOpenTaskId(task.id)}
                      className="block max-w-full truncate text-left font-medium text-gray-900 underline-offset-4 hover:underline">
                      {task.title}
                    </button>
                    {task.description && (
                      <p className="mt-0.5 truncate text-xs text-muted-foreground">{task.description}</p>
                    )}
                    {(task._count?.comments > 0 || task._count?.attachments > 0) && (
                      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
                        {task._count?.comments > 0 && <span>{task._count.comments} comment{task._count.comments !== 1 ? 's' : ''}</span>}
                        {task._count?.attachments > 0 && <span>{task._count.attachments} file{task._count.attachments !== 1 ? 's' : ''}</span>}
                      </div>
                    )}
                  </TableCell>
                  {/* Project */}
                  <TableCell>
                    {task.projectId ? (
                      <Link href={`/admin/projects/${task.projectId.id ?? task.projectId}`}
                        className="font-medium text-gray-900 underline-offset-4 hover:underline">
                        {task.projectId.name ?? 'Project'}
                      </Link>
                    ) : <span className="text-gray-400">—</span>}
                  </TableCell>
                  {/* Assignee */}
                  <TableCell className="text-gray-600">
                    {assignee ?? <span className="text-gray-400">Unassigned</span>}
                  </TableCell>
                  {/* Priority */}
                  <TableCell>
                    <div className="flex items-center gap-1.5 text-xs font-medium text-gray-700">
                      <PIcon className={`size-3.5 ${pCfg.color}`} />
                      {pCfg.label}
                    </div>
                  </TableCell>
                  {/* Due date */}
                  <TableCell>
                    <div className="flex items-center gap-1 whitespace-nowrap">
                      {dl != null && dl <= 1 && <Clock className="size-3.5 text-amber-500" />}
                      <span className={dlColor}>{dlLabel}</span>
                    </div>
                  </TableCell>
                  {/* Status */}
                  <TableCell>
                    {canUpdateTask
                      ? <StatusDropdown taskId={task.id} current={task.status} onUpdated={handleUpdated} />
                      : (
                        <Badge variant={STATUS_CFG[task.status]?.variant ?? 'default'} dot>
                          {STATUS_CFG[task.status]?.label ?? task.status}
                        </Badge>
                      )
                    }
                  </TableCell>
                  {/* Actions */}
                  <TableCell className="px-3 py-2 text-right">
                    {canDeleteTask && <RowMenu taskId={task.id} onDeleted={handleDeleted} />}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>

        {/* Pagination */}
        {pages > 1 && (
          <div className="border-t border-gray-100 px-4 py-3">
            <Pagination page={page} pages={pages} total={total} limit={limit} onPageChange={setPage} />
          </div>
        )}
      </Card>

      {openTaskId && (
        <TaskDetailModal taskId={openTaskId} onClose={() => setOpenTaskId(null)} onUpdate={load} />
      )}
    </div>
  )
}
