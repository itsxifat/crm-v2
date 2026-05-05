'use client'

import { useState, useEffect } from 'react'
import { toast } from 'react-hot-toast'
import { Loader2, FolderOpen } from 'lucide-react'

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

const STATUS_COLORS = {
  PENDING:     'bg-gray-100 text-gray-600',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  IN_REVIEW:   'bg-purple-100 text-purple-700',
  REVISION:    'bg-yellow-100 text-yellow-700',
  APPROVED:    'bg-teal-100 text-teal-700',
  DELIVERED:   'bg-green-100 text-green-700',
  ON_HOLD:     'bg-yellow-100 text-yellow-700',
  CANCELLED:   'bg-red-100 text-red-600',
}

const VENTURE_COLORS = {
  ENSTUDIO: 'bg-purple-100 text-purple-700',
  ENTECH:   'bg-blue-100 text-blue-700',
  ENMARK:   'bg-green-100 text-green-700',
}

export default function VendorDashboard() {
  const [projects, setProjects] = useState([])
  const [loading,  setLoading]  = useState(true)

  useEffect(() => {
    fetch('/api/projects?limit=100')
      .then(r => r.json())
      .then(j => setProjects(j.data ?? []))
      .catch(err => toast.error(err.message))
      .finally(() => setLoading(false))
  }, [])

  if (loading) return (
    <div className="flex justify-center py-20">
      <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
    </div>
  )

  return (
    <div className="space-y-6 max-w-5xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Vendor Dashboard</h1>
        <p className="text-sm text-gray-400 mt-0.5">View projects you are associated with</p>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white rounded-2xl border border-gray-100 p-5 flex items-center gap-4">
          <div className="w-10 h-10 bg-blue-50 rounded-xl flex items-center justify-center shrink-0">
            <FolderOpen className="w-5 h-5 text-blue-600" />
          </div>
          <div>
            <p className="text-lg font-semibold text-gray-900">{projects.length}</p>
            <p className="text-xs text-gray-400">Total Projects</p>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 p-5 flex items-center gap-4">
          <div className="w-10 h-10 bg-green-50 rounded-xl flex items-center justify-center shrink-0">
            <FolderOpen className="w-5 h-5 text-green-600" />
          </div>
          <div>
            <p className="text-lg font-semibold text-gray-900">
              {projects.filter(p => p.status === 'IN_PROGRESS').length}
            </p>
            <p className="text-xs text-gray-400">Active Projects</p>
          </div>
        </div>
        <div className="bg-white rounded-2xl border border-gray-100 p-5 flex items-center gap-4">
          <div className="w-10 h-10 bg-teal-50 rounded-xl flex items-center justify-center shrink-0">
            <FolderOpen className="w-5 h-5 text-teal-600" />
          </div>
          <div>
            <p className="text-lg font-semibold text-gray-900">
              {projects.filter(p => p.status === 'DELIVERED').length}
            </p>
            <p className="text-xs text-gray-400">Delivered</p>
          </div>
        </div>
      </div>

      {/* Projects table */}
      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        <div className="px-6 py-4 border-b border-gray-100">
          <h2 className="text-sm font-semibold text-gray-900">Projects</h2>
        </div>

        {projects.length === 0 ? (
          <div className="py-16 text-center text-gray-400 text-sm">No projects found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[600px]">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  {['Project Code', 'Project Name', 'Venture', 'Status', 'Start Date', 'Deadline'].map(h => (
                    <th key={h} className="px-5 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {projects.map(p => (
                  <tr key={p.id ?? p._id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-5 py-3.5 text-xs font-mono text-gray-400">{p.projectCode ?? '—'}</td>
                    <td className="px-5 py-3.5">
                      <p className="text-sm font-medium text-gray-900">{p.name}</p>
                    </td>
                    <td className="px-5 py-3.5">
                      {p.venture ? (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${VENTURE_COLORS[p.venture] ?? 'bg-gray-100 text-gray-600'}`}>
                          {p.venture}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-5 py-3.5">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[p.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {p.status?.replace('_', ' ') ?? '—'}
                      </span>
                    </td>
                    <td className="px-5 py-3.5 text-sm text-gray-500">{fmtDate(p.startDate)}</td>
                    <td className="px-5 py-3.5 text-sm text-gray-500">{fmtDate(p.deadline)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  )
}
