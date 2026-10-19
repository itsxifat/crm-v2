'use client'

import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Loader2, Lock, Info, Check, ChevronDown, Star, RotateCcw } from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import DatePicker from '@/components/ui/DatePicker'
import PeoplePicker from '@/components/ui/PeoplePicker'
import { useConfig } from '@/lib/useConfig'
import { CURRENCIES } from '@/lib/currencies'
import { cn } from '@/lib/utils'
import { dayKeyLabel, addDays } from '@/lib/finance/fiscal'
import {
  MONEY_ACCOUNT_TYPES, MFS_PROVIDERS, MFS_PROVIDER_LABELS, WALLET_TYPES, BD_BANKS, CASH_ACCOUNT_TYPES,
  accountTypeGroup, defaultAllowNegative,
} from '@/lib/finance/constants'
import { invalidateMoneyAccounts } from './MoneyAccountSelect'
import AccountIcon from './AccountIcon'
import AmountInput from './AmountInput'
import { FieldError } from './FinanceDialogs'
import {
  INPUT, INPUT_ERR, LABEL, BTN_PRIMARY, BTN_SECONDARY, FOOTER_STICKY, ACCOUNT_COLOR_SWATCHES,
  accountColor, accountSubtitle, findBank, parseAmount, todayKey, dayKeyOf, fetchJson, plainAmount,
} from './accountTheme'

const TYPE_HINTS = {
  BANK_CURRENT: 'Cheques, BEFTN / RTGS / NPSB',
  BANK_SAVINGS: 'SND / STD / savings',
  CASH:         'Office cash box',
  PETTY_CASH:   'Float held by a custodian',
  MFS:          'bKash, Nagad, Rocket…',
  CARD:         'Company debit / credit card',
  GATEWAY:      'SSLCommerz, aamarPay…',
  LOAN_OD:      'Term loan or overdraft',
  OTHER:        'Payoneer, Wise, escrow…',
}

const GATEWAY_PROVIDERS = ['SSLCommerz', 'aamarPay', 'shurjoPay', 'EPS', 'bKash Payment Gateway', 'Nagad Payment Gateway', 'Portwallet', 'Stripe', 'PayPal']

const BANK_TYPES = ['BANK_CURRENT', 'BANK_SAVINGS', 'LOAN_OD']

function overdraftModeOf(account, type) {
  if (!account) return defaultAllowNegative(type) ? 'UNLIMITED' : 'NONE'
  if (account.allowNegative) return 'UNLIMITED'
  return (Number(account.creditLimit) || 0) > 0 ? 'LIMIT' : 'NONE'
}

function initialForm(account, settings) {
  const type = account?.type ?? 'BANK_CURRENT'
  return {
    type,
    name:             account?.name ?? '',
    code:             account?.code ?? '',
    bankName:         account?.bankName ?? '',
    branchName:       account?.branchName ?? '',
    accountName:      account?.accountName ?? '',
    accountNumber:    account?.accountNumber ?? '',
    routingNumber:    account?.routingNumber ?? '',
    swiftCode:        account?.swiftCode ?? '',
    mfsProvider:      account?.mfsProvider ?? '',
    walletType:       account?.walletType ?? (account ? '' : 'MERCHANT'),
    currency:         account?.currency ?? 'BDT',
    openingBalance:   account ? (Math.abs(Number(account.openingBalance) || 0) > 0 ? plainAmount(account.openingBalance) : '') : '',
    openingDate:      account ? (dayKeyOf(account.openingDate) || '') : (settings?.goLiveDate || todayKey()),
    openingReference: account?.openingReference ?? '',
    overdraft:        overdraftModeOf(account, type),
    creditLimit:      account && Number(account.creditLimit) > 0 ? plainAmount(account.creditLimit) : '',
    isBankingChannel: account ? account.isBankingChannel !== false : !CASH_ACCOUNT_TYPES.includes(type),
    custodian:        account?.custodian?.employeeId
      ? { id: account.custodian.employeeId, type: 'EMPLOYEE', name: account.custodian.name, avatar: account.custodian.avatar, sub: account.custodian.sub }
      : null,
    linkedPaymentMethods: Array.isArray(account?.linkedPaymentMethods) ? account.linkedPaymentMethods : [],
    isDefault:        account ? !!account.isDefault : false,
    color:            account?.color ?? '',
    notes:            account?.notes ?? '',
  }
}

function suggestName(f) {
  const bank = findBank(f.bankName)
  const short = bank?.short ?? (f.bankName ? f.bankName.trim().split(/\s+/)[0] : '')
  const suffix = f.currency && f.currency !== 'BDT' ? ` (${f.currency})` : ''
  let base = ''
  switch (f.type) {
    case 'BANK_CURRENT': base = short ? `${short} Current` : ''; break
    case 'BANK_SAVINGS': base = short ? `${short} Savings` : ''; break
    case 'CASH':         base = 'Cash in hand'; break
    case 'PETTY_CASH':   base = f.custodian?.name ? `Petty cash — ${f.custodian.name}` : 'Petty cash'; break
    case 'MFS': {
      const p = f.mfsProvider ? (MFS_PROVIDER_LABELS[f.mfsProvider] ?? '').split(' ')[0] : ''
      const w = WALLET_TYPES.find(x => x.value === f.walletType)?.label ?? ''
      base = p ? `${p}${w ? ` ${w}` : ''}` : ''
      break
    }
    case 'CARD':    base = short ? `${short} Card` : 'Company card'; break
    case 'GATEWAY': base = f.bankName ? `${f.bankName.trim()}` : ''; break
    case 'LOAN_OD': base = short ? `${short} Loan / OD` : ''; break
    default:        base = f.bankName ? f.bankName.trim() : ''
  }
  return base ? `${base}${suffix}` : ''
}

function Section({ title, hint, children, className }) {
  return (
    <section className={cn('space-y-3', className)}>
      <div>
        <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
        {hint && <p className="text-xs text-gray-500 mt-0.5">{hint}</p>}
      </div>
      {children}
    </section>
  )
}

/**
 * Create / edit a money account.
 * Props: open, onOpenChange, account (null = create), accounts (for linked-method hints),
 *        settings ({ openingLocked, goLiveDate }), onSaved(account)
 */
export default function AccountFormModal({ open, onOpenChange, account = null, accounts = [], settings = {}, onSaved }) {
  const isEdit = !!account
  const { paymentMethods } = useConfig()
  const [form, setForm] = useState(() => initialForm(account, settings))
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [nameTouched, setNameTouched] = useState(isEdit)
  const [overdraftTouched, setOverdraftTouched] = useState(isEdit)
  const [custodianTouched, setCustodianTouched] = useState(false)
  const [numberLocked, setNumberLocked] = useState(false)
  const [routingLocked, setRoutingLocked] = useState(false)
  const [showAdvanced, setShowAdvanced] = useState(false)

  useEffect(() => {
    if (!open) return
    setForm(initialForm(account, settings))
    setErrors({})
    setSaving(false)
    setNameTouched(!!account)
    setOverdraftTouched(!!account)
    setCustodianTouched(false)
    setNumberLocked(!!account?.accountNumber && String(account.accountNumber).includes('••'))
    setRoutingLocked(!!account?.routingNumber && String(account.routingNumber).includes('••'))
    setShowAdvanced(!!(account?.code || account?.color || account?.notes))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, account?.id])

  const set = (patch) => {
    setForm(prev => {
      const next = { ...prev, ...patch }
      if (patch.type && patch.type !== prev.type) {
        if (!overdraftTouched) next.overdraft = defaultAllowNegative(patch.type) ? 'UNLIMITED' : 'NONE'
        if (CASH_ACCOUNT_TYPES.includes(patch.type)) next.isBankingChannel = false
        else if (CASH_ACCOUNT_TYPES.includes(prev.type)) next.isBankingChannel = true
      }
      if (!nameTouched && !isEdit && !('name' in patch)) next.name = suggestName(next)
      return next
    })
    setErrors(prev => {
      const copy = { ...prev }
      for (const k of Object.keys(patch)) delete copy[k]
      return copy
    })
  }

  const type = form.type
  const isCash = CASH_ACCOUNT_TYPES.includes(type)
  const isMfs = type === 'MFS'
  const isBank = BANK_TYPES.includes(type)
  const txCount = account?.txCount ?? 0
  const lockedGroup = isEdit && txCount > 0 ? accountTypeGroup(account.type) : null
  const currencyLocked = isEdit && txCount > 0
  const openingLocked = !!settings?.openingLocked
  const reconciled = isEdit && !!(account?.lastReconciledDate || account?.reconciliationInProgress)
  const openingDisabled = openingLocked || reconciled

  const preview = useMemo(() => ({
    ...form,
    name: form.name || suggestName(form) || 'New account',
    last4: numberLocked ? account?.last4 : (String(form.accountNumber).replace(/\D/g, '').slice(-4) || null),
  }), [form, numberLocked, account?.last4])

  const methods = useMemo(() => {
    const list = [...(paymentMethods ?? [])]
    for (const v of form.linkedPaymentMethods) {
      if (!list.some(m => String(m.value).toUpperCase() === String(v).toUpperCase())) list.push({ value: v, label: v.replace(/_/g, ' ') })
    }
    return list
  }, [paymentMethods, form.linkedPaymentMethods])

  const linkedElsewhere = (value) => accounts
    .filter(a => a.id !== account?.id && (a.status ?? 'ACTIVE') === 'ACTIVE' && (a.currency || 'BDT') === form.currency
      && (a.linkedPaymentMethods ?? []).some(m => String(m).toUpperCase() === String(value).toUpperCase()))
    .map(a => a.name)

  const toggleMethod = (value) => {
    const v = String(value).toUpperCase()
    const has = form.linkedPaymentMethods.some(m => String(m).toUpperCase() === v)
    set({ linkedPaymentMethods: has ? form.linkedPaymentMethods.filter(m => String(m).toUpperCase() !== v) : [...form.linkedPaymentMethods, v] })
  }

  const onBankName = (value) => {
    const patch = { bankName: value }
    const bank = findBank(value)
    if (bank?.swift && !form.swiftCode && BANK_TYPES.includes(type) && bank.name === value) patch.swiftCode = bank.swift
    set(patch)
  }

  function validate() {
    const e = {}
    if (!form.name.trim()) e.name = 'Give the account a name'
    if (isMfs && !form.mfsProvider) e.mfsProvider = 'Choose the wallet provider'
    if ((type === 'BANK_CURRENT' || type === 'BANK_SAVINGS') && !form.bankName.trim()) e.bankName = 'Bank name is required'
    if (!numberLocked && isMfs && form.accountNumber) {
      let d = String(form.accountNumber).replace(/\D/g, '')
      if (d.startsWith('880')) d = d.slice(2)
      if (!/^01\d{9,10}$/.test(d)) e.accountNumber = 'Wallet number should look like 01XXXXXXXXX'
    }
    if (!routingLocked && form.routingNumber && !/^\d{9}$/.test(form.routingNumber.replace(/\s+/g, ''))) e.routingNumber = 'Routing number is 9 digits'
    if (form.swiftCode && !/^[A-Za-z]{4}[A-Za-z]{2}[A-Za-z0-9]{2}([A-Za-z0-9]{3})?$/.test(form.swiftCode.replace(/\s+/g, ''))) e.swiftCode = '8 or 11 characters, e.g. BRAKBDDH'
    if (form.overdraft === 'LIMIT' && !(parseAmount(form.creditLimit) > 0)) e.creditLimit = 'Enter the overdraft limit'
    if (!openingDisabled && form.openingBalance !== '' && !Number.isFinite(parseAmount(form.openingBalance))) e.openingBalance = 'Enter a number'
    if (!openingDisabled && form.openingDate && form.openingDate > todayKey()) e.openingDate = 'Opening date cannot be in the future'
    if (form.code && !/^[A-Za-z0-9_-]{1,12}$/.test(form.code)) e.code = 'Up to 12 letters, digits, - or _'
    return e
  }

  async function submit() {
    const e = validate()
    if (Object.keys(e).length) {
      setErrors(e)
      toast.error(Object.values(e)[0])
      return
    }
    const payload = {
      name: form.name.trim(),
      type,
      currency: form.currency,
      code: form.code.trim() || null,
      bankName: isCash || isMfs ? null : (form.bankName.trim() || null),
      branchName: isBank ? (form.branchName.trim() || null) : null,
      swiftCode: isBank ? (form.swiftCode.trim() || null) : null,
      accountName: isCash ? null : (form.accountName.trim() || null),
      mfsProvider: isMfs ? form.mfsProvider : null,
      walletType: isMfs ? (form.walletType || null) : null,
      allowNegative: form.overdraft === 'UNLIMITED',
      creditLimit: form.overdraft === 'LIMIT' ? parseAmount(form.creditLimit) : 0,
      linkedPaymentMethods: form.linkedPaymentMethods,
      isDefault: !!form.isDefault,
      color: form.color || null,
      notes: form.notes.trim() || null,
    }
    if (!isCash) payload.isBankingChannel = !!form.isBankingChannel
    if (!numberLocked) payload.accountNumber = isCash ? null : (form.accountNumber.trim() || null)
    if (!routingLocked) payload.routingNumber = isBank ? (form.routingNumber.replace(/\s+/g, '') || null) : null
    if (!openingDisabled) {
      const ob = form.openingBalance === '' ? 0 : parseAmount(form.openingBalance)
      payload.openingBalance = ob
      payload.openingDate = form.openingDate || null
      payload.openingReference = form.openingReference.trim() || null
    }
    if (custodianTouched || (!isEdit && form.custodian)) payload.custodianEmployeeId = isCash ? (form.custodian?.id ?? null) : null

    setSaving(true)
    try {
      const json = await fetchJson(isEdit ? `/api/finance/accounts/${account.id}` : '/api/finance/accounts', {
        method: isEdit ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      invalidateMoneyAccounts()
      toast.success(isEdit ? 'Account updated' : 'Account added')
      onSaved?.(json.data)
      onOpenChange(false)
    } catch (err) {
      const fe = err.details?.fieldErrors ?? {}
      const mapped = Object.fromEntries(Object.entries(fe).filter(([, v]) => v?.length).map(([k, v]) => [k === 'custodianEmployeeId' ? 'custodian' : k, v[0]]))
      if (Object.keys(mapped).length) setErrors(mapped)
      toast.error(Object.values(mapped)[0] ?? err.message)
    } finally {
      setSaving(false)
    }
  }

  const numberLabel = {
    BANK_CURRENT: 'Account number', BANK_SAVINGS: 'Account number', LOAN_OD: 'Loan / OD account number',
    MFS: 'Wallet number', CARD: 'Card number (last 4 digits are enough)', GATEWAY: 'Merchant / store ID', OTHER: 'Account / reference number',
  }[type]
  const providerLabel = { CARD: 'Issuing bank', LOAN_OD: 'Lender / bank', GATEWAY: 'Gateway provider', OTHER: 'Provider / institution' }[type] ?? 'Bank name'
  const color = accountColor(preview)
  const goLiveLabel = settings?.goLiveDate ? dayKeyLabel(addDays(settings.goLiveDate, -1)) : null

  return (
    <Modal
      open={open}
      onOpenChange={(v) => !saving && onOpenChange(v)}
      title={isEdit ? 'Edit money account' : 'Add money account'}
      description={isEdit ? 'Changes apply to future entries; history stays as recorded.' : 'A bank account, cash box, mobile wallet or card the business pays from or into.'}
      size="lg"
    >
      <div className="space-y-6">
        {/* Live preview */}
        <div className="flex items-center gap-3 rounded-xl border border-gray-100 p-3" style={{ borderLeft: `4px solid ${color}` }}>
          <AccountIcon account={preview} />
          <div className="min-w-0">
            <p className="text-sm font-semibold text-gray-900 truncate">{preview.name}</p>
            <p className="text-xs text-gray-500 truncate">
              {accountSubtitle(preview)}{preview.last4 ? ` · •••• ${preview.last4}` : ''}{form.currency !== 'BDT' ? ` · ${form.currency}` : ''}
            </p>
          </div>
          {form.isDefault && <span className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-amber-700 bg-amber-50 px-2 py-0.5 rounded-full"><Star className="w-3 h-3" /> Default</span>}
        </div>

        {/* Type */}
        <Section title="Account type" hint={lockedGroup ? 'This account already has transactions, so it can only switch to a similar type.' : null}>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {MONEY_ACCOUNT_TYPES.map(t => {
              const disabled = lockedGroup && accountTypeGroup(t.value) !== lockedGroup
              const active = type === t.value
              return (
                <button
                  key={t.value}
                  type="button"
                  disabled={disabled}
                  onClick={() => set({ type: t.value })}
                  className={cn(
                    'flex items-start gap-2 rounded-xl border p-2.5 text-left transition-colors',
                    active ? 'border-gray-900 ring-1 ring-gray-900 bg-gray-50' : 'border-gray-200 hover:bg-gray-50',
                    disabled && 'opacity-40 cursor-not-allowed hover:bg-white',
                  )}
                >
                  <AccountIcon type={t.value} size="xs" />
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold text-gray-900 leading-tight">{t.label.replace(' (bKash/Nagad…)', '')}</span>
                    <span className="block text-[11px] text-gray-500 leading-tight mt-0.5">{TYPE_HINTS[t.value]}</span>
                  </span>
                  {active && <Check className="w-3.5 h-3.5 text-gray-900 ml-auto shrink-0" />}
                </button>
              )
            })}
          </div>
        </Section>

        {/* Identity */}
        <Section title="Details">
          {isMfs && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={LABEL}>Provider <span className="text-red-500">*</span></label>
                <select value={form.mfsProvider} onChange={e => set({ mfsProvider: e.target.value })} className={cn(INPUT, errors.mfsProvider && INPUT_ERR)}>
                  <option value="">Choose…</option>
                  {MFS_PROVIDERS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                </select>
                <FieldError message={errors.mfsProvider} />
              </div>
              <div>
                <label className={LABEL}>Wallet type</label>
                <select value={form.walletType} onChange={e => set({ walletType: e.target.value })} className={INPUT}>
                  <option value="">Not specified</option>
                  {WALLET_TYPES.map(w => <option key={w.value} value={w.value}>{w.label}</option>)}
                </select>
                {form.walletType === 'AGENT' && <p className="mt-1 text-[11px] text-amber-700">Agent wallets are not meant for business receipts — use a merchant wallet where possible.</p>}
                {form.walletType === 'PERSONAL' && <p className="mt-1 text-[11px] text-gray-500">Personal wallets have lower limits; merchant wallets give statements suitable as Mushak evidence.</p>}
              </div>
            </div>
          )}

          {!isCash && !isMfs && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className={cn(isBank ? '' : 'sm:col-span-2')}>
                <label className={LABEL}>{providerLabel}{(type === 'BANK_CURRENT' || type === 'BANK_SAVINGS') && <span className="text-red-500"> *</span>}</label>
                <input
                  list={type === 'GATEWAY' ? 'finance-gateway-list' : 'finance-bank-list'}
                  value={form.bankName}
                  onChange={e => onBankName(e.target.value)}
                  placeholder={type === 'GATEWAY' ? 'e.g. SSLCommerz' : 'Start typing, e.g. BRAC Bank'}
                  className={cn(INPUT, errors.bankName && INPUT_ERR)}
                />
                <FieldError message={errors.bankName} />
              </div>
              {isBank && (
                <div>
                  <label className={LABEL}>Branch</label>
                  <input value={form.branchName} onChange={e => set({ branchName: e.target.value })} placeholder="e.g. Gulshan" className={INPUT} />
                </div>
              )}
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={LABEL}>Account name in the app <span className="text-red-500">*</span></label>
              <input
                value={form.name}
                onChange={e => { setNameTouched(true); set({ name: e.target.value }) }}
                placeholder="e.g. BRAC Current"
                className={cn(INPUT, errors.name && INPUT_ERR)}
              />
              <FieldError message={errors.name} />
              {nameTouched && !isEdit && suggestName(form) && suggestName(form) !== form.name && (
                <button type="button" onClick={() => { setNameTouched(false); set({ name: suggestName(form) }) }} className="mt-1 inline-flex items-center gap-1 text-[11px] text-gray-500 hover:text-gray-800">
                  <RotateCcw className="w-3 h-3" /> Use “{suggestName(form)}”
                </button>
              )}
            </div>
            <div>
              <label className={LABEL}>Currency</label>
              <select value={form.currency} onChange={e => set({ currency: e.target.value })} disabled={currencyLocked} className={INPUT}>
                {CURRENCIES.map(c => <option key={c.code} value={c.code}>{c.code} — {c.label}</option>)}
              </select>
              {currencyLocked && <p className="mt-1 text-[11px] text-gray-500">Locked — the account already has transactions.</p>}
              {!currencyLocked && form.currency !== 'BDT' && <p className="mt-1 text-[11px] text-gray-500">Foreign-currency balances are shown separately and not added to BDT totals.</p>}
            </div>
          </div>

          {!isCash && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={LABEL}>{numberLabel}</label>
                {numberLocked ? (
                  <div className="flex items-center gap-2">
                    <span className={cn(INPUT, 'bg-gray-50 text-gray-500 tabular-nums')}>{account.accountNumber}</span>
                    <button type="button" onClick={() => { setNumberLocked(false); set({ accountNumber: '' }) }} className="text-xs font-medium text-gray-600 hover:text-gray-900 shrink-0">Replace</button>
                  </div>
                ) : (
                  <input
                    value={form.accountNumber}
                    onChange={e => set({ accountNumber: e.target.value })}
                    inputMode={isMfs ? 'tel' : 'text'}
                    placeholder={isMfs ? '01XXXXXXXXX' : ''}
                    className={cn(INPUT, 'tabular-nums', errors.accountNumber && INPUT_ERR)}
                  />
                )}
                <FieldError message={errors.accountNumber} />
                {!numberLocked && <p className="mt-1 text-[11px] text-gray-400">Shown as •••• last 4 to people without bank-detail access.</p>}
              </div>
              <div>
                <label className={LABEL}>{isMfs ? 'Wallet holder name' : 'Account title'}</label>
                <input value={form.accountName} onChange={e => set({ accountName: e.target.value })} placeholder="Name on the statement" className={INPUT} />
              </div>
            </div>
          )}

          {isBank && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={LABEL}>Routing number</label>
                {routingLocked ? (
                  <div className="flex items-center gap-2">
                    <span className={cn(INPUT, 'bg-gray-50 text-gray-500 tabular-nums')}>{account.routingNumber}</span>
                    <button type="button" onClick={() => { setRoutingLocked(false); set({ routingNumber: '' }) }} className="text-xs font-medium text-gray-600 hover:text-gray-900 shrink-0">Replace</button>
                  </div>
                ) : (
                  <input value={form.routingNumber} onChange={e => set({ routingNumber: e.target.value })} inputMode="numeric" placeholder="9 digits" className={cn(INPUT, 'tabular-nums', errors.routingNumber && INPUT_ERR)} />
                )}
                <FieldError message={errors.routingNumber} />
              </div>
              <div>
                <label className={LABEL}>SWIFT / BIC</label>
                <input value={form.swiftCode} onChange={e => set({ swiftCode: e.target.value.toUpperCase() })} placeholder="e.g. BRAKBDDH" className={cn(INPUT, 'uppercase', errors.swiftCode && INPUT_ERR)} />
                <FieldError message={errors.swiftCode} />
              </div>
            </div>
          )}

          {isCash && (
            <div>
              <label className={LABEL}>Custodian {type === 'PETTY_CASH' && <span className="text-gray-400 font-normal">(recommended)</span>}</label>
              <PeoplePicker
                types={['EMPLOYEE']}
                typeFilter={false}
                value={form.custodian}
                onChange={(p) => { setCustodianTouched(true); set({ custodian: p }) }}
                placeholder="Who holds this cash?"
              />
              {isEdit && account?.custodian && !account.custodian.employeeId && !custodianTouched && (
                <p className="mt-1 text-[11px] text-gray-500">Current custodian: {account.custodian.name}</p>
              )}
              <FieldError message={errors.custodian} />
            </div>
          )}
        </Section>

        {/* Opening balance */}
        <Section
          title="Opening balance"
          hint={openingDisabled ? null : `The balance on the ${isCash ? 'cash count' : 'statement'} at the end of the day before the opening date${goLiveLabel ? ` (go-live: balance as at ${goLiveLabel})` : ''}. Entries dated before the opening date are ignored for the balance.`}
        >
          {openingDisabled && (
            <div className="flex items-start gap-2 rounded-lg bg-amber-50 border border-amber-100 px-3 py-2 text-xs text-amber-800">
              <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              <span>
                {openingLocked
                  ? 'Opening balances are locked (Finance → Opening Balances). Record the first deposit as a transfer or a “Capital introduced” movement instead.'
                  : 'This account has been reconciled — undo its reconciliations before changing the opening balance.'}
                {isEdit && (
                  <span className="block mt-1 text-amber-900">
                    Current: <strong className="tabular-nums">{plainAmount(account.openingBalance)}</strong>{account.openingDate ? ` as of ${dayKeyLabel(account.openingDate)}` : ''}{account.openingReference ? ` · ${account.openingReference}` : ''}
                  </span>
                )}
              </span>
            </div>
          )}
          {!openingDisabled && (
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className={LABEL}>Amount ({form.currency})</label>
                <AmountInput value={form.openingBalance} onChange={v => set({ openingBalance: v })} currency={form.currency} allowNegative={form.overdraft !== 'NONE'} error={errors.openingBalance} />
                <FieldError message={errors.openingBalance} />
              </div>
              <div>
                <label className={LABEL}>Opening date</label>
                <DatePicker value={form.openingDate || null} onChange={v => set({ openingDate: v ?? '' })} placeholder="From the first entry" />
                <FieldError message={errors.openingDate} />
              </div>
              <div>
                <label className={LABEL}>Statement reference</label>
                <input value={form.openingReference} onChange={e => set({ openingReference: e.target.value })} placeholder="e.g. Stmt 30 Jun 2026" className={INPUT} />
              </div>
            </div>
          )}
        </Section>

        {/* Behaviour */}
        <Section title="Overdraft & usage">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            {[
              { v: 'NONE', t: 'Not allowed', d: 'Payments that would take it below zero are refused' },
              { v: 'LIMIT', t: 'Up to a limit', d: 'Overdraft facility with a fixed limit' },
              { v: 'UNLIMITED', t: 'No limit', d: 'Current account / loan / card may go negative' },
            ].map(o => (
              <label key={o.v} className={cn('flex items-start gap-2 rounded-xl border p-2.5 cursor-pointer', form.overdraft === o.v ? 'border-gray-900 bg-gray-50' : 'border-gray-200 hover:bg-gray-50')}>
                <input type="radio" name="overdraft" checked={form.overdraft === o.v} onChange={() => { setOverdraftTouched(true); set({ overdraft: o.v }) }} className="mt-0.5 accent-gray-900" />
                <span>
                  <span className="block text-xs font-semibold text-gray-900">{o.t}</span>
                  <span className="block text-[11px] text-gray-500 leading-tight">{o.d}</span>
                </span>
              </label>
            ))}
          </div>
          {form.overdraft === 'LIMIT' && (
            <div className="sm:w-1/2">
              <label className={LABEL}>Overdraft limit ({form.currency})</label>
              <AmountInput value={form.creditLimit} onChange={v => set({ creditLimit: v })} currency={form.currency} error={errors.creditLimit} />
              <FieldError message={errors.creditLimit} />
            </div>
          )}

          <div>
            <label className={LABEL}>Default for payment methods</label>
            <div className="flex flex-wrap gap-1.5">
              {methods.map(m => {
                const on = form.linkedPaymentMethods.some(x => String(x).toUpperCase() === String(m.value).toUpperCase())
                const elsewhere = linkedElsewhere(m.value)
                return (
                  <button
                    key={m.value}
                    type="button"
                    onClick={() => toggleMethod(m.value)}
                    title={elsewhere.length ? `Also linked to ${elsewhere.join(', ')}` : undefined}
                    className={cn(
                      'inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors',
                      on ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 text-gray-600 hover:bg-gray-50',
                    )}
                  >
                    {on && <Check className="w-3 h-3" />}
                    {m.label}
                    {elsewhere.length > 0 && <span className={cn('text-[10px]', on ? 'text-gray-300' : 'text-amber-600')}>•{elsewhere.length}</span>}
                  </button>
                )
              })}
            </div>
            <p className="mt-1 text-[11px] text-gray-500">When someone records a payment with one of these methods, this account is picked automatically. An amber dot means another {form.currency} account is linked too.</p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
            <label className="flex items-start gap-2 rounded-xl border border-gray-200 p-2.5 cursor-pointer hover:bg-gray-50">
              <input type="checkbox" checked={form.isDefault} onChange={e => set({ isDefault: e.target.checked })} className="mt-0.5 rounded border-gray-300 accent-gray-900" />
              <span>
                <span className="block text-xs font-semibold text-gray-900">Default {form.currency} account</span>
                <span className="block text-[11px] text-gray-500 leading-tight">Pre-selected when no payment method matches.</span>
              </span>
            </label>
            {!isCash && (
              <label className="flex items-start gap-2 rounded-xl border border-gray-200 p-2.5 cursor-pointer hover:bg-gray-50">
                <input type="checkbox" checked={form.isBankingChannel} onChange={e => set({ isBankingChannel: e.target.checked })} className="mt-0.5 rounded border-gray-300 accent-gray-900" />
                <span>
                  <span className="block text-xs font-semibold text-gray-900">Counts as a banking channel</span>
                  <span className="block text-[11px] text-gray-500 leading-tight">Bank/MFS transfers satisfy the ITA s.55 cash rules and avoid the +50% TDS rate.</span>
                </span>
              </label>
            )}
          </div>
        </Section>

        {/* Advanced */}
        <div className="border-t border-gray-100 pt-4">
          <button type="button" onClick={() => setShowAdvanced(s => !s)} className="inline-flex items-center gap-1 text-sm font-medium text-gray-700 hover:text-gray-900">
            <ChevronDown className={cn('w-4 h-4 transition-transform', showAdvanced && 'rotate-180')} /> More options
          </button>
          {showAdvanced && (
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className={LABEL}>Short code</label>
                  <input value={form.code} onChange={e => set({ code: e.target.value.toUpperCase() })} placeholder="e.g. BRAC-01" className={cn(INPUT, 'uppercase', errors.code && INPUT_ERR)} />
                  <FieldError message={errors.code} />
                </div>
                <div>
                  <label className={LABEL}>Card colour</label>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button type="button" onClick={() => set({ color: '' })} className={cn('h-7 px-2 rounded-lg border text-[11px] font-medium', !form.color ? 'border-gray-900 text-gray-900' : 'border-gray-200 text-gray-500')}>Auto</button>
                    {ACCOUNT_COLOR_SWATCHES.map(c => (
                      <button
                        key={c}
                        type="button"
                        aria-label={`Colour ${c}`}
                        onClick={() => set({ color: c })}
                        className={cn('w-7 h-7 rounded-lg border-2', form.color === c ? 'border-gray-900' : 'border-transparent')}
                        style={{ backgroundColor: c }}
                      />
                    ))}
                  </div>
                </div>
              </div>
              <div>
                <label className={LABEL}>Notes</label>
                <textarea rows={2} value={form.notes} onChange={e => set({ notes: e.target.value })} placeholder="Signatories, limits, relationship manager…" className={cn(INPUT, 'resize-none')} />
              </div>
            </div>
          )}
        </div>

        {!isEdit && (
          <p className="flex items-start gap-1.5 text-[11px] text-gray-500">
            <Info className="w-3.5 h-3.5 mt-px shrink-0" />
            After go-live every payment, receipt and transfer must name the account it moved through, so balances here stay real.
          </p>
        )}
      </div>

      <datalist id="finance-bank-list">
        {BD_BANKS.map(b => <option key={b} value={b} />)}
      </datalist>
      <datalist id="finance-gateway-list">
        {GATEWAY_PROVIDERS.map(b => <option key={b} value={b} />)}
      </datalist>

      <ModalFooter className={FOOTER_STICKY}>
        <button type="button" className={BTN_SECONDARY} onClick={() => onOpenChange(false)} disabled={saving}>Cancel</button>
        <button type="button" className={BTN_PRIMARY} onClick={submit} disabled={saving}>
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          {isEdit ? 'Save changes' : 'Add account'}
        </button>
      </ModalFooter>
    </Modal>
  )
}
