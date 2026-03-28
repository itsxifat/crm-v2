'use client'

import { useState, useEffect } from 'react'
import Link from 'next/link'
import { FolderOpen, Search, Filter, ArrowRight, Clock, ChevronRight } from 'lucide-react'

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

function PriorityBadge({ priority }) {
  const map = {
    LOW:    { label: 'Low',    bg: 'bg-gray-100',  text: 'text-gray-600' },
    MEDIUM: { label: 'Medium', bg: 'bg-blue-100',  text: 'text-blue-600' },
    HIGH:   { label: 'High',   bg: 'bg-orange-100',text: 'text-orange-600' },
    URGENT: { label: 'Urgent', bg: 'bg-red-100',   text: 'text-red-600' },
  }
  const s = map[priority] || map.MEDIUM
  return (
    <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-medium ${s.bg} ${s.text}`}>
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
        <div className="flex items-center justify-between mb-6">
          <div className="h-7 bg-gray-200 rounded animate-pulse w-32" />
        </div>
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {[...Array(6)].map((_, i) => (
            <div key={i} className="bg-white rounded-2xl border border-gray-100 p-6 animate-pulse">
              <div className="h-5 bg-gray-200 rounded w-3/4 mb-3" />
              <div className="h-3 bg-gray-200 rounded w-full mb-2" />
              <div className="h-3 bg-gray-200 rounded w-2/3 mb-4" />
              <div className="h-2 bg-gray-200 rounded-full w-full" />
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

      {/* Projects Grid */}
      {filtered.length === 0 ? (
        <div className="bg-white rounded-2xl border border-gray-100 p-16 text-center">
          <FolderOpen className="w-14 h-14 text-gray-200 mx-auto mb-4" />
          <h3 className="text-gray-600 font-semibold text-lg">No projects found</h3>
          <p className="text-gray-400 text-sm mt-1">
            {statusFilter !== 'ALL' ? 'Try changing the status filter.' : 'You have no projects yet.'}
          </p>
        </div>
      ) : (
        <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((project) => {
            const totalTasks = project._count?.tasks || 0
            const completedTasks = project.completedTaskCount || 0
            const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
            const nextMilestone = project.nextMilestone

            return (
              <Link key={project.id} href={`/client/projects/${project.id}`}>
                <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6 hover:shadow-md hover:border-blue-100 transition-all duration-200 h-full flex flex-col">
                  <div className="flex items-start justify-between mb-2">
                    <h3 className="font-semibold text-gray-900 text-base flex-1 pr-2 line-clamp-2">{project.name}</h3>
                    <StatusBadge status={project.status} />
                  </div>

                  <div className="flex items-center gap-2 mb-3">
                    <PriorityBadge priority={project.priority} />
                    {project.endDate && (
                      <span className="text-xs text-gray-400 flex items-center gap-1">
                        <Clock className="w-3 h-3" />
                        {new Date(project.endDate).toLocaleDateString()}
                      </span>
                    )}
                  </div>

                  {project.description && (
                    <p className="text-sm text-gray-500 mb-4 line-clamp-2 flex-1">{project.description}</p>
                  )}

                  <div className="mt-auto">
                    <div className="mb-3">
                      <div className="flex justify-between text-xs text-gray-500 mb-1.5">
                        <span>Progress</span>
                        <span className="font-semibold text-gray-700">{progress}%</span>
                      </div>
                      <div className="w-full bg-gray-100 rounded-full h-2">
                        <div
                          className="bg-blue-500 h-2 rounded-full transition-all"
                          style={{ width: `${progress}%` }}
                        />
                      </div>
                    </div>

                    {nextMilestone && (
                      <div className="text-xs text-gray-500 bg-blue-50 rounded-lg px-3 py-2 flex items-center gap-2">
                        <Clock className="w-3.5 h-3.5 text-blue-400 flex-shrink-0" />
                        <span className="line-clamp-1">Next: {nextMilestone.title}</span>
                      </div>
                    )}

                    <div className="flex items-center justify-end mt-3">
                      <span className="text-xs text-blue-600 font-medium flex items-center gap-0.5 hover:gap-1.5 transition-all">
                        View details <ChevronRight className="w-3.5 h-3.5" />
                      </span>
                    </div>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
