'use client'

import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { ArrowDownUp, AlertTriangle, Info } from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { Input, NativeSelect, Label } from '@/components/ui/Input'
import DatePicker from '@/components/ui/DatePicker'
import { cn } from '@/lib/utils'
import { dayKeyLabel } from '@/lib/finance/fiscal'
import { PAYMENT_CHANNELS, BD_BANKS, CASH_ACCOUNT_TYPES } from '@/lib/finance/constants'
import { useMoneyAccounts, moneyAccountLabel, invalidateMoneyAccounts } from './MoneyAccountSelect'
import AccountIcon from './AccountIcon'
import AmountInput from './AmountInput'
import { FieldError } from './FinanceDialogs'
import {
  FOOTER_STICKY, formatAmount, parseAmount, round2, todayKey, fetchJson, accountSubtitle, maskedNumber,
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
    <div className="mt-1.5 flex flex-wrap items-center justify-between gap-x-3 gap-y-0.5 text-xs">
      <span className="text-muted-foreground">{label}: <span className="tabular-nums text-gray-700">{formatAmount(before, account.currency)}</span></span>
      {Math.abs(delta) > 0.004 && (
        <span className={cn('font-medium tabular-nums', breach ? 'text-red-600' : 'text-gray-700')}>
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
    <NativeSelect value={value} onChange={e => onChange(e.target.value)} disabled={loading} invalid={!!error}>
      <option value="">{loading ? 'Loading accounts…' : placeholder}</option>
      {options.map(a => <option key={a.id} value={a.id}>{moneyAccountLabel(a)}</option>)}
    </NativeSelect>
  )

  return (
    <Modal
      open={open}
      onOpenChange={(v) => !saving && onOpenChange(v)}
      title="Transfer between accounts"
      description="Transfers never touch the P&L."
      size="lg"
    >
      <div className="space-y-5">
        {!loading && accounts.length < 2 && (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
            <Info className="mt-0.5 size-4 shrink-0" /> You need at least two active accounts to transfer.
          </div>
        )}

        {/* From / To */}
        <div className="space-y-2 rounded-lg bg-gray-50 p-3">
          <div>
            <Label>From</Label>
            <div className="flex items-center gap-2">
              {from && <AccountIcon account={from} size="sm" />}
              <div className="min-w-0 flex-1">{accountSelect(fromId, (v) => { setFromId(v); if (v && v === toId) setToId('') }, fromOptions, errors.fromAccountId, 'Select account')}</div>
            </div>
            <FieldError message={errors.fromAccountId} />
            {from && <BalanceLine account={from} delta={outDelta} label="Balance" />}
          </div>
          <div className="flex justify-center">
            <Button
              variant="outline"
              size="icon-sm"
              className="rounded-full"
              onClick={() => { const f = fromId; setFromId(toId); setToId(f) }}
              disabled={!fromId && !toId}
              aria-label="Swap accounts"
            >
              <ArrowDownUp />
            </Button>
          </div>
          <div>
            <Label>To</Label>
            <div className="flex items-center gap-2">
              {to && <AccountIcon account={to} size="sm" />}
              <div className="min-w-0 flex-1">{accountSelect(toId, setToId, toOptions, errors.toAccountId, 'Select account')}</div>
            </div>
            <FieldError message={errors.toAccountId} />
            {to && <BalanceLine account={to} delta={inDelta} label="Balance" />}
          </div>
        </div>

        {/* Amounts */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label required>Amount sent{from ? ` (${fromCur})` : ''}</Label>
            <AmountInput value={amount} onChange={onAmount} currency={fromCur} error={errors.amount} autoFocus />
            <FieldError message={errors.amount} />
            {overdraw && (
              <p className="mt-1.5 flex items-center gap-1 text-xs text-red-600"><AlertTriangle className="size-3.5" /> Only {formatAmount(available, fromCur)} available in {from.name}.</p>
            )}
          </div>
          <div>
            <Label required>Date</Label>
            <DatePicker value={date} onChange={v => setDate(v ?? '')} clearable={false} />
            <FieldError message={errors.date} />
            {dateLocked && !errors.date && <p className="mt-1.5 text-xs text-red-600">Books are locked up to {dayKeyLabel(lockedUntil)}.</p>}
          </div>
        </div>

        {crossCurrency && (
          <div className="space-y-4 rounded-lg border border-gray-200/80 p-3">
            <p className="text-sm font-medium text-gray-900">Currency exchange {fromCur} → {toCur}</p>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <Label>Rate (1 {fromCur} = ? {toCur})</Label>
                <Input value={rate} onChange={e => onRate(e.target.value)} inputMode="decimal" placeholder={effectiveRate ? effectiveRate.toFixed(4) : 'e.g. 121.50'} className="text-right tabular-nums" />
              </div>
              <div>
                <Label required>Amount received ({toCur})</Label>
                <AmountInput value={toAmount} onChange={(v) => { setToAmount(v); setRate('') }} currency={toCur} error={errors.toAmount} />
                <FieldError message={errors.toAmount} />
              </div>
            </div>
            {effectiveRate && (
              <p className="text-xs text-muted-foreground tabular-nums">Effective rate: 1 {fromCur} = {effectiveRate.toFixed(4)} {toCur}</p>
            )}
            {neitherBDT && (
              <div className="sm:w-1/2">
                <Label required>Value in BDT</Label>
                <AmountInput value={amountBDT} onChange={setAmountBDT} currency="BDT" error={errors.amountBDT} />
                <FieldError message={errors.amountBDT} />
              </div>
            )}
          </div>
        )}

        {neitherBDT && !crossCurrency && (
          <div className="sm:w-1/2">
            <Label required>Value in BDT</Label>
            <AmountInput value={amountBDT} onChange={setAmountBDT} currency="BDT" error={errors.amountBDT} />
            <FieldError message={errors.amountBDT} />
          </div>
        )}

        {/* Fee & channel */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label>Fee charged{from ? ` (${fromCur})` : ''}</Label>
            <AmountInput value={fee} onChange={setFee} currency={fromCur} error={errors.fee} />
            <FieldError message={errors.fee} />
            {from?.type === 'MFS' && amt > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {MFS_FEE_PRESETS.map(p => (
                  <Button key={p.label} variant="outline" size="xs" className="rounded-full font-normal text-gray-600" onClick={() => setFee(String(round2(amt * p.pct / 100)))}>
                    {p.label}
                  </Button>
                ))}
              </div>
            )}
            <p className="mt-1.5 text-xs text-muted-foreground">Booked as a bank charge on the sending account.</p>
          </div>
          <div>
            <Label>Channel</Label>
            <NativeSelect value={channel} onChange={e => setChannel(e.target.value)}>
              <option value="">Automatic{resolvedChannel && !channel ? ` (${TRANSFER_CHANNELS.find(c => c.value === resolvedChannel)?.label ?? resolvedChannel})` : ''}</option>
              {TRANSFER_CHANNELS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </NativeSelect>
          </div>
        </div>

        {showCheque && (
          <div className="grid grid-cols-1 gap-4 rounded-lg border border-gray-200/80 p-3 sm:grid-cols-3">
            <div>
              <Label>Cheque / instrument no.</Label>
              <Input value={cheque.no} onChange={e => setCheque(c => ({ ...c, no: e.target.value }))} />
            </div>
            <div>
              <Label>Cheque date</Label>
              <DatePicker value={cheque.date || null} onChange={v => setCheque(c => ({ ...c, date: v ?? '' }))} />
            </div>
            <div>
              <Label>Drawn on bank</Label>
              <Input list="finance-transfer-banks" value={cheque.bank} onChange={e => setCheque(c => ({ ...c, bank: e.target.value }))} placeholder={from?.bankName ?? ''} />
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label>Reference</Label>
            <Input value={reference} onChange={e => setReference(e.target.value)} placeholder="Bank ref / TrxID / slip no." />
          </div>
          <div>
            <Label>Note</Label>
            <Input value={description} onChange={e => setDescription(e.target.value)} placeholder={from && to ? `Transfer: ${from.name} → ${to.name}` : 'Optional'} />
          </div>
        </div>

        {from && to && amt > 0 && (
          <div className="space-y-1 rounded-lg border border-gray-200/80 bg-gray-50/60 p-3 text-[13px] text-gray-600">
            <p className="font-medium text-gray-900">Summary</p>
            <p><span className="text-muted-foreground">{from.name}{maskedNumber(from) ? ` ${maskedNumber(from)}` : ''}:</span> <span className="tabular-nums text-red-600">−{formatAmount(amt + (feeAmt > 0 ? feeAmt : 0), fromCur)}</span>{feeAmt > 0 ? ` (incl. fee ${formatAmount(feeAmt, fromCur)})` : ''}</p>
            <p><span className="text-muted-foreground">{to.name}{maskedNumber(to) ? ` ${maskedNumber(to)}` : ''}:</span> <span className="tabular-nums text-emerald-700">+{formatAmount(Number.isFinite(toAmt) ? toAmt : 0, toCur)}</span></p>
            <p className="text-xs text-gray-400">{accountSubtitle(from)} → {accountSubtitle(to)}</p>
          </div>
        )}
      </div>

      <datalist id="finance-transfer-banks">
        {BD_BANKS.map(b => <option key={b} value={b} />)}
      </datalist>

      <ModalFooter className={FOOTER_STICKY}>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
        <Button onClick={submit} loading={saving} disabled={loading || accounts.length < 2}>
          Transfer
        </Button>
      </ModalFooter>
    </Modal>
  )
}
