'use client'

import { useEffect, useState } from 'react'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { X, Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import Select from '@/components/ui/Select'
import Button from '@/components/ui/Button'
import { Input, Textarea, Field } from '@/components/ui/Input'

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

      toast.success(isEdit ? 'Project updated' : 'Project created')
      onSave?.(json.data)
      onClose()
    } catch {
      toast.error('Something went wrong')
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]">
      <div className="flex max-h-[90vh] w-full max-w-2xl flex-col rounded-2xl border border-gray-200/80 bg-white shadow-2xl">
        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 pb-3 pt-5">
          <h2 className="text-base font-semibold tracking-tight text-gray-900">{isEdit ? 'Edit project' : 'New project'}</h2>
          <Button variant="ghost" size="icon-sm" onClick={onClose} className="-mr-1.5 -mt-0.5 text-gray-400" aria-label="Close">
            <X />
          </Button>
        </div>

        {/* Body */}
        <form onSubmit={handleSubmit(onSubmit)} className="flex-1 space-y-4 overflow-y-auto px-6 pb-5 pt-1">
          <Field label="Project name" required error={errors.name?.message}>
            <Input {...register('name')} placeholder="e.g. Website redesign" invalid={!!errors.name} />
          </Field>

          <Field label="Description">
            <Textarea {...register('description')} rows={3} placeholder="Description…" className="resize-none" />
          </Field>

          <Field label="Client" required error={errors.clientId?.message}>
            {loadingClients ? (
              <div className="flex h-9 items-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" />
                Loading…
              </div>
            ) : (
              <Controller name="clientId" control={control} render={({ field }) => (
                <Select value={field.value} onChange={v => field.onChange(v ?? '')}
                  options={clients.map(c => ({ value: c.id, label: `${c.user?.name}${c.company ? ` (${c.company})` : ''}` }))}
                  placeholder="Select…"
                />
              )} />
            )}
          </Field>

          {/* Status + Priority */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Status">
              <Controller name="status" control={control} render={({ field }) => (
                <Select value={field.value} onChange={v => field.onChange(v ?? 'PLANNING')}
                  options={[
                    { value: 'PLANNING',    label: 'Planning' },
                    { value: 'IN_PROGRESS', label: 'In progress' },
                    { value: 'ON_HOLD',     label: 'On hold' },
                    { value: 'COMPLETED',   label: 'Completed' },
                    { value: 'CANCELLED',   label: 'Cancelled' },
                  ]}
                  placeholder="Select…"
                />
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
                  ]}
                  placeholder="Select…"
                />
              )} />
            </Field>
          </div>

          {/* Dates */}
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Start date">
              <Input type="date" {...register('startDate')} />
            </Field>
            <Field label="End date">
              <Input type="date" {...register('endDate')} />
            </Field>
          </div>

          {/* Budget + Currency */}
          <div className="grid grid-cols-3 gap-4">
            <Field label="Budget" className="col-span-2">
              <Input type="number" step="0.01" {...register('budget')} placeholder="0.00" />
            </Field>
            <Field label="Currency">
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
                  placeholder="Select…"
                />
              )} />
            </Field>
          </div>

          <Field label="Tags">
            <Input {...register('tags')} placeholder="e.g. web, design" />
          </Field>
        </form>

        {/* Footer */}
        <div className="flex flex-col-reverse gap-2 rounded-b-2xl border-t border-gray-100 bg-gray-50/60 px-6 py-3.5 sm:flex-row sm:justify-end">
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSubmit(onSubmit)} loading={isSubmitting}>
            {isEdit ? 'Save changes' : 'Create project'}
          </Button>
        </div>
      </div>
    </div>
  )
}
