'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { useSession } from 'next-auth/react'
import {
  TrendingUp, DollarSign, Briefcase, Users, FileText, AlertTriangle,
  ArrowUpRight, ArrowDownRight, ChevronLeft, BarChart2, Plus, X,
  CheckCircle2, Wallet, UserCheck, FolderPlus, UserPlus, ReceiptText,
  Flag, Circle, Target, Layers, Activity, ShieldAlert, Zap, Clock,
} from 'lucide-react'
import {
  ComposedChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Line,
} from 'recharts'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt  = (n) => n == null ? '—' : `৳\u202f${Number(n).toLocaleString('en-BD', { maximumFractionDigits: 0 })}`
const fmtK = (n) => {
  if (n == null) return '—'
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `৳${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 1_000)     return `৳${(n / 1_000).toFixed(0)}K`
  return `৳${n}`
}
const fmtDate  = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' }) : '—'
const daysLeft = (d) => d ? Math.ceil((new Date(d) - new Date()) / 86400000) : null

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']
const getMonthLabel = (offset = 0) => { const d = new Date(); d.setMonth(d.getMonth() - offset); return `${MONTHS[d.getMonth()]} ${d.getFullYear()}` }
const getDrillKey   = (offset = 0) => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() - offset); return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}` }

function greeting() {
  const h = new Date().getHours()
  return h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'
}

// ─── Trend badge ──────────────────────────────────────────────────────────────

function Trend({ change, invert = false }) {
  if (change == null) return null
  const up  = invert ? change < 0 : change > 0
  const neu = change === 0
  if (neu) return <span className="text-xs text-gray-400">No change</span>
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium ${up ? 'text-emerald-600' : 'text-rose-500'}`}>
      {up ? <ArrowUpRight className="w-3 h-3" /> : <ArrowDownRight className="w-3 h-3" />}
      {Math.abs(change)}%
    </span>
  )
}

// ─── KPI Card ─────────────────────────────────────────────────────────────────

function KpiCard({ title, value, sub, change, invert, icon: Icon, iconBg, iconColor, href }) {
  const inner = (
    <div className={`bg-white border border-gray-100 rounded-xl p-5 flex items-center gap-4 transition-shadow duration-150 ${href ? 'hover:shadow-sm cursor-pointer' : ''}`}>
      <div className={`w-10 h-10 rounded-lg flex items-center justify-center shrink-0 ${iconBg}`}>
        <Icon className={`w-5 h-5 ${iconColor}`} />
      </div>
      <div className="min-w-0 flex-1">
        <p className="text-xl font-bold text-gray-900 leading-none tracking-tight">{value}</p>
        <p className="text-xs text-gray-500 mt-1 font-medium">{title}</p>
        {(sub || change != null) && (
          <div className="flex items-center gap-2 mt-1.5">
            {change != null && <Trend change={change} invert={invert} />}
            {sub && <span className="text-xs text-gray-400 truncate">{sub}</span>}
          </div>
        )}
      </div>
    </div>
  )
  return href ? <Link href={href}>{inner}</Link> : inner
}

// ─── Custom chart tooltip ─────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-100 rounded-lg shadow-md px-3 py-2.5 text-xs min-w-[130px]">
      <p className="font-semibold text-gray-700 mb-2">{label}</p>
      {payload.map(p => (
        <div key={p.dataKey} className="flex items-center justify-between gap-4 mb-1 last:mb-0">
          <div className="flex items-center gap-1.5">
            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: p.color }} />
            <span className="text-gray-500">{p.name}</span>
          </div>
          <span className="font-semibold text-gray-800">{fmtK(p.value)}</span>
        </div>
      ))}
    </div>
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
    setLoading(true)
    fetch(`/api/dashboard/stats?drillMonth=${drillKey}`)
      .then(r => r.json())
      .then(j => { setData(j.data?.dailyData ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [drillKey])

  const income  = data?.reduce((s, r) => s + r.income,  0) ?? 0
  const expense = data?.reduce((s, r) => s + r.expense, 0) ?? 0

  return (
    <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-5 py-3.5 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors">
            <ChevronLeft className="w-4 h-4 text-gray-500" />
          </button>
          <span className="text-sm font-semibold text-gray-800">{label} — Daily View</span>
        </div>
        <div className="flex items-center gap-4 text-xs">
          <span className="text-gray-400">Income: <span className="text-emerald-600 font-semibold">{fmt(income)}</span></span>
          <span className="text-gray-400">Expense: <span className="text-red-500 font-semibold">{fmt(expense)}</span></span>
          <span className="text-gray-400">Net: <span className={`font-semibold ${income - expense >= 0 ? 'text-blue-600' : 'text-red-500'}`}>{fmt(income - expense)}</span></span>
        </div>
      </div>
      {loading ? (
        <div className="flex justify-center py-10">
          <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-xs min-w-[520px]">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-100">
                {['Day', 'Income', 'Expense', 'Net', 'Tx'].map(h => (
                  <th key={h} className={`px-5 py-2.5 text-xs font-medium text-gray-400 uppercase tracking-wide ${h === 'Day' ? 'text-left' : 'text-right'}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {(data ?? []).map(row => (
                <tr key={row.day} className={`transition-colors ${row.txCount > 0 ? 'hover:bg-gray-50/60' : 'opacity-40'}`}>
                  <td className="px-5 py-2.5 font-medium text-gray-700">{String(row.day).padStart(2, '0')} {MONTHS[mo - 1].slice(0, 3)}</td>
                  <td className="px-5 py-2.5 text-right text-emerald-600 font-medium">{row.income > 0 ? fmt(row.income) : '—'}</td>
                  <td className="px-5 py-2.5 text-right text-red-500">{row.expense > 0 ? fmt(row.expense) : '—'}</td>
                  <td className={`px-5 py-2.5 text-right font-medium ${row.profit > 0 ? 'text-gray-900' : row.profit < 0 ? 'text-red-500' : 'text-gray-300'}`}>
                    {row.txCount > 0 ? fmt(row.profit) : '—'}
                  </td>
                  <td className="px-5 py-2.5 text-right text-gray-400">{row.txCount > 0 ? row.txCount : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Status configs ───────────────────────────────────────────────────────────

const STATUS_BADGE = {
  PENDING:     'bg-gray-100 text-gray-600',
  IN_PROGRESS: 'bg-blue-50 text-blue-700',
  IN_REVIEW:   'bg-violet-50 text-violet-700',
  REVISION:    'bg-amber-50 text-amber-700',
  ACTIVE:      'bg-green-50 text-green-700',
  ON_HOLD:     'bg-yellow-50 text-yellow-700',
  CANCELLED:   'bg-red-50 text-red-600',
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

// ─── Section header ───────────────────────────────────────────────────────────

function SectionHeader({ title, href, action, meta }) {
  return (
    <div className="flex items-center justify-between mb-4">
      <div className="flex items-center gap-2">
        <h3 className="text-sm font-semibold text-gray-800">{title}</h3>
        {meta && <span className="text-xs text-gray-400">{meta}</span>}
      </div>
      {href && (
        <Link href={href} className="text-xs text-gray-400 hover:text-gray-700 flex items-center gap-0.5 transition-colors">
          {action ?? 'View all'} <ArrowUpRight className="w-3 h-3" />
        </Link>
      )}
    </div>
  )
}

// ─── Smart alerts ─────────────────────────────────────────────────────────────

function SmartAlerts({ items }) {
  const [dismissed, setDismissed] = useState([])
  const visible = items.filter((_, i) => !dismissed.includes(i))
  if (!visible.length) return null

  const STYLE = {
    error:   'bg-red-50 border-red-200 text-red-700',
    warning: 'bg-amber-50 border-amber-200 text-amber-700',
    info:    'bg-blue-50 border-blue-200 text-blue-700',
  }
  const ICON = { error: ShieldAlert, warning: AlertTriangle, info: Zap }

  return (
    <div className="space-y-2">
      {visible.map((ins, vi) => {
        const realIdx = items.indexOf(ins)
        const Icon    = ICON[ins.type] ?? Zap
        return (
          <div key={vi} className={`flex items-center gap-3 px-4 py-2.5 rounded-lg border text-sm ${STYLE[ins.type] ?? STYLE.info}`}>
            <Icon className="w-4 h-4 shrink-0" />
            <span className="flex-1 text-sm">{ins.message}</span>
            {ins.link && (
              <Link href={ins.link} className="text-xs font-medium underline underline-offset-2 opacity-70 hover:opacity-100 shrink-0 transition-opacity">
                View
              </Link>
            )}
            <button onClick={() => setDismissed(d => [...d, realIdx])} className="p-0.5 opacity-50 hover:opacity-100 transition-opacity shrink-0">
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
        )
      })}
    </div>
  )
}

// ─── Revenue chart ────────────────────────────────────────────────────────────

function RevenueChart({ data, onDrill }) {
  return (
    <div>
      <ResponsiveContainer width="100%" height={200}>
        <ComposedChart data={data} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gRev" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#3b82f6" stopOpacity={0.12} />
              <stop offset="100%" stopColor="#3b82f6" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gExp" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%"   stopColor="#ef4444" stopOpacity={0.08} />
              <stop offset="100%" stopColor="#ef4444" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
          <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
          <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} tickFormatter={v => fmtK(v)} width={48} />
          <Tooltip content={<ChartTooltip />} />
          <Area dataKey="revenue" name="Revenue" type="monotone" stroke="#3b82f6" strokeWidth={1.5}
            fill="url(#gRev)" dot={false} activeDot={{ r: 3, fill: '#3b82f6' }}
            onClick={d => onDrill?.(d.key)} className="cursor-pointer" />
          <Area dataKey="expense" name="Expense" type="monotone" stroke="#ef4444" strokeWidth={1.5}
            fill="url(#gExp)" dot={false} activeDot={{ r: 3, fill: '#ef4444' }} />
          <Line dataKey="profit" name="Net Profit" type="monotone" stroke="#10b981" strokeWidth={1.5}
            dot={false} activeDot={{ r: 3, fill: '#10b981' }} strokeDasharray="4 2" />
        </ComposedChart>
      </ResponsiveContainer>
      <div className="flex items-center gap-4 mt-2 justify-end">
        {[['#3b82f6','Revenue'], ['#ef4444','Expense'], ['#10b981','Net Profit']].map(([c, l]) => (
          <div key={l} className="flex items-center gap-1.5 text-xs text-gray-400">
            <span className="w-2.5 h-0.5 rounded-full inline-block" style={{ backgroundColor: c }} />
            {l}
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
  const dotColors = { NEW:'bg-gray-400', CONTACTED:'bg-blue-500', PROPOSAL_SENT:'bg-violet-500', NEGOTIATION:'bg-amber-500', WON:'bg-emerald-500', LOST:'bg-red-400' }
  return (
    <div className="space-y-3">
      {statuses.map(s => {
        const d   = pipeline[s] ?? { count: 0, value: 0 }
        const pct = Math.round((d.count / maxCount) * 100)
        return (
          <div key={s}>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <div className="flex items-center gap-2">
                <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dotColors[s]}`} />
                <span className="text-gray-600 font-medium">{LEAD_LABEL[s]}</span>
              </div>
              <div className="flex items-center gap-2.5 text-gray-400">
                <span className="font-semibold text-gray-700">{d.count}</span>
                {d.value > 0 && <span>{fmtK(d.value)}</span>}
              </div>
            </div>
            <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${dotColors[s]}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Projects list ────────────────────────────────────────────────────────────

function ProjectsList({ projects }) {
  if (!projects?.length) return (
    <div className="text-center py-8">
      <p className="text-sm text-gray-400">No active projects</p>
    </div>
  )
  return (
    <div className="divide-y divide-gray-50">
      {projects.map(p => {
        const budget     = p.budget ?? 0
        const paid       = p.paidAmount ?? 0
        const pct        = budget > 0 ? Math.min(100, Math.round((paid / budget) * 100)) : 0
        const dl         = daysLeft(p.deadline ?? p.currentPeriodEnd)
        const dlLabel    = dl == null ? null : dl < 0 ? `${Math.abs(dl)}d overdue` : dl === 0 ? 'Due today' : `${dl}d left`
        const dlColor    = dl == null ? '' : dl < 0 ? 'text-red-500' : dl <= 3 ? 'text-amber-500' : 'text-gray-400'
        const clientName = p.clientId?.userId?.name ?? '—'
        const dotColor   = p.venture === 'ENSTUDIO' ? 'bg-violet-500' : p.venture === 'ENTECH' ? 'bg-blue-500' : 'bg-emerald-500'
        return (
          <Link key={p._id} href={`/admin/projects/${p._id}`}
            className="flex items-start gap-3 py-3.5 hover:bg-gray-50/60 transition-colors -mx-1 px-1 rounded-lg group">
            <span className={`w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 ${dotColor}`} />
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 mb-0.5">
                <p className="text-sm font-medium text-gray-800 truncate">{p.name}</p>
                <span className={`text-xs px-1.5 py-0.5 rounded font-medium shrink-0 ${STATUS_BADGE[p.status] ?? 'bg-gray-100 text-gray-600'}`}>
                  {p.status?.replace(/_/g,' ')}
                </span>
              </div>
              <p className="text-xs text-gray-400 truncate">{clientName}{p.projectCode && ` · ${p.projectCode}`}</p>
              {budget > 0 && (
                <div className="flex items-center gap-2 mt-1.5">
                  <div className="flex-1 h-1 bg-gray-100 rounded-full overflow-hidden">
                    <div className={`h-full rounded-full transition-all ${pct >= 100 ? 'bg-emerald-500' : pct >= 60 ? 'bg-blue-500' : 'bg-gray-300'}`}
                      style={{ width: `${pct}%` }} />
                  </div>
                  <span className="text-xs text-gray-400 shrink-0 font-medium">{pct}%</span>
                </div>
              )}
            </div>
            {dlLabel && <span className={`text-xs font-medium shrink-0 mt-0.5 ${dlColor}`}>{dlLabel}</span>}
          </Link>
        )
      })}
    </div>
  )
}

// ─── Tasks list ───────────────────────────────────────────────────────────────

function TasksList({ tasks }) {
  if (!tasks?.length) return (
    <div className="text-center py-8">
      <p className="text-sm text-gray-400">No upcoming tasks</p>
    </div>
  )
  return (
    <div className="divide-y divide-gray-50">
      {tasks.map(t => {
        const dl      = daysLeft(t.dueDate)
        const dlLabel = dl == null ? '—' : dl < 0 ? `${Math.abs(dl)}d late` : dl === 0 ? 'Today' : fmtDate(t.dueDate)
        const dlColor = dl == null ? 'text-gray-300' : dl < 0 ? 'text-red-500' : dl === 0 ? 'text-amber-500' : 'text-gray-400'
        return (
          <div key={t._id} className="flex items-center gap-3 py-3">
            <Circle className="w-3.5 h-3.5 text-gray-300 shrink-0" />
            <div className="flex-1 min-w-0">
              <p className="text-sm text-gray-800 truncate font-medium">{t.title}</p>
              <p className="text-xs text-gray-400 truncate">{t.projectId?.name ?? 'No project'}</p>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <div className="flex items-center gap-1">
                <span className={`w-1.5 h-1.5 rounded-full ${PRIORITY_DOT[t.priority] ?? 'bg-gray-400'}`} />
                <span className="text-xs text-gray-500">{t.priority}</span>
              </div>
              <span className={`text-xs font-medium ${dlColor}`}>{dlLabel}</span>
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
          { label: 'Revenue',  value: fmt(f.income?.value),  color: 'text-gray-900', change: f.income?.change },
          { label: 'Expense',  value: fmt(f.expense?.value), color: 'text-gray-900', change: f.expense?.change, invert: true },
          { label: 'Net Profit', value: fmt(f.profit?.value), color: (f.profit?.value ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-500', change: f.profit?.change },
        ].map(r => (
          <div key={r.label} className="flex items-center justify-between">
            <span className="text-xs text-gray-500">{r.label}</span>
            <div className="flex items-center gap-2">
              <Trend change={r.change} invert={r.invert} />
              <span className={`text-sm font-semibold ${r.color}`}>{r.value}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="h-px bg-gray-100" />

      {/* Invoices */}
      <div>
        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2.5">Invoices</p>
        <div className="space-y-2">
          {[
            { label: 'Paid',    key: 'PAID',    dot: 'bg-emerald-500' },
            { label: 'Sent',    key: 'SENT',    dot: 'bg-blue-500' },
            { label: 'Overdue', key: 'OVERDUE', dot: 'bg-red-500' },
            { label: 'Draft',   key: 'DRAFT',   dot: 'bg-gray-400' },
          ].map(r => (
            <div key={r.key} className="flex items-center gap-2">
              <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${r.dot}`} />
              <span className="text-xs text-gray-500 flex-1">{r.label}</span>
              <span className="text-xs font-medium text-gray-700">{inv[r.key]?.count ?? 0}</span>
              <span className="text-xs text-gray-400 w-16 text-right">{fmtK(inv[r.key]?.total ?? 0)}</span>
            </div>
          ))}
        </div>
      </div>

      {pendingWithdrawals > 0 && (
        <>
          <div className="h-px bg-gray-100" />
          <Link href="/admin/freelancers" className="flex items-center justify-between group">
            <span className="text-xs text-gray-500">Pending Withdrawals</span>
            <span className="text-xs font-semibold text-amber-600 group-hover:text-amber-700 transition-colors">
              {pendingWithdrawals} pending
            </span>
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
    { label: 'Total Employees', value: hr.total,             icon: Users,        color: 'text-gray-400' },
    { label: 'Active',          value: hr.active,            icon: UserCheck,    color: 'text-emerald-500' },
    { label: 'Present Today',   value: hr.todayAttendance,   icon: CheckCircle2, color: 'text-blue-500' },
    { label: 'Pending Leaves',  value: hr.pendingLeaves,     icon: Clock,        color: hr.pendingLeaves > 0 ? 'text-amber-500' : 'text-gray-300' },
  ]
  return (
    <div className="space-y-2.5">
      {rows.map(({ label, value, icon: Icon, color }) => (
        <div key={label} className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className={`w-3.5 h-3.5 shrink-0 ${color}`} />
            <span className="text-xs text-gray-500">{label}</span>
          </div>
          <span className="text-sm font-semibold text-gray-800">{value ?? '—'}</span>
        </div>
      ))}
    </div>
  )
}

// ─── Ventures breakdown ───────────────────────────────────────────────────────

function VenturesPanel({ byVenture, total }) {
  if (!byVenture || !Object.keys(byVenture).length) return null
  const colors = { ENSTUDIO: 'bg-violet-500', ENTECH: 'bg-blue-500', ENMARK: 'bg-emerald-500' }
  const text   = { ENSTUDIO: 'text-violet-700 bg-violet-50', ENTECH: 'text-blue-700 bg-blue-50', ENMARK: 'text-emerald-700 bg-emerald-50' }
  return (
    <div className="space-y-3">
      {Object.entries(byVenture).map(([venture, count]) => {
        const pct = Math.round((count / (total || 1)) * 100)
        return (
          <div key={venture}>
            <div className="flex items-center justify-between text-xs mb-1.5">
              <span className={`font-medium px-2 py-0.5 rounded text-xs ${text[venture] ?? 'bg-gray-100 text-gray-600'}`}>{venture}</span>
              <span className="text-gray-500 font-semibold">{count} <span className="text-gray-400 font-normal">({pct}%)</span></span>
            </div>
            <div className="h-1 bg-gray-100 rounded-full overflow-hidden">
              <div className={`h-full rounded-full transition-all ${colors[venture] ?? 'bg-gray-400'}`} style={{ width: `${pct}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Recent leads ─────────────────────────────────────────────────────────────

function RecentLeads({ leads }) {
  if (!leads?.length) return <p className="text-sm text-gray-400 py-4 text-center">No leads</p>
  return (
    <div className="divide-y divide-gray-50">
      {leads.map(l => (
        <Link key={l._id} href="/admin/leads" className="flex items-center gap-3 py-3 hover:bg-gray-50/60 transition-colors -mx-1 px-1 rounded-lg">
          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${LEAD_DOT[l.status] ?? 'bg-gray-400'}`} />
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-800 truncate">{l.name}</p>
            <p className="text-xs text-gray-400 truncate">{l.company || l.source || '—'}</p>
          </div>
          <div className="text-right shrink-0">
            {l.value > 0 && <p className="text-xs font-semibold text-gray-700">{fmtK(l.value)}</p>}
            <p className="text-xs text-gray-400">{LEAD_LABEL[l.status] ?? l.status}</p>
          </div>
        </Link>
      ))}
    </div>
  )
}

// ─── Pending invoices ─────────────────────────────────────────────────────────

function PendingInvoices({ invoices }) {
  if (!invoices?.length) return (
    <p className="text-sm text-gray-400 py-4 text-center">All invoices collected</p>
  )
  return (
    <div className="divide-y divide-gray-50">
      {invoices.map(inv => {
        const dl        = daysLeft(inv.dueDate)
        const isOverdue = dl != null && dl < 0
        const clientName = inv.clientId?.userId?.name ?? '—'
        return (
          <Link key={inv._id} href={`/admin/invoices/${inv._id}`}
            className="flex items-center gap-3 py-3 hover:bg-gray-50/60 transition-colors -mx-1 px-1 rounded-lg">
            <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${isOverdue ? 'bg-red-500' : 'bg-amber-400'}`} />
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800 font-mono">{inv.invoiceNumber ?? '—'}</p>
              <p className="text-xs text-gray-400 truncate">{clientName}</p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-sm font-semibold text-gray-800">{fmtK(inv.total)}</p>
              <p className={`text-xs ${isOverdue ? 'text-red-500 font-medium' : 'text-gray-400'}`}>
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

  const monthOptions = Array.from({ length: 6 }, (_, i) => ({ key: getDrillKey(i), label: getMonthLabel(i) }))

  useEffect(() => {
    fetch('/api/dashboard/stats')
      .then(r => r.json())
      .then(j => { setStats(j.data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="flex items-center justify-center min-h-[400px]">
      <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  const f       = stats?.financials ?? {}
  const inv     = stats?.invoices   ?? {}
  const proj    = stats?.projects   ?? {}
  const clients = stats?.clients    ?? {}
  const tasks   = stats?.tasks      ?? {}
  const leads   = stats?.leads      ?? {}
  const hr      = stats?.hr         ?? {}

  // Smart alerts
  const alerts = []
  const overdueCount = inv.OVERDUE?.count ?? 0
  const overdueTotal = inv.OVERDUE?.total ?? 0
  if (overdueCount > 0)
    alerts.push({ type: 'error',   message: `${overdueCount} overdue invoice${overdueCount !== 1 ? 's' : ''} — ${fmtK(overdueTotal)} outstanding`, link: '/admin/invoices?status=OVERDUE' })
  if (tasks.overdue > 0)
    alerts.push({ type: 'warning', message: `${tasks.overdue} task${tasks.overdue !== 1 ? 's' : ''} past deadline`, link: '/admin/tasks' })
  if ((stats?.pendingWithdrawals ?? 0) > 0)
    alerts.push({ type: 'info',    message: `${stats.pendingWithdrawals} freelancer withdrawal${stats.pendingWithdrawals !== 1 ? 's' : ''} awaiting approval`, link: '/admin/freelancers' })
  const critProj = (stats?.recentProjects ?? []).filter(p => { const d = daysLeft(p.deadline ?? p.currentPeriodEnd); return d != null && d >= 0 && d <= 3 })
  if (critProj.length > 0)
    alerts.push({ type: 'warning', message: `${critProj.length} project${critProj.length !== 1 ? 's' : ''} deadline within 3 days`, link: '/admin/projects' })

  // KPI data
  const paidInvCount = inv.PAID?.count ?? 0
  const paidInvTotal = inv.PAID?.total ?? 0
  const sentCount    = (inv.SENT?.count ?? 0) + (inv.OVERDUE?.count ?? 0)
  const sentTotal    = (inv.SENT?.total ?? 0) + (inv.OVERDUE?.total ?? 0)

  const kpis = [
    {
      title: 'Monthly Revenue', value: fmtK(f.income?.value),
      sub: `vs ${fmtK(f.income?.prevValue)} last mo`, change: f.income?.change,
      icon: TrendingUp, iconBg: 'bg-blue-50', iconColor: 'text-blue-600',
      href: '/admin/accounts?tab=income',
    },
    {
      title: 'Net Profit', value: fmtK(f.profit?.value),
      sub: `Margin ${f.grossMargin?.value ?? 0}%`, change: f.profit?.change,
      icon: DollarSign, iconBg: 'bg-green-50', iconColor: 'text-green-600',
      href: '/admin/accounts',
    },
    {
      title: 'Paid Invoices', value: paidInvCount,
      sub: `${fmtK(paidInvTotal)} collected`,
      icon: CheckCircle2, iconBg: 'bg-emerald-50', iconColor: 'text-emerald-600',
      href: '/admin/invoices?status=PAID',
    },
    {
      title: 'Pending / Overdue', value: sentCount,
      sub: `${fmtK(sentTotal)} outstanding`,
      icon: AlertTriangle, iconBg: overdueCount > 0 ? 'bg-red-50' : 'bg-amber-50',
      iconColor: overdueCount > 0 ? 'text-red-500' : 'text-amber-500',
      href: '/admin/invoices',
    },
    {
      title: 'Active Projects', value: proj.active ?? 0,
      sub: `${proj.total ?? 0} total`,
      icon: Briefcase, iconBg: 'bg-blue-50', iconColor: 'text-blue-600',
      href: '/admin/projects',
    },
    {
      title: 'Open Tasks', value: tasks.open ?? 0,
      sub: tasks.overdue > 0 ? `${tasks.overdue} overdue` : `${tasks.completedThisMonth ?? 0} done this mo`,
      icon: tasks.overdue > 0 ? Flag : Activity,
      iconBg: tasks.overdue > 0 ? 'bg-red-50' : 'bg-violet-50',
      iconColor: tasks.overdue > 0 ? 'text-red-500' : 'text-violet-600',
      href: '/admin/tasks',
    },
  ]

  // Chart data
  const chartData = (stats?.revenueVsProfit ?? []).map((r, i) => ({
    ...r,
    expense: stats?.expenseTrend?.[i]?.expense ?? 0,
  }))

  return (
    <div className="space-y-5 pb-10">

      {/* ── Header ── */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">
            {greeting()}{session?.user?.name ? `, ${session.user.name.split(' ')[0]}` : ''}
          </h1>
          <p className="text-sm text-gray-400 mt-0.5">
            {new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-wrap">
          {[
            { label: 'New Client',  href: '/admin/clients',       icon: UserPlus },
            { label: 'New Project', href: '/admin/projects/new',  icon: FolderPlus },
            { label: 'New Invoice', href: '/admin/invoices/new',  icon: ReceiptText },
            { label: 'New Lead',    href: '/admin/leads',         icon: Target },
          ].map(({ label, href, icon: Icon }) => (
            <Link key={label} href={href}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium text-gray-600 border border-gray-200 bg-white rounded-lg hover:bg-gray-900 hover:text-white hover:border-gray-900 transition-all duration-150">
              <Plus className="w-3.5 h-3.5" />
              {label}
            </Link>
          ))}
        </div>
      </div>

      {/* ── Alerts ── */}
      <SmartAlerts items={alerts} />

      {/* ── KPI grid ── */}
      <div className="grid grid-cols-2 md:grid-cols-3 xl:grid-cols-6 gap-4">
        {kpis.map(k => <KpiCard key={k.title} {...k} />)}
      </div>

      {/* ── Period chips ── */}
      <div className="flex items-center gap-1.5 flex-wrap">
        <span className="text-xs text-gray-400 mr-1">Daily breakdown:</span>
        {monthOptions.map(m => (
          <button key={m.key} onClick={() => setDrillKey(prev => prev === m.key ? null : m.key)}
            className={`px-3 py-1.5 text-xs rounded-lg font-medium transition-colors duration-150 ${
              drillKey === m.key
                ? 'bg-gray-900 text-white'
                : 'bg-white border border-gray-200 text-gray-500 hover:bg-gray-50'
            }`}>
            {m.label}
          </button>
        ))}
      </div>

      {/* ── Drill-down ── */}
      {drillKey && <CalendarDrillDown drillKey={drillKey} onClose={() => setDrillKey(null)} />}

      {/* ── Main grid ── */}
      <div className="grid grid-cols-1 xl:grid-cols-3 gap-5">

        {/* Left — 2/3 */}
        <div className="xl:col-span-2 space-y-5">

          {/* Revenue chart */}
          <div className="bg-white border border-gray-100 rounded-xl p-5">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h3 className="text-sm font-semibold text-gray-800">Revenue & Profit</h3>
                <p className="text-xs text-gray-400 mt-0.5">6-month trend · click revenue to drill down</p>
              </div>
              <Link href="/admin/accounts" className="text-xs text-gray-400 hover:text-gray-700 flex items-center gap-0.5 transition-colors">
                Accounts <ArrowUpRight className="w-3 h-3" />
              </Link>
            </div>
            <RevenueChart data={chartData} onDrill={key => setDrillKey(prev => prev === key ? null : key)} />
          </div>

          {/* Active projects */}
          <div className="bg-white border border-gray-100 rounded-xl p-5">
            <SectionHeader title="Active Projects" meta={`${proj.active ?? 0} in progress`} href="/admin/projects" />
            <ProjectsList projects={stats?.recentProjects ?? []} />
          </div>

          {/* Tasks */}
          <div className="bg-white border border-gray-100 rounded-xl p-5">
            <SectionHeader
              title="Upcoming Tasks"
              meta={tasks.overdue > 0 ? `${tasks.overdue} overdue` : undefined}
              href="/admin/tasks"
            />
            <TasksList tasks={stats?.upcomingTasks ?? []} />
          </div>

        </div>

        {/* Right — 1/3 */}
        <div className="space-y-5">

          {/* Lead pipeline */}
          <div className="bg-white border border-gray-100 rounded-xl p-5">
            <SectionHeader title="Lead Pipeline" meta={`${leads.total ?? 0} total`} href="/admin/leads" />
            <LeadPipeline pipeline={leads.pipeline ?? {}} />
            {(leads.newThisMonth ?? 0) > 0 && (
              <p className="text-xs text-emerald-600 font-medium mt-3">
                +{leads.newThisMonth} new this month
              </p>
            )}
          </div>

          {/* Finance summary */}
          <div className="bg-white border border-gray-100 rounded-xl p-5">
            <SectionHeader title="Finance" href="/admin/accounts" />
            <FinanceSummary financials={f} invoices={inv} pendingWithdrawals={stats?.pendingWithdrawals} />
          </div>

          {/* Team */}
          <div className="bg-white border border-gray-100 rounded-xl p-5">
            <SectionHeader title="Team" href="/admin/employees" />
            <TeamSummary hr={hr} />
          </div>

          {/* Ventures */}
          {proj.byVenture && Object.keys(proj.byVenture).length > 0 && (
            <div className="bg-white border border-gray-100 rounded-xl p-5">
              <SectionHeader title="Projects by Venture" />
              <VenturesPanel byVenture={proj.byVenture} total={proj.total} />
            </div>
          )}

        </div>
      </div>

      {/* ── Bottom row ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">

        <div className="bg-white border border-gray-100 rounded-xl p-5">
          <SectionHeader title="Recent Leads" meta={leads.newThisMonth > 0 ? `${leads.newThisMonth} this month` : undefined} href="/admin/leads" />
          <RecentLeads leads={stats?.recentLeads ?? []} />
        </div>

        <div className="bg-white border border-gray-100 rounded-xl p-5">
          <SectionHeader title="Pending Invoices" meta="Sent & overdue" href="/admin/invoices" />
          <PendingInvoices invoices={stats?.recentInvoices ?? []} />
        </div>

      </div>
    </div>
  )
}
