'use client'

import { useEffect, useState, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import {
  ArrowLeft, LogIn, Clock, Monitor, Globe, Activity,
  ChevronLeft, ChevronRight, AlertCircle, Filter,
} from 'lucide-react'
import Select from '@/components/ui/Select'
import DatePicker from '@/components/ui/DatePicker'
import { cn } from '@/lib/utils'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatDate(date) {
  if (!date) return '—'
  return new Date(date).toLocaleString(undefined, {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
}

function timeAgo(date) {
  if (!date) return 'Never'
  const diff = Date.now() - new Date(date).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1)   return 'Just now'
  if (mins < 60)  return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24)   return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30)  return `${days}d ago`
  return new Date(date).toLocaleDateString()
}

// ─── Role config ──────────────────────────────────────────────────────────────

const ROLE_BADGE = {
  SUPER_ADMIN: 'bg-violet-100 text-violet-700',
  MANAGER:     'bg-blue-100 text-blue-700',
  EMPLOYEE:    'bg-emerald-100 text-emerald-700',
  FREELANCER:  'bg-orange-100 text-orange-700',
  CLIENT:      'bg-cyan-100 text-cyan-700',
  VENDOR:      'bg-slate-100 text-slate-600',
}

const ROLE_DOT = {
  SUPER_ADMIN: 'bg-violet-500',
  MANAGER:     'bg-blue-500',
  EMPLOYEE:    'bg-emerald-500',
  FREELANCER:  'bg-orange-500',
  CLIENT:      'bg-cyan-500',
  VENDOR:      'bg-slate-400',
}

const ROLE_LABEL = {
  SUPER_ADMIN: 'Super Admin',
  MANAGER:     'Manager',
  EMPLOYEE:    'Employee',
  FREELANCER:  'Freelancer',
  CLIENT:      'Client',
  VENDOR:      'Vendor',
}

// ─── Action config ────────────────────────────────────────────────────────────

const ACTION_CONFIG = {
  LOGIN:         { label: 'Login',         bg: 'bg-emerald-50', text: 'text-emerald-700', icon: LogIn    },
  CREATE:        { label: 'Create',        bg: 'bg-blue-50',    text: 'text-blue-700',    icon: Activity },
  UPDATE:        { label: 'Update',        bg: 'bg-amber-50',   text: 'text-amber-700',   icon: Activity },
  DELETE:        { label: 'Delete',        bg: 'bg-red-50',     text: 'text-red-700',     icon: Activity },
  SEND:          { label: 'Send',          bg: 'bg-violet-50',  text: 'text-violet-700',  icon: Activity },
  STATUS_CHANGE: { label: 'Status Change', bg: 'bg-cyan-50',    text: 'text-cyan-700',    icon: Activity },
  APPROVE:       { label: 'Approve',       bg: 'bg-teal-50',    text: 'text-teal-700',    icon: Activity },
  REJECT:        { label: 'Reject',        bg: 'bg-orange-50',  text: 'text-orange-700',  icon: Activity },
}

function ActionBadge({ action }) {
  const cfg = ACTION_CONFIG[action] ?? { label: action, bg: 'bg-gray-100', text: 'text-gray-600', icon: Activity }
  const Icon = cfg.icon
  return (
    <span className={cn('inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full', cfg.bg, cfg.text)}>
      <Icon className="w-3 h-3" />
      {cfg.label}
    </span>
  )
}

// ─── User info card ────────────────────────────────────────────────────────────

function UserCard({ user }) {
  if (!user) return null
  const dotCls   = ROLE_DOT[user.role]   ?? 'bg-gray-400'
  const badgeCls = ROLE_BADGE[user.role] ?? 'bg-gray-100 text-gray-600'

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5 flex items-center gap-4">
      <div className={cn('w-12 h-12 rounded-full flex items-center justify-center text-lg font-bold text-white shrink-0', dotCls)}>
        {user.avatar
          ? <Image src={user.avatar} alt="" width={48} height={48} className="w-12 h-12 rounded-full object-cover" />
          : (user.name ?? '?').charAt(0).toUpperCase()
        }
      </div>
      <div className="min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-semibold text-gray-900">{user.name}</p>
          <span className={cn('text-xs font-medium px-2 py-0.5 rounded-full', badgeCls)}>
            {ROLE_LABEL[user.role] ?? user.role}
          </span>
          <span className={cn(
            'text-xs font-medium px-2 py-0.5 rounded-full',
            user.isActive ? 'bg-emerald-100 text-emerald-700' : 'bg-gray-100 text-gray-500',
          )}>
            {user.isActive ? 'Active' : 'Inactive'}
          </span>
        </div>
        <p className="text-sm text-gray-500 mt-0.5">{user.email}</p>
        <p className="text-xs text-gray-400 mt-1 flex items-center gap-1">
          <Clock className="w-3 h-3" />
          Last login: {user.lastLogin ? formatDate(user.lastLogin) : 'Never'}
        </p>
      </div>
    </div>
  )
}

// ─── Log timeline ─────────────────────────────────────────────────────────────

function LogRow({ log, index }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={cn('flex gap-4 group', index > 0 && 'border-t border-gray-50')}>
      {/* Timeline spine */}
      <div className="flex flex-col items-center pt-4">
        <div className={cn(
          'w-2 h-2 rounded-full shrink-0',
          ACTION_CONFIG[log.action]?.bg?.replace('bg-', 'bg-').replace('-50', '-400') ?? 'bg-gray-300',
        )} />
        <div className="w-px flex-1 bg-gray-100 mt-1" />
      </div>

      {/* Content */}
      <div className="flex-1 py-3.5 pb-4 min-w-0">
        <div className="flex items-start justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-2 flex-wrap">
            <ActionBadge action={log.action} />
            <span className="text-sm text-gray-700">
              {log.entity}
              {log.entityId && log.entityId !== log.user?.id && (
                <span className="text-gray-400 text-xs ml-1">#{log.entityId.slice(-6)}</span>
              )}
            </span>
          </div>
          <span
            className="text-xs text-gray-400 whitespace-nowrap cursor-default"
            title={formatDate(log.createdAt)}
          >
            {timeAgo(log.createdAt)}
          </span>
        </div>

        {/* Meta row */}
        <div className="flex items-center gap-3 mt-1.5 flex-wrap">
          {log.ipAddress && (
            <span className="flex items-center gap-1 text-xs text-gray-400">
              <Globe className="w-3 h-3" /> {log.ipAddress}
            </span>
          )}
          {log.userAgent && (
            <span className="flex items-center gap-1 text-xs text-gray-400 truncate max-w-xs">
              <Monitor className="w-3 h-3 shrink-0" />
              <span className="truncate">{log.userAgent.substring(0, 60)}{log.userAgent.length > 60 ? '…' : ''}</span>
            </span>
          )}
        </div>

        {/* Changes */}
        {log.changes && (
          <div className="mt-1.5">
            <button
              onClick={() => setExpanded(e => !e)}
              className="text-xs text-gray-400 hover:text-gray-700 underline underline-offset-2 transition-colors"
            >
              {expanded ? 'Hide details' : 'Show details'}
            </button>
            {expanded && (
              <pre className="mt-1.5 text-xs bg-gray-50 rounded-lg p-2.5 overflow-x-auto text-gray-600 border border-gray-100">
                {log.changes}
              </pre>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function UserActivityLogPage() {
  const { userId } = useParams()

  const [user,         setUser]        = useState(null)
  const [userLoading,  setUserLoading] = useState(true)
  const [logs,         setLogs]        = useState([])
  const [meta,         setMeta]        = useState({ page: 1, total: 0, pages: 1 })
  const [page,         setPage]        = useState(1)
  const [logsLoading,  setLogsLoading] = useState(true)
  const [actionFilter, setActionFilter]= useState('')
  const [fromDate,     setFromDate]    = useState('')
  const [toDate,       setToDate]      = useState('')

  // Load user info
  useEffect(() => {
    setUserLoading(true)
    fetch(`/api/users/${userId}`)
      .then(r => r.json())
      .then(d => setUser(d.data ?? d))
      .catch(() => setUser(null))
      .finally(() => setUserLoading(false))
  }, [userId])

  // Load logs
  const loadLogs = useCallback(() => {
    setLogsLoading(true)
    const params = new URLSearchParams({ userId, page, limit: 25 })
    if (actionFilter) params.set('action', actionFilter)
    if (fromDate)     params.set('from', fromDate)
    if (toDate)       params.set('to', toDate)
    fetch(`/api/activity-logs?${params}`)
      .then(r => r.json())
      .then(d => {
        setLogs(d.data ?? [])
        setMeta(d.meta ?? { page: 1, total: 0, pages: 1 })
      })
      .catch(() => setLogs([]))
      .finally(() => setLogsLoading(false))
  }, [userId, page, actionFilter, fromDate, toDate])

  useEffect(() => { setPage(1) }, [actionFilter, fromDate, toDate])
  useEffect(() => { loadLogs() }, [loadLogs])

  return (
    <div className="space-y-5 max-w-3xl">
      {/* Back */}
      <Link
        href="/admin/activity-logs"
        className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors"
      >
        <ArrowLeft className="w-4 h-4" />
        Back to Activity Logs
      </Link>

      {/* User info */}
      {userLoading ? (
        <div className="h-24 bg-gray-100 rounded-xl animate-pulse" />
      ) : (
        <UserCard user={user} />
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="flex items-center gap-1.5 text-sm text-gray-500">
          <Filter className="w-3.5 h-3.5" />
          Filters:
        </div>
        <Select
          value={actionFilter}
          onChange={v => setActionFilter(v ?? '')}
          options={Object.entries(ACTION_CONFIG).map(([action, cfg]) => ({ value: action, label: cfg.label }))}
          placeholder="All Actions"
          size="sm"
        />
        <div className="flex items-center gap-1.5">
          <DatePicker value={fromDate || null} onChange={v => setFromDate(v ?? '')} />
          <span className="text-gray-400 text-xs">to</span>
          <DatePicker value={toDate || null} onChange={v => setToDate(v ?? '')} />
        </div>
        {(actionFilter || fromDate || toDate) && (
          <button
            onClick={() => { setActionFilter(''); setFromDate(''); setToDate('') }}
            className="text-xs text-gray-400 hover:text-gray-700 transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {/* Log count */}
      {!logsLoading && (
        <p className="text-xs text-gray-400">
          {meta.total} activit{meta.total !== 1 ? 'ies' : 'y'} found
          {(actionFilter || fromDate || toDate) ? ' (filtered)' : ''}
          {' '}· Logs retained for 356 days
        </p>
      )}

      {/* Timeline */}
      <div className="bg-white rounded-xl border border-gray-100 px-5 overflow-hidden">
        {logsLoading ? (
          <div className="space-y-4 py-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex gap-4">
                <div className="w-2 h-2 mt-4 rounded-full bg-gray-200 shrink-0" />
                <div className="flex-1 space-y-1.5 py-3">
                  <div className="h-4 bg-gray-100 rounded w-40 animate-pulse" />
                  <div className="h-3 bg-gray-100 rounded w-64 animate-pulse" />
                </div>
              </div>
            ))}
          </div>
        ) : logs.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-14 gap-2 text-gray-400">
            <AlertCircle className="w-6 h-6" />
            <p className="text-sm">No activity found</p>
          </div>
        ) : (
          <div>
            {logs.map((log, i) => (
              <LogRow key={log.id} log={log} index={i} />
            ))}
          </div>
        )}
      </div>

      {/* Pagination */}
      {meta.pages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <button
            onClick={() => setPage(p => Math.max(1, p - 1))}
            disabled={page <= 1}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 text-xs hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <ChevronLeft className="w-3.5 h-3.5" /> Prev
          </button>
          <span className="text-xs">Page {page} of {meta.pages}</span>
          <button
            onClick={() => setPage(p => Math.min(meta.pages, p + 1))}
            disabled={page >= meta.pages}
            className="inline-flex items-center gap-1 px-3 py-1.5 rounded-lg border border-gray-200 text-xs hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Next <ChevronRight className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
    </div>
  )
}
