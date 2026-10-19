'use client'

import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import {
  Loader2, Briefcase, UserRound, Landmark, HandCoins, Receipt, Percent, PlusCircle, SlidersHorizontal, Info,
} from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
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
  INPUT, INPUT_ERR, LABEL, BTN_PRIMARY, BTN_SECONDARY, FOOTER_STICKY,
  formatAmount, parseAmount, round2, todayKey, fetchJson,
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
      description="Money in or out of an account that isn't a client payment or a supplier bill."
      size="lg"
    >
      <div className="space-y-5">
        {/* Kind */}
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
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
                  'flex items-center gap-2 rounded-xl border p-2.5 text-left transition-colors',
                  active ? 'border-gray-900 ring-1 ring-gray-900 bg-gray-50' : 'border-gray-200 hover:bg-gray-50',
                )}
              >
                <span className={cn('w-7 h-7 rounded-lg flex items-center justify-center shrink-0', inbound ? 'bg-emerald-50 text-emerald-600' : 'bg-rose-50 text-rose-600')}>
                  <Icon className="w-3.5 h-3.5" />
                </span>
                <span className="min-w-0">
                  <span className="block text-xs font-semibold text-gray-900 leading-tight">{k.label}</span>
                  <span className={cn('block text-[10px] font-medium uppercase tracking-wide', inbound ? 'text-emerald-600' : 'text-rose-600')}>{inbound ? 'Money in' : 'Money out'}</span>
                </span>
              </button>
            )
          })}
        </div>
        <p className="flex items-start gap-1.5 text-xs text-gray-500"><Info className="w-3.5 h-3.5 mt-px shrink-0" />{def.hint}</p>

        {/* Account + amount */}
        <div>
          <label className={LABEL}>Account <span className="text-red-500">*</span></label>
          <div className="flex items-center gap-2">
            {account && <AccountIcon account={account} size="sm" />}
            <select value={accountId} onChange={e => setAccountId(e.target.value)} disabled={loading} className={cn(INPUT, errors.accountId && INPUT_ERR)}>
              <option value="">{loading ? 'Loading accounts…' : 'Choose account'}</option>
              {accounts.map(a => <option key={a.id} value={a.id}>{moneyAccountLabel(a)}</option>)}
            </select>
          </div>
          <FieldError message={errors.accountId} />
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={LABEL}>{kind === 'INTEREST_INCOME' ? 'Net amount credited' : kind === 'LOAN_REPAYMENT' ? 'Total instalment paid' : 'Amount'} ({currency}) <span className="text-red-500">*</span></label>
            <AmountInput value={amount} onChange={setAmount} currency={currency} error={errors.amount} autoFocus />
            <FieldError message={errors.amount} />
            {overdraw && <p className="mt-1 text-[11px] text-red-600">Only {formatAmount(available, currency)} available in {account.name}.</p>}
          </div>
          <div>
            <label className={LABEL}>Date <span className="text-red-500">*</span></label>
            <DatePicker value={date} onChange={v => setDate(v ?? '')} clearable={false} />
            <FieldError message={errors.date} />
            {dateLocked && !errors.date && <p className="mt-1 text-[11px] text-red-600">Books are locked up to {dayKeyLabel(lockedUntil)}.</p>}
          </div>
        </div>

        {foreign && (
          <div className="sm:w-1/2">
            <label className={LABEL}>Value in BDT <span className="text-red-500">*</span></label>
            <AmountInput value={amountBDT} onChange={setAmountBDT} currency="BDT" error={errors.amountBDT} />
            <FieldError message={errors.amountBDT} />
          </div>
        )}

        {/* Kind specific */}
        {kind === 'BANK_CHARGE' && (
          <div className="sm:w-1/2">
            <label className={LABEL}>Charge type</label>
            <select value={chargeType} onChange={e => setChargeType(e.target.value)} className={INPUT}>
              {BANK_CHARGE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
            {chargeType === 'VAT_ON_FEES' && <p className="mt-1 text-[11px] text-gray-500">VAT on bank charges may be creditable input VAT — record it in Tax &amp; VAT if you claim it.</p>}
          </div>
        )}

        {kind === 'INTEREST_INCOME' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 rounded-xl border border-gray-100 p-3">
            <div>
              <label className={LABEL}>Tax deducted by the bank (AIT)</label>
              <AmountInput value={ait} onChange={setAit} currency={currency} error={errors.aitDeducted} />
              <FieldError message={errors.aitDeducted} />
              <p className="mt-1 text-[11px] text-gray-500">Usually 10% of gross interest (with TIN). It becomes an advance tax credit.</p>
            </div>
            <div>
              <label className={LABEL}>Bank tax certificate no.</label>
              <input value={aitCertificateNo} onChange={e => setAitCertificateNo(e.target.value)} placeholder="If already received" className={INPUT} />
            </div>
          </div>
        )}

        {kind === 'LOAN_REPAYMENT' && (
          <div className="sm:w-1/2">
            <label className={LABEL}>Interest included ({currency})</label>
            <AmountInput value={interest} onChange={setInterest} currency={currency} error={errors.interestAmount} />
            <FieldError message={errors.interestAmount} />
          </div>
        )}

        {kind === 'OTHER_INCOME' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Income category</label>
              <select value={category} onChange={e => { setCategory(e.target.value); setSubcategory('') }} className={INPUT}>
                <option value="">Other Income</option>
                {(incomeCategories ?? []).map(c => <option key={c.id} value={c.label}>{c.label}</option>)}
              </select>
            </div>
            {subcategories.length > 0 && (
              <div>
                <label className={LABEL}>Subcategory</label>
                <select value={subcategory} onChange={e => setSubcategory(e.target.value)} className={INPUT}>
                  <option value="">—</option>
                  {subcategories.map(s => <option key={s} value={s}>{s}</option>)}
                </select>
              </div>
            )}
          </div>
        )}

        {def.partyLabel && (
          <div className="sm:w-1/2">
            <label className={LABEL}>{def.partyLabel}</label>
            <input value={party} onChange={e => setParty(e.target.value)} placeholder={kind.startsWith('LOAN') ? 'e.g. IDLC Finance / Director' : 'Name'} className={INPUT} />
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div className="sm:col-span-2">
            <label className={LABEL}>{isAdjustment ? 'Reason' : 'Description'}{isAdjustment && <span className="text-red-500"> *</span>}</label>
            <input value={description} onChange={e => setDescription(e.target.value)} placeholder={isAdjustment ? 'e.g. Cash count on 30 Sep short by ৳120 — booking error' : def.label} className={cn(INPUT, errors.description && INPUT_ERR)} />
            <FieldError message={errors.description} />
          </div>
          <div>
            <label className={LABEL}>Reference</label>
            <input value={reference} onChange={e => setReference(e.target.value)} placeholder="Statement / voucher ref" className={INPUT} />
          </div>
          <div>
            <label className={LABEL}>Channel</label>
            <select value={channel} onChange={e => setChannel(e.target.value)} className={INPUT}>
              <option value="">Automatic (from account)</option>
              {MOVEMENT_CHANNELS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
            </select>
          </div>
        </div>

        <FileUpload value={receiptUrl} onUploaded={setReceiptUrl} label="Statement / advice (optional)" />

        {effect && (
          <div className={cn('rounded-xl border p-3 text-xs space-y-0.5', isIn ? 'border-emerald-100 bg-emerald-50/50 text-emerald-900' : 'border-rose-100 bg-rose-50/50 text-rose-900')}>
            <p className="font-semibold">{account ? account.name : 'Effect'}</p>
            {effect.lines.map((l, i) => <p key={i} className="tabular-nums">{l}</p>)}
          </div>
        )}
      </div>

      <ModalFooter className={FOOTER_STICKY}>
        <button type="button" className={BTN_SECONDARY} onClick={() => onOpenChange(false)} disabled={saving}>Cancel</button>
        <button type="button" className={BTN_PRIMARY} onClick={submit} disabled={saving || loading}>
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          Record {def.short.toLowerCase()}
        </button>
      </ModalFooter>
    </Modal>
  )
}
