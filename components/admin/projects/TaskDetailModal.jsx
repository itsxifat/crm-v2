'use client'

import { useEffect, useState, useRef } from 'react'
import {
  X, Clock, MessageSquare, Paperclip, Play, Square,
  Send, Lock, Globe, User, Calendar, Tag, ChevronDown,
  Loader2, Activity, Plus,
} from 'lucide-react'
import { formatDate, formatRelativeTime, getStatusColor, getPriorityBadgeColor, getInitials } from '@/lib/utils'
import toast from 'react-hot-toast'

const PRIORITY_COLORS = {
  LOW:    'bg-slate-100 text-slate-700',
  MEDIUM: 'bg-blue-100 text-blue-700',
  HIGH:   'bg-orange-100 text-orange-700',
  URGENT: 'bg-red-100 text-red-700',
}

export default function TaskDetailModal({ taskId, onClose, onUpdate }) {
  const [task, setTask]             = useState(null)
  const [loading, setLoading]       = useState(true)
  const [comment, setComment]       = useState('')
  const [isInternal, setIsInternal] = useState(true)
  const [sendingComment, setSending] = useState(false)
  const [timerActive, setTimerActive] = useState(false)
  const [timerSeconds, setTimerSeconds] = useState(0)
  const [logHours, setLogHours]     = useState('')
  const [logDesc, setLogDesc]       = useState('')
  const [loggingTime, setLoggingTime] = useState(false)
  const timerRef = useRef(null)

  useEffect(() => {
    if (!taskId) return
    loadTask()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [taskId])

  useEffect(() => {
    if (timerActive) {
      timerRef.current = setInterval(() => setTimerSeconds((s) => s + 1), 1000)
    } else {
      clearInterval(timerRef.current)
    }
    return () => clearInterval(timerRef.current)
  }, [timerActive])

  async function loadTask() {
    try {
      setLoading(true)
      const res  = await fetch(`/api/tasks/${taskId}`)
      const json = await res.json()
      if (res.ok) setTask(json.data)
    } catch {
      toast.error('Failed to load task')
    } finally {
      setLoading(false)
    }
  }

  async function sendComment() {
    if (!comment.trim()) return
    try {
      setSending(true)
      const res  = await fetch(`/api/tasks/${taskId}/comments`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ content: comment, isInternal }),
      })
      const json = await res.json()
      if (!res.ok) { toast.error(json.error); return }
      setTask((prev) => ({ ...prev, comments: [...(prev.comments ?? []), json.data] }))
      setComment('')
      toast.success('Comment added')
    } catch {
      toast.error('Failed to add comment')
    } finally {
      setSending(false)
    }
  }

  async function logTime() {
    const hours = parseFloat(logHours)
    if (!hours || hours <= 0) { toast.error('Enter valid hours'); return }
    try {
      setLoggingTime(true)
      const res  = await fetch(`/api/tasks/${taskId}/timesheets`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ hours, description: logDesc, date: new Date().toISOString() }),
      })
      const json = await res.json()
      if (!res.ok) { toast.error(json.error); return }
      setTask((prev) => ({
        ...prev,
        timesheets: [json.data, ...(prev.timesheets ?? [])],
        actualHours: (prev.actualHours ?? 0) + hours,
      }))
      setLogHours('')
      setLogDesc('')
      toast.success('Time logged')
      onUpdate?.()
    } catch {
      toast.error('Failed to log time')
    } finally {
      setLoggingTime(false)
    }
  }

  function stopTimer() {
    const hours = timerSeconds / 3600
    setTimerActive(false)
    setTimerSeconds(0)
    setLogHours(hours.toFixed(2))
    toast.success(`Timer stopped — ${formatDuration(timerSeconds)} logged to hours field`)
  }

  function formatDuration(secs) {
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    const s = secs % 60
    return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':')
  }

  const assignee = task?.assignedEmployee?.user ?? task?.assignedFreelancer?.user
  const totalLogged = (task?.timesheets ?? []).reduce((s, t) => s + t.hours, 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/40 backdrop-blur-sm">
      <div className="h-full w-full max-w-2xl bg-white shadow-2xl flex flex-col animate-in slide-in-from-right">
        {/* Header */}
        <div className="flex items-start justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex-1 min-w-0 pr-4">
            {loading ? (
              <div className="h-6 w-48 bg-gray-200 rounded animate-pulse" />
            ) : (
              <>
                <h2 className="font-semibold text-gray-900 text-lg leading-tight truncate">{task?.title}</h2>
                <p className="text-xs text-gray-500 mt-0.5">{task?.project?.name}</p>
              </>
            )}
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 transition-colors shrink-0">
            <X className="w-4 h-4" />
          </button>
        </div>

        {loading ? (
          <div className="flex-1 p-6 space-y-4">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-10 bg-gray-100 rounded-lg animate-pulse" />
            ))}
          </div>
        ) : task ? (
          <div className="flex-1 overflow-y-auto">
            {/* Meta badges */}
            <div className="px-6 py-3 border-b border-gray-50 flex flex-wrap gap-2">
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${getStatusColor(task.status)}`}>
                {task.status.replace('_', ' ')}
              </span>
              <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium ${PRIORITY_COLORS[task.priority]}`}>
                {task.priority}
              </span>
              {task.isClientVisible && (
                <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium bg-green-100 text-green-700">
                  <Globe className="w-3 h-3" /> Client visible
                </span>
              )}
            </div>

            <div className="px-6 py-4 space-y-5">
              {/* Description */}
              {task.description && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">Description</p>
                  <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-wrap">{task.description}</p>
                </div>
              )}

              {/* Info grid */}
              <div className="grid grid-cols-2 gap-3">
                {assignee && (
                  <div className="bg-gray-50 rounded-xl p-3">
                    <p className="text-xs text-gray-400 mb-1">Assignee</p>
                    <div className="flex items-center gap-2">
                      <div className="w-7 h-7 rounded-full bg-primary text-white text-xs flex items-center justify-center font-semibold">
                        {getInitials(assignee.name)}
                      </div>
                      <span className="text-sm font-medium text-gray-800">{assignee.name}</span>
                    </div>
                  </div>
                )}
                {task.dueDate && (
                  <div className="bg-gray-50 rounded-xl p-3">
                    <p className="text-xs text-gray-400 mb-1">Due Date</p>
                    <p className="text-sm font-medium text-gray-800">{formatDate(task.dueDate)}</p>
                  </div>
                )}
                {task.estimatedHours && (
                  <div className="bg-gray-50 rounded-xl p-3">
                    <p className="text-xs text-gray-400 mb-1">Estimated</p>
                    <p className="text-sm font-medium text-gray-800">{task.estimatedHours}h</p>
                  </div>
                )}
                <div className="bg-gray-50 rounded-xl p-3">
                  <p className="text-xs text-gray-400 mb-1">Logged</p>
                  <p className="text-sm font-medium text-gray-800">{totalLogged.toFixed(1)}h</p>
                </div>
              </div>

              {/* Time Tracker */}
              <div className="border border-gray-200 rounded-xl p-4">
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <Clock className="w-3.5 h-3.5" /> Time Tracker
                </p>
                <div className="flex items-center gap-3 mb-3">
                  <div className="flex-1 text-center py-3 bg-gray-50 rounded-xl">
                    <span className="text-2xl font-mono font-bold text-gray-800">
                      {formatDuration(timerSeconds)}
                    </span>
                  </div>
                  <button
                    onClick={() => timerActive ? stopTimer() : setTimerActive(true)}
                    className={`flex items-center gap-2 px-4 py-3 rounded-xl text-sm font-medium transition-colors ${
                      timerActive ? 'bg-red-100 text-red-700 hover:bg-red-200' : 'bg-green-100 text-green-700 hover:bg-green-200'
                    }`}
                  >
                    {timerActive ? <><Square className="w-4 h-4" /> Stop</> : <><Play className="w-4 h-4" /> Start</>}
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    type="number"
                    step="0.25"
                    value={logHours}
                    onChange={(e) => setLogHours(e.target.value)}
                    placeholder="Hours"
                    className="w-24 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  <input
                    value={logDesc}
                    onChange={(e) => setLogDesc(e.target.value)}
                    placeholder="Description (optional)"
                    className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30"
                  />
                  <button
                    onClick={logTime}
                    disabled={loggingTime}
                    className="flex items-center gap-1.5 px-3 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 disabled:opacity-60 transition-colors"
                  >
                    {loggingTime ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                    Log
                  </button>
                </div>

                {/* Timesheet entries */}
                {(task.timesheets ?? []).length > 0 && (
                  <div className="mt-3 space-y-1.5 max-h-32 overflow-y-auto">
                    {task.timesheets.slice(0, 5).map((ts) => {
                      const who = ts.employee?.user ?? ts.freelancer?.user
                      return (
                        <div key={ts.id} className="flex items-center justify-between text-xs text-gray-600 py-1 border-b border-gray-50 last:border-0">
                          <span>{who?.name ?? 'Unknown'}</span>
                          <span className="text-gray-400">{formatDate(ts.date, 'MMM dd')}</span>
                          <span className="font-medium">{ts.hours}h</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Comments */}
              <div>
                <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3 flex items-center gap-1.5">
                  <MessageSquare className="w-3.5 h-3.5" /> Comments ({(task.comments ?? []).length})
                </p>
                <div className="space-y-3 mb-3 max-h-48 overflow-y-auto">
                  {(task.comments ?? []).length === 0 ? (
                    <p className="text-sm text-gray-400 text-center py-4">No comments yet.</p>
                  ) : (
                    task.comments.map((c) => (
                      <div key={c.id} className="flex gap-2.5">
                        <div className="w-7 h-7 rounded-full bg-gray-200 text-gray-600 text-xs flex items-center justify-center font-semibold shrink-0">
                          {getInitials(c.author?.name ?? '?')}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2 mb-0.5">
                            <span className="text-xs font-semibold text-gray-800">{c.author?.name}</span>
                            {c.isInternal && (
                              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-2xs">
                                <Lock className="w-2.5 h-2.5" /> Internal
                              </span>
                            )}
                            <span className="text-xs text-gray-400 ml-auto">{formatRelativeTime(c.createdAt)}</span>
                          </div>
                          <p className="text-sm text-gray-700">{c.content}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Comment input */}
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Write a comment..."
                    rows={2}
                    className="w-full px-3 py-2 text-sm focus:outline-none resize-none"
                    onKeyDown={(e) => { if (e.key === 'Enter' && e.metaKey) sendComment() }}
                  />
                  <div className="flex items-center justify-between px-3 py-2 border-t border-gray-100 bg-gray-50">
                    <label className="flex items-center gap-1.5 cursor-pointer">
                      <input
                        type="checkbox"
                        checked={isInternal}
                        onChange={(e) => setIsInternal(e.target.checked)}
                        className="w-3.5 h-3.5 text-primary border-gray-300 rounded"
                      />
                      <span className="text-xs text-gray-500">Internal only</span>
                    </label>
                    <button
                      onClick={sendComment}
                      disabled={sendingComment || !comment.trim()}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-primary text-white rounded-lg text-xs font-medium hover:bg-primary/90 disabled:opacity-50 transition-colors"
                    >
                      {sendingComment ? <Loader2 className="w-3 h-3 animate-spin" /> : <Send className="w-3 h-3" />}
                      Send
                    </button>
                  </div>
                </div>
              </div>

              {/* Attachments */}
              {(task.attachments ?? []).length > 0 && (
                <div>
                  <p className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2 flex items-center gap-1.5">
                    <Paperclip className="w-3.5 h-3.5" /> Attachments ({task.attachments.length})
                  </p>
                  <div className="space-y-1.5">
                    {task.attachments.map((att) => (
                      <a
                        key={att.id}
                        href={att.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 p-2.5 border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
                      >
                        <Paperclip className="w-4 h-4 text-gray-400" />
                        <span className="text-sm text-blue-600 hover:underline truncate">{att.fileName}</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex-1 flex items-center justify-center text-gray-400">Task not found</div>
        )}
      </div>
    </div>
  )
}
