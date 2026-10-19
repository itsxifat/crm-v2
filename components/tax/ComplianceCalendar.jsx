'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CalendarClock, ChevronRight, CheckCircle2, AlertOctagon } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/Card'
import EmptyState from '@/components/ui/EmptyState'
import { TaxPill, DaysLeftBadge } from './TaxBadges'
import { tk } from './taxUi'

const KIND_META = {
  VAT_RETURN:        { short: 'VAT', color: 'blue' },
  TDS_DEPOSIT:       { short: 'TDS', color: 'amber' },
  WHT_RETURN:        { short: 'WHT', color: 'purple' },
  ADVANCE_TAX:       { short: 'AIT', color: 'emerald' },
  INCOME_TAX_RETURN: { short: 'ITR', color: 'indigo' },
}

function dateParts(key) {
  const d = new Date(`${key}T00:00:00+06:00`)
  return {
    day: d.toLocaleDateString('en-GB', { day: '2-digit', timeZone: 'Asia/Dhaka' }),
    month: d.toLocaleDateString('en-US', { month: 'short', timeZone: 'Asia/Dhaka' }),
    weekday: d.toLocaleDateString('en-GB', { weekday: 'short', timeZone: 'Asia/Dhaka' }),
  }
}

function StatusBadge({ item }) {
  if (item.status === 'DONE') return <TaxPill label="Done" color="green" />
  if (item.status === 'NOTHING_DUE') return <TaxPill label="Nothing due" color="gray" />
  return <DaysLeftBadge daysLeft={item.daysLeft} />
}

/**
 * Statutory deadlines with days-left badges.
 * items: [{ key, kind, label, periodKey, dueDate, daysLeft, overdue, status, amount, href }]
 */
export default function ComplianceCalendar({ items = [], loading = false, initial = 8 }) {
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? items : items.slice(0, initial)
  const overdue = items.filter(i => i.status === 'OVERDUE').length

  return (
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-5 py-3.5">
        <h2 className="text-sm font-semibold text-gray-900">Compliance calendar</h2>
        {overdue > 0 ? (
          <span className="inline-flex items-center gap-1 text-xs font-medium text-red-700"><AlertOctagon className="size-3.5" /> {overdue} overdue</span>
        ) : !loading && items.length > 0 ? (
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground"><CheckCircle2 className="size-3.5 text-emerald-600" /> Nothing overdue</span>
        ) : null}
      </div>

      {loading ? (
        <ul className="divide-y divide-gray-100">
          {Array.from({ length: 5 }).map((_, i) => (
            <li key={i} className="flex items-center gap-3 px-5 py-3">
              <div className="size-11 animate-pulse rounded-lg bg-gray-100" />
              <div className="flex-1 space-y-1.5"><div className="h-3 w-3/4 animate-pulse rounded-md bg-gray-100" /><div className="h-3 w-1/3 animate-pulse rounded-md bg-gray-100" /></div>
            </li>
          ))}
        </ul>
      ) : items.length === 0 ? (
        <EmptyState icon={CalendarClock} title="No deadlines in the next 90 days" className="py-10" />
      ) : (
        <ul className="divide-y divide-gray-100">
          {visible.map(item => {
            const p = dateParts(item.dueDate)
            const meta = KIND_META[item.kind] ?? { short: item.kind, color: 'gray' }
            const done = item.status === 'DONE' || item.status === 'NOTHING_DUE'
            const overdueItem = item.status === 'OVERDUE'
            const content = (
              <div className={cn('flex items-center gap-3 px-5 py-3', item.href && 'transition-colors hover:bg-gray-50/70')}>
                <div className={cn('w-11 shrink-0 rounded-lg border py-1 text-center', overdueItem ? 'border-red-200 bg-red-50' : 'border-gray-200/80 bg-white shadow-xs')}>
                  <p className={cn('text-[11px] font-medium leading-tight', overdueItem ? 'text-red-600' : 'text-muted-foreground')}>{p.month}</p>
                  <p className={cn('text-base font-semibold leading-tight tabular-nums', overdueItem ? 'text-red-700' : 'text-gray-900')}>{p.day}</p>
                </div>
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm leading-snug', done ? 'text-muted-foreground' : 'font-medium text-gray-900')}>{item.label}</p>
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    <TaxPill label={meta.short} color={meta.color} dot={false} />
                    <StatusBadge item={item} />
                    {item.amount != null && item.amount > 0 && !done && <span className="text-xs text-gray-700 tabular-nums">{tk(item.amount)}</span>}
                    <span className="text-[11px] text-gray-400">{p.weekday}</span>
                  </div>
                </div>
                {item.href && <ChevronRight className="size-4 shrink-0 text-gray-300" />}
              </div>
            )
            return <li key={item.key}>{item.href ? <Link href={item.href}>{content}</Link> : content}</li>
          })}
        </ul>
      )}

      {items.length > initial && (
        <div className="border-t border-gray-100 px-5 py-2.5">
          <button type="button" onClick={() => setShowAll(s => !s)} className="text-[13px] font-medium text-muted-foreground transition-colors hover:text-gray-900">
            {showAll ? 'Show fewer' : `Show all ${items.length}`}
          </button>
        </div>
      )}
    </Card>
  )
}
