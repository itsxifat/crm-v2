'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from 'react'
import { CircleAlert, Inbox, Mail, MessagesSquare, PanelLeft, Paperclip, RefreshCw, Search, SearchX, Star, X } from 'lucide-react'
import Button from '@/components/ui/Button'
import EmptyState from '@/components/ui/EmptyState'
import { cn } from '@/lib/utils'
import BulkToolbar from './BulkToolbar'
import MessageRow from './MessageRow'
import { FILTER_CHIPS, SEARCH_OPERATORS, formatCount } from './mailUtils'
import { Checkbox, IconButton, Skeleton, Switch, Tip } from './ui'

const CHIP_ICONS = { unread: Mail, starred: Star, attachments: Paperclip }

// ─── Search ───────────────────────────────────────────────────────────────────

const SearchBox = forwardRef(function SearchBox({ value, onSearch }, ref) {
  const inputRef = useRef(null)
  const timer = useRef(null)
  const [text, setText] = useState(value || '')
  const [focused, setFocused] = useState(false)

  useImperativeHandle(ref, () => ({
    focus: () => { inputRef.current?.focus(); inputRef.current?.select() },
  }), [])

  useEffect(() => { setText(value || '') }, [value])
  useEffect(() => () => clearTimeout(timer.current), [])

  function commit(v, delay = 0) {
    clearTimeout(timer.current)
    if (delay) timer.current = setTimeout(() => onSearch(v.trim()), delay)
    else onSearch(v.trim())
  }

  function insertOperator(op) {
    const base = text && !text.endsWith(' ') ? `${text} ` : text
    const next = `${base}${op}${op.endsWith(':') ? '' : ' '}`
    setText(next)
    if (!op.endsWith(':')) commit(next)
    requestAnimationFrame(() => inputRef.current?.focus())
  }

  const showHints = focused && !text

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
      <input
        ref={inputRef}
        type="text"
        value={text}
        onChange={(e) => { setText(e.target.value); commit(e.target.value, 450) }}
        onFocus={() => setFocused(true)}
        onBlur={() => setFocused(false)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); commit(text) }
          if (e.key === 'Escape') {
            e.preventDefault()
            if (text) { setText(''); commit('') } else inputRef.current?.blur()
          }
        }}
        placeholder="Search mail"
        spellCheck={false}
        aria-label="Search mail"
        className="h-9 w-full rounded-lg border border-input bg-white pl-9 pr-8 text-sm text-gray-900 shadow-xs outline-none transition-[color,box-shadow,border-color] placeholder:text-gray-400 focus:border-ring focus:ring-[3px] focus:ring-ring/30"
      />
      {text ? (
        <button
          type="button"
          onClick={() => { setText(''); commit(''); inputRef.current?.focus() }}
          className="absolute right-2 top-1/2 inline-flex size-5 -translate-y-1/2 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-700"
          aria-label="Clear search"
        >
          <X className="size-3.5" />
        </button>
      ) : (
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-gray-200 bg-gray-50 px-1.5 font-sans text-[11px] font-medium text-gray-400 sm:block">/</kbd>
      )}

      {showHints && (
        <div className="absolute inset-x-0 top-full z-30 mt-1.5 rounded-xl border border-gray-200/80 bg-white p-1 shadow-lg animate-in fade-in-0 zoom-in-95 duration-100">
          {SEARCH_OPERATORS.map(o => (
            <button
              key={o.op}
              type="button"
              onMouseDown={(e) => { e.preventDefault(); insertOperator(o.op) }}
              className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-gray-100"
            >
              <span className="font-mono text-[12.5px] text-gray-900">{o.op}</span>
              <span className="text-xs text-muted-foreground">{o.hint}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
})

// ─── Skeleton ─────────────────────────────────────────────────────────────────

export function ListSkeleton({ rows = 10 }) {
  return (
    <div aria-hidden>
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex gap-3 border-b border-gray-100 py-3 pl-3 pr-3">
          <Skeleton className="size-8 shrink-0 rounded-full" />
          <div className="min-w-0 flex-1 space-y-2 pt-0.5">
            <div className="flex items-center justify-between gap-6">
              <Skeleton className="h-3 w-1/3" />
              <Skeleton className="h-3 w-10" />
            </div>
            <Skeleton className={cn('h-3', i % 3 === 0 ? 'w-4/5' : i % 3 === 1 ? 'w-11/12' : 'w-3/5')} />
          </div>
        </div>
      ))}
    </div>
  )
}

// ─── List ─────────────────────────────────────────────────────────────────────

export default function MessageList({
  title, items, loading, loadingMore, error, total, hasMore, hasMoreRemote, loadingOlder,
  onLoadMore, onLoadOlder, onRetry, onRefresh, refreshing,
  activeId, cursorId, selected, onToggle, onToggleAll, onClearSelection,
  onOpen, onQuick, onStar, onDragStart,
  accountsById, showAccountStripe, outgoing,
  search, onSearch, searchRef, chips, onChip, hiddenChips = [], threads, onThreads, threadsDisabled,
  bulk, onRailButton, railButtonLabel, emptyIcon, className,
}) {
  const scrollRef = useRef(null)
  const sentinelRef = useRef(null)
  const loadMoreRef = useRef(onLoadMore)
  loadMoreRef.current = onLoadMore

  // Infinite scroll
  useEffect(() => {
    const root = scrollRef.current
    const el = sentinelRef.current
    if (!root || !el || !hasMore) return
    const io = new IntersectionObserver((entries) => {
      if (entries.some(e => e.isIntersecting)) loadMoreRef.current?.()
    }, { root, rootMargin: '600px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [hasMore, items.length])

  // Keep the keyboard cursor visible.
  useEffect(() => {
    if (!cursorId || !scrollRef.current) return
    const row = scrollRef.current.querySelector(`[data-row-id="${CSS.escape(cursorId)}"]`)
    row?.scrollIntoView({ block: 'nearest' })
  }, [cursorId])

  // Back to top when the list itself changes (folder / search).
  const firstId = items[0]?.id
  useEffect(() => {
    if (loading && scrollRef.current) scrollRef.current.scrollTop = 0
  }, [loading, firstId])

  const selCount = selected.size
  const allChecked = items.length > 0 && items.every(i => selected.has(i.id))
  const isSearch = !!search || FILTER_CHIPS.some(c => chips[c.key])
  const range = total > 0 ? `${items.length ? 1 : 0}–${formatCount(items.length)} of ${formatCount(Math.max(total, items.length))}` : ''

  return (
    <section className={cn('flex h-full min-h-0 min-w-0 flex-col bg-white', className)} aria-label="Messages">
      {selCount > 0 ? (
        <BulkToolbar
          count={selCount}
          allChecked={allChecked}
          onToggleAll={() => onToggleAll(!allChecked)}
          onClear={onClearSelection}
          {...bulk}
        />
      ) : (
        <div className="flex h-12 shrink-0 items-center gap-1 border-b border-gray-200/80 pl-3 pr-2">
          {onRailButton && (
            <IconButton label={railButtonLabel || 'Folders'} onClick={onRailButton} className="-ml-1.5">
              <PanelLeft />
            </IconButton>
          )}
          <span className="mr-1.5 flex size-8 items-center justify-center">
            <Checkbox checked={false} onToggle={() => onToggleAll(true)} label="Select all" disabled={!items.length} />
          </span>
          <h2 className="min-w-0 truncate text-sm font-semibold text-gray-900">{title}</h2>
          <span className="ml-auto shrink-0 pl-2 text-xs tabular-nums text-muted-foreground">{range}</span>
          <IconButton label="Refresh" onClick={onRefresh} disabled={refreshing}>
            <RefreshCw className={cn(refreshing && 'animate-spin')} />
          </IconButton>
        </div>
      )}

      <div className="shrink-0 space-y-2 border-b border-gray-200/80 px-3 pb-2 pt-2.5">
        <SearchBox ref={searchRef} value={search} onSearch={onSearch} />
        <div className="flex min-w-0 items-center gap-1.5">
          {FILTER_CHIPS.filter(c => !hiddenChips.includes(c.key)).map(c => {
            const on = !!chips[c.key]
            const Icon = CHIP_ICONS[c.key]
            return (
              <button
                key={c.key}
                type="button"
                aria-pressed={on}
                onClick={() => onChip(c.key)}
                className={cn(
                  'inline-flex h-7 items-center gap-1.5 rounded-full border px-2.5 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50',
                  on ? 'border-gray-900 bg-gray-900 text-white' : 'border-gray-200 bg-white text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                )}
              >
                <Icon className="size-3.5" />
                {c.label}
              </button>
            )
          })}
          {!threadsDisabled && (
            <Tip label="Conversations">
              <label className="ml-auto flex shrink-0 cursor-pointer select-none items-center gap-1.5 pl-1 text-gray-500">
                <MessagesSquare className="size-4" />
                <Switch checked={threads} onChange={onThreads} label="Conversations" />
              </label>
            </Tip>
          )}
        </div>
      </div>

      <div ref={scrollRef} role="listbox" aria-label={title} aria-multiselectable className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
        {loading ? (
          <ListSkeleton />
        ) : error ? (
          <EmptyState
            icon={CircleAlert}
            title="Couldn't load messages"
            description={error}
            action={<Button variant="outline" size="sm" onClick={onRetry}>Retry</Button>}
          />
        ) : !items.length ? (
          <div className="flex h-full flex-col justify-center">
            <EmptyState icon={isSearch ? SearchX : emptyIcon || Inbox} title={isSearch ? 'No results' : 'No messages'} />
            {hasMoreRemote && (
              <div className="-mt-6 flex justify-center pb-8">
                <Button variant="outline" size="sm" onClick={onLoadOlder} loading={loadingOlder}>Load older from server</Button>
              </div>
            )}
          </div>
        ) : (
          <>
            {items.map(item => (
              <MessageRow
                key={item.id}
                item={item}
                stripeColor={showAccountStripe ? accountsById[item.accountId]?.color : null}
                active={item.id === activeId}
                cursor={item.id === cursorId}
                checked={selected.has(item.id)}
                selecting={selCount > 0}
                outgoing={outgoing}
                onOpen={onOpen}
                onToggle={onToggle}
                onStar={onStar}
                onQuick={onQuick}
                onDragStart={onDragStart}
              />
            ))}
            <div ref={sentinelRef} className="h-px" />
            {loadingMore && <ListSkeleton rows={3} />}
            {!hasMore && !loadingMore && hasMoreRemote && (
              <div className="flex justify-center px-3 py-5">
                <Button variant="outline" size="sm" onClick={onLoadOlder} loading={loadingOlder}>Load older from server</Button>
              </div>
            )}
          </>
        )}
      </div>
    </section>
  )
}
