'use client'

import { useEffect, useState, useCallback } from 'react'
import Link from 'next/link'
import Image from 'next/image'
import {
  Activity, Users, UserCheck, UserCog, Building2, ShieldCheck,
  Briefcase, Clock, ChevronRight, X, Search, RefreshCw,
  LogIn, AlertCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'

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
  SUPER_ADMIN: {
    label: 'Super Admin',
    icon:  ShieldCheck,
    bg:    'bg-violet-50',
    border:'border-violet-200',
    badge: 'bg-violet-100 text-violet-700',
    dot:   'bg-violet-500',
    text:  'text-violet-700',
    ring:  'ring-violet-300',
  },
  MANAGER: {
    label: 'Manager',
    icon:  Briefcase,
    bg:    'bg-blue-50',
    border:'border-blue-200',
    badge: 'bg-blue-100 text-blue-700',
    dot:   'bg-blue-500',
    text:  'text-blue-700',
    ring:  'ring-blue-300',
  },
  EMPLOYEE: {
    label: 'Employee',
    icon:  Users,
    bg:    'bg-emerald-50',
    border:'border-emerald-200',
    badge: 'bg-emerald-100 text-emerald-700',
    dot:   'bg-emerald-500',
    text:  'text-emerald-700',
    ring:  'ring-emerald-300',
  },
  FREELANCER: {
    label: 'Freelancer',
    icon:  UserCog,
    bg:    'bg-orange-50',
    border:'border-orange-200',
    badge: 'bg-orange-100 text-orange-700',
    dot:   'bg-orange-500',
    text:  'text-orange-700',
    ring:  'ring-orange-300',
  },
  CLIENT: {
    label: 'Client',
    icon:  UserCheck,
    bg:    'bg-cyan-50',
    border:'border-cyan-200',
    badge: 'bg-cyan-100 text-cyan-700',
    dot:   'bg-cyan-500',
    text:  'text-cyan-700',
    ring:  'ring-cyan-300',
  },
  VENDOR: {
    label: 'Vendor',
    icon:  Building2,
    bg:    'bg-slate-50',
    border:'border-slate-200',
    badge: 'bg-slate-100 text-slate-600',
    dot:   'bg-slate-400',
    text:  'text-slate-600',
    ring:  'ring-slate-300',
  },
}

// ─── Role stat card ───────────────────────────────────────────────────────────

function RoleCard({ role, activeCount, totalCount, lastLogin, selected, onClick }) {
  const cfg  = ROLE_CONFIG[role] ?? ROLE_CONFIG.VENDOR
  const Icon = cfg.icon
  const pct  = totalCount > 0 ? Math.round((activeCount / totalCount) * 100) : 0

  return (
    <button
      onClick={onClick}
      className={cn(
        'w-full text-left p-4 rounded-xl border transition-all duration-150',
        cfg.bg, cfg.border,
        selected ? `ring-2 ${cfg.ring} shadow-md` : 'hover:shadow-sm hover:ring-1 ' + cfg.ring,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className={cn('p-2 rounded-lg', 'bg-white/70')}>
          <Icon className={cn('w-4 h-4', cfg.text)} />
        </div>
        <span className={cn('text-xs font-semibold px-2 py-0.5 rounded-full', cfg.badge)}>
          {activeCount} enabled
        </span>
      </div>

      <p className={cn('mt-3 text-sm font-semibold', cfg.text)}>{cfg.label}</p>
      <p className="text-xs text-gray-500 mt-0.5">{activeCount} / {totalCount} users active</p>

      {/* Progress bar */}
      <div className="mt-2.5 h-1 bg-white/60 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', cfg.dot)}
          style={{ width: `${pct}%` }}
        />
      </div>

      <div className="mt-2 flex items-center gap-1 text-xs text-gray-400">
        <Clock className="w-3 h-3" />
        <span>Last login: {timeAgo(lastLogin)}</span>
      </div>
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
    <div className="fixed inset-y-0 right-0 z-50 w-80 bg-white border-l border-gray-200 shadow-xl flex flex-col">
      {/* Header */}
      <div className={cn('flex items-center justify-between px-4 py-3 border-b', cfg.bg, cfg.border)}>
        <div>
          <p className={cn('text-sm font-semibold', cfg.text)}>{cfg.label}s — Enabled Accounts</p>
          <p className="text-xs text-gray-500">{users.length} account{users.length !== 1 ? 's' : ''} · not real-time</p>
        </div>
        <button
          onClick={onClose}
          className="p-1.5 rounded-md text-gray-400 hover:text-gray-700 hover:bg-white/60 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto py-2">
        {loading ? (
          <div className="flex items-center justify-center h-32 text-gray-400 text-sm">
            Loading…
          </div>
        ) : users.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-32 gap-2 text-gray-400">
            <AlertCircle className="w-5 h-5" />
            <p className="text-sm">No active {cfg.label.toLowerCase()}s</p>
          </div>
        ) : (
          users.map(u => (
            <Link
              key={u.id}
              href={`/admin/activity-logs/${u.id}`}
              className="flex items-center gap-3 px-4 py-2.5 hover:bg-gray-50 transition-colors group"
            >
              {/* Avatar */}
              <div className={cn('w-8 h-8 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0', cfg.dot)}>
                {u.avatar
                  ? <Image src={u.avatar} alt="" width={32} height={32} className="w-8 h-8 rounded-full object-cover" />
                  : u.name.charAt(0).toUpperCase()
                }
              </div>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-gray-800 truncate">{u.name}</p>
                <p className="text-xs text-gray-400 truncate">{u.email}</p>
              </div>
              <div className="text-right shrink-0">
                <p className="text-xs text-gray-400">Last login</p>
                <p className="text-xs font-medium text-gray-600">{timeAgo(u.lastLogin)}</p>
                <ChevronRight className="w-3.5 h-3.5 text-gray-300 group-hover:text-gray-500 ml-auto mt-0.5 transition-colors" />
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

  const load = useCallback(async () => {
    setLoading(true)
    const params = new URLSearchParams({ page, limit: 20 })
    if (search)     params.set('search', search)
    if (roleFilter) params.set('role', roleFilter)
    try {
      const res  = await fetch(`/api/users?${params}`)
      const json = await res.json()
      setUsers(json.data ?? [])
      setMeta(json.meta ?? { page: 1, total: 0, pages: 1 })
    } catch {
      setUsers([])
    } finally {
      setLoading(false)
    }
  }, [page, search, roleFilter])

  useEffect(() => { setPage(1) }, [search, roleFilter])
  useEffect(() => { load() }, [load])

  const roleBadge = (role) => {
    const cfg = ROLE_CONFIG[role] ?? ROLE_CONFIG.VENDOR
    return (
      <span className={cn('text-xs px-2 py-0.5 rounded-full font-medium', cfg.badge)}>
        {cfg.label}
      </span>
    )
  }

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wider">User</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wider">Role</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wider hidden md:table-cell">Email</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wider">Last Login</th>
              <th className="text-left px-4 py-3 font-semibold text-gray-600 text-xs uppercase tracking-wider">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {loading ? (
              Array.from({ length: 5 }).map((_, i) => (
                <tr key={i}>
                  {Array.from({ length: 6 }).map((__, j) => (
                    <td key={j} className="px-4 py-3">
                      <div className="h-4 bg-gray-100 rounded animate-pulse" />
                    </td>
                  ))}
                </tr>
              ))
            ) : users.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-10 text-center text-gray-400 text-sm">
                  No users found
                </td>
              </tr>
            ) : (
              users.map(u => (
                <tr key={u._id ?? u.id} className="hover:bg-gray-50/50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2.5">
                      <div className={cn(
                        'w-7 h-7 rounded-full flex items-center justify-center text-xs font-semibold text-white shrink-0',
                        ROLE_CONFIG[u.role]?.dot ?? 'bg-gray-400',
                      )}>
                        {u.avatar
                          ? <Image src={u.avatar} alt="" width={28} height={28} className="w-7 h-7 rounded-full object-cover" />
                          : (u.name ?? '?').charAt(0).toUpperCase()
                        }
                      </div>
                      <span className="font-medium text-gray-800">{u.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">{roleBadge(u.role)}</td>
                  <td className="px-4 py-3 text-gray-500 hidden md:table-cell">{u.email}</td>
                  <td className="px-4 py-3 text-gray-500 whitespace-nowrap">
                    <span title={formatDate(u.lastLogin)}>{timeAgo(u.lastLogin)}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cn(
                      'inline-flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full',
                      u.isActive
                        ? 'bg-emerald-100 text-emerald-700'
                        : 'bg-gray-100 text-gray-500',
                    )}>
                      <span className={cn('w-1.5 h-1.5 rounded-full', u.isActive ? 'bg-emerald-500' : 'bg-gray-400')} />
                      {u.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <Link
                      href={`/admin/activity-logs/${u._id ?? u.id}`}
                      className="inline-flex items-center gap-1 text-xs font-medium text-gray-500 hover:text-gray-900 transition-colors"
                    >
                      View Logs
                      <ChevronRight className="w-3.5 h-3.5" />
                    </Link>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {meta.pages > 1 && (
        <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100 text-sm text-gray-500">
          <span>{meta.total} user{meta.total !== 1 ? 's' : ''}</span>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page <= 1}
              className="px-2.5 py-1 rounded border border-gray-200 text-xs hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Prev
            </button>
            <span className="text-xs">Page {page} / {meta.pages}</span>
            <button
              onClick={() => setPage(p => Math.min(meta.pages, p + 1))}
              disabled={page >= meta.pages}
              className="px-2.5 py-1 rounded border border-gray-200 text-xs hover:bg-gray-50 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
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
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900 flex items-center gap-2">
            <Activity className="w-5 h-5 text-gray-500" />
            Activity Logs
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">
            User activity footprints — retained for 356 days
          </p>
        </div>
        <button
          onClick={loadStats}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 px-3 py-1.5 rounded-lg border border-gray-200 hover:bg-gray-50 transition-colors"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          Refresh
        </button>
      </div>

      {/* Summary strip */}
      {!statsLoading && stats && (
        <div className="flex items-center gap-4 text-sm text-gray-600 bg-white border border-gray-100 rounded-xl px-4 py-3">
          <LogIn className="w-4 h-4 text-gray-400 shrink-0" />
          <span>
            <span className="font-semibold text-gray-900">{stats.totalActive}</span> enabled accounts
            {' '}out of{' '}
            <span className="font-semibold text-gray-900">{stats.totalUsers}</span> total
          </span>
          <span className="text-gray-300">|</span>
          <span className="text-xs text-gray-400">Click a role card to see enabled accounts &amp; last login times</span>
        </div>
      )}

      {/* Role stat cards */}
      <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-3">
        {statsLoading
          ? Array.from({ length: 6 }).map((_, i) => (
              <div key={i} className="h-36 bg-gray-100 rounded-xl animate-pulse" />
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
          className="fixed inset-0 z-40 bg-black/10"
          onClick={() => setActivePanel(null)}
        />
      )}

      {/* Active users slide panel */}
      {activePanel && (
        <ActiveUsersPanel role={activePanel} onClose={() => setActivePanel(null)} />
      )}

      {/* Users table section */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row sm:items-center gap-3">
          <div className="relative flex-1 max-w-sm">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400 pointer-events-none" />
            <input
              type="text"
              placeholder="Search by name or email…"
              value={searchInput}
              onChange={e => setSearchInput(e.target.value)}
              className="w-full pl-9 pr-3 py-2 text-sm border border-gray-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-gray-900/10 bg-white"
            />
          </div>
          <select
            value={roleFilter}
            onChange={e => setRoleFilter(e.target.value)}
            className="text-sm border border-gray-200 rounded-lg px-3 py-2 bg-white focus:outline-none focus:ring-2 focus:ring-gray-900/10"
          >
            <option value="">All Roles</option>
            {Object.entries(ROLE_CONFIG).map(([role, cfg]) => (
              <option key={role} value={role}>{cfg.label}</option>
            ))}
          </select>
        </div>

        <UsersTable search={search} roleFilter={roleFilter} />
      </div>
    </div>
  )
}
