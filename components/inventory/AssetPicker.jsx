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
      <div className={cn('flex items-center gap-3 w-full border border-gray-200 rounded-lg px-3 py-2 bg-white', disabled && 'opacity-60', className)}>
        <span className="w-8 h-8 rounded-lg bg-gray-100 text-gray-500 flex items-center justify-center shrink-0">
          <Package className="w-4 h-4" />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-sm font-medium text-gray-900 truncate">
            <span className="font-mono text-xs text-gray-500 mr-1.5">{selected.assetTag}</span>
            {selected.name}
          </p>
          {(cat || sub) && <p className="text-xs text-gray-400 truncate">{[cat, sub].filter(Boolean).join(' · ')}</p>}
        </div>
        {selected.status && <AssetStatusBadge status={selected.status} className="hidden sm:inline-flex" />}
        {!disabled && (
          <button type="button" onClick={clear} aria-label="Clear selected asset"
            className="p-1 text-gray-400 hover:text-gray-700 shrink-0">
            <X className="w-4 h-4" />
          </button>
        )}
      </div>
    )
  }

  return (
    <div ref={boxRef} className={cn('relative', className)}>
      <div className={cn(
        'flex items-center gap-2 w-full border border-gray-200 rounded-lg px-3 py-2 bg-white',
        'focus-within:ring-2 focus-within:ring-gray-900 focus-within:border-transparent',
        disabled && 'opacity-60 pointer-events-none',
      )}>
        <Search className="w-4 h-4 text-gray-400 shrink-0" />
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
          className="flex-1 min-w-0 text-sm bg-transparent outline-none border-0 p-0 focus:ring-0 placeholder-gray-400"
        />
        {loading
          ? <Loader2 className="w-4 h-4 animate-spin text-gray-400 shrink-0" />
          : <ChevronDown className="w-4 h-4 text-gray-300 shrink-0" />}
      </div>

      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-100 rounded-xl shadow-lg overflow-hidden">
          <div id={listId} className="max-h-72 overflow-y-auto py-1" role="listbox">
            {error ? (
              <p className="px-4 py-6 text-center text-sm text-red-500">{error}</p>
            ) : results.length === 0 ? (
              <p className="px-4 py-6 text-center text-sm text-gray-400">
                {loading ? 'Searching…' : query.trim() ? `No assets match "${query.trim()}"` : 'No assets available'}
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
                    className={cn('w-full flex items-center gap-3 px-3 py-2 text-left', i === active ? 'bg-gray-50' : 'hover:bg-gray-50')}
                  >
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-gray-900 truncate">
                        <span className="font-mono text-xs text-gray-500 mr-1.5">{a.assetTag}</span>
                        <span className="font-medium">{a.name}</span>
                      </p>
                      <p className="text-xs text-gray-400 truncate">
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
