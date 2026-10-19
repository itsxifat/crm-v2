/**
 * components/finance/accountTheme.js — presentation helpers for money
 * accounts (accent colours, groups, masked numbers, money formatting, CSV
 * download). Safe for client components. The class-string tokens below reuse
 * the shared UI primitives so finance screens match the rest of the app.
 */

import { cn, formatCurrency } from '@/lib/utils'
import { formatMoney } from '@/lib/currencies'
import { dhakaDayKey } from '@/lib/dhakaTime'
import { buttonVariants } from '@/components/ui/Button'
import { inputClass, selectClass } from '@/components/ui/Input'
import {
  accountTypeGroup, accountTypeLabel, MFS_PROVIDER_LABELS, BD_BANK_LIST,
} from '@/lib/finance/constants'

// ── House style tokens (same look as components/ui/Input + Button) ──────────
/** Text-like control. `items-center` keeps read-only <span> look-alikes vertically centred. */
export const INPUT = cn(inputClass, 'items-center')
/** Native <select> (keeps room for the chevron). */
export const SELECT = selectClass
export const INPUT_ERR = 'border-red-400 focus:border-red-400 focus:ring-red-500/15 focus-visible:border-red-400 focus-visible:ring-red-500/15'
export const LABEL = 'mb-2 block text-sm font-medium leading-none text-gray-900'
export const BTN_PRIMARY = buttonVariants({ variant: 'default' })
export const BTN_SECONDARY = buttonVariants({ variant: 'outline' })
export const BTN_DANGER = buttonVariants({ variant: 'destructive' })
/** ModalFooter className that keeps the footer pinned to the bottom of the scrolling modal body (body padding: px-4 sm:px-6, pb-4). */
export const FOOTER_STICKY = 'sticky -bottom-4 z-10 -mx-4 -mb-4 mt-6 sm:-mx-6'

export const ACCOUNT_GROUPS = [
  { key: 'bank',  label: 'Bank accounts',            short: 'Bank',           empty: 'No bank accounts yet.' },
  { key: 'cash',  label: 'Cash & petty cash',        short: 'Cash',           empty: 'No cash boxes yet.' },
  { key: 'mfs',   label: 'Mobile wallets',           short: 'Mobile wallets', empty: 'No mobile wallets yet.' },
  { key: 'other', label: 'Cards, gateways & loans',  short: 'Other',          empty: 'No cards, gateways or loan accounts.' },
]

/**
 * Categorical colours for the funds breakdown bar (bank, cash, mobile wallets, other).
 * Validated with the dataviz palette checker (adjacent CVD ΔE ≥ 9, normal-vision ≥ 24);
 * aqua is below 3:1 contrast, so the bar always ships with a labelled legend.
 */
export const FUND_GROUP_COLORS = { bank: '#2a78d6', cash: '#1baf7a', mfs: '#eb6834', other: '#6250d6' }

// Wallet brand colours (approximate brand palettes).
const MFS_COLORS = {
  BKASH:    '#E2136E',
  NAGAD:    '#F15A22',
  ROCKET:   '#8C3494',
  UPAY:     '#0B5CAB',
  TAP:      '#0EA5E9',
  MCASH:    '#00843D',
  OKWALLET: '#D7262E',
  OTHER:    '#64748B',
}

// A few well-known bank colours keyed by BD_BANK_LIST `short`.
const BANK_COLORS = {
  BRAC:        '#1D4E89',
  DBBL:        '#0F7A3A',
  EBL:         '#00573F',
  City:        '#C8102E',
  Prime:       '#1F3A93',
  Pubali:      '#0B6E4F',
  UCB:         '#B91C1C',
  MTB:         '#B4234A',
  'Bank Asia': '#0D4C92',
  'Dhaka Bank':'#1E40AF',
  IBBL:        '#00843D',
  Sonali:      '#C27C0E',
  Janata:      '#15803D',
  Agrani:      '#166534',
  Rupali:      '#0369A1',
  SCB:         '#0473EA',
  HSBC:        '#DB0011',
  Citi:        '#056DAE',
  Trust:       '#1E3A8A',
  'ONE Bank':  '#D7262E',
  NCC:         '#0E7490',
  IFIC:        '#1D4ED8',
  Southeast:   '#0F766E',
  Jamuna:      '#7C3AED',
  Midland:     '#0F766E',
}

const TYPE_COLORS = {
  BANK_CURRENT: '#2563EB',
  BANK_SAVINGS: '#4F46E5',
  CASH:         '#059669',
  PETTY_CASH:   '#0D9488',
  MFS:          '#DB2777',
  CARD:         '#475569',
  GATEWAY:      '#7C3AED',
  LOAN_OD:      '#D97706',
  OTHER:        '#64748B',
}

const FALLBACK_PALETTE = ['#2563EB', '#0F766E', '#7C3AED', '#B45309', '#BE123C', '#0369A1', '#4D7C0F', '#9333EA']

function hashString(s) {
  let h = 0
  const str = String(s ?? '')
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0
  return Math.abs(h)
}

/** BD_BANK_LIST entry whose name (or short name) matches a free-text bank name. */
export function findBank(bankName) {
  const n = String(bankName ?? '').trim().toLowerCase()
  if (!n) return null
  return BD_BANK_LIST.find(b => b.name.toLowerCase() === n)
    ?? BD_BANK_LIST.find(b => n.includes(b.short.toLowerCase()) || b.name.toLowerCase().startsWith(n))
    ?? null
}

/** Icon key for an account type (AccountIcon maps it to a lucide icon). */
export function accountIconKey(type) {
  switch (type) {
    case 'BANK_CURRENT':
    case 'BANK_SAVINGS': return 'bank'
    case 'CASH':         return 'cash'
    case 'PETTY_CASH':   return 'petty'
    case 'MFS':          return 'wallet'
    case 'CARD':         return 'card'
    case 'GATEWAY':      return 'gateway'
    case 'LOAN_OD':      return 'loan'
    default:             return 'other'
  }
}

const HEX_RE = /^#[0-9a-fA-F]{6}$/

/**
 * Accent colour for an account: explicit `color`, else wallet brand, else a
 * known bank colour, else the type colour (banks without a known colour get a
 * stable colour from their name so two banks look different).
 */
export function accountColor(account) {
  if (!account) return '#64748B'
  if (account.color && HEX_RE.test(account.color)) return account.color
  if (account.type === 'MFS') return MFS_COLORS[account.mfsProvider] ?? TYPE_COLORS.MFS
  if (['BANK_CURRENT', 'BANK_SAVINGS', 'LOAN_OD', 'CARD'].includes(account.type) && account.bankName) {
    const bank = findBank(account.bankName)
    if (bank && BANK_COLORS[bank.short]) return BANK_COLORS[bank.short]
    if (account.type !== 'LOAN_OD' && account.type !== 'CARD') {
      return FALLBACK_PALETTE[hashString(account.bankName) % FALLBACK_PALETTE.length]
    }
  }
  return TYPE_COLORS[account.type] ?? '#64748B'
}

/** '#RRGGBB' + alpha (0–1) → '#RRGGBBAA'. */
export function withAlpha(hex, alpha) {
  const a = Math.round(Math.min(1, Math.max(0, alpha)) * 255).toString(16).padStart(2, '0')
  return `${HEX_RE.test(hex) ? hex : '#64748B'}${a}`
}

/** Colour swatches offered in the account form. */
export const ACCOUNT_COLOR_SWATCHES = [
  '#2563EB', '#4F46E5', '#0F766E', '#059669', '#65A30D', '#D97706',
  '#EA580C', '#DC2626', '#DB2777', '#9333EA', '#475569', '#0F172A',
]

/** Group key ('bank'|'cash'|'mfs'|'other') of an account. */
export function accountGroup(account) {
  return accountTypeGroup(account?.type)
}

/** Provider / institution line under the account name. */
export function accountSubtitle(account) {
  if (!account) return ''
  const parts = []
  if (account.type === 'MFS') {
    if (account.mfsProvider) parts.push(MFS_PROVIDER_LABELS[account.mfsProvider] ?? account.mfsProvider)
    if (account.walletType) parts.push(`${account.walletType.charAt(0)}${account.walletType.slice(1).toLowerCase()} wallet`)
  } else if (account.bankName) {
    parts.push(account.bankName)
    if (account.branchName) parts.push(account.branchName)
  }
  if (!parts.length) parts.push(accountTypeLabel(account.type))
  return parts.join(' · ')
}

/** '•••• 4821' (or '' when no number is known). */
export function maskedNumber(account) {
  if (!account) return ''
  if (account.last4) return `•••• ${account.last4}`
  return ''
}

/** Money in an account's currency: '৳ 1,234.00' / '$ 1,234.00'. */
export function formatAmount(amount, currency = 'BDT') {
  const n = Number(amount)
  if (!Number.isFinite(n)) return '—'
  if (!currency || currency === 'BDT') return formatCurrency(n, 'BDT')
  return formatMoney(n, currency)
}

/** Signed money with explicit + / − sign. */
export function formatSigned(amount, currency = 'BDT') {
  const n = Number(amount) || 0
  if (Math.abs(n) < 0.005) return formatAmount(0, currency)
  return `${n < 0 ? '−' : '+'}${formatAmount(Math.abs(n), currency)}`
}

/** Plain number for inputs/CSV: 1234.5 → '1234.50'. */
export function plainAmount(amount) {
  const n = Number(amount)
  return Number.isFinite(n) ? n.toFixed(2) : ''
}

/** Today's business day 'YYYY-MM-DD' (Asia/Dhaka). */
export function todayKey() {
  return dhakaDayKey(new Date())
}

/** 'YYYY-MM-DD' Dhaka day of any date value ('' when invalid/empty). */
export function dayKeyOf(value) {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '' : dhakaDayKey(d)
}

/** Round to 2 decimals, half-up. */
export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

/** Parse a user-typed amount ('1,23,456.50' → 123456.5); NaN when not a number. */
export function parseAmount(value) {
  if (value === null || value === undefined) return NaN
  if (typeof value === 'number') return value
  const s = String(value).replace(/[,\s৳]/g, '').trim()
  if (s === '' || s === '-' || s === '.') return NaN
  return Number(s)
}

// ── CSV ───────────────────────────────────────────────────────────────────────

function csvCell(v) {
  if (v === null || v === undefined) return ''
  const s = String(v)
  // Neutralise spreadsheet formula injection, then quote when needed.
  const safe = /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s) ? `'${s}` : s
  return /[",\n\r]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}

/** rows: array of arrays → CSV text (CRLF, UTF-8 BOM for Excel). */
export function toCsv(rows) {
  return '﻿' + rows.map(r => r.map(csvCell).join(',')).join('\r\n')
}

/** Trigger a browser download of CSV rows. */
export function downloadCsv(filename, rows) {
  if (typeof window === 'undefined') return
  const blob = new Blob([toCsv(rows)], { type: 'text/csv;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

/** fetch → json with a thrown Error(json.error) on failure (house pattern). */
export async function fetchJson(url, options) {
  const res = await fetch(url, options)
  let json = {}
  try { json = await res.json() } catch { json = {} }
  if (!res.ok) {
    const err = new Error(json.error || `Request failed (${res.status})`)
    err.status = res.status
    err.details = json.details ?? null
    err.code = json.code ?? null
    err.data = json
    throw err
  }
  return json
}

/** First human message from a 422 zod `details` (flatten()) payload. */
export function firstValidationMessage(err) {
  const d = err?.details
  if (!d) return err?.message || 'Something went wrong'
  const field = d.fieldErrors && Object.entries(d.fieldErrors).find(([, v]) => v?.length)
  if (field) return `${field[0]}: ${field[1][0]}`
  if (d.formErrors?.length) return d.formErrors[0]
  return err?.message || 'Validation failed'
}
