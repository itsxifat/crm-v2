'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { cn } from '@/lib/utils'
import { selectClass } from '@/components/ui/Input'
import { catalogCodesFor, tdsRateText, vatServiceLabel } from '@/lib/tax/catalog'

/**
 * TaxCodeSelect — native select of VAT service codes or TDS sections.
 *
 * Props:
 *   kind        'VAT_SERVICE' | 'TDS_SECTION'
 *   value       code string | null (e.g. 'S099.10', '90-OTHER')
 *   onChange    (code | null, codeObject | null) => void
 *   placeholder text of the empty option
 *   className   extra classes for the <select>
 *   disabled, required, id, name
 *   asOf        'YYYY-MM-DD' — list the rates effective on that day (default today)
 *
 * Codes come from /api/tax/codes (cached per page for 60s). Until they load —
 * or if the request fails — the built-in catalog is shown, so the select is
 * never empty. A stored value that is no longer offered stays selectable.
 */

const CACHE_MS = 60 * 1000
const cache = new Map() // `${kind}|${asOf}` → { at, data } | { promise }

const cacheKey = (kind, asOf) => `${kind}|${asOf || ''}`

function fetchCodes(kind, asOf) {
  const key = cacheKey(kind, asOf)
  const hit = cache.get(key)
  if (hit?.data && Date.now() - hit.at < CACHE_MS) return Promise.resolve(hit.data)
  if (hit?.promise) return hit.promise
  const qs = new URLSearchParams({ kind })
  if (asOf) qs.set('asOf', asOf)
  const promise = fetch(`/api/tax/codes?${qs.toString()}`)
    .then(async (res) => {
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Failed to load tax codes')
      return Array.isArray(json.data) ? json.data : []
    })
    .then((data) => {
      cache.set(key, { at: Date.now(), data })
      return data
    })
    .catch((err) => {
      cache.delete(key)
      throw err
    })
  cache.set(key, { promise })
  return promise
}

/** Drop cached code lists (call after creating / editing codes). */
export function invalidateTaxCodesCache() {
  cache.clear()
}

/** Hook: { codes, loading, error, reload } for a kind (catalog fallback while loading / on error). */
export function useTaxCodes(kind, { asOf = null } = {}) {
  const fallback = useMemo(() => catalogCodesFor(kind, asOf || new Date()), [kind, asOf])
  const cached = cache.get(cacheKey(kind, asOf))
  const [codes, setCodes] = useState(() => cached?.data ?? fallback)
  const [loading, setLoading] = useState(!cached?.data)
  const [error, setError] = useState(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let alive = true
    setLoading(true)
    fetchCodes(kind, asOf)
      .then((data) => { if (alive) { setCodes(data); setError(null) } })
      .catch((err) => { if (alive) { setCodes(fallback); setError(err.message) } })
      .finally(() => { if (alive) setLoading(false) })
    return () => { alive = false }
  }, [kind, asOf, tick, fallback])

  const reload = useCallback(() => {
    cache.delete(cacheKey(kind, asOf))
    setTick(t => t + 1)
  }, [kind, asOf])

  return { codes, loading, error, reload }
}

const TDS_GROUPS = [
  { section: '89',  title: 's.89 — Contractors & suppliers' },
  { section: '90',  title: 's.90 — Services (residents)' },
  { section: '91',  title: 's.91 — Royalty / licence' },
  { section: '92',  title: 's.92 — Advertising' },
  { section: '94',  title: 's.94 — Commission' },
  { section: '109', title: 's.109 — Rent' },
  { section: '86',  title: 's.86 — Salary' },
  { section: '119', title: 's.119 — Non-residents' },
]

function tdsOptionLabel(row) {
  return `${row.code} — ${row.label} (${tdsRateText(row)})`
}

export default function TaxCodeSelect({
  kind,
  value,
  onChange,
  placeholder,
  className,
  disabled = false,
  required = false,
  id,
  name,
  asOf = null,
}) {
  const { codes, loading } = useTaxCodes(kind, { asOf })
  const current = value ? codes.find(c => c.code === value) ?? null : null
  const orphan = Boolean(value) && !current

  const groups = useMemo(() => {
    if (kind !== 'TDS_SECTION') return null
    const known = new Set(TDS_GROUPS.map(g => g.section))
    const out = TDS_GROUPS
      .map(g => ({ ...g, rows: codes.filter(c => String(c.section) === g.section) }))
      .filter(g => g.rows.length)
    const others = codes.filter(c => !known.has(String(c.section)))
    if (others.length) out.push({ section: 'other', title: 'Other sections', rows: others })
    return out
  }, [kind, codes])

  const emptyLabel = placeholder ?? (kind === 'TDS_SECTION' ? 'Select TDS section' : 'Select VAT service code')

  function handleChange(e) {
    const code = e.target.value || null
    onChange?.(code, code ? codes.find(c => c.code === code) ?? null : null)
  }

  return (
    <select
      id={id}
      name={name}
      value={value ?? ''}
      onChange={handleChange}
      disabled={disabled}
      required={required}
      className={cn(selectClass, 'h-auto py-[7px]', className)}
    >
      <option value="">{emptyLabel}</option>
      {orphan && <option value={value}>{value}{loading ? '' : ' (not active)'}</option>}
      {kind === 'TDS_SECTION'
        ? groups.map(g => (
            <optgroup key={g.section} label={g.title}>
              {g.rows.map(row => (
                <option key={`${row.code}-${row.id ?? row.effectiveFromDay ?? row.effectiveFrom}`} value={row.code}>
                  {tdsOptionLabel(row)}
                </option>
              ))}
            </optgroup>
          ))
        : codes.map(row => (
            <option key={`${row.code}-${row.id ?? row.effectiveFromDay ?? row.effectiveFrom}`} value={row.code}>
              {vatServiceLabel(row)}
            </option>
          ))}
    </select>
  )
}
