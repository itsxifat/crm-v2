'use client'

import { useEffect, useState, useRef } from 'react'
import { X, Paperclip, Play, Square, Send, Lock, Globe, Plus, Check } from 'lucide-react'
import { formatDate, formatRelativeTime } from '@/lib/utils'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Avatar from '@/components/ui/Avatar'
import { Input } from '@/components/ui/Input'
import { useSession } from 'next-auth/react'
import toast from 'react-hot-toast'

const PRIORITY_VARIANT = { LOW: 'default', MEDIUM: 'primary', HIGH: 'orange', URGENT: 'danger' }
const PRIORITY_LABEL   = { LOW: 'Low', MEDIUM: 'Medium', HIGH: 'High', URGENT: 'Urgent' }

export default function TaskDetailModal({ taskId, onClose, onUpdate }) {
  const { data: sessionData } = useSession()
  const [task, setTask]             = useState(null)
  const [loading, setLoading]       = useState(true)
  const [respondingAccept, setRespondingAccept] = useState(false)
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

  async function respondToAssignment(action) {
    setRespondingAccept(true)
    try {
      const res  = await fetch(`/api/tasks/${taskId}`, {
        method:  'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ action }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success(action === 'accept' ? 'Task accepted' : 'Task declined')
      loadTask()
      onUpdate?.()
    } catch (err) {
      toast.error(err.message ?? 'Failed')
    } finally {
      setRespondingAccept(false)
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
    toast.success(`Timer stopped — ${formatDuration(timerSeconds)} added to hours`)
  }

  function formatDuration(secs) {
    const h = Math.floor(secs / 3600)
    const m = Math.floor((secs % 3600) / 60)
    const s = secs % 60
    return [h, m, s].map((v) => String(v).padStart(2, '0')).join(':')
  }

  const assignee = task?.assignedEmployeeId?.userId ?? task?.assignedFreelancerId?.userId
  const totalLogged = (task?.timesheets ?? []).reduce((s, t) => s + t.hours, 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-end bg-black/40 backdrop-blur-[2px]">
      <div className="flex h-full w-full max-w-2xl flex-col border-l border-gray-200/80 bg-white shadow-2xl animate-in slide-in-from-right">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 border-b border-gray-100 px-6 pb-4 pt-5">
          <div className="min-w-0 flex-1">
            {loading ? (
              <div className="h-6 w-48 animate-pulse rounded-md bg-gray-100" />
            ) : (
              <>
                <h2 className="truncate text-base font-semibold leading-tight tracking-tight text-gray-900">{task?.title}</h2>
                {task?.projectId?.name && <p className="mt-0.5 text-[13px] text-muted-foreground">{task.projectId.name}</p>}
              </>
            )}
          </div>
          <Button variant="ghost" size="icon-sm" onClick={onClose} className="-mr-1.5 -mt-0.5 text-gray-400" aria-label="Close">
            <X />
          </Button>
        </div>

        {loading ? (
          <div className="flex-1 space-y-3 p-6">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-10 animate-pulse rounded-md bg-gray-100" />
            ))}
          </div>
        ) : task ? (
          <div className="flex-1 overflow-y-auto">
            {/* Meta badges */}
            <div className="flex flex-wrap gap-2 border-b border-gray-100 px-6 py-3">
              <Badge status={task.status} />
              <Badge variant={PRIORITY_VARIANT[task.priority] ?? 'default'}>
                {PRIORITY_LABEL[task.priority] ?? task.priority}
              </Badge>
              {task.isClientVisible && (
                <Badge variant="success">
                  <Globe className="size-3" /> Client visible
                </Badge>
              )}
              {task.assignedEmployeeId && task.assignmentStatus && (
                <Badge variant={
                  task.assignmentStatus === 'ACCEPTED' ? 'success'
                  : task.assignmentStatus === 'DECLINED' ? 'danger'
                  : 'warning'
                }>
                  {task.assignmentStatus === 'ACCEPTED' ? 'Accepted'
                    : task.assignmentStatus === 'DECLINED' ? 'Declined' : 'Awaiting acceptance'}
                </Badge>
              )}
            </div>

            {/* Assignee accept / decline */}
            {sessionData?.user?.role === 'EMPLOYEE' && task.assignmentStatus === 'ASSIGNED' && (
              <div className="mx-6 mt-4 flex flex-col gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-amber-800">Assigned to you — accept to confirm.</p>
                <div className="flex items-center gap-2">
                  <Button size="sm" onClick={() => respondToAssignment('accept')} loading={respondingAccept}>
                    {!respondingAccept && <Check />} Accept
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => respondToAssignment('decline')} disabled={respondingAccept} className="text-red-600 hover:text-red-700">
                    <X /> Decline
                  </Button>
                </div>
              </div>
            )}

            <div className="space-y-6 px-6 py-5">
              {/* Description */}
              {task.description && (
                <div>
                  <p className="mb-1.5 text-sm font-semibold text-gray-900">Description</p>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-gray-700">{task.description}</p>
                </div>
              )}

              {/* Info grid */}
              <div className="grid grid-cols-2 gap-3">
                {assignee && (
                  <div className="rounded-lg bg-gray-50 p-3">
                    <p className="mb-1 text-xs text-muted-foreground">Assignee</p>
                    <div className="flex items-center gap-2">
                      <Avatar name={assignee.name} src={assignee.avatar} size="xs" />
                      <span className="truncate text-sm font-medium text-gray-900">{assignee.name}</span>
                    </div>
                  </div>
                )}
                {task.dueDate && (
                  <div className="rounded-lg bg-gray-50 p-3">
                    <p className="mb-1 text-xs text-muted-foreground">Due date</p>
                    <p className="text-sm font-medium text-gray-900">{formatDate(task.dueDate)}</p>
                  </div>
                )}
                {task.estimatedHours && (
                  <div className="rounded-lg bg-gray-50 p-3">
                    <p className="mb-1 text-xs text-muted-foreground">Estimated</p>
                    <p className="text-sm font-medium tabular-nums text-gray-900">{task.estimatedHours}h</p>
                  </div>
                )}
                <div className="rounded-lg bg-gray-50 p-3">
                  <p className="mb-1 text-xs text-muted-foreground">Logged</p>
                  <p className="text-sm font-medium tabular-nums text-gray-900">{totalLogged.toFixed(1)}h</p>
                </div>
              </div>

              {/* Time Tracker */}
              <div className="rounded-xl border border-gray-200/80 p-4">
                <p className="mb-3 text-sm font-semibold text-gray-900">Time tracker</p>
                <div className="mb-3 flex items-center gap-3">
                  <div className="flex-1 rounded-lg bg-gray-50 py-3 text-center">
                    <span className="font-mono text-2xl font-semibold tabular-nums text-gray-900">
                      {formatDuration(timerSeconds)}
                    </span>
                  </div>
                  <Button
                    variant="outline"
                    size="lg"
                    onClick={() => timerActive ? stopTimer() : setTimerActive(true)}
                    className={timerActive ? 'h-12 text-red-600 hover:text-red-700' : 'h-12'}
                  >
                    {timerActive ? <><Square /> Stop</> : <><Play /> Start</>}
                  </Button>
                </div>
                <div className="flex gap-2">
                  <Input
                    type="number"
                    step="0.25"
                    value={logHours}
                    onChange={(e) => setLogHours(e.target.value)}
                    placeholder="Hours"
                    className="w-24"
                  />
                  <Input
                    value={logDesc}
                    onChange={(e) => setLogDesc(e.target.value)}
                    placeholder="Description (optional)"
                    className="flex-1"
                  />
                  <Button variant="outline" onClick={logTime} loading={loggingTime}>
                    {!loggingTime && <Plus />}
                    Log
                  </Button>
                </div>

                {/* Timesheet entries */}
                {(task.timesheets ?? []).length > 0 && (
                  <div className="mt-3 max-h-32 divide-y divide-gray-100 overflow-y-auto">
                    {task.timesheets.slice(0, 5).map((ts) => {
                      const who = ts.employeeId?.userId ?? ts.freelancerId?.userId
                      return (
                        <div key={ts.id} className="flex items-center justify-between py-1.5 text-xs text-gray-700">
                          <span>{who?.name ?? 'Unknown'}</span>
                          <span className="text-muted-foreground">{formatDate(ts.date, 'MMM dd')}</span>
                          <span className="font-medium tabular-nums">{ts.hours}h</span>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>

              {/* Comments */}
              <div>
                <p className="mb-3 flex items-center gap-2 text-sm font-semibold text-gray-900">
                  Comments
                  <Badge>{(task.comments ?? []).length}</Badge>
                </p>
                <div className="mb-3 max-h-48 space-y-3 overflow-y-auto">
                  {(task.comments ?? []).length === 0 ? (
                    <p className="py-4 text-center text-sm text-muted-foreground">No comments yet</p>
                  ) : (
                    task.comments.map((c) => (
                      <div key={c.id} className="flex gap-2.5">
                        <Avatar name={c.authorId?.name ?? '?'} src={c.authorId?.avatar} size="xs" />
                        <div className="min-w-0 flex-1">
                          <div className="mb-0.5 flex items-center gap-2">
                            <span className="text-xs font-medium text-gray-900">{c.authorId?.name}</span>
                            {c.isInternal && (
                              <Badge>
                                <Lock className="size-3" /> Internal
                              </Badge>
                            )}
                            <span className="ml-auto text-xs text-muted-foreground">{formatRelativeTime(c.createdAt)}</span>
                          </div>
                          <p className="text-sm text-gray-700">{c.content}</p>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {/* Comment input */}
                <div className="overflow-hidden rounded-lg border border-input bg-white shadow-xs focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/30">
                  <textarea
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    placeholder="Write a comment…"
                    rows={2}
                    className="w-full resize-none border-0 px-3 py-2 text-sm text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-0"
                    onKeyDown={(e) => { if (e.key === 'Enter' && e.metaKey) sendComment() }}
                  />
                  <div className="flex items-center justify-between border-t border-gray-100 bg-gray-50/60 px-3 py-2">
                    <label className="flex cursor-pointer items-center gap-1.5 text-xs text-gray-600">
                      <input
                        type="checkbox"
                        checked={isInternal}
                        onChange={(e) => setIsInternal(e.target.checked)}
                        className="size-3.5 rounded border-gray-300"
                      />
                      Internal only
                    </label>
                    <Button size="xs" onClick={sendComment} disabled={!comment.trim()} loading={sendingComment}>
                      {!sendingComment && <Send />}
                      Send
                    </Button>
                  </div>
                </div>
              </div>

              {/* Attachments */}
              {(task.attachments ?? []).length > 0 && (
                <div>
                  <p className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-900">
                    Attachments
                    <Badge>{task.attachments.length}</Badge>
                  </p>
                  <div className="space-y-1.5">
                    {task.attachments.map((att) => (
                      <a
                        key={att.id}
                        href={att.fileUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 rounded-lg border border-gray-200/80 p-2.5 transition-colors hover:bg-gray-50"
                      >
                        <Paperclip className="size-4 shrink-0 text-gray-400" />
                        <span className="truncate text-sm font-medium text-gray-900 underline-offset-4 hover:underline">{att.fileName}</span>
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">Task not found</div>
        )}
      </div>
    </div>
  )
}
