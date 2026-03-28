'use client'

import { useState, useEffect } from 'react'
import { toast } from 'react-hot-toast'
import { Loader2 } from 'lucide-react'

const fmt = (n) => `৳${(n ?? 0).toLocaleString('en-BD', { minimumFractionDigits: 2 })}`
const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'

const ASSIGNMENT_STATUS_COLORS = {
  ASSIGNED:    'bg-blue-100 text-blue-700',
  ACCEPTED:    'bg-teal-100 text-teal-700',
  IN_PROGRESS: 'bg-purple-100 text-purple-700',
  COMPLETED:   'bg-green-100 text-green-700',
  CANCELLED:   'bg-red-100 text-red-600',
}

const PAYMENT_STATUS_COLORS = {
  PENDING:               'bg-yellow-100 text-yellow-700',
  IN_WALLET:             'bg-green-100 text-green-700',
  WITHDRAWAL_REQUESTED:  'bg-blue-100 text-blue-700',
  PAID:                  'bg-gray-100 text-gray-600',
}

const VENTURE_COLORS = {
  ENSTUDIO: 'bg-purple-100 text-purple-700',
  ENTECH:   'bg-blue-100 text-blue-700',
  ENMARK:   'bg-green-100 text-green-700',
}

export default function FreelancerProjectsPage() {
  const [assignments, setAssignments] = useState([])
  const [loading,     setLoading]     = useState(true)
  const [acting,      setActing]      = useState(null)

  async function load() {
    try {
      const res  = await fetch('/api/freelancer/dashboard')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setAssignments(json.data?.assignments ?? [])
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  async function acceptAssignment(assignmentId) {
    setActing(assignmentId)
    try {
      const res  = await fetch(`/api/freelancer-assignments/${assignmentId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action: 'accept' }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Assignment accepted!')
      load()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setActing(null)
    }
  }

  if (loading) return (
    <div className="flex justify-center py-20">
      <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
    </div>
  )

  return (
    <div className="space-y-5 max-w-6xl">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">My Projects</h1>
        <p className="text-sm text-gray-400 mt-0.5">All your project assignments</p>
      </div>

      <div className="bg-white rounded-2xl border border-gray-100 overflow-hidden">
        {assignments.length === 0 ? (
          <div className="py-20 text-center text-gray-400 text-sm">No assignments found</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[700px]">
              <thead>
                <tr className="border-b border-gray-100 bg-gray-50/50">
                  {['Project Code', 'Project Name', 'Venture', 'My Payment', 'Status', 'Payment Status', 'Date', 'Action'].map(h => (
                    <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-400 uppercase tracking-wide">{h}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {assignments.map(a => (
                  <tr key={a.id ?? a._id} className="hover:bg-gray-50/50 transition-colors">
                    <td className="px-4 py-3.5 text-xs font-mono text-gray-400">
                      {a.projectId?.projectCode ?? '—'}
                    </td>
                    <td className="px-4 py-3.5">
                      <p className="text-sm font-medium text-gray-900">{a.projectId?.name ?? '—'}</p>
                    </td>
                    <td className="px-4 py-3.5">
                      {a.projectId?.venture ? (
                        <span className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${VENTURE_COLORS[a.projectId.venture] ?? 'bg-gray-100 text-gray-600'}`}>
                          {a.projectId.venture}
                        </span>
                      ) : '—'}
                    </td>
                    <td className="px-4 py-3.5 text-sm font-medium text-gray-900">
                      {fmt(a.paymentAmount)}
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${ASSIGNMENT_STATUS_COLORS[a.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {a.status.replace('_', ' ')}
                      </span>
                    </td>
                    <td className="px-4 py-3.5">
                      <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${PAYMENT_STATUS_COLORS[a.paymentStatus] ?? 'bg-gray-100 text-gray-600'}`}>
                        {a.paymentStatus?.replace('_', ' ') ?? 'PENDING'}
                      </span>
                    </td>
                    <td className="px-4 py-3.5 text-sm text-gray-500">
                      {fmtDate(a.createdAt)}
                    </td>
                    <td className="px-4 py-3.5">
                      {a.status === 'ASSIGNED' && (
                        <button
                          onClick={() => acceptAssignment(a.id ?? a._id)}
                          disabled={acting === (a.id ?? a._id)}
                          className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-900 text-white text-xs font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors"
                        >
                          {acting === (a.id ?? a._id) && <Loader2 className="w-3 h-3 animate-spin" />}
                          Accept
                        </button>
                      )}
                    </td>
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
