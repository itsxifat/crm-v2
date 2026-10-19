'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { Search, X, User, Building2, Phone, Mail, ChevronDown } from 'lucide-react'

/**
 * ClientSearch — searchable client picker
 * Props:
 *   value        — selected client id (string)
 *   onChange     — callback(clientId, clientObject)
 *   error        — error message string
 *   placeholder  — input placeholder
 */
export default function ClientSearch({ value, onChange, error, placeholder = 'Search by name, company, email, phone…' }) {
  const [query,    setQuery]    = useState('')
  const [results,  setResults]  = useState([])
  const [loading,  setLoading]  = useState(false)
  const [open,     setOpen]     = useState(false)
  const [selected, setSelected] = useState(null)   // full client object
  const containerRef = useRef(null)
  const inputRef     = useRef(null)
  const debounceRef  = useRef(null)
  const reqIdRef     = useRef(0)

  // Close on outside click
  useEffect(() => {
    function handler(e) {
      if (containerRef.current && !containerRef.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  // If a value is pre-set (edit mode), fetch that client by ID directly
  useEffect(() => {
    if (!value || selected?.id === value) return
    fetch(`/api/clients/${value}`)
      .then(r => r.json())
      .then(j => { if (j.data) setSelected(j.data) })
      .catch(() => {})
  }, [value]) // eslint-disable-line

  // Debounced search
  const search = useCallback((q) => {
    clearTimeout(debounceRef.current)
    const id = ++reqIdRef.current // any older in-flight response is now stale
    if (!q.trim()) { setResults([]); setLoading(false); return }
    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const res  = await fetch(`/api/clients?search=${encodeURIComponent(q)}&limit=10`)
        const json = await res.json()
        if (id !== reqIdRef.current) return
        setResults(json.data ?? [])
      } catch {
        if (id === reqIdRef.current) setResults([])
      } finally {
        if (id === reqIdRef.current) setLoading(false)
      }
    }, 280)
  }, [])

  function handleInput(e) {
    const q = e.target.value
    setQuery(q)
    setOpen(true)
    search(q)
  }

  function select(client) {
    setSelected(client)
    setQuery('')
    setOpen(false)
    onChange(client.id, client)
  }

  function clear() {
    setSelected(null)
    setQuery('')
    setResults([])
    onChange('', null)
    setTimeout(() => inputRef.current?.focus(), 0)
  }

  const initials = (name) => name?.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2) ?? '?'

  return (
    <div ref={containerRef} className="relative">
      {/* Selected state */}
      {selected ? (
        <div className={`flex items-center gap-3 rounded-lg border bg-white px-2.5 py-2 shadow-xs ${error ? 'border-red-400' : 'border-input'}`}>
          <div className="size-8 rounded-full bg-gray-100 text-gray-700 text-xs font-semibold flex items-center justify-center shrink-0">
            {initials(selected.userId?.name ?? selected.name)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{selected.userId?.name ?? selected.name}</p>
            <p className="text-xs text-gray-400 truncate">
              {[selected.company, selected.userId?.email].filter(Boolean).join(' · ')}
            </p>
          </div>
          <button type="button" onClick={clear}
            className="inline-flex size-7 shrink-0 items-center justify-center rounded-md text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900" aria-label="Clear">
            <X className="size-4" />
          </button>
        </div>
      ) : (
        /* Search input */
        <div className={`flex h-9 items-center gap-2 rounded-lg border bg-white px-3 shadow-xs transition-[box-shadow,border-color] ${error ? 'border-red-400' : 'border-input focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30'}`}>
          <Search className="size-4 text-gray-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleInput}
            onFocus={() => { if (query) setOpen(true) }}
            placeholder={placeholder}
            className="flex-1 border-0 bg-transparent p-0 text-sm outline-none placeholder:text-gray-400 focus:ring-0"
          />
          {loading && (
            <div className="size-3.5 border-2 border-gray-300 border-t-gray-900 rounded-full animate-spin shrink-0" />
          )}
          {!loading && (
            <ChevronDown className="size-4 text-gray-400 shrink-0" />
          )}
        </div>
      )}

      {/* Dropdown */}
      {open && !selected && (
        <div className="absolute z-30 mt-1.5 w-full max-h-72 overflow-y-auto rounded-xl border border-gray-200/80 bg-white p-1 shadow-lg">
          {loading && (
            <div className="px-3 py-2.5 text-sm text-gray-400">Searching…</div>
          )}
          {!loading && results.length === 0 && query.trim() && (
            <div className="px-4 py-6 text-center">
              <p className="text-sm text-gray-500">No matches for <span className="font-medium text-gray-900">&ldquo;{query}&rdquo;</span></p>
            </div>
          )}
          {!loading && results.length === 0 && !query.trim() && (
            <div className="px-3 py-2.5 text-sm text-gray-400">Type to search…</div>
          )}
          {results.map(client => {
            const name    = client.userId?.name ?? '—'
            const email   = client.userId?.email ?? ''
            const phone   = client.userId?.phone ?? client.phone ?? ''
            const company = client.company ?? ''

            return (
              <button key={client.id} type="button"
                onClick={() => select(client)}
                className="w-full flex items-center gap-3 rounded-lg px-2.5 py-2 hover:bg-gray-100 transition-colors text-left">
                <div className="size-8 rounded-full bg-gray-100 text-gray-700 text-xs font-semibold flex items-center justify-center shrink-0">
                  {initials(name)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-900">{name}</p>
                  <div className="flex items-center gap-3 mt-0.5 flex-wrap">
                    {company && (
                      <span className="flex items-center gap-1 text-xs text-gray-500">
                        <Building2 className="w-3 h-3" />{company}
                      </span>
                    )}
                    {email && (
                      <span className="flex items-center gap-1 text-xs text-gray-400">
                        <Mail className="w-3 h-3" />{email}
                      </span>
                    )}
                    {phone && (
                      <span className="flex items-center gap-1 text-xs text-gray-400">
                        <Phone className="w-3 h-3" />{phone}
                      </span>
                    )}
                  </div>
                </div>
              </button>
            )
          })}
        </div>
      )}

      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  )
}
