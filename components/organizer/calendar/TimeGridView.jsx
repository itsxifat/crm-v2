'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { format, isSameDay } from 'date-fns'
import { ChevronDown, ChevronUp, Repeat } from 'lucide-react'
import { cn } from '@/lib/utils'
import { colorClasses } from '../constants'
import { fmtTimeCompact, fmtTimeRange, layoutDayColumn, layoutRow, limitRow } from './layout'
import { ItemChip } from './parts'

export const HOUR_H = 48
const MIN_MINUTES = 22
const ALL_DAY_LANE_H = 22
const ALL_DAY_LIMIT = 3
const HOURS = Array.from({ length: 24 }, (_, h) => h)

function hourLabel(h) {
  if (h === 0) return ''
  if (h === 12) return '12 PM'
  return h < 12 ? `${h} AM` : `${h - 12} PM`
}

function TimedEvent({ seg, active, onClick }) {
  const it = seg.item
  const c = colorClasses(it.color)
  const top = (seg.top / 60) * HOUR_H
  const height = Math.max(((seg.bottom - seg.top) / 60) * HOUR_H - 2, 16)
  const short = height < 38
  const left = (seg.col / seg.cols) * 100
  const width = (seg.span / seg.cols) * 100
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        onClick?.(it, e.currentTarget.getBoundingClientRect())
      }}
      title={`${it.title} · ${fmtTimeRange(it._start, it._end)}`}
      className={cn(
        'absolute overflow-hidden rounded-md border-l-[3px] px-1.5 text-left leading-tight outline-none ring-1 ring-white',
        'transition-shadow hover:z-10 hover:shadow-md focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-ring',
        c.soft, c.softHover, c.text, c.border,
        short ? 'flex items-center gap-1 py-0' : 'py-1',
        seg.contStart && 'rounded-t-none',
        seg.contEnd && 'rounded-b-none',
        active && 'z-10 shadow-md',
      )}
      style={{ top: top + 1, height, left: `calc(${left}% + 2px)`, width: `calc(${width}% - 4px)` }}
    >
      {short ? (
        <>
          <span className="truncate text-[11px] font-medium">{it.title}</span>
          <span className="shrink-0 text-[11px] tabular-nums opacity-70">{fmtTimeCompact(it._start)}</span>
        </>
      ) : (
        <>
          <div className={cn('text-xs font-medium', height > 60 ? 'line-clamp-2 break-words' : 'truncate')}>
            {it.isRecurring && <Repeat className="mr-1 inline size-3 -translate-y-px opacity-60" />}
            {it.title}
          </div>
          <div className="truncate text-[11px] tabular-nums opacity-75">{fmtTimeRange(it._start, it._end)}</div>
          {height > 76 && it.location && <div className="truncate text-[11px] opacity-60">{it.location}</div>}
        </>
      )}
    </button>
  )
}

/** Week / day view: day headers, all-day row and a 24h time grid with side-by-side overlaps. */
export default function TimeGridView({
  days,
  items,
  now,
  canManage,
  activeKey,
  onItemClick,
  onCreate,
  onOpenDay,
}) {
  const scrollRef = useRef(null)
  const [expanded, setExpanded] = useState(false)
  const n = days.length
  const isWeek = n > 1
  const gridCols = { gridTemplateColumns: `repeat(${n}, minmax(0, 1fr))` }

  // Start the day at 8:00 (the view is keyed, so this runs per view switch).
  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = 8 * HOUR_H
  }, [])

  const allDaySegs = useMemo(
    () => layoutRow(items.filter((it) => it._allDayLane), days[0], n),
    [items, days, n],
  )
  const canExpand = allDaySegs.some((s) => s.lane >= ALL_DAY_LIMIT)
  const allDay = useMemo(
    () => limitRow(allDaySegs, n, expanded ? Infinity : ALL_DAY_LIMIT),
    [allDaySegs, n, expanded],
  )
  const allDayLanes = Math.max(1, allDay.lanes)

  const columns = useMemo(() => days.map((d) => layoutDayColumn(items, d, MIN_MINUTES)), [items, days])
  const nowMinutes = now.getHours() * 60 + now.getMinutes()

  function slotClick(e, day) {
    if (!canManage) return
    const rect = e.currentTarget.getBoundingClientRect()
    const y = e.clientY - rect.top
    const minutes = Math.min(Math.max(Math.floor((y / HOUR_H) * 2) * 30, 0), 23 * 60 + 30)
    onCreate?.({ date: day, allDay: false, minutes })
  }

  return (
    <div
      ref={scrollRef}
      className="relative overflow-auto overscroll-contain"
      style={{ height: 'clamp(440px, calc(100vh - 17rem), 1000px)' }}
    >
      <div className={cn('relative', isWeek && 'min-w-[720px]')}>
        {/* Header: day names + all-day row (sticky) */}
        <div className="sticky top-0 z-30 bg-white">
          <div className="flex border-b border-gray-100">
            <div className="sticky left-0 z-10 w-12 shrink-0 bg-white sm:w-14" />
            <div className="grid flex-1" style={gridCols}>
              {days.map((d) => {
                const isToday = isSameDay(d, now)
                const Tag = isWeek ? 'button' : 'div'
                return (
                  <Tag
                    key={d.toISOString()}
                    {...(isWeek ? { type: 'button', onClick: () => onOpenDay?.(d) } : {})}
                    className={cn(
                      'flex flex-col items-center gap-0.5 py-2 outline-none',
                      isWeek && 'transition-colors hover:bg-gray-50 focus-visible:bg-gray-50',
                    )}
                  >
                    <span className={cn('text-[11px] font-medium', isToday ? 'text-gray-900' : 'text-muted-foreground')}>
                      {format(d, isWeek ? 'EEE' : 'EEEE')}
                    </span>
                    <span
                      className={cn(
                        'flex size-8 items-center justify-center rounded-full text-lg font-semibold tabular-nums',
                        isToday ? 'bg-gray-900 text-white' : 'text-gray-900',
                      )}
                    >
                      {format(d, 'd')}
                    </span>
                  </Tag>
                )
              })}
            </div>
          </div>

          <div className="flex border-b border-gray-200/80">
            <div className="sticky left-0 z-10 flex w-12 shrink-0 flex-col items-end gap-0.5 bg-white pr-2 pt-1.5 sm:w-14">
              <span className="text-[10px] leading-4 text-gray-400">All day</span>
              {canExpand && (
                <button
                  type="button"
                  onClick={() => setExpanded((v) => !v)}
                  aria-label={expanded ? 'Collapse all-day events' : 'Expand all-day events'}
                  className="inline-flex size-5 items-center justify-center rounded text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900"
                >
                  {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
                </button>
              )}
            </div>
            <div className="relative flex-1" style={{ height: allDayLanes * ALL_DAY_LANE_H + 6 }}>
              <div className="absolute inset-0 grid" style={gridCols}>
                {days.map((d) => (
                  <div
                    key={d.toISOString()}
                    onClick={canManage ? () => onCreate?.({ date: d, allDay: true }) : undefined}
                    className={cn('border-l border-gray-100', canManage && 'cursor-pointer transition-colors hover:bg-gray-50')}
                  />
                ))}
              </div>
              {allDay.pieces.map((p) => {
                const inL = p.contStart ? 0 : 2
                const inR = p.contEnd ? 0 : 2
                return (
                  <ItemChip
                    key={`${p.item.key}:${p.start}`}
                    item={p.item}
                    contStart={p.contStart}
                    contEnd={p.contEnd}
                    active={activeKey === p.item.key}
                    onClick={onItemClick}
                    className="absolute"
                    style={{
                      top: 3 + p.lane * ALL_DAY_LANE_H,
                      height: ALL_DAY_LANE_H - 2,
                      left: `calc(${(p.start / n) * 100}% + ${inL}px)`,
                      width: `calc(${((p.end - p.start + 1) / n) * 100}% - ${inL + inR}px)`,
                    }}
                  />
                )
              })}
              {allDay.more.map((m) => (
                <button
                  key={`more:${m.day}`}
                  type="button"
                  onClick={(e) => { e.stopPropagation(); setExpanded(true) }}
                  className="absolute flex items-center rounded-[5px] px-1.5 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
                  style={{
                    top: 3 + m.lane * ALL_DAY_LANE_H,
                    height: ALL_DAY_LANE_H - 2,
                    left: `calc(${(m.day / n) * 100}% + 2px)`,
                    width: `calc(${100 / n}% - 4px)`,
                  }}
                >
                  +{m.count} more
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Time grid */}
        <div className="flex">
          <div className="sticky left-0 z-20 w-12 shrink-0 bg-white sm:w-14">
            {HOURS.map((h) => (
              <div key={h} className="relative" style={{ height: HOUR_H }}>
                {h > 0 && (
                  <span className="absolute -top-[7px] right-2 whitespace-nowrap text-[10px] tabular-nums leading-none text-gray-400">
                    {hourLabel(h)}
                  </span>
                )}
              </div>
            ))}
          </div>
          <div className="relative grid flex-1" style={{ ...gridCols, height: 24 * HOUR_H }}>
            <div className="pointer-events-none absolute inset-0">
              {HOURS.map((h) => (
                <div key={h} className={cn(h > 0 && 'border-t border-gray-100')} style={{ height: HOUR_H }} />
              ))}
            </div>
            {days.map((d, i) => {
              const isToday = isSameDay(d, now)
              return (
                <div
                  key={d.toISOString()}
                  onClick={(e) => slotClick(e, d)}
                  className={cn('relative border-l border-gray-100', canManage && 'cursor-pointer')}
                >
                  {columns[i].map((seg) => (
                    <TimedEvent
                      key={seg.item.key}
                      seg={seg}
                      active={activeKey === seg.item.key}
                      onClick={onItemClick}
                    />
                  ))}
                  {isToday && (
                    <div
                      className="pointer-events-none absolute inset-x-0 z-[15]"
                      style={{ top: (nowMinutes / 60) * HOUR_H }}
                    >
                      <div className="relative h-0.5 -translate-y-1/2 bg-red-500">
                        <span className="absolute -left-[5px] top-1/2 size-2.5 -translate-y-1/2 rounded-full bg-red-500" />
                      </div>
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      </div>
    </div>
  )
}
