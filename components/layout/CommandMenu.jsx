'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useSession } from 'next-auth/react'
import * as Dialog from '@radix-ui/react-dialog'
import { CornerDownLeft, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import { ACCOUNT_NAV, COMMAND_EXTRAS, canSee, visibleNav } from './nav'

/** ⌘K / Ctrl+K quick navigation across every page the user can open. */
export default function CommandMenu({ open, onOpenChange }) {
  const router = useRouter()
  const { data: session } = useSession()
  const [query, setQuery] = useState('')
  const [index, setIndex] = useState(0)
  const listRef = useRef(null)

  // Global shortcut
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        onOpenChange(!open)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onOpenChange])

  useEffect(() => { if (open) { setQuery(''); setIndex(0) } }, [open])

  const entries = useMemo(() => {
    const out = []
    for (const entry of visibleNav(session)) {
      if (entry.items) entry.items.forEach(i => out.push({ ...i, group: entry.label }))
      else out.push({ ...entry, group: 'Pages' })
    }
    COMMAND_EXTRAS.filter(i => canSee(i, session)).forEach(i => out.push(i))
    ACCOUNT_NAV.filter(i => canSee(i, session)).forEach(i => out.push({ ...i, group: 'Account' }))
    return out
  }, [session])

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return entries
    const words = q.split(/\s+/)
    return entries
      .map(e => {
        const hay = `${e.label} ${e.group}`.toLowerCase()
        if (!words.every(w => hay.includes(w))) return null
        const score = e.label.toLowerCase().startsWith(q) ? 0 : e.label.toLowerCase().includes(q) ? 1 : 2
        return { e, score }
      })
      .filter(Boolean)
      .sort((a, b) => a.score - b.score)
      .map(r => r.e)
  }, [entries, query])

  useEffect(() => { setIndex(0) }, [query])

  // Keep the highlighted row in view.
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${index}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [index])

  function go(item) {
    if (!item) return
    onOpenChange(false)
    router.push(item.href)
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setIndex(i => Math.min(i + 1, results.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setIndex(i => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') { e.preventDefault(); go(results[index]) }
  }

  // Group consecutive results under their section heading.
  const sections = []
  results.forEach((item, i) => {
    const last = sections[sections.length - 1]
    if (last && last.group === item.group) last.items.push({ item, i })
    else sections.push({ group: item.group, items: [{ item, i }] })
  })

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-black/30 backdrop-blur-[2px] data-[state=open]:animate-in data-[state=open]:fade-in-0" />
        <Dialog.Content
          className="fixed left-1/2 top-[12vh] z-[80] w-[calc(100%-1.5rem)] max-w-xl -translate-x-1/2 overflow-hidden rounded-2xl border border-gray-200/80 bg-white shadow-2xl outline-none data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:zoom-in-95 duration-150"
          onKeyDown={onKeyDown}
        >
          <Dialog.Title className="sr-only">Search</Dialog.Title>
          <Dialog.Description className="sr-only">Jump to a page</Dialog.Description>
          <div className="flex items-center gap-2.5 border-b border-gray-100 px-4">
            <Search className="size-4 shrink-0 text-gray-400" />
            <input
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search pages and actions…"
              className="h-12 w-full border-0 bg-transparent p-0 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:ring-0"
            />
            <kbd className="hidden rounded-md border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-[11px] font-medium text-gray-500 sm:inline">Esc</kbd>
          </div>

          <div ref={listRef} className="max-h-[min(420px,60vh)] overflow-y-auto p-1.5">
            {results.length === 0 ? (
              <p className="py-10 text-center text-sm text-muted-foreground">No results</p>
            ) : sections.map(section => (
              <div key={`${section.group}-${section.items[0].i}`} className="pb-1">
                <p className="px-2.5 pb-1 pt-2 text-xs font-medium text-muted-foreground">{section.group}</p>
                {section.items.map(({ item, i }) => {
                  const Icon = item.icon
                  const active = i === index
                  return (
                    <button
                      key={`${item.href}-${i}`}
                      data-index={i}
                      type="button"
                      onMouseMove={() => setIndex(i)}
                      onClick={() => go(item)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-left text-sm transition-colors',
                        active ? 'bg-gray-100 text-gray-900' : 'text-gray-700'
                      )}
                    >
                      {Icon && (
                        <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-gray-200/80 bg-white shadow-xs">
                          <Icon className="size-3.5 text-gray-600" />
                        </span>
                      )}
                      <span className="flex-1 truncate">{item.label}</span>
                      {active && <CornerDownLeft className="size-3.5 text-gray-400" />}
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  )
}
