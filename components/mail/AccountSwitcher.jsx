'use client'

import Link from 'next/link'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import { Check, ChevronsUpDown, Layers, Settings2 } from 'lucide-react'
import { cn } from '@/lib/utils'
import { menuContent, menuItem, menuSeparator } from './ui'

function AccountMark({ account, size = 'md' }) {
  const box = size === 'md' ? 'size-8 rounded-lg text-[13px]' : 'size-6 rounded-md text-[11px]'
  if (!account) {
    return (
      <span className={cn('inline-flex shrink-0 items-center justify-center bg-gray-900 text-white', box)}>
        <Layers className={size === 'md' ? 'size-4' : 'size-3.5'} />
      </span>
    )
  }
  return (
    <span
      className={cn('inline-flex shrink-0 items-center justify-center font-semibold text-white ring-1 ring-inset ring-black/10', box)}
      style={{ backgroundColor: account.color || '#18181b' }}
    >
      {(account.name || account.email || '?').trim()[0]?.toUpperCase()}
    </span>
  )
}

function Count({ n }) {
  if (!n) return null
  return <span className="ml-auto pl-2 text-xs font-medium tabular-nums text-gray-500">{n > 9999 ? '9999+' : n}</span>
}

export default function AccountSwitcher({ accounts, value, onChange, unreadByAccount = {}, canManage }) {
  const current = value === 'all' ? null : accounts.find(a => a.id === value)
  const totalUnread = accounts.reduce((s, a) => s + (unreadByAccount[a.id] || 0), 0)
  const multi = accounts.length > 1

  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger
        className="flex w-full items-center gap-2.5 rounded-lg p-1.5 text-left outline-none transition-colors hover:bg-gray-100 focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:bg-gray-100"
        aria-label="Switch mailbox"
      >
        <AccountMark account={current} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium text-gray-900">{current ? current.name : 'All inboxes'}</span>
          <span className="block truncate text-xs text-muted-foreground">
            {current ? current.email : `${accounts.length} mailboxes`}
          </span>
        </span>
        <ChevronsUpDown className="size-4 shrink-0 text-gray-400" />
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content align="start" sideOffset={6} className={cn(menuContent, 'w-[--radix-dropdown-menu-trigger-width] min-w-[260px]')}>
          {multi && (
            <>
              <DropdownMenu.Item className={cn(menuItem, 'py-2')} onSelect={() => onChange('all')}>
                <AccountMark size="sm" />
                <span className="min-w-0 flex-1 truncate font-medium text-gray-900">All inboxes</span>
                <Count n={totalUnread} />
                {value === 'all' && <Check className="size-4 shrink-0 text-gray-900" />}
              </DropdownMenu.Item>
              <DropdownMenu.Separator className={menuSeparator} />
            </>
          )}
          <div className="max-h-[50vh] overflow-y-auto">
            {accounts.map(a => (
              <DropdownMenu.Item key={a.id} className={cn(menuItem, 'py-2')} onSelect={() => onChange(a.id)}>
                <AccountMark account={a} size="sm" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium text-gray-900">{a.name}</span>
                  <span className="block truncate text-xs text-muted-foreground">{a.email}</span>
                </span>
                <Count n={unreadByAccount[a.id]} />
                {value === a.id && <Check className="size-4 shrink-0 text-gray-900" />}
              </DropdownMenu.Item>
            ))}
          </div>
          {canManage && (
            <>
              <DropdownMenu.Separator className={menuSeparator} />
              <DropdownMenu.Item asChild>
                <Link href="/admin/mail/accounts" className={menuItem}>
                  <Settings2 className="size-4 text-gray-500" />
                  Manage accounts
                </Link>
              </DropdownMenu.Item>
            </>
          )}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}
