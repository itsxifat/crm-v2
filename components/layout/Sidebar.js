'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname, useSearchParams, useRouter } from 'next/navigation'
import { useSession, signOut } from 'next-auth/react'
import { useState, useEffect, Suspense } from 'react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import * as Tooltip from '@radix-ui/react-tooltip'
import { ChevronRight, ChevronsUpDown, LogOut, Settings2, X } from 'lucide-react'
import { cn, getRoleLabel } from '@/lib/utils'
import { canDo } from '@/lib/rbac'
import { ACCOUNT_NAV, canSee, isItemActive, visibleNav } from './nav'

const GROUPS_KEY = 'sidebar:groups'

const menuContent = 'z-[70] min-w-[220px] rounded-xl border border-gray-200/80 bg-white p-1 shadow-lg animate-in fade-in-0 zoom-in-95 duration-100'
const menuItem    = 'flex w-full cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-700 outline-none transition-colors data-[highlighted]:bg-gray-100 data-[highlighted]:text-gray-900'

// ─── Pieces ───────────────────────────────────────────────────────────────────

function Tip({ label, enabled, children }) {
  if (!enabled) return children
  return (
    <Tooltip.Root delayDuration={0}>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content side="right" sideOffset={10}
          className="z-[70] rounded-md bg-gray-900 px-2 py-1 text-xs font-medium text-white shadow-md animate-in fade-in-0 zoom-in-95 duration-100">
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  )
}

const itemBase = 'group/item flex items-center gap-2.5 rounded-lg text-sm transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
const itemIdle = 'text-gray-600 hover:bg-sidebar-accent hover:text-gray-900'
const itemOn   = 'bg-white font-medium text-gray-900 shadow-sm ring-1 ring-gray-200/70'

function NavLink({ item, active, collapsed, onNavigate }) {
  const Icon = item.icon
  return (
    <Tip label={item.label} enabled={collapsed}>
      <Link
        href={item.href}
        onClick={onNavigate}
        aria-current={active ? 'page' : undefined}
        className={cn(itemBase, 'h-8', collapsed ? 'w-8 justify-center' : 'px-2', active ? itemOn : itemIdle)}
      >
        <Icon className={cn('size-4 shrink-0', active ? 'text-gray-900' : 'text-gray-500 group-hover/item:text-gray-900')} />
        {!collapsed && <span className="truncate">{item.label}</span>}
      </Link>
    </Tip>
  )
}

function NavGroup({ group, open, onToggle, collapsed, pathname, searchParams, onNavigate }) {
  const Icon = group.icon
  const activeChild = group.items.find(i => isItemActive(i, pathname, searchParams))

  // Icon rail: the group opens as a flyout menu.
  if (collapsed) {
    return (
      <DropdownMenu.Root modal={false}>
        <Tip label={group.label} enabled>
          <DropdownMenu.Trigger
            className={cn(itemBase, 'h-8 w-8 justify-center', activeChild ? itemOn : itemIdle)}
            aria-label={group.label}
          >
            <Icon className={cn('size-4', activeChild ? 'text-gray-900' : 'text-gray-500 group-hover/item:text-gray-900')} />
          </DropdownMenu.Trigger>
        </Tip>
        <DropdownMenu.Portal>
          <DropdownMenu.Content side="right" align="start" sideOffset={10} className={menuContent}>
            <DropdownMenu.Label className="px-2 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">{group.label}</DropdownMenu.Label>
            {group.items.map(item => {
              const active = item === activeChild
              return (
                <DropdownMenu.Item key={item.href} asChild>
                  <Link href={item.href} className={cn(menuItem, active && 'bg-gray-100 font-medium text-gray-900')}>
                    <item.icon className="size-4 text-gray-500" />
                    {item.label}
                  </Link>
                </DropdownMenu.Item>
              )
            })}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    )
  }

  return (
    <div>
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className={cn(itemBase, 'h-8 w-full px-2', itemIdle, activeChild && !open && 'text-gray-900')}
      >
        <Icon className={cn('size-4 shrink-0', activeChild ? 'text-gray-900' : 'text-gray-500 group-hover/item:text-gray-900')} />
        <span className={cn('flex-1 truncate text-left', activeChild && 'font-medium')}>{group.label}</span>
        <ChevronRight className={cn('size-3.5 shrink-0 text-gray-400 transition-transform duration-200', open && 'rotate-90')} />
      </button>

      <div className={cn('grid transition-[grid-template-rows,opacity] duration-200 ease-out', open ? 'grid-rows-[1fr] opacity-100' : 'grid-rows-[0fr] opacity-0')}>
        <ul className="ml-[17px] min-h-0 space-y-px overflow-hidden border-l border-gray-200 pl-2">
          {group.items.map((item, i) => {
            const active = item === activeChild
            return (
              <li key={item.href} className={cn(i === 0 && 'pt-0.5', i === group.items.length - 1 && 'pb-1')}>
                <Link
                  href={item.href}
                  onClick={onNavigate}
                  tabIndex={open ? undefined : -1}
                  aria-current={active ? 'page' : undefined}
                  className={cn(itemBase, 'h-7 px-2 text-[13px]', active ? itemOn : itemIdle)}
                >
                  <span className="truncate">{item.label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </div>
    </div>
  )
}

function UserMenu({ session, collapsed, onNavigate }) {
  const router = useRouter()
  const user = session?.user
  const name = user?.name || 'User'
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || 'U'
  const links = ACCOUNT_NAV.filter(i => canSee(i, session))

  async function handleSignOut() {
    await signOut({ redirect: false })
    router.push('/login')
  }

  const avatar = (
    <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-900 text-xs font-semibold text-white">
      {user?.avatar
        ? <Image src={user.avatar} alt={name} width={32} height={32} className="size-8 object-cover" />
        : initials}
    </span>
  )

  return (
    <DropdownMenu.Root modal={false}>
      <DropdownMenu.Trigger
        className={cn(
          'flex w-full items-center gap-2.5 rounded-lg text-left outline-none transition-colors hover:bg-sidebar-accent focus-visible:ring-2 focus-visible:ring-ring/50 data-[state=open]:bg-sidebar-accent',
          collapsed ? 'justify-center p-0' : 'p-1.5'
        )}
        aria-label="Account menu"
      >
        {avatar}
        {!collapsed && (
          <>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium text-gray-900">{name}</span>
              <span className="block truncate text-xs text-muted-foreground">{getRoleLabel(user?.role)}</span>
            </span>
            <ChevronsUpDown className="size-4 shrink-0 text-gray-400" />
          </>
        )}
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content side={collapsed ? 'right' : 'top'} align={collapsed ? 'end' : 'start'} sideOffset={8}
          className={cn(menuContent, 'w-[--radix-dropdown-menu-trigger-width] min-w-[232px]')}>
          <div className="flex items-center gap-2.5 px-2 py-2">
            {avatar}
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-gray-900">{name}</p>
              <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
            </div>
          </div>
          <DropdownMenu.Separator className="-mx-1 my-1 h-px bg-gray-100" />
          {links.map(item => (
            <DropdownMenu.Item key={item.href} asChild>
              <Link href={item.href} onClick={onNavigate} className={menuItem}>
                <item.icon className="size-4 text-gray-500" />
                {item.label}
              </Link>
            </DropdownMenu.Item>
          ))}
          {canDo(session, 'system.config.view') && (
            <DropdownMenu.Item asChild>
              <Link href="/admin/config" onClick={onNavigate} className={menuItem}>
                <Settings2 className="size-4 text-gray-500" />
                Settings
              </Link>
            </DropdownMenu.Item>
          )}
          <DropdownMenu.Separator className="-mx-1 my-1 h-px bg-gray-100" />
          <DropdownMenu.Item onSelect={handleSignOut} className={cn(menuItem, 'text-red-600 data-[highlighted]:bg-red-50 data-[highlighted]:text-red-700')}>
            <LogOut className="size-4" />
            Sign out
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  )
}

// ─── Sidebar body ─────────────────────────────────────────────────────────────

function SidebarBody({ collapsed, isMobile, onClose }) {
  const pathname     = usePathname()
  const searchParams = useSearchParams()
  const { data: session, status } = useSession()
  const nav = visibleNav(session)

  // Which groups are expanded: remembered per browser; the active one always opens.
  const [openGroups, setOpenGroups] = useState({})
  useEffect(() => {
    try { setOpenGroups(JSON.parse(localStorage.getItem(GROUPS_KEY) || '{}')) } catch {}
  }, [])
  const activeGroup = nav.find(g => g.items?.some(i => isItemActive(i, pathname, searchParams)))?.label
  useEffect(() => {
    if (activeGroup) setOpenGroups(prev => (prev[activeGroup] ? prev : { ...prev, [activeGroup]: true }))
  }, [activeGroup])
  function toggleGroup(label) {
    setOpenGroups(prev => {
      const next = { ...prev, [label]: !prev[label] }
      try { localStorage.setItem(GROUPS_KEY, JSON.stringify(next)) } catch {}
      return next
    })
  }

  const onNavigate = isMobile ? onClose : undefined

  return (
    <>
      {/* Brand */}
      <div className={cn('flex h-14 shrink-0 items-center', collapsed ? 'justify-center' : 'justify-between px-4')}>
        <Link href="/admin" onClick={onNavigate} className="flex items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
          {collapsed ? (
            <Image src="/en-icon.png" alt="Enfinito" width={28} height={28} className="size-7 object-contain" />
          ) : (
            <Image src="/en-logo.png" alt="Enfinito" width={112} height={26} className="h-[22px] w-auto object-contain" priority />
          )}
        </Link>
        {isMobile && (
          <button onClick={onClose} className="inline-flex size-8 items-center justify-center rounded-lg text-gray-500 hover:bg-sidebar-accent hover:text-gray-900" aria-label="Close menu">
            <X className="size-4" />
          </button>
        )}
      </div>

      {/* Navigation */}
      <nav className={cn('flex-1 overflow-y-auto overflow-x-hidden pb-4 pt-1', collapsed ? 'px-3' : 'px-3')}>
        {status === 'loading' ? (
          <div className="space-y-1.5">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className={cn('h-8 animate-pulse rounded-lg bg-gray-200/60', collapsed && 'w-8')} />
            ))}
          </div>
        ) : !session?.user?.role ? (
          !collapsed && (
            <div className="px-2 py-6 text-center">
              <p className="text-xs text-muted-foreground">Couldn&apos;t load your session.</p>
              <button onClick={() => window.location.reload()} className="mt-3 rounded-lg border border-gray-200 bg-white px-3 py-1.5 text-xs font-medium text-gray-900 shadow-xs hover:bg-gray-50">
                Reload
              </button>
            </div>
          )
        ) : (
          <ul className={cn('space-y-0.5', collapsed && 'flex flex-col items-center')}>
            {nav.map(entry => (
              <li key={entry.label}>
                {entry.items ? (
                  <NavGroup
                    group={entry}
                    open={!!openGroups[entry.label]}
                    onToggle={() => toggleGroup(entry.label)}
                    collapsed={collapsed}
                    pathname={pathname}
                    searchParams={searchParams}
                    onNavigate={onNavigate}
                  />
                ) : (
                  <NavLink item={entry} active={isItemActive(entry, pathname, searchParams)} collapsed={collapsed} onNavigate={onNavigate} />
                )}
              </li>
            ))}
          </ul>
        )}
      </nav>

      {/* User */}
      {session?.user && (
        <div className={cn('shrink-0 p-3', collapsed && 'flex justify-center')}>
          <UserMenu session={session} collapsed={collapsed} onNavigate={onNavigate} />
        </div>
      )}
    </>
  )
}

// ─── Sidebar ──────────────────────────────────────────────────────────────────

export default function Sidebar({ collapsed = false, mobileOpen = false, onMobileClose }) {
  return (
    <Tooltip.Provider>
      <Suspense fallback={null}>
        {/* Desktop */}
        <aside
          className={cn(
            'hidden h-screen shrink-0 flex-col bg-sidebar transition-[width] duration-200 ease-out lg:flex',
            collapsed ? 'w-14' : 'w-64'
          )}
        >
          <SidebarBody collapsed={collapsed} isMobile={false} />
        </aside>

        {/* Mobile drawer */}
        <aside
          className={cn(
            'fixed inset-y-0 left-0 z-40 flex w-72 flex-col bg-sidebar shadow-xl transition-transform duration-300 ease-out lg:hidden',
            mobileOpen ? 'translate-x-0' : '-translate-x-full'
          )}
          aria-hidden={!mobileOpen}
        >
          <SidebarBody collapsed={false} isMobile onClose={onMobileClose} />
        </aside>
      </Suspense>
    </Tooltip.Provider>
  )
}
