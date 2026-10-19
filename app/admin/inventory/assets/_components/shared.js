'use client'

import { useCallback, useEffect, useState } from 'react'
import {
  UserCheck, Repeat, Undo2, ArrowLeftRight, Wrench, CircleCheckBig, TriangleAlert, HandCoins, SearchX, ShieldAlert,
  ScanSearch, Archive, ArchiveRestore, BadgeDollarSign, Trash2, FileX2, HeartHandshake, Scale, StickyNote,
} from 'lucide-react'
import { cn, formatCurrency } from '@/lib/utils'
import { dhakaDayKey } from '@/lib/dhakaTime'

// ── style tokens (house style) ───────────────────────────────────────────────
export const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-gray-900 focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:bg-gray-50 disabled:text-gray-400'
export const labelCls = 'block text-xs font-medium text-gray-600 mb-1'
export const btnPrimary = 'inline-flex items-center justify-center gap-2 bg-gray-900 text-white hover:bg-gray-800 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
export const btnSecondary = 'inline-flex items-center justify-center gap-2 border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 rounded-lg px-3.5 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
export const btnDanger = 'inline-flex items-center justify-center gap-2 bg-red-600 text-white hover:bg-red-700 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
export const cardCls = 'bg-white border border-gray-100 rounded-xl'

export const ACTION_ICONS = {
  UserCheck, Repeat, Undo2, ArrowLeftRight, Wrench, CircleCheckBig, TriangleAlert, HandCoins, SearchX, ShieldAlert,
  ScanSearch, Archive, ArchiveRestore, BadgeDollarSign, Trash2, FileX2, HeartHandshake, Scale, StickyNote,
}

export function Field({ label, hint, error, required, className, children }) {
  return (
    <div className={className}>
      {label && (
        <label className={labelCls}>
          {label}{required && <span className="text-red-500"> *</span>}
        </label>
      )}
      {children}
      {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : hint ? <p className="mt-1 text-xs text-gray-400">{hint}</p> : null}
    </div>
  )
}

export function Section({ title, description, actions, className, bodyClassName, children }) {
  return (
    <section className={cn(cardCls, className)}>
      {(title || actions) && (
        <div className="flex items-start justify-between gap-3 px-4 sm:px-5 pt-4 pb-3 border-b border-gray-50">
          <div className="min-w-0">
            {title && <h2 className="text-sm font-semibold text-gray-900">{title}</h2>}
            {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
          </div>
          {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
        </div>
      )}
      <div className={cn('px-4 sm:px-5 py-4', bodyClassName)}>{children}</div>
    </section>
  )
}

/** Label / value row for detail panels. */
export function InfoRow({ label, children, mono }) {
  const empty = children === null || children === undefined || children === '' || children === false
  return (
    <div className="flex items-start justify-between gap-4 py-1.5 text-sm">
      <span className="text-gray-500 shrink-0">{label}</span>
      <span className={cn('text-right text-gray-900 min-w-0 break-words', mono && 'font-mono text-xs', empty && 'text-gray-300')}>
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
