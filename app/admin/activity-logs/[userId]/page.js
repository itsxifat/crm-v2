'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { useParams } from 'next/navigation'
import {
  Clock, Monitor, Globe, Activity,
} from 'lucide-react'
import Select from '@/components/ui/Select'
import DatePicker from '@/components/ui/DatePicker'
import Button from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import PageHeader from '@/components/ui/PageHeader'
import Badge from '@/components/ui/Badge'
import Avatar from '@/components/ui/Avatar'
import EmptyState from '@/components/ui/EmptyState'
import Pagination from '@/components/ui/Pagination'
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

const ROLE_VARIANT = {
  SUPER_ADMIN: 'purple',
  MANAGER:     'primary',
  EMPLOYEE:    'success',
  FREELANCER:  'orange',
  CLIENT:      'teal',
  VENDOR:      'default',
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
  LOGIN:         { label: 'Login',          variant: 'success' },
  CREATE:        { label: 'Create',         variant: 'primary' },
  UPDATE:        { label: 'Update',         variant: 'warning' },
  DELETE:        { label: 'Delete',         variant: 'danger'  },
  SEND:          { label: 'Send',           variant: 'purple'  },
  STATUS_CHANGE: { label: 'Status change',  variant: 'teal'    },
  APPROVE:       { label: 'Approve',        variant: 'teal'    },
  REJECT:        { label: 'Reject',         variant: 'orange'  },
  CONVERT:       { label: 'Convert',        variant: 'indigo'  },
  PAYMENT:       { label: 'Payment',        variant: 'success' },
  DEACTIVATE:    { label: 'Deactivate',     variant: 'danger'  },
  REACTIVATE:    { label: 'Reactivate',     variant: 'success' },
  MEMBER_ADD:    { label: 'Member added',   variant: 'primary' },
  MEMBER_REMOVE: { label: 'Member removed', variant: 'orange'  },
  PASSWORD_RESET_APPROVE: { label: 'Reset approved', variant: 'teal'   },
  PASSWORD_RESET_REJECT:  { label: 'Reset rejected', variant: 'danger' },
  // Inventory & assets
  ASSIGN:        { label: 'Assign',         variant: 'primary' },
  RETURN:        { label: 'Return',         variant: 'teal'    },
  TRANSFER:      { label: 'Transfer',       variant: 'indigo'  },
  DISPOSE:       { label: 'Dispose',        variant: 'orange'  },
  WRITE_OFF:     { label: 'Write-off',      variant: 'danger'  },
  SELL:          { label: 'Sell',           variant: 'success' },
  DEPRECIATE:    { label: 'Depreciate',     variant: 'purple'  },
  // Finance & tax
  RECONCILE:     { label: 'Reconcile',      variant: 'success' },
  LOCK:          { label: 'Lock',           variant: 'warning' },
  UNLOCK:        { label: 'Unlock',         variant: 'orange'  },
  FILE_RETURN:   { label: 'File return',    variant: 'purple'  },
  DEPOSIT:       { label: 'Deposit',        variant: 'success' },
  ISSUE_NOTE:    { label: 'Issue note',     variant: 'teal'    },
  VOID:          { label: 'Void',           variant: 'danger'  },
  ARCHIVE:       { label: 'Archive',        variant: 'default' },
  RESTORE:       { label: 'Restore',        variant: 'success' },
  REVERSE:       { label: 'Reverse',        variant: 'orange'  },
  UNDO:          { label: 'Undo',           variant: 'warning' },
  CANCEL:        { label: 'Cancel',         variant: 'danger'  },
  EXPORT:        { label: 'Export',         variant: 'default' },
  IMPORT:        { label: 'Import',         variant: 'primary' },
}

// Timeline dot colour per badge variant (static class names so Tailwind generates them).
const DOT = {
  success: 'bg-emerald-500', primary: 'bg-blue-500',   warning: 'bg-amber-500', danger: 'bg-red-500',
  purple:  'bg-violet-500',  teal:    'bg-teal-500',   orange:  'bg-orange-500', indigo: 'bg-indigo-500',
  default: 'bg-gray-400',
}

function ActionBadge({ action }) {
  const cfg = ACTION_CONFIG[action] ?? { label: action, variant: 'default' }
  return <Badge variant={cfg.variant}>{cfg.label}</Badge>
}

// ─── Log timeline ─────────────────────────────────────────────────────────────

function LogRow({ log, index }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className={cn('group flex gap-4', index > 0 && 'border-t border-gray-100')}>
      {/* Timeline spine */}
      <div className="flex flex-col items-center pt-5">
        <div className={cn('size-2 shrink-0 rounded-full', DOT[ACTION_CONFIG[log.action]?.variant] ?? 'bg-gray-300')} />
        <div className="mt-1 w-px flex-1 bg-gray-100" />
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1 py-3.5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex flex-wrap items-center gap-2">
            <ActionBadge action={log.action} />
            <span className="text-sm text-gray-900">
              {log.entity}
              {log.entityId && log.entityId !== log.user?.id && (
                <span className="ml-1 font-mono text-xs text-muted-foreground">#{log.entityId.slice(-6)}</span>
              )}
            </span>
          </div>
          <span
            className="cursor-default whitespace-nowrap text-xs text-muted-foreground"
            title={formatDate(log.createdAt)}
          >
            {timeAgo(log.createdAt)}
          </span>
        </div>

        {/* Meta row */}
        <div className="mt-1.5 flex flex-wrap items-center gap-3">
          {log.ipAddress && (
            <span className="flex items-center gap-1 text-xs text-muted-foreground">
              <Globe className="size-3" /> {log.ipAddress}
            </span>
          )}
          {log.userAgent && (
            <span className="flex max-w-xs items-center gap-1 truncate text-xs text-muted-foreground">
              <Monitor className="size-3 shrink-0" />
              <span className="truncate">{log.userAgent.substring(0, 60)}{log.userAgent.length > 60 ? '…' : ''}</span>
            </span>
          )}
        </div>

        {/* Changes */}
        {log.changes && (
          <div className="mt-1.5">
            <button
              type="button"
              onClick={() => setExpanded(e => !e)}
              className="text-xs font-medium text-gray-500 underline-offset-4 transition-colors hover:text-gray-900 hover:underline"
            >
              {expanded ? 'Hide details' : 'Show details'}
            </button>
            {expanded && (
              <pre className="mt-1.5 overflow-x-auto rounded-lg bg-gray-50 p-3 text-xs text-gray-700">
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
  const logsReqId = useRef(0)

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
    // A filter change fires one fetch with the old page and another after the
    // page resets — only the latest request may update state.
    const id = ++logsReqId.current
    setLogsLoading(true)
    const params = new URLSearchParams({ userId, page, limit: 25 })
    if (actionFilter) params.set('action', actionFilter)
    if (fromDate)     params.set('from', fromDate)
    if (toDate)       params.set('to', toDate)
    fetch(`/api/activity-logs?${params}`)
      .then(r => r.json())
      .then(d => {
        if (id !== logsReqId.current) return
        setLogs(d.data ?? [])
        setMeta(d.meta ?? { page: 1, total: 0, pages: 1 })
      })
      .catch(() => { if (id === logsReqId.current) setLogs([]) })
      .finally(() => { if (id === logsReqId.current) setLogsLoading(false) })
  }, [userId, page, actionFilter, fromDate, toDate])

  useEffect(() => { setPage(1) }, [actionFilter, fromDate, toDate])
  useEffect(() => { loadLogs() }, [loadLogs])

  const filtered = !!(actionFilter || fromDate || toDate)

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader
        back="/admin/activity-logs"
        backLabel="Activity logs"
        title={userLoading
          ? <span className="inline-block h-7 w-48 animate-pulse rounded-md bg-gray-100 align-middle" />
          : (user?.name ?? 'User activity')}
        meta={!userLoading && user ? (
          <>
            <Badge variant={ROLE_VARIANT[user.role] ?? 'default'}>{ROLE_LABEL[user.role] ?? user.role}</Badge>
            <Badge variant={user.isActive ? 'success' : 'default'} dot>{user.isActive ? 'Active' : 'Inactive'}</Badge>
          </>
        ) : null}
      >
        {!userLoading && user && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
            <span className="inline-flex items-center gap-2">
              <Avatar name={user.name ?? '?'} src={user.avatar} size="xs" />
              {user.email}
            </span>
            <span className="inline-flex items-center gap-1 text-xs">
              <Clock className="size-3" />
              Last login {user.lastLogin ? formatDate(user.lastLogin) : 'never'}
            </span>
          </div>
        )}
      </PageHeader>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={actionFilter}
          onChange={v => setActionFilter(v ?? '')}
          options={Object.entries(ACTION_CONFIG).map(([action, cfg]) => ({ value: action, label: cfg.label }))}
          placeholder="All actions"
          size="sm"
          className="w-full sm:w-44"
        />
        <div className="flex items-center gap-1.5">
          <DatePicker value={fromDate || null} onChange={v => setFromDate(v ?? '')} />
          <span className="text-xs text-muted-foreground">to</span>
          <DatePicker value={toDate || null} onChange={v => setToDate(v ?? '')} />
        </div>
        {filtered && (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => { setActionFilter(''); setFromDate(''); setToDate('') }}
          >
            Clear
          </Button>
        )}
        {!logsLoading && (
          <p className="text-xs text-muted-foreground tabular-nums sm:ml-auto">
            {meta.total} activit{meta.total !== 1 ? 'ies' : 'y'}{filtered ? ' (filtered)' : ''}
          </p>
        )}
      </div>

      {/* Timeline */}
      <Card className="overflow-hidden px-5">
        {logsLoading ? (
          <div className="space-y-4 py-4">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex gap-4">
                <div className="mt-4 size-2 shrink-0 rounded-full bg-gray-200" />
                <div className="flex-1 space-y-1.5 py-3">
                  <div className="h-4 w-40 animate-pulse rounded-md bg-gray-100" />
                  <div className="h-3 w-64 animate-pulse rounded-md bg-gray-100" />
                </div>
              </div>
            ))}
          </div>
        ) : logs.length === 0 ? (
          <EmptyState icon={Activity} title="No activity found" />
        ) : (
          <div>
            {logs.map((log, i) => (
              <LogRow key={log.id} log={log} index={i} />
            ))}
          </div>
        )}
      </Card>

      {/* Pagination */}
      {meta.pages > 1 && (
        <Pagination page={page} pages={meta.pages} onChange={setPage} />
      )}
    </div>
  )
}
