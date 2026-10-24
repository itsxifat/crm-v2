'use client'

import { Suspense, useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import toast from 'react-hot-toast'
import { TrendingUp, Check, X, Ban, FileText, Users, Search, AlertTriangle, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import PageHeader from '@/components/ui/PageHeader'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Tabs from '@/components/ui/Tabs'
import TkAmt from '@/components/ui/TkAmt'
import EmptyState from '@/components/ui/EmptyState'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import { Card } from '@/components/ui/Card'
import { Input, Textarea, NativeSelect, Field, inputClass } from '@/components/ui/Input'
import { usePermission } from '@/components/auth/Can'
import ReviseSalaryModal from '@/components/admin/salary/ReviseSalaryModal'
import { RevisionStatus, monthOptions, computeNewSalary, changeText, periodLabel } from '@/components/admin/salary/salaryUi'

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Dhaka' }) : '—'

async function api(url, opts) {
  const res = await fetch(url, opts)
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw Object.assign(new Error(j.error || j.failed?.[0]?.error || `Request failed (${res.status})`), { data: j })
  return j
}

function Person({ e }) {
  return (
    <div className="min-w-0">
      <Link href={`/admin/employees/${e.id}`} className="truncate text-sm font-medium text-gray-900 hover:underline">{e.name}</Link>
      <p className="truncate text-xs text-muted-foreground">{[e.designation, e.department].filter(Boolean).join(' · ') || e.employeeId || '—'}</p>
    </div>
  )
}

// ── To approve ───────────────────────────────────────────────────────────────

function ApprovalsTab({ onCount }) {
  const [rows, setRows] = useState(null)
  const [can, setCan] = useState({})
  const [selected, setSelected] = useState(new Set())
  const [busy, setBusy] = useState(null)

  const load = useCallback(() => {
    api('/api/salary-revisions?status=PENDING&limit=200')
      .then(j => { setRows(j.data); setCan(j.can); onCount?.(j.data.length); setSelected(new Set()) })
      .catch(err => { toast.error(err.message); setRows([]) })
  }, [onCount])
  useEffect(() => { load() }, [load])

  const decidable = (r) => can.approve && (r.employee?.userId !== can.userId || can.superAdmin)

  async function bulk(action) {
    const ids = [...selected]
    let note = null
    if (action === 'reject') {
      note = prompt('Why are these not approved? (optional)')
      if (note === null) return
    }
    setBusy(action)
    try {
      const j = await api('/api/salary-revisions/decide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, ids, note }) })
      toast.success(`${j.done.length} ${action === 'approve' ? 'approved' : 'not approved'}`)
      for (const f of j.failed ?? []) toast.error(f.error, { duration: 7000 })
      for (const w of j.warnings ?? []) toast(w, { duration: 7000 })
      load()
    } catch (err) {
      for (const f of err.data?.failed ?? []) toast.error(f.error, { duration: 7000 })
      if (!err.data?.failed?.length) toast.error(err.message)
    } finally { setBusy(null) }
  }

  async function one(r, action) {
    let note = null
    if (action === 'reject') {
      note = prompt('Why is it not approved? (optional)')
      if (note === null) return
    }
    if (action === 'cancel' && !confirm('Cancel this salary change?')) return
    setBusy(`${action}:${r.id}`)
    try {
      const j = await api(`/api/salary-revisions/${r.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, note }) })
      toast.success(action === 'approve' ? `Approved — ${r.employee?.name ?? 'the employee'} is notified` : action === 'reject' ? 'Marked as not approved' : 'Cancelled')
      for (const w of j.warnings ?? []) toast(w, { duration: 7000 })
      load()
    } catch (err) { toast.error(err.message) }
    finally { setBusy(null) }
  }

  if (!rows) return <LoadingSpinner className="py-16" />
  if (rows.length === 0) return <Card><EmptyState icon={Check} title="Nothing waiting for approval" description="Proposed increments and promotions show up here." /></Card>

  const selectable = rows.filter(decidable)
  const allOn = selectable.length > 0 && selectable.every(r => selected.has(r.id))
  const total = rows.filter(r => selected.has(r.id)).reduce((s, r) => s + r.change, 0)

  return (
    <div className="space-y-3">
      {can.approve && (
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label className="flex items-center gap-2 text-sm text-gray-700">
            <input type="checkbox" checked={allOn} onChange={e => setSelected(e.target.checked ? new Set(selectable.map(r => r.id)) : new Set())} className="size-4 rounded border-gray-300" />
            Select all {selected.size > 0 && <span className="text-muted-foreground">· {selected.size} selected · <TkAmt value={total} /> a month in total</span>}
          </label>
          <div className="flex gap-1.5">
            <Button size="sm" disabled={!selected.size} onClick={() => bulk('approve')} loading={busy === 'approve'}>{busy !== 'approve' && <Check />} Approve selected</Button>
            <Button size="sm" variant="outline" disabled={!selected.size} onClick={() => bulk('reject')} loading={busy === 'reject'}>{busy !== 'reject' && <X />} Not approve</Button>
          </div>
        </div>
      )}
      <Card className="divide-y divide-gray-100 overflow-hidden">
        {rows.map(r => (
          <div key={r.id} className="flex flex-col gap-3 px-4 py-3.5 lg:flex-row lg:items-center">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              {can.approve && (
                <input type="checkbox" disabled={!decidable(r)} checked={selected.has(r.id)} aria-label={`Select ${r.employee?.name}`}
                  onChange={e => setSelected(s => { const n = new Set(s); e.target.checked ? n.add(r.id) : n.delete(r.id); return n })}
                  className="mt-1 size-4 shrink-0 rounded border-gray-300 disabled:opacity-40" />
              )}
              {r.employee && <div className="w-48 shrink-0"><Person e={r.employee} /></div>}
              <div className="min-w-0 text-sm">
                <p className="text-gray-900">
                  <span className="text-muted-foreground">{r.typeLabel}:</span> <TkAmt value={r.previousSalary} /> <ArrowRight className="inline size-3.5 text-gray-400" /> <span className="font-semibold"><TkAmt value={r.newSalary} /></span>
                  <span className="ml-1.5 text-[13px] tabular-nums text-emerald-700">{changeText(r.previousSalary, r.newSalary)}</span>
                </p>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  From {r.effectiveLabel}{r.newDesignation ? ` · as ${r.newDesignation}` : ''} · proposed by {r.requestedBy?.name ?? '—'} on {fmtDate(r.createdAt)}{r.reason ? ` · ${r.reason}` : ''}
                </p>
              </div>
            </div>
            <div className="flex shrink-0 flex-wrap gap-1.5 lg:justify-end">
              {decidable(r) && <Button size="sm" onClick={() => one(r, 'approve')} loading={busy === `approve:${r.id}`}>{busy !== `approve:${r.id}` && <Check />} Approve</Button>}
              {decidable(r) && <Button size="sm" variant="outline" onClick={() => one(r, 'reject')} loading={busy === `reject:${r.id}`}>{busy !== `reject:${r.id}` && <X />} Not approve</Button>}
              {(can.approve || r.requestedBy?.id === can.userId) && (
                <Button size="sm" variant="ghost" onClick={() => one(r, 'cancel')} loading={busy === `cancel:${r.id}`} className="text-gray-500">{busy !== `cancel:${r.id}` && <Ban />} Cancel</Button>
              )}
              {!decidable(r) && can.approve && r.employee?.userId === can.userId && <Badge variant="outline">Your own salary</Badge>}
            </div>
          </div>
        ))}
      </Card>
    </div>
  )
}

// ── Employees (and bulk proposals) ───────────────────────────────────────────

/** Salary in `month` so far: an approved change starting earlier or the same month counts. */
const baseFor = (e, month) => (e.upcoming && e.upcoming.effectiveMonth <= month ? e.upcoming.newSalary : e.salary)

function BulkProposeModal({ employees, canApprove, onClose, onDone }) {
  const months = useMemo(() => monthOptions(), [])
  const [form, setForm] = useState({ type: 'INCREMENT', effectiveMonth: months[1]?.value ?? months[0].value, mode: 'percent', value: '10', reason: '', approveNow: false })
  const [overrides, setOverrides] = useState({})   // employeeId → typed new salary
  const [saving, setSaving] = useState(false)
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }))

  const rows = employees.map(e => {
    const base = baseFor(e, form.effectiveMonth)
    const computed = computeNewSalary(base, form.mode, form.value, form.type)
    const typed = overrides[e.id]
    const next = typed !== undefined && typed !== '' ? Number(typed) : computed
    return { e, base, next, edited: typed !== undefined && typed !== '' }
  })
  const total = rows.reduce((s, r) => s + ((Number(r.next) || 0) - (Number(r.base) || 0)), 0)

  async function submit(ev) {
    ev.preventDefault()
    if (rows.some(r => !(r.next > 0))) return toast.error('Every employee needs a new salary')
    setSaving(true)
    try {
      const res = await fetch('/api/salary-revisions', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          effectiveMonth: form.effectiveMonth, type: form.type, reason: form.reason || null, approveNow: canApprove && form.approveNow,
          items: rows.map(r => ({ employeeId: r.e.id, newSalary: r.next })),
        }),
      })
      const j = await res.json().catch(() => ({}))
      if (j.created?.length) toast.success(`${j.created.length} ${canApprove && form.approveNow ? 'approved' : 'sent for approval'}`)
      for (const f of j.failed ?? []) toast.error(`${f.name}: ${f.error}`, { duration: 8000 })
      for (const w of j.warnings ?? []) toast(w, { duration: 7000 })
      if (!res.ok && !j.failed?.length) throw new Error(j.error || 'Could not save')
      if (j.created?.length) { onDone(); onClose() }
    } catch (err) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  return (
    <Modal open onOpenChange={o => { if (!o) onClose() }} size="lg" title={`Salary change for ${employees.length} employee${employees.length === 1 ? '' : 's'}`}
      description="Set one rule for everyone, then adjust anyone individually.">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Kind">
            <NativeSelect value={form.type} onChange={e => set('type', e.target.value)}>
              <option value="INCREMENT">Increment</option>
              <option value="ADJUSTMENT">Adjustment</option>
              <option value="DECREASE">Decrease</option>
            </NativeSelect>
          </Field>
          <Field label="Starts from">
            <NativeSelect value={form.effectiveMonth} onChange={e => set('effectiveMonth', e.target.value)}>
              {months.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </NativeSelect>
          </Field>
          <Field label="For everyone">
            <div className="flex gap-1.5">
              <Input type="number" min="0" step="0.1" value={form.value} onChange={e => set('value', e.target.value)} />
              <NativeSelect value={form.mode} onChange={e => set('mode', e.target.value)} className="w-20 shrink-0">
                <option value="percent">%</option>
                <option value="amount">৳ +</option>
              </NativeSelect>
            </div>
          </Field>
        </div>

        <div className="max-h-[42vh] overflow-y-auto rounded-lg border border-gray-200/80">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 text-left text-xs text-muted-foreground">
              <tr><th className="px-3 py-2 font-medium">Employee</th><th className="px-3 py-2 text-right font-medium">From</th><th className="px-3 py-2 text-right font-medium">New salary</th><th className="px-3 py-2 text-right font-medium">Change</th></tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(({ e, base, next, edited }) => (
                <tr key={e.id}>
                  <td className="px-3 py-2"><p className="font-medium text-gray-900">{e.name}</p><p className="text-xs text-muted-foreground">{e.designation ?? '—'}</p></td>
                  <td className="px-3 py-2 text-right tabular-nums text-gray-600"><TkAmt value={base} /></td>
                  <td className="px-3 py-2 text-right">
                    <input type="number" min="0" step="1" value={edited ? overrides[e.id] : (next ?? '')} aria-label={`New salary for ${e.name}`}
                      onChange={ev => setOverrides(o => ({ ...o, [e.id]: ev.target.value }))}
                      className={cn(inputClass, 'h-8 w-32 text-right tabular-nums', edited && 'border-blue-300 bg-blue-50/40')} />
                  </td>
                  <td className={cn('px-3 py-2 text-right text-[13px] tabular-nums', next >= base ? 'text-emerald-700' : 'text-red-600')}>{next > 0 ? changeText(base, next) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-[13px] text-muted-foreground">Payroll changes by <span className="font-medium text-gray-900"><TkAmt value={total} /></span> a month from {periodLabel(form.effectiveMonth)}.</p>

        <Field label="Reason (internal)" hint="Not printed on the letters.">
          <Textarea rows={2} value={form.reason} onChange={e => set('reason', e.target.value)} placeholder="e.g. Annual review 2026" className="min-h-0 resize-none" />
        </Field>
        {canApprove && (
          <label className="flex items-center gap-2 text-sm text-gray-800">
            <input type="checkbox" checked={form.approveNow} onChange={e => set('approveNow', e.target.checked)} className="size-4 rounded border-gray-300" />
            Approve now (everyone is notified and gets their letter)
          </label>
        )}
        <ModalFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>{!saving && <TrendingUp />} {canApprove && form.approveNow ? 'Approve changes' : 'Send for approval'}</Button>
        </ModalFooter>
      </form>
    </Modal>
  )
}

function EmployeesTab({ canApprove, myUserId, superAdmin, onChanged }) {
  const [rows, setRows] = useState(null)
  const [search, setSearch] = useState('')
  const [department, setDepartment] = useState('')
  const [selected, setSelected] = useState(new Set())
  const [bulkOpen, setBulkOpen] = useState(false)
  const [revise, setRevise] = useState(null)

  const load = useCallback(() => {
    const qs = new URLSearchParams()
    if (search.trim()) qs.set('search', search.trim())
    if (department) qs.set('department', department)
    api(`/api/salary-revisions/employees?${qs}`)
      .then(j => setRows(j.data))
      .catch(err => { toast.error(err.message); setRows([]) })
  }, [search, department])
  useEffect(() => { const t = setTimeout(load, 250); return () => clearTimeout(t) }, [load])

  const departments = useMemo(() => [...new Set((rows ?? []).map(r => r.department).filter(Boolean))].sort(), [rows])
  const pickable = (r) => !r.pending
  const chosen = (rows ?? []).filter(r => selected.has(r.id))

  return (
    <div className="space-y-3">
      {bulkOpen && <BulkProposeModal employees={chosen} canApprove={canApprove} onClose={() => setBulkOpen(false)} onDone={() => { setSelected(new Set()); load(); onChanged() }} />}
      {revise && (
        <ReviseSalaryModal employee={{ id: revise.id, name: revise.name, salary: revise.salary, designation: revise.designation }}
          approved={revise.upcoming ? [revise.upcoming] : []}
          canApprove={canApprove && (revise.userId !== myUserId || superAdmin)}
          onClose={() => setRevise(null)} onDone={() => { load(); onChanged() }} />
      )}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
          <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search name or employee ID" className={cn(inputClass, 'pl-8')} />
        </div>
        <NativeSelect value={department} onChange={e => setDepartment(e.target.value)} className="sm:w-48">
          <option value="">All departments</option>
          {departments.map(d => <option key={d} value={d}>{d}</option>)}
        </NativeSelect>
        <Button disabled={!chosen.length} onClick={() => setBulkOpen(true)}><TrendingUp /> Change salary{chosen.length ? ` (${chosen.length})` : ''}</Button>
      </div>

      {!rows ? <LoadingSpinner className="py-16" /> : rows.length === 0 ? (
        <Card><EmptyState icon={Users} title="No employees found" /></Card>
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-gray-100 text-left text-xs text-muted-foreground">
              <tr>
                <th className="w-10 px-4 py-2.5">
                  <input type="checkbox" aria-label="Select all"
                    checked={rows.filter(pickable).length > 0 && rows.filter(pickable).every(r => selected.has(r.id))}
                    onChange={e => setSelected(e.target.checked ? new Set(rows.filter(pickable).map(r => r.id)) : new Set())}
                    className="size-4 rounded border-gray-300" />
                </th>
                <th className="px-2 py-2.5 font-medium">Employee</th>
                <th className="px-2 py-2.5 text-right font-medium">Monthly salary</th>
                <th className="px-2 py-2.5 font-medium">Last change</th>
                <th className="px-2 py-2.5 font-medium">Status</th>
                <th className="px-4 py-2.5" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map(r => {
                const overdue = (r.monthsSinceChange ?? 0) >= 12
                return (
                  <tr key={r.id} className="hover:bg-gray-50/60">
                    <td className="px-4 py-2.5">
                      <input type="checkbox" disabled={!pickable(r)} checked={selected.has(r.id)} aria-label={`Select ${r.name}`}
                        onChange={e => setSelected(s => { const n = new Set(s); e.target.checked ? n.add(r.id) : n.delete(r.id); return n })}
                        className="size-4 rounded border-gray-300 disabled:opacity-40" />
                    </td>
                    <td className="px-2 py-2.5"><Person e={r} /></td>
                    <td className="px-2 py-2.5 text-right font-medium tabular-nums text-gray-900"><TkAmt value={r.salary} /></td>
                    <td className="px-2 py-2.5">
                      {r.lastChange
                        ? <p className="text-[13px] text-gray-700">{r.lastChange.effectiveLabel} <span className="tabular-nums text-emerald-700">{r.lastChange.percent !== null ? `${r.lastChange.percent > 0 ? '+' : ''}${r.lastChange.percent}%` : ''}</span></p>
                        : <p className="text-[13px] text-muted-foreground">{r.hireDate ? `Since joining ${fmtDate(r.hireDate)}` : '—'}</p>}
                      {r.monthsSinceChange !== null && (
                        <p className={cn('text-xs', overdue ? 'font-medium text-amber-700' : 'text-muted-foreground')}>
                          {r.monthsSinceChange} month{r.monthsSinceChange === 1 ? '' : 's'} ago{overdue ? ' · due for review' : ''}
                        </p>
                      )}
                    </td>
                    <td className="px-2 py-2.5">
                      {r.pending && <Badge variant="warning">Waiting: <TkAmt value={r.pending.newSalary} /></Badge>}
                      {r.upcoming && <Badge variant="primary">From {r.upcoming.effectiveLabel}: <TkAmt value={r.upcoming.newSalary} /></Badge>}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      {!r.pending && <Button size="xs" variant="ghost" onClick={() => setRevise(r)}><TrendingUp /> Revise</Button>}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}
    </div>
  )
}

// ── History ──────────────────────────────────────────────────────────────────

function HistoryTab() {
  const [status, setStatus] = useState('all')
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)

  useEffect(() => {
    setData(null)
    api(`/api/salary-revisions?status=${status}&page=${page}&limit=50`)
      .then(setData)
      .catch(err => { toast.error(err.message); setData({ data: [], meta: { pages: 1 } }) })
  }, [status, page])

  return (
    <div className="space-y-3">
      <NativeSelect value={status} onChange={e => { setStatus(e.target.value); setPage(1) }} className="w-56">
        <option value="all">All changes</option>
        <option value="APPROVED">Approved</option>
        <option value="PENDING">Waiting for approval</option>
        <option value="REJECTED">Not approved</option>
        <option value="CANCELLED">Cancelled</option>
      </NativeSelect>
      {!data ? <LoadingSpinner className="py-16" /> : data.data.length === 0 ? (
        <Card><EmptyState icon={TrendingUp} title="No salary changes yet" /></Card>
      ) : (
        <Card className="divide-y divide-gray-100 overflow-hidden">
          {data.data.map(r => (
            <div key={r.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-center">
              {r.employee && <div className="w-48 shrink-0"><Person e={r.employee} /></div>}
              <div className="min-w-0 flex-1 text-sm">
                <p className="text-gray-900">
                  <span className="font-medium">{r.effectiveLabel}</span> · {r.typeLabel} · <TkAmt value={r.previousSalary} /> → <span className="font-semibold"><TkAmt value={r.newSalary} /></span>
                  <span className={cn('ml-1.5 text-[13px] tabular-nums', r.change >= 0 ? 'text-emerald-700' : 'text-red-600')}>{changeText(r.previousSalary, r.newSalary)}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {r.source === 'EDIT' ? 'Changed on the profile' : `Proposed by ${r.requestedBy?.name ?? '—'}`}
                  {r.approvedBy && r.status !== 'PENDING' && r.source !== 'EDIT' ? ` · ${r.status === 'REJECTED' ? 'declined' : 'approved'} by ${r.approvedBy.name}` : ''} · {fmtDate(r.createdAt)}
                  {r.reason && r.source !== 'EDIT' ? ` · ${r.reason}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <RevisionStatus r={r} />
                {r.letterNo && (
                  <a href={`/api/salary-revisions/${r.id}/letter`} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1 text-[13px] font-medium text-gray-700 underline-offset-4 hover:underline">
                    <FileText className="size-3.5" /> Letter
                  </a>
                )}
              </div>
            </div>
          ))}
        </Card>
      )}
      {data?.meta?.pages > 1 && (
        <div className="flex items-center justify-end gap-2 text-sm">
          <Button size="sm" variant="outline" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
          <span className="text-muted-foreground">Page {page} of {data.meta.pages}</span>
          <Button size="sm" variant="outline" disabled={page >= data.meta.pages} onClick={() => setPage(p => p + 1)}>Next</Button>
        </div>
      )}
    </div>
  )
}

// ── Page ─────────────────────────────────────────────────────────────────────

function IncrementsContent() {
  const router = useRouter()
  const sp = useSearchParams()
  const tab = sp.get('tab') ?? 'approvals'
  const { can, ready } = usePermission()
  const [pendingCount, setPendingCount] = useState(null)
  const [me, setMe] = useState({ userId: null, superAdmin: false })
  const [stamp, setStamp] = useState(0)

  useEffect(() => {
    api('/api/salary-revisions?status=PENDING&limit=1')
      .then(j => { setPendingCount(j.meta.total); setMe({ userId: j.can.userId, superAdmin: j.can.superAdmin }) })
      .catch(() => {})
  }, [stamp])

  if (!ready) return <LoadingSpinner className="py-20" />
  const canApprove = can('hr.salary.approve')
  const setTab = (t) => router.push(`/admin/salary-increments?tab=${t}`, { scroll: false })

  return (
    <div className="space-y-6">
      <PageHeader title="Salary increments"
        description="Increments, promotions and salary changes: proposed, approved, and in payroll from their month." />
      {!canApprove && (
        <div className="flex items-start gap-2 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5 text-sm text-gray-700">
          <AlertTriangle className="mt-0.5 size-4 shrink-0 text-gray-400" />
          Changes you propose wait for approval by someone who approves salaries.
        </div>
      )}
      <Tabs variant="underline" value={tab} onChange={setTab} tabs={[
        { value: 'approvals', label: 'To approve', count: pendingCount || undefined },
        { value: 'employees', label: 'Employees' },
        { value: 'history',   label: 'History' },
      ]} />
      {tab === 'approvals' && <ApprovalsTab key={stamp} onCount={setPendingCount} />}
      {tab === 'employees' && <EmployeesTab canApprove={canApprove} myUserId={me.userId} superAdmin={me.superAdmin} onChanged={() => setStamp(s => s + 1)} />}
      {tab === 'history' && <HistoryTab key={stamp} />}
    </div>
  )
}

export default function SalaryIncrementsPage() {
  return (
    <Suspense fallback={<LoadingSpinner className="py-20" />}>
      <IncrementsContent />
    </Suspense>
  )
}
