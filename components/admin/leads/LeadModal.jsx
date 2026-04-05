'use client'

import { useEffect, useState, useMemo, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { useForm, Controller, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'
import { Plus, X, Loader2, Send, Trash2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Select from '@/components/ui/Select'
import DatePicker from '@/components/ui/DatePicker'

const schema = z.object({
  name:             z.string().min(1, 'Name is required'),
  designation:      z.string().optional().nullable(),
  email:            z.string().email('Invalid email').optional().or(z.literal('')).nullable(),
  phone:            z.string().optional().nullable(),
  alternativePhone: z.string().optional().nullable(),
  company:          z.string().optional().nullable(),
  location:         z.string().optional().nullable(),
  status:           z.enum(['NEW','CONTACTED','PROPOSAL_SENT','NEGOTIATION','WON','LOST']).default('NEW'),
  priority:         z.enum(['LOW','NORMAL','HIGH','URGENT']).default('NORMAL'),
  service:          z.string().optional().nullable(),
  category:         z.string().optional().nullable(),
  subcategory:      z.string().optional().nullable(),
  source:           z.string().optional().nullable(),
  platform:         z.string().optional().nullable(),
  reference:        z.string().optional().nullable(),
  sendingDate:      z.string().optional().nullable(),
  followUpDate:     z.string().optional().nullable(),
  value:            z.string().optional().nullable(),
  assignedToId:     z.string().optional().nullable(),
  notes:            z.string().optional().nullable(),
})

const STATUSES = [
  { value: 'NEW',           label: 'New' },
  { value: 'CONTACTED',     label: 'Contacted' },
  { value: 'PROPOSAL_SENT', label: 'Proposal Sent' },
  { value: 'NEGOTIATION',   label: 'Negotiation' },
  { value: 'WON',           label: 'Won' },
  { value: 'LOST',          label: 'Lost' },
]

const PRIORITIES = [
  { value: 'LOW',    label: 'Low',    color: 'text-gray-500' },
  { value: 'NORMAL', label: 'Normal', color: 'text-blue-600' },
  { value: 'HIGH',   label: 'High',   color: 'text-orange-500' },
  { value: 'URGENT', label: 'Urgent', color: 'text-red-600' },
]

export default function LeadModal({ open, onClose, lead, onSuccess }) {
  const { data: session } = useSession()
  const [employees,     setEmployees]     = useState([])
  const [loading,       setLoading]       = useState(false)
  const [links,         setLinks]         = useState([])
  const [linkInput,     setLinkInput]     = useState('')
  const [comments,      setComments]      = useState([])
  const [commentText,   setCommentText]   = useState('')
  const [commentSaving, setCommentSaving] = useState(false)
  const [sources,       setSources]       = useState([])
  const [platforms,     setPlatforms]     = useState([])
  const [ventures,      setVentures]      = useState([])   // [{id, label}]
  const [servicesMap,   setServicesMap]   = useState({})   // { ventureId: [{id, label, subcategories}] }
  const isEdit = !!lead

  const { register, handleSubmit, reset, control, setValue, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '', designation: '', email: '', phone: '', alternativePhone: '',
      company: '', location: '', status: 'NEW', priority: 'NORMAL',
      service: '', category: '', subcategory: '', source: '', platform: '', reference: '',
      sendingDate: '', followUpDate: '', value: '', assignedToId: '', notes: '',
    },
  })

  const watchedService  = useWatch({ control, name: 'service' })
  const watchedCategory = useWatch({ control, name: 'category' })

  // Derive category options from selected venture
  const categoryOptions = useMemo(() => {
    if (!watchedService || !servicesMap[watchedService]) return []
    return servicesMap[watchedService].map(s => ({ value: s.label, label: s.label }))
  }, [watchedService, servicesMap])

  // Derive subcategory options from selected category
  const subcategoryOptions = useMemo(() => {
    if (!watchedService || !watchedCategory || !servicesMap[watchedService]) return []
    const svc = servicesMap[watchedService].find(s => s.label === watchedCategory)
    return (svc?.subcategories ?? []).map(s => ({ value: s, label: s }))
  }, [watchedService, watchedCategory, servicesMap])

  useEffect(() => {
    if (!open) return
    // Reset cascade guards so initial form population doesn't trigger cascade clears
    mountedService.current  = false
    mountedCategory.current = false
    fetch('/api/employees?limit=100').then(r => r.json()).then(d => setEmployees(d.data ?? [])).catch(() => {})
    fetch('/api/config').then(r => r.json()).then(j => {
      const d = j.data ?? {}
      setSources(d.leadSources    ?? [])
      setPlatforms(d.leadPlatforms ?? [])
      setVentures(d.ventures       ?? [])
      setServicesMap(d.services    ?? {})
    }).catch(() => {})

    if (lead) {
      reset({
        name:             lead.name             ?? '',
        designation:      lead.designation      ?? '',
        email:            lead.email            ?? '',
        phone:            lead.phone            ?? '',
        alternativePhone: lead.alternativePhone ?? '',
        company:          lead.company          ?? '',
        location:         lead.location         ?? '',
        status:           lead.status           ?? 'NEW',
        priority:         lead.priority         ?? 'NORMAL',
        service:          lead.service          ?? '',
        category:         lead.category         ?? '',
        subcategory:      lead.subcategory      ?? '',
        source:           lead.source           ?? '',
        platform:         lead.platform         ?? '',
        reference:        lead.reference        ?? '',
        sendingDate:      lead.sendingDate  ? new Date(lead.sendingDate).toISOString().slice(0,10)  : '',
        followUpDate:     lead.followUpDate ? new Date(lead.followUpDate).toISOString().slice(0,10) : '',
        value:            lead.value ? String(lead.value) : '',
        assignedToId:     typeof lead.assignedToId === 'object' ? (lead.assignedToId?.id ?? '') : (lead.assignedToId ?? ''),
        notes:            lead.notes ?? '',
      })
      setLinks(lead.links ?? [])
      setComments(lead.comments ?? [])
    } else {
      reset({
        name: '', designation: '', email: '', phone: '', alternativePhone: '',
        company: '', location: '', status: 'NEW', priority: 'NORMAL',
        service: '', category: '', subcategory: '', source: '', platform: '', reference: '',
        sendingDate: '', followUpDate: '', value: '', assignedToId: '', notes: '',
      })
      setLinks([])
      setComments([])
    }
    setLinkInput('')
    setCommentText('')
  }, [open, lead, reset])

  // Reset category + subcategory when venture changes (skip on first mount)
  const mountedService = useRef(false)
  useEffect(() => {
    if (!mountedService.current) { mountedService.current = true; return }
    setValue('category', '')
    setValue('subcategory', '')
  }, [watchedService]) // eslint-disable-line react-hooks/exhaustive-deps

  // Reset subcategory when category changes (skip on first mount)
  const mountedCategory = useRef(false)
  useEffect(() => {
    if (!mountedCategory.current) { mountedCategory.current = true; return }
    setValue('subcategory', '')
  }, [watchedCategory]) // eslint-disable-line react-hooks/exhaustive-deps

  function addLink() {
    const url = linkInput.trim()
    if (!url) return
    setLinks(l => [...l, url])
    setLinkInput('')
  }

  function removeLink(i) {
    setLinks(l => l.filter((_, idx) => idx !== i))
  }

  async function addComment() {
    if (!commentText.trim() || !isEdit) return
    setCommentSaving(true)
    try {
      const res  = await fetch(`/api/leads/${lead.id}/comments`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: commentText.trim() }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      setComments(c => [...c, json.data])
      setCommentText('')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setCommentSaving(false)
    }
  }

  async function deleteComment(commentId) {
    try {
      const res = await fetch(`/api/leads/${lead.id}/comments?commentId=${commentId}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
      setComments(c => c.filter(x => x.id !== commentId))
    } catch (err) {
      toast.error(err.message)
    }
  }

  const onSubmit = async (values) => {
    setLoading(true)
    try {
      const payload = {
        ...values,
        email:            values.email            || null,
        phone:            values.phone            || null,
        alternativePhone: values.alternativePhone || null,
        designation:      values.designation      || null,
        company:          values.company          || null,
        location:         values.location         || null,
        service:          values.service          || null,
        category:         values.category         || null,
        subcategory:      values.subcategory      || null,
        source:           values.source           || null,
        platform:         values.platform         || null,
        reference:        values.reference        || null,
        value:            values.value ? parseFloat(values.value) : null,
        assignedToId:     values.assignedToId     || null,
        followUpDate:     values.followUpDate ? new Date(values.followUpDate).toISOString() : null,
        sendingDate:      values.sendingDate  ? new Date(values.sendingDate).toISOString()  : null,
        notes:            values.notes            || null,
        links,
      }

      const url    = isEdit ? `/api/leads/${lead.id}` : '/api/leads'
      const method = isEdit ? 'PUT' : 'POST'

      const res  = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error ?? 'Something went wrong')

      toast.success(isEdit ? 'Lead updated' : 'Lead created')
      onSuccess?.(data.data)
      onClose()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  const ic  = (err) => `w-full px-3 py-2 text-sm border rounded-lg bg-white text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition-colors ${err ? 'border-red-300' : 'border-gray-200'}`
  const lc  = 'block text-xs font-semibold text-gray-500 mb-1.5 uppercase tracking-wide'
  const sec = 'text-xs font-bold text-gray-400 uppercase tracking-wider pb-2 border-b border-gray-100 mb-3'

  return (
    <Modal
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={isEdit ? 'Edit Lead' : 'Add New Lead'}
      description={isEdit ? 'Update lead information' : 'Fill in the details to create a new lead'}
      size="xl"
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">

        {/* ── Contact ── */}
        <div>
          <p className={sec}>Contact</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={lc}>Name *</label>
              <input {...register('name')} placeholder="John Smith" className={ic(errors.name)} />
              {errors.name && <p className="mt-1 text-xs text-red-500">{errors.name.message}</p>}
            </div>
            <div>
              <label className={lc}>Designation</label>
              <input {...register('designation')} placeholder="CEO, Marketing Head…" className={ic()} />
            </div>
            <div>
              <label className={lc}>Email</label>
              <input {...register('email')} type="email" placeholder="john@example.com" className={ic(errors.email)} />
              {errors.email && <p className="mt-1 text-xs text-red-500">{errors.email.message}</p>}
            </div>
            <div>
              <label className={lc}>Phone</label>
              <input {...register('phone')} type="tel" placeholder="+880 1X XX XXX XXX" className={ic()} />
            </div>
            <div>
              <label className={lc}>Alternative Phone</label>
              <input {...register('alternativePhone')} type="tel" placeholder="+880 1X XX XXX XXX" className={ic()} />
            </div>
            <div>
              <label className={lc}>Company</label>
              <input {...register('company')} placeholder="Acme Corp" className={ic()} />
            </div>
            <div className="col-span-2">
              <label className={lc}>Location</label>
              <input {...register('location')} placeholder="Dhaka, Bangladesh" className={ic()} />
            </div>
          </div>
        </div>

        {/* ── Lead Classification ── */}
        <div>
          <p className={sec}>Lead Details</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={lc}>Status</label>
              <Controller name="status" control={control} render={({ field }) => (
                <Select value={field.value} onChange={field.onChange} options={STATUSES} placeholder="Select status…" />
              )} />
            </div>
            <div>
              <label className={lc}>Priority</label>
              <Controller name="priority" control={control} render={({ field }) => (
                <Select value={field.value} onChange={field.onChange} options={PRIORITIES.map(p => ({ value: p.value, label: p.label }))} placeholder="Select priority…" />
              )} />
            </div>
            <div>
              <label className={lc}>Source</label>
              <Controller name="source" control={control} render={({ field }) => (
                <Select value={field.value} onChange={field.onChange}
                  options={sources.map(s => ({ value: s, label: s }))}
                  placeholder={sources.length === 0 ? 'No sources — add in Config' : 'Select source…'}
                  disabled={sources.length === 0}
                />
              )} />
            </div>
            <div>
              <label className={lc}>Platform</label>
              <Controller name="platform" control={control} render={({ field }) => (
                <Select value={field.value} onChange={field.onChange}
                  options={platforms.map(p => ({ value: p, label: p }))}
                  placeholder={platforms.length === 0 ? 'No platforms — add in Config' : 'Select platform…'}
                  disabled={platforms.length === 0}
                />
              )} />
            </div>
            <div>
              <label className={lc}>Service / Sister Concern</label>
              <Controller name="service" control={control} render={({ field }) => (
                <Select value={field.value} onChange={field.onChange}
                  options={ventures.map(v => ({ value: v.id, label: v.label }))}
                  placeholder={ventures.length === 0 ? 'No ventures — add in Config' : 'Select venture…'}
                  disabled={ventures.length === 0}
                />
              )} />
            </div>
            <div>
              <label className={lc}>Category</label>
              <Controller name="category" control={control} render={({ field }) => (
                <Select value={field.value} onChange={field.onChange}
                  options={categoryOptions}
                  placeholder={!watchedService ? 'Select venture first…' : categoryOptions.length === 0 ? 'No categories for this venture' : 'Select category…'}
                  disabled={categoryOptions.length === 0}
                />
              )} />
            </div>
            <div>
              <label className={lc}>Subcategory</label>
              <Controller name="subcategory" control={control} render={({ field }) => (
                <Select value={field.value} onChange={field.onChange}
                  options={subcategoryOptions}
                  placeholder={!watchedCategory ? 'Select category first…' : subcategoryOptions.length === 0 ? 'No subcategories' : 'Select subcategory…'}
                  disabled={subcategoryOptions.length === 0}
                />
              )} />
            </div>
            <div className="col-span-2">
              <label className={lc}>Reference / Referred By</label>
              <input {...register('reference')} placeholder="Who referred this lead?" className={ic()} />
            </div>
          </div>
        </div>

        {/* ── Dates & Financials ── */}
        <div>
          <p className={sec}>Dates & Financials</p>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={lc}>Sending Date</label>
              <Controller name="sendingDate" control={control} render={({ field }) => (
                <DatePicker value={field.value} onChange={field.onChange} placeholder="Pick sending date…" />
              )} />
            </div>
            <div>
              <label className={lc}>Follow-up Date</label>
              <Controller name="followUpDate" control={control} render={({ field }) => (
                <DatePicker value={field.value} onChange={field.onChange} placeholder="Pick follow-up date…" />
              )} />
            </div>
            <div>
              <label className={lc}>Deal Value (৳)</label>
              <input {...register('value')} type="number" step="0.01" min="0" placeholder="0.00" className={ic()} />
            </div>
            <div>
              <label className={lc}>Assigned To</label>
              <Controller name="assignedToId" control={control} render={({ field }) => (
                <Select
                  value={field.value}
                  onChange={field.onChange}
                  placeholder="Unassigned"
                  options={employees.map(emp => ({ value: emp.id, label: emp.userId?.name ?? emp.id }))}
                />
              )} />
            </div>
          </div>
        </div>

        {/* ── Links ── */}
        <div>
          <p className={sec}>Links</p>
          <div className="flex gap-2 mb-2">
            <input
              value={linkInput}
              onChange={e => setLinkInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addLink())}
              placeholder="https://facebook.com/page, LinkedIn, Portfolio…"
              className={ic()}
            />
            <button type="button" onClick={addLink}
              className="px-3 py-2 text-sm bg-gray-100 text-gray-700 rounded-lg hover:bg-gray-200 shrink-0 flex items-center gap-1">
              <Plus className="w-3.5 h-3.5" /> Add
            </button>
          </div>
          {links.length > 0 && (
            <div className="space-y-1.5">
              {links.map((url, i) => (
                <div key={i} className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 rounded-lg text-sm">
                  <a href={url} target="_blank" rel="noreferrer" className="flex-1 text-blue-600 hover:underline truncate">{url}</a>
                  <button type="button" onClick={() => removeLink(i)} className="text-gray-300 hover:text-red-500 shrink-0">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* ── Notes ── */}
        <div>
          <p className={sec}>Notes</p>
          <textarea {...register('notes')} rows={3} placeholder="Any relevant notes…" className={ic() + ' resize-none'} />
        </div>

        {/* ── Comments (edit only) ── */}
        {isEdit && (
          <div>
            <p className={sec}>Comments ({comments.length})</p>
            {comments.length > 0 && (
              <div className="space-y-2 mb-3 max-h-40 overflow-y-auto">
                {comments.map(c => (
                  <div key={c.id} className="flex gap-2 items-start px-3 py-2 bg-gray-50 rounded-lg">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-gray-800">{c.text}</p>
                      <p className="text-xs text-gray-400 mt-0.5">
                        {c.authorName} · {new Date(c.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    {(c.authorId === session?.user?.id || ['SUPER_ADMIN','MANAGER'].includes(session?.user?.role)) && (
                      <button type="button" onClick={() => deleteComment(c.id)} className="text-gray-300 hover:text-red-500 shrink-0 mt-0.5">
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <input
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addComment())}
                placeholder="Add a comment…"
                className={ic()}
              />
              <button type="button" onClick={addComment} disabled={commentSaving || !commentText.trim()}
                className="px-3 py-2 text-sm bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 shrink-0">
                {commentSaving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
              </button>
            </div>
          </div>
        )}

        {/* ── Footer ── */}
        <div className="flex items-center justify-end gap-3 pt-2 border-t border-gray-100">
          <button type="button" onClick={onClose}
            className="px-4 py-2 text-sm font-medium text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded-lg transition-colors">
            Cancel
          </button>
          <button type="submit" disabled={loading}
            className="px-5 py-2 text-sm font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-60 flex items-center gap-2">
            {loading && <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />}
            {isEdit ? 'Save Changes' : 'Create Lead'}
          </button>
        </div>
      </form>
    </Modal>
  )
}
