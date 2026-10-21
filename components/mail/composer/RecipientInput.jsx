'use client'

import { forwardRef, useCallback, useEffect, useId, useImperativeHandle, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'
import Avatar from '@/components/ui/Avatar'
import Badge from '@/components/ui/Badge'
import { cn } from '@/lib/utils'
import { dedupeAddresses, formatAddress, isValidAddress, mailApi, parseAddressList } from './composeUtils'

const SOURCE_LABEL = { client: 'Client', lead: 'Lead', staff: 'Staff' }

// Shared across composer windows: the same prefix is typed again and again.
const contactCache = new Map()

async function fetchContacts(q, signal) {
  const k = q.toLowerCase()
  if (contactCache.has(k)) return contactCache.get(k)
  const data = await mailApi(`/api/mail/contacts?q=${encodeURIComponent(q)}`, { signal })
  const list = Array.isArray(data) ? data : []
  contactCache.set(k, list)
  if (contactCache.size > 200) contactCache.delete(contactCache.keys().next().value)
  return list
}

/**
 * Chip input for one recipient field. `ref.flush()` commits typed text and
 * returns the resulting list synchronously (send reads it before state settles).
 */
const RecipientInput = forwardRef(function RecipientInput({ label, value, onChange, trailing, autoFocus }, ref) {
  const [text, setText] = useState('')
  const [focused, setFocused] = useState(false)
  const [items, setItems] = useState([])
  const [active, setActive] = useState(-1)
  const [rect, setRect] = useState(null)
  const inputRef = useRef(null)
  const rowRef = useRef(null)
  const listId = useId()
  const valueRef = useRef(value)
  const textRef = useRef(text)
  valueRef.current = value
  textRef.current = text

  const open = focused && items.length > 0 && !!text.trim()

  const emit = useCallback((next) => {
    valueRef.current = next
    onChange(next)
  }, [onChange])

  const commit = useCallback((raw) => {
    const source = raw ?? textRef.current
    textRef.current = ''
    setText('')
    setItems([])
    const parsed = parseAddressList(source)
    if (!parsed.length) return valueRef.current
    const next = dedupeAddresses([...valueRef.current, ...parsed])
    emit(next)
    return next
  }, [emit])

  useImperativeHandle(ref, () => ({
    flush: () => (textRef.current.trim() ? commit() : valueRef.current),
    focus: () => inputRef.current?.focus(),
  }), [commit])

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus()
  }, [autoFocus])

  // Debounced contact lookup.
  useEffect(() => {
    const q = text.trim()
    if (!q || /[,;]/.test(q)) { setItems([]); return }
    const ctrl = new AbortController()
    const cached = contactCache.has(q.toLowerCase())
    const timer = setTimeout(async () => {
      try {
        const list = await fetchContacts(q, ctrl.signal)
        const taken = new Set(valueRef.current.map((a) => a.address.toLowerCase()))
        const next = list.filter((c) => c?.address && !taken.has(c.address.toLowerCase())).slice(0, 8)
        setItems(next)
        setActive(next.length ? 0 : -1)
      } catch (err) {
        if (err?.name !== 'AbortError') setItems([])
      }
    }, cached ? 0 : 180)
    return () => { clearTimeout(timer); ctrl.abort() }
  }, [text])

  // The listbox is portalled (the composer body scrolls/clips) and follows the row.
  useEffect(() => {
    if (!open) return
    const place = () => {
      const r = rowRef.current?.getBoundingClientRect()
      if (r) setRect({ top: r.bottom + 4, left: r.left + 8, width: Math.min(Math.max(r.width - 16, 260), 380) })
    }
    place()
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
    }
  }, [open])

  function pick(contact) {
    emit(dedupeAddresses([...valueRef.current, { name: contact.name || '', address: contact.address }]))
    textRef.current = ''
    setText('')
    setItems([])
    inputRef.current?.focus()
  }

  function removeAt(i) {
    emit(value.filter((_, idx) => idx !== i))
    inputRef.current?.focus()
  }

  function editAt(i) {
    const a = value[i]
    if (textRef.current.trim()) commit()
    emit(valueRef.current.filter((x) => x !== a))
    setText(formatAddress(a))
    requestAnimationFrame(() => inputRef.current?.select())
  }

  function onKeyDown(e) {
    const mod = e.ctrlKey || e.metaKey
    if (open) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setActive((i) => (i + 1) % items.length); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setActive((i) => (i - 1 + items.length) % items.length); return }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setItems([]); return }
      if (((e.key === 'Enter' && !mod) || (e.key === 'Tab' && !e.shiftKey)) && active >= 0 && items[active]) {
        if (e.key === 'Enter') e.preventDefault()
        pick(items[active])
        return
      }
    }
    if (mod && e.key === 'Enter') { if (text.trim()) commit(); return } // composer sends
    // A separator inside an open quote belongs to the display name ("Doe, Jane" <…>).
    if ((e.key === ',' || e.key === ';') && (text.match(/"/g) || []).length % 2 === 1) return
    if (e.key === 'Enter' || e.key === ',' || e.key === ';') {
      e.preventDefault()
      if (text.trim()) commit()
      return
    }
    if (e.key === 'Tab' && !e.shiftKey && text.trim()) { commit(); return }
    if (e.key === 'Backspace' && !text && value.length && !e.repeat) {
      e.preventDefault()
      emit(value.slice(0, -1))
    }
  }

  function onPaste(e) {
    const pasted = e.clipboardData?.getData('text') || ''
    if (/[,;\n]/.test(pasted) || parseAddressList(pasted).length > 1) {
      e.preventDefault()
      commit(`${textRef.current}${pasted}`)
    }
  }

  const activeId = open && active >= 0 ? `${listId}-${active}` : undefined

  return (
    <div
      ref={rowRef}
      className="flex min-h-10 items-start gap-2 border-b border-gray-100 px-4 py-1.5"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) { e.preventDefault(); inputRef.current?.focus() }
      }}
    >
      <label htmlFor={`${listId}-input`} className="mt-[5px] w-12 shrink-0 text-[13px] text-gray-500">{label}</label>
      <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
        {value.map((a, i) => {
          const valid = isValidAddress(a.address)
          return (
            <span
              key={`${a.address}-${i}`}
              title={formatAddress(a)}
              onDoubleClick={() => editAt(i)}
              className={cn(
                'inline-flex h-6 max-w-full items-center gap-0.5 rounded-full pl-2 pr-0.5 text-[13px]',
                valid ? 'bg-gray-100 text-gray-800' : 'bg-red-50 text-red-700 ring-1 ring-inset ring-red-200'
              )}
            >
              <span className="truncate">{a.name || a.address}</span>
              <button
                type="button"
                tabIndex={-1}
                onClick={() => removeAt(i)}
                aria-label={`Remove ${a.address}`}
                className={cn(
                  'inline-flex size-5 shrink-0 items-center justify-center rounded-full',
                  valid ? 'text-gray-400 hover:bg-gray-200 hover:text-gray-700' : 'text-red-400 hover:bg-red-100 hover:text-red-700'
                )}
              >
                <X className="size-3" />
              </button>
            </span>
          )
        })}
        <input
          id={`${listId}-input`}
          ref={inputRef}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={activeId}
          aria-autocomplete="list"
          autoComplete="off"
          spellCheck={false}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false)
            if (textRef.current.trim()) commit()
          }}
          className="h-7 min-w-[140px] flex-1 border-0 bg-transparent p-0 text-sm text-gray-900 shadow-none outline-none placeholder:text-gray-400 focus:border-0 focus:outline-none focus:ring-0"
        />
      </div>
      {trailing && <div className="mt-[3px] flex shrink-0 items-center gap-0.5">{trailing}</div>}

      {open && rect && typeof document !== 'undefined' && createPortal(
        <ul
          id={listId}
          role="listbox"
          aria-label={`${label} suggestions`}
          onMouseDown={(e) => e.preventDefault()}
          style={{ position: 'fixed', top: rect.top, left: rect.left, width: rect.width }}
          className="pointer-events-auto z-[70] max-h-72 overflow-y-auto rounded-xl border border-gray-200/80 bg-white p-1 shadow-lg animate-in fade-in-0 zoom-in-95 duration-100"
        >
          {items.map((c, i) => (
            <li
              key={c.address}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onClick={() => pick(c)}
              className={cn('flex cursor-pointer items-center gap-2.5 rounded-md px-2 py-1.5', i === active && 'bg-gray-100')}
            >
              <Avatar name={c.name || c.address} size="xs" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm text-gray-900">{c.name || c.address}</div>
                {c.name && <div className="truncate text-xs text-gray-500">{c.address}</div>}
              </div>
              {SOURCE_LABEL[c.source] && <Badge variant="outline" className="shrink-0">{SOURCE_LABEL[c.source]}</Badge>}
            </li>
          ))}
        </ul>,
        document.body
      )}
    </div>
  )
})

export default RecipientInput
