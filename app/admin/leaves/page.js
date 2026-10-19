'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { Plus, Loader2, Check, Ban, Trash2, CalendarDays } from 'lucide-react'
import Select from '@/components/ui/Select'
import DatePicker from '@/components/ui/DatePicker'
import Button from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Textarea, Field } from '@/components/ui/Input'
import PageHeader from '@/components/ui/PageHeader'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Tabs from '@/components/ui/Tabs'
import Badge from '@/components/ui/Badge'
import SearchInput from '@/components/ui/SearchInput'
import EmptyState from '@/components/ui/EmptyState'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { Can } from '@/components/auth/Can'
import { cn } from '@/lib/utils'

// ─── Config ───────────────────────────────────────────────────────────────────

const STATUS_TABS = [
  { key: '',         label: 'All' },
  { key: 'PENDING',  label: 'Pending' },
  { key: 'APPROVED', label: 'Approved' },
  { key: 'REJECTED', label: 'Rejected' },
]

const STATUS_CFG = {
  PENDING:  { label: 'Pending',  variant: 'warning', dot: 'bg-amber-500' },
  APPROVED: { label: 'Approved', variant: 'success', dot: 'bg-emerald-500' },
  REJECTED: { label: 'Rejected', variant: 'danger',  dot: 'bg-red-500' },
}

const LEAVE_TYPES = ['ANNUAL', 'SICK', 'CASUAL', 'MATERNITY', 'PATERNITY', 'UNPAID', 'OTHER']

const TYPE_CFG = {
  ANNUAL:    { label: 'Annual' },
  SICK:      { label: 'Sick' },
  CASUAL:    { label: 'Casual' },
  MATERNITY: { label: 'Maternity' },
  PATERNITY: { label: 'Paternity' },
  UNPAID:    { label: 'Unpaid' },
  OTHER:     { label: 'Other' },
}

const ALL = '__all' // Select sentinel for "no filter" (Radix forbids '')

// API responses may carry `_id` (lean GET) or `id` (toJSON) — use whichever exists.
const rid = x => (x && typeof x === 'object' ? (x._id ?? x.id) : x) ?? null
function normalizeLeave(l) {
  if (!l) return l
  const emp = l.employeeId && typeof l.employeeId === 'object'
    ? { ...l.employeeId, _id: rid(l.employeeId) }
    : l.employeeId
  return { ...l, _id: rid(l), employeeId: emp }
}

function fmtDate(d) {
  if (!d) return '—'
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: '2-digit' })
}

function calcDays(start, end) {
  if (!start || !end) return '—'
  if (new Date(end) < new Date(start)) return '—'
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
    if (!form.employeeId) { setError('Please choose an employee'); return }
    if (!form.startDate || !form.endDate) { setError('Please choose both a start and an end date'); return }
    if (new Date(form.endDate) < new Date(form.startDate)) { setError('End date cannot be before the start date'); return }
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
    <Modal open onOpenChange={o => { if (!o) onClose() }} title="New leave request">
      <form onSubmit={submit} className="space-y-4">
        {error && <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</p>}

        <Field label="Employee">
          <Select value={form.employeeId} onChange={v => set('employeeId', v ?? '')}
            options={employees.map(emp => ({ value: rid(emp), label: emp.userId?.name ?? 'Unknown' }))}
            placeholder="Select…"
          />
        </Field>

        <Field label="Leave type">
          <Select value={form.type} onChange={v => set('type', v ?? 'ANNUAL')}
            options={LEAVE_TYPES.map(t => ({ value: t, label: TYPE_CFG[t]?.label ?? t }))}
            placeholder="Select…"
          />
        </Field>

        <div className="grid grid-cols-2 gap-4">
          <Field label="From">
            <DatePicker value={form.startDate || null} onChange={v => set('startDate', v ?? '')} />
          </Field>
          <Field label="To">
            <DatePicker value={form.endDate || null} onChange={v => set('endDate', v ?? '')} />
          </Field>
        </div>

        <Field label="Reason" htmlFor="leave-reason">
          <Textarea id="leave-reason" value={form.reason} onChange={e => set('reason', e.target.value)}
            rows={2} placeholder="Optional" className="min-h-0 resize-none" />
        </Field>

        <ModalFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>Submit request</Button>
        </ModalFooter>
      </form>
    </Modal>
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
  const [loadError, setLoadError] = useState('')
  const reqSeq = useRef(0)

  // Fetch employees once
  useEffect(() => {
    fetch('/api/employees?limit=200')
      .then(r => (r.ok ? r.json() : { data: [] }))
      .then(j => setEmployees(j.data ?? []))
      .catch(() => setEmployees([]))
  }, [])

  // The status tab is applied client-side so the summary counts always cover
  // every status. Stale responses (older requests) are ignored.
  const load = useCallback(async () => {
    const seq = ++reqSeq.current
    setLoading(true)
    setLoadError('')
    const params = new URLSearchParams()
    if (empFilter) params.set('employeeId', empFilter)
    if (typeFilter)params.set('type', typeFilter)
    try {
      const res  = await fetch(`/api/leaves?${params}`)
      const json = await res.json().catch(() => ({}))
      if (seq !== reqSeq.current) return
      if (!res.ok) {
        setLeaves([])
        setLoadError(json.error ?? 'Failed to load leaves')
      } else {
        setLeaves((json.data ?? []).map(normalizeLeave))
      }
    } catch {
      if (seq !== reqSeq.current) return
      setLeaves([])
      setLoadError('Network error')
    }
    setLoading(false)
  }, [empFilter, typeFilter])

  useEffect(() => { load() }, [load])

  async function handleAction(id, status) {
    setActioning(id)
    const res  = await fetch(`/api/leaves/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status }) })
    const json = await res.json().catch(() => ({}))
    if (res.ok) setLeaves(ls => ls.map(l => l._id === id ? { ...l, ...normalizeLeave(json.data) } : l))
    else alert(json.error ?? 'Failed to update leave')
    setActioning(null)
  }

  async function handleDelete(id) {
    if (!confirm('Delete this leave request?')) return
    const res = await fetch(`/api/leaves/${id}`, { method: 'DELETE' })
    if (res.ok) setLeaves(ls => ls.filter(l => l._id !== id))
    else alert((await res.json().catch(() => ({}))).error ?? 'Failed to delete leave')
  }

  function handleCreated() {
    // Reload so the new request only shows up where it matches the filters.
    setShowModal(false)
    load()
  }

  // Filter by status tab + search
  const filtered = leaves.filter(l => {
    if (statusTab && l.status !== statusTab) return false
    const name = l.employeeId?.userId?.name ?? ''
    return name.toLowerCase().includes(search.toLowerCase())
  })

  // Stats counts
  const pending  = leaves.filter(l => l.status === 'PENDING').length
  const approved = leaves.filter(l => l.status === 'APPROVED').length
  const rejected = leaves.filter(l => l.status === 'REJECTED').length

  return (
    <div className="space-y-6">
      <PageHeader
        title="Leaves"
        description={pending > 0 ? `${pending} pending approval` : 'No pending requests'}
        actions={<Button onClick={() => setShowModal(true)}><Plus /> New request</Button>}
      />

      {/* Summary cards (click to filter) */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {[
          { label: 'Pending',  count: pending,  dot: 'bg-amber-500',   click: 'PENDING' },
          { label: 'Approved', count: approved, dot: 'bg-emerald-500', click: 'APPROVED' },
          { label: 'Rejected', count: rejected, dot: 'bg-red-500',     click: 'REJECTED' },
        ].map(s => {
          const active = statusTab === s.click
          return (
            <button
              key={s.label}
              type="button"
              onClick={() => setStatusTab(prev => prev === s.click ? '' : s.click)}
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
        <Tabs
          value={statusTab}
          onChange={setStatusTab}
          tabs={STATUS_TABS.map(t => ({
            value: t.key,
            label: t.label,
            count: t.key === 'PENDING' && pending > 0 ? pending : undefined,
          }))}
        />
        <SearchInput value={search} onChange={setSearch} placeholder="Search…" debounceMs={0} className="w-full sm:w-64" />
        <Select value={empFilter || ALL} onChange={v => setEmpFilter(!v || v === ALL ? '' : v)}
          options={[{ value: ALL, label: 'All employees' }, ...employees.map(emp => ({ value: rid(emp), label: emp.userId?.name ?? 'Unknown' }))]}
          placeholder="All employees"
          className="w-full sm:w-52"
        />
        <Select value={typeFilter || ALL} onChange={v => setTypeFilter(!v || v === ALL ? '' : v)}
          options={[{ value: ALL, label: 'All types' }, ...LEAVE_TYPES.map(t => ({ value: t, label: TYPE_CFG[t]?.label ?? t }))]}
          placeholder="All types"
          className="w-full sm:w-40"
        />
      </div>

      {loadError && (
        <p className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{loadError}</p>
      )}

      {/* Table */}
      <Card className="overflow-hidden">
        <Table className="min-w-[780px]">
          <TableHeader>
            <TableRow>
              <TableHead>Employee</TableHead>
              <TableHead>Type</TableHead>
              <TableHead>From</TableHead>
              <TableHead>To</TableHead>
              <TableHead className="text-right">Duration</TableHead>
              <TableHead>Reason</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow className="hover:bg-transparent"><TableCell colSpan={8} className="py-16">
                <Loader2 className="mx-auto size-5 animate-spin text-gray-400" />
              </TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow className="hover:bg-transparent"><TableCell colSpan={8} className="p-0">
                <EmptyState
                  icon={CalendarDays}
                  title={statusTab === 'PENDING' ? 'No pending approvals' : (search || statusTab || empFilter || typeFilter) ? 'No results' : 'No leave requests yet'}
                />
              </TableCell></TableRow>
            ) : filtered.map(l => {
              const sCfg    = STATUS_CFG[l.status] ?? STATUS_CFG.PENDING
              const tCfg    = TYPE_CFG[l.type]   ?? TYPE_CFG.OTHER
              const name    = l.employeeId?.userId?.name ?? '—'
              const isPending = l.status === 'PENDING'
              const isBusy    = actioning === l._id

              return (
                <TableRow key={l._id}>
                  <TableCell className="font-medium text-gray-900">{name}</TableCell>
                  <TableCell><Badge variant="outline">{tCfg.label}</Badge></TableCell>
                  <TableCell className="tabular-nums">{fmtDate(l.startDate)}</TableCell>
                  <TableCell className="tabular-nums">{fmtDate(l.endDate)}</TableCell>
                  <TableCell className="text-right tabular-nums">{calcDays(l.startDate, l.endDate)}</TableCell>
                  <TableCell className="max-w-[180px]">
                    <span className="block truncate text-[13px] text-muted-foreground">{l.reason || '—'}</span>
                  </TableCell>
                  <TableCell><Badge variant={sCfg.variant}>{sCfg.label}</Badge></TableCell>
                  <TableCell className="px-2">
                    <div className="flex items-center justify-end gap-1">
                      <Can perm="hr.leaves.approve">
                        {isPending && (
                          <>
                            <Button variant="outline" size="xs" onClick={() => handleAction(l._id, 'APPROVED')} disabled={isBusy}>
                              {isBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Check className="size-3.5 text-emerald-600" />}
                              Approve
                            </Button>
                            <Button variant="outline" size="xs" onClick={() => handleAction(l._id, 'REJECTED')} disabled={isBusy}>
                              {isBusy ? <Loader2 className="size-3.5 animate-spin" /> : <Ban className="size-3.5 text-red-600" />}
                              Reject
                            </Button>
                          </>
                        )}
                        <Button variant="ghost" size="icon-xs" onClick={() => handleDelete(l._id)} title="Delete" aria-label="Delete"
                          className="text-gray-400 hover:bg-red-50 hover:text-red-600">
                          <Trash2 className="size-3.5" />
                        </Button>
                      </Can>
                    </div>
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      </Card>

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
