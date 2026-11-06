'use client'

import { Pin } from 'lucide-react'
import { cn } from '@/lib/utils'
import { Card } from '@/components/ui/Card'
import ActionMenu from '@/components/ui/ActionMenu'
import { colorClasses } from '../constants'
import NoteCard, { OrganizerBadge, noteActions, relativeTime } from './NoteCard'

/** Masonry-ish responsive grid of note cards (CSS columns). */
export function NoteGrid({ notes, showOrganizer, canManage, onOpen, onTogglePin, onDelete }) {
  return (
    <div className="columns-1 gap-4 sm:columns-2 lg:columns-3 2xl:columns-4">
      {notes.map((n) => (
        <div key={n.id} className="mb-4 break-inside-avoid">
          <NoteCard
            note={n}
            showOrganizer={showOrganizer}
            canManage={canManage}
            onOpen={onOpen}
            onTogglePin={onTogglePin}
            onDelete={onDelete}
          />
        </div>
      ))}
    </div>
  )
}

/** Compact list of notes inside one card. */
export function NoteList({ notes, showOrganizer, canManage, onOpen, onTogglePin, onDelete }) {
  return (
    <Card className="divide-y divide-gray-100 overflow-hidden">
      {notes.map((n) => {
        const untitled = !n.title?.trim()
        const snippet = (n.content ?? '').replace(/\s+/g, ' ').trim()
        return (
          <div
            key={n.id}
            role="button"
            tabIndex={0}
            onClick={() => onOpen?.(n)}
            onKeyDown={(e) => { if (e.key === 'Enter' && e.target === e.currentTarget) { e.preventDefault(); onOpen?.(n) } }}
            className="group flex cursor-pointer items-center gap-3 px-3 py-3 outline-none transition-colors hover:bg-gray-50/80 focus-visible:bg-gray-50 sm:px-4"
          >
            <span className={cn('size-2.5 shrink-0 rounded-full', colorClasses(n.color).dot)} />
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 items-center gap-1.5">
                {n.pinned && <Pin className="size-3.5 shrink-0 fill-current text-gray-900" aria-label="Pinned" />}
                <p className={cn('truncate text-sm font-medium', untitled ? 'text-gray-400' : 'text-gray-900')}>
                  {untitled ? 'Untitled' : n.title}
                </p>
              </div>
              {snippet && <p className="mt-0.5 truncate text-[13px] text-gray-500">{snippet}</p>}
              {(n.tags?.length > 0 || showOrganizer) && (
                <div className="mt-1.5 flex flex-wrap items-center gap-1 md:hidden">
                  {showOrganizer && <OrganizerBadge organizer={n.organizer} className="max-w-[180px]" />}
                  {n.tags?.slice(0, 3).map((t) => (
                    <span key={t} className="rounded-md bg-gray-100 px-1.5 py-px text-[11px] font-medium leading-4 text-gray-600">#{t}</span>
                  ))}
                </div>
              )}
            </div>
            <div className="hidden max-w-[220px] shrink-0 flex-wrap justify-end gap-1 md:flex">
              {n.tags?.slice(0, 3).map((t) => (
                <span key={t} className="rounded-md bg-gray-100 px-1.5 py-px text-[11px] font-medium leading-4 text-gray-600">#{t}</span>
              ))}
              {n.tags?.length > 3 && <span className="text-[11px] text-gray-400">+{n.tags.length - 3}</span>}
            </div>
            {showOrganizer && (
              <div className="hidden w-40 shrink-0 md:block">
                <OrganizerBadge organizer={n.organizer} />
              </div>
            )}
            <span className="hidden w-28 shrink-0 text-right text-xs text-gray-400 sm:block">{relativeTime(n.updatedAt)}</span>
            {canManage && (
              <div className="-my-1 shrink-0">
                <ActionMenu items={noteActions(n, { onOpen, onTogglePin, onDelete, canManage })} />
              </div>
            )}
          </div>
        )
      })}
    </Card>
  )
}
