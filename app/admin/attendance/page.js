'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { ChevronLeft, ChevronRight, Plus, X, Loader2, Search, UserCheck, Users } from 'lucide-react'
import Select from '@/components/ui/Select'
import DatePicker from '@/components/ui/DatePicker'

// ─── Config ───────────────────────────────────────────────────────────────────

const STATUS_CFG = {
  PRESENT:  { label: 'Present',  short: 'P', bg: 'bg-emerald-100', text: 'text-emerald-700', dot: 'bg-emerald-500' },
  ABSENT:   { label: 'Absent',   short: 'A', bg: 'bg-red-100',     text: 'text-red-600',     dot: 'bg-red-500' },
  LATE:     { label: 'Late',     short: 'L', bg: 'bg-amber-100',   text: 'text-amber-700',   dot: 'bg-amber-500' },
  HALF_DAY: { label: 'Half Day', short: 'H', bg: 'bg-blue-100',    text: 'text-blue-700',    dot: 'bg-blue-500' },
  ON_LEAVE: { label: 'On Leave', short: 'OL',bg: 'bg-gray-100',    text: 'text-gray-600',    dot: 'bg-gray-400' },
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

function fmtTime(d) {
  if (!d) return '—'
  return new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true })
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

function diffHours(checkIn, checkOut) {
  if (!checkIn || !checkOut) return null
  const diff = (new Date(checkOut) - new Date(checkIn)) / 3600000
  return diff > 0 ? `${diff.toFixed(1)}h` : null
}

// ─── Mark attendance modal ────────────────────────────────────────────────────

function AttendanceModal({ employees, prefill, onClose, onSaved }) {
  const isEdit = !!prefill?._id
  const today  = new Date().toISOString().split('T')[0]

  const [form, setForm] = useState({
    employeeId: prefill?.employeeId?._id ?? prefill?.employeeId ?? '',
    date:       prefill?.date ? new Date(prefill.date).toISOString().split('T')[0] : today,
    status:     prefill?.status ?? 'PRESENT',
    checkIn:    prefill?.checkIn  ? new Date(prefill.checkIn).toTimeString().slice(0,5)  : '',
    checkOut:   prefill?.checkOut ? new Date(prefill.checkOut).toTimeString().slice(0,5) : '',
    notes:      prefill?.notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  function toDatetime(dateStr, timeStr) {
    if (!timeStr) return null
    return new Date(`${dateStr}T${timeStr}:00`).toISOString()
  }

  async function submit(e) {
    e.preventDefault()
    setSaving(true)
    setError('')
    const body = {
      employeeId: form.employeeId,
      date:       new Date(form.date).toISOString(),
      status:     form.status,
      checkIn:    toDatetime(form.date, form.checkIn),
      checkOut:   toDatetime(form.date, form.checkOut),
      notes:      form.notes || null,
    }
    try {
      let res
      if (isEdit) {
        res = await fetch(`/api/attendance/${prefill._id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      } else {
        res = await fetch('/api/attendance', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      }
      const json = await res.json()
      if (!res.ok) { setError(json.error ?? 'Failed to save'); setSaving(false); return }
      onSaved(json.data, isEdit)
    } catch {
      setError('Network error')
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/30 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">{isEdit ? 'Edit Attendance' : 'Mark Attendance'}</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <X className="w-4 h-4 text-gray-500" />
          </button>
        </div>
        <form onSubmit={submit} className="p-5 space-y-4">
          {error && <p className="text-xs text-red-600 bg-red-50 border border-red-100 rounded-lg px-3 py-2">{error}</p>}

          {!isEdit && (
            <div>
              <label className="block text-xs font-medium text-gray-700 mb-1">Employee</label>
              <Select value={form.employeeId} onChange={v => set('employeeId', v ?? '')}
                options={employees.map(emp => ({ value: emp._id, label: emp.userId?.name ?? 'Unknown' }))}
                placeholder="Select employee…"
              />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Date</label>
            <DatePicker value={form.date || null} onChange={v => set('date', v ?? '')} />
          </div>

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Status</label>
            <Select value={form.status} onChange={v => set('status', v ?? 'PRESENT')}
              options={Object.entries(STATUS_CFG).map(([k, c]) => ({ value: k, label: c.label }))}
              placeholder="Select status…"
            />
          </div>

          {['PRESENT', 'LATE', 'HALF_DAY'].includes(form.status) && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Check In</label>
                <input type="time" value={form.checkIn} onChange={e => set('checkIn', e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">Check Out</label>
                <input type="time" value={form.checkOut} onChange={e => set('checkOut', e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-500" />
              </div>
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-gray-700 mb-1">Notes <span className="text-gray-400 font-normal">(optional)</span></label>
            <input type="text" value={form.notes} onChange={e => set('notes', e.target.value)}
              placeholder="Any note…"
              className="w-full px-3 py-2 text-sm border border-gray-200 rounded-lg bg-white focus:outline-none focus:ring-1 focus:ring-blue-500" />
          </div>

          <div className="flex gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="flex-1 px-4 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="flex-1 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-60 flex items-center justify-center gap-2">
              {saving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
              {isEdit ? 'Save Changes' : 'Mark Attendance'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AttendancePage() {
  const now          = new Date()
  const [year,  setYear]  = useState(now.getFullYear())
  const [month, setMonth] = useState(now.getMonth() + 1)   // 1-indexed
  const [records,  setRecords]  = useState([])
  const [employees,setEmployees]= useState([])
  const [loading,  setLoading]  = useState(true)
  const [empFilter,setEmpFilter]= useState('')
  const [statusFilter, setStatusFilter] = useState('')
  const [search,   setSearch]   = useState('')
  const [modal,    setModal]    = useState(null)  // null | 'new' | record object

  const monthKey = `${year}-${String(month).padStart(2, '0')}`

  // Fetch employees once
  useEffect(() => {
    fetch('/api/employees?limit=200')
      .then(r => r.json())
      .then(j => setEmployees(j.data ?? []))
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ month: monthKey })
    if (empFilter)    params.set('employeeId', empFilter)
    if (statusFilter) params.set('status', statusFilter)
    const res  = await fetch(`/api/attendance?${params}`)
    const json = await res.json()
    setRecords(json.data ?? [])
    setLoading(false)
  }, [monthKey, empFilter, statusFilter])

  useEffect(() => { load() }, [load])

  function prevMonth() { if (month === 1) { setYear(y => y - 1); setMonth(12) } else setMonth(m => m - 1) }
  function nextMonth() { if (month === 12){ setYear(y => y + 1); setMonth(1)  } else setMonth(m => m + 1) }

  function handleSaved(record, isEdit) {
    if (isEdit) {
      setRecords(rs => rs.map(r => r._id === record._id ? record : r))
    } else {
      setRecords(rs => {
        const idx = rs.findIndex(r => r._id === record._id)
        return idx >= 0 ? rs.map(r => r._id === record._id ? record : r) : [record, ...rs]
      })
    }
    setModal(null)
  }

  async function handleDelete(id) {
    if (!confirm('Delete this attendance record?')) return
    const res = await fetch(`/api/attendance/${id}`, { method: 'DELETE' })
    if (res.ok) setRecords(rs => rs.filter(r => r._id !== id))
  }

  // Filter by search
  const filtered = records.filter(r => {
    const name = r.employeeId?.userId?.name ?? ''
    return name.toLowerCase().includes(search.toLowerCase())
  })

  // Stats for selected month
  const stats = Object.entries(STATUS_CFG).map(([key, cfg]) => ({
    ...cfg, key, count: records.filter(r => r.status === key).length,
  }))

  return (
    <div className="space-y-5">

      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Attendance</h1>
          <p className="text-sm text-gray-400 mt-0.5">{records.length} record{records.length !== 1 ? 's' : ''} for {MONTHS[month - 1]} {year}</p>
        </div>
        <button onClick={() => setModal('new')}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
          <Plus className="w-4 h-4" />
          Mark Attendance
        </button>
      </div>

      {/* Month navigator */}
      <div className="bg-white border border-gray-100 rounded-xl p-4 flex items-center justify-between">
        <button onClick={prevMonth} className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
          <ChevronLeft className="w-4 h-4 text-gray-500" />
        </button>
        <span className="text-sm font-semibold text-gray-800">{MONTHS[month - 1]} {year}</span>
        <button onClick={nextMonth} className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
          <ChevronRight className="w-4 h-4 text-gray-500" />
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3">
        {stats.map(s => (
          <div key={s.key} className={`bg-white border border-gray-100 rounded-xl p-4 flex items-center gap-3 cursor-pointer transition-all ${statusFilter === s.key ? 'ring-2 ring-blue-500' : ''}`}
            onClick={() => setStatusFilter(prev => prev === s.key ? '' : s.key)}>
            <span className={`w-2.5 h-2.5 rounded-full shrink-0 ${s.dot}`} />
            <div>
              <p className="text-lg font-bold text-gray-900 leading-none">{s.count}</p>
              <p className="text-xs text-gray-500 mt-0.5">{s.label}</p>
            </div>
          </div>
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
        {statusFilter && (
          <button onClick={() => setStatusFilter('')}
            className="flex items-center gap-1 px-3 py-1.5 text-xs border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors">
            <X className="w-3 h-3" /> Clear filter
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                {['Employee', 'Date', 'Status', 'Check In', 'Check Out', 'Hours', 'Notes', ''].map(h => (
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
                  <Users className="w-8 h-8 text-gray-200 mx-auto mb-2" />
                  <p className="text-sm text-gray-400 font-medium">No attendance records</p>
                  <p className="text-xs text-gray-300 mt-1">Mark attendance using the button above</p>
                </td></tr>
              ) : filtered.map(r => {
                const cfg   = STATUS_CFG[r.status] ?? STATUS_CFG.ABSENT
                const name  = r.employeeId?.userId?.name ?? '—'
                const hours = diffHours(r.checkIn, r.checkOut)
                return (
                  <tr key={r._id} className="hover:bg-gray-50/60 transition-colors">
                    <td className="px-5 py-3.5">
                      <span className="text-sm font-medium text-gray-800">{name}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-sm text-gray-600">{fmtDate(r.date)}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded text-xs font-medium ${cfg.bg} ${cfg.text}`}>
                        <span className={`w-1.5 h-1.5 rounded-full ${cfg.dot}`} />
                        {cfg.label}
                      </span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-sm text-gray-600">{fmtTime(r.checkIn)}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-sm text-gray-600">{fmtTime(r.checkOut)}</span>
                    </td>
                    <td className="px-5 py-3.5">
                      <span className="text-sm text-gray-600 font-medium">{hours ?? '—'}</span>
                    </td>
                    <td className="px-5 py-3.5 max-w-[160px]">
                      <span className="text-xs text-gray-400 truncate block">{r.notes || '—'}</span>
                    </td>
                    <td className="px-3 py-3.5">
                      <div className="flex items-center gap-1">
                        <button onClick={() => setModal(r)}
                          className="px-2.5 py-1 text-xs text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
                          Edit
                        </button>
                        <button onClick={() => handleDelete(r._id)}
                          className="px-2.5 py-1 text-xs text-red-600 border border-red-100 rounded-lg hover:bg-red-50 transition-colors">
                          Del
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
      {modal && (
        <AttendanceModal
          employees={employees}
          prefill={modal === 'new' ? null : modal}
          onClose={() => setModal(null)}
          onSaved={handleSaved}
        />
      )}
    </div>
  )
}
