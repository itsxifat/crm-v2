'use client'

import Link from 'next/link'
import { Inbox, Pencil, RefreshCw, Pause, Play, Power, PowerOff, Trash2 } from 'lucide-react'
import { Card } from '@/components/ui/Card'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import Avatar from '@/components/ui/Avatar'
import ActionMenu from '@/components/ui/ActionMenu'
import { buttonVariants } from '@/components/ui/Button'
import { cn, formatDateTime } from '@/lib/utils'
import { MAIL_PROVIDERS } from '@/lib/mail/constants'
import SyncStatusBadge from './SyncStatusBadge'
import AccountMark from './AccountMark'
import Tip from './Tip'
import { timeAgo } from './api'

const MAX_AVATARS = 4

export const mailboxHref = (id) => `/admin/mail?account=${encodeURIComponent(id)}`

function AssignedStack({ users = [] }) {
  if (!users.length) return <span className="text-muted-foreground">—</span>
  const shown = users.slice(0, MAX_AVATARS)
  const extra = users.length - shown.length
  return (
    <Tip content={users.map(u => u.name).filter(Boolean).join(', ')}>
      <span className="flex items-center -space-x-1.5">
        {shown.map(u => (
          <span key={u.id} className="inline-flex rounded-full ring-2 ring-white">
            <Avatar src={u.avatar} name={u.name} size="xs" />
          </span>
        ))}
        {extra > 0 && (
          <span className="relative inline-flex size-6 items-center justify-center rounded-full bg-gray-100 text-[10px] font-semibold tabular-nums text-gray-600 ring-2 ring-white">
            +{extra}
          </span>
        )}
      </span>
    </Tip>
  )
}

/**
 * Mail accounts list.
 * Props: accounts, syncingIds (Set), onEdit, onSync, onToggleSync, onToggleActive, onDelete
 */
export default function AccountsTable({ accounts, syncingIds, onEdit, onSync, onToggleSync, onToggleActive, onDelete }) {
  return (
    <Card className="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead className="pl-5">Account</TableHead>
            <TableHead className="hidden lg:table-cell">Provider</TableHead>
            <TableHead className="hidden md:table-cell">Assigned</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="hidden sm:table-cell">Last sync</TableHead>
            <TableHead className="hidden text-right md:table-cell">Messages</TableHead>
            <TableHead className="w-0 pr-3"><span className="sr-only">Actions</span></TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {accounts.map(a => {
            const syncing = syncingIds?.has(a.id)
            const lastSync = a.sync?.lastSyncAt
            return (
              <TableRow key={a.id} className="group cursor-pointer" onClick={() => onEdit(a)}>
                <TableCell className="py-3.5 pl-5">
                  <div className="flex min-w-0 items-center gap-3">
                    <AccountMark color={a.color} name={a.name} className={cn(!a.isActive && 'opacity-50 grayscale')} />
                    <div className="min-w-0">
                      <p className="truncate font-medium text-gray-900">{a.name}</p>
                      <p className="truncate text-[13px] text-muted-foreground">{a.email}</p>
                    </div>
                  </div>
                </TableCell>
                <TableCell className="hidden whitespace-nowrap text-[13px] text-muted-foreground lg:table-cell">
                  {MAIL_PROVIDERS[a.provider]?.label ?? 'Custom'}
                </TableCell>
                <TableCell className="hidden md:table-cell">
                  <AssignedStack users={a.assignedUsers} />
                </TableCell>
                <TableCell>
                  <SyncStatusBadge account={a} syncing={syncing} />
                </TableCell>
                <TableCell className="hidden whitespace-nowrap text-[13px] tabular-nums text-muted-foreground sm:table-cell">
                  {lastSync ? <span title={formatDateTime(lastSync)}>{timeAgo(lastSync)}</span> : '—'}
                </TableCell>
                <TableCell className="hidden text-right tabular-nums text-gray-900 md:table-cell">
                  {(a.sync?.messageCount ?? 0).toLocaleString()}
                </TableCell>
                <TableCell className="pr-3" onClick={e => e.stopPropagation()}>
                  <div className="flex items-center justify-end gap-0.5">
                    <Tip content="Open mailbox">
                      <Link
                        href={mailboxHref(a.id)}
                        aria-label="Open mailbox"
                        className={cn(
                          buttonVariants({ variant: 'ghost', size: 'icon-sm' }),
                          'text-gray-400 hover:text-gray-900 sm:opacity-0 sm:group-hover:opacity-100 sm:focus-visible:opacity-100'
                        )}
                      >
                        <Inbox />
                      </Link>
                    </Tip>
                    <ActionMenu
                      items={[
                        { label: 'Open mailbox', icon: Inbox, href: mailboxHref(a.id) },
                        { label: 'Edit', icon: Pencil, onClick: () => onEdit(a) },
                        { label: 'Sync now', icon: RefreshCw, onClick: () => onSync(a), disabled: syncing || !a.isActive },
                        a.syncEnabled
                          ? { label: 'Pause sync', icon: Pause, onClick: () => onToggleSync(a) }
                          : { label: 'Resume sync', icon: Play, onClick: () => onToggleSync(a) },
                        a.isActive
                          ? { label: 'Deactivate', icon: PowerOff, onClick: () => onToggleActive(a) }
                          : { label: 'Activate', icon: Power, onClick: () => onToggleActive(a) },
                        { label: 'Delete', icon: Trash2, danger: true, onClick: () => onDelete(a) },
                      ]}
                    />
                  </div>
                </TableCell>
              </TableRow>
            )
          })}
        </TableBody>
      </Table>
    </Card>
  )
}
