'use client'

import { useState, useEffect, useRef, useCallback, Suspense, Fragment } from 'react'
import { useSession } from 'next-auth/react'
import { useSearchParams, useRouter } from 'next/navigation'
import {
  AlertCircle, Plus, Pencil, X, Loader2, CheckCircle2, XCircle,
  Paperclip, ExternalLink, ArrowUpRight, ArrowDownRight, FileText as FileTextIcon, ChevronLeft, Printer,
  Landmark, Receipt, ChevronDown, ChevronRight, AlertTriangle, Info, RotateCcw, ArrowLeftRight, Tag,
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
import Button, { buttonVariants } from '@/components/ui/Button'
import { Card, CardHeader, CardTitle, CardDescription } from '@/components/ui/Card'
import { Input, Textarea, NativeSelect, Label, inputClass, selectClass } from '@/components/ui/Input'
import PageHeader from '@/components/ui/PageHeader'
import Tabs from '@/components/ui/Tabs'
import { Table, TableHeader, TableBody, TableFooter, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import Badge from '@/components/ui/Badge'
import EmptyState from '@/components/ui/EmptyState'
import LoadingSpinner, { PageLoader } from '@/components/ui/LoadingSpinner'
import ActionMenu from '@/components/ui/ActionMenu'
import { cn } from '@/lib/utils'
import MoneyAccountSelect, { useMoneyAccounts, invalidateMoneyAccounts, moneyAccountLabel, accountRequiredOn } from '@/components/finance/MoneyAccountSelect'
import ReverseClientPaymentModal from '@/components/finance/ReverseClientPaymentModal'
import UnitSelect from '@/components/finance/UnitSelect'
import { COMPANY_UNIT, UNASSIGNED, ventureUnit, unitOptions, unitLabel } from '@/lib/units'
import { fiscalYearOf, fiscalYearRange, addFiscalYears, isDayKey } from '@/lib/finance/fiscal'
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
    INCOME:               { variant: 'success', label: 'Income' },
    EXPENSE:              { variant: 'danger',  label: 'Expense' },
    PENDING:              { variant: 'warning', label: 'Pending' },
    PAID:                 { variant: 'primary', label: 'Paid' },
    AUTHORIZED:           { variant: 'success', label: 'Authorized' },
    APPROVED:             { variant: 'primary', label: 'Approved' },
    REJECTED:             { variant: 'danger',  label: 'Rejected' },
    PENDING_CONFIRMATION: { variant: 'warning', label: 'Pending' },
    CONFIRMED:            { variant: 'success', label: 'Confirmed' },
    REVERSING:            { variant: 'warning', label: 'Reversing…' },
    REVERSED:             { variant: 'default', label: 'Reversed' },
  }
  const s = map[status] ?? { variant: 'default', label: status }
  return <Badge variant={s.variant} dot>{s.label}</Badge>
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

// ─── Ventures & products (business units, lib/units.js) ───────────────────────

const UNIT_GROUP_LABELS = { VENTURE: 'Ventures', PRODUCT: 'Products', COMPANY: 'Company' }

/** The unit an expense's payment is booked to — the same order lib/expensePayment.payExpense uses. */
function unitOfExpense(expense) {
  return expense?.unit
    ?? ventureUnit(expense?.projectId?.venture)
    ?? ventureUnit(expense?.venture)
    ?? COMPANY_UNIT
}

/** The unit a client receipt on this invoice is booked to (invoice → its project's venture → Company). */
function unitOfInvoice(invoice, project = null) {
  const p = invoice?.projectId && typeof invoice.projectId === 'object' ? invoice.projectId : null
  const first = Array.isArray(invoice?.projectIds) && typeof invoice.projectIds[0] === 'object' ? invoice.projectIds[0] : null
  return invoice?.unit
    ?? ventureUnit(p?.venture ?? first?.venture ?? project?.venture)
    ?? COMPANY_UNIT
}

/**
 * Report / list filter: '' = every unit the viewer may see, UNASSIGNED = rows
 * with no unit. Inactive ventures and products stay listed (their history reports).
 */
function UnitFilter({ value, onChange, config, allLabel = 'All ventures & products', className }) {
  const options = unitOptions(config ?? {}, { includeInactive: true })
  const kinds = [...new Set(options.map(o => o.kind))]
  return (
    <NativeSelect value={value ?? ''} onChange={e => onChange(e.target.value)}
      aria-label="Venture / product" className={cn('text-[13px]', className)}>
      <option value="">{allLabel}</option>
      {kinds.map(kind => (
        <optgroup key={kind} label={UNIT_GROUP_LABELS[kind] ?? kind}>
          {options.filter(o => o.kind === kind).map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </optgroup>
      ))}
      <option value={UNASSIGNED}>Unassigned (older entries)</option>
    </NativeSelect>
  )
}

/** A unit fixed by something else (project, invoice, stored row), shown like a disabled field. */
function UnitReadOnly({ unit, config }) {
  return (
    <div className={cn(inputClass, 'cursor-not-allowed items-center bg-gray-50')}>
      <span className={cn('truncate', unit ? 'text-gray-700' : 'text-amber-700')}>{unitLabel(unit, config ?? {})}</span>
    </div>
  )
}

/** Current Dhaka fiscal year (July–June) as { from, to } day keys; `offset` −1 = last year. */
function fiscalYearDays(offset = 0) {
  const fy = offset ? addFiscalYears(fiscalYearOf(), offset) : fiscalYearOf()
  const r = fiscalYearRange(fy)
  return { from: r?.startDay ?? '', to: r?.endDay ?? '' }
}

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
      className="mt-1 inline-flex"
    >
      <Badge variant={nonPl ? 'default' : 'purple'}>
        {KIND_LABELS[kind] ?? kind}{nonPl ? ' · not P&L' : ''}
      </Badge>
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

  const lc = 'mb-1.5 block text-[13px] font-medium text-gray-900'
  const cb = 'mt-0.5 size-4 shrink-0 rounded border-gray-300'

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-gray-200/80 bg-white">
        <button type="button" onClick={() => setOpen(o => !o)} aria-expanded={open}
          className="flex w-full items-center gap-2 px-4 py-3 text-left">
          <Receipt className="size-4 shrink-0 text-gray-400" />
          <span className="text-sm font-medium text-gray-900">VAT in this bill (Mushak-6.3)</span>
          <span className="ml-auto flex items-center gap-2">
            {vat > 0 && (
              <span className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">
                VAT {fmtTk(vat)}{creditable ? ' · input credit' : ''}
              </span>
            )}
            <ChevronDown className={cn('size-4 text-gray-400 transition-transform', open && 'rotate-180')} />
          </span>
        </button>
        {open && (
          <div className="space-y-4 border-t border-gray-100 p-4">
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <div>
                <label className={lc}>VAT in the bill (৳)</label>
                <input type="number" min="0" step="0.01" inputMode="decimal" disabled={disabled || vatLocked} readOnly={vatLocked}
                  value={v.vatAmount === null || v.vatAmount === undefined ? '' : v.vatAmount}
                  onChange={e => patch({ vatAmount: e.target.value === '' ? null : Number(e.target.value) })}
                  onBlur={e => { if (e.target.value === '') patch({ vatAmount: 0 }) }}
                  onKeyDown={e => { if (e.key === '-' || e.key === 'e') e.preventDefault() }}
                  placeholder="0.00" className={inputClass} />
                {(vat > 0 || vatLocked) && (
                  <p className="mt-1.5 text-xs text-muted-foreground">
                    {vat > 0
                      ? <>Excl. VAT {fmtTk(base)}{vatRate !== null ? ` · ≈ ${vatRate}%` : ''}{vatLocked ? ' · set on the purchase bill' : ''}</>
                      : 'Set on the purchase bill.'}
                  </p>
                )}
                {vat > grossNum + 0.005 && <p className="mt-1.5 text-xs text-red-600">VAT cannot exceed the bill amount.</p>}
              </div>
              <div>
                <label className={lc}>Supplier VAT status</label>
                <select value={v.supplierVatType ?? 'REGISTERED'} disabled={disabled}
                  onChange={e => patch({ supplierVatType: e.target.value })} className={selectClass}>
                  {SUPPLIER_VAT_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className={lc}>Supplier BIN</label>
                <input value={v.supplierBin ?? ''} disabled={disabled}
                  onChange={e => patch({ supplierBin: e.target.value })}
                  aria-invalid={binBad || undefined}
                  placeholder="000123456-0101" className={inputClass} />
                {binBad && <p className="mt-1.5 text-xs text-red-600">BIN must be 9 or 13 digits.</p>}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className={lc}>Mushak-6.3 no.</label>
                  <input value={v.mushakNo ?? ''} disabled={disabled}
                    onChange={e => patch({ mushakNo: e.target.value })} placeholder="Invoice no." className={inputClass} />
                </div>
                <div>
                  <label className={lc}>Mushak date</label>
                  <input type="date" value={v.mushakDate ?? ''} disabled={disabled}
                    onChange={e => patch({ mushakDate: e.target.value })} className={inputClass} />
                </div>
              </div>
            </div>

            {vat > 0 && (
              <div className="space-y-2 rounded-lg bg-gray-50 px-3 py-2.5">
                {!vatLocked && (
                  <label className="flex items-start gap-2 text-[13px] text-gray-700"
                    title="Office equipment, furniture, vehicles, rent, entertainment">
                    <input type="checkbox" checked={!!v.excludedItem} disabled={disabled}
                      onChange={e => patch({ excludedItem: e.target.checked })}
                      className={cb} />
                    <span>Excluded item (no input credit)</span>
                  </label>
                )}
                <label className="flex items-start gap-2 text-[13px] text-gray-700">
                  <input type="checkbox" checked={creditable} disabled={disabled || vatLocked || !!v.excludedItem}
                    onChange={e => patch({ vatCreditable: e.target.checked, creditableTouched: true })}
                    className={cb} />
                  <span className="font-medium text-gray-900">Claim as input tax credit</span>
                </label>
                {vatLocked && (
                  <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                    <Info className="mt-0.5 size-3.5 shrink-0" />
                    <span>Set on the purchase bill.</span>
                  </p>
                )}
                {itc.loading && (
                  <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Checking creditability…</p>
                )}
                {!itc.loading && itc.data && (
                  <p className={cn('flex items-start gap-1.5 text-xs', itc.data.creditable ? 'text-emerald-700' : 'text-amber-700')}>
                    {itc.data.creditable ? <CheckCircle2 className="mt-0.5 size-3.5 shrink-0" /> : <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />}
                    <span>
                      {itc.data.creditable
                        ? 'Creditable — claim within 6 tax periods.'
                        : `Not creditable: ${itc.data.reasonLabel ?? itc.data.reason}.`}
                      {!vatLocked && v.creditableTouched && creditable !== !!itc.data.creditable && ' Your choice overrides this.'}
                    </span>
                  </p>
                )}
                {!itc.loading && itc.error && <p className="text-xs text-muted-foreground">{itc.error}</p>}
              </div>
            )}

            <div className="grid grid-cols-1 gap-4 border-t border-gray-100 pt-4 sm:grid-cols-2">
              <div>
                <label className={lc}>Payee type (for TDS)</label>
                <select value={v.payeeType ?? 'COMPANY'} disabled={disabled}
                  onChange={e => patch({ payeeType: e.target.value })} className={selectClass}>
                  {PAYEE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
                {payeeLoading && <p className="mt-1.5 text-xs text-muted-foreground">Loading payee profile…</p>}
              </div>
              <label className="flex items-start gap-2 text-[13px] text-gray-700 sm:pt-7"
                title="Proof of return submission. Without it, TDS is 50% higher (ITA s.264 / s.142).">
                <input type="checkbox" checked={!!v.hasPsr} disabled={disabled}
                  onChange={e => patch({ hasPsr: e.target.checked })}
                  className={cb} />
                <span>Payee showed PSR <span className="text-muted-foreground">· else TDS +50%</span></span>
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

      <div className="rounded-lg bg-gray-50 px-4 py-3 text-xs">
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-gray-600 tabular-nums">
          <span>Bill {fmtTk(grossNum)}</span>
          {vat > 0 && <span>incl. VAT {fmtTk(vat)}</span>}
          {vds > 0 && <span>− VDS {fmtTk(vds)}</span>}
          {tds > 0 && <span>− TDS {fmtTk(tds)}</span>}
          <span className="ml-auto text-sm font-semibold text-gray-900">Net payable {fmtTk(net)}</span>
        </div>
        {net < -0.005 && <p className="mt-1 text-red-600">Withholding is more than the bill amount.</p>}
        {note && <p className="mt-1 text-muted-foreground">{note}</p>}
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
  if (vds > 0 && !(vat > 0)) errors.push('Enter the bill VAT before deducting VDS')
  else if (vds > vat + 0.005) errors.push('VDS cannot exceed the VAT on the bill')
  if (tds > round2(grossNum - vat) + 0.005) errors.push('TDS cannot be more than the bill value excluding VAT')
  if ((vds > 0 || tds > 0) && vds + tds >= grossNum - 0.005) errors.push('VDS + TDS must leave a net payable above zero')
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
    out.push({ level: 'warn', text: `${cashCost === 'SALARY' ? 'Salary' : 'Rent'} paid outside a bank or mobile wallet is non-deductible (ITA 2023 s.55).` })
  if (vat > 0 && toNum(gross) > ITC_BANKING_THRESHOLD && facts.vatBank === 'no')
    out.push({ level: 'warn', text: 'Over Tk 1,00,000 outside a banking channel loses input VAT credit (VAT Act s.46).' })
  if (vat > 0 && toNum(gross) > ITC_BANKING_THRESHOLD && facts.vatBank === 'uncertain')
    out.push({ level: 'info', text: 'MFS / gateway may not count as banking for input VAT over Tk 1,00,000.' })
  if ((tds > 0 || tax?.withholding?.tdsSection) && !facts.incomeTaxBank)
    out.push({ level: 'warn', text: 'Not a bank transfer — TDS is 50% higher (ITA s.142).' })
  if (tax?.withholding?.tdsSection && !tax?.hasPsr && tax?.payeeType !== 'NON_RESIDENT')
    out.push({ level: 'info', text: 'No PSR on file — TDS is 50% higher.' })
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
      className={cn(selectClass, size === 'sm' && 'text-[13px]')}
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
        ? 'mt-1 inline-flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-xs font-medium text-orange-700 ring-1 ring-inset ring-orange-600/15 hover:bg-orange-100'
        : 'inline-flex items-center gap-1 text-xs font-medium text-gray-900 underline-offset-4 hover:underline'}
    >
      <Receipt className="size-3.5 text-current" />
      Purchase bill{billNo ? ` ${billNo}` : ''}
      {!compact && <ExternalLink className="size-3 text-gray-400" />}
    </Link>
  )
}

function WarningList({ items }) {
  if (!items?.length) return null
  return (
    <ul className="space-y-1.5">
      {items.map((w, i) => (
        <li key={i} className={cn(
          'flex items-start gap-2 rounded-lg border px-3 py-2.5 text-[13px]',
          w.level === 'warn' ? 'border-amber-200 bg-amber-50 text-amber-800' : 'border-gray-200/80 bg-gray-50 text-gray-600'
        )}>
          {w.level === 'warn' ? <AlertTriangle className="mt-0.5 size-4 shrink-0" /> : <Info className="mt-0.5 size-4 shrink-0" />}
          <span>{w.text}</span>
        </li>
      ))}
    </ul>
  )
}

/** Hand-built dialog frame (matches components/ui/Modal) for the page's inline modals. */
function DialogShell({ title, description, onClose, className, footer, children }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]">
      <div className={cn('flex max-h-[92vh] w-full max-w-lg flex-col rounded-2xl border border-gray-200/80 bg-white shadow-2xl', className)}>
        <div className="flex shrink-0 items-start justify-between gap-4 px-4 pt-5 pb-3 sm:px-6">
          <div className="min-w-0">
            <h3 className="text-base font-semibold tracking-tight text-gray-900">{title}</h3>
            {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close" className="-mr-1.5 -mt-0.5 text-gray-400">
            <X />
          </Button>
        </div>
        <div className="flex-1 overflow-y-auto px-4 pt-1 pb-5 sm:px-6">{children}</div>
        {footer && (
          <div className="flex shrink-0 flex-wrap items-center justify-end gap-2 rounded-b-2xl border-t border-gray-100 bg-gray-50/60 px-4 py-3.5 sm:px-6">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Transaction Modal ────────────────────────────────────────────────────────

function TransactionModal({ open, onOpenChange, tx, onSaved, currentUser }) {
  const { paymentMethods, expenseCategories, incomeCategories, config } = useConfig()
  const isEdit = !!tx
  const [receiptUrl,  setReceiptUrl]  = useState('')
  const [projects,    setProjects]    = useState([])
  const [invoices,    setInvoices]    = useState([])
  const [txnIdVal,    setTxnIdVal]    = useState('')
  // Venture / product picked by hand (a project or linked invoice overrides it).
  const [unitChoice,  setUnitChoice]  = useState(null)
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
  const projectIdVal = watch('projectId')
  const invoiceIdVal = watch('invoiceId')
  const isExpense  = type === 'EXPENSE'
  const isForeign  = currency && currency !== BASE_CURRENCY
  // A NEW expense is not a direct ledger entry — it's submitted as a request that
  // must be Reviewed → Paid → Authorized. Editing an existing transaction is unchanged.
  const isExpenseRequest = isExpense && !isEdit

  // Venture / product (required on a new entry). A linked invoice settles to the
  // invoice's unit and a project to its venture — both shown read-only; otherwise
  // the person picks one (Company / shared included). Edits keep the stored unit:
  // it is changed from the list's row menu.
  const linkedInvoice = !isEdit && type === 'INCOME' && invoiceIdVal ? (invoices.find(i => i.id === invoiceIdVal) ?? null) : null
  const linkedProject = !isEdit && projectIdVal ? (projects.find(p => p.id === projectIdVal) ?? null) : null
  const derivedUnit   = linkedInvoice ? unitOfInvoice(linkedInvoice) : ventureUnit(linkedProject?.venture)
  const unit          = derivedUnit ?? unitChoice

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
      setUnitChoice(null)
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
      if (!isEdit && !unit) { toast.error('Choose the venture / product'); return }
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
          unit,
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
      if (accountRequired && !accountId) { toast.error('Select the account the money came into'); return }
      if ((data.currency || BASE_CURRENCY) !== BASE_CURRENCY && !(Number(data.amountBDT) > 0)) {
        toast.error('Enter the BDT-equivalent for a non-BDT transaction'); return
      }
      const body = { ...data, receiptUrl: receiptUrl || null, txnId: txnIdVal.trim() || null }
      // The ledger id is fixed once created — never send it on edit.
      if (isEdit) delete body.txnId
      // The unit is set on creation; later changes go through PATCH (the row menu).
      if (!isEdit) body.unit = unit
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

  const ic = inputClass
  const errCls = 'mt-1.5 text-xs text-red-600'

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={isEdit ? 'Edit transaction' : 'New transaction'} size="lg">
      <form id="tx-form" onSubmit={handleSubmit(onSubmit)} className="space-y-5">
        {/* Type */}
        <div>
          <Label>Type</Label>
          <div className="grid grid-cols-2 gap-3">
            {['INCOME', 'EXPENSE'].map((t) => (
              <label key={t} className="flex cursor-pointer items-center gap-2 rounded-lg border border-gray-200/80 px-3 py-2.5 shadow-xs transition-colors hover:bg-gray-50/70 has-[:checked]:border-gray-900 has-[:checked]:bg-gray-50">
                <input type="radio" value={t} {...register('type')} />
                <span className="text-sm font-medium text-gray-900">{t === 'INCOME' ? 'Income' : 'Expense'}</span>
              </label>
            ))}
          </div>
          {isExpenseRequest && (
            <p className="mt-2 text-xs text-amber-700" title="Review → Paid → Authorized before it reaches the ledger.">
              Sent as a payment request for review.
            </p>
          )}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <div>
            <Label required>Category</Label>
            <Controller name="category" control={control} render={({ field }) => (
              <Select value={field.value} onChange={v => { field.onChange(v ?? ''); setValue('expenseCategory', '') }}
                options={categories.map(c => ({ value: c, label: c }))}
                placeholder="Select…"
                disabled={baseCategories.length === 0}
              />
            )} />
            {errors.category && <p className={errCls}>{errors.category.message}</p>}
            {baseCategories.length === 0 && (
              <p className="mt-1.5 text-xs text-amber-700">No {isExpense ? 'expense' : 'income'} categories in Config → Finance.</p>
            )}
          </div>
          <div>
            <Label>Subcategory</Label>
            <Controller name="expenseCategory" control={control} render={({ field }) => (
              <Select value={field.value ?? ''} onChange={v => field.onChange(v ?? '')}
                options={subcategories.map(c => ({ value: c, label: c }))}
                placeholder={!category ? 'Pick a category' : subcategories.length === 0 ? 'None' : 'Select…'}
                disabled={!category || subcategories.length === 0}
              />
            )} />
          </div>
          <div>
            <Label required>Amount</Label>
            <Input type="number" step="0.01" min="0" placeholder="0.00" {...register('amount')} onKeyDown={e => { if (e.key === '-' || e.key === 'e') e.preventDefault() }}
              invalid={!!errors.amount} />
            {errors.amount && <p className={errCls}>{errors.amount.message}</p>}
          </div>
        </div>

        {/* Currency + BDT-equivalent (metrics always roll up in BDT) */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label>Currency</Label>
            <Controller name="currency" control={control} render={({ field }) => (
              <Select value={field.value ?? 'BDT'} onChange={v => field.onChange(v ?? 'BDT')}
                options={currencyOptions} placeholder="Select…" />
            )} />
          </div>
          {isForeign && (
            <div>
              <Label required title="The actual taka value — used for all finance metrics.">BDT equivalent</Label>
              <Input type="number" step="0.01" min="0" placeholder="0.00" {...register('amountBDT')} onKeyDown={e => { if (e.key === '-' || e.key === 'e') e.preventDefault() }}
                invalid={!!errors.amountBDT} />
              {errors.amountBDT && <p className={errCls}>{errors.amountBDT.message}</p>}
            </div>
          )}
        </div>

        <div>
          <Label required>Description</Label>
          <Textarea {...register('description')} rows={2} placeholder="What was this for?" className="resize-none" invalid={!!errors.description} />
          {errors.description && <p className={errCls}>{errors.description.message}</p>}
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label required>Date</Label>
            {/* Money cannot move on a future day (the ledger refuses it); an expense request may be dated ahead. */}
            <Input type="date" {...register('date')} max={isExpenseRequest ? undefined : dhakaDayKey()} invalid={!!errors.date} />
            {errors.date && <p className={errCls}>{errors.date.message}</p>}
          </div>
          {/* Payment method is recorded when the expense request is Paid, not at submit. */}
          {!isExpenseRequest && (
            <div>
              <Label>Payment method</Label>
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
            <Label>Money account</Label>
            <div className={cn(ic, 'items-center gap-2 bg-gray-50 text-gray-700')}>
              <Landmark className="size-4 shrink-0 text-gray-400" />
              <span className="truncate">
                {tx?.accountId?.name
                  ? `${tx.accountId.name} · ${accountTypeLabel(tx.accountId.type)}${tx.accountId.last4 ? ` ••${tx.accountId.last4}` : ''}`
                  : (moneyAccounts.find(a => a.id === String(idOf(tx?.accountId)))?.name ?? 'Linked account')}
              </span>
              {reconciled && <Badge variant="success" className="ml-auto">Reconciled</Badge>}
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">Reconciled entries keep their account.</p>
          </div>
        ) : showAccountPicker && (
          <div>
            <Label required={accountRequired}>
              {isEdit ? 'Money account' : 'Received into'}
            </Label>
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
            <p className="mt-1.5 text-xs text-muted-foreground">
              {isEdit
                ? (originalAccountId
                  ? 'Change only if posted to the wrong account.'
                  : 'Older entry — set an account for its balance.')
                : moneyAccounts.length === 0
                  ? 'No money accounts yet.'
                  : !accountLive
                    ? `Before go-live (${goLiveDate}) — no account needed.`
                    : 'Auto-picked from the payment method.'}
            </p>
          </div>
        ))}

        {/* Account manager + txn id are assigned when the expense is Paid, so they're
            hidden while submitting an expense request. */}
        {!isExpenseRequest && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label>Account manager</Label>
            <div className={cn(ic, 'cursor-not-allowed items-center justify-between bg-gray-50')}>
              <span className="truncate text-gray-700">
                {/* Editing keeps the stored manager, so show that person — not the current user */}
                {isEdit ? (tx?.accountManager?.name ?? '—') : (currentUser?.name ?? '—')}
                {!isEdit && currentUser?.role && (
                  <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                    {currentUser.role.replace('_', ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())}
                  </span>
                )}
              </span>
            </div>
          </div>
          <div>
            <Label title={isEdit ? 'Cannot be changed' : undefined}>Transaction ID</Label>
            <Input
              value={txnIdVal}
              onChange={e => setTxnIdVal(e.target.value)}
              placeholder={isEdit ? '' : 'Auto-generated if blank'}
              readOnly={isEdit}
              className={isEdit ? 'cursor-not-allowed bg-gray-50 text-gray-500' : undefined}
            />
          </div>
        </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label>Project</Label>
            <Controller name="projectId" control={control} render={({ field }) => (
              <Select value={field.value} onChange={v => field.onChange(v ?? '')}
                options={projects.map(p => ({ value: p.id, label: p.name }))}
                placeholder="None"
              />
            )} />
          </div>
          <div>
            <Label required={!isEdit}>Venture / product</Label>
            {isEdit || derivedUnit ? (
              <UnitReadOnly unit={isEdit ? (tx?.unit ?? null) : derivedUnit} config={config} />
            ) : (
              // '' = nothing chosen yet (null would read as a stored "Unassigned").
              <UnitSelect value={unitChoice ?? ''} onChange={v => setUnitChoice(v || null)} required placeholder="Select…" />
            )}
            <p className="mt-1.5 text-xs text-muted-foreground">
              {isEdit
                ? 'Change it from the row menu in Transactions.'
                : linkedInvoice
                  ? 'Follows the linked invoice.'
                  : derivedUnit
                    ? "Follows the project's venture."
                    : 'Company / shared for costs no venture or product owns.'}
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label>Reference</Label>
            <Input {...register('reference')} placeholder="INV-001, PO-123…" />
          </div>
          {type === 'INCOME' && (
            <div>
              <Label title="Syncs the invoice's paid amount">Linked invoice</Label>
              <Controller name="invoiceId" control={control} render={({ field }) => (
                <Select value={field.value} onChange={v => field.onChange(v ?? '')}
                  options={invoices.map(inv => ({ value: inv.id, label: `${inv.invoiceNumber} — ${inv.clientId?.userId?.name ?? inv.clientId?.company ?? 'Client'} (due ${formatCurrency(Math.max(0, toNum(inv.total) - toNum(inv.paidAmount)), inv.currency)})` }))}
                  placeholder="None"
                />
              )} />
            </div>
          )}
        </div>

        {/* Expense request: payee vendor + supplier-bill tax (VAT / VDS / TDS). */}
        {isExpenseRequest && Array.isArray(vendors) && vendors.length > 0 && (
          <div>
            <Label title="Fills BIN, VAT status & TDS defaults">Vendor</Label>
            <NativeSelect value={vendorId} onChange={e => chooseVendor(e.target.value)}>
              <option value="">No vendor</option>
              {vendors.map(v => (
                <option key={v.id} value={v.id}>{v.company}{v.bin && !String(v.bin).includes('•') ? ` · BIN ${v.bin}` : ''}</option>
              ))}
            </NativeSelect>
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
            note="Assumes bank payment; re-checked when paid."
          />
        )}
        {isExpenseRequest && !showExpenseTax && (
          <p className="text-xs text-muted-foreground">Tax is recorded on BDT bills only — use the Tax ledger for foreign bills.</p>
        )}

        <FileUpload
          label="Receipt / invoice"
          value={receiptUrl}
          onUploaded={url => setReceiptUrl(url)}
        />
      </form>
      <ModalFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
        <Button type="submit" form="tx-form" loading={isSubmitting}>
          {isEdit ? 'Save changes' : isExpenseRequest ? 'Submit request' : 'Add transaction'}
        </Button>
      </ModalFooter>
    </Modal>
  )
}

// ─── Approve Modal ────────────────────────────────────────────────────────────

function PaymentModal({ expense, onClose, onDone }) {
  const { paymentMethods, config } = useConfig()
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
        toast.success('Payment recorded')
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

  const hint = 'mt-1.5 text-xs text-muted-foreground'

  return (
    <DialogShell
      title="Record payment"
      description="Marks it paid and posts it to the ledger."
      onClose={onClose}
      className="max-w-3xl"
      footer={<>
        {!canPay && problems[0] && (
          <p className="flex w-full items-center gap-1.5 text-xs text-amber-700 sm:mr-auto sm:w-auto"><AlertCircle className="size-3.5 shrink-0" /> {problems[0]}</p>
        )}
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="outline" onClick={() => submit('reject')} disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : <XCircle />} Reject
        </Button>
        <Button onClick={() => submit('pay')} disabled={saving || !canPay}>
          {saving ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}
          {isForeign ? 'Mark paid' : `Mark paid · ${fmtTk(built.net)}`}
        </Button>
      </>}
    >
        <div className="space-y-5">
          {/* Two-column layout: summary + submitted proof */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="space-y-1.5 rounded-lg bg-gray-50 p-4">
              <p className="text-sm font-semibold text-gray-900">{expense.title}</p>
              <p className="text-xs text-muted-foreground">{expense.category}{expense.subcategory ? ` / ${expense.subcategory}` : ''} · {fmtDate(expense.date)}</p>
              <p className="pt-1 text-xl font-semibold tracking-tight text-gray-900 tabular-nums">{formatCurrency(expense.amount, expense.currency)}</p>
              {(payee?.name || expense.paidToName) && (
                <p className="text-xs text-muted-foreground">Payee <span className="font-medium text-gray-700">{payee?.name ?? expense.paidToName}</span></p>
              )}
              {expense.submittedBy?.name && (
                <p className="text-xs text-muted-foreground">Submitted by <span className="font-medium text-gray-700">{expense.submittedBy.name}</span></p>
              )}
              <p className="text-xs text-muted-foreground" title="Set when the expense was requested">
                Venture / product <span className="font-medium text-gray-700">{unitLabel(unitOfExpense(expense), config ?? {})}</span>
              </p>
              <PurchaseBillLink expense={expense} />
              {expense.notes && (
                <p className="mt-2 whitespace-pre-wrap border-t border-gray-200/80 pt-2 text-xs text-muted-foreground">{expense.notes}</p>
              )}
            </div>

            {docUrl(expense.invoiceUrl) ? (
              <DocPreview url={docUrl(expense.invoiceUrl)} label="Submitted proof" />
            ) : (
              <div className="flex items-center justify-center rounded-lg border border-dashed border-gray-200 px-4 py-8 text-center">
                <p className="text-xs text-muted-foreground">No proof attached.</p>
              </div>
            )}
          </div>

          {/* Payment: method, account, channel, date, transaction id */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label required>Payment method</Label>
              <NativeSelect value={paymentMethod} onChange={e => setPaymentMethod(e.target.value)}>
                <option value="">Select…</option>
                {paymentMethods.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
              </NativeSelect>
            </div>
            <div>
              <Label required={accountRequired}>Paid from</Label>
              <MoneyAccountSelect
                value={accountId}
                onChange={(id, acc) => { setAccountId(id); setAccount(acc ?? null) }}
                currency={expense.currency ?? 'BDT'}
                paymentMethod={paymentMethod || null}
                placeholder="Select account"
                required={accountRequired}
                autoSelect={accountLive}
                date={paidAt || null}
              />
              {moneyAccounts.length === 0 ? (
                <p className={hint}>No money accounts yet.</p>
              ) : !accountLive && (
                <p className={hint}>Before go-live ({goLiveDate}) — no account needed.</p>
              )}
              {overdraft && (
                <p className="mt-1.5 text-xs text-red-600">Only {formatMoney(available, accountObj.currency)} available in this account.</p>
              )}
            </div>
            <div>
              <Label>Channel</Label>
              <NativeSelect value={effectiveChannel}
                onChange={e => { setChannel(e.target.value); setChannelTouched(true) }}>
                <option value="">Select…</option>
                {CHANNEL_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </NativeSelect>
              <p className={hint} title={!channelTouched && autoChannel ? 'Set from the method / account' : undefined}>
                {facts.incomeTaxBank ? 'Banking channel for income tax.' : 'Not a banking channel — cash rules apply.'}
              </p>
            </div>
            <div>
              <Label required>Payment date</Label>
              <DatePicker value={paidAt || null} onChange={v => setPaidAt(v ?? '')} clearable={false} />
            </div>
            <div className="sm:col-span-2">
              <Label required={!proofUrl}>Transaction ID</Label>
              <Input value={txnId} onChange={e => setTxnId(e.target.value)} placeholder="Bank / bKash ref, cheque no." />
            </div>
          </div>

          <FileUpload
            label={txnId.trim() ? 'Payment proof' : 'Payment proof (or transaction ID)'}
            value={proofUrl}
            onUploaded={url => setProofUrl(url)}
          />

          {isForeign && (
            <div>
              <Label required>Amount in BDT</Label>
              <Input type="number" value={amtBDT} onChange={e => setAmtBDT(e.target.value)}
                placeholder={`${expense.currency} → BDT`} />
              <p className={hint}>Tax is recorded on BDT bills only — use the Tax ledger for foreign bills.</p>
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
            <Label>Note</Label>
            <Textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
              placeholder="Note for the requester…" className="resize-none" />
          </div>
        </div>
    </DialogShell>
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
    if (!scanUrl) { toast.error('Upload the signed invoice'); return }
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
    <DialogShell
      title={`Authorize invoice${expense.expenseId ?? expense.expenseInvoiceNo ? ` — ${expense.expenseId ?? expense.expenseInvoiceNo}` : ''}`}
      onClose={onClose}
      className="max-w-2xl"
      footer={<>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={submit} disabled={saving || !scanUrl}>
          {saving ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Authorize
        </Button>
      </>}
    >
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-gray-50 p-4">
            <div className="min-w-0">
              <p className="text-sm font-semibold text-gray-900">{expense.title}</p>
              <p className="text-xs text-muted-foreground">{expense.category}{expense.subcategory ? ` / ${expense.subcategory}` : ''} · {fmtDate(expense.date)}</p>
              <p className="mt-1 text-lg font-semibold tracking-tight text-gray-900 tabular-nums">{formatCurrency(expense.amount, expense.currency)}</p>
              <p className="mt-1 text-xs text-muted-foreground">Paid via <span className="font-medium text-gray-700">{methodLabel}</span>{expense.paymentTxnId ? ` · Txn ${expense.paymentTxnId}` : ''}</p>
            </div>
            <a href={`/api/expenses/${expense.id}/voucher`} target="_blank" rel="noreferrer"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              <Printer /> Print invoice
            </a>
          </div>

          <FileUpload
            label="Signed & sealed invoice scan"
            value={scanUrl}
            onUploaded={url => setScanUrl(url)}
          />
        </div>
    </DialogShell>
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
      toast.success('Payment reversed — back to Pending')
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
    <DialogShell
      title={`Reverse payment${expense.expenseInvoiceNo ? ` — ${expense.expenseInvoiceNo}` : ''}`}
      onClose={onClose}
      footer={<>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="destructive" onClick={submit} disabled={saving || trimmed.length < 5}>
          {saving ? <Loader2 className="animate-spin" /> : <RotateCcw />} Reverse payment
        </Button>
      </>}
    >
        <div className="space-y-4">
          <div className="rounded-lg bg-gray-50 p-4">
            <p className="text-sm font-semibold text-gray-900">{expense.title}</p>
            <p className="text-xs text-muted-foreground">{expense.category}{expense.subcategory ? ` / ${expense.subcategory}` : ''} · {fmtDate(expense.date)}</p>
            <p className="mt-1 text-lg font-semibold tracking-tight text-gray-900 tabular-nums">{formatCurrency(expense.amount, expense.currency)}</p>
          </div>
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-800"
            title="Refused while a tax entry is in a filed return, deposited by challan or has an issued certificate, or when the books are locked.">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <p>Posts a reversing entry today, voids its VAT / VDS / TDS entries and returns the request to <strong className="font-medium">Pending</strong>.</p>
          </div>
          <div>
            <Label required>Reason</Label>
            <Textarea value={reason} onChange={e => setReason(e.target.value)} rows={3} maxLength={300}
              placeholder="e.g. VDS withheld on a non-VDS service"
              className="resize-none" />
          </div>
        </div>
    </DialogShell>
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
    if (!scanUrl) { toast.error('Upload the signed combined invoice'); return }
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
    <DialogShell
      title={`Authorize ${ids.length} expense${ids.length > 1 ? 's' : ''}`}
      description="One signed combined invoice covers all of them."
      onClose={onClose}
      className="max-w-2xl"
      footer={<>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={submit} disabled={saving || !scanUrl}>
          {saving ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Authorize {ids.length}
        </Button>
      </>}
    >
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-4 rounded-lg bg-gray-50 p-4">
            <div>
              <p className="text-sm font-semibold text-gray-900">{ids.length} paid expense{ids.length > 1 ? 's' : ''}</p>
              <p className="mt-1 text-lg font-semibold tracking-tight text-gray-900 tabular-nums">Total <TkAmt value={totalBDT} decimals={2} /> <span className="text-xs font-normal text-muted-foreground">BDT</span></p>
            </div>
            <a href={`/api/expenses/combined-voucher?ids=${idsParam}`} target="_blank" rel="noreferrer"
              className={buttonVariants({ variant: 'outline', size: 'sm' })}>
              <Printer /> Print combined invoice
            </a>
          </div>

          <FileUpload
            label="Signed & sealed combined invoice scan"
            value={scanUrl}
            onUploaded={url => setScanUrl(url)}
          />
        </div>
    </DialogShell>
  )
}

// ─── Expense Detail Modal ─────────────────────────────────────────────────────
// Read-only preview: expense summary + all documents (main invoice, submitted
// proof, payment proof and — once authorized — the authorized invoice scan).

function ExpenseDetailModal({ expense, onClose }) {
  const { paymentMethods, config } = useConfig()
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
    <DialogShell
      title={`Expense${expense.expenseId ?? expense.expenseInvoiceNo ? ` — ${expense.expenseId ?? expense.expenseInvoiceNo}` : ''}`}
      onClose={onClose}
      className="max-w-2xl"
      footer={<Button variant="outline" onClick={onClose}>Close</Button>}
    >
        <div className="space-y-5">
          {/* Summary */}
          <div className="space-y-1.5 rounded-lg bg-gray-50 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-semibold text-gray-900">{expense.title}</p>
                  {expense.origin === 'REIMBURSEMENT' && <Badge variant="indigo">Reimbursement</Badge>}
                </div>
                <p className="text-xs text-muted-foreground">{expense.category}{expense.subcategory ? ` / ${expense.subcategory}` : ''} · {fmtDate(expense.date)}</p>
              </div>
              <StatusDot status={expense.status} />
            </div>
            <p className="pt-1 text-xl font-semibold tracking-tight text-gray-900 tabular-nums">
              {formatCurrency(expense.amount, expense.currency)}
              {isForeign && <span className="ml-2 text-xs font-normal text-muted-foreground">≈ {formatCurrency(expense.amountBDT ?? 0, 'BDT')}</span>}
            </p>
            {expense.submittedBy?.name && (
              <p className="text-xs text-muted-foreground">Submitted by <span className="font-medium text-gray-700">{expense.submittedBy.name}</span></p>
            )}
            <p className="text-xs text-muted-foreground">
              Venture / product <span className="font-medium text-gray-700">{unitLabel(unitOfExpense(expense), config ?? {})}</span>
            </p>
            <PurchaseBillLink expense={expense} />
            {settled && (
              <p className="text-xs text-muted-foreground">
                Paid via <span className="font-medium text-gray-700">{methodLabel ?? '—'}</span>
                {expense.accountId?.name ? <> from <span className="font-medium text-gray-700">{expense.accountId.name}</span></> : ''}
                {expense.paidAt ? ` on ${fmtDate(expense.paidAt)}` : ''}
                {expense.paymentTxnId ? ` · Txn ${expense.paymentTxnId}` : ''}
              </p>
            )}
            {expense.tax && (toNum(expense.tax.vatAmount) > 0 || toNum(expense.tax.vdsAmount) > 0 || toNum(expense.tax.tdsAmount) > 0) && (
              <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-gray-200/80 pt-2 text-xs text-muted-foreground tabular-nums">
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
              <p className="mt-2 whitespace-pre-wrap border-t border-gray-200/80 pt-2 text-xs text-muted-foreground">{expense.notes}</p>
            )}
          </div>

          {/* Documents */}
          <div className="space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold text-gray-900">Documents</p>
              {hasInvoice && (
                <a href={`/api/expenses/${expense.id ?? expense._id}/voucher`} target="_blank" rel="noreferrer"
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                  <Printer /> Main invoice
                </a>
              )}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              {docUrl(expense.signedInvoiceUrl) && <DocPreview url={docUrl(expense.signedInvoiceUrl)} label="Authorized invoice" />}
              {docUrl(expense.paymentProofUrl)  && <DocPreview url={docUrl(expense.paymentProofUrl)}  label="Payment proof" />}
              {docUrl(expense.invoiceUrl)       && <DocPreview url={docUrl(expense.invoiceUrl)}       label="Submitted proof" />}
            </div>
            {!hasInvoice && !docUrl(expense.signedInvoiceUrl) && !docUrl(expense.paymentProofUrl) && !docUrl(expense.invoiceUrl) && (
              <p className="text-xs text-muted-foreground">No documents yet.</p>
            )}
          </div>
        </div>
    </DialogShell>
  )
}

// ─── Confirm Payment Modal ────────────────────────────────────────────────────

function ConfirmPaymentModal({ payment, currentUser, onClose, onDone }) {
  const { paymentMethods, config } = useConfig()
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
      toast.success(action === 'confirm' ? 'Payment confirmed' : 'Payment rejected')
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
  const hint = 'mt-1.5 text-xs text-muted-foreground'

  return (
    <DialogShell
      title="Confirm payment"
      onClose={onClose}
      className="max-w-2xl"
      footer={<>
        {problems[0] && (
          <p className="flex w-full items-center gap-1.5 text-xs text-amber-700 sm:mr-auto sm:w-auto"><AlertCircle className="size-3.5 shrink-0" /> {problems[0]}</p>
        )}
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button variant="outline" onClick={() => submit('reject')} disabled={saving}>
          {saving ? <Loader2 className="animate-spin" /> : <XCircle />} Reject
        </Button>
        <Button onClick={() => submit('confirm')} disabled={saving || problems.length > 0}>
          {saving ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Confirm
        </Button>
      </>}
    >
        <div className="space-y-5">
          {/* Summary */}
          <div className="space-y-1.5 rounded-lg bg-gray-50 p-4">
            {project?.name && (
              <p className="text-sm font-semibold text-gray-900">
                {project.projectCode ? `[${project.projectCode}] ` : ''}{project.name}
              </p>
            )}
            {client?.name && (
              <p className="text-xs text-muted-foreground">Client <span className="font-medium text-gray-700">{client.name}</span></p>
            )}
            {invoice?.invoiceNumber && (
              <p className="text-xs text-muted-foreground">
                Invoice {invoice.invoiceNumber}
                {invDue !== null && <> · balance <span className="font-medium text-gray-700">{formatCurrency(invDue, payment.currency ?? 'BDT')}</span></>}
                {toNum(invoice.vatAmount) > 0 && <> · incl. VAT {formatCurrency(invoice.vatAmount, payment.currency ?? 'BDT')}</>}
              </p>
            )}
            {payment.description && (
              <p className="text-xs text-gray-600">{payment.description}</p>
            )}
            <p className="text-xs text-muted-foreground" title="A client receipt follows its invoice">
              Venture / product <span className="font-medium text-gray-700">{unitLabel(unitOfInvoice(invoice, project), config ?? {})}</span>
            </p>
            <p className="pt-1 text-xl font-semibold tracking-tight text-gray-900 tabular-nums">
              {payment.currency} {Number(payment.amount).toLocaleString()}
            </p>
            <p className="text-xs text-muted-foreground">
              {fmtMethod(payment.paymentMethod)} · {fmtDate(payment.paymentDate)}
              {payment.submittedBy?.name && <> · by {payment.submittedBy.name}</>}
            </p>
            {payment.notes && (
              <p className="text-xs italic text-muted-foreground">{payment.notes}</p>
            )}
            {docUrl(payment.receiptUrl) && (
              <DocPreview url={docUrl(payment.receiptUrl)} compact />
            )}
          </div>

          <p className="text-[13px] text-gray-600">
            Posts <span className="font-medium text-gray-900 tabular-nums">{payment.currency ?? 'BDT'} {Number(payment.amount).toLocaleString('en-BD', { minimumFractionDigits: 2 })}</span> as income
            {vds + tds > 0 && invoice?.invoiceNumber && (
              <span title="VDS / TDS the client withheld count as paid and become tax credits."> and settles <span className="font-medium text-gray-900 tabular-nums">{fmtTk(settled)}</span> of {invoice.invoiceNumber}</span>
            )}
            .
          </p>

          {/* Money account + channel */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label required={accountRequired}>Received into</Label>
              <MoneyAccountSelect
                value={accountId}
                onChange={(id, acc) => { setAccountId(id); setAccount(acc ?? null) }}
                currency={payment.currency ?? 'BDT'}
                paymentMethod={payment.paymentMethod || null}
                placeholder={cash > 0 ? 'Select account' : 'No cash — withholding only'}
                required={accountRequired}
                disabled={!(cash > 0)}
                autoSelect={accountLive}
                date={paymentDay || null}
              />
              {moneyAccounts.length === 0 ? (
                <p className={hint}>No money accounts yet.</p>
              ) : cash > 0 && !accountLive && (
                <p className={hint}>Before go-live ({goLiveDate}) — leave it empty.</p>
              )}
            </div>
            <div>
              <Label>Channel</Label>
              <NativeSelect value={effectiveChannel} onChange={e => { setChannel(e.target.value); setChannelTouched(true) }}>
                <option value="">Select…</option>
                {CHANNEL_OPTIONS.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </NativeSelect>
            </div>
          </div>

          {/* Account Manager + TxnId */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div>
              <Label>Account manager</Label>
              <div className={cn(inputClass, 'cursor-not-allowed items-center bg-gray-50')}>
                <span className="truncate text-gray-700">
                  {currentUser?.name ?? '—'}
                  {currentUser?.role && (
                    <span className="ml-1.5 text-xs font-normal text-muted-foreground">
                      {currentUser.role.replace('_', ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase())}
                    </span>
                  )}
                </span>
              </div>
            </div>
            <div>
              <Label required={!payment.receiptUrl}>Transaction ID</Label>
              <Input value={txnId} onChange={e => setTxnId(e.target.value)}
                placeholder="e.g. TXN-REF-001" />
              {!payment.receiptUrl && !txnId && (
                <p className="mt-1.5 text-xs text-amber-700">Required — no receipt attached</p>
              )}
            </div>
          </div>

          {isForeign && (
            <div>
              <Label required>BDT received</Label>
              <Input type="number" step="0.01" min="0" value={amountBDT} onChange={e => setAmountBDT(e.target.value)}
                placeholder={`${payment.currency} ${Number(payment.amount).toLocaleString()} in BDT`} />
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
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-lg bg-gray-50 px-4 py-3 text-xs text-gray-600 tabular-nums">
                  <span>Cash {fmtTk(cash)}</span>
                  {vds > 0 && <span>+ VDS {fmtTk(vds)}</span>}
                  {tds > 0 && <span>+ TDS {fmtTk(tds)}</span>}
                  <span className={cn('ml-auto text-sm font-semibold', overDue ? 'text-red-600' : 'text-gray-900')}>Settles {fmtTk(settled)}</span>
                  {invDue !== null && <span className="w-full text-muted-foreground">Invoice balance {fmtTk(invDue)}{overDue ? ' — reduce the amounts withheld' : ''}</span>}
                </div>
              )}
            </>
          ) : (
            <p className="text-xs text-muted-foreground">
              {!invoiceKey
                ? 'Link an invoice to record VDS / TDS withheld.'
                : 'VDS / TDS apply to BDT invoices only.'}
            </p>
          )}

          {/* Note */}
          <div>
            <Label>Note</Label>
            <Textarea value={note} onChange={e => setNote(e.target.value)} rows={2}
              placeholder="Required when rejecting"
              className="resize-none" />
          </div>
        </div>
    </DialogShell>
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
      toast.success('Edit request sent')
      onSubmitted && onSubmitted()
      onClose()
    } catch (err) {
      toast.error(err.message ?? 'Failed to submit request')
    } finally {
      setSaving(false)
    }
  }

  return (
    <DialogShell
      title="Request edit access"
      description={`This expense is ${expense.status} and locked. The owner will send a one-time OTP.`}
      onClose={onClose}
      className="max-w-md"
      footer={<>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button type="submit" form="edit-request-form" loading={saving}>Submit request</Button>
      </>}
    >
        <div className="space-y-4">
          <div className="space-y-1 rounded-lg bg-gray-50 p-4">
            <p className="text-sm font-semibold text-gray-900">{expense.title}</p>
            <p className="text-xs text-muted-foreground">{expense.category}{expense.subcategory ? ` / ${expense.subcategory}` : ''} · {fmtDate(expense.date)}</p>
            <p className="text-sm font-semibold text-gray-900 tabular-nums"><TkAmt value={expense.amount} decimals={2} /></p>
          </div>
          <form id="edit-request-form" onSubmit={submit}>
            <Label required>Reason</Label>
            <Textarea
              value={reason}
              onChange={e => setReason(e.target.value)}
              rows={3}
              placeholder="Why does this need editing?"
              className="resize-none"
            />
          </form>
        </div>
    </DialogShell>
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
      toast.success('Edit access granted')
      onVerified(expenseId)
      onClose()
    } catch (err) {
      setErrMsg(err.message ?? 'Invalid or expired OTP')
    } finally {
      setSaving(false)
    }
  }

  return (
    <DialogShell
      title="Enter OTP"
      description="Use the 6-digit code from the owner."
      onClose={onClose}
      className="max-w-sm"
      footer={<>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button type="submit" form="otp-verify-form" loading={saving} disabled={otp.length !== 6}>Verify</Button>
      </>}
    >
        <form id="otp-verify-form" onSubmit={verify} className="space-y-2">
          <Input
            value={otp}
            onChange={e => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
            placeholder="000000"
            maxLength={6}
            inputMode="numeric"
            aria-label="6-digit OTP"
            invalid={!!errMsg}
            className="h-11 text-center font-mono text-xl tracking-[0.4em]"
          />
          {errMsg && <p className="text-center text-xs text-red-600">{errMsg}</p>}
        </form>
    </DialogShell>
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
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-3">
        <div className="flex items-center gap-2">
          <Button variant="ghost" size="icon-xs" onClick={onClose} aria-label="Close daily breakdown" className="text-gray-500">
            <ChevronLeft />
          </Button>
          <CardTitle>{label} daily breakdown</CardTitle>
        </div>
        <span className="text-xs text-muted-foreground">{daysInMonth} days</span>
      </div>

      {loading ? (
        <LoadingSpinner className="py-12" />
      ) : (
        <Table className="min-w-[600px]">
          <TableHeader>
            <TableRow>
              <TableHead className="w-28">Day</TableHead>
              <TableHead className="text-right">Income</TableHead>
              <TableHead className="text-right">Expense</TableHead>
              <TableHead className="text-right">Net profit</TableHead>
              <TableHead className="text-right">Transactions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {(data ?? []).map(row => {
              const hasActivity = row.txCount > 0
              return (
                <TableRow key={row.day} className={cn(!hasActivity && 'opacity-40')}>
                  <TableCell className="py-2.5 font-medium text-gray-900">
                    {String(row.day).padStart(2, '0')}{' '}
                    <span className="font-normal text-muted-foreground">{MONTH_NAMES[mo - 1].slice(0, 3)}</span>
                  </TableCell>
                  <TableCell className="py-2.5 text-right font-medium text-emerald-600 tabular-nums">
                    {row.income > 0 ? fmtAmt(row.income) : '—'}
                  </TableCell>
                  <TableCell className="py-2.5 text-right text-red-600 tabular-nums">
                    {row.expense > 0 ? fmtAmt(row.expense) : '—'}
                  </TableCell>
                  <TableCell className={cn('py-2.5 text-right font-medium tabular-nums',
                    row.profit > 0 ? 'text-gray-900' : row.profit < 0 ? 'text-red-600' : 'text-gray-300'
                  )}>
                    {row.txCount > 0 ? fmtAmt(row.profit) : '—'}
                  </TableCell>
                  <TableCell className="py-2.5 text-right text-muted-foreground tabular-nums">
                    {row.txCount > 0 ? row.txCount : '—'}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </Card>
  )
}

// ─── Owner OTP Display Modal ──────────────────────────────────────────────────

function OwnerOtpModal({ otp, requesterName, onClose }) {
  return (
    <DialogShell
      title="Edit request approved"
      onClose={onClose}
      className="max-w-sm"
      footer={<Button onClick={onClose} className="w-full sm:w-auto">Done</Button>}
    >
        <div className="space-y-4">
          <p className="text-sm text-gray-600">
            Share this OTP with <span className="font-medium text-gray-900">{requesterName ?? 'the manager'}</span>. Single use, expires in 30 minutes.
          </p>
          <div className="rounded-lg border border-gray-200/80 bg-gray-50 px-6 py-5 text-center">
            <p className="font-mono text-4xl font-semibold tracking-[0.3em] text-gray-900">{otp}</p>
          </div>
        </div>
    </DialogShell>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

// ─── Change venture / product (Transactions row menu) ─────────────────────────
// PATCH /api/transactions/[id] { unit } re-tags one ledger row (logged). The
// server allows it in open periods, and in a locked period only for a row that
// has no unit yet (Unassigned).

function ChangeUnitModal({ tx, onClose, onDone }) {
  const { config } = useConfig()
  const current = tx.unit ?? null
  const [unit,   setUnit]   = useState(current)
  const [saving, setSaving] = useState(false)
  const changed = !!unit && unit !== current

  async function submit() {
    if (!unit) { toast.error('Choose the venture / product'); return }
    setSaving(true)
    try {
      const res  = await fetch(`/api/transactions/${tx.id ?? tx._id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ unit }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(apiErrorMessage(json, 'The venture / product could not be changed'))
      toast.success(`Moved to ${unitLabel(unit, config ?? {})}`)
      onDone()
      onClose()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <DialogShell
      title="Change venture / product"
      description="Moves this entry in the venture & product reports."
      onClose={onClose}
      className="max-w-md"
      footer={<>
        <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
        <Button onClick={submit} disabled={saving || !changed}>
          {saving ? <Loader2 className="animate-spin" /> : <Tag />} Save
        </Button>
      </>}
    >
        <div className="space-y-4">
          <div className="space-y-1 rounded-lg bg-gray-50 p-4">
            <p className="text-sm font-semibold text-gray-900">{tx.description || tx.category}</p>
            <p className="text-xs text-muted-foreground">{tx.category}{tx.expenseCategory ? ` / ${tx.expenseCategory}` : ''} · {fmtDate(tx.date)}</p>
            <p className="text-sm font-semibold text-gray-900 tabular-nums">
              {tx.type === 'INCOME' ? '+' : '-'}{formatCurrency(tx.amount, tx.currency)}
            </p>
            <p className="text-xs text-muted-foreground">
              Now <span className={cn('font-medium', current ? 'text-gray-700' : 'text-amber-700')}>{unitLabel(current, config ?? {})}</span>
            </p>
          </div>
          <div>
            <Label required>Venture / product</Label>
            <UnitSelect value={unit} onChange={v => setUnit(v || null)} required />
            <p className="mt-1.5 text-xs text-muted-foreground">Locked periods: only Unassigned entries can be placed.</p>
          </div>
          {(tx.reversedBy || tx.reversalOf) && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-800">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              <span>{tx.reversedBy ? 'This entry was reversed' : 'This is a reversal'} — move its pair too, so the two still cancel out.</span>
            </p>
          )}
        </div>
    </DialogShell>
  )
}

// ─── Ventures & products tab ──────────────────────────────────────────────────
// GET /api/accounts/units-report?from&to: one row per venture, product, Company /
// shared and Unassigned with the P&L figures (accounts/_lib/pl.js rules), the
// receivable and month-by-month figures. Scoped users get only their own units.

function unitKindBadge(row) {
  if (!row.unit) return <Badge variant="warning">Unassigned</Badge>
  if (row.kind === 'PRODUCT') return <Badge variant="indigo">Product</Badge>
  if (row.kind === 'COMPANY') return <Badge>Shared</Badge>
  return null
}

const fmtMargin = (income, margin) => (toNum(income) > 0 && margin !== null && margin !== undefined ? `${toNum(margin).toFixed(1)}%` : '—')

function UnitsReport({ from, to, setFrom, setTo, onViewTransactions }) {
  const { config } = useConfig()
  const [report,   setReport]   = useState(null)
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState(null)
  const [expanded, setExpanded] = useState(null)   // unit key showing its months

  useEffect(() => {
    // Ignore a reply for a period that is no longer selected.
    const ctrl = new AbortController()
    setLoading(true)
    setError(null)
    const qs = new URLSearchParams()
    if (from) qs.set('from', from)
    if (to)   qs.set('to', to)
    fetch(`/api/accounts/units-report?${qs}`, { signal: ctrl.signal })
      .then(async r => {
        const j = await r.json().catch(() => ({}))
        if (!r.ok) throw new Error(j.error || 'Failed to load the report')
        return j.data
      })
      .then(d => { setReport(d ?? null); setExpanded(null) })
      .catch(err => { if (err?.name !== 'AbortError') setError(err.message ?? 'Failed to load the report') })
      .finally(() => { if (!ctrl.signal.aborted) setLoading(false) })
    return () => ctrl.abort()
  }, [from, to])

  const thisFy = fiscalYearDays(0)
  const lastFy = fiscalYearDays(-1)
  const preset = from === thisFy.from && to === thisFy.to ? 'fy'
    : from === lastFy.from && to === lastFy.to ? 'lastfy'
    : '__custom__'
  const pickPreset = (p) => {
    const r = p === 'lastfy' ? lastFy : thisFy
    setFrom(r.from)
    setTo(r.to)
  }

  const units  = Array.isArray(report?.units) ? report.units : []
  const totals = report?.totals ?? {}
  const scoped = report?.scope?.all === false
  const keyOf  = (row) => row.unit ?? UNASSIGNED
  const money  = (n) => (toNum(n) !== 0 ? fmt(toNum(n)) : '—')

  return (
    <div className="space-y-4">
      {/* Period */}
      <div className="flex flex-wrap items-center gap-2">
        <Tabs size="sm" value={preset} onChange={pickPreset}
          tabs={[{ value: 'fy', label: 'This fiscal year' }, { value: 'lastfy', label: 'Last fiscal year' }]} />
        <DatePicker value={from || null} onChange={v => setFrom(v ?? '')} />
        <span className="text-sm text-muted-foreground">to</span>
        <DatePicker value={to || null} onChange={v => setTo(v ?? '')} />
      </div>

      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground">
        <span
          className="inline-flex cursor-help items-center gap-1.5"
          title="Salaries follow each employee's venture. Rent, utilities, bank charges, depreciation, tax penalties and purchases are in Company / shared, so a venture's profit is before overheads."
        >
          <Info className="size-3.5 shrink-0" />
          Profit before shared costs
        </span>
        {scoped && (
          <span className="inline-flex items-center gap-1.5 text-amber-700">
            <AlertCircle className="size-3.5 shrink-0" />
            Only your venture is shown.
          </span>
        )}
      </div>

      <Card className="overflow-hidden">
        {loading ? <LoadingSpinner className="h-40" /> : error ? (
          <EmptyState icon={AlertCircle} title="Report not available" description={error} />
        ) : units.length === 0 ? (
          <EmptyState title="No income or expense in this period"
            description={scoped ? 'Only your venture is shown: nothing was booked to it, or no venture is set on your employee record.' : 'Try another period.'} />
        ) : (
          <Table className="min-w-[760px]">
            <TableHeader>
              <TableRow>
                <TableHead>Venture / product</TableHead>
                <TableHead className="text-right">Income</TableHead>
                <TableHead className="text-right">Expense</TableHead>
                <TableHead className="text-right">Profit</TableHead>
                <TableHead className="text-right">Margin</TableHead>
                <TableHead className="text-right" title="Outstanding invoices">Receivable</TableHead>
                <TableHead><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {units.map(row => {
                const key    = keyOf(row)
                const open   = expanded === key
                const months = Array.isArray(row.months) ? row.months : []
                return (
                  <Fragment key={key}>
                    <TableRow className={cn(open && 'border-b-0')}>
                      <TableCell>
                        <button type="button" onClick={() => setExpanded(open ? null : key)} aria-expanded={open}
                          disabled={months.length === 0}
                          className="flex items-center gap-2 text-left disabled:cursor-default">
                          <ChevronRight className={cn('size-4 shrink-0 text-gray-400 transition-transform', open && 'rotate-90', months.length === 0 && 'invisible')} />
                          <span className="font-medium text-gray-900">{row.label ?? unitLabel(row.unit, config ?? {})}</span>
                          {unitKindBadge(row)}
                        </button>
                      </TableCell>
                      <TableCell className="text-right text-emerald-600 tabular-nums">{money(row.income)}</TableCell>
                      <TableCell className="text-right text-red-600 tabular-nums">{money(row.expense)}</TableCell>
                      <TableCell className={cn('text-right font-medium tabular-nums', toNum(row.profit) < 0 ? 'text-red-600' : 'text-gray-900')}>{fmt(toNum(row.profit))}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground tabular-nums">{fmtMargin(row.income, row.margin)}</TableCell>
                      <TableCell className="text-right tabular-nums">{money(row.receivable)}</TableCell>
                      <TableCell className="py-2 text-right">
                        <Button variant="ghost" size="xs" onClick={() => onViewTransactions(key)}>
                          View transactions <ChevronRight className="text-gray-400" />
                        </Button>
                      </TableCell>
                    </TableRow>
                    {open && (
                      <TableRow className="bg-gray-50/60 hover:bg-gray-50/60">
                        <TableCell colSpan={7} className="px-4 py-3">
                          <table className="w-full max-w-xl text-[13px]">
                            <thead>
                              <tr className="text-xs text-muted-foreground">
                                <th className="py-1 pr-4 text-left font-medium">Month</th>
                                <th className="py-1 pr-4 text-right font-medium">Income</th>
                                <th className="py-1 pr-4 text-right font-medium">Expense</th>
                                <th className="py-1 text-right font-medium">Profit</th>
                              </tr>
                            </thead>
                            <tbody>
                              {months.map(m => (
                                <tr key={m.month} className="border-t border-gray-200/70">
                                  <td className="py-1.5 pr-4 text-gray-900">{fmtMonth(m.month)}</td>
                                  <td className="py-1.5 pr-4 text-right text-emerald-600 tabular-nums">{money(m.income)}</td>
                                  <td className="py-1.5 pr-4 text-right text-red-600 tabular-nums">{money(m.expense)}</td>
                                  <td className={cn('py-1.5 text-right font-medium tabular-nums', toNum(m.profit) < 0 ? 'text-red-600' : 'text-gray-900')}>{fmt(toNum(m.profit))}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </TableCell>
                      </TableRow>
                    )}
                  </Fragment>
                )
              })}
            </TableBody>
            <TableFooter>
              <TableRow className="hover:bg-transparent">
                <TableCell className="font-semibold text-gray-900">{scoped ? 'Total (your units)' : 'Total'}</TableCell>
                <TableCell className="text-right font-semibold text-emerald-600 tabular-nums">{fmt(toNum(totals.income))}</TableCell>
                <TableCell className="text-right font-semibold text-red-600 tabular-nums">{fmt(toNum(totals.expense))}</TableCell>
                <TableCell className={cn('text-right font-semibold tabular-nums', toNum(totals.profit) < 0 ? 'text-red-600' : 'text-gray-900')}>{fmt(toNum(totals.profit))}</TableCell>
                <TableCell className="text-right text-xs text-muted-foreground tabular-nums">{fmtMargin(totals.income, totals.margin)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{fmt(toNum(totals.receivable))}</TableCell>
                <TableCell />
              </TableRow>
            </TableFooter>
          </Table>
        )}
      </Card>
    </div>
  )
}

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
    <dl className="grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
      {rows.map(([label, value]) => (
        <div key={label} className="min-w-0">
          <dt className="text-xs text-muted-foreground">{label}</dt>
          <dd className="mt-0.5 break-words text-[13px] text-gray-900">{value}</dd>
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

  const linkCls = 'inline-flex items-center gap-0.5 text-[13px] font-medium text-gray-900 underline-offset-4 hover:underline'

  return (
    <div className={cn('grid grid-cols-1 gap-4', showFunds && showTax && 'lg:grid-cols-3')}>
      {showFunds && (
        <Card className={cn('min-w-0 p-5', showTax && 'lg:col-span-2')}>
          <div className="mb-4 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <CardTitle>Funds</CardTitle>
              <CardDescription>
                {data?.asOf ? `As of ${fmtDate(data.asOf)}` : 'Current balances'}
              </CardDescription>
            </div>
            <div className="shrink-0 text-right">
              {data && data.count > 0 && <p className="text-lg font-semibold tracking-tight text-gray-900 tabular-nums">{fmtTk(data.totalBDT)}</p>}
              {canManageAccounts && (
                <Link href="/admin/finance/accounts" className={linkCls}>
                  Money accounts <ChevronRight className="size-3.5 text-gray-400" />
                </Link>
              )}
            </div>
          </div>

          {!data ? (
            optLoading && canPickAccounts ? (
              <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" /> Loading balances…</p>
            ) : (
              <p className="text-sm text-muted-foreground">No money accounts yet.</p>
            )
          ) : data.count === 0 ? (
            <p className="text-sm text-muted-foreground">No money accounts yet.</p>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap gap-2">
                {FUND_GROUPS.filter(g => g.key !== 'other' || toNum(data.byGroup?.other) !== 0).map(g => (
                  <span key={g.key} className="inline-flex items-center gap-1.5 rounded-md bg-gray-50 px-2.5 py-1 text-xs">
                    <span className="text-muted-foreground">{g.label}</span>
                    <span className={cn('font-medium tabular-nums', toNum(data.byGroup?.[g.key]) < 0 ? 'text-red-600' : 'text-gray-900')}>{fmtTk(data.byGroup?.[g.key])}</span>
                  </span>
                ))}
                {(data.foreign ?? []).map(f => (
                  <span key={f.currency} className="inline-flex items-center gap-1.5 rounded-md bg-gray-50 px-2.5 py-1 text-xs">
                    <span className="font-mono text-[11px] text-muted-foreground">{f.currency}</span>
                    <span className="font-medium text-gray-900 tabular-nums">{formatMoney(f.balance, f.currency)}</span>
                  </span>
                ))}
              </div>
              <div className="-mx-1 flex gap-3 overflow-x-auto px-1 pb-1">
                {data.accounts.map(a => (
                  <div key={a.id} className="min-w-[170px] max-w-[220px] shrink-0 rounded-lg border border-gray-200/80 px-3 py-2.5">
                    <p className="truncate text-[13px] font-medium text-gray-900" title={a.name}>{a.name}</p>
                    <p className="truncate text-xs text-muted-foreground">
                      {accountTypeLabel(a.type)}{a.last4 ? ` ••${a.last4}` : ''}{a.currency && a.currency !== BASE_CURRENCY ? ` · ${a.currency}` : ''}
                    </p>
                    <p className={cn('mt-1 text-sm font-semibold tabular-nums', toNum(a.balance) < 0 ? 'text-red-600' : 'text-gray-900')}>{money(a.balance, a.currency)}</p>
                    {toNum(a.unclearedCount) > 0 && (
                      <p className="text-[11px] text-muted-foreground">{a.unclearedCount} uncleared</p>
                    )}
                  </div>
                ))}
              </div>
            </>
          )}
        </Card>
      )}

      {showTax && (
        <Card className="min-w-0 p-5">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div>
              <CardTitle>Tax position</CardTitle>
              <CardDescription>Open VAT / VDS / TDS items</CardDescription>
            </div>
            {canSeeTax && (
              <Link href="/admin/tax" className={cn(linkCls, 'shrink-0')}>
                Tax dashboard <ChevronRight className="size-3.5 text-gray-400" />
              </Link>
            )}
          </div>
          {taxRows.length === 0 ? (
            <p className="text-sm text-muted-foreground">No open tax items.</p>
          ) : (
            <ul className="divide-y divide-gray-100">
              {taxRows.map(r => (
                <li key={r.key} className="flex items-center justify-between gap-3 py-2 text-[13px]">
                  <span className="min-w-0 text-gray-600">
                    {r.label} <span className="text-muted-foreground tabular-nums">({r.v.count})</span>
                    {r.overdue && <Badge variant="danger" className="ml-1.5">{r.overdue}</Badge>}
                  </span>
                  <span className="whitespace-nowrap font-medium text-gray-900 tabular-nums">{fmtTk(r.v.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
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
    <span className={cn(
      'inline-flex items-center gap-0.5 rounded-full px-1.5 py-0.5 text-xs font-medium ring-1 ring-inset tabular-nums',
      neutral  ? 'bg-gray-100 text-gray-600 ring-gray-500/10' :
      positive ? 'bg-emerald-50 text-emerald-700 ring-emerald-600/15' : 'bg-red-50 text-red-700 ring-red-600/15'
    )}>
      {!neutral && (positive
        ? <ArrowUpRight className="size-3" />
        : <ArrowDownRight className="size-3" />)}
      {neutral ? 'No change' : `${Math.abs(change)}%`}
    </span>
  )
}


function AccountsContent() {
  const { paymentMethods, expenseCategories, incomeCategories, config } = useConfig()
  const fmtMethod = v => v ? (paymentMethods.find(m => m.value === v)?.label ?? v.replace(/_/g, ' ')) : '—'
  const { data: session }  = useSession()
  const router             = useRouter()
  const searchParams       = useSearchParams()
  const activeTab          = searchParams.get('tab') || 'overview'
  // Deep link into Transactions (Ventures & products → "View transactions"):
  // ?tab=transactions&unit=VENTURE:ENTECH&from=YYYY-MM-DD&to=YYYY-MM-DD
  const unitParam          = searchParams.get('unit')
  const fromParam          = searchParams.get('from')
  const toParam            = searchParams.get('to')
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
  const [txUnit,    setTxUnit]    = useState(() => unitParam ?? '')   // '' all · UNASSIGNED · a unit value
  const [txExpanded, setTxExpanded] = useState(null)   // id of the row showing its tax / P&L breakdown
  const [changingUnitTx, setChangingUnitTx] = useState(null)   // row → ChangeUnitModal
  const [txPage,    setTxPage]    = useState(1)
  const [period,    setPeriod]    = useState('month')
  const [startDate, setStartDate] = useState(() => {
    if (isDayKey(fromParam)) return fromParam
    const now = new Date()
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  })
  const [endDate,   setEndDate]   = useState(() => (isDayKey(toParam) ? toParam : ymdLocal(new Date())))
  const [plStart,   setPlStart]   = useState(() => `${new Date().getFullYear()}-01-01`)
  const [plEnd,     setPlEnd]     = useState(() => ymdLocal(new Date()))
  const [plUnit,    setPlUnit]    = useState('')
  const [ovUnit,    setOvUnit]    = useState('')       // overview: '' = all units (dashboard KPI cards)
  // Ventures & products tab period (default: the current fiscal year, July–June).
  const [unFrom,    setUnFrom]    = useState(() => fiscalYearDays(0).from)
  const [unTo,      setUnTo]      = useState(() => fiscalYearDays(0).to)

  // Follow a later deep link (the page stays mounted when only the query changes).
  useEffect(() => {
    if (unitParam === null) return
    setTxUnit(unitParam)
    if (isDayKey(fromParam)) setStartDate(fromParam)
    if (isDayKey(toParam))   setEndDate(toParam)
    setTxPage(1)
  }, [unitParam, fromParam, toParam])

  function viewUnitTransactions(unit) {
    setTxUnit(unit)
    setTxType(''); setTxCategory(''); setTxSubcategory(''); setTxAccount(''); setTxKind('')
    if (unFrom) setStartDate(unFrom)
    if (unTo)   setEndDate(unTo)
    setTxPage(1)
    const qs = new URLSearchParams({ tab: 'transactions', unit })
    if (unFrom) qs.set('from', unFrom)
    if (unTo)   qs.set('to', unTo)
    router.push(`/admin/accounts?${qs}`)
  }

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
      if (ovUnit)    params.set('unit',      ovUnit)
      const res  = await fetch(`/api/accounts/summary?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setSummary(json.data)
    } catch (err) {
      toast.error(err.message ?? 'Failed to load summary')
    } finally {
      setLoading(false)
    }
  }, [startDate, endDate, ovUnit, session])

  const loadTransactions = useCallback(async () => {
    setTxLoading(true)
    try {
      const params = new URLSearchParams({ page: txPage, limit: 20 })
      if (txType)    params.set('type',      txType)
      if (txCategory) params.set('category', txCategory)
      if (txSubcategory) params.set('subcategory', txSubcategory)
      if (txAccount) params.set('accountId', txAccount)
      if (txKind)    params.set('kind', txKind)
      if (txUnit)    params.set('unit', txUnit)
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
  }, [txPage, txType, txCategory, txSubcategory, txAccount, txKind, txUnit, startDate, endDate])

  const loadPL = useCallback(async () => {
    setPlLoading(true)
    try {
      const params = new URLSearchParams()
      if (plStart) params.set('startDate', plStart)
      if (plEnd)   params.set('endDate',   plEnd)
      if (plUnit)  params.set('unit',      plUnit)
      const res  = await fetch(`/api/accounts/pl-report?${params}`)
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setPlReport(json.data)
    } catch (err) {
      toast.error(err.message ?? 'Failed to load P&L')
    } finally {
      setPlLoading(false)
    }
  }, [plStart, plEnd, plUnit])

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
      toast.success('Expense request submitted')
      loadPaymentRequests()
    } else {
      toast.success(editingTx ? 'Transaction updated' : 'Transaction added')
    }
    setEditingTx(null)
    loadSummary()
    loadTransactions()
  }

  // ── Spinner ───────────────────────────────────────────────────────────────

  const Spinner = () => <LoadingSpinner className="h-40" />

  // ── Render ────────────────────────────────────────────────────────────────

  const PAGE_TITLES = {
    overview:      'Finance overview',
    transactions:  'Transactions',
    confirmations: 'Payment confirmations',
    requests:      'Payment requests',
    withdrawals:   'Withdrawals',
    pl:            'Profit & loss',
    units:         'Ventures & products',
  }

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
      <PageHeader
        title={PAGE_TITLES[activeTab] ?? 'Accounts'}
        actions={(activeTab === 'overview' || activeTab === 'transactions') && canDo(session, 'finance.transactions.create') ? (
          <Button onClick={() => { setEditingTx(null); setModalOpen(true) }}>
            <Plus /> New transaction
          </Button>
        ) : null}
      />

      {/* ── OVERVIEW tab ── */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Date range selector */}
          <div className="flex flex-wrap items-center gap-2">
            <DatePicker value={startDate || null} onChange={v => setStartDate(v ?? '')} />
            <span className="text-sm text-muted-foreground">to</span>
            <DatePicker value={endDate || null} onChange={v => setEndDate(v ?? '')} />
            {(startDate || endDate) && (
              <Button variant="ghost" size="sm" onClick={() => { setStartDate(''); setEndDate('') }}>
                Clear
              </Button>
            )}
            {canDo(session, 'finance.overview.view') && (
              <div className="w-full sm:ml-auto sm:w-60">
                <UnitFilter value={ovUnit} onChange={setOvUnit} config={config} />
              </div>
            )}
          </div>

          {loading ? <Spinner /> : (summary || dashStats) ? (
            <>
              {(() => {
                const f = dashStats?.financials ?? {}
                const fmtVal = (n) => n == null ? '—' : `BDT ${Number(n).toLocaleString('en-BD', { minimumFractionDigits: 0 })}`
                // One venture / product: the period's figures from the summary. "All"
                // keeps the dashboard cards (this month vs last month).
                const unitPeriod = `${unitLabel(ovUnit, config ?? {})} · ${startDate ? fmtDate(startDate) : 'start'} – ${endDate ? fmtDate(endDate) : 'today'}`
                const CARDS = ovUnit && summary ? [
                  { label: 'Income',      value: fmtVal(summary.totalRevenue),  prev: unitPeriod },
                  { label: 'Expense',     value: fmtVal(summary.totalExpenses), prev: unitPeriod },
                  { label: 'Net profit',  value: fmtVal(summary.netProfit),     prev: unitPeriod },
                  { label: 'Margin',      value: `${toNum(summary.grossMargin).toFixed(1)}%`, prev: unitPeriod },
                  { label: 'Receivable',  value: fmtVal(summary.outstandingReceivables), prev: 'Outstanding invoices' },
                  { label: 'Transactions', value: toNum(summary.incomeCount) + toNum(summary.expenseCount), prev: unitPeriod },
                ] : [
                  { label: 'Monthly income',  value: fmtVal(f.income?.value),  prev: `vs ${fmtVal(f.income?.prevValue)} last month`,  change: f.income?.change },
                  { label: 'Monthly expense', value: fmtVal(f.expense?.value), prev: `vs ${fmtVal(f.expense?.prevValue)} last month`, change: f.expense?.change, invert: true },
                  { label: 'Net profit',      value: fmtVal(f.profit?.value),  prev: `vs ${fmtVal(f.profit?.prevValue)} last month`,  change: f.profit?.change },
                  { label: 'Gross margin',    value: `${f.grossMargin?.value ?? 0}%`,  prev: `was ${f.grossMargin?.prevValue ?? 0}% last month`,  change: f.grossMargin?.value  != null && f.grossMargin?.prevValue  != null ? (f.grossMargin.value  - f.grossMargin.prevValue)  : null },
                  { label: 'Expense ratio',   value: `${f.expenseRatio?.value ?? 0}%`, prev: `was ${f.expenseRatio?.prevValue ?? 0}% last month`, change: f.expenseRatio?.value != null && f.expenseRatio?.prevValue != null ? (f.expenseRatio.value - f.expenseRatio.prevValue) : null, invert: true },
                  { label: 'Transactions',    value: f.transactions?.value ?? 0,       prev: `${f.transactions?.prevValue ?? 0} last month`,      change: f.transactions?.change },
                ]
                const monthOptions = Array.from({ length: 6 }, (_, i) => ({ key: getDrillKey(i), label: getMonthLabel(i) }))
                return (
                  <>
                    <FundsTaxStrip funds={summary?.funds ?? null} taxPosition={summary?.taxPosition ?? null} session={session} />

                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-4 xl:grid-cols-3">
                        {CARDS.map(card => (
                          <Card key={card.label} className="p-5">
                            <div className="flex items-center justify-between gap-2">
                              <p className="truncate text-[13px] font-medium text-muted-foreground">{card.label}</p>
                              <TrendPill change={card.change} invert={card.invert} />
                            </div>
                            <p className="mt-2 text-2xl font-semibold tracking-tight text-gray-900 tabular-nums">{card.value}</p>
                            <p className="mt-1 text-xs text-muted-foreground">{card.prev}</p>
                          </Card>
                        ))}
                      </div>
                      <p
                        className="inline-flex cursor-help items-center gap-1.5 text-xs text-muted-foreground"
                        title="Client receipts count net of VAT, depreciation counts as an expense, and transfers, capital, loans, tax deposits and asset purchases are left out."
                      >
                        <Info className="size-3.5 shrink-0" />
                        Profit-and-loss basis
                      </p>
                    </div>

                    {/* Cash movements in the period that are not income or expense */}
                    {summary?.nonPlMovements?.length > 0 && (
                      <Card className="overflow-hidden">
                        <CardHeader className="border-b border-gray-100 pb-4">
                          <div>
                            <CardTitle>Other money movements</CardTitle>
                            <CardDescription>Change balances, not profit.</CardDescription>
                          </div>
                          <ArrowLeftRight className="size-4 text-gray-400" />
                        </CardHeader>
                        <Table className="min-w-[480px]">
                          <TableHeader>
                            <TableRow>
                              <TableHead>Kind</TableHead>
                              <TableHead className="text-right">Entries</TableHead>
                              <TableHead className="text-right">Money in</TableHead>
                              <TableHead className="text-right">Money out</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {summary.nonPlMovements.map(m => (
                              <TableRow key={m.kind}>
                                <TableCell className="font-medium text-gray-900">{m.label}</TableCell>
                                <TableCell className="text-right tabular-nums">{m.count}</TableCell>
                                <TableCell className="text-right tabular-nums">{m.inflow ? fmt(m.inflow) : '—'}</TableCell>
                                <TableCell className="text-right tabular-nums">{m.outflow ? fmt(m.outflow) : '—'}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </Card>
                    )}

                    {/* By-currency breakdown — original totals + their BDT-equivalent */}
                    {summary?.currencyBreakdown?.length > 0 && (
                      <Card className="overflow-hidden">
                        <CardHeader className="border-b border-gray-100 pb-4">
                          <div>
                            <CardTitle>By currency</CardTitle>
                            <CardDescription>Original amounts behind the BDT totals.</CardDescription>
                          </div>
                        </CardHeader>
                        <Table className="min-w-[640px]">
                          <TableHeader>
                            <TableRow>
                              <TableHead>Currency</TableHead>
                              <TableHead className="text-right">Transactions</TableHead>
                              <TableHead className="text-right">Income (orig.)</TableHead>
                              <TableHead className="text-right">Expense (orig.)</TableHead>
                              <TableHead className="text-right">Income (BDT)</TableHead>
                              <TableHead className="text-right">Expense (BDT)</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {summary.currencyBreakdown.map(c => (
                              <TableRow key={c.currency}>
                                <TableCell className="font-mono text-xs font-medium text-gray-900">{c.currency}</TableCell>
                                <TableCell className="text-right tabular-nums">{c.count}</TableCell>
                                <TableCell className="text-right tabular-nums">{c.incomeOriginal ? formatCurrency(c.incomeOriginal, c.currency) : '—'}</TableCell>
                                <TableCell className="text-right tabular-nums">{c.expenseOriginal ? formatCurrency(c.expenseOriginal, c.currency) : '—'}</TableCell>
                                <TableCell className="text-right text-emerald-600 tabular-nums">{c.incomeBDT ? fmt(c.incomeBDT) : '—'}</TableCell>
                                <TableCell className="text-right text-red-600 tabular-nums">{c.expenseBDT ? fmt(c.expenseBDT) : '—'}</TableCell>
                              </TableRow>
                            ))}
                          </TableBody>
                        </Table>
                      </Card>
                    )}

                    {/* The daily breakdown covers every unit, so it is shown for "All" only. */}
                    {!ovUnit && (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="text-[13px] text-muted-foreground">Daily breakdown</span>
                        <Tabs
                          size="sm"
                          value={drillKey}
                          onChange={v => setDrillKey(prev => prev === v ? null : v)}
                          tabs={monthOptions.map(m => ({ value: m.key, label: m.label }))}
                        />
                      </div>
                    )}
                    {!ovUnit && drillKey && <CalendarDrillDown drillKey={drillKey} onClose={() => setDrillKey(null)} />}
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
          <div className="flex flex-wrap items-center gap-2">
            <DatePicker value={startDate || null} onChange={v => { setStartDate(v ?? ''); setTxPage(1) }} />
            <span className="text-sm text-muted-foreground">to</span>
            <DatePicker value={endDate || null} onChange={v => { setEndDate(v ?? ''); setTxPage(1) }} />
            {(startDate || endDate) && (
              <Button variant="ghost" size="sm" onClick={() => { setStartDate(''); setEndDate(''); setTxPage(1) }}>Clear</Button>
            )}
            <Tabs
              className="ml-auto"
              value={txType}
              onChange={v => { setTxType(v); setTxCategory(''); setTxSubcategory(''); setTxPage(1) }}
              tabs={[{ value: '', label: 'All' }, { value: 'INCOME', label: 'Income' }, { value: 'EXPENSE', label: 'Expense' }]}
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <div className="w-full sm:w-44">
              <Select
                value={txCategory}
                onChange={v => { setTxCategory(v ?? ''); setTxSubcategory(''); setTxPage(1) }}
                options={txCategoryOptions.map(c => ({ value: c, label: c }))}
                placeholder="All categories"
              />
            </div>
            <div className="w-full sm:w-44">
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
            <div className="w-full sm:w-48">
              <NativeSelect value={txKind} onChange={e => { setTxKind(e.target.value); setTxPage(1) }} className="text-[13px]">
                <option value="">All kinds</option>
                <option value={PL_KINDS.join(',')}>In P&amp;L (operating + non-cash)</option>
                <option value={NON_PL_KINDS.join(',')}>Not in P&amp;L (all)</option>
                {KIND_OPTIONS.map(k => <option key={k.value} value={k.value}>{k.label}{PL_KINDS.includes(k.value) ? '' : ' (not P&L)'}</option>)}
              </NativeSelect>
            </div>
            <div className="w-full sm:w-56">
              <UnitFilter value={txUnit} onChange={v => { setTxUnit(v); setTxPage(1) }} config={config} />
            </div>
            {(txAccount || txKind || txUnit) && (
              <Button variant="ghost" size="sm" onClick={() => { setTxAccount(''); setTxKind(''); setTxUnit(''); setTxPage(1) }}>
                <X /> Clear account / kind / unit
              </Button>
            )}
          </div>

          <Card className="overflow-hidden">
            {txLoading ? <Spinner /> : txList.length === 0 ? (
              <EmptyState title="No transactions" description="Try another period or filter." />
            ) : (
                <Table className="min-w-[980px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Date</TableHead>
                      <TableHead>Type</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Venture / product</TableHead>
                      <TableHead>Source / paid to</TableHead>
                      <TableHead>Description</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Account</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead>Ref</TableHead>
                      <TableHead><span className="sr-only">Actions</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
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
                      // Only P&L rows count in the venture / product reports (the rest are Company).
                      const retaggable = !nonPl && canDo(session, 'finance.transactions.update')
                      const rowActions = [
                        editable && { label: 'Edit transaction', icon: Pencil, onClick: () => { setEditingTx(tx); setModalOpen(true) } },
                        retaggable && { label: 'Change venture / product', icon: Tag, onClick: () => setChangingUnitTx(tx) },
                        reversible && { label: 'Reverse receipt', icon: RotateCcw, danger: true, onClick: () => setReversingTx(tx) },
                      ].filter(Boolean)
                      return (
                        <Fragment key={rowId}>
                          <TableRow className={cn(nonPl && 'bg-gray-50/40', expanded && 'border-b-0')}>
                            <TableCell className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">{fmtDate(tx.date)}</TableCell>
                            <TableCell>
                              <StatusDot status={tx.type} />
                              <div><KindBadge kind={kind} /></div>
                            </TableCell>
                            <TableCell className="text-[13px]">
                              <span>{tx.category}</span>
                              {tx.expenseCategory && <span className="block text-xs text-muted-foreground">{tx.expenseCategory}</span>}
                            </TableCell>
                            <TableCell className={cn('max-w-[150px] truncate text-[13px]', !tx.unit && 'text-amber-700', nonPl && 'text-muted-foreground')}
                              title={!tx.unit ? 'Older entry not yet placed in a venture or product' : undefined}>
                              {unitLabel(tx.unit, config ?? {})}
                            </TableCell>
                            <TableCell className="max-w-[160px] truncate text-[13px]">
                              {tx.paidToName ?? tx.vendor ?? tx.projectId?.name ?? tx.paidBy?.name ?? (tx.counterAccountId?.name ? `↔ ${tx.counterAccountId.name}` : '—')}
                            </TableCell>
                            <TableCell className="max-w-[200px] truncate text-[13px] text-gray-900" title={tx.description}>{tx.description}</TableCell>
                            <TableCell className={cn('whitespace-nowrap text-right font-medium tabular-nums',
                              nonPl ? 'text-gray-400' : tx.type === 'INCOME' ? 'text-emerald-600' : 'text-red-600'
                            )} title={nonPl ? 'Not counted in profit & loss' : undefined}>
                              {tx.type === 'INCOME' ? '+' : '-'}{formatCurrency(tx.amount, tx.currency)}
                              {plDiffers && (
                                <span className="block text-xs font-normal text-muted-foreground">P&amp;L {fmtTk(plVal)}</span>
                              )}
                              {tx.reversedBy && (
                                <span className="block text-xs font-normal text-amber-700">Reversed by {tx.reversedBy}</span>
                              )}
                            </TableCell>
                            <TableCell className="max-w-[150px] text-[13px]">
                              {acctInfo ? (
                                <span className="block truncate" title={acctInfo.name}>
                                  {acctInfo.name}
                                  <span className="block text-xs text-muted-foreground">{accountTypeLabel(acctInfo.type)}{acctInfo.last4 ? ` ••${acctInfo.last4}` : ''}</span>
                                </span>
                              ) : acctId ? (
                                <span className="text-muted-foreground">Linked account</span>
                              ) : kind === 'NON_CASH' ? (
                                <span className="text-muted-foreground">Non-cash</span>
                              ) : (
                                <span className="text-gray-300" title="Recorded before money accounts — edit to set one">—</span>
                              )}
                            </TableCell>
                            <TableCell className="text-[13px]">
                              {fmtMethod(tx.paymentMethod)}
                              {tx.channel && <span className="block text-xs text-muted-foreground">{PAYMENT_CHANNEL_LABELS[tx.channel] ?? tx.channel}</span>}
                            </TableCell>
                            <TableCell className="text-[13px]">
                              {docUrl(tx.receiptUrl) ? (
                                <a href={docUrl(tx.receiptUrl)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-gray-900 underline-offset-4 hover:underline">
                                  <Paperclip className="size-3.5 text-gray-400" /> Receipt
                                </a>
                              ) : tx.txnId ? (
                                <span className="font-mono text-xs">{tx.txnId}</span>
                              ) : '—'}
                            </TableCell>
                            <TableCell className="py-2">
                              <div className="flex items-center justify-end gap-0.5">
                                {canExpand && (
                                  <Button variant="ghost" size="icon-sm" onClick={() => setTxExpanded(expanded ? null : rowId)}
                                    title={expanded ? 'Hide details' : 'Tax & P&L details'}
                                    aria-label={expanded ? 'Hide details' : 'Tax & P&L details'}
                                    aria-expanded={expanded}
                                    className="text-gray-400">
                                    <ChevronDown className={cn('size-4 transition-transform', expanded && 'rotate-180')} />
                                  </Button>
                                )}
                                {/* Edit, change venture / product, reverse a client receipt (wrong amount, account or date). */}
                                {rowActions.length > 0 ? (
                                  <ActionMenu items={rowActions} />
                                ) : (
                                  <span className="size-8" aria-hidden="true" />
                                )}
                              </div>
                            </TableCell>
                          </TableRow>
                          {expanded && (
                            <TableRow className="bg-gray-50/60 hover:bg-gray-50/60">
                              <TableCell colSpan={11} className="px-4 py-3">
                                <TxBreakdown tx={tx} nonPl={nonPl} plVal={plVal} cashBDT={cashBDT} />
                              </TableCell>
                            </TableRow>
                          )}
                        </Fragment>
                      )
                    })}
                  </TableBody>
                </Table>
            )}
            {txMeta.pages > 1 && (
              <div className="border-t border-gray-100 px-4 py-3">
                <Pagination meta={txMeta} page={txPage} onPageChange={setTxPage} />
              </div>
            )}
          </Card>
        </div>
      )}

      {/* ── PAYMENT CONFIRMATIONS tab ── */}
      {activeTab === 'confirmations' && (
        <div className="space-y-4">
          <Tabs
            value={pcStatus}
            onChange={v => { setPcStatus(v); setPcPage(1) }}
            tabs={[['PENDING_CONFIRMATION', 'Pending'], ['CONFIRMED', 'Confirmed'], ['REJECTED', 'Rejected'], ['REVERSED', 'Reversed'], ['', 'All']].map(([v, l]) => ({ value: v, label: l }))}
          />

          <Card className="overflow-hidden">
            {pcLoading ? <Spinner /> : pcList.length === 0 ? (
              <EmptyState title="No payment confirmations" />
            ) : (
                <Table className="min-w-[600px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead>Project</TableHead>
                      <TableHead>Client</TableHead>
                      <TableHead>Invoice</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Submitted by</TableHead>
                      <TableHead><span className="sr-only">Actions</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {pcList.map(pc => (
                      <TableRow key={pc.id ?? pc._id}>
                        <TableCell>
                          <p className="text-[13px] font-medium text-gray-900">{pc.projectId?.name ?? '—'}</p>
                          {pc.projectId?.projectCode && (
                            <p className="font-mono text-xs text-muted-foreground">{pc.projectId.projectCode}</p>
                          )}
                        </TableCell>
                        <TableCell className="text-[13px]">{pc.clientId?.userId?.name ?? '—'}</TableCell>
                        <TableCell className="text-[13px] text-muted-foreground">{pc.invoiceId?.invoiceNumber ?? '—'}</TableCell>
                        <TableCell className="whitespace-nowrap text-right font-medium text-gray-900 tabular-nums">
                          {formatCurrency(pc.amount, pc.currency)}
                          {(toNum(pc.vdsAmount) > 0 || toNum(pc.tdsAmount) > 0) && (
                            <span className="block text-xs font-normal text-muted-foreground">
                              {toNum(pc.vdsAmount) > 0 ? `+ VDS ${fmtTk(pc.vdsAmount)}` : ''}
                              {toNum(pc.vdsAmount) > 0 && toNum(pc.tdsAmount) > 0 ? ' · ' : ''}
                              {toNum(pc.tdsAmount) > 0 ? `+ TDS ${fmtTk(pc.tdsAmount)}` : ''}
                            </span>
                          )}
                          {pc.accountId?.name && <span className="block text-xs font-normal text-muted-foreground">into {pc.accountId.name}</span>}
                        </TableCell>
                        <TableCell>
                          <StatusDot status={pc.status} />
                          {pc.status === 'REVERSED' && (
                            <span className="mt-1 block max-w-[200px] truncate text-xs text-muted-foreground" title={pc.reversalReason ?? undefined}>
                              {pc.reversedBy?.name ? `by ${pc.reversedBy.name}` : ''}{pc.reversedBy?.name && pc.reversalReason ? ' — ' : ''}{pc.reversalReason ?? ''}
                            </span>
                          )}
                        </TableCell>
                        <TableCell className="text-[13px] text-muted-foreground">{pc.submittedBy?.name ?? '—'}</TableCell>
                        <TableCell className="py-2">
                          <div className="flex items-center justify-end gap-2">
                            {pc.status === 'PENDING_CONFIRMATION' && (
                              <Button size="xs" variant="outline" onClick={() => setConfirmingPc(pc)}>
                                Review
                              </Button>
                            )}
                            {pc.status === 'CONFIRMED' && canDo(session, 'finance.payments.confirm') && (
                              <Button size="xs" variant="outline" onClick={() => setReversingPc(pc)} title="Reverse this payment (wrong amount, account, VDS / TDS or date)"
                                className="text-red-600 hover:bg-red-50 hover:text-red-700">
                                <RotateCcw /> Reverse payment
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
            )}
            {pcMeta.pages > 1 && (
              <div className="border-t border-gray-100 px-4 py-3">
                <Pagination meta={pcMeta} page={pcPage} onPageChange={setPcPage} />
              </div>
            )}
          </Card>
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
        // '' = "All dates" (no range); a hand-picked range highlights no preset.
        const presetValue   = prPreset ? prPreset : (!prStart && !prEnd ? '' : '__custom__')
        const filterLabel   = 'mb-1.5 block text-xs text-muted-foreground'
        const cb            = 'size-4 rounded border-gray-300'
        return (
        <div className="space-y-4">
          {/* Status filter */}
          <Tabs
            value={prStatus}
            onChange={v => { setPrStatus(v); setPrPage(1); setPrSelected([]) }}
            tabs={[['PENDING', 'Pending'], ['PAID', 'Paid'], ['AUTHORIZED', 'Authorized'], ['REJECTED', 'Rejected'], ['', 'All']].map(([v, l]) => ({ value: v, label: l }))}
          />

          {/* Date + category filters */}
          <Card className="flex flex-wrap items-end gap-3 p-3">
            <Tabs
              size="sm"
              className="self-end"
              value={presetValue}
              onChange={selectPreset}
              tabs={[['today', 'Today'], ['yesterday', 'Yesterday'], ['7d', 'Last 7 days'], ['month', 'This month'], ['', 'All dates']].map(([v, l]) => ({ value: v, label: l }))}
            />
            <div className="flex items-end gap-2">
              <div>
                <label className={filterLabel}>From</label>
                <DatePicker value={prStart || null} onChange={v => setCustom('start', v)} />
              </div>
              <div>
                <label className={filterLabel}>To</label>
                <DatePicker value={prEnd || null} onChange={v => setCustom('end', v)} />
              </div>
            </div>
            <div className="min-w-[160px]">
              <label className={filterLabel}>Category</label>
              <NativeSelect value={prCategory} onChange={e => { setPrCategory(e.target.value); setPrSubcategory(''); setPrPage(1) }} className="text-[13px]">
                <option value="">All categories</option>
                {expenseCategories.map(c => <option key={c.id ?? c.label} value={c.label}>{c.label}</option>)}
              </NativeSelect>
            </div>
            <div className="min-w-[160px]">
              <label className={filterLabel}>Subcategory</label>
              <NativeSelect value={prSubcategory} onChange={e => { setPrSubcategory(e.target.value); setPrPage(1) }}
                disabled={!prCategory || subOptions.length === 0} className="text-[13px]">
                <option value="">All subcategories</option>
                {subOptions.map(s => <option key={s} value={s}>{s}</option>)}
              </NativeSelect>
            </div>
            {(prCategory || prSubcategory || prStart || prEnd) && (
              <Button variant="ghost" onClick={() => { setPrCategory(''); setPrSubcategory(''); setPrStart(''); setPrEnd(''); setPrPreset(''); setPrPage(1) }}>
                Clear
              </Button>
            )}
          </Card>

          {/* Batch action bar (paid + confirmer) — authorize a group with one combined invoice */}
          {showBatch && prSelected.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-gray-200/80 bg-gray-50 px-4 py-3">
              <p className="text-sm text-gray-700">
                <span className="font-semibold text-gray-900">{prSelected.length}</span> selected · Total <span className="font-medium text-gray-900 tabular-nums"><TkAmt value={selectedTotal} decimals={2} /> BDT</span>
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <a href={`/api/expenses/combined-voucher?ids=${prSelected.join(',')}`} target="_blank" rel="noreferrer"
                  className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                  <Printer /> Combined invoice
                </a>
                <Button size="sm" onClick={() => setBatchAuthorizing(true)}>
                  <CheckCircle2 /> Authorize selected
                </Button>
              </div>
            </div>
          )}

          <Card className="overflow-hidden">
            {prLoading ? <Spinner /> : prList.length === 0 ? (
              <EmptyState title="No payment requests" />
            ) : (
                <Table className="min-w-[640px]">
                  <TableHeader>
                    <TableRow>
                      {showBatch && (
                        <TableHead className="w-9">
                          <input type="checkbox" checked={allSelected} onChange={toggleAll}
                            disabled={selectableIds.length === 0}
                            aria-label="Select all paid"
                            className={cb} />
                        </TableHead>
                      )}
                      <TableHead>Title</TableHead>
                      <TableHead>Category</TableHead>
                      <TableHead>Project</TableHead>
                      <TableHead>Voucher</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Submitted by</TableHead>
                      <TableHead>Date</TableHead>
                      <TableHead><span className="sr-only">Actions</span></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {prList.map(pr => (
                      <TableRow key={pr.id ?? pr._id}>
                        {showBatch && (
                          <TableCell>
                            {pr.status === 'PAID' && (
                              <input type="checkbox" checked={prSelected.includes(pr.id ?? pr._id)}
                                onChange={() => toggleOne(pr.id ?? pr._id)}
                                aria-label="Select request"
                                className={cb} />
                            )}
                          </TableCell>
                        )}
                        <TableCell className="max-w-[180px]">
                          <button onClick={() => setDetailPr(pr)}
                            className="block w-full truncate text-left text-[13px] font-medium text-gray-900 underline-offset-4 hover:underline">
                            {pr.title ?? pr.description ?? '—'}
                          </button>
                          {pr.origin === 'REIMBURSEMENT' && (
                            <Badge variant="indigo" className="mt-1">Reimbursement</Badge>
                          )}
                          <PurchaseBillLink expense={pr} compact />
                        </TableCell>
                        <TableCell className="text-[13px]">
                          <span>{pr.category ?? '—'}</span>
                          {pr.subcategory && <span className="block text-xs text-muted-foreground">{pr.subcategory}</span>}
                        </TableCell>
                        <TableCell className="text-[13px] text-muted-foreground">{pr.projectId?.name ?? (pr.origin === 'SALARY' ? 'Salary' : '—')}</TableCell>
                        <TableCell className="whitespace-nowrap font-mono text-xs text-muted-foreground">{pr.expenseInvoiceNo ?? '—'}</TableCell>
                        <TableCell className="whitespace-nowrap text-right font-medium text-gray-900 tabular-nums">{formatCurrency(pr.amount, pr.currency)}</TableCell>
                        <TableCell><StatusDot status={pr.status} /></TableCell>
                        <TableCell className="text-[13px] text-muted-foreground">{pr.submittedBy?.name ?? (pr.origin === 'SALARY' ? 'System' : '—')}</TableCell>
                        <TableCell className="whitespace-nowrap text-xs text-muted-foreground tabular-nums">{fmtDate(pr.date ?? pr.createdAt)}</TableCell>
                        <TableCell className="py-2">
                          <div className="flex items-center justify-end gap-1.5">
                            {pr.status === 'PENDING' && (
                              <Button size="xs" variant="outline" onClick={() => setPayingPr(pr)}>
                                Review
                              </Button>
                            )}
                            {pr.status === 'PAID' && (
                              <>
                                <a href={`/api/expenses/${pr.id ?? pr._id}/voucher`} target="_blank" rel="noreferrer"
                                  className={buttonVariants({ variant: 'ghost', size: 'xs' })}>
                                  <Printer /> Invoice
                                </a>
                                <Button size="xs" variant="outline" onClick={() => setAuthorizingPr(pr)}>
                                  Authorize
                                </Button>
                              </>
                            )}
                            {canConfirm && (pr.status === 'PAID' || pr.status === 'AUTHORIZED') && (
                              <Button size="xs" variant="outline" onClick={() => setReversingPr(pr)} title="Reverse this payment (wrong amount, account, VDS or TDS)"
                                className="text-red-600 hover:bg-red-50 hover:text-red-700">
                                <RotateCcw /> Reverse payment
                              </Button>
                            )}
                            {pr.status === 'AUTHORIZED' && (
                              <>
                                <a href={`/api/expenses/${pr.id ?? pr._id}/voucher`} target="_blank" rel="noreferrer"
                                  className={buttonVariants({ variant: 'ghost', size: 'xs' })}>
                                  <Printer /> Invoice
                                </a>
                                {docUrl(pr.signedInvoiceUrl) && (
                                  <a href={docUrl(pr.signedInvoiceUrl)} target="_blank" rel="noopener noreferrer"
                                    className={cn(buttonVariants({ variant: 'ghost', size: 'xs' }), 'text-emerald-700 hover:text-emerald-800')}>
                                    <FileTextIcon /> Authorized
                                  </a>
                                )}
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
            )}
            {prMeta.pages > 1 && (
              <div className="border-t border-gray-100 px-4 py-3">
                <Pagination meta={prMeta} page={prPage} onPageChange={setPrPage} />
              </div>
            )}
          </Card>

          {/* Edit Requests section for owners */}
          {editRequests.length > 0 && (
            <Card className="overflow-hidden">
              <CardHeader className="border-b border-gray-100 pb-4">
                <div className="flex items-center gap-2">
                  <CardTitle>Pending edit requests</CardTitle>
                  <Badge variant="warning">{editRequests.length}</Badge>
                </div>
              </CardHeader>
              <div className="divide-y divide-gray-100">
                {editRequests.map(er => (
                  <div key={er.id ?? er._id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
                    <div className="min-w-0">
                      <p className="text-sm font-medium text-gray-900">{er.requesterId?.name ?? '—'} wants to edit an expense</p>
                      {er.reason && <p className="mt-0.5 text-xs text-muted-foreground">{er.reason}</p>}
                    </div>
                    <div className="flex shrink-0 gap-2">
                      <Button size="sm" variant="ghost" onClick={() => setRejectingEr(er)}>
                        Reject
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => handleApproveEditRequest(er)}>
                        <CheckCircle2 /> Approve
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>
        )
      })()}

      {/* ── WITHDRAWALS tab (removed — freelancer payments settle via Payment Requests) ── */}
      {activeTab === 'withdrawals' && (
        <Card>
          <EmptyState
            title="Withdrawals moved"
            description="Freelancer & agency payments are settled in Payment requests."
            action={<Button variant="outline" size="sm" href="/admin/accounts?tab=requests">Open payment requests</Button>}
          />
        </Card>
      )}

      {/* ── P&L REPORT tab ── */}
      {activeTab === 'pl' && (
        <div className="space-y-6">
          {/* Date range */}
          <div className="flex flex-wrap items-center gap-2">
            <DatePicker value={plStart || null} onChange={v => setPlStart(v ?? '')} />
            <span className="text-sm text-muted-foreground">to</span>
            <DatePicker value={plEnd || null} onChange={v => setPlEnd(v ?? '')} />
            <div className="w-full sm:w-60">
              <UnitFilter value={plUnit} onChange={setPlUnit} config={config} />
            </div>
            <Button onClick={loadPL}>Apply</Button>
            <Link href="/admin/accounts?tab=units"
              className="inline-flex items-center gap-0.5 text-[13px] font-medium text-gray-900 underline-offset-4 hover:underline sm:ml-auto">
              By venture &amp; product <ChevronRight className="size-3.5 text-gray-400" />
            </Link>
          </div>

          {plLoading ? <Spinner /> : plReport ? (
            <>
              {/* Summary cards */}
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
                  {[
                    { label: 'Total income',  value: fmt(plReport.summary?.totalIncome) },
                    { label: 'Total expense', value: fmt(plReport.summary?.totalExpense) },
                    { label: 'Net profit',    value: fmt(plReport.summary?.netProfit), negative: plReport.summary?.netProfit < 0 },
                    { label: 'Margin',        value: `${(plReport.summary?.margin ?? 0).toFixed(1)}%` },
                  ].map(c => (
                    <Card key={c.label} className="p-5">
                      <p className="truncate text-[13px] font-medium text-muted-foreground">{c.label}</p>
                      <p className={cn('mt-2 text-2xl font-semibold tracking-tight tabular-nums', c.negative ? 'text-red-600' : 'text-gray-900')}>{c.value}</p>
                    </Card>
                  ))}
                </div>
                <div className="flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-muted-foreground">
                  <span
                    className="inline-flex cursor-help items-center gap-1.5"
                    title="Receipts count net of VAT; transfers, capital, loans, tax deposits and asset purchases are not income or expense."
                  >
                    <Info className="size-3.5 shrink-0" />
                    Profit-and-loss basis
                  </span>
                  {toNum(plReport.summary?.depreciation) > 0 && (
                    <span className="tabular-nums">Depreciation {fmt(plReport.summary.depreciation)} · EBITDA {fmt(plReport.summary.ebitda)}</span>
                  )}
                  {toNum(plReport.summary?.unconvertedCount) > 0 && (
                    <span className="inline-flex items-center gap-1.5 text-amber-700">
                      <AlertTriangle className="size-3.5 shrink-0" />
                      {plReport.summary.unconvertedCount} foreign-currency entr{plReport.summary.unconvertedCount === 1 ? 'y has' : 'ies have'} no BDT amount and {plReport.summary.unconvertedCount === 1 ? 'is' : 'are'} left out.
                    </span>
                  )}
                </div>
              </div>

              {/* Monthly breakdown */}
              {plReport.rows?.length > 0 && (
                <Card className="overflow-hidden">
                  <CardHeader className="border-b border-gray-100 pb-4">
                    <CardTitle>Monthly breakdown</CardTitle>
                  </CardHeader>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Month</TableHead>
                        <TableHead className="text-right">Income</TableHead>
                        <TableHead className="text-right">Expense</TableHead>
                        <TableHead className="text-right">Net profit</TableHead>
                        <TableHead className="text-right">Margin</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {plReport.rows.map(row => {
                        const margin = row.totalIncome > 0 ? ((row.netProfit / row.totalIncome) * 100).toFixed(1) : '0.0'
                        return (
                          <TableRow key={row.month}>
                            <TableCell className="font-medium text-gray-900">{fmtMonth(row.month)}</TableCell>
                            <TableCell className="text-right text-emerald-600 tabular-nums">{fmt(row.totalIncome)}</TableCell>
                            <TableCell className="text-right text-red-600 tabular-nums">{fmt(row.totalExpense)}</TableCell>
                            <TableCell className={cn('text-right font-medium tabular-nums', row.netProfit >= 0 ? 'text-gray-900' : 'text-red-600')}>{fmt(row.netProfit)}</TableCell>
                            <TableCell className="text-right text-xs text-muted-foreground tabular-nums">{margin}%</TableCell>
                          </TableRow>
                        )
                      })}
                    </TableBody>
                    <TableFooter>
                      <TableRow className="hover:bg-transparent">
                        <TableCell className="font-semibold text-gray-900">Total</TableCell>
                        <TableCell className="text-right font-semibold text-emerald-600 tabular-nums">{fmt(plReport.summary?.totalIncome)}</TableCell>
                        <TableCell className="text-right font-semibold text-red-600 tabular-nums">{fmt(plReport.summary?.totalExpense)}</TableCell>
                        <TableCell className={cn('text-right font-semibold tabular-nums', plReport.summary?.netProfit >= 0 ? 'text-gray-900' : 'text-red-600')}>{fmt(plReport.summary?.netProfit)}</TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground tabular-nums">{(plReport.summary?.margin ?? 0).toFixed(1)}%</TableCell>
                      </TableRow>
                    </TableFooter>
                  </Table>
                </Card>
              )}
              {plReport.rows?.length === 0 && (
                <Card>
                  <EmptyState title="No income or expense in this period" />
                </Card>
              )}

              {/* Cash movements excluded from the P&L */}
              {plReport.nonPl?.length > 0 && (
                <Card className="overflow-hidden">
                  <CardHeader className="border-b border-gray-100 pb-4">
                    <div>
                      <CardTitle>Not in profit &amp; loss</CardTitle>
                      <CardDescription>Money moved, not income or expense.</CardDescription>
                    </div>
                  </CardHeader>
                  <Table className="min-w-[420px]">
                    <TableHeader>
                      <TableRow>
                        <TableHead>Kind</TableHead>
                        <TableHead className="text-right">Entries</TableHead>
                        <TableHead className="text-right">Money in</TableHead>
                        <TableHead className="text-right">Money out</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {plReport.nonPl.map(m => (
                        <TableRow key={m.kind}>
                          <TableCell className="text-gray-900">{m.label}</TableCell>
                          <TableCell className="text-right text-muted-foreground tabular-nums">{m.count}</TableCell>
                          <TableCell className="text-right tabular-nums">{m.inflow ? fmt(m.inflow) : '—'}</TableCell>
                          <TableCell className="text-right tabular-nums">{m.outflow ? fmt(m.outflow) : '—'}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </Card>
              )}
            </>
          ) : (
            <Card>
              <EmptyState title="No report yet" description="Pick a period and apply." />
            </Card>
          )}
        </div>
      )}

      {/* ── VENTURES & PRODUCTS tab ── */}
      {activeTab === 'units' && (
        <UnitsReport
          from={unFrom}
          to={unTo}
          setFrom={setUnFrom}
          setTo={setUnTo}
          onViewTransactions={viewUnitTransactions}
        />
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

      {changingUnitTx && (
        <ChangeUnitModal
          tx={changingUnitTx}
          onClose={() => setChangingUnitTx(null)}
          onDone={() => loadTransactions()}
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
        <DialogShell
          title="Reject edit request"
          onClose={() => { setRejectingEr(null); setRejectNote('') }}
          className="max-w-sm"
          footer={<>
            <Button variant="outline" onClick={() => { setRejectingEr(null); setRejectNote('') }}>Cancel</Button>
            <Button variant="destructive" onClick={() => handleRejectEditRequest(rejectingEr, rejectNote)}>Reject</Button>
          </>}
        >
          <Label>Reason</Label>
          <Textarea value={rejectNote} onChange={e => setRejectNote(e.target.value)} rows={3}
            placeholder="Optional"
            className="resize-none" />
        </DialogShell>
      )}

    </div>
  )
}

export default function AccountsPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <AccountsContent />
    </Suspense>
  )
}
