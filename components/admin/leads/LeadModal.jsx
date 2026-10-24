'use client'

import { useEffect, useState, useMemo, useRef, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import { useForm, Controller, useWatch } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import toast from 'react-hot-toast'
import { Plus, X, Loader2, Send, Trash2, Check } from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Select from '@/components/ui/Select'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import { Input, Textarea, Label, Field } from '@/components/ui/Input'
import { invalidateConfigCache } from '@/lib/useConfig'

const schema = z.object({
  name:             z.string().min(1, 'Name is required'),
  designation:      z.string().optional().nullable(),
  // A masked email ('j•••@g••.com') is allowed through — the API keeps the stored value
  email:            z.string().optional().nullable()
    .refine(v => !v || v.includes('••') || z.string().email().safeParse(v).success, 'Invalid email'),
  phone:            z.string().optional().nullable(),
  alternativePhone: z.string().optional().nullable(),
  company:          z.string().optional().nullable(),
  location:         z.string().optional().nullable(),
  status:           z.enum(['NEW','CONTACTED','PROPOSAL_SENT','NEGOTIATION','WON','LOST']).default('NEW'),
  priority:         z.enum(['LOW','NORMAL','HIGH','URGENT']).default('NORMAL'),
  businessCategory: z.string().optional().nullable(),
  service:          z.string().optional().nullable(),
  category:         z.string().optional().nullable(),
  subcategory:      z.string().optional().nullable(),
  source:           z.string().optional().nullable(),
  platform:         z.string().optional().nullable(),
  reference:        z.string().optional().nullable(),
  referenceType:    z.enum(['CLIENT', 'EMPLOYEE', 'LEAD']).optional().nullable(),
  referenceId:      z.string().optional().nullable(),
  sendingDate:      z.string().optional().nullable(),
  followUpDate:     z.string().optional().nullable(),
  value:            z.string().optional().nullable(),
  assignedToId:     z.string().optional().nullable(),
  notes:            z.string().optional().nullable(),
})

const STATUSES = [
  { value: 'NEW',           label: 'New' },
  { value: 'CONTACTED',     label: 'Contacted' },
  { value: 'PROPOSAL_SENT', label: 'Proposal sent' },
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
  const [sources,             setSources]             = useState([])
  const [platforms,           setPlatforms]           = useState([])
  const [ventures,            setVentures]            = useState([])
  const [servicesMap,         setServicesMap]         = useState({})
  const [businessCategories,  setBusinessCategories]  = useState([])
  const [configData,          setConfigData]          = useState(null)
  const [addingBizCat,        setAddingBizCat]        = useState(false)
  const [newBizCatInput,      setNewBizCatInput]      = useState('')
  const [savingBizCat,        setSavingBizCat]        = useState(false)

  // Reference autocomplete
  const [refQuery,       setRefQuery]       = useState('')
  const [refSuggestions, setRefSuggestions] = useState([])  // [{group, label, sublabel, value, id}]
  const [refOpen,        setRefOpen]        = useState(false)
  const [refLoading,     setRefLoading]     = useState(false)
  const [refType,        setRefType]        = useState(null)  // 'CLIENT'|'EMPLOYEE'|'LEAD'|null
  const [refId,          setRefId]          = useState(null)
  const refDebounce = useRef(null)
  const refWrapRef  = useRef(null)
  const isEdit = !!lead
  const canEditConfig = session?.user?.role === 'SUPER_ADMIN'   // /api/config writes are SUPER_ADMIN-only

  const { register, handleSubmit, reset, control, setValue, formState: { errors } } = useForm({
    resolver: zodResolver(schema),
    defaultValues: {
      name: '', designation: '', email: '', phone: '', alternativePhone: '',
      company: '', location: '', status: 'NEW', priority: 'NORMAL',
      businessCategory: '', service: '', category: '', subcategory: '',
      source: '', platform: '', reference: '',
      referenceType: null, referenceId: null,
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
    fetch('/api/employees?limit=100').then(r => r.json()).then(d => setEmployees(d.data ?? [])).catch(() => {})
    fetch('/api/config').then(r => r.json()).then(j => {
      const d = j.data ?? {}
      setConfigData(d)
      setSources(d.leadSources               ?? [])
      setPlatforms(d.leadPlatforms            ?? [])
      setVentures(d.ventures                  ?? [])
      setServicesMap(d.services               ?? {})
      setBusinessCategories(d.leadBusinessCategories ?? [])
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
        businessCategory: lead.businessCategory ?? '',
        service:          lead.service          ?? '',
        category:         lead.category         ?? '',
        subcategory:      lead.subcategory      ?? '',
        source:           lead.source           ?? '',
        platform:         lead.platform         ?? '',
        reference:        lead.reference        ?? '',
        referenceType:    lead.referenceType    ?? null,
        referenceId:      lead.referenceId      ?? null,
        sendingDate:      lead.sendingDate  ? new Date(lead.sendingDate).toISOString().slice(0,10)  : '',
        followUpDate:     lead.followUpDate ? new Date(lead.followUpDate).toISOString().slice(0,10) : '',
        value:            lead.value != null ? String(lead.value) : '',
        assignedToId:     typeof lead.assignedToId === 'object' ? (lead.assignedToId?.id ?? '') : (lead.assignedToId ?? ''),
        notes:            lead.notes ?? '',
      })
      setRefType(lead.referenceType ?? null)
      setRefId(lead.referenceId ?? null)
      setLinks(lead.links ?? [])
      setComments(lead.comments ?? [])
    } else {
      reset({
        name: '', designation: '', email: '', phone: '', alternativePhone: '',
        company: '', location: '', status: 'NEW', priority: 'NORMAL',
        businessCategory: '', service: '', category: '', subcategory: '',
        source: '', platform: '', reference: '',
        referenceType: null, referenceId: null,
        sendingDate: '', followUpDate: '', value: '', assignedToId: '', notes: '',
      })
      setRefType(null)
      setRefId(null)
      setLinks([])
      setComments([])
    }
    setLinkInput('')
    setCommentText('')
  }, [open, lead, reset])

  // Venture → category → subcategory cascade: clear dependants only when the
  // user actually changes the parent (done in the Select onChange handlers).

  // Sync refQuery with form value when editing
  useEffect(() => {
    if (open) setRefQuery(lead?.reference ?? '')
  }, [open, lead])

  // Close reference dropdown on outside click
  useEffect(() => {
    function onMouseDown(e) {
      if (refWrapRef.current && !refWrapRef.current.contains(e.target)) setRefOpen(false)
    }
    document.addEventListener('mousedown', onMouseDown)
    return () => document.removeEventListener('mousedown', onMouseDown)
  }, [])

  const searchReference = useCallback((q) => {
    clearTimeout(refDebounce.current)
    if (!q.trim()) { setRefSuggestions([]); setRefOpen(false); return }
    refDebounce.current = setTimeout(async () => {
      setRefLoading(true)
      try {
        const res  = await fetch(`/api/reference-search?q=${encodeURIComponent(q)}`)
        const json = await res.json()
        const suggestions = json.data ?? []
        setRefSuggestions(suggestions)
        setRefOpen(suggestions.length > 0)
      } catch { /* silent */ } finally {
        setRefLoading(false)
      }
    }, 350)
  }, [])

  async function addBusinessCategory() {
    const name = newBizCatInput.trim()
    if (!name || savingBizCat) return
    if (businessCategories.includes(name)) {
      setValue('businessCategory', name)
      setAddingBizCat(false)
      setNewBizCatInput('')
      return
    }
    setSavingBizCat(true)
    try {
      const updated = [...businessCategories, name]
      // PATCH merges just this key, so config changes made meanwhile aren't overwritten
      const res = await fetch('/api/config', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ leadBusinessCategories: updated }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error ?? 'Failed to save category')
      const saved = json.data?.leadBusinessCategories ?? updated
      setBusinessCategories(saved)
      setConfigData(json.data ?? { ...configData, leadBusinessCategories: saved })
      setValue('businessCategory', name)
      setAddingBizCat(false)
      setNewBizCatInput('')
      invalidateConfigCache()
    } catch (err) {
      toast.error(err.message || 'Failed to save category')
    } finally {
      setSavingBizCat(false)
    }
  }

  function addLink() {
    const raw = linkInput.trim()
    if (!raw) return
    // Same rule as the API: http(s) URLs only; scheme-less input gets https://
    const url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`
    try { new URL(url) } catch { toast.error('Enter a valid link, e.g. facebook.com/page'); return }
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
        businessCategory: values.businessCategory || null,
        service:          values.service          || null,
        category:         values.category         || null,
        subcategory:      values.subcategory      || null,
        source:           values.source           || null,
        platform:         values.platform         || null,
        reference:        values.reference        || null,
        referenceType:    values.reference ? (refType ?? null) : null,
        referenceId:      values.reference ? (refId   ?? null) : null,
        // A masked value ('••••••') is sent unchanged so the API keeps the stored amount.
        value:            String(values.value ?? '').includes('••') ? values.value : (values.value ? parseFloat(values.value) : null),
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

  const refVariant = (t) => (t === 'CLIENT' || t === 'Client') ? 'success' : (t === 'EMPLOYEE' || t === 'Employee') ? 'purple' : 'primary'

  return (
    <Modal
      open={open}
      onOpenChange={(v) => !v && onClose()}
      title={isEdit ? 'Edit lead' : 'New lead'}
      size="xl"
    >
      <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">

        {/* ── Contact ── */}
        <Section title="Contact">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Name" required error={errors.name?.message}>
              <Input {...register('name')} placeholder="John Smith" invalid={!!errors.name} />
            </Field>
            <Field label="Designation">
              <Input {...register('designation')} placeholder="e.g. CEO" />
            </Field>
            <Field label="Email" error={errors.email?.message}>
              <Input {...register('email')} type="email" placeholder="john@example.com" invalid={!!errors.email} />
            </Field>
            <Field label="Phone">
              <Input {...register('phone')} type="tel" placeholder="e.g. 017…" />
            </Field>
            <Field label="Alternative phone">
              <Input {...register('alternativePhone')} type="tel" placeholder="e.g. 018…" />
            </Field>
            <Field label="Company">
              <Input {...register('company')} placeholder="Acme Corp" />
            </Field>
            <Field label="Location" className="sm:col-span-2">
              <Input {...register('location')} placeholder="Dhaka, Bangladesh" />
            </Field>
          </div>
        </Section>

        {/* ── Lead Classification ── */}
        <Section title="Lead details">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Status">
              <Controller name="status" control={control} render={({ field }) => (
                <Select value={field.value} onChange={field.onChange} options={STATUSES} placeholder="Select…" />
              )} />
            </Field>
            <Field label="Priority">
              <Controller name="priority" control={control} render={({ field }) => (
                <Select value={field.value} onChange={field.onChange} options={PRIORITIES.map(p => ({ value: p.value, label: p.label }))} placeholder="Select…" />
              )} />
            </Field>
            <Field label="Business category" className="sm:col-span-2">
              {addingBizCat ? (
                <div className="flex gap-2">
                  <Input
                    autoFocus
                    value={newBizCatInput}
                    onChange={e => setNewBizCatInput(e.target.value)}
                    onKeyDown={e => {
                      if (e.key === 'Enter') { e.preventDefault(); addBusinessCategory() }
                      if (e.key === 'Escape') { setAddingBizCat(false); setNewBizCatInput('') }
                    }}
                    placeholder="e.g. E-commerce"
                  />
                  <Button size="icon" onClick={addBusinessCategory} loading={savingBizCat} aria-label="Save category">
                    {!savingBizCat && <Check />}
                  </Button>
                  <Button variant="outline" size="icon" onClick={() => { setAddingBizCat(false); setNewBizCatInput('') }} aria-label="Cancel">
                    <X />
                  </Button>
                </div>
              ) : (
                <div className="flex gap-2">
                  <div className="min-w-0 flex-1">
                    <Controller name="businessCategory" control={control} render={({ field }) => (
                      <Select value={field.value} onChange={field.onChange}
                        options={businessCategories.map(c => ({ value: c, label: c }))}
                        placeholder={businessCategories.length === 0 ? (canEditConfig ? 'No categories — click + to add' : 'No categories — add in Config') : 'Select…'}
                      />
                    )} />
                  </div>
                  {canEditConfig && (
                    <Button variant="outline" size="icon" onClick={() => setAddingBizCat(true)} title="Add business category" aria-label="Add business category">
                      <Plus />
                    </Button>
                  )}
                </div>
              )}
            </Field>
            <Field label="Source">
              <Controller name="source" control={control} render={({ field }) => (
                <Select value={field.value} onChange={field.onChange}
                  options={sources.map(s => ({ value: s, label: s }))}
                  placeholder={sources.length === 0 ? 'No sources — add in Config' : 'Select…'}
                  disabled={sources.length === 0}
                />
              )} />
            </Field>
            <Field label="Platform">
              <Controller name="platform" control={control} render={({ field }) => (
                <Select value={field.value} onChange={field.onChange}
                  options={platforms.map(p => ({ value: p, label: p }))}
                  placeholder={platforms.length === 0 ? 'No platforms — add in Config' : 'Select…'}
                  disabled={platforms.length === 0}
                />
              )} />
            </Field>
            <Field label="Service / sister concern">
              <Controller name="service" control={control} render={({ field }) => (
                <Select value={field.value}
                  onChange={(v) => {
                    if ((v ?? '') !== (field.value ?? '')) { setValue('category', ''); setValue('subcategory', '') }
                    field.onChange(v)
                  }}
                  options={ventures.filter(v => v.active !== false || v.id === field.value).map(v => ({ value: v.id, label: v.label }))}
                  placeholder={ventures.length === 0 ? 'No ventures — add in Config' : 'Select…'}
                  disabled={ventures.length === 0}
                />
              )} />
            </Field>
            <Field label="Category">
              <Controller name="category" control={control} render={({ field }) => (
                <Select value={field.value}
                  onChange={(v) => {
                    if ((v ?? '') !== (field.value ?? '')) setValue('subcategory', '')
                    field.onChange(v)
                  }}
                  options={categoryOptions}
                  placeholder={!watchedService ? 'Select venture first' : categoryOptions.length === 0 ? 'No categories' : 'Select…'}
                  disabled={categoryOptions.length === 0}
                />
              )} />
            </Field>
            <Field label="Subcategory">
              <Controller name="subcategory" control={control} render={({ field }) => (
                <Select value={field.value} onChange={field.onChange}
                  options={subcategoryOptions}
                  placeholder={!watchedCategory ? 'Select category first' : subcategoryOptions.length === 0 ? 'No subcategories' : 'Select…'}
                  disabled={subcategoryOptions.length === 0}
                />
              )} />
            </Field>
            <div className="sm:col-span-2" ref={refWrapRef}>
              <Label>Referred by</Label>
              <div className="relative">
                <Input
                  value={refQuery}
                  onChange={e => {
                    setRefQuery(e.target.value)
                    setValue('reference', e.target.value || null)
                    setValue('referenceType', null)
                    setValue('referenceId', null)
                    setRefType(null)
                    setRefId(null)
                    searchReference(e.target.value)
                  }}
                  onFocus={() => { if (refSuggestions.length > 0) setRefOpen(true) }}
                  placeholder="Search leads, clients, employees…"
                  className="pr-24"
                  autoComplete="off"
                />
                {refLoading && (
                  <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">
                    <Loader2 className="size-4 animate-spin" />
                  </span>
                )}
                {refType && !refOpen && (
                  <Badge variant={refVariant(refType)} className="absolute right-2 top-1/2 -translate-y-1/2">
                    {refType === 'LEAD' ? 'Lead' : refType === 'CLIENT' ? 'Client' : 'Employee'}
                  </Badge>
                )}
                {refOpen && refSuggestions.length > 0 && (
                  <ul className="absolute left-0 right-0 z-50 mt-1 max-h-52 overflow-y-auto rounded-xl border border-gray-200/80 bg-white p-1 text-sm shadow-lg">
                    {refSuggestions.map((s, i) => (
                      <li
                        key={i}
                        onMouseDown={e => {
                          e.preventDefault()
                          setRefQuery(s.value)
                          setValue('reference', s.value)
                          setValue('referenceType', s.type)
                          setValue('referenceId', s.id ? String(s.id) : null)
                          setRefType(s.type)
                          setRefId(s.id ? String(s.id) : null)
                          setRefOpen(false)
                        }}
                        className="flex cursor-pointer items-center gap-3 rounded-md px-2 py-1.5 hover:bg-gray-100"
                      >
                        <Badge variant={refVariant(s.group)} className="shrink-0">{s.group}</Badge>
                        <span className="min-w-0 flex-1">
                          <span className="font-medium text-gray-900">{s.label}</span>
                          {s.sublabel && <span className="ml-1.5 truncate text-xs text-muted-foreground">{s.sublabel}</span>}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          </div>
        </Section>

        {/* ── Dates & Financials ── */}
        <Section title="Dates & value">
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Sending date">
              <Input type="date" {...register('sendingDate')} />
            </Field>
            <Field label="Follow-up date">
              <Input type="date" {...register('followUpDate')} />
            </Field>
            <Field label="Deal value (৳)">
              <Input {...register('value')} type="number" step="0.01" min="0" placeholder="0.00" />
            </Field>
            <Field label="Assignee">
              <Controller name="assignedToId" control={control} render={({ field }) => (
                <Select
                  value={field.value}
                  onChange={field.onChange}
                  placeholder="Unassigned"
                  options={employees.map(emp => ({ value: emp.id, label: emp.userId?.name ?? emp.id }))}
                />
              )} />
            </Field>
          </div>
        </Section>

        {/* ── Links ── */}
        <Section title="Links">
          <div className="flex gap-2">
            <Input
              value={linkInput}
              onChange={e => setLinkInput(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addLink())}
              placeholder="https://…"
            />
            <Button variant="outline" onClick={addLink}>
              <Plus /> Add
            </Button>
          </div>
          {links.length > 0 && (
            <div className="mt-2 space-y-1.5">
              {links.map((url, i) => (
                <div key={i} className="flex items-center gap-2 rounded-lg bg-gray-50 px-3 py-1.5 text-sm">
                  <a href={url} target="_blank" rel="noreferrer" className="flex-1 truncate text-gray-900 underline-offset-4 hover:underline">{url}</a>
                  <button type="button" onClick={() => removeLink(i)} className="shrink-0 text-gray-400 hover:text-red-600" aria-label="Remove link">
                    <X className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </Section>

        {/* ── Notes ── */}
        <Section title="Notes">
          <Textarea {...register('notes')} rows={3} placeholder="Notes…" className="resize-none" />
        </Section>

        {/* ── Comments (edit only) ── */}
        {isEdit && (
          <Section title={`Comments (${comments.length})`}>
            {comments.length > 0 && (
              <div className="mb-3 max-h-40 space-y-2 overflow-y-auto">
                {comments.map(c => (
                  <div key={c.id} className="flex items-start gap-2 rounded-lg bg-gray-50 px-3 py-2">
                    <div className="min-w-0 flex-1">
                      <p className="text-sm text-gray-900">{c.text}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {c.authorName} · {new Date(c.createdAt).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                    {(c.authorId === session?.user?.id || ['SUPER_ADMIN','MANAGER'].includes(session?.user?.role)) && (
                      <button type="button" onClick={() => deleteComment(c.id)} className="mt-0.5 shrink-0 text-gray-400 hover:text-red-600" aria-label="Delete comment">
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Input
                value={commentText}
                onChange={e => setCommentText(e.target.value)}
                onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), addComment())}
                placeholder="Add a comment…"
              />
              <Button size="icon" onClick={addComment} disabled={commentSaving || !commentText.trim()} aria-label="Send comment">
                {commentSaving ? <Loader2 className="animate-spin" /> : <Send />}
              </Button>
            </div>
          </Section>
        )}

        <ModalFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={loading}>
            {isEdit ? 'Save changes' : 'Create lead'}
          </Button>
        </ModalFooter>
      </form>
    </Modal>
  )
}

function Section({ title, children }) {
  return (
    <section>
      <h3 className="mb-3 text-sm font-semibold text-gray-900">{title}</h3>
      {children}
    </section>
  )
}
