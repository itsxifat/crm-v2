'use client'

import Link from 'next/link'
import { formatDistanceToNow } from 'date-fns'
import { Pencil, Pin, PinOff, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import ActionMenu from '@/components/ui/ActionMenu'
import { colorClasses } from '../constants'

export function relativeTime(iso) {
  if (!iso) return ''
  try { return formatDistanceToNow(new Date(iso), { addSuffix: true }) } catch { return '' }
}

/** Card background: white for the neutral colour, a soft tint otherwise. */
export function noteSurface(color) {
  return !color || color === 'zinc' ? 'bg-white' : colorClasses(color).tint
}

export function OrganizerBadge({ organizer, className }) {
  if (!organizer) return null
  return (
    <Link
      href={`/admin/organizer/${organizer.id}?tab=notes`}
      onClick={(e) => e.stopPropagation()}
      className={cn(
        'inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full bg-white/70 px-2 py-0.5 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-200 transition-colors hover:text-gray-900 hover:ring-gray-300',
        className
      )}
    >
      <span className={cn('size-1.5 shrink-0 rounded-full', colorClasses(organizer.color).dot)} />
      <span className="truncate">{organizer.name}</span>
    </Link>
  )
}

export function noteActions(note, { onOpen, onTogglePin, onDelete, canManage }) {
  if (!canManage) return []
  return [
    { label: 'Edit', icon: Pencil, onClick: () => onOpen?.(note) },
    { label: note.pinned ? 'Unpin' : 'Pin', icon: note.pinned ? PinOff : Pin, onClick: () => onTogglePin?.(note) },
    { label: 'Delete', icon: Trash2, danger: true, onClick: () => onDelete?.(note) },
  ]
}

/** Grid card: colour tint, pin, title, 8-line preview, tags, organizer badge (master), relative time. */
export default function NoteCard({ note, showOrganizer = false, canManage = false, onOpen, onTogglePin, onDelete, className }) {
  const untitled = !note.title?.trim()
  return (
    <div
      role="button"
      tabIndex={0}
      onClick={() => onOpen?.(note)}
      onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); onOpen?.(note) } }}
      className={cn(
        'group relative flex cursor-pointer flex-col gap-2 rounded-xl border border-gray-200/80 p-4 text-left shadow-xs outline-none transition-shadow',
        'hover:shadow-md focus-visible:ring-[3px] focus-visible:ring-ring/40',
        noteSurface(note.color),
        className
      )}
    >
      <div className="flex items-start gap-2">
        <h3 className={cn('min-w-0 flex-1 break-words text-sm font-semibold leading-5', untitled ? 'text-gray-400' : 'text-gray-900')}>
          {untitled ? 'Untitled' : note.title}
        </h3>
        <div className="-mr-1.5 -mt-1.5 flex shrink-0 items-center">
          {canManage ? (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onTogglePin?.(note) }}
              aria-label={note.pinned ? 'Unpin' : 'Pin'}
              title={note.pinned ? 'Unpin' : 'Pin'}
              className={cn(
                'inline-flex size-8 items-center justify-center rounded-md transition-colors hover:bg-black/5',
                note.pinned ? 'text-gray-900' : 'text-gray-400 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100'
              )}
            >
              <Pin className={cn('size-4', note.pinned && 'fill-current')} />
            </button>
          ) : note.pinned ? (
            <span className="inline-flex size-8 items-center justify-center text-gray-900"><Pin className="size-4 fill-current" /></span>
          ) : null}
          {canManage && (
            <div className="sm:opacity-0 sm:focus-within:opacity-100 sm:group-hover:opacity-100 sm:has-[[data-open=true]]:opacity-100">
              <ActionMenu items={noteActions(note, { onOpen, onTogglePin, onDelete, canManage })} />
            </div>
          )}
        </div>
      </div>

      {note.content && (
        <p className="line-clamp-[8] whitespace-pre-wrap break-words text-[13px] leading-relaxed text-gray-700">
          {note.content}
        </p>
      )}

      {note.tags?.length > 0 && (
        <div className="flex flex-wrap gap-1">
          {note.tags.map((t) => (
            <span key={t} className="rounded-md bg-black/[0.04] px-1.5 py-px text-[11px] font-medium leading-4 text-gray-600">#{t}</span>
          ))}
        </div>
      )}

      <div className="mt-auto flex items-center gap-2 pt-1 text-xs text-gray-400">
        {showOrganizer && <OrganizerBadge organizer={note.organizer} className="max-w-[60%]" />}
        {note.project && !showOrganizer && <span className="min-w-0 truncate text-gray-500">{note.project.name}</span>}
        <span className="ml-auto shrink-0 whitespace-nowrap">{relativeTime(note.updatedAt)}</span>
      </div>
    </div>
  )
}
