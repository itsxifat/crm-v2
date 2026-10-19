'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, Loader2, X, ChevronDown } from 'lucide-react'
import Avatar from '@/components/ui/Avatar'

const TYPE_BADGE = {
  EMPLOYEE:   'bg-blue-50 text-blue-700',
  FREELANCER: 'bg-violet-50 text-violet-700',
  AGENCY:     'bg-indigo-50 text-indigo-700',
}

/**
 * Advanced, searchable assignee picker that scales to thousands of people.
 * Debounced async search across employees / freelancers / agencies.
 *
 * Props:
 *   types     — which kinds to search, e.g. ['EMPLOYEE'] or ['FREELANCER','AGENCY']
 *   value     — selected { id, type, name, avatar, sub } or null
 *   onChange  — (person|null) => void
 *   placeholder, typeFilter (show inline type tabs when multiple types)
 */
export default function PeoplePicker({
  types = ['EMPLOYEE', 'FREELANCER', 'AGENCY'],
  value = null,
  onChange,
  placeholder = 'Search people…',
  typeFilter = true,
}) {
  const [open, setOpen]       = useState(false)
  const [q, setQ]             = useState('')
  const [activeType, setActiveType] = useState(null) // null = all selected types
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const boxRef = useRef(null)
  const reqId  = useRef(0)

  const effectiveTypes = activeType ? [activeType] : types

  const search = useCallback(async (term, searchTypes) => {
    const id = ++reqId.current // ignore out-of-order responses for older terms
    setLoading(true)
    try {
      const params = new URLSearchParams({ q: term, types: searchTypes.join(','), limit: '25' })
      const res  = await fetch(`/api/people/search?${params}`)
      const json = await res.json()
      if (id !== reqId.current) return
      setResults(res.ok ? (json.data ?? []) : [])
    } catch {
      if (id === reqId.current) setResults([])
    } finally {
      if (id === reqId.current) setLoading(false)
    }
  }, [])

  // Debounced search whenever the dropdown is open.
  useEffect(() => {
    if (!open) return
    const t = setTimeout(() => search(q, effectiveTypes), 220)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, open, activeType])

  // Close on outside click.
  useEffect(() => {
    if (!open) return
    const onClick = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false) }
    window.addEventListener('mousedown', onClick)
    return () => window.removeEventListener('mousedown', onClick)
  }, [open])

  function pick(p) {
    onChange?.(p)
    setOpen(false)
    setQ('')
  }

  return (
    <div className="relative" ref={boxRef}>
      {value ? (
        <div className="flex items-center justify-between gap-2 w-full rounded-lg border border-input bg-white px-2.5 py-1.5 shadow-xs">
          <div className="flex items-center gap-2 min-w-0">
            <Avatar name={value.name} src={value.avatar} size="xs" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{value.name}</p>
              {value.sub && <p className="text-xs text-gray-400 truncate">{value.sub}</p>}
            </div>
          </div>
          <button type="button" onClick={() => onChange?.(null)} className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-900" aria-label="Clear">
            <X className="size-4" />
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setOpen(o => !o)}
          className="flex h-9 items-center justify-between gap-2 w-full rounded-lg border border-input bg-white px-3 text-sm text-gray-400 shadow-xs hover:border-gray-300">
          <span className="flex items-center gap-2"><Search className="size-4" /> {placeholder}</span>
          <ChevronDown className="size-4" />
        </button>
      )}

      {open && !value && (
        <div className="absolute z-50 mt-1.5 w-full overflow-hidden rounded-xl border border-gray-200/80 bg-white shadow-lg animate-in fade-in-0 zoom-in-95 duration-100">
          <div className="border-b border-gray-100 p-1.5">
            <div className="flex items-center gap-2 px-2 py-1.5">
              <Search className="size-4 text-gray-400" />
              <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Type a name…"
                className="flex-1 border-0 bg-transparent p-0 text-sm outline-none focus:ring-0" />
              {loading && <Loader2 className="size-4 animate-spin text-gray-400" />}
            </div>
            {typeFilter && types.length > 1 && (
              <div className="flex items-center gap-1 mt-2">
                <button type="button" onClick={() => setActiveType(null)}
                  className={`px-2 py-0.5 text-xs rounded-md ${!activeType ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>All</button>
                {types.map(t => (
                  <button type="button" key={t} onClick={() => setActiveType(t)}
                    className={`px-2 py-0.5 text-xs rounded-md capitalize ${activeType === t ? 'bg-gray-900 text-white' : 'text-gray-500 hover:bg-gray-100'}`}>
                    {t.toLowerCase()}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="max-h-64 overflow-y-auto p-1">
            {results.length === 0 && !loading ? (
              <p className="px-4 py-6 text-center text-sm text-gray-400">{q ? 'No matches' : 'Start typing to search'}</p>
            ) : (
              results.map(p => (
                <button type="button" key={`${p.type}:${p.id}`} onClick={() => pick(p)}
                  className="w-full flex items-center gap-2.5 rounded-md px-2 py-1.5 hover:bg-gray-100 text-left">
                  <Avatar name={p.name} src={p.avatar} size="xs" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                    {p.sub && <p className="text-xs text-gray-400 truncate">{p.sub}</p>}
                  </div>
                  <span className={`text-[11px] font-medium px-1.5 py-0.5 rounded-md capitalize ${TYPE_BADGE[p.type] ?? 'bg-gray-100 text-gray-500'}`}>
                    {p.type.toLowerCase()}
                  </span>
                </button>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  )
}
