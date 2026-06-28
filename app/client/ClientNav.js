'use client'

import { useState, useEffect } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { signOut, useSession } from 'next-auth/react'
import {
  LayoutDashboard, FolderOpen, FileText, Files,
  ChevronDown, LogOut, User, Menu, X, Building2, Check,
} from 'lucide-react'
import NotificationBell from '@/components/shared/NotificationBell'

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
    <div className="relative">
      <button
        onClick={() => setOpen(o => !o)}
        className="flex items-center gap-2 pl-2.5 pr-2 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors max-w-[180px]"
      >
        <Building2 className="w-3.5 h-3.5 text-gray-400 shrink-0" />
        <span className="text-sm font-medium text-gray-700 truncate">{active?.company || active?.clientCode || 'Company'}</span>
        <ChevronDown className="w-3.5 h-3.5 text-gray-400 shrink-0" />
      </button>

      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 mt-2 w-60 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-50 max-h-80 overflow-y-auto">
            <p className="px-3 py-1.5 text-[11px] font-semibold text-gray-400 uppercase tracking-wider">Switch company</p>
            {companies.map(c => (
              <button
                key={c.id}
                onClick={() => switchTo(c.id)}
                disabled={switching}
                className="w-full flex items-center gap-2.5 px-3 py-2 text-left hover:bg-gray-50 transition-colors disabled:opacity-60"
              >
                <div className="w-7 h-7 rounded-lg bg-blue-50 flex items-center justify-center shrink-0">
                  <Building2 className="w-3.5 h-3.5 text-blue-600" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{c.company || c.clientCode || 'Company'}</p>
                  <p className="text-[11px] text-gray-400 truncate">{c.clientCode}{c.role === 'OWNER' ? ' · Owner' : ''}</p>
                </div>
                {c.id === active?.id && <Check className="w-4 h-4 text-blue-600 shrink-0" />}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

const navLinks = [
  { href: '/client',           label: 'Dashboard',   icon: LayoutDashboard, exact: true },
  { href: '/client/projects',  label: 'My Projects', icon: FolderOpen },
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

  return (
    <nav className="bg-white border-b border-gray-100 sticky top-0 z-40 shadow-sm">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Logo + company switcher */}
          <div className="flex items-center gap-3">
            <Image src="/en-logo.png" alt="Enfinito" width={100} height={28} className="h-7 w-auto object-contain" />
            <span className="hidden lg:block text-xs text-gray-400 border-l border-gray-200 pl-3">
              Client Portal
            </span>
            <div className="border-l border-gray-200 pl-3">
              <CompanySwitcher />
            </div>
          </div>

          {/* Desktop Nav */}
          <div className="hidden md:flex items-center gap-1">
            {navLinks.map(({ href, label, icon: Icon, exact }) => (
              <Link
                key={href}
                href={href}
                className={`flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors duration-150 ${
                  isActive(href, exact)
                    ? 'bg-blue-50 text-blue-700'
                    : 'text-gray-600 hover:bg-gray-50 hover:text-gray-900'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </Link>
            ))}
          </div>

          {/* Right: Bell + Profile */}
          <div className="flex items-center gap-2">
            <NotificationBell />

            {/* Profile dropdown */}
            <div className="relative">
              <button
                onClick={() => setProfileOpen(!profileOpen)}
                className="flex items-center gap-2 px-2 py-1.5 rounded-xl hover:bg-gray-50 transition-colors"
              >
                {user.avatar ? (
                  <Image src={user.avatar} alt={user.name} width={32} height={32} className="w-8 h-8 rounded-full object-cover" />
                ) : (
                  <div className="w-8 h-8 rounded-full bg-blue-100 flex items-center justify-center">
                    <span className="text-sm font-semibold text-blue-700">
                      {user.name?.charAt(0).toUpperCase()}
                    </span>
                  </div>
                )}
                <div className="hidden sm:block text-left">
                  <p className="text-sm font-medium text-gray-800 leading-tight">{user.name}</p>
                  <p className="text-xs text-gray-400 leading-tight">Client</p>
                </div>
                <ChevronDown className="w-4 h-4 text-gray-400 hidden sm:block" />
              </button>

              {profileOpen && (
                <div className="absolute right-0 mt-2 w-48 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-50">
                  <Link
                    href="/client/profile"
                    onClick={() => setProfileOpen(false)}
                    className="flex items-center gap-2 px-4 py-2.5 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                  >
                    <User className="w-4 h-4 text-gray-400" />
                    My Profile
                  </Link>
                  <div className="border-t border-gray-100 my-1" />
                  <button
                    onClick={() => signOut({ callbackUrl: '/login' })}
                    className="w-full flex items-center gap-2 px-4 py-2.5 text-sm text-red-600 hover:bg-red-50 transition-colors"
                  >
                    <LogOut className="w-4 h-4" />
                    Sign Out
                  </button>
                </div>
              )}
            </div>

            {/* Mobile menu toggle */}
            <button
              onClick={() => setMobileOpen(!mobileOpen)}
              className="md:hidden p-2 rounded-lg hover:bg-gray-100 transition-colors"
            >
              {mobileOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
            </button>
          </div>
        </div>

        {/* Mobile menu */}
        {mobileOpen && (
          <div className="md:hidden border-t border-gray-100 py-2">
            {navLinks.map(({ href, label, icon: Icon, exact }) => (
              <Link
                key={href}
                href={href}
                onClick={() => setMobileOpen(false)}
                className={`flex items-center gap-3 px-4 py-2.5 text-sm font-medium transition-colors ${
                  isActive(href, exact)
                    ? 'text-blue-700 bg-blue-50'
                    : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                <Icon className="w-4 h-4" />
                {label}
              </Link>
            ))}
          </div>
        )}
      </div>
    </nav>
  )
}
