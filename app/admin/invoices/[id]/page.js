'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import {
  ArrowLeft, Pencil, Trash2, Send, CheckCircle2, Printer, Loader2,
  X, DollarSign, FileText, Clock, AlertTriangle, XCircle,
  PlusCircle, ExternalLink, CreditCard,
} from 'lucide-react'
import Image from 'next/image'
import FileUpload from '@/components/ui/FileUpload'
import TkAmt from '@/components/ui/TkAmt'
import Select from '@/components/ui/Select'
import DatePicker from '@/components/ui/DatePicker'

const fmt     = (n) => `৳ ${(n ?? 0).toLocaleString('en-BD', { minimumFractionDigits: 2 })}`
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const fmtDateInput = (d) => d ? new Date(d).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10)

const STATUS_STYLES = {
  DRAFT:          { badge: 'bg-gray-100 text-gray-600',     label: 'Draft' },
  SENT:           { badge: 'bg-blue-100 text-blue-700',     label: 'Sent' },
  PARTIALLY_PAID: { badge: 'bg-yellow-100 text-yellow-700', label: 'Partially Paid' },
  PAID:           { badge: 'bg-green-100 text-green-700',   label: 'Paid' },
  OVERDUE:        { badge: 'bg-red-100 text-red-600',       label: 'Overdue' },
  CANCELLED:      { badge: 'bg-gray-100 text-gray-500',     label: 'Cancelled' },
}

const PAYMENT_METHODS = ['BANK_TRANSFER', 'CASH', 'CARD', 'CHEQUE', 'ONLINE', 'OTHER']

const CONFIRMATION_STATUS = {
  PENDING_CONFIRMATION: { badge: 'bg-yellow-100 text-yellow-700', label: 'Pending Approval' },
  CONFIRMED:            { badge: 'bg-green-100 text-green-700',   label: 'Confirmed' },
  REJECTED:             { badge: 'bg-red-100 text-red-600',       label: 'Rejected' },
}

const TRANSITION_ACTIONS = {
  DRAFT:          [{ action: 'SENT',    label: 'Mark as Sent', icon: Send,         cls: 'bg-blue-600 hover:bg-blue-700 text-white' }],
  SENT:           [{ action: 'PAID',    label: 'Mark as Paid', icon: CheckCircle2, cls: 'bg-green-600 hover:bg-green-700 text-white' },
                   { action: 'OVERDUE', label: 'Mark Overdue', icon: AlertTriangle, cls: 'bg-orange-500 hover:bg-orange-600 text-white' },
                   { action: 'PARTIALLY_PAID', label: 'Partial Payment', icon: DollarSign, cls: 'bg-yellow-500 hover:bg-yellow-600 text-white' }],
  PARTIALLY_PAID: [{ action: 'PAID',    label: 'Mark as Paid', icon: CheckCircle2, cls: 'bg-green-600 hover:bg-green-700 text-white' }],
  OVERDUE:        [{ action: 'PAID',    label: 'Mark as Paid', icon: CheckCircle2, cls: 'bg-green-600 hover:bg-green-700 text-white' }],
}

// ─── Status Change Modal ───────────────────────────────────────────────────────

function StatusChangeModal({ invoice, onClose, onDone }) {
  const [action,     setAction]     = useState('')
  const [paidAmount, setPaidAmount] = useState('')
  const [saving,     setSaving]     = useState(false)
  const actions = TRANSITION_ACTIONS[invoice.status] ?? []

  async function submit() {
    if (!action) return
    setSaving(true)
    try {
      const body = { status: action }
      if (action === 'PARTIALLY_PAID' && paidAmount) body.paidAmount = Number(paidAmount)
      const res  = await fetch(`/api/invoices/${invoice.id}/status`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Invoice status updated')
      onDone()
      onClose()
    } catch (err) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  if (actions.length === 0) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold">Update Status</h3>
          <button onClick={onClose}><X className="w-4 h-4 text-gray-400" /></button>
        </div>
        <div className="space-y-2">
          {actions.map(a => {
            const Icon = a.icon
            return (
              <button key={a.action} onClick={() => setAction(a.action)}
                className={`w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 text-left transition-all ${
                  action === a.action ? 'border-blue-500 bg-blue-50' : 'border-gray-100 hover:border-gray-200'
                }`}>
                <Icon className="w-4 h-4 text-gray-500" />
                <span className="text-sm font-medium text-gray-800">{a.label}</span>
              </button>
            )
          })}
        </div>
        {action === 'PARTIALLY_PAID' && (
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Amount Paid (BDT)</label>
            <input type="number" step="0.01" min="0" value={paidAmount} onChange={e => setPaidAmount(e.target.value)} onKeyDown={e => { if (e.key === '-' || e.key === 'e') e.preventDefault() }}
              placeholder="0.00"
              className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
          </div>
        )}
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-200 rounded-xl hover:bg-gray-50">Cancel</button>
          <button onClick={submit} disabled={!action || saving}
            className="px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-xl hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Confirm
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Record Payment Modal ──────────────────────────────────────────────────────

function RecordPaymentModal({ invoice, onClose, onSaved }) {
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
      const res  = await fetch(`/api/invoices/${invoice.id}/payment-request`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, amount: Number(form.amount) }),
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
            <label className="block text-xs font-medium text-gray-500 mb-1">Amount (BDT) *</label>
            <input type="number" step="0.01" min="0" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} onKeyDown={e => { if (e.key === '-' || e.key === 'e') e.preventDefault() }} placeholder="0.00" className={ic} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Method</label>
            <Select value={form.paymentMethod} onChange={v => setForm(f => ({ ...f, paymentMethod: v ?? 'BANK_TRANSFER' }))}
              options={PAYMENT_METHODS.map(m => ({ value: m, label: m.replace('_', ' ') }))}
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

// ─── Payment History ───────────────────────────────────────────────────────────

function PaymentHistory({ invoiceId }) {
  const [payments, setPayments] = useState([])
  const [loading,  setLoading]  = useState(true)

  const load = useCallback(async () => {
    try {
      const res  = await fetch(`/api/invoices/${invoiceId}/payment-request`)
      const json = await res.json()
      if (res.ok) setPayments(json.data ?? [])
    } catch {}
    finally { setLoading(false) }
  }, [invoiceId])

  useEffect(() => { load() }, [load])

  if (loading) return (
    <div className="flex justify-center py-6">
      <div className="w-5 h-5 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )

  if (payments.length === 0) return (
    <p className="text-sm text-gray-400 text-center py-6">No payment requests yet.</p>
  )

  return (
    <div className="divide-y divide-gray-50">
      {payments.map(p => {
        const cs = CONFIRMATION_STATUS[p.status] ?? CONFIRMATION_STATUS.PENDING_CONFIRMATION
        return (
          <div key={p.id} className="flex items-start justify-between gap-4 py-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-gray-900">{fmt(p.amount)}</span>
                <span className="text-xs text-gray-400">{p.paymentMethod?.replace('_', ' ')}</span>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cs.badge}`}>
                  {cs.label}
                </span>
              </div>
              <p className="text-xs text-gray-500 mt-0.5">{p.description}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Date: {fmtDate(p.paymentDate)}
                {p.submittedBy?.name && ` · Submitted by ${p.submittedBy.name}`}
                {p.confirmedBy?.name && ` · Reviewed by ${p.confirmedBy.name}`}
              </p>
              {p.status === 'REJECTED' && p.rejectionNote && (
                <p className="text-xs text-red-500 mt-1">Rejection note: {p.rejectionNote}</p>
              )}
            </div>
            <div className="shrink-0 flex items-center gap-2">
              {p.receiptUrl && (
                <a href={p.receiptUrl} target="_blank" rel="noreferrer"
                  className="text-xs text-blue-500 hover:text-blue-700 flex items-center gap-1">
                  <ExternalLink className="w-3 h-3" /> Proof
                </a>
              )}
              {p.status === 'PENDING_CONFIRMATION' && (
                <Link href="/admin/accounts?tab=confirmations"
                  className="text-xs text-amber-600 hover:text-amber-700 flex items-center gap-1">
                  <Clock className="w-3 h-3" /> Review
                </Link>
              )}
            </div>
          </div>
        )
      })}
    </div>
  )
}

// ─── Print / PDF View ─────────────────────────────────────────────────────────

function InvoicePrintView({ invoice, payments = [] }) {
  const client     = invoice.clientId
  const user       = client?.userId
  const paidAmount = invoice.paidAmount ?? 0
  const subtotal   = invoice.subtotal   ?? 0
  const discount   = invoice.discount   ?? 0
  const taxAmount  = invoice.taxAmount  ?? 0
  const total      = invoice.total      ?? 0
  const balance    = Math.max(0, total - paidAmount)
  const cur        = invoice.currency   ?? 'BDT'
  const statusStyle = STATUS_STYLES[invoice.status] ?? STATUS_STYLES.DRAFT

  const isBDT = cur === 'BDT'
  const curSymbol = isBDT ? '৳' : cur
  const Sym = () => isBDT
    ? <span style={{ fontSize: 14, fontWeight: 400, lineHeight: 1, letterSpacing: '-0.5px', fontFamily: 'Georgia, serif' }}>৳</span>
    : <span>{cur}</span>
  const fmtAmt = (n) =>
    `${curSymbol}\u00A0${(n ?? 0).toLocaleString('en-BD', { minimumFractionDigits: 2 })}`

  const accent = {
    PAID: '#16a34a', PARTIALLY_PAID: '#d97706', OVERDUE: '#dc2626',
    SENT: '#2563eb', DRAFT: '#64748b', CANCELLED: '#94a3b8',
  }[invoice.status] ?? '#2563eb'

  const TH = (extra = {}) => ({
    padding: '7px 16px', fontSize: 10, fontWeight: 600,
    textTransform: 'uppercase', letterSpacing: '0.07em',
    color: '#64748b', borderBottom: '1px solid #e2e8f0',
    background: '#fff', ...extra,
  })
  const TD = (extra = {}) => ({
    padding: '8px 16px', fontSize: 12.5, color: '#334155',
    borderBottom: '1px solid #f1f5f9', verticalAlign: 'top', ...extra,
  })

  return (
    <div id="invoice-print" style={{
      fontFamily: "'Inter', 'Segoe UI', sans-serif",
      background: '#ffffff', padding: '36px 56px',
      maxWidth: 820, margin: '0 auto',
    }}>

      {/* ── HEADER ── */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
        <div>
          <Image src="/en-logo.png" alt="Enfinito" width={120} height={38} style={{ objectFit: 'contain', display: 'block', marginBottom: 7 }} />
          <p style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 700, color: '#0f172a' }}>Enfinito Bangladesh</p>
          <p style={{ margin: '0 0 2px', fontSize: 11, color: '#64748b' }}>Savar, Dhaka, Bangladesh</p>
          <p style={{ margin: '0 0 2px', fontSize: 11, color: '#64748b' }}>+8801332818901 - info@enfinito.com</p>
          <p style={{ margin: 0,         fontSize: 11, color: '#64748b' }}>www.enfinito.com</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <p style={{ margin: 0, fontSize: 26, fontWeight: 700, color: '#0f172a', letterSpacing: '-0.5px' }}>Invoice</p>
          <p style={{ margin: '4px 0 0', fontSize: 13, fontWeight: 700, color: '#94a3b8' }}>
            Invoice No: <strong style={{ color: accent, fontWeight: 700 }}>{invoice.invoiceNumber}</strong>
          </p>
          <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 3, alignItems: 'flex-end' }}>
            {[
              { label: 'Issued', value: fmtDate(invoice.issueDate) },
              { label: 'Due',    value: fmtDate(invoice.dueDate) },
            ].map(row => (
              <div key={row.label} style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                <span style={{ fontSize: 11, color: '#94a3b8', minWidth: 36, textAlign: 'right' }}>{row.label}</span>
                <strong style={{ fontSize: 11, color: '#475569', minWidth: 80, textAlign: 'left' }}>{row.value}</strong>
              </div>
            ))}
          </div>
          <p style={{ margin: '10px 0 0', fontSize: 13, fontWeight: 700, color: '#94a3b8' }}>
            Invoice Status: <strong style={{ color: accent, fontWeight: 700 }}>{statusStyle.label}</strong>
          </p>
        </div>
      </div>

      {/* ── DIVIDER ── */}
      <div style={{ height: 1, background: '#e2e8f0', marginBottom: 20 }} />

      {/* ── INVOICED TO ── */}
      <div style={{ marginBottom: 20 }}>
        <p style={{ margin: '0 0 10px', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#94a3b8' }}>Invoiced To</p>
        <p style={{ margin: '0 0 2px', fontSize: 13, fontWeight: 700, color: '#0f172a' }}>
          {client?.company ?? user?.name ?? '—'}
          {client?.clientCode && (
            <span style={{ fontSize: 11, fontWeight: 400, color: '#94a3b8', marginLeft: 6 }}>
              (Client ID: #{client.clientCode})
            </span>
          )}
        </p>
        {user?.name          && <p style={{ margin: '0 0 1px', fontSize: 11, fontWeight: 700, color: '#64748b' }}>{user.name}</p>}
        {client?.designation && <p style={{ margin: '0 0 2px', fontSize: 11, fontWeight: 400, color: '#64748b' }}>{client.designation}</p>}
        {(client?.address || client?.city || client?.country) && (
          <p style={{ margin: '0 0 2px', fontSize: 11, color: '#64748b' }}>
            {[client.address, client.city, client.country].filter(Boolean).join(', ')}
          </p>
        )}
        {user?.phone && <p style={{ margin: 0, fontSize: 11, color: '#64748b' }}>Phone: {user.phone}</p>}
      </div>

      {/* ── ITEMS TABLE ── */}
      <table style={{ width: '100%', borderCollapse: 'collapse', marginBottom: 0 }}>
        <thead>
          <tr>
            <th style={TH({ textAlign: 'left',   borderTop: '2px solid #0f172a', paddingLeft: 0 })}>ID</th>
            <th style={TH({ textAlign: 'left',   borderTop: '2px solid #0f172a' })}>Description</th>
            <th style={TH({ textAlign: 'center', borderTop: '2px solid #0f172a' })}>Qty</th>
            <th style={TH({ textAlign: 'right',  borderTop: '2px solid #0f172a', whiteSpace: 'nowrap' })}>Unit Price</th>
            <th style={TH({ textAlign: 'right',  borderTop: '2px solid #0f172a', paddingRight: 0, whiteSpace: 'nowrap' })}>Amount</th>
          </tr>
        </thead>
        <tbody>
          {invoice.items?.map((item, i) => {
            const projectMatch = item.description?.match(/^\[([^\]]+)\]/)
            const projectCode  = projectMatch
              ? projectMatch[1]
              : (invoice.projectIds?.[i]?.projectCode ?? invoice.projectIds?.[0]?.projectCode ?? '—')
            const rawDesc  = projectMatch
              ? item.description.slice(projectMatch[0].length).trim()
              : (item.description ?? '')
            const splitMatch = rawDesc.match(/^([^—\n]+?)(?:\s*—\s*|\n)([\s\S]*)$/)
            const descTitle  = splitMatch ? splitMatch[1].trim() : rawDesc
            const descDetail = splitMatch ? splitMatch[2].trim() : ''
            const project = invoice.projectIds?.[i] ?? invoice.projectIds?.[0]
            const venture = project?.venture
            return (
              <tr key={i}>
                <td style={TD({ paddingLeft: 0, fontSize: 12, fontWeight: 500, color: '#334155', whiteSpace: 'nowrap' })}>
                  #{projectCode}
                </td>
                <td style={TD({})}>
                  {venture && <p style={{ margin: '0 0 2px', fontSize: 10, fontWeight: 500, color: '#94a3b8', lineHeight: 1.3, textTransform: 'uppercase', letterSpacing: '0.06em' }}>{venture}</p>}
                  <p style={{ margin: 0, fontSize: 13, fontWeight: 600, color: '#0f172a', lineHeight: 1.4 }}>{descTitle}</p>
                  {descDetail && <p style={{ margin: '3px 0 0', fontSize: 10, fontWeight: 400, color: '#64748b', lineHeight: 1.6 }}>{descDetail}</p>}
                </td>
                <td style={TD({ textAlign: 'center', color: '#64748b' })}>{item.quantity}</td>
                <td style={TD({ textAlign: 'right', color: '#64748b', whiteSpace: 'nowrap' })}>
                  <Sym />&nbsp;{Number(item.rate).toLocaleString('en-BD', { minimumFractionDigits: 2 })}
                </td>
                <td style={TD({ textAlign: 'right', paddingRight: 0, fontWeight: 700, color: '#0f172a', whiteSpace: 'nowrap' })}>
                  <Sym />&nbsp;{(Number(item.quantity) * Number(item.rate)).toLocaleString('en-BD', { minimumFractionDigits: 2 })}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>

      {/* ── TOTALS ── */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 20 }}>
        <div style={{ width: 280 }}>
          <div style={{ height: 2, background: '#0f172a', marginBottom: 0 }} />
          {[
            { label: 'Sub Total',   n: subtotal,  prefix: '',  show: true,          valueColor: '#334155' },
            { label: 'Discount',    n: discount,  prefix: '−', show: discount > 0,  valueColor: '#ef4444' },
            { label: `MFS Charge (${invoice.taxRate ?? 0}%)`, n: taxAmount, prefix: '', show: taxAmount > 0, valueColor: '#334155' },
          ].filter(r => r.show).map((row, i) => (
            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #f1f5f9' }}>
              <span style={{ fontSize: 12, color: '#64748b' }}>{row.label}</span>
              <span style={{ fontSize: 12, color: row.valueColor, fontWeight: 500 }}>
                {row.prefix}<Sym />&nbsp;{(row.n ?? 0).toLocaleString('en-BD', { minimumFractionDigits: 2 })}
              </span>
            </div>
          ))}
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #e2e8f0' }}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}>Payable</span>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#0f172a' }}><Sym />&nbsp;{(total).toLocaleString('en-BD', { minimumFractionDigits: 2 })}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '5px 0', borderBottom: '1px solid #f1f5f9' }}>
            <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 500 }}>Paid</span>
            <span style={{ fontSize: 12, color: '#16a34a', fontWeight: 500 }}>−<Sym />&nbsp;{(paidAmount).toLocaleString('en-BD', { minimumFractionDigits: 2 })}</span>
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', padding: '9px 16px', marginTop: 3, marginLeft: -16, marginRight: -16, borderRadius: 8, background: balance > 0.01 ? '#fef2f2' : '#f0fdf4' }}>
            <span style={{ fontSize: 14, fontWeight: 800, color: balance > 0.01 ? '#dc2626' : '#16a34a' }}>Due</span>
            <span style={{ fontSize: 14, fontWeight: 800, color: balance > 0.01 ? '#dc2626' : '#16a34a' }}><Sym />&nbsp;{(balance).toLocaleString('en-BD', { minimumFractionDigits: 2 })}</span>
          </div>
        </div>
      </div>

      {/* ── TRANSACTIONS ── */}
      {payments.length > 0 && (
        <div style={{ marginBottom: 16 }}>
          <p style={{ margin: '0 0 8px', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#94a3b8' }}>Transaction Details</p>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={TH({ textAlign: 'left',   paddingLeft: 0, borderTop: '2px solid #0f172a' })}>Date</th>
                <th style={TH({ textAlign: 'left',   borderTop: '2px solid #0f172a' })}>Gateway / Method</th>
                <th style={TH({ textAlign: 'center', borderTop: '2px solid #0f172a' })}>Transaction ID</th>
                <th style={TH({ textAlign: 'right',  paddingRight: 0, borderTop: '2px solid #0f172a' })}>Paid Amount</th>
              </tr>
            </thead>
            <tbody>
              {payments.map((p, i) => (
                <tr key={i}>
                  <td style={TD({ paddingLeft: 0 })}>{fmtDate(p.paymentDate ?? p.createdAt)}</td>
                  <td style={TD()}>{(p.paymentMethod ?? '—').replace(/_/g, ' ')}</td>
                  <td style={TD({ textAlign: 'center', fontFamily: 'monospace', fontSize: 11 })}>{p.transactionId ?? p.txnId ?? '—'}</td>
                  <td style={TD({ textAlign: 'right', paddingRight: 0, color: '#16a34a', fontWeight: 600 })}><Sym />&nbsp;{(p.amount ?? 0).toLocaleString('en-BD', { minimumFractionDigits: 2 })}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* ── NOTES / TERMS ── */}
      {(invoice.notes || invoice.terms) && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}>
          {invoice.notes && (
            <div>
              <p style={{ margin: '0 0 6px', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#94a3b8' }}>Notes</p>
              <p style={{ margin: 0, fontSize: 11, color: '#475569', lineHeight: 1.7 }}>{invoice.notes}</p>
            </div>
          )}
          {invoice.terms && (
            <div>
              <p style={{ margin: '0 0 6px', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: '#94a3b8' }}>Payment Terms</p>
              <p style={{ margin: 0, fontSize: 11, color: '#475569', lineHeight: 1.7 }}>{invoice.terms}</p>
            </div>
          )}
        </div>
      )}

      {/* ── SYSTEM NOTE ── */}
      <div style={{ borderTop: '1px solid #f1f5f9', paddingTop: 16, marginBottom: 20, textAlign: 'center' }}>
        <p style={{ margin: 0, fontSize: 11, color: '#64748b', lineHeight: 1.8 }}>
          This is a system generated invoice. No signature is required.
        </p>
      </div>

      {/* ── FOOTER ── */}
      <div style={{ borderTop: '1px solid #e2e8f0', paddingTop: 12, textAlign: 'center' }}>
        <p style={{ margin: '0 0 3px', fontSize: 11, color: '#94a3b8' }}>
          Generated on {new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })} –{' '}
          {new Date().toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}
        </p>
        <p style={{ margin: 0, fontSize: 10, color: '#cbd5e1', letterSpacing: '0.04em' }}>
          Powered by Enfinito Technology – Entech
        </p>
      </div>
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function InvoiceDetailPage() {
  const { id }  = useParams()
  const router  = useRouter()
  const [invoice,      setInvoice]      = useState(null)
  const [payments,     setPayments]     = useState([])
  const [loading,      setLoading]      = useState(true)
  const [statusModal,  setStatusModal]  = useState(false)
  const [paymentModal, setPaymentModal] = useState(false)
  const [printMode,    setPrintMode]    = useState(false)
  const [historyKey,   setHistoryKey]   = useState(0)

  const load = useCallback(async () => {
    try {
      const [invRes, pmtRes] = await Promise.all([
        fetch(`/api/invoices/${id}`),
        fetch(`/api/invoices/${id}/payment-request`),
      ])
      const invJson = await invRes.json()
      if (!invRes.ok) throw new Error(invJson.error)
      setInvoice(invJson.data)
      if (pmtRes.ok) {
        const pmtJson = await pmtRes.json()
        setPayments((pmtJson.data ?? []).filter(p => p.status === 'CONFIRMED'))
      }
    } catch (err) { toast.error(err.message) }
    finally { setLoading(false) }
  }, [id])

  useEffect(() => { load() }, [load])

  async function handleDelete() {
    if (!confirm(`Delete invoice ${invoice?.invoiceNumber}? This cannot be undone.`)) return
    try {
      const res = await fetch(`/api/invoices/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Invoice deleted')
      router.push('/admin/invoices')
    } catch (err) { toast.error(err.message) }
  }

  if (loading) return (
    <div className="flex justify-center py-20">
      <div className="w-8 h-8 border-2 border-blue-600 border-t-transparent rounded-full animate-spin" />
    </div>
  )
  if (!invoice) return (
    <div className="text-center py-20">
      <p className="text-gray-500">Invoice not found.</p>
      <Link href="/admin/invoices" className="text-blue-600 text-sm mt-2 inline-block">Back to invoices</Link>
    </div>
  )

  const s       = STATUS_STYLES[invoice.status] ?? STATUS_STYLES.DRAFT
  const actions = TRANSITION_ACTIONS[invoice.status] ?? []
  const canRecordPayment = !['PAID', 'CANCELLED'].includes(invoice.status)
  const balance = invoice.total - (invoice.paidAmount ?? 0)

  if (printMode) {
    return (
      <div>
        <div className="print:hidden flex items-center gap-3 mb-4 px-4 pt-4">
          <button onClick={() => setPrintMode(false)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-xl hover:bg-gray-50">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <button onClick={() => {
              const el = document.getElementById('invoice-print')
              if (!el) return
              const win = window.open('', '_blank')
              win.document.write(`<!DOCTYPE html><html><head><meta charset="utf-8"/>
                <title>Invoice ${invoice.invoiceNumber}</title>
                <style>
                  @import url('https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap');
                  * { box-sizing: border-box; margin: 0; padding: 0; }
                  body { font-family: 'Inter','Segoe UI',sans-serif; background:#fff; }
                  @page { margin: 0; size: A4; }
                </style>
              </head><body>${el.outerHTML}</body></html>`)
              win.document.close()
              win.focus()
              setTimeout(() => { win.print(); win.close() }, 500)
            }}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-blue-600 text-white rounded-xl hover:bg-blue-700">
            <Printer className="w-4 h-4" /> Print / Save PDF
          </button>
        </div>
        <InvoicePrintView invoice={invoice} payments={payments} />
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <Link href="/admin/invoices" className="p-1.5 rounded-xl text-gray-400 hover:bg-gray-100">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <div className="flex items-center gap-2 flex-wrap">
              <h1 className="text-xl font-bold text-gray-900 font-mono">{invoice.invoiceNumber}</h1>
              <span className={`px-2.5 py-1 text-xs font-bold rounded-xl ${s.badge}`}>{s.label}</span>
            </div>
            <p className="text-sm text-gray-500 mt-0.5">
              {invoice.clientId?.userId?.name} {invoice.clientId?.company ? `· ${invoice.clientId.company}` : ''}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2 shrink-0 flex-wrap justify-end">
          {/* Record Payment button — shown for SENT / PARTIALLY_PAID / OVERDUE */}
          {canRecordPayment && (
            <button
              onClick={() => setPaymentModal(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-green-600 text-white rounded-xl hover:bg-green-700 transition-colors">
              <PlusCircle className="w-4 h-4" /> Record Payment
            </button>
          )}
          {actions.length > 0 && (
            <button onClick={() => setStatusModal(true)}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-gray-100 text-gray-700 rounded-xl hover:bg-gray-200 transition-colors">
              Update Status
            </button>
          )}
          <button onClick={() => setPrintMode(true)}
            className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-purple-50 text-purple-700 rounded-xl hover:bg-purple-100 transition-colors">
            <Printer className="w-4 h-4" /> Print / PDF
          </button>
          {invoice.status === 'DRAFT' && (
            <>
              <Link href={`/admin/invoices/${id}/edit`}
                className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 rounded-xl hover:bg-gray-50 text-gray-600">
                <Pencil className="w-3.5 h-3.5" /> Edit
              </Link>
              <button onClick={handleDelete}
                className="flex items-center gap-1.5 px-3 py-2 text-sm border border-red-100 text-red-600 rounded-xl hover:bg-red-50">
                <Trash2 className="w-3.5 h-3.5" /> Delete
              </button>
            </>
          )}
        </div>
      </div>

      {/* Payable / Paid / Due summary */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">Payable</p>
          <p className="text-lg font-bold text-gray-900"><TkAmt value={invoice.total} decimals={2} /></p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">Paid</p>
          <p className="text-lg font-bold text-green-600"><TkAmt value={invoice.paidAmount ?? 0} decimals={2} /></p>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 p-4">
          <p className="text-xs text-gray-400 font-medium uppercase tracking-wide mb-1">Due</p>
          <p className={`text-lg font-bold ${(invoice.total - (invoice.paidAmount ?? 0)) > 0.01 ? 'text-red-500' : 'text-green-600'}`}>
            <TkAmt value={Math.max(0, invoice.total - (invoice.paidAmount ?? 0))} decimals={2} />
          </p>
        </div>
      </div>

      {/* Payment progress bar (shown when partially/fully paid) */}
      {invoice.paidAmount > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 p-5">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Payment Progress</span>
            <span className="text-sm text-gray-500"><TkAmt value={invoice.paidAmount} decimals={2} /> of <TkAmt value={invoice.total} decimals={2} /></span>
          </div>
          <div className="h-2.5 bg-gray-100 rounded-full overflow-hidden">
            <div
              className="h-full bg-green-500 rounded-full transition-all"
              style={{ width: `${Math.min(100, (invoice.paidAmount / invoice.total) * 100).toFixed(1)}%` }}
            />
          </div>
          <div className="flex justify-between mt-1.5">
            <span className="text-xs text-green-600 font-medium">
              {((invoice.paidAmount / invoice.total) * 100).toFixed(0)}% paid
            </span>
            {balance > 0 && <span className="text-xs text-amber-600 font-medium">Balance: <TkAmt value={balance} decimals={2} /></span>}
          </div>
        </div>
      )}

      {/* Invoice print preview */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <InvoicePrintView invoice={invoice} payments={payments} />
      </div>

      {/* Payment history */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold text-gray-900">Payment Requests</h2>
          {canRecordPayment && (
            <button onClick={() => setPaymentModal(true)}
              className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1 font-medium">
              <PlusCircle className="w-3.5 h-3.5" /> Add Payment
            </button>
          )}
        </div>
        <PaymentHistory key={historyKey} invoiceId={id} />
      </div>

      {/* Modals */}
      {statusModal && (
        <StatusChangeModal
          invoice={invoice}
          onClose={() => setStatusModal(false)}
          onDone={() => load()}
        />
      )}
      {paymentModal && (
        <RecordPaymentModal
          invoice={invoice}
          onClose={() => setPaymentModal(false)}
          onSaved={() => { load(); setHistoryKey(k => k + 1) }}
        />
      )}
    </div>
  )
}
