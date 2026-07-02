'use client'

import { useState, useEffect, useCallback, Suspense } from 'react'
import { useSession } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import {
  TrendingUp, TrendingDown, Wallet, AlertCircle,
  Plus, Pencil, Trash2, X, Loader2, Clock, CheckCircle2, XCircle,
  Paperclip, ExternalLink, ArrowUpRight, ArrowDownRight, BarChart2, Percent, FileText as FileTextIcon, ChevronLeft, Printer,
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
import { useConfig } from '@/lib/useConfig'
import { currencyOptions, BASE_CURRENCY } from '@/lib/currencies'
import { formatCurrency } from '@/lib/utils'
import { canDo } from '@/lib/rbac'

// ─── Constants ───────────────────────────────────────────────────────────────

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
  amountBDT:      z.coerce.number().positive().optional().or(z.literal('')),
  accountManager: z.string().optional(),
  paymentMethod:  z.string().optional(),
  projectId:      z.string().optional(),
  invoiceId:      z.string().optional(),
  receiptUrl:     z.string().optional(),
  txnId:          z.string().optional(),
  expenseCategory:  z.string().optional().nullable(),  // subcategory (storage field)
  who:              z.string().optional(),             // "kind:id" — optional person who made/received it
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
    PAID:                 { dot: 'bg-blue-500',    label: 'Paid' },
    AUTHORIZED:           { dot: 'bg-green-500',   label: 'Authorized' },
    APPROVED:             { dot: 'bg-blue-500',    label: 'Approved' },
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

// Local YYYY-MM-DD (no UTC shift) for the expense date-range presets.
function ymdLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function presetRange(preset) {
  const start = new Date()
  const end   = new Date()
  if (preset === 'today')          { /* start = end = today */ }
  else if (preset === 'yesterday') { start.setDate(start.getDate() - 1); end.setDate(end.getDate() - 1) }
  else if (preset === '7d')        { start.setDate(start.getDate() - 6) }
  else if (preset === 'month')     { start.setDate(1) }
  else return { start: '', end: '' }
  return { start: ymdLocal(start), end: ymdLocal(end) }
}

// ─── Transaction Modal ────────────────────────────────────────────────────────

function TransactionModal({ open, onOpenChange, tx, onSaved, currentUser }) {
  const { paymentMethods, expenseCategories, incomeCategories } = useConfig()
  const isEdit = !!tx
  const [receiptUrl,  setReceiptUrl]  = useState('')
  const [projects,    setProjects]    = useState([])
  const [invoices,    setInvoices]    = useState([])
  const [users,       setUsers]       = useState([])
  const [freelancers, setFreelancers] = useState([])
  const [agencies,    setAgencies]    = useState([])
  const [employees,   setEmployees]   = useState([])
  const [txnIdVal,    setTxnIdVal]    = useState('')

  const { register, control, handleSubmit, watch, reset, setValue, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(txSchema),
    defaultValues: { type: 'INCOME', currency: 'BDT', date: new Date().toISOString().slice(0,10) },
  })
  const type       = watch('type')
  const category   = watch('category')
  const currency   = watch('currency')
  const isExpense  = type === 'EXPENSE'
  const isForeign  = currency && currency !== BASE_CURRENCY

  // Nested taxonomy from config — subcategories belong to the selected category
  const baseCategories = isExpense ? expenseCategories : incomeCategories
  const baseLabels     = baseCategories.map(c => c.label)
  // Keep an already-saved value selectable even if it's not in the configured list
  const categories    = (category && !baseLabels.includes(category)) ? [...baseLabels, category] : baseLabels
  const subcategories = baseCategories.find(c => c.label === category)?.subcategories ?? []

  // Optional "who made/received it" — any employee, staff user, or freelancer
  const whoOptions = [
    ...employees.filter(e => e.userId?.id).map(e => ({ value: `employee:${e.id}`, label: `${e.userId.name} · Employee` })),
    ...freelancers.map(f => ({ value: `freelancer:${f.id}`, label: `${f.userId?.name ?? f.userId?.email ?? 'Freelancer'} · Freelancer` })),
    ...agencies.map(a => ({ value: `agency:${a.id}`, label: `${a.agencyInfo?.agencyName ?? a.userId?.name ?? 'Agency'} · Agency` })),
    ...users.map(u => ({ value: `user:${u.id}`, label: `${u.name} · Staff` })),
  ]
  const whoName = (val) => whoOptions.find(o => o.value === val)?.label?.split(' · ')[0] ?? null

  useEffect(() => {
    if (open) {
      fetch('/api/projects?limit=200').then(r => r.json()).then(j => setProjects(j.data ?? []))
      fetch('/api/invoices?limit=200').then(r => r.json()).then(j => setInvoices((j.data ?? []).filter(inv => !['PAID','CANCELLED','DRAFT'].includes(inv.status))))
      fetch('/api/users?limit=200&roles=EMPLOYEE,MANAGER,SUPER_ADMIN').then(r => r.json()).then(j => setUsers(j.data ?? []))
      fetch('/api/freelancers?limit=200&type=FREELANCER').then(r => r.json()).then(j => setFreelancers(j.data ?? []))
      fetch('/api/freelancers?limit=200&type=AGENCY').then(r => r.json()).then(j => setAgencies(j.data ?? []))
      fetch('/api/employees?limit=200').then(r => r.json()).then(j => setEmployees(j.data ?? []))
      const url = isEdit ? tx.receiptUrl ?? '' : ''
      setReceiptUrl(url)
      setTxnIdVal(isEdit ? tx.txnId ?? '' : '')
      const editWho =
        tx?.freelancerId     ? `freelancer:${tx.freelancerId}` :
        tx?.agencyId         ? `agency:${tx.agencyId}` :
        tx?.paidToEmployeeId ? `employee:${tx.paidToEmployeeId}` :
        tx?.paidBy           ? `user:${tx.paidBy?.id ?? tx.paidBy}` : ''
      reset(isEdit ? {
        type:           tx.type,
        category:       tx.category,
        amount:         tx.amount,
        description:    tx.description,
        date:           tx.date?.slice(0, 10),
        reference:      tx.reference ?? '',
        currency:       tx.currency ?? 'BDT',
        amountBDT:      tx.amountBDT ?? '',
        who:            editWho,
        accountManager: tx.accountManager?.id ?? tx.accountManager ?? '',
        paymentMethod:   tx.paymentMethod ?? '',
        projectId:       tx.projectId?.id ?? tx.projectId ?? '',
        invoiceId:       tx.invoiceId?.id ?? tx.invoiceId ?? '',
        expenseCategory: tx.expenseCategory ?? '',
        receiptUrl:      url,
        txnId:           tx.txnId ?? '',
      } : { type: 'INCOME', currency: 'BDT', date: new Date().toISOString().slice(0, 10), accountManager: currentUser?.id ?? '' })
    }
  }, [open, tx, isEdit, reset, currentUser])

  async function onSubmit(data) {
    // Resolve the optional "who" selection into the matching reference + display name
    const [whoKind, whoId] = (data.who ?? '').split(':')
    const refs = { freelancerId: null, agencyId: null, paidToEmployeeId: null, paidBy: null }
    if (whoKind === 'freelancer') refs.freelancerId     = whoId
    else if (whoKind === 'agency') refs.agencyId         = whoId
    else if (whoKind === 'employee') refs.paidToEmployeeId = whoId
    else if (whoKind === 'user')   refs.paidBy           = whoId
    const { who, ...rest } = data
    const body = { ...rest, ...refs, paidToName: data.who ? whoName(data.who) : null, receiptUrl: receiptUrl || null, txnId: txnIdVal.trim() || null }
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

        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className={lc}>Category *</label>
            <Controller name="category" control={control} render={({ field }) => (
              <Select value={field.value} onChange={v => { field.onChange(v ?? ''); setValue('expenseCategory', '') }}
                options={categories.map(c => ({ value: c, label: c }))}
                placeholder="Select…"
                disabled={baseCategories.length === 0}
              />
            )} />
            {errors.category && <p className="mt-1 text-xs text-red-500">{errors.category.message}</p>}
            {baseCategories.length === 0 && (
              <p className="mt-1 text-xs text-amber-600">No {isExpense ? 'expense' : 'income'} categories in Config → Finance.</p>
            )}
          </div>
          <div>
            <label className={lc}>Subcategory</label>
            <Controller name="expenseCategory" control={control} render={({ field }) => (
              <Select value={field.value ?? ''} onChange={v => field.onChange(v ?? '')}
                options={subcategories.map(c => ({ value: c, label: c }))}
                placeholder={!category ? 'Select category first…' : subcategories.length === 0 ? 'No subcategories' : 'Select…'}
                disabled={!category || subcategories.length === 0}
              />
            )} />
          </div>
          <div>
            <label className={lc}>Amount *</label>
            <input type="number" step="0.01" min="0" placeholder="0.00" {...register('amount')} onKeyDown={e => { if (e.key === '-' || e.key === 'e') e.preventDefault() }}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
            {errors.amount && <p className="mt-1 text-xs text-red-500">{errors.amount.message}</p>}
          </div>
        </div>

        {/* Currency + BDT-equivalent (metrics always roll up in BDT) */}
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={lc}>Currency</label>
            <Controller name="currency" control={control} render={({ field }) => (
              <Select value={field.value ?? 'BDT'} onChange={v => field.onChange(v ?? 'BDT')}
                options={currencyOptions} placeholder="Select currency…" />
            )} />
          </div>
          {isForeign && (
            <div>
              <label className={lc}>BDT-equivalent spent/received *</label>
              <input type="number" step="0.01" min="0" placeholder="0.00" {...register('amountBDT')} onKeyDown={e => { if (e.key === '-' || e.key === 'e') e.preventDefault() }}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
              <p className="mt-1 text-xs text-gray-400">The actual taka value — used for all finance metrics.</p>
              {errors.amountBDT && <p className="mt-1 text-xs text-red-500">{errors.amountBDT.message}</p>}
            </div>
          )}
        </div>

        <div>
          <label className={lc}>Detailed Description *</label>
          <textarea {...register('description')} rows={2} placeholder="What was this for? Who/where, and any context…" className={`${ic} resize-none`} />
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
            <Controller name="paymentMethod" control={control} render={({ field }) => (
              <Select value={field.value} onChange={v => field.onChange(v ?? '')}
                options={paymentMethods}
                placeholder="Select…"
              />
            )} />
          </div>
        </div>

        <div>
          <label className={lc}>
            {isExpense ? 'Who made the expense' : 'Received from'}
            <span className="text-gray-400 font-normal text-xs ml-1">(optional — pick a person, or describe in the note above)</span>
          </label>
          <Controller name="who" control={control} render={({ field }) => (
            <Select value={field.value ?? ''} onChange={v => field.onChange(v ?? '')}
              options={whoOptions}
              placeholder="Select a person…"
            />
          )} />
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
              <span className="text-gray-400 text-xs ml-1">(optional — auto-generated if blank)</span>
            </label>
            <input
              value={txnIdVal}
              onChange={e => setTxnIdVal(e.target.value)}
              placeholder="e.g. TXN-REF-001"
              className={ic}
            />
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
          label={receiptUrl ? 'Receipt / Invoice ✓ (optional)' : 'Receipt / Invoice (optional)'}
          value={receiptUrl}
          onUploaded={url => setReceiptUrl(url)}
        />
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

function PaymentModal({ expense, onClose, onDone, currentUser }) {
  const { paymentMethods } = useConfig()
  const [note,          setNote]          = useState('')
  const [amtBDT,        setAmtBDT]        = useState(expense.amountBDT ?? '')
  const [paymentMethod, setPaymentMethod] = useState('')
  const [txnId,         setTxnId]         = useState('')
  const [proofUrl,      setProofUrl]      = useState('')
  const [saving,        setSaving]        = useState(false)
  const isForeign = (expense.currency ?? 'BDT') !== 'BDT'
  const canPay = paymentMethod && (proofUrl || txnId.trim()) && (!isForeign || Number(amtBDT) > 0)

  async function submit(action) {
    if (action === 'pay') {
      if (!paymentMethod)             { toast.error('Select the payment method'); return }
      if (!proofUrl && !txnId.trim()) { toast.error('Enter a transaction ID or upload payment proof'); return }
      if (isForeign && !(Number(amtBDT) > 0)) { toast.error('Enter the BDT-equivalent for this foreign-currency expense'); return }
    }
    setSaving(true)
    try {
      const res  = await fetch(`/api/expenses/${expense.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'pay' ? {
          action,
          note,
          paymentMethod,
          paymentTxnId:    txnId.trim() || undefined,
          paymentProofUrl: proofUrl || undefined,
          amountBDT:       isForeign ? Number(amtBDT) : undefined,
        } : { action, note }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success(action === 'pay' ? 'Payment recorded — invoice ready to print & authorize' : 'Request rejected')
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
          <h3 className="text-base font-semibold text-gray-900">Record Payment</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <p className="text-xs text-gray-500">
            Record how the payment was made. This marks the expense <strong>Paid</strong> and generates the
            invoice — print it, get it authorized, then upload the scan to move it to <strong>Authorized</strong>.
          </p>

          {/* Two-column layout: summary + submitted proof */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-4 space-y-2">
              <p className="text-sm font-semibold text-gray-900">{expense.title}</p>
              <p className="text-xs text-gray-500">{expense.category}{expense.subcategory ? ` / ${expense.subcategory}` : ''} · {fmtDate(expense.date)}</p>
              <p className="text-xl font-bold text-gray-900">{formatCurrency(expense.amount, expense.currency)}</p>
              {expense.submittedBy?.name && (
                <p className="text-xs text-gray-500">Submitted by: <span className="font-medium text-gray-700">{expense.submittedBy.name}</span></p>
              )}
              {expense.notes && (
                <p className="text-xs text-gray-500 border-t border-gray-200 pt-2 mt-2 whitespace-pre-wrap">{expense.notes}</p>
              )}
            </div>

            {expense.invoiceUrl ? (
              <DocPreview url={expense.invoiceUrl} label="Submitted Proof / Memo" />
            ) : (
              <div className="rounded-xl bg-gray-50 border border-dashed border-gray-200 flex items-center justify-center py-8 text-center px-4">
                <p className="text-xs text-gray-400">No proof attached — verify the description details above.</p>
              </div>
            )}
          </div>

          {/* Payment method + transaction id */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Payment method <span className="text-red-500">*</span></label>
              <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} className={ic}>
                <option value="">Select method…</option>
                {paymentMethods.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Transaction ID {!proofUrl && <span className="text-red-500">*</span>}
                {proofUrl && <span className="text-gray-400 text-xs ml-1">(optional)</span>}
              </label>
              <input value={txnId} onChange={e => setTxnId(e.target.value)} placeholder="e.g. bank / bKash txn ref" className={ic} />
            </div>
          </div>

          <FileUpload
            label={`Payment proof ${txnId.trim() ? '(optional)' : '(required if no transaction ID)'}`}
            value={proofUrl}
            onUploaded={url => setProofUrl(url)}
          />
          <p className="text-xs text-gray-400 -mt-3">Proof that the payment was actually made (bank/MFS receipt). Optional if you enter a transaction ID.</p>

          {isForeign && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Actual spend in BDT <span className="text-red-500">*</span>
                <span className="text-gray-400 text-xs ml-1">({expense.currency} → BDT)</span>
              </label>
              <input type="number" value={amtBDT} onChange={e => setAmtBDT(e.target.value)}
                placeholder="e.g. 12000" className={ic} />
            </div>
          )}

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
          <button onClick={() => submit('pay')} disabled={saving || !canPay}
            className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-60 flex items-center gap-1.5">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            <CheckCircle2 className="w-4 h-4" /> Mark Paid
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Authorize Modal ──────────────────────────────────────────────────────────
// Final stage: print the paid invoice, get it authorized (signed & sealed), then
// upload the scan here to move the expense to AUTHORIZED.

function AuthorizeModal({ expense, onClose, onDone }) {
  const { paymentMethods } = useConfig()
  const [scanUrl, setScanUrl] = useState('')
  const [saving,  setSaving]  = useState(false)
  const methodLabel = paymentMethods.find(m => m.value === expense.paymentMethod)?.label ?? expense.paymentMethod ?? '—'

  async function submit() {
    if (!scanUrl) { toast.error('Upload the scan of the authorized invoice'); return }
    setSaving(true)
    try {
      const res  = await fetch(`/api/expenses/${expense.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'authorize', signedInvoiceUrl: scanUrl }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Invoice authorized')
      onDone()
      onClose()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl border border-gray-200 w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <h3 className="text-base font-semibold text-gray-900">Authorize Invoice — {expense.expenseId ?? expense.expenseInvoiceNo ?? ''}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-gray-900">{expense.title}</p>
              <p className="text-xs text-gray-500">{expense.category}{expense.subcategory ? ` / ${expense.subcategory}` : ''} · {fmtDate(expense.date)}</p>
              <p className="text-lg font-bold text-gray-900 mt-1">{formatCurrency(expense.amount, expense.currency)}</p>
              <p className="text-xs text-gray-500 mt-1">Paid via <span className="font-medium text-gray-700">{methodLabel}</span>{expense.paymentTxnId ? ` · Txn ${expense.paymentTxnId}` : ''}</p>
            </div>
            <a href={`/api/expenses/${expense.id}/voucher`} target="_blank" rel="noreferrer"
              className="px-3 py-2 text-xs font-medium border border-gray-200 rounded-lg hover:bg-white flex items-center gap-1.5 shrink-0">
              <Printer className="w-4 h-4" /> Print Invoice
            </a>
          </div>

          <FileUpload
            label="Authorized invoice scan (required)"
            value={scanUrl}
            onUploaded={url => setScanUrl(url)}
          />
          <p className="text-xs text-gray-400 -mt-3">Upload the printed invoice after it has been signed by the account manager / authorized signatory and stamped with the company seal.</p>
        </div>

        <div className="flex gap-2 justify-end px-6 py-4 border-t border-gray-100 shrink-0">
          <button onClick={onClose} disabled={saving}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={submit} disabled={saving || !scanUrl}
            className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-60 flex items-center gap-1.5">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            <CheckCircle2 className="w-4 h-4" /> Authorize
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Batch Authorize Modal ────────────────────────────────────────────────────
// Authorizes a whole group of PAID expenses against ONE combined invoice: print
// the combined invoice, get it signed & sealed, upload the scan.

function BatchAuthorizeModal({ ids, expenses, onClose, onDone }) {
  const [scanUrl, setScanUrl] = useState('')
  const [saving,  setSaving]  = useState(false)

  const totalBDT = expenses.reduce((s, e) => s + (e.amountBDT ?? e.amount ?? 0), 0)
  const idsParam = ids.join(',')

  async function submit() {
    if (!scanUrl) { toast.error('Upload the scan of the authorized combined invoice first'); return }
    setSaving(true)
    try {
      const res  = await fetch('/api/expenses/batch-authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, signedInvoiceUrl: scanUrl }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success(`${json.data?.authorized ?? ids.length} expense(s) authorized`)
      onDone()
      onClose()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl border border-gray-200 w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <h3 className="text-base font-semibold text-gray-900">Authorize {ids.length} expense{ids.length > 1 ? 's' : ''} — combined invoice</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-gray-900">{ids.length} paid expense{ids.length > 1 ? 's' : ''}</p>
              <p className="text-lg font-bold text-gray-900 mt-1">Total <TkAmt value={totalBDT} decimals={2} /> <span className="text-xs font-normal text-gray-400">BDT</span></p>
            </div>
            <a href={`/api/expenses/combined-voucher?ids=${idsParam}`} target="_blank" rel="noreferrer"
              className="px-3 py-2 text-xs font-medium border border-gray-200 rounded-lg hover:bg-white flex items-center gap-1.5 shrink-0">
              <Printer className="w-4 h-4" /> Print Combined Invoice
            </a>
          </div>

          <FileUpload
            label="Authorized combined invoice scan (required)"
            value={scanUrl}
            onUploaded={url => setScanUrl(url)}
          />
          <p className="text-xs text-gray-400 -mt-3">Print the combined invoice, get it signed &amp; sealed, then upload the scan — one authorized invoice authorizes all {ids.length} expense(s) together.</p>
        </div>

        <div className="flex gap-2 justify-end px-6 py-4 border-t border-gray-100 shrink-0">
          <button onClick={onClose} disabled={saving}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={submit} disabled={saving || !scanUrl}
            className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-60 flex items-center gap-1.5">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            <CheckCircle2 className="w-4 h-4" /> Authorize {ids.length}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Confirm Payment Modal ────────────────────────────────────────────────────

function ConfirmPaymentModal({ payment, currentUser, onClose, onDone }) {
  const { paymentMethods } = useConfig()
  const fmtMethod = v => v ? (paymentMethods.find(m => m.value === v)?.label ?? v.replace(/_/g, ' ')) : '—'
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
            {fmtMethod(payment.paymentMethod)} · {fmtDate(payment.paymentDate)}
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
          <p className="text-xs text-gray-500">{expense.category}{expense.subcategory ? ` / ${expense.subcategory}` : ''} · {fmtDate(expense.date)}</p>
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
  const { paymentMethods, expenseCategories, incomeCategories } = useConfig()
  const fmtMethod = v => v ? (paymentMethods.find(m => m.value === v)?.label ?? v.replace(/_/g, ' ')) : '—'
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
  const [prCategory,    setPrCategory]    = useState('')
  const [prSubcategory, setPrSubcategory] = useState('')
  const [prStart,       setPrStart]       = useState('')
  const [prEnd,         setPrEnd]         = useState('')
  const [prPreset,      setPrPreset]      = useState('')      // '', today, yesterday, 7d, month
  const [prSelected,    setPrSelected]    = useState([])      // paid expense ids selected for batch authorize
  const [batchAuthorizing, setBatchAuthorizing] = useState(false)
  const [payingPr,      setPayingPr]      = useState(null)    // PENDING → record payment (PaymentModal)
  const [authorizingPr, setAuthorizingPr] = useState(null)    // PAID → authorize (AuthorizeModal)

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
  const [txCategory, setTxCategory] = useState('')
  const [txSubcategory, setTxSubcategory] = useState('')
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
      if (txCategory) params.set('category', txCategory)
      if (txSubcategory) params.set('subcategory', txSubcategory)
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
  }, [txPage, txType, txCategory, txSubcategory, startDate, endDate])

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
      if (prStatus)      params.set('status', prStatus)
      if (prCategory)    params.set('category', prCategory)
      if (prSubcategory) params.set('subcategory', prSubcategory)
      if (prStart)       params.set('startDate', prStart)
      if (prEnd)         params.set('endDate', prEnd)
      const res  = await fetch(`/api/expenses?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setPrList(json.data ?? [])
      setPrMeta(json.meta ?? { page: 1, pages: 1, total: 0 })
      setPrSelected([])
    } catch (err) {
      toast.error(err.message ?? 'Failed to load payment requests')
    } finally {
      setPrLoading(false)
    }
  }, [prPage, prStatus, prCategory, prSubcategory, prStart, prEnd])

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

  // Nested taxonomy — subcategory options follow the chosen parent category
  const txCatGroups = txType === 'INCOME'
    ? incomeCategories
    : txType === 'EXPENSE'
      ? expenseCategories
      : [...incomeCategories, ...expenseCategories]
  const txCategoryOptions = [...new Set(txCatGroups.map(c => c.label))]
  const txSubcategoryOptions = txCategory
    ? (txCatGroups.find(c => c.label === txCategory)?.subcategories ?? [])
    : [...new Set(txCatGroups.flatMap(c => c.subcategories ?? []))]

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
                  { label: 'Net Profit',      value: fmtVal(f.profit?.value),  prev: `vs ${fmtVal(f.profit?.prevValue)} last month`,  change: f.profit?.change,  icon: Wallet,   bg: 'bg-blue-50',   color: 'text-blue-600' },
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

                    {/* By-currency breakdown — original totals + their BDT-equivalent */}
                    {summary?.currencyBreakdown?.length > 0 && (
                      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
                        <div className="px-5 py-3 border-b border-gray-100">
                          <h3 className="text-sm font-semibold text-gray-900">By currency</h3>
                          <p className="text-xs text-gray-400 mt-0.5">All metrics above roll up in BDT. This shows the original currencies behind them.</p>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[640px]">
                            <thead>
                              <tr className="border-b border-gray-100 bg-gray-50">
                                {['Currency', 'Transactions', 'Income (orig.)', 'Expense (orig.)', 'Income (BDT)', 'Expense (BDT)'].map(h => (
                                  <th key={h} className="px-5 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                              {summary.currencyBreakdown.map(c => (
                                <tr key={c.currency} className="hover:bg-gray-50/50">
                                  <td className="px-5 py-2.5 text-sm font-medium text-gray-900">{c.currency}</td>
                                  <td className="px-5 py-2.5 text-sm text-gray-600">{c.count}</td>
                                  <td className="px-5 py-2.5 text-sm text-gray-700">{c.incomeOriginal ? formatCurrency(c.incomeOriginal, c.currency) : '—'}</td>
                                  <td className="px-5 py-2.5 text-sm text-gray-700">{c.expenseOriginal ? formatCurrency(c.expenseOriginal, c.currency) : '—'}</td>
                                  <td className="px-5 py-2.5 text-sm text-green-600">{c.incomeBDT ? fmt(c.incomeBDT) : '—'}</td>
                                  <td className="px-5 py-2.5 text-sm text-red-500">{c.expenseBDT ? fmt(c.expenseBDT) : '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

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
            <div className="w-48">
              <Select
                value={txCategory}
                onChange={v => { setTxCategory(v ?? ''); setTxSubcategory(''); setTxPage(1) }}
                options={txCategoryOptions.map(c => ({ value: c, label: c }))}
                placeholder="All categories"
              />
            </div>
            <div className="w-48">
              <Select
                value={txSubcategory}
                onChange={v => { setTxSubcategory(v ?? ''); setTxPage(1) }}
                options={txSubcategoryOptions.map(c => ({ value: c, label: c }))}
                placeholder="All subcategories"
                disabled={txSubcategoryOptions.length === 0}
              />
            </div>
            <div className="flex gap-1 ml-auto">
              {[['', 'All'], ['INCOME', 'Income'], ['EXPENSE', 'Expense']].map(([v, l]) => (
                <button key={v} onClick={() => { setTxType(v); setTxCategory(''); setTxSubcategory(''); setTxPage(1) }}
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
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Source / Paid to</th>
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
                        <td className="px-4 py-3 text-xs text-gray-600">
                          <span>{tx.category}</span>
                          {tx.expenseCategory && <span className="block text-[11px] text-gray-400">{tx.expenseCategory}</span>}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600 max-w-[160px] truncate">
                          {tx.paidToName ?? tx.vendor ?? tx.projectId?.name ?? tx.paidBy?.name ?? '—'}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-700 max-w-[200px] truncate">{tx.description}</td>
                        <td className={`px-4 py-3 text-right text-sm font-semibold whitespace-nowrap ${tx.type === 'INCOME' ? 'text-green-600' : 'text-red-500'}`}>
                          {tx.type === 'INCOME' ? '+' : '-'}{fmt(tx.amount)}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">{fmtMethod(tx.paymentMethod)}</td>
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
                          {pc.projectId?.projectCode && (
                            <p className="text-xs text-gray-400 font-mono">{pc.projectId.projectCode}</p>
                          )}
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
      {activeTab === 'requests' && (() => {
        const canConfirm    = canDo(session, 'finance.payments.confirm')
        const showBatch     = prStatus === 'PAID' && canConfirm
        const subOptions    = expenseCategories.find(c => c.label === prCategory)?.subcategories ?? []
        const selectableIds = prList.filter(r => r.status === 'PAID').map(r => r.id ?? r._id)
        const allSelected   = selectableIds.length > 0 && selectableIds.every(id => prSelected.includes(id))
        const selectedRows  = prList.filter(r => prSelected.includes(r.id ?? r._id))
        const selectedTotal = selectedRows.reduce((s, r) => s + (r.amountBDT ?? r.amount ?? 0), 0)
        const selectPreset  = (p) => { setPrPreset(p); setPrPage(1); const { start, end } = presetRange(p); setPrStart(start); setPrEnd(end) }
        const setCustom     = (which, v) => { setPrPreset(''); setPrPage(1); which === 'start' ? setPrStart(v ?? '') : setPrEnd(v ?? '') }
        const toggleAll     = () => setPrSelected(allSelected ? [] : selectableIds)
        const toggleOne     = (id) => setPrSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])
        return (
        <div className="space-y-4">
          {/* Status filter */}
          <div className="flex gap-2 flex-wrap">
            {[['PENDING', 'Pending'], ['PAID', 'Paid'], ['AUTHORIZED', 'Authorized'], ['REJECTED', 'Rejected'], ['', 'All']].map(([v, l]) => (
              <button key={v} onClick={() => { setPrStatus(v); setPrPage(1); setPrSelected([]) }}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${prStatus === v ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'}`}>
                {l}
              </button>
            ))}
          </div>

          {/* Date + category filters */}
          <div className="flex flex-wrap items-end gap-3 bg-white rounded-xl border border-gray-100 p-3">
            <div className="flex gap-1.5 flex-wrap">
              {[['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', 'Last 7 days'], ['month', 'This month'], ['', 'All dates']].map(([v, l]) => (
                <button key={v || 'all'} onClick={() => selectPreset(v)}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${prPreset === v && (v || (!prStart && !prEnd)) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'}`}>
                  {l}
                </button>
              ))}
            </div>
            <div className="flex items-end gap-2">
              <div>
                <label className="block text-[11px] text-gray-400 mb-1">From</label>
                <DatePicker value={prStart || null} onChange={v => setCustom('start', v)} />
              </div>
              <div>
                <label className="block text-[11px] text-gray-400 mb-1">To</label>
                <DatePicker value={prEnd || null} onChange={v => setCustom('end', v)} />
              </div>
            </div>
            <div className="min-w-[150px]">
              <label className="block text-[11px] text-gray-400 mb-1">Category</label>
              <select value={prCategory} onChange={e => { setPrCategory(e.target.value); setPrSubcategory(''); setPrPage(1) }}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-gray-900">
                <option value="">All categories</option>
                {expenseCategories.map(c => <option key={c.id ?? c.label} value={c.label}>{c.label}</option>)}
              </select>
            </div>
            <div className="min-w-[150px]">
              <label className="block text-[11px] text-gray-400 mb-1">Subcategory</label>
              <select value={prSubcategory} onChange={e => { setPrSubcategory(e.target.value); setPrPage(1) }}
                disabled={!prCategory || subOptions.length === 0}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:bg-gray-50 disabled:text-gray-400">
                <option value="">All subcategories</option>
                {subOptions.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            {(prCategory || prSubcategory || prStart || prEnd) && (
              <button onClick={() => { setPrCategory(''); setPrSubcategory(''); setPrStart(''); setPrEnd(''); setPrPreset(''); setPrPage(1) }}
                className="px-2.5 py-1.5 text-xs font-medium text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50">
                Clear
              </button>
            )}
          </div>

          {/* Batch action bar (paid + confirmer) — authorize a group with one combined invoice */}
          {showBatch && prSelected.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3">
              <p className="text-sm text-indigo-900">
                <strong>{prSelected.length}</strong> selected · Total <TkAmt value={selectedTotal} decimals={2} /> BDT
              </p>
              <div className="flex items-center gap-2">
                <a href={`/api/expenses/combined-voucher?ids=${prSelected.join(',')}`} target="_blank" rel="noreferrer"
                  className="px-3 py-1.5 text-xs font-medium border border-indigo-300 text-indigo-700 bg-white rounded-lg hover:bg-indigo-50 flex items-center gap-1.5">
                  <Printer className="w-3.5 h-3.5" /> Generate Combined Invoice
                </a>
                <button onClick={() => setBatchAuthorizing(true)}
                  className="px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700">
                  Authorize Selected
                </button>
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            {prLoading ? <Spinner /> : prList.length === 0 ? (
              <div className="text-center py-16 text-gray-400 text-sm">No payment requests found</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      {showBatch && (
                        <th className="px-4 py-3 w-9">
                          <input type="checkbox" checked={allSelected} onChange={toggleAll}
                            disabled={selectableIds.length === 0}
                            className="w-4 h-4 rounded border-gray-300 accent-indigo-600" />
                        </th>
                      )}
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Title</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Category</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Project</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Voucher</th>
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
                        {showBatch && (
                          <td className="px-4 py-3">
                            {pr.status === 'PAID' && (
                              <input type="checkbox" checked={prSelected.includes(pr.id ?? pr._id)}
                                onChange={() => toggleOne(pr.id ?? pr._id)}
                                className="w-4 h-4 rounded border-gray-300 accent-indigo-600" />
                            )}
                          </td>
                        )}
                        <td className="px-4 py-3 text-xs font-medium text-gray-800 max-w-[160px] truncate">{pr.title ?? pr.description ?? '—'}</td>
                        <td className="px-4 py-3 text-xs text-gray-600">
                          <span>{pr.category ?? '—'}</span>
                          {pr.subcategory && <span className="block text-[11px] text-gray-400">{pr.subcategory}</span>}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">{pr.projectId?.name ?? (pr.origin === 'SALARY' ? 'Salary' : pr.origin === 'REIMBURSEMENT' ? 'Reimbursement' : '—')}</td>
                        <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{pr.expenseInvoiceNo ?? '—'}</td>
                        <td className="px-4 py-3 text-right text-sm font-semibold text-gray-800 whitespace-nowrap">{formatCurrency(pr.amount, pr.currency)}</td>
                        <td className="px-4 py-3"><StatusDot status={pr.status} /></td>
                        <td className="px-4 py-3 text-xs text-gray-500">{pr.submittedBy?.name ?? (pr.origin === 'SALARY' ? 'System' : '—')}</td>
                        <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{fmtDate(pr.date ?? pr.createdAt)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            {pr.status === 'PENDING' && (
                              <button onClick={() => setPayingPr(pr)}
                                className="px-3 py-1.5 text-xs font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors">
                                Review
                              </button>
                            )}
                            {pr.status === 'PAID' && (
                              <>
                                <a href={`/api/expenses/${pr.id ?? pr._id}/voucher`} target="_blank" rel="noreferrer"
                                  className="px-3 py-1.5 text-xs font-medium border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 flex items-center gap-1.5">
                                  <Printer className="w-3.5 h-3.5" /> Invoice
                                </a>
                                <button onClick={() => setAuthorizingPr(pr)}
                                  className="px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">
                                  Authorize
                                </button>
                              </>
                            )}
                            {pr.status === 'AUTHORIZED' && (
                              <a href={`/api/expenses/${pr.id ?? pr._id}/voucher`} target="_blank" rel="noreferrer"
                                className="px-3 py-1.5 text-xs font-medium border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 flex items-center gap-1.5">
                                <Printer className="w-3.5 h-3.5" /> Invoice
                              </a>
                            )}
                          </div>
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
        )
      })()}

      {/* ── WITHDRAWALS tab (removed — freelancer payments settle via Payment Requests) ── */}
      {activeTab === 'withdrawals' && (
        <div className="bg-white border border-gray-100 rounded-xl p-10 text-center">
          <p className="text-sm text-gray-500">
            Wallet withdrawals were removed. Freelancer &amp; agency payments are now settled directly via{' '}
            <Link href="/admin/accounts?tab=requests" className="text-blue-600 hover:underline">Payment Requests</Link>.
          </p>
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
                  { label: 'Net Profit',    value: fmt(plReport.summary?.netProfit),    color: plReport.summary?.netProfit >= 0 ? 'text-blue-600' : 'text-red-600', bg: 'bg-blue-50', icon: Wallet },
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

      {payingPr && (
        <PaymentModal
          expense={payingPr}
          currentUser={session?.user}
          onClose={() => setPayingPr(null)}
          onDone={() => { loadPaymentRequests(); loadSummary() }}
        />
      )}

      {authorizingPr && (
        <AuthorizeModal
          expense={authorizingPr}
          onClose={() => setAuthorizingPr(null)}
          onDone={() => { loadPaymentRequests(); loadSummary() }}
        />
      )}

      {batchAuthorizing && (
        <BatchAuthorizeModal
          ids={prSelected}
          expenses={prList.filter(r => prSelected.includes(r.id ?? r._id))}
          onClose={() => setBatchAuthorizing(false)}
          onDone={() => { setPrSelected([]); loadPaymentRequests(); loadSummary() }}
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
