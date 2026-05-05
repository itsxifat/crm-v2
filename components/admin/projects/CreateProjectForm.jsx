'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import {
  Loader2, ArrowLeft, Building2, Calendar, Users, DollarSign,
  ChevronDown, Tag, FileText, Zap, RefreshCw,
} from 'lucide-react'
import toast from 'react-hot-toast'
import ClientSearch from '@/components/ui/ClientSearch'
import Select from '@/components/ui/Select'
import DatePicker from '@/components/ui/DatePicker'

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
  discount:         z.coerce.number().min(0).optional(),
  currency:         z.string().default('BDT'),
  tags:             z.string().optional(),
})

// toJSON strips _id → id; we must use .id not ._id when extracting populated refs
function extractId(ref) {
  if (!ref) return ''
  if (typeof ref === 'string') return ref
  return ref.id ?? ref._id?.toString() ?? ''
}

const VENTURE_ACCENT = {
  ENSTUDIO: { dot: 'bg-purple-500', bar: 'border-l-purple-500', activeBg: 'bg-purple-50', activeText: 'text-purple-700', activeBorder: 'border-purple-200' },
  ENTECH:   { dot: 'bg-blue-500',   bar: 'border-l-blue-500',   activeBg: 'bg-blue-50',   activeText: 'text-blue-700',   activeBorder: 'border-blue-200'   },
  ENMARK:   { dot: 'bg-emerald-500',bar: 'border-l-emerald-500',activeBg: 'bg-emerald-50',activeText: 'text-emerald-700',activeBorder: 'border-emerald-200'},
  _default: { dot: 'bg-gray-400',   bar: 'border-l-gray-400',   activeBg: 'bg-gray-50',   activeText: 'text-gray-700',   activeBorder: 'border-gray-200'   },
}

const PRIORITY_CONFIG = {
  LOW:    { label: 'Low',    color: 'text-gray-500'  },
  MEDIUM: { label: 'Medium', color: 'text-amber-600' },
  HIGH:   { label: 'High',   color: 'text-orange-600'},
  URGENT: { label: 'Urgent', color: 'text-red-600'   },
}

function SectionCard({ icon: Icon, title, children }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2.5 px-6 py-4 border-b border-gray-50">
        <div className="w-7 h-7 rounded-lg bg-gray-900 flex items-center justify-center flex-shrink-0">
          <Icon className="w-3.5 h-3.5 text-white" />
        </div>
        <h2 className="text-sm font-semibold text-gray-900 tracking-tight">{title}</h2>
      </div>
      <div className="p-6">{children}</div>
    </div>
  )
}

function Field({ label, error, required, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1.5">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
      {error && <p className="mt-1 text-xs text-red-500">{error}</p>}
    </div>
  )
}

const ic = 'w-full bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:bg-white focus:border-gray-400 focus:ring-0 transition-colors'

export default function CreateProjectForm({ project }) {
  const router   = useRouter()
  const isEdit   = !!project
  const [managers,      setManagers]      = useState([])
  const [ventures,      setVentures]      = useState([])
  const [svcMap,        setSvcMap]        = useState({})
  const [configLoading, setConfigLoading] = useState(true)

  const { register, control, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm({
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
      startDate:        project.startDate ? project.startDate.slice(0, 10) : '',
      deadline:         project.deadline  ? project.deadline.slice(0, 10)  : '',
      budget:           project.budget    ?? '',
      discount:         project.discount  ?? '',
      currency:         'BDT',
      tags:             project.tags       ?? '',
    } : {
      priority: 'MEDIUM',
      currency: 'BDT',
      projectType: undefined,
    },
  })

  const venture     = watch('venture')
  const projectType = watch('projectType')
  const budget      = watch('budget')
  const discount    = watch('discount')
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

  useEffect(() => {
    if (!isEdit) { setValue('category', ''); setValue('subcategory', '') }
  }, [venture, isEdit, setValue])

  const categories    = venture ? Object.keys(svcMap[venture] ?? {}) : []
  const subcategories = venture && category ? (svcMap[venture]?.[category] ?? []) : []
  const budgetNum     = Number(budget) || 0
  const discountNum   = Number(discount) || 0
  const netValue      = budgetNum - discountNum

  async function onSubmit(data) {
    try {
      const body = { ...data }
      if (!body.description)                              delete body.description
      if (!body.subcategory)                              delete body.subcategory
      if (!body.projectManagerId)                         delete body.projectManagerId
      if (!body.startDate)                                delete body.startDate
      if (!body.deadline)                                 delete body.deadline
      if (body.budget   === '' || body.budget   == null)  delete body.budget
      if (body.discount === '' || body.discount == null)  delete body.discount
      if (!body.tags)                                     delete body.tags

      const url    = isEdit ? `/api/projects/${project.id}` : '/api/projects'
      const method = isEdit ? 'PUT' : 'POST'
      const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json   = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      toast.success(isEdit ? 'Project updated' : 'Project created!')
      router.push(`/admin/projects/${json.data.id}`)
    } catch (err) {
      toast.error(err.message)
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">

      {/* ── Venture ── */}
      <SectionCard icon={Building2} title="Venture">
        {configLoading ? (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading ventures…
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
            {ventures.map(v => {
              const s       = VENTURE_ACCENT[v.id] ?? VENTURE_ACCENT._default
              const active  = venture === v.id
              return (
                <button key={v.id} type="button"
                  onClick={() => setValue('venture', v.id, { shouldValidate: true })}
                  className={`relative group p-4 rounded-xl border-2 border-l-4 text-left transition-all duration-150
                    ${active
                      ? `${s.activeBg} ${s.activeBorder} ${s.bar}`
                      : `bg-gray-50 border-gray-200 ${s.bar} opacity-60 hover:opacity-100 hover:bg-white`
                    }`}>
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`w-2 h-2 rounded-full ${s.dot}`} />
                    <p className={`text-sm font-semibold ${active ? s.activeText : 'text-gray-700'}`}>{v.label}</p>
                  </div>
                  <p className="text-xs text-gray-500 leading-relaxed">{v.description}</p>
                </button>
              )
            })}
          </div>
        )}
        {errors.venture && <p className="mt-2 text-xs text-red-500">{errors.venture.message}</p>}
      </SectionCard>

      {/* ── Project Type ── */}
      <SectionCard icon={Zap} title="Project Type">
        <div className="grid grid-cols-2 gap-2.5">
          {[
            { value: 'FIXED',   label: 'Fixed Project',    desc: 'One-time delivery with a set deadline', icon: '◈' },
            { value: 'MONTHLY', label: 'Monthly Retainer', desc: 'Recurring work billed each period',     icon: '↻' },
          ].map(({ value, label, desc, icon }) => {
            const active = projectType === value
            return (
              <button key={value} type="button"
                onClick={() => setValue('projectType', value, { shouldValidate: true })}
                className={`p-4 rounded-xl border-2 text-left transition-all duration-150
                  ${active ? 'bg-gray-900 border-gray-900' : 'bg-gray-50 border-gray-200 hover:border-gray-300 hover:bg-white'}`}>
                <p className={`text-lg mb-1 ${active ? 'text-white' : 'text-gray-400'}`}>{icon}</p>
                <p className={`text-sm font-semibold ${active ? 'text-white' : 'text-gray-700'}`}>{label}</p>
                <p className={`text-xs mt-0.5 ${active ? 'text-gray-300' : 'text-gray-500'}`}>{desc}</p>
              </button>
            )
          })}
        </div>
        {errors.projectType && <p className="mt-2 text-xs text-red-500">{errors.projectType.message}</p>}
      </SectionCard>

      {/* ── Details ── */}
      <SectionCard icon={FileText} title="Project Details">
        <div className="space-y-4">
          <Field label="Project Name" required error={errors.name?.message}>
            <input {...register('name')} placeholder="e.g. Brand Identity Redesign" className={ic} />
          </Field>

          <Field label="Client" required error={errors.clientId?.message}>
            <ClientSearch
              value={watch('clientId') ?? ''}
              onChange={id => setValue('clientId', id, { shouldValidate: true })}
              error={undefined}
            />
          </Field>

          <div className="grid grid-cols-2 gap-3">
            <Field label="Category" required error={errors.category?.message}>
              <Controller name="category" control={control} render={({ field }) => (
                <Select value={field.value} onChange={v => field.onChange(v ?? '')}
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
                  placeholder="Optional…"
                  disabled={!category || subcategories.length === 0}
                />
              )} />
            </Field>
          </div>

          <Field label="Description">
            <textarea rows={3} {...register('description')} placeholder="Brief overview of scope and goals…"
              className={`${ic} resize-none`} />
          </Field>
        </div>
      </SectionCard>

      {/* ── Schedule ── */}
      <SectionCard icon={Calendar} title="Schedule">
        <div className="grid grid-cols-3 gap-3">
          <Field label="Order Date">
            <div className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3.5 py-2.5 text-sm text-gray-400 flex items-center justify-between">
              <span>{isEdit && project.orderDate ? new Date(project.orderDate).toLocaleDateString() : 'Today'}</span>
              <span className="text-xs text-gray-300">auto</span>
            </div>
          </Field>
          <Field label="Start Date">
            <Controller name="startDate" control={control} render={({ field }) => (
              <DatePicker value={field.value || null} onChange={v => field.onChange(v ?? '')} />
            )} />
          </Field>
          <Field label="Deadline" error={errors.deadline?.message}>
            <Controller name="deadline" control={control} render={({ field }) => (
              <DatePicker value={field.value || null} onChange={v => field.onChange(v ?? '')}
                disabled={projectType === 'MONTHLY'} />
            )} />
            {projectType === 'MONTHLY' && (
              <p className="mt-1 text-xs text-gray-400">N/A for retainers</p>
            )}
          </Field>
        </div>
      </SectionCard>

      {/* ── Team ── */}
      <SectionCard icon={Users} title="Team & Classification">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Project Manager">
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
                placeholder="Select priority…"
              />
            )} />
          </Field>
          <div className="col-span-2">
            <Field label="Tags">
              <div className="relative">
                <Tag className="absolute left-3.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-gray-400 pointer-events-none" />
                <input {...register('tags')} placeholder="design, branding, q1-2026…"
                  className={`${ic} pl-9`} />
              </div>
            </Field>
          </div>
        </div>
      </SectionCard>

      {/* ── Financials ── */}
      <SectionCard icon={DollarSign} title="Financials">
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Budget (৳)">
              <input type="number" step="0.01" min="0"
                {...register('budget')}
                onKeyDown={e => { if (e.key === '-' || e.key === 'e') e.preventDefault() }}
                placeholder="0.00" className={ic} />
            </Field>
            <Field label="Discount (৳)">
              <input type="number" step="0.01" min="0"
                {...register('discount')}
                onKeyDown={e => { if (e.key === '-' || e.key === 'e') e.preventDefault() }}
                placeholder="0.00" className={ic} />
            </Field>
          </div>

          {budgetNum > 0 && (
            <div className="rounded-xl bg-gray-900 text-white p-4 space-y-2">
              <p className="text-xs text-gray-400 uppercase tracking-widest font-medium mb-3">Financial Summary</p>
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-400">Contract Value</span>
                <span className="font-medium tabular-nums">৳{budgetNum.toLocaleString('en-BD', { minimumFractionDigits: 2 })}</span>
              </div>
              {discountNum > 0 && (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-gray-400">Discount</span>
                  <span className="text-red-400 font-medium tabular-nums">− ৳{discountNum.toLocaleString('en-BD', { minimumFractionDigits: 2 })}</span>
                </div>
              )}
              <div className="border-t border-gray-700 pt-2 flex items-center justify-between">
                <span className="text-sm font-semibold">Net Value</span>
                <span className={`text-base font-bold tabular-nums ${netValue < 0 ? 'text-red-400' : 'text-emerald-400'}`}>
                  ৳{netValue.toLocaleString('en-BD', { minimumFractionDigits: 2 })}
                </span>
              </div>
            </div>
          )}

          <div className="flex items-center gap-2 text-xs text-gray-400">
            <span className="w-4 h-px bg-gray-200" />
            Currency is BDT — contact admin to change
          </div>
        </div>
      </SectionCard>

      {/* ── Footer ── */}
      <div className="flex items-center justify-between pt-2 pb-8">
        <button type="button" onClick={() => router.back()}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <button type="submit" disabled={isSubmitting}
          className="flex items-center gap-2 px-6 py-2.5 text-sm font-semibold text-white bg-gray-900 rounded-xl
            hover:bg-gray-800 active:scale-[0.98] disabled:opacity-50 transition-all duration-150">
          {isSubmitting ? <Loader2 className="w-4 h-4 animate-spin" /> : (isEdit ? <RefreshCw className="w-4 h-4" /> : <Zap className="w-4 h-4" />)}
          {isEdit ? 'Save Changes' : 'Create Project'}
        </button>
      </div>
    </form>
  )
}
