'use client'

import { useRouter, usePathname, useSearchParams } from 'next/navigation'
import { useState, useRef, useEffect, useCallback, Suspense } from 'react'
import Link from 'next/link'
import { Bell, CheckCheck, Loader2, PanelLeft, Search, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { findActive } from './nav'

const fmtAgo = (d) => {
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

function Breadcrumb() {
  const pathname     = usePathname()
  const searchParams = useSearchParams()
  const match = findActive(pathname, searchParams)
  if (!match) return null
  const { group, item } = match
  const base = item.basePath ?? item.href.split('?')[0]
  const deeper = pathname !== base && pathname.startsWith(`${base}/`)

  return (
    <nav aria-label="Breadcrumb" className="hidden min-w-0 items-center gap-1.5 text-sm sm:flex">
      {group && (
        <>
          <span className="truncate text-muted-foreground">{group.label}</span>
          <ChevronRight className="size-3.5 shrink-0 text-gray-300" />
        </>
      )}
      {deeper ? (
        <>
          <Link href={item.href} className="truncate text-muted-foreground hover:text-gray-900">{item.label}</Link>
          <ChevronRight className="size-3.5 shrink-0 text-gray-300" />
          <span className="truncate font-medium text-gray-900">Details</span>
        </>
      ) : (
        <span className="truncate font-medium text-gray-900">{item.label}</span>
      )}
    </nav>
  )
}

function Notifications() {
  const router = useRouter()
  const [open, setOpen]                 = useState(false)
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount]   = useState(0)
  const [loading, setLoading]           = useState(false)
  const [markingAll, setMarkingAll]     = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    function handleOutside(e) {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [])

  // Unread count on mount and every 60s
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

  async function toggle() {
    setOpen(v => !v)
    if (open) return
    setLoading(true)
    try {
      const res  = await fetch('/api/notifications?limit=15')
      const json = await res.json()
      setNotifications(json.data ?? [])
      setUnreadCount(json.unreadCount ?? 0)
    } catch {}
    finally { setLoading(false) }
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

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={toggle}
        aria-label="Notifications"
        className={cn(
          'relative inline-flex size-9 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900',
          open && 'bg-gray-100 text-gray-900'
        )}
      >
        <Bell className="size-[18px]" />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-white">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[360px] max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-gray-200/80 bg-white shadow-lg animate-in fade-in-0 zoom-in-95 duration-100">
          <div className="flex items-center justify-between px-4 py-3">
            <p className="text-sm font-semibold text-gray-900">Notifications</p>
            {unreadCount > 0 && (
              <button onClick={markAll} disabled={markingAll}
                className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-gray-600 hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50">
                {markingAll ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCheck className="size-3.5" />}
                Mark all read
              </button>
            )}
          </div>

          <div className="max-h-[360px] overflow-y-auto border-t border-gray-100 p-1">
            {loading ? (
              <div className="flex justify-center py-10"><Loader2 className="size-5 animate-spin text-gray-400" /></div>
            ) : notifications.length === 0 ? (
              <div className="flex flex-col items-center py-10 text-center">
                <Bell className="size-5 text-gray-300" />
                <p className="mt-2 text-sm text-muted-foreground">You&apos;re all caught up</p>
              </div>
            ) : (
              notifications.map(n => (
                <button
                  key={n.id}
                  type="button"
                  className="flex w-full gap-3 rounded-lg px-3 py-2.5 text-left transition-colors hover:bg-gray-50"
                  onClick={() => {
                    if (!n.isRead) markOne(n.id)
                    if (n.link) { router.push(n.link); setOpen(false) }
                  }}
                >
                  <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', n.isRead ? 'bg-transparent' : 'bg-brand')} />
                  <span className="min-w-0 flex-1">
                    <span className={cn('block text-[13px]', n.isRead ? 'text-gray-700' : 'font-medium text-gray-900')}>{n.title}</span>
                    <span className="mt-0.5 block text-xs text-muted-foreground line-clamp-2">{n.message}</span>
                    <span className="mt-1 block text-[11px] text-gray-400">{fmtAgo(n.createdAt)}</span>
                  </span>
                </button>
              ))
            )}
          </div>

          <div className="border-t border-gray-100 p-1">
            <Link href="/admin/notifications" onClick={() => setOpen(false)}
              className="block rounded-lg px-3 py-2 text-center text-[13px] font-medium text-gray-700 hover:bg-gray-50 hover:text-gray-900">
              View all
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}

export default function Header({ onMenuClick, onToggleSidebar, onSearchClick }) {
  const [isMac, setIsMac] = useState(false)
  useEffect(() => { setIsMac(/Mac|iPhone|iPad/.test(navigator.platform)) }, [])

  return (
    <header className="relative z-30 flex h-14 shrink-0 items-center gap-2 border-b border-gray-100 bg-white px-3 sm:px-4">
      {/* Mobile: open drawer · Desktop: collapse rail */}
      <button
        onClick={onMenuClick}
        className="inline-flex size-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 lg:hidden"
        aria-label="Open menu"
      >
        <PanelLeft className="size-4" />
      </button>
      <button
        onClick={onToggleSidebar}
        className="hidden size-8 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 lg:inline-flex"
        aria-label="Toggle sidebar"
      >
        <PanelLeft className="size-4" />
      </button>
      <div className="mx-1 hidden h-4 w-px bg-gray-200 sm:block" />

      <Suspense fallback={null}>
        <Breadcrumb />
      </Suspense>

      <div className="ml-auto flex items-center gap-1.5">
        <button
          onClick={onSearchClick}
          className="hidden h-9 w-60 items-center gap-2 rounded-lg border border-gray-200 bg-gray-50/60 px-3 text-sm text-gray-400 transition-colors hover:border-gray-300 hover:bg-white md:flex"
        >
          <Search className="size-4" />
          <span className="flex-1 text-left">Search…</span>
          <kbd className="rounded-md border border-gray-200 bg-white px-1.5 py-px text-[11px] font-medium text-gray-500 shadow-xs">
            {isMac ? '⌘K' : 'Ctrl K'}
          </kbd>
        </button>
        <button
          onClick={onSearchClick}
          className="inline-flex size-9 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 md:hidden"
          aria-label="Search"
        >
          <Search className="size-[18px]" />
        </button>
        <Notifications />
      </div>
    </header>
  )
}
