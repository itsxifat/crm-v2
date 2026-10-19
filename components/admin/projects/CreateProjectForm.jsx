'use client'

import { useState, useEffect, useRef } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2, ArrowLeft, Plus, RefreshCw, Package, Repeat } from 'lucide-react'
import toast from 'react-hot-toast'
import ClientSearch from '@/components/ui/ClientSearch'
import Select from '@/components/ui/Select'
import DatePicker from '@/components/ui/DatePicker'
import Button from '@/components/ui/Button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Input, Textarea, Field } from '@/components/ui/Input'
import { cn } from '@/lib/utils'
import { dhakaDayKey } from '@/lib/dhakaTime'

const schema = z.object({
  name:             z.string().min(1, 'Project name required'),
  description:      z.string().optional(),
  clientId:         z.string().min(1, 'Client required'),
  venture:          z.string().min(1, 'Venture required'),
  category:         z.string().min(1, 'Category required'),
  subcategory:      z.string().optional(),
  projectType:      z.enum(['FIXED', 'MONTHLY'], { required_error: 'Project type required' }),
  projectManagerId: z.string().optional(),
  priority:         z.enum(['LOW', 'MEDIUM', 'HIGH', 'URGENT']).default('MEDIUM'),
  startDate:        z.string().optional(),
  deadline:         z.string().optional(),
  budget:           z.coerce.number().min(0).optional(),
  currency:         z.string().default('BDT'),
  tags:             z.string().optional(),
})

// toJSON strips _id → id; we must use .id not ._id when extracting populated refs
function extractId(ref) {
  if (!ref) return ''
  if (typeof ref === 'string') return ref
  return ref.id ?? ref._id?.toString() ?? ''
}

const VENTURE_DOT = {
  ENSTUDIO: 'bg-violet-500',
  ENTECH:   'bg-blue-500',
  ENMARK:   'bg-emerald-500',
  _default: 'bg-gray-400',
}

const PRIORITY_CONFIG = {
  LOW:    { label: 'Low',    color: 'text-gray-500'  },
  MEDIUM: { label: 'Medium', color: 'text-amber-600' },
  HIGH:   { label: 'High',   color: 'text-orange-600'},
  URGENT: { label: 'Urgent', color: 'text-red-600'   },
}

const optionCard = (active) => cn(
  'rounded-lg border p-4 text-left transition-colors outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50',
  active
    ? 'border-gray-900 bg-white ring-1 ring-gray-900'
    : 'border-gray-200/80 bg-white hover:bg-gray-50'
)

function SectionCard({ title, children }) {
  return (
    <Card>
      <CardHeader className="px-6 pb-4 pt-5">
        <CardTitle>{title}</CardTitle>
      </CardHeader>
      <CardContent className="px-6 pb-6">{children}</CardContent>
    </Card>
  )
}

export default function CreateProjectForm({ project }) {
  const router   = useRouter()
  const isEdit   = !!project
  // Allow pre-selecting a client when arriving from a client/company page.
  const prefillClientId = useSearchParams().get('clientId') ?? ''
  const [managers,      setManagers]      = useState([])
  const [ventures,      setVentures]      = useState([])
  const [svcMap,        setSvcMap]        = useState({})
  const [configLoading, setConfigLoading] = useState(true)

  const { register, control, handleSubmit, watch, setValue, getValues, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: isEdit ? {
      name:             project.name             ?? '',
      description:      project.description      ?? '',
      clientId:         extractId(project.clientId),
      venture:          project.venture           ?? '',
      category:         project.category          ?? '',
      subcategory:      project.subcategory       ?? '',
      projectType:      project.projectType       ?? 'FIXED',
      projectManagerId: extractId(project.projectManagerId),
      priority:         project.priority          ?? 'MEDIUM',
      // Calendar day in the business timezone (Asia/Dhaka), not the UTC date.
      startDate:        project.startDate ? dhakaDayKey(project.startDate) : '',
      deadline:         project.deadline  ? dhakaDayKey(project.deadline)  : '',
      budget:           project.budget    ?? '',
      currency:         'BDT',
      tags:             project.tags       ?? '',
    } : {
      clientId: prefillClientId,
      priority: 'MEDIUM',
      currency: 'BDT',
      projectType: undefined,
    },
  })

  const venture     = watch('venture')
  const projectType = watch('projectType')
  const budget      = watch('budget')
  const category    = watch('category')

  useEffect(() => {
    fetch('/api/employees?limit=200')
      .then(r => r.json())
      .then(j => setManagers((j.data ?? []).filter(e => e.userId?.id).map(e => ({ id: e.userId.id, name: e.userId.name }))))
  }, [])

  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then(j => {
        const cfg = j.data ?? {}
        setVentures((cfg.ventures ?? []).filter(v => v.active !== false))
        const map = {}
        for (const [vid, services] of Object.entries(cfg.services ?? {})) {
          map[vid] = {}
          for (const svc of services) map[vid][svc.label] = svc.subcategories ?? []
        }
        setSvcMap(map)
      })
      .catch(() => toast.error('Failed to load config'))
      .finally(() => setConfigLoading(false))
  }, [])

  // When the venture changes (create or edit), drop a category / subcategory
  // that does not exist under the new venture.
  const prevVenture = useRef(venture)
  useEffect(() => {
    if (prevVenture.current === venture) return
    prevVenture.current = venture
    const cats = svcMap[venture] ?? {}
    const cat  = getValues('category')
    if (!cat || !Object.prototype.hasOwnProperty.call(cats, cat)) {
      setValue('category', ''); setValue('subcategory', '')
    } else if (!(cats[cat] ?? []).includes(getValues('subcategory'))) {
      setValue('subcategory', '')
    }
  }, [venture, svcMap, getValues, setValue])

  const categories    = venture ? Object.keys(svcMap[venture] ?? {}) : []
  const subcategories = venture && category ? (svcMap[venture]?.[category] ?? []) : []
  const budgetNum     = Number(budget) || 0

  async function onSubmit(data) {
    try {
      const body = { ...data }
      // Monthly retainers have billing periods, not a deadline.
      if (body.projectType === 'MONTHLY') body.deadline = ''
      // Create: omit empty optional fields. Edit: send them as null so a
      // cleared value is actually cleared (PUT only touches fields present).
      const clear = (k) => { if (isEdit) body[k] = null; else delete body[k] }
      if (!body.description)                              clear('description')
      if (!body.subcategory)                              clear('subcategory')
      if (!body.projectManagerId)                         clear('projectManagerId')
      if (!body.startDate)                                clear('startDate')
      if (!body.deadline)                                 clear('deadline')
      if (body.budget   === '' || body.budget   == null)  delete body.budget
      if (!body.tags)                                     clear('tags')

      const url    = isEdit ? `/api/projects/${project.id}` : '/api/projects'
      const method = isEdit ? 'PUT' : 'POST'
      const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json   = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      toast.success(isEdit ? 'Project updated' : 'Project created')
      router.push(`/admin/projects/${json.data.id}`)
    } catch (err) {
      toast.error(err.message)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">

      {/* ── Venture ── */}
      <SectionCard title="Venture">
        {configLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> Loading…
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {ventures.map(v => {
              const active = venture === v.id
              return (
                <button key={v.id} type="button"
                  onClick={() => setValue('venture', v.id, { shouldValidate: true })}
                  className={optionCard(active)}>
                  <div className="mb-1 flex items-center gap-2">
                    <span className={cn('size-2 rounded-full', VENTURE_DOT[v.id] ?? VENTURE_DOT._default)} />
                    <p className="text-sm font-medium text-gray-900">{v.label}</p>
                  </div>
                  {v.description && <p className="text-xs leading-relaxed text-muted-foreground">{v.description}</p>}
                </button>
              )
            })}
          </div>
        )}
        {errors.venture && <p className="mt-2 text-xs text-red-600">{errors.venture.message}</p>}
      </SectionCard>

      {/* ── Project Type ── */}
      <SectionCard title="Project type">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {[
            { value: 'FIXED',   label: 'Fixed project',    desc: 'One-time delivery with a deadline', icon: Package },
            { value: 'MONTHLY', label: 'Monthly retainer', desc: 'Recurring, billed each period',      icon: Repeat },
          ].map(({ value, label, desc, icon: Icon }) => {
            const active = projectType === value
            return (
              <button key={value} type="button"
                // The lifecycle is fixed once the project exists (the API rejects a change).
                disabled={isEdit && !active}
                title={isEdit ? 'Project type can’t be changed after creation' : undefined}
                onClick={() => {
                  if (isEdit) return
                  setValue('projectType', value, { shouldValidate: true })
                  if (value === 'MONTHLY') setValue('deadline', '')
                }}
                className={cn(optionCard(active), 'flex items-start gap-3', isEdit && !active && 'cursor-not-allowed opacity-40 hover:bg-white')}>
                <Icon className={cn('mt-0.5 size-4 shrink-0', active ? 'text-gray-900' : 'text-gray-400')} />
                <div>
                  <p className="text-sm font-medium text-gray-900">{label}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{desc}</p>
                </div>
              </button>
            )
          })}
        </div>
        {errors.projectType && <p className="mt-2 text-xs text-red-600">{errors.projectType.message}</p>}
      </SectionCard>

      {/* ── Details ── */}
      <SectionCard title="Details">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Project name" required error={errors.name?.message} className="sm:col-span-2">
            <Input {...register('name')} placeholder="e.g. Brand identity redesign" invalid={!!errors.name} />
          </Field>

          <Field label="Client" required error={errors.clientId?.message} className="sm:col-span-2">
            <ClientSearch
              value={watch('clientId') ?? ''}
              onChange={id => setValue('clientId', id, { shouldValidate: true })}
              error={undefined}
            />
          </Field>

          <Field label="Category" required error={errors.category?.message}>
            <Controller name="category" control={control} render={({ field }) => (
              <Select value={field.value} onChange={v => {
                // Subcategories belong to a category — reset on change.
                if ((v ?? '') !== field.value) setValue('subcategory', '')
                field.onChange(v ?? '')
              }}
                options={categories.map(c => ({ value: c, label: c }))}
                placeholder="Select…"
                disabled={!venture || configLoading}
              />
            )} />
          </Field>
          <Field label="Subcategory">
            <Controller name="subcategory" control={control} render={({ field }) => (
              <Select value={field.value} onChange={v => field.onChange(v ?? '')}
                options={subcategories.map(s => ({ value: s, label: s }))}
                placeholder="Optional"
                disabled={!category || subcategories.length === 0}
              />
            )} />
          </Field>

          <Field label="Description" className="sm:col-span-2">
            <Textarea rows={3} {...register('description')} placeholder="Scope and goals…" className="resize-none" />
          </Field>
        </div>
      </SectionCard>

      {/* ── Schedule ── */}
      <SectionCard title="Schedule">
        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Order date">
            <div className="flex h-9 w-full items-center justify-between rounded-lg border border-input bg-gray-50 px-3 text-sm text-gray-500">
              <span>{isEdit && project.orderDate ? new Date(project.orderDate).toLocaleDateString() : 'Today'}</span>
              <span className="text-xs text-gray-400">Auto</span>
            </div>
          </Field>
          <Field label="Start date">
            <Controller name="startDate" control={control} render={({ field }) => (
              <DatePicker value={field.value || null} onChange={v => field.onChange(v ?? '')} />
            )} />
          </Field>
          <Field
            label="Deadline"
            error={errors.deadline?.message}
            hint={projectType === 'MONTHLY' ? 'N/A for retainers' : undefined}
          >
            <Controller name="deadline" control={control} render={({ field }) => (
              <DatePicker value={field.value || null} onChange={v => field.onChange(v ?? '')}
                disabled={projectType === 'MONTHLY'} />
            )} />
          </Field>
        </div>
      </SectionCard>

      {/* ── Team ── */}
      <SectionCard title="Team & classification">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Project manager">
            <Controller name="projectManagerId" control={control} render={({ field }) => (
              <Select value={field.value} onChange={v => field.onChange(v ?? '')}
                options={managers.map(m => ({ value: m.id, label: m.name }))}
                placeholder="Unassigned"
              />
            )} />
          </Field>
          <Field label="Priority">
            <Controller name="priority" control={control} render={({ field }) => (
              <Select value={field.value} onChange={v => field.onChange(v ?? 'MEDIUM')}
                options={Object.entries(PRIORITY_CONFIG).map(([v, c]) => ({ value: v, label: c.label }))}
                placeholder="Select…"
              />
            )} />
          </Field>
          <Field label="Tags" className="sm:col-span-2">
            <Input {...register('tags')} placeholder="e.g. design, branding" />
          </Field>
        </div>
      </SectionCard>

      {/* ── Financials ── */}
      <SectionCard title="Financials">
        <div className="space-y-4">
          <Field label="Project value (৳)" hint="Net amount the client pays, in BDT">
            <Input type="number" step="0.01" min="0"
              {...register('budget')}
              onKeyDown={e => { if (e.key === '-' || e.key === 'e') e.preventDefault() }}
              placeholder="0.00" />
          </Field>

          {budgetNum > 0 && (
            <div className="flex items-center justify-between rounded-lg bg-gray-50 px-4 py-3">
              <span className="text-sm text-muted-foreground">Project value</span>
              <span className="text-base font-semibold tabular-nums text-gray-900">
                ৳{budgetNum.toLocaleString('en-BD', { minimumFractionDigits: 2 })}
              </span>
            </div>
          )}
        </div>
      </SectionCard>

      {/* ── Footer ── */}
      <div className="flex flex-wrap items-center justify-between gap-2 pb-8 pt-2">
        <Button variant="ghost" onClick={() => router.back()}>
          <ArrowLeft /> Back
        </Button>
        <Button type="submit" loading={isSubmitting}>
          {!isSubmitting && (isEdit ? <RefreshCw /> : <Plus />)}
          {isEdit ? 'Save changes' : 'Create project'}
        </Button>
      </div>
    </form>
  )
}
