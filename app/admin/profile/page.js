'use client'

import { useState, useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import {
  User, Phone, MapPin, FileText, Upload, Loader2, CheckCircle2,
  AlertCircle, Clock, Shield, Camera, ChevronRight, Lock,
  BadgeCheck, X, Plus,
} from 'lucide-react'
import toast from 'react-hot-toast'

// ─── Constants ────────────────────────────────────────────────────────────────

const TABS = ['Personal', 'Contact', 'KYC']

const GENDER_OPTIONS    = ['MALE', 'FEMALE', 'OTHER']
const MARITAL_OPTIONS   = ['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED']
const DOC_TYPE_OPTIONS  = ['NID', 'BIRTH_CERTIFICATE', 'CV', 'PASSPORT', 'ACADEMIC', 'OTHER']

const DOC_TYPE_META = {
  NID:               { label: 'National ID (NID)',      color: 'text-blue-700',   bg: 'bg-blue-50'   },
  BIRTH_CERTIFICATE: { label: 'Birth Certificate',      color: 'text-teal-700',   bg: 'bg-teal-50'   },
  CV:                { label: 'CV / Resume',             color: 'text-purple-700', bg: 'bg-purple-50' },
  PASSPORT:          { label: 'Passport',                color: 'text-orange-700', bg: 'bg-orange-50' },
  ACADEMIC:          { label: 'Academic Certificate',    color: 'text-green-700',  bg: 'bg-green-50'  },
  OTHER:             { label: 'Other Document',          color: 'text-gray-600',   bg: 'bg-gray-100'  },
}

const STATUS_META = {
  CREATED:          { label: 'Not Started',       bg: 'bg-gray-100',    text: 'text-gray-600',   icon: AlertCircle  },
  INCOMPLETE:       { label: 'Incomplete',        bg: 'bg-amber-50',    text: 'text-amber-700',  icon: AlertCircle  },
  PENDING_APPROVAL: { label: 'Pending HR Review', bg: 'bg-blue-50',     text: 'text-blue-700',   icon: Clock        },
  APPROVED:         { label: 'Approved',          bg: 'bg-green-50',    text: 'text-green-700',  icon: BadgeCheck   },
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
  const color = pct === 100 ? 'bg-green-500' : pct >= 60 ? 'bg-blue-500' : 'bg-amber-400'
  return (
    <div className="w-full bg-gray-100 rounded-full h-2.5">
      <div
        className={`h-2.5 rounded-full transition-all duration-700 ${color}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  )
}

function StatusBadge({ status }) {
  const m = STATUS_META[status] ?? STATUS_META.INCOMPLETE
  const Icon = m.icon
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${m.bg} ${m.text}`}>
      <Icon className="w-4 h-4" />
      {m.label}
    </span>
  )
}

function Field({ label, required, locked, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1.5">
        {label}
        {required && <span className="text-red-400 ml-0.5">*</span>}
        {locked && <Lock className="inline w-3 h-3 ml-1 text-gray-400" />}
      </label>
      {children}
    </div>
  )
}

function Input({ locked, ...props }) {
  const base = 'w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white'
  const dis  = 'bg-gray-50 text-gray-500 cursor-not-allowed'
  return (
    <input
      disabled={locked || props.disabled}
      className={`${base} ${locked || props.disabled ? dis : ''}`}
      {...props}
    />
  )
}

function Select({ locked, children, ...props }) {
  const base = 'w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white'
  const dis  = 'bg-gray-50 text-gray-500 cursor-not-allowed'
  return (
    <select
      disabled={locked || props.disabled}
      className={`${base} ${locked || props.disabled ? dis : ''}`}
      {...props}
    >
      {children}
    </select>
  )
}

// ─── Tab: Personal ────────────────────────────────────────────────────────────

function PersonalTab({ form, onChange, locked, uploading, onPhotoUpload }) {
  const fileRef = useRef(null)
  return (
    <div className="space-y-5">
      {/* Photo */}
      <Field label="Profile Photo" locked={locked}>
        <div className="flex items-center gap-4">
          <div className="w-20 h-20 rounded-2xl bg-gray-100 border-2 border-dashed border-gray-300 overflow-hidden flex items-center justify-center shrink-0">
            {form.photo ? (
              <img src={form.photo} alt="Profile" className="w-full h-full object-cover" />
            ) : (
              <Camera className="w-7 h-7 text-gray-400" />
            )}
          </div>
          {!locked && (
            <div>
              <button
                type="button"
                disabled={uploading}
                onClick={() => fileRef.current?.click()}
                className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-xl text-sm font-medium hover:bg-blue-100 transition-colors disabled:opacity-50"
              >
                {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
                {uploading ? 'Uploading…' : 'Upload Photo'}
              </button>
              <p className="text-xs text-gray-400 mt-1">JPG or PNG, plain background</p>
              <input ref={fileRef} type="file" accept="image/*" className="hidden"
                onChange={e => onPhotoUpload(e.target.files?.[0])} />
            </div>
          )}
        </div>
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Gender" required locked={locked}>
          <Select value={form.gender ?? ''} onChange={e => onChange('gender', e.target.value || null)} locked={locked}>
            <option value="">Select gender</option>
            {GENDER_OPTIONS.map(g => <option key={g} value={g}>{g.charAt(0) + g.slice(1).toLowerCase()}</option>)}
          </Select>
        </Field>

        <Field label="Date of Birth" required locked={locked}>
          <Input type="date" value={form.dateOfBirth ?? ''} onChange={e => onChange('dateOfBirth', e.target.value)} locked={locked} />
        </Field>

        <Field label="Nationality" required locked={locked}>
          <Input type="text" placeholder="e.g. Bangladeshi" value={form.nationality ?? ''} onChange={e => onChange('nationality', e.target.value)} locked={locked} />
        </Field>

        <Field label="Marital Status" required locked={locked}>
          <Select value={form.maritalStatus ?? ''} onChange={e => onChange('maritalStatus', e.target.value || null)} locked={locked}>
            <option value="">Select status</option>
            {MARITAL_OPTIONS.map(m => <option key={m} value={m}>{m.charAt(0) + m.slice(1).toLowerCase()}</option>)}
          </Select>
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
    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
      <Field label="Phone Number" required locked={locked}>
        <Input type="tel" placeholder="+880 1x xx xx xx xx" value={form.phone ?? ''} onChange={e => onChange('phone', e.target.value)} locked={locked} />
      </Field>

      <Field label="Alternative Phone" locked={locked}>
        <Input type="tel" placeholder="+880 1x xx xx xx xx" value={form.secondaryPhone ?? ''} onChange={e => onChange('secondaryPhone', e.target.value)} locked={locked} />
      </Field>

      <div className="sm:col-span-2">
        <Field label="Full Address" required locked={locked}>
          <textarea
            rows={3}
            placeholder="House, Road, Area, City, Country"
            value={form.address ?? ''}
            onChange={e => onChange('address', e.target.value)}
            disabled={locked}
            className={`w-full px-3 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none ${locked ? 'bg-gray-50 text-gray-500 cursor-not-allowed' : 'bg-white'}`}
          />
        </Field>
      </div>

      <div className="sm:col-span-2 space-y-3">
        <div className="flex items-center justify-between">
          <label className="block text-xs font-medium text-gray-500">
            Emergency Contacts <span className="text-red-400">*</span>
          </label>
          {!locked && (
            <button type="button" onClick={addContact}
              className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-medium">
              <Plus className="w-3.5 h-3.5" /> Add Another
            </button>
          )}
        </div>
        {contacts.map((contact, i) => (
          <div key={i} className="border border-gray-200 rounded-xl p-3 space-y-2">
            {contacts.length > 1 && (
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-gray-400 font-medium">Contact {i + 1}</span>
                {!locked && (
                  <button type="button" onClick={() => removeContact(i)}
                    className="p-1 text-gray-300 hover:text-red-500 rounded-lg hover:bg-red-50 transition-colors">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            )}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
              <Input type="text" placeholder="Full Name" value={contact.name} locked={locked}
                onChange={e => updateContact(i, 'name', e.target.value)} />
              <Input type="text" placeholder="Relation (e.g. Father)" value={contact.relation} locked={locked}
                onChange={e => updateContact(i, 'relation', e.target.value)} />
              <Input type="tel" placeholder="Phone Number" value={contact.phone} locked={locked}
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
    <div className="space-y-5">
      {kycLocked && (
        <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl text-sm text-amber-700">
          <Lock className="w-4 h-4 shrink-0" />
          KYC documents are locked after HR verification.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="NID Number" required locked={effectiveLock}>
          <Input type="text" placeholder="National ID number" value={form.nidNumber ?? ''} onChange={e => onChange('nidNumber', e.target.value)} locked={effectiveLock} />
        </Field>

        <Field label="Passport Number" locked={effectiveLock}>
          <Input type="text" placeholder="Optional" value={form.passportNumber ?? ''} onChange={e => onChange('passportNumber', e.target.value)} locked={effectiveLock} />
        </Field>
      </div>

      {/* Documents */}
      <div>
        <p className="text-xs font-medium text-gray-500 mb-2">
          Documents <span className="text-red-400">*</span>
          <span className="text-gray-400 font-normal ml-1">(at least 1 required — NID scan recommended)</span>
        </p>

        {(form.documents ?? []).length === 0 ? (
          <div className="text-center py-6 border-2 border-dashed border-gray-200 rounded-xl text-sm text-gray-400">
            No documents uploaded yet
          </div>
        ) : (
          <div className="space-y-2 mb-3">
            {(form.documents ?? []).map((doc, i) => {
              const meta = DOC_TYPE_META[doc.type] ?? DOC_TYPE_META.OTHER
              const name = doc.name || doc.url?.split('/').pop() || 'Document'
              return (
                <div key={i} className="flex items-center gap-3 p-3 bg-gray-50 border border-gray-100 rounded-xl">
                  <FileText className={`w-4 h-4 shrink-0 ${meta.color}`} />
                  <div className="flex-1 min-w-0">
                    <p className="text-sm text-gray-800 truncate">{name}</p>
                    <span className={`text-xs px-1.5 py-0.5 rounded-full ${meta.bg} ${meta.color}`}>{meta.label}</span>
                  </div>
                  <a href={doc.url} target="_blank" rel="noreferrer" className="text-xs text-blue-600 hover:underline shrink-0">View</a>
                  {!effectiveLock && (
                    <button type="button" onClick={() => onDocRemove(i)} className="p-1 text-gray-400 hover:text-red-500 transition-colors">
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              )
            })}
          </div>
        )}

        {!effectiveLock && (
          <div className="flex flex-wrap gap-2 items-end p-3 bg-gray-50 border border-gray-100 rounded-xl">
            <div>
              <p className="text-xs text-gray-400 mb-1">Type</p>
              <select value={addType} onChange={e => { setAddType(e.target.value); setAddName('') }}
                className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-500">
                {DOC_TYPE_OPTIONS.map(t => <option key={t} value={t}>{DOC_TYPE_META[t].label}</option>)}
              </select>
            </div>
            {addType === 'OTHER' && (
              <div>
                <p className="text-xs text-gray-400 mb-1">Name</p>
                <input value={addName} onChange={e => setAddName(e.target.value)} placeholder="Document name"
                  className="px-2 py-1.5 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-1 focus:ring-blue-500 w-40" />
              </div>
            )}
            <div>
              <p className="text-xs text-gray-400 mb-1">File</p>
              <button type="button" disabled={docUploading} onClick={() => fileRef.current?.click()}
                className="flex items-center gap-1.5 px-3 py-1.5 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-all disabled:opacity-50">
                {docUploading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />}
                {docUploading ? 'Uploading…' : 'Upload'}
              </button>
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
      toast.error('Please enter a document name for "Other" type')
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
      if (!res.ok) throw new Error(json.error ?? 'Save failed')
      setEmp(prev => ({ ...prev, ...json.data, profileCompletionPct: json.profileCompletionPct, profileStatus: json.profileStatus }))
      toast.success(json.profileStatus === 'PENDING_APPROVAL'
        ? 'Profile complete! Submitted to HR for review.'
        : 'Profile saved successfully')
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-blue-600" />
      </div>
    )
  }

  if (!emp) return null

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

  return (
    <div className="max-w-3xl mx-auto space-y-6">

      {/* Header card */}
      <div className="bg-white rounded-2xl border border-gray-100 p-6 shadow-sm">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-2xl bg-blue-50 flex items-center justify-center shrink-0 overflow-hidden">
            {form.photo ? (
              <img src={form.photo} alt="" className="w-full h-full object-cover" />
            ) : (
              <User className="w-7 h-7 text-blue-600" />
            )}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-3 flex-wrap">
              <h1 className="text-xl font-bold text-gray-900">{userName}</h1>
              <StatusBadge status={status} />
            </div>
            <p className="text-sm text-gray-400 mt-0.5">{emp.user?.email ?? session?.user?.email}</p>

            {/* Progress */}
            <div className="mt-4">
              <div className="flex items-center justify-between mb-1.5">
                <span className="text-sm font-medium text-gray-600">Profile Completion</span>
                <span className={`text-sm font-bold ${pct === 100 ? 'text-green-600' : 'text-blue-600'}`}>{pct}%</span>
              </div>
              <ProgressBar pct={pct} />
              {pct < 100 && (
                <p className="text-xs text-gray-400 mt-1.5">Complete all required fields to submit for HR review</p>
              )}
              {status === 'PENDING_APPROVAL' && (
                <p className="text-xs text-blue-600 mt-1.5 font-medium">Your profile is pending HR review. You will be notified once approved.</p>
              )}
              {status === 'APPROVED' && (
                <p className="text-xs text-green-600 mt-1.5 font-medium">Your profile has been approved. You have full panel access.</p>
              )}
            </div>
          </div>
        </div>

        {/* HR notes if rejected */}
        {emp.hrNotes && status === 'INCOMPLETE' && (
          <div className="mt-4 flex items-start gap-3 p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <span className="font-medium">HR Feedback: </span>{emp.hrNotes}
            </div>
          </div>
        )}
      </div>

      {/* Company info (HR-filled, read-only) */}
      {(emp.department || emp.position || emp.venture) && (
        <div className="bg-white rounded-2xl border border-gray-100 p-5 shadow-sm">
          <div className="flex items-center gap-2 mb-3">
            <Shield className="w-4 h-4 text-gray-400" />
            <h2 className="text-sm font-semibold text-gray-600">Company Info (HR managed)</h2>
          </div>
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
            {emp.employeeId && (
              <div>
                <p className="text-xs text-gray-400">Employee ID</p>
                <p className="text-sm font-semibold text-gray-800 font-mono">{emp.employeeId}</p>
              </div>
            )}
            {emp.department && (
              <div>
                <p className="text-xs text-gray-400">Department</p>
                <p className="text-sm font-medium text-gray-800">{emp.department}</p>
              </div>
            )}
            {emp.position && (
              <div>
                <p className="text-xs text-gray-400">Position</p>
                <p className="text-sm font-medium text-gray-800">{emp.position}</p>
              </div>
            )}
            {emp.venture && (
              <div>
                <p className="text-xs text-gray-400">Venture</p>
                <p className="text-sm font-medium text-gray-800">{emp.venture}</p>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Tab navigation */}
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm overflow-hidden">
        <div className="flex border-b border-gray-100">
          {TABS.map((tab, i) => {
            const done  = tabDone[i]
            const total = tabTotal[i]
            const full  = done === total
            return (
              <button
                key={tab}
                onClick={() => setActiveTab(i)}
                className={`flex-1 flex items-center justify-center gap-2 py-3.5 px-4 text-sm font-medium transition-colors border-b-2 ${
                  activeTab === i
                    ? 'border-blue-600 text-blue-600 bg-blue-50/50'
                    : 'border-transparent text-gray-500 hover:text-gray-700 hover:bg-gray-50'
                }`}
              >
                {full
                  ? <CheckCircle2 className="w-4 h-4 text-green-500" />
                  : <span className={`text-xs font-semibold px-1.5 py-0.5 rounded-full ${activeTab === i ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'}`}>{done}/{total}</span>
                }
                {tab}
              </button>
            )
          })}
        </div>

        <div className="p-6">
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

          {/* Navigation + Save */}
          <div className="flex items-center justify-between mt-6 pt-4 border-t border-gray-100">
            <button
              type="button"
              disabled={activeTab === 0}
              onClick={() => setActiveTab(t => t - 1)}
              className="px-4 py-2 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
            >
              Previous
            </button>

            <div className="flex items-center gap-3">
              {!finalLocked && (
                <button
                  type="button"
                  onClick={handleSave}
                  disabled={saving}
                  className="flex items-center gap-2 px-5 py-2 bg-blue-600 text-white text-sm font-medium rounded-xl hover:bg-blue-700 disabled:opacity-50 transition-colors"
                >
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                  {saving ? 'Saving…' : 'Save'}
                </button>
              )}
              {activeTab < TABS.length - 1 && (
                <button
                  type="button"
                  onClick={() => setActiveTab(t => t + 1)}
                  className="flex items-center gap-1.5 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-gray-800 transition-colors"
                >
                  Next <ChevronRight className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
