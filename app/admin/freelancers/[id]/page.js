'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import {
  ArrowLeft, Mail, Phone, Star, Wallet, Clock, Pencil,
  TrendingUp, TrendingDown, CheckCircle, XCircle, Loader2, BanknoteIcon
} from 'lucide-react'
import Avatar from '@/components/ui/Avatar'
import Badge from '@/components/ui/Badge'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import FreelancerModal from '@/components/admin/freelancers/FreelancerModal'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'

const TABS = ['Overview', 'Tasks', 'Timesheets', 'Assignments', 'Wallet', 'Withdrawals']

const walletSchema = z.object({
  type:        z.enum(['credit', 'debit']),
  amount:      z.coerce.number().positive('Must be > 0'),
  description: z.string().min(1, 'Required'),
})

const directPaySchema = z.object({
  amount:       z.coerce.number().positive('Must be > 0'),
  method:       z.string().min(1, 'Required'),
  reference:    z.string().optional(),
  note:         z.string().optional(),
})

function StatBox({ label, value, color = 'blue' }) {
  const colors = {
    blue:   'bg-blue-50 text-blue-700',
    green:  'bg-green-50 text-green-700',
    yellow: 'bg-yellow-50 text-yellow-700',
    purple: 'bg-purple-50 text-purple-700',
  }
  return (
    <div className={`rounded-xl p-4 ${colors[color]}`}>
      <p className="text-xs font-medium opacity-70">{label}</p>
      <p className="text-2xl font-bold mt-1">{value}</p>
    </div>
  )
}

function WalletModal({ open, onOpenChange, freelancerId, balance, onDone }) {
  const { register, handleSubmit, watch, reset, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(walletSchema),
    defaultValues: { type: 'credit' },
  })
  const type = watch('type')

  useEffect(() => { if (open) reset({ type: 'credit' }) }, [open, reset])

  async function onSubmit(data) {
    const res  = await fetch(`/api/freelancers/${freelancerId}/wallet`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error ?? 'Failed')
    onDone()
    onOpenChange(false)
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Wallet Adjustment" size="sm"
      description={`Current balance: $${(balance ?? 0).toLocaleString()}`}>
      <form id="wallet-form" onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Action</label>
          <div className="flex gap-3">
            {[{ value: 'credit', label: '+ Credit' }, { value: 'debit', label: '− Debit' }].map((t) => (
              <label key={t.value} className="flex-1 flex items-center gap-2 p-3 border rounded-lg cursor-pointer has-[:checked]:border-blue-500 has-[:checked]:bg-blue-50 transition-colors">
                <input type="radio" value={t.value} {...register('type')} className="accent-blue-600" />
                <span className="text-sm font-medium">{t.label}</span>
              </label>
            ))}
          </div>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Amount ($)</label>
          <input type="number" step="0.01" placeholder="0.00" {...register('amount')}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          {errors.amount && <p className="mt-1 text-xs text-red-500">{errors.amount.message}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
          <input placeholder="Reason for adjustment…" {...register('description')}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          {errors.description && <p className="mt-1 text-xs text-red-500">{errors.description.message}</p>}
        </div>
      </form>
      <ModalFooter>
        <button type="button" onClick={() => onOpenChange(false)}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
          Cancel
        </button>
        <button type="submit" form="wallet-form" disabled={isSubmitting}
          className={`px-4 py-2 text-sm font-medium text-white rounded-lg disabled:opacity-60 transition-colors flex items-center gap-2 ${type === 'credit' ? 'bg-green-600 hover:bg-green-700' : 'bg-red-600 hover:bg-red-700'}`}>
          {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
          {type === 'credit' ? 'Add Credit' : 'Deduct'}
        </button>
      </ModalFooter>
    </Modal>
  )
}

const PAY_METHODS = ['BKASH', 'BANK', 'CASH', 'CHEQUE', 'ONLINE', 'OTHER']

function DirectPayModal({ open, onOpenChange, freelancerId, assignment, onDone }) {
  const { register, handleSubmit, reset, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(directPaySchema),
    defaultValues: { method: 'BKASH', reference: '', note: '' },
  })

  useEffect(() => {
    if (open) reset({
      amount: assignment?.paymentAmount ?? '',
      method: 'BKASH',
      reference: '',
      note: '',
    })
  }, [open, assignment, reset])

  async function onSubmit(data) {
    const res  = await fetch('/api/admin/direct-payment', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        freelancerId,
        amount:      Number(data.amount),
        method:      data.method,
        reference:   data.reference,
        note:        data.note,
        projectId:   assignment?.projectId?._id ?? assignment?.projectId ?? null,
        assignmentId: assignment?.id ?? assignment?._id ?? null,
      }),
    })
    const json = await res.json()
    if (!res.ok) throw new Error(json.error ?? 'Payment failed')
    onDone()
    onOpenChange(false)
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Direct Payment" size="sm"
      description={assignment?.projectId?.name ? `Project: ${assignment.projectId.name}` : 'Pay freelancer directly'}>
      <form id="direct-pay-form" onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Amount (৳)</label>
          <input type="number" step="0.01" placeholder="0.00" {...register('amount')}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          {errors.amount && <p className="mt-1 text-xs text-red-500">{errors.amount.message}</p>}
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Payment Method</label>
          <select {...register('method')}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            {PAY_METHODS.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Reference / TxID <span className="text-gray-400 font-normal">(optional)</span></label>
          <input placeholder="e.g. TXN1234, cheque no..." {...register('reference')}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Note <span className="text-gray-400 font-normal">(optional)</span></label>
          <input placeholder="Reason or description…" {...register('note')}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
      </form>
      <ModalFooter>
        <button type="button" onClick={() => onOpenChange(false)}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
          Cancel
        </button>
        <button type="submit" form="direct-pay-form" disabled={isSubmitting}
          className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg disabled:opacity-60 transition-colors flex items-center gap-2">
          {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
          Pay Now
        </button>
      </ModalFooter>
    </Modal>
  )
}

export default function FreelancerDetailPage() {
  const { id }  = useParams()
  const router  = useRouter()
  const [data,         setData]         = useState(null)
  const [wallet,       setWallet]       = useState(null)
  const [assignments,  setAssignments]  = useState([])
  const [loading,      setLoading]      = useState(true)
  const [tab,          setTab]          = useState('Overview')
  const [editOpen,          setEditOpen]          = useState(false)
  const [walletOpen,        setWalletOpen]        = useState(false)
  const [approving,         setApproving]         = useState(null)
  const [directPayOpen,     setDirectPayOpen]     = useState(false)
  const [directPayAssign,   setDirectPayAssign]   = useState(null)

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

  const loadWallet = useCallback(async () => {
    try {
      const res  = await fetch(`/api/freelancers/${id}/wallet`)
      const json = await res.json()
      if (res.ok) setWallet(json.data)
    } catch { /* silent */ }
  }, [id])

  const loadAssignments = useCallback(async () => {
    try {
      const res  = await fetch(`/api/freelancer-assignments?freelancerId=${id}`)
      const json = await res.json()
      if (res.ok) setAssignments(json.data ?? [])
    } catch { /* silent */ }
  }, [id])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (tab === 'Wallet')       loadWallet()      }, [tab, loadWallet])
  useEffect(() => { if (tab === 'Assignments')  loadAssignments() }, [tab, loadAssignments])

  async function handleWithdrawal(requestId, action) {
    setApproving(requestId)
    try {
      const res  = await fetch(`/api/freelancers/${id}/withdrawals?requestId=${requestId}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success(`Withdrawal ${action === 'approve' ? 'approved' : 'rejected'}`)
      load()
    } catch (err) {
      toast.error(err.message ?? 'Failed')
    } finally {
      setApproving(null)
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

  const { userId: user, tasks = [], timesheets = [], withdrawals = [], earnings = [] } = data
  const totalEarned    = earnings.filter(e => e.amount > 0).reduce((s, e) => s + e.amount, 0)
  const pendingPayouts = withdrawals.filter(w => w.status === 'PENDING').length
  const totalHours     = timesheets.reduce((s, t) => s + (t.hours ?? 0), 0)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-4">
          <button onClick={() => router.back()} className="p-2 rounded-lg hover:bg-gray-100 transition-colors text-gray-500">
            <ArrowLeft className="w-5 h-5" />
          </button>
          <Avatar name={user?.name} src={user?.avatar} size="lg" />
          <div>
            <div className="flex items-center gap-2">
              <h1 className="text-xl font-bold text-gray-900">{user?.name}</h1>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${user?.isActive ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                {user?.isActive ? 'Active' : 'Inactive'}
              </span>
            </div>
            {data.skills && <p className="text-sm text-gray-500 mt-0.5">{data.skills}</p>}
            {data.hourlyRate && (
              <p className="text-xs text-gray-400 flex items-center gap-1 mt-0.5">
                <Star className="w-3 h-3 text-yellow-400 fill-yellow-400" />
                ${data.hourlyRate}/{data.rateType?.toLowerCase() ?? 'hr'}
              </p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setEditOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">
            <Pencil className="w-4 h-4" /> Edit
          </button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatBox label="Wallet Balance"   value={`$${(data.walletBalance ?? 0).toLocaleString()}`} color="green"  />
        <StatBox label="Total Earned"     value={`$${totalEarned.toLocaleString()}`}               color="blue"   />
        <StatBox label="Hours Logged"     value={`${totalHours.toFixed(1)}h`}                      color="purple" />
        <StatBox label="Pending Payouts"  value={pendingPayouts}                                   color="yellow" />
      </div>

      {/* Tabs */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex border-b border-gray-100 overflow-x-auto">
          {TABS.map((t) => (
            <button key={t} onClick={() => setTab(t)}
              className={`px-5 py-3.5 text-sm font-medium whitespace-nowrap transition-colors relative ${
                tab === t ? 'text-blue-600 border-b-2 border-blue-600 -mb-px' : 'text-gray-500 hover:text-gray-700'
              }`}>
              {t}
              {t === 'Withdrawals' && pendingPayouts > 0 && (
                <span className="ml-1.5 px-1.5 py-0.5 text-xs bg-red-500 text-white rounded-full">{pendingPayouts}</span>
              )}
            </button>
          ))}
        </div>

        <div className="p-6">
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
              </div>
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Payment Methods</h3>
                {[
                  { label: 'PayPal',       value: data.paypalEmail },
                  { label: 'bKash',        value: data.bkashNumber },
                  { label: 'Bank Details', value: data.bankDetails },
                ].map(({ label, value }) => value ? (
                  <div key={label}>
                    <p className="text-xs text-gray-400">{label}</p>
                    <p className="text-sm font-medium text-gray-900 mt-0.5">{value}</p>
                  </div>
                ) : null)}
                {!data.paypalEmail && !data.bkashNumber && !data.bankDetails && (
                  <p className="text-sm text-gray-400">No payment methods configured</p>
                )}
              </div>
            </div>
          )}

          {/* ASSIGNMENTS */}
          {tab === 'Assignments' && (
            assignments.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-400">No assignments found</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[600px]">
                  <thead>
                    <tr className="border-b border-gray-100">
                      {['Project', 'Payment', 'Status', 'Payment Status', 'Date', ''].map(h => (
                        <th key={h} className="pb-3 text-left text-xs font-semibold text-gray-400 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {assignments.map(a => {
                      const ASSIGN_COLORS = {
                        ASSIGNED: 'bg-blue-100 text-blue-700', ACCEPTED: 'bg-teal-100 text-teal-700',
                        IN_PROGRESS: 'bg-purple-100 text-purple-700', COMPLETED: 'bg-green-100 text-green-700', CANCELLED: 'bg-red-100 text-red-600',
                      }
                      const PAY_COLORS = {
                        PENDING: 'bg-yellow-100 text-yellow-700', IN_WALLET: 'bg-green-100 text-green-700',
                        WITHDRAWAL_REQUESTED: 'bg-blue-100 text-blue-700', PAID: 'bg-gray-100 text-gray-600',
                      }
                      return (
                        <tr key={a.id ?? a._id} className="hover:bg-gray-50 transition-colors">
                          <td className="py-3 pr-4">
                            <p className="text-sm font-medium text-gray-900">{a.projectId?.name ?? '—'}</p>
                            {a.projectId?.projectCode && <p className="text-xs text-gray-400 font-mono">{a.projectId.projectCode}</p>}
                          </td>
                          <td className="py-3 pr-4 text-sm font-medium text-gray-900">
                            ৳{(a.paymentAmount ?? 0).toLocaleString('en-BD', { minimumFractionDigits: 2 })}
                          </td>
                          <td className="py-3 pr-4">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${ASSIGN_COLORS[a.status] ?? 'bg-gray-100 text-gray-600'}`}>
                              {a.status?.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="py-3 pr-4">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${PAY_COLORS[a.paymentStatus] ?? 'bg-gray-100 text-gray-600'}`}>
                              {a.paymentStatus?.replace('_', ' ') ?? 'PENDING'}
                            </span>
                          </td>
                          <td className="py-3 text-sm text-gray-400">
                            {a.createdAt ? new Date(a.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'}
                          </td>
                          <td className="py-3">
                            {a.paymentStatus !== 'PAID' && (
                              <button
                                onClick={() => { setDirectPayAssign(a); setDirectPayOpen(true) }}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-lg hover:bg-blue-700 transition-colors">
                                <BanknoteIcon className="w-3.5 h-3.5" /> Pay Now
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

          {/* TASKS */}
          {tab === 'Tasks' && (
            tasks.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-400">No tasks assigned</p>
              </div>
            ) : (
              <div className="space-y-2">
                {tasks.map((t) => (
                  <div key={t.id ?? t._id} className="flex items-center gap-4 p-4 rounded-xl border border-gray-100 hover:bg-gray-50 transition-colors">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">{t.title}</p>
                      {t.projectId?.name && <p className="text-xs text-gray-400 mt-0.5">{t.projectId.name}</p>}
                    </div>
                    <div className="flex items-center gap-3 shrink-0">
                      {t.dueDate && (
                        <span className="text-xs text-gray-400">{new Date(t.dueDate).toLocaleDateString()}</span>
                      )}
                      <Badge status={t.status} />
                    </div>
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
                      <td className="py-3 text-sm text-gray-500">{new Date(ts.date).toLocaleDateString()}</td>
                      <td className="py-3">
                        <p className="text-sm text-gray-900">{ts.taskId?.title ?? '—'}</p>
                        {ts.taskId?.projectId?.name && <p className="text-xs text-gray-400">{ts.taskId.projectId.name}</p>}
                        {ts.description && <p className="text-xs text-gray-400 mt-0.5">{ts.description}</p>}
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

          {/* WALLET */}
          {tab === 'Wallet' && (
            <div className="space-y-6">
              <div className="flex items-center justify-between">
                <div className="bg-gradient-to-r from-blue-600 to-blue-700 text-white rounded-xl px-6 py-5 flex-1 mr-4">
                  <p className="text-blue-200 text-sm">Available Balance</p>
                  <p className="text-3xl font-bold mt-1">${(data.walletBalance ?? 0).toLocaleString()}</p>
                </div>
                <button onClick={() => setWalletOpen(true)}
                  className="flex items-center gap-2 px-4 py-2 bg-white border border-gray-200 text-gray-700 text-sm font-medium rounded-lg hover:bg-gray-50 transition-colors">
                  <Wallet className="w-4 h-4" /> Adjust
                </button>
              </div>

              {wallet ? (
                wallet.transactions.length === 0 ? (
                  <p className="text-center text-gray-400 py-8">No wallet transactions</p>
                ) : (
                  <div className="space-y-2">
                    {wallet.transactions.map((tx) => (
                      <div key={tx.id} className="flex items-center gap-3 p-3 rounded-lg border border-gray-100">
                        <div className={`w-8 h-8 rounded-full flex items-center justify-center ${tx.type === 'debit' ? 'bg-red-100' : 'bg-green-100'}`}>
                          {tx.type === 'debit'
                            ? <TrendingDown className="w-4 h-4 text-red-500" />
                            : <TrendingUp className="w-4 h-4 text-green-600" />}
                        </div>
                        <div className="flex-1">
                          <p className="text-sm font-medium text-gray-900">{tx.description}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <p className="text-xs text-gray-400">{new Date(tx.date).toLocaleDateString()}</p>
                            {tx.type === 'direct_payment' && (
                              <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-medium">Direct Pay</span>
                            )}
                          </div>
                        </div>
                        <span className={`text-sm font-semibold ${tx.type === 'debit' ? 'text-red-500' : 'text-green-600'}`}>
                          {tx.type === 'debit' ? '-' : '+'}৳{tx.amount.toLocaleString()}
                        </span>
                      </div>
                    ))}
                  </div>
                )
              ) : (
                <div className="text-center py-8">
                  <div className="w-6 h-6 border-2 border-blue-600 border-t-transparent rounded-full animate-spin mx-auto" />
                </div>
              )}
            </div>
          )}

          {/* WITHDRAWALS */}
          {tab === 'Withdrawals' && (
            withdrawals.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-gray-400">No withdrawal requests</p>
              </div>
            ) : (
              <div className="space-y-3">
                {withdrawals.map((w) => (
                  <div key={w.id ?? w._id} className="flex items-center gap-4 p-4 rounded-xl border border-gray-100">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-semibold text-gray-900">৳{w.amount.toLocaleString()}</p>
                        <Badge status={w.status} />
                        {w.isDirectPayment && (
                          <span className="text-xs bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full font-medium">Direct Pay</span>
                        )}
                      </div>
                      <p className="text-xs text-gray-400 mt-0.5">
                        via {w.method} · {new Date(w.createdAt).toLocaleDateString()}
                      </p>
                      {w.adminNote && <p className="text-xs text-gray-500 mt-1 italic">{w.adminNote}</p>}
                    </div>
                    {w.status === 'PENDING' && (
                      <div className="flex items-center gap-2 shrink-0">
                        <button
                          onClick={() => handleWithdrawal(w.id ?? w._id, 'approve')}
                          disabled={approving === (w.id ?? w._id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 disabled:opacity-60 transition-colors"
                        >
                          {approving === (w.id ?? w._id) ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle className="w-3.5 h-3.5" />}
                          Approve
                        </button>
                        <button
                          onClick={() => handleWithdrawal(w.id ?? w._id, 'reject')}
                          disabled={approving === (w.id ?? w._id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-white border border-gray-200 text-red-600 text-xs font-medium rounded-lg hover:bg-red-50 disabled:opacity-60 transition-colors"
                        >
                          <XCircle className="w-3.5 h-3.5" /> Reject
                        </button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )
          )}
        </div>
      </div>

      <FreelancerModal
        open={editOpen}
        onOpenChange={setEditOpen}
        freelancer={data}
        onSaved={() => { toast.success('Freelancer updated'); load() }}
      />

      <WalletModal
        open={walletOpen}
        onOpenChange={setWalletOpen}
        freelancerId={id}
        balance={data.walletBalance}
        onDone={() => { load(); loadWallet(); toast.success('Wallet updated') }}
      />

      <DirectPayModal
        open={directPayOpen}
        onOpenChange={setDirectPayOpen}
        freelancerId={id}
        assignment={directPayAssign}
        onDone={() => {
          toast.success('Payment recorded')
          loadAssignments()
          loadWallet()
        }}
      />
    </div>
  )
}
