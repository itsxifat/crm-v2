'use client'

import { useState, useEffect, useCallback } from 'react'
import { useParams } from 'next/navigation'
import Link from 'next/link'
import {
  ArrowLeft, CheckCircle, Circle, Clock, Upload, File, Download,
  AlertCircle, Loader2, MessageSquare, ChevronDown, ChevronUp
} from 'lucide-react'

function StatusBadge({ status }) {
  const map = {
    PLANNING:    { label: 'Planning',    bg: 'bg-gray-100',   text: 'text-gray-700' },
    IN_PROGRESS: { label: 'In Progress', bg: 'bg-blue-100',   text: 'text-blue-700' },
    ON_HOLD:     { label: 'On Hold',     bg: 'bg-yellow-100', text: 'text-yellow-700' },
    COMPLETED:   { label: 'Completed',   bg: 'bg-green-100',  text: 'text-green-700' },
    CANCELLED:   { label: 'Cancelled',   bg: 'bg-red-100',    text: 'text-red-700' },
  }
  const s = map[status] || map.PLANNING
  return (
    <span className={`inline-flex items-center px-3 py-1 rounded-full text-sm font-medium ${s.bg} ${s.text}`}>
      {s.label}
    </span>
  )
}

function PriorityBadge({ priority }) {
  const map = {
    LOW:    { label: 'Low',    bg: 'bg-gray-100',    text: 'text-gray-500' },
    MEDIUM: { label: 'Medium', bg: 'bg-blue-50',     text: 'text-blue-600' },
    HIGH:   { label: 'High',   bg: 'bg-orange-100',  text: 'text-orange-600' },
    URGENT: { label: 'Urgent', bg: 'bg-red-100',     text: 'text-red-600' },
  }
  const p = map[priority] || map.MEDIUM
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium ${p.bg} ${p.text}`}>
      {p.label}
    </span>
  )
}

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
  const [uploading, setUploading] = useState(false)
  const [uploadSuccess, setUploadSuccess] = useState(false)
  const [showAllTasks, setShowAllTasks] = useState(false)
  const [showAllMilestones, setShowAllMilestones] = useState(false)
  const [dragOver, setDragOver] = useState(false)

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

  const handleFileUpload = async (file) => {
    if (!file) return
    setUploading(true)
    setUploadSuccess(false)
    try {
      const formData = new FormData()
      formData.append('file', file)
      formData.append('projectId', id)
      const res = await fetch('/api/upload', { method: 'POST', body: formData })
      if (!res.ok) throw new Error('Upload failed')
      setUploadSuccess(true)
      setTimeout(() => setUploadSuccess(false), 3000)
      fetchProject()
    } catch (err) {
      alert(err.message)
    } finally {
      setUploading(false)
    }
  }

  if (loading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="h-6 bg-gray-200 rounded w-24" />
        <div className="bg-white rounded-2xl border border-gray-100 p-8">
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
    <div className="space-y-6">
      {/* Back */}
      <Link href="/client/projects" className="inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 font-medium transition-colors">
        <ArrowLeft className="w-4 h-4" />
        Back to Projects
      </Link>

      {/* Header */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8">
        <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4">
          <div className="flex-1">
            <div className="flex items-center gap-3 mb-2 flex-wrap">
              <h1 className="text-2xl font-bold text-gray-900">{project.name}</h1>
              <StatusBadge status={project.status} />
              {project.priority && <PriorityBadge priority={project.priority} />}
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

      <div className="grid lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2 space-y-6">
          {/* Milestones */}
          {project.milestones?.length > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
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
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
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
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
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

        <div className="space-y-6">
          {/* File Upload */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="text-base font-bold text-gray-900 mb-4">Upload Files</h2>
            <div
              onDragOver={(e) => { e.preventDefault(); setDragOver(true) }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault()
                setDragOver(false)
                const file = e.dataTransfer.files[0]
                if (file) handleFileUpload(file)
              }}
              className={`border-2 border-dashed rounded-xl p-8 text-center transition-colors ${
                dragOver ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-blue-300'
              }`}
            >
              {uploading ? (
                <div className="flex flex-col items-center">
                  <Loader2 className="w-8 h-8 text-blue-500 animate-spin mb-2" />
                  <p className="text-sm text-gray-500">Uploading...</p>
                </div>
              ) : uploadSuccess ? (
                <div className="flex flex-col items-center">
                  <CheckCircle className="w-8 h-8 text-green-500 mb-2" />
                  <p className="text-sm text-green-600 font-medium">File uploaded!</p>
                </div>
              ) : (
                <>
                  <Upload className="w-8 h-8 text-gray-300 mx-auto mb-3" />
                  <p className="text-sm text-gray-600 font-medium">Drop files here</p>
                  <p className="text-xs text-gray-400 mt-1 mb-3">or click to browse</p>
                  <label className="cursor-pointer inline-flex items-center px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 transition-colors">
                    Choose File
                    <input
                      type="file"
                      className="hidden"
                      onChange={(e) => handleFileUpload(e.target.files[0])}
                      accept=".pdf,.doc,.docx,.png,.jpg,.jpeg,.xlsx,.xls"
                    />
                  </label>
                  <p className="text-xs text-gray-400 mt-3">Max 10MB · PDF, DOC, Images, Excel</p>
                </>
              )}
            </div>
          </div>

          {/* Project Details */}
          <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
            <h2 className="text-base font-bold text-gray-900 mb-4">Project Details</h2>
            <div className="space-y-3">
              <div className="flex justify-between items-center">
                <span className="text-sm text-gray-500">Status</span>
                <StatusBadge status={project.status} />
              </div>
              {project.priority && (
                <div className="flex justify-between items-center">
                  <span className="text-sm text-gray-500">Priority</span>
                  <PriorityBadge priority={project.priority} />
                </div>
              )}
              {project.startDate && (
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Start Date</span>
                  <span className="text-sm font-medium text-gray-800">{new Date(project.startDate).toLocaleDateString()}</span>
                </div>
              )}
              {project.endDate && (
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Target End</span>
                  <span className="text-sm font-medium text-gray-800">{new Date(project.endDate).toLocaleDateString()}</span>
                </div>
              )}
              <div className="flex justify-between">
                <span className="text-sm text-gray-500">Tasks</span>
                <span className="text-sm font-medium text-gray-800">{completedTasks} / {totalTasks}</span>
              </div>
            </div>
          </div>

          {/* Pricing Summary */}
          {project.budget > 0 && (
            <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-6">
              <h2 className="text-base font-bold text-gray-900 mb-4">Pricing</h2>
              <div className="space-y-3">
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Project Price</span>
                  <span className="text-sm font-semibold text-gray-800">৳ {project.budget.toLocaleString()}</span>
                </div>
                {project.discount > 0 && (
                  <div className="flex justify-between">
                    <span className="text-sm text-gray-500">Discount</span>
                    <span className="text-sm font-medium text-green-600">- ৳ {project.discount.toLocaleString()}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-sm text-gray-500">Paid</span>
                  <span className="text-sm font-medium text-blue-600">৳ {project.paidAmount.toLocaleString()}</span>
                </div>
                <div className="pt-2 border-t border-gray-100 flex justify-between">
                  <span className="text-sm font-semibold text-gray-700">Due</span>
                  <span className={`text-sm font-bold ${project.dueAmount > 0 ? 'text-red-600' : 'text-green-600'}`}>
                    ৳ {project.dueAmount.toLocaleString()}
                  </span>
                </div>
              </div>
            </div>
          )}

          {/* Messages link */}
          <Link href="/client/messages">
            <div className="bg-gradient-to-r from-blue-500 to-blue-600 rounded-2xl p-6 text-white cursor-pointer hover:from-blue-600 hover:to-blue-700 transition-all">
              <MessageSquare className="w-6 h-6 mb-2 opacity-80" />
              <p className="font-semibold">Have questions?</p>
              <p className="text-blue-100 text-sm mt-1">Message our team</p>
            </div>
          </Link>
        </div>
      </div>
    </div>
  )
}
