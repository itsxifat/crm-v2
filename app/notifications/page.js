'use client'

import { useState, useEffect, useCallback } from 'react'
import { Bell, CheckCheck, Trash2 } from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'
import Button from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import PageHeader from '@/components/ui/PageHeader'
import Badge from '@/components/ui/Badge'
import EmptyState from '@/components/ui/EmptyState'
import LoadingSpinner from '@/components/ui/LoadingSpinner'

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
    } catch { toast.error("Couldn't load notifications") }
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
    <div className="mx-auto max-w-2xl space-y-6 px-4 py-8">
      <PageHeader
        title="Notifications"
        meta={unreadCount > 0 ? <Badge>{unreadCount} unread</Badge> : null}
        actions={unreadCount > 0 && (
          <Button variant="outline" size="sm" onClick={markAll} loading={markingAll}>
            {!markingAll && <CheckCheck />}
            Mark all read
          </Button>
        )}
      />

      <Card className="overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16"><LoadingSpinner /></div>
        ) : notifications.length === 0 ? (
          <EmptyState icon={Bell} title="No notifications" />
        ) : (
          <div className="divide-y divide-gray-100">
            {notifications.map(n => (
              <div key={n.id}
                className={cn('group flex items-start gap-3 px-5 py-4 transition-colors', !n.isRead ? 'cursor-pointer hover:bg-gray-50/70' : '')}
                onClick={() => { if (!n.isRead) markOne(n.id) }}
              >
                <span className={cn('mt-[7px] size-2 shrink-0 rounded-full', n.isRead ? 'bg-transparent' : 'bg-brand')} />
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm', n.isRead ? 'text-gray-600' : 'font-medium text-gray-900')}>{n.title}</p>
                  <p className="mt-0.5 text-sm text-muted-foreground">{n.message}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{fmtAgo(n.createdAt)}</p>
                </div>
                <Button
                  variant="ghost"
                  size="icon-xs"
                  onClick={e => { e.stopPropagation(); deleteOne(n.id) }}
                  className="text-gray-400 opacity-0 hover:text-red-600 focus-visible:opacity-100 group-hover:opacity-100"
                  aria-label="Delete"
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </div>
        )}

        {pages > 1 && (
          <div className="flex items-center justify-between border-t border-gray-100 px-5 py-3">
            <p className="text-xs text-muted-foreground">Page {page} of {pages}</p>
            <div className="flex gap-2">
              <Button variant="outline" size="xs" disabled={page <= 1} onClick={() => setPage(p => p - 1)}>Previous</Button>
              <Button variant="outline" size="xs" disabled={page >= pages} onClick={() => setPage(p => p + 1)}>Next</Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  )
}
