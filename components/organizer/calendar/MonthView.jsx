'use client'

import { useMemo, useRef } from 'react'
import { format, isSameDay, isSameMonth } from 'date-fns'
import { cn } from '@/lib/utils'
import { layoutRow, limitRow } from './layout'
import { ItemChip } from './parts'
import { useElementSize } from './hooks'

const COL = 100 / 7

/**
 * 6-week month grid. Multi-day / all-day items render as bars spanning cells;
 * overflowing days get a "+N more" link.
 */
export default function MonthView({
  days,
  cursor,
  items,
  now,
  canManage,
  activeKey,
  onItemClick,
  onCreate,
  onOpenDay,
  onMore,
}) {
  const rowRef = useRef(null)
  const size = useElementSize(rowRef)
  const compact = size.width > 0 && size.width < 560
  const laneH = compact ? 17 : 21
  const headH = compact ? 25 : 29
  const maxLanes = size.height ? Math.max(1, Math.floor((size.height - headH - 3) / laneH)) : 3

  const weeks = useMemo(() => {
    const out = []
    for (let i = 0; i < days.length; i += 7) out.push(days.slice(i, i + 7))
    return out
  }, [days])

  const layouts = useMemo(
    () => weeks.map((w) => limitRow(layoutRow(items, w[0], 7), 7, maxLanes)),
    [weeks, items, maxLanes],
  )

  return (
    <div className="select-none">
      <div className="grid grid-cols-7 border-b border-gray-100">
        {days.slice(0, 7).map((d) => (
          <div key={d.toISOString()} className="py-2 text-center text-xs font-medium text-muted-foreground">
            <span className="sm:hidden">{format(d, 'EEEEE')}</span>
            <span className="hidden sm:inline">{format(d, 'EEE')}</span>
          </div>
        ))}
      </div>

      {weeks.map((week, wi) => {
        const L = layouts[wi]
        return (
          <div
            // Keyed by position: the measured first row must stay the same element across
            // months, or the ResizeObserver keeps watching a detached node.
            key={wi}
            ref={wi === 0 ? rowRef : undefined}
            className="relative h-[5.5rem] border-b border-gray-100 last:border-b-0 sm:h-[7.5rem]"
          >
            <div className="absolute inset-0 grid grid-cols-7">
              {week.map((d) => {
                const inMonth = isSameMonth(d, cursor)
                const isToday = isSameDay(d, now)
                return (
                  <div
                    key={d.toISOString()}
                    onClick={canManage ? () => onCreate?.(d) : undefined}
                    className={cn(
                      'border-r border-gray-100 transition-colors last:border-r-0',
                      !inMonth && 'bg-gray-50/70',
                      canManage && 'cursor-pointer hover:bg-gray-50',
                    )}
                  >
                    <div className={cn('flex pt-1', compact ? 'justify-center' : 'px-1.5')}>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); onOpenDay?.(d) }}
                        className={cn(
                          'inline-flex h-6 min-w-6 items-center justify-center rounded-full px-1.5 text-xs tabular-nums transition-colors',
                          isToday
                            ? 'bg-gray-900 font-semibold text-white hover:bg-gray-800'
                            : inMonth
                              ? 'font-medium text-gray-900 hover:bg-gray-200/70'
                              : 'text-gray-400 hover:bg-gray-200/70',
                        )}
                      >
                        {d.getDate() === 1 && !compact ? format(d, 'd MMM') : format(d, 'd')}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>

            {L.pieces.map((p) => {
              const inL = p.contStart ? 0 : 3
              const inR = p.contEnd ? 0 : 3
              return (
                <ItemChip
                  key={`${p.item.key}:${p.start}`}
                  item={p.item}
                  compact={compact}
                  contStart={p.contStart}
                  contEnd={p.contEnd}
                  active={activeKey === p.item.key}
                  onClick={onItemClick}
                  className="absolute"
                  style={{
                    top: headH + p.lane * laneH,
                    height: laneH - 2,
                    left: `calc(${p.start * COL}% + ${inL}px)`,
                    width: `calc(${(p.end - p.start + 1) * COL}% - ${inL + inR}px)`,
                  }}
                />
              )
            })}

            {L.more.map((m) => (
              <button
                key={`more:${m.day}`}
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onMore?.(week[m.day], L.dayItems[m.day], e.currentTarget.getBoundingClientRect())
                }}
                className={cn(
                  'absolute flex items-center rounded-[5px] px-1.5 font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900',
                  compact ? 'justify-center text-[10px]' : 'text-xs',
                )}
                style={{
                  top: headH + m.lane * laneH,
                  height: laneH - 2,
                  left: `calc(${m.day * COL}% + 3px)`,
                  width: `calc(${COL}% - 6px)`,
                }}
              >
                {compact ? `+${m.count}` : `+${m.count} more`}
              </button>
            ))}
          </div>
        )
      })}
    </div>
  )
}
