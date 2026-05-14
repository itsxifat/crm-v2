'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { FolderOpen, Search, Clock, ChevronRight } from 'lucide-react'

const STATUS_OPTIONS = ['ALL', 'PLANNING', 'IN_PROGRESS', 'ON_HOLD', 'COMPLETED', 'CANCELLED']

function StatusBadge({ status }) {
  const map = {
    PLANNING:    { label: 'Planning',    bg: 'bg-gray-100',    text: 'text-gray-700' },
    IN_PROGRESS: { label: 'In Progress', bg: 'bg-blue-100',    text: 'text-blue-700' },
    ON_HOLD:     { label: 'On Hold',     bg: 'bg-yellow-100',  text: 'text-yellow-700' },
    COMPLETED:   { label: 'Completed',   bg: 'bg-green-100',   text: 'text-green-700' },
    CANCELLED:   { label: 'Cancelled',   bg: 'bg-red-100',     text: 'text-red-700' },
  }
  const s = map[status] || map.PLANNING
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  )
}


export default function ClientProjectsPage() {
  const [projects, setProjects] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [statusFilter, setStatusFilter] = useState('ALL')
  const [search, setSearch] = useState('')

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

  const filtered = projects.filter((p) => {
    const matchStatus = statusFilter === 'ALL' || p.status === statusFilter
    const matchSearch = p.name.toLowerCase().includes(search.toLowerCase())
    return matchStatus && matchSearch
  })

  if (loading) {
    return (
      <div>
        <div className="h-7 bg-gray-200 rounded animate-pulse w-32 mb-6" />
        <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-50">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="flex items-center gap-4 p-4 animate-pulse">
              <div className="flex-1 min-w-0">
                <div className="h-4 bg-gray-200 rounded w-1/3 mb-2" />
                <div className="h-2 bg-gray-200 rounded-full w-full" />
              </div>
              <div className="h-5 bg-gray-200 rounded-full w-20 flex-shrink-0" />
              <div className="h-3 bg-gray-200 rounded w-16 flex-shrink-0 hidden sm:block" />
              <div className="w-4 h-4 bg-gray-200 rounded flex-shrink-0" />
            </div>
          ))}
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-center py-20">
        <p className="text-red-500">{error}</p>
      </div>
    )
  }

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">My Projects</h1>
          <p className="text-sm text-gray-500 mt-0.5">{projects.length} project{projects.length !== 1 ? 's' : ''} total</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-3 mb-6">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
          <input
            type="text"
            placeholder="Search projects..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full pl-9 pr-4 py-2.5 bg-white border border-gray-200 rounded-xl text-sm text-gray-800 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
          />
        </div>

        <div className="flex gap-2 flex-wrap">
          {STATUS_OPTIONS.map((s) => (
            <button
              key={s}
              onClick={() => setStatusFilter(s)}
              className={`px-3 py-2 rounded-xl text-xs font-medium border transition-colors ${
                statusFilter === s
                  ? 'bg-blue-600 text-white border-blue-600'
                  : 'bg-white text-gray-600 border-gray-200 hover:border-blue-300 hover:text-blue-600'
              }`}
            >
              {s === 'ALL' ? 'All' : s.replace('_', ' ')}
            </button>
          ))}
        </div>
      </div>

      {/* Projects List */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-16 text-center">
          <FolderOpen className="w-14 h-14 text-gray-200 mx-auto mb-4" />
          <h3 className="text-gray-600 font-semibold text-lg">No projects found</h3>
          <p className="text-gray-400 text-sm mt-1">
            {statusFilter !== 'ALL' ? 'Try changing the status filter.' : 'You have no projects yet.'}
          </p>
        </div>
      ) : (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm divide-y divide-gray-50">
          {filtered.map((project) => {
            const totalTasks = project._count?.tasks || 0
            const completedTasks = project.completedTaskCount || 0
            const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0

            return (
              <Link key={project.id} href={`/client/projects/${project.id}`}>
                <div className="flex items-center gap-4 px-5 py-4 hover:bg-gray-50 transition-colors group">
                  {/* Name + progress */}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-semibold text-gray-900 truncate">{project.name}</p>
                    <div className="flex items-center gap-2 mt-1.5">
                      <div className="flex-1 max-w-xs bg-gray-100 rounded-full h-1.5">
                        <div
                          className="bg-blue-500 h-1.5 rounded-full transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                      <span className="text-xs text-gray-400 flex-shrink-0">{progress}%</span>
                    </div>
                  </div>

                  {/* Due date */}
                  {project.endDate ? (
                    <span className="hidden sm:flex items-center gap-1 text-xs text-gray-400 flex-shrink-0">
                      <Clock className="w-3 h-3" />
                      {new Date(project.endDate).toLocaleDateString()}
                    </span>
                  ) : (
                    <span className="hidden sm:block w-20" />
                  )}

                  {/* Status */}
                  <div className="flex-shrink-0">
                    <StatusBadge status={project.status} />
                  </div>

                  {/* Arrow */}
                  <ChevronRight className="w-4 h-4 text-gray-300 flex-shrink-0 group-hover:text-blue-500 transition-colors" />
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
