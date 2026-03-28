'use client'

import { useState, useEffect } from 'react'
import {
  TrendingUp, TrendingDown, DollarSign, Briefcase, Users, FileText,
  AlertTriangle, Clock, ArrowUpRight, ArrowDownRight, ChevronLeft,
  ChevronRight, BarChart2, Percent,
} from 'lucide-react'
import Link from 'next/link'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, LineChart, Line, Legend,
} from 'recharts'

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt = (n) =>
  n == null ? '—' : `৳ ${Number(n).toLocaleString('en-BD', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`

const fmtK = (n) => {
  if (!n) return '0'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000)     return `${(n / 1_000).toFixed(0)}K`
  return String(n)
}

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function getMonthLabel(offset = 0) {
  const d = new Date()
  d.setMonth(d.getMonth() - offset)
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`
}

function getDrillKey(offset = 0) {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// ─── Trend Pill ───────────────────────────────────────────────────────────────

function TrendPill({ change, invert = false }) {
  if (change == null) return null
  const positive = invert ? change < 0 : change > 0
  const neutral  = change === 0
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium px-1.5 py-0.5 rounded-full ${
      neutral  ? 'bg-gray-100 text-gray-500' :
      positive ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-500'
    }`}>
      {neutral ? null : positive
        ? <ArrowUpRight className="w-3 h-3" />
        : <ArrowDownRight className="w-3 h-3" />}
      {neutral ? 'No change' : `${Math.abs(change)}%`}
    </span>
  )
}

// ─── Calendar Drill-Down ──────────────────────────────────────────────────────

function CalendarDrillDown({ drillKey, onClose }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)

  const [yr, mo] = drillKey.split('-').map(Number)
  const label = `${MONTHS[mo - 1]} ${yr}`
  const daysInMonth = new Date(yr, mo, 0).getDate()

  useEffect(() => {
    setLoading(true)
    fetch(`/api/dashboard/stats?drillMonth=${drillKey}`)
      .then(r => r.json())
      .then(j => { setData(j.data?.dailyData ?? []); setLoading(false) })
      .catch(() => setLoading(false))
  }, [drillKey])

  return (
    <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 transition-colors">
            <ChevronLeft className="w-4 h-4 text-gray-500" />
          </button>
          <h3 className="font-semibold text-gray-900">{label} — Daily Breakdown</h3>
        </div>
        <span className="text-xs text-gray-400">{daysInMonth} days</span>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead>
              <tr className="bg-gray-50/70 border-b border-gray-100">
                <th className="px-5 py-2.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wide w-20">Day</th>
                <th className="px-5 py-2.5 text-right text-xs font-medium text-gray-400 uppercase tracking-wide">Income</th>
                <th className="px-5 py-2.5 text-right text-xs font-medium text-gray-400 uppercase tracking-wide">Expense</th>
                <th className="px-5 py-2.5 text-right text-xs font-medium text-gray-400 uppercase tracking-wide">Net Profit</th>
                <th className="px-5 py-2.5 text-right text-xs font-medium text-gray-400 uppercase tracking-wide">Transactions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {(data ?? []).map(row => {
                const hasActivity = row.txCount > 0
                return (
                  <tr key={row.day} className={`transition-colors ${hasActivity ? 'hover:bg-blue-50/30' : 'opacity-40'}`}>
                    <td className="px-5 py-2.5 font-medium text-gray-700">
                      {String(row.day).padStart(2, '0')} {MONTHS[mo - 1].slice(0, 3)}
                    </td>
                    <td className="px-5 py-2.5 text-right text-green-600 font-medium">
                      {row.income > 0 ? fmt(row.income) : '—'}
                    </td>
                    <td className="px-5 py-2.5 text-right text-red-500">
                      {row.expense > 0 ? fmt(row.expense) : '—'}
                    </td>
                    <td className={`px-5 py-2.5 text-right font-medium ${
                      row.profit > 0 ? 'text-gray-900' : row.profit < 0 ? 'text-red-500' : 'text-gray-300'
                    }`}>
                      {row.txCount > 0 ? fmt(row.profit) : '—'}
                    </td>
                    <td className="px-5 py-2.5 text-right text-gray-400">
                      {row.txCount > 0 ? row.txCount : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Custom Tooltip ───────────────────────────────────────────────────────────

function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null
  return (
    <div className="bg-white border border-gray-100 rounded-lg shadow-lg px-3 py-2 text-xs space-y-1">
      <p className="font-semibold text-gray-700 mb-1">{label}</p>
      {payload.map(p => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}: ৳ {Number(p.value).toLocaleString('en-BD')}
        </p>
      ))}
    </div>
  )
}

// ─── Main Dashboard ───────────────────────────────────────────────────────────

export default function AdminDashboard() {
  const [stats,      setStats]      = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [drillKey,   setDrillKey]   = useState(null) // e.g. "2026-03"
  const [session,    setSession]    = useState(null)

  useEffect(() => {
    // Fetch session name via a lightweight endpoint
    fetch('/api/users?limit=1').then(() => {})
    // Get display name from NextAuth session stored in cookie (read from meta)
    const nameEl = document.querySelector('meta[name="user-name"]')
    if (nameEl) setSession({ name: nameEl.content })
  }, [])

  useEffect(() => {
    setLoading(true)
    fetch('/api/dashboard/stats')
      .then(r => r.json())
      .then(j => { setStats(j.data); setLoading(false) })
      .catch(() => setLoading(false))
  }, [])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[400px]">
        <div className="w-7 h-7 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }

  const f = stats?.financials ?? {}

  const FINANCIAL_CARDS = [
    {
      label:   'Monthly Income',
      value:   fmt(f.income?.value),
      prev:    `vs ${fmt(f.income?.prevValue)} last month`,
      change:  f.income?.change,
      icon:    TrendingUp,
      bg:      'bg-green-50',
      color:   'text-green-600',
    },
    {
      label:   'Monthly Expense',
      value:   fmt(f.expense?.value),
      prev:    `vs ${fmt(f.expense?.prevValue)} last month`,
      change:  f.expense?.change,
      invert:  true,
      icon:    TrendingDown,
      bg:      'bg-red-50',
      color:   'text-red-500',
    },
    {
      label:   'Net Profit',
      value:   fmt(f.profit?.value),
      prev:    `vs ${fmt(f.profit?.prevValue)} last month`,
      change:  f.profit?.change,
      icon:    DollarSign,
      bg:      'bg-blue-50',
      color:   'text-blue-600',
    },
    {
      label:   'Gross Margin',
      value:   `${f.grossMargin?.value ?? 0}%`,
      prev:    `was ${f.grossMargin?.prevValue ?? 0}% last month`,
      change:  f.grossMargin?.value != null && f.grossMargin?.prevValue != null
                 ? (f.grossMargin.value - f.grossMargin.prevValue)
                 : null,
      icon:    Percent,
      bg:      'bg-purple-50',
      color:   'text-purple-600',
    },
    {
      label:   'Expense Ratio',
      value:   `${f.expenseRatio?.value ?? 0}%`,
      prev:    `was ${f.expenseRatio?.prevValue ?? 0}% last month`,
      change:  f.expenseRatio?.value != null && f.expenseRatio?.prevValue != null
                 ? (f.expenseRatio.value - f.expenseRatio.prevValue)
                 : null,
      invert:  true,
      icon:    BarChart2,
      bg:      'bg-orange-50',
      color:   'text-orange-500',
    },
    {
      label:   'Transactions',
      value:   f.transactions?.value ?? 0,
      prev:    `${f.transactions?.prevValue ?? 0} last month`,
      change:  f.transactions?.change,
      icon:    FileText,
      bg:      'bg-indigo-50',
      color:   'text-indigo-600',
    },
  ]

  const overdueInvoices  = stats?.invoices?.OVERDUE?.count  ?? 0
  const pendingWithdrawals = stats?.pendingWithdrawals ?? 0

  // Months list for period selector (last 6)
  const monthOptions = Array.from({ length: 6 }, (_, i) => ({
    key:   getDrillKey(i),
    label: getMonthLabel(i),
  }))

  return (
    <div className="space-y-6">
      {/* Page header */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Dashboard</h1>
          <p className="text-sm text-gray-400 mt-0.5">{getMonthLabel(0)} · Financial Overview</p>
        </div>
        {/* Period selector — calendar-style month chips */}
        <div className="flex items-center gap-1.5 bg-white border border-gray-100 rounded-xl px-3 py-2">
          {monthOptions.map(m => (
            <button
              key={m.key}
              onClick={() => setDrillKey(prev => prev === m.key ? null : m.key)}
              className={`px-3 py-1 text-xs rounded-lg transition-colors ${
                drillKey === m.key
                  ? 'bg-gray-900 text-white font-medium'
                  : 'text-gray-500 hover:bg-gray-50 hover:text-gray-800'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {/* Alert banners */}
      {(overdueInvoices > 0 || pendingWithdrawals > 0) && (
        <div className="flex flex-wrap gap-3">
          {overdueInvoices > 0 && (
            <Link href="/admin/invoices?status=OVERDUE"
              className="flex items-center gap-2 px-4 py-2 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700 hover:bg-red-100 transition-colors">
              <AlertTriangle className="w-4 h-4" />
              {overdueInvoices} overdue invoice{overdueInvoices !== 1 ? 's' : ''} need attention
            </Link>
          )}
          {pendingWithdrawals > 0 && (
            <Link href="/admin/freelancers?tab=withdrawals"
              className="flex items-center gap-2 px-4 py-2 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-yellow-700 hover:bg-yellow-100 transition-colors">
              <Clock className="w-4 h-4" />
              {pendingWithdrawals} withdrawal request{pendingWithdrawals !== 1 ? 's' : ''} pending
            </Link>
          )}
        </div>
      )}

      {/* Financial metrics grid */}
      <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
        {FINANCIAL_CARDS.map(card => {
          const Icon = card.icon
          return (
            <div key={card.label} className="bg-white border border-gray-100 rounded-xl p-5">
              <div className="flex items-start justify-between mb-3">
                <div className={`w-9 h-9 rounded-lg ${card.bg} flex items-center justify-center`}>
                  <Icon className={`w-4 h-4 ${card.color}`} />
                </div>
                <TrendPill change={card.change} invert={card.invert} />
              </div>
              <p className="text-xl font-bold text-gray-900">{card.value}</p>
              <p className="text-sm font-medium text-gray-600 mt-0.5">{card.label}</p>
              <p className="text-xs text-gray-400 mt-1">{card.prev}</p>
            </div>
          )
        })}
      </div>

      {/* Calendar drill-down (shown when a month is clicked) */}
      {drillKey && (
        <CalendarDrillDown
          drillKey={drillKey}
          onClose={() => setDrillKey(null)}
        />
      )}

      {/* Charts row */}
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-6">
        {/* Chart 1: 6-month expense trend */}
        <div className="bg-white border border-gray-100 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-gray-900 text-sm">Expense Trend</h3>
              <p className="text-xs text-gray-400">Last 6 months</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={stats?.expenseTrend ?? []} barSize={28}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false}
                tickFormatter={v => `${fmtK(v)}`} width={40} />
              <Tooltip content={<ChartTooltip />} />
              <Bar dataKey="expense" name="Expense" fill="#f87171" radius={[4, 4, 0, 0]}
                onClick={d => setDrillKey(prev => prev === d.key ? null : d.key)} className="cursor-pointer" />
            </BarChart>
          </ResponsiveContainer>
          <p className="text-xs text-gray-400 text-center mt-2">Click a bar to drill into daily view</p>
        </div>

        {/* Chart 2: Revenue vs Profit comparison */}
        <div className="bg-white border border-gray-100 rounded-xl p-5">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h3 className="font-semibold text-gray-900 text-sm">Revenue vs Profit</h3>
              <p className="text-xs text-gray-400">Current vs previous month comparison</p>
            </div>
          </div>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={stats?.revenueVsProfit ?? []} barSize={20} barCategoryGap="30%">
              <CartesianGrid strokeDasharray="3 3" stroke="#f1f5f9" vertical={false} />
              <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fontSize: 11, fill: '#94a3b8' }} axisLine={false} tickLine={false}
                tickFormatter={v => `${fmtK(v)}`} width={44} />
              <Tooltip content={<ChartTooltip />} />
              <Legend iconSize={8} iconType="circle" wrapperStyle={{ fontSize: 11, paddingTop: 8 }} />
              <Bar dataKey="revenue" name="Revenue" fill="#60a5fa" radius={[4, 4, 0, 0]}
                onClick={d => setDrillKey(prev => prev === d.key ? null : d.key)} className="cursor-pointer" />
              <Bar dataKey="profit"  name="Profit"  fill="#34d399" radius={[4, 4, 0, 0]}
                onClick={d => setDrillKey(prev => prev === d.key ? null : d.key)} className="cursor-pointer" />
            </BarChart>
          </ResponsiveContainer>
          <p className="text-xs text-gray-400 text-center mt-2">Click a bar to drill into daily view</p>
        </div>
      </div>

      {/* Quick stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Active Projects', value: stats?.projects?.active ?? 0, href: '/admin/projects', icon: Briefcase, color: 'text-blue-600', bg: 'bg-blue-50' },
          { label: 'Total Clients',   value: stats?.clients?.total ?? 0,   href: '/admin/clients',  icon: Users,     color: 'text-purple-600', bg: 'bg-purple-50' },
          { label: 'Open Leads',      value: stats?.leads?.total ?? 0,     href: '/admin/leads',    icon: TrendingUp, color: 'text-emerald-600', bg: 'bg-emerald-50' },
          { label: 'Open Tasks',      value: stats?.tasks?.open ?? 0,      href: '/admin/tasks',    icon: FileText,  color: 'text-orange-500', bg: 'bg-orange-50' },
        ].map(s => {
          const Icon = s.icon
          return (
            <Link key={s.label} href={s.href}
              className="bg-white border border-gray-100 rounded-xl p-4 flex items-center gap-3 hover:shadow-sm transition-shadow group">
              <div className={`w-9 h-9 rounded-lg ${s.bg} flex items-center justify-center shrink-0`}>
                <Icon className={`w-4 h-4 ${s.color}`} />
              </div>
              <div>
                <p className="text-lg font-bold text-gray-900">{s.value}</p>
                <p className="text-xs text-gray-400">{s.label}</p>
              </div>
              <ArrowUpRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-500 transition-colors ml-auto" />
            </Link>
          )
        })}
      </div>
    </div>
  )
}
