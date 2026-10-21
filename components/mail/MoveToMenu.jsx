'use client'

import { useMemo, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Archive, Folder, Inbox, OctagonAlert, Search, Trash2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { customFolderTree } from './mailUtils'
import { menuContent, menuItem, menuLabel, menuSeparator } from './ui'

// Standard targets use the semantic actions (they work across accounts and the
// server creates a missing Archive/Trash folder); custom folders use `move`.
const ROLE_TARGETS = [
  { role: 'INBOX',   action: 'restore', label: 'Inbox',   icon: Inbox },
  { role: 'ARCHIVE', action: 'archive', label: 'Archive', icon: Archive },
  { role: 'SPAM',    action: 'spam',    label: 'Spam',    icon: OctagonAlert },
  { role: 'TRASH',   action: 'trash',   label: 'Trash',   icon: Trash2 },
]

/**
 * folders: the account's folders when every target message is in one account
 * (custom folders are offered), or null for a mixed selection (standard targets only).
 * onSelect({ action, folderId?, label })
 */
export default function MoveToMenu({ children, folders, excludeRoles = [], excludeFolderIds = [], onSelect, align = 'start' }) {
  const [q, setQ] = useState('')
  const tree = useMemo(() => (folders ? customFolderTree(folders) : []), [folders])
  const needle = q.trim().toLowerCase()

  const roles = ROLE_TARGETS.filter(t => !excludeRoles.includes(t.role) && (!needle || t.label.toLowerCase().includes(needle)))
  const customs = tree.filter(f =>
    !excludeFolderIds.includes(f.id) && !f.noSelect &&
    (!needle || f.name.toLowerCase().includes(needle) || f.path.toLowerCase().includes(needle)))

  return (
    <DropdownMenu.Root onOpenChange={(o) => { if (!o) setQ('') }}>
      <DropdownMenu.Trigger asChild>{children}</DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align={align} sideOffset={6} className={cn(menuContent, 'w-60')} onCloseAutoFocus={(e) => e.preventDefault()}>
          {tree.length > 6 && (
            <div className="relative mb-1">
              <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-gray-400" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                // Keep Radix typeahead from stealing focus while typing.
                onKeyDown={(e) => { if (e.key !== 'Escape' && e.key !== 'ArrowDown') e.stopPropagation() }}
                placeholder="Find folder"
                className="h-8 w-full rounded-md border-0 bg-gray-50 pl-7 pr-2 text-sm text-gray-900 outline-none ring-0 placeholder:text-gray-400 focus:ring-2 focus:ring-ring/30"
              />
            </div>
          )}
          <DropdownMenu.Label className={menuLabel}>Move to</DropdownMenu.Label>
          {roles.map(t => (
            <DropdownMenu.Item key={t.role} className={menuItem} onSelect={() => onSelect?.({ action: t.action, label: t.label, role: t.role })}>
              <t.icon className="size-4 text-gray-500" />
              {t.label}
            </DropdownMenu.Item>
          ))}
          {customs.length > 0 && (
            <>
              {roles.length > 0 && <DropdownMenu.Separator className={menuSeparator} />}
              <div className="max-h-64 overflow-y-auto">
                {customs.map(f => (
                  <DropdownMenu.Item
                    key={f.id}
                    className={menuItem}
                    style={{ paddingLeft: 8 + f.level * 14 }}
                    onSelect={() => onSelect?.({ action: 'move', folderId: f.id, label: f.name })}
                  >
                    <Folder className="size-4 text-gray-500" />
                    <span className="truncate">{f.name}</span>
                  </DropdownMenu.Item>
                ))}
              </div>
            </>
          )}
          {!roles.length && !customs.length && (
            <div className="px-2 py-3 text-center text-sm text-muted-foreground">No folders</div>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
