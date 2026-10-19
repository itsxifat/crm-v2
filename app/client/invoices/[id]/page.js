'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { CreditCard, Printer, Layers, ChevronRight } from 'lucide-react'
import InvoicePrintView, { openInvoicePrint } from '@/components/shared/InvoicePrintView'
import { paymentSettlement, paymentMethodLabel, settlementParts } from '@/lib/paymentSettlement'
import { useConfig } from '@/lib/useConfig'
import { formatMoney } from '@/lib/currencies'
import PageHeader from '@/components/ui/PageHeader'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import { Input, Textarea, NativeSelect, Field } from '@/components/ui/Input'

const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
// Amounts are shown in the invoice's own currency, never a fixed ৳.
const fmtAmt  = (n, cur) => formatMoney(n, cur)

const STATUS_MAP = {
  DRAFT:          { label: 'Draft',            variant: 'default' },
  SENT:           { label: 'Awaiting payment', variant: 'primary' },
  PARTIALLY_PAID: { label: 'Partially paid',   variant: 'warning' },
  PAID:           { label: 'Paid',             variant: 'success' },
  OVERDUE:        { label: 'Overdue',          variant: 'danger'  },
  CANCELLED:      { label: 'Cancelled',        variant: 'default' },
}

const CONFIRM_STATUS = {
  PENDING_CONFIRMATION: { label: 'Pending approval', variant: 'warning' },
  CONFIRMED:            { label: 'Confirmed',        variant: 'success' },
  REJECTED:             { label: 'Rejected',         variant: 'danger'  },
  // A confirmed payment our finance team reversed (to be recorded again correctly).
  REVERSING:            { label: 'Confirmed',        variant: 'success' },
  REVERSED:             { label: 'Reversed',         variant: 'default' },
}

function PaymentModal({ invoice, onClose, onDone }) {
  const { paymentMethods } = useConfig()
  const [form, setForm]     = useState({ amount: '', method: 'BANK_TRANSFER', date: '', notes: '', receiptUrl: '' })
  const [saving, setSaving] = useState(false)

  const balance = (invoice.total ?? 0) - (invoice.paidAmount ?? 0)

  async function submit(e) {
    e.preventDefault()
    if (!form.amount || Number(form.amount) <= 0) return toast.error('Enter a valid amount')
    setSaving(true)
    try {
      const res = await fetch(`/api/invoices/${invoice.id}/payment-request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          amount:        Number(form.amount),
          paymentMethod: form.method,
          paymentDate:   form.date || undefined,
          notes:         form.notes || undefined,
          receiptUrl:    form.receiptUrl || undefined,
        }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Payment submitted')
      onDone()
      onClose()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal
      open
      onOpenChange={(o) => { if (!o) onClose() }}
      title="Submit payment"
      description={<>Balance due <span className="font-medium text-gray-900">{fmtAmt(balance, invoice?.currency)}</span></>}
    >
      <form onSubmit={submit} className="space-y-4">
        <Field label="Amount" required>
          <Input
            type="number" step="0.01" min="0.01" max={balance}
            value={form.amount}
            onChange={e => setForm(f => ({ ...f, amount: e.target.value }))}
            placeholder={balance.toFixed(2)}
            required
          />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Payment method">
            <NativeSelect
              value={form.method}
              onChange={e => setForm(f => ({ ...f, method: e.target.value }))}
            >
              {paymentMethods.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Payment date">
            <Input
              type="date"
              value={form.date}
              onChange={e => setForm(f => ({ ...f, date: e.target.value }))}
            />
          </Field>
        </div>
        <Field label="Receipt URL">
          <Input
            type="url"
            value={form.receiptUrl}
            onChange={e => setForm(f => ({ ...f, receiptUrl: e.target.value }))}
            placeholder="https://…"
          />
        </Field>
        <Field label="Notes">
          <Textarea
            value={form.notes}
            onChange={e => setForm(f => ({ ...f, notes: e.target.value }))}
            rows={2}
            className="min-h-0 resize-none"
          />
        </Field>
        <ModalFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={saving}>Submit payment</Button>
        </ModalFooter>
      </form>
    </Modal>
  )
}

export default function ClientInvoiceDetailPage() {
  const { id } = useParams()
  const router  = useRouter()
  const { paymentMethods } = useConfig()
  const fmtMethod = v => v ? (paymentMethods.find(m => m.value === v)?.label ?? v.replace(/_/g, ' ')) : '—'

  const [invoice,       setInvoice]       = useState(null)
  const [combined,      setCombined]      = useState(null)
  const [paymentReqs,   setPaymentReqs]   = useState([])
  const [company,       setCompany]       = useState({})
  const [loading,       setLoading]       = useState(true)
  const [showPayModal,  setShowPayModal]  = useState(false)

  async function load() {
    try {
      const [invRes, reqRes] = await Promise.all([
        fetch(`/api/client/invoices/${id}`),
        fetch(`/api/invoices/${id}/payment-request`),
      ])
      const invJson = await invRes.json()
      if (!invRes.ok) throw new Error(invJson.error ?? 'Not found')
      setInvoice(invJson.data)
      setCombined(invJson.combined ?? null)
      if (reqRes.ok) {
        const reqJson = await reqRes.json()
        setPaymentReqs(reqJson.data ?? [])
      }
    } catch (err) {
      toast.error(err.message)
      router.push('/client/invoices')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [id])

  // Company details for the invoice header — same source as the admin view
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
          // Seller BIN / TIN for VAT invoices (the issue-time snapshot on the invoice wins for the BIN).
          bin:     d.company_bin     ?? '',
          tin:     d.company_tin     ?? '',
        })
      })
      .catch(() => {})
  }, [])

  if (loading) return (
    <div className="animate-pulse space-y-6">
      <div className="space-y-2">
        <div className="h-4 w-20 rounded-md bg-gray-100" />
        <div className="h-7 w-48 rounded-md bg-gray-100" />
      </div>
      <div className="h-96 rounded-xl bg-gray-100" />
    </div>
  )

  if (!invoice) return null

  const status  = STATUS_MAP[invoice.status] ?? STATUS_MAP.DRAFT
  const canPay  = ['SENT', 'OVERDUE', 'PARTIALLY_PAID'].includes(invoice.status)
  // Only confirmed payments appear in the invoice's "Transaction Details" table
  const confirmedPayments = paymentReqs.filter(p => p.status === 'CONFIRMED')

  return (
    <div className="space-y-6">
      {showPayModal && (
        <PaymentModal invoice={invoice} onClose={() => setShowPayModal(false)} onDone={load} />
      )}

      <PageHeader
        back="/client/invoices"
        backLabel="Invoices"
        title={invoice.invoiceNumber}
        meta={<Badge variant={status.variant}>{status.label}</Badge>}
        description={invoice.projectId?.name ?? undefined}
        actions={
          <>
            <Button variant="outline" onClick={() => openInvoicePrint(invoice.invoiceNumber)}>
              <Printer /> Print / PDF
            </Button>
            {canPay && (
              <Button onClick={() => setShowPayModal(true)}>
                <CreditCard /> Pay now
              </Button>
            )}
          </>
        }
      />

      {/* Combined statement link */}
      {combined && (
        <Link href={`/client/invoices/combined/${combined.id}`}
          className="flex items-center justify-between gap-3 rounded-xl border border-gray-200/80 bg-white px-4 py-3 shadow-xs transition-colors hover:border-gray-300">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-gray-200/80 bg-white shadow-xs">
              <Layers className="size-4 text-gray-600" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900">Combined invoice {combined.combinedNumber}</p>
              <p className="text-[13px] text-muted-foreground">All invoices for this project in one document</p>
            </div>
          </div>
          <ChevronRight className="size-4 shrink-0 text-gray-400" />
        </Link>
      )}

      {/* Invoice — same layout as the admin panel */}
      <Card className="overflow-hidden">
        <InvoicePrintView invoice={invoice} payments={confirmedPayments} company={company} />
      </Card>

      {/* Payment submissions */}
      {paymentReqs.length > 0 && (
        <Card className="overflow-hidden">
          <CardHeader className="border-b border-gray-100 pb-3 pt-4">
            <CardTitle>Payment submissions</CardTitle>
          </CardHeader>
          <div className="divide-y divide-gray-100">
            {paymentReqs.map(req => {
              const cs = CONFIRM_STATUS[req.status] ?? CONFIRM_STATUS.PENDING_CONFIRMATION
              // What it settles on the invoice: cash + VAT / income tax withheld at
              // source (a withholding-only settlement has no cash).
              const s      = paymentSettlement(req)
              const reqCur = req.currency ?? invoice?.currency
              return (
                <div key={req._id ?? req.id} className="flex items-center justify-between gap-4 px-5 py-3.5">
                  <div className="min-w-0">
                    <p className="text-sm font-medium tabular-nums text-gray-900">{fmtAmt(s.settled, reqCur)}</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {s.withholdingOnly ? paymentMethodLabel(req.paymentMethod) : fmtMethod(req.paymentMethod)} · {fmtDate(req.paymentDate ?? req.createdAt)}
                    </p>
                    {s.hasWithholding && (
                      <p className="mt-0.5 text-xs text-gray-500">
                        {settlementParts(s).map(([k, v]) => `${k} ${fmtAmt(v, reqCur)}`).join(' · ')}
                      </p>
                    )}
                    {req.notes && <p className="mt-0.5 text-xs text-gray-500">{req.notes}</p>}
                  </div>
                  <Badge variant={cs.variant}>{cs.label}</Badge>
                </div>
              )
            })}
          </div>
        </Card>
      )}
    </div>
  )
}
