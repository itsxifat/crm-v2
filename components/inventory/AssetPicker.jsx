'use client'

import { useState, useEffect, useRef, useCallback, useId } from 'react'
import { Search, X, ChevronDown, Loader2, Package } from 'lucide-react'
import { cn } from '@/lib/utils'
import AssetStatusBadge from '@/components/inventory/AssetStatusBadge'

const assetId = (a) => (a ? String(a.id ?? a._id ?? '') : '')
const categoryName = (a) => (a?.categoryId && typeof a.categoryId === 'object' ? a.categoryId.name : null)
const holderName = (a) => {
  const e = a?.assignedEmployeeId
  if (!e || typeof e !== 'object') return null
  return e.name ?? e.userId?.name ?? e.employeeId ?? null
}
const subtitle = (a) => [a?.brand, a?.model, a?.serialNumber ? `S/N ${a.serialNumber}` : null].filter(Boolean).join(' · ')

/**
 * Searchable asset picker (tag, name, serial, brand, model) backed by
 * GET /api/inventory/assets?search=&status=.
 *
 * Props:
 *   value       — selected asset id (string) or null
 *   onChange    — (id|null, asset|null) => void
 *   statuses    — statuses to offer (default ['IN_STOCK']); empty array ⇒ any status
 *   placeholder — trigger text
 *   disabled, className
 */
export default function AssetPicker({
  value = null,
  onChange,
  statuses = ['IN_STOCK'],
  placeholder = 'Search by tag, name or serial…',
  disabled = false,
  className,
}) {
  const [open, setOpen]         = useState(false)
  const [query, setQuery]       = useState('')
  const [results, setResults]   = useState([])
  const [loading, setLoading]   = useState(false)
  const [error, setError]       = useState('')
  const [active, setActive]     = useState(0)
  const [selected, setSelected] = useState(null)
  const boxRef   = useRef(null)
  const inputRef = useRef(null)
  const reqId    = useRef(0)
  const listId   = useId()

  // Stable key so a new default array each render does not re-trigger searches.
  const statusKey = Array.isArray(statuses) ? statuses.filter(Boolean).join(',') : ''

  // Keep the selected card in step with `value` (load it when set from outside).
  useEffect(() => {
    if (!value) { setSelected(null); return }
    if (assetId(selected) === String(value)) return
    let cancelled = false
    fetch(`/api/inventory/assets/${encodeURIComponent(value)}`)
      .then(r => r.json().then(j => ({ ok: r.ok, j })))
      .then(({ ok, j }) => {
        if (cancelled || !ok) return
        const a = j?.data?.asset ?? j?.data ?? null
        if (a) setSelected(a)
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  const search = useCallback(async (term) => {
    const id = ++reqId.current // newer searches win over slower, older ones
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams({ limit: '15' })
      if (term.trim()) params.set('search', term.trim())
      if (statusKey) params.set('status', statusKey)
      const res  = await fetch(`/api/inventory/assets?${params}`)
      const json = await res.json()
      if (id !== reqId.current) return
      if (!res.ok) throw new Error(json.error || 'Failed to load assets')
      setResults(Array.isArray(json.data) ? json.data : [])
      setActive(0)
    } catch (err) {
      if (id !== reqId.current) return
      setResults([])
      setError(err.message || 'Failed to load assets')
    } finally {
      if (id === reqId.current) setLoading(false)
    }
  }, [statusKey])

  // Debounced search while the dropdown is open.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => search(query), 250)
    return () => clearTimeout(t)
  }, [query, open, search])

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const onDown = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  function pick(a) {
    setSelected(a)
    setOpen(false)
    setQuery('')
    onChange?.(assetId(a), a)
  }

  function clear() {
    setSelected(null)
    setQuery('')
    setResults([])
    onChange?.(null, null)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      if (!open) setOpen(true)
      setActive(i => Math.min(i + 1, Math.max(results.length - 1, 0)))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive(i => Math.max(i - 1, 0))
    } else if (e.key === 'Enter') {
      if (open && results[active]) { e.preventDefault(); pick(results[active]) }
    } else if (e.key === 'Escape') {
      setOpen(false)
    }
  }

  if (selected) {
    const cat = categoryName(selected)
    const sub = subtitle(selected)
    return (
      <div className={cn('flex w-full items-center gap-3 rounded-lg border border-input bg-white px-3 py-2 shadow-xs', disabled && 'opacity-60', className)}>
        <span className="flex size-8 shrink-0 items-center justify-center rounded-md border border-gray-200/80 bg-white shadow-xs">
          <Package className="size-4 text-gray-500" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-gray-900">
            <span className="mr-1.5 font-mono text-xs text-gray-500">{selected.assetTag}</span>
            {selected.name}
          </p>
          {(cat || sub) && <p className="truncate text-xs text-muted-foreground">{[cat, sub].filter(Boolean).join(' · ')}</p>}
        </div>
        {selected.status && <AssetStatusBadge status={selected.status} className="hidden sm:inline-flex" />}
        {!disabled && (
          <button type="button" onClick={clear} aria-label="Clear selected asset"
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900">
            <X className="size-4" />
          </button>
        )}
      </div>
    )
  }

  return (
    <div ref={boxRef} className={cn('relative', className)}>
      <div className={cn(
        'flex h-9 w-full items-center gap-2 rounded-lg border border-input bg-white px-3 shadow-xs transition-[color,box-shadow,border-color]',
        'focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30',
        disabled && 'pointer-events-none opacity-60',
      )}>
        <Search className="size-4 shrink-0 text-gray-400" />
        <input
          ref={inputRef}
          type="text"
          value={query}
          disabled={disabled}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          role="combobox"
          aria-controls={listId}
          aria-expanded={open}
          aria-autocomplete="list"
          className="min-w-0 flex-1 border-0 bg-transparent p-0 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:ring-0"
        />
        {loading
          ? <Loader2 className="size-4 shrink-0 animate-spin text-gray-400" />
          : <ChevronDown className="size-4 shrink-0 text-gray-400" />}
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-full overflow-hidden rounded-xl border border-gray-200/80 bg-white shadow-lg">
          <div id={listId} className="max-h-72 overflow-y-auto p-1" role="listbox">
            {error ? (
              <p className="px-4 py-6 text-center text-sm text-red-600">{error}</p>
            ) : results.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-muted-foreground">
                {loading ? 'Searching…' : query.trim() ? 'No results' : 'No assets'}
              </p>
            ) : (
              results.map((a, i) => {
                const cat = categoryName(a)
                const holder = holderName(a)
                const sub = subtitle(a)
                return (
                  <button
                    type="button"
                    key={assetId(a) || a.assetTag}
                    role="option"
                    aria-selected={i === active}
                    onMouseEnter={() => setActive(i)}
                    onClick={() => pick(a)}
                    className={cn('flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-left transition-colors', i === active ? 'bg-gray-100' : 'hover:bg-gray-100')}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-gray-900">
                        <span className="mr-1.5 font-mono text-xs text-gray-500">{a.assetTag}</span>
                        <span className="font-medium">{a.name}</span>
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[cat, sub, holder ? `with ${holder}` : null].filter(Boolean).join(' · ') || '—'}
                      </p>
                    </div>
                    {a.status && <AssetStatusBadge status={a.status} />}
                  </button>
                )
              })
            )}
          </div>
        </div>
      )}
    </div>
  )
}
