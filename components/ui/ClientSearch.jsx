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
    if (!q.trim()) { setResults([]); setLoading(false); return }
    setLoading(true)
    debounceRef.current = setTimeout(async () => {
      try {
        const res  = await fetch(`/api/clients?search=${encodeURIComponent(q)}&limit=10`)
        const json = await res.json()
        setResults(json.data ?? [])
      } catch {
        setResults([])
      } finally {
        setLoading(false)
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
        <div className={`flex items-center gap-3 px-3 py-2.5 border rounded-lg bg-white ${error ? 'border-red-400' : 'border-gray-200'}`}>
          <div className="w-8 h-8 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center shrink-0">
            {initials(selected.userId?.name ?? selected.name)}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-sm font-medium text-gray-900 truncate">{selected.userId?.name ?? selected.name}</p>
            <p className="text-xs text-gray-400 truncate">
              {[selected.company, selected.userId?.email].filter(Boolean).join(' · ')}
            </p>
          </div>
          <button type="button" onClick={clear}
            className="p-1 text-gray-400 hover:text-red-500 transition-colors shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>
      ) : (
        /* Search input */
        <div className={`flex items-center gap-2 px-3 py-2.5 border rounded-lg bg-white ${error ? 'border-red-400' : 'border-gray-200 focus-within:border-blue-500 focus-within:ring-2 focus-within:ring-blue-100'}`}>
          <Search className="w-4 h-4 text-gray-400 shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={handleInput}
            onFocus={() => { if (query) setOpen(true) }}
            placeholder={placeholder}
            className="flex-1 text-sm bg-transparent outline-none placeholder-gray-400"
          />
          {loading && (
            <div className="w-3.5 h-3.5 border border-blue-500 border-t-transparent rounded-full animate-spin shrink-0" />
          )}
          {!loading && (
            <ChevronDown className="w-4 h-4 text-gray-300 shrink-0" />
          )}
        </div>
      )}

      {/* Dropdown */}
      {open && !selected && (
        <div className="absolute z-30 mt-1 w-full bg-white rounded-xl shadow-lg border border-gray-100 max-h-72 overflow-y-auto">
          {loading && (
            <div className="px-4 py-3 text-sm text-gray-400">Searching…</div>
          )}
          {!loading && results.length === 0 && query.trim() && (
            <div className="px-4 py-6 text-center">
              <p className="text-sm text-gray-500">No clients found for <span className="font-medium">"{query}"</span></p>
              <p className="text-xs text-gray-400 mt-1">Try name, email, company or phone</p>
            </div>
          )}
          {!loading && results.length === 0 && !query.trim() && (
            <div className="px-4 py-3 text-sm text-gray-400">Start typing to search clients…</div>
          )}
          {results.map(client => {
            const name    = client.userId?.name ?? '—'
            const email   = client.userId?.email ?? ''
            const phone   = client.userId?.phone ?? client.phone ?? ''
            const company = client.company ?? ''

            return (
              <button key={client.id} type="button"
                onClick={() => select(client)}
                className="w-full flex items-center gap-3 px-4 py-3 hover:bg-blue-50 transition-colors text-left border-b border-gray-50 last:border-0">
                <div className="w-9 h-9 rounded-full bg-blue-100 text-blue-700 text-xs font-bold flex items-center justify-center shrink-0">
                  {initials(name)}
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{name}</p>
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
