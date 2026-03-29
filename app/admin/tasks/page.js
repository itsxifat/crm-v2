'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import {
  Search, Plus, ChevronDown, Circle, CheckCircle2,
  Loader2, Flag, AlertTriangle, Clock, MoreHorizontal, Trash2,
  ExternalLink, Filter,
} from 'lucide-react'

// ─── Config ───────────────────────────────────────────────────────────────────

const STATUS_TABS = [
  { key: '',            label: 'All' },
  { key: 'TODO',        label: 'To Do' },
  { key: 'IN_PROGRESS', label: 'In Progress' },
  { key: 'IN_REVIEW',   label: 'In Review' },
  { key: 'COMPLETED',   label: 'Completed' },
  { key: 'CANCELLED',   label: 'Cancelled' },
]

const STATUS_CFG = {
  TODO:        { label: 'To Do',       dot: 'bg-gray-400',    text: 'text-gray-600',   bg: 'bg-gray-100' },
  IN_PROGRESS: { label: 'In Progress', dot: 'bg-blue-500',    text: 'text-blue-700',   bg: 'bg-blue-50' },
  IN_REVIEW:   { label: 'In Review',   dot: 'bg-violet-500',  text: 'text-violet-700', bg: 'bg-violet-50' },
  COMPLETED:   { label: 'Completed',   dot: 'bg-emerald-500', text: 'text-emerald-700',bg: 'bg-emerald-50' },
  CANCELLED:   { label: 'Cancelled',   dot: 'bg-red-400',     text: 'text-red-600',    bg: 'bg-red-50' },
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
        className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium transition-colors ${cfg.bg} ${cfg.text} hover:opacity-80`}
        disabled={busy}>
        {busy ? <Loader2 className="w-3 h-3 animate-spin" /> : <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />}
        {cfg.label}
        <ChevronDown className="w-3 h-3 opacity-60" />
      </button>
      {open && (
        <div className="absolute left-0 top-full mt-1 w-40 bg-white border border-gray-100 rounded-xl shadow-lg py-1 z-20">
          {Object.entries(STATUS_CFG).map(([key, c]) => (
            <button key={key} onClick={() => change(key)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs hover:bg-gray-50 transition-colors ${key === current ? 'font-semibold' : ''}`}>
              <span className={`w-1.5 h-1.5 rounded-full ${c.dot}`} />
              {c.label}
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
      <button onClick={() => setOpen(o => !o)}
        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <div className="absolute right-0 top-full mt-1 w-36 bg-white border border-gray-100 rounded-xl shadow-lg py-1 z-20">
          <button onClick={del} disabled={busy}
            className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
            {busy ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TasksPage() {
  const { data: session }       = useSession()
  const [tasks,    setTasks]    = useState([])
  const [loading,  setLoading]  = useState(true)
  const [total,    setTotal]    = useState(0)
  const [page,     setPage]     = useState(1)
  const [statusTab,setStatusTab]= useState('')
  const [priority, setPriority] = useState('')
  const [search,   setSearch]   = useState('')
  const [searchQ,  setSearchQ]  = useState('')
  const limit                   = 30

  const isAdmin = ['SUPER_ADMIN', 'MANAGER'].includes(session?.user?.role)

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
  function handleUpdated(updated)  { setTasks(ts => ts.map(t => t._id === updated._id ? { ...t, ...updated } : t)) }
  function handleDeleted(id)       { setTasks(ts => ts.filter(t => t._id !== id)); setTotal(n => n - 1) }

  const pages = Math.ceil(total / limit)

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Tasks</h1>
          <p className="text-sm text-gray-400 mt-0.5">{total} task{total !== 1 ? 's' : ''} total</p>
        </div>
        {isAdmin && (
          <Link href="/admin/projects"
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
            <Plus className="w-4 h-4" />
            Add Task
          </Link>
        )}
      </div>

      {/* Status tabs */}
      <div className="flex gap-5 border-b border-gray-100 overflow-x-auto">
        {STATUS_TABS.map(t => (
          <button key={t.key} onClick={() => handleStatusChange(t.key)}
            className={`pb-2.5 text-sm whitespace-nowrap transition-colors ${
              statusTab === t.key
                ? 'text-gray-900 border-b-2 border-gray-900 font-medium'
                : 'text-gray-400 hover:text-gray-600'
            }`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search tasks…"
            className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-500"
          />
        </div>
        <div className="flex items-center gap-1.5">
          <Filter className="w-3.5 h-3.5 text-gray-400" />
          <select value={priority} onChange={e => { setPriority(e.target.value); setPage(1) }}
            className="px-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white text-gray-700 focus:outline-none focus:ring-1 focus:ring-blue-500">
            <option value="">All priorities</option>
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="URGENT">Urgent</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                {['Task', 'Project', 'Assignee', 'Priority', 'Due Date', 'Status', ''].map(h => (
                  <th key={h} className={`px-5 py-3 text-xs font-medium text-gray-400 uppercase tracking-wide ${h === 'Task' ? 'text-left' : h === '' ? '' : 'text-left'}`}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr>
                  <td colSpan={7} className="px-5 py-16 text-center">
                    <Loader2 className="w-5 h-5 animate-spin text-blue-600 mx-auto" />
                  </td>
                </tr>
              ) : tasks.length === 0 ? (
                <tr>
                  <td colSpan={7} className="px-5 py-16 text-center">
                    <CheckCircle2 className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                    <p className="text-sm text-gray-400 font-medium">No tasks found</p>
                    <p className="text-xs text-gray-300 mt-1">Try adjusting your filters</p>
                  </td>
                </tr>
              ) : tasks.map(task => {
                const dl       = daysLeft(task.dueDate)
                const dlLabel  = dl == null ? '—' : dl < 0 ? `${Math.abs(dl)}d late` : dl === 0 ? 'Today' : fmtDate(task.dueDate)
                const dlColor  = dl == null ? 'text-gray-300' : dl < 0 ? 'text-red-500 font-medium' : dl === 0 ? 'text-amber-500 font-medium' : 'text-gray-500'
                const pCfg     = PRIORITY_CFG[task.priority] ?? PRIORITY_CFG.MEDIUM
                const PIcon    = pCfg.icon
                const assignee = task.assignedEmployeeId?.userId?.name ?? task.assignedFreelancerId?.userId?.name ?? null

                return (
                  <tr key={task._id} className="hover:bg-gray-50/60 transition-colors">
                    {/* Task */}
                    <td className="px-5 py-3.5 max-w-[280px]">
                      <p className="text-sm font-medium text-gray-800 truncate">{task.title}</p>
                      {task.description && (
                        <p className="text-xs text-gray-400 truncate mt-0.5">{task.description}</p>
                      )}
                      {(task._count?.comments > 0 || task._count?.attachments > 0) && (
                        <div className="flex items-center gap-2 mt-1">
                          {task._count?.comments > 0 && <span className="text-xs text-gray-400">{task._count.comments} comment{task._count.comments !== 1 ? 's' : ''}</span>}
                          {task._count?.attachments > 0 && <span className="text-xs text-gray-400">{task._count.attachments} file{task._count.attachments !== 1 ? 's' : ''}</span>}
                        </div>
                      )}
                    </td>
                    {/* Project */}
                    <td className="px-5 py-3.5">
                      {task.projectId ? (
                        <Link href={`/admin/projects/${task.projectId._id ?? task.projectId}`}
                          className="text-sm text-blue-600 hover:underline flex items-center gap-1">
                          {task.projectId.name ?? 'Project'}
                          <ExternalLink className="w-3 h-3 opacity-60" />
                        </Link>
                      ) : <span className="text-sm text-gray-400">—</span>}
                    </td>
                    {/* Assignee */}
                    <td className="px-5 py-3.5">
                      <span className="text-sm text-gray-600">{assignee ?? <span className="text-gray-300">Unassigned</span>}</span>
                    </td>
                    {/* Priority */}
                    <td className="px-5 py-3.5">
                      <div className={`flex items-center gap-1.5 text-xs font-medium ${pCfg.color}`}>
                        <PIcon className="w-3.5 h-3.5" />
                        {pCfg.label}
                      </div>
                    </td>
                    {/* Due date */}
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1">
                        {dl != null && dl <= 1 && <Clock className="w-3 h-3 text-amber-500" />}
                        <span className={`text-sm ${dlColor}`}>{dlLabel}</span>
                      </div>
                    </td>
                    {/* Status */}
                    <td className="px-5 py-3.5">
                      {isAdmin
                        ? <StatusDropdown taskId={task._id} current={task.status} onUpdated={handleUpdated} />
                        : (
                          <span className={`inline-flex items-center gap-1.5 px-2 py-1 rounded text-xs font-medium ${STATUS_CFG[task.status]?.bg} ${STATUS_CFG[task.status]?.text}`}>
                            <span className={`w-1.5 h-1.5 rounded-full ${STATUS_CFG[task.status]?.dot}`} />
                            {STATUS_CFG[task.status]?.label ?? task.status}
                          </span>
                        )
                      }
                    </td>
                    {/* Actions */}
                    <td className="px-3 py-3.5">
                      {isAdmin && <RowMenu taskId={task._id} onDeleted={handleDeleted} />}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {pages > 1 && (
          <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
            <span className="text-sm text-gray-400">Page {page} of {pages} · {total} tasks</span>
            <div className="flex gap-2">
              <button onClick={() => setPage(p => p - 1)} disabled={page <= 1}
                className="px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg disabled:opacity-30 hover:bg-gray-50 transition-colors">
                Previous
              </button>
              <button onClick={() => setPage(p => p + 1)} disabled={page >= pages}
                className="px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg disabled:opacity-30 hover:bg-gray-50 transition-colors">
                Next
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
