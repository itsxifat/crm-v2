'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSession } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import {
  TrendingUp, TrendingDown, DollarSign, AlertCircle,
  Plus, Pencil, Trash2, X, Loader2, Clock, CheckCircle2, XCircle,
  Paperclip, ExternalLink, ArrowUpRight, ArrowDownRight, BarChart2, Percent, FileText as FileTextIcon, ChevronLeft,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Pagination from '@/components/ui/Pagination'
import FileUpload from '@/components/ui/FileUpload'
import Link from 'next/link'
import TkAmt from '@/components/ui/TkAmt'
import Select from '@/components/ui/Select'
import DatePicker from '@/components/ui/DatePicker'
import DocPreview from '@/components/ui/DocPreview'

// ─── Constants ───────────────────────────────────────────────────────────────

const INCOME_CATEGORIES  = ['Project Revenue', 'Retainer', 'Consulting', 'Product Sale', 'Referral', 'Other Income']
const EXPENSE_CATEGORIES = ['Payroll', 'Freelancer Payment', 'Agency Payment', 'Vendor Payment', 'Equipment', 'Employee Expense', 'Software', 'Marketing', 'Office', 'Travel', 'Tax', 'Other Expense']
const CURRENCY_OPTIONS   = ['BDT']
const PAYMENT_METHODS    = ['CASH', 'BANK_TRANSFER', 'CARD', 'CHEQUE', 'ONLINE', 'OTHER']

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
  freelancerId:     z.string().optional(),
  vendorId:         z.string().optional(),
  agencyId:         z.string().optional(),
  paidTo:           z.string().optional(),
  paidToEmployeeId: z.string().optional(),
  paidToName:       z.string().optional(),
  conveyanceType:   z.string().optional(),
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
  const [invoices,    setInvoices]    = useState([])
  const [users,       setUsers]       = useState([])
  const [freelancers, setFreelancers] = useState([])
  const [agencies,    setAgencies]    = useState([])
  const [employees,   setEmployees]   = useState([])
  const [vendors,     setVendors]     = useState([])
  const [txnIdVal,    setTxnIdVal]    = useState('')
  const [conveyanceType, setConveyanceType] = useState('employee')

  const { register, control, handleSubmit, watch, reset, setValue, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(txSchema),
    defaultValues: { type: 'INCOME', currency: 'BDT', date: new Date().toISOString().slice(0,10) },
  })
  const type       = watch('type')
  const category   = watch('category')
  const categories = type === 'INCOME' ? INCOME_CATEGORIES : EXPENSE_CATEGORIES

  // Dynamic entity selectors
  const isExpense           = type === 'EXPENSE'
  const isFreelancerPayment = isExpense && category === 'Freelancer Payment'
  const isAgencyPayment     = isExpense && category === 'Agency Payment'
  const isPayroll           = isExpense && (category === 'Payroll' || category === 'Employee Salary')
  const isVendorPayment     = isExpense && category === 'Vendor Payment'
  const isEquipment         = isExpense && category === 'Equipment'
  const isEmployeeExpense   = isExpense && category === 'Employee Expense'
  const isTravel            = isExpense && category === 'Travel'

  useEffect(() => {
    if (open) {
      fetch('/api/projects?limit=200').then(r => r.json()).then(j => setProjects(j.data ?? []))
      fetch('/api/invoices?limit=200').then(r => r.json()).then(j => setInvoices((j.data ?? []).filter(inv => !['PAID','CANCELLED','DRAFT'].includes(inv.status))))
      fetch('/api/users?limit=200&roles=EMPLOYEE,MANAGER,SUPER_ADMIN').then(r => r.json()).then(j => setUsers(j.data ?? []))
      fetch('/api/freelancers?limit=200&type=FREELANCER').then(r => r.json()).then(j => setFreelancers(j.data ?? []))
      fetch('/api/freelancers?limit=200&type=AGENCY').then(r => r.json()).then(j => setAgencies(j.data ?? []))
      fetch('/api/employees?limit=200').then(r => r.json()).then(j => setEmployees(j.data ?? []))
      fetch('/api/vendors?limit=200').then(r => r.json()).then(j => setVendors(j.data ?? []))
      const url = isEdit ? tx.receiptUrl ?? '' : ''
      setReceiptUrl(url)
      setTxnIdVal(isEdit ? tx.txnId ?? '' : '')
      setConveyanceType('employee')
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
        invoiceId:      tx.invoiceId?.id ?? tx.invoiceId ?? '',
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
            <Controller name="category" control={control} render={({ field }) => (
              <Select value={field.value} onChange={v => field.onChange(v ?? '')}
                options={categories.map(c => ({ value: c, label: c }))}
                placeholder="Select…"
              />
            )} />
            {errors.category && <p className="mt-1 text-xs text-red-500">{errors.category.message}</p>}
          </div>
          <div>
            <label className={lc}>Amount (BDT) *</label>
            <div className="flex gap-2 items-center">
              <span className="text-sm font-medium text-gray-500 border border-gray-200 rounded-lg px-3 py-2 bg-gray-50">BDT</span>
              <input type="number" step="0.01" min="0" placeholder="0.00" {...register('amount')} onKeyDown={e => { if (e.key === '-' || e.key === 'e') e.preventDefault() }}
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
            <Controller name="date" control={control} render={({ field }) => (
              <DatePicker value={field.value || null} onChange={v => field.onChange(v ?? '')} />
            )} />
            {errors.date && <p className="mt-1 text-xs text-red-500">{errors.date.message}</p>}
          </div>
          <div>
            <label className={lc}>Payment Method</label>
            <Controller name="paymentMethod" control={control} render={({ field }) => (
              <Select value={field.value} onChange={v => field.onChange(v ?? '')}
                options={PAYMENT_METHODS.map(m => ({ value: m, label: m.replace('_', ' ') }))}
                placeholder="Select…"
              />
            )} />
          </div>
        </div>

        {/* Dynamic entity selectors based on category */}
        {isFreelancerPayment && (
          <div>
            <label className={lc}>Freelancer *</label>
            <Controller name="freelancerId" control={control} render={({ field }) => (
              <Select value={field.value} onChange={v => field.onChange(v ?? '')}
                options={freelancers.map(f => ({ value: f.id, label: `${f.userId?.name ?? f.id}${f.userId?.email ? ` — ${f.userId.email}` : ''}` }))}
                placeholder="Select freelancer…"
              />
            )} />
          </div>
        )}
        {isAgencyPayment && (
          <div>
            <label className={lc}>Agency *</label>
            <Controller name="agencyId" control={control} render={({ field }) => (
              <Select value={field.value} onChange={v => field.onChange(v ?? '')}
                options={agencies.map(a => ({ value: a.id, label: a.agencyInfo?.agencyName ?? a.userId?.name ?? 'Unknown Agency' }))}
                placeholder="Select agency…"
              />
            )} />
          </div>
        )}
        {(isVendorPayment || isEquipment) && (
          <div>
            <label className={lc}>{isEquipment ? 'Purchased from (Vendor) *' : 'Vendor *'}</label>
            <Controller name="vendorId" control={control} render={({ field }) => (
              <Select value={field.value} onChange={v => field.onChange(v ?? '')}
                options={vendors.map(v => ({ value: v.id, label: `${v.company}${v.serviceType ? ` — ${v.serviceType}` : ''}` }))}
                placeholder="Select vendor…"
              />
            )} />
          </div>
        )}
        {(isPayroll || isEmployeeExpense) && (
          <div>
            <label className={lc}>{isPayroll ? 'Employee *' : 'Employee *'}</label>
            <Controller name="paidTo" control={control} render={({ field }) => (
              <Select value={field.value} onChange={v => field.onChange(v ?? '')}
                options={employees.filter(e => e.userId?.id).map(e => ({ value: e.id, label: `${e.userId.name}${e.designation ? ` — ${e.designation}` : ''}${isPayroll && e.salary ? ` (BDT ${Number(e.salary).toLocaleString()}/mo)` : ''}` }))}
                placeholder="Select employee…"
              />
            )} />
          </div>
        )}
        {isTravel && (
          <div className="space-y-2">
            <label className={lc}>Conveyance paid to *</label>
            <div className="flex gap-2">
              {['employee', 'freelancer', 'other'].map(t => (
                <button key={t} type="button"
                  onClick={() => { setConveyanceType(t); setValue('paidTo', ''); setValue('freelancerId', ''); setValue('paidToName', '') }}
                  className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-colors ${conveyanceType === t ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:border-gray-400'}`}>
                  {t.charAt(0).toUpperCase() + t.slice(1)}
                </button>
              ))}
            </div>
            {conveyanceType === 'employee' && (
              <Controller name="paidTo" control={control} render={({ field }) => (
                <Select value={field.value} onChange={v => field.onChange(v ?? '')}
                  options={employees.filter(e => e.userId?.id).map(e => ({ value: e.id, label: `${e.userId.name}${e.designation ? ` — ${e.designation}` : ''}` }))}
                  placeholder="Select employee…"
                />
              )} />
            )}
            {conveyanceType === 'freelancer' && (
              <Controller name="freelancerId" control={control} render={({ field }) => (
                <Select value={field.value} onChange={v => field.onChange(v ?? '')}
                  options={[...freelancers, ...agencies].map(f => ({ value: f.id, label: f.agencyInfo?.agencyName ?? f.userId?.name ?? 'Unknown' }))}
                  placeholder="Select freelancer / agency…"
                />
              )} />
            )}
            {conveyanceType === 'other' && (
              <input {...register('paidToName')} placeholder="Enter name…" className={ic} />
            )}
          </div>
        )}

        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={lc}>Vendor (manual)</label>
            <input {...register('vendor')} placeholder="Vendor / Supplier name" className={ic} />
          </div>
          <div>
            <label className={lc}>Paid By</label>
            <Controller name="paidBy" control={control} render={({ field }) => (
              <Select value={field.value} onChange={v => field.onChange(v ?? '')}
                options={users.map(u => ({ value: u.id, label: u.name }))}
                placeholder="Select person…"
              />
            )} />
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
            <Controller name="projectId" control={control} render={({ field }) => (
              <Select value={field.value} onChange={v => field.onChange(v ?? '')}
                options={projects.map(p => ({ value: p.id, label: p.name }))}
                placeholder="None"
              />
            )} />
          </div>
          <div>
            <label className={lc}>Reference</label>
            <input {...register('reference')} placeholder="INV-001, PO-123…" className={ic} />
          </div>
        </div>

        {type === 'INCOME' && (
          <div>
            <label className={lc}>Link to Invoice <span className="text-gray-400 font-normal text-xs">(syncs invoice paid amount)</span></label>
            <Controller name="invoiceId" control={control} render={({ field }) => (
              <Select value={field.value} onChange={v => field.onChange(v ?? '')}
                options={invoices.map(inv => ({ value: inv.id, label: `${inv.invoiceNumber} — ${inv.clientId?.name ?? inv.clientId ?? 'Client'} (৳${(inv.total ?? 0).toLocaleString()})` }))}
                placeholder="None"
              />
            )} />
          </div>
        )}

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

function ApproveModal({ expense, onClose, onDone, currentUser }) {
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
      <div className="bg-white rounded-xl border border-gray-200 w-full max-w-2xl max-h-[90vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <h3 className="text-base font-semibold text-gray-900">Review Payment Request</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">

          {/* Two-column layout: summary + invoice preview */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">

            {/* Left: expense summary */}
            <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-4 space-y-2">
              <p className="text-sm font-semibold text-gray-900">{expense.title}</p>
              <p className="text-xs text-gray-500">{expense.category} · {fmtDate(expense.date)}</p>
              <p className="text-xl font-bold text-gray-900"><TkAmt value={expense.amount} decimals={2} /></p>
              {expense.submittedBy?.name && (
                <p className="text-xs text-gray-500">Submitted by: <span className="font-medium text-gray-700">{expense.submittedBy.name}</span></p>
              )}
              {expense.notes && (
                <p className="text-xs text-gray-500 border-t border-gray-200 pt-2 mt-2">{expense.notes}</p>
              )}
            </div>

            {/* Right: submitted invoice preview */}
            {expense.invoiceUrl ? (
              <DocPreview
                url={expense.invoiceUrl}
                label="Submitted Invoice / Receipt"
              />
            ) : (
              <div className="rounded-xl bg-gray-50 border border-dashed border-gray-200 flex items-center justify-center py-8">
                <p className="text-xs text-gray-400">No invoice submitted</p>
              </div>
            )}
          </div>

          {/* Upload your receipt */}
          <FileUpload
            label={
              hasSubmittedInvoice
                ? 'Your Receipt (pre-filled — replace if needed)'
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
        </div>

        {/* Footer */}
        <div className="flex gap-2 justify-end px-6 py-4 border-t border-gray-100 shrink-0">
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
            <DocPreview url={payment.receiptUrl} compact />
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


function AccountsContent() {
  const { data: session }  = useSession()
  const searchParams       = useSearchParams()
  const activeTab          = searchParams.get('tab') || 'overview'
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
  const [txType,    setTxType]    = useState('')
  const [txPage,    setTxPage]    = useState(1)
  const [period,    setPeriod]    = useState('month')
  const [startDate, setStartDate] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  })
  const [endDate,   setEndDate]   = useState(() => new Date().toISOString().slice(0, 10))
  const [plStart,   setPlStart]   = useState(() => `${new Date().getFullYear()}-01-01`)
  const [plEnd,     setPlEnd]     = useState(() => new Date().toISOString().slice(0, 10))

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

  useEffect(() => { if (activeTab === 'overview') loadSummary() },             [activeTab, loadSummary])
  useEffect(() => {
    if (activeTab === 'overview') {
      fetch('/api/dashboard/stats')
        .then(r => r.json())
        .then(j => { if (j.data) setDashStats(j.data) })
        .catch(() => {})
    }
  }, [activeTab])
  useEffect(() => { if (activeTab === 'transactions')  loadTransactions()         }, [activeTab, loadTransactions])
  useEffect(() => { if (activeTab === 'confirmations') loadPaymentConfirmations() }, [activeTab, loadPaymentConfirmations])
  useEffect(() => { if (activeTab === 'requests')      loadPaymentRequests()      }, [activeTab, loadPaymentRequests])
  useEffect(() => { if (activeTab === 'withdrawals')   { loadWithdrawals(); loadEditRequests() } }, [activeTab, loadWithdrawals, loadEditRequests])
  useEffect(() => { if (activeTab === 'pl')            loadPL()                   }, [activeTab, loadPL])


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

  const tabBtnCls = (t) =>
    `px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
      activeTab === t
        ? 'bg-gray-900 text-white border-gray-900'
        : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400 hover:text-gray-800'
    }`

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Accounts</h1>
          <p className="text-sm text-gray-400 mt-0.5">Track income, expenses and financial health</p>
        </div>
        {(activeTab === 'overview' || activeTab === 'transactions') && (
          <button
            onClick={() => { setEditingTx(null); setModalOpen(true) }}
            className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Transaction
          </button>
        )}
      </div>

      {/* ── OVERVIEW tab ── */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Date range selector */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-gray-500 font-medium">Period</span>
            <DatePicker value={startDate || null} onChange={v => setStartDate(v ?? '')} />
            <span className="text-gray-400 text-sm">to</span>
            <DatePicker value={endDate || null} onChange={v => setEndDate(v ?? '')} />
            {(startDate || endDate) && (
              <button
                onClick={() => { setStartDate(''); setEndDate('') }}
                className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5 rounded hover:bg-gray-100 transition-colors"
              >
                Clear
              </button>
            )}
          </div>

          {loading ? <Spinner /> : summary ? (
            <>
              {(() => {
                const f = dashStats?.financials ?? {}
                const fmtVal = (n) => n == null ? '—' : `BDT ${Number(n).toLocaleString('en-BD', { minimumFractionDigits: 0 })}`
                const CARDS = [
                  { label: 'Monthly Income',  value: fmtVal(f.income?.value),  prev: `vs ${fmtVal(f.income?.prevValue)} last month`,  change: f.income?.change,  icon: TrendingUp,   bg: 'bg-green-50',  color: 'text-green-600' },
                  { label: 'Monthly Expense', value: fmtVal(f.expense?.value), prev: `vs ${fmtVal(f.expense?.prevValue)} last month`, change: f.expense?.change, invert: true, icon: TrendingDown, bg: 'bg-red-50',    color: 'text-red-500' },
                  { label: 'Net Profit',      value: fmtVal(f.profit?.value),  prev: `vs ${fmtVal(f.profit?.prevValue)} last month`,  change: f.profit?.change,  icon: DollarSign,   bg: 'bg-blue-50',   color: 'text-blue-600' },
                  { label: 'Gross Margin',    value: `${f.grossMargin?.value ?? 0}%`,  prev: `was ${f.grossMargin?.prevValue ?? 0}% last month`,  change: f.grossMargin?.value  != null && f.grossMargin?.prevValue  != null ? (f.grossMargin.value  - f.grossMargin.prevValue)  : null, icon: Percent,      bg: 'bg-purple-50', color: 'text-purple-600' },
                  { label: 'Expense Ratio',   value: `${f.expenseRatio?.value ?? 0}%`, prev: `was ${f.expenseRatio?.prevValue ?? 0}% last month`, change: f.expenseRatio?.value != null && f.expenseRatio?.prevValue != null ? (f.expenseRatio.value - f.expenseRatio.prevValue) : null, invert: true, icon: BarChart2, bg: 'bg-orange-50', color: 'text-orange-500' },
                  { label: 'Transactions',    value: f.transactions?.value ?? 0,       prev: `${f.transactions?.prevValue ?? 0} last month`,      change: f.transactions?.change,  icon: FileTextIcon, bg: 'bg-indigo-50', color: 'text-indigo-600' },
                ]
                const monthOptions = Array.from({ length: 6 }, (_, i) => ({ key: getDrillKey(i), label: getMonthLabel(i) }))
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
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-gray-400 mr-1">Drill down by month:</span>
                      {monthOptions.map(m => (
                        <button key={m.key} onClick={() => setDrillKey(prev => prev === m.key ? null : m.key)} className={tabBtnCls(drillKey === m.key ? 'overview' : '__none__')}>
                          {m.label}
                        </button>
                      ))}
                    </div>
                    {drillKey && <CalendarDrillDown drillKey={drillKey} onClose={() => setDrillKey(null)} />}
                  </>
                )
              })()}
            </>
          ) : null}
        </div>
      )}

      {/* ── TRANSACTIONS tab ── */}
      {activeTab === 'transactions' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-gray-500 font-medium">Period</span>
            <DatePicker value={startDate || null} onChange={v => { setStartDate(v ?? ''); setTxPage(1) }} />
            <span className="text-gray-400 text-sm">to</span>
            <DatePicker value={endDate || null} onChange={v => { setEndDate(v ?? ''); setTxPage(1) }} />
            {(startDate || endDate) && (
              <button onClick={() => { setStartDate(''); setEndDate(''); setTxPage(1) }} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5 rounded hover:bg-gray-100 transition-colors">Clear</button>
            )}
            <div className="flex gap-1 ml-auto">
              {[['', 'All'], ['INCOME', 'Income'], ['EXPENSE', 'Expense']].map(([v, l]) => (
                <button key={v} onClick={() => { setTxType(v); setTxPage(1) }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${txType === v ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            {txLoading ? <Spinner /> : txList.length === 0 ? (
              <div className="text-center py-16 text-gray-400 text-sm">No transactions found</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[700px]">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Date</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Type</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Category</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Description</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">Amount</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Method</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Ref</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {txList.map(tx => (
                      <tr key={tx.id ?? tx._id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{fmtDate(tx.date)}</td>
                        <td className="px-4 py-3"><StatusDot status={tx.type} /></td>
                        <td className="px-4 py-3 text-xs text-gray-600">{tx.category}</td>
                        <td className="px-4 py-3 text-xs text-gray-700 max-w-[200px] truncate">{tx.description}</td>
                        <td className={`px-4 py-3 text-right text-sm font-semibold whitespace-nowrap ${tx.type === 'INCOME' ? 'text-green-600' : 'text-red-500'}`}>
                          {tx.type === 'INCOME' ? '+' : '-'}{fmt(tx.amount)}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">{tx.paymentMethod?.replace(/_/g, ' ') ?? '—'}</td>
                        <td className="px-4 py-3 text-xs text-gray-500">
                          {tx.receiptUrl ? (
                            <a href={tx.receiptUrl} target="_blank" rel="noreferrer" className="flex items-center gap-1 text-blue-600 hover:underline">
                              <Paperclip className="w-3 h-3" /> Receipt
                            </a>
                          ) : tx.txnId ? (
                            <span className="font-mono text-xs">{tx.txnId}</span>
                          ) : '—'}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 justify-end">
                            <button onClick={() => { setEditingTx(tx); setModalOpen(true) }} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            <button onClick={() => handleDelete(tx)} className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors">
                              <Trash2 className="w-3.5 h-3.5" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {txMeta.pages > 1 && (
              <div className="px-4 py-3 border-t border-gray-100">
                <Pagination meta={txMeta} page={txPage} onPageChange={setTxPage} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── PAYMENT CONFIRMATIONS tab ── */}
      {activeTab === 'confirmations' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            {[['PENDING_CONFIRMATION', 'Pending'], ['CONFIRMED', 'Confirmed'], ['REJECTED', 'Rejected'], ['', 'All']].map(([v, l]) => (
              <button key={v} onClick={() => { setPcStatus(v); setPcPage(1) }}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${pcStatus === v ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'}`}>
                {l}
              </button>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            {pcLoading ? <Spinner /> : pcList.length === 0 ? (
              <div className="text-center py-16 text-gray-400 text-sm">No payment confirmations found</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[600px]">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Project</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Client</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Invoice</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">Amount</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Status</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Submitted By</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {pcList.map(pc => (
                      <tr key={pc.id ?? pc._id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-4 py-3">
                          <p className="text-xs font-medium text-gray-800">{pc.projectId?.name ?? '—'}</p>
                          {pc.projectId?.projectCode && <p className="text-xs text-gray-400">{pc.projectId.projectCode}</p>}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600">{pc.clientId?.userId?.name ?? '—'}</td>
                        <td className="px-4 py-3 text-xs text-gray-500">{pc.invoiceId?.invoiceNumber ?? '—'}</td>
                        <td className="px-4 py-3 text-right text-sm font-semibold text-gray-800 whitespace-nowrap">{fmt(pc.amount)}</td>
                        <td className="px-4 py-3"><StatusDot status={pc.status} /></td>
                        <td className="px-4 py-3 text-xs text-gray-500">{pc.submittedBy?.name ?? '—'}</td>
                        <td className="px-4 py-3">
                          {pc.status === 'PENDING_CONFIRMATION' && (
                            <button onClick={() => setConfirmingPc(pc)}
                              className="px-3 py-1.5 text-xs font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors">
                              Review
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {pcMeta.pages > 1 && (
              <div className="px-4 py-3 border-t border-gray-100">
                <Pagination meta={pcMeta} page={pcPage} onPageChange={setPcPage} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── PAYMENT REQUESTS tab ── */}
      {activeTab === 'requests' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            {[['PENDING', 'Pending'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected'], ['', 'All']].map(([v, l]) => (
              <button key={v} onClick={() => { setPrStatus(v); setPrPage(1) }}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${prStatus === v ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'}`}>
                {l}
              </button>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            {prLoading ? <Spinner /> : prList.length === 0 ? (
              <div className="text-center py-16 text-gray-400 text-sm">No payment requests found</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Title</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Category</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Project</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">Amount</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Status</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Submitted By</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Date</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {prList.map(pr => (
                      <tr key={pr.id ?? pr._id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-4 py-3 text-xs font-medium text-gray-800 max-w-[160px] truncate">{pr.title ?? pr.description ?? '—'}</td>
                        <td className="px-4 py-3 text-xs text-gray-600">{pr.category ?? '—'}</td>
                        <td className="px-4 py-3 text-xs text-gray-500">{pr.projectId?.name ?? '—'}</td>
                        <td className="px-4 py-3 text-right text-sm font-semibold text-gray-800 whitespace-nowrap">{fmt(pr.amount)}</td>
                        <td className="px-4 py-3"><StatusDot status={pr.status} /></td>
                        <td className="px-4 py-3 text-xs text-gray-500">{pr.submittedBy?.name ?? '—'}</td>
                        <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{fmtDate(pr.date ?? pr.createdAt)}</td>
                        <td className="px-4 py-3">
                          {pr.status === 'PENDING' && (
                            <button onClick={() => setApprovingPr(pr)}
                              className="px-3 py-1.5 text-xs font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors">
                              Review
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {prMeta.pages > 1 && (
              <div className="px-4 py-3 border-t border-gray-100">
                <Pagination meta={prMeta} page={prPage} onPageChange={setPrPage} />
              </div>
            )}
          </div>

          {/* Edit Requests section for owners */}
          {editRequests.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <p className="text-sm font-semibold text-amber-800 mb-3">Pending Edit Requests ({editRequests.length})</p>
              <div className="space-y-2">
                {editRequests.map(er => (
                  <div key={er.id ?? er._id} className="bg-white rounded-lg border border-amber-100 px-4 py-3 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{er.requesterId?.name ?? '—'} wants to edit an expense</p>
                      {er.reason && <p className="text-xs text-gray-500 mt-0.5">{er.reason}</p>}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => handleApproveEditRequest(er)}
                        className="px-3 py-1.5 text-xs font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800">
                        Approve
                      </button>
                      <button onClick={() => setRejectingEr(er)}
                        className="px-3 py-1.5 text-xs font-medium border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50">
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── WITHDRAWALS tab ── */}
      {activeTab === 'withdrawals' && (
        <div className="space-y-4">
          <div className="flex gap-2">
            {[['', 'All'], ['PENDING', 'Pending'], ['APPROVED', 'Approved'], ['REJECTED', 'Rejected']].map(([v, l]) => (
              <button key={v} onClick={() => setWdStatus(v)}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${wdStatus === v ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'}`}>
                {l}
              </button>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            {wdLoading ? <Spinner /> : wdList.length === 0 ? (
              <div className="text-center py-16 text-gray-400 text-sm">No withdrawal requests found</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Freelancer</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Project</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">Amount</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Status</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Requested</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {wdList.map(wd => (
                      <tr key={wd.id ?? wd._id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-4 py-3">
                          <p className="text-xs font-medium text-gray-800">{wd.freelancerId?.userId?.name ?? '—'}</p>
                          {wd.freelancerId?.userId?.email && <p className="text-xs text-gray-400">{wd.freelancerId.userId.email}</p>}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">{wd.projectId?.name ?? '—'}</td>
                        <td className="px-4 py-3 text-right text-sm font-semibold text-gray-800 whitespace-nowrap">{fmt(wd.amount)}</td>
                        <td className="px-4 py-3"><StatusDot status={wd.status} /></td>
                        <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{fmtDate(wd.createdAt)}</td>
                        <td className="px-4 py-3">
                          {wd.status === 'PENDING' && (
                            <div className="flex gap-1.5 justify-end">
                              <button onClick={() => setWdApproveModal(wd)}
                                className="px-3 py-1.5 text-xs font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors">
                                Approve
                              </button>
                              <button
                                onClick={async () => {
                                  const note = window.prompt('Rejection reason (optional):') ?? ''
                                  setWdNote(note)
                                  await handleRejectWithdrawal(wd.id ?? wd._id)
                                }}
                                className="px-3 py-1.5 text-xs font-medium border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 transition-colors">
                                Reject
                              </button>
                            </div>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Approve withdrawal modal */}
          {wdApproveModal && (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
              <div className="bg-white rounded-xl border border-gray-200 w-full max-w-md p-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-base font-semibold text-gray-900">Approve Withdrawal</h3>
                  <button onClick={() => setWdApproveModal(null)} className="p-1 rounded-lg hover:bg-gray-100">
                    <X className="w-5 h-5 text-gray-400" />
                  </button>
                </div>
                <div className="bg-gray-50 rounded-lg p-4 text-sm space-y-1">
                  <p className="font-medium text-gray-800">{wdApproveModal.freelancerId?.userId?.name ?? '—'}</p>
                  <p className="text-gray-500">{wdApproveModal.projectId?.name ?? '—'}</p>
                  <p className="text-lg font-bold text-gray-900 mt-2">{fmt(wdApproveModal.amount)}</p>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700 mb-1">Note (optional)</label>
                  <textarea value={wdApproveNote} onChange={e => setWdApproveNote(e.target.value)} rows={2}
                    placeholder="Add a note…"
                    className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none" />
                </div>
                <div className="flex gap-2 justify-end">
                  <button onClick={() => setWdApproveModal(null)} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
                  <button onClick={() => handleApproveWithdrawal(wdApproveModal)} disabled={!!approvingWd}
                    className="px-4 py-2 text-sm font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 disabled:opacity-60 flex items-center gap-2">
                    {approvingWd && <Loader2 className="w-4 h-4 animate-spin" />}
                    Approve
                  </button>
                </div>
              </div>
            </div>
          )}
        </div>
      )}

      {/* ── P&L REPORT tab ── */}
      {activeTab === 'pl' && (
        <div className="space-y-6">
          {/* Date range */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-gray-500 font-medium">Period</span>
            <DatePicker value={plStart || null} onChange={v => setPlStart(v ?? '')} />
            <span className="text-gray-400 text-sm">to</span>
            <DatePicker value={plEnd || null} onChange={v => setPlEnd(v ?? '')} />
            <button onClick={loadPL}
              className="px-3 py-1.5 text-xs font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors">
              Apply
            </button>
          </div>

          {plLoading ? <Spinner /> : plReport ? (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label: 'Total Income',  value: fmt(plReport.summary?.totalIncome),  color: 'text-green-600', bg: 'bg-green-50', icon: TrendingUp },
                  { label: 'Total Expense', value: fmt(plReport.summary?.totalExpense), color: 'text-red-500',   bg: 'bg-red-50',   icon: TrendingDown },
                  { label: 'Net Profit',    value: fmt(plReport.summary?.netProfit),    color: plReport.summary?.netProfit >= 0 ? 'text-blue-600' : 'text-red-600', bg: 'bg-blue-50', icon: DollarSign },
                  { label: 'Margin',        value: `${(plReport.summary?.margin ?? 0).toFixed(1)}%`, color: 'text-purple-600', bg: 'bg-purple-50', icon: Percent },
                ].map(c => {
                  const Icon = c.icon
                  return (
                    <div key={c.label} className="bg-white border border-gray-100 rounded-xl p-5">
                      <div className={`w-9 h-9 rounded-lg ${c.bg} flex items-center justify-center mb-3`}>
                        <Icon className={`w-4 h-4 ${c.color}`} />
                      </div>
                      <p className={`text-xl font-bold ${c.color}`}>{c.value}</p>
                      <p className="text-sm text-gray-500 mt-0.5">{c.label}</p>
                    </div>
                  )
                })}
              </div>

              {/* Monthly breakdown */}
              {plReport.rows?.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100">
                    <p className="text-sm font-semibold text-gray-800">Monthly Breakdown</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-100">
                          <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Month</th>
                          <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">Income</th>
                          <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">Expense</th>
                          <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">Net Profit</th>
                          <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">Margin</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {plReport.rows.map(row => {
                          const margin = row.totalIncome > 0 ? ((row.netProfit / row.totalIncome) * 100).toFixed(1) : '0.0'
                          return (
                            <tr key={row.month} className="hover:bg-gray-50/50">
                              <td className="px-4 py-3 text-sm font-medium text-gray-700">{fmtMonth(row.month)}</td>
                              <td className="px-4 py-3 text-right text-sm font-semibold text-green-600">{fmt(row.totalIncome)}</td>
                              <td className="px-4 py-3 text-right text-sm font-semibold text-red-500">{fmt(row.totalExpense)}</td>
                              <td className={`px-4 py-3 text-right text-sm font-bold ${row.netProfit >= 0 ? 'text-blue-600' : 'text-red-600'}`}>{fmt(row.netProfit)}</td>
                              <td className="px-4 py-3 text-right text-xs text-gray-500">{margin}%</td>
                            </tr>
                          )
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="bg-gray-50 border-t-2 border-gray-200">
                          <td className="px-4 py-3 text-sm font-bold text-gray-800">Total</td>
                          <td className="px-4 py-3 text-right text-sm font-bold text-green-600">{fmt(plReport.summary?.totalIncome)}</td>
                          <td className="px-4 py-3 text-right text-sm font-bold text-red-500">{fmt(plReport.summary?.totalExpense)}</td>
                          <td className={`px-4 py-3 text-right text-sm font-bold ${plReport.summary?.netProfit >= 0 ? 'text-blue-600' : 'text-red-600'}`}>{fmt(plReport.summary?.netProfit)}</td>
                          <td className="px-4 py-3 text-right text-xs text-gray-500">{(plReport.summary?.margin ?? 0).toFixed(1)}%</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-16 text-gray-400 text-sm">Select a date range and click Apply to generate the report</div>
          )}
        </div>
      )}

      {/* ── Modals ── */}
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
          currentUser={session?.user}
          onClose={() => setApprovingPr(null)}
          onDone={() => { loadPaymentRequests(); loadSummary() }}
        />
      )}

      {confirmingPc && (
        <ConfirmPaymentModal
          payment={confirmingPc}
          currentUser={session?.user}
          onClose={() => setConfirmingPc(null)}
          onDone={() => { loadPaymentConfirmations(); loadSummary() }}
        />
      )}

      {editRequestModal && (
        <RequestEditModal
          expense={editRequestModal}
          onClose={() => setEditRequestModal(null)}
          onSubmitted={() => { setEditRequestModal(null) }}
        />
      )}

      {otpModal && (
        <OtpVerifyModal
          requestId={otpModal.requestId}
          expenseId={otpModal.expenseId}
          onVerified={() => { setOtpModal(null); setEditUnlocked(prev => new Set([...prev, otpModal.expenseId])) }}
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

      {rejectingEr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl border border-gray-200 w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-semibold text-gray-900">Reject Edit Request</h3>
            <textarea value={rejectNote} onChange={e => setRejectNote(e.target.value)} rows={3}
              placeholder="Reason for rejection (optional)…"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setRejectingEr(null); setRejectNote('') }} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={() => handleRejectEditRequest(rejectingEr, rejectNote)}
                className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700">
                Reject
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

export default function AccountsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-[60vh]"><div className="w-7 h-7 border-2 border-gray-300 border-t-gray-700 rounded-full animate-spin" /></div>}>
      <AccountsContent />
    </Suspense>
  )
}
