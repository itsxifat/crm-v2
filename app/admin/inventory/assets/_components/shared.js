'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  UserCheck, Repeat, Undo2, ArrowLeftRight, Wrench, CircleCheckBig, TriangleAlert, HandCoins, SearchX, ShieldAlert,
  ScanSearch, Archive, ArchiveRestore, BadgeDollarSign, Trash2, FileX2, HeartHandshake, Scale, StickyNote,
} from 'lucide-react'
import { cn, formatCurrency } from '@/lib/utils'
import { dhakaDayKey } from '@/lib/dhakaTime'
import { buttonVariants } from '@/components/ui/Button'
import { Field as UiField, inputClass } from '@/components/ui/Input'

// ── style tokens (house style) ───────────────────────────────────────────────
/** Works on <input>, <select> and <textarea> (no fixed height). */
export const inputCls = cn(inputClass, 'h-auto min-h-9 py-1.5')
export const labelCls = 'mb-2 block text-sm font-medium leading-none text-gray-900'
export const btnPrimary = buttonVariants({ variant: 'default' })
export const btnSecondary = buttonVariants({ variant: 'outline' })
export const btnDanger = buttonVariants({ variant: 'destructive' })
export const cardCls = 'rounded-xl border border-gray-200/80 bg-white shadow-xs'

export const ACTION_ICONS = {
  UserCheck, Repeat, Undo2, ArrowLeftRight, Wrench, CircleCheckBig, TriangleAlert, HandCoins, SearchX, ShieldAlert,
  ScanSearch, Archive, ArchiveRestore, BadgeDollarSign, Trash2, FileX2, HeartHandshake, Scale, StickyNote,
}

export function Field({ label, hint, error, required, className, children }) {
  return (
    <UiField label={label} hint={hint} error={error} required={required} className={className}>
      {children}
    </UiField>
  )
}

export function Section({ title, description, actions, className, bodyClassName, children }) {
  const hasHeader = Boolean(title || actions)
  return (
    <section className={cn(cardCls, className)}>
      {hasHeader && (
        <div className="flex items-start justify-between gap-3 px-5 pt-5 pb-3">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold leading-5 tracking-tight text-gray-900">{title}</h2>}
            {description && <p className="mt-0.5 text-[13px] text-muted-foreground">{description}</p>}
          </div>
          {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
        </div>
      )}
      <div className={cn('px-5 pb-5', !hasHeader && 'pt-5', bodyClassName)}>{children}</div>
    </section>
  )
}

/** Label / value row for detail panels. */
export function InfoRow({ label, children, mono }) {
  const empty = children === null || children === undefined || children === '' || children === false
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <span className="shrink-0 text-muted-foreground">{label}</span>
      <span className={cn('min-w-0 break-words text-right text-gray-900', mono && 'font-mono text-xs', empty && 'text-gray-300')}>
        {empty ? '—' : children}
      </span>
    </div>
  )
}

// ── formatting ───────────────────────────────────────────────────────────────
export const tk = (n) => (n === null || n === undefined || Number.isNaN(Number(n)) ? '—' : formatCurrency(Number(n), 'BDT'))

export function fmtDay(d) {
  if (!d) return '—'
  const date = new Date(d)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Dhaka' })
}

export function fmtDateTime(d) {
  if (!d) return '—'
  const date = new Date(d)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Dhaka' })
}

export const todayKey = () => dhakaDayKey(new Date())

/** 'YYYY-MM-DD' (Dhaka) of a stored date, for DatePicker values. */
export function dayKeyOf(d) {
  if (!d) return null
  const date = new Date(d)
  return Number.isNaN(date.getTime()) ? null : dhakaDayKey(date)
}

export const holderName = (asset) => {
  const e = asset?.assignedEmployeeId
  if (e && typeof e === 'object') return e.name ?? e.employeeId ?? 'Employee'
  if (asset?.assignedDepartmentId && typeof asset.assignedDepartmentId === 'object') return asset.assignedDepartmentId.name
  return null
}

export const refName = (v) => (v && typeof v === 'object' ? (v.name ?? v.company ?? v.billNo ?? null) : null)
export const refId = (v) => (v && typeof v === 'object' ? (v.id ?? null) : (v ?? null))

// ── API ──────────────────────────────────────────────────────────────────────
export async function apiJson(url, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { 'Content-Type': 'application/json', ...(options.headers ?? {}) },
  })
  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const field = json?.details?.fieldErrors ? Object.entries(json.details.fieldErrors)[0] : null
    const msg = json.error === 'Validation failed' && field ? `${field[0]}: ${field[1]?.[0]}` : (json.error || 'Something went wrong')
    const err = new Error(msg)
    err.status = res.status
    err.details = json.details
    throw err
  }
  return json
}

// ── form options (categories, locations, departments, vendors, policy) ──────
let _options = null
let _optionsAt = 0
let _optionsPromise = null
const OPTIONS_TTL = 60 * 1000

function loadOptions(force = false) {
  if (!force && _options && Date.now() - _optionsAt < OPTIONS_TTL) return Promise.resolve(_options)
  if (_optionsPromise) return _optionsPromise
  _optionsPromise = apiJson('/api/inventory/assets/options')
    .then(json => {
      _options = json.data
      _optionsAt = Date.now()
      return _options
    })
    .finally(() => { _optionsPromise = null })
  return _optionsPromise
}

export function invalidateAssetOptions() {
  _optionsAt = 0
}

/** Categories / locations / departments / vendors / inventory settings for the asset forms. */
export function useAssetOptions() {
  const [options, setOptions] = useState(_options)
  const [loading, setLoading] = useState(!_options)
  const [error, setError] = useState(null)

  const reload = useCallback((force = true) => {
    setLoading(true)
    return loadOptions(force)
      .then(o => { setOptions(o); setError(null); return o })
      .catch(e => { setError(e.message); return null })
      .finally(() => setLoading(false))
  }, [])

  useEffect(() => { reload(false) }, [reload])

  return {
    options,
    loading,
    error,
    reload,
    categories: options?.categories?.filter(c => c.type !== 'CONSUMABLE') ?? [],
    locations: options?.locations ?? [],
    departments: options?.departments ?? [],
    vendors: options?.vendors ?? [],
    settings: options?.settings ?? null,
  }
}

/** Open a printable route in a new tab. */
export function openPrint(url) {
  if (typeof window !== 'undefined') window.open(url, '_blank', 'noopener')
}

export function labelsUrl(ids, { size = 'small', skip = 0 } = {}) {
  const p = new URLSearchParams({ ids: ids.join(','), size })
  if (skip) p.set('skip', String(skip))
  return `/api/inventory/assets/labels?${p}`
}
