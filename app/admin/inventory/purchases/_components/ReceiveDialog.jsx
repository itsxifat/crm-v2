'use client'

import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import {
  AlertTriangle, Banknote, CheckCircle2, Info, Loader2, PackageCheck, Send, Wallet, Archive,
} from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import DatePicker from '@/components/ui/DatePicker'
import FileUpload from '@/components/ui/FileUpload'
import MoneyAccountSelect, { invalidateMoneyAccounts } from '@/components/finance/MoneyAccountSelect'
import { usePermission } from '@/components/auth/Can'
import { useConfig } from '@/lib/useConfig'
import { cn } from '@/lib/utils'
import { dhakaDayKey } from '@/lib/dhakaTime'
import { PAYMENT_CHANNELS, channelFromPaymentMethod, isBankingChannel } from '@/lib/finance/constants'
import { num, tk, qtyText } from './billMath'

const ic = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:bg-gray-50'
const lc = 'block text-xs font-medium text-gray-600 mb-1'

const MODES = [
  {
    value: 'PAY_NOW',
    title: 'Pay now',
    desc: 'Pay the supplier from a bank, cash or wallet account. Posts the expense, input VAT and withholding now.',
    icon: Wallet,
  },
  {
    value: 'REQUEST',
    title: 'Send to Accounts for approval',
    desc: 'Creates a payment request in Accounts → Payment requests. Finance pays it later.',
    icon: Send,
  },
  {
    value: 'PAID_OUTSIDE',
    title: 'Already paid outside the system',
    desc: 'Historical purchase — no expense or money movement is recorded.',
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
      warnings.push('A supply over ৳ 1,00,000 not paid through a bank cannot claim input VAT (VAT Act s.46) — the VAT will be treated as cost.')
    }
    if (!banking && num(bill?.tds?.amount) > 0) {
      warnings.push('Not a bank payment: TDS is 50% higher than for bank payments (ITA s.142). Check the TDS on this bill before paying.')
    }
  }
  if (payMode === 'PAID_OUTSIDE' && settings?.goLiveDate && (bill?.billDay ?? '') >= settings.goLiveDate) {
    warnings.push('This bill is dated after go-live. Use "Already paid" only when the payment is recorded elsewhere — otherwise the expense will be missing from the books.')
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
    blockers.push('Some assets are set to be assigned on receipt, which needs the assign permission — clear the assignees or ask someone who can assign.')
  }
  // "Already paid outside" records no expense — refused when tax would then go unrecorded (same rules as the server).
  if (payMode === 'PAID_OUTSIDE' && bill?.vatCreditable && num(bill?.vatTotal) > 0) {
    blockers.push(isSettle
      ? 'This bill claims its input VAT, which is only recorded when the bill is paid through Accounts — pay it now or send it to Accounts. If it really was paid outside, cancel the bill, untick "VAT creditable" and receive it again.'
      : 'This bill claims its input VAT, which is only recorded when the bill is paid through Accounts — pay it now or send it to Accounts, or untick "VAT creditable" on the draft so the VAT goes into the asset cost.')
  }
  if (payMode === 'PAID_OUTSIDE' && num(bill?.tds?.amount) + num(bill?.vds?.amount) > 0 &&
      (!settings?.goLiveDate || (bill?.billDay ?? '') >= settings.goLiveDate)) {
    blockers.push(isSettle
      ? 'The VDS / TDS withheld on this bill must be recorded for deposit, the return and certificates — pay it now or send it to Accounts. If nothing was actually withheld, cancel the bill, clear the withholding and receive it again.'
      : 'The VDS / TDS withheld on this bill must be recorded for deposit, the return and certificates — pay it now or send it to Accounts, or clear the withholding on the draft if nothing was withheld.')
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
        : 'Assets are tagged, stock is added and the payment is recorded in one step.'}
      size="lg"
    >
      <div className="space-y-5">
        {!isSettle && (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              <SummaryTile label="Assets to tag" value={qtyText(summary.assets)} hint={summary.assigned ? `${qtyText(summary.assigned)} assigned on receipt` : null} />
              <SummaryTile label="Stock lines" value={summary.stock.length} hint={summary.stock.length ? summary.stock.map(l => `${qtyText(l.qty)} ${l.unit || 'pcs'}`).slice(0, 2).join(', ') : null} />
              <SummaryTile label="Expense lines" value={summary.expense} />
              <SummaryTile label="Net payable" value={tk(net, 0)} hint={num(bill?.tds?.amount) + num(bill?.vds?.amount) > 0 ? `after ${tk(num(bill?.tds?.amount) + num(bill?.vds?.amount), 0)} withheld` : null} />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={lc}>Received on</label>
                <DatePicker value={receivedAt} onChange={v => setReceivedAt(v || today)} clearable={false} />
                <p className="mt-1 text-[11px] text-gray-400">Depreciation and warranties start from this date.</p>
              </div>
            </div>
          </>
        )}

        <div>
          <p className={lc}>How is this bill paid?</p>
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
                  onClick={() => setPayMode(m.value)}
                  className={cn(
                    'flex items-start gap-3 text-left border rounded-xl px-3 py-2.5 transition-colors',
                    active ? 'border-gray-900 bg-gray-50 ring-1 ring-gray-900' : 'border-gray-200 hover:border-gray-300',
                    disabled && 'opacity-50 cursor-not-allowed hover:border-gray-200',
                  )}
                >
                  <Icon className={cn('w-4 h-4 mt-0.5 shrink-0', active ? 'text-gray-900' : 'text-gray-400')} />
                  <span className="min-w-0">
                    <span className="block text-sm font-medium text-gray-900">{m.title}</span>
                    <span className="block text-xs text-gray-500">
                      {disabled ? 'Needs the "Confirm payments" permission — send it to Accounts instead.' : m.desc}
                    </span>
                  </span>
                  {active && <CheckCircle2 className="w-4 h-4 text-gray-900 ml-auto shrink-0" />}
                </button>
              )
            })}
          </div>
        </div>

        {payMode === 'PAY_NOW' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border border-gray-100 rounded-xl p-3">
            <div>
              <label className={lc}>Payment method</label>
              <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} className={ic}>
                <option value="">From the account</option>
                {paymentMethods.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label className={lc}>Pay from <span className="text-red-500">*</span></label>
              <MoneyAccountSelect
                value={accountId}
                onChange={(id, acc) => { setAccountId(id); setAccount(acc) }}
                currency="BDT"
                paymentMethod={paymentMethod || null}
                required
              />
            </div>
            <div>
              <label className={lc}>Channel</label>
              <select value={channel} onChange={e => { setChannel(e.target.value); setChannelTouched(true) }} className={ic}>
                <option value="">Auto</option>
                {PAYMENT_CHANNELS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              <p className={cn('mt-1 text-[11px]', banking ? 'text-gray-400' : 'text-amber-700')}>
                {banking ? 'Counts as a banking channel for tax.' : 'Not a banking channel (cash / open cheque).'}
              </p>
            </div>
            <div>
              <label className={lc}>Paid on</label>
              <DatePicker value={paidAt} onChange={v => setPaidAt(v || today)} clearable={false} />
            </div>
            <div>
              <label className={lc}>Reference <span className="text-gray-400 font-normal">(txn ID, cheque or memo no.)</span></label>
              <input value={reference} onChange={e => setReference(e.target.value)} className={ic} placeholder="e.g. BEFTN 7781203 / Cheque 004512" maxLength={120} />
            </div>
            <div>
              <FileUpload value={proofUrl} onUploaded={setProofUrl} label="Payment proof (optional if a reference is given)" bucket="receipts" />
            </div>
          </div>
        )}

        <div>
          <label className={lc}>Note <span className="text-gray-400 font-normal">(optional)</span></label>
          <input value={note} onChange={e => setNote(e.target.value)} className={ic} maxLength={500}
            placeholder={payMode === 'REQUEST' ? 'Anything Accounts should know' : 'Internal note'} />
        </div>

        {(warnings.length > 0 || blockers.length > 0) && (
          <div className="space-y-1.5">
            {blockers.map((w, i) => (
              <p key={`b${i}`} className="flex items-start gap-2 text-xs text-red-700 bg-red-50 rounded-lg px-3 py-2">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {w}
              </p>
            ))}
            {warnings.map((w, i) => (
              <p key={`w${i}`} className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {w}
              </p>
            ))}
          </div>
        )}

        {error && (
          <p className="flex items-start gap-2 text-sm text-red-700 bg-red-50 rounded-lg px-3 py-2">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {error}
          </p>
        )}
      </div>

      <ModalFooter>
        <button type="button" onClick={() => onOpenChange(false)} disabled={submitting}
          className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 bg-white">
          Cancel
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={submitting || blockers.length > 0 || !payReady}
          className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-50 flex items-center gap-1.5"
        >
          {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : payMode === 'PAY_NOW' ? <Banknote className="w-4 h-4" /> : <PackageCheck className="w-4 h-4" />}
          {confirmLabel}
        </button>
      </ModalFooter>
    </Modal>
  )
}

function SummaryTile({ label, value, hint }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2">
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className="text-base font-semibold text-gray-900">{value}</p>
      {hint && <p className="text-[11px] text-gray-400 truncate">{hint}</p>}
    </div>
  )
}
