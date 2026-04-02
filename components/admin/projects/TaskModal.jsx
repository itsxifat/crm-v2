'use client'

import { useEffect, useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { X, Loader2, CheckSquare } from 'lucide-react'
import toast from 'react-hot-toast'
import Select from '@/components/ui/Select'
import DatePicker from '@/components/ui/DatePicker'

const schema = z.object({
  title:               z.string().min(1, 'Title is required'),
  description:         z.string().optional(),
  status:              z.enum(['TODO','IN_PROGRESS','IN_REVIEW','COMPLETED','CANCELLED']),
  priority:            z.enum(['LOW','MEDIUM','HIGH','URGENT']),
  dueDate:             z.string().optional(),
  estimatedHours:      z.string().optional(),
  assigneeType:        z.enum(['employee','freelancer','none']),
  assignedEmployeeId:  z.string().optional(),
  assignedFreelancerId:z.string().optional(),
  isClientVisible:     z.boolean().default(false),
  tags:                z.string().optional(),
})

export default function TaskModal({ task, projectId, defaultStatus, onClose, onSave }) {
  const [employees,   setEmployees]   = useState([])
  const [freelancers, setFreelancers] = useState([])
  const [loading, setLoading]         = useState(true)
  const isEdit = !!task

  const {
    register,
    control,
    handleSubmit,
    watch,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      title:               task?.title ?? '',
      description:         task?.description ?? '',
      status:              task?.status ?? defaultStatus ?? 'TODO',
      priority:            task?.priority ?? 'MEDIUM',
      dueDate:             task?.dueDate ? new Date(task.dueDate).toISOString().split('T')[0] : '',
      estimatedHours:      task?.estimatedHours?.toString() ?? '',
      assigneeType:        task?.assignedEmployeeId ? 'employee' : task?.assignedFreelancerId ? 'freelancer' : 'none',
      assignedEmployeeId:  task?.assignedEmployeeId ?? '',
      assignedFreelancerId:task?.assignedFreelancerId ?? '',
      isClientVisible:     task?.isClientVisible ?? false,
      tags:                task?.tags ?? '',
    },
  })

  const assigneeType = watch('assigneeType')

  useEffect(() => {
    async function load() {
      try {
        const [empRes, flRes] = await Promise.all([
          fetch('/api/users?role=EMPLOYEE&limit=100'),
          fetch('/api/freelancers?limit=100'),
        ])
        const [empJson, flJson] = await Promise.all([empRes.json(), flRes.json()])
        setEmployees(empJson.data ?? [])
        setFreelancers(flJson.data ?? [])
      } catch {
        toast.error('Failed to load team members')
      } finally {
        setLoading(false)
      }
    }
    load()
  }, [])

  async function onSubmit(values) {
    try {
      const payload = {
        title:               values.title,
        description:         values.description || null,
        status:              values.status,
        priority:            values.priority,
        dueDate:             values.dueDate ? new Date(values.dueDate).toISOString() : null,
        estimatedHours:      values.estimatedHours ? parseFloat(values.estimatedHours) : null,
        assignedEmployeeId:  values.assigneeType === 'employee'   ? values.assignedEmployeeId   || null : null,
        assignedFreelancerId:values.assigneeType === 'freelancer' ? values.assignedFreelancerId || null : null,
        isClientVisible:     values.isClientVisible,
        tags:                values.tags || null,
      }

      const url    = isEdit ? `/api/tasks/${task.id}` : `/api/projects/${projectId}/tasks`
      const method = isEdit ? 'PUT' : 'POST'

      const res  = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      })
      const json = await res.json()

      if (!res.ok) {
        toast.error(json.error ?? 'Failed to save task')
        return
      }

      toast.success(isEdit ? 'Task updated!' : 'Task created!')
      onSave?.(json.data)
      onClose()
    } catch {
      toast.error('Something went wrong')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-blue-50 rounded-lg flex items-center justify-center">
              <CheckSquare className="w-4 h-4 text-blue-600" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">{isEdit ? 'Edit Task' : 'New Task'}</h2>
              <p className="text-xs text-gray-500">{isEdit ? 'Update task details' : 'Add a task to this project'}</p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit(onSubmit)} className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* Title */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Title <span className="text-red-500">*</span>
            </label>
            <input
              {...register('title')}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              placeholder="Task title"
            />
            {errors.title && <p className="text-xs text-red-500 mt-1">{errors.title.message}</p>}
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              {...register('description')}
              rows={3}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none"
              placeholder="Task description..."
            />
          </div>

          {/* Status + Priority */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <Controller name="status" control={control} render={({ field }) => (
                <Select value={field.value} onChange={v => field.onChange(v ?? 'TODO')}
                  options={[
                    { value: 'TODO',        label: 'To Do' },
                    { value: 'IN_PROGRESS', label: 'In Progress' },
                    { value: 'IN_REVIEW',   label: 'In Review' },
                    { value: 'COMPLETED',   label: 'Completed' },
                    { value: 'CANCELLED',   label: 'Cancelled' },
                  ]}
                  placeholder="Select status…"
                />
              )} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
              <Controller name="priority" control={control} render={({ field }) => (
                <Select value={field.value} onChange={v => field.onChange(v ?? 'MEDIUM')}
                  options={[
                    { value: 'LOW',    label: 'Low' },
                    { value: 'MEDIUM', label: 'Medium' },
                    { value: 'HIGH',   label: 'High' },
                    { value: 'URGENT', label: 'Urgent' },
                  ]}
                  placeholder="Select priority…"
                />
              )} />
            </div>
          </div>

          {/* Due Date + Estimated Hours */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
              <input
                type="date"
                {...register('dueDate')}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Estimated Hours</label>
              <input
                type="number"
                step="0.5"
                {...register('estimatedHours')}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                placeholder="0"
              />
            </div>
          </div>

          {/* Assignee */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Assign To</label>
            <div className="flex gap-4 mb-3">
              {['none','employee','freelancer'].map((type) => (
                <label key={type} className="flex items-center gap-2 cursor-pointer">
                  <input
                    type="radio"
                    value={type}
                    {...register('assigneeType')}
                    className="text-primary"
                  />
                  <span className="text-sm text-gray-700 capitalize">{type === 'none' ? 'Unassigned' : type}</span>
                </label>
              ))}
            </div>

            {assigneeType === 'employee' && (
              <select
                {...register('assignedEmployeeId')}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              >
                <option value="">Select employee...</option>
                {employees.map((e) => (
                  <option key={e.id} value={e.employee?.id ?? e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            )}

            {assigneeType === 'freelancer' && (
              <select
                {...register('assignedFreelancerId')}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              >
                <option value="">Select freelancer...</option>
                {freelancers.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.user?.name}
                  </option>
                ))}
              </select>
            )}
          </div>

          {/* Tags + Client Visible */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Tags</label>
              <input
                {...register('tags')}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                placeholder="tag1, tag2"
              />
            </div>
            <div className="flex items-end pb-2">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  {...register('isClientVisible')}
                  className="w-4 h-4 text-primary border-gray-300 rounded"
                />
                <span className="text-sm text-gray-700">Visible to client</span>
              </label>
            </div>
          </div>
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
          <button type="button" onClick={onClose} className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSubmit(onSubmit)}
            disabled={isSubmitting || loading}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 disabled:opacity-60 transition-colors"
          >
            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {isEdit ? 'Save Changes' : 'Create Task'}
          </button>
        </div>
      </div>
    </div>
  )
}
