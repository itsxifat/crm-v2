'use client'

import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { ArrowDownUp, Loader2, AlertTriangle, Info } from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import DatePicker from '@/components/ui/DatePicker'
import { cn } from '@/lib/utils'
import { dayKeyLabel } from '@/lib/finance/fiscal'
import { PAYMENT_CHANNELS, BD_BANKS, CASH_ACCOUNT_TYPES } from '@/lib/finance/constants'
import { useMoneyAccounts, moneyAccountLabel, invalidateMoneyAccounts } from './MoneyAccountSelect'
import AccountIcon from './AccountIcon'
import AmountInput from './AmountInput'
import { FieldError } from './FinanceDialogs'
import {
  INPUT, INPUT_ERR, LABEL, BTN_PRIMARY, BTN_SECONDARY, FOOTER_STICKY,
  formatAmount, parseAmount, round2, todayKey, fetchJson, accountSubtitle, maskedNumber,
} from './accountTheme'

const CHEQUE_CHANNELS = ['CHEQUE', 'AC_PAYEE_CHEQUE', 'PAY_ORDER']
const TRANSFER_CHANNELS = PAYMENT_CHANNELS.filter(c => !['CHALLAN', 'GATEWAY'].includes(c.value))
const MFS_FEE_PRESETS = [
  { label: 'Cash-out 1.85%', pct: 1.85 },
  { label: 'Priyo 1.49%', pct: 1.49 },
  { label: 'MFS → bank 0.85%', pct: 0.85 },
]

function autoChannel(from, to) {
  if (!from || !to) return null
  // Mirrors the server default in createTransfer().
  if (CASH_ACCOUNT_TYPES.includes(from.type) || CASH_ACCOUNT_TYPES.includes(to.type)) return 'CASH'
  return 'INTERNAL'
}

function BalanceLine({ account, delta, label }) {
  if (!account) return null
  const before = Number(account.balance) || 0
  const after = round2(before + delta)
  const limit = account.allowNegative ? null : -(Number(account.creditLimit) || 0)
  const breach = limit !== null && after < limit - 0.005
  return (
    <div className="mt-2 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-[11px]">
      <span className="text-gray-500">{label}: <span className="tabular-nums text-gray-700">{formatAmount(before, account.currency)}</span></span>
      {Math.abs(delta) > 0.004 && (
        <span className={cn('tabular-nums font-medium', breach ? 'text-red-600' : 'text-gray-700')}>
          After: {formatAmount(after, account.currency)}
        </span>
      )}
    </div>
  )
}

/**
 * Move money between two of the company's own accounts.
 * Props: open, onOpenChange, defaultFromId, defaultToId, settings ({ lockedUntil }), onDone(transfer)
 */
export default function TransferModal({ open, onOpenChange, defaultFromId = null, defaultToId = null, settings = {}, onDone }) {
  const { accounts, loading, reload } = useMoneyAccounts()
  const [fromId, setFromId] = useState('')
  const [toId, setToId] = useState('')
  const [amount, setAmount] = useState('')
  const [toAmount, setToAmount] = useState('')
  const [rate, setRate] = useState('')
  const [amountBDT, setAmountBDT] = useState('')
  const [fee, setFee] = useState('')
  const [date, setDate] = useState(todayKey())
  const [channel, setChannel] = useState('')
  const [reference, setReference] = useState('')
  const [description, setDescription] = useState('')
  const [cheque, setCheque] = useState({ no: '', date: '', bank: '' })
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    reload()
    setFromId(defaultFromId ?? '')
    setToId(defaultToId ?? '')
    setAmount(''); setToAmount(''); setRate(''); setAmountBDT(''); setFee('')
    setDate(todayKey()); setChannel(''); setReference(''); setDescription('')
    setCheque({ no: '', date: '', bank: '' })
    setErrors({}); setSaving(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultFromId, defaultToId])

  const from = accounts.find(a => a.id === fromId) ?? null
  const to = accounts.find(a => a.id === toId) ?? null
  const fromCur = from?.currency ?? 'BDT'
  const toCur = to?.currency ?? 'BDT'
  const crossCurrency = !!(from && to && fromCur !== toCur)
  // Neither side in BDT (also e.g. USD → USD): the server needs the BDT value (createTransfer 422s without it).
  const neitherBDT = !!(from && to) && fromCur !== 'BDT' && toCur !== 'BDT'

  const amt = parseAmount(amount)
  const feeAmt = fee === '' ? 0 : parseAmount(fee)
  const toAmt = crossCurrency ? parseAmount(toAmount) : amt
  const effectiveRate = crossCurrency && amt > 0 && toAmt > 0 ? toAmt / amt : null
  const lockedUntil = settings?.lockedUntil ?? null
  const dateLocked = !!(lockedUntil && date && date <= lockedUntil)
  const resolvedChannel = channel || autoChannel(from, to)
  const showCheque = CHEQUE_CHANNELS.includes(channel)

  const outDelta = -((Number.isFinite(amt) ? amt : 0) + (Number.isFinite(feeAmt) ? feeAmt : 0))
  const inDelta = Number.isFinite(toAmt) ? toAmt : 0
  const available = from && !from.allowNegative ? round2((Number(from.balance) || 0) + (Number(from.creditLimit) || 0)) : null
  const overdraw = available !== null && Number.isFinite(amt) && -outDelta > available + 0.005

  const fromOptions = accounts
  const toOptions = useMemo(() => accounts.filter(a => a.id !== fromId), [accounts, fromId])

  const onRate = (v) => {
    setRate(v)
    const r = parseAmount(v)
    if (Number.isFinite(r) && r > 0 && amt > 0) setToAmount(String(round2(amt * r)))
  }
  const onAmount = (v) => {
    setAmount(v)
    const a = parseAmount(v)
    const r = parseAmount(rate)
    if (crossCurrency && Number.isFinite(r) && r > 0 && a > 0) setToAmount(String(round2(a * r)))
  }

  function validate() {
    const e = {}
    if (!fromId) e.fromAccountId = 'Choose the account money leaves'
    if (!toId) e.toAccountId = 'Choose the account money arrives in'
    if (fromId && fromId === toId) e.toAccountId = 'Choose two different accounts'
    if (!(amt > 0)) e.amount = 'Enter the amount'
    if (fee !== '' && !(feeAmt >= 0)) e.fee = 'Enter a valid fee'
    if (crossCurrency && !(toAmt > 0)) e.toAmount = `Enter the amount received in ${toCur}`
    if (neitherBDT && !(parseAmount(amountBDT) > 0)) e.amountBDT = 'Enter the BDT value'
    if (!date) e.date = 'Pick the date'
    else if (date > todayKey()) e.date = 'The date cannot be in the future'
    else if (dateLocked) e.date = `Books are locked up to ${dayKeyLabel(lockedUntil)}`
    return e
  }

  async function submit() {
    const e = validate()
    setErrors(e)
    if (Object.keys(e).length) { toast.error(Object.values(e)[0]); return }
    const body = {
      fromAccountId: fromId,
      toAccountId: toId,
      amount: amt,
      toAmount: crossCurrency ? toAmt : null,
      amountBDT: neitherBDT ? parseAmount(amountBDT) : null,
      fee: feeAmt > 0 ? feeAmt : 0,
      date,
      channel: channel || null,
      reference: reference.trim() || null,
      description: description.trim() || null,
      cheque: showCheque ? { no: cheque.no.trim() || null, date: cheque.date || null, bank: cheque.bank.trim() || null } : null,
    }
    setSaving(true)
    try {
      const json = await fetchJson('/api/finance/transfers', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      invalidateMoneyAccounts()
      reload()
      toast.success(`Transferred ${formatAmount(amt, fromCur)} to ${to?.name ?? 'account'}`)
      onDone?.(json.data)
      onOpenChange(false)
    } catch (err) {
      const fe = err.details?.fieldErrors ?? {}
      const mapped = Object.fromEntries(Object.entries(fe).filter(([, v]) => v?.length).map(([k, v]) => [k, v[0]]))
      if (Object.keys(mapped).length) setErrors(mapped)
      toast.error(Object.values(mapped)[0] ?? err.message)
    } finally {
      setSaving(false)
    }
  }

  const accountSelect = (value, onChange, options, error, placeholder) => (
    <select value={value} onChange={e => onChange(e.target.value)} disabled={loading} className={cn(INPUT, error && INPUT_ERR)}>
      <option value="">{loading ? 'Loading accounts…' : placeholder}</option>
      {options.map(a => <option key={a.id} value={a.id}>{moneyAccountLabel(a)}</option>)}
    </select>
  )

  return (
    <Modal
      open={open}
      onOpenChange={(v) => !saving && onOpenChange(v)}
      title="Transfer between accounts"
      description="Cash deposits, withdrawals, wallet cash-outs and bank-to-bank moves. Transfers never touch the P&L."
      size="lg"
    >
      <div className="space-y-5">
        {!loading && accounts.length < 2 && (
          <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-800">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" /> You need at least two active accounts to make a transfer.
          </div>
        )}

        {/* From / To */}
        <div className="rounded-xl border border-gray-100 bg-gray-50/60 p-3 space-y-2">
          <div>
            <label className={LABEL}>From</label>
            <div className="flex items-center gap-2">
              {from && <AccountIcon account={from} size="sm" />}
              <div className="flex-1 min-w-0">{accountSelect(fromId, (v) => { setFromId(v); if (v && v === toId) setToId('') }, fromOptions, errors.fromAccountId, 'Choose account')}</div>
            </div>
            <FieldError message={errors.fromAccountId} />
            {from && <BalanceLine account={from} delta={outDelta} label="Balance" />}
          </div>
          <div className="flex justify-center">
            <button
              type="button"
              onClick={() => { const f = fromId; setFromId(toId); setToId(f) }}
              disabled={!fromId && !toId}
              className="w-8 h-8 rounded-full border border-gray-200 bg-white flex items-center justify-center text-gray-500 hover:text-gray-900 hover:border-gray-300 disabled:opacity-40"
              aria-label="Swap accounts"
            >
              <ArrowDownUp className="w-4 h-4" />
            </button>
          </div>
          <div>
            <label className={LABEL}>To</label>
            <div className="flex items-center gap-2">
              {to && <AccountIcon account={to} size="sm" />}
              <div className="flex-1 min-w-0">{accountSelect(toId, setToId, toOptions, errors.toAccountId, 'Choose account')}</div>
            </div>
            <FieldError message={errors.toAccountId} />
            {to && <BalanceLine account={to} delta={inDelta} label="Balance" />}
          </div>
        </div>

        {/* Amounts */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={LABEL}>Amount sent{from ? ` (${fromCur})` : ''} <span className="text-red-500">*</span></label>
            <AmountInput value={amount} onChange={onAmount} currency={fromCur} error={errors.amount} autoFocus />
            <FieldError message={errors.amount} />
            {overdraw && (
              <p className="mt-1 text-[11px] text-red-600 flex items-center gap-1"><AlertTriangle className="w-3 h-3" /> Only {formatAmount(available, fromCur)} available in {from.name}.</p>
            )}
          </div>
          <div>
            <label className={LABEL}>Date <span className="text-red-500">*</span></label>
            <DatePicker value={date} onChange={v => setDate(v ?? '')} clearable={false} />
            <FieldError message={errors.date} />
            {dateLocked && !errors.date && <p className="mt-1 text-[11px] text-red-600">Books are locked up to {dayKeyLabel(lockedUntil)}.</p>}
          </div>
        </div>

        {crossCurrency && (
          <div className="rounded-xl border border-indigo-100 bg-indigo-50/40 p-3 space-y-3">
            <p className="text-xs font-semibold text-indigo-900">Currency exchange {fromCur} → {toCur}</p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={LABEL}>Rate (1 {fromCur} = ? {toCur})</label>
                <input value={rate} onChange={e => onRate(e.target.value)} inputMode="decimal" placeholder={effectiveRate ? effectiveRate.toFixed(4) : 'e.g. 121.50'} className={cn(INPUT, 'text-right tabular-nums')} />
              </div>
              <div>
                <label className={LABEL}>Amount received ({toCur}) <span className="text-red-500">*</span></label>
                <AmountInput value={toAmount} onChange={(v) => { setToAmount(v); setRate('') }} currency={toCur} error={errors.toAmount} />
                <FieldError message={errors.toAmount} />
              </div>
            </div>
            {effectiveRate && (
              <p className="text-[11px] text-indigo-800">Effective rate: 1 {fromCur} = {effectiveRate.toFixed(4)} {toCur}</p>
            )}
            {neitherBDT && (
              <div className="sm:w-1/2">
                <label className={LABEL}>Value in BDT <span className="text-red-500">*</span></label>
                <AmountInput value={amountBDT} onChange={setAmountBDT} currency="BDT" error={errors.amountBDT} />
                <FieldError message={errors.amountBDT} />
              </div>
            )}
          </div>
        )}

        {neitherBDT && !crossCurrency && (
          <div className="sm:w-1/2">
            <label className={LABEL}>Value in BDT <span className="text-red-500">*</span></label>
            <AmountInput value={amountBDT} onChange={setAmountBDT} currency="BDT" error={errors.amountBDT} />
            <FieldError message={errors.amountBDT} />
          </div>
        )}

        {/* Fee & channel */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={LABEL}>Fee charged{from ? ` (${fromCur})` : ''}</label>
            <AmountInput value={fee} onChange={setFee} currency={fromCur} error={errors.fee} />
            <FieldError message={errors.fee} />
            {from?.type === 'MFS' && amt > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {MFS_FEE_PRESETS.map(p => (
                  <button key={p.label} type="button" onClick={() => setFee(String(round2(amt * p.pct / 100)))} className="rounded-full border border-gray-200 px-2 py-0.5 text-[11px] text-gray-600 hover:bg-gray-50">
                    {p.label}
                  </button>
                ))}
              </div>
            )}
            <p className="mt-1 text-[11px] text-gray-500">Booked as “Bank Charges” (expense) on the sending account.</p>
          </div>
          <div>
            <label className={LABEL}>Channel</label>
            <select value={channel} onChange={e => setChannel(e.target.value)} className={INPUT}>
              <option value="">Automatic{resolvedChannel && !channel ? ` (${TRANSFER_CHANNELS.find(c => c.value === resolvedChannel)?.label ?? resolvedChannel})` : ''}</option>
              {TRANSFER_CHANNELS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
        </div>

        {showCheque && (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 rounded-xl border border-gray-100 p-3">
            <div>
              <label className={LABEL}>Cheque / instrument no.</label>
              <input value={cheque.no} onChange={e => setCheque(c => ({ ...c, no: e.target.value }))} className={INPUT} />
            </div>
            <div>
              <label className={LABEL}>Cheque date</label>
              <DatePicker value={cheque.date || null} onChange={v => setCheque(c => ({ ...c, date: v ?? '' }))} />
            </div>
            <div>
              <label className={LABEL}>Drawn on bank</label>
              <input list="finance-transfer-banks" value={cheque.bank} onChange={e => setCheque(c => ({ ...c, bank: e.target.value }))} placeholder={from?.bankName ?? ''} className={INPUT} />
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={LABEL}>Reference</label>
            <input value={reference} onChange={e => setReference(e.target.value)} placeholder="Bank ref / TrxID / slip no." className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>Note</label>
            <input value={description} onChange={e => setDescription(e.target.value)} placeholder={from && to ? `Transfer: ${from.name} → ${to.name}` : 'Optional'} className={INPUT} />
          </div>
        </div>

        {from && to && amt > 0 && (
          <div className="rounded-xl border border-gray-100 p-3 text-xs text-gray-600 space-y-1">
            <p className="font-semibold text-gray-900">Summary</p>
            <p><span className="text-gray-500">{from.name}{maskedNumber(from) ? ` ${maskedNumber(from)}` : ''}:</span> <span className="tabular-nums text-red-600">−{formatAmount(amt + (feeAmt > 0 ? feeAmt : 0), fromCur)}</span>{feeAmt > 0 ? ` (incl. fee ${formatAmount(feeAmt, fromCur)})` : ''}</p>
            <p><span className="text-gray-500">{to.name}{maskedNumber(to) ? ` ${maskedNumber(to)}` : ''}:</span> <span className="tabular-nums text-emerald-700">+{formatAmount(Number.isFinite(toAmt) ? toAmt : 0, toCur)}</span></p>
            <p className="text-gray-400">{accountSubtitle(from)} → {accountSubtitle(to)}</p>
          </div>
        )}
      </div>

      <datalist id="finance-transfer-banks">
        {BD_BANKS.map(b => <option key={b} value={b} />)}
      </datalist>

      <ModalFooter className={FOOTER_STICKY}>
        <button type="button" className={BTN_SECONDARY} onClick={() => onOpenChange(false)} disabled={saving}>Cancel</button>
        <button type="button" className={BTN_PRIMARY} onClick={submit} disabled={saving || loading || accounts.length < 2}>
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          Transfer
        </button>
      </ModalFooter>
    </Modal>
  )
}
