'use client'

import { useState, useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import {
  FileText, Upload, CheckCircle2, AlertCircle, Camera, ChevronLeft, ChevronRight, Lock, X, Plus,
} from 'lucide-react'
import toast from 'react-hot-toast'
import { cn } from '@/lib/utils'
import Button, { buttonVariants } from '@/components/ui/Button'
import { Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter } from '@/components/ui/Card'
import { Input, Textarea, NativeSelect, Label, Field } from '@/components/ui/Input'
import PageHeader from '@/components/ui/PageHeader'
import Tabs from '@/components/ui/Tabs'
import Badge from '@/components/ui/Badge'
import Avatar from '@/components/ui/Avatar'
import EmptyState from '@/components/ui/EmptyState'
import { PageLoader } from '@/components/ui/LoadingSpinner'

// ─── Constants ────────────────────────────────────────────────────────────────

const TABS = ['Personal', 'Contact', 'KYC']

const GENDER_OPTIONS    = ['MALE', 'FEMALE', 'OTHER']
const MARITAL_OPTIONS   = ['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED']
const DOC_TYPE_OPTIONS  = ['NID', 'BIRTH_CERTIFICATE', 'CV', 'PASSPORT', 'ACADEMIC', 'OTHER']

// Labels are also saved as the document name — don't reword them.
const DOC_TYPE_META = {
  NID:               { label: 'National ID (NID)'    },
  BIRTH_CERTIFICATE: { label: 'Birth Certificate'    },
  CV:                { label: 'CV / Resume'          },
  PASSPORT:          { label: 'Passport'             },
  ACADEMIC:          { label: 'Academic Certificate' },
  OTHER:             { label: 'Other Document'       },
}

const STATUS_META = {
  CREATED:          { label: 'Not started',       variant: 'default' },
  INCOMPLETE:       { label: 'Incomplete',        variant: 'warning' },
  PENDING_APPROVAL: { label: 'Pending HR review', variant: 'primary' },
  APPROVED:         { label: 'Approved',          variant: 'success' },
}

// Which fields count toward each tab's completion
const PERSONAL_FIELDS = ['gender', 'dateOfBirth', 'nationality', 'maritalStatus', 'photo']
const CONTACT_FIELDS  = ['phone', 'address', 'emergencyContacts']
const KYC_FIELDS      = ['nidNumber', '_hasDoc']  // _hasDoc is synthetic

function fmtDate(d) {
  if (!d) return ''
  return new Date(d).toISOString().split('T')[0]
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function ProgressBar({ pct }) {
  return (
    <div className="h-2 w-full rounded-full bg-gray-100">
      <div
        className={cn('h-2 rounded-full transition-all duration-700', pct === 100 ? 'bg-emerald-500' : 'bg-gray-900')}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

function StatusBadge({ status }) {
  const m = STATUS_META[status] ?? STATUS_META.INCOMPLETE
  return <Badge variant={m.variant}>{m.label}</Badge>
}

function TabDoneIcon({ className }) {
  return <CheckCircle2 className={cn(className, 'text-emerald-600')} />
}

function InfoRow({ label, children }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 first:pt-0 last:pb-0">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="text-right text-sm text-gray-900">{children}</dd>
    </div>
  )
}

// ─── Tab: Personal ────────────────────────────────────────────────────────────

function PersonalTab({ form, onChange, locked, uploading, onPhotoUpload }) {
  const fileRef = useRef(null)
  return (
    <div className="space-y-6">
      {/* Photo */}
      <Field label="Profile photo">
        <div className="flex items-center gap-4">
          <div className="flex size-20 shrink-0 items-center justify-center overflow-hidden rounded-xl border border-dashed border-gray-300 bg-gray-50">
            {form.photo ? (
              <img src={form.photo} alt="Profile" className="h-full w-full object-cover" />
            ) : (
              <Camera className="size-5 text-gray-400" />
            )}
          </div>
          {!locked && (
            <div>
              <Button variant="outline" size="sm" loading={uploading} onClick={() => fileRef.current?.click()}>
                {!uploading && <Upload />}
                {uploading ? 'Uploading…' : 'Upload photo'}
              </Button>
              <p className="mt-1.5 text-xs text-muted-foreground">JPG or PNG, plain background</p>
              <input ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={e => onPhotoUpload(e.target.files?.[0])} />
            </div>
          )}
        </div>
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Gender" required>
          <NativeSelect value={form.gender ?? ''} onChange={e => onChange('gender', e.target.value || null)} disabled={locked}>
            <option value="">Select…</option>
            {GENDER_OPTIONS.map(g => <option key={g} value={g}>{g.charAt(0) + g.slice(1).toLowerCase()}</option>)}
          </NativeSelect>
        </Field>

        <Field label="Date of birth" required>
          <Input type="date" value={form.dateOfBirth ?? ''} onChange={e => onChange('dateOfBirth', e.target.value)} disabled={locked} />
        </Field>

        <Field label="Nationality" required>
          <Input type="text" placeholder="e.g. Bangladeshi" value={form.nationality ?? ''} onChange={e => onChange('nationality', e.target.value)} disabled={locked} />
        </Field>

        <Field label="Marital status" required>
          <NativeSelect value={form.maritalStatus ?? ''} onChange={e => onChange('maritalStatus', e.target.value || null)} disabled={locked}>
            <option value="">Select…</option>
            {MARITAL_OPTIONS.map(m => <option key={m} value={m}>{m.charAt(0) + m.slice(1).toLowerCase()}</option>)}
          </NativeSelect>
        </Field>
      </div>
    </div>
  )
}

// ─── Tab: Contact ─────────────────────────────────────────────────────────────

function ContactTab({ form, onChange, locked }) {
  const contacts = form.emergencyContacts ?? [{ name: '', relation: '', phone: '' }]

  function updateContact(index, field, value) {
    const updated = contacts.map((c, i) => i === index ? { ...c, [field]: value } : c)
    onChange('emergencyContacts', updated)
  }

  function addContact() {
    onChange('emergencyContacts', [...contacts, { name: '', relation: '', phone: '' }])
  }

  function removeContact(index) {
    if (contacts.length <= 1) return
    onChange('emergencyContacts', contacts.filter((_, i) => i !== index))
  }

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Phone" required>
        <Input type="tel" placeholder="+880…" value={form.phone ?? ''} onChange={e => onChange('phone', e.target.value)} disabled={locked} />
      </Field>

      <Field label="Alternative phone">
        <Input type="tel" placeholder="+880…" value={form.secondaryPhone ?? ''} onChange={e => onChange('secondaryPhone', e.target.value)} disabled={locked} />
      </Field>

      <Field label="Address" required className="sm:col-span-2">
        <Textarea
          rows={3}
          placeholder="House, road, area, city, country"
          value={form.address ?? ''}
          onChange={e => onChange('address', e.target.value)}
          disabled={locked}
          className="resize-none"
        />
      </Field>

      <div className="space-y-3 sm:col-span-2">
        <div className="flex items-center justify-between">
          <Label required className="mb-0">Emergency contacts</Label>
          {!locked && (
            <Button variant="ghost" size="xs" onClick={addContact}>
              <Plus /> Add contact
            </Button>
          )}
        </div>
        {contacts.map((contact, i) => (
          <div key={i} className="space-y-2 rounded-lg border border-gray-200/80 p-3">
            {contacts.length > 1 && (
              <div className="flex items-center justify-between">
                <span className="text-xs font-medium text-muted-foreground">Contact {i + 1}</span>
                {!locked && (
                  <Button variant="ghost" size="icon-xs" aria-label="Remove contact" onClick={() => removeContact(i)}
                    className="text-gray-400 hover:bg-red-50 hover:text-red-600">
                    <X />
                  </Button>
                )}
              </div>
            )}
            <div className="grid gap-2 sm:grid-cols-3">
              <Input type="text" placeholder="Name" value={contact.name} disabled={locked}
                onChange={e => updateContact(i, 'name', e.target.value)} />
              <Input type="text" placeholder="Relation (e.g. Father)" value={contact.relation} disabled={locked}
                onChange={e => updateContact(i, 'relation', e.target.value)} />
              <Input type="tel" placeholder="Phone" value={contact.phone} disabled={locked}
                onChange={e => updateContact(i, 'phone', e.target.value)} />
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Tab: KYC ─────────────────────────────────────────────────────────────────

function KYCTab({ form, onChange, locked, kycLocked, onDocUpload, docUploading, onDocRemove }) {
  const fileRef = useRef(null)
  const [addType, setAddType] = useState('NID')
  const [addName, setAddName] = useState('')

  const effectiveLock = locked || kycLocked

  return (
    <div className="space-y-6">
      {kycLocked && (
        <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          <Lock className="size-4 shrink-0" />
          KYC is locked after HR verification.
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="NID number" required>
          <Input type="text" value={form.nidNumber ?? ''} onChange={e => onChange('nidNumber', e.target.value)} disabled={effectiveLock} />
        </Field>

        <Field label="Passport number">
          <Input type="text" placeholder="Optional" value={form.passportNumber ?? ''} onChange={e => onChange('passportNumber', e.target.value)} disabled={effectiveLock} />
        </Field>
      </div>

      {/* Documents */}
      <div className="space-y-3">
        <div>
          <Label required className="mb-1.5">Documents</Label>
          <p className="text-xs text-muted-foreground">At least one required, e.g. NID scan.</p>
        </div>

        {(form.documents ?? []).length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-200 py-6 text-center text-sm text-muted-foreground">
            No documents yet
          </div>
        ) : (
          <div className="divide-y divide-gray-100 rounded-lg border border-gray-200/80">
            {(form.documents ?? []).map((doc, i) => {
              const meta = DOC_TYPE_META[doc.type] ?? DOC_TYPE_META.OTHER
              const name = doc.name || doc.url?.split('/').pop() || 'Document'
              return (
                <div key={i} className="flex items-center gap-3 px-3 py-2.5">
                  <FileText className="size-4 shrink-0 text-gray-400" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-gray-900">{name}</p>
                    <p className="text-xs text-muted-foreground">{meta.label}</p>
                  </div>
                  <a href={doc.url} target="_blank" rel="noreferrer" className={buttonVariants({ variant: 'ghost', size: 'xs' })}>View</a>
                  {!effectiveLock && (
                    <Button variant="ghost" size="icon-xs" aria-label="Remove document" onClick={() => onDocRemove(i)}
                      className="text-gray-400 hover:bg-red-50 hover:text-red-600">
                      <X />
                    </Button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {!effectiveLock && (
          <div className="flex flex-wrap items-end gap-2 rounded-lg bg-gray-50 p-3">
            <div>
              <Label className="mb-1.5 text-xs text-muted-foreground">Type</Label>
              <NativeSelect value={addType} onChange={e => { setAddType(e.target.value); setAddName('') }} className="h-8 w-52">
                {DOC_TYPE_OPTIONS.map(t => <option key={t} value={t}>{DOC_TYPE_META[t].label}</option>)}
              </NativeSelect>
            </div>
            {addType === 'OTHER' && (
              <div>
                <Label className="mb-1.5 text-xs text-muted-foreground">Name</Label>
                <Input value={addName} onChange={e => setAddName(e.target.value)} placeholder="Document name" className="h-8 w-44" />
              </div>
            )}
            <div>
              <Button variant="outline" size="sm" loading={docUploading} onClick={() => fileRef.current?.click()}>
                {!docUploading && <Upload />}
                {docUploading ? 'Uploading…' : 'Upload'}
              </Button>
              <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden"
                onChange={e => onDocUpload(e.target.files?.[0], addType, addName)} />
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function EmployeeProfilePage() {
  const { data: session } = useSession()
  const [activeTab,     setActiveTab]     = useState(0)
  const [loading,       setLoading]       = useState(true)
  const [saving,        setSaving]        = useState(false)
  const [photoUploading, setPhotoUploading] = useState(false)
  const [docUploading,  setDocUploading]  = useState(false)
  const [emp,           setEmp]           = useState(null)
  const [form,          setForm]          = useState({})

  useEffect(() => { fetchProfile() }, [])

  async function fetchProfile() {
    setLoading(true)
    try {
      const res  = await fetch('/api/employee/profile')
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      setEmp(json.data)
      initForm(json.data)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setLoading(false)
    }
  }

  function initForm(data) {
    setForm({
      gender:           data.gender        ?? '',
      dateOfBirth:      data.dateOfBirth   ? fmtDate(data.dateOfBirth) : '',
      nationality:      data.nationality   ?? '',
      maritalStatus:    data.maritalStatus ?? '',
      photo:            data.photo         ?? '',
      phone:            data.phone         ?? '',
      secondaryPhone:   data.secondaryPhone ?? '',
      address:             data.address ?? '',
      emergencyContacts:   Array.isArray(data.emergencyContacts) && data.emergencyContacts.length > 0
                             ? data.emergencyContacts
                             : [{ name: '', relation: '', phone: '' }],
      nidNumber:        data.nidNumber     ?? '',
      passportNumber:   data.passportNumber ?? '',
      documents:        data.documents     ?? [],
    })
  }

  function onChange(key, value) {
    setForm(prev => ({ ...prev, [key]: value }))
  }

  async function handlePhotoUpload(file) {
    if (!file) return
    setPhotoUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res  = await fetch('/api/upload', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Upload failed')
      onChange('photo', json.url)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setPhotoUploading(false)
    }
  }

  async function handleDocUpload(file, type, name) {
    if (!file) return
    if (type === 'OTHER' && !name?.trim()) {
      toast.error('Enter a name for the "Other" document')
      return
    }
    setDocUploading(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res  = await fetch('/api/upload', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Upload failed')
      const docName = type === 'OTHER' ? (name.trim() || file.name) : (DOC_TYPE_META[type]?.label || file.name)
      onChange('documents', [...(form.documents ?? []), { url: json.url, type, name: docName }])
    } catch (err) {
      toast.error(err.message)
    } finally {
      setDocUploading(false)
    }
  }

  function handleDocRemove(index) {
    onChange('documents', (form.documents ?? []).filter((_, i) => i !== index))
  }

  async function handleSave() {
    setSaving(true)
    try {
      const payload = {
        gender:           form.gender        || null,
        dateOfBirth:      form.dateOfBirth   || null,
        nationality:      form.nationality   || null,
        maritalStatus:    form.maritalStatus || null,
        photo:            form.photo         || null,
        phone:            form.phone         || null,
        secondaryPhone:   form.secondaryPhone || null,
        address:             form.address || null,
        emergencyContacts:   (form.emergencyContacts ?? []).filter(c => c.name && c.relation && c.phone),
        nidNumber:        form.nidNumber     || null,
        passportNumber:   form.passportNumber || null,
        documents:        form.documents     ?? [],
      }
      const res  = await fetch('/api/employee/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? "Couldn't save profile")
      setEmp(prev => ({ ...prev, ...json.data, profileCompletionPct: json.profileCompletionPct, profileStatus: json.profileStatus }))
      toast.success(json.profileStatus === 'PENDING_APPROVAL'
        ? 'Submitted for HR review'
        : 'Profile saved')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return <PageLoader />
  }

  if (!emp) {
    return (
      <div className="max-w-3xl space-y-6">
        <PageHeader title="Profile" />
        <Card>
          <EmptyState
            icon={AlertCircle}
            title="Profile not set up yet"
            description="Contact HR or your admin to finish setup."
          />
        </Card>
      </div>
    )
  }

  const pct         = emp.profileCompletionPct ?? 0
  const status      = emp.profileStatus        ?? 'CREATED'
  const finalLocked = emp.finalApproved
  const kycLocked   = emp.kycApproved

  // Per-tab completion indicators
  const checks = {
    gender:         !!form.gender,
    dateOfBirth:    !!form.dateOfBirth,
    nationality:    !!form.nationality,
    maritalStatus:  !!form.maritalStatus,
    photo:          !!form.photo,
    phone:          !!form.phone,
    address:        !!form.address,
    emergencyContacts: (form.emergencyContacts ?? []).some(c => c.name && c.relation && c.phone),
    nidNumber:      !!form.nidNumber,
    _hasDoc:        (form.documents ?? []).length > 0,
  }

  const tabDone = [
    PERSONAL_FIELDS.filter(f => checks[f]).length,
    CONTACT_FIELDS.filter(f => checks[f]).length,
    KYC_FIELDS.filter(f => checks[f]).length,
  ]
  const tabTotal = [PERSONAL_FIELDS.length, CONTACT_FIELDS.length, KYC_FIELDS.length]

  const userName = emp.user?.name ?? session?.user?.name ?? 'Employee'

  const tabItems = TABS.map((tab, i) => {
    const full = tabDone[i] === tabTotal[i]
    return {
      value: i,
      label: tab,
      icon:  full ? TabDoneIcon : undefined,
      count: full ? undefined : `${tabDone[i]}/${tabTotal[i]}`,
    }
  })

  return (
    <div className="max-w-3xl space-y-6">
      <PageHeader title="Profile" />

      {/* Identity + completion */}
      <Card className="p-5">
        <div className="flex items-start gap-4">
          <Avatar key={form.photo || 'none'} src={form.photo || undefined} name={userName} size="xl" />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-base font-semibold text-gray-900">{userName}</h2>
              <StatusBadge status={status} />
            </div>
            <p className="truncate text-sm text-muted-foreground">{emp.user?.email ?? session?.user?.email}</p>

            <div className="mt-4">
              <div className="mb-1.5 flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Profile completion</span>
                <span className="font-medium tabular-nums text-gray-900">{pct}%</span>
              </div>
              <ProgressBar pct={pct} />
              {pct < 100 && (
                <p className="mt-1.5 text-xs text-muted-foreground">Complete required fields to submit for HR review.</p>
              )}
              {status === 'PENDING_APPROVAL' && (
                <p className="mt-1.5 text-xs text-muted-foreground">You&rsquo;ll be notified once approved.</p>
              )}
              {status === 'APPROVED' && (
                <p className="mt-1.5 text-xs text-muted-foreground">Approved, with full panel access.</p>
              )}
            </div>
          </div>
        </div>

        {/* HR notes if rejected */}
        {emp.hrNotes && status === 'INCOMPLETE' && (
          <div className="mt-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-800">
            <AlertCircle className="mt-0.5 size-4 shrink-0" />
            <div>
              <span className="font-medium">HR feedback: </span>{emp.hrNotes}
            </div>
          </div>
        )}
      </Card>

      {/* Company info (HR-filled, read-only) */}
      {(emp.department || emp.position || emp.venture) && (
        <Card>
          <CardHeader>
            <div>
              <CardTitle>Company info</CardTitle>
              <CardDescription>Managed by HR</CardDescription>
            </div>
          </CardHeader>
          <CardContent>
            <dl className="divide-y divide-gray-100">
              {emp.employeeId && <InfoRow label="Employee ID"><span className="font-mono">{emp.employeeId}</span></InfoRow>}
              {emp.department && <InfoRow label="Department">{emp.department}</InfoRow>}
              {emp.position   && <InfoRow label="Position">{emp.position}</InfoRow>}
              {emp.venture    && <InfoRow label="Venture">{emp.venture}</InfoRow>}
            </dl>
          </CardContent>
        </Card>
      )}

      {/* Profile sections */}
      <Card>
        <Tabs variant="underline" value={activeTab} onChange={setActiveTab} tabs={tabItems} className="px-5 pt-3" />

        <div className="p-5">
          {activeTab === 0 && (
            <PersonalTab
              form={form}
              onChange={onChange}
              locked={finalLocked}
              uploading={photoUploading}
              onPhotoUpload={handlePhotoUpload}
            />
          )}
          {activeTab === 1 && (
            <ContactTab
              form={form}
              onChange={onChange}
              locked={finalLocked}
            />
          )}
          {activeTab === 2 && (
            <KYCTab
              form={form}
              onChange={onChange}
              locked={finalLocked}
              kycLocked={kycLocked}
              onDocUpload={handleDocUpload}
              docUploading={docUploading}
              onDocRemove={handleDocRemove}
            />
          )}
        </div>

        {/* Navigation + Save */}
        <CardFooter className="justify-between">
          <Button variant="outline" disabled={activeTab === 0} onClick={() => setActiveTab(t => t - 1)}>
            <ChevronLeft /> Previous
          </Button>

          <div className="flex items-center gap-2">
            {finalLocked && (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <Lock className="size-3.5" /> Locked
              </span>
            )}
            {activeTab < TABS.length - 1 && (
              <Button variant="outline" onClick={() => setActiveTab(t => t + 1)}>
                Next <ChevronRight />
              </Button>
            )}
            {!finalLocked && (
              <Button onClick={handleSave} loading={saving}>
                {saving ? 'Saving…' : 'Save'}
              </Button>
            )}
          </div>
        </CardFooter>
      </Card>
    </div>
  )
}
