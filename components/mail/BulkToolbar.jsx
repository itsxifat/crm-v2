'use client'

import { Archive, ArchiveRestore, FolderInput, Inbox, Mail, MailOpen, OctagonAlert, ShieldCheck, Star, StarOff, Trash2, X } from 'lucide-react'
import MoveToMenu from './MoveToMenu'
import { Checkbox, IconButton } from './ui'

/** Selection toolbar (replaces the list header while rows are checked). */
export default function BulkToolbar({
  count, allChecked, onToggleAll, onClear, role,
  anyUnread, anyUnstarred, moveFolders, excludeFolderIds, onAction,
}) {
  const act = (action, opts) => () => onAction(action, opts)

  return (
    <div className="flex h-12 shrink-0 items-center gap-1 border-b border-gray-200/80 bg-white pl-3 pr-2 animate-in fade-in-0 duration-100">
      <span className="mr-1.5 flex size-8 items-center justify-center">
        <Checkbox checked={allChecked} indeterminate={!allChecked} onToggle={onToggleAll} label="Select all" />
      </span>
      <span className="mr-1 text-sm font-medium tabular-nums text-gray-900">{count}</span>

      <div className="flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto scrollbar-none">
        {role === 'TRASH' ? (
          <>
            <IconButton label="Restore" onClick={act('restore')}><ArchiveRestore /></IconButton>
            <IconButton label="Delete forever" onClick={act('delete')} className="hover:text-red-600"><Trash2 /></IconButton>
          </>
        ) : role === 'SPAM' ? (
          <>
            <IconButton label="Not spam" onClick={act('notSpam')}><ShieldCheck /></IconButton>
            <IconButton label="Delete" shortcut="#" onClick={act('trash')}><Trash2 /></IconButton>
          </>
        ) : (
          <>
            {role === 'ARCHIVE' ? (
              <IconButton label="Move to inbox" onClick={act('restore')}><Inbox /></IconButton>
            ) : role !== 'DRAFTS' && (
              <IconButton label="Archive" shortcut="E" onClick={act('archive')}><Archive /></IconButton>
            )}
            {role !== 'DRAFTS' && role !== 'SENT' && (
              <IconButton label="Report spam" shortcut="!" onClick={act('spam')}><OctagonAlert /></IconButton>
            )}
            <IconButton label="Delete" shortcut="#" onClick={act('trash')}><Trash2 /></IconButton>
          </>
        )}

        <span className="mx-1 h-4 w-px shrink-0 bg-gray-200" />

        {role !== 'DRAFTS' && (anyUnread ? (
          <IconButton label="Mark as read" shortcut="⇧I" onClick={act('read')}><MailOpen /></IconButton>
        ) : (
          <IconButton label="Mark as unread" shortcut="⇧U" onClick={act('unread')}><Mail /></IconButton>
        ))}
        {anyUnstarred ? (
          <IconButton label="Star" shortcut="S" onClick={act('star')}><Star /></IconButton>
        ) : (
          <IconButton label="Remove star" shortcut="S" onClick={act('unstar')}><StarOff /></IconButton>
        )}
        <MoveToMenu
          folders={moveFolders}
          excludeRoles={role ? [role] : []}
          excludeFolderIds={excludeFolderIds}
          onSelect={(t) => onAction(t.action, { folderId: t.folderId, label: t.label })}
        >
          <IconButton label="Move to"><FolderInput /></IconButton>
        </MoveToMenu>
      </div>

      <IconButton label="Clear selection" shortcut="Esc" onClick={onClear}><X /></IconButton>
    </div>
  )
}
