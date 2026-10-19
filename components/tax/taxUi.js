/**
 * components/tax/taxUi.js — PURE helpers & style tokens shared by the tax pages
 * and modals (safe for 'use client' components: no server imports).
 */

import { dhakaDayKey } from '@/lib/dhakaTime'
import { dayKeyLabel } from '@/lib/finance/fiscal'
import { TAX_ENTRY_TYPE_META, PAYEE_TYPES } from '@/lib/tax/catalog'
import { formatCurrency } from '@/lib/utils'

// ── style tokens ─────────────────────────────────────────────────────────────
export const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:bg-gray-50 disabled:text-gray-500'
export const labelCls = 'block text-xs font-medium text-gray-600 mb-1'
export const hintCls = 'mt-1 text-[11px] text-gray-400'
export const btnPrimary = 'inline-flex items-center justify-center gap-2 bg-gray-900 text-white hover:bg-gray-800 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
export const btnGhost = 'inline-flex items-center justify-center gap-2 border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
export const btnDanger = 'inline-flex items-center justify-center gap-2 bg-red-600 text-white hover:bg-red-700 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
export const cardCls = 'bg-white border border-gray-100 rounded-xl'

// ── tones (full class strings so Tailwind keeps them) ───────────────────────
export const TONES = {
  gray:    { badge: 'bg-gray-100 text-gray-600',       dot: 'bg-gray-400',    soft: 'bg-gray-50 border-gray-200 text-gray-700',       icon: 'bg-gray-100 text-gray-600' },
  blue:    { badge: 'bg-blue-50 text-blue-700',        dot: 'bg-blue-500',    soft: 'bg-blue-50 border-blue-100 text-blue-800',       icon: 'bg-blue-50 text-blue-600' },
  indigo:  { badge: 'bg-indigo-50 text-indigo-700',    dot: 'bg-indigo-500',  soft: 'bg-indigo-50 border-indigo-100 text-indigo-800', icon: 'bg-indigo-50 text-indigo-600' },
  purple:  { badge: 'bg-purple-50 text-purple-700',    dot: 'bg-purple-500',  soft: 'bg-purple-50 border-purple-100 text-purple-800', icon: 'bg-purple-50 text-purple-600' },
  teal:    { badge: 'bg-teal-50 text-teal-700',        dot: 'bg-teal-500',    soft: 'bg-teal-50 border-teal-100 text-teal-800',       icon: 'bg-teal-50 text-teal-600' },
  green:   { badge: 'bg-green-50 text-green-700',      dot: 'bg-green-500',   soft: 'bg-green-50 border-green-100 text-green-800',    icon: 'bg-green-50 text-green-600' },
  emerald: { badge: 'bg-emerald-50 text-emerald-700',  dot: 'bg-emerald-500', soft: 'bg-emerald-50 border-emerald-100 text-emerald-800', icon: 'bg-emerald-50 text-emerald-600' },
  amber:   { badge: 'bg-amber-50 text-amber-700',      dot: 'bg-amber-400',   soft: 'bg-amber-50 border-amber-200 text-amber-800',    icon: 'bg-amber-50 text-amber-600' },
  orange:  { badge: 'bg-orange-50 text-orange-700',    dot: 'bg-orange-500',  soft: 'bg-orange-50 border-orange-100 text-orange-800', icon: 'bg-orange-50 text-orange-600' },
  red:     { badge: 'bg-red-50 text-red-700',          dot: 'bg-red-500',     soft: 'bg-red-50 border-red-200 text-red-800',          icon: 'bg-red-50 text-red-600' },
  pink:    { badge: 'bg-pink-50 text-pink-700',        dot: 'bg-pink-500',    soft: 'bg-pink-50 border-pink-100 text-pink-800',       icon: 'bg-pink-50 text-pink-600' },
  cyan:    { badge: 'bg-cyan-50 text-cyan-700',        dot: 'bg-cyan-500',    soft: 'bg-cyan-50 border-cyan-100 text-cyan-800',       icon: 'bg-cyan-50 text-cyan-600' },
}
export const tone = (name) => TONES[name] ?? TONES.gray

export const ENTRY_TYPE_TONE = {
  OUTPUT_VAT: 'blue', INPUT_VAT: 'teal', VDS_RECEIVABLE: 'indigo', VDS_PAYABLE: 'orange',
  TDS_RECEIVABLE: 'purple', TDS_PAYABLE: 'amber', CREDIT_NOTE: 'pink', DEBIT_NOTE: 'red',
  VAT_PAYMENT: 'green', TDS_DEPOSIT: 'green', ADVANCE_TAX: 'emerald', VAT_ADJUSTMENT: 'gray', VAT_BALANCE_BF: 'cyan',
}

export const ENTRY_TYPE_OPTIONS = Object.entries(TAX_ENTRY_TYPE_META).map(([value, m]) => ({ value, label: m.label }))
export const entryTypeLabel = (t) => TAX_ENTRY_TYPE_META[t]?.label ?? t ?? '—'

export const CERT_STATUS_META = {
  NOT_REQUIRED: { label: 'Not required', tone: 'gray' },
  PENDING:      { label: 'Pending',      tone: 'amber' },
  RECEIVED:     { label: 'Received',     tone: 'green' },
  ISSUED:       { label: 'Issued',       tone: 'green' },
}
export const DEPOSIT_STATUS_META = {
  NOT_REQUIRED: { label: 'Not required',   tone: 'gray' },
  PENDING:      { label: 'To deposit',     tone: 'amber' },
  DEPOSITED:    { label: 'Deposited',      tone: 'green' },
  VIA_RETURN:   { label: 'Via VAT return', tone: 'blue' },
}

export const payeeTypeLabel = (t) => PAYEE_TYPES.find(p => p.value === t)?.label ?? '—'

// ── formatting ───────────────────────────────────────────────────────────────
export const tk = (n) => formatCurrency(Number(n) || 0, 'BDT')

/** '15 Oct 2026' (Asia/Dhaka) for a Date / ISO / 'YYYY-MM-DD'. */
export function fmtDay(v) {
  if (!v) return '—'
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return dayKeyLabel(v)
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) return '—'
  return dayKeyLabel(dhakaDayKey(d))
}

/** 'Oct 2026' for 'YYYY-MM'. */
export function fmtPeriod(p) {
  const m = /^(\d{4})-(\d{2})$/.exec(String(p ?? ''))
  if (!m) return p ?? '—'
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1)).toLocaleString('en-US', { month: 'short', year: 'numeric', timeZone: 'UTC' })
}

export const todayKey = () => dhakaDayKey(new Date())

/** 'Due today' / '3 days left' / '5 days overdue'. */
export function daysLeftText(n) {
  if (n === null || n === undefined || Number.isNaN(Number(n))) return ''
  if (n === 0) return 'Due today'
  if (n === 1) return '1 day left'
  if (n > 1) return `${n} days left`
  if (n === -1) return '1 day overdue'
  return `${-n} days overdue`
}

/** Tone for a days-left badge. */
export function daysLeftTone(n, { done = false } = {}) {
  if (done) return 'green'
  if (n === null || n === undefined) return 'gray'
  if (n < 0) return 'red'
  if (n <= 3) return 'orange'
  if (n <= 10) return 'amber'
  return 'gray'
}

// ── fetch ────────────────────────────────────────────────────────────────────
/** fetch + JSON; throws Error(json.error) with `.details` on a non-2xx response. */
export async function fetchJson(url, opts = {}) {
  const init = { ...opts }
  if (init.body && typeof init.body !== 'string') {
    init.body = JSON.stringify(init.body)
    init.headers = { 'Content-Type': 'application/json', ...(init.headers ?? {}) }
  }
  const res = await fetch(url, init)
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(firstError(json) || `Request failed (${res.status})`)
    err.status = res.status
    err.details = json.details ?? null
    throw err
  }
  return json
}

/** The most useful message from an API error body (zod field errors first). */
export function firstError(json) {
  if (!json) return null
  const fe = json.details?.fieldErrors
  if (json.error === 'Validation failed' && fe) {
    const [field, msgs] = Object.entries(fe).find(([, m]) => m?.length) ?? []
    if (field) return `${field}: ${msgs[0]}`
    const form = json.details?.formErrors?.[0]
    if (form) return form
  }
  return json.error ?? null
}

/** Open a printable document in a new tab. */
export function openPrint(url) {
  if (typeof window !== 'undefined') window.open(url, '_blank')
}

/** Same counter-party key as the server (one certificate = one party). */
export function partyKeyOf(e) {
  if (e?.partyKey) return e.partyKey
  if (e?.partyId) return `id:${String(e.partyId)}`
  const name = String(e?.partyName ?? '').trim().toLowerCase().replace(/\s+/g, ' ')
  const bin = String(e?.partyBin ?? '').replace(/\D/g, '')
  return `name:${name}|${bin}`
}

/** Fiscal-year options around today: ['2026-27', '2025-26', …]. */
export function fiscalYearOptions(count = 4, startMonth = 7) {
  const now = new Date()
  const d = new Date(now.getTime() + 6 * 3600 * 1000)
  const y = d.getUTCFullYear()
  const m = d.getUTCMonth() + 1
  const start = m >= startMonth ? y : y - 1
  const out = []
  for (let i = 0; i < count; i++) {
    const s = start - i
    out.push(startMonth === 1 ? String(s) : `${s}-${String((s + 1) % 100).padStart(2, '0')}`)
  }
  return out
}

export const sumAmount = (rows, field = 'amount') => Math.round((rows ?? []).reduce((s, r) => s + (Number(r?.[field]) || 0), 0) * 100) / 100

/** Tax already deposited on a TDS / VDS payable by part-paying challans (all of it once DEPOSITED). */
export function depositPaid(e) {
  if (e?.deposit?.status === 'DEPOSITED') return Number(e?.amount) || 0
  return Math.min(Number(e?.amount) || 0, Math.max(0, Number(e?.deposit?.paidAmount) || 0))
}

/** Tax still to deposit by challan on a TDS / VDS payable (0 unless its deposit is PENDING). */
export function depositBalance(e) {
  if (e?.deposit?.status !== 'PENDING') return 0
  return Math.max(0, Math.round(((Number(e?.amount) || 0) - (Number(e?.deposit?.paidAmount) || 0)) * 100) / 100)
}

/** Sum of depositBalance() over rows. */
export const sumBalance = (rows) => Math.round((rows ?? []).reduce((s, r) => s + depositBalance(r), 0) * 100) / 100
