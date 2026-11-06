'use client'

import Link from 'next/link'
import {
  Archive, ArchiveRestore, ArrowLeft, Building2, FolderKanban, Pencil, Pin, PinOff, Trash2,
} from 'lucide-react'
import Badge from '@/components/ui/Badge'
import ActionMenu from '@/components/ui/ActionMenu'
import { cn } from '@/lib/utils'
import { colorClasses } from './constants'

const chipClass =
  'inline-flex max-w-[16rem] items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset transition-colors'

/** Title block of an organizer page: back link, colour dot + name, client / project chips, actions. */
export default function OrganizerHeader({ organizer, canManage, onEdit, onTogglePin, onToggleArchive, onDelete }) {
  const c = colorClasses(organizer.color)
  const archived = organizer.status === 'ARCHIVED'
  const pinned = !!organizer.pinned
  const projects = organizer.projects ?? []

  return (
    <div className="min-w-0">
      <Link
        href="/admin/organizer"
        className="mb-2 inline-flex items-center gap-1.5 text-[13px] font-medium text-muted-foreground hover:text-gray-900"
      >
        <ArrowLeft className="size-3.5" />
        Organizer
      </Link>

      <div className="flex min-w-0 items-center gap-2.5">
        <span aria-hidden className={cn('size-3 shrink-0 rounded-full', c.dot)} />
        <h1 className="truncate text-2xl font-semibold tracking-tight text-gray-900">{organizer.name}</h1>
        {pinned && <Pin className="size-4 shrink-0 fill-current text-gray-400" aria-label="Pinned" />}
        {archived && <Badge className="shrink-0">Archived</Badge>}
        {canManage && (
          <div className="ml-auto shrink-0 pl-2">
            <ActionMenu
              items={[
                { label: 'Edit', icon: Pencil, onClick: onEdit },
                { label: pinned ? 'Unpin' : 'Pin', icon: pinned ? PinOff : Pin, onClick: onTogglePin },
                {
                  label: archived ? 'Restore' : 'Archive',
                  icon: archived ? ArchiveRestore : Archive,
                  onClick: onToggleArchive,
                },
                { label: 'Delete', icon: Trash2, danger: true, onClick: onDelete },
              ]}
            />
          </div>
        )}
      </div>

      {(organizer.client || projects.length > 0) && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {organizer.client && (
            <Link
              href={`/admin/clients/${organizer.client.id}`}
              className={cn(chipClass, 'bg-gray-100 text-gray-700 ring-gray-500/10 hover:bg-gray-200/70')}
            >
              <Building2 className="size-3.5 shrink-0 text-gray-500" />
              <span className="truncate">{organizer.client.name}</span>
            </Link>
          )}
          {projects.map((p) => (
            <Link
              key={p.id}
              href={`/admin/projects/${p.id}`}
              className={cn(chipClass, 'bg-white text-gray-700 ring-gray-200 hover:bg-gray-50')}
            >
              <FolderKanban className="size-3.5 shrink-0 text-gray-400" />
              <span className="truncate">{p.name}</span>
            </Link>
          ))}
        </div>
      )}

      {organizer.description && (
        <p className="mt-2.5 line-clamp-2 max-w-2xl whitespace-pre-line text-sm text-muted-foreground">
          {organizer.description}
        </p>
      )}
    </div>
  )
}
