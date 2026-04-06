'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { LayoutDashboard, FolderOpen, Wallet, LogOut, UserCircle, Send, X } from 'lucide-react'
import { signOut } from 'next-auth/react'
import { useState, useEffect } from 'react'

const NAV = [
  { href: '/freelancer',                   label: 'Dashboard',        icon: LayoutDashboard },
  { href: '/freelancer/projects',          label: 'My Projects',      icon: FolderOpen },
  { href: '/freelancer/wallet',            label: 'Wallet',           icon: Wallet },
  { href: '/freelancer/payment-requests',  label: 'Payment Requests', icon: Send, badge: 'paymentRequests' },
  { href: '/freelancer/account',           label: 'My Account',       icon: UserCircle },
]

export default function FreelancerSidebar({ user, portalType = 'FREELANCER', isOpen = false, onClose }) {
  const pathname = usePathname()
  const [pendingCount, setPendingCount] = useState(0)

  useEffect(() => {
    fetch('/api/freelancer/withdrawals')
      .then(r => r.json())
      .then(json => {
        const pending = (json.data ?? []).filter(r => r.status === 'PENDING').length
        setPendingCount(pending)
      })
      .catch(() => {})
  }, [pathname])

  const badges = { paymentRequests: pendingCount }

  return (
    <>
      {/* Mobile backdrop */}
      {isOpen && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm lg:hidden"
          onClick={onClose}
        />
      )}

      {/* Sidebar */}
      <aside
        className={`
          fixed inset-y-0 left-0 z-50 w-64 bg-white border-r border-gray-100 flex flex-col shrink-0
          transition-transform duration-300 ease-in-out
          lg:static lg:translate-x-0 lg:w-56 lg:z-auto
          ${isOpen ? 'translate-x-0' : '-translate-x-full'}
        `}
      >
        {/* Logo */}
        <div className="h-14 flex items-center justify-between px-5 border-b border-gray-100 shrink-0">
          <div className="flex items-center gap-2">
            <span className="text-base font-bold text-gray-900 tracking-tight">En-Tech</span>
            <span className="text-xs text-gray-400 font-medium bg-gray-100 px-1.5 py-0.5 rounded">
              {portalType === 'AGENCY' ? 'Agency' : 'Freelancer'}
            </span>
          </div>
          {/* Close button – mobile only */}
          <button
            onClick={onClose}
            className="lg:hidden p-1.5 rounded-lg text-gray-400 hover:bg-gray-100 hover:text-gray-600 transition-colors"
            aria-label="Close menu"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 py-4 px-3 space-y-0.5 overflow-y-auto">
          {NAV.map(({ href, label, icon: Icon, badge }) => {
            const active = pathname === href || (href !== '/freelancer' && pathname.startsWith(href))
            const count = badge ? badges[badge] : 0
            return (
              <Link
                key={href}
                href={href}
                onClick={onClose}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                  active
                    ? 'bg-gray-900 text-white font-medium'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                <Icon className="w-4 h-4 shrink-0" />
                <span className="flex-1">{label}</span>
                {count > 0 && (
                  <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full leading-none ${
                    active ? 'bg-white/20 text-white' : 'bg-yellow-100 text-yellow-700'
                  }`}>
                    {String(count).padStart(2, '0')}
                  </span>
                )}
              </Link>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="p-3 border-t border-gray-100 shrink-0">
          <button
            onClick={() => signOut({ callbackUrl: '/login' })}
            className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-gray-500 hover:bg-gray-50 hover:text-gray-700 transition-colors"
          >
            <LogOut className="w-4 h-4" />
            Sign out
          </button>
        </div>
      </aside>
    </>
  )
}
