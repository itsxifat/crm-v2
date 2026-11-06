'use client'

import { useEffect, useMemo, useState } from 'react'
import { addDays, addMonths, format, isSameDay, isSameMonth, startOfMonth, startOfWeek } from 'date-fns'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { WEEK_STARTS_ON } from '../constants'

/** Compact month navigator for the sidebar. Highlights today and the visible range. */
export default function MiniMonth({ cursor, rangeStart, rangeEnd, highlightRange, onSelect }) {
  const [month, setMonth] = useState(() => startOfMonth(cursor))
  useEffect(() => { setMonth(startOfMonth(cursor)) }, [cursor])

  const days = useMemo(() => {
    const start = startOfWeek(month, { weekStartsOn: WEEK_STARTS_ON })
    return Array.from({ length: 42 }, (_, i) => addDays(start, i))
  }, [month])
  const today = new Date()

  return (
    <div className="select-none">
      <div className="mb-1.5 flex items-center justify-between pl-1.5">
        <span className="text-[13px] font-semibold text-gray-900">{format(month, 'MMMM yyyy')}</span>
        <div className="flex items-center">
          <button
            type="button"
            aria-label="Previous month"
            onClick={() => setMonth((m) => addMonths(m, -1))}
            className="inline-flex size-6 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
          >
            <ChevronLeft className="size-4" />
          </button>
          <button
            type="button"
            aria-label="Next month"
            onClick={() => setMonth((m) => addMonths(m, 1))}
            className="inline-flex size-6 items-center justify-center rounded-md text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>
      <div className="grid grid-cols-7 text-center">
        {days.slice(0, 7).map((d) => (
          <div key={d.toISOString()} className="py-1 text-[10px] font-medium text-gray-400">{format(d, 'EEEEEE')}</div>
        ))}
        {days.map((d, i) => {
          const inMonth = isSameMonth(d, month)
          const isToday = isSameDay(d, today)
          const selected = isSameDay(d, cursor)
          const inR = (x) => highlightRange && x >= rangeStart && x < rangeEnd
          const inRange = inR(d)
          const col = i % 7
          return (
            <div
              key={d.toISOString()}
              className={cn(
                'py-px',
                inRange && 'bg-gray-100',
                inRange && (col === 0 || !inR(days[i - 1])) && 'rounded-l-md',
                inRange && (col === 6 || !inR(days[i + 1])) && 'rounded-r-md',
              )}
            >
              <button
                type="button"
                onClick={() => onSelect?.(d)}
                className={cn(
                  'mx-auto flex size-7 items-center justify-center rounded-full text-[12px] tabular-nums transition-colors',
                  isToday
                    ? 'bg-gray-900 font-semibold text-white hover:bg-gray-800'
                    : selected
                      ? 'bg-gray-200 font-semibold text-gray-900'
                      : inMonth
                        ? 'text-gray-700 hover:bg-gray-100'
                        : 'text-gray-300 hover:bg-gray-50',
                )}
              >
                {format(d, 'd')}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
