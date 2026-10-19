'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import {
  ArrowLeft, Mail, Phone, Clock, Pencil, Ban, RotateCcw,
  CheckCircle2, Send, BadgeCheck, FileText, XCircle, Briefcase, Wallet,
} from 'lucide-react'
import Avatar from '@/components/ui/Avatar'
import Badge from '@/components/ui/Badge'
import Button, { buttonVariants } from '@/components/ui/Button'
import { Card, CardHeader, CardTitle, CardDescription, CardAction } from '@/components/ui/Card'
import Tabs from '@/components/ui/Tabs'
import EmptyState from '@/components/ui/EmptyState'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import { Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import FreelancerModal from '@/components/admin/freelancers/FreelancerModal'
import { formatCurrency } from '@/lib/utils'

const TABS = ['Overview', 'Engagements', 'Payments', 'Timesheets']

function moneyByCurrency(totals) {
  if (!totals || totals.length === 0) return formatCurrency(0)
  return totals.map(t => formatCurrency(t.total, t.currency)).join('  ·  ')
}

const ASSIGN_VARIANT = {
  ASSIGNED: 'primary', ACCEPTED: 'teal', IN_PROGRESS: 'purple', COMPLETED: 'success', CANCELLED: 'danger',
}
const PAY_LABEL = {
  PENDING: { label: 'Not requested', variant: 'default' },
  PAYMENT_REQUESTED: { label: 'Awaiting payment', variant: 'warning' },
  PAID: { label: 'Paid', variant: 'success' },
  NOT_REQUIRED: { label: 'Salary', variant: 'indigo' },
}

function StatBox({ label, value, hint }) {
  return (
    <Card className="p-5">
      <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
      <p className="mt-2 break-words text-xl font-semibold tracking-tight tabular-nums text-gray-900">{value}</p>
      {hint && <p className="mt-1 text-xs text-muted-foreground">{hint}</p>}
    </Card>
  )
}

// Money fields may arrive masked ('••••••') for roles without pii.financial.view —
// show the mask as-is instead of formatting it into 'NaN'.
function fmtMoney(v, currency) {
  return typeof v === 'number' ? formatCurrency(v, currency) : (v ?? '—')
}

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
}

const PAYEE_LABELS = {
  INDIVIDUAL:   'Individual (resident)',
  COMPANY:      'Company / firm',
  NON_RESIDENT: 'Non-resident (abroad)',
}

// Read-only tax identity (TDS / VDS payee side). The e-TIN may arrive masked
// ('••••••••9012') for viewers without pii.identity.view — shown as-is.
function TaxIdentity({ data, onEdit }) {
  const isAgency = data.type === 'AGENCY'
  const payee    = data.payeeType ?? (isAgency ? 'COMPANY' : 'INDIVIDUAL')
  const rows = [
    { label: 'TIN (e-TIN)', value: data.tin, mono: true },
    { label: 'BIN',         value: data.bin, mono: true },
    { label: 'Payee type',  value: PAYEE_LABELS[payee] ?? payee },
  ]
  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-sm font-semibold text-gray-900">Tax identity</h3>
        <Badge variant={data.hasPsr ? 'success' : 'warning'}>
          {data.hasPsr ? 'PSR on file' : 'No PSR — TDS +50%'}
        </Badge>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {rows.map(r => (
          <div key={r.label} className="min-w-0">
            <p className="text-xs text-muted-foreground">{r.label}</p>
            <p className={`mt-0.5 break-words text-sm font-medium ${r.value ? 'text-gray-900' : 'text-gray-300'} ${r.mono && r.value ? 'font-mono' : ''}`}>
              {r.value || '—'}
            </p>
          </div>
        ))}
      </div>
      {isAgency && payee === 'INDIVIDUAL' && (
        <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          Set as an individual payee — firms are usually “Company / firm” for TDS.{' '}
          <button type="button" onClick={onEdit} className="font-medium underline underline-offset-4">Edit</button>
        </div>
      )}
      {!data.tin && !data.bin && (
        <p className="text-sm text-muted-foreground">
          No TIN or BIN on file.{' '}
          <button type="button" onClick={onEdit} className="font-medium text-gray-900 underline-offset-4 hover:underline">Add tax details</button>
        </p>
      )}
    </div>
  )
}

const VERIFY_META = {
  CREATED:          { label: 'Not started',    variant: 'default' },
  INCOMPLETE:       { label: 'Incomplete',     variant: 'warning' },
  PENDING_APPROVAL: { label: 'Pending review', variant: 'primary' },
  APPROVED:         { label: 'Verified',       variant: 'success' },
}

function VerificationCard({ data, acting, onAction }) {
  const status  = data.profileStatus ?? 'CREATED'
  const pct     = data.profileCompletionPct ?? 0
  const isAgency = data.type === 'AGENCY'
  const docs    = data.kycDocuments ?? []
  const meta    = VERIFY_META[status] ?? VERIFY_META.INCOMPLETE
  const busy    = acting === 'verify'

  const rows = isAgency
    ? [
        { label: 'Agency name', value: data.agencyInfo?.agencyName },
        { label: 'Agency type', value: data.agencyInfo?.type },
        { label: 'Contact person', value: data.contactPerson?.name },
        { label: 'Contact phone', value: data.contactPerson?.phone },
        { label: 'Contact email', value: data.contactPerson?.email },
        { label: 'Address', value: data.address },
      ]
    : [
        { label: 'NID number', value: data.nidNumber },
        { label: 'Passport', value: data.passportNumber },
        { label: 'Address', value: data.address },
        { label: 'Skills', value: data.skills },
      ]

  return (
    <Card>
      <CardHeader className="items-center">
        <CardTitle>KYC verification</CardTitle>
        <CardAction>
          <Badge variant={meta.variant}>{meta.label} · {pct}%</Badge>
        </CardAction>
      </CardHeader>

      <div className="space-y-4 px-5 pb-5">
        {status === 'CREATED' || status === 'INCOMPLETE' ? (
          <p className="text-sm text-muted-foreground">
            KYC not submitted yet ({pct}% complete).
          </p>
        ) : (
          <>
            <div className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
              {rows.filter(r => r.value).map(r => (
                <div key={r.label}>
                  <p className="text-xs text-muted-foreground">{r.label}</p>
                  <p className="mt-0.5 break-words text-sm font-medium text-gray-900">{r.value}</p>
                </div>
              ))}
            </div>

            <div>
              <p className="mb-1.5 text-xs text-muted-foreground">Documents</p>
              {docs.length === 0 ? (
                <p className="text-sm text-muted-foreground">No documents uploaded</p>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {docs.map((d, i) => (
                    <a key={i} href={d.url} target="_blank" rel="noreferrer"
                      className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                      <FileText /> {d.name || d.type}
                    </a>
                  ))}
                </div>
              )}
            </div>
          </>
        )}

        {data.reviewNotes && status === 'INCOMPLETE' && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
            <XCircle className="mt-0.5 size-4 shrink-0" />
            <div><span className="font-medium">Sent back: </span>{data.reviewNotes}</div>
          </div>
        )}

        {status === 'APPROVED' && (
          <p className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700">
            <BadgeCheck className="size-4" /> Verified{data.verifiedAt ? ` on ${fmtDate(data.verifiedAt)}` : ''} · full portal access
          </p>
        )}
      </div>

      {status === 'PENDING_APPROVAL' && (
        <div className="flex flex-wrap items-center gap-2 border-t border-gray-100 px-5 py-3">
          <Button onClick={() => onAction('approve')} loading={busy}>
            {!busy && <BadgeCheck />} Approve
          </Button>
          <Button variant="outline" onClick={() => onAction('reject')} disabled={busy} className="text-red-600 hover:text-red-700">
            <XCircle /> Reject
          </Button>
        </div>
      )}
    </Card>
  )
}

export default function FreelancerDetailPage() {
  const { id } = useParams()
  const router = useRouter()
  const [data, setData]     = useState(null)
  const [loading, setLoading] = useState(true)
  const [tab, setTab]       = useState('Overview')
  const [editOpen, setEditOpen] = useState(false)
  const [acting, setActing] = useState(null)

  const load = useCallback(async () => {
    try {
      const res  = await fetch(`/api/freelancers/${id}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setData(json.data)
    } catch (err) {
      toast.error(err.message ?? 'Failed to load')
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])

  async function assignmentAction(assignmentId, action, msg) {
    setActing(assignmentId + action)
    try {
      const res  = await fetch(`/api/freelancer-assignments/${assignmentId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success(msg)
      load()
    } catch (err) {
      toast.error(err.message ?? 'Failed')
    } finally {
      setActing(null)
    }
  }

  async function generateSalary() {
    try {
      const res  = await fetch('/api/cron/salary-payouts', { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success(json.created > 0 ? `Generated ${json.created} payout(s)` : 'No new payouts due')
      load()
    } catch (err) {
      toast.error(err.message ?? 'Failed')
    }
  }

  // Salary is approved & paid from the unified Expenses queue; this only cancels a pending payout.
  async function payoutAction(p, action) {
    // Cancelling is irreversible: the period can't be regenerated by the salary cron.
    const note = prompt(`Cancel the ${p.period ?? ''} salary payout? This can't be undone; the month won't be regenerated.\n\nReason (optional):`)
    if (note === null) return
    try {
      const res  = await fetch(`/api/admin/salary-payouts/${p.id ?? p._id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action, note: note.trim() || null }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Payout cancelled')
      load()
    } catch (err) {
      toast.error(err.message ?? 'Failed')
    }
  }

  async function toggleDisable(disable) {
    if (disable && !confirm('Disable this account?')) return
    try {
      const res  = await fetch(`/api/freelancers/${id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: disable ? 'disable' : 'enable' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success(disable ? 'Account disabled' : 'Account reactivated')
      load()
    } catch (err) {
      toast.error(err.message ?? 'Failed')
    }
  }

  async function verifyAction(action) {
    if (action === 'reject') {
      const notes = prompt('Reason for rejection (shown to the freelancer):')
      if (notes === null) return
      setActing('verify')
      try {
        const res  = await fetch(`/api/admin/freelancers/${id}/approve`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'reject', notes }),
        })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error)
        toast.success('KYC returned for revision')
        load()
      } catch (err) {
        toast.error(err.message ?? 'Failed')
      } finally { setActing(null) }
      return
    }
    setActing('verify')
    try {
      const res  = await fetch(`/api/admin/freelancers/${id}/approve`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'approve' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Verified — access granted')
      load()
    } catch (err) {
      toast.error(err.message ?? 'Failed')
    } finally { setActing(null) }
  }

  if (loading) return <PageLoader />
  if (!data) {
    return (
      <EmptyState
        title="Freelancer not found"
        action={<Button variant="outline" href="/admin/freelancers">Back to freelancers</Button>}
      />
    )
  }

  const {
    userId: user, assignments = [], salaryPayouts = [], timesheets = [], finance = {},
  } = data
  const isSalary = data.employmentMode === 'SALARY'
  const disabled = data.disabledAt || user?.isActive === false
  const totalHours = timesheets.reduce((s, t) => s + (t.hours ?? 0), 0)
  const paidHistory = assignments.filter(a => a.paymentStatus === 'PAID')

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <button type="button" onClick={() => router.back()}
          className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-gray-900">
          <ArrowLeft className="size-3.5" /> Back
        </button>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <Avatar name={user?.name} src={user?.avatar} size="lg" />
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-2xl font-semibold tracking-tight text-gray-900">{user?.name}</h1>
                <Badge variant={disabled ? 'danger' : 'success'} dot>{disabled ? 'Disabled' : 'Active'}</Badge>
                <Badge variant={isSalary ? 'indigo' : 'default'}>
                  {isSalary ? 'Salary' : 'Project'} · {data.paymentCurrency ?? 'BDT'}
                </Badge>
              </div>
              {data.skills && <p className="mt-1 text-sm text-muted-foreground">{data.skills}</p>}
            </div>
          </div>
          <div className="flex shrink-0 flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => setEditOpen(true)}>
              <Pencil /> Edit
            </Button>
            {disabled ? (
              <Button variant="outline" onClick={() => toggleDisable(false)}>
                <RotateCcw /> Reactivate
              </Button>
            ) : (
              <Button variant="outline" onClick={() => toggleDisable(true)} disabled={finance.hasUnpaid}
                title={finance.hasUnpaid ? 'Settle outstanding dues first' : ''}
                className="text-red-600 hover:text-red-700">
                <Ban /> Disable
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Money buckets */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <StatBox label="In progress" value={moneyByCurrency(finance.accepted)} hint="Accepted, not delivered" />
        <StatBox label="Owed" value={moneyByCurrency(finance.owed)} hint="Delivered, unpaid" />
        <StatBox label="Total paid" value={moneyByCurrency(finance.paid)} />
      </div>

      {/* KYC / Verification */}
      <VerificationCard data={data} acting={acting} onAction={verifyAction} />

      {/* Tabs */}
      <div className="space-y-4">
        <Tabs
          variant="underline"
          value={tab}
          onChange={setTab}
          tabs={[...TABS, ...(isSalary ? ['Salary'] : [])].map(t => ({ value: t, label: t }))}
        />

        {/* OVERVIEW */}
        {tab === 'Overview' && (
          <Card className="p-5">
            <div className="grid gap-8 lg:grid-cols-2">
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-900">Contact</h3>
                {[
                  { icon: Mail,  label: 'Email', value: user?.email },
                  { icon: Phone, label: 'Phone', value: user?.phone },
                ].map(({ icon: Icon, label, value }) => value ? (
                  <div key={label} className="flex items-center gap-3">
                    <Icon className="size-4 shrink-0 text-gray-400" />
                    <div>
                      <p className="text-xs text-muted-foreground">{label}</p>
                      <p className="text-sm font-medium text-gray-900">{value}</p>
                    </div>
                  </div>
                ) : null)}
                {data.bio && (
                  <div>
                    <p className="mb-1 text-xs text-muted-foreground">Bio</p>
                    <p className="text-sm text-gray-700">{data.bio}</p>
                  </div>
                )}
                {disabled && data.disabledReason && (
                  <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5">
                    <p className="text-xs font-medium text-red-700">Disabled</p>
                    <p className="mt-0.5 text-sm text-red-800">{data.disabledReason}</p>
                  </div>
                )}
              </div>
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-900">Engagement</h3>
                <div>
                  <p className="text-xs text-muted-foreground">Mode</p>
                  <p className="mt-0.5 text-sm font-medium text-gray-900">{isSalary ? 'Monthly salary' : 'Per project / task'}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Default payment currency</p>
                  <p className="mt-0.5 text-sm font-medium text-gray-900">{data.paymentCurrency ?? 'BDT'}</p>
                </div>
                {isSalary && (
                  <div className="space-y-1 rounded-lg bg-gray-50 p-4">
                    <p className="text-sm font-semibold tabular-nums text-gray-900">{fmtMoney(data.salaryAmount, data.salaryCurrency)} / month</p>
                    <p className="text-xs text-gray-600">Pays on day {data.salaryDay ?? '—'} of each month</p>
                    <p className="text-xs text-muted-foreground">
                      {fmtDate(data.salaryStartDate)} → {data.salaryEndDate ? fmtDate(data.salaryEndDate) : 'ongoing'}
                      {' · '}{data.salaryActive ? 'Active' : 'Paused'}
                    </p>
                  </div>
                )}
              </div>
              <div className="border-t border-gray-100 pt-5 lg:col-span-2">
                <TaxIdentity data={data} onEdit={() => setEditOpen(true)} />
              </div>
            </div>
          </Card>
        )}

        {/* ENGAGEMENTS */}
        {tab === 'Engagements' && (
          <Card className="overflow-hidden">
            {assignments.length === 0 ? (
              <EmptyState icon={Briefcase} title="No engagements yet" />
            ) : (
              <Table className="min-w-[640px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead>Date</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assignments.map(a => {
                    const aid = a.id ?? a._id
                    const pay = PAY_LABEL[a.paymentStatus] ?? PAY_LABEL.PENDING
                    return (
                      <TableRow key={aid}>
                        <TableCell>
                          <p className="font-medium text-gray-900">{a.projectId?.name ?? '—'}</p>
                          {a.projectId?.projectCode && <p className="font-mono text-xs text-muted-foreground">{a.projectId.projectCode}</p>}
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-medium tabular-nums text-gray-900">
                          {a.paymentAmount ? formatCurrency(a.paymentAmount, a.currency) : '—'}
                        </TableCell>
                        <TableCell>
                          <Badge variant={ASSIGN_VARIANT[a.status] ?? 'default'}>{a.status?.replace('_', ' ')}</Badge>
                        </TableCell>
                        <TableCell>
                          <Badge variant={pay.variant}>{pay.label}</Badge>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(a.createdAt)}</TableCell>
                        <TableCell>
                          {['ACCEPTED', 'IN_PROGRESS'].includes(a.status) && (
                            <Button variant="outline" size="xs"
                              onClick={() => assignmentAction(aid, 'complete', 'Marked delivered')}
                              loading={acting === aid + 'complete'}>
                              <CheckCircle2 /> Mark done
                            </Button>
                          )}
                          {a.status === 'COMPLETED' && a.paymentStatus === 'PENDING' && a.paymentAmount > 0 && (
                            <Button variant="outline" size="xs"
                              onClick={() => assignmentAction(aid, 'request_payment', 'Sent to payment')}
                              loading={acting === aid + 'request_payment'}>
                              <Send /> Send to payment
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </Card>
        )}

        {/* PAYMENTS */}
        {tab === 'Payments' && (
          <Card className="overflow-hidden">
            {paidHistory.length === 0 && salaryPayouts.filter(p => p.status === 'PAID').length === 0 ? (
              <EmptyState icon={Wallet} title="No payments yet" />
            ) : (
              <div className="divide-y divide-gray-100">
                {paidHistory.map(a => (
                  <div key={a.id ?? a._id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium text-gray-900">{a.projectId?.name ?? 'Project'}</p>
                      <p className="text-xs text-muted-foreground">Paid · {fmtDate(a.approvedAt ?? a.updatedAt)}</p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums text-emerald-600">{formatCurrency(a.paymentAmount, a.currency)}</p>
                  </div>
                ))}
                {salaryPayouts.filter(p => p.status === 'PAID').map(p => (
                  <div key={p.id ?? p._id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                    <div>
                      <p className="text-sm font-medium text-gray-900">Salary · {p.period}</p>
                      <p className="text-xs text-muted-foreground">Paid · {fmtDate(p.approvedAt)}</p>
                    </div>
                    <p className="shrink-0 text-sm font-semibold tabular-nums text-emerald-600">{fmtMoney(p.amount, p.currency)}</p>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}

        {/* TIMESHEETS */}
        {tab === 'Timesheets' && (
          <Card className="overflow-hidden">
            {timesheets.length === 0 ? (
              <EmptyState icon={Clock} title="No timesheets yet" />
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Date</TableHead>
                    <TableHead>Task</TableHead>
                    <TableHead className="text-right">Hours</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {timesheets.map((ts) => (
                    <TableRow key={ts.id ?? ts._id}>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(ts.date)}</TableCell>
                      <TableCell>
                        <p className="text-gray-900">{ts.taskId?.title ?? '—'}</p>
                        {ts.taskId?.projectId?.name && <p className="text-xs text-muted-foreground">{ts.taskId.projectId.name}</p>}
                      </TableCell>
                      <TableCell className="text-right font-medium tabular-nums text-gray-900">{ts.hours}h</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={2} className="font-semibold text-gray-900">Total</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-gray-900">{totalHours.toFixed(1)}h</TableCell>
                  </TableRow>
                </TableFooter>
              </Table>
            )}
          </Card>
        )}

        {/* SALARY */}
        {tab === 'Salary' && isSalary && (
          <Card>
            <CardHeader>
              <div>
                <CardTitle>Salary payouts</CardTitle>
                <CardDescription>Auto-generated on day {data.salaryDay ?? '—'} monthly</CardDescription>
              </div>
              <CardAction>
                <Button variant="outline" size="sm" onClick={generateSalary}>
                  <RotateCcw /> Generate due payouts
                </Button>
              </CardAction>
            </CardHeader>
            {salaryPayouts.length === 0 ? (
              <p className="px-5 pb-5 text-sm text-muted-foreground">No payouts yet</p>
            ) : (
              <div className="divide-y divide-gray-100 border-t border-gray-100">
                {salaryPayouts.map(p => (
                  <div key={p.id ?? p._id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3.5">
                    <div>
                      <p className="text-sm font-medium text-gray-900">{p.period}</p>
                      <p className="text-xs text-muted-foreground">{p.status === 'PAID' ? `Paid · ${fmtDate(p.approvedAt)}` : p.status}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <p className="text-sm font-semibold tabular-nums text-gray-900">{fmtMoney(p.amount, p.currency)}</p>
                      {p.status === 'PENDING' ? (
                        <div className="flex items-center gap-2">
                          <Link href="/admin/accounts?tab=requests"
                            className={buttonVariants({ variant: 'outline', size: 'xs' })}>Approve in expenses</Link>
                          <Button variant="outline" size="xs" onClick={() => payoutAction(p, 'cancel')}
                            className="text-red-600 hover:text-red-700">Cancel</Button>
                        </div>
                      ) : (
                        <Badge status={p.status} />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </Card>
        )}
      </div>

      <FreelancerModal
        open={editOpen}
        onOpenChange={setEditOpen}
        freelancer={data}
        onSaved={() => { toast.success('Freelancer updated'); load() }}
      />
    </div>
  )
}
