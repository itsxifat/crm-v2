'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut, useSession } from 'next-auth/react'
import * as DropdownMenu from '@radix-ui/react-dropdown-menu'
import {
  LayoutDashboard, FolderOpen, FileText, Files,
  ChevronDown, ChevronsUpDown, LogOut, User, Menu, X, Building2, Check, Loader2,
} from 'lucide-react'
import NotificationBell from '@/components/shared/NotificationBell'
import { cn } from '@/lib/utils'

const menuContent = 'z-[70] min-w-[220px] rounded-xl border border-gray-200/80 bg-white p-1 shadow-lg animate-in fade-in-0 zoom-in-95 duration-100'
const menuItem    = 'flex w-full cursor-pointer select-none items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-700 outline-none transition-colors data-[highlighted]:bg-gray-100 data-[highlighted]:text-gray-900 data-[disabled]:pointer-events-none data-[disabled]:opacity-60'

// ─── Company switcher ───────────────────────────────────────────────────────────
// Shown only when the signed-in person belongs to more than one company.
function CompanySwitcher() {
  const { update } = useSession()
  const [companies, setCompanies] = useState([])
  const [activeId, setActiveId]   = useState(null)
  const [open, setOpen]           = useState(false)
  const [switching, setSwitching] = useState(false)

  useEffect(() => {
    fetch('/api/client/companies')
      .then(r => r.json())
      .then(d => { setCompanies(d.companies ?? []); setActiveId(d.activeClientId ?? null) })
      .catch(() => {})
  }, [])

  if (companies.length < 2) return null
  const active = companies.find(c => c.id === activeId) ?? companies[0]

  async function switchTo(id) {
    if (id === activeId || switching) { setOpen(false); return }
    setSwitching(true)
    try {
      await update({ activeClientId: id })
      // Hard navigation so every panel re-fetches for the new active company.
      window.location.href = '/client'
    } catch {
      setSwitching(false)
      setOpen(false)
    }
  }

  return (
    <div className="flex min-w-0 items-center gap-3">
      <span className="hidden h-5 w-px bg-gray-200 sm:block" />
      <DropdownMenu.Root open={open} onOpenChange={setOpen} modal={false}>
        <DropdownMenu.Trigger
          className="inline-flex h-8 min-w-0 max-w-[150px] items-center gap-2 rounded-lg px-2 text-sm font-medium text-gray-900 outline-none transition-colors hover:bg-gray-100 focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:bg-gray-100 sm:max-w-[220px]"
        >
          {switching
            ? <Loader2 className="size-4 shrink-0 animate-spin text-gray-400" />
            : <Building2 className="size-4 shrink-0 text-gray-500" />}
          <span className="truncate">{active?.company || active?.clientCode || 'Company'}</span>
          <ChevronsUpDown className="size-3.5 shrink-0 text-gray-400" />
        </DropdownMenu.Trigger>
        <DropdownMenu.Portal>
          <DropdownMenu.Content align="start" sideOffset={8} className={cn(menuContent, 'max-h-80 w-64 overflow-y-auto')}>
            <DropdownMenu.Label className="px-2 pb-1 pt-1.5 text-xs font-medium text-muted-foreground">Switch company</DropdownMenu.Label>
            {companies.map(c => (
              <DropdownMenu.Item
                key={c.id}
                disabled={switching}
                onSelect={(e) => { e.preventDefault(); switchTo(c.id) }}
                className={cn(menuItem, 'gap-2.5')}
              >
                <span className="flex size-7 shrink-0 items-center justify-center rounded-md border border-gray-200/80 bg-white shadow-xs">
                  <Building2 className="size-3.5 text-gray-500" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium text-gray-900">{c.company || c.clientCode || 'Company'}</span>
                  <span className="block truncate text-xs text-muted-foreground">{c.clientCode}{c.role === 'OWNER' ? ' · Owner' : ''}</span>
                </span>
                {c.id === active?.id && <Check className="size-4 shrink-0 text-gray-900" />}
              </DropdownMenu.Item>
            ))}
          </DropdownMenu.Content>
        </DropdownMenu.Portal>
      </DropdownMenu.Root>
    </div>
  )
}

const navLinks = [
  { href: '/client',           label: 'Dashboard',   icon: LayoutDashboard, exact: true },
  { href: '/client/projects',  label: 'Projects',    icon: FolderOpen },
  { href: '/client/invoices',  label: 'Invoices',    icon: FileText },
  // { href: '/client/documents', label: 'Documents',   icon: Files }, // temporarily disabled
]

export default function ClientNav({ user }) {
  const pathname = usePathname()
  const [profileOpen, setProfileOpen] = useState(false)
  const [mobileOpen, setMobileOpen] = useState(false)

  const isActive = (href, exact) => {
    if (exact) return pathname === href
    return pathname.startsWith(href)
  }

  const initial = user.name?.charAt(0).toUpperCase()
  const avatar = user.avatar ? (
    <Image src={user.avatar} alt={user.name} width={32} height={32} className="size-8 shrink-0 rounded-full object-cover ring-1 ring-black/5" />
  ) : (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-gray-900 text-xs font-semibold text-white">
      {initial}
    </span>
  )

  return (
    <header className="sticky top-0 z-40 border-b border-gray-200/80 bg-white">
      <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-3 px-4 sm:px-6">
        {/* Logo + company switcher */}
        <div className="flex min-w-0 items-center gap-3">
          <Link href="/client" className="flex shrink-0 items-center rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
            <Image src="/en-logo.png" alt="Enfinito" width={112} height={26} className="h-[22px] w-auto object-contain" priority />
          </Link>
          <CompanySwitcher />
        </div>

        {/* Desktop nav */}
        <nav className="ml-3 hidden items-center gap-1 md:flex">
          {navLinks.map(({ href, label, exact }) => {
            const active = isActive(href, exact)
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'inline-flex h-8 items-center rounded-md px-3 text-sm transition-colors',
                  active
                    ? 'bg-gray-100 font-medium text-gray-900'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                )}
              >
                {label}
              </Link>
            )
          })}
        </nav>

        {/* Right: bell + profile */}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          <NotificationBell />

          <DropdownMenu.Root open={profileOpen} onOpenChange={setProfileOpen} modal={false}>
            <DropdownMenu.Trigger
              className="flex items-center gap-2 rounded-lg p-1 outline-none transition-colors hover:bg-gray-100 focus-visible:ring-[3px] focus-visible:ring-ring/50 data-[state=open]:bg-gray-100 sm:pr-2"
              aria-label="Account menu"
            >
              {avatar}
              <span className="hidden max-w-[140px] truncate text-sm font-medium text-gray-900 sm:block">{user.name}</span>
              <ChevronDown className="hidden size-4 text-gray-400 sm:block" />
            </DropdownMenu.Trigger>
            <DropdownMenu.Portal>
              <DropdownMenu.Content align="end" sideOffset={8} className={cn(menuContent, 'w-60')}>
                <div className="flex items-center gap-2.5 px-2 py-2">
                  {avatar}
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-gray-900">{user.name}</p>
                    <p className="truncate text-xs text-muted-foreground">{user.email || 'Client'}</p>
                  </div>
                </div>
                <DropdownMenu.Separator className="-mx-1 my-1 h-px bg-gray-100" />
                <DropdownMenu.Item asChild>
                  <Link href="/client/profile" onClick={() => setProfileOpen(false)} className={menuItem}>
                    <User className="size-4 text-gray-500" />
                    Profile
                  </Link>
                </DropdownMenu.Item>
                <DropdownMenu.Separator className="-mx-1 my-1 h-px bg-gray-100" />
                <DropdownMenu.Item
                  onSelect={() => signOut({ callbackUrl: '/login' })}
                  className={cn(menuItem, 'text-red-600 data-[highlighted]:bg-red-50 data-[highlighted]:text-red-700')}
                >
                  <LogOut className="size-4" />
                  Sign out
                </DropdownMenu.Item>
              </DropdownMenu.Content>
            </DropdownMenu.Portal>
          </DropdownMenu.Root>

          {/* Mobile menu toggle */}
          <button
            onClick={() => setMobileOpen(!mobileOpen)}
            className="inline-flex size-9 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 md:hidden"
            aria-label={mobileOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={mobileOpen}
          >
            {mobileOpen ? <X className="size-4" /> : <Menu className="size-4" />}
          </button>
        </div>
      </div>

      {/* Mobile menu */}
      {mobileOpen && (
        <nav className="border-t border-gray-100 md:hidden">
          <div className="mx-auto max-w-6xl space-y-0.5 px-3 py-2">
            {navLinks.map(({ href, label, icon: Icon, exact }) => {
              const active = isActive(href, exact)
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setMobileOpen(false)}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex h-9 items-center gap-2.5 rounded-md px-3 text-sm transition-colors',
                    active
                      ? 'bg-gray-100 font-medium text-gray-900'
                      : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                  )}
                >
                  <Icon className={cn('size-4', active ? 'text-gray-900' : 'text-gray-500')} />
                  {label}
                </Link>
              )
            })}
          </div>
        </nav>
      )}
    </header>
  )
}
