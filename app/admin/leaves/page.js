'use client'

import { useState, useEffect, useCallback } from 'react'
import { Plus, X, Loader2, Check, Ban, Search, CalendarDays } from 'lucide-react'
import Select from '@/components/ui/Select'
import DatePicker from '@/components/ui/DatePicker'

// ─── Config ───────────────────────────────────────────────────────────────────

const STATUS_TABS = [
  { key: '',         label: 'All' },
  { key: 'PENDING',  label: 'Pending' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'REJECTED', label: 'Rejected' },
]

const STATUS_CFG = {
  PENDING:  { label: 'Pending',  bg: 'bg-amber-50',  text: 'text-amber-700',  dot: 'bg-amber-500' },
  APPROVED: { label: 'Approved', bg: 'bg-emerald-50', text: 'text-emerald-700',dot: 'bg-emerald-500' },
  REJECTED: { label: 'Rejected', bg: 'bg-red-50',    text: 'text-red-600',    dot: 'bg-red-500' },
}

const LEAVE_TYPES = ['ANNUAL', 'SICK', 'CASUAL', 'MATERNITY', 'PATERNITY', 'UNPAID', 'OTHER']

const TYPE_CFG = {
  ANNUAL:    { label: 'Annual',    bg: 'bg-blue-50',   text: 'text-blue-700' },
  SICK:      { label: 'Sick',      bg: 'bg-red-50',    text: 'text-red-700' },
  CASUAL:    { label: 'Casual',    bg: 'bg-violet-50', text: 'text-violet-700' },
  MATERNITY: { label: 'Maternity', bg: 'bg-pink-50',   text: 'text-pink-700' },
  PATERNITY: { label: 'Paternity', bg: 'bg-indigo-50', text: 'text-indigo-700' },
  UNPAID:    { label: 'Unpaid',    bg: 'bg-gray-100',  text: 'text-gray-600' },
  OTHER:     { label: 'Other',     bg: 'bg-gray-100',  text: 'text-gray-600' },
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
}

function calcDays(start, end) {
  if (!start || !end) return '—'
  const diff = Math.ceil((new Date(end) - new Date(start)) / 86400000) + 1
  return `${diff} day${diff !== 1 ? 's' : ''}`
}

// ─── New leave modal ──────────────────────────────────────────────────────────

function NewLeaveModal({ employees, onClose, onCreated }) {
  const [form, setForm] = useState({
    employeeId: '',
    type:       'ANNUAL',
    startDate:  '',
    endDate:    '',
    reason:     '',
  })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    try {
      const body = {
        employeeId: form.employeeId,
        type:       form.type,
        startDate:  new Date(form.startDate).toISOString(),
        endDate:    new Date(form.endDate).toISOString(),
        reason:     form.reason || null,
      }
      const res  = await fetch('/api/leaves', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Failed'); setSaving(false); return }
      onCreated(json.data)
    } catch {
      setError('Network error')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">New Leave Request</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Employee</label>
            <Select value={form.employeeId} onChange={v => set('employeeId', v ?? '')}
              options={employees.map(emp => ({ value: emp._id, label: emp.userId?.name ?? 'Unknown' }))}
              placeholder="Select employee…"
            />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Leave Type</label>
            <Select value={form.type} onChange={v => set('type', v ?? 'ANNUAL')}
              options={LEAVE_TYPES.map(t => ({ value: t, label: TYPE_CFG[t]?.label ?? t }))}
              placeholder="Select type…"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">From</label>
              <DatePicker value={form.startDate || null} onChange={v => set('startDate', v ?? '')} />
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">To</label>
              <DatePicker value={form.endDate || null} onChange={v => set('endDate', v ?? '')} />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Reason <span className="text-gray-400 font-normal">(optional)</span></label>
            <textarea value={form.reason} onChange={e => set('reason', e.target.value)}
              rows={2} placeholder="Reason for leave…"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 resize-none" />
          </div>

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              Submit
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function LeavesPage() {
  const [leaves,    setLeaves]    = useState([])
  const [employees, setEmployees] = useState([])
  const [loading,   setLoading]   = useState(true)
  const [statusTab, setStatusTab] = useState('')
  const [typeFilter,setTypeFilter]= useState('')
  const [empFilter, setEmpFilter] = useState('')
  const [search,    setSearch]    = useState('')
  const [showModal, setShowModal] = useState(false)
  const [actioning, setActioning] = useState(null)  // id being approved/rejected

  // Fetch employees once
  useEffect(() => {
    fetch('/api/employees?limit=200')
      .then(r => r.json())
      .then(j => setEmployees(j.data ?? []))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams()
    if (statusTab) params.set('status', statusTab)
    if (empFilter) params.set('employeeId', empFilter)
    if (typeFilter)params.set('type', typeFilter)
    const res  = await fetch(`/api/leaves?${params}`)
    const json = await res.json()
    setLeaves(json.data ?? [])
    setLoading(false)
  }, [statusTab, empFilter, typeFilter])

  useEffect(() => { load() }, [load])

  async function handleAction(id, status) {
    setActioning(id)
    const res  = await fetch(`/api/leaves/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
    const json = await res.json()
    if (res.ok) setLeaves(ls => ls.map(l => l._id === id ? { ...l, ...json.data } : l))
    setActioning(null)
  }

  async function handleDelete(id) {
    if (!confirm('Delete this leave request?')) return
    const res = await fetch(`/api/leaves/${id}`, { method: 'DELETE' })
    if (res.ok) setLeaves(ls => ls.filter(l => l._id !== id))
  }

  function handleCreated(leave) {
    setLeaves(ls => [leave, ...ls])
    setShowModal(false)
  }

  // Filter by search
  const filtered = leaves.filter(l => {
    const name = l.employeeId?.userId?.name ?? ''
    return name.toLowerCase().includes(search.toLowerCase())
  })

  // Stats counts
  const pending  = leaves.filter(l => l.status === 'PENDING').length
  const approved = leaves.filter(l => l.status === 'APPROVED').length
  const rejected = leaves.filter(l => l.status === 'REJECTED').length

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Leaves</h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {pending > 0 ? `${pending} pending approval` : 'No pending requests'}
          </p>
        </div>
        <button onClick={() => setShowModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
          <Plus className="w-4 h-4" />
          New Request
        </button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        {[
          { label: 'Pending',  count: pending,  dot: 'bg-amber-500',   click: 'PENDING' },
          { label: 'Approved', count: approved, dot: 'bg-emerald-500', click: 'APPROVED' },
          { label: 'Rejected', count: rejected, dot: 'bg-red-500',     click: 'REJECTED' },
        ].map(s => (
          <div key={s.label} onClick={() => setStatusTab(prev => prev === s.click ? '' : s.click)}
            className={`bg-white border border-gray-100 rounded-xl p-4 flex items-center gap-3 cursor-pointer transition-all ${statusTab === s.click ? 'ring-2 ring-blue-500' : 'hover:shadow-sm'}`}>
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${s.dot}`} />
            <div>
              <p className="text-xl font-bold text-gray-900 leading-none">{s.count}</p>
              <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Status tabs */}
      <div className="flex gap-5 border-b border-gray-100">
        {STATUS_TABS.map(t => (
          <button key={t.key} onClick={() => setStatusTab(t.key)}
            className={`pb-2.5 text-sm whitespace-nowrap transition-colors ${
              statusTab === t.key
                ? 'text-gray-900 border-b-2 border-gray-900 font-medium'
                : 'text-gray-400 hover:text-gray-600'
            }`}>
            {t.label}
            {t.key === 'PENDING' && pending > 0 && (
              <span className="ml-1.5 px-1.5 py-0.5 bg-amber-100 text-amber-700 text-xs rounded-full font-medium">{pending}</span>
            )}
          </button>
        ))}
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)}
            placeholder="Search by employee…"
            className="w-full pl-9 pr-3 py-1.5 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-500" />
        </div>
        <Select value={empFilter} onChange={v => setEmpFilter(v ?? '')}
          options={employees.map(emp => ({ value: emp._id, label: emp.userId?.name ?? 'Unknown' }))}
          placeholder="All employees"
          size="sm"
        />
        <Select value={typeFilter} onChange={v => setTypeFilter(v ?? '')}
          options={LEAVE_TYPES.map(t => ({ value: t, label: TYPE_CFG[t]?.label ?? t }))}
          placeholder="All types"
          size="sm"
        />
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[780px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                {['Employee', 'Type', 'From', 'To', 'Duration', 'Reason', 'Status', 'Actions'].map(h => (
                  <th key={h} className="px-5 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading ? (
                <tr><td colSpan={8} className="px-5 py-16 text-center">
                  <Loader2 className="w-5 h-5 animate-spin text-blue-600 mx-auto" />
                </td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={8} className="px-5 py-16 text-center">
                  <CalendarDays className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                  <p className="text-sm text-gray-400 font-medium">No leave requests</p>
                  {statusTab === 'PENDING' && <p className="text-xs text-gray-300 mt-1">No pending approvals</p>}
                </td></tr>
              ) : filtered.map(l => {
                const sCfg    = STATUS_CFG[l.status] ?? STATUS_CFG.PENDING
                const tCfg    = TYPE_CFG[l.type]   ?? TYPE_CFG.OTHER
                const name    = l.employeeId?.userId?.name ?? '—'
                const isPending = l.status === 'PENDING'
                const isBusy    = actioning === l._id

                return (
                  <tr key={l._id} className="hover:bg-gray-50/60 transition-colors">
                    {/* Employee */}
                    <td className="px-5 py-3.5">
                      <span className="text-sm font-medium text-gray-800">{name}</span>
                    </td>
                    {/* Type */}
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${tCfg.bg} ${tCfg.text}`}>
                        {tCfg.label}
                      </span>
                    </td>
                    {/* From */}
                    <td className="px-5 py-3.5">
                      <span className="text-sm text-gray-600">{fmtDate(l.startDate)}</span>
                    </td>
                    {/* To */}
                    <td className="px-5 py-3.5">
                      <span className="text-sm text-gray-600">{fmtDate(l.endDate)}</span>
                    </td>
                    {/* Duration */}
                    <td className="px-5 py-3.5">
                      <span className="text-sm font-medium text-gray-700">{calcDays(l.startDate, l.endDate)}</span>
                    </td>
                    {/* Reason */}
                    <td className="px-5 py-3.5 max-w-[180px]">
                      <span className="text-xs text-gray-400 truncate block">{l.reason || '—'}</span>
                    </td>
                    {/* Status */}
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium ${sCfg.bg} ${sCfg.text}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${sCfg.dot}`} />
                        {sCfg.label}
                      </span>
                    </td>
                    {/* Actions */}
                    <td className="px-5 py-3.5">
                      <div className="flex items-center gap-1.5">
                        {isPending && (
                          <>
                            <button onClick={() => handleAction(l._id, 'APPROVED')} disabled={isBusy}
                              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-emerald-700 bg-emerald-50 border border-emerald-100 rounded-lg hover:bg-emerald-100 transition-colors disabled:opacity-50">
                              {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Check className="w-3 h-3" />}
                              Approve
                            </button>
                            <button onClick={() => handleAction(l._id, 'REJECTED')} disabled={isBusy}
                              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-red-600 bg-red-50 border border-red-100 rounded-lg hover:bg-red-100 transition-colors disabled:opacity-50">
                              {isBusy ? <Loader2 className="w-3 h-3 animate-spin" /> : <Ban className="w-3 h-3" />}
                              Reject
                            </button>
                          </>
                        )}
                        <button onClick={() => handleDelete(l._id)}
                          className="px-2.5 py-1 text-xs text-gray-400 border border-gray-200 rounded-lg hover:bg-gray-50 hover:text-red-500 transition-colors">
                          <X className="w-3 h-3" />
                        </button>
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <NewLeaveModal
          employees={employees}
          onClose={() => setShowModal(false)}
          onCreated={handleCreated}
        />
      )}
    </div>
  )
}
