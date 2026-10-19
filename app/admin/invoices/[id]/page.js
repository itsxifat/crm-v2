'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import {
  ArrowLeft, Pencil, Trash2, Send, Printer, Loader2,
  X, Wallet, Clock, AlertTriangle, XCircle,
  PlusCircle, ExternalLink, CreditCard, Layers,
  FileText, Copy, FileMinus, FilePlus, Percent, Ban, CheckCircle2, Info, ShieldAlert, RotateCcw,
} from 'lucide-react'
import FileUpload from '@/components/ui/FileUpload'
import TkAmt from '@/components/ui/TkAmt'
import Select from '@/components/ui/Select'
import DatePicker from '@/components/ui/DatePicker'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import InvoicePrintView, { openInvoicePrint, buyerBinOf } from '@/components/shared/InvoicePrintView'
import WithholdingFields, { emptyWithholding, invoiceAllowsVds } from '@/components/tax/WithholdingFields'
import ReverseClientPaymentModal from '@/components/finance/ReverseClientPaymentModal'
import { usePermission } from '@/components/auth/Can'
import CreditNoteModal, { CancelNoteModal } from '@/app/admin/tax/notes/_components/CreditNoteModal'
import { useConfig } from '@/lib/useConfig'
import { dhakaDayKey } from '@/lib/dhakaTime'
import { isVatInvoice, taxableValueOf, invoiceVatLabel } from '@/lib/invoiceTotals'
import { VAT_TREATMENTS, CREDIT_NOTE_REASONS, BUYER_BIN_THRESHOLD } from '@/lib/tax/catalog'
import { formatMoney } from '@/lib/currencies'
import { cn } from '@/lib/utils'

const fmt     = (n) => `৳ ${(n ?? 0).toLocaleString('en-BD', { minimumFractionDigits: 2 })}`
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const fmtDateTime = (d) => d
  ? new Date(d).toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Dhaka' })
  : '—'
const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const STATUS_STYLES = {
  DRAFT:          { badge: 'bg-gray-100 text-gray-600',     label: 'Draft' },
  SENT:           { badge: 'bg-blue-100 text-blue-700',     label: 'Sent' },
  PARTIALLY_PAID: { badge: 'bg-yellow-100 text-yellow-700', label: 'Partially Paid' },
  PAID:           { badge: 'bg-green-100 text-green-700',   label: 'Paid' },
  OVERDUE:        { badge: 'bg-red-100 text-red-600',       label: 'Overdue' },
  CANCELLED:      { badge: 'bg-gray-100 text-gray-500',     label: 'Cancelled' },
}


const CONFIRMATION_STATUS = {
  PENDING_CONFIRMATION: { badge: 'bg-yellow-100 text-yellow-700', label: 'Pending Approval' },
  CONFIRMED:            { badge: 'bg-green-100 text-green-700',   label: 'Confirmed' },
  REJECTED:             { badge: 'bg-red-100 text-red-600',       label: 'Rejected' },
  REVERSING:            { badge: 'bg-amber-100 text-amber-700',   label: 'Reversing…' },
  REVERSED:             { badge: 'bg-gray-100 text-gray-600',     label: 'Reversed' },
}

// PAID is set automatically when payment is fully confirmed — it cannot be set manually
const TRANSITION_ACTIONS = {
  DRAFT: [
    { action: 'SENT',      label: 'Mark as Sent',    icon: Send,          cls: 'bg-blue-600 hover:bg-blue-700 text-white' },
    { action: 'CANCELLED', label: 'Cancel Invoice',  icon: XCircle,       cls: 'bg-red-500 hover:bg-red-600 text-white' },
  ],
  SENT: [
    { action: 'PARTIALLY_PAID', label: 'Partial Payment', icon: Wallet,    cls: 'bg-yellow-500 hover:bg-yellow-600 text-white' },
    { action: 'OVERDUE',        label: 'Mark Overdue',    icon: AlertTriangle, cls: 'bg-orange-500 hover:bg-orange-600 text-white' },
    { action: 'CANCELLED',      label: 'Cancel Invoice',  icon: XCircle,       cls: 'bg-red-500 hover:bg-red-600 text-white' },
  ],
  PARTIALLY_PAID: [
    { action: 'OVERDUE',   label: 'Mark Overdue',   icon: AlertTriangle, cls: 'bg-orange-500 hover:bg-orange-600 text-white' },
  ],
  OVERDUE: [
    { action: 'PARTIALLY_PAID', label: 'Back to Partial', icon: Wallet, cls: 'bg-yellow-500 hover:bg-yellow-600 text-white' },
    { action: 'CANCELLED',      label: 'Cancel Invoice',  icon: XCircle,    cls: 'bg-red-500 hover:bg-red-600 text-white' },
  ],
  PAID:      [],
  CANCELLED: [],
}

const NOTEABLE_STATUSES = ['SENT', 'PARTIALLY_PAID', 'OVERDUE', 'PAID']
const WITHHOLDABLE_STATUSES = ['SENT', 'PARTIALLY_PAID', 'OVERDUE']

// ─── Status Change Modal ───────────────────────────────────────────────────────

function StatusChangeModal({ invoice, onClose, onDone }) {
  const [action,     setAction]     = useState('')
  const [saving,     setSaving]     = useState(false)
  const actions = TRANSITION_ACTIONS[invoice.status] ?? []
  const vat = isVatInvoice(invoice)

  async function submit() {
    if (!action) return
    setSaving(true)
    try {
      const body = { status: action }
      const res  = await fetch(`/api/invoices/${invoice.id}/status`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success(action === 'SENT' && vat ? 'Invoice issued — output VAT recorded' : 'Invoice status updated')
      if (json.warning) toast(json.warning, { icon: '⚠️', duration: 9000 })
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
            <p className="text-xs text-gray-500">
              The paid amount comes from confirmed payments only. Use Record Payment to add a new payment.
            </p>
          </div>
        )}
        {action === 'SENT' && vat && (
          <p className="text-xs text-gray-500">
            Issuing is the VAT tax point: the issue time and both parties&apos; BINs are fixed on the invoice and its output VAT is recorded for the VAT return.
          </p>
        )}
        {action === 'CANCELLED' && vat && invoice.status !== 'DRAFT' && (
          <p className="text-xs text-gray-500">
            Cancelling voids the output VAT. Once the VAT is in a filed return this is refused — issue a credit note (Mushak-6.7) instead.
          </p>
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
  const { paymentMethods } = useConfig()
  const [form, setForm] = useState({
    amount: '', paymentMethod: 'BANK_TRANSFER',
    paymentDate: dhakaDayKey(),
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
              options={paymentMethods}
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

// ─── Record VDS / TDS withheld by the client ──────────────────────────────────

function WithholdingModal({ invoice, open, onOpenChange, onSaved }) {
  const [value, setValue]   = useState(emptyWithholding())
  const [date, setDate]     = useState(dhakaDayKey())
  const [note, setNote]     = useState('')
  const [saving, setSaving] = useState(false)

  const total   = num(invoice.total)
  const paid    = num(invoice.paidAmount)
  const due     = Math.max(0, Math.round((total - paid) * 100) / 100)
  const taxable = taxableValueOf(invoice)
  const vat     = num(invoice.vatAmount)

  useEffect(() => {
    if (!open) return
    setValue({
      ...emptyWithholding(),
      tdsSection: invoice.clientId?.defaultTdsSection || null,
      vatServiceCode: invoice.serviceCode || null,
    })
    setDate(dhakaDayKey())
    setNote('')
  }, [open, invoice.id, invoice.clientId?.defaultTdsSection, invoice.serviceCode])

  const vds = num(value.vdsAmount)
  const tds = num(value.tdsAmount)
  const withheld = Math.round((vds + tds) * 100) / 100
  const over = withheld > due + 0.01

  async function submit() {
    if (withheld <= 0) { toast.error('Enter the VDS and/or TDS the client withheld'); return }
    if (over) { toast.error(`Withholding cannot exceed the amount due (${fmt(due)})`); return }
    if (tds > 0 && !value.tdsSection) { toast.error('Choose the TDS section the client deducted under'); return }
    setSaving(true)
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/withholding`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          vdsAmount: vds,
          tdsAmount: tds,
          tdsSection: value.tdsSection || null,
          vdsCertificateNo: value.vdsCertificateNo || null,
          vdsCertificateDate: value.vdsCertificateDate || null,
          tdsCertificateNo: value.tdsCertificateNo || null,
          tdsCertificateDate: value.tdsCertificateDate || null,
          date,
          note: note.trim() || null,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) {
        const detail = json?.details?.fieldErrors ? Object.values(json.details.fieldErrors).flat()[0] : null
        throw new Error(detail || json.error || (res.status === 404 ? 'Recording withholding is not available yet.' : 'Failed to record withholding'))
      }
      toast.success('Withholding recorded — the invoice is settled by it')
      if (json.warning) toast(json.warning, { icon: '⚠️', duration: 8000 })
      onSaved()
      onOpenChange(false)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal open={open} onOpenChange={(v) => { if (!saving) onOpenChange(v) }}
      title="Record VDS / TDS withheld by the client"
      description={`Invoice ${invoice.invoiceNumber} · due ${fmt(due)}`} size="lg">
      <div className="space-y-4">
        <p className="text-xs text-gray-500">
          Use this when the client deducted VAT (VDS) or income tax (TDS / AIT) at source and paid us the rest.
          The withheld amount settles the invoice like cash; collect the Mushak-6.6 and the TDS certificate to claim the credit.
          Cash received is recorded separately through Record Payment.
        </p>
        <div className="grid grid-cols-3 gap-3 rounded-xl border border-gray-100 bg-gray-50/70 px-4 py-3 text-xs text-gray-600">
          <span>Taxable value<span className="block font-semibold text-gray-900">{fmt(taxable)}</span></span>
          <span>VAT<span className="block font-semibold text-gray-900">{fmt(vat)}</span></span>
          <span>Due<span className="block font-semibold text-gray-900">{fmt(due)}</span></span>
        </div>
        <WithholdingFields
          mode="CUSTOMER"
          baseAmount={taxable}
          vatAmount={vat}
          value={value}
          onChange={setValue}
          date={date}
          defaultOpen
          vdsAllowed={invoiceAllowsVds(invoice)}
        />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Date withheld *</label>
            <DatePicker value={date} onChange={v => setDate(v ?? dhakaDayKey())} clearable={false} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-600 mb-1">Note</label>
            <input value={note} onChange={e => setNote(e.target.value)} maxLength={500} placeholder="e.g. per client's payment advice"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
          </div>
        </div>
        <div className="flex items-center justify-between rounded-xl border border-gray-100 px-4 py-3">
          <span className="text-sm text-gray-600">Settles</span>
          <span className={cn('text-sm font-semibold', over ? 'text-red-600' : 'text-gray-900')}>{fmt(withheld)} of {fmt(due)} due</span>
        </div>
        {over && <p className="text-xs text-red-600">The withheld total is more than the amount still due.</p>}
      </div>
      <ModalFooter className="-mx-4 sm:-mx-6 -mb-4 mt-5">
        <button type="button" onClick={() => onOpenChange(false)} disabled={saving}
          className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
        <button type="button" onClick={submit} disabled={saving || withheld <= 0 || over}
          className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-50 flex items-center gap-1.5">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Percent className="w-4 h-4" />} Record withholding
        </button>
      </ModalFooter>
    </Modal>
  )
}

// ─── Payment History ───────────────────────────────────────────────────────────

function PaymentHistory({ invoiceId, onChanged }) {
  const { paymentMethods } = useConfig()
  const { can, ready } = usePermission()
  const canReverse = ready && can('finance.payments.confirm')
  const fmtMethod = v => v ? (paymentMethods.find(m => m.value === v)?.label ?? v.replace(/_/g, ' ')) : '—'
  const [payments, setPayments] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [reversing, setReversing] = useState(null)   // CONFIRMED payment → ReverseClientPaymentModal

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
        const vds = num(p.vdsAmount)
        const tds = num(p.tdsAmount)
        return (
          <div key={p.id} className="flex items-start justify-between gap-4 py-4">
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-semibold text-gray-900">{fmt(p.amount)}</span>
                <span className="text-xs text-gray-400">{p.paymentMethod === 'WITHHOLDING' ? 'Withholding only' : fmtMethod(p.paymentMethod)}</span>
                <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${cs.badge}`}>
                  {cs.label}
                </span>
              </div>
              {(vds > 0 || tds > 0) && (
                <p className="text-xs text-gray-500 mt-0.5">
                  {vds > 0 && <>VDS {fmt(vds)}</>}{vds > 0 && tds > 0 && ' · '}{tds > 0 && <>TDS {fmt(tds)}</>} withheld by client
                </p>
              )}
              <p className="text-xs text-gray-500 mt-0.5">{p.description}</p>
              <p className="text-xs text-gray-400 mt-0.5">
                Date: {fmtDate(p.paymentDate)}
                {p.submittedBy?.name && ` · Submitted by ${p.submittedBy.name}`}
                {p.confirmedBy?.name && ` · Reviewed by ${p.confirmedBy.name}`}
              </p>
              {p.status === 'REJECTED' && p.rejectionNote && (
                <p className="text-xs text-red-500 mt-1">Rejection note: {p.rejectionNote}</p>
              )}
              {p.status === 'REVERSED' && (
                <p className="text-xs text-gray-500 mt-1">
                  Reversed{p.reversedAt ? ` ${fmtDate(p.reversedAt)}` : ''}{p.reversedBy?.name ? ` by ${p.reversedBy.name}` : ''}
                  {p.reversalTransactionId?.txnId ? ` (${p.reversalTransactionId.txnId})` : ''}
                  {p.reversalReason ? ` — ${p.reversalReason}` : ''}
                </p>
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
              {p.status === 'CONFIRMED' && canReverse && (
                <button onClick={() => setReversing(p)} title="Reverse this payment (wrong amount, account, VDS / TDS or date)"
                  className="text-xs text-red-500 hover:text-red-700 flex items-center gap-1">
                  <RotateCcw className="w-3 h-3" /> Reverse
                </button>
              )}
            </div>
          </div>
        )
      })}
      {reversing && (
        <ReverseClientPaymentModal
          payment={reversing}
          onClose={() => setReversing(null)}
          onDone={() => { load(); onChanged?.() }}
        />
      )}
    </div>
  )
}

// ─── VAT summary ──────────────────────────────────────────────────────────────

function Field({ label, children, className }) {
  return (
    <div className={cn('min-w-0', className)}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">{label}</p>
      <div className="text-sm text-gray-900 mt-0.5 break-words">{children}</div>
    </div>
  )
}

function VatPanel({ invoice, company, money }) {
  const vat = isVatInvoice(invoice)
  const treatment = invoice.vatTreatment || 'NONE'
  const treatmentLabel = VAT_TREATMENTS.find(t => t.value === treatment)?.label ?? treatment
  const issued = invoice.status !== 'DRAFT'
  const sellerBin = invoice.seller?.bin || company.bin || null
  const buyerBin = buyerBinOf(invoice)
  const taxable = taxableValueOf(invoice)
  const sd = num(invoice.sdAmount)
  const mfs = num(invoice.taxAmount)
  const bdtValue = invoice.currency && invoice.currency !== 'BDT' && num(invoice.totalBDT) > 0 && num(invoice.total) > 0
    ? taxable * num(invoice.totalBDT) / num(invoice.total)
    : taxable
  const needBuyerBin = ['STANDARD', 'REDUCED'].includes(treatment) && !buyerBin && bdtValue > BUYER_BIN_THRESHOLD

  if (!vat) {
    return (
      <div className="bg-white rounded-2xl border border-gray-100 p-5">
        <div className="flex items-center gap-2 mb-2">
          <FileText className="w-4 h-4 text-gray-400" />
          <h2 className="text-sm font-semibold text-gray-900">VAT</h2>
          <span className="ml-auto inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-600">No VAT</span>
        </div>
        <p className="text-sm text-gray-500">
          This invoice carries no VAT treatment, so it is not a tax invoice (Mushak-6.3) and has no output VAT.
          {invoice.status === 'DRAFT' && ' Edit the draft to set a VAT treatment if this supply is VAT-able.'}
        </p>
        {mfs > 0 && <p className="text-xs text-gray-400 mt-2">MFS charge {invoice.taxRate ?? 0}% ({money(mfs)}) is a payment surcharge, not VAT.</p>}
      </div>
    )
  }

  let vatStatus
  if (invoice.status === 'DRAFT') vatStatus = { icon: Info, cls: 'text-gray-500', text: 'Output VAT is recorded when the invoice is issued (marked as sent).' }
  else if (invoice.status === 'CANCELLED') vatStatus = { icon: Ban, cls: 'text-gray-500', text: 'Invoice cancelled — its output VAT was voided.' }
  else if (invoice.outputVatEntryId) vatStatus = { icon: CheckCircle2, cls: 'text-green-600', text: 'Output VAT recorded for the VAT return.' }
  else vatStatus = { icon: ShieldAlert, cls: 'text-amber-600', text: 'Output VAT is not recorded yet — use Send to retry, or ask the tax team.' }
  const StatusIcon = vatStatus.icon

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <FileText className="w-4 h-4 text-gray-400" />
        <h2 className="text-sm font-semibold text-gray-900">VAT (Mushak-6.3)</h2>
        <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-indigo-50 text-indigo-700">{treatmentLabel}</span>
        {issued && (
          <div className="ml-auto flex items-center gap-2">
            <a href={`/api/invoices/${invoice.id}/mushak`} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800">
              <Printer className="w-3.5 h-3.5" /> Mushak-6.3
            </a>
            <a href={`/api/invoices/${invoice.id}/mushak?copy=duplicate`} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50">
              <Copy className="w-3.5 h-3.5" /> Duplicate copy
            </a>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <Field label="Taxable value">{money(taxable)}</Field>
        {sd > 0 && <Field label="SD">{money(sd)}</Field>}
        <Field label={invoiceVatLabel(invoice)}>{money(num(invoice.vatAmount))}</Field>
        {mfs > 0 && <Field label={`MFS charge (${invoice.taxRate ?? 0}%)`}><span className="text-gray-600">{money(mfs)}</span></Field>}
        <Field label="Service code">{invoice.serviceCode || <span className="text-gray-400">—</span>}</Field>
        <Field label="Tax point (issued)">{invoice.issuedAt ? fmtDateTime(invoice.issuedAt) : <span className="text-gray-400">{issued ? fmtDate(invoice.sentAt ?? invoice.issueDate) : 'On issue'}</span>}</Field>
        {invoice.deliveryDestination && <Field label="Delivery destination" className="col-span-2">{invoice.deliveryDestination}</Field>}
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="rounded-xl border border-gray-100 px-3 py-2.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Seller BIN</p>
          {sellerBin
            ? <p className="text-sm font-mono text-gray-900 mt-0.5">{sellerBin}</p>
            : <p className="text-xs text-amber-700 mt-0.5 flex items-center gap-1"><AlertTriangle className="w-3.5 h-3.5" /> Not set — Tax &amp; VAT → Tax Settings</p>}
          <p className="text-xs text-gray-500 truncate">{invoice.seller?.name || company.name || ''}</p>
        </div>
        <div className="rounded-xl border border-gray-100 px-3 py-2.5">
          <p className="text-[11px] font-medium uppercase tracking-wide text-gray-400">Buyer BIN</p>
          {buyerBin
            ? <p className="text-sm font-mono text-gray-900 mt-0.5">{buyerBin}</p>
            : <p className={cn('text-xs mt-0.5 flex items-center gap-1', needBuyerBin ? 'text-amber-700' : 'text-gray-400')}>
                {needBuyerBin && <AlertTriangle className="w-3.5 h-3.5" />}
                {needBuyerBin ? `Missing — required on Mushak-6.3 above Tk ${BUYER_BIN_THRESHOLD.toLocaleString('en-BD')}` : 'Not recorded'}
              </p>}
          <p className="text-xs text-gray-500 truncate">{invoice.buyer?.name || invoice.clientId?.company || invoice.clientId?.userId?.name || ''}</p>
        </div>
      </div>

      <p className={cn('flex items-start gap-2 text-xs', vatStatus.cls)}>
        <StatusIcon className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {vatStatus.text}
      </p>
    </div>
  )
}

// ─── Settlement breakdown ─────────────────────────────────────────────────────

function SettlementPanel({ invoice, money, refunded, canWithhold, onWithhold }) {
  const total    = num(invoice.total)
  const paid     = num(invoice.paidAmount)
  const vds      = num(invoice.withheldVds)
  const tds      = num(invoice.withheldTds)
  const credited = num(invoice.creditedAmount)
  const debited  = num(invoice.debitedAmount)
  const cash     = Math.max(0, Math.round((paid - vds - tds - credited) * 100) / 100)
  const due      = Math.max(0, Math.round((total - paid) * 100) / 100)

  const rows = [
    { label: 'Billed', value: total, sub: debited > 0 ? <>incl. debit notes {money(debited)}</> : null, strong: true },
    { label: 'Cash received', value: cash },
    { label: 'VAT deducted at source (VDS)', value: vds, hint: vds > 0 ? 'Collect the Mushak-6.6' : null },
    { label: 'Income tax deducted (TDS / AIT)', value: tds, hint: tds > 0 ? 'Collect the TDS certificate' : null },
    { label: 'Credit notes adjusted', value: credited },
  ]

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-5 space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Wallet className="w-4 h-4 text-gray-400" />
        <h2 className="text-sm font-semibold text-gray-900">Settlement</h2>
        {canWithhold && (
          <button type="button" onClick={onWithhold}
            className="ml-auto flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50">
            <Percent className="w-3.5 h-3.5" /> Record VDS/TDS withheld
          </button>
        )}
      </div>
      <div className="divide-y divide-gray-50">
        {rows.map(r => (
          <div key={r.label} className="flex items-start justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className={cn('text-sm', r.strong ? 'font-medium text-gray-900' : 'text-gray-600')}>{r.label}</p>
              {r.sub && <p className="text-xs text-gray-400">{r.sub}</p>}
              {r.hint && <p className="text-xs text-amber-600">{r.hint}</p>}
            </div>
            <p className={cn('text-sm whitespace-nowrap', r.strong ? 'font-semibold text-gray-900' : (r.value > 0 ? 'text-gray-900' : 'text-gray-300'))}>{money(r.value)}</p>
          </div>
        ))}
        {refunded > 0 && (
          <div className="flex items-start justify-between gap-3 py-2">
            <div>
              <p className="text-sm text-gray-600">Refunded to client</p>
              <p className="text-xs text-gray-400">Credit notes paid back (not part of the settled amount)</p>
            </div>
            <p className="text-sm text-gray-900 whitespace-nowrap">−{money(refunded)}</p>
          </div>
        )}
        <div className="flex items-center justify-between gap-3 pt-3">
          <p className="text-sm font-semibold text-gray-900">Due</p>
          <p className={cn('text-base font-bold whitespace-nowrap', due > 0.01 ? 'text-red-500' : 'text-green-600')}>{money(due)}</p>
        </div>
      </div>
    </div>
  )
}

// ─── Credit / debit notes on this invoice ─────────────────────────────────────

function NotesPanel({ invoice, notes, loading, error, money, canManage, canViewTax, onNew, onCancel }) {
  const noteable = NOTEABLE_STATUSES.includes(invoice.status)
  const reasonLabel = (v) => CREDIT_NOTE_REASONS.find(r => r.value === v)?.label ?? v

  return (
    <div className="bg-white rounded-2xl border border-gray-100 p-6">
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <FileMinus className="w-4 h-4 text-gray-400" />
        <h2 className="text-sm font-semibold text-gray-900">Credit &amp; debit notes</h2>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {canViewTax && notes.length > 0 && (
            <Link href={`/admin/tax/notes?invoiceId=${invoice.id}`} className="text-xs text-gray-500 hover:text-gray-800">View in Tax</Link>
          )}
          {canManage && noteable && (
            <>
              <button type="button" onClick={() => onNew('CREDIT')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50">
                <FileMinus className="w-3.5 h-3.5" /> Credit note
              </button>
              <button type="button" onClick={() => onNew('DEBIT')}
                className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 text-gray-700 rounded-lg hover:bg-gray-50">
                <FilePlus className="w-3.5 h-3.5" /> Debit note
              </button>
            </>
          )}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-gray-300" /></div>
      ) : error ? (
        <p className="text-sm text-red-600 text-center py-4">{error}</p>
      ) : notes.length === 0 ? (
        <p className="text-sm text-gray-400 text-center py-6">
          No notes on this invoice.{canManage && noteable ? ' Issue a credit note for a discount, cancelled or returned supply, or a debit note for an extra charge.' : ''}
        </p>
      ) : (
        <div className="divide-y divide-gray-50">
          {notes.map(n => {
            const debit = n.kind === 'DEBIT'
            const cancelled = n.status === 'CANCELLED'
            return (
              <div key={n.id} className={cn('flex flex-wrap items-start justify-between gap-3 py-3', cancelled && 'opacity-60')}>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-sm font-semibold text-gray-900">{n.noteNo}</span>
                    <span className={cn('inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium', debit ? 'bg-amber-50 text-amber-700' : 'bg-teal-50 text-teal-700')}>
                      {debit ? 'Debit · Mushak-6.8' : 'Credit · Mushak-6.7'}
                    </span>
                    {cancelled && <span className="inline-flex px-2 py-0.5 rounded-full text-[11px] font-medium bg-gray-100 text-gray-500">Cancelled</span>}
                  </div>
                  <p className="text-xs text-gray-500 mt-0.5">
                    {fmtDateTime(n.issuedAt)} · {reasonLabel(n.reason)}{n.reasonText ? ` — ${n.reasonText}` : ''}
                  </p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {debit ? 'Added to the invoice' : n.settlement === 'REFUND' ? `Refunded${n.refundAccountId?.name ? ` from ${n.refundAccountId.name}` : ''}` : 'Adjusted against the invoice'}
                    {num(n.vatAmount) > 0 && <> · VAT {money(n.vatAmount)}</>}
                    {cancelled && n.cancelReason ? ` · Cancelled: ${n.cancelReason}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className={cn('text-sm font-semibold whitespace-nowrap', debit ? 'text-amber-700' : 'text-teal-700')}>
                    {debit ? '+' : '−'}{money(n.totalAmount)}
                  </span>
                  <a href={`/api/credit-notes/${n.id}/print`} target="_blank" rel="noopener noreferrer" title="Print"
                    className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"><Printer className="w-4 h-4" /></a>
                  <a href={`/api/credit-notes/${n.id}/print?copy=duplicate`} target="_blank" rel="noopener noreferrer" title="Print duplicate"
                    className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100"><Copy className="w-4 h-4" /></a>
                  {canManage && !cancelled && (
                    <button type="button" onClick={() => onCancel(n)} title="Cancel note"
                      className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50"><Ban className="w-4 h-4" /></button>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export default function InvoiceDetailPage() {
  const { id }  = useParams()
  const router  = useRouter()
  const { can, ready } = usePermission()
  const [invoice,      setInvoice]      = useState(null)
  const [payments,     setPayments]     = useState([])
  const [loading,      setLoading]      = useState(true)
  const [statusModal,  setStatusModal]  = useState(false)
  const [paymentModal, setPaymentModal] = useState(false)
  const [printMode,    setPrintMode]    = useState(false)
  const [historyKey,   setHistoryKey]   = useState(0)
  const [company,      setCompany]      = useState({})
  const [combined,     setCombined]     = useState(null)
  const [siblingCount, setSiblingCount] = useState(0)
  const [notes,        setNotes]        = useState([])
  const [notesCtx,     setNotesCtx]     = useState(null)
  const [notesLoading, setNotesLoading] = useState(true)
  const [notesError,   setNotesError]   = useState(null)
  const [noteKind,     setNoteKind]     = useState(null)   // 'CREDIT' | 'DEBIT' while the note modal is open
  const [cancelNote,   setCancelNote]   = useState(null)
  const [withholdOpen, setWithholdOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const [invRes, pmtRes] = await Promise.all([
        fetch(`/api/invoices/${id}`),
        fetch(`/api/invoices/${id}/payment-request`),
      ])
      const invJson = await invRes.json()
      if (!invRes.ok) throw new Error(invJson.error)
      setInvoice(invJson.data)
      setCombined(invJson.combined ?? null)
      setSiblingCount(invJson.meta?.projectInvoiceCount ?? 0)
      if (pmtRes.ok) {
        const pmtJson = await pmtRes.json()
        setPayments((pmtJson.data ?? []).filter(p => p.status === 'CONFIRMED'))
      }
    } catch (err) { toast.error(err.message) }
    finally { setLoading(false) }
  }, [id])

  const loadNotes = useCallback(async () => {
    setNotesError(null)
    try {
      const res = await fetch(`/api/credit-notes?invoiceId=${id}&limit=100`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not load credit / debit notes')
      setNotes(json.data ?? [])
      setNotesCtx(json.context ?? null)
    } catch (err) {
      setNotesError(err.message)
    } finally {
      setNotesLoading(false)
    }
  }, [id])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadNotes() }, [loadNotes])

  useEffect(() => {
    fetch('/api/settings?group=company')
      .then(r => r.json())
      .then(j => {
        const d = j.data ?? {}
        setCompany({
          name:    d.company_name    ?? '',
          address: d.company_address ?? '',
          phone:   d.company_phone   ?? '',
          email:   d.company_email   ?? '',
          website: d.company_website ?? '',
          bin:     d.company_bin     ?? '',
          tin:     d.company_tin     ?? '',
        })
      })
      .catch(() => {})
  }, [])

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
  const canRecordPayment = !['DRAFT', 'PAID', 'CANCELLED'].includes(invoice.status)
  const balance = invoice.total - (invoice.paidAmount ?? 0)
  const cur     = (invoice.currency || 'BDT').toUpperCase()
  const money   = (n) => (cur === 'BDT' ? <TkAmt value={num(n)} decimals={2} /> : formatMoney(num(n), cur))
  const isVat   = isVatInvoice(invoice)
  const canNotes = ready && can('tax.notes.manage')
  const canViewTax = ready && can('tax.view')
  const canWithhold = ready && can('finance.payments.confirm') && WITHHOLDABLE_STATUSES.includes(invoice.status) && cur === 'BDT' && balance > 0.01
  const showNotes = invoice.status !== 'DRAFT' && (NOTEABLE_STATUSES.includes(invoice.status) || notes.length > 0)
  const refunded = num(notesCtx?.refunded)

  const reloadAll = () => { load(); loadNotes(); setHistoryKey(k => k + 1) }

  if (printMode) {
    return (
      <div>
        <div className="print:hidden flex items-center gap-3 mb-4 px-4 pt-4">
          <button onClick={() => setPrintMode(false)}
            className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-xl hover:bg-gray-50">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <button onClick={() => openInvoicePrint(invoice.invoiceNumber)}
            className="flex items-center gap-1.5 px-4 py-1.5 text-sm bg-blue-600 text-white rounded-xl hover:bg-blue-700">
            <Printer className="w-4 h-4" /> Print / Save PDF
          </button>
          {isVat && invoice.status !== 'DRAFT' && (
            <a href={`/api/invoices/${invoice.id}/mushak`} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-4 py-1.5 text-sm border border-gray-200 rounded-xl hover:bg-gray-50">
              <FileText className="w-4 h-4" /> Mushak-6.3
            </a>
          )}
        </div>
        <InvoicePrintView invoice={invoice} payments={payments} company={company} />
      </div>
    )
  }

  return (
    <div className="space-y-6 pb-10">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
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
        <div className="flex items-center gap-2 shrink-0 flex-wrap sm:justify-end">
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
          {isVat && invoice.status !== 'DRAFT' && (
            <a href={`/api/invoices/${invoice.id}/mushak`} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-indigo-50 text-indigo-700 rounded-xl hover:bg-indigo-100 transition-colors">
              <FileText className="w-4 h-4" /> Mushak-6.3
            </a>
          )}
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

      {/* Part of a combined invoice */}
      {combined && (
        <Link href={`/admin/invoices/combined/${combined.id}`}
          className="flex items-center justify-between gap-3 rounded-2xl border border-blue-100 bg-blue-50/70 px-5 py-3.5 hover:bg-blue-100/70 transition-colors">
          <div className="flex items-center gap-3 min-w-0">
            <Layers className="w-4 h-4 text-blue-600 shrink-0" />
            <div className="min-w-0">
              <p className="text-sm font-semibold text-blue-900">
                Part of combined invoice {combined.combinedNumber}
              </p>
              <p className="text-xs text-blue-700/80">
                This project carries {siblingCount} invoice{siblingCount === 1 ? '' : 's'} — the combined document
                re-totals itself whenever any of them changes.
              </p>
            </div>
          </div>
          <ExternalLink className="w-4 h-4 text-blue-500 shrink-0" />
        </Link>
      )}

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

      {/* VAT summary + settlement breakdown */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3">
          <VatPanel invoice={invoice} company={company} money={money} />
        </div>
        <div className="lg:col-span-2">
          <SettlementPanel
            invoice={invoice}
            money={money}
            refunded={refunded}
            canWithhold={canWithhold}
            onWithhold={() => setWithholdOpen(true)}
          />
        </div>
      </div>

      {/* Credit / debit notes */}
      {showNotes && (
        <NotesPanel
          invoice={invoice}
          notes={notes}
          loading={notesLoading}
          error={notesError}
          money={money}
          canManage={canNotes}
          canViewTax={canViewTax}
          onNew={kind => setNoteKind(kind)}
          onCancel={n => setCancelNote(n)}
        />
      )}

      {/* Invoice print preview */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-x-auto">
        <InvoicePrintView invoice={invoice} payments={payments} company={company} />
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
        <PaymentHistory key={historyKey} invoiceId={id} onChanged={() => { load(); loadNotes() }} />
      </div>

      {/* Modals */}
      {statusModal && (
        <StatusChangeModal
          invoice={invoice}
          onClose={() => setStatusModal(false)}
          onDone={() => { load(); loadNotes() }}
        />
      )}
      {paymentModal && (
        <RecordPaymentModal
          invoice={invoice}
          onClose={() => setPaymentModal(false)}
          onSaved={() => { load(); setHistoryKey(k => k + 1) }}
        />
      )}
      {withholdOpen && (
        <WithholdingModal
          invoice={invoice}
          open={withholdOpen}
          onOpenChange={setWithholdOpen}
          onSaved={reloadAll}
        />
      )}
      {noteKind && (
        <CreditNoteModal
          open={!!noteKind}
          onOpenChange={(v) => { if (!v) setNoteKind(null) }}
          invoice={invoice}
          initialKind={noteKind}
          onIssued={reloadAll}
        />
      )}
      {cancelNote && (
        <CancelNoteModal
          open={!!cancelNote}
          onOpenChange={(v) => { if (!v) setCancelNote(null) }}
          note={cancelNote}
          onCancelled={reloadAll}
        />
      )}
    </div>
  )
}
