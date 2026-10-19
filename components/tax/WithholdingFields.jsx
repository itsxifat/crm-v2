'use client'

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ChevronDown, Info, Loader2, Sparkles } from 'lucide-react'
import DatePicker from '@/components/ui/DatePicker'
import Badge from '@/components/ui/Badge'
import { Input, Label } from '@/components/ui/Input'
import { cn } from '@/lib/utils'
import { round2 } from '@/lib/tax/catalog'
import TaxCodeSelect from './TaxCodeSelect'

/**
 * WithholdingFields — collapsible "Tax withholding (VDS / TDS)" panel.
 *
 * Props:
 *   mode            'PAYEE'    — we withhold from a supplier / payee (expense, purchase bill)
 *                   'CUSTOMER' — the client withheld from our invoice (payment confirmation)
 *   baseAmount      taxable value EXCLUDING VAT (BDT) — base for both TDS and VDS
 *   vatAmount       VAT on the bill / invoice (caps VDS; 0 ⇒ no VDS)
 *   payeeType       'COMPANY' | 'INDIVIDUAL' | 'NON_RESIDENT' (TDS rate)
 *   hasPsr          payee showed proof of return submission (else +50% TDS)
 *   bankingChannel  payment through a bank / MFS (else +50% TDS)
 *   value           { vdsAmount, vdsRate, vatServiceCode, tdsSection, tdsRate, tdsAmount, higherRateApplied,
 *                     vdsCertificateNo, vdsCertificateDate, tdsCertificateNo, tdsCertificateDate }
 *   onChange        (nextValue) => void — always receives the full object
 *   disabled, compact
 *   supplierVatType 'REGISTERED' | 'TURNOVER' | 'UNREGISTERED' | 'FOREIGN' (PAYEE mode; default REGISTERED)
 *   date            'YYYY-MM-DD' — rates effective on that day (default today)
 *   defaultOpen     open initially (default: open when any withholding is set)
 *   vdsAllowed      false ⇒ the VDS inputs are locked at 0 with a note (CUSTOMER mode
 *                   on an invoice that carries no VAT — see invoiceAllowsVds)
 *
 * PAYEE mode fills amounts automatically from /api/tax/suggest until the user
 * edits them; CUSTOMER mode only offers "Use suggested" (the client's actual
 * deduction is what counts). Amounts are numbers in BDT; dates 'YYYY-MM-DD'.
 */

/**
 * Can VDS be withheld from this (sales) invoice? Not from one that carries no
 * VAT: zero-rated / exempt, or issued as 'No VAT' under the VAT module
 * (issuedAt set). Legacy non-VAT invoices issued before it stay open, as on the
 * server (lib/paymentLedger.js invoiceVdsCap). No invoice ⇒ true.
 */
export function invoiceAllowsVds(invoice) {
  if (!invoice || typeof invoice !== 'object') return true
  const t = ['STANDARD', 'REDUCED', 'ZERO_RATED', 'EXEMPT', 'NONE'].includes(invoice.vatTreatment) ? invoice.vatTreatment : 'NONE'
  if (t === 'ZERO_RATED' || t === 'EXEMPT') return false
  return !(t === 'NONE' && invoice.issuedAt)
}

export function emptyWithholding() {
  return {
    vdsAmount: 0,
    vdsRate: null,
    vatServiceCode: null,
    tdsSection: null,
    tdsRate: null,
    tdsAmount: 0,
    higherRateApplied: false,
    vdsCertificateNo: null,
    vdsCertificateDate: null,
    tdsCertificateNo: null,
    tdsCertificateDate: null,
  }
}

const DEBOUNCE_MS = 350

const toNum = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const fmt = (n) => toNum(n).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

const differs = (a, b) => Math.abs(toNum(a) - toNum(b)) >= 0.005

async function fetchSuggestion(params, signal) {
  const qs = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) {
    if (v !== null && v !== undefined && v !== '') qs.set(k, String(v))
  }
  const res = await fetch(`/api/tax/suggest?${qs.toString()}`, { signal })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(json.error || 'Could not get a suggestion')
  return json.data
}

function useSuggestion(enabled, params, deps) {
  const [state, setState] = useState({ loading: false, data: null, error: null })
  useEffect(() => {
    if (!enabled) {
      setState({ loading: false, data: null, error: null })
      return undefined
    }
    const controller = new AbortController()
    setState(s => ({ ...s, loading: true, error: null }))
    const timer = setTimeout(() => {
      fetchSuggestion(params, controller.signal)
        .then(data => setState({ loading: false, data, error: null }))
        .catch(err => {
          if (err?.name === 'AbortError') return
          setState({ loading: false, data: null, error: err.message })
        })
    }, DEBOUNCE_MS)
    return () => {
      clearTimeout(timer)
      controller.abort()
    }
  }, deps) // eslint-disable-line react-hooks/exhaustive-deps
  return state
}

function Reasons({ reasons }) {
  if (!reasons?.length) return null
  return (
    <ul className="mt-1 space-y-0.5">
      {reasons.map((r, i) => {
        const warn = r.startsWith('+50%') || /not |no |cannot|deactivated|verify/i.test(r)
        const Icon = warn ? AlertTriangle : Info
        return (
          <li key={i} className={cn('flex items-start gap-1.5 text-xs leading-snug', warn ? 'text-amber-700' : 'text-muted-foreground')}>
            <Icon className="mt-px size-3.5 shrink-0" />
            <span>{r}</span>
          </li>
        )
      })}
    </ul>
  )
}

function SuggestionLine({ state, current, onUse, disabled, label }) {
  if (state.loading) {
    return (
      <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Loader2 className="size-3.5 animate-spin" /> Calculating {label}…
      </p>
    )
  }
  if (state.error) return <p className="mt-2 text-xs text-red-600">{state.error}</p>
  const s = state.data
  if (!s) return null
  const showUse = differs(s.amount, current.amount) || (s.rate !== null && s.rate !== undefined && differs(s.rate, current.rate))
  return (
    <div className="mt-2 rounded-lg bg-gray-50 px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-gray-600">
        <Sparkles className="size-3.5 text-gray-400" />
        <span>
          Suggested{s.rate !== null && s.rate !== undefined ? ` ${s.rate}%` : ''} → <span className="font-medium text-gray-900 tabular-nums">৳ {fmt(s.amount)}</span>
          {s.appliedBasis === 'COMMISSION' ? ' (on commission)' : ''}
        </span>
        {showUse && !disabled && (
          <button
            type="button"
            onClick={onUse}
            className="ml-auto text-xs font-medium text-gray-900 underline-offset-4 hover:underline"
          >
            Use suggested
          </button>
        )}
      </div>
      <Reasons reasons={s.reasons} />
    </div>
  )
}

function AmountInput({ value, onChange, disabled, placeholder = '0.00', suffix, compact, zeroOnBlur = true }) {
  return (
    <div className="relative">
      <Input
        type="number"
        inputMode="decimal"
        min="0"
        step="0.01"
        value={value === null || value === undefined ? '' : value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={e => onChange(e.target.value === '' ? null : Number(e.target.value))}
        onBlur={e => { if (zeroOnBlur && e.target.value === '') onChange(0, true) }}
        className={cn('tabular-nums', compact && 'h-8 px-2.5 text-[13px]', suffix && 'pr-7')}
      />
      {suffix && <span className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">{suffix}</span>}
    </div>
  )
}

export default function WithholdingFields({
  mode = 'PAYEE',
  baseAmount,
  vatAmount = 0,
  payeeType = 'COMPANY',
  hasPsr = true,
  bankingChannel = true,
  value,
  onChange,
  disabled = false,
  compact = false,
  supplierVatType = 'REGISTERED',
  date = null,
  defaultOpen,
  vdsAllowed = true,
}) {
  const v = { ...emptyWithholding(), ...(value ?? {}) }
  const isCustomer = mode === 'CUSTOMER'
  const vdsLocked = disabled || !vdsAllowed
  const base = Math.max(0, round2(toNum(baseAmount)))
  const vat = vatAmount === null || vatAmount === undefined ? null : Math.max(0, round2(toNum(vatAmount)))

  const [open, setOpen] = useState(() => defaultOpen ?? (
    toNum(v.vdsAmount) > 0 || toNum(v.tdsAmount) > 0 || Boolean(v.tdsSection) || Boolean(v.vatServiceCode)
  ))

  // Latest value, updated synchronously on every emit so back-to-back updates merge correctly.
  const valueRef = useRef(v)
  valueRef.current = v
  const emit = (patch) => {
    const next = { ...valueRef.current, ...patch }
    valueRef.current = next
    onChange?.(next)
  }

  // Auto-apply suggestions (PAYEE mode) until the user types an amount or rate.
  const autoTds = useRef(!isCustomer && !(toNum(v.tdsAmount) > 0))
  const autoVds = useRef(!isCustomer && !(toNum(v.vdsAmount) > 0))

  const tdsState = useSuggestion(
    Boolean(v.tdsSection) && base > 0,
    { type: 'tds', section: v.tdsSection, payeeType, base, hasPsr: hasPsr ? 1 : 0, bank: bankingChannel ? 1 : 0, date, mode },
    [v.tdsSection, base, payeeType, hasPsr, bankingChannel, date, mode],
  )
  const vdsEnabled = vdsAllowed && base > 0 && (isCustomer || Boolean(v.vatServiceCode))
  const vdsState = useSuggestion(
    vdsEnabled,
    { type: 'vds', serviceCode: v.vatServiceCode, base, vat, supplierVatType, date, mode },
    [v.vatServiceCode, base, vat, supplierVatType, date, mode, vdsEnabled],
  )

  useEffect(() => {
    const s = tdsState.data
    if (!s || !autoTds.current || disabled) return
    const cur = valueRef.current
    if (differs(s.amount, cur.tdsAmount) || differs(s.rate, cur.tdsRate) || Boolean(s.higherRateApplied) !== Boolean(cur.higherRateApplied)) {
      emit({ tdsRate: s.rate, tdsAmount: s.amount, higherRateApplied: Boolean(s.higherRateApplied) })
    }
  }, [tdsState.data]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const s = vdsState.data
    if (!s || !autoVds.current || disabled || isCustomer) return
    const cur = valueRef.current
    if (differs(s.amount, cur.vdsAmount) || differs(s.rate, cur.vdsRate)) {
      emit({ vdsRate: s.rate, vdsAmount: s.amount })
    }
  }, [vdsState.data]) // eslint-disable-line react-hooks/exhaustive-deps

  // No VDS on a bill / invoice that carries no VAT: clear anything entered before.
  useEffect(() => {
    if (vdsAllowed || disabled) return
    const cur = valueRef.current
    if (toNum(cur.vdsAmount) > 0 || cur.vdsRate !== null || cur.vdsCertificateNo || cur.vdsCertificateDate) {
      emit({ vdsAmount: 0, vdsRate: null, vdsCertificateNo: null, vdsCertificateDate: null })
    }
  }, [vdsAllowed]) // eslint-disable-line react-hooks/exhaustive-deps

  // PAYEE mode: no base ⇒ nothing to withhold (only while amounts are still automatic).
  useEffect(() => {
    if (base > 0 || disabled || isCustomer) return
    const cur = valueRef.current
    const patch = {}
    if (autoTds.current && toNum(cur.tdsAmount) > 0) patch.tdsAmount = 0
    if (autoVds.current && toNum(cur.vdsAmount) > 0) patch.vdsAmount = 0
    if (Object.keys(patch).length) emit(patch)
  }, [base]) // eslint-disable-line react-hooks/exhaustive-deps

  function onTdsSection(code) {
    autoTds.current = !isCustomer
    emit(code ? { tdsSection: code } : { tdsSection: null, tdsRate: null, tdsAmount: 0, higherRateApplied: false })
  }

  function onVdsCode(code) {
    autoVds.current = !isCustomer
    emit(code ? { vatServiceCode: code } : { vatServiceCode: null, vdsRate: isCustomer ? valueRef.current.vdsRate : null, vdsAmount: isCustomer ? valueRef.current.vdsAmount : 0 })
  }

  function onTdsRate(rate) {
    autoTds.current = false
    const r = rate === null ? null : Math.max(0, rate)
    emit({ tdsRate: r, tdsAmount: r === null ? valueRef.current.tdsAmount : round2((base * r) / 100) })
  }

  function onVdsRate(rate) {
    autoVds.current = false
    const r = rate === null ? null : Math.max(0, rate)
    let amount = r === null ? valueRef.current.vdsAmount : round2((base * r) / 100)
    if (r !== null && vat !== null && vat > 0 && amount > vat) amount = vat
    emit({ vdsRate: r, vdsAmount: amount })
  }

  function onTdsAmount(amount, blurred) {
    if (!blurred) autoTds.current = false
    emit({ tdsAmount: amount === null ? null : Math.max(0, round2(amount)) })
  }

  function onVdsAmount(amount, blurred) {
    if (!blurred) autoVds.current = false
    emit({ vdsAmount: amount === null ? null : Math.max(0, round2(amount)) })
  }

  function applyTdsSuggestion() {
    const s = tdsState.data
    if (!s) return
    autoTds.current = !isCustomer
    emit({ tdsRate: s.rate, tdsAmount: s.amount, higherRateApplied: Boolean(s.higherRateApplied) })
  }

  function applyVdsSuggestion() {
    const s = vdsState.data
    if (!s) return
    autoVds.current = !isCustomer
    emit({
      vdsRate: s.rate,
      vdsAmount: s.amount,
      ...(isCustomer && !valueRef.current.vatServiceCode && s.serviceCode ? { vatServiceCode: s.serviceCode } : {}),
    })
  }

  const tdsAmount = toNum(v.tdsAmount)
  const vdsAmount = toNum(v.vdsAmount)
  const total = round2(tdsAmount + vdsAmount)
  const overBase = base > 0 && total > round2(base + (vat ?? 0)) + 0.005
  const vdsOverVat = vat !== null && vdsAmount > vat + 0.005

  const lc = compact ? 'mb-1.5 text-xs' : undefined
  const ic = compact ? 'h-8 px-2.5 text-[13px]' : undefined
  // TaxCodeSelect keeps pr-9 for the chevron, so only trim the left padding.
  const sc = compact ? 'py-[5px] pl-2.5 text-[13px] leading-5' : undefined
  const pad = compact ? 'p-3' : 'p-4'
  const gap = compact ? 'gap-2' : 'gap-3'
  const sectionTitle = 'mb-2.5 text-[13px] font-medium text-gray-900'

  return (
    <div className="rounded-lg border border-gray-200/80 bg-white">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className={cn('flex w-full items-center gap-2 rounded-lg text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50', compact ? 'px-3 py-2.5' : 'px-4 py-3')}
        aria-expanded={open}
        title={isCustomer
          ? 'Amounts the client deducted from this payment. They settle the invoice like cash; collect the Mushak-6.6 (VDS) and TDS certificate to claim the credit.'
          : 'Amounts we deduct from this payment. TDS is deposited by challan; VDS is paid through our VAT return (note 24). We must issue Mushak-6.6 / TDS certificates.'}
      >
        <span className="text-sm font-medium text-gray-900">Tax withholding (VDS / TDS)</span>
        <span className="ml-auto flex items-center gap-2">
          {total > 0 && (
            <span className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
              {vdsAmount > 0 && <>VDS ৳ {fmt(vdsAmount)}</>}
              {vdsAmount > 0 && tdsAmount > 0 && ' · '}
              {tdsAmount > 0 && <>TDS ৳ {fmt(tdsAmount)}</>}
            </span>
          )}
          <ChevronDown className={cn('size-4 text-gray-400 transition-transform', open && 'rotate-180')} />
        </span>
      </button>

      {open && (
        <div className={cn('space-y-5 border-t border-gray-100', pad)}>
          {base > 0 && (
            <p className="text-xs text-muted-foreground">
              Base (excl. VAT) <span className="font-medium text-gray-900 tabular-nums">৳ {fmt(base)}</span>
            </p>
          )}

          {/* TDS */}
          <div>
            <h4 className={sectionTitle}>Income tax (TDS / AIT)</h4>
            <div className={cn('grid grid-cols-1 sm:grid-cols-6', gap)}>
              <div className="sm:col-span-4">
                <Label className={lc}>TDS section</Label>
                <TaxCodeSelect
                  kind="TDS_SECTION"
                  value={v.tdsSection}
                  onChange={onTdsSection}
                  placeholder="No TDS"
                  disabled={disabled}
                  asOf={date}
                  className={sc}
                />
              </div>
              <div className="sm:col-span-1">
                <Label className={lc}>Rate</Label>
                <AmountInput value={v.tdsRate} onChange={onTdsRate} disabled={disabled || !v.tdsSection} placeholder="0" suffix="%" compact={compact} zeroOnBlur={false} />
              </div>
              <div className="sm:col-span-1">
                <Label className={lc}>TDS amount</Label>
                <AmountInput value={v.tdsAmount} onChange={onTdsAmount} disabled={disabled || (!v.tdsSection && !isCustomer)} compact={compact} />
              </div>
            </div>
            {v.tdsSection && (
              <SuggestionLine
                state={tdsState}
                current={{ amount: v.tdsAmount, rate: v.tdsRate }}
                onUse={applyTdsSuggestion}
                disabled={disabled}
                label="TDS"
              />
            )}
            {v.tdsSection && base <= 0 && (
              <p className="mt-2 text-xs text-muted-foreground">Enter the amount to calculate TDS.</p>
            )}
            {v.higherRateApplied && (
              <Badge variant="warning" className="mt-2 gap-1">
                <AlertTriangle className="size-3" /> Higher rate (+50%) applied
              </Badge>
            )}
            {isCustomer && (tdsAmount > 0 || v.tdsSection) && (
              <div className={cn('mt-3 grid grid-cols-1 sm:grid-cols-2', gap)}>
                <div>
                  <Label className={lc}>TDS certificate no.</Label>
                  <Input
                    type="text"
                    value={v.tdsCertificateNo ?? ''}
                    onChange={e => emit({ tdsCertificateNo: e.target.value || null })}
                    disabled={disabled}
                    placeholder="If received"
                    className={ic}
                  />
                </div>
                <div>
                  <Label className={lc}>Certificate date</Label>
                  <DatePicker
                    value={v.tdsCertificateDate}
                    onChange={d => emit({ tdsCertificateDate: d })}
                    disabled={disabled}
                    size={compact ? 'sm' : 'md'}
                    placeholder="Pick a date"
                  />
                </div>
              </div>
            )}
          </div>

          {/* VDS */}
          <div>
            <h4 className={sectionTitle}>VAT deducted at source (VDS)</h4>
            <div className={cn('grid grid-cols-1 sm:grid-cols-6', gap)}>
              <div className="sm:col-span-4">
                <Label className={lc}>VAT service code</Label>
                <TaxCodeSelect
                  kind="VAT_SERVICE"
                  value={v.vatServiceCode}
                  onChange={onVdsCode}
                  placeholder={isCustomer ? 'Invoice service code (default)' : 'No VDS'}
                  disabled={vdsLocked}
                  asOf={date}
                  className={sc}
                />
              </div>
              <div className="sm:col-span-1">
                <Label className={lc}>Rate</Label>
                <AmountInput value={v.vdsRate} onChange={onVdsRate} disabled={vdsLocked || (!v.vatServiceCode && !isCustomer)} placeholder="0" suffix="%" compact={compact} zeroOnBlur={false} />
              </div>
              <div className="sm:col-span-1">
                <Label className={lc}>VDS amount</Label>
                <AmountInput value={v.vdsAmount} onChange={onVdsAmount} disabled={vdsLocked || (!v.vatServiceCode && !isCustomer)} compact={compact} />
              </div>
            </div>
            {!vdsAllowed && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
                <Info className="size-3.5" /> No VAT on this invoice, so no VDS.
              </p>
            )}
            {vdsEnabled && (
              <SuggestionLine
                state={vdsState}
                current={{ amount: v.vdsAmount, rate: v.vdsRate }}
                onUse={applyVdsSuggestion}
                disabled={disabled}
                label="VDS"
              />
            )}
            {vdsOverVat && (
              <p className="mt-2 flex items-center gap-1.5 text-xs text-amber-700">
                <AlertTriangle className="size-3.5" /> VDS is more than the VAT on the bill (৳ {fmt(vat)}).
              </p>
            )}
            {isCustomer && vdsAllowed && (vdsAmount > 0 || v.vatServiceCode) && (
              <div className={cn('mt-3 grid grid-cols-1 sm:grid-cols-2', gap)}>
                <div>
                  <Label className={lc}>Mushak-6.6 certificate no.</Label>
                  <Input
                    type="text"
                    value={v.vdsCertificateNo ?? ''}
                    onChange={e => emit({ vdsCertificateNo: e.target.value || null })}
                    disabled={disabled}
                    placeholder="If received"
                    className={ic}
                  />
                </div>
                <div>
                  <Label className={lc}>Certificate date</Label>
                  <DatePicker
                    value={v.vdsCertificateDate}
                    onChange={d => emit({ vdsCertificateDate: d })}
                    disabled={disabled}
                    size={compact ? 'sm' : 'md'}
                    placeholder="Pick a date"
                  />
                </div>
              </div>
            )}
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-gray-100 pt-3">
            <span className="text-[13px] text-muted-foreground">
              {isCustomer ? 'Settled by withholding' : 'Total withheld'}
            </span>
            <span className="text-sm font-semibold text-gray-900 tabular-nums">৳ {fmt(total)}</span>
            {overBase && (
              <p className="flex w-full items-center gap-1.5 text-xs text-red-600">
                <AlertTriangle className="size-3.5" /> Withholding is more than the bill amount.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
