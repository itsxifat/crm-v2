'use client'

import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import {
  Briefcase, UserRound, Landmark, HandCoins, Receipt, Percent, PlusCircle, SlidersHorizontal,
} from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { Input, NativeSelect, Label } from '@/components/ui/Input'
import DatePicker from '@/components/ui/DatePicker'
import FileUpload from '@/components/ui/FileUpload'
import { useConfig } from '@/lib/useConfig'
import { cn } from '@/lib/utils'
import { dayKeyLabel } from '@/lib/finance/fiscal'
import { PAYMENT_CHANNELS } from '@/lib/finance/constants'
import { useMoneyAccounts, moneyAccountLabel, invalidateMoneyAccounts } from './MoneyAccountSelect'
import AccountIcon from './AccountIcon'
import AmountInput from './AmountInput'
import { FieldError } from './FinanceDialogs'
import { MOVEMENT_KINDS, MOVEMENT_KIND_MAP, BANK_CHARGE_TYPES } from './movementKinds'
import {
  FOOTER_STICKY, formatAmount, parseAmount, round2, todayKey, fetchJson,
} from './accountTheme'

const KIND_ICONS = {
  CAPITAL_IN: Briefcase,
  DRAWING: UserRound,
  LOAN_IN: Landmark,
  LOAN_REPAYMENT: HandCoins,
  BANK_CHARGE: Receipt,
  INTEREST_INCOME: Percent,
  OTHER_INCOME: PlusCircle,
  ADJUSTMENT_IN: SlidersHorizontal,
  ADJUSTMENT_OUT: SlidersHorizontal,
}

const MOVEMENT_CHANNELS = PAYMENT_CHANNELS.filter(c => !['INTERNAL', 'CHALLAN'].includes(c.value))

/**
 * Record a non-trading money movement on one account (capital, drawings, loans,
 * bank charges, interest with AIT, other income, balance adjustments).
 * Props: open, onOpenChange, defaultAccountId, defaultKind, settings ({ lockedUntil }), onDone(result)
 */
export default function MovementModal({ open, onOpenChange, defaultAccountId = null, defaultKind = null, settings = {}, onDone }) {
  const { accounts, loading, reload } = useMoneyAccounts()
  const { incomeCategories } = useConfig()
  const [kind, setKind] = useState('BANK_CHARGE')
  const [accountId, setAccountId] = useState('')
  const [amount, setAmount] = useState('')
  const [amountBDT, setAmountBDT] = useState('')
  const [date, setDate] = useState(todayKey())
  const [description, setDescription] = useState('')
  const [reference, setReference] = useState('')
  const [channel, setChannel] = useState('')
  const [chargeType, setChargeType] = useState('MAINTENANCE')
  const [category, setCategory] = useState('')
  const [subcategory, setSubcategory] = useState('')
  const [party, setParty] = useState('')
  const [ait, setAit] = useState('')
  const [aitCertificateNo, setAitCertificateNo] = useState('')
  const [interest, setInterest] = useState('')
  const [receiptUrl, setReceiptUrl] = useState('')
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) return
    reload()
    setKind(defaultKind && MOVEMENT_KIND_MAP[defaultKind] ? defaultKind : 'BANK_CHARGE')
    setAccountId(defaultAccountId ?? '')
    setAmount(''); setAmountBDT(''); setDate(todayKey()); setDescription(''); setReference(''); setChannel('')
    setChargeType('MAINTENANCE'); setCategory(''); setSubcategory(''); setParty('')
    setAit(''); setAitCertificateNo(''); setInterest(''); setReceiptUrl('')
    setErrors({}); setSaving(false)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultAccountId, defaultKind])

  const def = MOVEMENT_KIND_MAP[kind]
  const account = accounts.find(a => a.id === accountId) ?? null
  const currency = account?.currency ?? 'BDT'
  const foreign = currency !== 'BDT'
  const amt = parseAmount(amount)
  const aitAmt = ait === '' ? 0 : parseAmount(ait)
  const interestAmt = interest === '' ? 0 : parseAmount(interest)
  const lockedUntil = settings?.lockedUntil ?? null
  const dateLocked = !!(lockedUntil && date && date <= lockedUntil)
  const isIn = def.direction === 'IN'
  const isAdjustment = def.txKind === 'ADJUSTMENT'

  const subcategories = useMemo(
    () => (incomeCategories ?? []).find(c => c.label === category)?.subcategories ?? [],
    [incomeCategories, category],
  )

  const available = account && !account.allowNegative ? round2((Number(account.balance) || 0) + (Number(account.creditLimit) || 0)) : null
  const overdraw = !isIn && available !== null && amt > available + 0.005

  // What this will post (for the summary box).
  const effect = useMemo(() => {
    if (!(amt > 0)) return null
    if (kind === 'INTEREST_INCOME') {
      const gross = round2(amt + (aitAmt > 0 ? aitAmt : 0))
      return { lines: [
        `Money in: +${formatAmount(amt, currency)}`,
        `Interest income (P&L): ${formatAmount(gross, currency)}`,
        ...(aitAmt > 0 ? [`Tax credit (AIT deducted by bank): ${formatAmount(aitAmt, currency)} — recorded as TDS receivable${gross > 0 ? ` (${round2(aitAmt / gross * 100)}% of gross)` : ''}`] : []),
      ] }
    }
    if (kind === 'LOAN_REPAYMENT') {
      const i = interestAmt > 0 ? interestAmt : 0
      return { lines: [
        `Money out: −${formatAmount(amt, currency)}`,
        `Loan principal repaid (not P&L): ${formatAmount(round2(amt - i), currency)}`,
        ...(i > 0 ? [`Interest expense (P&L): ${formatAmount(i, currency)}`] : []),
      ] }
    }
    const sign = isIn ? '+' : '−'
    const pl = def.txKind === 'OPERATING'
    return { lines: [
      `Money ${isIn ? 'in' : 'out'}: ${sign}${formatAmount(amt, currency)}`,
      pl ? `${isIn ? 'Income' : 'Expense'} in the P&L: ${formatAmount(amt, currency)}` : 'Not in the P&L (balance-sheet movement)',
    ] }
  }, [amt, aitAmt, interestAmt, kind, currency, isIn, def.txKind])

  function validate() {
    const e = {}
    if (!accountId) e.accountId = 'Choose the account'
    if (!(amt > 0)) e.amount = 'Enter the amount'
    if (foreign && !(parseAmount(amountBDT) > 0)) e.amountBDT = `Enter the BDT value of this ${currency} amount`
    if (!date) e.date = 'Pick the date'
    else if (date > todayKey()) e.date = 'The date cannot be in the future'
    else if (dateLocked) e.date = `Books are locked up to ${dayKeyLabel(lockedUntil)}`
    if (kind === 'INTEREST_INCOME' && ait !== '' && !(aitAmt >= 0)) e.aitDeducted = 'Enter a valid amount'
    if (kind === 'LOAN_REPAYMENT' && interest !== '' && !(interestAmt >= 0)) e.interestAmount = 'Enter a valid amount'
    if (kind === 'LOAN_REPAYMENT' && interestAmt > amt + 0.005) e.interestAmount = 'Interest cannot exceed the amount paid'
    if (isAdjustment && description.trim().length < 5) e.description = 'Explain why the balance is adjusted (at least 5 characters)'
    return e
  }

  async function submit() {
    const e = validate()
    setErrors(e)
    if (Object.keys(e).length) { toast.error(Object.values(e)[0]); return }
    const body = {
      kind,
      accountId,
      amount: amt,
      amountBDT: foreign ? parseAmount(amountBDT) : null,
      date,
      description: description.trim() || null,
      reference: reference.trim() || null,
      channel: channel || null,
      party: def.partyLabel ? (party.trim() || null) : null,
      chargeType: kind === 'BANK_CHARGE' ? chargeType : null,
      category: kind === 'OTHER_INCOME' ? (category || null) : null,
      subcategory: kind === 'OTHER_INCOME' ? (subcategory || null) : null,
      aitDeducted: kind === 'INTEREST_INCOME' && aitAmt > 0 ? aitAmt : null,
      aitCertificateNo: kind === 'INTEREST_INCOME' ? (aitCertificateNo.trim() || null) : null,
      interestAmount: kind === 'LOAN_REPAYMENT' && interestAmt > 0 ? interestAmt : null,
      receiptUrl: receiptUrl || null,
    }
    setSaving(true)
    try {
      const json = await fetchJson('/api/finance/movements', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      invalidateMoneyAccounts()
      reload()
      toast.success(`${def.label} recorded`)
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

  return (
    <Modal
      open={open}
      onOpenChange={(v) => !saving && onOpenChange(v)}
      title="Record money movement"
      size="lg"
    >
      <div className="space-y-5">
        {/* Kind */}
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
            {MOVEMENT_KINDS.map(k => {
              const Icon = KIND_ICONS[k.value] ?? PlusCircle
              const active = kind === k.value
              const inbound = k.direction === 'IN'
              return (
                <button
                  key={k.value}
                  type="button"
                  onClick={() => { setKind(k.value); setErrors({}) }}
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg border p-2.5 text-left transition-colors',
                    active ? 'border-gray-900 bg-gray-50 ring-1 ring-gray-900' : 'border-gray-200/80 hover:bg-gray-50',
                  )}
                >
                  <Icon className={cn('size-4 shrink-0', active ? 'text-gray-900' : 'text-gray-500')} />
                  <span className="min-w-0">
                    <span className="block text-[13px] font-medium leading-tight text-gray-900">{k.label}</span>
                    <span className={cn('mt-0.5 block text-[11px] font-medium', inbound ? 'text-emerald-600' : 'text-red-600')}>{inbound ? 'Money in' : 'Money out'}</span>
                  </span>
                </button>
              )
            })}
          </div>
          <p className="text-[13px] text-muted-foreground">{def.hint}</p>
        </div>

        {/* Account + amount */}
        <div>
          <Label required>Account</Label>
          <div className="flex items-center gap-2">
            {account && <AccountIcon account={account} size="sm" />}
            <NativeSelect value={accountId} onChange={e => setAccountId(e.target.value)} disabled={loading} invalid={!!errors.accountId}>
              <option value="">{loading ? 'Loading accounts…' : 'Select account'}</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{moneyAccountLabel(a)}</option>)}
            </NativeSelect>
          </div>
          <FieldError message={errors.accountId} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label required>{kind === 'INTEREST_INCOME' ? 'Net amount credited' : kind === 'LOAN_REPAYMENT' ? 'Total instalment paid' : 'Amount'} ({currency})</Label>
            <AmountInput value={amount} onChange={setAmount} currency={currency} error={errors.amount} autoFocus />
            <FieldError message={errors.amount} />
            {overdraw && <p className="mt-1.5 text-xs text-red-600">Only {formatAmount(available, currency)} available in {account.name}.</p>}
          </div>
          <div>
            <Label required>Date</Label>
            <DatePicker value={date} onChange={v => setDate(v ?? '')} clearable={false} />
            <FieldError message={errors.date} />
            {dateLocked && !errors.date && <p className="mt-1.5 text-xs text-red-600">Books are locked up to {dayKeyLabel(lockedUntil)}.</p>}
          </div>
        </div>

        {foreign && (
          <div className="sm:w-1/2">
            <Label required>Value in BDT</Label>
            <AmountInput value={amountBDT} onChange={setAmountBDT} currency="BDT" error={errors.amountBDT} />
            <FieldError message={errors.amountBDT} />
          </div>
        )}

        {/* Kind specific */}
        {kind === 'BANK_CHARGE' && (
          <div className="sm:w-1/2">
            <Label>Charge type</Label>
            <NativeSelect value={chargeType} onChange={e => setChargeType(e.target.value)}>
              {BANK_CHARGE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </NativeSelect>
            {chargeType === 'VAT_ON_FEES' && <p className="mt-1.5 text-xs text-muted-foreground">May be creditable input VAT — record it in Tax &amp; VAT to claim it.</p>}
          </div>
        )}

        {kind === 'INTEREST_INCOME' && (
          <div className="grid grid-cols-1 gap-4 rounded-lg bg-gray-50 p-3 sm:grid-cols-2">
            <div>
              <Label>Tax deducted by the bank (AIT)</Label>
              <AmountInput value={ait} onChange={setAit} currency={currency} error={errors.aitDeducted} />
              <FieldError message={errors.aitDeducted} />
              <p className="mt-1.5 text-xs text-muted-foreground">Usually 10% of gross; becomes a tax credit.</p>
            </div>
            <div>
              <Label>Bank tax certificate no.</Label>
              <Input value={aitCertificateNo} onChange={e => setAitCertificateNo(e.target.value)} placeholder="Optional" />
            </div>
          </div>
        )}

        {kind === 'LOAN_REPAYMENT' && (
          <div className="sm:w-1/2">
            <Label>Interest included ({currency})</Label>
            <AmountInput value={interest} onChange={setInterest} currency={currency} error={errors.interestAmount} />
            <FieldError message={errors.interestAmount} />
          </div>
        )}

        {kind === 'OTHER_INCOME' && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label>Income category</Label>
              <NativeSelect value={category} onChange={e => { setCategory(e.target.value); setSubcategory('') }}>
                <option value="">Other Income</option>
                {(incomeCategories ?? []).map(c => <option key={c.id} value={c.label}>{c.label}</option>)}
              </NativeSelect>
            </div>
            {subcategories.length > 0 && (
              <div>
                <Label>Subcategory</Label>
                <NativeSelect value={subcategory} onChange={e => setSubcategory(e.target.value)}>
                  <option value="">—</option>
                  {subcategories.map(s => <option key={s} value={s}>{s}</option>)}
                </NativeSelect>
              </div>
            )}
          </div>
        )}

        {def.partyLabel && (
          <div className="sm:w-1/2">
            <Label>{def.partyLabel}</Label>
            <Input value={party} onChange={e => setParty(e.target.value)} placeholder={kind.startsWith('LOAN') ? 'e.g. IDLC Finance' : 'Name'} />
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label required={isAdjustment}>{isAdjustment ? 'Reason' : 'Description'}</Label>
            <Input value={description} onChange={e => setDescription(e.target.value)} placeholder={isAdjustment ? 'e.g. Cash count short — booking error' : def.label} invalid={!!errors.description} />
            <FieldError message={errors.description} />
          </div>
          <div>
            <Label>Reference</Label>
            <Input value={reference} onChange={e => setReference(e.target.value)} placeholder="Statement / voucher ref" />
          </div>
          <div>
            <Label>Channel</Label>
            <NativeSelect value={channel} onChange={e => setChannel(e.target.value)}>
              <option value="">Automatic</option>
              {MOVEMENT_CHANNELS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </NativeSelect>
          </div>
        </div>

        <FileUpload value={receiptUrl} onUploaded={setReceiptUrl} label="Statement / advice (optional)" />

        {effect && (
          <div className="space-y-0.5 rounded-lg border border-gray-200/80 bg-gray-50/60 p-3 text-[13px] text-gray-600">
            <p className="font-medium text-gray-900">{account ? account.name : 'Effect'}</p>
            {effect.lines.map((l, i) => <p key={i} className="tabular-nums">{l}</p>)}
          </div>
        )}
      </div>

      <ModalFooter className={FOOTER_STICKY}>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
        <Button onClick={submit} loading={saving} disabled={loading}>
          Record {def.short.toLowerCase()}
        </Button>
      </ModalFooter>
    </Modal>
  )
}
