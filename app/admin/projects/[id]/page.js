'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import {
  ArrowLeft, Pencil, Trash2, Plus, CheckCircle2, Circle,
  DollarSign, TrendingUp, TrendingDown, Loader2, X, Paperclip,
  CreditCard, Clock, Calendar, Users, Tag, Flag, BarChart2,
  ChevronRight, MoreHorizontal, Check, AlertTriangle, FileText,
  BookOpen, MessageSquare, Send, Pencil as PencilIcon,
} from 'lucide-react'
import { VENTURE_META, STATUS_META, EXPENSE_CATEGORIES } from '@/lib/ventures'
import Image from 'next/image'
import FileUpload from '@/components/ui/FileUpload'
import DocPreview from '@/components/ui/DocPreview'
import Select from '@/components/ui/Select'
import DatePicker from '@/components/ui/DatePicker'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const fmt = (n) => `৳ ${(n ?? 0).toLocaleString('en-BD', { minimumFractionDigits: 2 })}`
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const fmtDateTime = (d) => d ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : '—'

const VENTURE_COLORS = {
  ENSTUDIO: { bg: 'from-purple-600 to-purple-800', badge: 'bg-purple-100 text-purple-700', dot: 'bg-purple-500' },
  ENTECH:   { bg: 'from-blue-600 to-blue-800',     badge: 'bg-blue-100 text-blue-700',     dot: 'bg-blue-500'   },
  ENMARK:   { bg: 'from-green-600 to-green-800',   badge: 'bg-green-100 text-green-700',   dot: 'bg-green-500'  },
}
const STATUS_COLORS = {
  PENDING:       'bg-gray-100 text-gray-600',
  IN_PROGRESS:   'bg-blue-100 text-blue-700',
  IN_REVIEW:     'bg-purple-100 text-purple-700',
  REVISION:      'bg-yellow-100 text-yellow-700',
  APPROVED:      'bg-teal-100 text-teal-700',
  DELIVERED:     'bg-green-100 text-green-700',
  ACTIVE:        'bg-green-100 text-green-700',
  EXPIRING_SOON: 'bg-orange-100 text-orange-700',
  RENEWED:       'bg-blue-100 text-blue-700',
  ON_HOLD:       'bg-yellow-100 text-yellow-700',
  CANCELLED:     'bg-red-100 text-red-600',
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
const PRIORITY_COLORS = {
  LOW:    'bg-gray-100 text-gray-500',
  MEDIUM: 'bg-blue-50 text-blue-600',
  HIGH:   'bg-orange-100 text-orange-600',
  URGENT: 'bg-red-100 text-red-600',
}
const TASK_STATUS_COLORS = {
  TODO:        'bg-gray-100 text-gray-600',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  IN_REVIEW:   'bg-purple-100 text-purple-700',
  COMPLETED:   'bg-green-100 text-green-700',
  CANCELLED:   'bg-red-100 text-red-600',
}
const TASK_STATUS_DOT = {
  TODO:        'bg-gray-400',
  IN_PROGRESS: 'bg-blue-500',
  IN_REVIEW:   'bg-purple-500',
  COMPLETED:   'bg-green-500',
  CANCELLED:   'bg-red-500',
}
const TRANSITIONS = {
  PENDING:       ['IN_PROGRESS','CANCELLED','ON_HOLD'],
  IN_PROGRESS:   ['IN_REVIEW','REVISION','ON_HOLD','CANCELLED'],
  IN_REVIEW:     ['APPROVED','REVISION','IN_PROGRESS'],
  REVISION:      ['IN_PROGRESS','IN_REVIEW'],
  APPROVED:      ['DELIVERED'],
  DELIVERED:     [],
  ACTIVE:        ['EXPIRING_SOON','ON_HOLD','CANCELLED'],
  EXPIRING_SOON: ['RENEWED','CANCELLED'],
  RENEWED:       ['ACTIVE','EXPIRING_SOON'],
  ON_HOLD:       ['IN_PROGRESS','ACTIVE','CANCELLED'],
  CANCELLED:     [],
}
const PAYMENT_METHODS = ['CASH','BANK_TRANSFER','CARD','CHEQUE','ONLINE','OTHER']

// ─── StatusModal ──────────────────────────────────────────────────────────────

function StatusModal({ project, onClose, onSaved }) {
  const [status, setStatus] = useState('')
  const [note,   setNote]   = useState('')
  const [saving, setSaving] = useState(false)
  const allowed = TRANSITIONS[project.status] ?? []

  async function save() {
    if (!status) return
    setSaving(true)
    try {
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl border border-gray-200 w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">Change Status</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100"><X className="w-4 h-4 text-gray-400" /></button>
        </div>
        <p className="text-xs text-gray-500">Current: <span className="font-medium text-gray-700">{STATUS_META[project.status]?.label ?? project.status}</span></p>
        {allowed.length === 0 ? (
          <p className="text-sm text-gray-400 py-2">No further transitions available.</p>
        ) : (
          <div className="space-y-1.5">
            {allowed.map(s => (
              <button key={s} onClick={() => setStatus(s)}
                className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg border text-left transition-all ${status === s ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:border-gray-300'}`}>
                <div className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[s] ?? 'bg-gray-400'}`} />
                <span className="text-sm text-gray-800">{STATUS_META[s]?.label ?? s}</span>
                {status === s && <Check className="w-4 h-4 text-gray-700 ml-auto" />}
              </button>
            ))}
          </div>
        )}
        {status === 'CANCELLED' && (
          <textarea value={note} onChange={e => setNote(e.target.value)} rows={2} placeholder="Cancellation reason…"
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none" />
        )}
        <div className="flex gap-2 justify-end pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={save} disabled={!status || saving}
            className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-40 flex items-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Update
          </button>
        </div>
      </div>
    </div>
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
    assignedTo:  task?.assignedTo  ?? '',
    dueDate:     task?.dueDate     ? new Date(task.dueDate).toISOString().slice(0,10) : '',
  })
  const [saving, setSaving] = useState(false)
  const [members, setMembers] = useState([])

  useEffect(() => {
    fetch('/api/users?limit=100').then(r => r.json()).then(j => setMembers(j.data ?? []))
  }, [])

  async function save() {
    if (!form.title.trim()) { toast.error('Title required'); return }
    setSaving(true)
    try {
      const url    = isEdit ? `/api/projects/${projectId}/tasks/${task.id}` : `/api/projects/${projectId}/tasks`
      const method = isEdit ? 'PUT' : 'POST'
      const body   = { ...form, dueDate: form.dueDate || null, assignedTo: form.assignedTo || null }
      const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json   = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success(isEdit ? 'Task updated' : 'Task created')
      onSaved()
      onClose()
    } catch (err) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  const ic = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl border border-gray-200 w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">{isEdit ? 'Edit Task' : 'New Task'}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100"><X className="w-4 h-4 text-gray-400" /></button>
        </div>
        <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))}
          placeholder="Task title *" className={ic} />
        <textarea value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
          placeholder="Description (optional)" rows={2} className={`${ic} resize-none`} />
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
            <Select value={form.status} onChange={v => setForm(f => ({ ...f, status: v ?? 'TODO' }))}
              options={['TODO','IN_PROGRESS','IN_REVIEW','COMPLETED','CANCELLED'].map(s => ({ value: s, label: s.replace(/_/g,' ') }))}
              placeholder="Select status…"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Priority</label>
            <Select value={form.priority} onChange={v => setForm(f => ({ ...f, priority: v ?? 'MEDIUM' }))}
              options={['LOW','MEDIUM','HIGH','URGENT'].map(p => ({ value: p, label: p }))}
              placeholder="Select priority…"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Assigned To</label>
            <Select value={form.assignedTo} onChange={v => setForm(f => ({ ...f, assignedTo: v ?? '' }))}
              options={members.map(m => ({ value: m.id, label: m.name }))}
              placeholder="Unassigned"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Due Date</label>
            <DatePicker value={form.dueDate || null} onChange={v => setForm(f => ({ ...f, dueDate: v ?? '' }))} />
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-40 flex items-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} {isEdit ? 'Update' : 'Create'} Task
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── ExpenseModal ─────────────────────────────────────────────────────────────

function ExpenseModal({ projectId, onClose, onSaved }) {
  const [form, setForm] = useState({
    title: '', amount: '', category: EXPENSE_CATEGORIES[0],
    date: new Date().toISOString().slice(0,10), notes: '', invoiceUrl: '',
  })
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!form.title || !form.amount) { toast.error('Title and amount required'); return }
    setSaving(true)
    try {
      const res  = await fetch(`/api/projects/${projectId}/expenses`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, amount: Number(form.amount), invoiceUrl: form.invoiceUrl || null }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Expense submitted')
      onSaved(); onClose()
    } catch (err) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  const ic = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl border border-gray-200 w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">Add Expense</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100"><X className="w-4 h-4 text-gray-400" /></button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">Title *</label>
            <input value={form.title} onChange={e => setForm(f => ({ ...f, title: e.target.value }))} placeholder="Expense title" className={ic} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Amount (৳) *</label>
            <input type="number" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" className={ic} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Date</label>
            <DatePicker value={form.date || null} onChange={v => setForm(f => ({ ...f, date: v ?? '' }))} />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
            <Select value={form.category} onChange={v => setForm(f => ({ ...f, category: v ?? EXPENSE_CATEGORIES[0] }))}
              options={EXPENSE_CATEGORIES.map(c => ({ value: c, label: c }))}
              placeholder="Select category…"
            />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} rows={2} className={`${ic} resize-none`} />
          </div>
          <div className="col-span-2">
            <FileUpload label="Invoice / Receipt" value={form.invoiceUrl} onUploaded={url => setForm(f => ({ ...f, invoiceUrl: url }))} />
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-40 flex items-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Submit Expense
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── PaymentModal ─────────────────────────────────────────────────────────────

function PaymentModal({ projectId, onClose, onSaved }) {
  const [form, setForm] = useState({
    amount: '', paymentMethod: 'BANK_TRANSFER',
    paymentDate: new Date().toISOString().slice(0, 10),
    description: '', notes: '', receiptUrl: '',
  })
  const [saving, setSaving] = useState(false)

  async function save() {
    if (!form.amount || Number(form.amount) <= 0) { toast.error('Amount required'); return }
    if (!form.receiptUrl) { toast.error('Payment proof required'); return }
    setSaving(true)
    try {
      const res  = await fetch(`/api/projects/${projectId}/payments`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, amount: Number(form.amount), currency: 'BDT' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Payment recorded — pending confirmation in Accounts')
      onSaved(); onClose()
    } catch (err) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  const ic = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900'
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl border border-gray-200 w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">Record Payment</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100"><X className="w-4 h-4 text-gray-400" /></button>
        </div>
        <p className="text-xs text-gray-400 border border-gray-100 rounded-lg px-3 py-2">
          Payment will be sent to Accounts for confirmation before being added to income.
        </p>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Amount (৳) *</label>
            <input type="number" step="0.01" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} placeholder="0.00" className={ic} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Method</label>
            <Select value={form.paymentMethod} onChange={v => setForm(f => ({ ...f, paymentMethod: v ?? 'BANK_TRANSFER' }))}
              options={PAYMENT_METHODS.map(m => ({ value: m, label: m.replace(/_/g,' ') }))}
              placeholder="Select method…"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Payment Date</label>
            <DatePicker value={form.paymentDate || null} onChange={v => setForm(f => ({ ...f, paymentDate: v ?? '' }))} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Description</label>
            <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Invoice ref, note…" className={ic} />
          </div>
          <div className="col-span-2">
            <FileUpload label="Payment Proof / Receipt *" value={form.receiptUrl} onUploaded={url => setForm(f => ({ ...f, receiptUrl: url }))} />
          </div>
        </div>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-40 flex items-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            <CreditCard className="w-4 h-4" /> Record Payment
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

const ALL_TABS = ['overview', 'brief', 'discussion', 'tasks', 'expenses', 'payments', 'renewals', 'freelancers']
const FINANCIAL_TABS = new Set(['expenses', 'payments'])
const TAB_LABELS = { overview: 'Overview', brief: 'Brief', discussion: 'Discussion', tasks: 'Tasks', expenses: 'Expenses', payments: 'Payments', renewals: 'Renewals', freelancers: 'Freelancers' }

export default function ProjectDetailPage() {
  const { id }  = useParams()
  const router  = useRouter()
  const { data: session } = useSession()
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
  const [freelancerAssignments, setFreelancerAssignments] = useState([])
  const [assignModal,         setAssignModal]         = useState(false)
  const [assignForm,          setAssignForm]          = useState({ freelancerId: '', paymentAmount: '', paymentNotes: '' })
  const [freelancerList,      setFreelancerList]      = useState([])
  const [assignSaving,        setAssignSaving]        = useState(false)
  const [approvingAssign,     setApprovingAssign]     = useState(null)
  const [processingExpense,   setProcessingExpense]   = useState(null)

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

  useEffect(() => {
    if (tab === 'payments')    loadPayments()
  }, [tab, loadPayments])

  useEffect(() => {
    if (tab === 'freelancers') {
      loadFreelancerAssignments()
      fetch('/api/freelancers?limit=200').then(r => r.json()).then(j => setFreelancerList(j.data ?? []))
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
    if (!assignForm.freelancerId || !assignForm.paymentAmount) {
      toast.error('Freelancer and payment amount are required')
      return
    }
    setAssignSaving(true)
    try {
      const res  = await fetch('/api/freelancer-assignments', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ projectId: id, ...assignForm, paymentAmount: Number(assignForm.paymentAmount) }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Freelancer assigned!')
      setAssignModal(false)
      setAssignForm({ freelancerId: '', paymentAmount: '', paymentNotes: '' })
      loadFreelancerAssignments()
    } catch (err) { toast.error(err.message) }
    finally { setAssignSaving(false) }
  }

  async function handleApproveAssignment(assignmentId) {
    setApprovingAssign(assignmentId)
    try {
      const res  = await fetch(`/api/freelancer-assignments/${assignmentId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'approve' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Payment approved — moved to freelancer wallet')
      loadFreelancerAssignments()
    } catch (err) { toast.error(err.message) }
    finally { setApprovingAssign(null) }
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

  async function handleExpenseAction(expenseId, action) {
    setProcessingExpense(expenseId)
    try {
      const res  = await fetch(`/api/projects/${id}/expenses/${expenseId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success(action === 'approve' ? 'Expense approved' : 'Expense rejected')
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
    if (!confirm(`Delete "${project?.name}"? This cannot be undone.`)) return
    try {
      const res = await fetch(`/api/projects/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Project deleted')
      router.push('/admin/projects')
    } catch (err) { toast.error(err.message) }
  }

  if (loading) return (
    <div className="flex justify-center py-20">
      <div className="w-6 h-6 border-2 border-gray-300 border-t-gray-700 rounded-full animate-spin" />
    </div>
  )
  if (!project) return (
    <div className="text-center py-20">
      <p className="text-gray-500">Project not found.</p>
      <Link href="/admin/projects" className="text-gray-700 text-sm mt-2 inline-block underline">Back to projects</Link>
    </div>
  )

  const TABS        = canViewFinancials ? ALL_TABS : ALL_TABS.filter(t => !FINANCIAL_TABS.has(t))
  const paidAmount  = project.paidAmount ?? 0
  const dueAmount   = project.dueAmount  ?? Math.max(0, (project.budget ?? 0) - (project.discount ?? 0) - paidAmount)
  const profit      = paidAmount - (project.approvedExpenses ?? 0)
  const utilization = project.budget > 0 ? Math.round(((project.approvedExpenses ?? 0) / project.budget) * 100) : 0
  const vm          = VENTURE_META[project.venture] ?? {}
  const vc          = VENTURE_COLORS[project.venture] ?? VENTURE_COLORS.ENTECH
  const doneTasks   = project.tasks?.filter(t => t.status === 'COMPLETED').length ?? 0
  const totalTasks  = project.tasks?.length ?? 0
  const taskPct     = totalTasks > 0 ? Math.round((doneTasks / totalTasks) * 100) : 0
  const isOverdue   = project.deadline && new Date(project.deadline) < new Date() && !['DELIVERED','CANCELLED','APPROVED'].includes(project.status)

  return (
    <div className="space-y-5 pb-10">

      {/* Page Header */}
      <div>
        <div className="flex items-center gap-2 mb-4">
          <Link href="/admin/projects" className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <span className="text-gray-300">/</span>
          <span className="text-sm text-gray-400">Projects</span>
        </div>

        <div className="flex items-start justify-between gap-4 flex-wrap">
          <div>
            {project.projectCode && (
              <p className="font-mono text-sm text-gray-400 mb-1">{project.projectCode}</p>
            )}
            <h1 className="text-2xl font-semibold text-gray-900">{project.name}</h1>
            <div className="flex items-center gap-3 mt-2 flex-wrap">
              <div className="flex items-center gap-1.5">
                <span className={`w-2 h-2 rounded-full shrink-0 ${STATUS_DOT[project.status] ?? 'bg-gray-400'}`} />
                <span className="text-sm text-gray-500">{STATUS_META[project.status]?.label ?? project.status}</span>
              </div>
              <span className="text-gray-200">·</span>
              <span className="text-sm text-gray-400">{vm.label ?? project.venture}</span>
              <span className="text-gray-200">·</span>
              <span className="text-sm text-gray-400">{project.projectType === 'MONTHLY' ? 'Monthly Retainer' : 'Fixed Project'}</span>
              {isOverdue && (
                <span className="text-red-500 text-sm">· Overdue since {fmtDate(project.deadline)}</span>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2 shrink-0 flex-wrap">
            <Link href={`/admin/projects/${id}/edit`}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors">
              <Pencil className="w-3.5 h-3.5" /> Edit
            </Link>
            <button onClick={() => setStatusModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors">
              Change Status
            </button>
            {canViewFinancials && (
              <Link href={`/admin/invoices/new?projectId=${id}&clientId=${project.clientId?.id ?? project.clientId?._id ?? project.clientId ?? ''}`}
                className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-lg text-gray-600 hover:bg-gray-50 transition-colors">
                <FileText className="w-3.5 h-3.5" /> Create Invoice
              </Link>
            )}
            <button onClick={handleDelete}
              className="p-1.5 rounded-lg border border-gray-200 text-gray-400 hover:text-red-500 hover:border-red-200 transition-colors">
              <Trash2 className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Stats row */}
        <div className="flex items-center gap-8 mt-5 pb-5 border-b border-gray-100 flex-wrap">
          {[
            ...(canViewFinancials ? [
              { label: 'Budget',   value: fmt(project.budget) },
              { label: 'Paid',     value: fmt(paidAmount),  colored: true, positive: true },
              { label: 'Due',      value: fmt(dueAmount),   colored: dueAmount > 0, positive: false },
              { label: 'Expenses', value: fmt(project.approvedExpenses) },
              { label: 'Profit',   value: fmt(profit), colored: true, positive: profit >= 0 },
            ] : []),
            { label: `Tasks`, value: `${doneTasks} / ${totalTasks}` },
          ].map(({ label, value, colored, positive }) => (
            <div key={label}>
              <p className={`text-lg font-semibold ${colored ? (positive ? 'text-green-600' : 'text-red-500') : 'text-gray-900'}`}>{value}</p>
              <p className="text-xs text-gray-400 mt-0.5">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Tab Nav */}
      <div className="flex gap-0 border-b border-gray-100">
        {TABS.map(t => (
          <button key={t} onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-sm font-medium transition-all -mb-px ${
              tab === t
                ? 'border-b-2 border-gray-900 text-gray-900'
                : 'text-gray-400 hover:text-gray-600 border-b-2 border-transparent'
            }`}>
            {TAB_LABELS[t]}
            {t === 'tasks' && totalTasks > 0 && (
              <span className="ml-1.5 text-xs text-gray-400">{totalTasks}</span>
            )}
          </button>
        ))}
      </div>

      {/* ── OVERVIEW ── */}
      {tab === 'overview' && (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
          {/* Details card */}
          <div className="lg:col-span-2 bg-white border border-gray-100 rounded-xl p-6">
            <h3 className="text-sm font-medium text-gray-500 mb-5 flex items-center gap-2">
              <FileText className="w-4 h-4" /> Project Details
            </h3>

            {/* Progress bars */}
            {((canViewFinancials && project.budget > 0) || totalTasks > 0) && (
              <div className="space-y-3 mb-6 pb-6 border-b border-gray-100">
                {canViewFinancials && project.budget > 0 && (
                  <div>
                    <div className="flex justify-between text-xs text-gray-400 mb-1.5">
                      <span>Budget used</span>
                      <span>{utilization}%</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1">
                      <div className={`h-1 rounded-full transition-all ${utilization > 90 ? 'bg-red-400' : utilization > 70 ? 'bg-yellow-400' : 'bg-gray-400'}`}
                        style={{ width: `${Math.min(utilization, 100)}%` }} />
                    </div>
                  </div>
                )}
                {totalTasks > 0 && (
                  <div>
                    <div className="flex justify-between text-xs text-gray-400 mb-1.5">
                      <span>Task completion</span>
                      <span>{taskPct}%</span>
                    </div>
                    <div className="w-full bg-gray-100 rounded-full h-1">
                      <div className="h-1 rounded-full bg-gray-400 transition-all" style={{ width: `${taskPct}%` }} />
                    </div>
                  </div>
                )}
              </div>
            )}

            <dl className="grid grid-cols-2 gap-x-8 gap-y-4">
              {[
                { label: 'Client',       value: project.clientId?.userId?.name ?? '—' },
                { label: 'Company',      value: project.clientId?.company ?? '—' },
                { label: 'Manager',      value: project.projectManagerId?.name ?? '—' },
                { label: 'Priority',     value: <span className="text-xs text-gray-500">{project.priority}</span> },
                { label: 'Order Date',   value: fmtDate(project.orderDate) },
                { label: 'Start Date',   value: fmtDate(project.startDate) },
                ...(project.projectType === 'FIXED' ? [
                  { label: 'Deadline',   value: <span className={isOverdue ? 'text-red-500' : ''}>{fmtDate(project.deadline)}</span> },
                ] : [
                  { label: 'Period Start', value: fmtDate(project.currentPeriodStart) },
                  { label: 'Period End',   value: fmtDate(project.currentPeriodEnd) },
                  { label: 'Next Billing', value: fmtDate(project.nextBillingDate) },
                ]),
                { label: 'Currency',   value: 'BDT' },
                ...(canViewFinancials ? [
                  { label: 'Budget',   value: fmt(project.budget) },
                  { label: 'Discount', value: fmt(project.discount) },
                  { label: 'Paid',     value: <span className="text-green-600">{fmt(paidAmount)}</span> },
                  { label: 'Due',      value: <span className={dueAmount > 0 ? 'text-red-500' : 'text-gray-600'}>{fmt(dueAmount)}</span> },
                  { label: 'Expenses', value: fmt(project.approvedExpenses) },
                  { label: 'Profit',   value: <span className={profit >= 0 ? 'text-green-600' : 'text-red-500'}>{fmt(profit)}</span> },
                ] : []),
              ].map(({ label, value }) => (
                <div key={label} className="flex flex-col gap-0.5">
                  <dt className="text-xs text-gray-400">{label}</dt>
                  <dd className="text-sm text-gray-900">{value ?? '—'}</dd>
                </div>
              ))}
            </dl>

            {project.description && (
              <>
                <div className="border-t border-gray-100 my-5" />
                <h4 className="text-xs text-gray-400 uppercase tracking-wide mb-2">Description</h4>
                <p className="text-sm text-gray-600 leading-relaxed whitespace-pre-wrap">{project.description}</p>
              </>
            )}

            {project.tags && (
              <div className="border-t border-gray-100 mt-5 pt-4 flex items-center gap-2 flex-wrap">
                <Tag className="w-3.5 h-3.5 text-gray-300" />
                {project.tags.split(',').map(t => (
                  <span key={t.trim()} className="px-2 py-0.5 border border-gray-200 text-gray-500 text-xs rounded-full">{t.trim()}</span>
                ))}
              </div>
            )}
          </div>

          {/* Team + Quick Actions */}
          <div className="space-y-4">
            {/* Team */}
            {(project.teamMembers?.length > 0 || project.projectManagerId) && (
              <div className="bg-white border border-gray-100 rounded-xl p-5">
                <h3 className="text-sm font-medium text-gray-500 mb-4 flex items-center gap-2">
                  <Users className="w-4 h-4" /> Team
                </h3>
                <div className="space-y-3">
                  {project.projectManagerId && (
                    <div className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-xs font-medium text-gray-600 shrink-0">
                        {project.projectManagerId.name?.[0]?.toUpperCase()}
                      </div>
                      <div>
                        <p className="text-sm text-gray-800">{project.projectManagerId.name}</p>
                        <p className="text-xs text-gray-400">Project Manager</p>
                      </div>
                    </div>
                  )}
                  {project.teamMembers?.map(m => (
                    <div key={m.id ?? m._id ?? m} className="flex items-center gap-2.5">
                      <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-xs font-medium text-gray-500 shrink-0">
                        {m.name?.[0]?.toUpperCase() ?? '?'}
                      </div>
                      <p className="text-sm text-gray-700">{m.name}</p>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Quick Actions */}
            <div className="bg-white border border-gray-100 rounded-xl p-5">
              <h3 className="text-sm font-medium text-gray-500 mb-3">Quick Actions</h3>
              <div className="space-y-1">
                <button onClick={() => { setTab('tasks'); setTaskModal(true) }}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors text-left">
                  <Plus className="w-4 h-4 text-gray-400" /> Add Task
                </button>
                {canViewFinancials && (<>
                  <button onClick={() => { setTab('expenses'); setExpenseModal(true) }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors text-left">
                    <TrendingDown className="w-4 h-4 text-gray-400" /> Submit Expense
                  </button>
                  <button onClick={() => { setTab('payments'); setPaymentModal(true) }}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors text-left">
                    <CreditCard className="w-4 h-4 text-gray-400" /> Record Payment
                  </button>
                  <Link href={`/admin/invoices/new?projectId=${id}&clientId=${project.clientId?.id ?? project.clientId?._id ?? project.clientId ?? ''}`}
                    className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-sm text-gray-600 hover:bg-gray-50 hover:text-gray-900 transition-colors">
                    <FileText className="w-4 h-4 text-gray-400" /> Create Invoice
                  </Link>
                </>)}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── TASKS ── */}
      {tab === 'tasks' && (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <div>
              <h3 className="text-sm font-medium text-gray-900">Tasks</h3>
              <p className="text-xs text-gray-400 mt-0.5">{doneTasks} of {totalTasks} completed</p>
            </div>
            <button onClick={() => { setEditingTask(null); setTaskModal(true) }}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-600 text-xs font-medium rounded-lg hover:bg-gray-50 transition-colors">
              <Plus className="w-3.5 h-3.5" /> Add Task
            </button>
          </div>

          {totalTasks > 0 && (
            <div className="px-6 py-3 border-b border-gray-100">
              <div className="flex items-center gap-3">
                <div className="flex-1 bg-gray-100 rounded-full h-1">
                  <div className="h-1 rounded-full bg-gray-400 transition-all" style={{ width: `${taskPct}%` }} />
                </div>
                <span className="text-xs text-gray-400 shrink-0">{taskPct}%</span>
              </div>
            </div>
          )}

          {totalTasks === 0 ? (
            <div className="py-16 text-center">
              <Circle className="w-8 h-8 text-gray-200 mx-auto mb-3" />
              <p className="text-gray-400 text-sm">No tasks yet</p>
              <button onClick={() => setTaskModal(true)}
                className="mt-3 text-gray-500 text-sm hover:text-gray-700 underline">Create the first task</button>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {project.tasks.map(t => {
                const isDone = t.status === 'COMPLETED'
                return (
                  <div key={t.id ?? t._id} className="flex items-start gap-4 px-6 py-4 hover:bg-gray-50/50 group transition-colors">
                    <button onClick={() => handleToggleTask(t)} className="mt-0.5 shrink-0">
                      {isDone
                        ? <CheckCircle2 className="w-5 h-5 text-gray-400" />
                        : <Circle className="w-5 h-5 text-gray-200 group-hover:text-gray-300 transition-colors" />
                      }
                    </button>
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-3 flex-wrap">
                        <p className={`text-sm ${isDone ? 'line-through text-gray-400' : 'text-gray-900'}`}>
                          {t.title}
                        </p>
                        <div className="flex items-center gap-1.5">
                          <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${TASK_STATUS_DOT[t.status] ?? 'bg-gray-400'}`} />
                          <span className="text-xs text-gray-400">{t.status.replace('_',' ')}</span>
                        </div>
                        {t.priority && t.priority !== 'MEDIUM' && (
                          <span className="text-xs text-gray-400">{t.priority}</span>
                        )}
                      </div>
                      {t.description && <p className="text-xs text-gray-400 mt-0.5 truncate">{t.description}</p>}
                      {t.dueDate && (
                        <div className="flex items-center gap-1 mt-1.5">
                          <Calendar className="w-3 h-3 text-gray-300" />
                          <span className={`text-xs ${new Date(t.dueDate) < new Date() && !isDone ? 'text-red-500' : 'text-gray-400'}`}>
                            {fmtDate(t.dueDate)}
                          </span>
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                      <button onClick={() => { setEditingTask(t); setTaskModal(true) }}
                        className="p-1.5 rounded-lg text-gray-300 hover:text-gray-600 hover:bg-gray-100 transition-colors">
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button onClick={() => handleDeleteTask(t.id ?? t._id)}
                        className="p-1.5 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
        </div>
      )}

      {/* ── EXPENSES ── */}
      {tab === 'expenses' && (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-900">Expenses ({project.expenses?.length ?? 0})</h3>
            <button onClick={() => setExpenseModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-600 text-xs font-medium rounded-lg hover:bg-gray-50 transition-colors">
              <Plus className="w-3.5 h-3.5" /> Add Expense
            </button>
          </div>
          {(project.expenses?.length ?? 0) === 0 ? (
            <div className="py-16 text-center text-gray-400 text-sm">No expenses yet</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  {['Title','Category','Amount','Date','Status',''].map(h => (
                    <th key={h} className="px-5 py-3 text-left text-xs text-gray-400 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {project.expenses.map(e => (
                  <tr key={e.id ?? e._id} className="hover:bg-gray-50/50">
                    <td className="px-5 py-3 text-sm text-gray-800">{e.title}</td>
                    <td className="px-5 py-3 text-sm text-gray-400">{e.category}</td>
                    <td className="px-5 py-3 text-sm text-gray-900">BDT {Number(e.amount).toLocaleString()}</td>
                    <td className="px-5 py-3 text-sm text-gray-400">{fmtDate(e.date)}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          e.status === 'APPROVED' ? 'bg-green-500' :
                          e.status === 'REJECTED' ? 'bg-red-500' :
                          'bg-yellow-400'
                        }`} />
                        <span className="text-xs text-gray-500">{e.status}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        {e.invoiceUrl && <DocPreview url={e.invoiceUrl} compact />}
                        {e.status === 'PENDING' && (
                          <>
                            <button onClick={() => handleExpenseAction(e.id ?? e._id, 'approve')}
                              disabled={processingExpense === (e.id ?? e._id)}
                              className="px-2 py-0.5 text-xs font-medium text-white bg-green-600 rounded hover:bg-green-700 disabled:opacity-50">
                              Approve
                            </button>
                            <button onClick={() => handleExpenseAction(e.id ?? e._id, 'reject')}
                              disabled={processingExpense === (e.id ?? e._id)}
                              className="px-2 py-0.5 text-xs font-medium text-red-600 border border-red-200 rounded hover:bg-red-50 disabled:opacity-50">
                              Reject
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── PAYMENTS ── */}
      {tab === 'payments' && (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
            <h3 className="text-sm font-medium text-gray-900">Payments ({payments.length})</h3>
            <button onClick={() => setPaymentModal(true)}
              className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-600 text-xs font-medium rounded-lg hover:bg-gray-50 transition-colors">
              <Plus className="w-3.5 h-3.5" /> Record Payment
            </button>
          </div>
          {!paymentsLoaded ? (
            <div className="py-10 flex justify-center">
              <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-500 rounded-full animate-spin" />
            </div>
          ) : payments.length === 0 ? (
            <div className="py-16 text-center text-gray-400 text-sm">No payments recorded yet</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  {['Description','Amount','Method','Date','Status','Proof'].map(h => (
                    <th key={h} className="px-5 py-3 text-left text-xs text-gray-400 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {payments.map(p => (
                  <tr key={p.id} className="hover:bg-gray-50/50">
                    <td className="px-5 py-3 text-sm text-gray-800">{p.description || '—'}</td>
                    <td className="px-5 py-3 text-sm text-gray-900">BDT {Number(p.amount).toLocaleString()}</td>
                    <td className="px-5 py-3 text-sm text-gray-400">{p.paymentMethod?.replace('_',' ')}</td>
                    <td className="px-5 py-3 text-sm text-gray-400">{fmtDate(p.paymentDate)}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${
                          p.status === 'CONFIRMED' ? 'bg-green-500' :
                          p.status === 'REJECTED'  ? 'bg-red-500'   :
                          'bg-yellow-400'
                        }`} />
                        <span className="text-xs text-gray-500">
                          {p.status === 'PENDING_CONFIRMATION' ? 'Pending' : p.status === 'CONFIRMED' ? 'Confirmed' : 'Rejected'}
                        </span>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      {p.receiptUrl ? <DocPreview url={p.receiptUrl} compact /> : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {payments.some(p => p.status === 'PENDING_CONFIRMATION') && (
            <div className="px-6 py-3 border-t border-gray-100">
              <p className="text-xs text-gray-400">Pending payments are awaiting confirmation in <strong className="text-gray-600">Accounts → Payment Confirmations</strong>.</p>
            </div>
          )}
        </div>
      )}

      {/* ── RENEWALS ── */}
      {tab === 'renewals' && (
        <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-gray-100">
            <h3 className="text-sm font-medium text-gray-900">Renewal History ({project.renewals?.length ?? 0})</h3>
          </div>
          {(project.renewals?.length ?? 0) === 0 ? (
            <div className="py-16 text-center text-gray-400 text-sm">No renewal history</div>
          ) : (
            <table className="w-full">
              <thead>
                <tr className="border-b border-gray-100">
                  {['Period','Amount','Status','Notes'].map(h => (
                    <th key={h} className="px-5 py-3 text-left text-xs text-gray-400 font-medium">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {project.renewals.map(r => (
                  <tr key={r.id ?? r._id} className="hover:bg-gray-50/50">
                    <td className="px-5 py-3 text-sm text-gray-700">{fmtDate(r.periodStart)} – {fmtDate(r.periodEnd)}</td>
                    <td className="px-5 py-3 text-sm text-gray-900">BDT {Number(r.billingAmount).toLocaleString()}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-1.5">
                        <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" />
                        <span className="text-xs text-gray-500">{r.status}</span>
                      </div>
                    </td>
                    <td className="px-5 py-3 text-sm text-gray-400">{r.notes ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* ── FREELANCERS ── */}
      {tab === 'freelancers' && (() => {
        const ASSIGN_STATUS_COLORS = {
          ASSIGNED: 'bg-blue-100 text-blue-700', ACCEPTED: 'bg-teal-100 text-teal-700',
          IN_PROGRESS: 'bg-purple-100 text-purple-700', COMPLETED: 'bg-green-100 text-green-700', CANCELLED: 'bg-red-100 text-red-600',
        }
        const PAY_STATUS_COLORS = {
          PENDING: 'bg-yellow-100 text-yellow-700', IN_WALLET: 'bg-green-100 text-green-700',
          WITHDRAWAL_REQUESTED: 'bg-blue-100 text-blue-700', PAID: 'bg-gray-100 text-gray-600',
        }
        const ic = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900'

        return (
          <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-gray-100 flex items-center justify-between">
              <div>
                <h3 className="text-sm font-medium text-gray-900">Freelancer Assignments</h3>
                <p className="text-xs text-gray-400 mt-0.5">{freelancerAssignments.length} assignment{freelancerAssignments.length !== 1 ? 's' : ''}</p>
              </div>
              <button onClick={() => setAssignModal(true)}
                className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-200 text-gray-600 text-xs font-medium rounded-lg hover:bg-gray-50 transition-colors">
                <Plus className="w-3.5 h-3.5" /> Assign Freelancer
              </button>
            </div>

            {freelancerAssignments.length === 0 ? (
              <div className="py-16 text-center text-gray-400 text-sm">No freelancers assigned to this project yet</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px]">
                  <thead>
                    <tr className="border-b border-gray-100">
                      {['Freelancer', 'Payment ৳', 'Status', 'Payment Status', 'Action'].map(h => (
                        <th key={h} className="px-5 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {freelancerAssignments.map(a => {
                      const name   = a.freelancerId?.userId?.name ?? 'Unknown'
                      const email  = a.freelancerId?.userId?.email ?? ''
                      const avatar = a.freelancerId?.userId?.avatar
                      const aId    = a.id ?? a._id
                      return (
                        <tr key={aId} className="hover:bg-gray-50/50 transition-colors">
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-2.5">
                              {avatar ? (
                                <Image src={avatar} alt="" width={28} height={28} className="w-7 h-7 rounded-full object-cover shrink-0" />
                              ) : (
                                <div className="w-7 h-7 rounded-full bg-gray-100 flex items-center justify-center text-xs font-medium text-gray-600 shrink-0">
                                  {name[0]?.toUpperCase()}
                                </div>
                              )}
                              <div>
                                <p className="text-sm font-medium text-gray-900">{name}</p>
                                {email && <p className="text-xs text-gray-400">{email}</p>}
                              </div>
                            </div>
                          </td>
                          <td className="px-5 py-3.5 text-sm font-medium text-gray-900">
                            ৳{(a.paymentAmount ?? 0).toLocaleString('en-BD', { minimumFractionDigits: 2 })}
                          </td>
                          <td className="px-5 py-3.5">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${ASSIGN_STATUS_COLORS[a.status] ?? 'bg-gray-100 text-gray-600'}`}>
                              {a.status?.replace('_', ' ')}
                            </span>
                          </td>
                          <td className="px-5 py-3.5">
                            <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${PAY_STATUS_COLORS[a.paymentStatus] ?? 'bg-gray-100 text-gray-600'}`}>
                              {a.paymentStatus?.replace('_', ' ') ?? 'PENDING'}
                            </span>
                          </td>
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-2">
                              {a.status === 'IN_PROGRESS' && (
                                <button
                                  onClick={() => handleCompleteAssignment(aId)}
                                  className="flex items-center gap-1 px-2.5 py-1 bg-teal-600 text-white text-xs font-medium rounded-lg hover:bg-teal-700 transition-colors"
                                >
                                  <CheckCircle2 className="w-3 h-3" /> Mark Complete
                                </button>
                              )}
                              {a.status === 'COMPLETED' && a.paymentStatus === 'PENDING' && (
                                <button
                                  onClick={() => handleApproveAssignment(aId)}
                                  disabled={approvingAssign === aId}
                                  className="flex items-center gap-1 px-2.5 py-1 bg-green-600 text-white text-xs font-medium rounded-lg hover:bg-green-700 disabled:opacity-50 transition-colors"
                                >
                                  {approvingAssign === aId && <Loader2 className="w-3 h-3 animate-spin" />}
                                  Approve Payment
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {/* Assign Freelancer Modal */}
            {assignModal && (
              <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
                <div className="bg-white rounded-xl border border-gray-200 w-full max-w-md p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h3 className="text-base font-semibold text-gray-900">Assign Freelancer</h3>
                    <button onClick={() => setAssignModal(false)} className="p-1 rounded-lg hover:bg-gray-100">
                      <X className="w-4 h-4 text-gray-400" />
                    </button>
                  </div>
                  <form onSubmit={handleAssignFreelancer} className="space-y-4">
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Freelancer <span className="text-red-500">*</span></label>
                      <Select value={assignForm.freelancerId}
                        onChange={v => setAssignForm(f => ({ ...f, freelancerId: v ?? '' }))}
                        options={freelancerList.map(f => ({ value: f.id ?? f._id, label: `${f.userId?.name ?? f.id}${f.userId?.email ? ` — ${f.userId.email}` : ''}` }))}
                        placeholder="Select freelancer…"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Payment Amount (৳) <span className="text-red-500">*</span></label>
                      <input type="number" step="0.01" min="1"
                        value={assignForm.paymentAmount}
                        onChange={e => setAssignForm(f => ({ ...f, paymentAmount: e.target.value }))}
                        placeholder="0.00" className={ic} required />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-gray-500 mb-1">Payment Notes</label>
                      <textarea value={assignForm.paymentNotes}
                        onChange={e => setAssignForm(f => ({ ...f, paymentNotes: e.target.value }))}
                        rows={2} placeholder="Additional notes…" className={`${ic} resize-none`} />
                    </div>
                    <div className="flex gap-2 justify-end pt-1">
                      <button type="button" onClick={() => setAssignModal(false)}
                        className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
                      <button type="submit" disabled={assignSaving}
                        className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-40 flex items-center gap-2">
                        {assignSaving && <Loader2 className="w-4 h-4 animate-spin" />} Assign
                      </button>
                    </div>
                  </form>
                </div>
              </div>
            )}
          </div>
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
            <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
                <div className="flex items-center gap-2">
                  <BookOpen className="w-4 h-4 text-gray-400" />
                  <h3 className="text-sm font-semibold text-gray-800">Project Brief</h3>
                </div>
                {canEditBrief && !briefEditing && (
                  <button
                    onClick={() => { setBriefDraft(brief ?? ''); setBriefEditing(true) }}
                    className="flex items-center gap-1.5 text-xs text-gray-500 hover:text-gray-900 px-2.5 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
                  >
                    <Pencil className="w-3.5 h-3.5" />
                    {brief ? 'Edit' : 'Add Brief'}
                  </button>
                )}
              </div>

              {/* Content */}
              <div className="px-6 py-5">
                {briefEditing ? (
                  <div className="space-y-3">
                    <textarea
                      value={briefDraft}
                      onChange={e => setBriefDraft(e.target.value)}
                      rows={12}
                      placeholder="Write the project brief here — scope, objectives, deliverables, special instructions…"
                      className="w-full text-sm text-gray-800 border border-gray-200 rounded-lg px-3.5 py-3 resize-y focus:outline-none focus:ring-2 focus:ring-gray-900/10 leading-relaxed"
                      autoFocus
                    />
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={() => setBriefEditing(false)}
                        className="px-3.5 py-1.5 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={handleSaveBrief}
                        disabled={briefSaving}
                        className="flex items-center gap-1.5 px-3.5 py-1.5 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-40 transition-colors"
                      >
                        {briefSaving && <Loader2 className="w-3.5 h-3.5 animate-spin" />}
                        Save Brief
                      </button>
                    </div>
                  </div>
                ) : !briefLoaded ? (
                  <div className="flex justify-center py-10">
                    <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />
                  </div>
                ) : brief ? (
                  <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{brief}</p>
                ) : (
                  <div className="flex flex-col items-center justify-center py-12 text-gray-400 gap-2">
                    <BookOpen className="w-8 h-8 opacity-30" />
                    <p className="text-sm">No brief has been written yet.</p>
                    {canEditBrief && (
                      <button
                        onClick={() => { setBriefDraft(''); setBriefEditing(true) }}
                        className="mt-1 text-sm text-gray-600 underline underline-offset-2 hover:text-gray-900"
                      >
                        Write the brief
                      </button>
                    )}
                  </div>
                )}
              </div>

              {/* Footer: last edited */}
              {!briefEditing && briefMeta?.briefUpdatedAt && (
                <div className="px-6 py-3 border-t border-gray-50 flex items-center gap-1.5 text-xs text-gray-400">
                  <Clock className="w-3 h-3" />
                  Last updated {fmtBriefDate(briefMeta.briefUpdatedAt)}
                  {briefMeta.briefUpdatedBy?.name && ` by ${briefMeta.briefUpdatedBy.name}`}
                </div>
              )}
            </div>
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
        const ROLE_DOT = {
          SUPER_ADMIN: 'bg-violet-500', MANAGER: 'bg-blue-500',
          EMPLOYEE: 'bg-emerald-500', FREELANCER: 'bg-orange-500',
          CLIENT: 'bg-cyan-500', VENDOR: 'bg-slate-400',
        }

        return (
          <div className="max-w-3xl flex flex-col gap-0 bg-white border border-gray-100 rounded-xl overflow-hidden" style={{ height: '70vh' }}>
            {/* Header */}
            <div className="flex items-center gap-2 px-5 py-3.5 border-b border-gray-100 shrink-0">
              <MessageSquare className="w-4 h-4 text-gray-400" />
              <h3 className="text-sm font-semibold text-gray-800">Discussion</h3>
              {messages.length > 0 && (
                <span className="ml-1 text-xs text-gray-400">{messages.length} message{messages.length !== 1 ? 's' : ''}</span>
              )}
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
              {!discussionLoaded ? (
                <div className="flex justify-center py-10">
                  <div className="w-5 h-5 border-2 border-gray-200 border-t-gray-600 rounded-full animate-spin" />
                </div>
              ) : messages.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-full gap-2 text-gray-400 py-10">
                  <MessageSquare className="w-8 h-8 opacity-30" />
                  <p className="text-sm">No messages yet. Start the conversation.</p>
                </div>
              ) : (
                messages.map(msg => {
                  const isOwn  = msg.user.id === uid
                  const canDel = isOwn || ['SUPER_ADMIN', 'MANAGER'].includes(session?.user?.role)
                  const dot    = ROLE_DOT[msg.user.role] ?? 'bg-gray-400'

                  return (
                    <div key={msg.id} className={`flex gap-3 group ${isOwn ? 'flex-row-reverse' : ''}`}>
                      {/* Avatar */}
                      <div className={`w-8 h-8 rounded-full shrink-0 flex items-center justify-center text-xs font-bold text-white ${dot}`}>
                        {msg.user.avatar
                          ? <Image src={msg.user.avatar} alt="" width={32} height={32} className="w-8 h-8 rounded-full object-cover" />
                          : msg.user.name.charAt(0).toUpperCase()
                        }
                      </div>

                      {/* Bubble */}
                      <div className={`flex flex-col gap-0.5 max-w-[75%] ${isOwn ? 'items-end' : 'items-start'}`}>
                        <div className="flex items-center gap-2">
                          <span className={`text-xs font-medium text-gray-500 ${isOwn ? 'order-last' : ''}`}>
                            {isOwn ? 'You' : msg.user.name}
                          </span>
                          <span className="text-xs text-gray-300">{fmtDateTime(msg.createdAt)}</span>
                        </div>
                        <div className={`flex items-start gap-1.5 ${isOwn ? 'flex-row-reverse' : ''}`}>
                          <div className={`px-3.5 py-2.5 rounded-2xl text-sm leading-relaxed whitespace-pre-wrap break-words ${
                            isOwn
                              ? 'bg-gray-900 text-white rounded-tr-sm'
                              : 'bg-gray-100 text-gray-800 rounded-tl-sm'
                          }`}>
                            {msg.content}
                          </div>
                          {canDel && (
                            <button
                              onClick={() => handleDeleteMessage(msg.id)}
                              disabled={deletingMsg === msg.id}
                              className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded-md text-gray-300 hover:text-red-400 hover:bg-red-50 shrink-0 mt-0.5"
                            >
                              {deletingMsg === msg.id
                                ? <Loader2 className="w-3 h-3 animate-spin" />
                                : <Trash2 className="w-3 h-3" />
                              }
                            </button>
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
                  <textarea
                    value={msgInput}
                    onChange={e => setMsgInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSendMessage(e) }
                    }}
                    placeholder="Write a message… (Enter to send, Shift+Enter for new line)"
                    rows={1}
                    className="flex-1 resize-none text-sm border border-gray-200 rounded-xl px-3.5 py-2.5 focus:outline-none focus:ring-2 focus:ring-gray-900/10 leading-relaxed"
                    style={{ maxHeight: '120px', overflowY: 'auto' }}
                  />
                  <button
                    type="submit"
                    disabled={!msgInput.trim() || msgSending}
                    className="p-2.5 rounded-xl bg-gray-900 text-white hover:bg-gray-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shrink-0"
                  >
                    {msgSending
                      ? <Loader2 className="w-4 h-4 animate-spin" />
                      : <Send className="w-4 h-4" />
                    }
                  </button>
                </form>
              ) : (
                <p className="text-xs text-gray-400 text-center py-1">Only project members can post in the discussion.</p>
              )}
            </div>
          </div>
        )
      })()}

      {/* ── Modals ── */}
      {statusModal && (
        <StatusModal project={project} onClose={() => setStatusModal(false)}
          onSaved={s => setProject(p => ({ ...p, status: s }))} />
      )}
      {expenseModal && (
        <ExpenseModal projectId={id} onClose={() => setExpenseModal(false)} onSaved={() => load()} />
      )}
      {paymentModal && (
        <PaymentModal projectId={id} onClose={() => setPaymentModal(false)}
          onSaved={() => { setPaymentsLoaded(false); loadPayments() }} />
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
