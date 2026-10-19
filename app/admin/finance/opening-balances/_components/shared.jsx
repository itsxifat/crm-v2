'use client'

import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react'
import TkAmt from '@/components/ui/TkAmt'
import { formatMoney } from '@/lib/currencies'
import { cn } from '@/lib/utils'

export const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:bg-gray-50 disabled:text-gray-500'
export const labelCls = 'block text-xs font-medium text-gray-600 mb-1'
export const btnPrimary = 'inline-flex items-center justify-center gap-2 bg-gray-900 text-white hover:bg-gray-800 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
export const btnGhost = 'inline-flex items-center justify-center gap-2 border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
export const btnDanger = 'inline-flex items-center justify-center gap-2 bg-red-600 text-white hover:bg-red-700 rounded-lg px-4 py-2 text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed'
export const cardCls = 'bg-white border border-gray-100 rounded-xl'

/**
 * fetch wrapper: JSON in/out; throws Error(json.error) with .status / .details on failure.
 */
export async function apiFetch(url, { method = 'GET', body } = {}) {
  const res = await fetch(url, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const err = new Error(json.error || 'Something went wrong')
    err.status = res.status
    err.details = json.details ?? null
    throw err
  }
  return json
}

/** First message per field from a zod flatten() payload: { 'a.b': 'msg' }. */
export function fieldErrorsOf(err) {
  const fe = err?.details?.fieldErrors
  if (!fe || typeof fe !== 'object') return {}
  return Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, Array.isArray(v) ? v[0] : String(v)]))
}

/** Amount in its currency: ৳ via TkAmt for BDT, symbol + figure otherwise. */
export function Money({ value, currency = 'BDT', className, decimals = 2 }) {
  if (value === null || value === undefined || value === '') return <span className={cn('text-gray-400', className)}>—</span>
  if (!currency || currency === 'BDT') return <TkAmt value={Number(value) || 0} decimals={decimals} className={className} />
  return <span className={className}>{formatMoney(value, currency)}</span>
}

const TONES = {
  info:    { box: 'bg-blue-50 border-blue-100 text-blue-900',     icon: Info,          iconCls: 'text-blue-500' },
  warning: { box: 'bg-amber-50 border-amber-100 text-amber-900',  icon: AlertTriangle, iconCls: 'text-amber-500' },
  error:   { box: 'bg-red-50 border-red-100 text-red-900',        icon: XCircle,       iconCls: 'text-red-500' },
  success: { box: 'bg-emerald-50 border-emerald-100 text-emerald-900', icon: CheckCircle2, iconCls: 'text-emerald-500' },
  neutral: { box: 'bg-gray-50 border-gray-100 text-gray-700',     icon: Info,          iconCls: 'text-gray-400' },
}

export function Callout({ tone = 'info', title, children, className, icon }) {
  const t = TONES[tone] ?? TONES.info
  const Icon = icon ?? t.icon
  return (
    <div className={cn('flex gap-3 rounded-lg border px-3 py-2.5 text-sm', t.box, className)}>
      <Icon className={cn('w-4 h-4 mt-0.5 shrink-0', t.iconCls)} />
      <div className="min-w-0">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5', 'text-[13px] leading-relaxed opacity-90')}>{children}</div>}
      </div>
    </div>
  )
}

/** "What to enter / where to find it" box used on every step. */
export function Guidance({ what, where, children }) {
  return (
    <div className="rounded-lg bg-gray-50 border border-gray-100 px-3 py-2.5 text-[13px] leading-relaxed text-gray-600 space-y-1">
      {what && <p><span className="font-medium text-gray-800">What to enter: </span>{what}</p>}
      {where && <p><span className="font-medium text-gray-800">Where to find it: </span>{where}</p>}
      {children}
    </div>
  )
}

export function FieldError({ message }) {
  if (!message) return null
  return <p className="mt-1 text-xs text-red-600">{message}</p>
}

/** Parse a money input string; returns null for blank, NaN for junk. */
export function parseAmount(v) {
  if (v === null || v === undefined) return null
  const s = String(v).replace(/,/g, '').trim()
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : NaN
}
