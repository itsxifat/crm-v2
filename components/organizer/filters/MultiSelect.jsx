'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, ChevronDown, CirclePlus, Loader2, Search } from 'lucide-react'
import { cn } from '@/lib/utils'
import Avatar from '@/components/ui/Avatar'
import { buttonVariants } from '@/components/ui/Button'
import { colorClasses } from '../constants'
import Popover from './Popover'

/**
 * Faceted select in a popover: search + checkboxes (multiple) or a check list (single).
 *
 * Props:
 *   label, icon          trigger text / lucide icon
 *   options              [{ value, label, color?: paletteKey, dotClass?, avatar?: { src, name }, icon?, hint? }]
 *   value                string[] (multiple) | string ('' = none) (single)
 *   onChange             (string[] | string) => void
 *   multiple             default true
 *   searchable           default: options.length > 7 or loadOptions given
 *   loadOptions          async (q) => options  (remote search; `options` stay pinned on top)
 *   getLabel             (value) => string     (label for selected values not in the list)
 *   variant              'facet' (dashed until active) | 'value' (shows the selected label)
 *   clearable            default true
 *   align, width, className (trigger), emptyText, placeholder
 */
export default function MultiSelect({
  label,
  icon: Icon,
  options = [],
  value,
  onChange,
  multiple = true,
  searchable,
  loadOptions,
  getLabel,
  variant = 'facet',
  clearable = true,
  align = 'start',
  width = 260,
  className,
  emptyText = 'No results',
  placeholder,
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [remote, setRemote] = useState([])
  const [loading, setLoading] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const labelCache = useRef(new Map())
  const reqId = useRef(0)
  const inputRef = useRef(null)
  const listRef = useRef(null)

  const selected = useMemo(
    () => (multiple ? (Array.isArray(value) ? value : []) : (value ? [value] : [])),
    [multiple, value]
  )
  const canSearch = searchable ?? (!!loadOptions || options.length > 7)

  // Remember labels of every option we have seen so chips/triggers can name selected values.
  useEffect(() => {
    for (const o of [...options, ...remote]) labelCache.current.set(o.value, o)
  }, [options, remote])

  // Remote search (debounced) while open.
  useEffect(() => {
    if (!open || !loadOptions) return
    const id = ++reqId.current
    setLoading(true)
    const t = setTimeout(async () => {
      try {
        const res = await loadOptions(query.trim())
        if (id === reqId.current) setRemote(Array.isArray(res) ? res : [])
      } catch {
        if (id === reqId.current) setRemote([])
      } finally {
        if (id === reqId.current) setLoading(false)
      }
    }, 200)
    return () => clearTimeout(t)
  }, [open, query, loadOptions])

  useEffect(() => {
    if (!open) { setQuery(''); return }
    setActiveIdx(0)
    setTimeout(() => (canSearch ? inputRef.current : listRef.current)?.focus({ preventScroll: true }), 30)
  }, [open, canSearch])

  const labelOf = (v) =>
    options.find((o) => o.value === v)?.label ??
    labelCache.current.get(v)?.label ??
    getLabel?.(v) ??
    v

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const local = q ? options.filter((o) => String(o.label).toLowerCase().includes(q)) : options
    const seen = new Set(local.map((o) => o.value))
    const extra = loadOptions ? remote.filter((o) => !seen.has(o.value)) : []
    const list = [...local, ...extra]
    // Keep selected values that aren't in the current list visible (so they can be unticked).
    if (!q && multiple) {
      const listed = new Set(list.map((o) => o.value))
      const missing = selected.filter((v) => !listed.has(v)).map((v) => labelCache.current.get(v) ?? { value: v, label: labelOf(v) })
      return [...missing, ...list]
    }
    return list
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, options, remote, loadOptions, multiple, selected])

  useEffect(() => { setActiveIdx(0) }, [query])

  function toggle(v) {
    if (multiple) {
      onChange?.(selected.includes(v) ? selected.filter((x) => x !== v) : [...selected, v])
    } else {
      onChange?.(selected[0] === v && clearable ? '' : v)
      setOpen(false)
    }
  }

  function clear() {
    onChange?.(multiple ? [] : '')
    if (!multiple) setOpen(false)
  }

  function onKeyDown(e) {
    if (e.key === 'ArrowDown') { e.preventDefault(); setActiveIdx((i) => Math.min(i + 1, visible.length - 1)) }
    else if (e.key === 'ArrowUp') { e.preventDefault(); setActiveIdx((i) => Math.max(i - 1, 0)) }
    else if (e.key === 'Enter') {
      e.preventDefault()
      const o = visible[activeIdx]
      if (o) toggle(o.value)
    }
  }

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${activeIdx}"]`)
    el?.scrollIntoView?.({ block: 'nearest' })
  }, [activeIdx])

  const active = selected.length > 0
  const summary = multiple
    ? (selected.length === 1 ? labelOf(selected[0]) : `${selected.length} selected`)
    : (active ? labelOf(selected[0]) : null)

  const trigger = variant === 'value' ? (
    <button
      type="button"
      onClick={() => setOpen((o) => !o)}
      className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'max-w-full font-normal', open && 'bg-accent', className)}
    >
      {Icon && <Icon className="text-gray-500" />}
      {label && <span className="text-gray-500">{label}</span>}
      <span className="truncate font-medium text-gray-900">{summary ?? placeholder ?? 'Any'}</span>
      <ChevronDown className="size-3.5 text-gray-400" />
    </button>
  ) : (
    <button
      type="button"
      onClick={() => setOpen((o) => !o)}
      className={cn(
        buttonVariants({ variant: 'outline', size: 'sm' }),
        'max-w-full font-normal',
        !active && 'border-dashed text-gray-600',
        open && 'bg-accent',
        className
      )}
    >
      {Icon ? <Icon className="text-gray-500" /> : <CirclePlus className="text-gray-500" />}
      <span className={cn(active && 'font-medium text-gray-900')}>{label}</span>
      {active && (
        <>
          <span className="h-4 w-px bg-gray-200" />
          {multiple && selected.length > 1 ? (
            <span className="rounded-md bg-gray-100 px-1.5 text-xs font-medium tabular-nums text-gray-700">{selected.length}</span>
          ) : (
            <span className="max-w-[120px] truncate rounded-md bg-gray-100 px-1.5 text-xs font-medium text-gray-700">{summary}</span>
          )}
        </>
      )}
    </button>
  )

  return (
    <Popover open={open} onOpenChange={setOpen} trigger={trigger} align={align} width={width} title={label}>
      {canSearch && (
        <div className="sticky top-0 z-10 flex items-center gap-2 border-b border-gray-100 bg-white px-3">
          <Search className="size-4 shrink-0 text-gray-400" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            placeholder={placeholder ?? `Search ${String(label ?? '').toLowerCase()}…`}
            className="h-10 w-full border-0 bg-transparent p-0 text-sm text-gray-900 outline-none placeholder:text-gray-400 focus:ring-0"
          />
          {loading && <Loader2 className="size-4 shrink-0 animate-spin text-gray-400" />}
        </div>
      )}

      <div
        ref={listRef}
        role="listbox"
        aria-multiselectable={multiple || undefined}
        tabIndex={canSearch ? -1 : 0}
        onKeyDown={canSearch ? undefined : onKeyDown}
        className="p-1 outline-none"
      >
        {visible.length === 0 ? (
          <p className="px-3 py-6 text-center text-sm text-gray-400">{loading ? 'Searching…' : emptyText}</p>
        ) : (
          visible.map((o, i) => {
            const isSel = selected.includes(o.value)
            const OIcon = o.icon
            return (
              <button
                key={o.value}
                type="button"
                role="option"
                aria-selected={isSel}
                data-idx={i}
                onClick={() => toggle(o.value)}
                onMouseMove={() => activeIdx !== i && setActiveIdx(i)}
                className={cn(
                  'flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left text-sm text-gray-700 transition-colors sm:py-1.5',
                  i === activeIdx && 'bg-gray-100 text-gray-900'
                )}
              >
                {multiple ? (
                  <span
                    className={cn(
                      'flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors',
                      isSel ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-300 bg-white'
                    )}
                  >
                    {isSel && <Check className="size-3" strokeWidth={3} />}
                  </span>
                ) : null}
                {o.avatar ? (
                  <Avatar src={o.avatar.src} name={o.avatar.name ?? o.label} size="xs" className="!size-5 text-[9px]" />
                ) : o.color ? (
                  <span className={cn('size-2 shrink-0 rounded-full', colorClasses(o.color).dot)} />
                ) : o.dotClass ? (
                  <span className={cn('size-2 shrink-0 rounded-full', o.dotClass)} />
                ) : OIcon ? (
                  <OIcon className="size-4 shrink-0 text-gray-400" />
                ) : null}
                <span className="min-w-0 flex-1 truncate">{o.label}</span>
                {o.hint != null && <span className="shrink-0 text-xs tabular-nums text-gray-400">{o.hint}</span>}
                {!multiple && isSel && <Check className="size-4 shrink-0 text-gray-900" />}
              </button>
            )
          })
        )}
      </div>

      {clearable && active && (
        <div className="sticky bottom-0 border-t border-gray-100 bg-white p-1">
          <button
            type="button"
            onClick={clear}
            className="w-full rounded-md px-2 py-1.5 text-center text-sm text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900"
          >
            Clear
          </button>
        </div>
      )}
    </Popover>
  )
}

export { MultiSelect }
