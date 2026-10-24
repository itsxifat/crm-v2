'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import {
  ArrowLeft, Pencil, Trash2, Send, Printer,
  X, Wallet, Clock, AlertTriangle, XCircle,
  PlusCircle, ExternalLink, CreditCard, Layers, ChevronRight,
  FileText, Copy, FileMinus, FilePlus, Percent, Ban, CheckCircle2, Info, ShieldAlert, RotateCcw, RefreshCw,
} from 'lucide-react'
import FileUpload from '@/components/ui/FileUpload'
import TkAmt from '@/components/ui/TkAmt'
import Select from '@/components/ui/Select'
import DatePicker from '@/components/ui/DatePicker'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Button, { buttonVariants } from '@/components/ui/Button'
import { Card, CardHeader, CardTitle, CardAction, CardContent } from '@/components/ui/Card'
import PageHeader from '@/components/ui/PageHeader'
import Badge from '@/components/ui/Badge'
import EmptyState from '@/components/ui/EmptyState'
import LoadingSpinner, { PageLoader } from '@/components/ui/LoadingSpinner'
import { Label, inputClass } from '@/components/ui/Input'
import InvoicePrintView, { openInvoicePrint, buyerBinOf } from '@/components/shared/InvoicePrintView'
import WithholdingFields, { emptyWithholding, invoiceAllowsVds } from '@/components/tax/WithholdingFields'
import ReverseClientPaymentModal from '@/components/finance/ReverseClientPaymentModal'
import InvoiceOnlinePanel from '@/components/admin/invoices/InvoiceOnlinePanel'
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
  DRAFT:          { variant: 'default', label: 'Draft' },
  SENT:           { variant: 'primary', label: 'Sent' },
  PARTIALLY_PAID: { variant: 'warning', label: 'Partially paid' },
  PAID:           { variant: 'success', label: 'Paid' },
  OVERDUE:        { variant: 'danger',  label: 'Overdue' },
  CANCELLED:      { variant: 'outline', label: 'Cancelled' },
}


const CONFIRMATION_STATUS = {
  PENDING_CONFIRMATION: { variant: 'warning', label: 'Pending approval' },
  CONFIRMED:            { variant: 'success', label: 'Confirmed' },
  REJECTED:             { variant: 'danger',  label: 'Rejected' },
  REVERSING:            { variant: 'orange',  label: 'Reversing…' },
  REVERSED:             { variant: 'default', label: 'Reversed' },
}

// PAID is set automatically when payment is fully confirmed — it cannot be set manually
const TRANSITION_ACTIONS = {
  DRAFT: [
    { action: 'SENT',      label: 'Mark as sent',    icon: Send },
    { action: 'CANCELLED', label: 'Cancel invoice',  icon: XCircle, danger: true },
  ],
  SENT: [
    { action: 'PARTIALLY_PAID', label: 'Partial payment', icon: Wallet },
    { action: 'OVERDUE',        label: 'Mark overdue',    icon: AlertTriangle },
    { action: 'CANCELLED',      label: 'Cancel invoice',  icon: XCircle, danger: true },
  ],
  PARTIALLY_PAID: [
    { action: 'OVERDUE',   label: 'Mark overdue',   icon: AlertTriangle },
  ],
  OVERDUE: [
    { action: 'PARTIALLY_PAID', label: 'Back to partial', icon: Wallet },
    { action: 'CANCELLED',      label: 'Cancel invoice',  icon: XCircle, danger: true },
  ],
  PAID:      [],
  CANCELLED: [],
}

const NOTEABLE_STATUSES = ['SENT', 'PARTIALLY_PAID', 'OVERDUE', 'PAID']
const WITHHOLDABLE_STATUSES = ['SENT', 'PARTIALLY_PAID', 'OVERDUE']

const warnIcon = <AlertTriangle className="size-4 shrink-0 text-amber-600" />

// Hand-built dialog shell (matches components/ui/Modal).
function DialogShell({ title, description, onClose, maxWidth = 'max-w-md', children, footer }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]">
      <div className={cn('flex max-h-[92vh] w-full flex-col rounded-2xl border border-gray-200/80 bg-white shadow-2xl', maxWidth)}>
        <div className="flex shrink-0 items-start justify-between gap-4 px-6 pb-3 pt-5">
          <div className="min-w-0">
            <h3 className="text-base font-semibold tracking-tight text-gray-900">{title}</h3>
            {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close" className="-mr-1.5 -mt-0.5 text-gray-400">
            <X />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 pb-5 pt-1">{children}</div>
        <div className="flex shrink-0 justify-end gap-2 rounded-b-2xl border-t border-gray-100 bg-gray-50/60 px-6 py-3.5">
          {footer}
        </div>
      </div>
    </div>
  )
}

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
      toast.success(action === 'SENT' && vat ? 'Invoice issued — output VAT recorded' : 'Status updated')
      if (json.warning) toast(json.warning, { icon: warnIcon, duration: 9000 })
      onDone()
      onClose()
    } catch (err) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  if (actions.length === 0) return null

  return (
    <DialogShell
      title="Update status"
      onClose={onClose}
      maxWidth="max-w-sm"
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={submit} disabled={!action} loading={saving}>Confirm</Button>
        </>
      }
    >
      <div className="space-y-2">
        {actions.map(a => {
          const Icon = a.icon
          const selected = action === a.action
          return (
            <button key={a.action} onClick={() => setAction(a.action)}
              className={cn(
                'flex w-full items-center gap-3 rounded-lg border px-3.5 py-2.5 text-left transition-colors',
                selected ? 'border-gray-900 bg-gray-50 ring-1 ring-gray-900' : 'border-gray-200 hover:bg-gray-50'
              )}>
              <Icon className={cn('size-4', a.danger ? 'text-red-500' : 'text-gray-500')} />
              <span className="text-sm font-medium text-gray-900">{a.label}</span>
            </button>
          )
        })}
      </div>
      {action === 'PARTIALLY_PAID' && (
        <p className="mt-3 text-[13px] text-muted-foreground">
          Paid amount comes from confirmed payments only.
        </p>
      )}
      {action === 'SENT' && vat && (
        <p className="mt-3 text-[13px] text-muted-foreground">
          Issuing fixes the VAT tax point and both BINs, and records output VAT.
        </p>
      )}
      {action === 'CANCELLED' && vat && invoice.status !== 'DRAFT' && (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          Voids the output VAT. If it&apos;s in a filed return, issue a credit note (Mushak-6.7) instead.
        </p>
      )}
    </DialogShell>
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

  const ic = inputClass
  return (
    <DialogShell
      title="Record payment"
      description="Accounts confirms it before it counts as income."
      onClose={onClose}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={save} loading={saving}>
            {!saving && <CreditCard />} Record payment
          </Button>
        </>
      }
    >
      <div className="grid grid-cols-2 gap-4">
        <div>
          <Label required>Amount (BDT)</Label>
          <input type="number" step="0.01" min="0" value={form.amount} onChange={e => setForm(f => ({ ...f, amount: e.target.value }))} onKeyDown={e => { if (e.key === '-' || e.key === 'e') e.preventDefault() }} placeholder="0.00" className={ic} />
        </div>
        <div>
          <Label>Method</Label>
          <Select value={form.paymentMethod} onChange={v => setForm(f => ({ ...f, paymentMethod: v ?? 'BANK_TRANSFER' }))}
            options={paymentMethods}
            placeholder="Select…"
          />
        </div>
        <div>
          <Label>Payment date</Label>
          <DatePicker value={form.paymentDate || null} onChange={v => setForm(f => ({ ...f, paymentDate: v ?? '' }))} />
        </div>
        <div>
          <Label>Description</Label>
          <input value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} placeholder="Optional" className={ic} />
        </div>
        <div className="col-span-2">
          <FileUpload
            label={<>Payment proof<span className="ml-0.5 text-red-500">*</span></>}
            value={form.receiptUrl}
            onUploaded={url => setForm(f => ({ ...f, receiptUrl: url }))}
          />
        </div>
      </div>
    </DialogShell>
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
      toast.success('Withholding recorded')
      if (json.warning) toast(json.warning, { icon: warnIcon, duration: 8000 })
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
      title="Record VDS / TDS withheld"
      description={`${invoice.invoiceNumber} · due ${fmt(due)}`} size="lg">
      <div className="space-y-4">
        <p className="text-[13px] text-muted-foreground"
          title="Use this when the client deducted VAT (VDS) or income tax (TDS / AIT) at source and paid us the rest. Cash received is recorded separately through Record payment.">
          Settles the invoice like cash. Collect the Mushak-6.6 / TDS certificate.
        </p>
        <div className="grid grid-cols-3 gap-3 rounded-lg bg-gray-50 px-4 py-3 text-xs text-muted-foreground">
          <span>Taxable value<span className="mt-0.5 block text-sm font-semibold tabular-nums text-gray-900">{fmt(taxable)}</span></span>
          <span>VAT<span className="mt-0.5 block text-sm font-semibold tabular-nums text-gray-900">{fmt(vat)}</span></span>
          <span>Due<span className="mt-0.5 block text-sm font-semibold tabular-nums text-gray-900">{fmt(due)}</span></span>
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
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label required>Date withheld</Label>
            <DatePicker value={date} onChange={v => setDate(v ?? dhakaDayKey())} clearable={false} />
          </div>
          <div>
            <Label>Note</Label>
            <input value={note} onChange={e => setNote(e.target.value)} maxLength={500} placeholder="Optional"
              className={inputClass} />
          </div>
        </div>
        <div className="flex items-center justify-between rounded-lg border border-gray-200/80 px-4 py-3">
          <span className="text-sm text-muted-foreground">Settles</span>
          <span className={cn('text-sm font-semibold tabular-nums', over ? 'text-red-600' : 'text-gray-900')}>{fmt(withheld)} of {fmt(due)} due</span>
        </div>
        {over && <p className="text-xs text-red-600">Withheld total is more than the amount due.</p>}
      </div>
      <ModalFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
        <Button onClick={submit} disabled={withheld <= 0 || over} loading={saving}>
          {!saving && <Percent />} Record withholding
        </Button>
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

  if (loading) return <LoadingSpinner size="sm" className="py-6" />

  if (payments.length === 0) return (
    <p className="py-6 text-center text-sm text-muted-foreground">No payment requests yet</p>
  )

  return (
    <div className="divide-y divide-gray-100">
      {payments.map(p => {
        const cs = CONFIRMATION_STATUS[p.status] ?? CONFIRMATION_STATUS.PENDING_CONFIRMATION
        const vds = num(p.vdsAmount)
        const tds = num(p.tdsAmount)
        return (
          <div key={p.id} className="flex items-start justify-between gap-4 py-3.5 first:pt-0 last:pb-0">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <span className="text-sm font-semibold tabular-nums text-gray-900">{fmt(p.amount)}</span>
                <span className="text-xs text-muted-foreground">{p.paymentMethod === 'WITHHOLDING' ? 'Withholding only' : fmtMethod(p.paymentMethod)}</span>
                <Badge variant={cs.variant}>{cs.label}</Badge>
              </div>
              {(vds > 0 || tds > 0) && (
                <p className="mt-0.5 text-xs text-gray-600">
                  {vds > 0 && <>VDS {fmt(vds)}</>}{vds > 0 && tds > 0 && ' · '}{tds > 0 && <>TDS {fmt(tds)}</>} withheld by client
                </p>
              )}
              {p.description && <p className="mt-0.5 text-xs text-gray-600">{p.description}</p>}
              <p className="mt-0.5 text-xs text-muted-foreground">
                {fmtDate(p.paymentDate)}
                {p.submittedBy?.name && ` · Submitted by ${p.submittedBy.name}`}
                {p.confirmedBy?.name && ` · Reviewed by ${p.confirmedBy.name}`}
              </p>
              {p.status === 'REJECTED' && p.rejectionNote && (
                <p className="mt-1 text-xs text-red-600">Rejected: {p.rejectionNote}</p>
              )}
              {p.status === 'REVERSED' && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Reversed{p.reversedAt ? ` ${fmtDate(p.reversedAt)}` : ''}{p.reversedBy?.name ? ` by ${p.reversedBy.name}` : ''}
                  {p.reversalTransactionId?.txnId ? ` (${p.reversalTransactionId.txnId})` : ''}
                  {p.reversalReason ? ` — ${p.reversalReason}` : ''}
                </p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-1">
              {p.receiptUrl && (
                <a href={p.receiptUrl} target="_blank" rel="noreferrer"
                  className={buttonVariants({ variant: 'ghost', size: 'xs' })}>
                  <ExternalLink /> Proof
                </a>
              )}
              {p.status === 'PENDING_CONFIRMATION' && (
                <Link href="/admin/accounts?tab=confirmations"
                  className={cn(buttonVariants({ variant: 'ghost', size: 'xs' }), 'text-amber-700 hover:text-amber-800')}>
                  <Clock /> Review
                </Link>
              )}
              {p.status === 'CONFIRMED' && canReverse && (
                <Button variant="ghost" size="xs" onClick={() => setReversing(p)}
                  title="Reverse this payment (wrong amount, account, VDS / TDS or date)"
                  className="text-red-600 hover:bg-red-50 hover:text-red-700">
                  <RotateCcw /> Reverse
                </Button>
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
      <p className="text-xs text-muted-foreground">{label}</p>
      <div className="mt-0.5 break-words text-sm font-medium text-gray-900">{children}</div>
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
      <Card className="h-full p-5">
        <div className="mb-2 flex items-center gap-2">
          <CardTitle>VAT</CardTitle>
          <Badge className="ml-auto">No VAT</Badge>
        </div>
        <p className="text-sm text-muted-foreground"
          title="This invoice carries no VAT treatment, so it is not a tax invoice (Mushak-6.3) and has no output VAT.">
          Not a tax invoice (Mushak-6.3) — no output VAT.
          {invoice.status === 'DRAFT' && ' Edit the draft to set a VAT treatment.'}
        </p>
        {mfs > 0 && <p className="mt-2 text-xs text-muted-foreground">MFS charge {invoice.taxRate ?? 0}% ({money(mfs)}) is a payment surcharge, not VAT.</p>}
      </Card>
    )
  }

  let vatStatus
  if (invoice.status === 'DRAFT') vatStatus = { icon: Info, cls: 'text-muted-foreground', text: 'Output VAT is recorded on issue (marked as sent).' }
  else if (invoice.status === 'CANCELLED') vatStatus = { icon: Ban, cls: 'text-muted-foreground', text: 'Cancelled — output VAT voided.' }
  else if (invoice.outputVatEntryId) vatStatus = { icon: CheckCircle2, cls: 'text-emerald-600', text: 'Output VAT recorded for the VAT return.' }
  else vatStatus = { icon: ShieldAlert, cls: 'text-amber-700', text: 'Output VAT not recorded yet — use Send to retry, or ask the tax team.' }
  const StatusIcon = vatStatus.icon

  return (
    <Card className="h-full space-y-4 p-5">
      <div className="flex flex-wrap items-center gap-2">
        <CardTitle>VAT (Mushak-6.3)</CardTitle>
        <Badge variant="indigo">{treatmentLabel}</Badge>
        {issued && (
          <div className="ml-auto flex items-center gap-1.5">
            <a href={`/api/invoices/${invoice.id}/mushak`} target="_blank" rel="noopener noreferrer"
              className={buttonVariants({ variant: 'outline', size: 'xs' })}>
              <Printer /> Mushak-6.3
            </a>
            <a href={`/api/invoices/${invoice.id}/mushak?copy=duplicate`} target="_blank" rel="noopener noreferrer"
              className={buttonVariants({ variant: 'ghost', size: 'xs' })}>
              <Copy /> Duplicate
            </a>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Field label="Taxable value">{money(taxable)}</Field>
        {sd > 0 && <Field label="SD">{money(sd)}</Field>}
        <Field label={invoiceVatLabel(invoice)}>{money(num(invoice.vatAmount))}</Field>
        {mfs > 0 && <Field label={`MFS charge (${invoice.taxRate ?? 0}%)`}><span className="text-gray-600">{money(mfs)}</span></Field>}
        <Field label="Service code">{invoice.serviceCode || <span className="text-gray-400">—</span>}</Field>
        <Field label="Tax point (issued)">{invoice.issuedAt ? fmtDateTime(invoice.issuedAt) : <span className="font-normal text-muted-foreground">{issued ? fmtDate(invoice.sentAt ?? invoice.issueDate) : 'On issue'}</span>}</Field>
        {invoice.deliveryDestination && <Field label="Delivery destination" className="col-span-2">{invoice.deliveryDestination}</Field>}
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <div className="rounded-lg bg-gray-50 px-3 py-2.5">
          <p className="text-xs text-muted-foreground">Seller BIN</p>
          {sellerBin
            ? <p className="mt-0.5 font-mono text-sm text-gray-900">{sellerBin}</p>
            : <p className="mt-0.5 flex items-center gap-1 text-xs text-amber-700"><AlertTriangle className="size-3.5" /> Not set — Tax &amp; VAT → Tax Settings</p>}
          <p className="truncate text-xs text-muted-foreground">{invoice.seller?.name || company.name || ''}</p>
        </div>
        <div className="rounded-lg bg-gray-50 px-3 py-2.5">
          <p className="text-xs text-muted-foreground">Buyer BIN</p>
          {buyerBin
            ? <p className="mt-0.5 font-mono text-sm text-gray-900">{buyerBin}</p>
            : <p className={cn('mt-0.5 flex items-center gap-1 text-xs', needBuyerBin ? 'text-amber-700' : 'text-gray-400')}>
                {needBuyerBin && <AlertTriangle className="size-3.5" />}
                {needBuyerBin ? `Missing — required on Mushak-6.3 above Tk ${BUYER_BIN_THRESHOLD.toLocaleString('en-BD')}` : 'Not recorded'}
              </p>}
          <p className="truncate text-xs text-muted-foreground">{invoice.buyer?.name || invoice.clientId?.company || invoice.clientId?.userId?.name || ''}</p>
        </div>
      </div>

      <p className={cn('flex items-start gap-2 text-xs', vatStatus.cls)}>
        <StatusIcon className="mt-px size-3.5 shrink-0" /> {vatStatus.text}
      </p>
    </Card>
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
    <Card className="h-full p-5">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <CardTitle>Settlement</CardTitle>
        {canWithhold && (
          <Button variant="outline" size="xs" onClick={onWithhold} className="ml-auto">
            <Percent /> Record VDS/TDS
          </Button>
        )}
      </div>
      <div className="divide-y divide-gray-100">
        {rows.map(r => (
          <div key={r.label} className="flex items-start justify-between gap-3 py-2">
            <div className="min-w-0">
              <p className={cn('text-sm', r.strong ? 'font-medium text-gray-900' : 'text-gray-600')}>{r.label}</p>
              {r.sub && <p className="text-xs text-muted-foreground">{r.sub}</p>}
              {r.hint && <p className="text-xs text-amber-700">{r.hint}</p>}
            </div>
            <p className={cn('whitespace-nowrap text-sm tabular-nums', r.strong ? 'font-semibold text-gray-900' : (r.value > 0 ? 'text-gray-900' : 'text-gray-300'))}>{money(r.value)}</p>
          </div>
        ))}
        {refunded > 0 && (
          <div className="flex items-start justify-between gap-3 py-2">
            <div>
              <p className="text-sm text-gray-600">Refunded to client</p>
              <p className="text-xs text-muted-foreground">Not part of the settled amount</p>
            </div>
            <p className="whitespace-nowrap text-sm tabular-nums text-gray-900">−{money(refunded)}</p>
          </div>
        )}
        <div className="flex items-center justify-between gap-3 pt-3">
          <p className="text-sm font-semibold text-gray-900">Due</p>
          <p className={cn('whitespace-nowrap text-base font-semibold tabular-nums', due > 0.01 ? 'text-red-600' : 'text-emerald-600')}>{money(due)}</p>
        </div>
      </div>
    </Card>
  )
}

// ─── Credit / debit notes on this invoice ─────────────────────────────────────

function NotesPanel({ invoice, notes, loading, error, money, canManage, canViewTax, onNew, onCancel }) {
  const noteable = NOTEABLE_STATUSES.includes(invoice.status)
  const reasonLabel = (v) => CREDIT_NOTE_REASONS.find(r => r.value === v)?.label ?? v

  return (
    <Card>
      <CardHeader>
        <CardTitle>Credit &amp; debit notes</CardTitle>
        <CardAction className="flex-wrap justify-end gap-1.5">
          {canViewTax && notes.length > 0 && (
            <Link href={`/admin/tax/notes?invoiceId=${invoice.id}`} className={buttonVariants({ variant: 'ghost', size: 'xs' })}>View in Tax</Link>
          )}
          {canManage && noteable && (
            <>
              <Button variant="outline" size="xs" onClick={() => onNew('CREDIT')}>
                <FileMinus /> Credit note
              </Button>
              <Button variant="outline" size="xs" onClick={() => onNew('DEBIT')}>
                <FilePlus /> Debit note
              </Button>
            </>
          )}
        </CardAction>
      </CardHeader>

      <CardContent>
        {loading ? (
          <LoadingSpinner size="sm" className="py-6" />
        ) : error ? (
          <p className="py-4 text-center text-sm text-red-600">{error}</p>
        ) : notes.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground"
            title={canManage && noteable ? 'Issue a credit note for a discount, cancelled or returned supply, or a debit note for an extra charge.' : undefined}>
            No notes yet
          </p>
        ) : (
          <div className="divide-y divide-gray-100">
            {notes.map(n => {
              const debit = n.kind === 'DEBIT'
              const cancelled = n.status === 'CANCELLED'
              return (
                <div key={n.id} className={cn('flex flex-wrap items-start justify-between gap-3 py-3 first:pt-0 last:pb-0', cancelled && 'opacity-60')}>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-semibold text-gray-900">{n.noteNo}</span>
                      <Badge variant={debit ? 'warning' : 'teal'}>
                        {debit ? 'Debit · Mushak-6.8' : 'Credit · Mushak-6.7'}
                      </Badge>
                      {cancelled && <Badge>Cancelled</Badge>}
                    </div>
                    <p className="mt-0.5 text-xs text-gray-600">
                      {fmtDateTime(n.issuedAt)} · {reasonLabel(n.reason)}{n.reasonText ? ` — ${n.reasonText}` : ''}
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {debit ? 'Added to the invoice' : n.settlement === 'REFUND' ? `Refunded${n.refundAccountId?.name ? ` from ${n.refundAccountId.name}` : ''}` : 'Adjusted against the invoice'}
                      {num(n.vatAmount) > 0 && <> · VAT {money(n.vatAmount)}</>}
                      {cancelled && n.cancelReason ? ` · Cancelled: ${n.cancelReason}` : ''}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1">
                    <span className={cn('mr-2 whitespace-nowrap text-sm font-semibold tabular-nums', debit ? 'text-amber-700' : 'text-teal-700')}>
                      {debit ? '+' : '−'}{money(n.totalAmount)}
                    </span>
                    <a href={`/api/credit-notes/${n.id}/print`} target="_blank" rel="noopener noreferrer" title="Print" aria-label="Print"
                      className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'text-gray-500')}><Printer /></a>
                    <a href={`/api/credit-notes/${n.id}/print?copy=duplicate`} target="_blank" rel="noopener noreferrer" title="Print duplicate" aria-label="Print duplicate"
                      className={cn(buttonVariants({ variant: 'ghost', size: 'icon-sm' }), 'text-gray-500')}><Copy /></a>
                    {canManage && !cancelled && (
                      <Button variant="ghost" size="icon-sm" onClick={() => onCancel(n)} title="Cancel note" aria-label="Cancel note"
                        className="text-gray-500 hover:bg-red-50 hover:text-red-600"><Ban /></Button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </CardContent>
    </Card>
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
    if (!confirm(`Delete invoice ${invoice?.invoiceNumber}? This can't be undone.`)) return
    try {
      const res = await fetch(`/api/invoices/${id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Invoice deleted')
      router.push('/admin/invoices')
    } catch (err) { toast.error(err.message) }
  }

  if (loading) return <PageLoader />
  if (!invoice) return (
    <EmptyState
      icon={FileText}
      title="Invoice not found"
      action={<Button variant="outline" size="sm" href="/admin/invoices">Back to invoices</Button>}
    />
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
        <div className="mb-4 flex flex-wrap items-center gap-2 print:hidden">
          <Button variant="outline" onClick={() => setPrintMode(false)}>
            <ArrowLeft /> Back
          </Button>
          <Button onClick={() => openInvoicePrint(invoice.invoiceNumber)}>
            <Printer /> Print / save PDF
          </Button>
          {isVat && invoice.status !== 'DRAFT' && (
            <a href={`/api/invoices/${invoice.id}/mushak`} target="_blank" rel="noopener noreferrer"
              className={buttonVariants({ variant: 'outline' })}>
              <FileText /> Mushak-6.3
            </a>
          )}
        </div>
        <InvoicePrintView invoice={invoice} payments={payments} company={company} />
      </div>
    )
  }

  const due = Math.max(0, invoice.total - (invoice.paidAmount ?? 0))

  return (
    <div className="space-y-6 pb-10">
      <PageHeader
        back="/admin/invoices"
        backLabel="Invoices"
        title={invoice.invoiceNumber}
        meta={<Badge variant={s.variant} dot>{s.label}</Badge>}
        description={<>{invoice.clientId?.userId?.name} {invoice.clientId?.company ? `· ${invoice.clientId.company}` : ''}</>}
        actions={
          <>
            {invoice.status === 'DRAFT' && (
              <Button variant="ghost" size="icon" onClick={handleDelete} title="Delete" aria-label="Delete invoice"
                className="text-gray-500 hover:bg-red-50 hover:text-red-600">
                <Trash2 />
              </Button>
            )}
            {invoice.status === 'DRAFT' && (
              <Button variant="outline" href={`/admin/invoices/${id}/edit`}>
                <Pencil /> Edit
              </Button>
            )}
            {isVat && invoice.status !== 'DRAFT' && (
              <a href={`/api/invoices/${invoice.id}/mushak`} target="_blank" rel="noopener noreferrer"
                className={buttonVariants({ variant: 'outline' })}>
                <FileText /> Mushak-6.3
              </a>
            )}
            <Button variant="outline" onClick={() => setPrintMode(true)}>
              <Printer /> Print / PDF
            </Button>
            {actions.length > 0 && (
              <Button variant={canRecordPayment ? 'outline' : 'default'} onClick={() => setStatusModal(true)}>
                <RefreshCw /> Update status
              </Button>
            )}
            {/* Record payment — shown for SENT / PARTIALLY_PAID / OVERDUE */}
            {canRecordPayment && (
              <Button onClick={() => setPaymentModal(true)}>
                <PlusCircle /> Record payment
              </Button>
            )}
          </>
        }
      />

      {/* Part of a combined invoice */}
      {combined && (
        <Link href={`/admin/invoices/combined/${combined.id}`}
          className="flex items-center justify-between gap-3 rounded-xl border border-gray-200/80 bg-white px-4 py-3 shadow-xs transition-colors hover:bg-gray-50/70"
          title="The combined document re-totals itself whenever any of the project's invoices changes.">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-gray-200/80 bg-white shadow-xs">
              <Layers className="size-4 text-gray-600" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">
                Part of combined invoice {combined.combinedNumber}
              </p>
              <p className="text-xs text-muted-foreground">
                {siblingCount} invoice{siblingCount === 1 ? '' : 's'} on this project
              </p>
            </div>
          </div>
          <ChevronRight className="size-4 shrink-0 text-gray-400" />
        </Link>
      )}

      {/* Payable / Paid / Due summary + progress */}
      <Card className="p-5">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <p className="text-[13px] font-medium text-muted-foreground">Payable</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight text-gray-900"><TkAmt value={invoice.total} decimals={2} /></p>
          </div>
          <div>
            <p className="text-[13px] font-medium text-muted-foreground">Paid</p>
            <p className="mt-1 text-2xl font-semibold tracking-tight text-emerald-600"><TkAmt value={invoice.paidAmount ?? 0} decimals={2} /></p>
          </div>
          <div>
            <p className="text-[13px] font-medium text-muted-foreground">Due</p>
            <p className={cn('mt-1 text-2xl font-semibold tracking-tight', (invoice.total - (invoice.paidAmount ?? 0)) > 0.01 ? 'text-red-600' : 'text-emerald-600')}>
              <TkAmt value={due} decimals={2} />
            </p>
          </div>
        </div>

        {/* Payment progress (shown when partially/fully paid) */}
        {invoice.paidAmount > 0 && (
          <div className="mt-5 border-t border-gray-100 pt-4">
            <div className="h-1.5 overflow-hidden rounded-full bg-gray-100">
              <div
                className="h-full rounded-full bg-emerald-500 transition-all"
                style={{ width: `${Math.min(100, (invoice.paidAmount / invoice.total) * 100).toFixed(1)}%` }}
              />
            </div>
            <div className="mt-2 flex justify-between text-xs">
              <span className="font-medium text-emerald-600">
                {((invoice.paidAmount / invoice.total) * 100).toFixed(0)}% paid
              </span>
              {balance > 0 && <span className="font-medium text-amber-700">Balance <TkAmt value={balance} decimals={2} /></span>}
            </div>
          </div>
        )}
      </Card>

      {/* Online payment (Enfinito Pay link) + client files lock (encloud) */}
      {invoice.status !== 'DRAFT' && <InvoiceOnlinePanel invoice={invoice} />}

      {/* VAT summary + settlement breakdown */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-5">
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
      <Card className="overflow-x-auto">
        <InvoicePrintView invoice={invoice} payments={payments} company={company} />
      </Card>

      {/* Payment history */}
      <Card>
        <CardHeader>
          <CardTitle>Payment requests</CardTitle>
          {canRecordPayment && (
            <CardAction>
              <Button variant="ghost" size="xs" onClick={() => setPaymentModal(true)}>
                <PlusCircle /> Add payment
              </Button>
            </CardAction>
          )}
        </CardHeader>
        <CardContent>
          <PaymentHistory key={historyKey} invoiceId={id} onChanged={() => { load(); loadNotes() }} />
        </CardContent>
      </Card>

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
