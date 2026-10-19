'use client'

import { useState, useRef, useEffect } from 'react'
import { PanelLeft, ChevronsUpDown, ChevronRight, LogOut, UserCircle } from 'lucide-react'
import { signOut } from 'next-auth/react'
import { usePathname } from 'next/navigation'
import Image from 'next/image'
import Link from 'next/link'
import NotificationBell from '@/components/shared/NotificationBell'
import { cn } from '@/lib/utils'

const PAGES = [
  { href: '/freelancer/projects',     label: 'Projects' },
  { href: '/freelancer/verification', label: 'Verification' },
  { href: '/freelancer/account',      label: 'Account' },
  { href: '/freelancer/setup',        label: 'Setup' },
  { href: '/freelancer',              label: 'Dashboard' },
]

const menuItem = 'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-gray-700 outline-none transition-colors hover:bg-gray-100 hover:text-gray-900'

export default function FreelancerHeader({ user, portalType = 'FREELANCER', onMenuClick }) {
  const [profileOpen, setProfileOpen] = useState(false)
  const profileRef = useRef(null)
  const pathname = usePathname()

  useEffect(() => {
    function handleOutside(e) {
      if (profileRef.current && !profileRef.current.contains(e.target)) {
        setProfileOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [])

  const portalLabel = portalType === 'AGENCY' ? 'Agency' : 'Freelancer'
  const page = PAGES.find(p => pathname === p.href || (p.href !== '/freelancer' && pathname?.startsWith(`${p.href}/`)))
  const name = user?.name || portalLabel
  const initials = name.split(' ').filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase() || 'F'

  const avatar = (
    <span className="flex size-8 shrink-0 items-center justify-center overflow-hidden rounded-lg bg-gray-900 text-xs font-semibold text-white">
      {user?.avatar
        ? <Image src={user.avatar} alt="" width={32} height={32} className="size-8 object-cover" />
        : initials}
    </span>
  )

  return (
    <header className="relative z-30 flex h-14 shrink-0 items-center gap-2 border-b border-gray-100 bg-white px-3 sm:px-4">
      {/* Menu – mobile only */}
      <button
        onClick={onMenuClick}
        className="inline-flex size-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 lg:hidden"
        aria-label="Open menu"
      >
        <PanelLeft className="size-4" />
      </button>
      <div className="mx-1 h-4 w-px bg-gray-200 lg:hidden" />

      {/* Breadcrumb */}
      <nav aria-label="Breadcrumb" className="flex min-w-0 items-center gap-1.5 text-sm">
        <span className="truncate text-muted-foreground">{portalLabel}</span>
        {page && (
          <>
            <ChevronRight className="size-3.5 shrink-0 text-gray-300" />
            <span className="truncate font-medium text-gray-900">{page.label}</span>
          </>
        )}
      </nav>

      {/* Right side */}
      <div className="ml-auto flex items-center gap-1.5">
        <NotificationBell />

        {/* Profile dropdown */}
        <div className="relative" ref={profileRef}>
          <button
            onClick={() => setProfileOpen(v => !v)}
            className={cn(
              'flex items-center gap-2 rounded-lg p-1 text-left transition-colors hover:bg-gray-100 sm:pr-2',
              profileOpen && 'bg-gray-100'
            )}
            aria-label="Account menu"
          >
            {avatar}
            <span className="hidden min-w-0 sm:block">
              <span className="block max-w-[160px] truncate text-sm font-medium leading-tight text-gray-900">{user?.name}</span>
              <span className="block text-xs leading-tight text-muted-foreground">{portalLabel}</span>
            </span>
            <ChevronsUpDown className="hidden size-4 text-gray-400 sm:block" />
          </button>

          {profileOpen && (
            <div className="absolute right-0 top-full z-50 mt-2 w-60 rounded-xl border border-gray-200/80 bg-white p-1 shadow-lg animate-in fade-in-0 zoom-in-95 duration-100">
              <div className="flex items-center gap-2.5 px-2 py-2">
                {avatar}
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">{user?.name}</p>
                  <p className="truncate text-xs text-muted-foreground">{user?.email}</p>
                </div>
              </div>
              <div className="-mx-1 my-1 h-px bg-gray-100" />
              <Link
                href="/freelancer/account"
                onClick={() => setProfileOpen(false)}
                className={menuItem}
              >
                <UserCircle className="size-4 text-gray-500" />
                Account
              </Link>
              <div className="-mx-1 my-1 h-px bg-gray-100" />
              <button
                onClick={() => signOut({ callbackUrl: '/login' })}
                className={cn(menuItem, 'text-red-600 hover:bg-red-50 hover:text-red-700')}
              >
                <LogOut className="size-4" />
                Sign out
              </button>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
