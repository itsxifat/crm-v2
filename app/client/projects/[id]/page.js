'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, CheckCircle, Circle, Clock, File, Download,
  AlertCircle, ChevronDown, ChevronUp, FileText, Layers, ExternalLink
} from 'lucide-react'
import ProjectStatusBadge from '@/components/portals/ProjectStatusBadge'

function TaskStatusBadge({ status }) {
  const map = {
    TODO:        { label: 'To Do',      bg: 'bg-gray-100',   text: 'text-gray-600' },
    IN_PROGRESS: { label: 'In Progress',bg: 'bg-blue-100',   text: 'text-blue-700' },
    IN_REVIEW:   { label: 'In Review',  bg: 'bg-purple-100', text: 'text-purple-700' },
    COMPLETED:   { label: 'Completed',  bg: 'bg-green-100',  text: 'text-green-700' },
    CANCELLED:   { label: 'Cancelled',  bg: 'bg-red-100',    text: 'text-red-700' },
  }
  const s = map[status] || map.TODO
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  )
}

export default function ClientProjectDetailPage() {
  const { id } = useParams()
  const [project, setProject] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [showAllTasks, setShowAllTasks] = useState(false)
  const [showAllMilestones, setShowAllMilestones] = useState(false)
  const [billing, setBilling] = useState(null)   // { data, summary, combined }

  const fetchProject = useCallback(async () => {
    try {
      const res = await fetch(`/api/client/projects/${id}`)
      if (!res.ok) throw new Error('Project not found')
      const data = await res.json()
      setProject(data.project)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [id])

  useEffect(() => { fetchProject() }, [fetchProject])

  // Invoices raised against this project, with their live paid / due figures.
  useEffect(() => {
    fetch(`/api/client/projects/${id}/invoices`)
      .then(r => (r.ok ? r.json() : null))
      .then(d => setBilling(d))
      .catch(() => {})
  }, [id])

  if (loading) {
    return (
      <div className="max-w-4xl mx-auto space-y-5 animate-pulse">
        <div className="h-6 bg-gray-200 rounded w-24" />
        <div className="bg-white rounded-2xl border border-gray-100 p-6">
          <div className="h-8 bg-gray-200 rounded w-1/2 mb-4" />
          <div className="h-4 bg-gray-200 rounded w-3/4 mb-2" />
          <div className="h-4 bg-gray-200 rounded w-2/3" />
        </div>
      </div>
    )
  }

  if (error || !project) {
    return (
      <div className="text-center py-20">
        <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-4" />
        <p className="text-gray-600 font-medium">{error || 'Project not found'}</p>
        <Link href="/client/projects" className="mt-4 inline-block text-blue-600 hover:text-blue-700 text-sm font-medium">
          Back to Projects
        </Link>
      </div>
    )
  }

  const totalTasks = project.tasks?.length || 0
  const completedTasks = project.tasks?.filter((t) => t.status === 'COMPLETED').length || 0
  const progress = totalTasks > 0 ? Math.round((completedTasks / totalTasks) * 100) : 0
  const completedMilestones = project.milestones?.filter((m) => m.completed).length || 0
  const totalMilestones = project.milestones?.length || 0

  const visibleTasks = showAllTasks ? project.tasks : project.tasks?.slice(0, 5)
  const visibleMilestones = showAllMilestones ? project.milestones : project.milestones?.slice(0, 5)

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {/* Back */}
      <Link href="/client/projects" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 font-medium transition-colors">
        <ArrowLeft className="w-4 h-4" />
        Back to Projects
      </Link>

      {/* Header */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <h1 className="text-2xl font-bold text-gray-900">{project.name}</h1>
              <ProjectStatusBadge status={project.status} className="px-3 py-1 text-sm" />
            </div>
            {project.description && (
              <p className="text-gray-500 text-sm max-w-2xl">{project.description}</p>
            )}
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-6 pt-6 border-t border-gray-100">
          {project.startDate && (
            <div>
              <p className="text-xs text-gray-400 font-medium">Start Date</p>
              <p className="text-sm font-semibold text-gray-800 mt-0.5">
                {new Date(project.startDate).toLocaleDateString()}
              </p>
            </div>
          )}
          {project.endDate && (
            <div>
              <p className="text-xs text-gray-400 font-medium">Target Date</p>
              <p className="text-sm font-semibold text-gray-800 mt-0.5">
                {new Date(project.endDate).toLocaleDateString()}
              </p>
            </div>
          )}
          <div>
            <p className="text-xs text-gray-400 font-medium">Tasks</p>
            <p className="text-sm font-semibold text-gray-800 mt-0.5">{completedTasks}/{totalTasks} done</p>
          </div>
          <div>
            <p className="text-xs text-gray-400 font-medium">Milestones</p>
            <p className="text-sm font-semibold text-gray-800 mt-0.5">{completedMilestones}/{totalMilestones}</p>
          </div>
        </div>

        {/* Progress */}
        <div className="mt-6">
          <div className="flex justify-between text-sm mb-2">
            <span className="font-medium text-gray-700">Overall Progress</span>
            <span className="font-bold text-blue-600">{progress}%</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-3">
            <div
              className="bg-gradient-to-r from-blue-500 to-blue-600 h-3 rounded-full transition-all duration-500"
              style={{ width: `${progress}%` }}
            />
          </div>
        </div>
      </div>

      {/* Pricing */}
      {project.budget > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-base font-bold text-gray-900 mb-4">Pricing</h2>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            <div>
              <p className="text-xs text-gray-400 font-medium">Project Value</p>
              <p className="text-sm font-semibold text-gray-800 mt-0.5">৳ {project.budget.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 font-medium">Paid</p>
              <p className="text-sm font-semibold text-blue-600 mt-0.5">৳ {project.paidAmount.toLocaleString()}</p>
            </div>
            <div>
              <p className="text-xs text-gray-400 font-medium">Due</p>
              <p className={`text-sm font-bold mt-0.5 ${project.dueAmount > 0 ? 'text-red-600' : 'text-green-600'}`}>
                ৳ {project.dueAmount.toLocaleString()}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Invoices */}
      {(billing?.data?.length ?? 0) > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
          <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between gap-3 flex-wrap">
            <div>
              <h2 className="text-base font-bold text-gray-900 flex items-center gap-2">
                <FileText className="w-4 h-4 text-gray-400" /> Invoices
              </h2>
              <p className="text-xs text-gray-400 mt-0.5">
                {billing.data.length} invoice{billing.data.length === 1 ? '' : 's'} for this project
              </p>
            </div>
            {billing.combined && (
              <Link href={`/client/invoices/combined/${billing.combined.id}`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-blue-50 border border-blue-100 text-blue-700 text-xs font-medium rounded-lg hover:bg-blue-100 transition-colors">
                <Layers className="w-3.5 h-3.5" /> View combined invoice
              </Link>
            )}
          </div>

          {/* Billing totals */}
          <div className="grid grid-cols-3 divide-x divide-gray-100 border-b border-gray-100">
            {[
              { label: 'Total Billed', value: billing.summary?.total,      cls: 'text-gray-900' },
              { label: 'Paid',         value: billing.summary?.paidAmount, cls: 'text-green-600' },
              { label: 'Due',          value: billing.summary?.due,        cls: (billing.summary?.due ?? 0) > 0.01 ? 'text-red-600' : 'text-green-600' },
            ].map(c => (
              <div key={c.label} className="px-5 py-3.5">
                <p className="text-xs text-gray-400 font-medium">{c.label}</p>
                <p className={`text-sm font-bold mt-0.5 ${c.cls}`}>
                  ৳ {(Number(c.value) || 0).toLocaleString('en-BD', { minimumFractionDigits: 2 })}
                </p>
              </div>
            ))}
          </div>

          <div className="divide-y divide-gray-50">
            {billing.data.map(inv => (
              <Link key={inv.id} href={`/client/invoices/${inv.id}`}
                className="flex items-center justify-between gap-4 px-5 py-3.5 hover:bg-gray-50/60 transition-colors">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-gray-900">{inv.invoiceNumber}</p>
                  <p className="text-xs text-gray-400 mt-0.5">
                    Issued {inv.issueDate ? new Date(inv.issueDate).toLocaleDateString() : '—'}
                    {inv.dueDate ? ` · Due ${new Date(inv.dueDate).toLocaleDateString()}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-4 shrink-0">
                  <div className="text-right">
                    <p className="text-sm font-bold text-gray-900">
                      ৳ {(Number(inv.total) || 0).toLocaleString('en-BD', { minimumFractionDigits: 2 })}
                    </p>
                    <p className={`text-xs mt-0.5 ${inv.due > 0.01 ? 'text-red-500' : 'text-green-600'}`}>
                      {inv.due > 0.01
                        ? `৳ ${inv.due.toLocaleString('en-BD', { minimumFractionDigits: 2 })} due`
                        : 'Paid in full'}
                    </p>
                  </div>
                  <span className={`inline-flex px-2.5 py-0.5 rounded-full text-xs font-medium ${
                    inv.status === 'PAID'           ? 'bg-green-100 text-green-700'  :
                    inv.status === 'OVERDUE'        ? 'bg-red-100 text-red-600'      :
                    inv.status === 'PARTIALLY_PAID' ? 'bg-yellow-100 text-yellow-700':
                    'bg-blue-100 text-blue-700'
                  }`}>
                    {inv.status.replace(/_/g, ' ')}
                  </span>
                  <ExternalLink className="w-3.5 h-3.5 text-gray-300" />
                </div>
              </Link>
            ))}
          </div>
        </div>
      )}

      {/* Milestones */}
      {project.milestones?.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-base font-bold text-gray-900 mb-4">Project Milestones</h2>
          <div className="space-y-3">
            {visibleMilestones.map((milestone) => (
              <div key={milestone.id} className="flex items-start gap-3 p-3 rounded-xl hover:bg-gray-50 transition-colors">
                {milestone.completed ? (
                  <CheckCircle className="w-5 h-5 text-green-500 flex-shrink-0 mt-0.5" />
                ) : (
                  <Circle className="w-5 h-5 text-gray-300 flex-shrink-0 mt-0.5" />
                )}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${milestone.completed ? 'text-gray-400 line-through' : 'text-gray-800'}`}>
                    {milestone.title}
                  </p>
                  {milestone.description && (
                    <p className="text-xs text-gray-400 mt-0.5">{milestone.description}</p>
                  )}
                </div>
                {milestone.dueDate && (
                  <span className={`text-xs font-medium flex items-center gap-1 ${
                    !milestone.completed && new Date(milestone.dueDate) < new Date()
                      ? 'text-red-500'
                      : 'text-gray-400'
                  }`}>
                    <Clock className="w-3 h-3" />
                    {new Date(milestone.dueDate).toLocaleDateString()}
                  </span>
                )}
              </div>
            ))}
          </div>
          {project.milestones.length > 5 && (
            <button
              onClick={() => setShowAllMilestones(!showAllMilestones)}
              className="mt-3 text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
            >
              {showAllMilestones ? <><ChevronUp className="w-4 h-4" />Show less</> : <><ChevronDown className="w-4 h-4" />Show all {project.milestones.length}</>}
            </button>
          )}
        </div>
      )}

      {/* Tasks (client visible) */}
      {project.tasks?.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-base font-bold text-gray-900 mb-4">Your Tasks Overview</h2>
          <div className="space-y-2">
            {visibleTasks.map((task) => (
              <div key={task.id} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:bg-gray-50 transition-colors">
                {task.status === 'COMPLETED' ? (
                  <CheckCircle className="w-4 h-4 text-green-500 flex-shrink-0" />
                ) : (
                  <Circle className="w-4 h-4 text-gray-300 flex-shrink-0" />
                )}
                <div className="flex-1 min-w-0">
                  <p className={`text-sm font-medium ${task.status === 'COMPLETED' ? 'text-gray-400' : 'text-gray-800'}`}>
                    {task.title}
                  </p>
                </div>
                <TaskStatusBadge status={task.status} />
                {task.dueDate && (
                  <span className="text-xs text-gray-400 hidden sm:block">
                    {new Date(task.dueDate).toLocaleDateString()}
                  </span>
                )}
              </div>
            ))}
          </div>
          {project.tasks.length > 5 && (
            <button
              onClick={() => setShowAllTasks(!showAllTasks)}
              className="mt-3 text-sm text-blue-600 hover:text-blue-700 font-medium flex items-center gap-1"
            >
              {showAllTasks ? <><ChevronUp className="w-4 h-4" />Show less</> : <><ChevronDown className="w-4 h-4" />Show all {project.tasks.length}</>}
            </button>
          )}
        </div>
      )}

      {/* Deliverables */}
      {project.documents?.length > 0 && (
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-5">
          <h2 className="text-base font-bold text-gray-900 mb-4">Deliverables & Files</h2>
          <div className="space-y-2">
            {project.documents.map((doc) => (
              <div key={doc.id} className="flex items-center gap-3 p-3 rounded-xl border border-gray-100 hover:bg-gray-50 transition-colors">
                <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center flex-shrink-0">
                  <File className="w-4 h-4 text-blue-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{doc.name}</p>
                  {doc.description && <p className="text-xs text-gray-400">{doc.description}</p>}
                </div>
                <a href={doc.fileUrl} target="_blank" rel="noopener noreferrer">
                  <button className="p-2 rounded-lg hover:bg-gray-100 transition-colors">
                    <Download className="w-4 h-4 text-gray-500" />
                  </button>
                </a>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
