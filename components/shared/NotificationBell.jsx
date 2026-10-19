'use client'

import { useState, useEffect, useRef } from 'react'
import { Bell, X, CheckCheck, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import Button, { buttonVariants } from '@/components/ui/Button'

export default function NotificationBell() {
  const [open, setOpen] = useState(false)
  const [notifications, setNotifications] = useState([])
  const [unreadCount, setUnreadCount] = useState(0)
  const [loading, setLoading] = useState(false)
  const dropdownRef = useRef(null)
  const router = useRouter()

  const fetchNotifications = async () => {
    setLoading(true)
    try {
      const res = await fetch('/api/notifications?limit=10')
      if (res.ok) {
        const data = await res.json()
        setNotifications(data.data || [])
        setUnreadCount(data.unreadCount || 0)
      }
    } catch {}
    setLoading(false)
  }

  useEffect(() => {
    fetchNotifications()
    const interval = setInterval(fetchNotifications, 30000)
    return () => clearInterval(interval)
  }, [])

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  const markAllRead = async () => {
    try {
      await fetch('/api/notifications', { method: 'PATCH' })
      setNotifications((prev) => prev.map((n) => ({ ...n, isRead: true })))
      setUnreadCount(0)
    } catch {}
  }

  const openNotification = async (n) => {
    if (!n.isRead) {
      setNotifications((prev) => prev.map((x) => (x.id === n.id ? { ...x, isRead: true } : x)))
      setUnreadCount((c) => Math.max(0, c - 1))
      fetch(`/api/notifications/${n.id}`, { method: 'PATCH' }).catch(() => {})
    }
    // Only follow in-app links (never protocol-relative or external URLs).
    if (typeof n.link === 'string' && n.link.startsWith('/') && !n.link.startsWith('//')) {
      setOpen(false)
      router.push(n.link)
    }
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label="Notifications"
        className={cn(
          'relative flex size-9 items-center justify-center rounded-lg text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900',
          open && 'bg-gray-100 text-gray-900'
        )}
      >
        <Bell className="size-4" />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-semibold leading-none text-white ring-2 ring-white tabular-nums">
            {unreadCount > 9 ? '9+' : unreadCount}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-50 mt-2 w-80 overflow-hidden rounded-xl border border-gray-200/80 bg-white shadow-lg">
          {/* Header */}
          <div className="flex items-center justify-between gap-2 border-b border-gray-100 px-4 py-3">
            <div className="flex items-center gap-2">
              <h3 className="text-sm font-semibold text-gray-900">Notifications</h3>
              {unreadCount > 0 && (
                <span className="rounded-full bg-gray-100 px-1.5 text-[11px] font-medium leading-[18px] text-gray-600 tabular-nums">
                  {unreadCount}
                </span>
              )}
            </div>
            <div className="flex items-center gap-1">
              {unreadCount > 0 && (
                <Button variant="ghost" size="xs" onClick={markAllRead} className="text-muted-foreground">
                  <CheckCheck className="size-3.5" />
                  Mark all read
                </Button>
              )}
              <Button variant="ghost" size="icon-xs" onClick={() => setOpen(false)} className="text-gray-400" aria-label="Close">
                <X />
              </Button>
            </div>
          </div>

          {/* List */}
          <div className="max-h-80 overflow-y-auto scrollbar-thin">
            {loading && (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="size-5 animate-spin text-gray-400" />
              </div>
            )}

            {!loading && notifications.length === 0 && (
              <div className="flex flex-col items-center py-10 text-center">
                <div className="mb-3 flex size-9 items-center justify-center rounded-lg border border-gray-200/80 bg-white shadow-xs">
                  <Bell className="size-4 text-gray-500" />
                </div>
                <p className="text-sm text-muted-foreground">No notifications yet</p>
              </div>
            )}

            {!loading && notifications.map((n) => (
              <div
                key={n.id}
                onClick={() => openNotification(n)}
                className="cursor-pointer border-b border-gray-100 px-4 py-3 transition-colors last:border-0 hover:bg-gray-50/70"
              >
                <div className="flex items-start gap-3">
                  <span className={cn('mt-1.5 size-2 shrink-0 rounded-full', !n.isRead ? 'bg-brand' : 'bg-transparent')} />
                  <div className="min-w-0 flex-1">
                    <p className={cn('text-sm', !n.isRead ? 'font-medium text-gray-900' : 'text-gray-600')}>
                      {n.title}
                    </p>
                    <p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">{n.message}</p>
                    <p className="mt-1 text-[11px] text-gray-400">
                      {new Date(n.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · {new Date(n.createdAt).toLocaleDateString()}
                    </p>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Footer */}
          <div className="border-t border-gray-100 p-1.5">
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className={cn(buttonVariants({ variant: 'ghost', size: 'sm' }), 'w-full')}
            >
              View all
            </Link>
          </div>
        </div>
      )}
    </div>
  )
}
