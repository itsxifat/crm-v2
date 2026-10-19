'use client'

import { useState } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, LogOut, PanelLeft, UserCircle, X } from 'lucide-react'
import { signOut } from 'next-auth/react'
import { cn } from '@/lib/utils'

const NAV = [
  { href: '/vendor',         label: 'Dashboard', icon: LayoutDashboard },
  { href: '/vendor/account', label: 'Account',   icon: UserCircle },
]

const itemBase = 'group/item flex h-8 items-center gap-2.5 rounded-lg px-2 text-sm transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
const itemIdle = 'text-gray-600 hover:bg-sidebar-accent hover:text-gray-900'
const itemOn   = 'bg-white font-medium text-gray-900 shadow-sm ring-1 ring-gray-200/70'

function SidebarBody({ onNavigate, onClose }) {
  const pathname = usePathname()

  return (
    <>
      <div className="flex h-14 shrink-0 items-center justify-between px-4">
        <Link href="/vendor" onClick={onNavigate} className="flex items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
          <Image src="/en-logo.png" alt="Enfinito" width={112} height={26} className="h-[22px] w-auto object-contain" priority />
          <span className="rounded-md border border-gray-200/80 bg-white px-1.5 py-px text-[11px] font-medium text-gray-600">Vendor</span>
        </Link>
        {onClose && (
          <button
            onClick={onClose}
            className="inline-flex size-8 items-center justify-center rounded-lg text-gray-500 hover:bg-sidebar-accent hover:text-gray-900"
            aria-label="Close menu"
          >
            <X className="size-4" />
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 pb-4 pt-1">
        <ul className="space-y-0.5">
          {NAV.map(({ href, label, icon: Icon }) => {
            const active = pathname === href
            return (
              <li key={href}>
                <Link
                  href={href}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={cn(itemBase, active ? itemOn : itemIdle)}
                >
                  <Icon className={cn('size-4 shrink-0', active ? 'text-gray-900' : 'text-gray-500 group-hover/item:text-gray-900')} />
                  <span className="truncate">{label}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      </nav>

      <div className="shrink-0 p-3">
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          className={cn(itemBase, itemIdle, 'w-full')}
        >
          <LogOut className="size-4 shrink-0 text-gray-500 group-hover/item:text-gray-900" />
          Sign out
        </button>
      </div>
    </>
  )
}

/** Desktop sidebar (lg and up). */
export default function VendorSidebar({ user }) {
  return (
    <aside className="hidden h-screen w-64 shrink-0 flex-col bg-sidebar lg:flex">
      <SidebarBody />
    </aside>
  )
}

/** Mobile menu button + slide-in drawer (below lg). */
export function VendorMobileNav() {
  const [open, setOpen] = useState(false)
  const close = () => setOpen(false)

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex size-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 lg:hidden"
        aria-label="Open menu"
      >
        <PanelLeft className="size-4" />
      </button>

      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px] transition-opacity lg:hidden',
          open ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
        onClick={close}
      />
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-72 flex-col bg-sidebar shadow-xl transition-transform duration-300 ease-out lg:hidden',
          open ? 'translate-x-0' : '-translate-x-full'
        )}
        aria-hidden={!open}
      >
        <SidebarBody onNavigate={close} onClose={close} />
      </aside>
    </>
  )
}
