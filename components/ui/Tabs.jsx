'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * A row that scrolls sideways when its tabs don't fit. The scrollbar stays hidden, so
 * a fade and an arrow show on the side where more tabs are, and the selected tab is
 * kept in view.
 */
function Scroller({ className, outerClassName, activeKey, children }) {
  const ref = useRef(null)
  const [edges, setEdges] = useState({ left: false, right: false })

  const update = useCallback(() => {
    const el = ref.current
    if (!el) return
    const left = el.scrollLeft > 2
    const right = el.scrollLeft + el.clientWidth < el.scrollWidth - 2
    setEdges(e => (e.left === left && e.right === right ? e : { left, right }))
  }, [])

  useEffect(() => {
    const el = ref.current
    if (!el) return undefined
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(update) : null
    ro?.observe(el)
    return () => { el.removeEventListener('scroll', update); ro?.disconnect() }
  }, [update])

  // Sideways only: never move the page to bring the row into view.
  useEffect(() => {
    const el = ref.current
    const tab = el?.querySelector('[data-active="true"]')
    if (!el || !tab) return
    const start = tab.offsetLeft
    const end = start + tab.offsetWidth
    if (start < el.scrollLeft) el.scrollLeft = Math.max(0, start - 24)
    else if (end > el.scrollLeft + el.clientWidth) el.scrollLeft = end - el.clientWidth + 24
    update()
  }, [activeKey, update])

  const nudge = (dir) => ref.current?.scrollBy({ left: dir * Math.max(120, ref.current.clientWidth * 0.6), behavior: 'smooth' })
  const edge = 'absolute top-0 bottom-px z-10 flex w-10 items-center text-gray-500 transition-colors hover:text-gray-900'

  return (
    <div className={cn('relative min-w-0 max-w-full', outerClassName)}>
      <div ref={ref} className={cn('relative overflow-x-auto scrollbar-none', className)}>{children}</div>
      {edges.left && (
        <button type="button" tabIndex={-1} aria-label="Show earlier tabs" onClick={() => nudge(-1)}
          className={cn(edge, 'left-0 justify-start bg-gradient-to-r from-white via-white/90 to-transparent')}>
          <ChevronLeft className="size-4" />
        </button>
      )}
      {edges.right && (
        <button type="button" tabIndex={-1} aria-label="Show more tabs" onClick={() => nudge(1)}
          className={cn(edge, 'right-0 justify-end bg-gradient-to-l from-white via-white/90 to-transparent')}>
          <ChevronRight className="size-4" />
        </button>
      )}
    </div>
  )
}

/**
 * Segmented tabs (shadcn TabsList look). Controlled.
 *   <Tabs value={tab} onChange={setTab} tabs={[{ value: 'all', label: 'All', icon: Inbox, count: 4 }]} />
 * variant: 'pill' (default) | 'underline'
 */
export default function Tabs({ tabs = [], value, onChange, variant = 'pill', size = 'default', className }) {
  const items = tabs.filter(Boolean)

  if (variant === 'underline') {
    return (
      <Scroller activeKey={value} className={cn('-mb-px flex max-w-full items-center gap-5 border-b border-gray-200', className)}>
        {items.map((t) => {
          const active = t.value === value
          const Icon = t.icon
          return (
            <button
              key={t.value}
              type="button"
              data-active={active}
              disabled={t.disabled}
              onClick={() => onChange?.(t.value)}
              className={cn(
                'relative inline-flex items-center gap-1.5 whitespace-nowrap pb-2.5 pt-1 text-sm font-medium transition-colors outline-none',
                'after:absolute after:inset-x-0 after:-bottom-px after:h-0.5 after:rounded-full',
                active ? 'text-gray-900 after:bg-gray-900' : 'text-muted-foreground hover:text-gray-900 after:bg-transparent',
                'disabled:pointer-events-none disabled:opacity-50'
              )}
            >
              {Icon && <Icon className="size-4" />}
              {t.label}
              {t.count != null && <TabCount active={active}>{t.count}</TabCount>}
            </button>
          )
        })}
      </Scroller>
    )
  }

  return (
    // Pills sit in toolbars: layout classes (ml-auto, mb-4) belong on the outside.
    <Scroller activeKey={value} outerClassName={className}>
      <div
        role="tablist"
        className={cn(
          'inline-flex items-center rounded-lg bg-gray-100 p-[3px] text-muted-foreground',
          size === 'sm' ? 'h-8' : 'h-9'
        )}
      >
        {items.map((t) => {
          const active = t.value === value
          const Icon = t.icon
          return (
            <button
              key={t.value}
              type="button"
              role="tab"
              aria-selected={active}
              data-active={active}
              disabled={t.disabled}
              onClick={() => onChange?.(t.value)}
              className={cn(
                'inline-flex h-full items-center justify-center gap-1.5 whitespace-nowrap rounded-md px-3 font-medium transition-all outline-none',
                size === 'sm' ? 'text-xs' : 'text-sm',
                'focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50',
                active ? 'bg-white text-gray-900 shadow-sm' : 'hover:text-gray-900'
              )}
            >
              {Icon && <Icon className="size-4" />}
              {t.label}
              {t.count != null && <TabCount active={active}>{t.count}</TabCount>}
            </button>
          )
        })}
      </div>
    </Scroller>
  )
}

function TabCount({ active, children }) {
  return (
    <span
      className={cn(
        'min-w-[18px] rounded-full px-1.5 text-center text-[11px] font-medium leading-[18px] tabular-nums',
        active ? 'bg-gray-900 text-white' : 'bg-gray-200/80 text-gray-600'
      )}
    >
      {children}
    </span>
  )
}

export { Tabs }
