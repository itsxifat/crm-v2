'use client'

import { useMemo } from 'react'
import { format, isSameDay } from 'date-fns'
import { CalendarDays, MapPin, Repeat } from 'lucide-react'
import { cn } from '@/lib/utils'
import EmptyState from '@/components/ui/EmptyState'
import { TODO_STATUS, colorClasses, toYMD } from '../constants'
import { agendaTime, dayOfSpan, itemsForDay } from './layout'
import { TodoBox } from './parts'

function AgendaRow({ item, day, master, active, onClick }) {
  const isTodo = item.kind === 'todo'
  const done = isTodo && item.status === 'DONE'
  const c = colorClasses(isTodo ? item.list?.color : item.color)
  const meta = isTodo
    ? [master ? item.organizer?.name : null, item.list?.name, TODO_STATUS[item.status]?.label].filter(Boolean)
    : [master ? item.organizer?.name : null, item.calendar?.name, dayOfSpan(item, day)].filter(Boolean)

  return (
    <button
      type="button"
      onClick={(e) => onClick?.(item, e.currentTarget.getBoundingClientRect())}
      className={cn(
        'flex w-full items-start gap-3 rounded-lg px-2 py-2 text-left outline-none transition-colors hover:bg-gray-50 focus-visible:bg-gray-50',
        active && 'bg-gray-100 hover:bg-gray-100',
      )}
    >
      <span className="w-[4.75rem] shrink-0 pt-px text-xs tabular-nums text-gray-500 sm:w-32 sm:text-[13px]">
        {agendaTime(item, day)}
      </span>
      {isTodo ? (
        <TodoBox done={done} color={item.list?.color} className="mt-[3px] size-3.5" />
      ) : (
        <span className={cn('mt-[5px] size-2.5 shrink-0 rounded-full', c.dot)} />
      )}
      <span className="min-w-0 flex-1">
        <span className={cn('flex items-center gap-1.5 text-sm font-medium text-gray-900', done && 'text-gray-400 line-through')}>
          <span className="truncate">{item.title}</span>
          {item.isRecurring && <Repeat className="size-3 shrink-0 text-gray-400" />}
        </span>
        {(meta.length > 0 || item.location) && (
          <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
            <span className="truncate">{meta.join(' · ')}</span>
            {!isTodo && item.location && (
              <span className="hidden min-w-0 items-center gap-1 truncate sm:inline-flex">
                <MapPin className="size-3 shrink-0" />
                <span className="truncate">{item.location}</span>
              </span>
            )}
          </span>
        )}
      </span>
    </button>
  )
}

/** Day-grouped list of everything in the range; empty days are skipped. */
export default function AgendaView({ days, items, now, master, activeKey, onItemClick, onOpenDay, searching }) {
  const groups = useMemo(
    () => days.map((d) => ({ day: d, items: itemsForDay(items, d) })).filter((g) => g.items.length),
    [days, items],
  )

  if (!groups.length) {
    return <EmptyState icon={CalendarDays} title={searching ? 'No matching events' : 'No events'} className="py-20" />
  }

  return (
    <div className="divide-y divide-gray-100">
      {groups.map((g) => {
        const isToday = isSameDay(g.day, now)
        return (
          <div key={toYMD(g.day)} className="flex gap-2 px-2 py-2.5 sm:gap-4 sm:px-4">
            <button
              type="button"
              onClick={() => onOpenDay?.(g.day)}
              className="group flex w-12 shrink-0 flex-col items-center rounded-lg py-1.5 outline-none sm:w-14"
            >
              <span className={cn('text-[11px] font-medium', isToday ? 'text-gray-900' : 'text-muted-foreground')}>
                {format(g.day, 'EEE')}
              </span>
              <span
                className={cn(
                  'mt-0.5 flex size-8 items-center justify-center rounded-full text-lg font-semibold tabular-nums transition-colors',
                  isToday ? 'bg-gray-900 text-white' : 'text-gray-900 group-hover:bg-gray-100',
                )}
              >
                {format(g.day, 'd')}
              </span>
              <span className="mt-0.5 text-[11px] text-muted-foreground">{format(g.day, 'MMM')}</span>
            </button>
            <div className="min-w-0 flex-1 space-y-0.5 py-0.5">
              {g.items.map((it) => (
                <AgendaRow
                  key={`${it.key}:${toYMD(g.day)}`}
                  item={it}
                  day={g.day}
                  master={master}
                  active={activeKey === it.key}
                  onClick={onItemClick}
                />
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}
