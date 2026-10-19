'use client'

import { AlertTriangle, CheckCircle2, ChevronDown, Info, XCircle } from 'lucide-react'
import TkAmt from '@/components/ui/TkAmt'
import { buttonVariants } from '@/components/ui/Button'
import { inputClass } from '@/components/ui/Input'
import { formatMoney } from '@/lib/currencies'
import { cn } from '@/lib/utils'

export const inputCls = inputClass
export const labelCls = 'mb-2 block text-sm font-medium leading-none text-gray-900'
export const btnPrimary = buttonVariants()
export const btnGhost = buttonVariants({ variant: 'outline' })
export const btnDanger = buttonVariants({ variant: 'destructive' })
export const cardCls = 'rounded-xl border border-gray-200/80 bg-white shadow-xs'

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
  info:    { box: 'border-blue-200 bg-blue-50 text-blue-800',          icon: Info,          iconCls: 'text-blue-600' },
  warning: { box: 'border-amber-200 bg-amber-50 text-amber-800',       icon: AlertTriangle, iconCls: 'text-amber-600' },
  error:   { box: 'border-red-200 bg-red-50 text-red-800',             icon: XCircle,       iconCls: 'text-red-600' },
  success: { box: 'border-emerald-200 bg-emerald-50 text-emerald-800', icon: CheckCircle2,  iconCls: 'text-emerald-600' },
  neutral: { box: 'border-gray-200/80 bg-gray-50 text-gray-700',       icon: Info,          iconCls: 'text-gray-500' },
}

export function Callout({ tone = 'info', title, children, className, icon }) {
  const t = TONES[tone] ?? TONES.info
  const Icon = icon ?? t.icon
  return (
    <div className={cn('flex gap-2.5 rounded-lg border px-3 py-2.5 text-sm', t.box, className)}>
      <Icon className={cn('mt-0.5 size-4 shrink-0', t.iconCls)} />
      <div className="min-w-0">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn(title && 'mt-0.5', 'text-[13px] leading-relaxed')}>{children}</div>}
      </div>
    </div>
  )
}

/** "What to enter / where to find it" guidance, collapsed by default (`collapsible={false}` for a plain box). */
export function Guidance({ what, where, children, collapsible = true }) {
  if (!collapsible) {
    return (
      <div className="space-y-1 rounded-lg bg-gray-50 px-3 py-2.5 text-[13px] leading-relaxed text-gray-600">
        {what && <p>{what}</p>}
        {where && <p><span className="font-medium text-gray-800">Where to find it: </span>{where}</p>}
        {children}
      </div>
    )
  }
  return (
    <details className="group rounded-lg bg-gray-50 px-3 py-2 text-[13px] leading-relaxed text-gray-600">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 font-medium text-gray-700 hover:text-gray-900 [&::-webkit-details-marker]:hidden">
        <Info className="size-3.5 text-gray-400" />
        What to enter
        <ChevronDown className="size-3.5 text-gray-400 transition-transform group-open:rotate-180" />
      </summary>
      <div className="mt-2 space-y-1">
        {what && <p>{what}</p>}
        {where && <p><span className="font-medium text-gray-800">Where to find it: </span>{where}</p>}
        {children}
      </div>
    </details>
  )
}

export function FieldError({ message }) {
  if (!message) return null
  return <p className="mt-1.5 text-xs text-red-600">{message}</p>
}

/** Parse a money input string; returns null for blank, NaN for junk. */
export function parseAmount(v) {
  if (v === null || v === undefined) return null
  const s = String(v).replace(/,/g, '').trim()
  if (s === '') return null
  const n = Number(s)
  return Number.isFinite(n) ? n : NaN
}
