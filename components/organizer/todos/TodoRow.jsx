'use client'

import Link from 'next/link'
import { AlignLeft, Briefcase, CalendarDays, Check, Flag, GripVertical } from 'lucide-react'
import { cn } from '@/lib/utils'
import Avatar from '@/components/ui/Avatar'
import Badge from '@/components/ui/Badge'
import { PRIORITY, TODO_STATUS, colorClasses } from '../constants'
import { DUE_TONE_CLASS, dueLabel, dueTone } from './utils'

/** Round completion toggle. Open → Done, In progress → Done, Done → Open. */
export function TodoCheck({ status, onToggle, disabled = false, className }) {
  const done = status === 'DONE'
  const progress = status === 'IN_PROGRESS'
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={done}
      aria-label={done ? 'Mark as not done' : 'Mark as done'}
      disabled={disabled}
      onClick={(e) => { e.stopPropagation(); onToggle?.() }}
      onKeyDown={(e) => e.stopPropagation()}
      className={cn('group/check -m-1.5 shrink-0 rounded-full p-1.5 outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-default', className)}
    >
      <span
        className={cn(
          'flex size-[18px] items-center justify-center rounded-full border-[1.5px] transition-colors',
          done && 'border-emerald-500 bg-emerald-500 text-white',
          progress && 'border-blue-500',
          !done && !progress && 'border-gray-300 text-transparent',
          !done && !disabled && 'group-hover/check:border-gray-500 group-hover/check:text-gray-400'
        )}
      >
        {progress ? (
          <span className="size-2 rounded-full bg-blue-500 group-hover/check:hidden" />
        ) : null}
        <Check className={cn('size-3', progress && 'hidden group-hover/check:block')} strokeWidth={3} />
      </span>
    </button>
  )
}

function PriorityFlag({ priority, withLabel = true, className }) {
  const p = PRIORITY[priority] ?? PRIORITY.MEDIUM
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap', className)}>
      <Flag className={cn('size-3.5', p.icon)} />
      {withLabel && p.label}
    </span>
  )
}

function DueDate({ todo, className }) {
  if (!todo.dueDate) return null
  const tone = dueTone(todo)
  return (
    <span className={cn('inline-flex items-center gap-1 whitespace-nowrap', DUE_TONE_CLASS[tone], className)}>
      <CalendarDays className="size-3.5" />
      {dueLabel(todo.dueDate)}
    </span>
  )
}

function OrganizerLink({ organizer, className }) {
  if (!organizer) return <span className="text-gray-300">—</span>
  return (
    <Link
      href={`/admin/organizer/${organizer.id}?tab=todo`}
      onClick={(e) => e.stopPropagation()}
      className={cn('inline-flex min-w-0 max-w-full items-center gap-1.5 text-gray-700 underline-offset-4 hover:text-gray-900 hover:underline', className)}
    >
      <span className={cn('size-2 shrink-0 rounded-full', colorClasses(organizer.color).dot)} />
      <span className="truncate">{organizer.name}</span>
    </Link>
  )
}

function ListName({ list, className }) {
  if (!list) return <span className="text-gray-300">—</span>
  return (
    <span className={cn('inline-flex min-w-0 max-w-full items-center gap-1.5', className)}>
      <span className={cn('size-1.5 shrink-0 rounded-full', colorClasses(list.color).dot)} />
      <span className="truncate">{list.name}</span>
    </span>
  )
}

/** Column widths shared by TodoRow (columns mode) and the table header. */
export const TODO_COLS = {
  organizer: 'w-40',
  list: 'w-32',
  priority: 'w-24',
  due: 'w-28',
  assignee: 'w-16',
  status: 'w-28',
}

/**
 * One to-do.
 *   columns        render table columns on xl screens (master table); compact meta below xl
 *   showOrganizer  / showList   include them in the compact meta line
 *   dragHandleProps from @hello-pangea/dnd (shows a grip)
 */
export default function TodoRow({
  todo,
  onToggle,
  onOpen,
  canManage = false,
  columns = false,
  showOrganizer = false,
  showList = false,
  dragHandleProps,
  isDragging = false,
  className,
}) {
  const done = todo.status === 'DONE'
  const showPriority = todo.priority === 'URGENT' || todo.priority === 'HIGH'

  const meta = [
    todo.status === 'IN_PROGRESS' && (
      <span key="st" className="inline-flex items-center gap-1 text-blue-600">
        <span className="size-1.5 rounded-full bg-blue-500" />
        {TODO_STATUS.IN_PROGRESS.label}
      </span>
    ),
    todo.dueDate && <DueDate key="due" todo={todo} />,
    showPriority && <PriorityFlag key="pr" priority={todo.priority} className="text-gray-600" />,
    showOrganizer && todo.organizer && <OrganizerLink key="org" organizer={todo.organizer} className="max-w-[160px] text-gray-500" />,
    showList && todo.list && <ListName key="list" list={todo.list} className="max-w-[140px]" />,
    todo.project && (
      <span key="proj" className="inline-flex min-w-0 max-w-[160px] items-center gap-1">
        <Briefcase className="size-3.5 shrink-0" />
        <span className="truncate">{todo.project.name}</span>
      </span>
    ),
    todo.notes && <AlignLeft key="notes" className="size-3.5" aria-label="Has notes" />,
  ].filter(Boolean)

  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen?.(todo)}
      onKeyDown={(e) => {
        // Only the row itself: Space on the drag handle lifts it (dnd), Enter on a link follows it.
        if (e.target !== e.currentTarget) return
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen?.(todo) }
      }}
      className={cn(
        'group flex cursor-pointer items-start gap-3 bg-white px-3 py-2.5 text-sm outline-none transition-colors sm:px-4',
        'hover:bg-gray-50/80 focus-visible:bg-gray-50',
        columns && 'xl:items-center',
        isDragging && 'rounded-lg shadow-lg ring-1 ring-gray-200',
        className
      )}
    >
      {dragHandleProps && (
        <span
          {...dragHandleProps}
          onClick={(e) => e.stopPropagation()}
          aria-label="Drag to reorder"
          className="-ml-1.5 -mr-1.5 mt-0.5 flex h-5 w-4 shrink-0 cursor-grab items-center justify-center text-gray-300 transition-opacity hover:text-gray-500 active:cursor-grabbing sm:opacity-0 sm:group-hover:opacity-100"
        >
          <GripVertical className="size-4" />
        </span>
      )}

      <TodoCheck status={todo.status} onToggle={() => onToggle?.(todo)} disabled={!canManage} className={cn('mt-px', columns && 'xl:mt-0')} />

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className={cn('min-w-0 break-words leading-5 text-gray-900', done && 'text-gray-400 line-through decoration-gray-300')}>
            {todo.title}
          </span>
          {todo.tags?.map((t) => (
            <span key={t} className="rounded-md bg-gray-100 px-1.5 py-px text-[11px] font-medium leading-4 text-gray-600">#{t}</span>
          ))}
        </div>
        {meta.length > 0 && (
          <div className={cn('mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500', columns && 'xl:hidden')}>
            {meta}
          </div>
        )}
      </div>

      {columns && (
        <>
          <div className={cn('hidden shrink-0 text-[13px] xl:block', TODO_COLS.organizer)}>
            <OrganizerLink organizer={todo.organizer} />
          </div>
          <div className={cn('hidden shrink-0 text-[13px] text-gray-600 xl:block', TODO_COLS.list)}>
            <ListName list={todo.list} />
          </div>
          <div className={cn('hidden shrink-0 text-xs font-medium text-gray-700 xl:block', TODO_COLS.priority)}>
            <PriorityFlag priority={todo.priority} />
          </div>
          <div className={cn('hidden shrink-0 text-[13px] xl:block', TODO_COLS.due)}>
            {todo.dueDate ? <DueDate todo={todo} /> : <span className="text-gray-300">—</span>}
          </div>
        </>
      )}

      <div className={cn('flex shrink-0 justify-end', columns && 'xl:w-16 xl:justify-center')}>
        {todo.assignee ? (
          <span title={todo.assignee.name}>
            <Avatar src={todo.assignee.avatar} name={todo.assignee.name} size="xs" />
          </span>
        ) : columns ? (
          <span className="hidden size-6 xl:block" />
        ) : null}
      </div>

      {columns && (
        <div className={cn('hidden shrink-0 xl:block', TODO_COLS.status)}>
          <Badge variant={TODO_STATUS[todo.status]?.variant ?? 'default'} dot>
            {TODO_STATUS[todo.status]?.label ?? todo.status}
          </Badge>
        </div>
      )}
    </div>
  )
}
