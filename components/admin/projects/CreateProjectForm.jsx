'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useForm, Controller } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { Loader2 } from 'lucide-react'
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
  projectType:      z.enum(['FIXED','MONTHLY'], { required_error: 'Project type required' }),
  projectManagerId: z.string().optional(),
  priority:         z.enum(['LOW','MEDIUM','HIGH','URGENT']).default('MEDIUM'),
  startDate:        z.string().optional(),
  deadline:         z.string().optional(),
  budget:           z.coerce.number().min(0).optional(),
  discount:         z.coerce.number().min(0).optional(),
  currency:         z.string().default('BDT'),
  tags:             z.string().optional(),
})

// Fallback styles for the 3 built-in ventures; unknown ventures get a neutral style
const VENTURE_STYLES = {
  ENSTUDIO: { ring: 'ring-purple-500', bg: 'bg-purple-50', text: 'text-purple-700', border: 'border-purple-200' },
  ENTECH:   { ring: 'ring-blue-500',   bg: 'bg-blue-50',   text: 'text-blue-700',   border: 'border-blue-200'   },
  ENMARK:   { ring: 'ring-green-500',  bg: 'bg-green-50',  text: 'text-green-700',  border: 'border-green-200'  },
  _default: { ring: 'ring-gray-500',   bg: 'bg-gray-50',   text: 'text-gray-700',   border: 'border-gray-200'   },
}

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500'
const labelCls = 'block text-sm font-medium text-gray-700 mb-1'

export default function CreateProjectForm({ project }) {
  const router = useRouter()
  const isEdit = !!project
  const [managers,  setManagers]  = useState([])
  const [ventures,  setVentures]  = useState([])   // [{ id, label, description }]
  const [svcMap,    setSvcMap]    = useState({})    // { VENTURE_ID: { 'Label': ['sub1'] } }
  const [configLoading, setConfigLoading] = useState(true)

  const { register, control, handleSubmit, watch, setValue, formState: { errors, isSubmitting } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: isEdit ? {
      name:             project.name,
      description:      project.description ?? '',
      clientId:         project.clientId?._id ?? project.clientId ?? '',
      venture:          project.venture,
      category:         project.category,
      subcategory:      project.subcategory ?? '',
      projectType:      project.projectType,
      projectManagerId: project.projectManagerId?._id ?? project.projectManagerId ?? '',
      priority:         project.priority,
      startDate:        project.startDate ? project.startDate.slice(0,10) : '',
      deadline:         project.deadline  ? project.deadline.slice(0,10)  : '',
      budget:           project.budget   ?? '',
      discount:         project.discount ?? '',
      currency:         'BDT',
      tags:             project.tags ?? '',
    } : { priority: 'MEDIUM', currency: 'BDT' },
  })

  const venture     = watch('venture')
  const projectType = watch('projectType')
  const budget      = watch('budget')
  const discount    = watch('discount')
  const category    = watch('category')

  // Fetch managers
  useEffect(() => {
    fetch('/api/employees?limit=200').then(r => r.json()).then(j =>
      setManagers((j.data ?? []).filter(e => e.userId?.id).map(e => ({ id: e.userId.id, name: e.userId.name })))
    )
  }, [])

  // Fetch config (ventures + services) from DB
  useEffect(() => {
    fetch('/api/config')
      .then(r => r.json())
      .then(j => {
        const cfg = j.data ?? {}
        setVentures((cfg.ventures ?? []).filter(v => v.active !== false))

        // Convert services array → { 'Service Label': ['sub1', 'sub2'] }
        const map = {}
        for (const [vid, services] of Object.entries(cfg.services ?? {})) {
          map[vid] = {}
          for (const svc of services) {
            map[vid][svc.label] = svc.subcategories ?? []
          }
        }
        setSvcMap(map)
      })
      .catch(() => toast.error('Failed to load config'))
      .finally(() => setConfigLoading(false))
  }, [])

  // Reset category/subcategory when venture changes
  useEffect(() => {
    if (!isEdit) {
      setValue('category', '')
      setValue('subcategory', '')
    }
  }, [venture, isEdit, setValue])

  const categories    = venture ? Object.keys(svcMap[venture] ?? {}) : []
  const subcategories = venture && category ? (svcMap[venture]?.[category] ?? []) : []
  const profit        = (Number(budget) || 0) - (Number(discount) || 0)

  async function onSubmit(data) {
    try {
      const body = { ...data }
      if (!body.description)      delete body.description
      if (!body.subcategory)      delete body.subcategory
      if (!body.projectManagerId) delete body.projectManagerId
      if (!body.startDate)        delete body.startDate
      if (!body.deadline)         delete body.deadline
      if (body.budget === '' || body.budget === undefined) delete body.budget
      if (body.discount === '' || body.discount === undefined) delete body.discount
      if (!body.tags)             delete body.tags

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
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">

      {/* Venture */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Venture</h2>
        {configLoading ? (
          <div className="flex items-center gap-2 text-sm text-gray-400">
            <Loader2 className="w-4 h-4 animate-spin" /> Loading ventures…
          </div>
        ) : (
          <div className="grid grid-cols-3 gap-3">
            {ventures.map(v => {
              const s = VENTURE_STYLES[v.id] ?? VENTURE_STYLES._default
              return (
                <button key={v.id} type="button"
                  onClick={() => setValue('venture', v.id, { shouldValidate: true })}
                  className={`p-4 rounded-xl border-2 text-left transition-all ${venture === v.id ? `${s.ring} ring-2 ${s.bg} ${s.border}` : 'border-gray-200 hover:border-gray-300'}`}>
                  <p className={`text-sm font-bold ${venture === v.id ? s.text : 'text-gray-700'}`}>{v.label}</p>
                  <p className="text-xs text-gray-500 mt-0.5">{v.description}</p>
                </button>
              )
            })}
          </div>
        )}
        {errors.venture && <p className="text-xs text-red-500">{errors.venture.message}</p>}
      </div>

      {/* Project Type */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Project Type</h2>
        <div className="grid grid-cols-2 gap-3">
          {[
            { value: 'FIXED',   label: 'Fixed Project',    desc: 'One-time delivery with a deadline' },
            { value: 'MONTHLY', label: 'Monthly Retainer', desc: 'Recurring subscription with billing periods' },
          ].map(({ value, label, desc }) => (
            <button key={value} type="button"
              onClick={() => setValue('projectType', value, { shouldValidate: true })}
              className={`p-4 rounded-xl border-2 text-left transition-all ${projectType === value ? 'ring-2 ring-blue-500 bg-blue-50 border-blue-200' : 'border-gray-200 hover:border-gray-300'}`}>
              <p className={`text-sm font-bold ${projectType === value ? 'text-blue-700' : 'text-gray-700'}`}>{label}</p>
              <p className="text-xs text-gray-500 mt-0.5">{desc}</p>
            </button>
          ))}
        </div>
        {errors.projectType && <p className="text-xs text-red-500">{errors.projectType.message}</p>}
      </div>

      {/* Basic Info */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Basic Info</h2>
        <div>
          <label className={labelCls}>Project Name *</label>
          <input {...register('name')} placeholder="Project name" className={inputCls} />
          {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name.message}</p>}
        </div>
        <div>
          <label className={labelCls}>Client *</label>
          <ClientSearch
            value={watch('clientId') ?? ''}
            onChange={(id) => setValue('clientId', id, { shouldValidate: true })}
            error={errors.clientId?.message}
          />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Category *</label>
            <Controller name="category" control={control} render={({ field }) => (
              <Select value={field.value} onChange={v => field.onChange(v ?? '')}
                options={categories.map(c => ({ value: c, label: c }))}
                placeholder="Select category…"
                disabled={!venture || configLoading}
              />
            )} />
            {errors.category && <p className="mt-1 text-xs text-red-500">{errors.category.message}</p>}
          </div>
          <div>
            <label className={labelCls}>Subcategory</label>
            <Controller name="subcategory" control={control} render={({ field }) => (
              <Select value={field.value} onChange={v => field.onChange(v ?? '')}
                options={subcategories.map(s => ({ value: s, label: s }))}
                placeholder="Select subcategory…"
                disabled={!category || subcategories.length === 0}
              />
            )} />
          </div>
        </div>
        <div>
          <label className={labelCls}>Description</label>
          <textarea rows={3} {...register('description')} placeholder="Project description…"
            className={`${inputCls} resize-none`} />
        </div>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Priority</label>
            <Controller name="priority" control={control} render={({ field }) => (
              <Select value={field.value} onChange={v => field.onChange(v ?? 'MEDIUM')}
                options={['LOW','MEDIUM','HIGH','URGENT'].map(p => ({ value: p, label: p }))}
                placeholder="Select priority…"
              />
            )} />
          </div>
          <div>
            <label className={labelCls}>Tags</label>
            <input {...register('tags')} placeholder="tag1, tag2…" className={inputCls} />
          </div>
        </div>
      </div>

      {/* Dates */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Dates</h2>
        <div className="grid grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>Order Date</label>
            <div className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-gray-50 text-gray-500 flex items-center gap-2">
              <span>{isEdit ? (project.orderDate ? new Date(project.orderDate).toLocaleDateString() : '—') : new Date().toLocaleDateString()}</span>
              <span className="text-xs text-gray-400 ml-auto">auto-set, read-only</span>
            </div>
          </div>
          <div>
            <label className={labelCls}>Start Date</label>
            <Controller name="startDate" control={control} render={({ field }) => (
              <DatePicker value={field.value || null} onChange={v => field.onChange(v ?? '')} />
            )} />
          </div>
        </div>
        {projectType === 'FIXED' && (
          <div className="grid grid-cols-2 gap-4">
            <div />
            <div>
              <label className={labelCls}>Deadline</label>
              <Controller name="deadline" control={control} render={({ field }) => (
                <DatePicker value={field.value || null} onChange={v => field.onChange(v ?? '')} />
              )} />
            </div>
          </div>
        )}
      </div>

      {/* Team */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Team</h2>
        <div>
          <label className={labelCls}>Project Manager</label>
          <Controller name="projectManagerId" control={control} render={({ field }) => (
            <Select value={field.value} onChange={v => field.onChange(v ?? '')}
              options={managers.map(m => ({ value: m.id, label: m.name }))}
              placeholder="Unassigned"
            />
          )} />
        </div>
      </div>

      {/* Financials */}
      <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-6 space-y-4">
        <h2 className="text-sm font-semibold text-gray-700 uppercase tracking-wide">Financials</h2>
        <div className="grid grid-cols-3 gap-4">
          <div>
            <label className={labelCls}>Budget ($)</label>
            <input type="number" step="0.01" {...register('budget')} placeholder="0.00" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Discount ($)</label>
            <input type="number" step="0.01" {...register('discount')} placeholder="0.00" className={inputCls} />
          </div>
          <div>
            <label className={labelCls}>Currency</label>
            <div className={`${inputCls} bg-gray-50 text-gray-500`}>BDT</div>
            <input type="hidden" {...register('currency')} value="BDT" />
          </div>
        </div>
        {(Number(budget) > 0 || Number(discount) > 0) && (
          <div className="rounded-lg bg-gray-50 px-4 py-3 flex items-center justify-between">
            <span className="text-sm text-gray-500">Estimated Profit</span>
            <span className={`text-sm font-bold ${profit >= 0 ? 'text-green-600' : 'text-red-600'}`}>
              ${profit.toLocaleString()}
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center justify-end gap-3 pb-6">
        <button type="button" onClick={() => router.back()}
          className="px-4 py-2 text-sm font-medium text-gray-700 bg-white border border-gray-200 rounded-lg hover:bg-gray-50 transition-colors">
          Cancel
        </button>
        <button type="submit" disabled={isSubmitting}
          className="px-6 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors flex items-center gap-2">
          {isSubmitting && <Loader2 className="w-4 h-4 animate-spin" />}
          {isEdit ? 'Save Changes' : 'Create Project'}
        </button>
      </div>
    </form>
  )
}
