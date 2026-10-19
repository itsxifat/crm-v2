'use client'

import { useState, useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import { Upload, Plus, X, Clock, AlertCircle, BadgeCheck, FileText } from 'lucide-react'
import toast, { Toaster } from 'react-hot-toast'
import PageHeader from '@/components/ui/PageHeader'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import EmptyState from '@/components/ui/EmptyState'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/Card'
import { Input, Textarea, NativeSelect, Label, Field } from '@/components/ui/Input'

const DOC_TYPES = ['NID', 'PASSPORT', 'TRADE_LICENSE', 'TIN', 'CV', 'PORTFOLIO', 'OTHER']
const DOC_LABELS = {
  NID: 'National ID', PASSPORT: 'Passport', TRADE_LICENSE: 'Trade License',
  TIN: 'TIN Certificate', CV: 'CV / Resume', PORTFOLIO: 'Portfolio', OTHER: 'Other Document',
}

const STATUS_META = {
  CREATED:          { label: 'Not started',   variant: 'default', icon: AlertCircle },
  INCOMPLETE:       { label: 'Incomplete',    variant: 'warning', icon: AlertCircle },
  PENDING_APPROVAL: { label: 'Under review',  variant: 'primary', icon: Clock },
  APPROVED:         { label: 'Verified',      variant: 'success', icon: BadgeCheck },
}

export default function FreelancerVerificationPage() {
  const { update } = useSession()
  const [loading, setLoading] = useState(true)
  const [saving,  setSaving]  = useState(false)
  const [docUploading, setDocUploading] = useState(false)
  const [fl, setFl] = useState(null)
  const [isAgency, setIsAgency] = useState(false)
  const [form, setForm] = useState({})
  const [addType, setAddType] = useState('NID')
  const [addName, setAddName] = useState('')
  const fileRef = useRef(null)

  useEffect(() => { fetchProfile() }, [])

  async function fetchProfile() {
    setLoading(true)
    try {
      const res  = await fetch('/api/freelancers/profile')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed to load')
      const d = json.data
      setFl(d)
      setIsAgency(d.type === 'AGENCY')
      setForm({
        photo:          d.photo ?? '',
        address:        d.address ?? '',
        nidNumber:      d.nidNumber ?? '',
        passportNumber: d.passportNumber ?? '',
        skills:         d.skills ?? '',
        bio:            d.bio ?? '',
        portfolioLinks: d.portfolioLinks ?? '',
        documents:      d.documents ?? [],
        agencyInfo:     { agencyName: '', phone: '', address: '', type: '', ...(d.agencyInfo ?? {}) },
        contactPerson:  { name: '', phone: '', email: '', designation: '', ...(d.contactPerson ?? {}) },
      })
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  function set(key, value)      { setForm(p => ({ ...p, [key]: value })) }
  function setNested(obj, key, value) { setForm(p => ({ ...p, [obj]: { ...p[obj], [key]: value } })) }

  async function uploadDoc(file) {
    if (!file) return
    if (addType === 'OTHER' && !addName.trim()) { toast.error('Enter a name for the "Other" document'); return }
    setDocUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res  = await fetch('/api/upload', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Upload failed')
      const name = addType === 'OTHER' ? addName.trim() : DOC_LABELS[addType]
      set('documents', [...(form.documents ?? []), { url: json.url, type: addType, name }])
      setAddName('')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setDocUploading(false)
    }
  }

  function removeDoc(i) { set('documents', (form.documents ?? []).filter((_, idx) => idx !== i)) }

  async function handleSave() {
    setSaving(true)
    try {
      const payload = isAgency
        ? {
            address: form.address || null,
            documents: form.documents ?? [],
            agencyInfo: form.agencyInfo,
            contactPerson: form.contactPerson,
          }
        : {
            photo: form.photo || null,
            address: form.address || null,
            nidNumber: form.nidNumber || null,
            passportNumber: form.passportNumber || null,
            skills: form.skills || null,
            bio: form.bio || null,
            portfolioLinks: form.portfolioLinks || null,
            documents: form.documents ?? [],
          }
      const res  = await fetch('/api/freelancers/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Save failed')
      setFl(prev => ({ ...prev, ...json.data, profileCompletionPct: json.profileCompletionPct, profileStatus: json.profileStatus }))
      toast.success(json.profileStatus === 'PENDING_APPROVAL'
        ? 'Submitted for verification'
        : 'Saved')
      // Refresh the session so the gate reflects the new status promptly.
      update?.()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <PageLoader />

  if (!fl) return (
    <Card className="mx-auto mt-10 max-w-md">
      <EmptyState icon={AlertCircle} title="Profile not set up yet" description="Your record isn’t ready. Please contact your admin." />
    </Card>
  )

  const status = fl.profileStatus ?? 'CREATED'
  const pct    = fl.profileCompletionPct ?? 0
  const meta   = STATUS_META[status] ?? STATUS_META.INCOMPLETE
  const Icon   = meta.icon
  const locked = fl.kycApproved

  return (
    <div className="max-w-3xl space-y-6">
      <Toaster position="top-center" />

      <PageHeader
        title={isAgency ? 'Agency verification' : 'Identity verification'}
        description="Complete KYC to unlock the portal"
        meta={<Badge variant={meta.variant}><Icon className="size-3.5" />{meta.label}</Badge>}
      />

      {/* Progress */}
      <Card className="p-5">
        <div className="flex items-center justify-between text-sm">
          <span className="font-medium text-gray-900">Completion</span>
          <span className={`font-semibold tabular-nums ${pct === 100 ? 'text-emerald-600' : 'text-gray-900'}`}>{pct}%</span>
        </div>
        <div className="mt-2 h-2 w-full rounded-full bg-gray-100">
          <div className={`h-2 rounded-full transition-all duration-700 ${pct === 100 ? 'bg-emerald-500' : 'bg-gray-900'}`} style={{ width: `${pct}%` }} />
        </div>
        {status === 'PENDING_APPROVAL' && (
          <p className="mt-3 text-[13px] text-muted-foreground">Under review. You’ll be notified once verified.</p>
        )}
        {status === 'APPROVED' && (
          <p className="mt-3 text-[13px] text-emerald-700">Verified — you have full portal access.</p>
        )}
        {fl.reviewNotes && status === 'INCOMPLETE' && (
          <div className="mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <div><span className="font-medium">Reviewer note: </span>{fl.reviewNotes}</div>
          </div>
        )}
      </Card>

      {/* Form */}
      {isAgency ? (
        <>
          <Card>
            <CardHeader><CardTitle>Agency details</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Agency name" required><Input disabled={locked} value={form.agencyInfo.agencyName} onChange={e => setNested('agencyInfo', 'agencyName', e.target.value)} /></Field>
              <Field label="Agency type"><Input disabled={locked} value={form.agencyInfo.type} onChange={e => setNested('agencyInfo', 'type', e.target.value)} placeholder="e.g. Design Studio" /></Field>
              <Field label="Address" required className="sm:col-span-2"><Input disabled={locked} value={form.address} onChange={e => set('address', e.target.value)} /></Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>Contact person</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Name" required><Input disabled={locked} value={form.contactPerson.name} onChange={e => setNested('contactPerson', 'name', e.target.value)} /></Field>
              <Field label="Phone" required><Input disabled={locked} value={form.contactPerson.phone} onChange={e => setNested('contactPerson', 'phone', e.target.value)} /></Field>
              <Field label="Email"><Input disabled={locked} value={form.contactPerson.email} onChange={e => setNested('contactPerson', 'email', e.target.value)} /></Field>
              <Field label="Designation"><Input disabled={locked} value={form.contactPerson.designation} onChange={e => setNested('contactPerson', 'designation', e.target.value)} /></Field>
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardHeader><CardTitle>Identity</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <Field label="NID number" required><Input disabled={locked} value={form.nidNumber} onChange={e => set('nidNumber', e.target.value)} /></Field>
            <Field label="Passport number"><Input disabled={locked} value={form.passportNumber} onChange={e => set('passportNumber', e.target.value)} /></Field>
            <Field label="Address" required className="sm:col-span-2"><Input disabled={locked} value={form.address} onChange={e => set('address', e.target.value)} /></Field>
            <Field label="Skills" required className="sm:col-span-2"><Input disabled={locked} value={form.skills} onChange={e => set('skills', e.target.value)} placeholder="e.g. React, Node.js, UI Design" /></Field>
            <Field label="Bio" className="sm:col-span-2"><Textarea rows={3} disabled={locked} value={form.bio} onChange={e => set('bio', e.target.value)} /></Field>
            <Field label="Portfolio links" className="sm:col-span-2"><Input disabled={locked} value={form.portfolioLinks} onChange={e => set('portfolioLinks', e.target.value)} placeholder="https://…" /></Field>
          </CardContent>
        </Card>
      )}

      {/* Documents */}
      <Card>
        <CardHeader>
          <CardTitle>Documents<span className="ml-0.5 text-red-500">*</span></CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {(form.documents ?? []).length === 0 ? (
            <p className="rounded-lg border border-dashed border-gray-200 py-6 text-center text-sm text-muted-foreground">No documents yet</p>
          ) : (
            <div className="divide-y divide-gray-100 rounded-lg border border-gray-200/80">
              {(form.documents ?? []).map((d, i) => (
                <div key={i} className="flex items-center gap-3 px-3 py-2">
                  <FileText className="size-4 shrink-0 text-gray-400" />
                  <a href={d.url} target="_blank" rel="noreferrer" className="flex-1 truncate text-sm font-medium text-gray-900 underline-offset-4 hover:underline">{d.name || DOC_LABELS[d.type] || d.type}</a>
                  {!locked && (
                    <Button variant="ghost" size="icon-xs" onClick={() => removeDoc(i)} aria-label="Remove document" className="text-gray-400 hover:text-red-600">
                      <X />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}

          {!locked && (
            <div className="flex flex-wrap items-end gap-3 rounded-lg bg-gray-50 p-3">
              <div>
                <Label htmlFor="doc-type">Type</Label>
                <NativeSelect id="doc-type" value={addType} onChange={e => { setAddType(e.target.value); setAddName('') }} className="w-44">
                  {DOC_TYPES.map(t => <option key={t} value={t}>{DOC_LABELS[t]}</option>)}
                </NativeSelect>
              </div>
              {addType === 'OTHER' && (
                <div>
                  <Label htmlFor="doc-name">Name</Label>
                  <Input id="doc-name" value={addName} onChange={e => setAddName(e.target.value)} placeholder="Document name" className="w-44" />
                </div>
              )}
              <Button variant="outline" loading={docUploading} onClick={() => fileRef.current?.click()}>
                {!docUploading && <Plus />}
                {docUploading ? 'Uploading…' : 'Upload'}
              </Button>
              <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={e => { uploadDoc(e.target.files?.[0]); e.target.value = '' }} />
            </div>
          )}
        </CardContent>
      </Card>

      {!locked && (
        <div className="flex flex-wrap items-center justify-end gap-3">
          <p className="mr-auto text-[13px] text-muted-foreground">Fill all required fields to submit.</p>
          <Button onClick={handleSave} loading={saving}>
            {!saving && <Upload />}
            {saving ? 'Saving…' : 'Save & submit'}
          </Button>
        </div>
      )}
    </div>
  )
}
