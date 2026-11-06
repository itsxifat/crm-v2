'use client'

import { useEffect, useRef, useState } from 'react'
import { useSession } from 'next-auth/react'
import { Check, ChevronDown, Loader2, Search, UserRound, UserX, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import Avatar from '@/components/ui/Avatar'
import { searchPeople } from './hooks'

/**
 * Staff picker (inline dropdown, safe inside dialogs).
 *   value     { id, name, avatar } | null
 *   onChange  (person | null) => void
 */
export default function AssigneePicker({ value, onChange, disabled = false, placeholder = 'Unassigned', className }) {
  const { data: session } = useSession()
  const me = session?.user?.id ? { id: session.user.id, name: session.user.name, avatar: session.user.avatar ?? null } : null

  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const boxRef = useRef(null)
  const inputRef = useRef(null)
  const reqId = useRef(0)

  useEffect(() => {
    if (!open) return
    const id = ++reqId.current
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const data = await searchPeople(q.trim())
        if (id === reqId.current) setResults(data)
      } catch {
        if (id === reqId.current) setResults([])
      } finally {
        if (id === reqId.current) setLoading(false)
      }
    }, 200)
    return () => clearTimeout(t)
  }, [q, open])

  useEffect(() => {
    if (!open) { setQ(''); return }
    setActiveIdx(0)
    setTimeout(() => inputRef.current?.focus(), 20)
    const onDown = (e) => { if (!boxRef.current?.contains(e.target)) setOpen(false) }
    // Escape closes only this dropdown. The dialog listens on document (capture), so catch it on window first.
    const onEsc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); setOpen(false) } }
    document.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onEsc, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onEsc, true)
    }
  }, [open])

  const items = []
  if (!q.trim()) {
    items.push({ key: 'none', person: null, label: 'Unassigned', icon: UserX })
    if (me) items.push({ key: `me:${me.id}`, person: me, label: `${me.name ?? 'Me'}`, hint: 'Me' })
  }
  for (const p of results) {
    if (!q.trim() && me && p.id === me.id) continue
    items.push({ key: p.id, person: { id: p.id, name: p.name, avatar: p.avatar ?? null }, label: p.name, hint: p.designation || p.email })
  }

  useEffect(() => { setActiveIdx(0) }, [q])

  function pick(person) {
    onChange?.(person)
    setOpen(false)
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, items.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); const it = items[activeIdx]; if (it) pick(it.person) }
  }

  return (
    <div ref={boxRef} className={cn('relative', className)}>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          'flex h-9 w-full items-center gap-2 rounded-lg border border-input bg-white px-3 text-left text-sm shadow-xs transition-[color,box-shadow,border-color]',
          'outline-none hover:border-gray-300 focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/30',
          'disabled:cursor-not-allowed disabled:bg-gray-50 disabled:opacity-60',
          open && 'border-ring ring-[3px] ring-ring/30'
        )}
      >
        {value ? (
          <>
            <Avatar src={value.avatar} name={value.name} size="xs" className="!size-5 text-[9px]" />
            <span className="min-w-0 flex-1 truncate text-gray-900">{value.name}</span>
            {!disabled && (
              <span
                role="button"
                tabIndex={-1}
                aria-label="Clear assignee"
                onClick={(e) => { e.stopPropagation(); onChange?.(null) }}
                className="inline-flex size-5 items-center justify-center rounded text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              >
                <X className="size-3.5" />
              </span>
            )}
          </>
        ) : (
          <>
            <UserRound className="size-4 shrink-0 text-gray-400" />
            <span className="min-w-0 flex-1 truncate text-gray-400">{placeholder}</span>
            <ChevronDown className="size-4 shrink-0 text-gray-400" />
          </>
        )}
      </button>

      {open && (
        <div className="absolute inset-x-0 top-full z-50 mt-1.5 overflow-hidden rounded-xl border border-gray-200/80 bg-white shadow-lg animate-in fade-in-0 zoom-in-95 duration-100">
          <div className="flex items-center gap-2 border-b border-gray-100 px-3">
            <Search className="size-4 shrink-0 text-gray-400" />
            <input
              ref={inputRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder="Search people…"
              className="h-10 w-full border-0 bg-transparent p-0 text-sm outline-none placeholder:text-gray-400 focus:ring-0"
            />
            {loading && <Loader2 className="size-4 shrink-0 animate-spin text-gray-400" />}
          </div>
          <div className="max-h-60 overflow-y-auto p-1">
            {items.length === 0 ? (
              <p className="px-3 py-6 text-center text-sm text-gray-400">{loading ? 'Searching…' : 'No matches'}</p>
            ) : items.map((it, i) => {
              const selected = (it.person?.id ?? null) === (value?.id ?? null)
              const Icon = it.icon
              return (
                <button
                  key={it.key}
                  type="button"
                  onClick={() => pick(it.person)}
                  onMouseMove={() => activeIdx !== i && setActiveIdx(i)}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2 py-1.5 text-left text-sm text-gray-700',
                    i === activeIdx && 'bg-gray-100 text-gray-900'
                  )}
                >
                  {Icon ? (
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-gray-100 text-gray-500">
                      <Icon className="size-3.5" />
                    </span>
                  ) : (
                    <Avatar src={it.person?.avatar} name={it.person?.name ?? ''} size="xs" />
                  )}
                  <span className="min-w-0 flex-1 truncate">{it.label}</span>
                  {it.hint && <span className="max-w-[45%] shrink-0 truncate text-xs text-gray-400">{it.hint}</span>}
                  {selected && <Check className="size-4 shrink-0 text-gray-900" />}
                </button>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
