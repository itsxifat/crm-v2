'use client'

import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import {
  AlertTriangle, Banknote, CheckCircle2, Info, PackageCheck, Send, Wallet, Archive,
} from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { Field, Input, Label, NativeSelect } from '@/components/ui/Input'
import DatePicker from '@/components/ui/DatePicker'
import FileUpload from '@/components/ui/FileUpload'
import MoneyAccountSelect, { invalidateMoneyAccounts } from '@/components/finance/MoneyAccountSelect'
import { usePermission } from '@/components/auth/Can'
import { useConfig } from '@/lib/useConfig'
import { cn } from '@/lib/utils'
import { dhakaDayKey } from '@/lib/dhakaTime'
import { PAYMENT_CHANNELS, channelFromPaymentMethod, isBankingChannel } from '@/lib/finance/constants'
import { num, tk, qtyText } from './billMath'

const MODES = [
  {
    value: 'PAY_NOW',
    title: 'Pay now',
    desc: 'From a bank, cash or wallet account.',
    tip: 'Posts the expense, input VAT and withholding now.',
    icon: Wallet,
  },
  {
    value: 'REQUEST',
    title: 'Send to Accounts',
    desc: 'Finance pays it from Payment requests.',
    tip: 'Creates a payment request in Accounts → Payment requests.',
    icon: Send,
  },
  {
    value: 'PAID_OUTSIDE',
    title: 'Already paid outside',
    desc: 'Historical — no expense or money movement.',
    tip: 'Historical purchase — no expense or money movement is recorded.',
    icon: Archive,
  },
]

/**
 * Receive a DRAFT bill (mode 'receive') or settle the payment of a RECEIVED bill
 * (mode 'settle'). Calls POST /receive or POST /payment and hands the updated
 * bill to onDone(bill, warning).
 */
export default function ReceiveDialog({ open, onOpenChange, bill, mode = 'receive', settings, onDone }) {
  const { can } = usePermission()
  const { paymentMethods } = useConfig()
  const canPayNow = can('finance.payments.confirm')
  const today = dhakaDayKey(new Date())
  const isSettle = mode === 'settle'
  const requestPending = isSettle && bill?.payment?.status === 'REQUESTED'

  const [receivedAt, setReceivedAt] = useState(today)
  const [payMode, setPayMode] = useState('REQUEST')
  const [accountId, setAccountId] = useState(null)
  const [account, setAccount] = useState(null)
  const [paymentMethod, setPaymentMethod] = useState('')
  const [channel, setChannel] = useState('')
  const [channelTouched, setChannelTouched] = useState(false)
  const [paidAt, setPaidAt] = useState(today)
  const [reference, setReference] = useState('')
  const [proofUrl, setProofUrl] = useState('')
  const [note, setNote] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) return
    setReceivedAt(today)
    setPayMode(requestPending ? 'PAY_NOW' : (bill?.payment?.mode === 'PAY_NOW' && canPayNow ? 'PAY_NOW' : 'REQUEST'))
    setAccountId(null)
    setAccount(null)
    setPaymentMethod('')
    setChannel('')
    setChannelTouched(false)
    setPaidAt(today)
    setReference('')
    setProofUrl('')
    setNote('')
    setError(null)
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  // Channel follows the method / account until the user picks one.
  useEffect(() => {
    if (channelTouched) return
    const next = channelFromPaymentMethod(paymentMethod || null, account) ?? ''
    setChannel(next)
  }, [paymentMethod, account, channelTouched])

  const lines = useMemo(() => bill?.lines ?? [], [bill])
  const summary = useMemo(() => {
    const assets = lines.filter(l => l.lineType === 'ASSET').reduce((s, l) => s + num(l.qty), 0)
    const assigned = lines.filter(l => l.lineType === 'ASSET' && l.assignEmployeeId).reduce((s, l) => s + num(l.qty), 0)
    const stock = lines.filter(l => l.lineType === 'CONSUMABLE')
    const expense = lines.filter(l => l.lineType === 'EXPENSE').length
    const missingSerials = lines.filter(l => l.lineType === 'ASSET' && (l.serialNumbers?.length ?? 0) > 0 && l.serialNumbers.length !== num(l.qty))
    return { assets, assigned, stock, expense, missingSerials }
  }, [lines])

  const net = num(bill?.netPayable)
  const total = num(bill?.total)
  const banking = payMode === 'PAY_NOW' ? isBankingChannel({ channel: channel || null, account }) : true

  const warnings = []
  if (payMode === 'PAY_NOW' && account) {
    if (account.allowNegative === false && num(account.balance) + num(account.creditLimit) < net - 0.005) {
      warnings.push(`${account.name} has ${tk(account.balance)} — less than the ${tk(net)} to pay.`)
    }
    if (!banking && bill?.vatCreditable && total > 100000) {
      warnings.push('Over ৳ 1,00,000 and not paid through a bank: input VAT can’t be claimed and is treated as cost (VAT Act s.46).')
    }
    if (!banking && num(bill?.tds?.amount) > 0) {
      warnings.push('Not a bank payment: TDS is 50% higher (ITA s.142) — check the TDS on this bill before paying.')
    }
  }
  if (payMode === 'PAID_OUTSIDE' && settings?.goLiveDate && (bill?.billDay ?? '') >= settings.goLiveDate) {
    warnings.push('Dated after go-live: use “Already paid” only if the payment is recorded elsewhere, or the expense will be missing from the books.')
  }

  const lockedReceive = !isSettle && settings?.lockedUntil && receivedAt && receivedAt <= settings.lockedUntil
  const blockers = []
  if (!isSettle && summary.missingSerials.length) {
    blockers.push(`Serial numbers are incomplete on ${summary.missingSerials.length} line${summary.missingSerials.length === 1 ? '' : 's'} — enter one per unit or clear them.`)
  }
  if (!isSettle && bill?.vatCreditable && num(bill?.vatTotal) > 0 && !bill?.mushakNo) {
    blockers.push("Enter the supplier's Mushak-6.3 number to claim input VAT (or untick VAT creditable).")
  }
  if (lockedReceive) blockers.push(`Books are locked up to ${settings.lockedUntil} — choose a later received date.`)
  if (!isSettle && summary.assigned > 0 && !can('inventory.assign')) {
    blockers.push('Assigning on receipt needs the assign permission — clear the assignees or ask someone who can assign.')
  }
  // "Already paid outside" records no expense — refused when tax would then go unrecorded (same rules as the server).
  if (payMode === 'PAID_OUTSIDE' && bill?.vatCreditable && num(bill?.vatTotal) > 0) {
    blockers.push(isSettle
      ? 'Input VAT is only recorded when paid through Accounts — pay now or send to Accounts. If it really was paid outside, cancel the bill, untick “VAT creditable” and receive it again.'
      : 'Input VAT is only recorded when paid through Accounts — pay now, send to Accounts, or untick “VAT creditable” on the draft so the VAT goes into cost.')
  }
  if (payMode === 'PAID_OUTSIDE' && num(bill?.tds?.amount) + num(bill?.vds?.amount) > 0 &&
      (!settings?.goLiveDate || (bill?.billDay ?? '') >= settings.goLiveDate)) {
    blockers.push(isSettle
      ? 'Withheld VDS / TDS must be recorded for deposit, the return and certificates — pay now or send to Accounts. If nothing was withheld, cancel the bill, clear the withholding and receive it again.'
      : 'Withheld VDS / TDS must be recorded for deposit, the return and certificates — pay now, send to Accounts, or clear the withholding on the draft.')
  }

  const payReady = payMode !== 'PAY_NOW' || (accountId && (reference.trim() || proofUrl))

  async function submit() {
    if (blockers.length) return
    if (payMode === 'PAY_NOW' && !accountId) { setError('Select the money account to pay from'); return }
    if (payMode === 'PAY_NOW' && !reference.trim() && !proofUrl) { setError('Enter the payment reference or upload proof'); return }
    setSubmitting(true)
    setError(null)
    try {
      const payment = {
        mode: payMode,
        paymentMethod: paymentMethod || null,
        ...(payMode === 'PAY_NOW' ? {
          accountId, channel: channel || null, paidAt, reference: reference.trim() || null, proofUrl: proofUrl || null, note: note.trim() || null,
        } : { note: note.trim() || null }),
      }
      const url = isSettle ? `/api/inventory/purchases/${bill.id}/payment` : `/api/inventory/purchases/${bill.id}/receive`
      const body = isSettle ? { payment } : { receivedAt, payment }
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Failed')
      if (payMode === 'PAY_NOW') invalidateMoneyAccounts()
      if (json.warning) toast(json.warning, { duration: 8000 })
      if (isSettle) {
        toast.success(payMode === 'PAY_NOW' ? 'Payment recorded' : payMode === 'REQUEST' ? 'Payment request sent to Accounts' : 'Marked as paid')
      } else {
        const c = json.created ?? {}
        const parts = []
        if (c.assets) parts.push(`${c.assets} asset${c.assets === 1 ? '' : 's'} tagged`)
        if (c.stockLines) parts.push(`${c.stockLines} stock line${c.stockLines === 1 ? '' : 's'} received`)
        toast.success(`Bill received${parts.length ? ` — ${parts.join(', ')}` : ''}`)
      }
      onDone?.(json.data, json.warning ?? null)
      onOpenChange(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  const confirmLabel = (() => {
    if (payMode === 'PAY_NOW') return `${isSettle ? 'Pay' : 'Receive & pay'} ${tk(net)}`
    if (payMode === 'REQUEST') return isSettle ? 'Send to Accounts' : 'Receive & send to Accounts'
    return isSettle ? 'Mark as paid' : 'Receive'
  })()

  const availableModes = requestPending ? MODES.filter(m => m.value === 'PAY_NOW') : MODES

  return (
    <Modal
      open={open}
      onOpenChange={(v) => { if (!submitting) onOpenChange(v) }}
      title={isSettle ? (requestPending ? 'Pay this bill now' : 'Settle payment') : `Receive ${bill?.billNo ?? 'bill'}`}
      description={isSettle
        ? `${bill?.vendorName ?? 'Supplier'} · net payable ${tk(net)}`
        : undefined}
      size="lg"
    >
      <div className="space-y-5">
        {!isSettle && (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <SummaryTile label="Assets to tag" value={qtyText(summary.assets)} hint={summary.assigned ? `${qtyText(summary.assigned)} assigned on receipt` : null} />
              <SummaryTile label="Stock lines" value={summary.stock.length} hint={summary.stock.length ? summary.stock.map(l => `${qtyText(l.qty)} ${l.unit || 'pcs'}`).slice(0, 2).join(', ') : null} />
              <SummaryTile label="Expense lines" value={summary.expense} />
              <SummaryTile label="Net payable" value={tk(net, 0)} hint={num(bill?.tds?.amount) + num(bill?.vds?.amount) > 0 ? `after ${tk(num(bill?.tds?.amount) + num(bill?.vds?.amount), 0)} withheld` : null} />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label title="Depreciation and warranties start from this date">Received on</Label>
                <DatePicker value={receivedAt} onChange={v => setReceivedAt(v || today)} clearable={false} />
              </div>
            </div>
          </>
        )}

        <div>
          <Label>Payment</Label>
          <div className="grid grid-cols-1 gap-2">
            {availableModes.map(m => {
              const disabled = m.value === 'PAY_NOW' && !canPayNow
              const Icon = m.icon
              const active = payMode === m.value
              return (
                <button
                  type="button"
                  key={m.value}
                  disabled={disabled}
                  title={m.tip}
                  onClick={() => setPayMode(m.value)}
                  className={cn(
                    'flex items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors',
                    active ? 'border-gray-900 bg-gray-50/60 ring-1 ring-gray-900' : 'border-gray-200/80 hover:bg-gray-50',
                    disabled && 'cursor-not-allowed opacity-50 hover:bg-transparent',
                  )}
                >
                  <Icon className={cn('mt-0.5 size-4 shrink-0', active ? 'text-gray-900' : 'text-gray-400')} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-gray-900">{m.title}</span>
                    <span className="block text-xs text-muted-foreground">
                      {disabled ? 'Needs the “Confirm payments” permission.' : m.desc}
                    </span>
                  </span>
                  {active && <CheckCircle2 className="ml-auto size-4 shrink-0 text-gray-900" />}
                </button>
              )
            })}
          </div>
        </div>

        {payMode === 'PAY_NOW' && (
          <div className="grid grid-cols-1 gap-4 rounded-lg border border-gray-200/80 p-4 sm:grid-cols-2">
            <Field label="Payment method">
              <NativeSelect value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
                <option value="">From the account</option>
                {paymentMethods.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Pay from" required>
              <MoneyAccountSelect
                value={accountId}
                onChange={(id, acc) => { setAccountId(id); setAccount(acc) }}
                currency="BDT"
                paymentMethod={paymentMethod || null}
                required
              />
            </Field>
            <div>
              <Label>Channel</Label>
              <NativeSelect value={channel} onChange={e => { setChannel(e.target.value); setChannelTouched(true) }}>
                <option value="">Auto</option>
                {PAYMENT_CHANNELS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </NativeSelect>
              <p className={cn('mt-1.5 text-xs', banking ? 'text-muted-foreground' : 'text-amber-700')}>
                {banking ? 'Banking channel for tax' : 'Not a banking channel (cash / open cheque)'}
              </p>
            </div>
            <Field label="Paid on">
              <DatePicker value={paidAt} onChange={v => setPaidAt(v || today)} clearable={false} />
            </Field>
            <Field label="Reference">
              <Input value={reference} onChange={e => setReference(e.target.value)} placeholder="Txn ID, cheque or memo no." maxLength={120} />
            </Field>
            <div>
              <FileUpload value={proofUrl} onUploaded={setProofUrl} label="Payment proof (if no reference)" bucket="receipts" />
            </div>
          </div>
        )}

        <Field label="Note">
          <Input value={note} onChange={e => setNote(e.target.value)} maxLength={500}
            placeholder={payMode === 'REQUEST' ? 'Anything Accounts should know' : 'Internal note'} />
        </Field>

        {(warnings.length > 0 || blockers.length > 0) && (
          <div className="space-y-2">
            {blockers.map((w, i) => (
              <p key={`b${i}`} className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {w}
              </p>
            ))}
            {warnings.map((w, i) => (
              <p key={`w${i}`} className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                <Info className="mt-0.5 size-4 shrink-0" /> {w}
              </p>
            ))}
          </div>
        )}

        {error && (
          <p className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {error}
          </p>
        )}
      </div>

      <ModalFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
        <Button onClick={submit} loading={submitting} disabled={blockers.length > 0 || !payReady}>
          {!submitting && (payMode === 'PAY_NOW' ? <Banknote /> : <PackageCheck />)}
          {confirmLabel}
        </Button>
      </ModalFooter>
    </Modal>
  )
}

function SummaryTile({ label, value, hint }) {
  return (
    <div className="min-w-0 rounded-lg bg-gray-50 px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-base font-semibold tabular-nums text-gray-900">{value}</p>
      {hint && <p className="truncate text-[11px] text-gray-400">{hint}</p>}
    </div>
  )
}
