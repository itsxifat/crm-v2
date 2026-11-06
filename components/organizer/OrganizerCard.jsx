'use client'

import Link from 'next/link'
import {
  Archive, ArchiveRestore, Building2, CalendarDays, ListTodo, Pencil, Pin, PinOff, StickyNote, Trash2,
} from 'lucide-react'
import { Card } from '@/components/ui/Card'
import Badge from '@/components/ui/Badge'
import ActionMenu from '@/components/ui/ActionMenu'
import { cn } from '@/lib/utils'
import { colorClasses } from './constants'

const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`

/**
 * Dashboard tile for one organizer. The whole card links to the organizer;
 * the pin button and action menu sit above that link.
 */
export default function OrganizerCard({ organizer, canManage, onEdit, onTogglePin, onToggleArchive, onDelete }) {
  const c = colorClasses(organizer.color)
  const counts = organizer.counts ?? {}
  const archived = organizer.status === 'ARCHIVED'
  const pinned = !!organizer.pinned
  const projects = organizer.projects ?? []
  const href = `/admin/organizer/${organizer.id}`

  const meta = [
    organizer.client && (
      <span key="client" className="flex min-w-0 items-center gap-1.5">
        <Building2 className="size-3.5 shrink-0" />
        <span className="truncate">{organizer.client.name}</span>
      </span>
    ),
    projects.length > 0 && <span key="projects" className="shrink-0">{plural(projects.length, 'project')}</span>,
    <span key="calendars" className="shrink-0">{plural(counts.calendars ?? 0, 'calendar')}</span>,
  ].filter(Boolean)

  return (
    <Card
      className={cn(
        'group relative flex flex-col overflow-hidden transition-[border-color,box-shadow] duration-200 hover:border-gray-300 hover:shadow-md',
        archived && 'bg-gray-50/70'
      )}
    >
      <span aria-hidden className={cn('absolute inset-x-0 top-0 h-1', c.bar, archived && 'opacity-40')} />

      <div className="flex items-start gap-2 px-5 pb-4 pt-5">
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-2">
            <Link
              href={href}
              className={cn(
                'truncate text-sm font-semibold tracking-tight outline-none after:absolute after:inset-0 focus-visible:underline',
                archived ? 'text-gray-600' : 'text-gray-900'
              )}
            >
              {organizer.name}
            </Link>
            {archived && <Badge className="shrink-0">Archived</Badge>}
          </div>
          <div className="mt-1 flex min-w-0 items-center gap-1.5 text-[13px] text-muted-foreground">
            {meta.map((node, i) => (
              <span key={node.key} className={cn('flex min-w-0 items-center gap-1.5', i > 0 && 'shrink-0')}>
                {i > 0 && <span className="text-gray-300">·</span>}
                {node}
              </span>
            ))}
          </div>
        </div>

        <div className="relative z-10 -mr-2 -mt-1.5 flex shrink-0 items-center">
          {canManage ? (
            <button
              type="button"
              onClick={() => onTogglePin?.(organizer)}
              aria-label={pinned ? 'Unpin' : 'Pin'}
              title={pinned ? 'Unpin' : 'Pin'}
              className={cn(
                'inline-flex size-8 items-center justify-center rounded-md transition-colors hover:bg-gray-100',
                pinned ? 'text-gray-900' : 'text-gray-300 hover:text-gray-700'
              )}
            >
              <Pin className={cn('size-4', pinned && 'fill-current')} />
            </button>
          ) : pinned ? (
            <span className="inline-flex size-8 items-center justify-center text-gray-400" title="Pinned">
              <Pin className="size-4 fill-current" />
            </span>
          ) : null}
          {canManage && (
            <ActionMenu
              items={[
                { label: 'Edit', icon: Pencil, onClick: () => onEdit?.(organizer) },
                { label: pinned ? 'Unpin' : 'Pin', icon: pinned ? PinOff : Pin, onClick: () => onTogglePin?.(organizer) },
                {
                  label: archived ? 'Restore' : 'Archive',
                  icon: archived ? ArchiveRestore : Archive,
                  onClick: () => onToggleArchive?.(organizer),
                },
                { label: 'Delete', icon: Trash2, danger: true, onClick: () => onDelete?.(organizer) },
              ]}
            />
          )}
        </div>
      </div>

      {organizer.description && (
        <p className="-mt-1 line-clamp-2 px-5 pb-4 text-[13px] leading-relaxed text-gray-600">{organizer.description}</p>
      )}

      <div className="mt-auto grid grid-cols-3 divide-x divide-gray-100 border-t border-gray-100">
        <Metric icon={CalendarDays} label="Upcoming" value={counts.upcomingEvents ?? 0} />
        <Metric
          icon={ListTodo}
          label="Open to-dos"
          value={counts.todosOpen ?? 0}
          extra={counts.todosOverdue > 0 && (
            <span className="text-xs font-medium text-red-600">{counts.todosOverdue} overdue</span>
          )}
        />
        <Metric icon={StickyNote} label="Notes" value={counts.notes ?? 0} />
      </div>
    </Card>
  )
}

function Metric({ icon: Icon, label, value, extra }) {
  return (
    <div className="min-w-0 px-3.5 py-3">
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <Icon className="size-3.5 shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5">
        <span className="text-sm font-semibold tabular-nums text-gray-900">{value}</span>
        {extra}
      </div>
    </div>
  )
}
