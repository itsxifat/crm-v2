'use client'

import Link from 'next/link'
import { ArrowRight, Check, CheckCircle2, Flag } from 'lucide-react'
import { differenceInCalendarDays, format, startOfDay } from 'date-fns'
import { Card, CardHeader, CardTitle } from '@/components/ui/Card'
import Button from '@/components/ui/Button'
import Avatar from '@/components/ui/Avatar'
import EmptyState from '@/components/ui/EmptyState'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import { cn } from '@/lib/utils'
import { PRIORITY, fromYMD } from '../constants'

function dueInfo(ymd, today) {
  if (!ymd) return null
  const d = fromYMD(ymd)
  const diff = differenceInCalendarDays(d, today)
  if (diff < 0) return { label: format(d, 'd MMM'), cls: 'font-medium text-red-600' }
  if (diff === 0) return { label: 'Today', cls: 'font-medium text-amber-600' }
  if (diff === 1) return { label: 'Tomorrow', cls: 'text-gray-700' }
  if (diff < 7) return { label: format(d, 'EEEE'), cls: 'text-muted-foreground' }
  return { label: format(d, 'd MMM'), cls: 'text-muted-foreground' }
}

/** Open to-dos due this week across all organizers, with a quick "mark done". */
export default function DueSoon({ todos = [], loading, error, canManage, onComplete, onViewAll }) {
  const today = startOfDay(new Date())

  return (
    <Card className="flex min-w-0 flex-col">
      <CardHeader className="items-center pb-2">
        <CardTitle>Due soon</CardTitle>
        {onViewAll && (
          <Button variant="ghost" size="xs" onClick={onViewAll} className="-my-1 -mr-2 text-muted-foreground">
            To-dos <ArrowRight />
          </Button>
        )}
      </CardHeader>

      <div className="flex-1 px-2 pb-3">
        {loading ? (
          <LoadingSpinner className="py-12" />
        ) : error ? (
          <p className="px-3 py-10 text-center text-sm text-red-600">{error}</p>
        ) : todos.length === 0 ? (
          <EmptyState icon={CheckCircle2} title="Nothing due this week" className="py-10" />
        ) : (
          <ul className="pt-1">
            {todos.map((t) => {
              const due = dueInfo(t.dueDate, today)
              const sub = [t.organizer?.name, t.list?.name].filter(Boolean).join(' · ')
              const flagged = t.priority === 'HIGH' || t.priority === 'URGENT'
              const href = t.organizer?.id ? `/admin/organizer/${t.organizer.id}?tab=todo` : null
              const text = (
                <>
                  <p className="truncate text-sm font-medium text-gray-900">{t.title}</p>
                  {sub && <p className="truncate text-xs text-muted-foreground">{sub}</p>}
                </>
              )
              return (
                <li key={t.id} className="flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-gray-50">
                  {canManage ? (
                    <button
                      type="button"
                      onClick={() => onComplete?.(t)}
                      aria-label="Mark as done"
                      title="Mark as done"
                      className={cn(
                        'group/check flex size-[18px] shrink-0 items-center justify-center rounded-full border bg-white transition-colors hover:border-gray-900',
                        t.status === 'IN_PROGRESS' ? 'border-blue-500' : 'border-gray-300'
                      )}
                    >
                      <Check className="size-3 text-gray-900 opacity-0 transition-opacity group-hover/check:opacity-100" />
                    </button>
                  ) : (
                    <span
                      aria-hidden
                      className={cn(
                        'size-[18px] shrink-0 rounded-full border',
                        t.status === 'IN_PROGRESS' ? 'border-blue-500' : 'border-gray-300'
                      )}
                    />
                  )}

                  {href ? (
                    <Link href={href} className="min-w-0 flex-1">{text}</Link>
                  ) : (
                    <div className="min-w-0 flex-1">{text}</div>
                  )}

                  <div className="flex shrink-0 items-center gap-2 text-xs">
                    {flagged && (
                      <Flag className={cn('size-3.5', PRIORITY[t.priority]?.icon)} aria-label={PRIORITY[t.priority]?.label} />
                    )}
                    {due && <span className={cn('tabular-nums', due.cls)}>{due.label}</span>}
                    {t.assignee && <Avatar src={t.assignee.avatar} name={t.assignee.name} size="xs" />}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </Card>
  )
}
