'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { ChevronLeft, ChevronRight, Plus, X, Loader2, Users, Pencil, Trash2 } from 'lucide-react'
import Select from '@/components/ui/Select'
import DatePicker from '@/components/ui/DatePicker'
import Button from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input, Field } from '@/components/ui/Input'
import PageHeader from '@/components/ui/PageHeader'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Badge from '@/components/ui/Badge'
import SearchInput from '@/components/ui/SearchInput'
import EmptyState from '@/components/ui/EmptyState'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { Can } from '@/components/auth/Can'
import { dhakaDayKey } from '@/lib/dhakaTime'
import { cn } from '@/lib/utils'

// ─── Config ───────────────────────────────────────────────────────────────────

const STATUS_CFG = {
  PRESENT:  { label: 'Present',  short: 'P',  variant: 'success', dot: 'bg-emerald-500' },
  ABSENT:   { label: 'Absent',   short: 'A',  variant: 'danger',  dot: 'bg-red-500' },
  LATE:     { label: 'Late',     short: 'L',  variant: 'warning', dot: 'bg-amber-500' },
  HALF_DAY: { label: 'Half day', short: 'H',  variant: 'primary', dot: 'bg-blue-500' },
  ON_LEAVE: { label: 'On leave', short: 'OL', variant: 'default', dot: 'bg-gray-400' },
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

// Attendance days and times are in the business timezone (Asia/Dhaka).
const TZ = 'Asia/Dhaka'
const TIMED_STATUSES = ['PRESENT', 'LATE', 'HALF_DAY']
const ALL = '__all' // Select sentinel for "no filter" (Radix forbids '')

// API responses may carry `_id` (lean GET) or `id` (toJSON) — use whichever exists.
const rid = x => (x && typeof x === 'object' ? (x._id ?? x.id) : x) ?? null
function normalizeRecord(r) {
  if (!r) return r
  const emp = r.employeeId && typeof r.employeeId === 'object'
    ? { ...r.employeeId, _id: rid(r.employeeId) }
    : r.employeeId
  return { ...r, _id: rid(r), employeeId: emp }
}

function fmtTime(d) {
  if (!d) return '—'
  return new Date(d).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: TZ })
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', timeZone: TZ })
}

// 'HH:mm' of an instant in Dhaka time.
function dhakaTime(d) {
  return new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: false, timeZone: TZ }).slice(0, 5)
}

function diffHours(checkIn, checkOut) {
  if (!checkIn || !checkOut) return null
  const diff = (new Date(checkOut) - new Date(checkIn)) / 3600000
  return diff > 0 ? `${diff.toFixed(1)}h` : null
}

// ─── Mark attendance modal ────────────────────────────────────────────────────

function AttendanceModal({ employees, prefill, onClose, onSaved }) {
  const isEdit = !!rid(prefill)
  const today  = dhakaDayKey()

  const [form, setForm] = useState({
    employeeId: rid(prefill?.employeeId) ?? '',
    date:       prefill?.day ?? (prefill?.date ? dhakaDayKey(prefill.date) : today),
    status:     prefill?.status ?? 'PRESENT',
    checkIn:    prefill?.checkIn  ? dhakaTime(prefill.checkIn)  : '',
    checkOut:   prefill?.checkOut ? dhakaTime(prefill.checkOut) : '',
    notes:      prefill?.notes ?? '',
  })
  const [saving, setSaving] = useState(false)
  const [error,  setError]  = useState('')

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  function toDatetime(dateStr, timeStr) {
    if (!timeStr) return null
    return new Date(`${dateStr}T${timeStr}:00+06:00`).toISOString()
  }

  async function submit(e) {
    e.preventDefault()
    if (!isEdit && !form.employeeId) { setError('Please choose an employee'); return }
    if (!form.date) { setError('Please choose a date'); return }
    const timed = TIMED_STATUSES.includes(form.status)
    if (timed && form.checkIn && form.checkOut && form.checkOut <= form.checkIn) {
      setError('Check out must be after check in'); return
    }
    setSaving(true)
    setError('')
    try {
      // Check-in/out only apply to worked statuses; the date cannot change on edit.
      const body = {
        status:     form.status,
        checkIn:    timed ? toDatetime(form.date, form.checkIn)  : null,
        checkOut:   timed ? toDatetime(form.date, form.checkOut) : null,
        notes:      form.notes || null,
      }
      if (!isEdit) {
        body.employeeId = form.employeeId
        body.date       = new Date(`${form.date}T00:00:00+06:00`).toISOString()
      }
      let res
      if (isEdit) {
        res = await fetch(`/api/attendance/${rid(prefill)}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
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
    <Modal open onOpenChange={o => { if (!o) onClose() }} title={isEdit ? 'Edit attendance' : 'Mark attendance'}>
      <form onSubmit={submit} className="space-y-4">
        {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>}

        {!isEdit && (
          <Field label="Employee">
            <Select value={form.employeeId} onChange={v => set('employeeId', v ?? '')}
              options={employees.map(emp => ({ value: rid(emp), label: emp.userId?.name ?? 'Unknown' }))}
              placeholder="Select…"
            />
          </Field>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Date">
            <DatePicker value={form.date || null} onChange={v => set('date', v ?? '')} disabled={isEdit} />
          </Field>
          <Field label="Status">
            <Select value={form.status} onChange={v => set('status', v ?? 'PRESENT')}
              options={Object.entries(STATUS_CFG).map(([k, c]) => ({ value: k, label: c.label }))}
              placeholder="Select…"
            />
          </Field>
        </div>

        {TIMED_STATUSES.includes(form.status) && (
          <div className="grid grid-cols-2 gap-4">
            <Field label="Check in" htmlFor="att-in">
              <Input id="att-in" type="time" value={form.checkIn} onChange={e => set('checkIn', e.target.value)} />
            </Field>
            <Field label="Check out" htmlFor="att-out">
              <Input id="att-out" type="time" value={form.checkOut} onChange={e => set('checkOut', e.target.value)} />
            </Field>
          </div>
        )}

        <Field label="Notes" htmlFor="att-notes">
          <Input id="att-notes" type="text" value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Optional" />
        </Field>

        <ModalFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>{isEdit ? 'Save' : 'Mark attendance'}</Button>
        </ModalFooter>
      </form>
    </Modal>
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
  const [loadError, setLoadError] = useState('')
  const reqSeq = useRef(0)

  const monthKey = `${year}-${String(month).padStart(2, '0')}`

  // Fetch employees once
  useEffect(() => {
    fetch('/api/employees?limit=200')
      .then(r => (r.ok ? r.json() : { data: [] }))
      .then(j => setEmployees(j.data ?? []))
      .catch(() => setEmployees([]))
  }, [])

  // The status filter is applied client-side so the stat cards always show
  // every status for the month. Stale responses (older requests) are ignored.
  const load = useCallback(async () => {
    const seq = ++reqSeq.current
    setLoading(true)
    setLoadError('')
    const params = new URLSearchParams({ month: monthKey })
    if (empFilter) params.set('employeeId', empFilter)
    try {
      const res  = await fetch(`/api/attendance?${params}`)
      const json = await res.json().catch(() => ({}))
      if (seq !== reqSeq.current) return
      if (!res.ok) {
        setRecords([])
        setLoadError(json.error ?? 'Failed to load attendance')
      } else {
        setRecords((json.data ?? []).map(normalizeRecord))
      }
    } catch {
      if (seq !== reqSeq.current) return
      setRecords([])
      setLoadError('Network error')
    }
    setLoading(false)
  }, [monthKey, empFilter])

  useEffect(() => { load() }, [load])

  function prevMonth() { if (month === 1) { setYear(y => y - 1); setMonth(12) } else setMonth(m => m - 1) }
  function nextMonth() { if (month === 12){ setYear(y => y + 1); setMonth(1)  } else setMonth(m => m + 1) }

  function handleSaved(record, isEdit) {
    const saved = normalizeRecord(record)
    if (isEdit && saved?._id) {
      setRecords(rs => rs.map(r => r._id === saved._id ? { ...r, ...saved } : r))
    } else {
      // Creation upserts by employee + day and may fall outside the viewed
      // month or filters — reload instead of guessing where it belongs.
      load()
    }
    setModal(null)
  }

  async function handleDelete(id) {
    if (!confirm('Delete this attendance record?')) return
    const res = await fetch(`/api/attendance/${id}`, { method: 'DELETE' })
    if (res.ok) setRecords(rs => rs.filter(r => r._id !== id))
  }

  // Filter by status + search
  const filtered = records.filter(r => {
    if (statusFilter && r.status !== statusFilter) return false
    const name = r.employeeId?.userId?.name ?? ''
    return name.toLowerCase().includes(search.toLowerCase())
  })

  // Stats for selected month
  const stats = Object.entries(STATUS_CFG).map(([key, cfg]) => ({
    ...cfg, key, count: records.filter(r => r.status === key).length,
  }))

  return (
    <div className="space-y-6">
      <PageHeader
        title="Attendance"
        description={`${records.length} record${records.length !== 1 ? 's' : ''} · ${MONTHS[month - 1]} ${year}`}
        actions={
          <>
            {/* Month navigator */}
            <div className="inline-flex h-9 items-center rounded-lg border border-input bg-white shadow-xs">
              <Button variant="ghost" size="icon-sm" onClick={prevMonth} aria-label="Previous month" className="rounded-r-none">
                <ChevronLeft />
              </Button>
              <span className="min-w-[8.5rem] px-2 text-center text-sm font-medium text-gray-900 tabular-nums">{MONTHS[month - 1]} {year}</span>
              <Button variant="ghost" size="icon-sm" onClick={nextMonth} aria-label="Next month" className="rounded-l-none">
                <ChevronRight />
              </Button>
            </div>
            <Can perm="hr.attendance.manage">
              <Button onClick={() => setModal('new')}><Plus /> Mark attendance</Button>
            </Can>
          </>
        }
      />

      {/* Stats (click to filter) */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-5">
        {stats.map(s => {
          const active = statusFilter === s.key
          return (
            <button
              key={s.key}
              type="button"
              onClick={() => setStatusFilter(prev => prev === s.key ? '' : s.key)}
              className={cn(
                'rounded-xl border bg-white p-4 text-left shadow-xs transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
                active ? 'border-gray-900 ring-1 ring-gray-900' : 'border-gray-200/80 hover:border-gray-300'
              )}
            >
              <div className="flex items-center gap-2 text-[13px] font-medium text-muted-foreground">
                <span className={cn('size-2 shrink-0 rounded-full', s.dot)} />
                {s.label}
              </div>
              <p className="mt-1.5 text-2xl font-semibold tracking-tight text-gray-900 tabular-nums">{s.count}</p>
            </button>
          )
        })}
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search…" debounceMs={0} className="w-full sm:w-64" />
        <Select value={empFilter || ALL} onChange={v => setEmpFilter(!v || v === ALL ? '' : v)}
          options={[{ value: ALL, label: 'All employees' }, ...employees.map(emp => ({ value: rid(emp), label: emp.userId?.name ?? 'Unknown' }))]}
          placeholder="All employees"
          className="w-full sm:w-56"
        />
        {statusFilter && (
          <Button variant="ghost" size="sm" onClick={() => setStatusFilter('')}>
            <X /> Clear filter
          </Button>
        )}
      </div>

      {loadError && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{loadError}</p>
      )}

      {/* Table */}
      <Card className="overflow-hidden">
        <Table className="min-w-[700px]">
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Date</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Check in</TableHead>
              <TableHead>Check out</TableHead>
              <TableHead className="text-right">Hours</TableHead>
              <TableHead>Notes</TableHead>
              <TableHead className="w-20"><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow className="hover:bg-transparent"><TableCell colSpan={8} className="py-16">
                <Loader2 className="mx-auto size-5 animate-spin text-gray-400" />
              </TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow className="hover:bg-transparent"><TableCell colSpan={8} className="p-0">
                <EmptyState icon={Users} title={search || statusFilter || empFilter ? 'No results' : 'No attendance yet'} />
              </TableCell></TableRow>
            ) : filtered.map(r => {
              const cfg   = STATUS_CFG[r.status] ?? STATUS_CFG.ABSENT
              const name  = r.employeeId?.userId?.name ?? '—'
              const hours = TIMED_STATUSES.includes(r.status) ? diffHours(r.checkIn, r.checkOut) : null
              return (
                <TableRow key={r._id}>
                  <TableCell className="font-medium text-gray-900">{name}</TableCell>
                  <TableCell className="tabular-nums">{fmtDate(r.date)}</TableCell>
                  <TableCell><Badge variant={cfg.variant}>{cfg.label}</Badge></TableCell>
                  <TableCell className="tabular-nums">{fmtTime(r.checkIn)}</TableCell>
                  <TableCell className="tabular-nums">{fmtTime(r.checkOut)}</TableCell>
                  <TableCell className="text-right tabular-nums">{hours ?? '—'}</TableCell>
                  <TableCell className="max-w-[160px]">
                    <span className="block truncate text-[13px] text-muted-foreground">{r.notes || '—'}</span>
                  </TableCell>
                  <TableCell className="px-2 text-right">
                    <Can perm="hr.attendance.manage">
                      <div className="flex items-center justify-end gap-0.5">
                        <Button variant="ghost" size="icon-sm" onClick={() => setModal(r)} title="Edit" aria-label="Edit">
                          <Pencil />
                        </Button>
                        <Button variant="ghost" size="icon-sm" onClick={() => handleDelete(r._id)} title="Delete" aria-label="Delete"
                          className="text-gray-500 hover:bg-red-50 hover:text-red-600">
                          <Trash2 />
                        </Button>
                      </div>
                    </Can>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Card>

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
