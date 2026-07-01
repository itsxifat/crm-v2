'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import {
  ArrowLeft, Mail, Phone, Clock, Pencil, Ban, RotateCcw, Loader2,
  CheckCircle2, Send, CalendarClock,
} from 'lucide-react'
import Avatar from '@/components/ui/Avatar'
import Badge from '@/components/ui/Badge'
import FreelancerModal from '@/components/admin/freelancers/FreelancerModal'
import { formatCurrency } from '@/lib/utils'

const TABS = ['Overview', 'Engagements', 'Payments', 'Timesheets']

function moneyByCurrency(totals) {
  if (!totals || totals.length === 0) return formatCurrency(0)
  return totals.map(t => formatCurrency(t.total, t.currency)).join('  ·  ')
}

const ASSIGN_COLORS = {
  ASSIGNED: 'bg-blue-50 text-blue-700', ACCEPTED: 'bg-teal-50 text-teal-700',
  IN_PROGRESS: 'bg-violet-50 text-violet-700', COMPLETED: 'bg-emerald-50 text-emerald-700',
  CANCELLED: 'bg-rose-50 text-rose-600',
}
const PAY_LABEL = {
  PENDING: { label: 'Not requested', cls: 'bg-gray-50 text-gray-500' },
  PAYMENT_REQUESTED: { label: 'Awaiting payment', cls: 'bg-amber-50 text-amber-700' },
  PAID: { label: 'Paid', cls: 'bg-emerald-50 text-emerald-700' },
  NOT_REQUIRED: { label: 'Salary', cls: 'bg-indigo-50 text-indigo-700' },
}

function StatBox({ label, value, hint, color }) {
  return (
    <div className="rounded-2xl border border-gray-100 bg-white p-4 sm:p-5 shadow-sm">
      <p className={`text-xs font-medium uppercase tracking-wide ${color}`}>{label}</p>
      <p className="text-lg sm:text-xl font-bold text-gray-900 mt-1.5 break-words">{value}</p>
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  )
}

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
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
    try {
      const res  = await fetch(`/api/admin/salary-payouts/${p.id ?? p._id}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
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

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
      </div>
    )
  }
  if (!data) {
    return (
      <div className="text-center py-20">
        <p className="text-gray-500">Freelancer not found.</p>
        <Link href="/admin/freelancers" className="text-blue-600 text-sm mt-2 inline-block hover:underline">Back to Freelancers</Link>
      </div>
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
    <div className="space-y-6 mx-auto w-full max-w-6xl">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-4">
        <div className="flex items-center gap-4">
          <button onClick={() => router.back()} className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-500">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <Avatar name={user?.name} src={user?.avatar} size="lg" />
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-gray-900">{user?.name}</h1>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${disabled ? 'bg-rose-100 text-rose-700' : 'bg-green-100 text-green-700'}`}>
                {disabled ? 'Disabled' : 'Active'}
              </span>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${isSalary ? 'bg-indigo-100 text-indigo-700' : 'bg-gray-100 text-gray-600'}`}>
                {isSalary ? 'Salary' : 'Project'} · {data.paymentCurrency ?? 'BDT'}
              </span>
            </div>
            {data.skills && <p className="text-sm text-gray-500 mt-0.5">{data.skills}</p>}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setEditOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">
            <Pencil className="w-4 h-4" /> Edit
          </button>
          {disabled ? (
            <button onClick={() => toggleDisable(false)}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-emerald-700 text-sm font-medium rounded-lg hover:bg-emerald-50 transition-colors">
              <RotateCcw className="w-4 h-4" /> Reactivate
            </button>
          ) : (
            <button onClick={() => toggleDisable(true)} disabled={finance.hasUnpaid}
              title={finance.hasUnpaid ? 'Settle outstanding dues first' : ''}
              className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-rose-600 text-sm font-medium rounded-lg hover:bg-rose-50 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
              <Ban className="w-4 h-4" /> Disable
            </button>
          )}
        </div>
      </div>

      {/* Money buckets */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <StatBox label="In progress" value={moneyByCurrency(finance.accepted)} hint="Accepted, not delivered" color="text-violet-600" />
        <StatBox label="Owed" value={moneyByCurrency(finance.owed)} hint="Delivered / requested, unpaid" color="text-amber-600" />
        <StatBox label="Total paid" value={moneyByCurrency(finance.paid)} hint="Settled to date" color="text-emerald-600" />
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex border-b border-gray-100 overflow-x-auto">
          {[...TABS, ...(isSalary ? ['Salary'] : [])].map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-5 py-3.5 text-sm font-medium whitespace-nowrap transition-colors relative ${
                tab === t ? 'text-blue-600 border-b-2 border-blue-600 -mb-px' : 'text-gray-500 hover:text-gray-700'
              }`}>
              {t}
            </button>
          ))}
        </div>

        <div className="p-5 sm:p-6">
          {/* OVERVIEW */}
          {tab === 'Overview' && (
            <div className="grid lg:grid-cols-2 gap-8">
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Contact</h3>
                {[
                  { icon: Mail,  label: 'Email', value: user?.email },
                  { icon: Phone, label: 'Phone', value: user?.phone },
                ].map(({ icon: Icon, label, value }) => value ? (
                  <div key={label} className="flex items-center gap-3">
                    <Icon className="w-4 h-4 text-gray-400 shrink-0" />
                    <div>
                      <p className="text-xs text-gray-400">{label}</p>
                      <p className="text-sm font-medium text-gray-900">{value}</p>
                    </div>
                  </div>
                ) : null)}
                {data.bio && (
                  <div>
                    <p className="text-xs text-gray-400 mb-1">Bio</p>
                    <p className="text-sm text-gray-600">{data.bio}</p>
                  </div>
                )}
                {disabled && data.disabledReason && (
                  <div className="rounded-lg bg-rose-50 border border-rose-100 p-3">
                    <p className="text-xs text-rose-600 font-medium">Disabled</p>
                    <p className="text-sm text-rose-700 mt-0.5">{data.disabledReason}</p>
                  </div>
                )}
              </div>
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Engagement</h3>
                <div>
                  <p className="text-xs text-gray-400">Mode</p>
                  <p className="text-sm font-medium text-gray-900 mt-0.5">{isSalary ? 'Monthly salary' : 'Per project / task'}</p>
                </div>
                <div>
                  <p className="text-xs text-gray-400">Default payment currency</p>
                  <p className="text-sm font-medium text-gray-900 mt-0.5">{data.paymentCurrency ?? 'BDT'}</p>
                </div>
                {isSalary && (
                  <div className="rounded-xl bg-indigo-50/60 border border-indigo-100 p-4 space-y-1.5">
                    <p className="text-sm font-semibold text-gray-900">{formatCurrency(data.salaryAmount, data.salaryCurrency)} / month</p>
                    <p className="text-xs text-gray-500">Pays on day {data.salaryDay ?? '—'} of each month</p>
                    <p className="text-xs text-gray-400">
                      {fmtDate(data.salaryStartDate)} → {data.salaryEndDate ? fmtDate(data.salaryEndDate) : 'ongoing'}
                      {' · '}{data.salaryActive ? 'Active' : 'Paused'}
                    </p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ENGAGEMENTS */}
          {tab === 'Engagements' && (
            assignments.length === 0 ? (
              <div className="text-center py-12"><p className="text-gray-400">No engagements yet</p></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px]">
                  <thead>
                    <tr className="border-b border-gray-100">
                      {['Project', 'Amount', 'Stage', 'Payment', 'Date', 'Action'].map(h => (
                        <th key={h} className="pb-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {assignments.map(a => {
                      const aid = a.id ?? a._id
                      const pay = PAY_LABEL[a.paymentStatus] ?? PAY_LABEL.PENDING
                      return (
                        <tr key={aid} className="hover:bg-gray-50 transition-colors">
                          <td className="py-3 pr-4">
                            <p className="text-sm font-medium text-gray-900">{a.projectId?.name ?? '—'}</p>
                            {a.projectId?.projectCode && <p className="text-xs text-gray-400 font-mono">{a.projectId.projectCode}</p>}
                          </td>
                          <td className="py-3 pr-4 text-sm font-medium text-gray-900">
                            {a.paymentAmount ? formatCurrency(a.paymentAmount, a.currency) : '—'}
                          </td>
                          <td className="py-3 pr-4">
                            <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${ASSIGN_COLORS[a.status] ?? 'bg-gray-50 text-gray-600'}`}>
                              {a.status?.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="py-3 pr-4">
                            <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${pay.cls}`}>{pay.label}</span>
                          </td>
                          <td className="py-3 pr-4 text-sm text-gray-400">{fmtDate(a.createdAt)}</td>
                          <td className="py-3">
                            {['ACCEPTED', 'IN_PROGRESS'].includes(a.status) && (
                              <button onClick={() => assignmentAction(aid, 'complete', 'Marked delivered')}
                                disabled={acting === aid + 'complete'}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-50 disabled:opacity-50">
                                {acting === aid + 'complete' && <Loader2 className="w-3 h-3 animate-spin" />}
                                <CheckCircle2 className="w-3.5 h-3.5" /> Mark done
                              </button>
                            )}
                            {a.status === 'COMPLETED' && a.paymentStatus === 'PENDING' && a.paymentAmount > 0 && (
                              <button onClick={() => assignmentAction(aid, 'request_payment', 'Sent to payment')}
                                disabled={acting === aid + 'request_payment'}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 disabled:opacity-50">
                                {acting === aid + 'request_payment' && <Loader2 className="w-3 h-3 animate-spin" />}
                                <Send className="w-3.5 h-3.5" /> Send to payment
                              </button>
                            )}
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )
          )}

          {/* PAYMENTS */}
          {tab === 'Payments' && (
            paidHistory.length === 0 && salaryPayouts.filter(p => p.status === 'PAID').length === 0 ? (
              <div className="text-center py-12"><p className="text-gray-400">No payments yet</p></div>
            ) : (
              <div className="space-y-2">
                {paidHistory.map(a => (
                  <div key={a.id ?? a._id} className="flex items-center justify-between gap-4 p-4 rounded-xl border border-gray-100">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900 truncate">{a.projectId?.name ?? 'Project'}</p>
                      <p className="text-xs text-gray-400">Paid · {fmtDate(a.approvedAt ?? a.updatedAt)}</p>
                    </div>
                    <p className="text-sm font-semibold text-emerald-600 shrink-0">{formatCurrency(a.paymentAmount, a.currency)}</p>
                  </div>
                ))}
                {salaryPayouts.filter(p => p.status === 'PAID').map(p => (
                  <div key={p.id ?? p._id} className="flex items-center justify-between gap-4 p-4 rounded-xl border border-gray-100">
                    <div>
                      <p className="text-sm font-medium text-gray-900">Salary · {p.period}</p>
                      <p className="text-xs text-gray-400">Paid · {fmtDate(p.approvedAt)}</p>
                    </div>
                    <p className="text-sm font-semibold text-emerald-600 shrink-0">{formatCurrency(p.amount, p.currency)}</p>
                  </div>
                ))}
              </div>
            )
          )}

          {/* TIMESHEETS */}
          {tab === 'Timesheets' && (
            timesheets.length === 0 ? (
              <div className="text-center py-12">
                <Clock className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                <p className="text-gray-400">No timesheets logged</p>
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="pb-3 text-left text-xs font-semibold text-gray-500 uppercase">Date</th>
                    <th className="pb-3 text-left text-xs font-semibold text-gray-500 uppercase">Task</th>
                    <th className="pb-3 text-right text-xs font-semibold text-gray-500 uppercase">Hours</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {timesheets.map((ts) => (
                    <tr key={ts.id ?? ts._id} className="hover:bg-gray-50">
                      <td className="py-3 text-sm text-gray-500">{fmtDate(ts.date)}</td>
                      <td className="py-3">
                        <p className="text-sm text-gray-900">{ts.taskId?.title ?? '—'}</p>
                        {ts.taskId?.projectId?.name && <p className="text-xs text-gray-400">{ts.taskId.projectId.name}</p>}
                      </td>
                      <td className="py-3 text-sm font-semibold text-gray-900 text-right">{ts.hours}h</td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="border-t-2 border-gray-200">
                    <td colSpan={2} className="py-3 text-sm font-semibold text-gray-700">Total</td>
                    <td className="py-3 text-sm font-bold text-gray-900 text-right">{totalHours.toFixed(1)}h</td>
                  </tr>
                </tfoot>
              </table>
            )
          )}

          {/* SALARY */}
          {tab === 'Salary' && isSalary && (
            <div className="space-y-5">
              <div className="flex items-center justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2">
                  <CalendarClock className="w-4 h-4 text-indigo-500" />
                  <h3 className="text-sm font-semibold text-gray-700">Salary Payouts</h3>
                </div>
                <button onClick={generateSalary}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 text-gray-700 text-xs font-medium rounded-lg hover:bg-gray-50">
                  <RotateCcw className="w-3.5 h-3.5" /> Generate due payouts
                </button>
              </div>
              <p className="text-xs text-gray-400">
                Payouts are created automatically on day {data.salaryDay ?? '—'} each month. Use “Generate due payouts” to run it now.
              </p>
              {salaryPayouts.length === 0 ? (
                <p className="text-gray-400 text-sm">No payouts yet.</p>
              ) : (
                <div className="space-y-2">
                  {salaryPayouts.map(p => (
                    <div key={p.id ?? p._id} className="flex items-center justify-between gap-4 p-4 rounded-xl border border-gray-100">
                      <div>
                        <p className="text-sm font-medium text-gray-900">{p.period}</p>
                        <p className="text-xs text-gray-400">{p.status === 'PAID' ? `Paid · ${fmtDate(p.approvedAt)}` : p.status}</p>
                      </div>
                      <div className="flex items-center gap-3">
                        <p className="text-sm font-semibold text-gray-900">{formatCurrency(p.amount, p.currency)}</p>
                        {p.status === 'PENDING' ? (
                          <div className="flex items-center gap-2">
                            <Link href="/admin/accounts?tab=requests"
                              className="px-2.5 py-1 bg-white border border-gray-200 text-gray-600 text-xs font-medium rounded-lg hover:bg-gray-50">Approve in Expenses →</Link>
                            <button onClick={() => payoutAction(p, 'cancel')}
                              className="px-2.5 py-1 bg-white border border-gray-200 text-rose-600 text-xs font-medium rounded-lg hover:bg-rose-50">Cancel</button>
                          </div>
                        ) : (
                          <Badge status={p.status} />
                        )}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
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
