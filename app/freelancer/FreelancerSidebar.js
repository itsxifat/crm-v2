'use client'

import Link from 'next/link'
import Image from 'next/image'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, FolderOpen, LogOut, UserCircle, ShieldCheck, X } from 'lucide-react'
import { signOut } from 'next-auth/react'
import { cn } from '@/lib/utils'

const NAV = [
  { href: '/freelancer',                   label: 'Dashboard',        icon: LayoutDashboard },
  { href: '/freelancer/projects',          label: 'Projects',         icon: FolderOpen },
  { href: '/freelancer/verification',      label: 'Verification',     icon: ShieldCheck },
  { href: '/freelancer/account',           label: 'Account',          icon: UserCircle },
]

const itemBase = 'group/item flex h-8 items-center gap-2.5 rounded-lg px-2 text-sm transition-colors duration-150 outline-none focus-visible:ring-2 focus-visible:ring-ring/50'
const itemIdle = 'text-gray-600 hover:bg-sidebar-accent hover:text-gray-900'
const itemOn   = 'bg-white font-medium text-gray-900 shadow-sm ring-1 ring-gray-200/70'

export default function FreelancerSidebar({ user, portalType = 'FREELANCER', isOpen = false, onClose }) {
  const pathname = usePathname()
  const badges = {}

  return (
    <>
      {/* Mobile backdrop */}
      <div
        className={cn(
          'fixed inset-0 z-40 bg-black/30 backdrop-blur-[2px] transition-opacity lg:hidden',
          isOpen ? 'opacity-100' : 'pointer-events-none opacity-0'
        )}
        onClick={onClose}
      />

      {/* Sidebar */}
      <aside
        className={cn(
          'fixed inset-y-0 left-0 z-50 flex w-72 shrink-0 flex-col bg-sidebar shadow-xl transition-transform duration-300 ease-out',
          'lg:static lg:z-auto lg:h-screen lg:w-64 lg:translate-x-0 lg:shadow-none',
          isOpen ? 'translate-x-0' : '-translate-x-full'
        )}
      >
        {/* Brand */}
        <div className="flex h-14 shrink-0 items-center justify-between px-4">
          <Link href="/freelancer" onClick={onClose} className="flex items-center gap-2 rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
            <Image src="/en-logo.png" alt="Enfinito" width={112} height={26} className="h-[22px] w-auto object-contain" priority />
            <span className="rounded-md border border-gray-200/80 bg-white px-1.5 py-px text-[11px] font-medium text-gray-600">
              {portalType === 'AGENCY' ? 'Agency' : 'Freelancer'}
            </span>
          </Link>
          {/* Close button – mobile only */}
          <button
            onClick={onClose}
            className="inline-flex size-8 items-center justify-center rounded-lg text-gray-500 hover:bg-sidebar-accent hover:text-gray-900 lg:hidden"
            aria-label="Close menu"
          >
            <X className="size-4" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto px-3 pb-4 pt-1">
          <ul className="space-y-0.5">
            {NAV.map(({ href, label, icon: Icon, badge }) => {
              const active = pathname === href || (href !== '/freelancer' && pathname.startsWith(href))
              const count = badge ? badges[badge] : 0
              return (
                <li key={href}>
                  <Link
                    href={href}
                    onClick={onClose}
                    aria-current={active ? 'page' : undefined}
                    className={cn(itemBase, active ? itemOn : itemIdle)}
                  >
                    <Icon className={cn('size-4 shrink-0', active ? 'text-gray-900' : 'text-gray-500 group-hover/item:text-gray-900')} />
                    <span className="flex-1 truncate">{label}</span>
                    {count > 0 && (
                      <span className="min-w-[18px] rounded-full bg-gray-200/80 px-1.5 text-center text-[11px] font-medium leading-[18px] text-gray-700 tabular-nums">
                        {String(count).padStart(2, '0')}
                      </span>
                    )}
                  </Link>
                </li>
              )
            })}
          </ul>
        </nav>

        {/* Footer */}
        <div className="shrink-0 p-3">
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className={cn(itemBase, itemIdle, 'w-full')}
          >
            <LogOut className="size-4 shrink-0 text-gray-500 group-hover/item:text-gray-900" />
            Sign out
          </button>
        </div>
      </aside>
    </>
  )
}
