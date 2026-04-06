'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Bell, CheckCheck, Trash2, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'

const TYPE_COLORS = {
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
  if (mins < 1)   return 'just now'
  if (mins < 60)  return `${mins} minute${mins === 1 ? '' : 's'} ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)   return `${hrs} hour${hrs === 1 ? '' : 's'} ago`
  const days = Math.floor(hrs / 24)
  if (days < 7)   return `${days} day${days === 1 ? '' : 's'} ago`
  return new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function NotificationsPage() {
  const router = useRouter()
  const [notifications, setNotifications] = useState([])
  const [loading,       setLoading]       = useState(true)
  const [markingAll,    setMarkingAll]    = useState(false)
  const [page,          setPage]          = useState(1)
  const [total,         setTotal]         = useState(0)
  const [unreadOnly,    setUnreadOnly]    = useState(false)
  const limit = 25

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const p   = new URLSearchParams({ page, limit })
      if (unreadOnly) p.set('unread', 'true')
      const res  = await fetch(`/api/notifications?${p}`)
      const json = await res.json()
      setNotifications(json.data ?? [])
      setTotal(json.meta?.total ?? 0)
    } catch { toast.error('Failed to load notifications') }
    finally { setLoading(false) }
  }, [page, unreadOnly])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [unreadOnly])

  async function markOne(id) {
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n))
    await fetch(`/api/notifications/${id}`, { method: 'PATCH' })
  }

  async function deleteOne(id) {
    setNotifications(prev => prev.filter(n => n.id !== id))
    setTotal(t => t - 1)
    await fetch(`/api/notifications/${id}`, { method: 'DELETE' })
  }

  async function markAll() {
    setMarkingAll(true)
    try {
      await fetch('/api/notifications', { method: 'PATCH' })
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })))
      toast.success('All marked as read')
    } catch { toast.error('Failed') }
    finally { setMarkingAll(false) }
  }

  const unreadCount = notifications.filter(n => !n.isRead).length
  const pages = Math.ceil(total / limit)

  const readCount = notifications.filter(n => n.isRead).length
  const typeBreakdown = notifications.reduce((acc, n) => {
    acc[n.type] = (acc[n.type] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Notifications</h1>
          <p className="text-sm text-gray-400 mt-0.5">{total} total{unreadCount > 0 ? ` · ${unreadCount} unread` : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-sm text-gray-600 cursor-pointer">
            <input type="checkbox" checked={unreadOnly} onChange={e => setUnreadOnly(e.target.checked)}
              className="rounded border-gray-300" />
            Unread only
          </label>
          {unreadCount > 0 && (
            <button onClick={markAll} disabled={markingAll}
              className="flex items-center gap-1.5 px-3 py-1.5 text-sm border border-gray-200 rounded-xl hover:bg-gray-50 disabled:opacity-50 transition-colors">
              {markingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCheck className="w-4 h-4" />}
              Mark all read
            </button>
          )}
        </div>
      </div>

      {/* Two-column layout on PC */}
      <div className="flex flex-col lg:flex-row gap-6 items-start">

        {/* Left – Notifications list */}
        <div className="flex-1 min-w-0 bg-white border border-gray-100 rounded-xl overflow-hidden">
          {loading ? (
            <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
          ) : notifications.length === 0 ? (
            <div className="text-center py-16 text-gray-400">
              <Bell className="w-10 h-10 mx-auto mb-3 opacity-30" />
              <p className="text-sm">{unreadOnly ? 'No unread notifications' : 'No notifications yet'}</p>
            </div>
          ) : (
            <div className="divide-y divide-gray-50">
              {notifications.map(n => (
                <div
                  key={n.id}
                  className={cn('flex items-start gap-4 px-5 py-4 hover:bg-gray-50 transition-colors group', !n.isRead && 'bg-blue-50/40')}
                >
                  {/* Unread indicator */}
                  <div className="w-2 h-2 rounded-full mt-2 shrink-0" style={{ background: n.isRead ? 'transparent' : '#3b82f6' }} />

                  {/* Content */}
                  <div className="flex-1 min-w-0 cursor-pointer" onClick={() => {
                    if (!n.isRead) markOne(n.id)
                    if (n.link) router.push(n.link)
                  }}>
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide', TYPE_COLORS[n.type] ?? TYPE_COLORS.GENERAL)}>
                        {n.type}
                      </span>
                      <p className="text-xs text-gray-400">{fmtAgo(n.createdAt)}</p>
                    </div>
                    <p className={cn('text-sm font-medium text-gray-800', !n.isRead && 'text-gray-900')}>{n.title}</p>
                    <p className="text-sm text-gray-500 mt-0.5">{n.message}</p>
                  </div>

                  {/* Actions */}
                  <div className="flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity shrink-0">
                    {!n.isRead && (
                      <button onClick={() => markOne(n.id)} title="Mark as read"
                        className="p-1 text-gray-400 hover:text-blue-600 rounded">
                        <CheckCheck className="w-4 h-4" />
                      </button>
                    )}
                    <button onClick={() => deleteOne(n.id)} title="Delete"
                      className="p-1 text-gray-400 hover:text-red-500 rounded">
                      <Trash2 className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {pages > 1 && (
            <div className="flex items-center justify-between px-5 py-3 border-t border-gray-100">
              <p className="text-xs text-gray-400">Page {page} of {pages}</p>
              <div className="flex gap-2">
                <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                  className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">Previous</button>
                <button disabled={page >= pages} onClick={() => setPage(p => p + 1)}
                  className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">Next</button>
              </div>
            </div>
          )}
        </div>

        {/* Right – Summary panel (PC only) */}
        <div className="hidden lg:flex flex-col gap-4 w-72 shrink-0">

          {/* Stats */}
          <div className="bg-white border border-gray-100 rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-700">Overview</h2>
            <div className="grid grid-cols-2 gap-3">
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-gray-900">{total}</p>
                <p className="text-xs text-gray-400 mt-0.5">Total</p>
              </div>
              <div className="bg-blue-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-blue-600">{unreadCount}</p>
                <p className="text-xs text-gray-400 mt-0.5">Unread</p>
              </div>
              <div className="bg-green-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-green-600">{readCount}</p>
                <p className="text-xs text-gray-400 mt-0.5">Read</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 text-center">
                <p className="text-2xl font-bold text-gray-900">{pages}</p>
                <p className="text-xs text-gray-400 mt-0.5">Pages</p>
              </div>
            </div>
          </div>

          {/* By type */}
          {Object.keys(typeBreakdown).length > 0 && (
            <div className="bg-white border border-gray-100 rounded-xl p-5 space-y-3">
              <h2 className="text-sm font-semibold text-gray-700">By Type</h2>
              <div className="space-y-2">
                {Object.entries(typeBreakdown).map(([type, count]) => (
                  <div key={type} className="flex items-center justify-between">
                    <span className={cn('text-[10px] font-semibold px-1.5 py-0.5 rounded uppercase tracking-wide', TYPE_COLORS[type] ?? TYPE_COLORS.GENERAL)}>
                      {type}
                    </span>
                    <span className="text-sm font-medium text-gray-700">{count}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Quick actions */}
          <div className="bg-white border border-gray-100 rounded-xl p-5 space-y-2">
            <h2 className="text-sm font-semibold text-gray-700">Quick Actions</h2>
            {unreadCount > 0 && (
              <button onClick={markAll} disabled={markingAll}
                className="w-full flex items-center gap-2 px-3 py-2 text-sm text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg disabled:opacity-50 transition-colors">
                {markingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCheck className="w-4 h-4" />}
                Mark all as read
              </button>
            )}
            <label className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-600 bg-gray-50 hover:bg-gray-100 rounded-lg cursor-pointer transition-colors">
              <input type="checkbox" checked={unreadOnly} onChange={e => setUnreadOnly(e.target.checked)}
                className="rounded border-gray-300" />
              Show unread only
            </label>
          </div>
        </div>

      </div>
    </div>
  )
}
