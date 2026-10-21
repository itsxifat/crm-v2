'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  Bell, BellOff, BellRing, Clock, Folder, FolderPlus, Keyboard, Loader2, MoreHorizontal, PenSquare, Pencil, Plus, RefreshCw, Star, Trash2,
} from 'lucide-react'
import Button from '@/components/ui/Button'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import { cn } from '@/lib/utils'
import { STANDARD_FOLDERS } from '@/lib/mail/constants'
import AccountSwitcher from './AccountSwitcher'
import { DRAG_TYPE, ROLE_META, customFolderTree, formatAgo } from './mailUtils'
import { AccountDot, CountBadge, IconButton, Tip, menuContent, menuItem, menuItemDanger, menuSeparator } from './ui'

const itemBase = 'group/item relative flex w-full items-center gap-2.5 rounded-lg text-sm outline-none transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-ring/50'
const itemIdle = 'text-gray-600 hover:bg-gray-100 hover:text-gray-900'
const itemOn   = 'bg-white font-medium text-gray-900 shadow-sm ring-1 ring-gray-200/70'
const itemDrop = 'bg-gray-900/5 text-gray-900 ring-1 ring-gray-900/20'

// Rail order: Gmail-like, virtual views right under the inbox.
const NAV = [
  { key: 'role:INBOX', role: 'INBOX' },
  { key: 'view:starred', view: 'starred', label: 'Starred', icon: Star },
  { key: 'view:scheduled', view: 'scheduled', label: 'Scheduled', icon: Clock },
  ...STANDARD_FOLDERS.filter(f => f.role !== 'INBOX').map(f => ({ key: `role:${f.role}`, role: f.role })),
]
const DROP_ROLES = ['INBOX', 'ARCHIVE', 'SPAM', 'TRASH']

function useDropTarget(enabled, onDrop) {
  const [over, setOver] = useState(false)
  if (!enabled) return [false, {}]
  return [over, {
    onDragOver: (e) => {
      if (!e.dataTransfer.types.includes(DRAG_TYPE)) return
      e.preventDefault()
      e.dataTransfer.dropEffect = 'move'
      if (!over) setOver(true)
    },
    onDragLeave: (e) => { if (!e.currentTarget.contains(e.relatedTarget)) setOver(false) },
    onDrop: (e) => {
      e.preventDefault()
      setOver(false)
      let ids = []
      try { ids = JSON.parse(e.dataTransfer.getData(DRAG_TYPE) || '[]') } catch {}
      if (ids.length) onDrop(ids)
    },
  }]
}

function NavItem({ icon: Icon, label, count, strong, active, onClick, dropEnabled, onDropIds, style, children }) {
  const [over, dropProps] = useDropTarget(dropEnabled, (ids) => onDropIds?.(ids))
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      style={style}
      className={cn(itemBase, 'h-8 px-2', over ? itemDrop : active ? itemOn : itemIdle)}
      {...dropProps}
    >
      <Icon className={cn('size-4 shrink-0', active || over ? 'text-gray-900' : 'text-gray-500 group-hover/item:text-gray-900')} />
      <span className="min-w-0 flex-1 truncate text-left">{label}</span>
      {children ?? <CountBadge count={count} strong={strong} />}
    </button>
  )
}

function InlineFolderInput({ initial = '', level = 0, onSubmit, onCancel }) {
  const [value, setValue] = useState(initial)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(false)
  const ref = useRef(null)
  useEffect(() => { ref.current?.focus(); ref.current?.select() }, [])

  async function submit() {
    const name = value.trim()
    if (!name || name === initial) return onCancel()
    setBusy(true)
    const ok = await onSubmit(name)
    setBusy(false)
    if (!ok) { setError(true); ref.current?.focus() }
  }

  return (
    <div className="flex h-8 items-center gap-2.5 px-2" style={{ paddingLeft: 8 + level * 14 }}>
      {busy ? <Loader2 className="size-4 shrink-0 animate-spin text-gray-400" /> : <Folder className="size-4 shrink-0 text-gray-400" />}
      <input
        ref={ref}
        value={value}
        disabled={busy}
        onChange={(e) => { setValue(e.target.value); setError(false) }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') { e.preventDefault(); submit() }
          if (e.key === 'Escape') { e.preventDefault(); onCancel() }
        }}
        onBlur={() => { if (!busy && !value.trim()) onCancel() }}
        placeholder="Folder name"
        aria-invalid={error || undefined}
        className="h-7 min-w-0 flex-1 rounded-md border border-input bg-white px-2 text-sm text-gray-900 shadow-xs outline-none placeholder:text-gray-400 focus:border-ring focus:ring-2 focus:ring-ring/30 aria-[invalid=true]:border-red-400"
      />
    </div>
  )
}

function CustomFolderItem({ folder, active, onOpen, onRename, onDelete, onNewSub, onDropIds }) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [over, dropProps] = useDropTarget(!folder.noSelect, (ids) => onDropIds?.(ids))

  return (
    <div className="group/f relative" onContextMenu={(e) => { e.preventDefault(); setMenuOpen(true) }}>
      <button
        type="button"
        onClick={() => !folder.noSelect && onOpen()}
        aria-current={active ? 'page' : undefined}
        style={{ paddingLeft: 8 + folder.level * 14 }}
        className={cn(itemBase, 'h-8 pr-8', over ? itemDrop : active ? itemOn : itemIdle, folder.noSelect && 'cursor-default')}
        {...dropProps}
      >
        <Folder className={cn('size-4 shrink-0', active || over ? 'text-gray-900' : 'text-gray-500 group-hover/item:text-gray-900')} />
        <span className="min-w-0 flex-1 truncate text-left">{folder.name}</span>
        <span className={cn('transition-opacity group-hover/f:opacity-0', menuOpen && 'opacity-0')}>
          <CountBadge count={folder.unread} strong />
        </span>
      </button>
      <DropdownMenu.Root open={menuOpen} onOpenChange={setMenuOpen}>
        <DropdownMenu.Trigger asChild>
          <button
            type="button"
            aria-label={`${folder.name} options`}
            className="absolute right-1 top-1/2 inline-flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-gray-400 opacity-0 outline-none transition-opacity hover:bg-gray-200/70 hover:text-gray-900 focus-visible:opacity-100 focus-visible:ring-2 focus-visible:ring-ring/50 group-hover/f:opacity-100 data-[state=open]:opacity-100"
          >
            <MoreHorizontal className="size-4" />
          </button>
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="start" side="right" sideOffset={6} className={menuContent}>
            <DropdownMenu.Item className={menuItem} onSelect={onNewSub}>
              <FolderPlus className="size-4 text-gray-500" />
              New subfolder
            </DropdownMenu.Item>
            <DropdownMenu.Item className={menuItem} onSelect={onRename}>
              <Pencil className="size-4 text-gray-500" />
              Rename
            </DropdownMenu.Item>
            <DropdownMenu.Separator className={menuSeparator} />
            <DropdownMenu.Item className={cn(menuItem, menuItemDanger)} onSelect={onDelete}>
              <Trash2 className="size-4" />
              Delete
            </DropdownMenu.Item>
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}

function FolderSection({ title, account, folders, activeKey, onNavigate, onCreate, onRename, onDelete, onDropMessages }) {
  const tree = useMemo(() => customFolderTree(folders), [folders])
  // { mode: 'new', parentId, level, afterId } | { mode: 'rename', id }
  const [editing, setEditing] = useState(null)

  async function create(name) {
    const ok = await onCreate({ accountId: account.id, name, parentId: editing?.parentId || undefined })
    if (ok) setEditing(null)
    return ok
  }
  async function rename(folder, name) {
    const ok = await onRename(folder, name)
    if (ok) setEditing(null)
    return ok
  }

  const newRow = (level) => (
    <InlineFolderInput key="__new" level={level} onSubmit={create} onCancel={() => setEditing(null)} />
  )

  return (
    <div className="mt-5">
      <div className="group/h mb-1 flex h-6 items-center gap-2 px-2">
        {title}
        <IconButton
          label="New folder"
          size="xs"
          tipSide="right"
          className="ml-auto size-6 opacity-60 hover:opacity-100 group-hover/h:opacity-100"
          onClick={() => setEditing({ mode: 'new', parentId: null, level: 0, afterId: null })}
        >
          <Plus />
        </IconButton>
      </div>
      <div className="space-y-px">
        {editing?.mode === 'new' && !editing.afterId && newRow(0)}
        {tree.map(f => (
          <div key={f.id}>
            {editing?.mode === 'rename' && editing.id === f.id ? (
              <InlineFolderInput initial={f.name} level={f.level} onSubmit={(name) => rename(f, name)} onCancel={() => setEditing(null)} />
            ) : (
              <CustomFolderItem
                folder={f}
                active={activeKey === `folder:${f.id}`}
                onOpen={() => onNavigate({ folderId: f.id })}
                onRename={() => setEditing({ mode: 'rename', id: f.id })}
                onDelete={() => onDelete(f)}
                onNewSub={() => setEditing({ mode: 'new', parentId: f.id, level: f.level + 1, afterId: f.id })}
                onDropIds={(ids) => onDropMessages({ action: 'move', folderId: f.id, accountId: f.accountId, label: f.name }, ids)}
              />
            )}
            {editing?.mode === 'new' && editing.afterId === f.id && newRow(editing.level)}
          </div>
        ))}
      </div>
    </div>
  )
}

function useTick(ms) {
  const [, setN] = useState(0)
  useEffect(() => {
    const t = setInterval(() => setN(n => n + 1), ms)
    return () => clearInterval(t)
  }, [ms])
}

function SyncIndicator({ sync }) {
  useTick(30_000)
  const { state, lastSyncAt, error } = sync || {}
  let content
  if (state === 'syncing') {
    content = <><Loader2 className="size-3.5 animate-spin text-gray-400" /><span>Syncing…</span></>
  } else if (state === 'error') {
    content = <><span className="size-2 shrink-0 rounded-full bg-red-500" /><span className="text-red-600">Sync error</span></>
  } else if (state === 'live') {
    content = (
      <>
        <span className="relative flex size-2 shrink-0">
          <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
          <span className="relative inline-flex size-2 rounded-full bg-emerald-500" />
        </span>
        <span className="text-gray-700">Live</span>
      </>
    )
  } else {
    const ago = formatAgo(lastSyncAt)
    content = <><span className="size-2 shrink-0 rounded-full bg-gray-300" /><span>{ago ? `Synced ${ago}` : 'Not synced yet'}</span></>
  }
  return (
    <Tip label={state === 'error' ? error : null} side="top" align="start">
      <span className="flex min-w-0 flex-1 items-center gap-2 truncate text-xs text-muted-foreground">{content}</span>
    </Tip>
  )
}

export default function FolderRail({
  accounts, accountId, onAccountChange, unreadByAccount, canManage,
  folders, activeKey, onNavigate, scheduledCount,
  onCompose, onCreateFolder, onRenameFolder, onDeleteFolder, onDropMessages,
  sync, syncing, onSyncNow, notifyPermission, onEnableNotifications, onShowShortcuts,
  className,
}) {
  const [confirmDelete, setConfirmDelete] = useState(null)
  const [deleting, setDeleting] = useState(false)

  const scopeAccounts = accountId === 'all' ? accounts : accounts.filter(a => a.id === accountId)
  const scopeIds = new Set(scopeAccounts.map(a => a.id))
  const scoped = folders.filter(f => scopeIds.has(f.accountId))

  const sum = (role, field) => scoped.filter(f => f.role === role).reduce((s, f) => s + (Number(f[field]) || 0), 0)
  const counts = { INBOX: sum('INBOX', 'unread'), DRAFTS: sum('DRAFTS', 'total'), SPAM: sum('SPAM', 'unread') }

  const sections = scopeAccounts
    .map(a => ({ account: a, folders: scoped.filter(f => f.accountId === a.id && f.role === 'CUSTOM') }))
    .filter(s => accountId !== 'all' || s.folders.length > 0)

  async function doDelete() {
    setDeleting(true)
    const ok = await onDeleteFolder(confirmDelete)
    setDeleting(false)
    if (ok) setConfirmDelete(null)
  }

  const NotifyIcon = notifyPermission === 'granted' ? BellRing : notifyPermission === 'denied' ? BellOff : Bell
  const notifyLabel = notifyPermission === 'granted' ? 'Notifications on' : notifyPermission === 'denied' ? 'Notifications blocked' : 'Enable notifications'

  return (
    <aside className={cn('flex h-full min-h-0 w-60 shrink-0 flex-col border-r border-gray-200/80 bg-gray-50/40', className)}>
      <div className="shrink-0 space-y-2 px-2 pt-2">
        <AccountSwitcher
          accounts={accounts}
          value={accountId}
          onChange={onAccountChange}
          unreadByAccount={unreadByAccount}
          canManage={canManage}
        />
        <Button className="w-full" onClick={onCompose}>
          <PenSquare />
          Compose
        </Button>
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto px-2 pb-4 pt-3" aria-label="Folders">
        <div className="space-y-px">
          {NAV.map(n => {
            const meta = n.role ? ROLE_META[n.role] : n
            const count = n.role ? counts[n.role] : n.view === 'scheduled' ? scheduledCount : 0
            const dropTarget = n.role && DROP_ROLES.includes(n.role)
              ? { action: { INBOX: 'restore', ARCHIVE: 'archive', SPAM: 'spam', TRASH: 'trash' }[n.role], label: meta.label, role: n.role }
              : n.view === 'starred' ? { action: 'star', label: 'Starred' } : null
            return (
              <NavItem
                key={n.key}
                icon={meta.icon}
                label={meta.label}
                count={count}
                strong={n.role === 'INBOX'}
                active={activeKey === n.key}
                onClick={() => onNavigate(n.role ? { role: n.role } : { view: n.view })}
                dropEnabled={!!dropTarget}
                onDropIds={(ids) => onDropMessages(dropTarget, ids)}
              />
            )
          })}
        </div>

        {sections.map(({ account, folders: list }) => (
          <FolderSection
            key={account.id}
            account={account}
            folders={list}
            activeKey={activeKey}
            onNavigate={onNavigate}
            onCreate={onCreateFolder}
            onRename={onRenameFolder}
            onDelete={setConfirmDelete}
            onDropMessages={onDropMessages}
            title={accountId === 'all' ? (
              <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <AccountDot color={account.color} />
                <span className="truncate">{account.name}</span>
              </span>
            ) : (
              <span className="text-xs font-medium text-muted-foreground">Folders</span>
            )}
          />
        ))}
      </nav>

      <div className="flex shrink-0 items-center gap-0.5 border-t border-gray-200/70 py-1.5 pl-3 pr-1.5">
        <SyncIndicator sync={sync} />
        {notifyPermission && (
          <IconButton size="xs" label={notifyLabel} tipSide="top" onClick={onEnableNotifications} disabled={notifyPermission === 'denied'}>
            <NotifyIcon />
          </IconButton>
        )}
        <IconButton size="xs" label="Keyboard shortcuts" shortcut="?" tipSide="top" onClick={onShowShortcuts}>
          <Keyboard />
        </IconButton>
        <IconButton size="xs" label="Sync now" tipSide="top" onClick={onSyncNow} disabled={syncing}>
          <RefreshCw className={cn(syncing && 'animate-spin')} />
        </IconButton>
      </div>

      <Modal open={!!confirmDelete} onOpenChange={(v) => !v && !deleting && setConfirmDelete(null)} title="Delete folder?" size="sm">
        <p className="text-sm text-gray-600">
          <span className="font-medium text-gray-900">{confirmDelete?.name}</span> and every message in it will be deleted from the server.
        </p>
        <ModalFooter>
          <Button variant="outline" onClick={() => setConfirmDelete(null)} disabled={deleting}>Cancel</Button>
          <Button variant="destructive" onClick={doDelete} loading={deleting}>Delete</Button>
        </ModalFooter>
      </Modal>
    </aside>
  )
}
