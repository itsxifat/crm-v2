'use client'

import { useSession, signOut } from 'next-auth/react'
import { useRouter } from 'next/navigation'
import { useState, useRef, useEffect, useCallback } from 'react'
import Link from 'next/link'
import {
  Bell, Search, LogOut, User, Settings, ChevronDown,
  CheckCheck, Loader2, Menu,
} from 'lucide-react'
import Image from 'next/image'
import { cn, getInitials, getRoleLabel } from '@/lib/utils'

const TYPE_STYLES = {
  TASK:      'bg-purple-100 text-purple-700',
  INVOICE:   'bg-blue-100 text-blue-700',
  PAYMENT:   'bg-green-100 text-green-700',
  QUOTATION: 'bg-teal-100 text-teal-700',
  LEAVE:     'bg-yellow-100 text-yellow-700',
  GENERAL:   'bg-gray-100 text-gray-600',
}

const fmtAgo = (d) => {
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function Header({ onMenuClick }) {
  const { data: session } = useSession()
  const router            = useRouter()

  const [profileOpen, setProfileOpen]   = useState(false)
  const [notifOpen,   setNotifOpen]     = useState(false)
  const [searchQuery, setSearchQuery]   = useState('')
  const [notifications, setNotifications] = useState([])
  const [unreadCount,   setUnreadCount]   = useState(0)
  const [notifLoading,  setNotifLoading]  = useState(false)
  const [markingAll,    setMarkingAll]    = useState(false)

  const profileRef = useRef(null)
  const notifRef   = useRef(null)

  // Close dropdowns on outside click
  useEffect(() => {
    function handleOutside(e) {
      if (profileRef.current && !profileRef.current.contains(e.target)) setProfileOpen(false)
      if (notifRef.current   && !notifRef.current.contains(e.target))   setNotifOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [])

  // Fetch unread count on mount and every 60s
  const fetchUnread = useCallback(async () => {
    try {
      const res  = await fetch('/api/notifications?unread=true&limit=1')
      const json = await res.json()
      setUnreadCount(json.unreadCount ?? 0)
    } catch {}
  }, [])

  useEffect(() => {
    fetchUnread()
    const id = setInterval(fetchUnread, 60000)
    return () => clearInterval(id)
  }, [fetchUnread])

  async function openNotifications() {
    setNotifOpen(v => !v)
    if (notifOpen) return
    setNotifLoading(true)
    try {
      const res  = await fetch('/api/notifications?limit=15')
      const json = await res.json()
      setNotifications(json.data ?? [])
      setUnreadCount(json.unreadCount ?? 0)
    } catch {}
    finally { setNotifLoading(false) }
  }

  async function markOne(id) {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n))
    setUnreadCount(prev => Math.max(0, prev - 1))
    await fetch(`/api/notifications/${id}`, { method: 'PATCH' })
  }

  async function markAll() {
    setMarkingAll(true)
    try {
      await fetch('/api/notifications', { method: 'PATCH' })
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })))
      setUnreadCount(0)
    } catch {}
    finally { setMarkingAll(false) }
  }

  async function handleSignOut() {
    await signOut({ redirect: false })
    router.push('/login')
  }

  const user = session?.user

  return (
    <header className="h-16 bg-white border-b border-gray-200 flex items-center gap-3 px-4 sm:px-6 shrink-0 z-30">
      {/* Hamburger – mobile only */}
      <button
        onClick={onMenuClick}
        className="lg:hidden p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors shrink-0"
        aria-label="Open menu"
      >
        <Menu className="w-5 h-5" />
      </button>

      {/* Left – Search */}
      <div className="flex-1 lg:flex-none lg:w-72">
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
      <div className="flex items-center gap-2 ml-auto">

        {/* Notifications */}
        <div className="relative" ref={notifRef}>
          <button
            onClick={openNotifications}
            className="relative p-2 rounded-lg text-gray-500 hover:bg-gray-100 hover:text-gray-700 transition-colors"
          >
            <Bell className="w-5 h-5" />
            {unreadCount > 0 && (
              <span className="absolute top-1 right-1 min-w-[16px] h-4 bg-red-500 rounded-full text-[10px] font-bold text-white flex items-center justify-center px-1 border border-white">
                {unreadCount > 99 ? '99+' : unreadCount}
              </span>
            )}
          </button>

          {notifOpen && (
            <div className="absolute right-0 top-full mt-1.5 w-80 max-w-[calc(100vw-1rem)] bg-white rounded-xl border border-gray-200 shadow-lg z-50 animate-fade-in overflow-hidden">
              {/* Header */}
              <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
                <p className="text-sm font-semibold text-gray-900">Notifications</p>
                {unreadCount > 0 && (
                  <button onClick={markAll} disabled={markingAll}
                    className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 disabled:opacity-50">
                    {markingAll ? <Loader2 className="w-3 h-3 animate-spin" /> : <CheckCheck className="w-3.5 h-3.5" />}
                    Mark all read
                  </button>
                )}
              </div>

              {/* List */}
              <div className="max-h-80 overflow-y-auto divide-y divide-gray-50">
                {notifLoading ? (
                  <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
                ) : notifications.length === 0 ? (
                  <div className="text-center py-8 text-sm text-gray-400">No notifications</div>
                ) : (
                  notifications.map(n => (
                    <div key={n.id}
                      className={cn('flex gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors', !n.isRead && 'bg-blue-50/40')}
                      onClick={() => {
                        if (!n.isRead) markOne(n.id)
                        if (n.link) { router.push(n.link); setNotifOpen(false) }
                      }}
                    >
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <p className={cn('text-xs font-semibold text-gray-800', !n.isRead && 'text-gray-900')}>{n.title}</p>
                          {!n.isRead && <span className="w-1.5 h-1.5 rounded-full bg-blue-500 mt-1 shrink-0" />}
                        </div>
                        <p className="text-xs text-gray-500 mt-0.5 line-clamp-2">{n.message}</p>
                        <p className="text-[10px] text-gray-400 mt-1">{fmtAgo(n.createdAt)}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>

              {/* Footer */}
              <div className="border-t border-gray-100 px-4 py-2.5">
                <Link href="/admin/notifications" onClick={() => setNotifOpen(false)}
                  className="text-xs text-blue-600 hover:text-blue-800 font-medium">
                  View all notifications
                </Link>
              </div>
            </div>
          )}
        </div>

        {/* Profile Dropdown */}
        <div className="relative" ref={profileRef}>
          <button
            onClick={() => setProfileOpen((v) => !v)}
            className="flex items-center gap-2.5 px-2 py-1.5 rounded-lg hover:bg-gray-100 transition-colors"
          >
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
                  href="/admin/account"
                  onClick={() => setProfileOpen(false)}
                  className="flex items-center gap-2.5 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                >
                  <User className="w-4 h-4 text-gray-400" />
                  My Account
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
