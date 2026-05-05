'use client'

import { useState, useEffect, useCallback } from 'react'
import { Bell, CheckCheck, Trash2, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'

const fmtAgo = (d) => {
  const diff = Date.now() - new Date(d).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1)  return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)  return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

export default function NotificationsPage() {
  const [notifications, setNotifications] = useState([])
  const [loading,    setLoading]    = useState(true)
  const [markingAll, setMarkingAll] = useState(false)
  const [page,   setPage]   = useState(1)
  const [total,  setTotal]  = useState(0)
  const limit = 25

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res  = await fetch(`/api/notifications?page=${page}&limit=${limit}`)
      const json = await res.json()
      setNotifications(json.data ?? [])
      setTotal(json.meta?.total ?? 0)
    } catch { toast.error('Failed to load') }
    finally { setLoading(false) }
  }, [page])

  useEffect(() => { load() }, [load])

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
    } catch {}
    finally { setMarkingAll(false) }
  }

  const unreadCount = notifications.filter(n => !n.isRead).length
  const pages = Math.ceil(total / limit)

  return (
    <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-gray-900">Notifications</h1>
        {unreadCount > 0 && (
          <button onClick={markAll} disabled={markingAll}
            className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 disabled:opacity-50">
            {markingAll ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCheck className="w-4 h-4" />}
            Mark all read
          </button>
        )}
      </div>

      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
        ) : notifications.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Bell className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No notifications</p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50">
            {notifications.map(n => (
              <div key={n.id}
                className={cn('flex items-start gap-3 px-5 py-4 group', !n.isRead && 'bg-blue-50/40')}
                onClick={() => { if (!n.isRead) markOne(n.id) }}
              >
                <div className="w-2 h-2 rounded-full mt-2 shrink-0" style={{ background: n.isRead ? 'transparent' : '#3b82f6' }} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800">{n.title}</p>
                  <p className="text-sm text-gray-500 mt-0.5">{n.message}</p>
                  <p className="text-xs text-gray-400 mt-1">{fmtAgo(n.createdAt)}</p>
                </div>
                <button onClick={e => { e.stopPropagation(); deleteOne(n.id) }}
                  className="opacity-0 group-hover:opacity-100 p-1 text-gray-400 hover:text-red-500 transition-opacity">
                  <Trash2 className="w-4 h-4" />
                </button>
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
    </div>
  )
}
