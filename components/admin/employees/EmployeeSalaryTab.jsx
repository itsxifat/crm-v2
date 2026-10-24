'use client'

import { useCallback, useEffect, useState } from 'react'
import toast from 'react-hot-toast'
import { TrendingUp, FileText, Check, X, Ban, Clock, ArrowRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import Button, { buttonVariants } from '@/components/ui/Button'
import { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent } from '@/components/ui/Card'
import TkAmt from '@/components/ui/TkAmt'
import EmptyState from '@/components/ui/EmptyState'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import ReviseSalaryModal from '@/components/admin/salary/ReviseSalaryModal'
import { RevisionStatus, changeText } from '@/components/admin/salary/salaryUi'

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Dhaka' }) : '—'

async function api(url, opts) {
  const res = await fetch(url, opts)
  const j = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(j.error || `Request failed (${res.status})`)
  return j
}

/** Employee page tab: salary now, changes waiting or scheduled, and the full history with letters. */
export default function EmployeeSalaryTab({ emp, onChanged }) {
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [revising, setRevising] = useState(false)
  const [busy, setBusy] = useState(null)

  const load = useCallback(() => {
    api(`/api/salary-revisions?employeeId=${emp.id}&limit=100`)
      .then(j => { setData(j); setError(null) })
      .catch(err => setError(err.message))
  }, [emp.id])
  useEffect(() => { load() }, [load])

  async function decide(r, action) {
    let note = null
    if (action === 'reject') {
      note = prompt('Why is it not approved? (optional, shown to the person who proposed it)')
      if (note === null) return
    }
    if (action === 'cancel' && !confirm('Cancel this salary change?')) return
    setBusy(`${action}:${r.id}`)
    try {
      const j = await api(`/api/salary-revisions/${r.id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action, note }) })
      toast.success(action === 'approve' ? 'Approved — the employee is notified' : action === 'reject' ? 'Marked as not approved' : 'Cancelled')
      for (const w of j.warnings ?? []) toast(w, { duration: 7000 })
      load()
      onChanged?.()
    } catch (err) { toast.error(err.message) }
    finally { setBusy(null) }
  }

  if (error) return <Card><EmptyState title="Couldn't load the salary history" description={error} action={<Button variant="outline" onClick={load}>Retry</Button>} /></Card>
  if (!data) return <LoadingSpinner className="py-16" />

  const can = data.can
  const own = String(emp.userId?.id ?? emp.userId?._id ?? emp.userId ?? '') === String(can.userId)
  const mayDecide = can.approve && (!own || can.superAdmin)
  const mayRevise = (can.revise || can.approve) && (!own || can.superAdmin) && !emp.resigned
  const revisions = data.data
  const pending = revisions.find(r => r.status === 'PENDING')
  const upcoming = revisions.filter(r => r.status === 'APPROVED' && !r.inEffect)
  const approved = revisions.filter(r => r.status === 'APPROVED')
  const lastInEffect = approved.find(r => r.inEffect)

  return (
    <div className="space-y-6">
      {revising && (
        <ReviseSalaryModal
          employee={{ id: emp.id, name: emp.userId?.name ?? 'Employee', salary: emp.salary, designation: emp.designation || emp.position }}
          approved={approved}
          canApprove={mayDecide}
          onClose={() => setRevising(false)}
          onDone={() => { load(); onChanged?.() }}
        />
      )}

      <Card>
        <CardHeader>
          <div>
            <CardTitle>Monthly salary</CardTitle>
            <CardDescription>{lastInEffect ? <>Last changed {lastInEffect.effectiveLabel}: {changeText(lastInEffect.previousSalary, lastInEffect.newSalary)}</> : 'No changes recorded yet'}</CardDescription>
          </div>
          {mayRevise && !pending && (
            <CardAction><Button onClick={() => setRevising(true)}><TrendingUp /> Revise salary</Button></CardAction>
          )}
        </CardHeader>
        <CardContent>
          <p className="text-3xl font-semibold tracking-tight text-gray-900"><TkAmt value={emp.salary ?? 0} /></p>
          {(emp.designation || emp.position) && <p className="mt-1 text-sm text-muted-foreground">{emp.designation || emp.position}</p>}
        </CardContent>
      </Card>

      {pending && (
        <Card className="border-amber-200 bg-amber-50/40">
          <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-0.5">
              <p className="flex items-center gap-1.5 text-sm font-medium text-amber-800"><Clock className="size-4" /> {pending.typeLabel} waiting for approval</p>
              <p className="text-sm text-gray-800">
                <TkAmt value={pending.previousSalary} /> <ArrowRight className="inline size-3.5 text-gray-400" /> <span className="font-semibold"><TkAmt value={pending.newSalary} /></span>
                <span className="ml-1.5 text-emerald-700">{changeText(pending.previousSalary, pending.newSalary)}</span> from {pending.effectiveLabel}
                {pending.newDesignation && <> · as <span className="font-medium">{pending.newDesignation}</span></>}
              </p>
              <p className="text-xs text-muted-foreground">Proposed by {pending.requestedBy?.name ?? '—'} on {fmtDate(pending.createdAt)}{pending.reason ? ` · ${pending.reason}` : ''}</p>
            </div>
            <div className="flex shrink-0 flex-wrap gap-1.5">
              {mayDecide && <Button size="sm" onClick={() => decide(pending, 'approve')} loading={busy === `approve:${pending.id}`}>{busy !== `approve:${pending.id}` && <Check />} Approve</Button>}
              {mayDecide && <Button size="sm" variant="outline" onClick={() => decide(pending, 'reject')} loading={busy === `reject:${pending.id}`}>{busy !== `reject:${pending.id}` && <X />} Not approve</Button>}
              {(mayDecide || pending.requestedBy?.id === can.userId) && (
                <Button size="sm" variant="ghost" onClick={() => decide(pending, 'cancel')} loading={busy === `cancel:${pending.id}`} className="text-gray-500">{busy !== `cancel:${pending.id}` && <Ban />} Cancel</Button>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {upcoming.map(r => (
        <Card key={r.id} className="border-blue-200 bg-blue-50/30">
          <CardContent className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0 space-y-0.5">
              <p className="text-sm font-medium text-blue-800">{r.typeLabel} approved — starts {r.effectiveLabel}</p>
              <p className="text-sm text-gray-800">
                <TkAmt value={r.previousSalary} /> <ArrowRight className="inline size-3.5 text-gray-400" /> <span className="font-semibold"><TkAmt value={r.newSalary} /></span>
                <span className="ml-1.5 text-emerald-700">{changeText(r.previousSalary, r.newSalary)}</span>
                {r.newDesignation && <> · as <span className="font-medium">{r.newDesignation}</span></>}
              </p>
            </div>
            <div className="flex shrink-0 gap-1.5">
              {r.letterNo && (
                <a href={`/api/salary-revisions/${r.id}/letter`} target="_blank" rel="noopener noreferrer" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                  <FileText /> Letter
                </a>
              )}
              {mayDecide && <Button size="sm" variant="ghost" onClick={() => decide(r, 'cancel')} loading={busy === `cancel:${r.id}`} className="text-gray-500">{busy !== `cancel:${r.id}` && <Ban />} Cancel</Button>}
            </div>
          </CardContent>
        </Card>
      ))}

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-gray-100">
          <CardTitle>Salary history</CardTitle>
        </CardHeader>
        {revisions.length === 0 ? (
          <EmptyState icon={TrendingUp} title="No salary changes yet" description={mayRevise ? 'Increments, promotions and adjustments appear here with their letters.' : undefined} />
        ) : (
          <div className="divide-y divide-gray-100">
            {revisions.map(r => (
              <div key={r.id} className="flex flex-col gap-2 px-5 py-3.5 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="text-sm text-gray-900">
                    <span className="font-medium">{r.effectiveLabel}</span>
                    <span className="mx-1.5 text-gray-300">·</span>{r.typeLabel}
                    <span className="mx-1.5 text-gray-300">·</span>
                    <span className="tabular-nums"><TkAmt value={r.previousSalary} /> → <span className="font-semibold"><TkAmt value={r.newSalary} /></span></span>
                    <span className={cn('ml-1.5 text-[13px] tabular-nums', r.change >= 0 ? 'text-emerald-700' : 'text-red-600')}>{changeText(r.previousSalary, r.newSalary)}</span>
                  </p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {r.newDesignation && <>{r.previousDesignation ? `${r.previousDesignation} → ` : ''}{r.newDesignation} · </>}
                    {r.source === 'EDIT' ? `Changed on the profile by ${r.requestedBy?.name ?? '—'}` : <>Proposed by {r.requestedBy?.name ?? '—'}{r.approvedBy && r.status !== 'PENDING' ? ` · ${r.status === 'REJECTED' ? 'declined' : 'approved'} by ${r.approvedBy.name}` : ''}</>}
                    {r.reason && r.source !== 'EDIT' ? ` · ${r.reason}` : ''}
                    {r.decisionNote ? ` · Note: ${r.decisionNote}` : ''}
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
          </div>
        )}
      </Card>
    </div>
  )
}
