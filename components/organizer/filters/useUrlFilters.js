'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'

// Filter state mirrored into the URL query (prefixed keys, e.g. `t_status=OPEN,DONE`).
// Local state updates immediately; the URL write is debounced with router.replace.
// Components using this must render inside a <Suspense> boundary (useSearchParams).

const WRITE_DELAY = 250

/** Value equality for filter values (arrays compared element-wise). */
export function isSameValue(a, b) {
  if (Array.isArray(a) || Array.isArray(b)) {
    const x = Array.isArray(a) ? a : []
    const y = Array.isArray(b) ? b : []
    return x.length === y.length && x.every((v, i) => v === y[i])
  }
  if (typeof a === 'boolean' || typeof b === 'boolean') return !!a === !!b
  return (a ?? '') === (b ?? '')
}

function parseValue(raw, def) {
  if (raw == null) return def
  if (Array.isArray(def)) return raw ? raw.split(',').map((s) => s.trim()).filter(Boolean) : []
  if (typeof def === 'boolean') return raw === '1' || raw === 'true'
  if (typeof def === 'number') {
    const n = Number(raw)
    return Number.isFinite(n) ? n : def
  }
  return raw
}

function serializeValue(v) {
  if (Array.isArray(v)) return v.join(',')
  if (typeof v === 'boolean') return v ? '1' : '0'
  return String(v ?? '')
}

function readAll(sp, prefix, defaults) {
  const out = {}
  for (const [k, def] of Object.entries(defaults)) out[k] = parseValue(sp?.get(prefix + k), def)
  return out
}

/** Canonical query string of the non-default values (keys sorted). */
function portionOf(values, prefix, defaults) {
  const p = new URLSearchParams()
  for (const k of Object.keys(defaults).sort()) {
    if (!isSameValue(values[k], defaults[k])) p.set(prefix + k, serializeValue(values[k]))
  }
  return p.toString()
}

/**
 * const { filters, setFilters, reset, defaults } = useUrlFilters('t_', { q: '', status: [], sort: 'due' })
 *   setFilters({ status: ['OPEN'] })        // patch (or a function prev => patch)
 *   reset()                                // everything back to defaults
 *   reset(['status', 'q'])                 // only these keys
 * Defaults decide the type of each key: array → comma list, boolean → '1', string → as-is.
 */
export function useUrlFilters(prefix, defaults) {
  const router = useRouter()
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const defaultsKey = JSON.stringify(defaults)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const stableDefaults = useMemo(() => defaults, [defaultsKey])

  const [filters, setState] = useState(() => readAll(searchParams, prefix, stableDefaults))
  const stateRef = useRef(filters)
  const recentWrites = useRef([])
  const timer = useRef(null)

  // Prefixed part of the current URL, canonicalised the same way we write it.
  const urlPortion = useMemo(() => {
    const entries = []
    searchParams?.forEach((v, k) => { if (k.startsWith(prefix)) entries.push([k, v]) })
    entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    const p = new URLSearchParams()
    for (const [k, v] of entries) p.append(k, v)
    return p.toString()
  }, [searchParams, prefix])

  // Adopt URL changes made elsewhere (back/forward, links). Ignore echoes of our own writes.
  useEffect(() => {
    if (timer.current) return
    if (urlPortion === portionOf(stateRef.current, prefix, stableDefaults)) return
    if (recentWrites.current.includes(urlPortion)) return
    const next = readAll(searchParams, prefix, stableDefaults)
    stateRef.current = next
    setState(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlPortion])

  // Defaults changed (e.g. organizer ↔ master): re-read so every key exists.
  const firstDefaults = useRef(true)
  useEffect(() => {
    if (firstDefaults.current) { firstDefaults.current = false; return }
    const next = readAll(searchParams, prefix, stableDefaults)
    stateRef.current = next
    setState(next)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stableDefaults])

  const flush = useCallback(() => {
    timer.current = null
    if (typeof window === 'undefined') return
    // The user navigated away before the debounce fired — never drag them back.
    if (window.location.pathname !== pathname) return
    const values = stateRef.current
    const params = new URLSearchParams(window.location.search)
    for (const k of [...params.keys()]) if (k.startsWith(prefix)) params.delete(k)
    for (const k of Object.keys(stableDefaults).sort()) {
      if (!isSameValue(values[k], stableDefaults[k])) params.set(prefix + k, serializeValue(values[k]))
    }
    recentWrites.current = [...recentWrites.current.slice(-9), portionOf(values, prefix, stableDefaults)]
    const q = params.toString()
    router.replace(q ? `${pathname}?${q}` : pathname, { scroll: false })
  }, [router, pathname, prefix, stableDefaults])

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  const setFilters = useCallback((patch) => {
    const prev = stateRef.current
    const delta = typeof patch === 'function' ? patch(prev) : patch
    const next = { ...prev, ...delta }
    stateRef.current = next
    setState(next)
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(flush, WRITE_DELAY)
  }, [flush])

  const reset = useCallback((keys) => {
    const patch = {}
    for (const k of keys ?? Object.keys(stableDefaults)) patch[k] = stableDefaults[k]
    setFilters(patch)
  }, [setFilters, stableDefaults])

  // Merge in defaults so a key added later is never undefined.
  const merged = useMemo(() => ({ ...stableDefaults, ...filters }), [stableDefaults, filters])

  return { filters: merged, setFilters, reset, defaults: stableDefaults }
}

export default useUrlFilters
