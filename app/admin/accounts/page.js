'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSearchParams } from 'next/navigation'
import { useSession } from 'next-auth/react'
import {
  TrendingUp, TrendingDown, DollarSign, AlertCircle,
  Plus, Pencil, Trash2, X, Loader2, Clock, CheckCircle2, XCircle,
  Paperclip, ExternalLink, ArrowUpRight, ArrowDownRight, BarChart2, Percent, FileText as FileTextIcon, ChevronLeft,
} from 'lucide-react'
import toast from 'react-hot-toast'
import {
  BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, PieChart, Pie, Cell, Legend
} from 'recharts'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Pagination from '@/components/ui/Pagination'
import FileUpload from '@/components/ui/FileUpload'
import Link from 'next/link'
import TkAmt from '@/components/ui/TkAmt'

// ─── Constants ───────────────────────────────────────────────────────────────

const INCOME_CATEGORIES  = ['Project Revenue', 'Retainer', 'Consulting', 'Product Sale', 'Referral', 'Other Income']
const EXPENSE_CATEGORIES = ['Payroll', 'Freelancer Payment', 'Software', 'Marketing', 'Office', 'Travel', 'Tax', 'Vendor Payment', 'Other Expense']
const CURRENCY_OPTIONS   = ['BDT']
const PAYMENT_METHODS    = ['CASH', 'BANK_TRANSFER', 'CARD', 'CHEQUE', 'ONLINE', 'OTHER']
const PIE_COLORS         = ['#3B82F6','#10B981','#F59E0B','#EF4444','#8B5CF6','#EC4899','#06B6D4','#14B8A6']
const TABS               = ['Overview', 'Charts', 'Transactions', 'Payment Confirmations', 'Payment Requests', 'Withdrawals', 'P&L Report']

const VENTURE_COLORS = {
  ENSTUDIO: 'bg-purple-100 text-purple-700',
  ENTECH:   'bg-blue-100 text-blue-700',
  ENMARK:   'bg-green-100 text-green-700',
}

const txSchema = z.object({
  type:           z.enum(['INCOME', 'EXPENSE']),
  category:       z.string().min(1, 'Category required'),
  amount:         z.coerce.number().positive('Must be > 0'),
  description:    z.string().min(1, 'Description required'),
  date:           z.string().min(1, 'Date required'),
  reference:      z.string().optional(),
  currency:       z.string().default('BDT'),
  vendor:         z.string().optional(),
  paidBy:         z.string().optional(),
  accountManager: z.string().optional(),
  paymentMethod:  z.string().optional(),
  projectId:      z.string().optional(),
  receiptUrl:     z.string().optional(),
  txnId:          z.string().optional(),
  freelancerId:   z.string().optional(),
  vendorId:       z.string().optional(),
  paidTo:         z.string().optional(),
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt      = (n) => `৳ ${(n ?? 0).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const fmtDate  = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '—'
const fmtMonth = (key) => {
  const [y, m] = key.split('-')
  return new Date(+y, +m - 1).toLocaleString('default', { month: 'short', year: '2-digit' })
}

// ─── Status Dot Badge ─────────────────────────────────────────────────────────

function StatusDot({ status }) {
  const map = {
    INCOME:               { dot: 'bg-green-500',  label: 'Income' },
    EXPENSE:              { dot: 'bg-red-500',     label: 'Expense' },
    PENDING:              { dot: 'bg-yellow-400',  label: 'Pending' },
    APPROVED:             { dot: 'bg-green-500',   label: 'Approved' },
    REJECTED:             { dot: 'bg-red-500',     label: 'Rejected' },
    PENDING_CONFIRMATION: { dot: 'bg-yellow-400',  label: 'Pending' },
    CONFIRMED:            { dot: 'bg-green-500',   label: 'Confirmed' },
  }
  const s = map[status] ?? { dot: 'bg-gray-400', label: status }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
      <span className="text-xs text-gray-600">{s.label}</span>
    </span>
  )
}

// ─── Transaction Modal ────────────────────────────────────────────────────────

function TransactionModal({ open, onOpenChange, tx, onSaved, currentUser }) {
  const isEdit = !!tx
  const [receiptUrl,  setReceiptUrl]  = useState('')
  const [projects,    setProjects]    = useState([])
  const [users,       setUsers]       = useState([])
  const [freelancers, setFreelancers] = useState([])
  const [employees,   setEmployees]   = useState([])
  const [vendors,     setVendors]     = useState([])
  const [txnIdVal,    setTxnIdVal]    = useState('')

  const { register, handleSubmit, watch, reset, setValue, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(txSchema),
    defaultValues: { type: 'INCOME', currency: 'USD', date: new Date().toISOString().slice(0,10) },
  })
  const type       = watch('type')
  const category   = watch('category')
  const categories = type === 'INCOME' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES

  // Dynamic entity label/selector based on category
  const isFreelancerPayment = type === 'EXPENSE' && category === 'Freelancer Payment'
  const isPayroll           = type === 'EXPENSE' && (category === 'Payroll' || category === 'Employee Salary')
  const isVendorPayment     = type === 'EXPENSE' && category === 'Vendor Payment'

  useEffect(() => {
    if (open) {
      fetch('/api/projects?limit=200').then(r => r.json()).then(j => setProjects(j.data ?? []))
      fetch('/api/users?limit=100').then(r => r.json()).then(j => setUsers(j.data ?? []))
      fetch('/api/freelancers?limit=200').then(r => r.json()).then(j => setFreelancers(j.data ?? []))
      fetch('/api/employees?limit=200').then(r => r.json()).then(j => setEmployees(j.data ?? []))
      fetch('/api/vendors?limit=200').then(r => r.json()).then(j => setVendors(j.data ?? []))
      const url = isEdit ? tx.receiptUrl ?? '' : ''
      setReceiptUrl(url)
      setTxnIdVal(isEdit ? tx.txnId ?? '' : '')
      reset(isEdit ? {
        type:           tx.type,
        category:       tx.category,
        amount:         tx.amount,
        description:    tx.description,
        date:           tx.date?.slice(0, 10),
        reference:      tx.reference ?? '',
        currency:       'BDT',
        vendor:         tx.vendor ?? '',
        paidBy:         tx.paidBy?.id ?? tx.paidBy ?? '',
        accountManager: tx.accountManager?.id ?? tx.accountManager ?? '',
        paymentMethod:  tx.paymentMethod ?? '',
        projectId:      tx.projectId?.id ?? tx.projectId ?? '',
        receiptUrl:     url,
        txnId:          tx.txnId ?? '',
      } : { type: 'INCOME', currency: 'BDT', date: new Date().toISOString().slice(0, 10), accountManager: currentUser?.id ?? '' })
    }
  }, [open, tx, isEdit, reset, currentUser])

  async function onSubmit(data) {
    if (!receiptUrl && !txnIdVal.trim()) {
      toast.error('Either upload a receipt OR enter a Transaction ID')
      return
    }
    const body = { ...data, receiptUrl: receiptUrl || null, txnId: txnIdVal.trim() || null }
    Object.keys(body).forEach(k => { if (body[k] === '') body[k] = null })
    const url    = isEdit ? `/api/transactions/${tx.id}` : '/api/transactions'
    const method = isEdit ? 'PUT' : 'POST'
    const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
    const json   = await res.json()
    if (!res.ok) throw new Error(json.error ?? 'Failed')
    onSaved()
    onOpenChange(false)
  }

  const ic = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-gray-900'
  const lc = 'block text-sm font-medium text-gray-700 mb-1'

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={isEdit ? 'Edit Transaction' : 'New Transaction'} size="lg">
      <form id="tx-form" onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* Type */}
        <div>
          <label className={lc}>Type</label>
          <div className="flex gap-3">
            {['INCOME', 'EXPENSE'].map((t) => (
              <label key={t} className="flex-1 flex items-center gap-2 p-3 border border-gray-200 rounded-lg cursor-pointer has-[:checked]:border-gray-900 has-[:checked]:bg-gray-50 transition-colors">
                <input type="radio" value={t} {...register('type')} className="accent-gray-900" />
                <span className="text-sm font-medium">{t === 'INCOME' ? 'Income' : 'Expense'}</span>
              </label>
            ))}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={lc}>Category *</label>
            <select {...register('category')} className={ic}>
              <option value="">Select…</option>
              {categories.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
            {errors.category && <p className="mt-1 text-xs text-red-500">{errors.category.message}</p>}
          </div>
          <div>
            <label className={lc}>Amount (BDT) *</label>
            <div className="flex gap-2 items-center">
              <span className="text-sm font-medium text-gray-500 border border-gray-200 rounded-lg px-3 py-2 bg-gray-50">BDT</span>
              <input type="number" step="0.01" placeholder="0.00" {...register('amount')}
                className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
            </div>
            {errors.amount && <p className="mt-1 text-xs text-red-500">{errors.amount.message}</p>}
          </div>
        </div>

        <div>
          <label className={lc}>Description *</label>
          <input {...register('description')} placeholder="e.g. Invoice payment from Acme Corp" className={ic} />
          {errors.description && <p className="mt-1 text-xs text-red-500">{errors.description.message}</p>}
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={lc}>Date *</label>
            <input type="date" {...register('date')} className={ic} />
            {errors.date && <p className="mt-1 text-xs text-red-500">{errors.date.message}</p>}
          </div>
          <div>
            <label className={lc}>Payment Method</label>
            <select {...register('paymentMethod')} className={ic}>
              <option value="">Select…</option>
              {PAYMENT_METHODS.map(m => <option key={m} value={m}>{m.replace('_',' ')}</option>)}
            </select>
          </div>
        </div>

        {/* Dynamic entity selector based on category */}
        {isFreelancerPayment && (
          <div>
            <label className={lc}>Freelancer *</label>
            <select {...register('freelancerId')} className={ic}>
              <option value="">Select freelancer…</option>
              {freelancers.map(f => (
                <option key={f.id} value={f.id}>
                  {f.userId?.name ?? f.id}{f.userId?.email ? ` — ${f.userId.email}` : ''}
                </option>
              ))}
            </select>
          </div>
        )}
        {isPayroll && (
          <div>
            <label className={lc}>Employee *</label>
            <select {...register('paidTo')} className={ic}>
              <option value="">Select employee…</option>
              {employees.map(e => (
                <option key={e.id} value={e.id}>
                  {e.userId?.name ?? e.id}{e.designation ? ` — ${e.designation}` : e.position ? ` — ${e.position}` : ''}
                  {e.salary ? ` (BDT ${Number(e.salary).toLocaleString()}/mo)` : ''}
                </option>
              ))}
            </select>
          </div>
        )}
        {isVendorPayment && (
          <div>
            <label className={lc}>Vendor *</label>
            <select {...register('vendorId')} className={ic}>
              <option value="">Select vendor…</option>
              {vendors.map(v => (
                <option key={v.id} value={v.id}>
                  {v.name}{v.category ? ` — ${v.category}` : ''}
                </option>
              ))}
            </select>
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={lc}>Vendor (manual)</label>
            <input {...register('vendor')} placeholder="Vendor / Supplier name" className={ic} />
          </div>
          <div>
            <label className={lc}>Paid By</label>
            <select {...register('paidBy')} className={ic}>
              <option value="">Select person…</option>
              {users.map(u => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={lc}>Account Manager</label>
            <div className={`${ic} bg-gray-50 cursor-not-allowed flex items-center justify-between`}>
              <span className="text-gray-700">
                {currentUser?.name ?? '—'}
                {currentUser?.role && (
                  <span className="ml-1.5 text-xs text-gray-400 font-normal">
                    {currentUser.role.replace('_', ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())}
                  </span>
                )}
              </span>
            </div>
          </div>
          <div>
            <label className={lc}>
              Transaction ID
              {!receiptUrl && <span className="text-red-500 ml-1">*</span>}
              {receiptUrl  && <span className="text-gray-400 text-xs ml-1">(optional — receipt uploaded)</span>}
            </label>
            <input
              value={txnIdVal}
              onChange={e => setTxnIdVal(e.target.value)}
              placeholder="e.g. TXN-REF-001"
              className={ic}
            />
            {!receiptUrl && !txnIdVal && (
              <p className="mt-1 text-xs text-amber-600">Required when no receipt is attached</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={lc}>Related Project</label>
            <select {...register('projectId')} className={ic}>
              <option value="">None</option>
              {projects.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </div>
          <div>
            <label className={lc}>Reference</label>
            <input {...register('reference')} placeholder="INV-001, PO-123…" className={ic} />
          </div>
        </div>

        <FileUpload
          label={receiptUrl ? 'Receipt / Invoice ✓' : 'Receipt / Invoice'}
          value={receiptUrl}
          onUploaded={url => setReceiptUrl(url)}
        />
        <p className="text-xs text-gray-400 -mt-1">
          {receiptUrl
            ? 'Receipt uploaded — Transaction ID is optional'
            : 'Upload receipt OR enter a Transaction ID above (one is required)'}
        </p>
      </form>
      <ModalFooter>
        <button type="button" onClick={() => onOpenChange(false)}
          className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
          Cancel
        </button>
        <button type="submit" form="tx-form" disabled={isSubmitting}
          className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-60 transition-colors flex items-center gap-2">
          {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
          {isEdit ? 'Save Changes' : 'Add Transaction'}
        </button>
      </ModalFooter>
    </Modal>
  )
}

// ─── Approve Modal ────────────────────────────────────────────────────────────

function ApproveModal({ expense, onClose, onDone }) {
  const [receiptUrl,      setReceiptUrl]      = useState(expense.invoiceUrl ?? '')
  const [note,            setNote]            = useState('')
  const [txnId,           setTxnId]           = useState('')
  const [accountManager,  setAccountManager]  = useState('')
  const [users,           setUsers]           = useState([])
  const [saving,          setSaving]          = useState(false)
  const hasSubmittedInvoice = !!expense.invoiceUrl

  useEffect(() => {
    fetch('/api/users?limit=100').then(r => r.json()).then(j => setUsers(j.data ?? []))
  }, [])

  async function submit(action) {
    if (action === 'approve') {
      const finalReceipt = receiptUrl || null
      if (!finalReceipt && !txnId.trim()) {
        toast.error('Upload a receipt OR enter a Transaction ID to approve')
        return
      }
    }
    setSaving(true)
    try {
      const projectId = typeof expense.projectId === 'object'
        ? (expense.projectId?.id ?? expense.projectId?._id)
        : expense.projectId
      const res  = await fetch(`/api/projects/${projectId}/expenses/${expense.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          note,
          receiptUrl:     receiptUrl || null,
          txnId:          txnId.trim() || undefined,
          accountManager: accountManager || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success(action === 'approve' ? 'Payment approved & synced to transactions' : 'Payment rejected')
      onDone()
      onClose()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const ic = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl border border-gray-200 w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">Review Payment Request</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        {/* Summary */}
        <div className="rounded-lg bg-gray-50 border border-gray-100 px-4 py-3 space-y-1.5">
          <p className="text-sm font-semibold text-gray-900">{expense.title}</p>
          <p className="text-xs text-gray-500">{expense.category} · {fmtDate(expense.date)}</p>
          <p className="text-lg font-bold text-gray-900"><TkAmt value={expense.amount} decimals={2} /></p>
          {expense.submittedBy?.name && (
            <p className="text-xs text-gray-500">Submitted by: {expense.submittedBy.name}</p>
          )}
          {expense.invoiceUrl && (
            <a href={expense.invoiceUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">
              <Paperclip className="w-3 h-3" /> View submitted invoice
            </a>
          )}
        </div>

        {/* Receipt / Invoice */}
        <FileUpload
          label={
            hasSubmittedInvoice
              ? 'Receipt / Invoice — pre-filled from submission (replace if needed)'
              : 'Upload Receipt (required to approve)'
          }
          value={receiptUrl}
          onUploaded={url => setReceiptUrl(url)}
        />
        {hasSubmittedInvoice && !receiptUrl && (
          <p className="text-xs text-amber-600">Invoice was cleared — re-upload or keep the original.</p>
        )}

        {/* Account Manager + TxnId */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Account Manager</label>
            <div className={`${ic} bg-gray-50 cursor-not-allowed flex items-center`}>
              <span className="text-gray-700">
                {currentUser?.name ?? '—'}
                {currentUser?.role && (
                  <span className="ml-1.5 text-xs text-gray-400 font-normal">
                    {currentUser.role.replace('_', ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())}
                  </span>
                )}
              </span>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Transaction ID {!receiptUrl && <span className="text-red-500">*</span>}
              {receiptUrl && <span className="text-gray-400 text-xs ml-1">(optional)</span>}
            </label>
            <input value={txnId} onChange={e => setTxnId(e.target.value)}
              placeholder="e.g. TXN-REF-001"
              className={ic} />
          </div>
        </div>

        {/* Note */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Note (optional)</label>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
            placeholder="Add a note for the requester…"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none" />
        </div>

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} disabled={saving}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={() => submit('reject')} disabled={saving}
            className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-60 flex items-center gap-1.5">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            <XCircle className="w-4 h-4" /> Reject
          </button>
          <button onClick={() => submit('approve')} disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-60 flex items-center gap-1.5">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            <CheckCircle2 className="w-4 h-4" /> Approve
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Confirm Payment Modal ────────────────────────────────────────────────────

function ConfirmPaymentModal({ payment, currentUser, onClose, onDone }) {
  const [note,           setNote]           = useState('')
  const [txnId,          setTxnId]          = useState('')
  const [users,   setUsers]   = useState([])
  const [saving,  setSaving]  = useState(false)

  useEffect(() => {
    fetch('/api/users?limit=100').then(r => r.json()).then(j => setUsers(j.data ?? []))
  }, [])

  async function submit(action) {
    if (action === 'confirm' && !payment.receiptUrl && !txnId.trim()) {
      toast.error('Upload payment proof OR enter a Transaction ID to confirm')
      return
    }
    setSaving(true)
    try {
      const res  = await fetch(`/api/project-payments/${payment.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action,
          rejectionNote:  note || undefined,
          txnId:          txnId.trim() || undefined,
          accountManager: currentUser?.id || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success(action === 'confirm' ? 'Payment confirmed & added to income' : 'Payment rejected')
      onDone()
      onClose()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const project = payment.projectId
  const client  = payment.clientId?.userId
  const ic = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl border border-gray-200 w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">Confirm Payment</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        {/* Summary */}
        <div className="rounded-lg bg-gray-50 border border-gray-100 px-4 py-3 space-y-1.5">
          {project?.name && (
            <p className="text-sm font-semibold text-gray-900">
              {project.projectCode ? `[${project.projectCode}] ` : ''}{project.name}
            </p>
          )}
          {client?.name && (
            <p className="text-xs text-gray-500">Client: {client.name}</p>
          )}
          {payment.description && (
            <p className="text-xs text-gray-600">{payment.description}</p>
          )}
          <p className="text-xl font-bold text-gray-900">
            {payment.currency} {Number(payment.amount).toLocaleString()}
          </p>
          <p className="text-xs text-gray-500">
            {payment.paymentMethod?.replace('_', ' ')} · {fmtDate(payment.paymentDate)}
          </p>
          {payment.submittedBy?.name && (
            <p className="text-xs text-gray-400">Recorded by: {payment.submittedBy.name}</p>
          )}
          {payment.notes && (
            <p className="text-xs text-gray-500 italic">{payment.notes}</p>
          )}
          {payment.receiptUrl && (
            <a href={payment.receiptUrl} target="_blank" rel="noopener noreferrer"
              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">
              <Paperclip className="w-3 h-3" /> View payment proof
            </a>
          )}
        </div>

        <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-2.5 text-xs text-gray-600">
          Confirming will create an <strong>INCOME transaction</strong> in the Transactions ledger for BDT {Number(payment.amount).toLocaleString('en-BD', { minimumFractionDigits: 2 })}.
        </div>

        {/* Account Manager + TxnId */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Account Manager</label>
            <div className={`${ic} bg-gray-50 cursor-not-allowed flex items-center`}>
              <span className="text-gray-700">
                {currentUser?.name ?? '—'}
                {currentUser?.role && (
                  <span className="ml-1.5 text-xs text-gray-400 font-normal">
                    {currentUser.role.replace('_', ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())}
                  </span>
                )}
              </span>
            </div>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Transaction ID
              {!payment.receiptUrl && <span className="text-red-500 ml-1">*</span>}
              {payment.receiptUrl && <span className="text-gray-400 text-xs ml-1">(optional)</span>}
            </label>
            <input value={txnId} onChange={e => setTxnId(e.target.value)}
              placeholder="e.g. TXN-REF-001"
              className={ic} />
            {!payment.receiptUrl && !txnId && (
              <p className="text-xs text-amber-600 mt-1">Required — no receipt attached</p>
            )}
          </div>
        </div>

        {/* Note */}
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">Note (optional — required if rejecting)</label>
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
            placeholder="Add a note…"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none" />
        </div>

        <div className="flex gap-2 justify-end">
          <button onClick={onClose} disabled={saving}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={() => submit('reject')} disabled={saving}
            className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-60 flex items-center gap-1.5">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            <XCircle className="w-4 h-4" /> Reject
          </button>
          <button onClick={() => submit('confirm')} disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-60 flex items-center gap-1.5">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            <CheckCircle2 className="w-4 h-4" /> Confirm
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Request Edit Modal ───────────────────────────────────────────────────────

function RequestEditModal({ expense, onClose, onSubmitted }) {
  const [reason,  setReason]  = useState('')
  const [saving,  setSaving]  = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (!reason.trim()) { toast.error('Reason is required'); return }
    setSaving(true)
    try {
      const res  = await fetch('/api/edit-requests', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ itemType: 'PROJECT_EXPENSE', itemId: expense.id, reason: reason.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Edit request submitted. Waiting for owner approval.')
      onSubmitted && onSubmitted()
      onClose()
    } catch (err) {
      toast.error(err.message ?? 'Failed to submit request')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl border border-gray-200 w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">Request Edit Access</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="rounded-lg bg-gray-50 border border-gray-100 px-4 py-3 space-y-1">
          <p className="text-sm font-semibold text-gray-900">{expense.title}</p>
          <p className="text-xs text-gray-500">{expense.category} · {fmtDate(expense.date)}</p>
          <p className="text-sm font-bold text-gray-900"><TkAmt value={expense.amount} decimals={2} /></p>
        </div>
        <p className="text-xs text-gray-500">
          This expense is <strong>{expense.status}</strong>. Editing is locked. Submit a request and the owner will generate a one-time OTP to grant you temporary edit access.
        </p>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Reason for edit <span className="text-red-500">*</span></label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              placeholder="Describe why this expense needs to be edited…"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={onClose} disabled={saving}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-60 flex items-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Submit Request
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── OTP Verify Modal ─────────────────────────────────────────────────────────

function OtpVerifyModal({ requestId, expenseId, onVerified, onClose }) {
  const [otp,     setOtp]     = useState('')
  const [saving,  setSaving]  = useState(false)
  const [errMsg,  setErrMsg]  = useState('')

  async function verify(e) {
    e.preventDefault()
    if (!otp.trim()) { setErrMsg('Enter the OTP'); return }
    setSaving(true)
    setErrMsg('')
    try {
      const res  = await fetch(`/api/edit-requests/${requestId}/verify`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ otp: otp.trim() }),
      })
      const json = await res.json()
      if (!res.ok || !json.valid) throw new Error(json.error ?? 'Invalid or expired OTP')
      toast.success('OTP verified — edit access granted')
      onVerified(expenseId)
      onClose()
    } catch (err) {
      setErrMsg(err.message ?? 'Invalid or expired OTP')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl border border-gray-200 w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">Enter OTP</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <p className="text-xs text-gray-500">Enter the 6-digit OTP provided by the owner to unlock edit access for this expense.</p>
        <form onSubmit={verify} className="space-y-3">
          <input
            value={otp}
            onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="6-digit OTP"
            maxLength={6}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-center text-xl font-mono tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-gray-900"
          />
          {errMsg && <p className="text-xs text-red-500 text-center">{errMsg}</p>}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={onClose} disabled={saving}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={saving || otp.length !== 6}
              className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-60 flex items-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Verify OTP
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Calendar helpers ─────────────────────────────────────────────────────────

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function getMonthLabel(offset = 0) {
  const d = new Date()
  d.setMonth(d.getMonth() - offset)
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`
}

function getDrillKey(offset = 0) {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// ─── Calendar Drill-Down ──────────────────────────────────────────────────────

function CalendarDrillDown({ drillKey, onClose }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)

  const [yr, mo] = drillKey.split('-').map(Number)
  const label      = `${MONTH_NAMES[mo - 1]} ${yr}`
  const daysInMonth = new Date(yr, mo, 0).getDate()

  const fmtAmt = (n) => n == null ? '—' : `BDT ${Number(n).toLocaleString('en-BD', { minimumFractionDigits: 0 })}`

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
                <th className="px-5 py-2.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wide w-28">Day</th>
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
                      {String(row.day).padStart(2, '0')}{' '}
                      <span className="text-gray-400 font-normal">{MONTH_NAMES[mo - 1].slice(0, 3)}</span>
                    </td>
                    <td className="px-5 py-2.5 text-right text-green-600 font-medium">
                      {row.income > 0 ? fmtAmt(row.income) : '—'}
                    </td>
                    <td className="px-5 py-2.5 text-right text-red-500">
                      {row.expense > 0 ? fmtAmt(row.expense) : '—'}
                    </td>
                    <td className={`px-5 py-2.5 text-right font-medium ${
                      row.profit > 0 ? 'text-gray-900' : row.profit < 0 ? 'text-red-500' : 'text-gray-300'
                    }`}>
                      {row.txCount > 0 ? fmtAmt(row.profit) : '—'}
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

// ─── Owner OTP Display Modal ──────────────────────────────────────────────────

function OwnerOtpModal({ otp, requesterName, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl border border-gray-200 w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">Edit Request Approved</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <p className="text-sm text-gray-600">
          Share this OTP with <strong>{requesterName ?? 'the manager'}</strong>. It expires in 30 minutes and can only be used once.
        </p>
        <div className="rounded-xl bg-yellow-50 border-2 border-yellow-300 px-6 py-5 text-center">
          <p className="text-xs text-yellow-700 font-medium uppercase tracking-wide mb-2">One-Time Password</p>
          <p className="text-4xl font-mono font-bold tracking-[0.3em] text-yellow-900">{otp}</p>
          <p className="text-xs text-yellow-600 mt-2">Valid for 30 minutes</p>
        </div>
        <button onClick={onClose}
          className="w-full px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors">
          Done
        </button>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

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
      {!neutral && (positive
        ? <ArrowUpRight className="w-3 h-3" />
        : <ArrowDownRight className="w-3 h-3" />)}
      {neutral ? 'No change' : `${Math.abs(change)}%`}
    </span>
  )
}

const TAB_PARAM_MAP = {
  transactions:  'Transactions',
  income:        'Transactions',
  expense:       'Transactions',
  confirmations: 'Payment Confirmations',
  requests:      'Payment Requests',
}

export default function AccountsPage() {
  const { data: session }  = useSession()
  const searchParams = useSearchParams()
  const [tab,        setTab]        = useState(() => TAB_PARAM_MAP[searchParams?.get('tab')] ?? 'Overview')
  const [summary,    setSummary]    = useState(null)
  const [dashStats,  setDashStats]  = useState(null)
  const [drillKey,   setDrillKey]   = useState(null)
  const [txList,     setTxList]     = useState([])
  const [txMeta,     setTxMeta]     = useState({ page: 1, pages: 1, total: 0 })
  const [plReport,   setPlReport]   = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [txLoading,  setTxLoading]  = useState(false)
  const [plLoading,  setPlLoading]  = useState(false)
  const [modalOpen,  setModalOpen]  = useState(false)
  const [editingTx,  setEditingTx]  = useState(null)

  // Payment requests (expense-based)
  const [prList,      setPrList]      = useState([])
  const [prMeta,      setPrMeta]      = useState({ page: 1, pages: 1, total: 0 })
  const [prLoading,   setPrLoading]   = useState(false)
  const [prPage,      setPrPage]      = useState(1)
  const [prStatus,    setPrStatus]    = useState('PENDING')
  const [approvingPr, setApprovingPr] = useState(null)

  // Payment confirmations (project client payments)
  const [pcList,      setPcList]      = useState([])
  const [pcMeta,      setPcMeta]      = useState({ page: 1, pages: 1, total: 0 })
  const [pcLoading,   setPcLoading]   = useState(false)
  const [pcPage,      setPcPage]      = useState(1)
  const [pcStatus,    setPcStatus]    = useState('PENDING_CONFIRMATION')
  const [confirmingPc, setConfirmingPc] = useState(null)

  // Withdrawals tab
  const [wdList,       setWdList]       = useState([])
  const [wdLoading,    setWdLoading]    = useState(false)
  const [wdStatus,     setWdStatus]     = useState('')
  const [approvingWd,  setApprovingWd]  = useState(null)
  const [rejectingWd,  setRejectingWd]  = useState(null)
  const [wdNote,       setWdNote]       = useState('')
  const [wdApproveNote, setWdApproveNote] = useState('')
  const [wdApproveModal, setWdApproveModal] = useState(null)

  // OTP edit-lock system
  const [editRequestModal, setEditRequestModal] = useState(null)   // expense object
  const [otpModal,         setOtpModal]         = useState(null)   // { requestId, expenseId }
  const [editUnlocked,     setEditUnlocked]     = useState(new Set())
  const [editRequests,     setEditRequests]     = useState([])     // pending edit requests (owner view)
  const [ownerOtpModal,    setOwnerOtpModal]    = useState(null)   // { otp, requesterName }
  const [erLoading,        setErLoading]        = useState(false)
  const [rejectingEr,      setRejectingEr]      = useState(null)   // edit request being rejected
  const [rejectNote,       setRejectNote]       = useState('')

  // Filters
  const [txType,    setTxType]    = useState(() => {
    const p = searchParams?.get('tab')
    if (p === 'income')  return 'INCOME'
    if (p === 'expense') return 'EXPENSE'
    return ''
  })
  const [txPage,    setTxPage]    = useState(1)
  const [period,    setPeriod]    = useState('month')
  const [startDate, setStartDate] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  })
  const [endDate,   setEndDate]   = useState(() => new Date().toISOString().slice(0, 10))
  const [plStart,   setPlStart]   = useState(() => `${new Date().getFullYear()}-01-01`)
  const [plEnd,     setPlEnd]     = useState(() => new Date().toISOString().slice(0, 10))

  // ── Sync tab/filter when URL ?tab= param changes ─────────────────────────
  useEffect(() => {
    const p = searchParams?.get('tab')
    const mappedTab = TAB_PARAM_MAP[p] ?? 'Overview'
    setTab(mappedTab)
    if (p === 'income')  setTxType('INCOME')
    else if (p === 'expense') setTxType('EXPENSE')
    else if (p === 'transactions') setTxType('')
  }, [searchParams])

  // ── Loaders ──────────────────────────────────────────────────────────────

  const loadSummary = useCallback(async () => {
    try {
      const params = new URLSearchParams()
      if (startDate) params.set('startDate', startDate)
      if (endDate)   params.set('endDate',   endDate)
      const res  = await fetch(`/api/accounts/summary?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setSummary(json.data)
    } catch (err) {
      toast.error(err.message ?? 'Failed to load summary')
    } finally {
      setLoading(false)
    }
  }, [startDate, endDate])

  const loadTransactions = useCallback(async () => {
    setTxLoading(true)
    try {
      const params = new URLSearchParams({ page: txPage, limit: 20 })
      if (txType)    params.set('type',      txType)
      if (startDate) params.set('startDate', startDate)
      if (endDate)   params.set('endDate',   endDate)
      const res  = await fetch(`/api/transactions?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setTxList(json.data ?? [])
      setTxMeta(json.meta ?? { page: 1, pages: 1, total: 0 })
    } catch (err) {
      toast.error(err.message ?? 'Failed to load transactions')
    } finally {
      setTxLoading(false)
    }
  }, [txPage, txType, startDate, endDate])

  const loadPL = useCallback(async () => {
    setPlLoading(true)
    try {
      const params = new URLSearchParams()
      if (plStart) params.set('startDate', plStart)
      if (plEnd)   params.set('endDate',   plEnd)
      const res  = await fetch(`/api/accounts/pl-report?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setPlReport(json.data)
    } catch (err) {
      toast.error(err.message ?? 'Failed to load P&L')
    } finally {
      setPlLoading(false)
    }
  }, [plStart, plEnd])

  const loadPaymentRequests = useCallback(async () => {
    setPrLoading(true)
    try {
      const params = new URLSearchParams({ page: prPage, limit: 20 })
      if (prStatus) params.set('status', prStatus)
      const res  = await fetch(`/api/expenses?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setPrList(json.data ?? [])
      setPrMeta(json.meta ?? { page: 1, pages: 1, total: 0 })
    } catch (err) {
      toast.error(err.message ?? 'Failed to load payment requests')
    } finally {
      setPrLoading(false)
    }
  }, [prPage, prStatus])

  const loadPaymentConfirmations = useCallback(async () => {
    setPcLoading(true)
    try {
      const params = new URLSearchParams({ page: pcPage, limit: 20 })
      if (pcStatus) params.set('status', pcStatus)
      const res  = await fetch(`/api/project-payments?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setPcList(json.data ?? [])
      setPcMeta(json.meta ?? { page: 1, pages: 1, total: 0 })
    } catch (err) {
      toast.error(err.message ?? 'Failed to load payment confirmations')
    } finally {
      setPcLoading(false)
    }
  }, [pcPage, pcStatus])

  const loadEditRequests = useCallback(async () => {
    setErLoading(true)
    try {
      const res  = await fetch('/api/edit-requests')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setEditRequests(json.data ?? [])
    } catch (err) {
      console.error('Failed to load edit requests', err)
    } finally {
      setErLoading(false)
    }
  }, [])

  useEffect(() => { loadSummary() },      [loadSummary])
  useEffect(() => {
    fetch('/api/dashboard/stats')
      .then(r => r.json())
      .then(j => { if (j.data) setDashStats(j.data) })
      .catch(() => {})
  }, [])
  useEffect(() => { loadTransactions() }, [loadTransactions])
  useEffect(() => { if (tab === 'P&L Report')              loadPL() },                   [tab, loadPL])

  const loadWithdrawals = useCallback(async () => {
    setWdLoading(true)
    try {
      const url = wdStatus ? `/api/admin/withdrawal-requests?status=${wdStatus}` : '/api/admin/withdrawal-requests'
      const res  = await fetch(url)
      const json = await res.json()
      if (res.ok) setWdList(json.data ?? [])
    } catch { /* silent */ }
    finally { setWdLoading(false) }
  }, [wdStatus])

  useEffect(() => { if (tab === 'Withdrawals') loadWithdrawals() }, [tab, loadWithdrawals])

  async function handleApproveWithdrawal(wd) {
    setApprovingWd(wd.id ?? wd._id)
    try {
      const res  = await fetch(`/api/admin/withdrawal-requests/${wd.id ?? wd._id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'approve', adminNote: wdApproveNote || undefined }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Withdrawal approved')
      setWdApproveModal(null)
      setWdApproveNote('')
      loadWithdrawals()
      loadSummary()
    } catch (err) { toast.error(err.message) }
    finally { setApprovingWd(null) }
  }

  async function handleRejectWithdrawal(wdId) {
    setRejectingWd(wdId)
    try {
      const res  = await fetch(`/api/admin/withdrawal-requests/${wdId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'reject', adminNote: wdNote || undefined }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Withdrawal rejected')
      setWdNote('')
      loadWithdrawals()
    } catch (err) { toast.error(err.message) }
    finally { setRejectingWd(null) }
  }
  useEffect(() => { if (tab === 'Payment Requests')        loadPaymentRequests() },       [tab, loadPaymentRequests])
  useEffect(() => { if (tab === 'Payment Requests')        loadEditRequests() },          [tab, loadEditRequests])
  useEffect(() => { if (tab === 'Payment Confirmations')   loadPaymentConfirmations() },  [tab, loadPaymentConfirmations])

  // ── Actions ───────────────────────────────────────────────────────────────

  async function handleApproveEditRequest(er) {
    try {
      const res  = await fetch(`/api/edit-requests/${er.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'APPROVE' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setOwnerOtpModal({ otp: json.data.otp, requesterName: er.requesterId?.name })
      loadEditRequests()
    } catch (err) {
      toast.error(err.message ?? 'Failed to approve edit request')
    }
  }

  async function handleRejectEditRequest(er, note) {
    try {
      const res  = await fetch(`/api/edit-requests/${er.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'REJECT', reviewNote: note }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Edit request rejected')
      setRejectingEr(null)
      setRejectNote('')
      loadEditRequests()
    } catch (err) {
      toast.error(err.message ?? 'Failed to reject edit request')
    }
  }

  function handleSaved() {
    toast.success(editingTx ? 'Transaction updated' : 'Transaction added')
    setEditingTx(null)
    loadSummary()
    loadTransactions()
  }

  async function handleDelete(tx) {
    if (!confirm(`Delete "${tx.description}"?`)) return
    try {
      const res = await fetch(`/api/transactions/${tx.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Transaction deleted')
      loadSummary()
      loadTransactions()
    } catch (err) {
      toast.error(err.message ?? 'Failed to delete')
    }
  }

  // ── Spinner ───────────────────────────────────────────────────────────────

  const Spinner = () => (
    <div className="flex items-center justify-center h-40">
      <div className="w-7 h-7 border-2 border-gray-300 border-t-gray-700 rounded-full animate-spin" />
    </div>
  )

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Accounts</h1>
          <p className="text-sm text-gray-400 mt-0.5">Track income, expenses and financial health</p>
        </div>
        <button
          onClick={() => { setEditingTx(null); setModalOpen(true) }}
          className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors"
        >
          <Plus className="w-4 h-4" /> Add Transaction
        </button>
      </div>

      {/* Date range selector */}
      <div className="flex items-center gap-3 flex-wrap">
        <span className="text-sm text-gray-500 font-medium">Period</span>
        <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500" />
        <span className="text-gray-400 text-sm">to</span>
        <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500" />
        {(startDate || endDate) && (
          <button
            onClick={() => { setStartDate(''); setEndDate('') }}
            className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5 rounded hover:bg-gray-100 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex border-b border-gray-200 gap-1">
        {TABS.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium transition-colors whitespace-nowrap ${
              tab === t
                ? 'border-b-2 border-gray-900 text-gray-900 -mb-px'
                : 'text-gray-400 hover:text-gray-600'
            }`}>
            {t}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {tab === 'Overview' && (
        <div className="space-y-6">
          {loading ? <Spinner /> : summary ? (
            <>
              {/* ── Monthly financial metric cards (dashboard-style) ── */}
              {(() => {
                const f = dashStats?.financials ?? {}
                const fmtVal = (n) => n == null ? '—' : `BDT ${Number(n).toLocaleString('en-BD', { minimumFractionDigits: 0 })}`

                const CARDS = [
                  {
                    label:  'Monthly Income',
                    value:  fmtVal(f.income?.value),
                    prev:   `vs ${fmtVal(f.income?.prevValue)} last month`,
                    change: f.income?.change,
                    icon:   TrendingUp,
                    bg:     'bg-green-50',
                    color:  'text-green-600',
                  },
                  {
                    label:  'Monthly Expense',
                    value:  fmtVal(f.expense?.value),
                    prev:   `vs ${fmtVal(f.expense?.prevValue)} last month`,
                    change: f.expense?.change,
                    invert: true,
                    icon:   TrendingDown,
                    bg:     'bg-red-50',
                    color:  'text-red-500',
                  },
                  {
                    label:  'Net Profit',
                    value:  fmtVal(f.profit?.value),
                    prev:   `vs ${fmtVal(f.profit?.prevValue)} last month`,
                    change: f.profit?.change,
                    icon:   DollarSign,
                    bg:     'bg-blue-50',
                    color:  'text-blue-600',
                  },
                  {
                    label:  'Gross Margin',
                    value:  `${f.grossMargin?.value ?? 0}%`,
                    prev:   `was ${f.grossMargin?.prevValue ?? 0}% last month`,
                    change: f.grossMargin?.value != null && f.grossMargin?.prevValue != null
                              ? (f.grossMargin.value - f.grossMargin.prevValue) : null,
                    icon:   Percent,
                    bg:     'bg-purple-50',
                    color:  'text-purple-600',
                  },
                  {
                    label:  'Expense Ratio',
                    value:  `${f.expenseRatio?.value ?? 0}%`,
                    prev:   `was ${f.expenseRatio?.prevValue ?? 0}% last month`,
                    change: f.expenseRatio?.value != null && f.expenseRatio?.prevValue != null
                              ? (f.expenseRatio.value - f.expenseRatio.prevValue) : null,
                    invert: true,
                    icon:   BarChart2,
                    bg:     'bg-orange-50',
                    color:  'text-orange-500',
                  },
                  {
                    label:  'Transactions',
                    value:  f.transactions?.value ?? 0,
                    prev:   `${f.transactions?.prevValue ?? 0} last month`,
                    change: f.transactions?.change,
                    icon:   FileTextIcon,
                    bg:     'bg-indigo-50',
                    color:  'text-indigo-600',
                  },
                ]

                const monthOptions = Array.from({ length: 6 }, (_, i) => ({
                  key:   getDrillKey(i),
                  label: getMonthLabel(i),
                }))

                return (
                  <>
                    <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
                      {CARDS.map(card => {
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

                    {/* Month chips → drill into daily calendar */}
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-gray-400 mr-1">Drill down by month:</span>
                      {monthOptions.map(m => (
                        <button
                          key={m.key}
                          onClick={() => setDrillKey(prev => prev === m.key ? null : m.key)}
                          className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
                            drillKey === m.key
                              ? 'bg-gray-900 text-white border-gray-900'
                              : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400 hover:text-gray-800'
                          }`}
                        >
                          {m.label}
                        </button>
                      ))}
                    </div>

                    {/* Daily drill-down */}
                    {drillKey && (
                      <CalendarDrillDown
                        drillKey={drillKey}
                        onClose={() => setDrillKey(null)}
                      />
                    )}
                  </>
                )
              })()}

            </>
          ) : null}
        </div>
      )}

      {/* ── CHARTS ── */}
      {tab === 'Charts' && (
        <div className="space-y-6">
          {loading ? <Spinner /> : summary ? (
            <>
              {summary.monthlyData?.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-100 p-6">
                  <h3 className="text-sm font-semibold text-gray-700 mb-4">Monthly Income vs Expenses</h3>
                  <ResponsiveContainer width="100%" height={260}>
                    <BarChart data={summary.monthlyData.map(d => ({ ...d, month: fmtMonth(d.month) }))} barSize={14}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#F1F5F9" />
                      <XAxis dataKey="month" tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} />
                      <YAxis tick={{ fontSize: 11, fill: '#94A3B8' }} axisLine={false} tickLine={false} tickFormatter={(v) => `${v >= 1000 ? `${(v/1000).toFixed(0)}k` : v}`} />
                      <Tooltip formatter={(v) => fmt(v)} contentStyle={{ borderRadius: 8, border: '1px solid #E2E8F0', fontSize: 12 }} />
                      <Legend wrapperStyle={{ fontSize: 12 }} />
                      <Bar dataKey="income"  name="Income"  fill="#10B981" radius={[4,4,0,0]} />
                      <Bar dataKey="expense" name="Expense" fill="#EF4444" radius={[4,4,0,0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}

              {summary.expenseByCategory?.length > 0 && (
                <div className="grid lg:grid-cols-2 gap-6">
                  <div className="bg-white rounded-xl border border-gray-100 p-6">
                    <h3 className="text-sm font-semibold text-gray-700 mb-4">Expenses by Category</h3>
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie data={summary.expenseByCategory} dataKey="amount" nameKey="category" cx="50%" cy="50%" outerRadius={80} label={({ category, percent }) => `${category} ${(percent * 100).toFixed(0)}%`} labelLine={false} fontSize={10}>
                          {summary.expenseByCategory.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                        </Pie>
                        <Tooltip formatter={(v) => fmt(v)} contentStyle={{ borderRadius: 8, fontSize: 12 }} />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                  <div className="bg-white rounded-xl border border-gray-100 p-6">
                    <h3 className="text-sm font-semibold text-gray-700 mb-4">Category Breakdown</h3>
                    <div className="space-y-3">
                      {summary.expenseByCategory.map((c, i) => {
                        const total = summary.expenseByCategory.reduce((s, x) => s + x.amount, 0)
                        const pct   = total > 0 ? (c.amount / total) * 100 : 0
                        return (
                          <div key={c.category}>
                            <div className="flex justify-between items-center mb-1">
                              <span className="text-sm text-gray-700 flex items-center gap-2">
                                <span className="w-2.5 h-2.5 rounded-full inline-block" style={{ backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                                {c.category}
                              </span>
                              <span className="text-sm font-medium text-gray-900"><TkAmt value={c.amount} decimals={2} /></span>
                            </div>
                            <div className="w-full bg-gray-100 rounded-full h-1.5">
                              <div className="h-1.5 rounded-full" style={{ width: `${pct}%`, backgroundColor: PIE_COLORS[i % PIE_COLORS.length] }} />
                            </div>
                          </div>
                        )
                      })}
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : null}
        </div>
      )}

      {/* ── TRANSACTIONS ── */}
      {tab === 'Transactions' && (
        <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-3 flex-wrap">
            <div className="flex gap-1">
              {['', 'INCOME', 'EXPENSE'].map((t) => (
                <button key={t || 'all'} onClick={() => { setTxType(t); setTxPage(1) }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    txType === t
                      ? 'bg-gray-900 text-white'
                      : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                  }`}>
                  {t || 'All'}
                </button>
              ))}
            </div>
            <span className="ml-auto text-sm text-gray-400">{txMeta.total} transaction{txMeta.total !== 1 ? 's' : ''}</span>
          </div>

          {txLoading ? <Spinner /> : txList.length === 0 ? (
            <div className="text-center py-16">
              <DollarSign className="w-10 h-10 text-gray-200 mx-auto mb-3" />
              <p className="text-sm text-gray-400">No transactions found</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px]">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="px-4 py-3 text-left text-xs text-gray-400 uppercase tracking-wide">TXN ID</th>
                    <th className="px-4 py-3 text-left text-xs text-gray-400 uppercase tracking-wide">Date / Time</th>
                    <th className="px-4 py-3 text-left text-xs text-gray-400 uppercase tracking-wide">Description</th>
                    <th className="px-4 py-3 text-left text-xs text-gray-400 uppercase tracking-wide">Category</th>
                    <th className="px-4 py-3 text-left text-xs text-gray-400 uppercase tracking-wide">Type</th>
                    <th className="px-4 py-3 text-left text-xs text-gray-400 uppercase tracking-wide">People</th>
                    <th className="px-4 py-3 text-left text-xs text-gray-400 uppercase tracking-wide">Payment</th>
                    <th className="px-4 py-3 text-right text-xs text-gray-400 uppercase tracking-wide">Amount</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {txList.map((tx) => {
                    const txDate = new Date(tx.date)
                    const entryDate = new Date(tx.createdAt)
                    return (
                      <tr key={tx.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3">
                          <span className="text-xs font-mono text-gray-500 bg-gray-100 px-2 py-0.5 rounded">
                            {tx.txnId ?? '—'}
                          </span>
                        </td>
                        <td className="px-4 py-3 whitespace-nowrap">
                          <p className="text-sm text-gray-700">{txDate.toLocaleDateString('en-BD', { day:'2-digit', month:'short', year:'numeric' })}</p>
                          <p className="text-xs text-gray-400">Entered: {entryDate.toLocaleString('en-BD', { day:'2-digit', month:'short', year:'numeric', hour:'2-digit', minute:'2-digit' })}</p>
                        </td>
                        <td className="px-4 py-3 max-w-[200px]">
                          <p className="text-sm font-medium text-gray-900 truncate">{tx.description}</p>
                          {tx.vendor    && <p className="text-xs text-gray-400">Vendor: {tx.vendor}</p>}
                          {tx.reference && <p className="text-xs text-gray-400">Ref: {tx.reference}</p>}
                          {tx.projectId?.name && (
                            <p className="text-xs text-gray-400">
                              {tx.projectId.projectCode ? `[${tx.projectId.projectCode}] ` : ''}{tx.projectId.name}
                            </p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600 whitespace-nowrap">{tx.category}</td>
                        <td className="px-4 py-3">
                          <StatusDot status={tx.type} />
                        </td>
                        <td className="px-4 py-3">
                          {tx.paidBy?.name && <p className="text-xs text-gray-600">Paid by: <span className="font-medium">{tx.paidBy.name}</span></p>}
                          {tx.accountManager?.name && <p className="text-xs text-gray-600">Acc. Mgr: <span className="font-medium">{tx.accountManager.name}</span></p>}
                          {tx.createdBy?.name && <p className="text-xs text-gray-400">Entry by: {tx.createdBy.name}</p>}
                        </td>
                        <td className="px-4 py-3">
                          {tx.paymentMethod && (
                            <p className="text-xs text-gray-500">{tx.paymentMethod.replace('_',' ')}</p>
                          )}
                          {tx.receiptUrl && (
                            <a href={tx.receiptUrl} target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline mt-0.5">
                              <Paperclip className="w-3 h-3" /> Receipt
                            </a>
                          )}
                        </td>
                        <td className={`px-4 py-3 text-sm font-bold text-right whitespace-nowrap ${tx.type === 'INCOME' ? 'text-green-600' : 'text-red-500'}`}>
                          {tx.type === 'INCOME' ? '+' : '-'}<TkAmt value={tx.amount} decimals={2} />
                        </td>
                        <td className="px-4 py-3 text-right">
                          <div className="flex items-center justify-end gap-1">
                            <button onClick={() => { setEditingTx(tx); setModalOpen(true) }}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => handleDelete(tx)}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}

          {txMeta.pages > 1 && (
            <div className="px-6 py-4 border-t border-gray-100">
              <Pagination page={txMeta.page} pages={txMeta.pages} onChange={(p) => setTxPage(p)} />
            </div>
          )}
        </div>
      )}

      {/* ── PAYMENT CONFIRMATIONS ── */}
      {tab === 'Payment Confirmations' && (
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-gray-100 px-5 py-3 flex items-center gap-3 flex-wrap">
            <span className="text-sm text-gray-500">Status:</span>
            <div className="flex gap-1">
              {['PENDING_CONFIRMATION', 'CONFIRMED', 'REJECTED'].map(s => (
                <button key={s} onClick={() => { setPcStatus(s); setPcPage(1) }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    pcStatus === s ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                  }`}>
                  {s === 'PENDING_CONFIRMATION' ? 'Pending' : s.charAt(0) + s.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
          </div>

          {pcLoading ? <Spinner /> : pcList.length === 0 ? (
            <div className="bg-white rounded-xl border border-gray-100 py-16 text-center text-sm text-gray-400">
              No payment confirmations found
            </div>
          ) : (
            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="px-5 py-3 text-left text-xs text-gray-400 uppercase tracking-wide">Project</th>
                    <th className="px-5 py-3 text-left text-xs text-gray-400 uppercase tracking-wide">Invoice</th>
                    <th className="px-5 py-3 text-left text-xs text-gray-400 uppercase tracking-wide">Submitted By</th>
                    <th className="px-5 py-3 text-left text-xs text-gray-400 uppercase tracking-wide">Client</th>
                    <th className="px-5 py-3 text-left text-xs text-gray-400 uppercase tracking-wide">Amount</th>
                    <th className="px-5 py-3 text-left text-xs text-gray-400 uppercase tracking-wide">Method</th>
                    <th className="px-5 py-3 text-left text-xs text-gray-400 uppercase tracking-wide">Date</th>
                    <th className="px-5 py-3 text-left text-xs text-gray-400 uppercase tracking-wide">Proof</th>
                    <th className="px-5 py-3 text-left text-xs text-gray-400 uppercase tracking-wide">Status</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {pcList.map(pc => {
                    const statusLabel = {
                      PENDING_CONFIRMATION: 'Pending',
                      CONFIRMED:            'Confirmed',
                      REJECTED:             'Rejected',
                    }[pc.status] ?? pc.status
                    const project = pc.projectId
                    const client  = pc.clientId?.userId
                    return (
                      <tr key={pc.id} className="hover:bg-gray-50">
                        <td className="px-5 py-3">
                          <p className="text-sm font-medium text-gray-900">{project?.name ?? '—'}</p>
                          {project?.projectCode && (
                            <p className="text-xs font-mono text-gray-400">{project.projectCode}</p>
                          )}
                        </td>
                        <td className="px-5 py-3">
                          {pc.invoiceId ? (
                            <Link href={`/admin/invoices/${pc.invoiceId.id ?? pc.invoiceId._id}`}
                              className="text-xs font-mono text-blue-600 hover:text-blue-800 font-medium">
                              {pc.invoiceId.invoiceNumber}
                            </Link>
                          ) : <span className="text-xs text-gray-400">—</span>}
                        </td>
                        <td className="px-5 py-3">
                          {pc.submittedBy ? (
                            <div className="flex items-center gap-2">
                              <div className="w-6 h-6 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center shrink-0">
                                {pc.submittedBy.name?.charAt(0).toUpperCase()}
                              </div>
                              <span className="text-sm text-gray-700">{pc.submittedBy.name}</span>
                            </div>
                          ) : <span className="text-xs text-gray-400">—</span>}
                        </td>
                        <td className="px-5 py-3 text-sm text-gray-600">{client?.name ?? '—'}</td>
                        <td className="px-5 py-3 text-sm font-semibold text-gray-900">
                          {pc.currency} {Number(pc.amount).toLocaleString()}
                        </td>
                        <td className="px-5 py-3 text-sm text-gray-500">{pc.paymentMethod?.replace('_', ' ')}</td>
                        <td className="px-5 py-3 text-sm text-gray-500">{fmtDate(pc.paymentDate)}</td>
                        <td className="px-5 py-3">
                          {pc.receiptUrl ? (
                            <a href={pc.receiptUrl} target="_blank" rel="noopener noreferrer"
                              className="inline-flex items-center gap-1 text-xs text-blue-600 hover:underline">
                              <Paperclip className="w-3 h-3" /> View
                            </a>
                          ) : <span className="text-xs text-gray-400">—</span>}
                        </td>
                        <td className="px-5 py-3">
                          <StatusDot status={pc.status} />
                          {pc.status === 'CONFIRMED' && pc.confirmedBy?.name && (
                            <p className="text-xs text-gray-400 mt-0.5">by {pc.confirmedBy.name}</p>
                          )}
                          {pc.status === 'REJECTED' && pc.rejectionNote && (
                            <p className="text-xs text-gray-400 mt-0.5 max-w-xs truncate">{pc.rejectionNote}</p>
                          )}
                        </td>
                        <td className="px-5 py-3 text-right">
                          {pc.status === 'PENDING_CONFIRMATION' && (
                            <button onClick={() => setConfirmingPc(pc)}
                              className="px-3 py-1.5 text-xs font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors">
                              Review
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {pcMeta.pages > 1 && (
                <div className="px-5 py-4 border-t border-gray-100">
                  <Pagination page={pcPage} pages={pcMeta.pages} onPageChange={setPcPage} />
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── PAYMENT REQUESTS ── */}
      {tab === 'Payment Requests' && (
        <div className="space-y-4">

          {/* ── Owner: Pending Edit Requests panel ── */}
          {editRequests.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl overflow-hidden">
              <div className="px-5 py-3 border-b border-amber-200 flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-amber-600" />
                <span className="text-sm font-semibold text-amber-800">Pending Edit Requests ({editRequests.length})</span>
              </div>
              <div className="divide-y divide-amber-100">
                {editRequests.map(er => (
                  <div key={er.id} className="px-5 py-3 flex items-start gap-4">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium text-gray-900">{er.requesterId?.name ?? 'Unknown'}</p>
                      <p className="text-xs text-gray-500 mt-0.5">Item ID: <span className="font-mono">{String(er.itemId)}</span></p>
                      <p className="text-xs text-gray-600 mt-1 italic">"{er.reason}"</p>
                      <p className="text-xs text-gray-400 mt-0.5">{fmtDate(er.createdAt)}</p>
                    </div>
                    <div className="flex items-center gap-2 flex-shrink-0">
                      {rejectingEr?.id === er.id ? (
                        <div className="flex items-center gap-2">
                          <input
                            value={rejectNote}
                            onChange={e => setRejectNote(e.target.value)}
                            placeholder="Rejection note…"
                            className="border border-gray-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-gray-900 w-44"
                          />
                          <button onClick={() => handleRejectEditRequest(er, rejectNote)}
                            className="px-2.5 py-1.5 text-xs font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 transition-colors">
                            Confirm
                          </button>
                          <button onClick={() => { setRejectingEr(null); setRejectNote('') }}
                            className="px-2.5 py-1.5 text-xs text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50">
                            Cancel
                          </button>
                        </div>
                      ) : (
                        <>
                          <button onClick={() => { setRejectingEr(er); setRejectNote('') }}
                            className="px-3 py-1.5 text-xs font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors flex items-center gap-1">
                            <XCircle className="w-3.5 h-3.5" /> Reject
                          </button>
                          <button onClick={() => handleApproveEditRequest(er)}
                            className="px-3 py-1.5 text-xs font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors flex items-center gap-1">
                            <CheckCircle2 className="w-3.5 h-3.5" /> Approve & Get OTP
                          </button>
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl border border-gray-100 px-5 py-3 flex items-center gap-3 flex-wrap">
            <span className="text-sm text-gray-500">Status:</span>
            <div className="flex gap-1">
              {['PENDING', 'APPROVED', 'REJECTED'].map(s => (
                <button key={s} onClick={() => { setPrStatus(s); setPrPage(1) }}
                  className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-colors ${
                    prStatus === s ? 'bg-gray-900 text-white' : 'text-gray-500 hover:text-gray-700 hover:bg-gray-100'
                  }`}>
                  {s}
                </button>
              ))}
            </div>
            <span className="ml-auto text-sm text-gray-400">{prMeta.total} request{prMeta.total !== 1 ? 's' : ''}</span>
          </div>

          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            {prLoading ? <Spinner /> : prList.length === 0 ? (
              <div className="text-center py-16">
                <Clock className="w-10 h-10 text-gray-200 mx-auto mb-3" />
                <p className="text-sm text-gray-400">No {prStatus.toLowerCase()} payment requests</p>
              </div>
            ) : (
              <table className="w-full">
                <thead>
                  <tr className="border-b border-gray-100">
                    <th className="px-5 py-3 text-left text-xs text-gray-400 uppercase tracking-wide">Request</th>
                    <th className="px-5 py-3 text-left text-xs text-gray-400 uppercase tracking-wide">Project</th>
                    <th className="px-5 py-3 text-left text-xs text-gray-400 uppercase tracking-wide">Category</th>
                    <th className="px-5 py-3 text-left text-xs text-gray-400 uppercase tracking-wide">Submitted By</th>
                    <th className="px-5 py-3 text-left text-xs text-gray-400 uppercase tracking-wide">Date</th>
                    <th className="px-5 py-3 text-right text-xs text-gray-400 uppercase tracking-wide">Amount</th>
                    <th className="px-5 py-3 text-left text-xs text-gray-400 uppercase tracking-wide">Files</th>
                    <th className="px-5 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {prList.map(e => {
                    const isLocked   = (e.status === 'APPROVED' || e.status === 'REJECTED') && !editUnlocked.has(e.id)
                    // Find an approved (but OTP not yet used) edit request for this expense
                    const approvedEr = editRequests.find(er => String(er.itemId) === e.id && er.status === 'APPROVED' && !er.otpUsed)
                    return (
                      <tr key={e.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-5 py-3">
                          <p className="text-sm font-medium text-gray-900">{e.title}</p>
                          {e.notes && <p className="text-xs text-gray-400 mt-0.5 truncate max-w-xs">{e.notes}</p>}
                        </td>
                        <td className="px-5 py-3">
                          {e.projectId ? (
                            <Link href={`/admin/projects/${e.projectId?.id ?? e.projectId?._id ?? e.projectId}`}
                              className="text-sm text-blue-600 hover:underline font-medium">
                              {e.projectId.name ?? '—'}
                            </Link>
                          ) : <span className="text-sm text-gray-400">—</span>}
                          {e.venture && (
                            <span className={`ml-2 px-1.5 py-0.5 text-xs font-medium rounded ${VENTURE_COLORS[e.venture] ?? 'bg-gray-100 text-gray-500'}`}>
                              {e.venture}
                            </span>
                          )}
                        </td>
                        <td className="px-5 py-3 text-sm text-gray-600">{e.category}</td>
                        <td className="px-5 py-3 text-sm text-gray-700">{e.submittedBy?.name ?? '—'}</td>
                        <td className="px-5 py-3 text-sm text-gray-500">{fmtDate(e.date)}</td>
                        <td className="px-5 py-3 text-sm font-semibold text-gray-900 text-right"><TkAmt value={e.amount} decimals={2} /></td>
                        <td className="px-5 py-3">
                          <div className="flex items-center gap-1.5">
                            {e.invoiceUrl && (
                              <a href={e.invoiceUrl} target="_blank" rel="noopener noreferrer"
                                className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                                <Paperclip className="w-3 h-3" /> Invoice
                              </a>
                            )}
                            {e.receiptUrl && (
                              <a href={e.receiptUrl} target="_blank" rel="noopener noreferrer"
                                className="flex items-center gap-1 text-xs text-blue-600 hover:underline">
                                <Paperclip className="w-3 h-3" /> Receipt
                              </a>
                            )}
                            {!e.invoiceUrl && !e.receiptUrl && <span className="text-xs text-gray-300">—</span>}
                          </div>
                        </td>
                        <td className="px-5 py-3 text-right">
                          {prStatus === 'PENDING' ? (
                            <button onClick={() => setApprovingPr(e)}
                              className="px-3 py-1.5 text-xs font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors">
                              Review
                            </button>
                          ) : isLocked ? (
                            <div className="flex items-center justify-end gap-1.5">
                              <button onClick={() => setEditRequestModal(e)}
                                className="px-2.5 py-1.5 text-xs font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition-colors whitespace-nowrap">
                                Request Edit
                              </button>
                              {approvedEr && (
                                <button onClick={() => setOtpModal({ requestId: approvedEr.id, expenseId: e.id })}
                                  className="px-2.5 py-1.5 text-xs font-medium text-blue-700 bg-blue-50 border border-blue-200 rounded-lg hover:bg-blue-100 transition-colors whitespace-nowrap">
                                  Enter OTP
                                </button>
                              )}
                            </div>
                          ) : (
                            <button onClick={() => setApprovingPr(e)}
                              className="px-3 py-1.5 text-xs font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors">
                              Edit
                            </button>
                          )}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            )}

            {prMeta.pages > 1 && (
              <div className="px-5 py-4 border-t border-gray-100">
                <Pagination page={prMeta.page} pages={prMeta.pages} onChange={(p) => setPrPage(p)} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── WITHDRAWALS ── */}
      {tab === 'Withdrawals' && (() => {
        const WD_STATUS_COLORS = {
          PENDING:  'bg-yellow-100 text-yellow-700',
          APPROVED: 'bg-green-100 text-green-700',
          PAID:     'bg-teal-100 text-teal-700',
          REJECTED: 'bg-red-100 text-red-600',
        }
        const ic = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900'
        return (
          <div className="space-y-4">
            {/* Filter */}
            <div className="flex items-center gap-3">
              <span className="text-sm text-gray-500">Filter by status</span>
              <select value={wdStatus} onChange={e => setWdStatus(e.target.value)}
                className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500">
                <option value="">All</option>
                <option value="PENDING">Pending</option>
                <option value="APPROVED">Approved</option>
                <option value="REJECTED">Rejected</option>
              </select>
            </div>

            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              {wdLoading ? (
                <div className="flex justify-center py-12">
                  <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-700 rounded-full animate-spin" />
                </div>
              ) : wdList.length === 0 ? (
                <div className="py-16 text-center text-gray-400 text-sm">No withdrawal requests found</div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[800px]">
                    <thead>
                      <tr className="border-b border-gray-100 bg-gray-50/50">
                        {['Freelancer', 'Project', 'Amount', 'Method', 'Details', 'Requested', 'Status', 'Actions'].map(h => (
                          <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">{h}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {wdList.map(wd => {
                        const wdId   = wd.id ?? wd._id
                        const flName = wd.freelancerId?.userId?.name ?? '—'
                        const flEmail = wd.freelancerId?.userId?.email ?? ''
                        return (
                          <tr key={wdId} className="hover:bg-gray-50/50 transition-colors">
                            <td className="px-4 py-3.5">
                              <p className="text-sm font-medium text-gray-900">{flName}</p>
                              {flEmail && <p className="text-xs text-gray-400">{flEmail}</p>}
                            </td>
                            <td className="px-4 py-3.5">
                              {wd.projectId ? (
                                <div>
                                  <p className="text-sm text-gray-700">{wd.projectId.name}</p>
                                  {wd.projectId.projectCode && <p className="text-xs text-gray-400 font-mono">{wd.projectId.projectCode}</p>}
                                </div>
                              ) : <span className="text-gray-400 text-sm">—</span>}
                            </td>
                            <td className="px-4 py-3.5 text-sm font-semibold text-gray-900">
                              <TkAmt value={wd.amount} decimals={2} />
                            </td>
                            <td className="px-4 py-3.5 text-sm text-gray-600">{wd.method}</td>
                            <td className="px-4 py-3.5 text-sm text-gray-500 max-w-[150px] truncate" title={wd.paymentDetails ?? ''}>
                              {wd.paymentDetails ?? '—'}
                            </td>
                            <td className="px-4 py-3.5 text-sm text-gray-500">
                              {fmtDate(wd.createdAt)}
                            </td>
                            <td className="px-4 py-3.5">
                              <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${WD_STATUS_COLORS[wd.status] ?? 'bg-gray-100 text-gray-600'}`}>
                                {wd.status}
                              </span>
                            </td>
                            <td className="px-4 py-3.5">
                              {wd.status === 'PENDING' && (
                                <div className="flex items-center gap-1.5">
                                  <button
                                    onClick={() => { setWdApproveModal(wd); setWdApproveNote('') }}
                                    className="flex items-center gap-1 px-2.5 py-1 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 transition-colors"
                                  >
                                    <CheckCircle2 className="w-3 h-3" /> Approve
                                  </button>
                                  <button
                                    onClick={() => handleRejectWithdrawal(wdId)}
                                    disabled={rejectingWd === wdId}
                                    className="flex items-center gap-1 px-2.5 py-1 border border-gray-200 text-red-600 text-xs font-medium rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
                                  >
                                    {rejectingWd === wdId ? <Loader2 className="w-3 h-3 animate-spin" /> : <XCircle className="w-3 h-3" />}
                                    Reject
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>

            {/* Approve Modal */}
            {wdApproveModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                <div className="bg-white rounded-xl border border-gray-200 w-full max-w-md p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-semibold text-gray-900">Approve Withdrawal</h3>
                    <button onClick={() => setWdApproveModal(null)} className="p-1 rounded-lg hover:bg-gray-100">
                      <X className="w-4 h-4 text-gray-400" />
                    </button>
                  </div>
                  <div className="bg-gray-50 rounded-lg px-4 py-3 space-y-1">
                    <p className="text-sm font-semibold text-gray-900">
                      {wdApproveModal.freelancerId?.userId?.name ?? '—'}
                    </p>
                    <p className="text-xs text-gray-500">Amount: <TkAmt value={wdApproveModal.amount} decimals={2} /></p>
                    <p className="text-xs text-gray-500">Method: {wdApproveModal.method}</p>
                    {wdApproveModal.paymentDetails && (
                      <p className="text-xs text-gray-500">Details: {wdApproveModal.paymentDetails}</p>
                    )}
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-gray-500 mb-1">Note (optional)</label>
                    <textarea value={wdApproveNote} onChange={e => setWdApproveNote(e.target.value)}
                      rows={2} placeholder="Add a note…"
                      className={`${ic} resize-none`} />
                  </div>
                  <div className="flex gap-2 justify-end">
                    <button onClick={() => setWdApproveModal(null)}
                      className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">
                      Cancel
                    </button>
                    <button
                      onClick={() => handleApproveWithdrawal(wdApproveModal)}
                      disabled={approvingWd === (wdApproveModal.id ?? wdApproveModal._id)}
                      className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-50 flex items-center gap-2"
                    >
                      {approvingWd === (wdApproveModal.id ?? wdApproveModal._id) && <Loader2 className="w-4 h-4 animate-spin" />}
                      <CheckCircle2 className="w-4 h-4" /> Confirm Approval
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )
      })()}

      {/* ── P&L REPORT ── */}
      {tab === 'P&L Report' && (
        <div className="space-y-6">
          <div className="bg-white rounded-xl border border-gray-100 p-4 flex items-center gap-3 flex-wrap">
            <span className="text-sm text-gray-700">Report period:</span>
            <input type="date" value={plStart} onChange={(e) => setPlStart(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
            <span className="text-gray-400">to</span>
            <input type="date" value={plEnd} onChange={(e) => setPlEnd(e.target.value)}
              className="border border-gray-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
            <button onClick={loadPL} disabled={plLoading}
              className="px-4 py-1.5 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-60 transition-colors">
              {plLoading ? 'Loading…' : 'Generate'}
            </button>
          </div>

          {plLoading ? <Spinner /> : plReport ? (
            <>
              {/* P&L stats row */}
              <div className="flex items-center gap-0 divide-x divide-gray-200 bg-white border border-gray-100 rounded-xl px-2 py-4">
                <div className="flex-1 px-6 text-center">
                  <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Total Income</p>
                  <p className="text-xl font-bold text-green-600"><TkAmt value={plReport.summary.totalIncome} decimals={2} /></p>
                </div>
                <div className="flex-1 px-6 text-center">
                  <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Total Expense</p>
                  <p className="text-xl font-bold text-red-500"><TkAmt value={plReport.summary.totalExpense} decimals={2} /></p>
                </div>
                <div className="flex-1 px-6 text-center">
                  <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Net Profit</p>
                  <p className={`text-xl font-bold ${plReport.summary.netProfit >= 0 ? 'text-gray-900' : 'text-red-500'}`}>
                    <TkAmt value={plReport.summary.netProfit} decimals={2} />
                  </p>
                </div>
                <div className="flex-1 px-6 text-center">
                  <p className="text-xs text-gray-400 uppercase tracking-wide mb-1">Profit Margin</p>
                  <p className={`text-xl font-bold ${plReport.summary.margin >= 0 ? 'text-gray-900' : 'text-red-500'}`}>
                    {plReport.summary.margin?.toFixed(1)}%
                  </p>
                </div>
              </div>

              {plReport.rows.length === 0 ? (
                <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
                  <p className="text-sm text-gray-400">No transactions in this period</p>
                </div>
              ) : (
                <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                  <table className="w-full">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="px-6 py-3 text-left text-xs text-gray-400 uppercase tracking-wide">Month</th>
                        <th className="px-6 py-3 text-right text-xs text-gray-400 uppercase tracking-wide">Income</th>
                        <th className="px-6 py-3 text-right text-xs text-gray-400 uppercase tracking-wide">Expenses</th>
                        <th className="px-6 py-3 text-right text-xs text-gray-400 uppercase tracking-wide">Net Profit</th>
                        <th className="px-6 py-3 text-right text-xs text-gray-400 uppercase tracking-wide">Margin</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {plReport.rows.map((row) => {
                        const margin = row.totalIncome > 0 ? (row.netProfit / row.totalIncome) * 100 : 0
                        return (
                          <tr key={row.month} className="hover:bg-gray-50 transition-colors">
                            <td className="px-6 py-3 text-sm font-medium text-gray-900">{fmtMonth(row.month)}</td>
                            <td className="px-6 py-3 text-sm text-green-600 font-medium text-right">{fmt(row.totalIncome)}</td>
                            <td className="px-6 py-3 text-sm text-red-500 font-medium text-right">{fmt(row.totalExpense)}</td>
                            <td className={`px-6 py-3 text-sm font-semibold text-right ${row.netProfit >= 0 ? 'text-gray-900' : 'text-red-600'}`}>
                              {fmt(row.netProfit)}
                            </td>
                            <td className="px-6 py-3 text-sm text-gray-500 text-right">{margin.toFixed(1)}%</td>
                          </tr>
                        )
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t-2 border-gray-200 bg-gray-50 font-semibold">
                        <td className="px-6 py-3 text-sm text-gray-700">Total</td>
                        <td className="px-6 py-3 text-sm text-green-700 text-right">{fmt(plReport.summary.totalIncome)}</td>
                        <td className="px-6 py-3 text-sm text-red-600 text-right">{fmt(plReport.summary.totalExpense)}</td>
                        <td className={`px-6 py-3 text-sm text-right ${plReport.summary.netProfit >= 0 ? 'text-gray-900' : 'text-red-700'}`}>
                          {fmt(plReport.summary.netProfit)}
                        </td>
                        <td className="px-6 py-3 text-sm text-gray-600 text-right">{plReport.summary.margin?.toFixed(1)}%</td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              )}
            </>
          ) : (
            <div className="bg-white rounded-xl border border-gray-100 p-12 text-center">
              <p className="text-sm text-gray-400">Select a date range and click Generate</p>
            </div>
          )}
        </div>
      )}

      <TransactionModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        tx={editingTx}
        onSaved={handleSaved}
        currentUser={session?.user}
      />

      {approvingPr && (
        <ApproveModal
          expense={approvingPr}
          onClose={() => setApprovingPr(null)}
          onDone={() => { loadPaymentRequests(); loadSummary() }}
        />
      )}

      {confirmingPc && (
        <ConfirmPaymentModal
          payment={confirmingPc}
          currentUser={session?.user}
          onClose={() => setConfirmingPc(null)}
          onDone={() => { loadPaymentConfirmations(); loadSummary(); loadTransactions() }}
        />
      )}

      {editRequestModal && (
        <RequestEditModal
          expense={editRequestModal}
          onClose={() => setEditRequestModal(null)}
          onSubmitted={() => loadEditRequests()}
        />
      )}

      {otpModal && (
        <OtpVerifyModal
          requestId={otpModal.requestId}
          expenseId={otpModal.expenseId}
          onVerified={(id) => setEditUnlocked(prev => new Set([...prev, id]))}
          onClose={() => setOtpModal(null)}
        />
      )}

      {ownerOtpModal && (
        <OwnerOtpModal
          otp={ownerOtpModal.otp}
          requesterName={ownerOtpModal.requesterName}
          onClose={() => setOwnerOtpModal(null)}
        />
      )}
    </div>
  )
}
