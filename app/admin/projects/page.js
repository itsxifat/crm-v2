'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Search, MoreHorizontal, Eye, Pencil, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import toast from 'react-hot-toast'
import { VENTURES, VENTURE_META, STATUS_META } from '@/lib/ventures'
import TkAmt from '@/components/ui/TkAmt'
import Select from '@/components/ui/Select'
import DatePicker from '@/components/ui/DatePicker'

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
  { key: 'IN_PROGRESS', label: 'In Progress', filterKey: 'IN_PROGRESS' },
  { key: 'ON_HOLD',     label: 'On Hold',     filterKey: 'ON_HOLD' },
  { key: 'FEEDBACK',    label: 'Feedback',    filterKey: 'FEEDBACK' },
  { key: 'SUBMITTED',   label: 'Submitted',   filterKey: 'SUBMITTED' },
  { key: 'DELIVERED',   label: 'Delivered',   filterKey: 'DELIVERED' },
  { key: 'CANCELLED',   label: 'Cancelled',   filterKey: 'CANCELLED' },
]

// ─── Status Dropdown ─────────────────────────────────────────────────────────

const BASE_STATUSES = [
  { key: 'PENDING',     label: 'Pending'     },
  { key: 'IN_PROGRESS', label: 'In Progress' },
  { key: 'IN_REVIEW',   label: 'In Review'   },
  { key: 'REVISION',    label: 'Revision'    },
  { key: 'DELIVERED',   label: 'Delivered'   },
]

function StatusDropdown({ project, onUpdated }) {
  const router = useRouter()
  const [open,   setOpen]   = useState(false)
  const [saving, setSaving] = useState(false)
  const [pos,    setPos]    = useState({ top: 0, left: 0 })
  const btnRef = useRef(null)

  const isMonthly = project.projectType === 'MONTHLY'
  const statuses  = isMonthly
    ? [...BASE_STATUSES, { key: 'RENEWED', label: 'Renewed', special: true }]
    : BASE_STATUSES

  useEffect(() => {
    function h(e) { if (btnRef.current && !btnRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  function handleOpen(e) {
    e.stopPropagation()
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
        toast.success(`Renewed! New project created: ${json.newProject.projectCode}`, { duration: 6000 })
        router.push(`/admin/projects/${json.newProject.id}`)
      } else {
        const res  = await fetch(`/api/projects/${project.id}`, {
          method:  'PUT',
          headers: { 'Content-Type': 'application/json' },
          body:    JSON.stringify({ status }),
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
        className="inline-flex items-center gap-1.5 text-xs text-gray-600 hover:text-gray-900 px-2 py-1 rounded-lg hover:bg-gray-100 transition-colors disabled:opacity-50 group"
      >
        {saving
          ? <span className="w-1.5 h-1.5 rounded-full bg-gray-300 animate-pulse" />
          : <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[project.status] ?? 'bg-gray-400'}`} />
        }
        {STATUS_META[project.status]?.label ?? project.status}
        <svg className="w-3 h-3 text-gray-400 group-hover:text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {open && (
        <div
          onClick={e => e.stopPropagation()}
          style={{ position: 'fixed', top: pos.top, left: pos.left, zIndex: 9999 }}
          className="w-44 bg-white border border-gray-200 rounded-xl shadow-lg py-1 overflow-hidden"
        >
          {statuses.map(({ key, label, special }) => (
            <button
              key={key}
              onClick={e => handleSelect(e, key)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 text-xs transition-colors
                ${key === project.status ? 'font-semibold text-gray-900 bg-gray-50' : 'text-gray-600 hover:bg-gray-50'}
                ${special ? 'border-t border-gray-100 text-blue-600 hover:bg-blue-50' : ''}`}
            >
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${STATUS_DOT[key] ?? 'bg-gray-400'}`} />
              {label}
              {special && <span className="ml-auto text-blue-400 text-[10px]">new project</span>}
              {!special && key === project.status && <span className="ml-auto text-gray-400">✓</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

// ─── Row Menu ─────────────────────────────────────────────────────────────────

function RowMenu({ project, onDeleted }) {
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [pos,  setPos]  = useState({ top: 0, right: 0 })
  const btnRef = useRef(null)

  useEffect(() => {
    function h(e) { if (btnRef.current && !btnRef.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', h)
    return () => document.removeEventListener('mousedown', h)
  }, [])

  function handleOpen(e) {
    e.stopPropagation()
    const rect = btnRef.current.getBoundingClientRect()
    setPos({ top: rect.bottom + window.scrollY + 4, right: window.innerWidth - rect.right })
    setOpen(o => !o)
  }

  async function handleDelete() {
    setOpen(false)
    if (!confirm(`Delete "${project.name}"? This cannot be undone.`)) return
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
    <div ref={btnRef} className="inline-block">
      <button onClick={handleOpen}
        className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100 transition-colors">
        <MoreHorizontal className="w-4 h-4" />
      </button>
      {open && (
        <div style={{ position: 'fixed', top: pos.top, right: pos.right, zIndex: 9999 }}
          className="w-44 bg-white rounded-xl shadow-lg border border-gray-100 py-1 text-sm">
          <button onClick={() => { setOpen(false); router.push(`/admin/projects/${project.id}`) }}
            className="w-full flex items-center gap-2.5 px-4 py-2 text-gray-700 hover:bg-gray-50">
            <Eye className="w-3.5 h-3.5 text-gray-400" /> View Details
          </button>
          <button onClick={() => { setOpen(false); router.push(`/admin/projects/${project.id}/edit`) }}
            className="w-full flex items-center gap-2.5 px-4 py-2 text-gray-700 hover:bg-gray-50">
            <Pencil className="w-3.5 h-3.5 text-gray-400" /> Edit Project
          </button>
          <div className="border-t border-gray-100 my-1" />
          <button onClick={handleDelete}
            className="w-full flex items-center gap-2.5 px-4 py-2 text-red-600 hover:bg-red-50">
            <Trash2 className="w-3.5 h-3.5" /> Delete
          </button>
        </div>
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function ProjectsPage() {
  const router  = useRouter()
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

  useEffect(() => {
    fetch('/api/projects/stats').then(r => r.json()).then(j => { if (j.data) setStats(j.data) })
  }, [])

  const loadProjects = useCallback(async () => {
    setLoading(true)
    try {
      const p = new URLSearchParams({ page, limit: 25 })
      if (search)    p.set('search',      search)
      if (venture)   p.set('venture',     venture)
      if (type)      p.set('projectType', type)
      if (status)    p.set('status',      status)
      if (startDate) p.set('startDate',   startDate)
      if (endDate)   p.set('endDate',     endDate)
      const res  = await fetch(`/api/projects?${p}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setProjects(json.data ?? [])
      setMeta(json.meta ?? { page: 1, pages: 1, total: 0 })
    } catch (err) {
      toast.error(err.message ?? 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [page, search, venture, type, status, startDate, endDate])

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

  // Build status count map from stats
  const statusCountMap = {}
  if (stats) {
    statusCountMap[''] = stats.total ?? 0
    statusCountMap['PENDING']     = stats.notStarted     ?? 0
    statusCountMap['IN_PROGRESS'] = stats.active         ?? 0
    statusCountMap['ON_HOLD']     = stats.onHold         ?? 0
    statusCountMap['FEEDBACK']    = stats.feedback        ?? 0
    statusCountMap['SUBMITTED']   = stats.submitted       ?? 0
    statusCountMap['DELIVERED']   = stats.delivered       ?? 0
    statusCountMap['CANCELLED']   = stats.cancelled       ?? 0
  }

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Projects</h1>
        <Link href="/admin/projects/new"
          className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
          <Plus className="w-4 h-4" /> New Project
        </Link>
      </div>

      {/* Status overview chips */}
      <div className="flex flex-wrap gap-2">
        {STATUS_OVERVIEW.map(({ key, label, filterKey }) => (
          <button
            key={key}
            onClick={() => filterByStatus(filterKey)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              status === filterKey && (filterKey !== '' || status === '')
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400 hover:text-gray-800'
            }`}
          >
            {filterKey && <span className={`w-1.5 h-1.5 rounded-full ${STATUS_DOT[filterKey] ?? 'bg-gray-400'}`} />}
            {label}
            {stats && (
              <span className={`ml-0.5 ${
                status === filterKey && (filterKey !== '' || status === '') ? 'text-gray-300' : 'text-gray-400'
              }`}>
                {statusCountMap[filterKey] ?? 0}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Venture tabs */}
      <div className="flex items-center gap-6 border-b border-gray-100">
        {[['', 'All Ventures'], ...VENTURES.map(v => [v, VENTURE_META[v]?.label ?? v])].map(([v, l]) => (
          <button
            key={v}
            onClick={() => { setVenture(v); setPage(1) }}
            className={`pb-2.5 text-sm transition-colors border-b-2 ${
              venture === v
                ? 'border-blue-600 text-blue-600 font-medium'
                : 'border-transparent text-gray-400 hover:text-gray-600'
            }`}
          >
            {l}
          </button>
        ))}
      </div>

      {/* Filters row */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative flex-1 min-w-52 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
          <input
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1) }}
            placeholder="Search projects…"
            className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 placeholder-gray-400"
          />
        </div>
        <Select value={type} onChange={v => { setType(v ?? ''); setPage(1) }}
          options={[
            { value: 'FIXED',   label: 'Fixed' },
            { value: 'MONTHLY', label: 'Monthly' },
          ]}
          placeholder="All Types"
          size="sm"
          className="w-36"
        />
        {/* Date range */}
        <div className="flex items-center gap-1.5">
          <DatePicker value={startDate || null} onChange={v => { setStartDate(v ?? ''); setPage(1) }} />
          <span className="text-xs text-gray-400">—</span>
          <DatePicker value={endDate || null} onChange={v => { setEndDate(v ?? ''); setPage(1) }} />
        </div>
        {hasFilters && (
          <button
            onClick={() => { setSearch(''); setVenture(''); setType(''); setStatus(''); setStartDate(''); setEndDate(''); setPage(1) }}
            className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5 rounded hover:bg-gray-100 transition-colors">
            Clear
          </button>
        )}
        <span className="text-xs text-gray-400 ml-auto">{meta.total} project{meta.total !== 1 ? 's' : ''}</span>
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-20">
            <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-20">
            <p className="text-sm text-gray-500 font-medium">No projects found</p>
            {hasFilters && <p className="text-xs text-gray-400 mt-1">Try adjusting your filters</p>}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1100px]">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60">
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide whitespace-nowrap">Project ID</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Venture</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Project Name</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Client</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Type</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wide">Budget</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wide">Paid</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wide">Due</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wide">Expense</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wide">Profit</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide whitespace-nowrap">Due / Period</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {projects.map(p => {
                  const vm      = VENTURE_META[p.venture] ?? {}
                  const due     = p.projectType === 'FIXED' ? p.deadline : p.currentPeriodEnd
                  const isOverd = due && new Date(due) < new Date() && !['DELIVERED','CANCELLED','APPROVED'].includes(p.status)

                  // Financials
                  const budget  = Number(p.budget  ?? 0)
                  const paid    = Number(p.paidAmount    ?? 0)
                  const expense = Number(p.approvedExpenses ?? 0)
                  const profit  = budget - expense
                  const dueBal  = budget - paid

                  return (
                    <tr key={p.id}
                      onClick={() => router.push(`/admin/projects/${p.id}`)}
                      className="hover:bg-gray-50/60 cursor-pointer transition-colors">
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="text-sm font-mono font-medium text-gray-800">{p.projectCode ?? '—'}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap text-sm text-gray-600">
                        {vm.label ?? p.venture}
                      </td>
                      <td className="px-4 py-3 min-w-44">
                        <p className="text-sm font-medium text-gray-900 truncate max-w-48">{p.name}</p>
                        <p className="text-xs text-gray-400 mt-0.5 truncate max-w-48">
                          {p.category}{p.subcategory ? ` › ${p.subcategory}` : ''}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        <p className="text-sm text-gray-700 truncate max-w-28">{p.clientId?.userId?.name ?? '—'}</p>
                        {p.clientId?.company && (
                          <p className="text-xs text-gray-400 truncate max-w-28">{p.clientId.company}</p>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="text-xs text-gray-500">{p.projectType === 'MONTHLY' ? 'Monthly' : 'Fixed'}</span>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <TkAmt value={budget || null} className="text-sm text-gray-700" />
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <TkAmt value={paid} className="text-sm text-green-600" />
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <TkAmt value={dueBal > 0 ? dueBal : null} className={`text-sm ${dueBal > 0 ? 'text-amber-600' : 'text-gray-400'}`} />
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <TkAmt value={expense} className="text-sm text-red-500" />
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <TkAmt value={profit} className={`text-sm font-medium ${profit >= 0 ? 'text-gray-800' : 'text-red-500'}`} />
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {isOverd ? (
                          <span className="text-xs text-red-500">Overdue · {fmtDate(due)}</span>
                        ) : (
                          <span className="text-xs text-gray-500">{fmtDate(due)}</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap" onClick={e => e.stopPropagation()}>
                        <StatusDropdown project={p} onUpdated={handleStatusUpdated} />
                      </td>
                      <td className="px-4 py-3 text-right" onClick={e => e.stopPropagation()}>
                        <RowMenu project={p} onDeleted={handleDeleted} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}

        {meta.pages > 1 && (
          <div className="px-4 py-3 border-t border-gray-100 flex items-center justify-between">
            <p className="text-xs text-gray-400">Page {meta.page} of {meta.pages}</p>
            <div className="flex gap-2">
              <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                className="px-3 py-1.5 text-xs text-gray-600 border border-gray-200 rounded-lg disabled:opacity-30 hover:bg-gray-50 transition-colors">
                Prev
              </button>
              <button disabled={page >= meta.pages} onClick={() => setPage(p => p + 1)}
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
