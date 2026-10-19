'use client'

import { useState, useEffect } from 'react'
import { toast } from 'react-hot-toast'
import { Clock, Hourglass, CheckCircle2, FolderOpen } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'
import PageHeader from '@/components/ui/PageHeader'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import EmptyState from '@/components/ui/EmptyState'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

// Render a per-currency totals array (from the dashboard API) as "৳5,000 · $120".
function moneyByCurrency(totals) {
  if (!totals || totals.length === 0) return formatCurrency(0)
  return totals.map(t => formatCurrency(t.total, t.currency)).join('  ·  ')
}

const ASSIGNMENT_STATUS_VARIANT = {
  ASSIGNED:    'primary',
  ACCEPTED:    'teal',
  IN_PROGRESS: 'purple',
  COMPLETED:   'success',
  CANCELLED:   'danger',
}

const PAYMENT_STATUS_LABEL = {
  PENDING:            { label: 'Not requested',    variant: 'default' },
  PAYMENT_REQUESTED:  { label: 'Awaiting payment', variant: 'warning' },
  PAID:               { label: 'Paid',             variant: 'success' },
  NOT_REQUIRED:       { label: 'Salary',           variant: 'indigo' },
}

const VENTURE_VARIANT = {
  ENSTUDIO: 'purple',
  ENTECH:   'primary',
  ENMARK:   'success',
}

const humanize = (s) => {
  const t = String(s).replace(/_/g, ' ').toLowerCase()
  return t.charAt(0).toUpperCase() + t.slice(1)
}

// Merge several per-currency totals arrays, summing entries in the same currency.
function mergeTotals(...lists) {
  const map = new Map()
  for (const list of lists) {
    for (const t of list ?? []) map.set(t.currency, (map.get(t.currency) ?? 0) + (Number(t.total) || 0))
  }
  return [...map.entries()].map(([currency, total]) => ({ currency, total }))
}

function SummaryCard({ label, hint, totals, icon: Icon, tint }) {
  return (
    <Card className="p-5" title={hint}>
      <div className="flex items-center justify-between gap-3">
        <p className="truncate text-[13px] font-medium text-muted-foreground">{label}</p>
        <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-gray-200/80 bg-white shadow-xs">
          <Icon className={`size-4 ${tint}`} />
        </div>
      </div>
      <p className="mt-2 break-words text-2xl font-semibold tracking-tight text-gray-900 tabular-nums">{moneyByCurrency(totals)}</p>
    </Card>
  )
}

export default function FreelancerDashboard() {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)
  const [acting,  setActing]  = useState(null)

  async function load() {
    try {
      const res  = await fetch('/api/freelancer/dashboard')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setData(json.data)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function actOn(assignmentId, action, successMsg) {
    setActing(assignmentId + action)
    try {
      const res  = await fetch(`/api/freelancer-assignments/${assignmentId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success(successMsg)
      load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setActing(null)
    }
  }

  if (loading) return <PageLoader />
  if (!data) return null

  const { freelancer, assignments, salaryPayouts = [], summary } = data

  return (
    <div className="space-y-6">
      <PageHeader
        title="Dashboard"
        description={`Welcome back, ${freelancer.userId?.name ?? 'Freelancer'}`}
      />

      {/* Three money buckets */}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <SummaryCard
          label="In progress"
          hint="Accepted, not delivered yet"
          totals={summary.accepted.totals}
          icon={Hourglass}
          tint="text-violet-600"
        />
        <SummaryCard
          label="Awaiting payment"
          hint="Delivered, not paid yet"
          totals={mergeTotals(summary.awaitingPayment.totals, summary.salaryPending?.totals)}
          icon={Clock}
          tint="text-amber-600"
        />
        <SummaryCard
          label="Total paid"
          hint="Settled to date"
          totals={mergeTotals(summary.paid.totals, summary.salaryPaid?.totals)}
          icon={CheckCircle2}
          tint="text-emerald-600"
        />
      </div>

      {/* Engagements */}
      <Card className="overflow-hidden">
        <CardHeader className="border-b border-gray-100">
          <CardTitle>Engagements</CardTitle>
        </CardHeader>

        {assignments.length === 0 ? (
          <EmptyState icon={FolderOpen} title="No engagements yet" />
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Project</TableHead>
                    <TableHead>Venture</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Stage</TableHead>
                    <TableHead>Payment</TableHead>
                    <TableHead className="w-24"><span className="sr-only">Action</span></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {assignments.map(a => {
                    const id = a.id ?? a._id
                    const pay = PAYMENT_STATUS_LABEL[a.paymentStatus] ?? PAYMENT_STATUS_LABEL.PENDING
                    return (
                      <TableRow key={id}>
                        <TableCell>
                          <p className="font-medium text-gray-900">{a.projectId?.name ?? '—'}</p>
                          {a.projectId?.projectCode && (
                            <p className="mt-0.5 font-mono text-xs text-muted-foreground">{a.projectId.projectCode}</p>
                          )}
                        </TableCell>
                        <TableCell>
                          {a.projectId?.venture
                            ? <Badge variant={VENTURE_VARIANT[a.projectId.venture] ?? 'default'}>{a.projectId.venture}</Badge>
                            : <span className="text-gray-300">—</span>}
                        </TableCell>
                        <TableCell className="text-right font-medium tabular-nums text-gray-900">
                          {a.paymentAmount ? formatCurrency(a.paymentAmount, a.currency) : <span className="text-gray-400">—</span>}
                        </TableCell>
                        <TableCell>
                          <Badge variant={ASSIGNMENT_STATUS_VARIANT[a.status] ?? 'default'}>{humanize(a.status)}</Badge>
                        </TableCell>
                        <TableCell><Badge variant={pay.variant}>{pay.label}</Badge></TableCell>
                        <TableCell className="text-right">
                          {a.status === 'ASSIGNED' && (
                            <Button size="xs" onClick={() => actOn(id, 'accept', 'Engagement accepted')} loading={acting === id + 'accept'}>
                              Accept
                            </Button>
                          )}
                          {a.status === 'ACCEPTED' && (
                            <Button size="xs" variant="outline" onClick={() => actOn(id, 'start', 'Marked in progress')} loading={acting === id + 'start'}>
                              Start
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            </div>

            {/* Mobile cards */}
            <div className="divide-y divide-gray-100 md:hidden">
              {assignments.map(a => {
                const id = a.id ?? a._id
                const pay = PAYMENT_STATUS_LABEL[a.paymentStatus] ?? PAYMENT_STATUS_LABEL.PENDING
                return (
                  <div key={id} className="space-y-3 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="text-sm font-medium text-gray-900">{a.projectId?.name ?? '—'}</p>
                        {a.projectId?.projectCode && (
                          <p className="mt-0.5 font-mono text-xs text-muted-foreground">{a.projectId.projectCode}</p>
                        )}
                      </div>
                      <p className="shrink-0 text-sm font-semibold tabular-nums text-gray-900">
                        {a.paymentAmount ? formatCurrency(a.paymentAmount, a.currency) : '—'}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge variant={ASSIGNMENT_STATUS_VARIANT[a.status] ?? 'default'}>{humanize(a.status)}</Badge>
                      <Badge variant={pay.variant}>{pay.label}</Badge>
                    </div>
                    {a.status === 'ASSIGNED' && (
                      <Button size="sm" className="w-full" onClick={() => actOn(id, 'accept', 'Engagement accepted')} loading={acting === id + 'accept'}>
                        Accept
                      </Button>
                    )}
                    {a.status === 'ACCEPTED' && (
                      <Button size="sm" variant="outline" className="w-full" onClick={() => actOn(id, 'start', 'Marked in progress')} loading={acting === id + 'start'}>
                        Start
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </Card>

      {/* Salary payouts */}
      {salaryPayouts.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-gray-100">
            <CardTitle>Salary payouts</CardTitle>
          </CardHeader>
          <Table className="min-w-[420px]">
            <TableHeader>
              <TableRow>
                <TableHead>Period</TableHead>
                <TableHead className="text-right">Amount</TableHead>
                <TableHead>Status</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {salaryPayouts.map(p => (
                <TableRow key={p.id ?? p._id}>
                  <TableCell>{p.period}</TableCell>
                  <TableCell className="text-right font-medium tabular-nums text-gray-900">{formatCurrency(p.amount, p.currency)}</TableCell>
                  <TableCell>
                    <Badge variant={p.status === 'PAID' ? 'success' : p.status === 'CANCELLED' ? 'danger' : 'warning'}>
                      {humanize(p.status)}
                    </Badge>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  )
}
