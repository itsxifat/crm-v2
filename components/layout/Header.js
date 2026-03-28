'use client'

import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useState, useRef, useEffect } from 'react'
import Link from 'next/link'
import {
  Bell,
  Search,
  LogOut,
  User,
  Settings,
  ChevronDown,
} from 'lucide-react'
import Image from 'next/image'
import { cn, getInitials, getRoleLabel } from '@/lib/utils'

export default function Header() {
  const { data: session } = useSession()
  const router            = useRouter()
  const [profileOpen, setProfileOpen] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const profileRef = useRef(null)

  // Close profile dropdown on outside click
  useEffect(() => {
    function handleOutside(e) {
      if (profileRef.current && !profileRef.current.contains(e.target)) {
        setProfileOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [])

  async function handleSignOut() {
    await signOut({ redirect: false })
    router.push('/login')
  }

  const user = session?.user

  return (
    <header className="h-16 bg-white border-b border-gray-200 flex items-center justify-between px-6 shrink-0 z-30">
      {/* Left – Search */}
      <div className="flex-1 max-w-md">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
          <input
            type="search"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search anything…"
            className="w-full pl-9 pr-4 py-2 text-sm bg-gray-100 border border-transparent rounded-lg focus:outline-none focus:bg-white focus:border-primary focus:ring-1 focus:ring-primary transition-colors placeholder-gray-400"
          />
        </div>
      </div>

      {/* Right – Notifications + Profile */}
      <div className="flex items-center gap-2 ml-4">
        {/* Notifications */}
        <Link
          href="/admin/notifications"
          className="relative p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
        >
          <Bell className="w-5 h-5" />
          <span className="absolute top-1.5 right-1.5 w-2 h-2 bg-red-500 rounded-full border-2 border-white" />
        </Link>

        {/* Profile Dropdown */}
        <div className="relative" ref={profileRef}>
          <button
            onClick={() => setProfileOpen((v) => !v)}
            className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
            {/* Avatar */}
            <div className="w-8 h-8 rounded-full bg-primary flex-center text-white text-sm font-semibold shrink-0">
              {user?.avatar ? (
                <Image src={user.avatar} alt={user.name} width={32} height={32} className="w-8 h-8 rounded-full object-cover" />
              ) : (
                getInitials(user?.name ?? 'U')
              )}
            </div>
            <div className="hidden md:block text-left">
              <p className="text-sm font-medium text-gray-900 leading-tight">{user?.name ?? '—'}</p>
              <p className="text-xs text-gray-500 leading-tight">{getRoleLabel(user?.role)}</p>
            </div>
            <ChevronDown
              className={cn(
                'w-4 h-4 text-gray-400 hidden md:block transition-transform duration-200',
                profileOpen && 'rotate-180'
              )}
            />
          </button>

          {/* Dropdown */}
          {profileOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-56 bg-white rounded-xl border border-gray-200 shadow-lg py-1 z-50 animate-fade-in">
              <div className="px-4 py-3 border-b border-gray-100">
                <p className="text-sm font-semibold text-gray-900">{user?.name}</p>
                <p className="text-xs text-gray-500 mt-0.5">{user?.email}</p>
                <span className="inline-block mt-1.5 text-2xs font-medium px-2 py-0.5 rounded-full bg-primary/10 text-primary">
                  {getRoleLabel(user?.role)}
                </span>
              </div>

              <div className="py-1">
                <Link
                  href="/profile"
                  onClick={() => setProfileOpen(false)}
                  className="flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <User className="w-4 h-4 text-gray-400" />
                  My Profile
                </Link>
                <Link
                  href="/settings"
                  onClick={() => setProfileOpen(false)}
                  className="flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <Settings className="w-4 h-4 text-gray-400" />
                  Settings
                </Link>
              </div>

              <div className="border-t border-gray-100 py-1">
                <button
                  onClick={handleSignOut}
                  className="w-full flex items-center gap-2.5 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                >
                  <LogOut className="w-4 h-4" />
                  Sign out
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  )
}
