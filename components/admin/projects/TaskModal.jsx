'use client'

import { useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { X } from 'lucide-react'
import toast from 'react-hot-toast'
import Select from '@/components/ui/Select'
import Button from '@/components/ui/Button'
import { Input, Textarea, Field } from '@/components/ui/Input'
import PeoplePicker from '@/components/ui/PeoplePicker'

const schema = z.object({
  title:           z.string().min(1, 'Title is required'),
  description:     z.string().optional(),
  status:          z.enum(['TODO','IN_PROGRESS','IN_REVIEW','COMPLETED','CANCELLED']),
  priority:        z.enum(['LOW','MEDIUM','HIGH','URGENT']),
  dueDate:         z.string().optional(),
  estimatedHours:  z.string().optional(),
  isClientVisible: z.boolean().default(false),
  tags:            z.string().optional(),
})

export default function TaskModal({ task, projectId, defaultStatus, onClose, onSave }) {
  const isEdit = !!task

  // Tasks are assigned to in-house employees only.
  const [assignee, setAssignee] = useState(
    task?.assignedEmployeeId
      ? {
          id:     task.assignedEmployeeId.id ?? task.assignedEmployeeId._id ?? task.assignedEmployeeId,
          type:   'EMPLOYEE',
          name:   task.assignedEmployeeId.userId?.name ?? 'Employee',
          avatar: task.assignedEmployeeId.userId?.avatar ?? null,
          sub:    'Employee',
        }
      : null
  )

  const {
    register, control, handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      title:           task?.title ?? '',
      description:     task?.description ?? '',
      status:          task?.status ?? defaultStatus ?? 'TODO',
      priority:        task?.priority ?? 'MEDIUM',
      dueDate:         task?.dueDate ? new Date(task.dueDate).toISOString().split('T')[0] : '',
      estimatedHours:  task?.estimatedHours?.toString() ?? '',
      isClientVisible: task?.isClientVisible ?? false,
      tags:            task?.tags ?? '',
    },
  })

  async function onSubmit(values) {
    try {
      const payload = {
        title:              values.title,
        description:        values.description || null,
        status:             values.status,
        priority:           values.priority,
        dueDate:            values.dueDate ? new Date(values.dueDate).toISOString() : null,
        estimatedHours:     values.estimatedHours ? parseFloat(values.estimatedHours) : null,
        assignedEmployeeId: assignee?.id ?? null,
        isClientVisible:    values.isClientVisible,
        tags:               values.tags || null,
      }

      const url    = isEdit ? `/api/tasks/${task.id}` : `/api/projects/${projectId}/tasks`
      const method = isEdit ? 'PUT' : 'POST'

      const res  = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) { toast.error(json.error ?? 'Failed to save task'); return }

      toast.success(isEdit ? 'Task updated' : 'Task created')
      onSave?.(json.data)
      onClose()
    } catch {
      toast.error('Something went wrong')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]">
      <div className="flex max-h-[90vh] w-full max-w-xl flex-col rounded-2xl border border-gray-200/80 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 pb-3 pt-5">
          <h2 className="text-base font-semibold tracking-tight text-gray-900">{isEdit ? 'Edit task' : 'New task'}</h2>
          <Button variant="ghost" size="icon-sm" onClick={onClose} className="-mr-1.5 -mt-0.5 text-gray-400" aria-label="Close">
            <X />
          </Button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit(onSubmit)} className="flex-1 space-y-4 overflow-y-auto px-6 pb-5 pt-1">
          <Field label="Title" required error={errors.title?.message}>
            <Input {...register('title')} placeholder="Task title" invalid={!!errors.title} />
          </Field>

          <Field label="Description">
            <Textarea {...register('description')} rows={3} placeholder="Description…" className="resize-none" />
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Status">
              <Controller name="status" control={control} render={({ field }) => (
                <Select value={field.value} onChange={v => field.onChange(v ?? 'TODO')}
                  options={[
                    { value: 'TODO',        label: 'To do' },
                    { value: 'IN_PROGRESS', label: 'In progress' },
                    { value: 'IN_REVIEW',   label: 'In review' },
                    { value: 'COMPLETED',   label: 'Completed' },
                    { value: 'CANCELLED',   label: 'Cancelled' },
                  ]} placeholder="Select…" />
              )} />
            </Field>
            <Field label="Priority">
              <Controller name="priority" control={control} render={({ field }) => (
                <Select value={field.value} onChange={v => field.onChange(v ?? 'MEDIUM')}
                  options={[
                    { value: 'LOW',    label: 'Low' },
                    { value: 'MEDIUM', label: 'Medium' },
                    { value: 'HIGH',   label: 'High' },
                    { value: 'URGENT', label: 'Urgent' },
                  ]} placeholder="Select…" />
              )} />
            </Field>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Due date">
              <Input type="date" {...register('dueDate')} />
            </Field>
            <Field label="Estimated hours">
              <Input type="number" step="0.5" {...register('estimatedHours')} placeholder="0" />
            </Field>
          </div>

          {/* Assignee — employees only */}
          <Field label="Assignee" hint="In-house team only">
            <span title="Outsiders are engaged from the project’s Freelancers tab." className="block">
              <PeoplePicker types={['EMPLOYEE']} value={assignee} onChange={setAssignee}
                placeholder="Search team members…" typeFilter={false} />
            </span>
          </Field>

          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Tags">
              <Input {...register('tags')} placeholder="e.g. design, copy" />
            </Field>
            <div className="flex items-end pb-2">
              <label className="flex cursor-pointer items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" {...register('isClientVisible')} className="size-4 rounded border-gray-300" />
                Visible to client
              </label>
            </div>
          </div>
        </form>

        {/* Footer */}
        <div className="flex flex-col-reverse gap-2 rounded-b-2xl border-t border-gray-100 bg-gray-50/60 px-6 py-3.5 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit(onSubmit)} loading={isSubmitting}>
            {isEdit ? 'Save changes' : 'Create task'}
          </Button>
        </div>
      </div>
    </div>
  )
}
