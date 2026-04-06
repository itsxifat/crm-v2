'use client'

import { useEffect, useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { X, Loader2, Briefcase } from 'lucide-react'
import toast from 'react-hot-toast'
import Select from '@/components/ui/Select'
import DatePicker from '@/components/ui/DatePicker'

const schema = z.object({
  name:        z.string().min(1, 'Project name is required'),
  description: z.string().optional(),
  clientId:    z.string().min(1, 'Client is required'),
  status:      z.enum(['PLANNING','IN_PROGRESS','ON_HOLD','COMPLETED','CANCELLED']),
  priority:    z.enum(['LOW','MEDIUM','HIGH','URGENT']),
  startDate:   z.string().optional(),
  endDate:     z.string().optional(),
  budget:      z.string().optional(),
  currency:    z.string().length(3),
  tags:        z.string().optional(),
})

export default function ProjectModal({ project, onClose, onSave }) {
  const [clients, setClients] = useState([])
  const [loadingClients, setLoadingClients] = useState(true)

  const isEdit = !!project

  const {
    register,
    control,
    handleSubmit,
    formState: { errors, isSubmitting },
    reset,
  } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      name:        project?.name ?? '',
      description: project?.description ?? '',
      clientId:    project?.clientId ?? '',
      status:      project?.status ?? 'PLANNING',
      priority:    project?.priority ?? 'MEDIUM',
      startDate:   project?.startDate ? new Date(project.startDate).toISOString().split('T')[0] : '',
      endDate:     project?.endDate   ? new Date(project.endDate).toISOString().split('T')[0]   : '',
      budget:      project?.budget?.toString() ?? '',
      currency:    project?.currency ?? 'BDT',
      tags:        project?.tags ?? '',
    },
  })

  useEffect(() => {
    async function loadClients() {
      try {
        const res  = await fetch('/api/clients?limit=100')
        const json = await res.json()
        setClients(json.data ?? [])
      } catch {
        toast.error('Failed to load clients')
      } finally {
        setLoadingClients(false)
      }
    }
    loadClients()
  }, [])

  async function onSubmit(values) {
    try {
      const payload = {
        ...values,
        budget:    values.budget ? parseFloat(values.budget) : null,
        startDate: values.startDate ? new Date(values.startDate).toISOString() : null,
        endDate:   values.endDate   ? new Date(values.endDate).toISOString()   : null,
      }

      const url    = isEdit ? `/api/projects/${project.id}` : '/api/projects'
      const method = isEdit ? 'PUT' : 'POST'

      const res  = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(payload),
      })
      const json = await res.json()

      if (!res.ok) {
        toast.error(json.error ?? 'Failed to save project')
        return
      }

      toast.success(isEdit ? 'Project updated!' : 'Project created!')
      onSave?.(json.data)
      onClose()
    } catch {
      toast.error('Something went wrong')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 bg-primary/10 rounded-lg flex items-center justify-center">
              <Briefcase className="w-4 h-4 text-primary" />
            </div>
            <div>
              <h2 className="font-semibold text-gray-900">{isEdit ? 'Edit Project' : 'New Project'}</h2>
              <p className="text-xs text-gray-500">{isEdit ? 'Update project details' : 'Create a new project'}</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit(onSubmit)} className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {/* Name */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Project Name <span className="text-red-500">*</span>
            </label>
            <input
              {...register('name')}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              placeholder="e.g. Website Redesign"
            />
            {errors.name && <p className="text-xs text-red-500 mt-1">{errors.name.message}</p>}
          </div>

          {/* Description */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
            <textarea
              {...register('description')}
              rows={3}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary resize-none"
              placeholder="Project description..."
            />
          </div>

          {/* Client */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Client <span className="text-red-500">*</span>
            </label>
            {loadingClients ? (
              <div className="flex items-center gap-2 py-2 text-sm text-gray-400">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading clients...
              </div>
            ) : (
              <Controller name="clientId" control={control} render={({ field }) => (
                <Select value={field.value} onChange={v => field.onChange(v ?? '')}
                  options={clients.map(c => ({ value: c.id, label: `${c.user?.name}${c.company ? ` (${c.company})` : ''}` }))}
                  placeholder="Select client..."
                />
              )} />
            )}
            {errors.clientId && <p className="text-xs text-red-500 mt-1">{errors.clientId.message}</p>}
          </div>

          {/* Status + Priority */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status</label>
              <Controller name="status" control={control} render={({ field }) => (
                <Select value={field.value} onChange={v => field.onChange(v ?? 'PLANNING')}
                  options={[
                    { value: 'PLANNING',    label: 'Planning' },
                    { value: 'IN_PROGRESS', label: 'In Progress' },
                    { value: 'ON_HOLD',     label: 'On Hold' },
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

          {/* Dates */}
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Start Date</label>
              <Controller name="startDate" control={control} render={({ field }) => (
                <DatePicker value={field.value || null} onChange={v => field.onChange(v ?? '')} />
              )} />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">End Date</label>
              <Controller name="endDate" control={control} render={({ field }) => (
                <DatePicker value={field.value || null} onChange={v => field.onChange(v ?? '')} />
              )} />
            </div>
          </div>

          {/* Budget + Currency */}
          <div className="grid grid-cols-3 gap-4">
            <div className="col-span-2">
              <label className="block text-sm font-medium text-gray-700 mb-1">Budget</label>
              <input
                type="number"
                step="0.01"
                {...register('budget')}
                className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Currency</label>
              <Controller name="currency" control={control} render={({ field }) => (
                <Select value={field.value} onChange={v => field.onChange(v ?? 'BDT')}
                  options={[
                    { value: 'USD', label: 'USD' },
                    { value: 'EUR', label: 'EUR' },
                    { value: 'GBP', label: 'GBP' },
                    { value: 'BDT', label: 'BDT' },
                    { value: 'INR', label: 'INR' },
                    { value: 'CAD', label: 'CAD' },
                    { value: 'AUD', label: 'AUD' },
                  ]}
                  placeholder="Select currency…"
                />
              )} />
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Tags</label>
            <input
              {...register('tags')}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-primary/30 focus:border-primary"
              placeholder="e.g. web, design, urgent (comma separated)"
            />
          </div>
        </form>

        {/* Footer */}
        <div className="flex items-center justify-end gap-3 px-6 py-4 border-t border-gray-100">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSubmit(onSubmit)}
            disabled={isSubmitting}
            className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-primary rounded-lg hover:bg-primary/90 disabled:opacity-60 transition-colors"
          >
            {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
            {isEdit ? 'Save Changes' : 'Create Project'}
          </button>
        </div>
      </div>
    </div>
  )
}
