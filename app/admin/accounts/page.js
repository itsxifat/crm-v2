'use client'

import { useState, useEffect, useRef, useCallback, Suspense, Fragment } from 'react'
import { useSession } from 'next-auth/react'
import { useSearchParams } from 'next/navigation'
import {
  TrendingUp, TrendingDown, Wallet, AlertCircle,
  Plus, Pencil, X, Loader2, Clock, CheckCircle2, XCircle,
  Paperclip, ExternalLink, ArrowUpRight, ArrowDownRight, BarChart2, Percent, FileText as FileTextIcon, ChevronLeft, Printer,
  Landmark, Receipt, ChevronDown, ChevronRight, AlertTriangle, Info, Calculator, ArrowLeftRight, RotateCcw,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Pagination from '@/components/ui/Pagination'
import FileUpload from '@/components/ui/FileUpload'
import Link from 'next/link'
import TkAmt from '@/components/ui/TkAmt'
import Select from '@/components/ui/Select'
import DatePicker from '@/components/ui/DatePicker'
import DocPreview from '@/components/ui/DocPreview'
import MoneyAccountSelect, { useMoneyAccounts, invalidateMoneyAccounts, moneyAccountLabel, accountRequiredOn } from '@/components/finance/MoneyAccountSelect'
import ReverseClientPaymentModal from '@/components/finance/ReverseClientPaymentModal'
import WithholdingFields, { emptyWithholding, invoiceAllowsVds } from '@/components/tax/WithholdingFields'
import { useConfig } from '@/lib/useConfig'
import { currencyOptions, BASE_CURRENCY, formatMoney } from '@/lib/currencies'
import { formatCurrency } from '@/lib/utils'
import { canDo, canDoAny } from '@/lib/rbac'
import { dhakaDayKey } from '@/lib/dhakaTime'
import {
  KIND_LABELS, KIND_OPTIONS, PL_KINDS, NON_PL_KINDS, PAYMENT_CHANNELS, PAYMENT_CHANNEL_LABELS,
  channelFromPaymentMethod, normalizeChannel, isBankingChannel, accountTypeLabel, accountTypeGroup,
} from '@/lib/finance/constants'
import {
  SUPPLIER_VAT_TYPES, PAYEE_TYPES, BIN_REGEX, normalizeBin, round2, treatmentForRate,
  ITC_BANKING_THRESHOLD,
} from '@/lib/tax/catalog'
import { safeLinkUrl } from '@/lib/inventory/constants'

// ─── Constants ───────────────────────────────────────────────────────────────

const VENTURE_COLORS = {
  ENSTUDIO: 'bg-purple-100 text-purple-700',
  ENTECH:   'bg-blue-100 text-blue-700',
  ENMARK:   'bg-green-100 text-green-700',
}

const txSchema = z.object({
  type:           z.enum(['INCOME', 'EXPENSE']),
  category:       z.string().min(1, 'Category required'),
  amount:         z.coerce.number().positive('Must be > 0'),
  description:    z.string().min(1, 'Description required'),
  date:           z.string().min(1, 'Date required'),
  reference:      z.string().optional(),
  currency:       z.string().default('BDT'),
  amountBDT:      z.coerce.number().positive().optional().or(z.literal('')),
  accountManager: z.string().optional(),
  paymentMethod:  z.string().optional(),
  projectId:      z.string().optional(),
  invoiceId:      z.string().optional(),
  receiptUrl:     z.string().optional(),
  txnId:          z.string().optional(),
  expenseCategory:  z.string().optional().nullable(),  // subcategory (storage field)
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

const fmt      = (n) => `৳ ${(n ?? 0).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
// Ledger dates are Asia/Dhaka calendar days (often stored at Dhaka midnight = 18:00 UTC the day before).
const fmtDate  = (d) => d ? new Date(d).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'Asia/Dhaka' }) : '—'
const fmtMonth = (key) => {
  const [y, m] = key.split('-')
  return new Date(+y, +m - 1).toLocaleString('default', { month: 'short', year: '2-digit' })
}

// ─── Status Dot Badge ─────────────────────────────────────────────────────────

function StatusDot({ status }) {
  const map = {
    INCOME:               { dot: 'bg-green-500',  label: 'Income' },
    EXPENSE:              { dot: 'bg-red-500',     label: 'Expense' },
    PENDING:              { dot: 'bg-yellow-400',  label: 'Pending' },
    PAID:                 { dot: 'bg-blue-500',    label: 'Paid' },
    AUTHORIZED:           { dot: 'bg-green-500',   label: 'Authorized' },
    APPROVED:             { dot: 'bg-blue-500',    label: 'Approved' },
    REJECTED:             { dot: 'bg-red-500',     label: 'Rejected' },
    PENDING_CONFIRMATION: { dot: 'bg-yellow-400',  label: 'Pending' },
    CONFIRMED:            { dot: 'bg-green-500',   label: 'Confirmed' },
    REVERSING:            { dot: 'bg-amber-400',   label: 'Reversing…' },
    REVERSED:             { dot: 'bg-gray-400',    label: 'Reversed' },
  }
  const s = map[status] ?? { dot: 'bg-gray-400', label: status }
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${s.dot}`} />
      <span className="text-xs text-gray-600">{s.label}</span>
    </span>
  )
}

// Local YYYY-MM-DD (no UTC shift) for the expense date-range presets.
function ymdLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function presetRange(preset) {
  const start = new Date()
  const end   = new Date()
  if (preset === 'today')          { /* start = end = today */ }
  else if (preset === 'yesterday') { start.setDate(start.getDate() - 1); end.setDate(end.getDate() - 1) }
  else if (preset === '7d')        { start.setDate(start.getDate() - 6) }
  else if (preset === 'month')     { start.setDate(1) }
  else return { start: '', end: '' }
  return { start: ymdLocal(start), end: ymdLocal(end) }
}

// ─── Money accounts & tax helpers ─────────────────────────────────────────────

const toNum = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const fmtTk   = (n) => `৳ ${toNum(n).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const dayKeyOf = (d) => {
  if (!d) return ''
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) return d
  const dt = new Date(d)
  return Number.isNaN(dt.getTime()) ? '' : dhakaDayKey(dt)
}
const idOf = (v) => (v && typeof v === 'object' ? (v.id ?? v._id ?? null) : (v ?? null))
/**
 * Stored receipt / proof / invoice links (older rows were not validated): only
 * our own uploads (/uploads/…) or an http(s) URL are rendered as a link or
 * preview — javascript:, data:, //host, /api/… and other values ⇒ null.
 */
const docUrl = (url) => {
  const u = safeLinkUrl(url)
  return u && (u.startsWith('/uploads/') || /^https?:\/\//i.test(u)) ? u : null
}
/** Readable message from an API error body: zod field errors beat the generic 'Validation failed'. */
function apiErrorMessage(json, fallback = 'Something went wrong') {
  const fe = json?.details?.fieldErrors
  if (fe && typeof fe === 'object') {
    for (const [field, msgs] of Object.entries(fe)) {
      const m = Array.isArray(msgs) ? msgs[0] : msgs
      if (m) return json?.error && json.error !== 'Validation failed' ? json.error : `${field}: ${m}`
    }
  }
  return json?.error || fallback
}
const CHANNEL_OPTIONS = PAYMENT_CHANNELS.filter(c => c.value !== 'INTERNAL' && c.value !== 'CHALLAN')

// Salary / rent paid outside a bank is not an allowable expense (ITA 2023 s.55) —
// the same rule lib/expensePayment.js applies when the payment is recorded.
const SALARY_RE = /\bsalar(y|ies)\b|\bwages?\b|\bpayroll\b/i
const RENT_RE   = /\brent(al)?s?\b/i
// Channels that are not a bank / mobile-wallet transfer for the s.55 cash rule.
const CASH_RULE_CHANNELS = ['CASH', 'CHEQUE', 'OTHER']

/** 'SALARY' | 'RENT' | null from the expense category / subcategory text (and origin). */
function salaryOrRentOf(text, origin = null) {
  if (origin === 'SALARY' || SALARY_RE.test(text ?? '')) return 'SALARY'
  if (RENT_RE.test(text ?? '')) return 'RENT'
  return null
}

/** Channel facts used by the compliance hints. */
function channelFacts(channel, account) {
  const ch    = normalizeChannel(channel) ?? channelFromPaymentMethod(null, account) ?? null
  const def   = PAYMENT_CHANNELS.find(c => c.value === ch) ?? null
  const cashAccount = ['CASH', 'PETTY_CASH'].includes(account?.type)
  return {
    channel:       ch,
    // s.55 cash rule: cash / open cheque / other channel, or paid from a cash or petty-cash account.
    cashLike:      CASH_RULE_CHANNELS.includes(ch) || cashAccount,
    incomeTaxBank: isBankingChannel({ channel: ch, account }),
    // VAT s.46: 'yes' | 'no' | 'uncertain' (MFS / gateways are not clearly covered)
    vatBank:       cashAccount ? 'no' : (def ? def.bankingForVat : 'yes'),
  }
}

/** Kind badge for ledger rows: non-P&L kinds are greyed, NON_CASH is flagged. */
function KindBadge({ kind }) {
  if (!kind || kind === 'OPERATING') return null
  const nonPl = !PL_KINDS.includes(kind)
  return (
    <span
      title={nonPl ? 'Cash movement — not income or expense in the P&L' : 'Non-cash P&L entry (no money account)'}
      className={`inline-flex items-center mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
        nonPl ? 'bg-gray-100 text-gray-500' : 'bg-violet-50 text-violet-700'
      }`}
    >
      {KIND_LABELS[kind] ?? kind}{nonPl ? ' · not P&L' : ''}
    </span>
  )
}

/** Initial expense-tax form state from an expense's stored `tax` subdocument. */
function expenseTaxState(expense, payee = null) {
  const t = expense?.tax ?? null
  return {
    vatAmount:         t?.vatAmount ?? 0,
    supplierVatType:   t?.supplierVatType ?? payee?.vatType ?? 'REGISTERED',
    supplierBin:       t?.supplierBin ?? payee?.bin ?? '',
    mushakNo:          t?.mushakNo ?? '',
    mushakDate:        dayKeyOf(t?.mushakDate),
    vatCreditable:     !!t?.vatCreditable,
    // Purchase bills decide creditability deliberately; an explicit "yes" from the
    // submitter is kept too. Otherwise the live hint sets it until the user decides.
    creditableTouched: !!expense?.purchaseBillId || t?.vatCreditable === true,
    excludedItem:      false,
    payeeType:         t?.payeeType ?? payee?.payeeType ?? 'COMPANY',
    hasPsr:            t?.hasPsr ?? payee?.hasPsr ?? true,
    withholding: {
      ...emptyWithholding(),
      vdsAmount:         t?.vdsAmount ?? 0,
      vdsRate:           t?.vdsRate ?? null,
      vatServiceCode:    t?.vatServiceCode ?? payee?.vatServiceCode ?? null,
      tdsSection:        t?.tdsSection ?? payee?.tdsSection ?? null,
      tdsRate:           t?.tdsRate ?? null,
      tdsAmount:         t?.tdsAmount ?? 0,
      higherRateApplied: !!t?.higherRateApplied,
    },
  }
}

/**
 * Fill the parts of an expense-tax state that are still at their defaults from a payee profile.
 * `storedVatType`: the supplier VAT status saved on the bill — when the saved tax has none,
 * the payee's VAT status still applies (else the form would send REGISTERED and claim credit
 * from a turnover-tax / unregistered supplier).
 */
function applyPayeeDefaults(prev, payee, { hadStoredTax, storedVatType = null }) {
  if (!payee) return prev
  const next = { ...prev }
  if (!hadStoredTax) {
    if (payee.payeeType) next.payeeType = payee.payeeType
    if (payee.hasPsr !== null && payee.hasPsr !== undefined) next.hasPsr = !!payee.hasPsr
  }
  if (payee.vatType && (!hadStoredTax || !storedVatType)) next.supplierVatType = payee.vatType
  if (!String(prev.supplierBin ?? '').trim() && payee.bin) next.supplierBin = payee.bin
  const w = prev.withholding ?? emptyWithholding()
  if (!w.tdsSection && payee.tdsSection) next.withholding = { ...w, tdsSection: payee.tdsSection }
  if (!w.vatServiceCode && payee.vatServiceCode) next.withholding = { ...(next.withholding ?? w), vatServiceCode: payee.vatServiceCode }
  return next
}

/** Normalised payee tax profile from a vendor / freelancer record. */
function payeeProfile(rec, fallbackType = 'COMPANY') {
  if (!rec || typeof rec !== 'object') return null
  const masked = (s) => typeof s === 'string' && s.includes('•')
  return {
    name:           rec.company ?? rec.agencyInfo?.agencyName ?? rec.userId?.name ?? rec.name ?? null,
    payeeType:      rec.payeeType ?? fallbackType,
    hasPsr:         rec.hasPsr ?? null,
    bin:            rec.bin && !masked(rec.bin) ? rec.bin : null,
    vatType:        rec.vatRegistrationType ?? null,
    tdsSection:     rec.defaultTdsSection ?? null,
    vatServiceCode: rec.defaultVatServiceCode ?? null,
  }
}

/**
 * Loads the payee's tax profile (payee type, PSR, BIN, default TDS section / VAT
 * service code) for an expense: a populated vendor/freelancer is used as-is,
 * otherwise it is fetched (vendors: finance.payments.confirm may read; a
 * freelancer read may be forbidden — then sensible defaults apply).
 */
function usePayeeProfile(expense) {
  const [state, setState] = useState({ loading: false, payee: null })
  const vendorRef     = expense?.vendorId ?? null
  const freelancerRef = expense?.agencyId ?? expense?.freelancerId ?? null
  const isAgency      = !!expense?.agencyId || expense?.origin === 'AGENCY'
  const vendorKey     = idOf(vendorRef)
  const freelancerKey = idOf(freelancerRef)
  const origin        = expense?.origin ?? null
  const hasEmployee   = !!expense?.paidToEmployeeId

  const serverPayee = expense?.payee ?? null

  useEffect(() => {
    let alive = true
    // GET /api/expenses returns the payee's tax profile to payment confirmers.
    if (serverPayee && typeof serverPayee === 'object') {
      setState({
        loading: false,
        payee: {
          name:           serverPayee.name ?? null,
          payeeType:      serverPayee.payeeType ?? (serverPayee.type === 'VENDOR' || serverPayee.type === 'AGENCY' ? 'COMPANY'
            : serverPayee.type === 'FREELANCER' || serverPayee.type === 'EMPLOYEE' ? 'INDIVIDUAL' : null),
          hasPsr:         serverPayee.hasPsr ?? null,
          bin:            serverPayee.bin && !String(serverPayee.bin).includes('•') ? serverPayee.bin : null,
          vatType:        serverPayee.vatRegistrationType ?? null,
          tdsSection:     serverPayee.defaultTdsSection ?? null,
          vatServiceCode: serverPayee.defaultVatServiceCode ?? null,
        },
      })
      return () => { alive = false }
    }
    if (vendorRef && typeof vendorRef === 'object' && 'payeeType' in vendorRef) {
      setState({ loading: false, payee: payeeProfile(vendorRef, 'COMPANY') })
      return () => { alive = false }
    }
    if (freelancerRef && typeof freelancerRef === 'object' && 'payeeType' in freelancerRef) {
      setState({ loading: false, payee: payeeProfile(freelancerRef, isAgency ? 'COMPANY' : 'INDIVIDUAL') })
      return () => { alive = false }
    }
    const url = vendorKey ? `/api/vendors/${vendorKey}` : freelancerKey ? `/api/freelancers/${freelancerKey}` : null
    const fallbackType = vendorKey ? 'COMPANY'
      : freelancerKey ? (isAgency ? 'COMPANY' : 'INDIVIDUAL')
      : (hasEmployee || origin === 'SALARY' || origin === 'REIMBURSEMENT') ? 'INDIVIDUAL'
      : null
    if (!url) {
      setState({ loading: false, payee: fallbackType ? { payeeType: fallbackType, hasPsr: null } : null })
      return () => { alive = false }
    }
    setState({ loading: true, payee: null })
    fetch(url)
      .then(async r => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || 'Payee not readable')
        return j.data
      })
      .then(rec => { if (alive) setState({ loading: false, payee: payeeProfile(rec, fallbackType) }) })
      .catch(() => { if (alive) setState({ loading: false, payee: { payeeType: fallbackType, hasPsr: null } }) })
    return () => { alive = false }
  }, [serverPayee, vendorRef, freelancerRef, vendorKey, freelancerKey, isAgency, origin, hasEmployee])

  return state
}

/** Debounced input-VAT creditability hint from /api/tax/suggest?type=itc. */
function useItcHint({ enabled, supplierVatType, hasMushak, excludedItem, gross, vatBank }) {
  const [state, setState] = useState({ loading: false, data: null, error: null })
  useEffect(() => {
    if (!enabled) { setState({ loading: false, data: null, error: null }); return undefined }
    const ctrl = new AbortController()
    setState(s => ({ ...s, loading: true, error: null }))
    const timer = setTimeout(() => {
      const qs = new URLSearchParams({
        type:            'itc',
        supplierVatType: supplierVatType || 'REGISTERED',
        hasMushak:       hasMushak ? '1' : '0',
        excludedItem:    excludedItem ? '1' : '0',
        gross:           String(Math.max(0, round2(gross))),
        bank:            vatBank === 'no' ? '0' : '1',
      })
      fetch(`/api/tax/suggest?${qs.toString()}`, { signal: ctrl.signal })
        .then(async r => {
          const j = await r.json().catch(() => ({}))
          if (!r.ok) throw new Error(j.error || 'Could not check input VAT credit')
          return j.data
        })
        .then(data => setState({ loading: false, data, error: null }))
        .catch(err => { if (err?.name !== 'AbortError') setState({ loading: false, data: null, error: err.message }) })
    }, 350)
    return () => { clearTimeout(timer); ctrl.abort() }
  }, [enabled, supplierVatType, hasMushak, excludedItem, gross, vatBank])
  return state
}

/**
 * Supplier-bill tax section: VAT included in the bill (Mushak-6.3), input VAT
 * creditability, payee profile and VDS/TDS withholding (WithholdingFields PAYEE).
 * `value`/`setValue` are a React state pair (setValue accepts an updater).
 * Returns null for non-BDT bills (tax amounts are BDT only).
 * `vatLocked`: the VAT amount and its creditability were set on the purchase bill
 * (its assets were costed on that basis) — shown read-only, never changed here.
 */
function ExpenseTaxSection({
  gross, value, setValue, bankingForTax = true, vatBank = 'yes', date = null,
  disabled = false, note = null, payeeLoading = false, defaultOpen = false, vatLocked = false,
}) {
  const v = value
  const grossNum = Math.max(0, round2(toNum(gross)))
  const vat      = Math.max(0, round2(toNum(v.vatAmount)))
  const base     = Math.max(0, round2(grossNum - vat))
  const vatRate  = base > 0 && vat > 0 ? round2((vat / base) * 100) : null
  const hasMushak = !!String(v.mushakNo ?? '').trim()
  const binRaw   = String(v.supplierBin ?? '').replace(/\s+/g, '')
  const binBad   = binRaw !== '' && !binRaw.includes('•') && !BIN_REGEX.test(binRaw)
  // An excluded item never carries input credit, whatever was chosen before.
  const creditable = !!v.vatCreditable && !v.excludedItem
  const [open, setOpen] = useState(() => defaultOpen || vat > 0 || hasMushak || !!binRaw)

  const patch = useCallback((p) => setValue(prev => ({ ...prev, ...p })), [setValue])

  const itc = useItcHint({
    enabled:         vat > 0 && !disabled,
    supplierVatType: v.supplierVatType,
    hasMushak,
    excludedItem:    !!v.excludedItem,
    gross:           grossNum,
    vatBank,
  })
  // Follow the hint until the user decides for themselves (never on a purchase bill's VAT).
  useEffect(() => {
    if (!itc.data || vatLocked) return
    setValue(prev => (prev.creditableTouched || prev.vatCreditable === !!itc.data.creditable)
      ? prev
      : { ...prev, vatCreditable: !!itc.data.creditable })
  }, [itc.data, setValue, vatLocked])

  const w   = v.withholding ?? emptyWithholding()
  const vds = Math.max(0, toNum(w.vdsAmount))
  const tds = Math.max(0, toNum(w.tdsAmount))
  const net = round2(grossNum - vds - tds)

  const lc = 'block text-xs font-medium text-gray-600 mb-1'
  const ic = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:bg-gray-50 disabled:text-gray-500'

  return (
    <div className="space-y-3">
      <div className="bg-white border border-gray-100 rounded-xl">
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
          className="w-full flex items-center gap-2 px-4 py-3 text-left">
          <Receipt className="w-4 h-4 text-gray-400 shrink-0" />
          <span className="text-sm font-medium text-gray-900">VAT in this bill (Mushak-6.3)</span>
          <span className="ml-auto flex items-center gap-2">
            {vat > 0 && (
              <span className="text-xs text-gray-500 whitespace-nowrap">
                VAT {fmtTk(vat)}{creditable ? ' · input credit' : ''}
              </span>
            )}
            <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
          </span>
        </button>
        {open && (
          <div className="border-t border-gray-100 p-4 space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={lc}>VAT included in the bill (৳)</label>
                <input type="number" min="0" step="0.01" inputMode="decimal" disabled={disabled || vatLocked} readOnly={vatLocked}
                  value={v.vatAmount === null || v.vatAmount === undefined ? '' : v.vatAmount}
                  onChange={e => patch({ vatAmount: e.target.value === '' ? null : Number(e.target.value) })}
                  onBlur={e => { if (e.target.value === '') patch({ vatAmount: 0 }) }}
                  onKeyDown={e => { if (e.key === '-' || e.key === 'e') e.preventDefault() }}
                  placeholder="0.00" className={ic} />
                <p className="mt-1 text-[11px] text-gray-400">
                  {vat > 0
                    ? <>Value excl. VAT {fmtTk(base)}{vatRate !== null ? ` · rate ≈ ${vatRate}%` : ''}{vatLocked ? ' · set on the purchase bill' : ''}</>
                    : vatLocked
                      ? 'Set on the purchase bill — assets were costed on this basis.'
                      : 'Leave 0 if the bill carries no VAT.'}
                </p>
                {vat > grossNum + 0.005 && <p className="mt-1 text-[11px] text-red-600">VAT cannot exceed the bill amount.</p>}
              </div>
              <div>
                <label className={lc}>Supplier VAT status</label>
                <select value={v.supplierVatType ?? 'REGISTERED'} disabled={disabled}
                  onChange={e => patch({ supplierVatType: e.target.value })} className={ic}>
                  {SUPPLIER_VAT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className={lc}>Supplier BIN</label>
                <input value={v.supplierBin ?? ''} disabled={disabled}
                  onChange={e => patch({ supplierBin: e.target.value })}
                  placeholder="000123456-0101" className={`${ic} ${binBad ? 'border-red-300' : ''}`} />
                <p className={`mt-1 text-[11px] ${binBad ? 'text-red-600' : 'text-gray-400'}`}>
                  {binBad ? 'BIN must be 9 or 13 digits.' : 'BIN is 13 digits, e.g. 000123456-0101'}
                </p>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={lc}>Mushak-6.3 no.</label>
                  <input value={v.mushakNo ?? ''} disabled={disabled}
                    onChange={e => patch({ mushakNo: e.target.value })} placeholder="Invoice no." className={ic} />
                </div>
                <div>
                  <label className={lc}>Mushak date</label>
                  <input type="date" value={v.mushakDate ?? ''} disabled={disabled}
                    onChange={e => patch({ mushakDate: e.target.value })} className={ic} />
                </div>
              </div>
            </div>

            {vat > 0 && (
              <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2.5 space-y-2">
                {!vatLocked && (
                  <label className="flex items-start gap-2 text-xs text-gray-700">
                    <input type="checkbox" checked={!!v.excludedItem} disabled={disabled}
                      onChange={e => patch({ excludedItem: e.target.checked })}
                      className="mt-0.5 w-4 h-4 rounded border-gray-300 accent-gray-900" />
                    <span>Excluded item — office equipment, furniture, vehicles, rent, entertainment (no input credit)</span>
                  </label>
                )}
                <label className="flex items-start gap-2 text-xs text-gray-700">
                  <input type="checkbox" checked={creditable} disabled={disabled || vatLocked || !!v.excludedItem}
                    onChange={e => patch({ vatCreditable: e.target.checked, creditableTouched: true })}
                    className="mt-0.5 w-4 h-4 rounded border-gray-300 accent-gray-900" />
                  <span className="font-medium">Claim this VAT as input tax credit</span>
                </label>
                {vatLocked && (
                  <p className="flex items-start gap-1.5 text-[11px] text-gray-500">
                    <Info className="w-3 h-3 mt-0.5 shrink-0" />
                    <span>Set on the purchase bill — assets were costed on this basis.</span>
                  </p>
                )}
                {itc.loading && (
                  <p className="flex items-center gap-1.5 text-[11px] text-gray-400"><Loader2 className="w-3 h-3 animate-spin" /> Checking creditability…</p>
                )}
                {!itc.loading && itc.data && (
                  <p className={`flex items-start gap-1.5 text-[11px] ${itc.data.creditable ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {itc.data.creditable ? <CheckCircle2 className="w-3 h-3 mt-0.5 shrink-0" /> : <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />}
                    <span>
                      {itc.data.creditable
                        ? 'Creditable — claim it in the VAT return within 6 tax periods.'
                        : `Not creditable: ${itc.data.reasonLabel ?? itc.data.reason}.`}
                      {!vatLocked && v.creditableTouched && creditable !== !!itc.data.creditable && ' Your choice overrides this hint.'}
                    </span>
                  </p>
                )}
                {!itc.loading && itc.error && <p className="text-[11px] text-gray-400">{itc.error}</p>}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 border-t border-gray-100 pt-3">
              <div>
                <label className={lc}>Payee type (for TDS)</label>
                <select value={v.payeeType ?? 'COMPANY'} disabled={disabled}
                  onChange={e => patch({ payeeType: e.target.value })} className={ic}>
                  {PAYEE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                {payeeLoading && <p className="mt-1 text-[11px] text-gray-400">Loading payee profile…</p>}
              </div>
              <label className="flex items-start gap-2 text-xs text-gray-700 sm:pt-6">
                <input type="checkbox" checked={!!v.hasPsr} disabled={disabled}
                  onChange={e => patch({ hasPsr: e.target.checked })}
                  className="mt-0.5 w-4 h-4 rounded border-gray-300 accent-gray-900" />
                <span>Payee showed proof of return submission (PSR)<span className="block text-[11px] text-gray-400">Without PSR, TDS is 50% higher (ITA s.264 / s.142).</span></span>
              </label>
            </div>
          </div>
        )}
      </div>

      <WithholdingFields
        mode="PAYEE"
        baseAmount={base}
        vatAmount={vat}
        payeeType={v.payeeType ?? 'COMPANY'}
        hasPsr={!!v.hasPsr}
        bankingChannel={!!bankingForTax}
        supplierVatType={v.supplierVatType ?? 'REGISTERED'}
        date={date || null}
        value={w}
        onChange={next => setValue(prev => ({ ...prev, withholding: next }))}
        disabled={disabled}
      />

      <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-xs">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-gray-600">
          <span>Bill {fmtTk(grossNum)}</span>
          {vat > 0 && <span>incl. VAT {fmtTk(vat)}</span>}
          {vds > 0 && <span>− VDS {fmtTk(vds)}</span>}
          {tds > 0 && <span>− TDS {fmtTk(tds)}</span>}
          <span className="ml-auto text-sm font-semibold text-gray-900">Net payable {fmtTk(net)}</span>
        </div>
        {net < -0.005 && <p className="mt-1 text-red-600">Withholding is more than the bill amount.</p>}
        {note && <p className="mt-1 text-gray-400">{note}</p>}
      </div>
    </div>
  )
}

/**
 * Validation + request payload for an expense's `tax` object (BDT bills only).
 * `cashLike` = paid in cash / by open cheque / other channel or from a cash
 * account (channelFacts) — with a salary / rent category the cost is
 * non-deductible (ITA 2023 s.55). `vatLocked` (purchase-bill expense) leaves the
 * VAT amount and its creditability out of the payload, so the stored ones stay.
 */
function buildExpenseTax(tax, { gross, category, origin = null, cashLike = false, vatLocked = false, force = false }) {
  const grossNum = Math.max(0, round2(toNum(gross)))
  const vat = Math.max(0, round2(toNum(tax.vatAmount)))
  const w   = tax.withholding ?? emptyWithholding()
  const vds = Math.max(0, round2(toNum(w.vdsAmount)))
  const tds = Math.max(0, round2(toNum(w.tdsAmount)))
  const binRaw = String(tax.supplierBin ?? '').replace(/\s+/g, '')
  const errors = []
  // Same rules as lib/expensePayment.buildExpenseTax (the server re-checks them).
  if (vat > grossNum + 0.005) errors.push('VAT cannot exceed the bill amount')
  if (vds > 0 && !(vat > 0)) errors.push('Enter the VAT in the bill before deducting VDS — VDS cannot exceed the VAT charged')
  else if (vds > vat + 0.005) errors.push('VDS cannot exceed the VAT on the bill')
  if (tds > round2(grossNum - vat) + 0.005) errors.push('TDS cannot be more than the bill value excluding VAT')
  if ((vds > 0 || tds > 0) && vds + tds >= grossNum - 0.005) errors.push('VDS + TDS cannot take the whole bill — the net payable must be more than zero')
  if (binRaw && !binRaw.includes('•') && !BIN_REGEX.test(binRaw)) errors.push('Supplier BIN must be 9 or 13 digits')
  if (tds > 0 && !w.tdsSection) errors.push('Select the TDS section for the tax deducted')

  const cashSalaryRent = !!cashLike && !!salaryOrRentOf(category, origin)
  // A section / service code without any amount carries nothing to record.
  const used = vat > 0 || vds > 0 || tds > 0 || !!binRaw || !!String(tax.mushakNo ?? '').trim() || cashSalaryRent
  if (!used && !force) return { errors, payload: null, net: grossNum }

  const base = Math.max(0, round2(grossNum - vat))
  const vatRate = vat > 0 && base > 0 ? round2((vat / base) * 100) : null
  if (vatRate !== null && vatRate > 100 && !vatLocked) errors.push('VAT is more than the value excluding VAT — check the VAT amount')
  const payload = {
    vatAmount:         vat,
    vatRate,
    // Excluded items (office equipment, furniture, vehicles, rent, entertainment) never carry input credit.
    vatCreditable:     vat > 0 && !tax.excludedItem ? !!tax.vatCreditable : false,
    treatment:         vat > 0 ? treatmentForRate(vatRate) : null,
    supplierBin:       binRaw && !binRaw.includes('•') ? (normalizeBin(binRaw) || binRaw) : null,
    supplierVatType:   tax.supplierVatType || null,
    mushakNo:          String(tax.mushakNo ?? '').trim() || null,
    mushakDate:        tax.mushakDate || null,
    vatServiceCode:    w.vatServiceCode || null,
    vdsRate:           w.vdsRate ?? null,
    vdsAmount:         vds,
    tdsSection:        w.tdsSection || null,
    tdsRate:           w.tdsRate ?? null,
    tdsAmount:         tds,
    payeeType:         tax.payeeType || null,
    hasPsr:            !!tax.hasPsr,
    higherRateApplied: !!w.higherRateApplied,
    // Salary / rent paid outside a bank is not an allowable expense (ITA 2023 s.55).
    taxDeductible:     !cashSalaryRent,
  }
  // The purchase bill decided these — its assets were costed on that basis.
  if (vatLocked) {
    delete payload.vatAmount
    delete payload.vatRate
    delete payload.vatCreditable
    delete payload.treatment
  }
  return { errors, net: round2(grossNum - vds - tds), payload }
}

/** Compliance warnings for a supplier payment. */
function expenseComplianceWarnings({ tax, gross, category, origin = null, facts }) {
  const out = []
  const vat = toNum(tax?.vatAmount)
  const tds = toNum(tax?.withholding?.tdsAmount)
  const cashCost = facts.cashLike ? salaryOrRentOf(category, origin) : null
  if (cashCost)
    out.push({ level: 'warn', text: `${cashCost === 'SALARY' ? 'Salary' : 'Rent'} paid in cash, by open cheque, through another non-bank channel or from a cash account is not an allowable expense for income tax (ITA 2023 s.55) — it will be recorded as non-deductible. Pay it through a bank or mobile-wallet account.` })
  if (vat > 0 && toNum(gross) > ITC_BANKING_THRESHOLD && facts.vatBank === 'no')
    out.push({ level: 'warn', text: 'Supplies over Tk 1,00,000 paid outside a banking channel lose the input VAT credit (VAT Act s.46).' })
  if (vat > 0 && toNum(gross) > ITC_BANKING_THRESHOLD && facts.vatBank === 'uncertain')
    out.push({ level: 'info', text: 'Mobile-wallet / gateway payments may not count as a banking channel for input VAT over Tk 1,00,000 — a bank transfer is safer.' })
  if ((tds > 0 || tax?.withholding?.tdsSection) && !facts.incomeTaxBank)
    out.push({ level: 'warn', text: 'Payment not through a bank transfer — TDS is charged 50% higher (ITA s.142).' })
  if (tax?.withholding?.tdsSection && !tax?.hasPsr && tax?.payeeType !== 'NON_RESIDENT')
    out.push({ level: 'info', text: 'Payee has no PSR on file — TDS is 50% higher unless they show proof of return submission.' })
  return out
}

/**
 * Native account <select> WITHOUT auto-selection (MoneyAccountSelect picks a
 * default when empty) — for filters and for assigning an account to a legacy row.
 */
function PlainAccountSelect({ value, onChange, currency = null, placeholder = 'All accounts', disabled = false, size = 'md', showBalance = true, extraOptions = [] }) {
  const { accounts, loading } = useMoneyAccounts()
  const options = currency
    ? accounts.filter(a => a.currency === currency || a.currency === BASE_CURRENCY)
    : accounts
  return (
    <select
      value={value ?? ''}
      onChange={e => onChange(e.target.value || null)}
      disabled={disabled || loading}
      className={`w-full border border-gray-200 rounded-lg px-3 ${size === 'sm' ? 'py-1.5 text-xs' : 'py-2 text-sm'} bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:bg-gray-50 disabled:text-gray-400`}
    >
      <option value="">{loading ? 'Loading accounts…' : placeholder}</option>
      {extraOptions.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
      {options.map(a => <option key={a.id} value={a.id}>{moneyAccountLabel(a, { showBalance })}</option>)}
    </select>
  )
}

/** "Purchase bill" link for expenses raised from an inventory purchase bill. */
function PurchaseBillLink({ expense, compact = false }) {
  const billId = idOf(expense?.purchaseBillId)
  if (!billId) return null
  const billNo = typeof expense.purchaseBillId === 'object' ? expense.purchaseBillId?.billNo : null
  return (
    <Link
      href={`/admin/inventory/purchases/${billId}`}
      onClick={e => e.stopPropagation()}
      className={compact
        ? 'inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-orange-50 text-orange-700 hover:bg-orange-100'
        : 'inline-flex items-center gap-1 text-xs font-medium text-blue-600 hover:underline'}
    >
      <Receipt className={compact ? 'w-3 h-3' : 'w-3.5 h-3.5'} />
      Purchase bill{billNo ? ` ${billNo}` : ''}
      {!compact && <ExternalLink className="w-3 h-3" />}
    </Link>
  )
}

function WarningList({ items }) {
  if (!items?.length) return null
  return (
    <ul className="space-y-1.5">
      {items.map((w, i) => (
        <li key={i} className={`flex items-start gap-2 rounded-lg px-3 py-2 text-xs ${
          w.level === 'warn' ? 'bg-amber-50 text-amber-800 border border-amber-100' : 'bg-gray-50 text-gray-600 border border-gray-100'
        }`}>
          {w.level === 'warn' ? <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
          <span>{w.text}</span>
        </li>
      ))}
    </ul>
  )
}

// ─── Transaction Modal ────────────────────────────────────────────────────────

function TransactionModal({ open, onOpenChange, tx, onSaved, currentUser }) {
  const { paymentMethods, expenseCategories, incomeCategories } = useConfig()
  const isEdit = !!tx
  const [receiptUrl,  setReceiptUrl]  = useState('')
  const [projects,    setProjects]    = useState([])
  const [invoices,    setInvoices]    = useState([])
  const [txnIdVal,    setTxnIdVal]    = useState('')
  // Money account the cash moved through (income: received into). Legacy rows
  // without an account may get one on edit; an existing account is fixed.
  const [accountId,   setAccountId]   = useState(null)
  const { accounts: moneyAccounts, goLiveDate } = useMoneyAccounts()
  // Expense request: optional vendor + supplier-bill tax (VAT / VDS / TDS).
  const [vendors,     setVendors]     = useState(null)   // null = not readable / not loaded
  const [vendorId,    setVendorId]    = useState('')
  const [expTax,      setExpTax]      = useState(() => expenseTaxState(null))

  const { register, control, handleSubmit, watch, reset, setValue, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(txSchema),
    defaultValues: { type: 'INCOME', currency: 'BDT', date: dhakaDayKey() },
  })
  // Keep the latest session user without making it a form-init dependency —
  // it arrives async (undefined → object) and gets a fresh ref on refetches.
  const currentUserRef = useRef(currentUser)
  currentUserRef.current = currentUser

  const type       = watch('type')
  const category   = watch('category')
  const currency   = watch('currency')
  const amountVal  = watch('amount')
  const paymentMethodVal = watch('paymentMethod')
  const dateVal    = watch('date')
  const isExpense  = type === 'EXPENSE'
  const isForeign  = currency && currency !== BASE_CURRENCY
  // A NEW expense is not a direct ledger entry — it's submitted as a request that
  // must be Reviewed → Paid → Authorized. Editing an existing transaction is unchanged.
  const isExpenseRequest = isExpense && !isEdit

  // Nested taxonomy from config — subcategories belong to the selected category
  const baseCategories = isExpense ? expenseCategories : incomeCategories
  const baseLabels     = baseCategories.map(c => c.label)
  // Keep an already-saved value selectable even if it's not in the configured list
  const categories    = (category && !baseLabels.includes(category)) ? [...baseLabels, category] : baseLabels
  const subcategories = baseCategories.find(c => c.label === category)?.subcategories ?? []

  useEffect(() => {
    if (open) {
      fetch('/api/projects?limit=200').then(r => r.json()).then(j => setProjects(j.data ?? []))
      fetch('/api/invoices?limit=200').then(r => r.json()).then(j => setInvoices((j.data ?? []).filter(inv => !['PAID','CANCELLED','DRAFT'].includes(inv.status))))
      const url = isEdit ? docUrl(tx.receiptUrl) ?? '' : ''
      setReceiptUrl(url)
      setTxnIdVal(isEdit ? tx.txnId ?? '' : '')
      setAccountId(isEdit ? (idOf(tx.accountId) ? String(idOf(tx.accountId)) : null) : null)
      setVendorId('')
      setExpTax(expenseTaxState(null))
      reset(isEdit ? {
        type:           tx.type,
        category:       tx.category,
        amount:         tx.amount,
        description:    tx.description,
        // Dhaka calendar day — rows stored at Dhaka midnight are 18:00 UTC the day before.
        date:           dayKeyOf(tx.date),
        reference:      tx.reference ?? '',
        currency:       tx.currency ?? 'BDT',
        amountBDT:      tx.amountBDT ?? '',
        accountManager: tx.accountManager?.id ?? tx.accountManager ?? '',
        paymentMethod:   tx.paymentMethod ?? '',
        projectId:       tx.projectId?.id ?? tx.projectId ?? '',
        invoiceId:       tx.invoiceId?.id ?? tx.invoiceId ?? '',
        expenseCategory: tx.expenseCategory ?? '',
        receiptUrl:      url,
        txnId:           tx.txnId ?? '',
      } : { type: 'INCOME', currency: 'BDT', date: dhakaDayKey(), accountManager: currentUserRef.current?.id ?? '' })
    }
  }, [open, tx, isEdit, reset])

  // Backfill the (read-only) account manager once the session resolves, without
  // re-initializing the form — otherwise the Type toggle snaps back to Income.
  useEffect(() => {
    if (open && !isEdit && currentUser?.id) setValue('accountManager', currentUser.id)
  }, [open, isEdit, currentUser, setValue])

  // Vendors for the expense request (payee + BIN / VAT status / TDS defaults).
  // Vendor master data is readable with hr.vendors.manage, inventory.purchase or
  // finance.payments.confirm — without those the picker is simply hidden.
  useEffect(() => {
    if (!open || !isExpenseRequest || vendors !== null) return
    let alive = true
    fetch('/api/vendors?limit=200')
      .then(async r => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || 'Vendors not readable')
        return Array.isArray(j.data) ? j.data : []
      })
      .then(list => { if (alive) setVendors(list) })
      .catch(() => { if (alive) setVendors(false) })
    return () => { alive = false }
  }, [open, isExpenseRequest, vendors])

  const selectedVendor = Array.isArray(vendors) ? (vendors.find(v => v.id === vendorId) ?? null) : null
  function chooseVendor(id) {
    setVendorId(id)
    const vendor = Array.isArray(vendors) ? vendors.find(v => v.id === id) : null
    const profile = payeeProfile(vendor, 'COMPANY')
    setExpTax(prev => {
      if (!profile) return prev
      const next = applyPayeeDefaults(prev, profile, { hadStoredTax: false })
      // A newly picked vendor replaces the previous vendor's BIN and VAT status.
      return { ...next, supplierBin: profile.bin ?? '', supplierVatType: profile.vatType ?? 'REGISTERED' }
    })
  }

  const originalAccountId = isEdit && idOf(tx?.accountId) ? String(idOf(tx.accountId)) : null
  const reconciled        = isEdit && (tx?.clearStatus === 'RECONCILED' || tx?.clearStatus === 'CLEARED' || !!tx?.reconciliationId)
  // A cleared/reconciled entry keeps its account (it is matched to a bank statement).
  const accountLocked     = !!originalAccountId && reconciled
  const showAccountPicker = !isExpenseRequest && !accountLocked
  // Before go-live an entry needs no account (the server only requires one from
  // the go-live date on, and accounts opened on go-live refuse earlier dates).
  const accountLive       = accountRequiredOn(dateVal, goLiveDate)
  const accountRequired   = !isEdit && !isExpense && moneyAccounts.length > 0 && accountLive
  const showExpenseTax    = isExpenseRequest && (currency || BASE_CURRENCY) === BASE_CURRENCY

  async function onSubmit(data) {
    try {
      // A brand-new expense is not written to the ledger directly — it becomes a
      // PENDING expense request that must be Reviewed → Paid → Authorized.
      if (isExpenseRequest) {
        // Supplier-bill tax (BDT bills only). Payment channel is unknown until the
        // expense is paid, so the payer re-checks it in the payment step.
        let tax
        if (showExpenseTax) {
          const built = buildExpenseTax(expTax, {
            gross: data.amount, category: `${data.category ?? ''} ${data.expenseCategory ?? ''}`, cashLike: false,
          })
          if (built.errors.length) { toast.error(built.errors[0]); return }
          if (built.payload) {
            // Cash-rule deductibility is decided when the payment is recorded.
            tax = { ...built.payload }
            delete tax.taxDeductible
          }
        }
        const body = {
          origin:      vendorId ? 'VENDOR' : data.projectId ? 'PROJECT' : 'OTHER',
          vendorId:    vendorId || undefined,
          paidToName:  selectedVendor?.company || undefined,
          tax,
          title:       data.description,
          category:    data.category,
          subcategory: data.expenseCategory || undefined,
          amount:      data.amount,
          currency:    data.currency,
          amountBDT:   data.amountBDT || undefined,
          date:        data.date,
          projectId:   data.projectId || undefined,
          invoiceUrl:  receiptUrl || undefined,
          notes:       data.reference ? `Ref: ${data.reference}` : undefined,
        }
        const res  = await fetch('/api/expenses', {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
        })
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(apiErrorMessage(json, 'Failed to submit expense request'))
        onSaved({ expenseRequest: true })
        onOpenChange(false)
        return
      }

      // Income, or editing an existing transaction → direct ledger entry.
      if (accountRequired && !accountId) { toast.error('Select the money account (bank / cash / wallet) the money came into'); return }
      if ((data.currency || BASE_CURRENCY) !== BASE_CURRENCY && !(Number(data.amountBDT) > 0)) {
        toast.error('Enter the BDT-equivalent for a non-BDT transaction'); return
      }
      const body = { ...data, receiptUrl: receiptUrl || null, txnId: txnIdVal.trim() || null }
      // The ledger id is fixed once created — never send it on edit.
      if (isEdit) delete body.txnId
      Object.keys(body).forEach(k => { if (body[k] === '') body[k] = null })
      // Money account: always on a new entry; on edit only when it changes (a
      // legacy row getting one, or a correction). It is never cleared from here —
      // the server keeps linked / reconciled entries on their account.
      if (!isEdit) {
        if (accountId) body.accountId = accountId
      } else if (!accountLocked && accountId && accountId !== originalAccountId) {
        body.accountId = accountId
      }
      const url    = isEdit ? `/api/transactions/${tx.id}` : '/api/transactions'
      const method = isEdit ? 'PUT' : 'POST'
      const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json   = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(apiErrorMessage(json, 'Failed'))
      invalidateMoneyAccounts()   // balances moved
      onSaved()
      onOpenChange(false)
    } catch (err) {
      toast.error(err.message ?? 'Something went wrong')
    }
  }

  const ic = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-gray-900'
  const lc = 'block text-sm font-medium text-gray-700 mb-1'

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={isEdit ? 'Edit Transaction' : 'New Transaction'} size="lg">
      <form id="tx-form" onSubmit={handleSubmit(onSubmit)} className="space-y-4">
        {/* Type */}
        <div>
          <label className={lc}>Type</label>
          <div className="flex gap-3">
            {['INCOME', 'EXPENSE'].map((t) => (
              <label key={t} className="flex-1 flex items-center gap-2 p-3 border border-gray-200 rounded-lg cursor-pointer has-[:checked]:border-gray-900 has-[:checked]:bg-gray-50 transition-colors">
                <input type="radio" value={t} {...register('type')} className="accent-gray-900" />
                <span className="text-sm font-medium">{t === 'INCOME' ? 'Income' : 'Expense'}</span>
              </label>
            ))}
          </div>
          {isExpenseRequest && (
            <p className="mt-2 text-xs text-amber-600">
              Expenses are submitted as a request — they go through Review → Paid → Authorized before they appear in the ledger.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <div>
            <label className={lc}>Category *</label>
            <Controller name="category" control={control} render={({ field }) => (
              <Select value={field.value} onChange={v => { field.onChange(v ?? ''); setValue('expenseCategory', '') }}
                options={categories.map(c => ({ value: c, label: c }))}
                placeholder="Select…"
                disabled={baseCategories.length === 0}
              />
            )} />
            {errors.category && <p className="mt-1 text-xs text-red-500">{errors.category.message}</p>}
            {baseCategories.length === 0 && (
              <p className="mt-1 text-xs text-amber-600">No {isExpense ? 'expense' : 'income'} categories in Config → Finance.</p>
            )}
          </div>
          <div>
            <label className={lc}>Subcategory</label>
            <Controller name="expenseCategory" control={control} render={({ field }) => (
              <Select value={field.value ?? ''} onChange={v => field.onChange(v ?? '')}
                options={subcategories.map(c => ({ value: c, label: c }))}
                placeholder={!category ? 'Select category first…' : subcategories.length === 0 ? 'No subcategories' : 'Select…'}
                disabled={!category || subcategories.length === 0}
              />
            )} />
          </div>
          <div>
            <label className={lc}>Amount *</label>
            <input type="number" step="0.01" min="0" placeholder="0.00" {...register('amount')} onKeyDown={e => { if (e.key === '-' || e.key === 'e') e.preventDefault() }}
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
            {errors.amount && <p className="mt-1 text-xs text-red-500">{errors.amount.message}</p>}
          </div>
        </div>

        {/* Currency + BDT-equivalent (metrics always roll up in BDT) */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={lc}>Currency</label>
            <Controller name="currency" control={control} render={({ field }) => (
              <Select value={field.value ?? 'BDT'} onChange={v => field.onChange(v ?? 'BDT')}
                options={currencyOptions} placeholder="Select currency…" />
            )} />
          </div>
          {isForeign && (
            <div>
              <label className={lc}>BDT-equivalent spent/received *</label>
              <input type="number" step="0.01" min="0" placeholder="0.00" {...register('amountBDT')} onKeyDown={e => { if (e.key === '-' || e.key === 'e') e.preventDefault() }}
                className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
              <p className="mt-1 text-xs text-gray-400">The actual taka value — used for all finance metrics.</p>
              {errors.amountBDT && <p className="mt-1 text-xs text-red-500">{errors.amountBDT.message}</p>}
            </div>
          )}
        </div>

        <div>
          <label className={lc}>Detailed Description *</label>
          <textarea {...register('description')} rows={2} placeholder="What was this for? Who/where, and any context…" className={`${ic} resize-none`} />
          {errors.description && <p className="mt-1 text-xs text-red-500">{errors.description.message}</p>}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={lc}>Date *</label>
            {/* Money cannot move on a future day (the ledger refuses it); an expense request may be dated ahead. */}
            <input type="date" {...register('date')} max={isExpenseRequest ? undefined : dhakaDayKey()} className={ic} />
            {errors.date && <p className="mt-1 text-xs text-red-500">{errors.date.message}</p>}
          </div>
          {/* Payment method is recorded when the expense request is Paid, not at submit. */}
          {!isExpenseRequest && (
            <div>
              <label className={lc}>Payment Method</label>
              <Controller name="paymentMethod" control={control} render={({ field }) => (
                <Select value={field.value} onChange={v => field.onChange(v ?? '')}
                  options={paymentMethods}
                  placeholder="Select…"
                />
              )} />
            </div>
          )}
        </div>

        {/* Money account — where the money came in (or went out, for legacy rows). */}
        {!isExpenseRequest && (accountLocked ? (
          <div>
            <label className={lc}>Money account</label>
            <div className={`${ic} bg-gray-50 text-gray-700 flex items-center gap-2`}>
              <Landmark className="w-4 h-4 text-gray-400 shrink-0" />
              <span className="truncate">
                {tx?.accountId?.name
                  ? `${tx.accountId.name} · ${accountTypeLabel(tx.accountId.type)}${tx.accountId.last4 ? ` ••${tx.accountId.last4}` : ''}`
                  : (moneyAccounts.find(a => a.id === String(idOf(tx?.accountId)))?.name ?? 'Linked account')}
              </span>
              {reconciled && <span className="ml-auto text-[11px] text-emerald-700">Reconciled</span>}
            </div>
            <p className="mt-1 text-xs text-gray-400">This entry is reconciled with a bank statement, so its account cannot be changed.</p>
          </div>
        ) : showAccountPicker && (
          <div>
            <label className={lc}>
              {isEdit ? 'Money account' : 'Received into'}
              {accountRequired ? <span className="text-red-500 ml-0.5">*</span> : <span className="text-gray-400 text-xs ml-1">(optional)</span>}
            </label>
            {isEdit ? (
              // No auto-pick here: an entry only gets the account the user chooses.
              // (MoneyAccountSelect also keeps an archived current account visible.)
              <MoneyAccountSelect
                autoSelect={false}
                value={accountId}
                onChange={id => setAccountId(id ?? originalAccountId)}
                currency={currency || BASE_CURRENCY}
                date={dateVal || null}
                placeholder={originalAccountId ? 'Select account' : 'Not set (older entry)'}
              />
            ) : (
              <MoneyAccountSelect
                value={accountId}
                onChange={id => setAccountId(id)}
                currency={currency || BASE_CURRENCY}
                paymentMethod={paymentMethodVal || null}
                placeholder="Select bank / cash / wallet account"
                required={accountRequired}
                autoSelect={accountLive}
                date={dateVal || null}
              />
            )}
            <p className="mt-1 text-xs text-gray-400">
              {isEdit
                ? (originalAccountId
                  ? 'Change it only if the entry was posted to the wrong account. Entries linked to invoices or payments keep theirs.'
                  : 'This older entry has no money account. Set one so it shows in that account’s balance and statement.')
                : moneyAccounts.length === 0
                  ? 'No money accounts yet — add them in Finance → Money Accounts. After go-live every entry needs one.'
                  : !accountLive
                    ? `Dated before go-live (${goLiveDate}) — no money account needed; earlier movements are in the opening balances.`
                    : 'Picked automatically from the payment method; change it if the money landed elsewhere.'}
            </p>
          </div>
        ))}

        {/* Account manager + txn id are assigned when the expense is Paid, so they're
            hidden while submitting an expense request. */}
        {!isExpenseRequest && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={lc}>Account Manager</label>
            <div className={`${ic} bg-gray-50 cursor-not-allowed flex items-center justify-between`}>
              <span className="text-gray-700">
                {/* Editing keeps the stored manager, so show that person — not the current user */}
                {isEdit ? (tx?.accountManager?.name ?? '—') : (currentUser?.name ?? '—')}
                {!isEdit && currentUser?.role && (
                  <span className="ml-1.5 text-xs text-gray-400 font-normal">
                    {currentUser.role.replace('_', ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())}
                  </span>
                )}
              </span>
            </div>
          </div>
          <div>
            <label className={lc}>
              Transaction ID
              <span className="text-gray-400 text-xs ml-1">{isEdit ? '(cannot be changed)' : '(optional — auto-generated if blank)'}</span>
            </label>
            <input
              value={txnIdVal}
              onChange={e => setTxnIdVal(e.target.value)}
              placeholder="e.g. TXN-REF-001"
              readOnly={isEdit}
              className={`${ic}${isEdit ? ' bg-gray-50 text-gray-500 cursor-not-allowed' : ''}`}
            />
          </div>
        </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={lc}>Related Project</label>
            <Controller name="projectId" control={control} render={({ field }) => (
              <Select value={field.value} onChange={v => field.onChange(v ?? '')}
                options={projects.map(p => ({ value: p.id, label: p.name }))}
                placeholder="None"
              />
            )} />
          </div>
          <div>
            <label className={lc}>Reference</label>
            <input {...register('reference')} placeholder="INV-001, PO-123…" className={ic} />
          </div>
        </div>

        {type === 'INCOME' && (
          <div>
            <label className={lc}>Link to Invoice <span className="text-gray-400 font-normal text-xs">(syncs invoice paid amount)</span></label>
            <Controller name="invoiceId" control={control} render={({ field }) => (
              <Select value={field.value} onChange={v => field.onChange(v ?? '')}
                options={invoices.map(inv => ({ value: inv.id, label: `${inv.invoiceNumber} — ${inv.clientId?.userId?.name ?? inv.clientId?.company ?? 'Client'} (due ${formatCurrency(Math.max(0, toNum(inv.total) - toNum(inv.paidAmount)), inv.currency)})` }))}
                placeholder="None"
              />
            )} />
          </div>
        )}

        {/* Expense request: payee vendor + supplier-bill tax (VAT / VDS / TDS). */}
        {isExpenseRequest && Array.isArray(vendors) && vendors.length > 0 && (
          <div>
            <label className={lc}>Vendor <span className="text-gray-400 font-normal text-xs">(optional — fills BIN, VAT status &amp; TDS defaults)</span></label>
            <select value={vendorId} onChange={e => chooseVendor(e.target.value)} className={ic}>
              <option value="">No vendor</option>
              {vendors.map(v => (
                <option key={v.id} value={v.id}>{v.company}{v.bin && !String(v.bin).includes('•') ? ` · BIN ${v.bin}` : ''}</option>
              ))}
            </select>
          </div>
        )}
        {showExpenseTax && (
          <ExpenseTaxSection
            gross={amountVal}
            value={expTax}
            setValue={setExpTax}
            bankingForTax
            vatBank="yes"
            date={watch('date') || null}
            note="Withholding assumes payment through a bank. It is re-checked against the actual account and channel when the payment is recorded."
          />
        )}
        {isExpenseRequest && !showExpenseTax && (
          <p className="text-xs text-gray-400">VAT and VDS/TDS are recorded for BDT bills only — enter foreign-currency withholding in Tax &amp; VAT → Tax ledger.</p>
        )}

        <FileUpload
          label={receiptUrl ? 'Receipt / Invoice ✓ (optional)' : 'Receipt / Invoice (optional)'}
          value={receiptUrl}
          onUploaded={url => setReceiptUrl(url)}
        />
      </form>
      <ModalFooter>
        <button type="button" onClick={() => onOpenChange(false)}
          className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
          Cancel
        </button>
        <button type="submit" form="tx-form" disabled={isSubmitting}
          className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-60 transition-colors flex items-center gap-2">
          {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
          {isEdit ? 'Save Changes' : isExpenseRequest ? 'Submit Expense Request' : 'Add Transaction'}
        </button>
      </ModalFooter>
    </Modal>
  )
}

// ─── Approve Modal ────────────────────────────────────────────────────────────

function PaymentModal({ expense, onClose, onDone }) {
  const { paymentMethods } = useConfig()
  const { accounts: moneyAccounts, goLiveDate } = useMoneyAccounts()
  const [note,          setNote]          = useState('')
  const [amtBDT,        setAmtBDT]        = useState(expense.amountBDT ?? '')
  const [paymentMethod, setPaymentMethod] = useState('')
  const [txnId,         setTxnId]         = useState('')
  const [proofUrl,      setProofUrl]      = useState('')
  const [accountId,     setAccountId]     = useState(() => (idOf(expense.accountId) ? String(idOf(expense.accountId)) : null))
  const [account,       setAccount]       = useState(null)
  const [channel,       setChannel]       = useState('')
  const [channelTouched, setChannelTouched] = useState(false)
  const [paidAt,        setPaidAt]        = useState(() => dhakaDayKey())
  const [saving,        setSaving]        = useState(false)
  const isForeign    = (expense.currency ?? 'BDT') !== 'BDT'
  const hadStoredTax = !!expense.tax
  const storedVatType = expense.tax?.supplierVatType ?? null
  const [tax, setTax] = useState(() => expenseTaxState(expense))

  // Payee tax profile (payee type, PSR, BIN, VAT status, default TDS section) → form defaults, once.
  const { loading: payeeLoading, payee } = usePayeeProfile(expense)
  const payeeApplied = useRef(false)
  useEffect(() => {
    if (!payee || payeeApplied.current) return
    payeeApplied.current = true
    setTax(prev => applyPayeeDefaults(prev, payee, { hadStoredTax, storedVatType }))
  }, [payee, hadStoredTax, storedVatType])

  const accountObj = account ?? moneyAccounts.find(a => a.id === accountId) ?? null
  const autoChannel = channelFromPaymentMethod(paymentMethod || null, accountObj) ?? ''
  const effectiveChannel = channelTouched ? channel : autoChannel
  // No channel sent ⇒ the server derives it from the method / account, as here.
  const facts = channelFacts(effectiveChannel || autoChannel || null, accountObj)
  // A purchase bill fixed the VAT and its creditability (its assets were costed on that basis).
  const vatLocked = !!idOf(expense.purchaseBillId)
  // A payment dated before go-live needs no account (and the accounts opened on go-live refuse it).
  const accountLive     = accountRequiredOn(paidAt, goLiveDate)
  const accountRequired = moneyAccounts.length > 0 && accountLive
  const category = `${expense.category ?? ''} ${expense.subcategory ?? ''}`
  const today = dhakaDayKey()

  const built = isForeign
    ? { errors: [], payload: null, net: toNum(expense.amount) }
    : buildExpenseTax(tax, { gross: expense.amount, category, origin: expense.origin ?? null, cashLike: facts.cashLike, vatLocked, force: hadStoredTax })
  const warnings = isForeign ? [] : expenseComplianceWarnings({ tax, gross: expense.amountBDT ?? expense.amount, category, origin: expense.origin ?? null, facts })

  // Cash leaving the account, in the account's currency (overdraft hint only — the server enforces it).
  const cashOut = isForeign
    ? (accountObj?.currency === expense.currency ? toNum(expense.amount) : toNum(amtBDT))
    : built.net
  const available = accountObj ? toNum(accountObj.balance) + toNum(accountObj.creditLimit) : null
  const overdraft = !!accountObj && accountObj.allowNegative === false && available !== null && cashOut > available + 0.005

  const problems = []
  if (!paymentMethod)                              problems.push('Select the payment method')
  if (accountRequired && !accountId)               problems.push('Select the account the money was paid from')
  if (accountObj?.openingDate && paidAt && paidAt < accountObj.openingDate) {
    problems.push(`${accountObj.name} opens on ${accountObj.openingDate} — the payment date is earlier; choose another account${accountLive ? '' : ' or leave it empty'}`)
  }
  if (!proofUrl && !txnId.trim())                  problems.push('Enter a transaction ID or upload payment proof')
  if (isForeign && !(Number(amtBDT) > 0))          problems.push('Enter the BDT-equivalent for this foreign-currency expense')
  if (!paidAt)                                     problems.push('Pick the payment date')
  else if (paidAt > today)                         problems.push('The payment date cannot be in the future')
  problems.push(...built.errors)
  const canPay = problems.length === 0

  async function submit(action) {
    if (action === 'pay' && problems.length) { toast.error(problems[0]); return }
    setSaving(true)
    try {
      const res  = await fetch(`/api/expenses/${expense.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'pay' ? {
          action,
          note,
          paymentMethod,
          paymentTxnId:    txnId.trim() || undefined,
          paymentProofUrl: proofUrl || undefined,
          amountBDT:       isForeign ? Number(amtBDT) : undefined,
          accountId:       accountId || undefined,
          channel:         effectiveChannel || undefined,
          paidAt,
          tax:             built.payload ?? undefined,
        } : { action, note }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(apiErrorMessage(json, action === 'pay' ? 'Payment could not be recorded' : 'Could not reject the request'))
      if (action === 'pay') {
        invalidateMoneyAccounts()
        toast.success('Payment recorded — invoice ready to print & authorize')
        for (const w of Array.isArray(json.warnings) ? json.warnings : []) {
          if (w?.message) toast(w.message, { duration: 7000 })
        }
      } else {
        toast.success('Request rejected')
      }
      onDone()
      onClose()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const ic = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900'
  const lc = 'block text-sm font-medium text-gray-700 mb-1'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl border border-gray-200 w-full max-w-3xl max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-100 shrink-0">
          <h3 className="text-base font-semibold text-gray-900">Record Payment</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        {/* Scrollable body */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-5">
          <p className="text-xs text-gray-500">
            Record how and from which account the payment was made. This marks the expense <strong>Paid</strong>,
            posts it to the ledger on the payment date and generates the invoice — print it, get it authorized,
            then upload the scan to move it to <strong>Authorized</strong>.
          </p>

          {/* Two-column layout: summary + submitted proof */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-4 space-y-2">
              <p className="text-sm font-semibold text-gray-900">{expense.title}</p>
              <p className="text-xs text-gray-500">{expense.category}{expense.subcategory ? ` / ${expense.subcategory}` : ''} · {fmtDate(expense.date)}</p>
              <p className="text-xl font-bold text-gray-900">{formatCurrency(expense.amount, expense.currency)}</p>
              {(payee?.name || expense.paidToName) && (
                <p className="text-xs text-gray-500">Payee: <span className="font-medium text-gray-700">{payee?.name ?? expense.paidToName}</span></p>
              )}
              {expense.submittedBy?.name && (
                <p className="text-xs text-gray-500">Submitted by: <span className="font-medium text-gray-700">{expense.submittedBy.name}</span></p>
              )}
              <PurchaseBillLink expense={expense} />
              {expense.notes && (
                <p className="text-xs text-gray-500 border-t border-gray-200 pt-2 mt-2 whitespace-pre-wrap">{expense.notes}</p>
              )}
            </div>

            {docUrl(expense.invoiceUrl) ? (
              <DocPreview url={docUrl(expense.invoiceUrl)} label="Submitted Proof / Memo" />
            ) : (
              <div className="rounded-xl bg-gray-50 border border-dashed border-gray-200 flex items-center justify-center py-8 text-center px-4">
                <p className="text-xs text-gray-400">No proof attached — verify the description details above.</p>
              </div>
            )}
          </div>

          {/* Payment: method, account, channel, date, transaction id */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={lc}>Payment method <span className="text-red-500">*</span></label>
              <select value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)} className={ic}>
                <option value="">Select method…</option>
                {paymentMethods.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </select>
            </div>
            <div>
              <label className={lc}>
                Paid from {accountRequired ? <span className="text-red-500">*</span> : <span className="text-gray-400 text-xs ml-1">(optional)</span>}
              </label>
              <MoneyAccountSelect
                value={accountId}
                onChange={(id, acc) => { setAccountId(id); setAccount(acc ?? null) }}
                currency={expense.currency ?? 'BDT'}
                paymentMethod={paymentMethod || null}
                placeholder="Select bank / cash / wallet account"
                required={accountRequired}
                autoSelect={accountLive}
                date={paidAt || null}
              />
              {moneyAccounts.length === 0 ? (
                <p className="mt-1 text-[11px] text-gray-400">No money accounts yet — add them in Finance → Money Accounts. After go-live every payment needs one.</p>
              ) : !accountLive && (
                <p className="mt-1 text-[11px] text-gray-400">Paid before go-live ({goLiveDate}) — no money account needed.</p>
              )}
              {overdraft && (
                <p className="mt-1 text-[11px] text-red-600">Only {formatMoney(available, accountObj.currency)} available in this account.</p>
              )}
            </div>
            <div>
              <label className={lc}>Channel</label>
              <select value={effectiveChannel}
                onChange={e => { setChannel(e.target.value); setChannelTouched(true) }}
                className={ic}>
                <option value="">Select channel…</option>
                {CHANNEL_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
              <p className="mt-1 text-[11px] text-gray-400">
                {facts.incomeTaxBank ? 'Banking channel for income tax.' : 'Not a banking channel — cash rules apply.'}
                {!channelTouched && autoChannel ? ' Set from the method / account.' : ''}
              </p>
            </div>
            <div>
              <label className={lc}>Payment date <span className="text-red-500">*</span></label>
              <DatePicker value={paidAt || null} onChange={v => setPaidAt(v ?? '')} clearable={false} />
              <p className="mt-1 text-[11px] text-gray-400">The ledger entry is dated on this day.</p>
            </div>
            <div className="sm:col-span-2">
              <label className={lc}>
                Transaction ID {!proofUrl && <span className="text-red-500">*</span>}
                {proofUrl && <span className="text-gray-400 text-xs ml-1">(optional)</span>}
              </label>
              <input value={txnId} onChange={e => setTxnId(e.target.value)} placeholder="e.g. bank / bKash txn ref, cheque no." className={ic} />
            </div>
          </div>

          <FileUpload
            label={`Payment proof ${txnId.trim() ? '(optional)' : '(required if no transaction ID)'}`}
            value={proofUrl}
            onUploaded={url => setProofUrl(url)}
          />
          <p className="text-xs text-gray-400 -mt-3">Proof that the payment was actually made (bank/MFS receipt). Optional if you enter a transaction ID.</p>

          {isForeign && (
            <div>
              <label className={lc}>
                Actual spend in BDT <span className="text-red-500">*</span>
                <span className="text-gray-400 text-xs ml-1">({expense.currency} → BDT)</span>
              </label>
              <input type="number" value={amtBDT} onChange={e => setAmtBDT(e.target.value)}
                placeholder="e.g. 12000" className={ic} />
              <p className="mt-1 text-xs text-gray-400">VAT and VDS/TDS are recorded on BDT bills only — enter withholding on foreign payments in Tax &amp; VAT → Tax ledger.</p>
            </div>
          )}

          {/* Supplier-bill tax: VAT, input credit, VDS / TDS withheld */}
          {!isForeign && (
            <ExpenseTaxSection
              gross={expense.amount}
              value={tax}
              setValue={setTax}
              bankingForTax={facts.incomeTaxBank}
              vatBank={facts.vatBank}
              date={paidAt || null}
              payeeLoading={payeeLoading}
              defaultOpen={hadStoredTax}
              vatLocked={vatLocked}
            />
          )}

          <WarningList items={warnings} />

          {/* Note */}
          <div>
            <label className={lc}>Note (optional)</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
              placeholder="Add a note for the requester…"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none" />
          </div>
        </div>

        {/* Footer */}
        <div className="flex flex-wrap items-center gap-2 justify-end px-4 sm:px-6 py-4 border-t border-gray-100 shrink-0">
          {!canPay && problems[0] && (
            <p className="w-full sm:w-auto sm:mr-auto text-xs text-amber-700 flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5 shrink-0" /> {problems[0]}</p>
          )}
          <button onClick={onClose} disabled={saving}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={() => submit('reject')} disabled={saving}
            className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-60 flex items-center gap-1.5">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            <XCircle className="w-4 h-4" /> Reject
          </button>
          <button onClick={() => submit('pay')} disabled={saving || !canPay}
            className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-60 flex items-center gap-1.5">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            <CheckCircle2 className="w-4 h-4" />
            {isForeign ? 'Mark Paid' : `Mark Paid · ${fmtTk(built.net)}`}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Authorize Modal ──────────────────────────────────────────────────────────
// Final stage: print the paid invoice, get it authorized (signed & sealed), then
// upload the scan here to move the expense to AUTHORIZED.

function AuthorizeModal({ expense, onClose, onDone }) {
  const { paymentMethods } = useConfig()
  const [scanUrl, setScanUrl] = useState('')
  const [saving,  setSaving]  = useState(false)
  const methodLabel = paymentMethods.find(m => m.value === expense.paymentMethod)?.label ?? expense.paymentMethod ?? '—'

  async function submit() {
    if (!scanUrl) { toast.error('Upload the scan of the authorized invoice'); return }
    setSaving(true)
    try {
      const res  = await fetch(`/api/expenses/${expense.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'authorize', signedInvoiceUrl: scanUrl }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Invoice authorized')
      onDone()
      onClose()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl border border-gray-200 w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <h3 className="text-base font-semibold text-gray-900">Authorize Invoice — {expense.expenseId ?? expense.expenseInvoiceNo ?? ''}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-gray-900">{expense.title}</p>
              <p className="text-xs text-gray-500">{expense.category}{expense.subcategory ? ` / ${expense.subcategory}` : ''} · {fmtDate(expense.date)}</p>
              <p className="text-lg font-bold text-gray-900 mt-1">{formatCurrency(expense.amount, expense.currency)}</p>
              <p className="text-xs text-gray-500 mt-1">Paid via <span className="font-medium text-gray-700">{methodLabel}</span>{expense.paymentTxnId ? ` · Txn ${expense.paymentTxnId}` : ''}</p>
            </div>
            <a href={`/api/expenses/${expense.id}/voucher`} target="_blank" rel="noreferrer"
              className="px-3 py-2 text-xs font-medium border border-gray-200 rounded-lg hover:bg-white flex items-center gap-1.5 shrink-0">
              <Printer className="w-4 h-4" /> Print Invoice
            </a>
          </div>

          <FileUpload
            label="Authorized invoice scan (required)"
            value={scanUrl}
            onUploaded={url => setScanUrl(url)}
          />
          <p className="text-xs text-gray-400 -mt-3">Upload the printed invoice after it has been signed by the account manager / authorized signatory and stamped with the company seal.</p>
        </div>

        <div className="flex gap-2 justify-end px-6 py-4 border-t border-gray-100 shrink-0">
          <button onClick={onClose} disabled={saving}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={submit} disabled={saving || !scanUrl}
            className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-60 flex items-center gap-1.5">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            <CheckCircle2 className="w-4 h-4" /> Authorize
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Reverse Payment Modal ────────────────────────────────────────────────────
// Undoes a recorded expense payment (PAID / AUTHORIZED): the server posts a
// reversing ledger entry, voids the VAT / VDS / TDS entries the payment created
// and puts the request back to Pending, so it can be paid again correctly.
// PATCH /api/expenses/[id] { action:'reverse', reason }.

function ReversePaymentModal({ expense, onClose, onDone }) {
  const [reason, setReason] = useState('')
  const [saving, setSaving] = useState(false)
  const trimmed = reason.trim()

  async function submit() {
    if (trimmed.length < 5) { toast.error('Give a reason (at least 5 characters)'); return }
    setSaving(true)
    try {
      const res  = await fetch(`/api/expenses/${expense.id ?? expense._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reverse', reason: trimmed }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(apiErrorMessage(json, 'The payment could not be reversed'))
      invalidateMoneyAccounts()   // the reversal moves money back into the account
      toast.success('Payment reversed — the request is back to Pending')
      for (const w of Array.isArray(json.warnings) ? json.warnings : []) {
        if (w?.message) toast(w.message, { duration: 7000 })
      }
      onDone()
      onClose()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl border border-gray-200 w-full max-w-lg max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-100 shrink-0">
          <h3 className="text-base font-semibold text-gray-900">Reverse payment{expense.expenseInvoiceNo ? ` — ${expense.expenseInvoiceNo}` : ''}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-4">
          <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-3">
            <p className="text-sm font-semibold text-gray-900">{expense.title}</p>
            <p className="text-xs text-gray-500">{expense.category}{expense.subcategory ? ` / ${expense.subcategory}` : ''} · {fmtDate(expense.date)}</p>
            <p className="text-lg font-bold text-gray-900 mt-1">{formatCurrency(expense.amount, expense.currency)}</p>
          </div>
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-800 space-y-1">
            <p>This posts a reversing entry for the payment (dated today), voids the VAT / VDS / TDS entries it created and puts the request back to <strong>Pending</strong>, so it can be paid again with the right details.</p>
            <p>It is refused while a tax entry is in a filed return, deposited by challan or has an issued certificate, or when the books are locked.</p>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Reason <span className="text-red-500">*</span></label>
            <textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={300}
              placeholder="e.g. VDS withheld on a service that is not on the VDS list"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-gray-900" />
          </div>
        </div>

        <div className="flex gap-2 justify-end px-4 sm:px-6 py-4 border-t border-gray-100 shrink-0">
          <button onClick={onClose} disabled={saving}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={submit} disabled={saving || trimmed.length < 5}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-60 flex items-center gap-1.5">
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />} Reverse payment
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Batch Authorize Modal ────────────────────────────────────────────────────
// Authorizes a whole group of PAID expenses against ONE combined invoice: print
// the combined invoice, get it signed & sealed, upload the scan.

function BatchAuthorizeModal({ ids, expenses, onClose, onDone }) {
  const [scanUrl, setScanUrl] = useState('')
  const [saving,  setSaving]  = useState(false)

  const totalBDT = expenses.reduce((s, e) => s + (e.amountBDT ?? e.amount ?? 0), 0)
  const idsParam = ids.join(',')

  async function submit() {
    if (!scanUrl) { toast.error('Upload the scan of the authorized combined invoice first'); return }
    setSaving(true)
    try {
      const res  = await fetch('/api/expenses/batch-authorize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids, signedInvoiceUrl: scanUrl }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success(`${json.data?.authorized ?? ids.length} expense(s) authorized`)
      onDone()
      onClose()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl border border-gray-200 w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <h3 className="text-base font-semibold text-gray-900">Authorize {ids.length} expense{ids.length > 1 ? 's' : ''} — combined invoice</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100">
            <X className="w-5 h-5 text-gray-400" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-4 flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-gray-900">{ids.length} paid expense{ids.length > 1 ? 's' : ''}</p>
              <p className="text-lg font-bold text-gray-900 mt-1">Total <TkAmt value={totalBDT} decimals={2} /> <span className="text-xs font-normal text-gray-400">BDT</span></p>
            </div>
            <a href={`/api/expenses/combined-voucher?ids=${idsParam}`} target="_blank" rel="noreferrer"
              className="px-3 py-2 text-xs font-medium border border-gray-200 rounded-lg hover:bg-white flex items-center gap-1.5 shrink-0">
              <Printer className="w-4 h-4" /> Print Combined Invoice
            </a>
          </div>

          <FileUpload
            label="Authorized combined invoice scan (required)"
            value={scanUrl}
            onUploaded={url => setScanUrl(url)}
          />
          <p className="text-xs text-gray-400 -mt-3">Print the combined invoice, get it signed &amp; sealed, then upload the scan — one authorized invoice authorizes all {ids.length} expense(s) together.</p>
        </div>

        <div className="flex gap-2 justify-end px-6 py-4 border-t border-gray-100 shrink-0">
          <button onClick={onClose} disabled={saving}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={submit} disabled={saving || !scanUrl}
            className="px-4 py-2 text-sm font-medium text-white bg-green-600 rounded-lg hover:bg-green-700 disabled:opacity-60 flex items-center gap-1.5">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            <CheckCircle2 className="w-4 h-4" /> Authorize {ids.length}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Expense Detail Modal ─────────────────────────────────────────────────────
// Read-only preview: expense summary + all documents (main invoice, submitted
// proof, payment proof and — once authorized — the authorized invoice scan).

function ExpenseDetailModal({ expense, onClose }) {
  const { paymentMethods } = useConfig()
  const methodLabel = paymentMethods.find(m => m.value === expense.paymentMethod)?.label ?? expense.paymentMethod ?? null
  const isForeign = (expense.currency ?? 'BDT') !== 'BDT'
  const settled   = expense.status === 'PAID' || expense.status === 'AUTHORIZED'
  const hasInvoice = expense.status !== 'PENDING' && expense.status !== 'REJECTED'
  // Input-VAT credit: once paid, what the payment recorded (expense.inputVat — it may have
  // refused the credit: no Mushak-6.3 / BIN, turnover supplier, cash over Tk 1,00,000…);
  // before that, only what was requested.
  const itc = expense.inputVat ?? null
  const vatCreditText = settled
    ? (itc?.creditable === true ? ' (input credit claimed)'
      : itc?.creditable === false ? ` (no input credit${itc.reasonLabel ? ` — ${itc.reasonLabel}` : ''})`
      : '')
    : (expense.status === 'PENDING' && expense.tax?.vatCreditable ? ' (input credit requested)' : '')

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl border border-gray-200 w-full max-w-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 shrink-0">
          <h3 className="text-base font-semibold text-gray-900">Expense — {expense.expenseId ?? expense.expenseInvoiceNo ?? ''}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100"><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Summary */}
          <div className="rounded-xl bg-gray-50 border border-gray-100 px-4 py-4 space-y-2">
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <p className="text-sm font-semibold text-gray-900">{expense.title}</p>
                  {expense.origin === 'REIMBURSEMENT' && (
                    <span className="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-50 text-indigo-700">
                      Reimbursement
                    </span>
                  )}
                </div>
                <p className="text-xs text-gray-500">{expense.category}{expense.subcategory ? ` / ${expense.subcategory}` : ''} · {fmtDate(expense.date)}</p>
              </div>
              <StatusDot status={expense.status} />
            </div>
            <p className="text-xl font-bold text-gray-900">
              {formatCurrency(expense.amount, expense.currency)}
              {isForeign && <span className="text-xs font-normal text-gray-400 ml-2">≈ {formatCurrency(expense.amountBDT ?? 0, 'BDT')}</span>}
            </p>
            {expense.submittedBy?.name && (
              <p className="text-xs text-gray-500">Submitted by: <span className="font-medium text-gray-700">{expense.submittedBy.name}</span></p>
            )}
            <PurchaseBillLink expense={expense} />
            {settled && (
              <p className="text-xs text-gray-500">
                Paid via <span className="font-medium text-gray-700">{methodLabel ?? '—'}</span>
                {expense.accountId?.name ? <> from <span className="font-medium text-gray-700">{expense.accountId.name}</span></> : ''}
                {expense.paidAt ? ` on ${fmtDate(expense.paidAt)}` : ''}
                {expense.paymentTxnId ? ` · Txn ${expense.paymentTxnId}` : ''}
              </p>
            )}
            {expense.tax && (toNum(expense.tax.vatAmount) > 0 || toNum(expense.tax.vdsAmount) > 0 || toNum(expense.tax.tdsAmount) > 0) && (
              <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-gray-500 border-t border-gray-200 pt-2 mt-2">
                {toNum(expense.tax.vatAmount) > 0 && (
                  <span>VAT {fmtTk(expense.tax.vatAmount)}{vatCreditText}</span>
                )}
                {toNum(expense.tax.vdsAmount) > 0 && <span>VDS withheld {fmtTk(expense.tax.vdsAmount)}</span>}
                {toNum(expense.tax.tdsAmount) > 0 && (
                  <span>TDS withheld {fmtTk(expense.tax.tdsAmount)}{expense.tax.tdsSection ? ` (${expense.tax.tdsSection})` : ''}</span>
                )}
                {expense.tax.netPayable !== null && expense.tax.netPayable !== undefined && (
                  <span className="font-medium text-gray-700">Net paid {fmtTk(expense.tax.netPayable)}</span>
                )}
              </div>
            )}
            {expense.notes && (
              <p className="text-xs text-gray-500 border-t border-gray-200 pt-2 mt-2 whitespace-pre-wrap">{expense.notes}</p>
            )}
          </div>

          {/* Documents */}
          <div className="space-y-3">
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Documents</p>
            {hasInvoice && (
              <a href={`/api/expenses/${expense.id ?? expense._id}/voucher`} target="_blank" rel="noreferrer"
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50">
                <Printer className="w-4 h-4" /> Open main invoice
              </a>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {docUrl(expense.signedInvoiceUrl) && <DocPreview url={docUrl(expense.signedInvoiceUrl)} label="Authorized Invoice" />}
              {docUrl(expense.paymentProofUrl)  && <DocPreview url={docUrl(expense.paymentProofUrl)}  label="Payment Proof" />}
              {docUrl(expense.invoiceUrl)       && <DocPreview url={docUrl(expense.invoiceUrl)}       label="Submitted Proof / Memo" />}
            </div>
            {!hasInvoice && !docUrl(expense.signedInvoiceUrl) && !docUrl(expense.paymentProofUrl) && !docUrl(expense.invoiceUrl) && (
              <p className="text-xs text-gray-400">No documents yet.</p>
            )}
          </div>
        </div>

        <div className="flex justify-end px-6 py-4 border-t border-gray-100 shrink-0">
          <button onClick={onClose} className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">Close</button>
        </div>
      </div>
    </div>
  )
}

// ─── Confirm Payment Modal ────────────────────────────────────────────────────

function ConfirmPaymentModal({ payment, currentUser, onClose, onDone }) {
  const { paymentMethods } = useConfig()
  const { data: session } = useSession()
  const fmtMethod = v => v ? (paymentMethods.find(m => m.value === v)?.label ?? v.replace(/_/g, ' ')) : '—'
  const { accounts: moneyAccounts, goLiveDate } = useMoneyAccounts()
  const [note,           setNote]           = useState('')
  const [txnId,          setTxnId]          = useState('')
  const [amountBDT,      setAmountBDT]      = useState(payment.amountBDT ? String(payment.amountBDT) : '')
  const [accountId,      setAccountId]      = useState(() => (idOf(payment.accountId) ? String(idOf(payment.accountId)) : null))
  const [account,        setAccount]        = useState(null)
  const [channel,        setChannel]        = useState(payment.channel ?? '')
  const [channelTouched, setChannelTouched] = useState(!!payment.channel)
  // Withholding the client deducted (may already be stored on the pending payment).
  const [withholding,    setWithholding]    = useState(() => ({
    ...emptyWithholding(),
    vdsAmount:          toNum(payment.vdsAmount),
    tdsAmount:          toNum(payment.tdsAmount),
    tdsSection:         payment.tdsSection ?? null,
    vdsCertificateNo:   payment.vdsCertificateNo ?? null,
    vdsCertificateDate: dayKeyOf(payment.vdsCertificateDate) || null,
    tdsCertificateNo:   payment.tdsCertificateNo ?? null,
    tdsCertificateDate: dayKeyOf(payment.tdsCertificateDate) || null,
  }))
  const [invoice, setInvoice] = useState(() => (payment.invoiceId && typeof payment.invoiceId === 'object' ? payment.invoiceId : null))
  const [saving,  setSaving]  = useState(false)
  const isForeign = (payment.currency ?? 'BDT') !== 'BDT'
  const invoiceKey = idOf(payment.invoiceId)

  // The confirmations list may not carry the invoice's VAT figures — load them
  // when the reviewer can read invoices (they only refine the VDS/TDS hints).
  const canReadInvoices = canDo(session, 'sales.invoices.view')
  useEffect(() => {
    if (!invoiceKey || !canReadInvoices) return
    const populated = payment.invoiceId && typeof payment.invoiceId === 'object' ? payment.invoiceId : null
    if (populated && 'vatAmount' in populated && 'currency' in populated) return
    let alive = true
    fetch(`/api/invoices/${invoiceKey}`)
      .then(async r => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || 'Invoice not readable')
        return j.data
      })
      .then(inv => { if (alive && inv) setInvoice(prev => ({ ...(prev ?? {}), ...inv })) })
      .catch(() => { /* keep the populated summary */ })
    return () => { alive = false }
  }, [invoiceKey, canReadInvoices, payment.invoiceId])

  const accountObj  = account ?? moneyAccounts.find(a => a.id === accountId) ?? null
  const autoChannel = channelFromPaymentMethod(payment.paymentMethod || null, accountObj) ?? ''
  const effectiveChannel = channelTouched ? channel : autoChannel
  // Settlement: cash + VDS + TDS withheld by the client (BDT invoices only).
  const canWithhold = !!invoiceKey && !isForeign
  const cash    = toNum(payment.amount)
  // A withholding-only request (no cash) moves no money, so it needs no account;
  // neither does a payment dated before go-live (the server only requires one
  // from go-live on, and accounts opened on go-live refuse earlier dates).
  const paymentDay       = dayKeyOf(payment.paymentDate)
  const accountLive      = accountRequiredOn(paymentDay, goLiveDate)
  const accountRequired  = moneyAccounts.length > 0 && cash > 0 && accountLive
  const vds     = canWithhold ? Math.max(0, toNum(withholding.vdsAmount)) : 0
  const tds     = canWithhold ? Math.max(0, toNum(withholding.tdsAmount)) : 0
  const settled = round2(cash + vds + tds)
  const invTotal = toNum(invoice?.total)
  const invDue   = invoice ? Math.max(0, round2(invTotal - toNum(invoice.paidAmount))) : null
  const overDue  = invDue !== null && settled > invDue + 0.01
  // WithholdingFields base = value excl. VAT of the part being settled.
  const share    = invTotal > 0 ? Math.min(1, settled / invTotal) : 0
  const vatShare = invTotal > 0 ? round2(toNum(invoice?.vatAmount) * share) : 0
  const taxable  = invoice?.taxableValue !== null && invoice?.taxableValue !== undefined ? toNum(invoice.taxableValue) : null
  const base     = invTotal > 0 && taxable !== null ? round2(taxable * share) : round2(Math.max(0, settled - vatShare - (invTotal > 0 ? toNum(invoice?.sdAmount) * share : 0)))

  const problems = []
  if (cash > 0 && !payment.receiptUrl && !txnId.trim()) problems.push('Upload payment proof OR enter a Transaction ID to confirm')
  if (!(cash > 0) && !(vds + tds > 0))     problems.push('This request has no cash and no tax withheld — reject it instead')
  if (isForeign && !(Number(amountBDT) > 0)) problems.push(`Enter the BDT amount received for this ${payment.currency} payment`)
  if (accountRequired && !accountId)        problems.push('Select the money account the payment landed in')
  if (cash > 0 && accountObj?.openingDate && paymentDay && paymentDay < accountObj.openingDate) {
    problems.push(`${accountObj.name} opens on ${accountObj.openingDate} — the payment date is earlier; choose another account${accountLive ? '' : ' or leave it empty'}`)
  }
  if (overDue)                              problems.push(`Cash + VDS + TDS (${fmtTk(settled)}) is more than the invoice balance of ${fmtTk(invDue)}`)

  async function submit(action) {
    if (action === 'confirm' && problems.length) { toast.error(problems[0]); return }
    setSaving(true)
    try {
      const res  = await fetch(`/api/project-payments/${payment.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(action === 'confirm' ? {
          action,
          rejectionNote:  note || undefined,
          txnId:          txnId.trim() || undefined,
          accountManager: currentUser?.id || undefined,
          amountBDT:      isForeign && Number(amountBDT) > 0 ? Number(amountBDT) : undefined,
          // null (not undefined) when cleared, so the server does not fall back to the requester's suggested account.
          accountId:      cash > 0 ? (accountId || null) : undefined,
          channel:        cash > 0 ? (effectiveChannel || undefined) : undefined,
          ...(canWithhold ? {
            vdsAmount:          vds,
            tdsAmount:          tds,
            tdsSection:         withholding.tdsSection || null,
            vdsCertificateNo:   withholding.vdsCertificateNo || null,
            vdsCertificateDate: withholding.vdsCertificateDate || null,
            tdsCertificateNo:   withholding.tdsCertificateNo || null,
            tdsCertificateDate: withholding.tdsCertificateDate || null,
          } : {}),
        } : {
          action,
          rejectionNote: note || undefined,
        }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(apiErrorMessage(json, action === 'confirm' ? 'Payment could not be confirmed' : 'Could not reject the payment'))
      if (action === 'confirm') invalidateMoneyAccounts()
      toast.success(action === 'confirm' ? 'Payment confirmed & added to income' : 'Payment rejected')
      onDone()
      onClose()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const project = payment.projectId
  const client  = payment.clientId?.userId
  const ic = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl border border-gray-200 w-full max-w-2xl max-h-[92vh] flex flex-col">
        <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-gray-100 shrink-0">
          <h3 className="text-base font-semibold text-gray-900">Confirm Payment</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100"><X className="w-5 h-5 text-gray-400" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-5 space-y-4">
          {/* Summary */}
          <div className="rounded-lg bg-gray-50 border border-gray-100 px-4 py-3 space-y-1.5">
            {project?.name && (
              <p className="text-sm font-semibold text-gray-900">
                {project.projectCode ? `[${project.projectCode}] ` : ''}{project.name}
              </p>
            )}
            {client?.name && (
              <p className="text-xs text-gray-500">Client: {client.name}</p>
            )}
            {invoice?.invoiceNumber && (
              <p className="text-xs text-gray-500">
                Invoice {invoice.invoiceNumber}
                {invDue !== null && <> · balance <span className="font-medium text-gray-700">{formatCurrency(invDue, payment.currency ?? 'BDT')}</span></>}
                {toNum(invoice.vatAmount) > 0 && <> · incl. VAT {formatCurrency(invoice.vatAmount, payment.currency ?? 'BDT')}</>}
              </p>
            )}
            {payment.description && (
              <p className="text-xs text-gray-600">{payment.description}</p>
            )}
            <p className="text-xl font-bold text-gray-900">
              {payment.currency} {Number(payment.amount).toLocaleString()}
            </p>
            <p className="text-xs text-gray-500">
              {fmtMethod(payment.paymentMethod)} · {fmtDate(payment.paymentDate)}
            </p>
            {payment.submittedBy?.name && (
              <p className="text-xs text-gray-400">Recorded by: {payment.submittedBy.name}</p>
            )}
            {payment.notes && (
              <p className="text-xs text-gray-500 italic">{payment.notes}</p>
            )}
            {docUrl(payment.receiptUrl) && (
              <DocPreview url={docUrl(payment.receiptUrl)} compact />
            )}
          </div>

          <div className="rounded-lg border border-gray-100 bg-gray-50 px-4 py-2.5 text-xs text-gray-600">
            Confirming will create an <strong>INCOME transaction</strong> in the ledger for {payment.currency ?? 'BDT'} {Number(payment.amount).toLocaleString('en-BD', { minimumFractionDigits: 2 })}
            {vds + tds > 0 && invoice?.invoiceNumber && (
              <> and settle <strong>{fmtTk(settled)}</strong> of invoice {invoice.invoiceNumber} — VDS / TDS the client withheld count as paid and become tax credits.</>
            )}
            {!(vds + tds > 0) && '.'}
          </div>

          {/* Money account + channel */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Received into {accountRequired ? <span className="text-red-500">*</span> : <span className="text-gray-400 text-xs ml-1">(optional)</span>}
              </label>
              <MoneyAccountSelect
                value={accountId}
                onChange={(id, acc) => { setAccountId(id); setAccount(acc ?? null) }}
                currency={payment.currency ?? 'BDT'}
                paymentMethod={payment.paymentMethod || null}
                placeholder={cash > 0 ? 'Select bank / cash / wallet account' : 'No cash — withholding only'}
                required={accountRequired}
                disabled={!(cash > 0)}
                autoSelect={accountLive}
                date={paymentDay || null}
              />
              {moneyAccounts.length === 0 ? (
                <p className="mt-1 text-[11px] text-gray-400">No money accounts yet — add them in Finance → Money Accounts. After go-live every receipt needs one.</p>
              ) : cash > 0 && !accountLive && (
                <p className="mt-1 text-[11px] text-gray-400">Received before go-live ({goLiveDate}) — no money account needed; leave it empty.</p>
              )}
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Channel</label>
              <select value={effectiveChannel} onChange={e => { setChannel(e.target.value); setChannelTouched(true) }} className={ic}>
                <option value="">Select channel…</option>
                {CHANNEL_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
          </div>

          {/* Account Manager + TxnId */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Account Manager</label>
              <div className={`${ic} bg-gray-50 cursor-not-allowed flex items-center`}>
                <span className="text-gray-700">
                  {currentUser?.name ?? '—'}
                  {currentUser?.role && (
                    <span className="ml-1.5 text-xs text-gray-400 font-normal">
                      {currentUser.role.replace('_', ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())}
                    </span>
                  )}
                </span>
              </div>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Transaction ID
                {!payment.receiptUrl && <span className="text-red-500 ml-1">*</span>}
                {payment.receiptUrl && <span className="text-gray-400 text-xs ml-1">(optional)</span>}
              </label>
              <input value={txnId} onChange={e => setTxnId(e.target.value)}
                placeholder="e.g. TXN-REF-001"
                className={ic} />
              {!payment.receiptUrl && !txnId && (
                <p className="text-xs text-amber-600 mt-1">Required — no receipt attached</p>
              )}
            </div>
          </div>

          {isForeign && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                BDT received <span className="text-red-500 ml-1">*</span>
              </label>
              <input type="number" step="0.01" min="0" value={amountBDT} onChange={e => setAmountBDT(e.target.value)}
                placeholder={`BDT equivalent of ${payment.currency} ${Number(payment.amount).toLocaleString()}`}
                className={ic} />
            </div>
          )}

          {/* VDS / TDS withheld by the client */}
          {canWithhold ? (
            <>
              <WithholdingFields
                mode="CUSTOMER"
                baseAmount={base}
                vatAmount={vatShare}
                payeeType="COMPANY"
                value={withholding}
                onChange={setWithholding}
                date={dayKeyOf(payment.paymentDate) || null}
                defaultOpen={vds + tds > 0}
                vdsAllowed={invoiceAllowsVds(invoice)}
              />
              {vds + tds > 0 && (
                <div className="rounded-xl border border-gray-100 bg-gray-50 px-4 py-3 text-xs flex flex-wrap items-center gap-x-4 gap-y-1 text-gray-600">
                  <span>Cash {fmtTk(cash)}</span>
                  {vds > 0 && <span>+ VDS {fmtTk(vds)}</span>}
                  {tds > 0 && <span>+ TDS {fmtTk(tds)}</span>}
                  <span className={`ml-auto text-sm font-semibold ${overDue ? 'text-red-600' : 'text-gray-900'}`}>Settles {fmtTk(settled)}</span>
                  {invDue !== null && <span className="w-full text-gray-400">Invoice balance {fmtTk(invDue)}{overDue ? ' — reduce the amounts withheld' : ''}</span>}
                </div>
              )}
            </>
          ) : (
            <p className="text-xs text-gray-400">
              {!invoiceKey
                ? 'VDS / TDS withheld by the client can be recorded when the payment is linked to an invoice.'
                : 'VDS / TDS withholding is recorded on BDT invoices only.'}
            </p>
          )}

          {/* Note */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Note (optional — required if rejecting)</label>
            <textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
              placeholder="Add a note…"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none" />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2 justify-end px-4 sm:px-6 py-4 border-t border-gray-100 shrink-0">
          {problems[0] && (
            <p className="w-full sm:w-auto sm:mr-auto text-xs text-amber-700 flex items-center gap-1.5"><AlertCircle className="w-3.5 h-3.5 shrink-0" /> {problems[0]}</p>
          )}
          <button onClick={onClose} disabled={saving}
            className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
            Cancel
          </button>
          <button onClick={() => submit('reject')} disabled={saving}
            className="px-4 py-2 text-sm font-medium text-gray-700 border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-60 flex items-center gap-1.5">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            <XCircle className="w-4 h-4" /> Reject
          </button>
          <button onClick={() => submit('confirm')} disabled={saving || problems.length > 0}
            className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-60 flex items-center gap-1.5">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            <CheckCircle2 className="w-4 h-4" /> Confirm
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Request Edit Modal ───────────────────────────────────────────────────────

function RequestEditModal({ expense, onClose, onSubmitted }) {
  const [reason,  setReason]  = useState('')
  const [saving,  setSaving]  = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (!reason.trim()) { toast.error('Reason is required'); return }
    setSaving(true)
    try {
      const res  = await fetch('/api/edit-requests', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ itemType: 'PROJECT_EXPENSE', itemId: expense.id, reason: reason.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Edit request submitted. Waiting for owner approval.')
      onSubmitted && onSubmitted()
      onClose()
    } catch (err) {
      toast.error(err.message ?? 'Failed to submit request')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl border border-gray-200 w-full max-w-md p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">Request Edit Access</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <div className="rounded-lg bg-gray-50 border border-gray-100 px-4 py-3 space-y-1">
          <p className="text-sm font-semibold text-gray-900">{expense.title}</p>
          <p className="text-xs text-gray-500">{expense.category}{expense.subcategory ? ` / ${expense.subcategory}` : ''} · {fmtDate(expense.date)}</p>
          <p className="text-sm font-bold text-gray-900"><TkAmt value={expense.amount} decimals={2} /></p>
        </div>
        <p className="text-xs text-gray-500">
          This expense is <strong>{expense.status}</strong>. Editing is locked. Submit a request and the owner will generate a one-time OTP to grant you temporary edit access.
        </p>
        <form onSubmit={submit} className="space-y-3">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Reason for edit <span className="text-red-500">*</span></label>
            <textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              placeholder="Describe why this expense needs to be edited…"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none"
            />
          </div>
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={onClose} disabled={saving}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={saving}
              className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-60 flex items-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Submit Request
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── OTP Verify Modal ─────────────────────────────────────────────────────────

function OtpVerifyModal({ requestId, expenseId, onVerified, onClose }) {
  const [otp,     setOtp]     = useState('')
  const [saving,  setSaving]  = useState(false)
  const [errMsg,  setErrMsg]  = useState('')

  async function verify(e) {
    e.preventDefault()
    if (!otp.trim()) { setErrMsg('Enter the OTP'); return }
    setSaving(true)
    setErrMsg('')
    try {
      const res  = await fetch(`/api/edit-requests/${requestId}/verify`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ otp: otp.trim() }),
      })
      const json = await res.json()
      if (!res.ok || !json.valid) throw new Error(json.error ?? 'Invalid or expired OTP')
      toast.success('OTP verified — edit access granted')
      onVerified(expenseId)
      onClose()
    } catch (err) {
      setErrMsg(err.message ?? 'Invalid or expired OTP')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl border border-gray-200 w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">Enter OTP</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <p className="text-xs text-gray-500">Enter the 6-digit OTP provided by the owner to unlock edit access for this expense.</p>
        <form onSubmit={verify} className="space-y-3">
          <input
            value={otp}
            onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="6-digit OTP"
            maxLength={6}
            className="w-full border border-gray-200 rounded-lg px-3 py-2 text-center text-xl font-mono tracking-[0.4em] focus:outline-none focus:ring-2 focus:ring-gray-900"
          />
          {errMsg && <p className="text-xs text-red-500 text-center">{errMsg}</p>}
          <div className="flex gap-2 justify-end">
            <button type="button" onClick={onClose} disabled={saving}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
              Cancel
            </button>
            <button type="submit" disabled={saving || otp.length !== 6}
              className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-60 flex items-center gap-2">
              {saving && <Loader2 className="w-4 h-4 animate-spin" />}
              Verify OTP
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Calendar helpers ─────────────────────────────────────────────────────────

const MONTH_NAMES = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function getMonthLabel(offset = 0) {
  const d = new Date()
  d.setDate(1) // avoid rolling into the next month on the 29th–31st
  d.setMonth(d.getMonth() - offset)
  return `${MONTH_NAMES[d.getMonth()]} ${d.getFullYear()}`
}

function getDrillKey(offset = 0) {
  const d = new Date()
  d.setDate(1)
  d.setMonth(d.getMonth() - offset)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}

// ─── Calendar Drill-Down ──────────────────────────────────────────────────────

function CalendarDrillDown({ drillKey, onClose }) {
  const [data,    setData]    = useState(null)
  const [loading, setLoading] = useState(true)

  const [yr, mo] = drillKey.split('-').map(Number)
  const label      = `${MONTH_NAMES[mo - 1]} ${yr}`
  const daysInMonth = new Date(yr, mo, 0).getDate()

  const fmtAmt = (n) => n == null ? '—' : `BDT ${Number(n).toLocaleString('en-BD', { minimumFractionDigits: 0 })}`

  useEffect(() => {
    // Ignore responses for a month that's no longer selected (out-of-order replies)
    const ctrl = new AbortController()
    setLoading(true)
    fetch(`/api/dashboard/stats?drillMonth=${drillKey}`, { signal: ctrl.signal })
      .then(r => r.json())
      .then(j => { if (!ctrl.signal.aborted) { setData(j.data?.dailyData ?? []); setLoading(false) } })
      .catch(() => { if (!ctrl.signal.aborted) setLoading(false) })
    return () => ctrl.abort()
  }, [drillKey])

  return (
    <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <button onClick={onClose} className="p-1 rounded hover:bg-gray-100 transition-colors">
            <ChevronLeft className="w-4 h-4 text-gray-500" />
          </button>
          <h3 className="font-semibold text-gray-900">{label} — Daily Breakdown</h3>
        </div>
        <span className="text-xs text-gray-400">{daysInMonth} days</span>
      </div>

      {loading ? (
        <div className="flex justify-center py-12">
          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[600px]">
            <thead>
              <tr className="bg-gray-50/70 border-b border-gray-100">
                <th className="px-5 py-2.5 text-left text-xs font-medium text-gray-400 uppercase tracking-wide w-28">Day</th>
                <th className="px-5 py-2.5 text-right text-xs font-medium text-gray-400 uppercase tracking-wide">Income</th>
                <th className="px-5 py-2.5 text-right text-xs font-medium text-gray-400 uppercase tracking-wide">Expense</th>
                <th className="px-5 py-2.5 text-right text-xs font-medium text-gray-400 uppercase tracking-wide">Net Profit</th>
                <th className="px-5 py-2.5 text-right text-xs font-medium text-gray-400 uppercase tracking-wide">Transactions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {(data ?? []).map(row => {
                const hasActivity = row.txCount > 0
                return (
                  <tr key={row.day} className={`transition-colors ${hasActivity ? 'hover:bg-blue-50/30' : 'opacity-40'}`}>
                    <td className="px-5 py-2.5 font-medium text-gray-700">
                      {String(row.day).padStart(2, '0')}{' '}
                      <span className="text-gray-400 font-normal">{MONTH_NAMES[mo - 1].slice(0, 3)}</span>
                    </td>
                    <td className="px-5 py-2.5 text-right text-green-600 font-medium">
                      {row.income > 0 ? fmtAmt(row.income) : '—'}
                    </td>
                    <td className="px-5 py-2.5 text-right text-red-500">
                      {row.expense > 0 ? fmtAmt(row.expense) : '—'}
                    </td>
                    <td className={`px-5 py-2.5 text-right font-medium ${
                      row.profit > 0 ? 'text-gray-900' : row.profit < 0 ? 'text-red-500' : 'text-gray-300'
                    }`}>
                      {row.txCount > 0 ? fmtAmt(row.profit) : '—'}
                    </td>
                    <td className="px-5 py-2.5 text-right text-gray-400">
                      {row.txCount > 0 ? row.txCount : '—'}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ─── Owner OTP Display Modal ──────────────────────────────────────────────────

function OwnerOtpModal({ otp, requesterName, onClose }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl border border-gray-200 w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">Edit Request Approved</h3>
          <button onClick={onClose}><X className="w-5 h-5 text-gray-400" /></button>
        </div>
        <p className="text-sm text-gray-600">
          Share this OTP with <strong>{requesterName ?? 'the manager'}</strong>. It expires in 30 minutes and can only be used once.
        </p>
        <div className="rounded-xl bg-yellow-50 border-2 border-yellow-300 px-6 py-5 text-center">
          <p className="text-xs text-yellow-700 font-medium uppercase tracking-wide mb-2">One-Time Password</p>
          <p className="text-4xl font-mono font-bold tracking-[0.3em] text-yellow-900">{otp}</p>
          <p className="text-xs text-yellow-600 mt-2">Valid for 30 minutes</p>
        </div>
        <button onClick={onClose}
          className="w-full px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 transition-colors">
          Done
        </button>
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

// ─── Ledger row breakdown (Transactions tab expander) ─────────────────────────

const CLEAR_LABELS = { UNCLEARED: 'Not yet cleared', CLEARED: 'Cleared', RECONCILED: 'Reconciled' }

function TxBreakdown({ tx, nonPl, plVal, cashBDT }) {
  const t = tx.tax ?? null
  const kind = tx.kind || 'OPERATING'
  const isIncome = tx.type === 'INCOME'
  const foreign = (tx.currency || BASE_CURRENCY) !== BASE_CURRENCY
  const rows = []
  rows.push(['Cash moved', `${formatCurrency(tx.amount, tx.currency)}${foreign && cashBDT !== null ? ` ≈ ${fmtTk(cashBDT)}` : ''}`])
  if (tx.accountAmount !== null && tx.accountAmount !== undefined && tx.accountId?.currency && tx.accountId.currency !== (tx.currency || BASE_CURRENCY)) {
    rows.push(['In account currency', formatMoney(tx.accountAmount, tx.accountId.currency)])
  }
  // A non-cash INCOME 'Depreciation' row is depreciation written back on an asset disposal:
  // the P&L reports it as a reduction of the depreciation expense (accounts/_lib/pl.js plEffect).
  const writeBack = isIncome && !tx.reversalOf && kind === 'NON_CASH' && ['Depreciation', 'Asset Impairment', 'Amortisation', 'Amortization'].includes(tx.category)
  rows.push(['Profit & loss', nonPl
    ? `Not counted (${KIND_LABELS[kind] ?? kind})`
    : writeBack
      ? `${tx.category} written back ${fmtTk(plVal ?? cashBDT ?? 0)} · reduces that expense (non-cash)`
      : `${isIncome ? 'Income' : 'Expense'} ${fmtTk(plVal ?? cashBDT ?? 0)}${kind === 'NON_CASH' ? ' · non-cash' : ''}`])
  if (t) {
    if (toNum(t.grossBDT) > 0) rows.push([isIncome ? 'Gross settled' : 'Gross bill', fmtTk(t.grossBDT)])
    if (toNum(t.vatBDT) > 0)   rows.push([isIncome ? 'VAT in receipt (liability)' : 'VAT in bill', fmtTk(t.vatBDT)])
    if (toNum(t.sdBDT) > 0)    rows.push(['Supplementary duty', fmtTk(t.sdBDT)])
    if (toNum(t.vdsBDT) > 0)   rows.push([isIncome ? 'VDS withheld by client' : 'VDS we withheld', fmtTk(t.vdsBDT)])
    if (toNum(t.tdsBDT) > 0)   rows.push([isIncome ? 'TDS / AIT withheld by client' : 'TDS we withheld', fmtTk(t.tdsBDT)])
    if (!isIncome && toNum(t.vatBDT) > 0 && t.inputVatCreditable !== null && t.inputVatCreditable !== undefined) {
      rows.push(['Input VAT credit', t.inputVatCreditable ? 'Claimable' : 'Not claimable (charged to expense)'])
    }
    if (t.taxDeductible === false) rows.push(['Income tax', 'Not deductible (cash payment rule)'])
  }
  if (tx.channel) rows.push(['Channel', `${PAYMENT_CHANNEL_LABELS[tx.channel] ?? tx.channel}${tx.cheque?.no ? ` · cheque ${tx.cheque.no}` : ''}`])
  if (tx.accountId) rows.push(['Bank status', `${CLEAR_LABELS[tx.clearStatus] ?? 'Not yet cleared'}${tx.clearedDate ? ` · ${fmtDate(tx.clearedDate)}` : ''}`])
  if (tx.transferId) rows.push(['Transfer', tx.counterAccountId?.name ? `${isIncome ? 'From' : 'To'} ${tx.counterAccountId.name}` : 'Between own accounts'])
  if (tx.reversalOf) rows.push(['Reversal', 'Cancels an earlier entry'])
  return (
    <dl className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-2">
      {rows.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-[11px] uppercase tracking-wide text-gray-400">{label}</dt>
          <dd className="text-xs text-gray-700 break-words">{value}</dd>
        </div>
      ))}
    </dl>
  )
}

// ─── Funds & tax position (overview) ──────────────────────────────────────────

const FUND_GROUPS = [
  { key: 'bank',  label: 'Bank' },
  { key: 'cash',  label: 'Cash' },
  { key: 'mfs',   label: 'Mobile wallets' },
  { key: 'other', label: 'Other' },
]

const ACCOUNT_PICKER_PERMS = [
  'finance.accounts.view', 'finance.accounts.manage', 'finance.payments.confirm',
  'finance.transactions.create', 'finance.transactions.view',
]

/** Funds from the account-picker options when the summary is unavailable. */
function fundsFromOptions(accounts) {
  const byGroup = { bank: 0, cash: 0, mfs: 0, other: 0 }
  const foreign = {}
  let totalBDT = 0
  const list = accounts.map(a => {
    const group = accountTypeGroup(a.type)
    const balance = toNum(a.balance)
    if ((a.currency || BASE_CURRENCY) === BASE_CURRENCY) { totalBDT += balance; byGroup[group] += balance }
    else foreign[a.currency] = (foreign[a.currency] ?? 0) + balance
    return { ...a, group, balance }
  })
  return {
    asOf: null,
    count: list.length,
    totalBDT: round2(totalBDT),
    byGroup: Object.fromEntries(Object.entries(byGroup).map(([k, v]) => [k, round2(v)])),
    foreign: Object.entries(foreign).map(([currency, balance]) => ({ currency, balance: round2(balance) })),
    accounts: list,
  }
}

function FundsTaxStrip({ funds, taxPosition, session }) {
  const canPickAccounts = canDoAny(session, ACCOUNT_PICKER_PERMS)
  const { accounts: optionAccounts, loading: optLoading } = useMoneyAccounts()
  const canManageAccounts = canDoAny(session, ['finance.accounts.view', 'finance.accounts.manage'])
  const canSeeTax = canDoAny(session, ['tax.view', 'tax.manage'])

  // The summary's funds follow the overview period; the picker's options are a fallback.
  const data = funds ?? (canPickAccounts && optionAccounts.length ? fundsFromOptions(optionAccounts) : null)
  const showFunds = !!funds || canPickAccounts
  const showTax = !!taxPosition
  if (!showFunds && !showTax) return null

  const money = (amount, currency) => ((currency || BASE_CURRENCY) === BASE_CURRENCY ? fmtTk(amount) : formatMoney(amount, currency))
  const tp = taxPosition ?? {}
  const taxRows = [
    { key: 'tdsDep',  label: 'TDS to deposit',            v: tp.tdsToDeposit,           overdue: tp.tdsToDeposit?.overdueCount ? `${tp.tdsToDeposit.overdueCount} overdue` : null },
    { key: 'vdsDep',  label: 'VDS to deposit',            v: tp.vdsToDeposit },
    { key: 'vdsIss',  label: 'Mushak-6.6 to issue',       v: tp.vdsCertificatesToIssue },
    { key: 'tdsIss',  label: 'TDS certificates to issue', v: tp.tdsCertificatesToIssue },
    { key: 'vdsCol',  label: 'VDS certificates to collect', v: tp.vdsCertificatesPending },
    { key: 'tdsCol',  label: 'AIT certificates to collect', v: tp.tdsCertificatesPending },
    { key: 'itc',     label: 'Unclaimed input VAT',       v: tp.inputVatUnclaimed },
  ].filter(r => toNum(r.v?.count) > 0)

  return (
    <div className={`grid grid-cols-1 gap-4 ${showFunds && showTax ? 'lg:grid-cols-3' : ''}`}>
      {showFunds && (
        <div className={`bg-white border border-gray-100 rounded-xl p-5 min-w-0 ${showTax ? 'lg:col-span-2' : ''}`}>
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="flex items-center gap-3 min-w-0">
              <div className="w-9 h-9 rounded-lg bg-emerald-50 flex items-center justify-center shrink-0">
                <Landmark className="w-4 h-4 text-emerald-600" />
              </div>
              <div className="min-w-0">
                <h3 className="text-sm font-semibold text-gray-900">Funds</h3>
                <p className="text-xs text-gray-400">
                  {data?.asOf ? `Balances at the end of ${fmtDate(data.asOf)}` : 'Current balances'} across bank, cash and wallets
                </p>
              </div>
            </div>
            <div className="text-right shrink-0">
              {data && data.count > 0 && <p className="text-lg font-bold text-gray-900">{fmtTk(data.totalBDT)}</p>}
              {canManageAccounts && (
                <Link href="/admin/finance/accounts" className="text-xs text-blue-600 hover:underline inline-flex items-center gap-0.5">
                  Money accounts <ChevronRight className="w-3 h-3" />
                </Link>
              )}
            </div>
          </div>

          {!data ? (
            optLoading && canPickAccounts ? (
              <p className="text-xs text-gray-400 flex items-center gap-1.5"><Loader2 className="w-3 h-3 animate-spin" /> Loading balances…</p>
            ) : (
              <p className="text-sm text-gray-500">No money accounts yet. Add your bank, cash and mobile-wallet accounts to track balances and post every payment to an account.</p>
            )
          ) : data.count === 0 ? (
            <p className="text-sm text-gray-500">No money accounts yet. Add your bank, cash and mobile-wallet accounts to track balances and post every payment to an account.</p>
          ) : (
            <>
              <div className="flex flex-wrap gap-2 mb-3">
                {FUND_GROUPS.filter(g => g.key !== 'other' || toNum(data.byGroup?.other) !== 0).map(g => (
                  <span key={g.key} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-50 border border-gray-100 px-2.5 py-1 text-xs">
                    <span className="text-gray-500">{g.label}</span>
                    <span className={`font-semibold ${toNum(data.byGroup?.[g.key]) < 0 ? 'text-red-600' : 'text-gray-900'}`}>{fmtTk(data.byGroup?.[g.key])}</span>
                  </span>
                ))}
                {(data.foreign ?? []).map(f => (
                  <span key={f.currency} className="inline-flex items-center gap-1.5 rounded-lg bg-amber-50 border border-amber-100 px-2.5 py-1 text-xs">
                    <span className="text-amber-700">{f.currency}</span>
                    <span className="font-semibold text-amber-900">{formatMoney(f.balance, f.currency)}</span>
                  </span>
                ))}
              </div>
              <div className="flex gap-3 overflow-x-auto pb-1 -mx-1 px-1">
                {data.accounts.map(a => (
                  <div key={a.id} className="min-w-[170px] max-w-[220px] shrink-0 rounded-lg border border-gray-100 px-3 py-2.5">
                    <p className="text-xs font-medium text-gray-900 truncate" title={a.name}>{a.name}</p>
                    <p className="text-[11px] text-gray-400 truncate">
                      {accountTypeLabel(a.type)}{a.last4 ? ` ••${a.last4}` : ''}{a.currency && a.currency !== BASE_CURRENCY ? ` · ${a.currency}` : ''}
                    </p>
                    <p className={`text-sm font-semibold mt-1 ${toNum(a.balance) < 0 ? 'text-red-600' : 'text-gray-900'}`}>{money(a.balance, a.currency)}</p>
                    {toNum(a.unclearedCount) > 0 && (
                      <p className="text-[10px] text-gray-400">{a.unclearedCount} uncleared</p>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {showTax && (
        <div className="bg-white border border-gray-100 rounded-xl p-5 min-w-0">
          <div className="flex items-start justify-between gap-3 mb-4">
            <div className="flex items-center gap-3">
              <div className="w-9 h-9 rounded-lg bg-rose-50 flex items-center justify-center shrink-0">
                <Calculator className="w-4 h-4 text-rose-600" />
              </div>
              <div>
                <h3 className="text-sm font-semibold text-gray-900">Tax position</h3>
                <p className="text-xs text-gray-400">Open VAT / VDS / TDS items</p>
              </div>
            </div>
            {canSeeTax && (
              <Link href="/admin/tax" className="text-xs text-blue-600 hover:underline inline-flex items-center gap-0.5 shrink-0">
                Tax dashboard <ChevronRight className="w-3 h-3" />
              </Link>
            )}
          </div>
          {taxRows.length === 0 ? (
            <p className="text-sm text-gray-500">No open tax items — nothing to deposit, issue or collect.</p>
          ) : (
            <ul className="divide-y divide-gray-50">
              {taxRows.map(r => (
                <li key={r.key} className="flex items-center justify-between gap-3 py-2 text-xs">
                  <span className="text-gray-600 min-w-0">
                    {r.label} <span className="text-gray-400">({r.v.count})</span>
                    {r.overdue && <span className="ml-1.5 inline-flex px-1.5 py-0.5 rounded bg-red-50 text-red-600 text-[10px] font-medium">{r.overdue}</span>}
                  </span>
                  <span className="font-semibold text-gray-900 whitespace-nowrap">{fmtTk(r.v.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Trend Pill ───────────────────────────────────────────────────────────────

function TrendPill({ change, invert = false }) {
  if (change == null) return null
  const positive = invert ? change < 0 : change > 0
  const neutral  = change === 0
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium px-1.5 py-0.5 rounded-full ${
      neutral  ? 'bg-gray-100 text-gray-500' :
      positive ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-500'
    }`}>
      {!neutral && (positive
        ? <ArrowUpRight className="w-3 h-3" />
        : <ArrowDownRight className="w-3 h-3" />)}
      {neutral ? 'No change' : `${Math.abs(change)}%`}
    </span>
  )
}


function AccountsContent() {
  const { paymentMethods, expenseCategories, incomeCategories } = useConfig()
  const fmtMethod = v => v ? (paymentMethods.find(m => m.value === v)?.label ?? v.replace(/_/g, ' ')) : '—'
  const { data: session }  = useSession()
  const searchParams       = useSearchParams()
  const activeTab          = searchParams.get('tab') || 'overview'
  // Money accounts (names for ledger rows whose account is not populated, and the filter).
  const { accounts: moneyAccountOptions } = useMoneyAccounts()
  const [summary,    setSummary]    = useState(null)
  const [dashStats,  setDashStats]  = useState(null)
  const [drillKey,   setDrillKey]   = useState(null)
  const [txList,     setTxList]     = useState([])
  const [txMeta,     setTxMeta]     = useState({ page: 1, pages: 1, total: 0 })
  const [plReport,   setPlReport]   = useState(null)
  const [loading,    setLoading]    = useState(true)
  const [txLoading,  setTxLoading]  = useState(false)
  const [plLoading,  setPlLoading]  = useState(false)
  const [modalOpen,  setModalOpen]  = useState(false)
  const [editingTx,  setEditingTx]  = useState(null)

  // Payment requests (expense-based)
  const [prList,      setPrList]      = useState([])
  const [prMeta,      setPrMeta]      = useState({ page: 1, pages: 1, total: 0 })
  const [prLoading,   setPrLoading]   = useState(false)
  const [prPage,      setPrPage]      = useState(1)
  const [prStatus,    setPrStatus]    = useState('PENDING')
  const [prCategory,    setPrCategory]    = useState('')
  const [prSubcategory, setPrSubcategory] = useState('')
  const [prStart,       setPrStart]       = useState('')
  const [prEnd,         setPrEnd]         = useState('')
  const [prPreset,      setPrPreset]      = useState('')      // '', today, yesterday, 7d, month
  const [prSelected,    setPrSelected]    = useState([])      // paid expense ids selected for batch authorize
  const [batchAuthorizing, setBatchAuthorizing] = useState(false)
  const [payingPr,      setPayingPr]      = useState(null)    // PENDING → record payment (PaymentModal)
  const [authorizingPr, setAuthorizingPr] = useState(null)    // PAID → authorize (AuthorizeModal)
  const [reversingPr,   setReversingPr]   = useState(null)    // PAID / AUTHORIZED → reverse the payment (ReversePaymentModal)
  const [detailPr,      setDetailPr]      = useState(null)    // row → read-only detail preview

  // Payment confirmations (project client payments)
  const [pcList,      setPcList]      = useState([])
  const [pcMeta,      setPcMeta]      = useState({ page: 1, pages: 1, total: 0 })
  const [pcLoading,   setPcLoading]   = useState(false)
  const [pcPage,      setPcPage]      = useState(1)
  const [pcStatus,    setPcStatus]    = useState('PENDING_CONFIRMATION')
  const [confirmingPc, setConfirmingPc] = useState(null)
  const [reversingPc,  setReversingPc]  = useState(null)   // CONFIRMED → reverse the client payment
  const [reversingTx,  setReversingTx]  = useState(null)   // invoice receipt in the ledger → reverse it

  // Withdrawals tab
  const [wdList,       setWdList]       = useState([])
  const [wdLoading,    setWdLoading]    = useState(false)
  const [wdStatus,     setWdStatus]     = useState('')
  const [approvingWd,  setApprovingWd]  = useState(null)
  const [rejectingWd,  setRejectingWd]  = useState(null)
  const [wdNote,       setWdNote]       = useState('')
  const [wdApproveNote, setWdApproveNote] = useState('')
  const [wdApproveModal, setWdApproveModal] = useState(null)

  // OTP edit-lock system
  const [editRequestModal, setEditRequestModal] = useState(null)   // expense object
  const [otpModal,         setOtpModal]         = useState(null)   // { requestId, expenseId }
  const [editUnlocked,     setEditUnlocked]     = useState(new Set())
  const [editRequests,     setEditRequests]     = useState([])     // pending edit requests (owner view)
  const [ownerOtpModal,    setOwnerOtpModal]    = useState(null)   // { otp, requesterName }
  const [erLoading,        setErLoading]        = useState(false)
  const [rejectingEr,      setRejectingEr]      = useState(null)   // edit request being rejected
  const [rejectNote,       setRejectNote]       = useState('')

  // Filters
  const [txType,    setTxType]    = useState('')
  const [txCategory, setTxCategory] = useState('')
  const [txSubcategory, setTxSubcategory] = useState('')
  const [txAccount, setTxAccount] = useState('')
  const [txKind,    setTxKind]    = useState('')
  const [txExpanded, setTxExpanded] = useState(null)   // id of the row showing its tax / P&L breakdown
  const [txPage,    setTxPage]    = useState(1)
  const [period,    setPeriod]    = useState('month')
  const [startDate, setStartDate] = useState(() => {
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  })
  const [endDate,   setEndDate]   = useState(() => ymdLocal(new Date()))
  const [plStart,   setPlStart]   = useState(() => `${new Date().getFullYear()}-01-01`)
  const [plEnd,     setPlEnd]     = useState(() => ymdLocal(new Date()))

// ── Loaders ──────────────────────────────────────────────────────────────

  const loadSummary = useCallback(async () => {
    if (!session) return
    // Company-wide summary needs finance.overview.view; without it the overview
    // still shows the dashboard KPI cards, just not the summary.
    if (!canDo(session, 'finance.overview.view')) { setLoading(false); return }
    try {
      const params = new URLSearchParams()
      if (startDate) params.set('startDate', startDate)
      if (endDate)   params.set('endDate',   endDate)
      const res  = await fetch(`/api/accounts/summary?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setSummary(json.data)
    } catch (err) {
      toast.error(err.message ?? 'Failed to load summary')
    } finally {
      setLoading(false)
    }
  }, [startDate, endDate, session])

  const loadTransactions = useCallback(async () => {
    setTxLoading(true)
    try {
      const params = new URLSearchParams({ page: txPage, limit: 20 })
      if (txType)    params.set('type',      txType)
      if (txCategory) params.set('category', txCategory)
      if (txSubcategory) params.set('subcategory', txSubcategory)
      if (txAccount) params.set('accountId', txAccount)
      if (txKind)    params.set('kind', txKind)
      if (startDate) params.set('startDate', startDate)
      if (endDate)   params.set('endDate',   endDate)
      const res  = await fetch(`/api/transactions?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setTxList(json.data ?? [])
      setTxMeta(json.meta ?? { page: 1, pages: 1, total: 0 })
      setTxExpanded(null)
    } catch (err) {
      toast.error(err.message ?? 'Failed to load transactions')
    } finally {
      setTxLoading(false)
    }
  }, [txPage, txType, txCategory, txSubcategory, txAccount, txKind, startDate, endDate])

  const loadPL = useCallback(async () => {
    setPlLoading(true)
    try {
      const params = new URLSearchParams()
      if (plStart) params.set('startDate', plStart)
      if (plEnd)   params.set('endDate',   plEnd)
      const res  = await fetch(`/api/accounts/pl-report?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setPlReport(json.data)
    } catch (err) {
      toast.error(err.message ?? 'Failed to load P&L')
    } finally {
      setPlLoading(false)
    }
  }, [plStart, plEnd])

  const loadPaymentRequests = useCallback(async () => {
    setPrLoading(true)
    try {
      const params = new URLSearchParams({ page: prPage, limit: 20 })
      if (prStatus)      params.set('status', prStatus)
      if (prCategory)    params.set('category', prCategory)
      if (prSubcategory) params.set('subcategory', prSubcategory)
      if (prStart)       params.set('startDate', prStart)
      if (prEnd)         params.set('endDate', prEnd)
      const res  = await fetch(`/api/expenses?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setPrList(json.data ?? [])
      setPrMeta(json.meta ?? { page: 1, pages: 1, total: 0 })
      setPrSelected([])
    } catch (err) {
      toast.error(err.message ?? 'Failed to load payment requests')
    } finally {
      setPrLoading(false)
    }
  }, [prPage, prStatus, prCategory, prSubcategory, prStart, prEnd])

  const loadPaymentConfirmations = useCallback(async () => {
    setPcLoading(true)
    try {
      const params = new URLSearchParams({ page: pcPage, limit: 20 })
      if (pcStatus) params.set('status', pcStatus)
      const res  = await fetch(`/api/project-payments?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setPcList(json.data ?? [])
      setPcMeta(json.meta ?? { page: 1, pages: 1, total: 0 })
    } catch (err) {
      toast.error(err.message ?? 'Failed to load payment confirmations')
    } finally {
      setPcLoading(false)
    }
  }, [pcPage, pcStatus])

  const loadEditRequests = useCallback(async () => {
    setErLoading(true)
    try {
      const res  = await fetch('/api/edit-requests')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setEditRequests(json.data ?? [])
    } catch (err) {
      console.error('Failed to load edit requests', err)
    } finally {
      setErLoading(false)
    }
  }, [])

  const loadWithdrawals = useCallback(async () => {
    setWdLoading(true)
    try {
      const url = wdStatus ? `/api/admin/withdrawal-requests?status=${wdStatus}` : '/api/admin/withdrawal-requests'
      const res  = await fetch(url)
      const json = await res.json()
      if (res.ok) setWdList(json.data ?? [])
    } catch { /* silent */ }
    finally { setWdLoading(false) }
  }, [wdStatus])

  useEffect(() => { if (activeTab === 'overview') loadSummary() },             [activeTab, loadSummary])
  useEffect(() => {
    if (activeTab === 'overview') {
      fetch('/api/dashboard/stats')
        .then(r => r.json())
        .then(j => { if (j.data) setDashStats(j.data) })
        .catch(() => {})
    }
  }, [activeTab])
  useEffect(() => { if (activeTab === 'transactions')  loadTransactions()         }, [activeTab, loadTransactions])
  useEffect(() => { if (activeTab === 'confirmations') loadPaymentConfirmations() }, [activeTab, loadPaymentConfirmations])
  // The Pending Edit Requests panel lives on the requests tab. The withdrawals tab is a
  // static notice (the /api/admin/withdrawal-requests route was removed), so nothing loads there.
  useEffect(() => { if (activeTab === 'requests')      { loadPaymentRequests(); loadEditRequests() } }, [activeTab, loadPaymentRequests, loadEditRequests])
  useEffect(() => { if (activeTab === 'pl')            loadPL()                   }, [activeTab, loadPL])


  async function handleApproveWithdrawal(wd) {
    setApprovingWd(wd.id ?? wd._id)
    try {
      const res  = await fetch(`/api/admin/withdrawal-requests/${wd.id ?? wd._id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'approve', adminNote: wdApproveNote || undefined }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Withdrawal approved')
      setWdApproveModal(null)
      setWdApproveNote('')
      loadWithdrawals()
      loadSummary()
    } catch (err) { toast.error(err.message) }
    finally { setApprovingWd(null) }
  }

  async function handleRejectWithdrawal(wdId) {
    setRejectingWd(wdId)
    try {
      const res  = await fetch(`/api/admin/withdrawal-requests/${wdId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'reject', adminNote: wdNote || undefined }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Withdrawal rejected')
      setWdNote('')
      loadWithdrawals()
    } catch (err) { toast.error(err.message) }
    finally { setRejectingWd(null) }
  }

  // ── Actions ───────────────────────────────────────────────────────────────

  async function handleApproveEditRequest(er) {
    try {
      const res  = await fetch(`/api/edit-requests/${er.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'APPROVE' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setOwnerOtpModal({ otp: json.data.otp, requesterName: er.requesterId?.name })
      loadEditRequests()
    } catch (err) {
      toast.error(err.message ?? 'Failed to approve edit request')
    }
  }

  async function handleRejectEditRequest(er, note) {
    try {
      const res  = await fetch(`/api/edit-requests/${er.id}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'REJECT', reviewNote: note }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Edit request rejected')
      setRejectingEr(null)
      setRejectNote('')
      loadEditRequests()
    } catch (err) {
      toast.error(err.message ?? 'Failed to reject edit request')
    }
  }

  function handleSaved(meta = {}) {
    if (meta.expenseRequest) {
      toast.success('Expense request submitted — review it in the Requests tab')
      loadPaymentRequests()
    } else {
      toast.success(editingTx ? 'Transaction updated' : 'Transaction added')
    }
    setEditingTx(null)
    loadSummary()
    loadTransactions()
  }

  // ── Spinner ───────────────────────────────────────────────────────────────

  const Spinner = () => (
    <div className="flex items-center justify-center h-40">
      <div className="w-7 h-7 border-2 border-gray-300 border-t-gray-700 rounded-full animate-spin" />
    </div>
  )

  // ── Render ────────────────────────────────────────────────────────────────

  const tabBtnCls = (t) =>
    `px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
      activeTab === t
        ? 'bg-gray-900 text-white border-gray-900'
        : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400 hover:text-gray-800'
    }`

  // Nested taxonomy — subcategory options follow the chosen parent category
  const txCatGroups = txType === 'INCOME'
    ? incomeCategories
    : txType === 'EXPENSE'
      ? expenseCategories
      : [...incomeCategories, ...expenseCategories]
  const txCategoryOptions = [...new Set(txCatGroups.map(c => c.label))]
  const txSubcategoryOptions = txCategory
    ? (txCatGroups.find(c => c.label === txCategory)?.subcategories ?? [])
    : [...new Set(txCatGroups.flatMap(c => c.subcategories ?? []))]

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Accounts</h1>
          <p className="text-sm text-gray-400 mt-0.5">Track income, expenses and financial health</p>
        </div>
        {(activeTab === 'overview' || activeTab === 'transactions') && canDo(session, 'finance.transactions.create') && (
          <button
            onClick={() => { setEditingTx(null); setModalOpen(true) }}
            className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 transition-colors"
          >
            <Plus className="w-4 h-4" /> Add Transaction
          </button>
        )}
      </div>

      {/* ── OVERVIEW tab ── */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Date range selector */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-gray-500 font-medium">Period</span>
            <DatePicker value={startDate || null} onChange={v => setStartDate(v ?? '')} />
            <span className="text-gray-400 text-sm">to</span>
            <DatePicker value={endDate || null} onChange={v => setEndDate(v ?? '')} />
            {(startDate || endDate) && (
              <button
                onClick={() => { setStartDate(''); setEndDate('') }}
                className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5 rounded hover:bg-gray-100 transition-colors"
              >
                Clear
              </button>
            )}
          </div>

          {loading ? <Spinner /> : (summary || dashStats) ? (
            <>
              {(() => {
                const f = dashStats?.financials ?? {}
                const fmtVal = (n) => n == null ? '—' : `BDT ${Number(n).toLocaleString('en-BD', { minimumFractionDigits: 0 })}`
                const CARDS = [
                  { label: 'Monthly Income',  value: fmtVal(f.income?.value),  prev: `vs ${fmtVal(f.income?.prevValue)} last month`,  change: f.income?.change,  icon: TrendingUp,   bg: 'bg-green-50',  color: 'text-green-600' },
                  { label: 'Monthly Expense', value: fmtVal(f.expense?.value), prev: `vs ${fmtVal(f.expense?.prevValue)} last month`, change: f.expense?.change, invert: true, icon: TrendingDown, bg: 'bg-red-50',    color: 'text-red-500' },
                  { label: 'Net Profit',      value: fmtVal(f.profit?.value),  prev: `vs ${fmtVal(f.profit?.prevValue)} last month`,  change: f.profit?.change,  icon: Wallet,   bg: 'bg-blue-50',   color: 'text-blue-600' },
                  { label: 'Gross Margin',    value: `${f.grossMargin?.value ?? 0}%`,  prev: `was ${f.grossMargin?.prevValue ?? 0}% last month`,  change: f.grossMargin?.value  != null && f.grossMargin?.prevValue  != null ? (f.grossMargin.value  - f.grossMargin.prevValue)  : null, icon: Percent,      bg: 'bg-purple-50', color: 'text-purple-600' },
                  { label: 'Expense Ratio',   value: `${f.expenseRatio?.value ?? 0}%`, prev: `was ${f.expenseRatio?.prevValue ?? 0}% last month`, change: f.expenseRatio?.value != null && f.expenseRatio?.prevValue != null ? (f.expenseRatio.value - f.expenseRatio.prevValue) : null, invert: true, icon: BarChart2, bg: 'bg-orange-50', color: 'text-orange-500' },
                  { label: 'Transactions',    value: f.transactions?.value ?? 0,       prev: `${f.transactions?.prevValue ?? 0} last month`,      change: f.transactions?.change,  icon: FileTextIcon, bg: 'bg-indigo-50', color: 'text-indigo-600' },
                ]
                const monthOptions = Array.from({ length: 6 }, (_, i) => ({ key: getDrillKey(i), label: getMonthLabel(i) }))
                return (
                  <>
                    <FundsTaxStrip funds={summary?.funds ?? null} taxPosition={summary?.taxPosition ?? null} session={session} />

                    <div className="grid grid-cols-2 xl:grid-cols-3 gap-4">
                      {CARDS.map(card => {
                        const Icon = card.icon
                        return (
                          <div key={card.label} className="bg-white border border-gray-100 rounded-xl p-5">
                            <div className="flex items-start justify-between mb-3">
                              <div className={`w-9 h-9 rounded-lg ${card.bg} flex items-center justify-center`}>
                                <Icon className={`w-4 h-4 ${card.color}`} />
                              </div>
                              <TrendPill change={card.change} invert={card.invert} />
                            </div>
                            <p className="text-xl font-bold text-gray-900">{card.value}</p>
                            <p className="text-sm font-medium text-gray-600 mt-0.5">{card.label}</p>
                            <p className="text-xs text-gray-400 mt-1">{card.prev}</p>
                          </div>
                        )
                      })}
                    </div>
                    <p className="text-xs text-gray-400 -mt-2 flex items-start gap-1.5">
                      <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                      Income and expense are profit-and-loss figures: client receipts count net of VAT, depreciation counts as an expense,
                      and transfers, capital, loans, tax deposits and asset purchases are left out.
                    </p>

                    {/* Cash movements in the period that are not income or expense */}
                    {summary?.nonPlMovements?.length > 0 && (
                      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
                        <div className="px-5 py-3 border-b border-gray-100 flex items-center gap-2">
                          <ArrowLeftRight className="w-4 h-4 text-gray-400" />
                          <div>
                            <h3 className="text-sm font-semibold text-gray-900">Other money movements</h3>
                            <p className="text-xs text-gray-400 mt-0.5">In the selected period — they change balances but not profit.</p>
                          </div>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[480px]">
                            <thead>
                              <tr className="border-b border-gray-100 bg-gray-50">
                                {['Kind', 'Entries', 'Money in', 'Money out'].map(h => (
                                  <th key={h} className="px-5 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                              {summary.nonPlMovements.map(m => (
                                <tr key={m.kind} className="hover:bg-gray-50/50">
                                  <td className="px-5 py-2.5 text-sm font-medium text-gray-900">{m.label}</td>
                                  <td className="px-5 py-2.5 text-sm text-gray-600">{m.count}</td>
                                  <td className="px-5 py-2.5 text-sm text-gray-700">{m.inflow ? fmt(m.inflow) : '—'}</td>
                                  <td className="px-5 py-2.5 text-sm text-gray-700">{m.outflow ? fmt(m.outflow) : '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    {/* By-currency breakdown — original totals + their BDT-equivalent */}
                    {summary?.currencyBreakdown?.length > 0 && (
                      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
                        <div className="px-5 py-3 border-b border-gray-100">
                          <h3 className="text-sm font-semibold text-gray-900">By currency</h3>
                          <p className="text-xs text-gray-400 mt-0.5">All metrics above roll up in BDT. This shows the original currencies behind them.</p>
                        </div>
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[640px]">
                            <thead>
                              <tr className="border-b border-gray-100 bg-gray-50">
                                {['Currency', 'Transactions', 'Income (orig.)', 'Expense (orig.)', 'Income (BDT)', 'Expense (BDT)'].map(h => (
                                  <th key={h} className="px-5 py-2.5 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide whitespace-nowrap">{h}</th>
                                ))}
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-gray-50">
                              {summary.currencyBreakdown.map(c => (
                                <tr key={c.currency} className="hover:bg-gray-50/50">
                                  <td className="px-5 py-2.5 text-sm font-medium text-gray-900">{c.currency}</td>
                                  <td className="px-5 py-2.5 text-sm text-gray-600">{c.count}</td>
                                  <td className="px-5 py-2.5 text-sm text-gray-700">{c.incomeOriginal ? formatCurrency(c.incomeOriginal, c.currency) : '—'}</td>
                                  <td className="px-5 py-2.5 text-sm text-gray-700">{c.expenseOriginal ? formatCurrency(c.expenseOriginal, c.currency) : '—'}</td>
                                  <td className="px-5 py-2.5 text-sm text-green-600">{c.incomeBDT ? fmt(c.incomeBDT) : '—'}</td>
                                  <td className="px-5 py-2.5 text-sm text-red-500">{c.expenseBDT ? fmt(c.expenseBDT) : '—'}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}

                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-xs text-gray-400 mr-1">Drill down by month:</span>
                      {monthOptions.map(m => (
                        <button key={m.key} onClick={() => setDrillKey(prev => prev === m.key ? null : m.key)} className={tabBtnCls(drillKey === m.key ? 'overview' : '__none__')}>
                          {m.label}
                        </button>
                      ))}
                    </div>
                    {drillKey && <CalendarDrillDown drillKey={drillKey} onClose={() => setDrillKey(null)} />}
                  </>
                )
              })()}
            </>
          ) : null}
        </div>
      )}

      {/* ── TRANSACTIONS tab ── */}
      {activeTab === 'transactions' && (
        <div className="space-y-4">
          {/* Filters */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-gray-500 font-medium">Period</span>
            <DatePicker value={startDate || null} onChange={v => { setStartDate(v ?? ''); setTxPage(1) }} />
            <span className="text-gray-400 text-sm">to</span>
            <DatePicker value={endDate || null} onChange={v => { setEndDate(v ?? ''); setTxPage(1) }} />
            {(startDate || endDate) && (
              <button onClick={() => { setStartDate(''); setEndDate(''); setTxPage(1) }} className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5 rounded hover:bg-gray-100 transition-colors">Clear</button>
            )}
            <div className="w-48">
              <Select
                value={txCategory}
                onChange={v => { setTxCategory(v ?? ''); setTxSubcategory(''); setTxPage(1) }}
                options={txCategoryOptions.map(c => ({ value: c, label: c }))}
                placeholder="All categories"
              />
            </div>
            <div className="w-48">
              <Select
                value={txSubcategory}
                onChange={v => { setTxSubcategory(v ?? ''); setTxPage(1) }}
                options={txSubcategoryOptions.map(c => ({ value: c, label: c }))}
                placeholder="All subcategories"
                disabled={txSubcategoryOptions.length === 0}
              />
            </div>
            <div className="w-full sm:w-56">
              <PlainAccountSelect
                value={txAccount || null}
                onChange={v => { setTxAccount(v ?? ''); setTxPage(1) }}
                placeholder="All accounts"
                showBalance={false}
                size="sm"
                extraOptions={[{ value: 'none', label: 'No account (older entries)' }]}
              />
            </div>
            <div className="w-full sm:w-44">
              <select value={txKind} onChange={e => { setTxKind(e.target.value); setTxPage(1) }}
                className="w-full border border-gray-200 rounded-lg px-3 py-1.5 text-xs bg-white focus:outline-none focus:ring-2 focus:ring-gray-900">
                <option value="">All kinds</option>
                <option value={PL_KINDS.join(',')}>In P&amp;L (operating + non-cash)</option>
                <option value={NON_PL_KINDS.join(',')}>Not in P&amp;L (all)</option>
                {KIND_OPTIONS.map(k => <option key={k.value} value={k.value}>{k.label}{PL_KINDS.includes(k.value) ? '' : ' (not P&L)'}</option>)}
              </select>
            </div>
            {(txAccount || txKind) && (
              <button onClick={() => { setTxAccount(''); setTxKind(''); setTxPage(1) }}
                className="text-xs text-gray-400 hover:text-gray-600 px-2 py-1.5 rounded hover:bg-gray-100 transition-colors">
                Clear account / kind
              </button>
            )}
            <div className="flex gap-1 ml-auto">
              {[['', 'All'], ['INCOME', 'Income'], ['EXPENSE', 'Expense']].map(([v, l]) => (
                <button key={v} onClick={() => { setTxType(v); setTxCategory(''); setTxSubcategory(''); setTxPage(1) }}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${txType === v ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'}`}>
                  {l}
                </button>
              ))}
            </div>
          </div>

          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            {txLoading ? <Spinner /> : txList.length === 0 ? (
              <div className="text-center py-16 text-gray-400 text-sm">No transactions found</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[860px]">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Date</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Type</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Category</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Source / Paid to</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Description</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">Amount</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Account</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Method</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Ref</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {txList.map(tx => {
                      const rowId    = tx.id ?? tx._id
                      const kind     = tx.kind || 'OPERATING'
                      const nonPl    = !PL_KINDS.includes(kind)
                      const acct     = tx.accountId && typeof tx.accountId === 'object' ? tx.accountId : null
                      const acctId   = idOf(tx.accountId)
                      const acctOpt  = !acct && acctId ? (moneyAccountOptions.find(a => a.id === String(acctId)) ?? null) : null
                      const acctInfo = acct ?? acctOpt
                      const plVal    = tx.plAmountBDT !== null && tx.plAmountBDT !== undefined ? toNum(tx.plAmountBDT) : null
                      const cashBDT  = tx.amountBDT !== null && tx.amountBDT !== undefined ? toNum(tx.amountBDT) : null
                      const hasTax   = !!tx.tax && ['grossBDT', 'vatBDT', 'sdBDT', 'vdsBDT', 'tdsBDT'].some(k => toNum(tx.tax[k]) > 0)
                      const plDiffers = !nonPl && plVal !== null && cashBDT !== null && Math.abs(plVal - cashBDT) >= 0.005
                      const canExpand = hasTax || plDiffers || nonPl || !!tx.channel || !!tx.transferId || !!tx.reversalOf || tx.clearStatus === 'CLEARED' || tx.clearStatus === 'RECONCILED'
                      const expanded  = txExpanded === rowId
                      // Only operating rows are edited here; transfers, tax deposits, asset
                      // postings and other system entries are managed where they were created.
                      const editable  = kind === 'OPERATING' && !tx.reversalOf && !tx.transferId
                      // A client receipt booked against an invoice is corrected by reversing it.
                      const reversible = tx.type === 'INCOME' && !!tx.invoiceId && !!tx.tax && !tx.reversalOf && !tx.reversedBy &&
                        canDo(session, 'finance.payments.confirm')
                      return (
                        <Fragment key={rowId}>
                          <tr className={`hover:bg-gray-50/50 transition-colors ${nonPl ? 'bg-gray-50/40' : ''}`}>
                            <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{fmtDate(tx.date)}</td>
                            <td className="px-4 py-3">
                              <StatusDot status={tx.type} />
                              <div><KindBadge kind={kind} /></div>
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-600">
                              <span>{tx.category}</span>
                              {tx.expenseCategory && <span className="block text-[11px] text-gray-400">{tx.expenseCategory}</span>}
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-600 max-w-[160px] truncate">
                              {tx.paidToName ?? tx.vendor ?? tx.projectId?.name ?? tx.paidBy?.name ?? (tx.counterAccountId?.name ? `↔ ${tx.counterAccountId.name}` : '—')}
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-700 max-w-[200px] truncate" title={tx.description}>{tx.description}</td>
                            <td className={`px-4 py-3 text-right text-sm font-semibold whitespace-nowrap ${
                              nonPl ? 'text-gray-400' : tx.type === 'INCOME' ? 'text-green-600' : 'text-red-500'
                            }`} title={nonPl ? 'Not counted in profit & loss' : undefined}>
                              {tx.type === 'INCOME' ? '+' : '-'}{formatCurrency(tx.amount, tx.currency)}
                              {plDiffers && (
                                <span className="block text-[11px] font-normal text-gray-400">P&amp;L {fmtTk(plVal)}</span>
                              )}
                              {tx.reversedBy && (
                                <span className="block text-[11px] font-normal text-amber-600">Reversed by {tx.reversedBy}</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-600 max-w-[150px]">
                              {acctInfo ? (
                                <span className="block truncate" title={acctInfo.name}>
                                  {acctInfo.name}
                                  <span className="block text-[11px] text-gray-400">{accountTypeLabel(acctInfo.type)}{acctInfo.last4 ? ` ••${acctInfo.last4}` : ''}</span>
                                </span>
                              ) : acctId ? (
                                <span className="text-gray-400">Linked account</span>
                              ) : kind === 'NON_CASH' ? (
                                <span className="text-gray-400">Non-cash</span>
                              ) : (
                                <span className="text-gray-300" title="Recorded before money accounts — edit to set one">—</span>
                              )}
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-500">
                              {fmtMethod(tx.paymentMethod)}
                              {tx.channel && <span className="block text-[11px] text-gray-400">{PAYMENT_CHANNEL_LABELS[tx.channel] ?? tx.channel}</span>}
                            </td>
                            <td className="px-4 py-3 text-xs text-gray-500">
                              {docUrl(tx.receiptUrl) ? (
                                <a href={docUrl(tx.receiptUrl)} target="_blank" rel="noopener noreferrer" className="flex items-center gap-1 text-blue-600 hover:underline">
                                  <Paperclip className="w-3 h-3" /> Receipt
                                </a>
                              ) : tx.txnId ? (
                                <span className="font-mono text-xs">{tx.txnId}</span>
                              ) : '—'}
                            </td>
                            <td className="px-4 py-3">
                              <div className="flex items-center gap-1 justify-end">
                                {canExpand && (
                                  <button onClick={() => setTxExpanded(expanded ? null : rowId)}
                                    title={expanded ? 'Hide details' : 'Tax & P&L details'}
                                    aria-expanded={expanded}
                                    className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
                                    <ChevronDown className={`w-3.5 h-3.5 transition-transform ${expanded ? 'rotate-180' : ''}`} />
                                  </button>
                                )}
                                {reversible && (
                                  <button onClick={() => setReversingTx(tx)} title="Reverse this client receipt (wrong amount, account or date)"
                                    aria-label="Reverse receipt"
                                    className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-600 transition-colors">
                                    <RotateCcw className="w-3.5 h-3.5" />
                                  </button>
                                )}
                                {editable ? (
                                  <button onClick={() => { setEditingTx(tx); setModalOpen(true) }} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
                                    <Pencil className="w-3.5 h-3.5" />
                                  </button>
                                ) : (
                                  <span className="p-1.5 w-6" aria-hidden="true" />
                                )}
                              </div>
                            </td>
                          </tr>
                          {expanded && (
                            <tr className="bg-gray-50/60">
                              <td colSpan={10} className="px-4 py-3">
                                <TxBreakdown tx={tx} nonPl={nonPl} plVal={plVal} cashBDT={cashBDT} />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      )
                    })}
                  </tbody>
                </table>
              </div>
            )}
            {txMeta.pages > 1 && (
              <div className="px-4 py-3 border-t border-gray-100">
                <Pagination meta={txMeta} page={txPage} onPageChange={setTxPage} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── PAYMENT CONFIRMATIONS tab ── */}
      {activeTab === 'confirmations' && (
        <div className="space-y-4">
          <div className="flex gap-2 flex-wrap">
            {[['PENDING_CONFIRMATION', 'Pending'], ['CONFIRMED', 'Confirmed'], ['REJECTED', 'Rejected'], ['REVERSED', 'Reversed'], ['', 'All']].map(([v, l]) => (
              <button key={v} onClick={() => { setPcStatus(v); setPcPage(1) }}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${pcStatus === v ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'}`}>
                {l}
              </button>
            ))}
          </div>

          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            {pcLoading ? <Spinner /> : pcList.length === 0 ? (
              <div className="text-center py-16 text-gray-400 text-sm">No payment confirmations found</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[600px]">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Project</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Client</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Invoice</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">Amount</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Status</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Submitted By</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {pcList.map(pc => (
                      <tr key={pc.id ?? pc._id} className="hover:bg-gray-50/50 transition-colors">
                        <td className="px-4 py-3">
                          <p className="text-xs font-medium text-gray-800">{pc.projectId?.name ?? '—'}</p>
                          {pc.projectId?.projectCode && (
                            <p className="text-xs text-gray-400 font-mono">{pc.projectId.projectCode}</p>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600">{pc.clientId?.userId?.name ?? '—'}</td>
                        <td className="px-4 py-3 text-xs text-gray-500">{pc.invoiceId?.invoiceNumber ?? '—'}</td>
                        <td className="px-4 py-3 text-right text-sm font-semibold text-gray-800 whitespace-nowrap">
                          {formatCurrency(pc.amount, pc.currency)}
                          {(toNum(pc.vdsAmount) > 0 || toNum(pc.tdsAmount) > 0) && (
                            <span className="block text-[11px] font-normal text-gray-400">
                              {toNum(pc.vdsAmount) > 0 ? `+ VDS ${fmtTk(pc.vdsAmount)}` : ''}
                              {toNum(pc.vdsAmount) > 0 && toNum(pc.tdsAmount) > 0 ? ' · ' : ''}
                              {toNum(pc.tdsAmount) > 0 ? `+ TDS ${fmtTk(pc.tdsAmount)}` : ''}
                            </span>
                          )}
                          {pc.accountId?.name && <span className="block text-[11px] font-normal text-gray-400">into {pc.accountId.name}</span>}
                        </td>
                        <td className="px-4 py-3">
                          <StatusDot status={pc.status} />
                          {pc.status === 'REVERSED' && (
                            <span className="block mt-0.5 text-[11px] text-gray-400 max-w-[200px] truncate" title={pc.reversalReason ?? undefined}>
                              {pc.reversedBy?.name ? `by ${pc.reversedBy.name}` : ''}{pc.reversedBy?.name && pc.reversalReason ? ' — ' : ''}{pc.reversalReason ?? ''}
                            </span>
                          )}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">{pc.submittedBy?.name ?? '—'}</td>
                        <td className="px-4 py-3">
                          {pc.status === 'PENDING_CONFIRMATION' && (
                            <button onClick={() => setConfirmingPc(pc)}
                              className="px-3 py-1.5 text-xs font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors">
                              Review
                            </button>
                          )}
                          {pc.status === 'CONFIRMED' && canDo(session, 'finance.payments.confirm') && (
                            <button onClick={() => setReversingPc(pc)} title="Reverse this payment (wrong amount, account, VDS / TDS or date)"
                              className="px-3 py-1.5 text-xs font-medium border border-red-200 text-red-600 rounded-lg hover:bg-red-50 flex items-center gap-1.5 whitespace-nowrap">
                              <RotateCcw className="w-3.5 h-3.5" /> Reverse payment
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {pcMeta.pages > 1 && (
              <div className="px-4 py-3 border-t border-gray-100">
                <Pagination meta={pcMeta} page={pcPage} onPageChange={setPcPage} />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── PAYMENT REQUESTS tab ── */}
      {activeTab === 'requests' && (() => {
        const canConfirm    = canDo(session, 'finance.payments.confirm')
        const showBatch     = prStatus === 'PAID' && canConfirm
        const subOptions    = expenseCategories.find(c => c.label === prCategory)?.subcategories ?? []
        const selectableIds = prList.filter(r => r.status === 'PAID').map(r => r.id ?? r._id)
        const allSelected   = selectableIds.length > 0 && selectableIds.every(id => prSelected.includes(id))
        const selectedRows  = prList.filter(r => prSelected.includes(r.id ?? r._id))
        const selectedTotal = selectedRows.reduce((s, r) => s + (r.amountBDT ?? r.amount ?? 0), 0)
        const selectPreset  = (p) => { setPrPreset(p); setPrPage(1); const { start, end } = presetRange(p); setPrStart(start); setPrEnd(end) }
        const setCustom     = (which, v) => { setPrPreset(''); setPrPage(1); which === 'start' ? setPrStart(v ?? '') : setPrEnd(v ?? '') }
        const toggleAll     = () => setPrSelected(allSelected ? [] : selectableIds)
        const toggleOne     = (id) => setPrSelected(s => s.includes(id) ? s.filter(x => x !== id) : [...s, id])
        return (
        <div className="space-y-4">
          {/* Status filter */}
          <div className="flex gap-2 flex-wrap">
            {[['PENDING', 'Pending'], ['PAID', 'Paid'], ['AUTHORIZED', 'Authorized'], ['REJECTED', 'Rejected'], ['', 'All']].map(([v, l]) => (
              <button key={v} onClick={() => { setPrStatus(v); setPrPage(1); setPrSelected([]) }}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${prStatus === v ? 'bg-gray-900 text-white border-gray-900' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'}`}>
                {l}
              </button>
            ))}
          </div>

          {/* Date + category filters */}
          <div className="flex flex-wrap items-end gap-3 bg-white rounded-xl border border-gray-100 p-3">
            <div className="flex gap-1.5 flex-wrap">
              {[['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', 'Last 7 days'], ['month', 'This month'], ['', 'All dates']].map(([v, l]) => (
                <button key={v || 'all'} onClick={() => selectPreset(v)}
                  className={`px-2.5 py-1.5 text-xs font-medium rounded-lg border transition-colors ${prPreset === v && (v || (!prStart && !prEnd)) ? 'bg-indigo-600 text-white border-indigo-600' : 'bg-white text-gray-500 border-gray-200 hover:border-gray-400'}`}>
                  {l}
                </button>
              ))}
            </div>
            <div className="flex items-end gap-2">
              <div>
                <label className="block text-[11px] text-gray-400 mb-1">From</label>
                <DatePicker value={prStart || null} onChange={v => setCustom('start', v)} />
              </div>
              <div>
                <label className="block text-[11px] text-gray-400 mb-1">To</label>
                <DatePicker value={prEnd || null} onChange={v => setCustom('end', v)} />
              </div>
            </div>
            <div className="min-w-[150px]">
              <label className="block text-[11px] text-gray-400 mb-1">Category</label>
              <select value={prCategory} onChange={e => { setPrCategory(e.target.value); setPrSubcategory(''); setPrPage(1) }}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-gray-900">
                <option value="">All categories</option>
                {expenseCategories.map(c => <option key={c.id ?? c.label} value={c.label}>{c.label}</option>)}
              </select>
            </div>
            <div className="min-w-[150px]">
              <label className="block text-[11px] text-gray-400 mb-1">Subcategory</label>
              <select value={prSubcategory} onChange={e => { setPrSubcategory(e.target.value); setPrPage(1) }}
                disabled={!prCategory || subOptions.length === 0}
                className="w-full border border-gray-200 rounded-lg px-2.5 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:bg-gray-50 disabled:text-gray-400">
                <option value="">All subcategories</option>
                {subOptions.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            {(prCategory || prSubcategory || prStart || prEnd) && (
              <button onClick={() => { setPrCategory(''); setPrSubcategory(''); setPrStart(''); setPrEnd(''); setPrPreset(''); setPrPage(1) }}
                className="px-2.5 py-1.5 text-xs font-medium text-gray-500 border border-gray-200 rounded-lg hover:bg-gray-50">
                Clear
              </button>
            )}
          </div>

          {/* Batch action bar (paid + confirmer) — authorize a group with one combined invoice */}
          {showBatch && prSelected.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3">
              <p className="text-sm text-indigo-900">
                <strong>{prSelected.length}</strong> selected · Total <TkAmt value={selectedTotal} decimals={2} /> BDT
              </p>
              <div className="flex items-center gap-2">
                <a href={`/api/expenses/combined-voucher?ids=${prSelected.join(',')}`} target="_blank" rel="noreferrer"
                  className="px-3 py-1.5 text-xs font-medium border border-indigo-300 text-indigo-700 bg-white rounded-lg hover:bg-indigo-50 flex items-center gap-1.5">
                  <Printer className="w-3.5 h-3.5" /> Generate Combined Invoice
                </a>
                <button onClick={() => setBatchAuthorizing(true)}
                  className="px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700">
                  Authorize Selected
                </button>
              </div>
            </div>
          )}

          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
            {prLoading ? <Spinner /> : prList.length === 0 ? (
              <div className="text-center py-16 text-gray-400 text-sm">No payment requests found</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-100">
                      {showBatch && (
                        <th className="px-4 py-3 w-9">
                          <input type="checkbox" checked={allSelected} onChange={toggleAll}
                            disabled={selectableIds.length === 0}
                            className="w-4 h-4 rounded border-gray-300 accent-indigo-600" />
                        </th>
                      )}
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Title</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Category</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Project</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Voucher</th>
                      <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">Amount</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Status</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Submitted By</th>
                      <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Date</th>
                      <th className="px-4 py-3" />
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {prList.map(pr => (
                      <tr key={pr.id ?? pr._id} className="hover:bg-gray-50/50 transition-colors">
                        {showBatch && (
                          <td className="px-4 py-3">
                            {pr.status === 'PAID' && (
                              <input type="checkbox" checked={prSelected.includes(pr.id ?? pr._id)}
                                onChange={() => toggleOne(pr.id ?? pr._id)}
                                className="w-4 h-4 rounded border-gray-300 accent-indigo-600" />
                            )}
                          </td>
                        )}
                        <td className="px-4 py-3 max-w-[160px]">
                          <button onClick={() => setDetailPr(pr)}
                            className="text-xs font-medium text-gray-800 hover:text-blue-600 hover:underline truncate block text-left w-full">
                            {pr.title ?? pr.description ?? '—'}
                          </button>
                          {pr.origin === 'REIMBURSEMENT' && (
                            <span className="inline-flex items-center mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-indigo-50 text-indigo-700">
                              Reimbursement
                            </span>
                          )}
                          <PurchaseBillLink expense={pr} compact />
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-600">
                          <span>{pr.category ?? '—'}</span>
                          {pr.subcategory && <span className="block text-[11px] text-gray-400">{pr.subcategory}</span>}
                        </td>
                        <td className="px-4 py-3 text-xs text-gray-500">{pr.projectId?.name ?? (pr.origin === 'SALARY' ? 'Salary' : '—')}</td>
                        <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{pr.expenseInvoiceNo ?? '—'}</td>
                        <td className="px-4 py-3 text-right text-sm font-semibold text-gray-800 whitespace-nowrap">{formatCurrency(pr.amount, pr.currency)}</td>
                        <td className="px-4 py-3"><StatusDot status={pr.status} /></td>
                        <td className="px-4 py-3 text-xs text-gray-500">{pr.submittedBy?.name ?? (pr.origin === 'SALARY' ? 'System' : '—')}</td>
                        <td className="px-4 py-3 text-xs text-gray-400 whitespace-nowrap">{fmtDate(pr.date ?? pr.createdAt)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center justify-end gap-2">
                            {pr.status === 'PENDING' && (
                              <button onClick={() => setPayingPr(pr)}
                                className="px-3 py-1.5 text-xs font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors">
                                Review
                              </button>
                            )}
                            {pr.status === 'PAID' && (
                              <>
                                <a href={`/api/expenses/${pr.id ?? pr._id}/voucher`} target="_blank" rel="noreferrer"
                                  className="px-3 py-1.5 text-xs font-medium border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 flex items-center gap-1.5">
                                  <Printer className="w-3.5 h-3.5" /> Invoice
                                </a>
                                <button onClick={() => setAuthorizingPr(pr)}
                                  className="px-3 py-1.5 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors">
                                  Authorize
                                </button>
                              </>
                            )}
                            {canConfirm && (pr.status === 'PAID' || pr.status === 'AUTHORIZED') && (
                              <button onClick={() => setReversingPr(pr)} title="Reverse this payment (wrong amount, account, VDS or TDS)"
                                className="px-3 py-1.5 text-xs font-medium border border-red-200 text-red-600 rounded-lg hover:bg-red-50 flex items-center gap-1.5 whitespace-nowrap">
                                <RotateCcw className="w-3.5 h-3.5" /> Reverse payment
                              </button>
                            )}
                            {pr.status === 'AUTHORIZED' && (
                              <>
                                <a href={`/api/expenses/${pr.id ?? pr._id}/voucher`} target="_blank" rel="noreferrer"
                                  className="px-3 py-1.5 text-xs font-medium border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50 flex items-center gap-1.5">
                                  <Printer className="w-3.5 h-3.5" /> Invoice
                                </a>
                                {docUrl(pr.signedInvoiceUrl) && (
                                  <a href={docUrl(pr.signedInvoiceUrl)} target="_blank" rel="noopener noreferrer"
                                    className="px-3 py-1.5 text-xs font-medium border border-green-200 text-green-700 bg-green-50 rounded-lg hover:bg-green-100 flex items-center gap-1.5">
                                    <FileTextIcon className="w-3.5 h-3.5" /> Authorized
                                  </a>
                                )}
                              </>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {prMeta.pages > 1 && (
              <div className="px-4 py-3 border-t border-gray-100">
                <Pagination meta={prMeta} page={prPage} onPageChange={setPrPage} />
              </div>
            )}
          </div>

          {/* Edit Requests section for owners */}
          {editRequests.length > 0 && (
            <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
              <p className="text-sm font-semibold text-amber-800 mb-3">Pending Edit Requests ({editRequests.length})</p>
              <div className="space-y-2">
                {editRequests.map(er => (
                  <div key={er.id ?? er._id} className="bg-white rounded-lg border border-amber-100 px-4 py-3 flex items-center justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{er.requesterId?.name ?? '—'} wants to edit an expense</p>
                      {er.reason && <p className="text-xs text-gray-500 mt-0.5">{er.reason}</p>}
                    </div>
                    <div className="flex gap-2 shrink-0">
                      <button onClick={() => handleApproveEditRequest(er)}
                        className="px-3 py-1.5 text-xs font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800">
                        Approve
                      </button>
                      <button onClick={() => setRejectingEr(er)}
                        className="px-3 py-1.5 text-xs font-medium border border-gray-200 text-gray-600 rounded-lg hover:bg-gray-50">
                        Reject
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        )
      })()}

      {/* ── WITHDRAWALS tab (removed — freelancer payments settle via Payment Requests) ── */}
      {activeTab === 'withdrawals' && (
        <div className="bg-white border border-gray-100 rounded-xl p-10 text-center">
          <p className="text-sm text-gray-500">
            Wallet withdrawals were removed. Freelancer &amp; agency payments are now settled directly via{' '}
            <Link href="/admin/accounts?tab=requests" className="text-blue-600 hover:underline">Payment Requests</Link>.
          </p>
        </div>
      )}

      {/* ── P&L REPORT tab ── */}
      {activeTab === 'pl' && (
        <div className="space-y-6">
          {/* Date range */}
          <div className="flex items-center gap-3 flex-wrap">
            <span className="text-sm text-gray-500 font-medium">Period</span>
            <DatePicker value={plStart || null} onChange={v => setPlStart(v ?? '')} />
            <span className="text-gray-400 text-sm">to</span>
            <DatePicker value={plEnd || null} onChange={v => setPlEnd(v ?? '')} />
            <button onClick={loadPL}
              className="px-3 py-1.5 text-xs font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800 transition-colors">
              Apply
            </button>
          </div>

          {plLoading ? <Spinner /> : plReport ? (
            <>
              {/* Summary cards */}
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                {[
                  { label: 'Total Income',  value: fmt(plReport.summary?.totalIncome),  color: 'text-green-600', bg: 'bg-green-50', icon: TrendingUp },
                  { label: 'Total Expense', value: fmt(plReport.summary?.totalExpense), color: 'text-red-500',   bg: 'bg-red-50',   icon: TrendingDown },
                  { label: 'Net Profit',    value: fmt(plReport.summary?.netProfit),    color: plReport.summary?.netProfit >= 0 ? 'text-blue-600' : 'text-red-600', bg: 'bg-blue-50', icon: Wallet },
                  { label: 'Margin',        value: `${(plReport.summary?.margin ?? 0).toFixed(1)}%`, color: 'text-purple-600', bg: 'bg-purple-50', icon: Percent },
                ].map(c => {
                  const Icon = c.icon
                  return (
                    <div key={c.label} className="bg-white border border-gray-100 rounded-xl p-5">
                      <div className={`w-9 h-9 rounded-lg ${c.bg} flex items-center justify-center mb-3`}>
                        <Icon className={`w-4 h-4 ${c.color}`} />
                      </div>
                      <p className={`text-xl font-bold ${c.color}`}>{c.value}</p>
                      <p className="text-sm text-gray-500 mt-0.5">{c.label}</p>
                    </div>
                  )
                })}
              </div>
              <div className="flex flex-wrap items-start gap-x-6 gap-y-1 text-xs text-gray-400 -mt-2">
                <span className="flex items-start gap-1.5">
                  <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                  Receipts count net of VAT; transfers, capital, loans, tax deposits and asset purchases are not income or expense.
                </span>
                {toNum(plReport.summary?.depreciation) > 0 && (
                  <span>Depreciation {fmt(plReport.summary.depreciation)} · EBITDA {fmt(plReport.summary.ebitda)}</span>
                )}
                {toNum(plReport.summary?.unconvertedCount) > 0 && (
                  <span className="text-amber-600">{plReport.summary.unconvertedCount} foreign-currency entr{plReport.summary.unconvertedCount === 1 ? 'y has' : 'ies have'} no BDT amount and {plReport.summary.unconvertedCount === 1 ? 'is' : 'are'} left out.</span>
                )}
              </div>

              {/* Monthly breakdown */}
              {plReport.rows?.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100">
                    <p className="text-sm font-semibold text-gray-800">Monthly Breakdown</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-100">
                          <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Month</th>
                          <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">Income</th>
                          <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">Expense</th>
                          <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">Net Profit</th>
                          <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">Margin</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {plReport.rows.map(row => {
                          const margin = row.totalIncome > 0 ? ((row.netProfit / row.totalIncome) * 100).toFixed(1) : '0.0'
                          return (
                            <tr key={row.month} className="hover:bg-gray-50/50">
                              <td className="px-4 py-3 text-sm font-medium text-gray-700">{fmtMonth(row.month)}</td>
                              <td className="px-4 py-3 text-right text-sm font-semibold text-green-600">{fmt(row.totalIncome)}</td>
                              <td className="px-4 py-3 text-right text-sm font-semibold text-red-500">{fmt(row.totalExpense)}</td>
                              <td className={`px-4 py-3 text-right text-sm font-bold ${row.netProfit >= 0 ? 'text-blue-600' : 'text-red-600'}`}>{fmt(row.netProfit)}</td>
                              <td className="px-4 py-3 text-right text-xs text-gray-500">{margin}%</td>
                            </tr>
                          )
                        })}
                      </tbody>
                      <tfoot>
                        <tr className="bg-gray-50 border-t-2 border-gray-200">
                          <td className="px-4 py-3 text-sm font-bold text-gray-800">Total</td>
                          <td className="px-4 py-3 text-right text-sm font-bold text-green-600">{fmt(plReport.summary?.totalIncome)}</td>
                          <td className="px-4 py-3 text-right text-sm font-bold text-red-500">{fmt(plReport.summary?.totalExpense)}</td>
                          <td className={`px-4 py-3 text-right text-sm font-bold ${plReport.summary?.netProfit >= 0 ? 'text-blue-600' : 'text-red-600'}`}>{fmt(plReport.summary?.netProfit)}</td>
                          <td className="px-4 py-3 text-right text-xs text-gray-500">{(plReport.summary?.margin ?? 0).toFixed(1)}%</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}
              {plReport.rows?.length === 0 && (
                <div className="bg-white rounded-xl border border-gray-100 text-center py-12 text-gray-400 text-sm">
                  No income or expense in this period.
                </div>
              )}

              {/* Cash movements excluded from the P&L */}
              {plReport.nonPl?.length > 0 && (
                <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
                  <div className="px-4 py-3 border-b border-gray-100">
                    <p className="text-sm font-semibold text-gray-800">Not in profit &amp; loss</p>
                    <p className="text-xs text-gray-400 mt-0.5">Money that moved in this period without being income or expense.</p>
                  </div>
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm min-w-[420px]">
                      <thead>
                        <tr className="bg-gray-50 border-b border-gray-100">
                          <th className="text-left px-4 py-3 text-xs font-medium text-gray-500">Kind</th>
                          <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">Entries</th>
                          <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">Money in</th>
                          <th className="text-right px-4 py-3 text-xs font-medium text-gray-500">Money out</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-gray-50">
                        {plReport.nonPl.map(m => (
                          <tr key={m.kind} className="hover:bg-gray-50/50">
                            <td className="px-4 py-3 text-sm text-gray-700">{m.label}</td>
                            <td className="px-4 py-3 text-right text-sm text-gray-500">{m.count}</td>
                            <td className="px-4 py-3 text-right text-sm text-gray-700">{m.inflow ? fmt(m.inflow) : '—'}</td>
                            <td className="px-4 py-3 text-right text-sm text-gray-700">{m.outflow ? fmt(m.outflow) : '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div className="text-center py-16 text-gray-400 text-sm">Select a date range and click Apply to generate the report</div>
          )}
        </div>
      )}

      {/* ── Modals ── */}
      <TransactionModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        tx={editingTx}
        onSaved={handleSaved}
        currentUser={session?.user}
      />

      {payingPr && (
        <PaymentModal
          expense={payingPr}
          currentUser={session?.user}
          onClose={() => setPayingPr(null)}
          onDone={() => { loadPaymentRequests(); loadSummary() }}
        />
      )}

      {authorizingPr && (
        <AuthorizeModal
          expense={authorizingPr}
          onClose={() => setAuthorizingPr(null)}
          onDone={() => { loadPaymentRequests(); loadSummary() }}
        />
      )}

      {reversingPr && (
        <ReversePaymentModal
          expense={reversingPr}
          onClose={() => setReversingPr(null)}
          onDone={() => { setPrSelected([]); loadPaymentRequests(); loadSummary() }}
        />
      )}

      {batchAuthorizing && (
        <BatchAuthorizeModal
          ids={prSelected}
          expenses={prList.filter(r => prSelected.includes(r.id ?? r._id))}
          onClose={() => setBatchAuthorizing(false)}
          onDone={() => { setPrSelected([]); loadPaymentRequests(); loadSummary() }}
        />
      )}

      {detailPr && (
        <ExpenseDetailModal expense={detailPr} onClose={() => setDetailPr(null)} />
      )}

      {confirmingPc && (
        <ConfirmPaymentModal
          payment={confirmingPc}
          currentUser={session?.user}
          onClose={() => setConfirmingPc(null)}
          onDone={() => { loadPaymentConfirmations(); loadSummary() }}
        />
      )}

      {reversingPc && (
        <ReverseClientPaymentModal
          payment={reversingPc}
          onClose={() => setReversingPc(null)}
          onDone={() => { loadPaymentConfirmations(); loadSummary() }}
        />
      )}

      {reversingTx && (
        <ReverseClientPaymentModal
          transaction={reversingTx}
          onClose={() => setReversingTx(null)}
          onDone={() => { loadTransactions(); loadSummary() }}
        />
      )}

      {editRequestModal && (
        <RequestEditModal
          expense={editRequestModal}
          onClose={() => setEditRequestModal(null)}
          onSubmitted={() => { setEditRequestModal(null) }}
        />
      )}

      {otpModal && (
        <OtpVerifyModal
          requestId={otpModal.requestId}
          expenseId={otpModal.expenseId}
          onVerified={() => { setOtpModal(null); setEditUnlocked(prev => new Set([...prev, otpModal.expenseId])) }}
          onClose={() => setOtpModal(null)}
        />
      )}

      {ownerOtpModal && (
        <OwnerOtpModal
          otp={ownerOtpModal.otp}
          requesterName={ownerOtpModal.requesterName}
          onClose={() => setOwnerOtpModal(null)}
        />
      )}

      {rejectingEr && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-xl border border-gray-200 w-full max-w-sm p-6 space-y-4">
            <h3 className="text-base font-semibold text-gray-900">Reject Edit Request</h3>
            <textarea value={rejectNote} onChange={e => setRejectNote(e.target.value)} rows={3}
              placeholder="Reason for rejection (optional)…"
              className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none" />
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setRejectingEr(null); setRejectNote('') }} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
              <button onClick={() => handleRejectEditRequest(rejectingEr, rejectNote)}
                className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700">
                Reject
              </button>
            </div>
          </div>
        </div>
      )}

    </div>
  )
}

export default function AccountsPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-[60vh]"><div className="w-7 h-7 border-2 border-gray-300 border-t-gray-700 rounded-full animate-spin" /></div>}>
      <AccountsContent />
    </Suspense>
  )
}
