'use client'

import { useState, useEffect } from 'react'
import { toast } from 'react-hot-toast'
import { Loader2, Clock, Hourglass, CheckCircle2, CalendarClock } from 'lucide-react'
import { formatCurrency } from '@/lib/utils'

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

// Render a per-currency totals array (from the dashboard API) as "৳5,000 · $120".
function moneyByCurrency(totals) {
  if (!totals || totals.length === 0) return formatCurrency(0)
  return totals.map(t => formatCurrency(t.total, t.currency)).join('  ·  ')
}

const ASSIGNMENT_STATUS_COLORS = {
  ASSIGNED:    'bg-blue-50 text-blue-700 ring-blue-600/10',
  ACCEPTED:    'bg-teal-50 text-teal-700 ring-teal-600/10',
  IN_PROGRESS: 'bg-violet-50 text-violet-700 ring-violet-600/10',
  COMPLETED:   'bg-emerald-50 text-emerald-700 ring-emerald-600/10',
  CANCELLED:   'bg-rose-50 text-rose-600 ring-rose-600/10',
}

const PAYMENT_STATUS_LABEL = {
  PENDING:            { label: 'Not requested', cls: 'bg-gray-50 text-gray-500 ring-gray-500/10' },
  PAYMENT_REQUESTED:  { label: 'Awaiting payment', cls: 'bg-amber-50 text-amber-700 ring-amber-600/10' },
  PAID:               { label: 'Paid', cls: 'bg-emerald-50 text-emerald-700 ring-emerald-600/10' },
  NOT_REQUIRED:       { label: 'Salary', cls: 'bg-indigo-50 text-indigo-700 ring-indigo-600/10' },
}

const VENTURE_COLORS = {
  ENSTUDIO: 'bg-purple-50 text-purple-700 ring-purple-600/10',
  ENTECH:   'bg-blue-50 text-blue-700 ring-blue-600/10',
  ENMARK:   'bg-green-50 text-green-700 ring-green-600/10',
}

function Pill({ children, className = '' }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ring-1 ring-inset ${className}`}>
      {children}
    </span>
  )
}

function SummaryCard({ label, hint, totals, icon: Icon, accent }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-gray-400 uppercase tracking-wide">{label}</span>
        <div className={`w-9 h-9 rounded-xl flex items-center justify-center ${accent.bg}`}>
          <Icon className={`w-4.5 h-4.5 ${accent.text}`} />
        </div>
      </div>
      <div>
        <p className="text-xl font-semibold text-gray-900 leading-tight break-words">{moneyByCurrency(totals)}</p>
        <p className="text-xs text-gray-400 mt-1">{hint}</p>
      </div>
    </div>
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

  if (loading) return (
    <div className="flex justify-center py-20">
      <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
    </div>
  )
  if (!data) return null

  const { freelancer, assignments, salaryPayouts = [], summary } = data
  const isSalary = freelancer.employmentMode === 'SALARY'

  return (
    <div className="space-y-6 mx-auto w-full max-w-6xl">
      {/* Welcome */}
      <div>
        <h1 className="text-xl sm:text-2xl font-bold text-gray-900">
          Welcome back, {freelancer.userId?.name ?? 'Freelancer'}
        </h1>
        <p className="text-sm text-gray-400 mt-0.5">
          {isSalary ? 'Your engagements and salary at a glance' : 'Your engagements and payments at a glance'}
        </p>
      </div>

      {/* Three money buckets */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        <SummaryCard
          label="In progress"
          hint="Accepted, not delivered yet"
          totals={summary.accepted.totals}
          icon={Hourglass}
          accent={{ bg: 'bg-violet-50', text: 'text-violet-600' }}
        />
        <SummaryCard
          label="Awaiting payment"
          hint="Delivered, not paid yet"
          totals={[...summary.awaitingPayment.totals, ...(isSalary ? summary.salaryPending.totals : [])]}
          icon={Clock}
          accent={{ bg: 'bg-amber-50', text: 'text-amber-600' }}
        />
        <SummaryCard
          label="Total paid"
          hint="Settled to date"
          totals={[...summary.paid.totals, ...(isSalary ? summary.salaryPaid.totals : [])]}
          icon={CheckCircle2}
          accent={{ bg: 'bg-emerald-50', text: 'text-emerald-600' }}
        />
      </div>

      {/* Engagements */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="px-5 sm:px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">My Engagements</h2>
        </div>

        {assignments.length === 0 ? (
          <div className="py-16 text-center text-gray-400 text-sm">No engagements yet</div>
        ) : (
          <>
            {/* Desktop table */}
            <div className="hidden md:block overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    {['Project', 'Venture', 'Amount', 'Stage', 'Payment', 'Action'].map(h => (
                      <th key={h} className="px-5 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {assignments.map(a => {
                    const id = a.id ?? a._id
                    const pay = PAYMENT_STATUS_LABEL[a.paymentStatus] ?? PAYMENT_STATUS_LABEL.PENDING
                    return (
                      <tr key={id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-5 py-3.5">
                          <p className="text-sm font-medium text-gray-900">{a.projectId?.name ?? '—'}</p>
                          {a.projectId?.projectCode && (
                            <p className="text-xs text-gray-400 font-mono mt-0.5">{a.projectId.projectCode}</p>
                          )}
                        </td>
                        <td className="px-5 py-3.5">
                          {a.projectId?.venture
                            ? <Pill className={VENTURE_COLORS[a.projectId.venture] ?? 'bg-gray-50 text-gray-600 ring-gray-500/10'}>{a.projectId.venture}</Pill>
                            : <span className="text-gray-300">—</span>}
                        </td>
                        <td className="px-5 py-3.5 text-sm font-medium text-gray-900">
                          {a.paymentAmount ? formatCurrency(a.paymentAmount, a.currency) : <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-5 py-3.5">
                          <Pill className={ASSIGNMENT_STATUS_COLORS[a.status] ?? 'bg-gray-50 text-gray-600 ring-gray-500/10'}>
                            {a.status.replace('_', ' ')}
                          </Pill>
                        </td>
                        <td className="px-5 py-3.5"><Pill className={pay.cls}>{pay.label}</Pill></td>
                        <td className="px-5 py-3.5">
                          {a.status === 'ASSIGNED' && (
                            <button
                              onClick={() => actOn(id, 'accept', 'Engagement accepted!')}
                              disabled={acting === id + 'accept'}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors"
                            >
                              {acting === id + 'accept' && <Loader2 className="w-3 h-3 animate-spin" />}
                              Accept
                            </button>
                          )}
                          {a.status === 'ACCEPTED' && (
                            <button
                              onClick={() => actOn(id, 'start', 'Marked in progress')}
                              disabled={acting === id + 'start'}
                              className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50 transition-colors"
                            >
                              {acting === id + 'start' && <Loader2 className="w-3 h-3 animate-spin" />}
                              Start
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Mobile cards */}
            <div className="md:hidden divide-y divide-gray-50">
              {assignments.map(a => {
                const id = a.id ?? a._id
                const pay = PAYMENT_STATUS_LABEL[a.paymentStatus] ?? PAYMENT_STATUS_LABEL.PENDING
                return (
                  <div key={id} className="p-4 space-y-2.5">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{a.projectId?.name ?? '—'}</p>
                        {a.projectId?.projectCode && (
                          <p className="text-xs text-gray-400 font-mono mt-0.5">{a.projectId.projectCode}</p>
                        )}
                      </div>
                      <p className="text-sm font-semibold text-gray-900 shrink-0">
                        {a.paymentAmount ? formatCurrency(a.paymentAmount, a.currency) : '—'}
                      </p>
                    </div>
                    <div className="flex flex-wrap items-center gap-2">
                      <Pill className={ASSIGNMENT_STATUS_COLORS[a.status] ?? 'bg-gray-50 text-gray-600 ring-gray-500/10'}>
                        {a.status.replace('_', ' ')}
                      </Pill>
                      <Pill className={pay.cls}>{pay.label}</Pill>
                    </div>
                    {a.status === 'ASSIGNED' && (
                      <button
                        onClick={() => actOn(id, 'accept', 'Engagement accepted!')}
                        disabled={acting === id + 'accept'}
                        className="w-full inline-flex items-center justify-center gap-1.5 px-3 py-2 bg-gray-900 text-white text-xs font-medium rounded-lg disabled:opacity-50"
                      >
                        {acting === id + 'accept' && <Loader2 className="w-3 h-3 animate-spin" />}
                        Accept
                      </button>
                    )}
                  </div>
                )
              })}
            </div>
          </>
        )}
      </div>

      {/* Salary payouts */}
      {salaryPayouts.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 sm:px-6 py-4 border-b border-gray-100 flex items-center gap-2">
            <CalendarClock className="w-4 h-4 text-indigo-500" />
            <h2 className="text-sm font-semibold text-gray-900">Salary Payouts</h2>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px]">
              <thead>
                <tr className="border-b border-gray-100">
                  {['Period', 'Amount', 'Status'].map(h => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {salaryPayouts.map(p => (
                  <tr key={p.id ?? p._id} className="hover:bg-gray-50/50">
                    <td className="px-5 py-3 text-sm text-gray-700">{p.period}</td>
                    <td className="px-5 py-3 text-sm font-medium text-gray-900">{formatCurrency(p.amount, p.currency)}</td>
                    <td className="px-5 py-3">
                      <Pill className={p.status === 'PAID'
                        ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/10'
                        : p.status === 'CANCELLED'
                          ? 'bg-rose-50 text-rose-600 ring-rose-600/10'
                          : 'bg-amber-50 text-amber-700 ring-amber-600/10'}>
                        {p.status}
                      </Pill>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  )
}
