'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useTagSuggestions } from './hooks'
import { MAX_TAGS, normalizeTag } from './utils'

/**
 * Tag chips + input with suggestions from /api/organizer/tags (inline dropdown, safe in dialogs).
 *   value     string[]
 *   onChange  (string[]) => void
 * Enter / comma / Tab adds, Backspace on empty removes the last tag.
 */
export default function TagInput({ value = [], onChange, disabled = false, placeholder = 'Add tags…', className }) {
  const all = useTagSuggestions()
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  const [activeIdx, setActiveIdx] = useState(-1)
  const inputRef = useRef(null)
  const boxRef = useRef(null)

  const full = value.length >= MAX_TAGS

  const suggestions = useMemo(() => {
    const q = normalizeTag(text)
    const pool = all.filter((t) => !value.includes(t))
    const list = q ? pool.filter((t) => t.includes(q)).sort((a, b) => (a.startsWith(q) ? 0 : 1) - (b.startsWith(q) ? 0 : 1)) : pool
    return list.slice(0, 8)
  }, [all, text, value])

  useEffect(() => { setActiveIdx(-1) }, [text])

  function add(raw) {
    const parts = String(raw).split(',').map(normalizeTag).filter(Boolean)
    if (!parts.length) return
    const next = [...value]
    for (const p of parts) if (!next.includes(p) && next.length < MAX_TAGS) next.push(p)
    onChange?.(next)
    setText('')
  }

  function remove(tag) {
    onChange?.(value.filter((t) => t !== tag))
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown' && suggestions.length) { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, suggestions.length - 1)); return }
    if (e.key === 'ArrowUp' && suggestions.length) { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, -1)); return }
    if (e.key === 'Enter' || e.key === ',' || (e.key === 'Tab' && text.trim())) {
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) return // let the form's save shortcut through
      const pick = activeIdx >= 0 ? suggestions[activeIdx] : text
      if (!String(pick).trim()) { if (e.key === ',') e.preventDefault(); return }
      e.preventDefault()
      add(pick)
      return
    }
    if (e.key === 'Backspace' && !text && value.length) {
      remove(value[value.length - 1])
    }
  }

  const showSuggestions = focused && !disabled && !full && suggestions.length > 0

  return (
    <div ref={boxRef} className={cn('relative', className)}>
      <div
        onClick={() => inputRef.current?.focus()}
        className={cn(
          'flex min-h-9 w-full cursor-text flex-wrap items-center gap-1.5 rounded-lg border border-input bg-white px-2 py-1.5 shadow-xs transition-[color,box-shadow,border-color]',
          focused && 'border-ring ring-[3px] ring-ring/30',
          disabled && 'cursor-not-allowed bg-gray-50 opacity-60'
        )}
      >
        {value.map((t) => (
          <span key={t} className="inline-flex h-6 items-center gap-1 rounded-md bg-gray-100 pl-2 pr-1 text-xs font-medium text-gray-700">
            #{t}
            {!disabled && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); remove(t) }}
                aria-label={`Remove ${t}`}
                className="inline-flex size-4 items-center justify-center rounded text-gray-400 hover:bg-gray-200 hover:text-gray-700"
              >
                <X className="size-3" />
              </button>
            )}
          </span>
        ))}
        {!full && (
          <input
            ref={inputRef}
            value={text}
            disabled={disabled}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKeyDown}
            onFocus={() => setFocused(true)}
            onBlur={() => {
              // Commit a half-typed tag so clicking Save never drops it.
              setFocused(false)
              if (text.trim()) add(text)
            }}
            placeholder={value.length ? '' : placeholder}
            className="h-6 min-w-[80px] flex-1 border-0 bg-transparent p-0 px-1 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:ring-0"
          />
        )}
      </div>

      {showSuggestions && (
        <div className="absolute inset-x-0 top-full z-50 mt-1.5 max-h-56 overflow-y-auto rounded-xl border border-gray-200/80 bg-white p-1 shadow-lg animate-in fade-in-0 zoom-in-95 duration-100">
          {suggestions.map((t, i) => (
            <button
              key={t}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); add(t) }}
              onMouseMove={() => activeIdx !== i && setActiveIdx(i)}
              className={cn(
                'flex w-full items-center rounded-md px-2 py-1.5 text-left text-sm text-gray-700',
                i === activeIdx && 'bg-gray-100 text-gray-900'
              )}
            >
              <span className="text-gray-400">#</span>{t}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
