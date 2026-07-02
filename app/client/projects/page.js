'use client'

import { useState, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import { FolderOpen, Search, Clock, ChevronRight } from 'lucide-react'
import { STATUS_META } from '@/lib/ventures'
import ProjectStatusBadge from '@/components/portals/ProjectStatusBadge'

const fmtTk = (n) => `৳ ${(Number(n) || 0).toLocaleString('en-BD', { minimumFractionDigits: 0 })}`
const fmtDate = (d) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

export default function ClientProjectsPage() {
  const router = useRouter()
  const [projects, setProjects] = useState([])
  const [loading, setLoading]   = useState(true)
  const [error, setError]       = useState(null)
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [search, setSearch]     = useState('')

  useEffect(() => {
    const fetchProjects = async () => {
      try {
        const res = await fetch('/api/client/projects')
        if (!res.ok) throw new Error('Failed to load projects')
        const data = await res.json()
        setProjects(data.projects || [])
      } catch (err) {
        setError(err.message)
      } finally {
        setLoading(false)
      }
    }
    fetchProjects()
  }, [])

  // Build the status filter chips from the statuses actually present, with counts.
  const statusChips = useMemo(() => {
    const counts = {}
    for (const p of projects) counts[p.status] = (counts[p.status] ?? 0) + 1
    const chips = [{ key: 'ALL', label: 'All', count: projects.length }]
    for (const key of Object.keys(counts)) {
      chips.push({ key, label: STATUS_META[key]?.label ?? key, count: counts[key] })
    }
    return chips
  }, [projects])

  const filtered = projects.filter((p) => {
    const matchStatus = statusFilter === 'ALL' || p.status === statusFilter
    const matchSearch =
      p.name?.toLowerCase().includes(search.toLowerCase()) ||
      p.projectCode?.toLowerCase().includes(search.toLowerCase())
    return matchStatus && matchSearch
  })

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-7 bg-gray-200 rounded animate-pulse w-40" />
        <div className="bg-white rounded-xl border border-gray-100 divide-y divide-gray-50">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="flex items-center gap-4 p-4 animate-pulse">
              <div className="h-4 bg-gray-200 rounded w-20 flex-shrink-0" />
              <div className="h-4 bg-gray-200 rounded w-1/3" />
              <div className="h-5 bg-gray-200 rounded-full w-20 ml-auto flex-shrink-0" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <p className="text-red-500 text-sm">{error}</p>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">My Projects</h1>
        <p className="text-sm text-gray-500 mt-0.5">
          {projects.length} project{projects.length !== 1 ? 's' : ''} total
        </p>
      </div>

      {/* Status chips */}
      <div className="flex flex-wrap gap-2">
        {statusChips.map(({ key, label, count }) => (
          <button
            key={key}
            onClick={() => setStatusFilter(key)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors ${
              statusFilter === key
                ? 'bg-gray-900 text-white border-gray-900'
                : 'bg-white text-gray-600 border-gray-200 hover:border-gray-400 hover:text-gray-800'
            }`}
          >
            {label}
            <span className={statusFilter === key ? 'text-gray-300' : 'text-gray-400'}>{count}</span>
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="relative w-full sm:max-w-xs">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400" />
        <input
          type="text"
          placeholder="Search by name or ID…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="w-full pl-9 pr-3 py-2 bg-white border border-gray-200 rounded-lg text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
        {filtered.length === 0 ? (
          <div className="p-16 text-center">
            <FolderOpen className="w-12 h-12 text-gray-200 mx-auto mb-4" />
            <h3 className="text-gray-600 font-semibold">No projects found</h3>
            <p className="text-gray-400 text-sm mt-1">
              {statusFilter !== 'ALL' || search ? 'Try changing the filters.' : 'You have no projects yet.'}
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[820px]">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/60">
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide whitespace-nowrap">Project ID</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Project</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Type</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wide">Value</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wide">Paid</th>
                  <th className="px-4 py-3 text-right text-xs font-medium text-gray-400 uppercase tracking-wide">Due</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide whitespace-nowrap">Due / Renews</th>
                  <th className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">Status</th>
                  <th className="px-4 py-3 w-10" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {filtered.map((p) => {
                  const isMonthly = p.projectType === 'MONTHLY'
                  const due = isMonthly ? p.currentPeriodEnd : p.deadline
                  const isOverdue = due && new Date(due) < new Date()
                    && !['DELIVERED', 'CANCELLED', 'APPROVED', 'RENEWED'].includes(p.status)
                  return (
                    <tr
                      key={p.id}
                      onClick={() => router.push(`/client/projects/${p.id}`)}
                      className="hover:bg-gray-50/60 cursor-pointer transition-colors group"
                    >
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="text-sm font-mono font-medium text-gray-800">{p.projectCode ?? '—'}</span>
                      </td>
                      <td className="px-4 py-3 min-w-44">
                        <p className="text-sm font-medium text-gray-900 truncate max-w-[220px]">{p.name}</p>
                        {(p.category || p.subcategory) && (
                          <p className="text-xs text-gray-400 mt-0.5 truncate max-w-[220px]">
                            {p.category}{p.subcategory ? ` › ${p.subcategory}` : ''}
                          </p>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <span className="text-xs text-gray-500">{isMonthly ? 'Monthly' : 'Fixed'}</span>
                      </td>
                      <td className="px-4 py-3 text-right whitespace-nowrap text-sm text-gray-700">{fmtTk(p.netValue)}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap text-sm text-green-600">{fmtTk(p.paidAmount)}</td>
                      <td className="px-4 py-3 text-right whitespace-nowrap">
                        <span className={`text-sm ${p.dueAmount > 0 ? 'text-amber-600' : 'text-gray-400'}`}>{fmtTk(p.dueAmount)}</span>
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        {due ? (
                          <span className={`inline-flex items-center gap-1 text-xs ${isOverdue ? 'text-red-500' : 'text-gray-500'}`}>
                            <Clock className="w-3 h-3" />
                            {isOverdue ? 'Overdue · ' : ''}{fmtDate(due)}
                          </span>
                        ) : (
                          <span className="text-xs text-gray-300">—</span>
                        )}
                      </td>
                      <td className="px-4 py-3 whitespace-nowrap">
                        <ProjectStatusBadge status={p.status} />
                      </td>
                      <td className="px-4 py-3 text-right">
                        <ChevronRight className="w-4 h-4 text-gray-300 group-hover:text-blue-500 transition-colors" />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
