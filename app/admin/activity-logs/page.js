'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import Link from 'next/link'
import {
  Users, UserCheck, UserCog, Building2, ShieldCheck,
  Briefcase, Clock, ChevronRight, X, Search, RefreshCw,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import Button, { buttonVariants } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import PageHeader from '@/components/ui/PageHeader'
import Badge from '@/components/ui/Badge'
import Avatar from '@/components/ui/Avatar'
import EmptyState from '@/components/ui/EmptyState'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import Pagination from '@/components/ui/Pagination'
import { NativeSelect, inputClass } from '@/components/ui/Input'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'

// ─── Helpers ──────────────────────────────────────────────────────────────────

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

function formatDate(date) {
  if (!date) return '—'
  return new Date(date).toLocaleString()
}

// ─── Role config ──────────────────────────────────────────────────────────────

const ROLE_CONFIG = {
  SUPER_ADMIN: { label: 'Super Admin', icon: ShieldCheck, variant: 'purple'  },
  MANAGER:     { label: 'Manager',     icon: Briefcase,   variant: 'primary' },
  EMPLOYEE:    { label: 'Employee',    icon: Users,       variant: 'success' },
  FREELANCER:  { label: 'Freelancer',  icon: UserCog,     variant: 'orange'  },
  CLIENT:      { label: 'Client',      icon: UserCheck,   variant: 'teal'    },
  VENDOR:      { label: 'Vendor',      icon: Building2,   variant: 'default' },
}

// ─── Role stat card ───────────────────────────────────────────────────────────

function RoleCard({ role, activeCount, totalCount, lastLogin, selected, onClick }) {
  const cfg  = ROLE_CONFIG[role] ?? ROLE_CONFIG.VENDOR
  const Icon = cfg.icon
  const pct  = totalCount > 0 ? Math.round((activeCount / totalCount) * 100) : 0

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'w-full rounded-xl border bg-white p-4 text-left shadow-xs transition-all duration-150',
        selected ? 'border-gray-900 ring-1 ring-gray-900' : 'border-gray-200/80 hover:border-gray-300 hover:shadow-sm',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <p className="truncate text-[13px] font-medium text-muted-foreground">{cfg.label}</p>
        <Icon className="size-4 shrink-0 text-gray-400" />
      </div>

      <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums text-gray-900">
        {activeCount}
        <span className="ml-1 text-xs font-normal text-muted-foreground">/ {totalCount} enabled</span>
      </p>

      {/* Progress bar */}
      <div className="mt-2.5 h-1 overflow-hidden rounded-full bg-gray-100">
        <div className="h-full rounded-full bg-gray-900 transition-all" style={{ width: `${pct}%` }} />
      </div>

      <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground">
        <Clock className="size-3" /> {timeAgo(lastLogin)}
      </p>
    </button>
  )
}

// ─── Active users slide panel ─────────────────────────────────────────────────

function ActiveUsersPanel({ role, onClose }) {
  const cfg = ROLE_CONFIG[role] ?? ROLE_CONFIG.VENDOR
  const [users, setUsers]     = useState([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    setLoading(true)
    fetch(`/api/activity-logs/stats?role=${role}`)
      .then(r => r.json())
      .then(d => setUsers(d.users ?? []))
      .catch(() => setUsers([]))
      .finally(() => setLoading(false))
  }, [role])

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex w-80 max-w-full flex-col border-l border-gray-200/80 bg-white shadow-2xl">
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-5 pb-3 pt-5">
        <div className="min-w-0">
          <p className="text-base font-semibold text-gray-900">{cfg.label}s</p>
          <p className="mt-0.5 text-xs text-muted-foreground">{users.length} enabled account{users.length !== 1 ? 's' : ''} · not real-time</p>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} className="-mr-1.5 text-gray-400" aria-label="Close">
          <X />
        </Button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto py-2">
        {loading ? (
          <LoadingSpinner className="h-32" />
        ) : users.length === 0 ? (
          <EmptyState icon={cfg.icon} title={`No active ${cfg.label.toLowerCase()}s`} />
        ) : (
          users.map(u => (
            <Link
              key={u.id}
              href={`/admin/activity-logs/${u.id}`}
              className="group flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-gray-50"
            >
              <Avatar name={u.name} src={u.avatar} size="sm" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium text-gray-900">{u.name}</p>
                <p className="truncate text-xs text-muted-foreground">{u.email}</p>
              </div>
              <div className="flex shrink-0 items-center gap-1.5 text-right">
                <span className="text-xs text-muted-foreground" title="Last login">{timeAgo(u.lastLogin)}</span>
                <ChevronRight className="size-4 text-gray-300 transition-colors group-hover:text-gray-500" />
              </div>
            </Link>
          ))
        )}
      </div>
    </div>
  )
}

// ─── Users table ──────────────────────────────────────────────────────────────

function UsersTable({ search, roleFilter }) {
  const [users, setUsers]     = useState([])
  const [meta,  setMeta]      = useState({ page: 1, total: 0, pages: 1 })
  const [page,  setPage]      = useState(1)
  const [loading, setLoading] = useState(true)
  const reqId = useRef(0)

  const load = useCallback(async () => {
    // Only the latest request may update state (a search change fetches with
    // the old page before the page-reset effect fetches page 1).
    const id = ++reqId.current
    setLoading(true)
    const params = new URLSearchParams({ page, limit: 20 })
    if (search)     params.set('search', search)
    if (roleFilter) params.set('role', roleFilter)
    try {
      const res  = await fetch(`/api/users?${params}`)
      const json = await res.json()
      if (id !== reqId.current) return
      setUsers(json.data ?? [])
      setMeta(json.meta ?? { page: 1, total: 0, pages: 1 })
    } catch {
      if (id === reqId.current) setUsers([])
    } finally {
      if (id === reqId.current) setLoading(false)
    }
  }, [page, search, roleFilter])

  useEffect(() => { setPage(1) }, [search, roleFilter])
  useEffect(() => { load() }, [load])

  const roleBadge = (role) => {
    const cfg = ROLE_CONFIG[role] ?? ROLE_CONFIG.VENDOR
    return <Badge variant={cfg.variant}>{cfg.label}</Badge>
  }

  return (
    <Card className="overflow-hidden">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>User</TableHead>
            <TableHead>Role</TableHead>
            <TableHead className="hidden md:table-cell">Email</TableHead>
            <TableHead>Last login</TableHead>
            <TableHead>Status</TableHead>
            <TableHead />
          </TableRow>
        </TableHeader>
        <TableBody>
          {loading ? (
            Array.from({ length: 5 }).map((_, i) => (
              <TableRow key={i} className="hover:bg-transparent">
                {Array.from({ length: 6 }).map((__, j) => (
                  <TableCell key={j}>
                    <div className="h-4 animate-pulse rounded-md bg-gray-100" />
                  </TableCell>
                ))}
              </TableRow>
            ))
          ) : users.length === 0 ? (
            <TableRow className="hover:bg-transparent">
              <TableCell colSpan={6} className="p-0">
                <EmptyState icon={Users} title="No users found" />
              </TableCell>
            </TableRow>
          ) : (
            users.map(u => (
              <TableRow key={u._id ?? u.id}>
                <TableCell>
                  <div className="flex items-center gap-2.5">
                    <Avatar name={u.name ?? '?'} src={u.avatar} size="xs" />
                    <span className="font-medium text-gray-900">{u.name}</span>
                  </div>
                </TableCell>
                <TableCell>{roleBadge(u.role)}</TableCell>
                <TableCell className="hidden text-muted-foreground md:table-cell">{u.email}</TableCell>
                <TableCell className="whitespace-nowrap text-muted-foreground">
                  <span title={formatDate(u.lastLogin)}>{timeAgo(u.lastLogin)}</span>
                </TableCell>
                <TableCell>
                  <Badge variant={u.isActive ? 'success' : 'default'} dot>{u.isActive ? 'Active' : 'Inactive'}</Badge>
                </TableCell>
                <TableCell className="text-right">
                  <Link
                    href={`/admin/activity-logs/${u._id ?? u.id}`}
                    className={buttonVariants({ variant: 'ghost', size: 'xs' })}
                  >
                    View logs
                    <ChevronRight />
                  </Link>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      {/* Pagination */}
      {meta.pages > 1 && (
        <div className="border-t border-gray-100 px-4 py-3">
          <Pagination page={page} pages={meta.pages} total={meta.total} limit={20} onChange={setPage} />
        </div>
      )}
    </Card>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ActivityLogsPage() {
  const [stats,        setStats]        = useState(null)
  const [statsLoading, setStatsLoading] = useState(true)
  const [activePanel,  setActivePanel]  = useState(null) // role string or null
  const [search,       setSearch]       = useState('')
  const [roleFilter,   setRoleFilter]   = useState('')
  const [searchInput,  setSearchInput]  = useState('')

  const loadStats = useCallback(() => {
    setStatsLoading(true)
    fetch('/api/activity-logs/stats')
      .then(r => r.json())
      .then(d => setStats(d))
      .catch(() => setStats(null))
      .finally(() => setStatsLoading(false))
  }, [])

  useEffect(() => { loadStats() }, [loadStats])

  // Debounce search
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput), 350)
    return () => clearTimeout(t)
  }, [searchInput])

  const handleCardClick = (role) => {
    setActivePanel(prev => prev === role ? null : role)
  }

  return (
    <div className="space-y-6">
      <PageHeader
        title="Activity logs"
        description="Logs retained for 356 days"
        meta={!statsLoading && stats ? (
          <Badge variant="outline" className="tabular-nums">{stats.totalActive} / {stats.totalUsers} enabled</Badge>
        ) : null}
        actions={
          <Button variant="outline" onClick={loadStats}>
            <RefreshCw /> Refresh
          </Button>
        }
      />

      {/* Role stat cards */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-6">
        {statsLoading
          ? Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-32 animate-pulse rounded-xl bg-gray-100" />
            ))
          : (stats?.roles ?? []).map(r => (
              <RoleCard
                key={r.role}
                role={r.role}
                activeCount={r.activeCount}
                totalCount={r.totalCount}
                lastLogin={r.lastLogin}
                selected={activePanel === r.role}
                onClick={() => handleCardClick(r.role)}
              />
            ))
        }
      </div>

      {/* Overlay backdrop */}
      {activePanel && (
        <div
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[2px]"
          onClick={() => setActivePanel(null)}
        />
      )}

      {/* Active users slide panel */}
      {activePanel && (
        <ActiveUsersPanel role={activePanel} onClose={() => setActivePanel(null)} />
      )}

      {/* Users table section */}
      <div className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative w-full sm:w-64">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
            <input
              type="text"
              placeholder="Search…"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              className={cn(inputClass, 'pl-9')}
            />
          </div>
          <NativeSelect
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value)}
            className="w-full sm:w-44"
          >
            <option value="">All roles</option>
            {Object.entries(ROLE_CONFIG).map(([role, cfg]) => (
              <option key={role} value={role}>{cfg.label}</option>
            ))}
          </NativeSelect>
        </div>

        <UsersTable search={search} roleFilter={roleFilter} />
      </div>
    </div>
  )
}
