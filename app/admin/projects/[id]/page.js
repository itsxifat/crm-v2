'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import {
  Pencil, Trash2, Plus, CheckCircle2, Circle,
  Loader2, X, CreditCard, Clock, Calendar,
  ChevronRight, Check, FileText,
  BookOpen, MessageSquare, Send, Layers, TrendingDown, Users,
} from 'lucide-react'
import { STATUS_META } from '@/lib/ventures'
import { useConfig } from '@/lib/useConfig'
import Image from 'next/image'
import FileUpload from '@/components/ui/FileUpload'
import DocPreview from '@/components/ui/DocPreview'
import Select from '@/components/ui/Select'
import DatePicker from '@/components/ui/DatePicker'
import PeoplePicker from '@/components/ui/PeoplePicker'
import Button, { buttonVariants } from '@/components/ui/Button'
import { Card, CardHeader, CardTitle, CardDescription, CardAction, CardContent } from '@/components/ui/Card'
import { Input, Textarea, NativeSelect, Label, Field } from '@/components/ui/Input'
import PageHeader from '@/components/ui/PageHeader'
import Tabs from '@/components/ui/Tabs'
import Badge from '@/components/ui/Badge'
import EmptyState from '@/components/ui/EmptyState'
import LoadingSpinner, { PageLoader } from '@/components/ui/LoadingSpinner'
import { Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { cn } from '@/lib/utils'
import MoneyAccountSelect, { useMoneyAccounts, invalidateMoneyAccounts, accountRequiredOn } from '@/components/finance/MoneyAccountSelect'
import WithholdingFields, { emptyWithholding, invoiceAllowsVds } from '@/components/tax/WithholdingFields'
import { PAYMENT_CHANNELS, channelFromPaymentMethod } from '@/lib/finance/constants'
import { round2 } from '@/lib/tax/catalog'
import { currencyOptions, BASE_CURRENCY } from '@/lib/currencies'
import { dhakaDayKey } from '@/lib/dhakaTime'
import { allowedStatusTransitions, canRenewProject } from '@/lib/projectStatus'
import { canDo } from '@/lib/rbac'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n) => `৳ ${(n ?? 0).toLocaleString('en-BD', { minimumFractionDigits: 2 })}`

// Amount in its own currency; BDT-equivalent alongside when foreign.
const fmtMoney = (amount, currency) => {
  const cur = currency || 'BDT'
  const num = Number(amount ?? 0).toLocaleString('en-BD', { minimumFractionDigits: 2 })
  return cur === 'BDT' ? `৳${num}` : `${cur} ${num}`
}
// Date-only values (deadline, due date) are overdue only once their Dhaka
// calendar day has passed — not from 06:00 on the day itself.
const isPastDay = (d) => !!d && dhakaDayKey(d) < dhakaDayKey()
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Dhaka' }) : '—'
const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'
// Display-only: 'IN_PROGRESS' → 'In progress'
const humanize = (s) => s ? String(s).charAt(0) + String(s).slice(1).toLowerCase().replace(/_/g, ' ') : ''

const STATUS_BADGE = {
  PENDING:       'default',
  IN_PROGRESS:   'primary',
  IN_REVIEW:     'purple',
  REVISION:      'warning',
  APPROVED:      'teal',
  DELIVERED:     'success',
  FEEDBACK:      'orange',
  SUBMITTED:     'indigo',
  ACTIVE:        'success',
  EXPIRING_SOON: 'orange',
  RENEWED:       'primary',
  ON_HOLD:       'warning',
  CANCELLED:     'danger',
}
const STATUS_DOT = {
  PENDING:       'bg-gray-400',
  IN_PROGRESS:   'bg-blue-500',
  IN_REVIEW:     'bg-purple-500',
  REVISION:      'bg-yellow-500',
  APPROVED:      'bg-teal-500',
  DELIVERED:     'bg-green-500',
  ACTIVE:        'bg-green-500',
  EXPIRING_SOON: 'bg-orange-500',
  RENEWED:       'bg-blue-500',
  ON_HOLD:       'bg-yellow-500',
  CANCELLED:     'bg-red-500',
}
const TASK_STATUS_DOT = {
  TODO:        'bg-gray-400',
  IN_PROGRESS: 'bg-blue-500',
  IN_REVIEW:   'bg-purple-500',
  COMPLETED:   'bg-green-500',
  CANCELLED:   'bg-red-500',
}
const ASSIGN_STATUS_BADGE = {
  ASSIGNED: 'primary', ACCEPTED: 'teal', IN_PROGRESS: 'purple', COMPLETED: 'success', CANCELLED: 'danger',
}
const PAY_STATUS_BADGE = {
  PENDING: 'warning', PAYMENT_REQUESTED: 'orange', IN_WALLET: 'success', WITHDRAWAL_REQUESTED: 'primary', PAID: 'default',
}
const EXPENSE_STATUS_BADGE = { AUTHORIZED: 'success', PAID: 'primary', REJECTED: 'danger' }
const PAYMENT_STATUS_BADGE = { CONFIRMED: 'success', REJECTED: 'danger', REVERSED: 'default', REVERSING: 'default' }

// Hand-built dialog shell that matches components/ui/Modal. Renders the panel as a
// <form> when `onSubmit` is given so footer buttons can submit it.
function DialogShell({ title, onClose, size = 'max-w-md', onSubmit, footer, scroll = true, children }) {
  const Panel = onSubmit ? 'form' : 'div'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]">
      <Panel
        onSubmit={onSubmit}
        className={cn('flex w-full flex-col rounded-2xl border border-gray-200/80 bg-white shadow-2xl', scroll && 'max-h-[92vh]', size)}
      >
        <div className="flex shrink-0 items-start justify-between gap-4 px-6 pb-3 pt-5">
          <h3 className="text-base font-semibold tracking-tight text-gray-900">{title}</h3>
          <Button variant="ghost" size="icon-sm" onClick={onClose} className="-mr-1.5 -mt-0.5 text-gray-400" aria-label="Close">
            <X />
          </Button>
        </div>
        <div className={cn('space-y-4 px-6 pb-5 pt-1', scroll && 'flex-1 overflow-y-auto')}>
          {children}
        </div>
        {footer && (
          <div className="flex shrink-0 flex-wrap justify-end gap-2 rounded-b-2xl border-t border-gray-100 bg-gray-50/60 px-6 py-3.5">
            {footer}
          </div>
        )}
      </Panel>
    </div>
  )
}
// ─── StatusModal ──────────────────────────────────────────────────────────────

function StatusModal({ project, onClose, onSaved, onRenewed }) {
  const [status, setStatus] = useState('')
  const [note,   setNote]   = useState('')
  const [saving, setSaving] = useState(false)
  const allowed = [
    ...allowedStatusTransitions(project),
    ...(canRenewProject(project) ? ['RENEWED'] : []),
  ]

  async function save() {
    if (!status) return
    setSaving(true)
    try {
      if (status === 'RENEWED') {
        // Renewal creates the next-period project + renewal record.
        const res  = await fetch(`/api/projects/${project.id}/renew`, { method: 'POST' })
        const json = await res.json()
        if (!res.ok) throw new Error(json.error ?? 'Renewal failed')
        toast.success(`Renewed — new project ${json.newProject.projectCode}`, { duration: 6000 })
        onClose()
        onRenewed(json.newProject)
        return
      }
      const res  = await fetch(`/api/projects/${project.id}/status`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status, note }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Status updated')
      onSaved(status)
      onClose()
    } catch (err) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  return (
    <DialogShell
      title="Change status"
      onClose={onClose}
      size="max-w-sm"
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} disabled={!status} loading={saving}>Update</Button>
      </>}
    >
      <p className="text-[13px] text-muted-foreground">Current: <span className="font-medium text-gray-900">{STATUS_META[project.status]?.label ?? project.status}</span></p>
      {allowed.length === 0 ? (
        <p className="py-2 text-sm text-muted-foreground">No further transitions available.</p>
      ) : (
        <div className="space-y-1.5">
          {allowed.map(s => (
            <button key={s} onClick={() => setStatus(s)}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
                status === s ? 'border-gray-900 bg-gray-50' : 'border-gray-200/80 hover:bg-gray-50'
              )}>
              <span className={`size-2 rounded-full shrink-0 ${STATUS_DOT[s] ?? 'bg-gray-400'}`} />
              <span className="text-sm text-gray-900">{STATUS_META[s]?.label ?? s}</span>
              {status === s && <Check className="ml-auto size-4 text-gray-900" />}
            </button>
          ))}
        </div>
      )}
      {status === 'CANCELLED' && (
        <Textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Cancellation reason…"
          className="min-h-0 resize-none" />
      )}
    </DialogShell>
  )
}

// ─── TaskModal ────────────────────────────────────────────────────────────────

function TaskModal({ projectId, task, onClose, onSaved }) {
  const isEdit = !!task
  const [form, setForm] = useState({
    title:       task?.title       ?? '',
    description: task?.description ?? '',
    status:      task?.status      ?? 'TODO',
    priority:    task?.priority    ?? 'MEDIUM',
    assignedEmployeeId: String(task?.assignedEmployeeId?.id ?? task?.assignedEmployeeId?._id ?? task?.assignedEmployeeId ?? ''),
    dueDate:     task?.dueDate     ? dhakaDayKey(task.dueDate) : '',
  })
  const [saving, setSaving] = useState(false)
  const [members, setMembers] = useState([])

  useEffect(() => {
    // Tasks are assigned to in-house employees (Employee ids), not users.
    fetch('/api/employees?limit=200').then(r => r.json()).then(j => setMembers(j.data ?? [])).catch(() => {})
  }, [])

  async function save() {
    if (!form.title.trim()) { toast.error('Title required'); return }
    setSaving(true)
    try {
      const url    = isEdit ? `/api/projects/${projectId}/tasks/${task.id}` : `/api/projects/${projectId}/tasks`
      const method = isEdit ? 'PUT' : 'POST'
      const body   = { ...form, dueDate: form.dueDate || null, assignedEmployeeId: form.assignedEmployeeId || null }
      const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json   = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success(isEdit ? 'Task updated' : 'Task created')
      onSaved()
      onClose()
    } catch (err) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  return (
    <DialogShell
      title={isEdit ? 'Edit task' : 'New task'}
      onClose={onClose}
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} loading={saving}>{isEdit ? 'Save' : 'Create task'}</Button>
      </>}
    >
      <Field label="Title" required>
        <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
          placeholder="Task title" />
      </Field>
      <Field label="Description">
        <Textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
          placeholder="Optional" rows={2} className="min-h-0 resize-none" />
      </Field>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Status">
          <Select value={form.status} onChange={v => setForm(f => ({ ...f, status: v ?? 'TODO' }))}
            options={['TODO','IN_PROGRESS','IN_REVIEW','COMPLETED','CANCELLED'].map(s => ({ value: s, label: humanize(s) }))}
            placeholder="Select…"
          />
        </Field>
        <Field label="Priority">
          <Select value={form.priority} onChange={v => setForm(f => ({ ...f, priority: v ?? 'MEDIUM' }))}
            options={['LOW','MEDIUM','HIGH','URGENT'].map(p => ({ value: p, label: humanize(p) }))}
            placeholder="Select…"
          />
        </Field>
        <Field label="Assigned to">
          <Select value={form.assignedEmployeeId} onChange={v => setForm(f => ({ ...f, assignedEmployeeId: v ?? '' }))}
            options={members.filter(m => m.userId?.name).map(m => ({ value: m.id, label: m.userId.name }))}
            placeholder="Unassigned"
          />
        </Field>
        <Field label="Due date">
          <DatePicker value={form.dueDate || null} onChange={v => setForm(f => ({ ...f, dueDate: v ?? '' }))} />
        </Field>
      </div>
    </DialogShell>
  )
}

// ─── ExpenseModal ─────────────────────────────────────────────────────────────

function ExpenseModal({ projectId, onClose, onSaved }) {
  const { expenseCategories, loading: configLoading } = useConfig()
  const [form, setForm] = useState({
    title: '', amount: '', category: '', subcategory: '',
    date: dhakaDayKey(), notes: '', invoiceUrl: '',
    payeeType: '', // '', freelancer, agency, vendor, employee, other
    freelancerId: '', agencyId: '', vendorId: '', paidToEmployeeId: '',
    paidToName: '',
  })
  const [saving,      setSaving]      = useState(false)
  const [freelancers, setFreelancers] = useState([])
  const [agencies,    setAgencies]    = useState([])
  const [vendors,     setVendors]     = useState([])
  const [employees,   setEmployees]   = useState([])

  // subcategories belong to the selected parent category
  const subcategories = expenseCategories.find(c => c.label === form.category)?.subcategories ?? []
  const PAYEE_TYPES = [
    { id: '',           label: 'None' },
    { id: 'freelancer', label: 'Freelancer' },
    { id: 'agency',     label: 'Agency' },
    { id: 'vendor',     label: 'Vendor' },
    { id: 'employee',   label: 'Employee' },
    { id: 'other',      label: 'Other' },
  ]

  useEffect(() => {
    // Always fetch assigned freelancers for this project
    fetch(`/api/freelancer-assignments?projectId=${projectId}`)
      .then(r => r.json()).then(j => {
        const all = j.data ?? []
        setFreelancers(all.filter(a => a.freelancerId?.type !== 'AGENCY'))
        setAgencies(all.filter(a => a.freelancerId?.type === 'AGENCY'))
      })
    fetch('/api/vendors?limit=200').then(r => r.json()).then(j => setVendors(j.data ?? []))
    fetch('/api/employees?limit=200').then(r => r.json()).then(j => setEmployees(j.data ?? []))
  }, [projectId])

  function setPayeeType(t) {
    setForm(f => ({ ...f, payeeType: t, freelancerId: '', agencyId: '', vendorId: '', paidToEmployeeId: '', paidToName: '' }))
  }

  async function save() {
    if (!form.title || !form.amount) { toast.error('Title and amount required'); return }
    if (!form.category) { toast.error('Select a category'); return }
    if (form.payeeType === 'freelancer' && !form.freelancerId)     { toast.error('Select a freelancer'); return }
    if (form.payeeType === 'agency'     && !form.agencyId)         { toast.error('Select an agency'); return }
    if (form.payeeType === 'vendor'     && !form.vendorId)         { toast.error('Select a vendor'); return }
    if (form.payeeType === 'employee'   && !form.paidToEmployeeId) { toast.error('Select an employee'); return }
    if (form.payeeType === 'other'      && !form.paidToName?.trim()) { toast.error('Enter a name'); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/projects/${projectId}/expenses`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...form,
          amount:           Number(form.amount),
          subcategory:      form.subcategory      || null,
          invoiceUrl:       form.invoiceUrl       || null,
          freelancerId:     form.freelancerId     || null,
          agencyId:         form.agencyId         || null,
          vendorId:         form.vendorId         || null,
          paidToEmployeeId: form.paidToEmployeeId || null,
          paidToName:       form.paidToName       || null,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Expense submitted')
      onSaved(); onClose()
    } catch (err) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  return (
    <DialogShell
      title="New expense"
      onClose={onClose}
      size="max-w-lg"
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} loading={saving}>Submit expense</Button>
      </>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" required className="sm:col-span-2">
          <Input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Expense title" />
        </Field>
        <Field label="Amount (৳)" required>
          <Input type="number" step="0.01" min="0" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} onKeyDown={e => { if (e.key === '-' || e.key === 'e') e.preventDefault() }} placeholder="0.00" />
        </Field>
        <Field label="Date">
          <DatePicker value={form.date || null} onChange={v => setForm(f => ({ ...f, date: v ?? '' }))} />
        </Field>
        <Field label="Category" required className="sm:col-span-2">
          <Select
            value={form.category}
            onChange={v => setForm(f => ({ ...f, category: v ?? '', subcategory: '' }))}
            options={expenseCategories.map(c => ({ value: c.label, label: c.label }))}
            placeholder="Select…"
            disabled={configLoading || expenseCategories.length === 0}
          />
          {!configLoading && expenseCategories.length === 0 && (
            <p className="mt-1.5 text-xs text-amber-700">No expense categories — add them in Config → Finance.</p>
          )}
        </Field>
        <Field label="Subcategory" className="sm:col-span-2">
          <Select
            value={form.subcategory}
            onChange={v => setForm(f => ({ ...f, subcategory: v ?? '' }))}
            options={subcategories.map(s => ({ value: s, label: s }))}
            placeholder={!form.category ? 'Select a category first' : subcategories.length === 0 ? 'No subcategories' : 'Select…'}
            disabled={!form.category || subcategories.length === 0}
          />
        </Field>

        <div className="space-y-2 sm:col-span-2">
          <Label className="mb-0">Paid to</Label>
          <Tabs
            size="sm"
            value={form.payeeType}
            onChange={setPayeeType}
            tabs={PAYEE_TYPES.map(t => ({ value: t.id, label: t.label }))}
          />
          {form.payeeType === 'freelancer' && (
            <Select value={form.freelancerId} onChange={v => setForm(f => ({ ...f, freelancerId: v ?? '' }))}
              options={freelancers.map(a => ({
                value: a.freelancerId?.id ?? a.freelancerId,
                label: a.freelancerId?.userId?.name ?? a.freelancerId?.userId?.email ?? 'Unknown',
              }))}
              placeholder="Select freelancer…"
            />
          )}
          {form.payeeType === 'agency' && (
            <Select value={form.agencyId} onChange={v => setForm(f => ({ ...f, agencyId: v ?? '' }))}
              options={agencies.map(a => ({
                value: a.freelancerId?.id ?? a.freelancerId,
                label: a.freelancerId?.agencyInfo?.agencyName ?? a.freelancerId?.userId?.name ?? 'Unknown Agency',
              }))}
              placeholder="Select agency…"
            />
          )}
          {form.payeeType === 'vendor' && (
            <Select value={form.vendorId} onChange={v => setForm(f => ({ ...f, vendorId: v ?? '' }))}
              options={vendors.map(v => ({
                value: v.id,
                label: `${v.company}${v.serviceType ? ` — ${v.serviceType}` : ''}`,
              }))}
              placeholder="Select vendor…"
            />
          )}
          {form.payeeType === 'employee' && (
            <Select value={form.paidToEmployeeId} onChange={v => setForm(f => ({ ...f, paidToEmployeeId: v ?? '' }))}
              options={employees.filter(e => e.userId?.id).map(e => ({
                value: e.id,
                label: `${e.userId.name}${e.designation ? ` — ${e.designation}` : ''}`,
              }))}
              placeholder="Select employee…"
            />
          )}
          {form.payeeType === 'other' && (
            <Input value={form.paidToName} onChange={e => setForm(f => ({ ...f, paidToName: e.target.value }))}
              placeholder="Name" />
          )}
        </div>

        <Field label="Notes" className="sm:col-span-2">
          <Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} className="min-h-0 resize-none" />
        </Field>
        <div className="sm:col-span-2">
          <FileUpload label="Invoice / receipt" value={form.invoiceUrl} onUploaded={url => setForm(f => ({ ...f, invoiceUrl: url }))} />
        </div>
      </div>
    </DialogShell>
  )
}

// ─── PaymentModal ─────────────────────────────────────────────────────────────

const PAYMENT_CHANNEL_OPTIONS = PAYMENT_CHANNELS.filter(c => c.value !== 'INTERNAL' && c.value !== 'CHALLAN')
const numOr0 = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

function PaymentModal({ projectId, project, onClose, onSaved }) {
  const { paymentMethods } = useConfig()
  const [form, setForm] = useState({
    amount: '', paymentMethod: 'BANK_TRANSFER',
    paymentDate: dhakaDayKey(),
    description: '', notes: '', receiptUrl: '',
  })
  const [saving,   setSaving]   = useState(false)
  const [invoices, setInvoices] = useState([])
  const [invoiceId, setInvoiceId] = useState('')
  // The invoice list needs sales.invoices.view; without it the server links the
  // oldest open invoice itself (and then decides the currency).
  const [invoicesUnavailable, setInvoicesUnavailable] = useState(false)
  const { data: session } = useSession()
  // Confirmers (finance.payments.confirm) book the payment immediately: they pick
  // the money account and record any VDS / TDS the client withheld.
  const canConfirm = canDo(session, 'finance.payments.confirm')
  const { accounts: moneyAccounts, goLiveDate } = useMoneyAccounts()
  const [accountId,      setAccountId]      = useState(null)
  const [account,        setAccount]        = useState(null)
  const [channel,        setChannel]        = useState('')
  const [channelTouched, setChannelTouched] = useState(false)
  const [withholding,    setWithholding]    = useState(() => emptyWithholding())
  const [amountBDT,      setAmountBDT]      = useState('')

  // Billable (issued, not cancelled) invoices of this project. Default to the
  // oldest one with a balance — the same invoice the server picks by default.
  useEffect(() => {
    fetch(`/api/projects/${projectId}/invoices`)
      .then(async r => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) { setInvoicesUnavailable(true); return { data: [] } }
        return j
      })
      .then(j => {
        const billable = (j.data ?? [])
          .filter(i => !['DRAFT', 'CANCELLED'].includes(i.status))
          .sort((a, b) => new Date(a.issueDate ?? 0) - new Date(b.issueDate ?? 0))
        setInvoices(billable)
        // A fully paid invoice cannot take a payment (the server refuses it), so with
        // nothing outstanding the payment stays project-level unless one is picked.
        const def = billable.find(i => Number(i.total ?? 0) - Number(i.paidAmount ?? 0) > 0.01) ?? null
        if (def) setInvoiceId(def.id)
      })
      .catch(() => {})
  }, [projectId])
  const invoice = invoices.find(i => i.id === invoiceId) ?? null
  // An invoice payment is always in the invoice's currency (the server refuses
  // anything else); a foreign-currency receipt also needs the BDT actually received.
  const payCurrency = String(invoice?.currency || BASE_CURRENCY).toUpperCase()
  const isForeign   = payCurrency !== BASE_CURRENCY
  const money       = (n) => fmtMoney(n, payCurrency)
  useEffect(() => { setAmountBDT('') }, [payCurrency])

  // Withholding is recorded against a BDT invoice only.
  const canWithhold = canConfirm && !!invoice && !isForeign
  useEffect(() => {
    if (!canWithhold) setWithholding(emptyWithholding())
  }, [canWithhold])

  // Compute outstanding balance — prefer invoice, fall back to project budget
  const outstanding = (() => {
    if (invoice) {
      return Math.max(0, Number(invoice.total ?? 0) - Number(invoice.paidAmount ?? 0))
    }
    if (project) {
      const budget = Number(project.budget ?? 0)
      const paid   = Number(project.paidAmount ?? 0)
      return budget > 0 ? Math.max(0, budget - paid) : null
    }
    return null
  })()

  const enteredAmt = Number(form.amount) || 0
  const vds        = canWithhold ? Math.max(0, numOr0(withholding.vdsAmount)) : 0
  const tds        = canWithhold ? Math.max(0, numOr0(withholding.tdsAmount)) : 0
  const withheld   = round2(vds + tds)
  const settledAmt = round2(enteredAmt + withheld)
  const amountExceedsBalance = outstanding !== null && outstanding > 0.01 && settledAmt > outstanding + 0.01

  // WithholdingFields base = value excl. VAT of the part being settled.
  const invTotal = Number(invoice?.total ?? 0)
  const share    = invTotal > 0 ? Math.min(1, settledAmt / invTotal) : 0
  const vatShare = invTotal > 0 ? round2(Number(invoice?.vatAmount ?? 0) * share) : 0
  const taxable  = invoice?.taxableValue !== null && invoice?.taxableValue !== undefined ? Number(invoice.taxableValue) : null
  const base     = invTotal > 0 && taxable !== null
    ? round2(taxable * share)
    : round2(Math.max(0, settledAmt - vatShare))

  const accountObj  = account ?? moneyAccounts.find(a => a.id === accountId) ?? null
  const autoChannel = channelFromPaymentMethod(form.paymentMethod || null, accountObj) ?? ''
  const effectiveChannel = channelTouched ? channel : autoChannel
  // A payment dated before go-live needs no account (the server only requires one
  // from go-live on, and accounts opened on go-live refuse earlier dates).
  const accountLive      = accountRequiredOn(form.paymentDate, goLiveDate)
  const accountRequired  = canConfirm && moneyAccounts.length > 0 && enteredAmt > 0 && accountLive

  async function save() {
    if (!(enteredAmt > 0) && !(withheld > 0)) { toast.error('Amount required'); return }
    if (form.amount !== '' && enteredAmt < 0) { toast.error('Amount cannot be negative'); return }
    if (amountExceedsBalance) { toast.error(`${withheld > 0 ? 'Amount + VDS + TDS' : 'Amount'} exceeds outstanding balance of ${money(outstanding)}`); return }
    if (enteredAmt > 0 && !form.receiptUrl) { toast.error('Payment proof required'); return }
    if (form.paymentDate && form.paymentDate > dhakaDayKey()) { toast.error('The payment date cannot be in the future'); return }
    if (accountRequired && !accountId) { toast.error('Select the money account the payment landed in'); return }
    const bdtReceived = Number(amountBDT)
    if (isForeign && amountBDT !== '' && !(bdtReceived > 0)) { toast.error('Enter a valid BDT amount received'); return }
    // Confirmers book the payment now, so the BDT value is required; a requester
    // may leave it for Accounts to fill in when confirming.
    if (isForeign && canConfirm && enteredAmt > 0 && !(bdtReceived > 0)) {
      toast.error(`Enter the BDT amount received for this ${payCurrency} payment`); return
    }
    setSaving(true)
    try {
      const body = {
        ...form,
        amount: enteredAmt,
        // Without the invoice list the server picks the invoice and its currency.
        ...(invoicesUnavailable && !invoice ? {} : { currency: payCurrency }),
        ...(isForeign && bdtReceived > 0 ? { amountBDT: bdtReceived } : {}),
        ...(invoice ? { invoiceId: invoice.id } : {}),
        ...(canConfirm && enteredAmt > 0 ? { accountId: accountId || undefined, channel: effectiveChannel || undefined } : {}),
        ...(canWithhold && withheld > 0 ? {
          vdsAmount:          vds,
          tdsAmount:          tds,
          tdsSection:         withholding.tdsSection || null,
          vdsCertificateNo:   withholding.vdsCertificateNo || null,
          vdsCertificateDate: withholding.vdsCertificateDate || null,
          tdsCertificateNo:   withholding.tdsCertificateNo || null,
          tdsCertificateDate: withholding.tdsCertificateDate || null,
        } : {}),
      }
      const res  = await fetch(`/api/projects/${projectId}/payments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Payment could not be recorded')
      if (json.data?.status === 'CONFIRMED') invalidateMoneyAccounts()
      toast.success(json.data?.status === 'CONFIRMED'
        ? 'Payment recorded and confirmed'
        : 'Payment recorded — pending confirmation in Accounts')
      onSaved(); onClose()
    } catch (err) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  return (
    <DialogShell
      title="Record payment"
      onClose={onClose}
      size={canConfirm ? 'max-w-2xl' : 'max-w-md'}
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} loading={saving} disabled={amountExceedsBalance}>Record payment</Button>
      </>}
    >
      {invoices.length > 1 && (
        <Field label="Invoice">
          <Select value={invoiceId} onChange={v => setInvoiceId(v ?? '')}
            options={invoices.map(i => ({
              value: i.id,
              label: `${i.invoiceNumber} — due ${fmtMoney(Math.max(0, Number(i.total ?? 0) - Number(i.paidAmount ?? 0)), i.currency)}`,
            }))}
            placeholder="Select invoice…"
          />
        </Field>
      )}
      {invoice ? (
        <div className="space-y-0.5 rounded-lg bg-gray-50 px-3 py-2.5 text-[13px] text-gray-600">
          <p>
            Invoice <span className="font-medium text-gray-900">{invoice.invoiceNumber}</span>
            {' · '}{canConfirm ? 'confirmed immediately' : 'updates on confirmation'}
          </p>
          {outstanding !== null && (
            <p className={outstanding <= 0.01 ? 'font-medium text-emerald-700' : ''}>
              Outstanding <span className="font-medium text-gray-900 tabular-nums">{money(outstanding)}</span>
              {outstanding <= 0.01 && ' — fully paid'}
              {Number(invoice.vatAmount ?? 0) > 0 && <span className="text-muted-foreground"> · VAT {money(invoice.vatAmount)}</span>}
            </p>
          )}
        </div>
      ) : (
        <div className="space-y-0.5 rounded-lg bg-gray-50 px-3 py-2.5 text-[13px] text-gray-600">
          <p>{canConfirm
            ? 'Confirmed immediately and added to income.'
            : 'Sent to Accounts for confirmation.'}</p>
          {outstanding !== null && (
            <p>Outstanding <span className="font-medium text-gray-900 tabular-nums">৳{outstanding.toFixed(2)}</span></p>
          )}
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field
          label={canWithhold ? 'Cash received (৳)' : `Amount (${isForeign ? payCurrency : '৳'})`}
          required={!canWithhold}
          error={amountExceedsBalance ? `${withheld > 0 ? 'Cash + VDS + TDS exceeds' : 'Exceeds'} outstanding balance of ${money(outstanding)}` : undefined}
        >
          <Input type="number" step="0.01" min="0" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} onKeyDown={e => { if (e.key === '-' || e.key === 'e') e.preventDefault() }} placeholder="0.00" invalid={amountExceedsBalance} />
        </Field>
        {isForeign && (
          <Field label="BDT received" required={canConfirm} hint="Taka actually credited, per bank advice.">
            <Input type="number" step="0.01" min="0" value={amountBDT} onChange={e => setAmountBDT(e.target.value)}
              onKeyDown={e => { if (e.key === '-' || e.key === 'e') e.preventDefault() }}
              placeholder="0.00"
              title={canConfirm ? undefined : 'Optional — Accounts confirms it'} />
          </Field>
        )}
        <Field label="Method">
          <Select value={form.paymentMethod} onChange={v => setForm(f => ({ ...f, paymentMethod: v ?? 'BANK_TRANSFER' }))}
            options={paymentMethods}
            placeholder="Select…"
          />
        </Field>
        {canConfirm && (
          <>
            <Field
              label="Received into"
              required={accountRequired}
              hint={moneyAccounts.length === 0
                ? 'No money accounts yet (Finance → Money accounts).'
                : enteredAmt > 0 && !accountLive ? `Before go-live (${goLiveDate}) — no account needed.` : undefined}
            >
              <MoneyAccountSelect
                value={accountId}
                onChange={(id, acc) => { setAccountId(id); setAccount(acc ?? null) }}
                currency={payCurrency}
                paymentMethod={form.paymentMethod || null}
                placeholder="Select account…"
                required={accountRequired}
                disabled={!(enteredAmt > 0) && withheld > 0}
                autoSelect={accountLive}
                date={form.paymentDate || null}
              />
            </Field>
            <Field label="Channel">
              <NativeSelect value={effectiveChannel} onChange={e => { setChannel(e.target.value); setChannelTouched(true) }}
                disabled={!(enteredAmt > 0) && withheld > 0}>
                <option value="">Select…</option>
                {PAYMENT_CHANNEL_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </NativeSelect>
            </Field>
          </>
        )}
        <Field label="Payment date">
          <DatePicker value={form.paymentDate || null} onChange={v => setForm(f => ({ ...f, paymentDate: v ?? '' }))} />
        </Field>
        <Field label="Description">
          <Input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Invoice ref, note…" />
        </Field>
        <div className="sm:col-span-2">
          <FileUpload label={enteredAmt > 0 || !(withheld > 0) ? 'Payment proof *' : 'Proof / client deduction note'} value={form.receiptUrl} onUploaded={url => setForm(f => ({ ...f, receiptUrl: url }))} />
        </div>
      </div>

      {canWithhold && (
        <>
          <WithholdingFields
            mode="CUSTOMER"
            baseAmount={base}
            vatAmount={vatShare}
            payeeType="COMPANY"
            value={withholding}
            onChange={setWithholding}
            date={form.paymentDate || null}
            compact
            vdsAllowed={invoiceAllowsVds(invoice)}
          />
          {withheld > 0 && (
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-gray-50 px-3 py-2 text-xs text-gray-600 tabular-nums">
              <span>Cash ৳{enteredAmt.toFixed(2)}</span>
              {vds > 0 && <span>+ VDS ৳{vds.toFixed(2)}</span>}
              {tds > 0 && <span>+ TDS ৳{tds.toFixed(2)}</span>}
              <span className={cn('ml-auto font-semibold', amountExceedsBalance ? 'text-red-600' : 'text-gray-900')}>Settles ৳{settledAmt.toFixed(2)}</span>
            </div>
          )}
        </>
      )}
      {canConfirm && invoice && !canWithhold && (
        <p className="text-xs text-muted-foreground">VDS / TDS withholding is recorded on BDT invoices only.</p>
      )}
    </DialogShell>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const ALL_TABS = ['overview', 'brief', 'discussion', 'tasks', 'invoices', 'expenses', 'payments', 'renewals', 'freelancers', 'agencies']
const FINANCIAL_TABS = new Set(['invoices', 'expenses', 'payments'])
const TAB_LABELS = { overview: 'Overview', brief: 'Brief', discussion: 'Discussion', tasks: 'Tasks', invoices: 'Invoices', expenses: 'Expenses', payments: 'Payments', renewals: 'Renewals', freelancers: 'Freelancers', agencies: 'Agencies' }

export default function ProjectDetailPage() {
  const { id }  = useParams()
  const router  = useRouter()
  const { data: session } = useSession()
  const { ventures, paymentMethods } = useConfig()
  const fmtMethod = v => v ? (paymentMethods.find(m => m.value === v)?.label ?? v.replace(/_/g, ' ')) : '—'
  const [project,           setProject]           = useState(null)
  const [loading,           setLoading]           = useState(true)
  const [canViewFinancials, setCanViewFinancials] = useState(true)
  const [tab,               setTab]               = useState('overview')
  const [statusModal,    setStatusModal]    = useState(false)
  const [expenseModal,   setExpenseModal]   = useState(false)
  const [paymentModal,   setPaymentModal]   = useState(false)
  const [taskModal,      setTaskModal]      = useState(false)
  const [editingTask,    setEditingTask]    = useState(null)
  const [payments,            setPayments]            = useState([])
  const [paymentsLoaded,      setPaymentsLoaded]      = useState(false)
  // Invoices tab
  const [invoices,            setInvoices]            = useState([])
  const [invoiceSummary,      setInvoiceSummary]      = useState(null)
  const [combinedInvoice,     setCombinedInvoice]     = useState(null)
  const [invoicesLoaded,      setInvoicesLoaded]      = useState(false)
  const [generatingCombined,  setGeneratingCombined]  = useState(false)
  const [freelancerAssignments, setFreelancerAssignments] = useState([])
  const [assignModal,         setAssignModal]         = useState(false)
  const [assignForm,          setAssignForm]          = useState({ person: null, freelancerId: '', paymentAmount: '', currency: 'BDT', amountBDT: '', paymentNotes: '' })
  const [freelancerList,      setFreelancerList]      = useState([])
  const [assignSaving,        setAssignSaving]        = useState(false)
  const [processingExpense,   setProcessingExpense]   = useState(null)
  const [requestingPayment,   setRequestingPayment]   = useState(null)
  const [editAssignment,      setEditAssignment]      = useState(null)    // {id, paymentAmount, paymentNotes, status}
  const [editAssignSaving,    setEditAssignSaving]    = useState(false)
  const [deletingAssign,      setDeletingAssign]      = useState(null)
  // Agency assignments (reuse FreelancerAssignment model; agencies have type=AGENCY)
  const [agencyList,          setAgencyList]          = useState([])
  const [assignAgencyModal,   setAssignAgencyModal]   = useState(false)
  const [assignAgencyForm,    setAssignAgencyForm]    = useState({ person: null, freelancerId: '', paymentAmount: '', currency: 'BDT', amountBDT: '', paymentNotes: '' })
  const [assignAgencySaving,  setAssignAgencySaving]  = useState(false)

  // Brief state
  const [brief,            setBrief]            = useState(null)
  const [briefMeta,        setBriefMeta]        = useState(null) // { briefUpdatedAt, briefUpdatedBy }
  const [briefEditing,     setBriefEditing]     = useState(false)
  const [briefDraft,       setBriefDraft]       = useState('')
  const [briefSaving,      setBriefSaving]      = useState(false)
  const [briefLoaded,      setBriefLoaded]      = useState(false)

  // Discussion state
  const [messages,         setMessages]         = useState([])
  const [msgInput,         setMsgInput]         = useState('')
  const [msgSending,       setMsgSending]       = useState(false)
  const [discussionLoaded, setDiscussionLoaded] = useState(false)
  const [deletingMsg,      setDeletingMsg]      = useState(null)
  const chatBottomRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const res  = await fetch(`/api/projects/${id}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setProject(json.data)
      setCanViewFinancials(json.meta?.canViewFinancials ?? true)
    } catch (err) { toast.error(err.message) }
    finally { setLoading(false) }
  }, [id])

  useEffect(() => { load() }, [load])

  const loadPayments = useCallback(async () => {
    try {
      const res  = await fetch(`/api/projects/${id}/payments`)
      const json = await res.json()
      if (res.ok) setPayments(json.data ?? [])
    } catch {}
    setPaymentsLoaded(true)
  }, [id])

  const loadFreelancerAssignments = useCallback(async () => {
    try {
      const res  = await fetch(`/api/freelancer-assignments?projectId=${id}`)
      const json = await res.json()
      if (res.ok) setFreelancerAssignments(json.data ?? [])
    } catch { /* silent */ }
  }, [id])

  const loadInvoices = useCallback(async () => {
    try {
      const res  = await fetch(`/api/projects/${id}/invoices`)
      const json = await res.json()
      if (res.ok) {
        setInvoices(json.data ?? [])
        setInvoiceSummary(json.summary ?? null)
        setCombinedInvoice(json.combined ?? null)
      }
    } catch { /* silent */ }
    setInvoicesLoaded(true)
  }, [id])

  useEffect(() => {
    if (tab === 'payments')    loadPayments()
    if (tab === 'invoices')    loadInvoices()
  }, [tab, loadPayments, loadInvoices])

  async function handleGenerateCombined() {
    setGeneratingCombined(true)
    try {
      const res  = await fetch(`/api/projects/${id}/invoices`, { method: 'POST' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success(`Combined invoice ${json.data.combinedNumber} ready`)
      router.push(`/admin/invoices/combined/${json.data.id}`)
    } catch (err) { toast.error(err.message) }
    finally { setGeneratingCombined(false) }
  }

  useEffect(() => {
    if (tab === 'freelancers' || tab === 'agencies') {
      loadFreelancerAssignments()
    }
    if (tab === 'freelancers') {
      fetch('/api/freelancers?limit=200&type=FREELANCER').then(r => r.json()).then(j => setFreelancerList(j.data ?? []))
    }
    if (tab === 'agencies') {
      fetch('/api/freelancers?limit=200&type=AGENCY').then(r => r.json()).then(j => setAgencyList(j.data ?? []))
    }
  }, [tab, loadFreelancerAssignments])

  // Load brief once when tab is opened
  useEffect(() => {
    if (tab !== 'brief' || briefLoaded) return
    fetch(`/api/projects/${id}/brief`)
      .then(r => r.json())
      .then(d => {
        setBrief(d.brief ?? null)
        setBriefMeta({ briefUpdatedAt: d.briefUpdatedAt, briefUpdatedBy: d.briefUpdatedBy })
        setBriefLoaded(true)
      })
      .catch(() => setBriefLoaded(true))
  }, [tab, id, briefLoaded])

  // Load discussion once when tab is opened; scroll to bottom on new messages
  useEffect(() => {
    if (tab !== 'discussion' || discussionLoaded) return
    fetch(`/api/projects/${id}/discussion`)
      .then(r => r.json())
      .then(d => { setMessages(d.data ?? []); setDiscussionLoaded(true) })
      .catch(() => setDiscussionLoaded(true))
  }, [tab, id, discussionLoaded])

  useEffect(() => {
    if (tab === 'discussion') chatBottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, tab])

  async function handleSaveBrief() {
    setBriefSaving(true)
    try {
      const res  = await fetch(`/api/projects/${id}/brief`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ brief: briefDraft }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setBrief(json.brief ?? null)
      setBriefMeta({ briefUpdatedAt: json.briefUpdatedAt, briefUpdatedBy: json.briefUpdatedBy })
      setBriefEditing(false)
      toast.success('Brief saved')
    } catch (err) { toast.error(err.message) }
    finally { setBriefSaving(false) }
  }

  async function handleSendMessage(e) {
    e.preventDefault()
    if (!msgInput.trim() || msgSending) return
    setMsgSending(true)
    try {
      const res  = await fetch(`/api/projects/${id}/discussion`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ content: msgInput }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setMessages(prev => [...prev, json.data])
      setMsgInput('')
    } catch (err) { toast.error(err.message) }
    finally { setMsgSending(false) }
  }

  async function handleDeleteMessage(msgId) {
    setDeletingMsg(msgId)
    try {
      const res  = await fetch(`/api/projects/${id}/discussion/${msgId}`, { method: 'DELETE' })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setMessages(prev => prev.filter(m => m.id !== msgId))
    } catch (err) { toast.error(err.message) }
    finally { setDeletingMsg(null) }
  }

  async function handleAssignFreelancer(e) {
    e.preventDefault()
    const isSalary = assignForm.person?.mode === 'SALARY'
    if (!assignForm.freelancerId) { toast.error('Select a freelancer'); return }
    if (!isSalary && !assignForm.paymentAmount) { toast.error('Payment amount is required'); return }
    if (!isSalary && assignForm.currency !== BASE_CURRENCY && !assignForm.amountBDT) {
      toast.error('Enter the BDT-equivalent for a non-BDT amount'); return
    }
    setAssignSaving(true)
    try {
      const res  = await fetch('/api/freelancer-assignments', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          projectId: id,
          freelancerId: assignForm.freelancerId,
          paymentNotes: assignForm.paymentNotes,
          ...(isSalary ? {} : {
            paymentAmount: Number(assignForm.paymentAmount),
            currency: assignForm.currency,
            amountBDT: assignForm.amountBDT ? Number(assignForm.amountBDT) : undefined,
          }),
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Freelancer assigned')
      setAssignModal(false)
      setAssignForm({ person: null, freelancerId: '', paymentAmount: '', currency: 'BDT', amountBDT: '', paymentNotes: '' })
      loadFreelancerAssignments()
    } catch (err) { toast.error(err.message) }
    finally { setAssignSaving(false) }
  }

  async function handleAssignAgency(e) {
    e.preventDefault()
    if (!assignAgencyForm.freelancerId || !assignAgencyForm.paymentAmount) {
      toast.error('Agency and payment amount are required')
      return
    }
    if (assignAgencyForm.currency !== BASE_CURRENCY && !assignAgencyForm.amountBDT) {
      toast.error('Enter the BDT-equivalent for a non-BDT amount'); return
    }
    setAssignAgencySaving(true)
    try {
      const res  = await fetch('/api/freelancer-assignments', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          projectId: id,
          freelancerId: assignAgencyForm.freelancerId,
          paymentNotes: assignAgencyForm.paymentNotes,
          paymentAmount: Number(assignAgencyForm.paymentAmount),
          currency: assignAgencyForm.currency,
          amountBDT: assignAgencyForm.amountBDT ? Number(assignAgencyForm.amountBDT) : undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Agency assigned')
      setAssignAgencyModal(false)
      setAssignAgencyForm({ person: null, freelancerId: '', paymentAmount: '', currency: 'BDT', amountBDT: '', paymentNotes: '' })
      loadFreelancerAssignments()
    } catch (err) { toast.error(err.message) }
    finally { setAssignAgencySaving(false) }
  }

  async function handleCompleteAssignment(assignmentId) {
    try {
      const res  = await fetch(`/api/freelancer-assignments/${assignmentId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'complete' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Assignment marked as completed')
      loadFreelancerAssignments()
    } catch (err) { toast.error(err.message) }
  }

  async function handleRequestPayment(assignmentId) {
    setRequestingPayment(assignmentId)
    try {
      const res  = await fetch(`/api/freelancer-assignments/${assignmentId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'request_payment' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Payment request sent to accounts')
      loadFreelancerAssignments()
    } catch (err) { toast.error(err.message) }
    finally { setRequestingPayment(null) }
  }

  async function handleEditAssignment(e) {
    e.preventDefault()
    if (!editAssignment) return
    if (editAssignment.currency !== BASE_CURRENCY && !(Number(editAssignment.amountBDT) > 0)) {
      toast.error('Enter the BDT-equivalent for a non-BDT amount'); return
    }
    setEditAssignSaving(true)
    try {
      const res  = await fetch(`/api/freelancer-assignments/${editAssignment.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          action: 'edit',
          paymentAmount: editAssignment.paymentAmount === '' ? null : Number(editAssignment.paymentAmount),
          currency: editAssignment.currency,
          // BDT engagements: the server keeps amountBDT equal to the amount.
          ...(editAssignment.currency !== BASE_CURRENCY && { amountBDT: editAssignment.amountBDT === '' ? null : Number(editAssignment.amountBDT) }),
          paymentNotes: editAssignment.paymentNotes,
          status: editAssignment.status,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Assignment updated')
      setEditAssignment(null)
      loadFreelancerAssignments()
    } catch (err) { toast.error(err.message) }
    finally { setEditAssignSaving(false) }
  }

  async function handleDeleteAssignment(assignmentId) {
    if (!confirm('Delete this freelancer assignment?')) return
    setDeletingAssign(assignmentId)
    try {
      const res  = await fetch(`/api/freelancer-assignments/${assignmentId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Assignment deleted')
      loadFreelancerAssignments()
    } catch (err) { toast.error(err.message) }
    finally { setDeletingAssign(null) }
  }

  async function handleExpenseAction(expenseId, action) {
    setProcessingExpense(expenseId)
    try {
      const res  = await fetch(`/api/expenses/${expenseId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success(action === 'approve' ? 'Expense approved — voucher ready to print' : 'Expense rejected')
      load()
    } catch (err) { toast.error(err.message) }
    finally { setProcessingExpense(null) }
  }

  async function handleDeleteTask(taskId) {
    if (!confirm('Delete this task?')) return
    try {
      const res = await fetch(`/api/projects/${id}/tasks/${taskId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Task deleted')
      load()
    } catch (err) { toast.error(err.message) }
  }

  async function handleToggleTask(task) {
    const newStatus = task.status === 'COMPLETED' ? 'TODO' : 'COMPLETED'
    try {
      const res = await fetch(`/api/projects/${id}/tasks/${task.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...task, status: newStatus }),
      })
      if (!res.ok) throw new Error((await res.json()).error)
      load()
    } catch (err) { toast.error(err.message) }
  }

  async function handleDelete() {
    if (!confirm(`Delete "${project?.name}"? This can't be undone.`)) return
    try {
      const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Project deleted')
      router.push('/admin/projects')
    } catch (err) { toast.error(err.message) }
  }

  if (loading) return <PageLoader />
  if (!project) return (
    <EmptyState
      icon={FileText}
      title="Project not found"
      action={<Button variant="outline" href="/admin/projects">Back to projects</Button>}
    />
  )

  const TABS           = canViewFinancials ? ALL_TABS : ALL_TABS.filter(t => !FINANCIAL_TABS.has(t))
  // Mirror the API guards: PUT / status / renew need projects.update; DELETE is SUPER_ADMIN-only.
  const canUpdateProject = canDo(session, 'projects.update')
  const canDeleteProject = session?.user?.role === 'SUPER_ADMIN' && canDo(session, 'projects.delete')
  const paidAmount     = project.paidAmount  ?? 0
  const projectValue   = project.budget      ?? 0   // the net value; no contract/discount split any more
  const dueAmount      = project.dueAmount   ?? Math.max(0, projectValue - paidAmount)
  const profit         = paidAmount - (project.approvedExpenses ?? 0)
  const utilization    = projectValue > 0 ? Math.round(((project.approvedExpenses ?? 0) / projectValue) * 100) : 0
  const ventureIdx  = ventures.findIndex(v => v.id === project.venture)
  const vm          = ventureIdx >= 0 ? ventures[ventureIdx] : { label: project.venture }
  const doneTasks   = project.tasks?.filter(t => t.status === 'COMPLETED').length ?? 0
  const totalTasks  = project.tasks?.length ?? 0
  const taskPct     = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0
  const isOverdue   = project.projectType === 'FIXED' && isPastDay(project.deadline) && !['DELIVERED','CANCELLED','APPROVED'].includes(project.status)

  const invoiceHref = `/admin/invoices/new?projectId=${id}&clientId=${project.clientId?.id ?? project.clientId?._id ?? project.clientId ?? ''}`
  const stats = [
    ...(canViewFinancials ? [
      { label: 'Project value', value: fmt(projectValue) },
      { label: 'Paid',     value: fmt(paidAmount),  cls: 'text-emerald-600' },
      { label: 'Due',      value: fmt(dueAmount),   cls: dueAmount > 0 ? 'text-red-600' : undefined },
      { label: 'Expenses', value: fmt(project.approvedExpenses) },
      { label: 'Profit',   value: fmt(profit), cls: profit >= 0 ? 'text-emerald-600' : 'text-red-600' },
    ] : []),
    { label: 'Tasks', value: `${doneTasks} / ${totalTasks}` },
  ]

  return (
    <div className="space-y-6 pb-10">

      {/* Page Header */}
      <PageHeader
        back="/admin/projects"
        backLabel="Projects"
        title={project.name}
        meta={
          <Badge variant={STATUS_BADGE[project.status] ?? 'default'} dot>
            {STATUS_META[project.status]?.label ?? project.status}
          </Badge>
        }
        actions={<>
          {canUpdateProject && (<>
            <Button variant="outline" size="sm" href={`/admin/projects/${id}/edit`}>
              <Pencil /> Edit
            </Button>
            <Button variant="outline" size="sm" onClick={() => setStatusModal(true)}>
              Change status
            </Button>
          </>)}
          {canViewFinancials && (
            <Button variant="outline" size="sm" href={invoiceHref}>
              <FileText /> New invoice
            </Button>
          )}
          {canDeleteProject && (
            <Button variant="outline" size="icon-sm" onClick={handleDelete} aria-label="Delete project"
              className="text-gray-500 hover:border-red-200 hover:bg-red-50 hover:text-red-600">
              <Trash2 />
            </Button>
          )}
        </>}
      >
        <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
          {project.projectCode && <span className="font-mono text-[13px]">{project.projectCode}</span>}
          {project.projectCode && <span className="text-gray-300">·</span>}
          <span>{vm.label ?? project.venture}</span>
          <span className="text-gray-300">·</span>
          <span>{project.projectType === 'MONTHLY' ? 'Monthly retainer' : 'Fixed project'}</span>
          {isOverdue && (
            <span className="font-medium text-red-600">· Overdue since {fmtDate(project.deadline)}</span>
          )}
        </div>
      </PageHeader>

      {/* Stats row */}
      <Card className={cn(
        'grid gap-px overflow-hidden bg-gray-100',
        stats.length > 1 ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-6' : 'grid-cols-1'
      )}>
        {stats.map(({ label, value, cls }) => (
          <div key={label} className="bg-white px-5 py-4">
            <p className="text-[13px] text-muted-foreground">{label}</p>
            <p className={cn('mt-1 text-lg font-semibold tracking-tight tabular-nums text-gray-900', cls)}>{value}</p>
          </div>
        ))}
      </Card>

      {/* Tab Nav */}
      <Tabs
        variant="underline"
        value={tab}
        onChange={setTab}
        tabs={TABS.map(t => ({
          value: t,
          label: TAB_LABELS[t],
          count: t === 'tasks' && totalTasks > 0 ? totalTasks : undefined,
        }))}
      />

      {/* ── OVERVIEW ── */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
          {/* Details card */}
          <Card className="p-5 sm:p-6 lg:col-span-2">
            <CardTitle className="mb-5">Project details</CardTitle>

            {/* Progress bars */}
            {((canViewFinancials && projectValue > 0) || totalTasks > 0) && (
              <div className="mb-6 space-y-4 border-b border-gray-100 pb-6">
                {canViewFinancials && projectValue > 0 && (
                  <div>
                    <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
                      <span>Cost vs project value <span className="text-gray-400">(of ৳{projectValue.toLocaleString()})</span></span>
                      <span className="tabular-nums">{utilization}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-gray-100">
                      <div className={`h-1.5 rounded-full transition-all ${utilization > 90 ? 'bg-red-500' : utilization > 70 ? 'bg-amber-500' : 'bg-gray-900'}`}
                        style={{ width: `${Math.min(utilization, 100)}%` }} />
                    </div>
                  </div>
                )}
                {totalTasks > 0 && (
                  <div>
                    <div className="mb-1.5 flex justify-between text-xs text-muted-foreground">
                      <span>Task completion</span>
                      <span className="tabular-nums">{taskPct}%</span>
                    </div>
                    <div className="h-1.5 w-full rounded-full bg-gray-100">
                      <div className="h-1.5 rounded-full bg-gray-900 transition-all" style={{ width: `${taskPct}%` }} />
                    </div>
                  </div>
                )}
              </div>
            )}

            <dl className="grid grid-cols-1 gap-x-8 gap-y-4 sm:grid-cols-2">
              {[
                { label: 'Client',       value: project.clientId?.userId?.name ?? '—' },
                { label: 'Company',      value: project.clientId?.company ?? '—' },
                { label: 'Manager',      value: project.projectManagerId?.name ?? '—' },
                { label: 'Priority',     value: humanize(project.priority) || '—' },
                { label: 'Order date',   value: fmtDate(project.orderDate) },
                { label: 'Start date',   value: fmtDate(project.startDate) },
                ...(project.projectType === 'FIXED' ? [
                  { label: 'Deadline',   value: <span className={isOverdue ? 'font-medium text-red-600' : ''}>{fmtDate(project.deadline)}</span> },
                ] : [
                  { label: 'Period start', value: fmtDate(project.currentPeriodStart) },
                  { label: 'Period end',   value: fmtDate(project.currentPeriodEnd) },
                  { label: 'Next billing', value: fmtDate(project.nextBillingDate) },
                ]),
                { label: 'Currency',   value: 'BDT' },
                ...(canViewFinancials ? [
                  { label: 'Expenses', value: fmt(project.approvedExpenses) },
                  { label: 'Profit',   value: <span className={profit >= 0 ? 'text-emerald-600' : 'text-red-600'}>{fmt(profit)}</span> },
                ] : []),
              ].map(({ label, value }) => (
                <div key={label} className="flex flex-col gap-1">
                  <dt className="text-[13px] text-muted-foreground">{label}</dt>
                  <dd className="text-sm text-gray-900">{value ?? '—'}</dd>
                </div>
              ))}
            </dl>

            {/* Financial breakdown — only shown to users who can view financials */}
            {canViewFinancials && projectValue > 0 && (
              <div className="mt-6 space-y-2.5 rounded-lg bg-gray-50 p-4 text-sm tabular-nums">
                <p className="mb-1 text-sm font-semibold text-gray-900">Financial breakdown</p>
                <div className="flex items-center justify-between border-b border-gray-200/80 pb-2.5">
                  <span className="text-gray-600">Project value</span>
                  <span className="font-semibold text-gray-900">{fmt(projectValue)}</span>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-gray-600">Paid</span>
                  <span className="font-medium text-emerald-600">{fmt(paidAmount)}</span>
                </div>
                {dueAmount > 0 && (
                  <div className="flex items-center justify-between border-t border-gray-200/80 pt-2.5">
                    <span className="font-medium text-gray-900">Outstanding</span>
                    <span className="font-semibold text-amber-600">{fmt(dueAmount)}</span>
                  </div>
                )}
                {dueAmount <= 0.01 && (
                  <div className="flex items-center justify-between border-t border-gray-200/80 pt-2.5">
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium text-emerald-700">
                      <CheckCircle2 className="size-3.5" /> Fully paid
                    </span>
                    <span className="font-semibold text-emerald-600">{fmt(paidAmount)}</span>
                  </div>
                )}
              </div>
            )}

            {project.description && (
              <div className="mt-6 border-t border-gray-100 pt-5">
                <h4 className="mb-2 text-sm font-medium text-gray-900">Description</h4>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-600">{project.description}</p>
              </div>
            )}

            {project.tags && (
              <div className="mt-5 flex flex-wrap items-center gap-1.5 border-t border-gray-100 pt-4">
                {project.tags.split(',').map(t => (
                  <Badge key={t.trim()} variant="outline">{t.trim()}</Badge>
                ))}
              </div>
            )}
          </Card>

          {/* Team + Quick Actions */}
          <div className="space-y-4">
            {/* Team */}
            {(project.teamMembers?.length > 0 || project.projectManagerId) && (
              <Card>
                <CardHeader>
                  <CardTitle>Team</CardTitle>
                </CardHeader>
                <CardContent className="space-y-3">
                  {project.projectManagerId && (
                    <div className="flex items-center gap-2.5">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-medium text-gray-700">
                        {project.projectManagerId.name?.[0]?.toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm font-medium text-gray-900">{project.projectManagerId.name}</p>
                        <p className="text-xs text-muted-foreground">Project manager</p>
                      </div>
                    </div>
                  )}
                  {project.teamMembers?.map(m => (
                    <div key={m.id ?? m._id ?? m} className="flex items-center gap-2.5">
                      <div className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-medium text-gray-600">
                        {m.name?.[0]?.toUpperCase() ?? '?'}
                      </div>
                      <p className="text-sm text-gray-700">{m.name}</p>
                    </div>
                  ))}
                </CardContent>
              </Card>
            )}

            {/* Quick Actions */}
            <Card>
              <CardHeader className="pb-2">
                <CardTitle>Quick actions</CardTitle>
              </CardHeader>
              <CardContent className="space-y-0.5 px-3 pb-3">
                <Button variant="ghost" className="w-full justify-start" onClick={() => { setTab('tasks'); setTaskModal(true) }}>
                  <Plus className="text-gray-400" /> New task
                </Button>
                {canViewFinancials && (<>
                  <Button variant="ghost" className="w-full justify-start" onClick={() => { setTab('expenses'); setExpenseModal(true) }}>
                    <TrendingDown className="text-gray-400" /> Submit expense
                  </Button>
                  <Button variant="ghost" className="w-full justify-start" onClick={() => { setTab('payments'); setPaymentModal(true) }}>
                    <CreditCard className="text-gray-400" /> Record payment
                  </Button>
                  <Link href={invoiceHref} className={cn(buttonVariants({ variant: 'ghost' }), 'w-full justify-start')}>
                    <FileText className="text-gray-400" /> New invoice
                  </Link>
                </>)}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      {/* ── TASKS ── */}
      {tab === 'tasks' && (
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-gray-100 pb-4">
            <div>
              <CardTitle>Tasks</CardTitle>
              <CardDescription>{doneTasks} of {totalTasks} completed</CardDescription>
            </div>
            <CardAction>
              <Button variant="outline" size="sm" onClick={() => { setEditingTask(null); setTaskModal(true) }}>
                <Plus /> New task
              </Button>
            </CardAction>
          </CardHeader>

          {totalTasks > 0 && (
            <div className="border-b border-gray-100 px-5 py-3">
              <div className="flex items-center gap-3">
                <div className="h-1.5 flex-1 rounded-full bg-gray-100">
                  <div className="h-1.5 rounded-full bg-gray-900 transition-all" style={{ width: `${taskPct}%` }} />
                </div>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{taskPct}%</span>
              </div>
            </div>
          )}

          {totalTasks === 0 ? (
            <EmptyState
              icon={Circle}
              title="No tasks yet"
              action={<Button variant="outline" size="sm" onClick={() => setTaskModal(true)}><Plus /> New task</Button>}
            />
          ) : (
            <div className="divide-y divide-gray-100">
              {project.tasks.map(t => {
                const isDone = t.status === 'COMPLETED'
                return (
                  <div key={t.id ?? t._id} className="group flex items-start gap-3 px-5 py-3.5 transition-colors hover:bg-gray-50/70">
                    <button onClick={() => handleToggleTask(t)} className="mt-0.5 shrink-0" aria-label={isDone ? 'Mark as to do' : 'Mark as completed'}>
                      {isDone
                        ? <CheckCircle2 className="size-[18px] text-emerald-600" />
                        : <Circle className="size-[18px] text-gray-300 transition-colors group-hover:text-gray-400" />
                      }
                    </button>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                        <p className={cn('text-sm', isDone ? 'text-gray-400 line-through' : 'font-medium text-gray-900')}>
                          {t.title}
                        </p>
                        <div className="flex items-center gap-1.5">
                          <span className={`size-1.5 shrink-0 rounded-full ${TASK_STATUS_DOT[t.status] ?? 'bg-gray-400'}`} />
                          <span className="text-xs text-muted-foreground">{humanize(t.status)}</span>
                        </div>
                        {t.priority && t.priority !== 'MEDIUM' && (
                          <span className="text-xs text-muted-foreground">{humanize(t.priority)}</span>
                        )}
                      </div>
                      {t.description && <p className="mt-0.5 truncate text-xs text-muted-foreground">{t.description}</p>}
                      {t.dueDate && (
                        <div className="mt-1.5 flex items-center gap-1">
                          <Calendar className="size-3.5 text-gray-400" />
                          <span className={`text-xs ${isPastDay(t.dueDate) && !isDone && t.status !== 'CANCELLED' ? 'font-medium text-red-600' : 'text-muted-foreground'}`}>
                            {fmtDate(t.dueDate)}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity sm:opacity-0 sm:group-hover:opacity-100">
                      <Button variant="ghost" size="icon-sm" aria-label="Edit task" className="text-gray-400"
                        onClick={() => { setEditingTask(t); setTaskModal(true) }}>
                        <Pencil />
                      </Button>
                      <Button variant="ghost" size="icon-sm" aria-label="Delete task" className="text-gray-400 hover:bg-red-50 hover:text-red-600"
                        onClick={() => handleDeleteTask(t.id ?? t._id)}>
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </Card>
      )}

      {/* ── INVOICES ── */}
      {tab === 'invoices' && (
        <div className="space-y-4">
          {/* Rollup across every issued invoice on this project */}
          {invoiceSummary && (
            <div className="grid grid-cols-2 gap-4 lg:grid-cols-5">
              {[
                { label: 'Invoices',   value: invoiceSummary.allCount ?? 0, cls: 'text-gray-900', raw: true },
                { label: 'Billed',     value: fmt(invoiceSummary.total),      cls: 'text-gray-900' },
                { label: 'Paid',       value: fmt(invoiceSummary.paidAmount), cls: 'text-emerald-600' },
                { label: 'Due',        value: fmt(invoiceSummary.due),        cls: invoiceSummary.due > 0.01 ? 'text-red-600' : 'text-emerald-600' },
                { label: 'Un-invoiced', value: fmt(invoiceSummary.uninvoiced), cls: invoiceSummary.uninvoiced > 0.01 ? 'text-amber-600' : 'text-gray-400' },
              ].map(c => (
                <Card key={c.label} className="p-4">
                  <p className="text-[13px] text-muted-foreground">{c.label}</p>
                  <p className={`mt-1 text-base font-semibold tabular-nums ${c.cls}`}>{c.value}</p>
                </Card>
              ))}
            </div>
          )}

          <Card className="overflow-hidden">
            <CardHeader className="flex-wrap border-b border-gray-100">
              <div>
                <CardTitle>Invoices <span className="font-normal text-muted-foreground">{invoices.length}</span></CardTitle>
                {invoiceSummary?.draftCount > 0 && (
                  <CardDescription>
                    {invoiceSummary.draftCount} draft{invoiceSummary.draftCount === 1 ? '' : 's'} excluded from totals
                  </CardDescription>
                )}
              </div>
              <CardAction className="flex-wrap">
                {combinedInvoice ? (
                  <Link href={`/admin/invoices/combined/${combinedInvoice.id}`}
                    title="Combined invoice — re-totals from the invoices below each time it's opened"
                    className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                    <Layers /> {combinedInvoice.combinedNumber}
                  </Link>
                ) : invoices.length > 1 ? (
                  <Button variant="outline" size="sm" onClick={handleGenerateCombined} loading={generatingCombined}>
                    {!generatingCombined && <Layers />}
                    Generate combined invoice
                  </Button>
                ) : null}
                <Button variant="outline" size="sm" href={invoiceHref}>
                  <Plus /> New invoice
                </Button>
              </CardAction>
            </CardHeader>

            {!invoicesLoaded ? (
              <div className="flex justify-center py-10">
                <LoadingSpinner />
              </div>
            ) : invoices.length === 0 ? (
              <EmptyState icon={FileText} title="No invoices yet" />
            ) : (
              <Table className="min-w-[720px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice no</TableHead>
                    <TableHead>Issued</TableHead>
                    <TableHead>Due date</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead className="text-right">Paid</TableHead>
                    <TableHead className="text-right">Due</TableHead>
                    <TableHead className="w-10" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {invoices.map(inv => (
                    <TableRow key={inv.id} onClick={() => router.push(`/admin/invoices/${inv.id}`)}
                      className="cursor-pointer">
                      <TableCell className="whitespace-nowrap font-mono text-[13px] font-medium text-gray-900">{inv.invoiceNumber}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(inv.issueDate)}</TableCell>
                      <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(inv.dueDate)}</TableCell>
                      <TableCell className="whitespace-nowrap">
                        <Badge status={inv.status} dot />
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right font-medium tabular-nums text-gray-900">{fmt(inv.total)}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums text-emerald-600">{fmt(inv.paidAmount)}</TableCell>
                      <TableCell className={`whitespace-nowrap text-right font-medium tabular-nums ${inv.due > 0.01 ? 'text-red-600' : 'text-emerald-600'}`}>{fmt(inv.due)}</TableCell>
                      <TableCell className="text-right">
                        <ChevronRight className="inline size-4 text-gray-300" />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
                <TableFooter>
                  <TableRow className="hover:bg-transparent">
                    <TableCell colSpan={4} className="text-[13px] font-medium text-gray-600">
                      Total ({invoiceSummary?.invoiceCount ?? 0} billable)
                    </TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-gray-900">{fmt(invoiceSummary?.total)}</TableCell>
                    <TableCell className="text-right font-semibold tabular-nums text-emerald-600">{fmt(invoiceSummary?.paidAmount)}</TableCell>
                    <TableCell className={`text-right font-semibold tabular-nums ${(invoiceSummary?.due ?? 0) > 0.01 ? 'text-red-600' : 'text-emerald-600'}`}>{fmt(invoiceSummary?.due)}</TableCell>
                    <TableCell />
                  </TableRow>
                </TableFooter>
              </Table>
            )}
          </Card>
        </div>
      )}

      {/* ── EXPENSES ── */}
      {tab === 'expenses' && (
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-gray-100">
            <CardTitle>Expenses <span className="font-normal text-muted-foreground">{project.expenses?.length ?? 0}</span></CardTitle>
            <CardAction>
              <Button variant="outline" size="sm" onClick={() => setExpenseModal(true)}>
                <Plus /> New expense
              </Button>
            </CardAction>
          </CardHeader>
          {(project.expenses?.length ?? 0) === 0 ? (
            <EmptyState icon={TrendingDown} title="No expenses yet" />
          ) : (
            <Table className="min-w-[560px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {project.expenses.map(e => (
                  <TableRow key={e.id ?? e._id}>
                    <TableCell className="font-medium text-gray-900">{e.title}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {e.category}{e.subcategory ? ` / ${e.subcategory}` : ''}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums text-gray-900">
                      {fmtMoney(e.amount, e.currency)}
                      {(e.currency || 'BDT') !== 'BDT' && e.amountBDT != null && (
                        <p className="text-xs text-muted-foreground">≈ {fmtMoney(e.amountBDT, 'BDT')}</p>
                      )}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(e.date)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Badge variant={EXPENSE_STATUS_BADGE[e.status] ?? 'warning'} dot>{humanize(e.status)}</Badge>
                    </TableCell>
                    <TableCell className="py-2">
                      <div className="flex items-center justify-end gap-1.5">
                        {e.invoiceUrl && <DocPreview url={e.invoiceUrl} compact />}
                        {(e.status === 'PAID' || e.status === 'AUTHORIZED') && (
                          <a href={`/api/expenses/${e.id ?? e._id}/voucher`} target="_blank" rel="noreferrer"
                            className={buttonVariants({ variant: 'outline', size: 'xs' })}>
                            Invoice
                          </a>
                        )}
                        {e.status === 'PENDING' && (
                          <>
                            <Link href="/admin/accounts?tab=requests"
                              className={buttonVariants({ variant: 'default', size: 'xs' })}>
                              Record payment
                            </Link>
                            <Button variant="outline" size="xs"
                              onClick={() => handleExpenseAction(e.id ?? e._id, 'reject')}
                              disabled={processingExpense === (e.id ?? e._id)}
                              className="text-red-600 hover:bg-red-50 hover:text-red-700">
                              Reject
                            </Button>
                          </>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}

      {/* ── PAYMENTS ── */}
      {tab === 'payments' && (
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-gray-100">
            <CardTitle>Payments <span className="font-normal text-muted-foreground">{payments.length}</span></CardTitle>
            <CardAction>
              <Button variant="outline" size="sm" onClick={() => setPaymentModal(true)}>
                <Plus /> Record payment
              </Button>
            </CardAction>
          </CardHeader>
          {!paymentsLoaded ? (
            <div className="flex justify-center py-10">
              <LoadingSpinner />
            </div>
          ) : payments.length === 0 ? (
            <EmptyState icon={CreditCard} title="No payments yet" />
          ) : (
            <Table className="min-w-[540px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Description</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Method</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Proof</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {payments.map(p => (
                  <TableRow key={p.id}>
                    <TableCell className="text-gray-900">{p.description || '—'}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums text-gray-900">
                      {p.currency && p.currency !== 'BDT' ? p.currency : 'BDT'} {Number(p.amount).toLocaleString()}
                      {(numOr0(p.vdsAmount) > 0 || numOr0(p.tdsAmount) > 0) && (
                        <span className="block text-[11px] text-muted-foreground">
                          {numOr0(p.vdsAmount) > 0 ? `+ VDS ${numOr0(p.vdsAmount).toLocaleString()}` : ''}
                          {numOr0(p.vdsAmount) > 0 && numOr0(p.tdsAmount) > 0 ? ' · ' : ''}
                          {numOr0(p.tdsAmount) > 0 ? `+ TDS ${numOr0(p.tdsAmount).toLocaleString()}` : ''}
                        </span>
                      )}
                      {p.accountId?.name && <span className="block text-[11px] text-muted-foreground">into {p.accountId.name}</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{fmtMethod(p.paymentMethod)}</TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">{fmtDate(p.paymentDate)}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <span title={p.status === 'REVERSED' && p.reversalReason ? `Reversed: ${p.reversalReason}` : undefined}>
                        <Badge variant={PAYMENT_STATUS_BADGE[p.status] ?? 'warning'} dot>
                          {({ PENDING_CONFIRMATION: 'Pending', CONFIRMED: 'Confirmed', REJECTED: 'Rejected', REVERSING: 'Reversing…', REVERSED: 'Reversed' })[p.status] ?? p.status}
                        </Badge>
                      </span>
                    </TableCell>
                    <TableCell className="py-2">
                      {p.receiptUrl ? <DocPreview url={p.receiptUrl} compact /> : '—'}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          {payments.some(p => p.status === 'PENDING_CONFIRMATION') && (
            <div className="border-t border-gray-100 px-5 py-3">
              <p className="text-xs text-muted-foreground">Pending payments await confirmation in <span className="font-medium text-gray-700">Accounts → Payment confirmations</span>.</p>
            </div>
          )}
        </Card>
      )}

      {/* ── RENEWALS ── */}
      {tab === 'renewals' && (
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-gray-100">
            <CardTitle>Renewal history <span className="font-normal text-muted-foreground">{project.renewals?.length ?? 0}</span></CardTitle>
          </CardHeader>
          {(project.renewals?.length ?? 0) === 0 ? (
            <EmptyState icon={Clock} title="No renewals yet" />
          ) : (
            <Table className="min-w-[420px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Period</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Notes</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {project.renewals.map(r => (
                  <TableRow key={r.id ?? r._id}>
                    <TableCell className="whitespace-nowrap text-gray-900">{fmtDate(r.periodStart)} – {fmtDate(r.periodEnd)}</TableCell>
                    <TableCell className="whitespace-nowrap text-right tabular-nums text-gray-900">BDT {Number(r.billingAmount).toLocaleString()}</TableCell>
                    <TableCell className="whitespace-nowrap">
                      <Badge variant="primary" dot>{humanize(r.status)}</Badge>
                    </TableCell>
                    <TableCell className="text-muted-foreground">{r.notes ?? '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      )}

      {/* ── FREELANCERS ── */}
      {tab === 'freelancers' && (() => {
        const isAdmin = ['SUPER_ADMIN', 'MANAGER'].includes(session?.user?.role)
        // The API lets admins and the project manager complete / request payment.
        const canManageAssignments = isAdmin ||
          (session?.user?.role === 'EMPLOYEE' && (project.projectManagerId?.id ?? project.projectManagerId) === session?.user?.id)
        const freelancerOnlyAssignments = freelancerAssignments.filter(a => a.freelancerId?.type !== 'AGENCY')

        return (
          <Card className="overflow-hidden">
            <CardHeader className="border-b border-gray-100">
              <div>
                <CardTitle>Freelancers</CardTitle>
                <CardDescription>{freelancerOnlyAssignments.length} assignment{freelancerOnlyAssignments.length !== 1 ? 's' : ''}</CardDescription>
              </div>
              {(
                ['SUPER_ADMIN', 'MANAGER'].includes(session?.user?.role) ||
                (session?.user?.role === 'EMPLOYEE' && (project.projectManagerId?.id ?? project.projectManagerId) === session.user.id)
              ) && (
                <CardAction>
                  <Button variant="outline" size="sm" onClick={() => setAssignModal(true)}>
                    <Plus /> Assign freelancer
                  </Button>
                </CardAction>
              )}
            </CardHeader>

            {freelancerOnlyAssignments.length === 0 ? (
              <EmptyState icon={Users} title="No freelancers assigned yet" />
            ) : (
              <Table className="min-w-[640px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Freelancer</TableHead>
                    <TableHead className="text-right">Payment</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Payment status</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {freelancerOnlyAssignments.map(a => {
                    const name   = a.freelancerId?.userId?.name ?? 'Unknown'
                    const email  = a.freelancerId?.userId?.email ?? ''
                    const avatar = a.freelancerId?.userId?.avatar
                    const aId    = a.id ?? a._id
                    return (
                      <TableRow key={aId}>
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            {avatar ? (
                              <Image src={avatar} alt="" width={28} height={28} className="size-7 shrink-0 rounded-full object-cover" />
                            ) : (
                              <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-medium text-gray-600">
                                {name[0]?.toUpperCase()}
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="font-medium text-gray-900">{name}</p>
                              {email && <p className="text-xs text-muted-foreground">{email}</p>}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-medium tabular-nums text-gray-900">
                          {fmtMoney(a.paymentAmount, a.currency)}
                          {(a.currency || 'BDT') !== 'BDT' && a.amountBDT != null && (
                            <p className="text-xs font-normal text-muted-foreground">≈ {fmtMoney(a.amountBDT, 'BDT')}</p>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={ASSIGN_STATUS_BADGE[a.status] ?? 'default'}>{humanize(a.status)}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            {/* Payment Status — dropdown for admin when PENDING and the work is delivered */}
                            {canManageAssignments && a.paymentStatus === 'PENDING' && a.status === 'COMPLETED' ? (
                              <NativeSelect
                                value={a.paymentStatus}
                                disabled={requestingPayment === aId}
                                onChange={e => { if (e.target.value === 'PAYMENT_REQUESTED') handleRequestPayment(aId) }}
                                className="h-8 w-auto text-xs"
                              >
                                <option value="PENDING">Pending</option>
                                <option value="PAYMENT_REQUESTED">Request payment</option>
                              </NativeSelect>
                            ) : (
                              <Badge variant={PAY_STATUS_BADGE[a.paymentStatus] ?? 'default'}>
                                {a.paymentStatus === 'PAYMENT_REQUESTED' ? 'Payment requested' : (humanize(a.paymentStatus) || 'Pending')}
                              </Badge>
                            )}
                            {requestingPayment === aId && <Loader2 className="size-3.5 animate-spin text-gray-400" />}
                          </div>
                        </TableCell>
                        <TableCell className="py-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {a.status === 'IN_PROGRESS' && (
                              <Button variant="outline" size="xs" onClick={() => handleCompleteAssignment(aId)}>
                                <CheckCircle2 /> Mark complete
                              </Button>
                            )}
                            {isAdmin && (
                              <>
                                <Button variant="outline" size="xs"
                                  onClick={() => setEditAssignment({ id: aId, paymentAmount: a.paymentAmount ?? '', currency: a.currency || 'BDT', amountBDT: a.amountBDT ?? '', paymentNotes: a.paymentNotes ?? '', status: a.status })}>
                                  <Pencil /> Edit
                                </Button>
                                <Button variant="ghost" size="icon-xs" aria-label="Delete assignment"
                                  onClick={() => handleDeleteAssignment(aId)}
                                  disabled={deletingAssign === aId}
                                  className="text-gray-400 hover:bg-red-50 hover:text-red-600">
                                  {deletingAssign === aId ? <Loader2 className="animate-spin" /> : <Trash2 />}
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}

            {/* Assign Freelancer Modal */}
            {assignModal && (
              <DialogShell
                title="Assign freelancer"
                onClose={() => setAssignModal(false)}
                onSubmit={handleAssignFreelancer}
                scroll={false}
                footer={<>
                  <Button variant="outline" onClick={() => setAssignModal(false)}>Cancel</Button>
                  <Button type="submit" loading={assignSaving}>Assign</Button>
                </>}
              >
                <Field label="Freelancer" required>
                  <PeoplePicker types={['FREELANCER']} typeFilter={false} value={assignForm.person}
                    placeholder="Search freelancers…"
                    onChange={p => setAssignForm(f => ({
                      ...f, person: p, freelancerId: p?.id ?? '',
                      currency: p?.currency ?? 'BDT',
                    }))} />
                </Field>
                {assignForm.person?.mode === 'SALARY' ? (
                  <div className="rounded-lg border border-blue-200 bg-blue-50 px-3 py-2.5 text-sm text-blue-800">
                    Salary-based — covered by their monthly salary.
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 gap-4">
                      <Field label="Amount" required>
                        <Input type="number" step="0.01" min="1"
                          value={assignForm.paymentAmount}
                          onChange={e => setAssignForm(f => ({ ...f, paymentAmount: e.target.value }))}
                          placeholder="0.00" />
                      </Field>
                      <Field label="Currency">
                        <Select value={assignForm.currency}
                          onChange={v => setAssignForm(f => ({ ...f, currency: v ?? 'BDT' }))}
                          options={currencyOptions} placeholder="Select…" />
                      </Field>
                    </div>
                    {assignForm.currency !== BASE_CURRENCY && (
                      <Field label="BDT equivalent" required>
                        <Input type="number" step="0.01" min="1"
                          value={assignForm.amountBDT}
                          onChange={e => setAssignForm(f => ({ ...f, amountBDT: e.target.value }))}
                          placeholder="0.00" />
                      </Field>
                    )}
                  </>
                )}
                <Field label="Payment notes">
                  <Textarea value={assignForm.paymentNotes}
                    onChange={e => setAssignForm(f => ({ ...f, paymentNotes: e.target.value }))}
                    rows={2} placeholder="Optional" className="min-h-0 resize-none" />
                </Field>
              </DialogShell>
            )}

            {/* Edit Assignment Modal */}
            {editAssignment && (
              <DialogShell
                title="Edit assignment"
                onClose={() => setEditAssignment(null)}
                onSubmit={handleEditAssignment}
                footer={<>
                  <Button variant="outline" onClick={() => setEditAssignment(null)}>Cancel</Button>
                  <Button type="submit" loading={editAssignSaving}>Save</Button>
                </>}
              >
                <Field label="Status">
                  <NativeSelect
                    value={editAssignment.status}
                    onChange={e => setEditAssignment(f => ({ ...f, status: e.target.value }))}
                  >
                    {['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].map(s => (
                      <option key={s} value={s}>{humanize(s)}</option>
                    ))}
                  </NativeSelect>
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Payment amount" required>
                    <Input type="number" step="0.01" min="1"
                      value={editAssignment.paymentAmount}
                      onChange={e => setEditAssignment(f => ({ ...f, paymentAmount: e.target.value }))}
                      placeholder="0.00" required />
                  </Field>
                  <Field label="Currency">
                    <Select value={editAssignment.currency}
                      onChange={v => setEditAssignment(f => ({ ...f, currency: v ?? 'BDT' }))}
                      options={currencyOptions} placeholder="Select…" />
                  </Field>
                </div>
                {editAssignment.currency !== BASE_CURRENCY && (
                  <Field label="BDT equivalent" required>
                    <Input type="number" step="0.01" min="1"
                      value={editAssignment.amountBDT}
                      onChange={e => setEditAssignment(f => ({ ...f, amountBDT: e.target.value }))}
                      placeholder="0.00" required />
                  </Field>
                )}
                <Field label="Payment notes">
                  <Textarea value={editAssignment.paymentNotes}
                    onChange={e => setEditAssignment(f => ({ ...f, paymentNotes: e.target.value }))}
                    rows={2} placeholder="Optional" className="min-h-0 resize-none" />
                </Field>
              </DialogShell>
            )}
          </Card>
        )
      })()}

      {/* ── AGENCIES ── */}
      {tab === 'agencies' && (() => {
        const isAdmin = ['SUPER_ADMIN', 'MANAGER'].includes(session?.user?.role)
        // The API lets admins and the project manager complete / request payment.
        const canManageAssignments = isAdmin ||
          (session?.user?.role === 'EMPLOYEE' && (project.projectManagerId?.id ?? project.projectManagerId) === session?.user?.id)
        const agencyAssignments = freelancerAssignments.filter(a => a.freelancerId?.type === 'AGENCY')

        return (
          <Card className="overflow-hidden">
            <CardHeader className="border-b border-gray-100">
              <div>
                <CardTitle>Agencies</CardTitle>
                <CardDescription>{agencyAssignments.length} assignment{agencyAssignments.length !== 1 ? 's' : ''}</CardDescription>
              </div>
              {(
                ['SUPER_ADMIN', 'MANAGER'].includes(session?.user?.role) ||
                (session?.user?.role === 'EMPLOYEE' && (project.projectManagerId?.id ?? project.projectManagerId) === session.user.id)
              ) && (
                <CardAction>
                  <Button variant="outline" size="sm" onClick={() => setAssignAgencyModal(true)}>
                    <Plus /> Assign agency
                  </Button>
                </CardAction>
              )}
            </CardHeader>

            {agencyAssignments.length === 0 ? (
              <EmptyState icon={Users} title="No agencies assigned yet" />
            ) : (
              <Table className="min-w-[640px]">
                <TableHeader>
                  <TableRow>
                    <TableHead>Agency</TableHead>
                    <TableHead className="text-right">Payment</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Payment status</TableHead>
                    <TableHead>Action</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agencyAssignments.map(a => {
                    const agencyName = a.freelancerId?.agencyInfo?.agencyName ?? a.freelancerId?.userId?.name ?? 'Unknown'
                    const email      = a.freelancerId?.userId?.email ?? ''
                    const aId        = a.id ?? a._id
                    return (
                      <TableRow key={aId}>
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <div className="flex size-7 shrink-0 items-center justify-center rounded-full bg-gray-100 text-xs font-medium text-gray-600">
                              {agencyName[0]?.toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="font-medium text-gray-900">{agencyName}</p>
                              {email && <p className="text-xs text-muted-foreground">{email}</p>}
                            </div>
                          </div>
                        </TableCell>
                        <TableCell className="whitespace-nowrap text-right font-medium tabular-nums text-gray-900">
                          {fmtMoney(a.paymentAmount, a.currency)}
                          {(a.currency || 'BDT') !== 'BDT' && a.amountBDT != null && (
                            <p className="text-xs font-normal text-muted-foreground">≈ {fmtMoney(a.amountBDT, 'BDT')}</p>
                          )}
                        </TableCell>
                        <TableCell>
                          <Badge variant={ASSIGN_STATUS_BADGE[a.status] ?? 'default'}>{humanize(a.status)}</Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            {canManageAssignments && a.paymentStatus === 'PENDING' && a.status === 'COMPLETED' ? (
                              <NativeSelect
                                value={a.paymentStatus}
                                disabled={requestingPayment === aId}
                                onChange={e => { if (e.target.value === 'PAYMENT_REQUESTED') handleRequestPayment(aId) }}
                                className="h-8 w-auto text-xs"
                              >
                                <option value="PENDING">Pending</option>
                                <option value="PAYMENT_REQUESTED">Request payment</option>
                              </NativeSelect>
                            ) : (
                              <Badge variant={PAY_STATUS_BADGE[a.paymentStatus] ?? 'default'}>
                                {a.paymentStatus === 'PAYMENT_REQUESTED' ? 'Payment requested' : (humanize(a.paymentStatus) || 'Pending')}
                              </Badge>
                            )}
                            {requestingPayment === aId && <Loader2 className="size-3.5 animate-spin text-gray-400" />}
                          </div>
                        </TableCell>
                        <TableCell className="py-2">
                          <div className="flex flex-wrap items-center gap-1.5">
                            {a.status === 'IN_PROGRESS' && (
                              <Button variant="outline" size="xs" onClick={() => handleCompleteAssignment(aId)}>
                                <CheckCircle2 /> Mark complete
                              </Button>
                            )}
                            {isAdmin && (
                              <>
                                <Button variant="outline" size="xs"
                                  onClick={() => setEditAssignment({ id: aId, paymentAmount: a.paymentAmount ?? '', currency: a.currency || 'BDT', amountBDT: a.amountBDT ?? '', paymentNotes: a.paymentNotes ?? '', status: a.status })}>
                                  <Pencil /> Edit
                                </Button>
                                <Button variant="ghost" size="icon-xs" aria-label="Delete assignment"
                                  onClick={() => handleDeleteAssignment(aId)}
                                  disabled={deletingAssign === aId}
                                  className="text-gray-400 hover:bg-red-50 hover:text-red-600">
                                  {deletingAssign === aId ? <Loader2 className="animate-spin" /> : <Trash2 />}
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}

            {/* Assign Agency Modal */}
            {assignAgencyModal && (
              <DialogShell
                title="Assign agency"
                onClose={() => setAssignAgencyModal(false)}
                onSubmit={handleAssignAgency}
                scroll={false}
                footer={<>
                  <Button variant="outline" onClick={() => setAssignAgencyModal(false)}>Cancel</Button>
                  <Button type="submit" loading={assignAgencySaving}>Assign</Button>
                </>}
              >
                <Field label="Agency" required>
                  <PeoplePicker types={['AGENCY']} typeFilter={false} value={assignAgencyForm.person}
                    placeholder="Search agencies…"
                    onChange={p => setAssignAgencyForm(f => ({
                      ...f, person: p, freelancerId: p?.id ?? '',
                      currency: p?.currency ?? 'BDT',
                    }))} />
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Amount" required>
                    <Input type="number" step="0.01" min="1"
                      value={assignAgencyForm.paymentAmount}
                      onChange={e => setAssignAgencyForm(f => ({ ...f, paymentAmount: e.target.value }))}
                      placeholder="0.00" />
                  </Field>
                  <Field label="Currency">
                    <Select value={assignAgencyForm.currency}
                      onChange={v => setAssignAgencyForm(f => ({ ...f, currency: v ?? 'BDT' }))}
                      options={currencyOptions} placeholder="Select…" />
                  </Field>
                </div>
                {assignAgencyForm.currency !== BASE_CURRENCY && (
                  <Field label="BDT equivalent" required>
                    <Input type="number" step="0.01" min="1"
                      value={assignAgencyForm.amountBDT}
                      onChange={e => setAssignAgencyForm(f => ({ ...f, amountBDT: e.target.value }))}
                      placeholder="0.00" />
                  </Field>
                )}
                <Field label="Payment notes">
                  <Textarea value={assignAgencyForm.paymentNotes}
                    onChange={e => setAssignAgencyForm(f => ({ ...f, paymentNotes: e.target.value }))}
                    rows={2} placeholder="Optional" className="min-h-0 resize-none" />
                </Field>
              </DialogShell>
            )}

            {/* Edit Assignment Modal (shared with freelancers tab) */}
            {editAssignment && (
              <DialogShell
                title="Edit assignment"
                onClose={() => setEditAssignment(null)}
                onSubmit={handleEditAssignment}
                footer={<>
                  <Button variant="outline" onClick={() => setEditAssignment(null)}>Cancel</Button>
                  <Button type="submit" loading={editAssignSaving}>Save</Button>
                </>}
              >
                <Field label="Status">
                  <NativeSelect
                    value={editAssignment.status}
                    onChange={e => setEditAssignment(f => ({ ...f, status: e.target.value }))}
                  >
                    {['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED'].map(s => (
                      <option key={s} value={s}>{humanize(s)}</option>
                    ))}
                  </NativeSelect>
                </Field>
                <div className="grid grid-cols-2 gap-4">
                  <Field label="Payment amount" required>
                    <Input type="number" step="0.01" min="1"
                      value={editAssignment.paymentAmount}
                      onChange={e => setEditAssignment(f => ({ ...f, paymentAmount: e.target.value }))}
                      placeholder="0.00" required />
                  </Field>
                  <Field label="Currency">
                    <Select value={editAssignment.currency}
                      onChange={v => setEditAssignment(f => ({ ...f, currency: v ?? 'BDT' }))}
                      options={currencyOptions} placeholder="Select…" />
                  </Field>
                </div>
                {editAssignment.currency !== BASE_CURRENCY && (
                  <Field label="BDT equivalent" required>
                    <Input type="number" step="0.01" min="1"
                      value={editAssignment.amountBDT}
                      onChange={e => setEditAssignment(f => ({ ...f, amountBDT: e.target.value }))}
                      placeholder="0.00" required />
                  </Field>
                )}
                <Field label="Payment notes">
                  <Textarea value={editAssignment.paymentNotes}
                    onChange={e => setEditAssignment(f => ({ ...f, paymentNotes: e.target.value }))}
                    rows={2} placeholder="Optional" className="min-h-0 resize-none" />
                </Field>
              </DialogShell>
            )}
          </Card>
        )
      })()}

      {/* ── BRIEF ── */}
      {tab === 'brief' && (() => {
        const canEditBrief = session && (
          ['SUPER_ADMIN', 'MANAGER'].includes(session.user.role) ||
          (project.projectManagerId?.id ?? project.projectManagerId) === session.user.id
        )
        const fmtBriefDate = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : null

        return (
          <div className="max-w-3xl space-y-4">
            <Card className="overflow-hidden">
              {/* Header */}
              <CardHeader className="items-center border-b border-gray-100">
                <CardTitle>Project brief</CardTitle>
                {canEditBrief && !briefEditing && (
                  <CardAction>
                    <Button variant="outline" size="sm"
                      onClick={() => { setBriefDraft(brief ?? ''); setBriefEditing(true) }}>
                      <Pencil />
                      {brief ? 'Edit' : 'Add brief'}
                    </Button>
                  </CardAction>
                )}
              </CardHeader>

              {/* Content */}
              <div className="px-5 py-5">
                {briefEditing ? (
                  <div className="space-y-3">
                    <Textarea
                      value={briefDraft}
                      onChange={e => setBriefDraft(e.target.value)}
                      rows={12}
                      placeholder="Scope, objectives, deliverables…"
                      className="resize-y"
                      autoFocus
                    />
                    <div className="flex items-center justify-end gap-2">
                      <Button variant="outline" onClick={() => setBriefEditing(false)}>
                        Cancel
                      </Button>
                      <Button onClick={handleSaveBrief} loading={briefSaving}>
                        Save brief
                      </Button>
                    </div>
                  </div>
                ) : !briefLoaded ? (
                  <div className="flex justify-center py-10">
                    <LoadingSpinner />
                  </div>
                ) : brief ? (
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">{brief}</p>
                ) : (
                  <EmptyState
                    icon={BookOpen}
                    title="No brief yet"
                    className="py-8"
                    action={canEditBrief && (
                      <Button variant="outline" size="sm" onClick={() => { setBriefDraft(''); setBriefEditing(true) }}>
                        Write brief
                      </Button>
                    )}
                  />
                )}
              </div>

              {/* Footer: last edited */}
              {!briefEditing && briefMeta?.briefUpdatedAt && (
                <div className="flex items-center gap-1.5 border-t border-gray-100 px-5 py-3 text-xs text-muted-foreground">
                  <Clock className="size-3.5" />
                  Updated {fmtBriefDate(briefMeta.briefUpdatedAt)}
                  {briefMeta.briefUpdatedBy?.name && ` by ${briefMeta.briefUpdatedBy.name}`}
                </div>
              )}
            </Card>
          </div>
        )
      })()}

      {/* ── DISCUSSION ── */}
      {tab === 'discussion' && (() => {
        const uid = session?.user?.id
        const canPost = session && (
          ['SUPER_ADMIN', 'MANAGER'].includes(session.user.role) ||
          (project.projectManagerId?.id ?? project.projectManagerId) === uid ||
          project.teamMembers?.some(m => (m.id ?? m._id ?? m) === uid)
        )

        return (
          <Card className="flex max-w-3xl flex-col gap-0 overflow-hidden" style={{ height: '70vh' }}>
            {/* Header */}
            <div className="flex shrink-0 items-center gap-2 border-b border-gray-100 px-5 py-3.5">
              <CardTitle>Discussion</CardTitle>
              {messages.length > 0 && (
                <span className="text-xs text-muted-foreground">{messages.length} message{messages.length !== 1 ? 's' : ''}</span>
              )}
            </div>

            {/* Messages */}
            <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
              {!discussionLoaded ? (
                <div className="flex justify-center py-10">
                  <LoadingSpinner />
                </div>
              ) : messages.length === 0 ? (
                <EmptyState icon={MessageSquare} title="No messages yet" className="h-full" />
              ) : (
                messages.map(msg => {
                  const isOwn  = msg.user.id === uid
                  const canDel = isOwn || ['SUPER_ADMIN', 'MANAGER'].includes(session?.user?.role)

                  return (
                    <div key={msg.id} className={`group flex gap-3 ${isOwn ? 'flex-row-reverse' : ''}`}>
                      {/* Avatar */}
                      <div className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-full bg-gray-100 text-xs font-medium text-gray-700">
                        {msg.user.avatar
                          ? <Image src={msg.user.avatar} alt="" width={32} height={32} className="size-8 rounded-full object-cover" />
                          : msg.user.name.charAt(0).toUpperCase()
                        }
                      </div>

                      {/* Bubble */}
                      <div className={`flex max-w-[75%] flex-col gap-1 ${isOwn ? 'items-end' : 'items-start'}`}>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-medium text-gray-700 ${isOwn ? 'order-last' : ''}`}>
                            {isOwn ? 'You' : msg.user.name}
                          </span>
                          <span className="text-[11px] text-gray-400">{fmtDateTime(msg.createdAt)}</span>
                        </div>
                        <div className={`flex items-start gap-1.5 ${isOwn ? 'flex-row-reverse' : ''}`}>
                          <div className={`whitespace-pre-wrap break-words rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
                            isOwn
                              ? 'rounded-tr-md bg-gray-900 text-white'
                              : 'rounded-tl-md bg-gray-100 text-gray-900'
                          }`}>
                            {msg.content}
                          </div>
                          {canDel && (
                            <Button variant="ghost" size="icon-xs" aria-label="Delete message"
                              onClick={() => handleDeleteMessage(msg.id)}
                              disabled={deletingMsg === msg.id}
                              className="mt-0.5 text-gray-300 opacity-0 transition-opacity hover:bg-red-50 hover:text-red-600 group-hover:opacity-100">
                              {deletingMsg === msg.id
                                ? <Loader2 className="size-3.5 animate-spin" />
                                : <Trash2 className="size-3.5" />
                              }
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  )
                })
              )}
              <div ref={chatBottomRef} />
            </div>

            {/* Input */}
            <div className="shrink-0 border-t border-gray-100 px-4 py-3">
              {canPost ? (
                <form onSubmit={handleSendMessage} className="flex items-end gap-2">
                  <Textarea
                    value={msgInput}
                    onChange={e => setMsgInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(e) }
                    }}
                    placeholder="Write a message…"
                    title="Enter to send · Shift+Enter for a new line"
                    rows={1}
                    className="min-h-0 flex-1 resize-none py-2"
                    style={{ maxHeight: '120px', overflowY: 'auto' }}
                  />
                  <Button type="submit" size="icon" aria-label="Send"
                    disabled={!msgInput.trim() || msgSending}>
                    {msgSending ? <Loader2 className="animate-spin" /> : <Send />}
                  </Button>
                </form>
              ) : (
                <p className="py-1 text-center text-xs text-muted-foreground">Only project members can post.</p>
              )}
            </div>
          </Card>
        )
      })()}

      {/* ── Modals ── */}
      {statusModal && (
        <StatusModal project={project} onClose={() => setStatusModal(false)}
          onSaved={s => setProject(p => ({ ...p, status: s }))}
          onRenewed={np => router.push(`/admin/projects/${np.id}`)} />
      )}
      {expenseModal && (
        <ExpenseModal projectId={id} onClose={() => setExpenseModal(false)} onSaved={() => load()} />
      )}
      {paymentModal && (
        <PaymentModal projectId={id} project={project} onClose={() => setPaymentModal(false)}
          onSaved={() => { load(); setPaymentsLoaded(false); loadPayments() }} />
      )}
      {(taskModal || editingTask) && (
        <TaskModal
          projectId={id}
          task={editingTask}
          onClose={() => { setTaskModal(false); setEditingTask(null) }}
          onSaved={() => load()}
        />
      )}
    </div>
  )
}
