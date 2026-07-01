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

  const effectiveTypes = activeType ? [activeType] : types

  const search = useCallback(async (term, searchTypes) => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ q: term, types: searchTypes.join(','), limit: '25' })
      const res  = await fetch(`/api/people/search?${params}`)
      const json = await res.json()
      setResults(res.ok ? (json.data ?? []) : [])
    } catch {
      setResults([])
    } finally {
      setLoading(false)
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
        <div className="flex items-center justify-between gap-2 w-full border border-gray-200 rounded-lg px-3 py-2">
          <div className="flex items-center gap-2 min-w-0">
            <Avatar name={value.name} src={value.avatar} size="xs" />
            <div className="min-w-0">
              <p className="text-sm font-medium text-gray-900 truncate">{value.name}</p>
              {value.sub && <p className="text-xs text-gray-400 truncate">{value.sub}</p>}
            </div>
          </div>
          <button type="button" onClick={() => onChange?.(null)} className="p-1 text-gray-400 hover:text-gray-600 shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        <button type="button" onClick={() => setOpen(o => !o)}
          className="flex items-center justify-between gap-2 w-full border border-gray-200 rounded-lg px-3 py-2 text-sm text-gray-500 hover:border-gray-300">
          <span className="flex items-center gap-2"><Search className="w-4 h-4" /> {placeholder}</span>
          <ChevronDown className="w-4 h-4" />
        </button>
      )}

      {open && !value && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-100 rounded-xl shadow-lg overflow-hidden">
          <div className="p-2 border-b border-gray-50">
            <div className="flex items-center gap-2 px-2 py-1.5 bg-gray-50 rounded-lg">
              <Search className="w-4 h-4 text-gray-400" />
              <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Type a name…"
                className="flex-1 bg-transparent text-sm outline-none" />
              {loading && <Loader2 className="w-4 h-4 animate-spin text-gray-400" />}
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

          <div className="max-h-64 overflow-y-auto py-1">
            {results.length === 0 && !loading ? (
              <p className="px-4 py-6 text-center text-sm text-gray-400">{q ? 'No matches' : 'Start typing to search'}</p>
            ) : (
              results.map(p => (
                <button type="button" key={`${p.type}:${p.id}`} onClick={() => pick(p)}
                  className="w-full flex items-center gap-2.5 px-3 py-2 hover:bg-gray-50 text-left">
                  <Avatar name={p.name} src={p.avatar} size="xs" />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-gray-900 truncate">{p.name}</p>
                    {p.sub && <p className="text-xs text-gray-400 truncate">{p.sub}</p>}
                  </div>
                  <span className={`text-[10px] font-medium px-1.5 py-0.5 rounded ${TYPE_BADGE[p.type] ?? 'bg-gray-100 text-gray-500'}`}>
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
