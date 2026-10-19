'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import {
  TrendingUp, Briefcase, AlertTriangle,
  ArrowUpRight, ArrowDownRight, ChevronLeft, Plus, X,
  CheckCircle2, Wallet, Flag, Circle, Activity, ShieldAlert, Zap,
  FolderKanban, ListTodo, Users,
} from 'lucide-react'
import {
  ComposedChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Line,
} from 'recharts'
import { cn } from '@/lib/utils'
import Button, { buttonVariants } from '@/components/ui/Button'
import { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent } from '@/components/ui/Card'
import PageHeader from '@/components/ui/PageHeader'
import StatsCard from '@/components/ui/StatsCard'
import Badge from '@/components/ui/Badge'
import Tabs from '@/components/ui/Tabs'
import EmptyState from '@/components/ui/EmptyState'
import LoadingSpinner, { PageLoader } from '@/components/ui/LoadingSpinner'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt  = (n) => n == null ? '—' : `৳ ${Number(n).toLocaleString('en-BD', { maximumFractionDigits: 0 })}`
// Full number with thousands separators (no K/M abbreviation — its rounding hid small changes like a 100 expense)
const fmtK = (n) => n == null ? '—' : `৳ ${Number(n).toLocaleString('en-BD', { maximumFractionDigits: 0 })}`
const fmtDate  = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—'
const daysLeft = (d) => d ? Math.ceil((new Date(d) - new Date()) / 86400000) : null
// "IN_PROGRESS" → "In progress" (display only)
const humanize = (s) => s ? (s.charAt(0) + s.slice(1).toLowerCase()).replace(/_/g, ' ') : ''

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const getMonthLabel = (offset = 0) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - offset); return `${MONTHS[d.getMonth()]} ${d.getFullYear()}` }
const getDrillKey   = (offset = 0) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - offset); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` }

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

// Chart palette (zinc + brand)
const C = {
  brand:  '#2157E0',
  ink:    '#18181b', // zinc-900
  muted:  '#a1a1aa', // zinc-400
  grid:   '#f4f4f5', // zinc-100
  axis:   '#71717a', // zinc-500
  cursor: '#e4e4e7', // zinc-200
}

// ─── Trend badge ──────────────────────────────────────────────────────────────

function Trend({ change, invert = false }) {
  if (change == null) return null
  const up  = invert ? change < 0 : change > 0
  const neu = change === 0
  if (neu) return <span className="text-xs text-muted-foreground">No change</span>
  return (
    <span className={cn('inline-flex items-center gap-0.5 text-xs font-medium tabular-nums', up ? 'text-emerald-600' : 'text-red-600')}>
      {up ? <ArrowUpRight className="size-3.5" /> : <ArrowDownRight className="size-3.5" />}
      {Math.abs(change)}%
    </span>
  )
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ title, value, sub, change, invert, icon, color, href }) {
  const hasChange = change != null && change !== 0
  const positive  = invert ? change < 0 : change > 0
  const label     = change === 0 ? (sub ? `No change · ${sub}` : 'No change') : sub
  return (
    <StatsCard
      title={title}
      value={value}
      icon={icon}
      color={color}
      href={href}
      change={hasChange ? `${Math.abs(change)}%` : undefined}
      positive={positive}
      changeLabel={label}
    />
  )
}

// ─── Custom chart tooltip ─────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="min-w-[150px] rounded-lg border border-gray-200/80 bg-white px-3 py-2 text-xs shadow-lg">
      <p className="mb-1.5 font-medium text-gray-900">{label}</p>
      {payload.map(p => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4 py-0.5">
          <div className="flex items-center gap-1.5">
            <span className="size-2 shrink-0 rounded-[2px]" style={{ backgroundColor: p.color }} />
            <span className="text-muted-foreground">{p.name}</span>
          </div>
          <span className="font-medium tabular-nums text-gray-900">{fmtK(p.value)}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Card section wrapper ─────────────────────────────────────────────────────

function Section({ title, meta, href, action, children, contentClassName }) {
  return (
    <Card>
      <CardHeader>
        <div className="min-w-0">
          <CardTitle>{title}</CardTitle>
          {meta && <CardDescription>{meta}</CardDescription>}
        </div>
        {href && (
          <CardAction>
            <Link href={href} className={cn(buttonVariants({ variant: 'ghost', size: 'xs' }), '-mr-1.5 -mt-1 text-muted-foreground')}>
              {action ?? 'View all'} <ArrowUpRight className="size-3.5" />
            </Link>
          </CardAction>
        )}
      </CardHeader>
      <CardContent className={contentClassName}>{children}</CardContent>
    </Card>
  )
}

// ─── Calendar drill-down ──────────────────────────────────────────────────────

function CalendarDrillDown({ drillKey, onClose }) {
  const [data, setData]       = useState(null)
  const [loading, setLoading] = useState(true)
  const [yr, mo]              = drillKey.split('-').map(Number)
  const label                 = `${MONTHS[mo - 1]} ${yr}`
  const daysInMonth           = new Date(yr, mo, 0).getDate()

  useEffect(() => {
    // Ignore responses for a month that's no longer selected (out-of-order replies)
    const ctrl = new AbortController()
    setLoading(true)
    fetch(`/api/dashboard/stats?drillMonth=${drillKey}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then(j => { if (!ctrl.signal.aborted) { setData(j.data?.dailyData ?? []); setLoading(false) } })
      .catch(() => { if (!ctrl.signal.aborted) setLoading(false) })
    return () => ctrl.abort()
  }, [drillKey])

  const income  = data?.reduce((s, r) => s + r.income,  0) ?? 0
  const expense = data?.reduce((s, r) => s + r.expense, 0) ?? 0

  return (
    <Card className="overflow-hidden">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-gray-100 px-5 py-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" onClick={onClose} className="-ml-1.5" aria-label="Close daily view">
            <ChevronLeft />
          </Button>
          <span className="text-sm font-semibold text-gray-900">{label}</span>
          <span className="text-[13px] text-muted-foreground">Daily</span>
        </div>
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span>Income <span className="ml-1 font-medium tabular-nums text-emerald-600">{fmt(income)}</span></span>
          <span>Expense <span className="ml-1 font-medium tabular-nums text-red-600">{fmt(expense)}</span></span>
          <span>Net <span className={cn('ml-1 font-medium tabular-nums', income - expense >= 0 ? 'text-gray-900' : 'text-red-600')}>{fmt(income - expense)}</span></span>
        </div>
      </div>
      {loading ? (
        <div className="flex justify-center py-10">
          <LoadingSpinner size="sm" />
        </div>
      ) : (
        <Table className="min-w-[520px]">
          <TableHeader>
            <TableRow>
              {['Day', 'Income', 'Expense', 'Net', 'Tx'].map(h => (
                <TableHead key={h} className={h === 'Day' ? 'px-5' : 'px-5 text-right'}>{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data ?? []).map(row => (
              <TableRow key={row.day} className={row.txCount > 0 ? '' : 'opacity-40 hover:bg-transparent'}>
                <TableCell className="px-5 py-2 font-medium text-gray-900">{String(row.day).padStart(2, '0')} {MONTHS[mo - 1].slice(0, 3)}</TableCell>
                <TableCell className="px-5 py-2 text-right tabular-nums text-emerald-600">{row.income > 0 ? fmt(row.income) : '—'}</TableCell>
                <TableCell className="px-5 py-2 text-right tabular-nums text-red-600">{row.expense > 0 ? fmt(row.expense) : '—'}</TableCell>
                <TableCell className={cn('px-5 py-2 text-right font-medium tabular-nums', row.profit > 0 ? 'text-gray-900' : row.profit < 0 ? 'text-red-600' : 'text-gray-300')}>
                  {row.txCount > 0 ? fmt(row.profit) : '—'}
                </TableCell>
                <TableCell className="px-5 py-2 text-right tabular-nums text-muted-foreground">{row.txCount > 0 ? row.txCount : '—'}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </Card>
  )
}

// ─── Status configs ───────────────────────────────────────────────────────────

const STATUS_VARIANT = {
  PENDING:     'default',
  IN_PROGRESS: 'primary',
  IN_REVIEW:   'purple',
  REVISION:    'warning',
  ACTIVE:      'success',
  ON_HOLD:     'warning',
  CANCELLED:   'danger',
}

const PRIORITY_DOT = {
  LOW:    'bg-gray-400',
  MEDIUM: 'bg-blue-500',
  HIGH:   'bg-orange-500',
  URGENT: 'bg-red-500',
}

const LEAD_DOT = {
  NEW:           'bg-gray-400',
  CONTACTED:     'bg-blue-500',
  PROPOSAL_SENT: 'bg-violet-500',
  NEGOTIATION:   'bg-amber-500',
  WON:           'bg-emerald-500',
  LOST:          'bg-red-400',
}

const LEAD_LABEL = {
  NEW: 'New', CONTACTED: 'Contacted', PROPOSAL_SENT: 'Proposal',
  NEGOTIATION: 'Negotiation', WON: 'Won', LOST: 'Lost',
}

// ─── Smart alerts ─────────────────────────────────────────────────────────────

function SmartAlerts({ items }) {
  const [dismissed, setDismissed] = useState([])
  const visible = items.filter((_, i) => !dismissed.includes(i))
  if (!visible.length) return null

  const STYLE = {
    error:   'border-red-200 bg-red-50 text-red-800',
    warning: 'border-amber-200 bg-amber-50 text-amber-800',
    info:    'border-blue-200 bg-blue-50 text-blue-800',
  }
  const ICON = { error: ShieldAlert, warning: AlertTriangle, info: Zap }

  return (
    <div className="space-y-2">
      {visible.map((ins, vi) => {
        const realIdx = items.indexOf(ins)
        const Icon    = ICON[ins.type] ?? Zap
        return (
          <div key={vi} className={cn('flex items-center gap-2.5 rounded-lg border px-3 py-2.5 text-sm', STYLE[ins.type] ?? STYLE.info)}>
            <Icon className="size-4 shrink-0" />
            <span className="flex-1">{ins.message}</span>
            {ins.link && (
              <Link href={ins.link} className="shrink-0 text-[13px] font-medium underline-offset-4 hover:underline">
                View
              </Link>
            )}
            <button
              type="button"
              onClick={() => setDismissed(d => [...d, realIdx])}
              className="-mr-1 shrink-0 rounded-md p-1 opacity-60 transition-opacity hover:opacity-100"
              aria-label="Dismiss"
            >
              <X className="size-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}

// ─── Revenue chart ────────────────────────────────────────────────────────────

const SERIES = [
  { key: 'revenue', label: 'Revenue',    color: C.brand },
  { key: 'expense', label: 'Expense',    color: C.muted },
  { key: 'profit',  label: 'Net profit', color: C.ink, dashed: true },
]

function RevenueChart({ data, onDrill }) {
  return (
    <div title="Click a month for the daily breakdown">
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}
          onClick={s => { const key = s?.activePayload?.[0]?.payload?.key; if (key) onDrill?.(key) }}
          className="cursor-pointer">
          <defs>
            <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={C.brand} stopOpacity={0.14} />
              <stop offset="100%" stopColor={C.brand} stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gExp" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor={C.muted} stopOpacity={0.14} />
              <stop offset="100%" stopColor={C.muted} stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={C.grid} vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: C.axis }} axisLine={false} tickLine={false} tickMargin={8} />
          <YAxis tick={{ fontSize: 11, fill: C.axis }} axisLine={false} tickLine={false} tickFormatter={v => Number(v).toLocaleString('en-BD')} width={64} />
          <Tooltip content={<ChartTooltip />} cursor={{ stroke: C.cursor, strokeWidth: 1 }} />
          <Area dataKey="revenue" name="Revenue" type="monotone" stroke={C.brand} strokeWidth={2}
            fill="url(#gRev)" dot={false} activeDot={{ r: 3.5, fill: C.brand, strokeWidth: 0 }} />
          <Area dataKey="expense" name="Expense" type="monotone" stroke={C.muted} strokeWidth={1.75}
            fill="url(#gExp)" dot={false} activeDot={{ r: 3.5, fill: C.muted, strokeWidth: 0 }} />
          <Line dataKey="profit" name="Net profit" type="monotone" stroke={C.ink} strokeWidth={1.5}
            dot={false} activeDot={{ r: 3.5, fill: C.ink, strokeWidth: 0 }} strokeDasharray="4 3" />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="mt-3 flex flex-wrap items-center justify-end gap-4">
        {SERIES.map(s => (
          <div key={s.key} className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <span className="size-2 rounded-[2px]" style={{ backgroundColor: s.color }} />
            {s.label}
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Lead pipeline ────────────────────────────────────────────────────────────

function LeadPipeline({ pipeline }) {
  const statuses  = ['NEW','CONTACTED','PROPOSAL_SENT','NEGOTIATION','WON','LOST']
  const maxCount  = Math.max(1, ...statuses.map(s => pipeline[s]?.count ?? 0))
  return (
    <div className="space-y-3.5">
      {statuses.map(s => {
        const d   = pipeline[s] ?? { count: 0, value: 0 }
        const pct = Math.round((d.count / maxCount) * 100)
        return (
          <div key={s}>
            <div className="mb-1.5 flex items-center justify-between text-[13px]">
              <div className="flex items-center gap-2">
                <span className={cn('size-1.5 shrink-0 rounded-full', LEAD_DOT[s])} />
                <span className="text-gray-700">{LEAD_LABEL[s]}</span>
              </div>
              <div className="flex items-center gap-2.5 tabular-nums">
                {d.value > 0 && <span className="text-xs text-muted-foreground">{fmtK(d.value)}</span>}
                <span className="font-medium text-gray-900">{d.count}</span>
              </div>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
              <div className="h-full rounded-full bg-gray-900 transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Projects list ────────────────────────────────────────────────────────────

function ProjectsList({ projects }) {
  if (!projects?.length) return <EmptyState icon={FolderKanban} title="No active projects" className="py-8" />
  return (
    <div className="-my-2 divide-y divide-gray-100">
      {projects.map(p => {
        const budget     = p.budget ?? 0
        const paid       = p.paidAmount ?? 0
        const pct        = budget > 0 ? Math.min(100, Math.round((paid / budget) * 100)) : 0
        const dl         = daysLeft(p.deadline ?? p.currentPeriodEnd)
        const dlLabel    = dl == null ? null : dl < 0 ? `${Math.abs(dl)}d overdue` : dl === 0 ? 'Due today' : `${dl}d left`
        const dlColor    = dl == null ? '' : dl < 0 ? 'text-red-600' : dl <= 3 ? 'text-amber-600' : 'text-muted-foreground'
        const clientName = p.clientId?.userId?.name ?? '—'
        const dotColor   = p.venture === 'ENSTUDIO' ? 'bg-violet-500' : p.venture === 'ENTECH' ? 'bg-blue-500' : 'bg-emerald-500'
        return (
          <Link key={p._id} href={`/admin/projects/${p._id}`}
            className="group -mx-2 flex items-start gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-gray-50/70">
            <span className={cn('mt-[7px] size-1.5 shrink-0 rounded-full', dotColor)} title={p.venture} />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <p className="truncate text-sm font-medium text-gray-900">{p.name}</p>
                {p.status && <Badge variant={STATUS_VARIANT[p.status] ?? 'default'} className="shrink-0">{humanize(p.status)}</Badge>}
              </div>
              <p className="mt-0.5 truncate text-xs text-muted-foreground">{clientName}{p.projectCode && ` · ${p.projectCode}`}</p>
              {budget > 0 && (
                <div className="mt-2 flex items-center gap-2">
                  <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-gray-100">
                    <div className={cn('h-full rounded-full transition-all', pct >= 100 ? 'bg-emerald-500' : pct >= 60 ? 'bg-gray-900' : 'bg-gray-400')}
                      style={{ width: `${pct}%` }} />
                  </div>
                  <span className="w-8 shrink-0 text-right text-xs tabular-nums text-muted-foreground">{pct}%</span>
                </div>
              )}
            </div>
            {dlLabel && <span className={cn('mt-0.5 shrink-0 text-xs font-medium', dlColor)}>{dlLabel}</span>}
          </Link>
        )
      })}
    </div>
  )
}

// ─── Tasks list ───────────────────────────────────────────────────────────────

function TasksList({ tasks }) {
  if (!tasks?.length) return <EmptyState icon={ListTodo} title="No upcoming tasks" className="py-8" />
  return (
    <div className="-my-2 divide-y divide-gray-100">
      {tasks.map(t => {
        const dl      = daysLeft(t.dueDate)
        const dlLabel = dl == null ? '—' : dl < 0 ? `${Math.abs(dl)}d late` : dl === 0 ? 'Today' : fmtDate(t.dueDate)
        const dlColor = dl == null ? 'text-gray-300' : dl < 0 ? 'text-red-600' : dl === 0 ? 'text-amber-600' : 'text-muted-foreground'
        return (
          <div key={t._id} className="flex items-center gap-3 py-3">
            <Circle className="size-4 shrink-0 text-gray-300" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-gray-900">{t.title}</p>
              <p className="truncate text-xs text-muted-foreground">{t.projectId?.name ?? 'No project'}</p>
            </div>
            <div className="flex shrink-0 items-center gap-3">
              <div className="flex items-center gap-1.5">
                <span className={cn('size-1.5 rounded-full', PRIORITY_DOT[t.priority] ?? 'bg-gray-400')} />
                <span className="text-xs text-gray-600">{humanize(t.priority)}</span>
              </div>
              <span className={cn('w-16 text-right text-xs font-medium tabular-nums', dlColor)}>{dlLabel}</span>
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Finance summary ──────────────────────────────────────────────────────────

function FinanceSummary({ financials, invoices, pendingWithdrawals }) {
  const f   = financials ?? {}
  const inv = invoices ?? {}
  return (
    <div className="space-y-4">
      {/* Monthly */}
      <div className="space-y-2.5">
        {[
          { label: 'Revenue',    value: fmt(f.income?.value),  color: 'text-gray-900', change: f.income?.change },
          { label: 'Expense',    value: fmt(f.expense?.value), color: 'text-gray-900', change: f.expense?.change, invert: true },
          { label: 'Net profit', value: fmt(f.profit?.value),  color: (f.profit?.value ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600', change: f.profit?.change },
        ].map(r => (
          <div key={r.label} className="flex items-center justify-between">
            <span className="text-[13px] text-muted-foreground">{r.label}</span>
            <div className="flex items-center gap-2">
              <Trend change={r.change} invert={r.invert} />
              <span className={cn('text-sm font-semibold tabular-nums', r.color)}>{r.value}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="h-px bg-gray-100" />

      {/* Invoices */}
      <div>
        <p className="mb-2.5 text-xs font-medium text-muted-foreground">Invoices</p>
        <div className="space-y-2">
          {[
            { label: 'Paid',           key: 'PAID',           dot: 'bg-emerald-500' },
            { label: 'Sent',           key: 'SENT',           dot: 'bg-blue-500',   due: true },
            { label: 'Partially paid', key: 'PARTIALLY_PAID', dot: 'bg-amber-500',  due: true },
            { label: 'Overdue',        key: 'OVERDUE',        dot: 'bg-red-500',    due: true },
            { label: 'Draft',          key: 'DRAFT',          dot: 'bg-gray-400' },
          ].map(r => (
            <div key={r.key} className="flex items-center gap-2 text-[13px]">
              <span className={cn('size-1.5 shrink-0 rounded-full', r.dot)} />
              <span className="flex-1 text-gray-700">{r.label}</span>
              <span className="font-medium tabular-nums text-gray-900">{inv[r.key]?.count ?? 0}</span>
              <span className="w-24 text-right text-xs tabular-nums text-muted-foreground" title={r.due ? 'Outstanding' : undefined}>{fmtK((r.due ? inv[r.key]?.due : inv[r.key]?.total) ?? 0)}</span>
            </div>
          ))}
        </div>
      </div>

      {pendingWithdrawals > 0 && (
        <>
          <div className="h-px bg-gray-100" />
          <Link href="/admin/accounts" className="group flex items-center justify-between text-[13px]">
            <span className="text-muted-foreground group-hover:text-gray-900">Payouts awaiting approval</span>
            <Badge variant="warning">{pendingWithdrawals} pending</Badge>
          </Link>
        </>
      )}
    </div>
  )
}

// ─── Team summary ─────────────────────────────────────────────────────────────

function TeamSummary({ hr }) {
  if (!hr) return null
  const rows = [
    { label: 'Total employees', value: hr.total },
    { label: 'Active',          value: hr.active },
    { label: 'Present today',   value: hr.todayAttendance },
    { label: 'Pending leaves',  value: hr.pendingLeaves, warn: hr.pendingLeaves > 0 },
  ]
  return (
    <div className="space-y-2.5">
      {rows.map(({ label, value, warn }) => (
        <div key={label} className="flex items-center justify-between">
          <span className="text-[13px] text-muted-foreground">{label}</span>
          <span className={cn('text-sm font-semibold tabular-nums', warn ? 'text-amber-600' : 'text-gray-900')}>{value ?? '—'}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Ventures breakdown ───────────────────────────────────────────────────────

function VenturesPanel({ byVenture, total }) {
  if (!byVenture || !Object.keys(byVenture).length) return null
  const variant = { ENSTUDIO: 'purple', ENTECH: 'primary', ENMARK: 'success' }
  return (
    <div className="space-y-3.5">
      {Object.entries(byVenture).map(([venture, count]) => {
        const pct = Math.round((count / (total || 1)) * 100)
        return (
          <div key={venture}>
            <div className="mb-1.5 flex items-center justify-between text-[13px]">
              <Badge variant={variant[venture] ?? 'default'}>{venture}</Badge>
              <span className="font-medium tabular-nums text-gray-900">{count} <span className="font-normal text-muted-foreground">({pct}%)</span></span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
              <div className="h-full rounded-full bg-gray-900 transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Recent leads ─────────────────────────────────────────────────────────────

function RecentLeads({ leads }) {
  if (!leads?.length) return <EmptyState icon={Users} title="No leads yet" className="py-8" />
  return (
    <div className="-my-2 divide-y divide-gray-100">
      {leads.map(l => (
        <Link key={l._id} href="/admin/leads" className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-gray-50/70">
          <span className={cn('size-1.5 shrink-0 rounded-full', LEAD_DOT[l.status] ?? 'bg-gray-400')} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-medium text-gray-900">{l.name}</p>
            <p className="truncate text-xs text-muted-foreground">{l.company || l.source || '—'}</p>
          </div>
          <div className="shrink-0 text-right">
            {l.value > 0 && <p className="text-sm font-medium tabular-nums text-gray-900">{fmtK(l.value)}</p>}
            <p className="text-xs text-muted-foreground">{LEAD_LABEL[l.status] ?? l.status}</p>
          </div>
        </Link>
      ))}
    </div>
  )
}

// ─── Pending invoices ─────────────────────────────────────────────────────────

function PendingInvoices({ invoices }) {
  if (!invoices?.length) return <EmptyState icon={CheckCircle2} title="All invoices collected" className="py-8" />
  return (
    <div className="-my-2 divide-y divide-gray-100">
      {invoices.map(inv => {
        const dl        = daysLeft(inv.dueDate)
        const isOverdue = dl != null && dl < 0
        const clientName = inv.clientId?.userId?.name ?? '—'
        return (
          <Link key={inv._id} href={`/admin/invoices/${inv._id}`}
            className="-mx-2 flex items-center gap-3 rounded-lg px-2 py-3 transition-colors hover:bg-gray-50/70">
            <span className={cn('size-1.5 shrink-0 rounded-full', isOverdue ? 'bg-red-500' : 'bg-amber-400')} />
            <div className="min-w-0 flex-1">
              <p className="font-mono text-[13px] font-medium text-gray-900">{inv.invoiceNumber ?? '—'}</p>
              <p className="truncate text-xs text-muted-foreground">{clientName}</p>
            </div>
            <div className="shrink-0 text-right">
              <p className="text-sm font-medium tabular-nums text-gray-900">{fmtK(inv.due ?? inv.total)}</p>
              <p className={cn('text-xs', isOverdue ? 'font-medium text-red-600' : 'text-muted-foreground')}>
                {dl == null ? '—' : dl < 0 ? `${Math.abs(dl)}d overdue` : dl === 0 ? 'Due today' : `Due ${fmtDate(inv.dueDate)}`}
              </p>
            </div>
          </Link>
        )
      })}
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function DashboardPage() {
  const { data: session }       = useSession()
  const [stats,    setStats]    = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [drillKey, setDrillKey] = useState(null)
  const [error,    setError]    = useState(null)

  const monthOptions = Array.from({ length: 6 }, (_, i) => ({ key: getDrillKey(i), label: getMonthLabel(i) }))

  useEffect(() => {
    fetch('/api/dashboard/stats')
      .then(async r => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(r.status === 403 ? 'You do not have access to the dashboard.' : (j.error || 'Could not load dashboard'))
        setStats(j.data ?? null)
      })
      .catch(e => setError(e.message || 'Could not load dashboard'))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return <PageLoader />

  if (error) return (
    <EmptyState icon={AlertTriangle} title={error} className="min-h-[400px]" />
  )

  // Blocks the viewer lacks permission for come back as null — hide them.
  const show = {
    finance:  !!stats?.financials,
    invoices: !!stats?.invoices,
    invoiceList: Array.isArray(stats?.recentInvoices),
    projects: !!stats?.projects,
    tasks:    !!stats?.tasks,
    leads:    !!stats?.leads,
    hr:       !!stats?.hr,
  }

  const f       = stats?.financials ?? {}
  const inv     = stats?.invoices   ?? {}
  const proj    = stats?.projects   ?? {}
  const tasks   = stats?.tasks      ?? {}
  const leads   = stats?.leads      ?? {}
  const hr      = stats?.hr         ?? {}

  // Smart alerts
  const alerts = []
  const overdueCount = inv.OVERDUE?.count ?? 0
  const overdueTotal = inv.OVERDUE?.due ?? 0
  if (overdueCount > 0)
    alerts.push({ type: 'error',   message: `${overdueCount} overdue invoice${overdueCount !== 1 ? 's' : ''} — ${fmtK(overdueTotal)} outstanding`, link: '/admin/invoices?status=OVERDUE' })
  if (tasks.overdue > 0)
    alerts.push({ type: 'warning', message: `${tasks.overdue} task${tasks.overdue !== 1 ? 's' : ''} past deadline`, link: '/admin/tasks' })
  if ((stats?.pendingWithdrawals ?? 0) > 0)
    alerts.push({ type: 'info',    message: `${stats.pendingWithdrawals} freelancer payment${stats.pendingWithdrawals !== 1 ? 's' : ''} awaiting approval`, link: '/admin/accounts' })
  const critProj = proj.dueSoon ?? 0
  if (critProj > 0)
    alerts.push({ type: 'warning', message: `${critProj} project${critProj !== 1 ? 's' : ''} due within 3 days`, link: '/admin/projects' })

  // KPI data
  const paidInvCount = inv.PAID?.count ?? 0
  const paidInvTotal = inv.PAID?.total ?? 0
  const OPEN_STATUSES = ['SENT', 'PARTIALLY_PAID', 'OVERDUE']
  const sentCount    = OPEN_STATUSES.reduce((n, k) => n + (inv[k]?.count ?? 0), 0)
  const sentTotal    = OPEN_STATUSES.reduce((n, k) => n + (inv[k]?.due   ?? 0), 0)

  const kpis = [
    {
      title: 'Monthly revenue', value: fmtK(f.income?.value),
      sub: `vs ${fmtK(f.income?.prevValue)} last mo`, change: f.income?.change,
      icon: TrendingUp, color: 'gray',
      href: '/admin/accounts?tab=income', show: show.finance,
    },
    {
      title: 'Net profit', value: fmtK(f.profit?.value),
      sub: `Margin ${f.grossMargin?.value ?? 0}%`, change: f.profit?.change,
      icon: Wallet, color: 'gray',
      href: '/admin/accounts', show: show.finance,
    },
    {
      title: 'Paid invoices', value: paidInvCount,
      sub: `${fmtK(paidInvTotal)} collected`,
      icon: CheckCircle2, color: 'gray',
      href: '/admin/invoices?status=PAID', show: show.invoices,
    },
    {
      title: 'Pending / overdue', value: sentCount,
      sub: `${fmtK(sentTotal)} outstanding`,
      icon: AlertTriangle, color: overdueCount > 0 ? 'red' : 'gray',
      href: '/admin/invoices', show: show.invoices,
    },
    {
      title: 'Active projects', value: proj.active ?? 0,
      sub: `${proj.total ?? 0} total`,
      icon: Briefcase, color: 'gray',
      href: '/admin/projects', show: show.projects,
    },
    {
      title: 'Open tasks', value: tasks.open ?? 0,
      sub: tasks.overdue > 0 ? `${tasks.overdue} overdue` : `${tasks.completedThisMonth ?? 0} done this mo`,
      icon: tasks.overdue > 0 ? Flag : Activity,
      color: tasks.overdue > 0 ? 'red' : 'gray',
      href: '/admin/tasks', show: show.tasks,
    },
  ].filter(k => k.show)

  // Chart data
  const chartData = (stats?.revenueVsProfit ?? []).map((r, i) => ({
    ...r,
    expense: stats?.expenseTrend?.[i]?.expense ?? 0,
  }))

  const firstName = session?.user?.name ? session.user.name.split(' ')[0] : ''
  const today     = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric' })

  return (
    <div className="space-y-6">

      {/* ── Header ── */}
      <PageHeader
        title="Dashboard"
        description={`${greeting()}${firstName ? `, ${firstName}` : ''} · ${today}`}
        actions={
          <>
            {[
              { label: 'New client',  href: '/admin/clients' },
              { label: 'New project', href: '/admin/projects/new' },
              { label: 'New invoice', href: '/admin/invoices/new' },
              { label: 'New lead',    href: '/admin/leads' },
            ].map(({ label, href }) => (
              <Link key={label} href={href} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                <Plus /> {label}
              </Link>
            ))}
          </>
        }
      />

      {/* ── Alerts ── */}
      <SmartAlerts items={alerts} />

      {/* ── KPI grid ── */}
      {kpis.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {kpis.map(k => <KpiCard key={k.title} {...k} />)}
        </div>
      )}

      {/* ── Period chips ── */}
      {show.finance && (
        <div className="flex flex-wrap items-center gap-3">
          <span className="text-[13px] text-muted-foreground">Daily breakdown</span>
          <Tabs
            size="sm"
            value={drillKey}
            onChange={key => setDrillKey(prev => prev === key ? null : key)}
            tabs={monthOptions.map(m => ({ value: m.key, label: m.label }))}
          />
        </div>
      )}

      {/* ── Drill-down ── */}
      {show.finance && drillKey && <CalendarDrillDown drillKey={drillKey} onClose={() => setDrillKey(null)} />}

      {/* ── Main grid ── */}
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">

        {/* Left — 2/3 */}
        <div className="space-y-4 xl:col-span-2">

          {/* Revenue chart */}
          {show.finance && (
            <Section title="Revenue & profit" meta="Last 6 months" href="/admin/accounts" action="Accounts">
              <RevenueChart data={chartData} onDrill={key => setDrillKey(prev => prev === key ? null : key)} />
            </Section>
          )}

          {/* Active projects */}
          {show.projects && (
            <Section title="Active projects" meta={`${proj.active ?? 0} in progress`} href="/admin/projects">
              <ProjectsList projects={stats?.recentProjects ?? []} />
            </Section>
          )}

          {/* Tasks */}
          {show.tasks && (
            <Section
              title="Upcoming tasks"
              meta={tasks.overdue > 0 ? `${tasks.overdue} overdue` : undefined}
              href="/admin/tasks"
            >
              <TasksList tasks={stats?.upcomingTasks ?? []} />
            </Section>
          )}

        </div>

        {/* Right — 1/3 */}
        <div className="space-y-4">

          {/* Lead pipeline */}
          {show.leads && (
            <Section title="Lead pipeline" meta={`${leads.total ?? 0} total`} href="/admin/leads">
              <LeadPipeline pipeline={leads.pipeline ?? {}} />
              {(leads.newThisMonth ?? 0) > 0 && (
                <p className="mt-4 text-xs font-medium text-emerald-600">
                  +{leads.newThisMonth} new this month
                </p>
              )}
            </Section>
          )}

          {/* Finance summary */}
          {show.finance && (
            <Section title="Finance" meta="This month" href="/admin/accounts">
              <FinanceSummary financials={f} invoices={inv} pendingWithdrawals={stats?.pendingWithdrawals} />
            </Section>
          )}

          {/* Team */}
          {show.hr && (
            <Section title="Team" href="/admin/employees">
              <TeamSummary hr={hr} />
            </Section>
          )}

          {/* Ventures */}
          {proj.byVenture && Object.keys(proj.byVenture).length > 0 && (
            <Section title="Projects by venture">
              <VenturesPanel byVenture={proj.byVenture} total={proj.total} />
            </Section>
          )}

        </div>
      </div>

      {/* ── Bottom row ── */}
      {(show.leads || show.invoiceList) && (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

          {show.leads && (
            <Section title="Recent leads" meta={leads.newThisMonth > 0 ? `${leads.newThisMonth} this month` : undefined} href="/admin/leads">
              <RecentLeads leads={stats?.recentLeads ?? []} />
            </Section>
          )}

          {show.invoiceList && (
            <Section title="Pending invoices" meta="Sent, partially paid & overdue" href="/admin/invoices">
              <PendingInvoices invoices={stats?.recentInvoices ?? []} />
            </Section>
          )}

        </div>
      )}
    </div>
  )
}
