'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import {
  Bell, CheckCheck, Trash2, ListTodo, FileText, CreditCard, FileSpreadsheet, CalendarDays, Package, Landmark, TrendingUp, FolderOpen,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'
import PageHeader from '@/components/ui/PageHeader'
import Button from '@/components/ui/Button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import Tabs from '@/components/ui/Tabs'
import EmptyState from '@/components/ui/EmptyState'
import StatsCard from '@/components/ui/StatsCard'
import Pagination from '@/components/ui/Pagination'
import LoadingSpinner from '@/components/ui/LoadingSpinner'

const TYPE_ICONS = {
  TASK:      ListTodo,
  INVOICE:   FileText,
  PAYMENT:   CreditCard,
  QUOTATION: FileSpreadsheet,
  LEAVE:     CalendarDays,
  ASSET:     Package,
  TAX:       Landmark,
  SALARY:    TrendingUp,
  PROJECT:   FolderOpen,
  GENERAL:   Bell,
}

const typeLabel = (t) => (t ? String(t).replace(/_/g, ' ').toLowerCase().replace(/^\w/, c => c.toUpperCase()) : 'General')

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
  const [unreadCount,   setUnreadCount]   = useState(0)
  const limit = 25
  const reqId = useRef(0)

  const load = useCallback(async () => {
    const id = ++reqId.current // ignore responses from superseded requests
    setLoading(true)
    try {
      const p   = new URLSearchParams({ page, limit })
      if (unreadOnly) p.set('unread', 'true')
      const res  = await fetch(`/api/notifications?${p}`)
      const json = await res.json()
      if (id !== reqId.current) return
      setNotifications(json.data ?? [])
      setTotal(json.meta?.total ?? 0)
      setUnreadCount(json.unreadCount ?? 0)
    } catch { if (id === reqId.current) toast.error('Couldn’t load notifications') }
    finally { if (id === reqId.current) setLoading(false) }
  }, [page, unreadOnly])

  useEffect(() => { load() }, [load])

  // Reset to page 1 in the same update as the filter change (one fetch, not two).
  function changeUnreadOnly(checked) {
    setUnreadOnly(checked)
    setPage(1)
  }

  async function markOne(id) {
    if (notifications.some(n => n.id === id && !n.isRead)) setUnreadCount(c => Math.max(0, c - 1))
    setNotifications(prev => prev.map(n => n.id === id ? { ...n, isRead: true } : n))
    await fetch(`/api/notifications/${id}`, { method: 'PATCH' })
  }

  async function deleteOne(id) {
    if (notifications.some(n => n.id === id && !n.isRead)) setUnreadCount(c => Math.max(0, c - 1))
    setNotifications(prev => prev.filter(n => n.id !== id))
    setTotal(t => t - 1)
    await fetch(`/api/notifications/${id}`, { method: 'DELETE' })
  }

  async function markAll() {
    setMarkingAll(true)
    try {
      await fetch('/api/notifications', { method: 'PATCH' })
      setNotifications(prev => prev.map(n => ({ ...n, isRead: true })))
      setUnreadCount(0)
      toast.success('All marked as read')
    } catch { toast.error('Couldn’t mark as read') }
    finally { setMarkingAll(false) }
  }

  const pages = Math.ceil(total / limit)

  const readCount = notifications.filter(n => n.isRead).length
  const typeBreakdown = notifications.reduce((acc, n) => {
    acc[n.type] = (acc[n.type] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="space-y-6">
      <PageHeader
        title="Notifications"
        actions={unreadCount > 0 && (
          <Button variant="outline" size="sm" onClick={markAll} loading={markingAll}>
            {!markingAll && <CheckCheck />} Mark all as read
          </Button>
        )}
      />

      <div className="hidden gap-4 sm:grid sm:grid-cols-2 lg:grid-cols-4">
        <StatsCard title="Total" value={total} />
        <StatsCard title="Unread" value={unreadCount} />
        <StatsCard title="Read" value={readCount} />
        <StatsCard title="Pages" value={pages} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Tabs
          value={unreadOnly ? 'unread' : 'all'}
          onChange={(v) => changeUnreadOnly(v === 'unread')}
          tabs={[
            { value: 'all', label: 'All' },
            { value: 'unread', label: 'Unread', count: unreadCount > 0 ? unreadCount : undefined },
          ]}
        />
      </div>

      <div className="flex flex-col items-start gap-6 lg:flex-row">
        <Card className="w-full min-w-0 flex-1 overflow-hidden">
          {loading ? (
            <LoadingSpinner className="py-16" />
          ) : notifications.length === 0 ? (
            <EmptyState icon={Bell} title={unreadOnly ? 'No unread notifications' : 'No notifications'} />
          ) : (
            <div className="divide-y divide-gray-100">
              {notifications.map(n => {
                const Icon = TYPE_ICONS[n.type] ?? Bell
                return (
                  <div key={n.id} className="group flex items-start gap-3 px-4 py-3.5 transition-colors hover:bg-gray-50/70">
                    <span className={cn('mt-3 size-2 shrink-0 rounded-full', n.isRead ? 'bg-transparent' : 'bg-brand')} />

                    <div className="flex size-8 shrink-0 items-center justify-center rounded-lg border border-gray-200/80 bg-white shadow-xs">
                      <Icon className="size-4 text-gray-500" />
                    </div>

                    <div className="min-w-0 flex-1 cursor-pointer" onClick={() => {
                      if (!n.isRead) markOne(n.id)
                      if (n.link) router.push(n.link)
                    }}>
                      <p className={cn('text-sm', n.isRead ? 'text-gray-600' : 'font-medium text-gray-900')}>{n.title}</p>
                      {n.message && <p className="mt-0.5 text-sm text-muted-foreground">{n.message}</p>}
                      <p className="mt-1 text-xs text-muted-foreground">{typeLabel(n.type)} · {fmtAgo(n.createdAt)}</p>
                    </div>

                    <div className="flex shrink-0 items-center gap-0.5 transition-opacity sm:opacity-0 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
                      {!n.isRead && (
                        <Button variant="ghost" size="icon-xs" onClick={() => markOne(n.id)} title="Mark as read" aria-label="Mark as read">
                          <CheckCheck />
                        </Button>
                      )}
                      <Button variant="ghost" size="icon-xs" onClick={() => deleteOne(n.id)} title="Delete" aria-label="Delete"
                        className="hover:text-red-600">
                        <Trash2 />
                      </Button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}

          {pages > 1 && (
            <div className="border-t border-gray-100 px-4 py-3">
              <Pagination page={page} pages={pages} onPageChange={setPage} />
            </div>
          )}
        </Card>

        {Object.keys(typeBreakdown).length > 0 && (
          <Card className="hidden w-72 shrink-0 lg:block">
            <CardHeader>
              <CardTitle>By type</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2.5">
              {Object.entries(typeBreakdown).map(([type, count]) => {
                const Icon = TYPE_ICONS[type] ?? Bell
                return (
                  <div key={type} className="flex items-center justify-between gap-3 text-sm">
                    <span className="inline-flex items-center gap-2 text-gray-700">
                      <Icon className="size-4 text-gray-400" />
                      {typeLabel(type)}
                    </span>
                    <span className="font-medium tabular-nums text-gray-900">{count}</span>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  )
}
