'use client'

import { useState } from 'react'
import Link from 'next/link'
import { format, isSameYear } from 'date-fns'
import { AlignLeft, CalendarDays, FolderKanban, ListChecks, MapPin, Pencil, Repeat, Trash2, User, X } from 'lucide-react'
import { cn } from '@/lib/utils'
import Button, { buttonVariants } from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import { PRIORITY, TODO_STATUS, colorClasses, fromYMD } from '../constants'
import { describeRepeat, describeWhen } from './layout'
import { ItemChip, TodoBox } from './parts'

function Row({ icon: Icon, children }) {
  return (
    <div className="flex items-start gap-3">
      <Icon className="mt-px size-4 shrink-0 text-gray-400" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  )
}

function Toolbar({ children, onClose }) {
  return (
    <div className="flex items-center justify-end gap-0.5 px-1.5 pt-1.5">
      {children}
      <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close" className="text-gray-500">
        <X />
      </Button>
    </div>
  )
}

/** Popover body for an event occurrence. Recurring deletes ask: this occurrence or the whole series. */
export function EventDetails({ event: ev, master, canManage, onEdit, onDelete, onClose }) {
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(null)
  const c = colorClasses(ev.color)
  const repeat = describeRepeat(ev)

  async function del(mode) {
    setBusy(mode)
    try { await onDelete?.(ev, mode) } finally { setBusy(null) }
  }

  function askDelete() {
    if (ev.isRecurring) { setConfirming(true); return }
    if (window.confirm('Delete this event?')) del('series')
  }

  return (
    <div>
      <Toolbar onClose={onClose}>
        {canManage && (
          <>
            <Button variant="ghost" size="icon-sm" onClick={() => onEdit?.(ev)} aria-label="Edit event" title="Edit" className="text-gray-500">
              <Pencil />
            </Button>
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={askDelete}
              disabled={!!busy}
              aria-label="Delete event"
              title="Delete"
              className="text-gray-500 hover:bg-red-50 hover:text-red-600"
            >
              <Trash2 />
            </Button>
          </>
        )}
      </Toolbar>

      <div className="px-4 pb-4">
        <div className="flex gap-3">
          <span className={cn('mt-[7px] size-3 shrink-0 rounded-[4px]', c.dot)} />
          <div className="min-w-0">
            <h3 className="break-words text-base font-semibold leading-snug tracking-tight text-gray-900">{ev.title}</h3>
            <p className="mt-1 text-[13px] text-gray-600">{describeWhen(ev)}</p>
            {repeat && (
              <p className="mt-0.5 flex items-center gap-1.5 text-[13px] text-muted-foreground">
                <Repeat className="size-3.5 shrink-0" />
                {repeat}
              </p>
            )}
          </div>
        </div>

        <div className="mt-4 space-y-2.5 text-[13px] text-gray-700">
          {ev.location && <Row icon={MapPin}><span className="break-words">{ev.location}</span></Row>}
          {ev.description && (
            <Row icon={AlignLeft}>
              <p className="max-h-48 overflow-y-auto whitespace-pre-wrap break-words leading-relaxed">{ev.description}</p>
            </Row>
          )}
          <Row icon={CalendarDays}>
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              {master && ev.organizer && (
                <>
                  <Link href={`/admin/organizer/${ev.organizer.id}`} className="font-medium text-gray-900 underline-offset-4 hover:underline">
                    {ev.organizer.name}
                  </Link>
                  <span className="text-gray-300">·</span>
                </>
              )}
              <span className={cn('size-2 rounded-full', colorClasses(ev.calendar?.color).dot)} />
              {ev.calendar?.name ?? 'Calendar'}
            </span>
          </Row>
          {ev.project && (
            <Row icon={FolderKanban}>
              <Link href={`/admin/projects/${ev.project.id}`} className="underline-offset-4 hover:underline">{ev.project.name}</Link>
            </Row>
          )}
          {ev.createdBy?.name && <Row icon={User}>{ev.createdBy.name}</Row>}
        </div>
      </div>

      {confirming && (
        <div className="border-t border-gray-100 bg-gray-50/70 px-4 py-3">
          <p className="text-[13px] font-medium text-gray-900">Delete recurring event</p>
          <div className="mt-2.5 flex flex-wrap gap-2">
            <Button size="sm" variant="outline" loading={busy === 'occurrence'} disabled={!!busy} onClick={() => del('occurrence')}>
              Delete this occurrence
            </Button>
            <Button size="sm" variant="destructive" loading={busy === 'series'} disabled={!!busy} onClick={() => del('series')}>
              Delete series
            </Button>
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => setConfirming(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Read-only popover body for a to-do shown on the calendar. */
export function TodoDetails({ todo, master, onClose }) {
  const status = TODO_STATUS[todo.status] ?? TODO_STATUS.OPEN
  const priority = PRIORITY[todo.priority]
  const due = fromYMD(todo.dueDate)
  const done = todo.status === 'DONE'
  return (
    <div>
      <Toolbar onClose={onClose} />
      <div className="px-4 pb-4">
        <div className="flex gap-3">
          <TodoBox done={done} color={todo.list?.color} className="mt-[5px] size-3.5" />
          <div className="min-w-0">
            <h3 className={cn('break-words text-base font-semibold leading-snug tracking-tight text-gray-900', done && 'text-gray-500 line-through')}>
              {todo.title}
            </h3>
            {due && (
              <p className="mt-1 text-[13px] text-gray-600">
                Due {format(due, isSameYear(due, new Date()) ? 'EEEE, d MMMM' : 'EEEE, d MMMM yyyy')}
              </p>
            )}
          </div>
        </div>
        <div className="mt-4 space-y-2.5 text-[13px] text-gray-700">
          <Row icon={ListChecks}>
            <span className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
              {master && todo.organizer && (
                <>
                  <span className="font-medium text-gray-900">{todo.organizer.name}</span>
                  <span className="text-gray-300">·</span>
                </>
              )}
              <span className={cn('size-2 rounded-full', colorClasses(todo.list?.color).dot)} />
              {todo.list?.name ?? 'To-do'}
            </span>
          </Row>
          <div className="flex flex-wrap items-center gap-1.5 pl-7">
            <Badge variant={status.variant} dot>{status.label}</Badge>
            {priority && <Badge variant={priority.variant}>{priority.label}</Badge>}
          </div>
        </div>
        {master && todo.organizer?.id && (
          <Link
            href={`/admin/organizer/${todo.organizer.id}?tab=todo`}
            className={cn(buttonVariants({ variant: 'outline', size: 'sm' }), 'mt-4 w-full')}
          >
            Open to-do list
          </Link>
        )}
      </div>
    </div>
  )
}

/** "+N more" popover body: every item on one day. */
export function DayItems({ day, items, activeKey, onItemClick, onOpenDay, onClose }) {
  return (
    <div className="p-3">
      <div className="mb-2 flex items-start justify-between gap-2">
        <button type="button" onClick={() => onOpenDay?.(day)} className="rounded-md px-1 text-left outline-none hover:bg-gray-50">
          <div className="text-[11px] font-medium text-muted-foreground">{format(day, 'EEEE')}</div>
          <div className="text-lg font-semibold tracking-tight text-gray-900">{format(day, 'd MMMM')}</div>
        </button>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close" className="-mr-1 -mt-1 text-gray-500">
          <X />
        </Button>
      </div>
      <div className="space-y-1">
        {items.map((it) => (
          <ItemChip
            key={it.key}
            item={it}
            active={activeKey === it.key}
            onClick={onItemClick}
            className="h-6 w-full"
          />
        ))}
      </div>
    </div>
  )
}
