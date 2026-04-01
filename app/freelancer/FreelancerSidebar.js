'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, FolderOpen, Wallet, LogOut, UserCircle } from 'lucide-react'
import { signOut } from 'next-auth/react'

const NAV = [
  { href: '/freelancer',          label: 'Dashboard',  icon: LayoutDashboard },
  { href: '/freelancer/projects', label: 'My Projects', icon: FolderOpen },
  { href: '/freelancer/wallet',   label: 'Wallet',      icon: Wallet },
  { href: '/freelancer/account',  label: 'My Account',  icon: UserCircle },
]

export default function FreelancerSidebar({ user }) {
  const pathname = usePathname()

  return (
    <aside className="w-56 bg-white border-r border-gray-100 flex flex-col shrink-0">
      {/* Logo */}
      <div className="h-14 flex items-center px-5 border-b border-gray-100">
        <span className="text-base font-bold text-gray-900 tracking-tight">En-Tech</span>
        <span className="ml-2 text-xs text-gray-400 font-medium bg-gray-100 px-1.5 py-0.5 rounded">Freelancer</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 py-4 px-3 space-y-0.5">
        {NAV.map(({ href, label, icon: Icon }) => {
          const active = pathname === href || (href !== '/freelancer' && pathname.startsWith(href))
          return (
            <Link key={href} href={href}
              className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                active
                  ? 'bg-gray-900 text-white font-medium'
                  : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
              }`}>
              <Icon className="w-4 h-4 shrink-0" />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="p-3 border-t border-gray-100">
        <button
          onClick={() => signOut({ callbackUrl: '/login' })}
          className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
        >
          <LogOut className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </aside>
  )
}
