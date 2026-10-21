'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, Loader2, X, Check } from 'lucide-react'
import Avatar from '@/components/ui/Avatar'
import { cn } from '@/lib/utils'
import { mailApi } from './api'

const pickUser = (u) => ({ id: u.id, name: u.name, email: u.email, avatar: u.avatar ?? null, role: u.role })

/**
 * Searchable multi-select of staff (GET /api/mail/assignable-users?q=).
 * value: [{ id, name, email, avatar, role }] · onChange(users)
 */
export default function UserMultiPicker({ value = [], onChange }) {
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [cursor, setCursor] = useState(0)
  const reqId = useRef(0)
  const listRef = useRef(null)

  useEffect(() => {
    const id = ++reqId.current // drop out-of-order responses for older terms
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const term = q.trim()
        const json = await mailApi(`/api/mail/assignable-users${term ? `?q=${encodeURIComponent(term)}` : ''}`)
        if (id !== reqId.current) return
        setResults(Array.isArray(json.data) ? json.data : [])
        setError(null)
        setCursor(0)
      } catch (err) {
        if (id !== reqId.current) return
        setResults([])
        setError(err.message)
      } finally {
        if (id === reqId.current) setLoading(false)
      }
    }, q ? 250 : 0)
    return () => clearTimeout(t)
  }, [q])

  const selectedIds = useMemo(() => new Set(value.map(u => u.id)), [value])

  const toggle = (u) => {
    if (selectedIds.has(u.id)) onChange(value.filter(x => x.id !== u.id))
    else onChange([...value, pickUser(u)])
  }
  const remove = (id) => onChange(value.filter(x => x.id !== id))

  const onKeyDown = (e) => {
    if (!results.length) return
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = (cursor + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % results.length
      setCursor(next)
      listRef.current?.querySelector(`[data-idx="${next}"]`)?.scrollIntoView({ block: 'nearest' })
    } else if (e.key === 'Enter') {
      e.preventDefault()
      const u = results[cursor]
      if (u) toggle(u)
    }
  }

  return (
    <div className="space-y-3">
      {value.length > 0 && (
        <div className="flex flex-wrap gap-1.5">
          {value.map(u => (
            <span
              key={u.id}
              className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-gray-200/80 bg-white py-0.5 pl-0.5 pr-1 text-[13px] font-medium text-gray-800 shadow-xs"
            >
              <Avatar src={u.avatar} name={u.name} size="xs" className="h-5 w-5 text-[9px]" />
              <span className="truncate">{u.name}</span>
              <button
                type="button"
                onClick={() => remove(u.id)}
                aria-label={`Remove ${u.name}`}
                className="inline-flex size-4 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900"
              >
                <X className="size-3" />
              </button>
            </span>
          ))}
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-input bg-white shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30">
        <div className="flex h-10 items-center gap-2 border-b border-gray-100 px-3">
          <Search className="size-4 shrink-0 text-gray-400" />
          <input
            value={q}
            onChange={e => setQ(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder="Search staff"
            aria-label="Search staff"
            className="h-full flex-1 border-0 bg-transparent p-0 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:ring-0"
          />
          {loading && <Loader2 className="size-4 shrink-0 animate-spin text-gray-400" />}
        </div>

        <div ref={listRef} role="listbox" aria-multiselectable="true" className="max-h-72 overflow-y-auto p-1">
          {error ? (
            <p className="px-3 py-6 text-center text-sm text-red-600">{error}</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-6 text-center text-sm text-muted-foreground">{loading ? 'Loading…' : 'No matches'}</p>
          ) : (
            results.map((u, i) => {
              const selected = selectedIds.has(u.id)
              return (
                <button
                  key={u.id}
                  type="button"
                  role="option"
                  aria-selected={selected}
                  data-idx={i}
                  onClick={() => toggle(u)}
                  onMouseEnter={() => setCursor(i)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left transition-colors',
                    i === cursor ? 'bg-gray-100' : 'hover:bg-gray-100'
                  )}
                >
                  <span
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors',
                      selected ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white'
                    )}
                  >
                    {selected && <Check className="size-3" strokeWidth={3} />}
                  </span>
                  <Avatar src={u.avatar} name={u.name} size="xs" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium text-gray-900">{u.name}</span>
                    <span className="block truncate text-xs text-muted-foreground">{u.email}</span>
                  </span>
                  {u.designation && (
                    <span className="hidden max-w-[160px] truncate text-xs text-muted-foreground sm:block">{u.designation}</span>
                  )}
                </button>
              )
            })
          )}
        </div>
      </div>
    </div>
  )
}
