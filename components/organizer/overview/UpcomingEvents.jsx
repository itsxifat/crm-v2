'use client'

import Link from 'next/link'
import { ArrowRight, CalendarDays } from 'lucide-react'
import { differenceInCalendarDays, format, startOfDay } from 'date-fns'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import EmptyState from '@/components/ui/EmptyState'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import { cn } from '@/lib/utils'
import { colorClasses, fromYMD, toYMD } from '../constants'

/**
 * Event occurrences → what the "Upcoming" list shows: finished ones dropped, each
 * pinned to the day it is listed under (today for ones that started earlier), sorted.
 */
export function upcomingItems(events, now = new Date()) {
  const todayKey = toYMD(now)
  return (events ?? [])
    .filter((ev) => (ev.allDay ? String(ev.end).slice(0, 10) >= todayKey : new Date(ev.end) >= now))
    .map((ev) => {
      const startKey = ev.allDay ? String(ev.start).slice(0, 10) : toYMD(new Date(ev.start))
      const ongoing = startKey < todayKey
      return { ...ev, day: ongoing ? todayKey : startKey, ongoing }
    })
    .sort(
      (a, b) =>
        a.day.localeCompare(b.day) ||
        Number(b.allDay) - Number(a.allDay) ||
        new Date(a.start) - new Date(b.start)
    )
}

function dayLabel(key, today) {
  const d = fromYMD(key)
  const diff = differenceInCalendarDays(d, today)
  if (diff === 0) return 'Today'
  if (diff === 1) return 'Tomorrow'
  return format(d, 'EEEE, d MMM')
}

function timeLabel(ev) {
  if (ev.allDay) return 'All day'
  if (ev.ongoing) return 'Ongoing'
  return format(new Date(ev.start), 'h:mm a')
}

/** Compact day-grouped list of the next few event occurrences across all organizers. */
export default function UpcomingEvents({ items = [], loading, error, onViewAll, max = 8 }) {
  const today = startOfDay(new Date())
  const shown = items.slice(0, max)
  const more = items.length - shown.length

  const groups = []
  for (const ev of shown) {
    const last = groups[groups.length - 1]
    if (last?.key === ev.day) last.items.push(ev)
    else groups.push({ key: ev.day, items: [ev] })
  }

  return (
    <Card className="flex min-w-0 flex-col">
      <CardHeader className="items-center pb-2">
        <CardTitle>Upcoming</CardTitle>
        {onViewAll && (
          <Button variant="ghost" size="xs" onClick={onViewAll} className="-my-1 -mr-2 text-muted-foreground">
            Calendar <ArrowRight />
          </Button>
        )}
      </CardHeader>

      <div className="flex-1 px-2 pb-3">
        {loading ? (
          <LoadingSpinner className="py-12" />
        ) : error ? (
          <p className="px-3 py-10 text-center text-sm text-red-600">{error}</p>
        ) : shown.length === 0 ? (
          <EmptyState icon={CalendarDays} title="Nothing in the next 7 days" className="py-10" />
        ) : (
          <>
            {groups.map((g) => (
              <div key={g.key}>
                <p className="px-3 pb-1 pt-2 text-xs font-medium text-muted-foreground">{dayLabel(g.key, today)}</p>
                <ul>
                  {g.items.map((ev) => (
                    <li key={ev.key ?? `${ev.id}:${ev.start}`}>
                      <EventRow ev={ev} />
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {more > 0 && onViewAll && (
              <button
                type="button"
                onClick={onViewAll}
                className="mt-1 w-full rounded-lg px-3 py-2 text-left text-xs font-medium text-muted-foreground transition-colors hover:bg-gray-50 hover:text-gray-900"
              >
                {more} more
              </button>
            )}
          </>
        )}
      </div>
    </Card>
  )
}

function EventRow({ ev }) {
  const c = colorClasses(ev.color ?? ev.calendar?.color)
  const sub = [ev.organizer?.name, ev.calendar?.name].filter(Boolean).join(' · ')
  const body = (
    <>
      <span aria-hidden className={cn('h-8 w-1 shrink-0 rounded-full', c.bar)} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-900">{ev.title}</p>
        {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
      </div>
      <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{timeLabel(ev)}</span>
    </>
  )
  const cls = 'flex items-center gap-3 rounded-lg px-3 py-2 transition-colors'
  return ev.organizer?.id ? (
    <Link href={`/admin/organizer/${ev.organizer.id}?tab=calendar`} className={cn(cls, 'hover:bg-gray-50')}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  )
}
