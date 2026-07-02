'use client'

import { useState, useEffect, useRef } from 'react'
import { useSession } from 'next-auth/react'
import {
  Loader2, Upload, Plus, X, ShieldCheck, Clock, AlertCircle,
  BadgeCheck, FileText, Building2, User as UserIcon,
} from 'lucide-react'
import toast, { Toaster } from 'react-hot-toast'

const inputCls = 'w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-purple-500 focus:border-transparent transition bg-white text-gray-800 placeholder:text-gray-400'

const DOC_TYPES = ['NID', 'PASSPORT', 'TRADE_LICENSE', 'TIN', 'CV', 'PORTFOLIO', 'OTHER']
const DOC_LABELS = {
  NID: 'National ID', PASSPORT: 'Passport', TRADE_LICENSE: 'Trade License',
  TIN: 'TIN Certificate', CV: 'CV / Resume', PORTFOLIO: 'Portfolio', OTHER: 'Other Document',
}

const STATUS_META = {
  CREATED:          { label: 'Not Started',   bg: 'bg-gray-100',  text: 'text-gray-600',   icon: AlertCircle },
  INCOMPLETE:       { label: 'Incomplete',    bg: 'bg-amber-50',  text: 'text-amber-700',  icon: AlertCircle },
  PENDING_APPROVAL: { label: 'Under Review',  bg: 'bg-blue-50',   text: 'text-blue-700',   icon: Clock },
  APPROVED:         { label: 'Verified',      bg: 'bg-green-50',  text: 'text-green-700',  icon: BadgeCheck },
}

function Field({ label, required, children }) {
  return (
    <div>
      <label className="block text-xs font-medium text-gray-500 mb-1.5">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
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
        ? 'Submitted for verification!'
        : 'Saved')
      // Refresh the session so the gate reflects the new status promptly.
      update?.()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return (
    <div className="flex items-center justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
  )

  if (!fl) return (
    <div className="max-w-md mx-auto mt-16 bg-white rounded-2xl border border-gray-100 p-8 text-center">
      <AlertCircle className="w-10 h-10 text-amber-400 mx-auto mb-3" />
      <h1 className="text-lg font-semibold text-gray-900">Profile not set up yet</h1>
      <p className="text-sm text-gray-500 mt-1">Your record isn’t ready. Please contact your admin.</p>
    </div>
  )

  const status = fl.profileStatus ?? 'CREATED'
  const pct    = fl.profileCompletionPct ?? 0
  const meta   = STATUS_META[status] ?? STATUS_META.INCOMPLETE
  const Icon   = meta.icon
  const locked = fl.kycApproved

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <Toaster position="top-center" />

      {/* Header */}
      <div className="bg-white border border-gray-100 rounded-2xl p-6">
        <div className="flex items-center gap-3 flex-wrap">
          <div className="w-11 h-11 rounded-xl bg-purple-100 flex items-center justify-center shrink-0">
            {isAgency ? <Building2 className="w-5 h-5 text-purple-700" /> : <ShieldCheck className="w-5 h-5 text-purple-700" />}
          </div>
          <div className="flex-1 min-w-0">
            <h1 className="text-xl font-semibold text-gray-900">{isAgency ? 'Agency Verification' : 'Identity Verification'}</h1>
            <p className="text-sm text-gray-400">Complete your KYC to unlock full portal access</p>
          </div>
          <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium ${meta.bg} ${meta.text}`}>
            <Icon className="w-4 h-4" /> {meta.label}
          </span>
        </div>

        <div className="mt-4">
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-sm font-medium text-gray-600">Completion</span>
            <span className={`text-sm font-bold ${pct === 100 ? 'text-green-600' : 'text-purple-600'}`}>{pct}%</span>
          </div>
          <div className="w-full bg-gray-100 rounded-full h-2.5">
            <div className={`h-2.5 rounded-full transition-all duration-700 ${pct === 100 ? 'bg-green-500' : 'bg-purple-500'}`} style={{ width: `${pct}%` }} />
          </div>
          {status === 'PENDING_APPROVAL' && (
            <p className="text-xs text-blue-600 mt-2 font-medium">Your submission is under review. You’ll be notified once verified.</p>
          )}
          {status === 'APPROVED' && (
            <p className="text-xs text-green-600 mt-2 font-medium">You’re verified — you have full portal access.</p>
          )}
          {fl.reviewNotes && status === 'INCOMPLETE' && (
            <div className="mt-3 flex items-start gap-2 p-3 bg-red-50 border border-red-100 rounded-xl text-sm text-red-700">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <div><span className="font-medium">Reviewer note: </span>{fl.reviewNotes}</div>
            </div>
          )}
        </div>
      </div>

      {/* Form */}
      <div className="bg-white border border-gray-100 rounded-2xl p-6 space-y-5">
        {isAgency ? (
          <>
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-600"><Building2 className="w-4 h-4" /> Agency Details</div>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Agency Name" required><input className={inputCls} disabled={locked} value={form.agencyInfo.agencyName} onChange={e => setNested('agencyInfo', 'agencyName', e.target.value)} /></Field>
              <Field label="Agency Type"><input className={inputCls} disabled={locked} value={form.agencyInfo.type} onChange={e => setNested('agencyInfo', 'type', e.target.value)} placeholder="e.g. Design Studio" /></Field>
            </div>
            <Field label="Address" required><input className={inputCls} disabled={locked} value={form.address} onChange={e => set('address', e.target.value)} /></Field>

            <div className="flex items-center gap-2 text-sm font-semibold text-gray-600 pt-2"><UserIcon className="w-4 h-4" /> Contact Person</div>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="Name" required><input className={inputCls} disabled={locked} value={form.contactPerson.name} onChange={e => setNested('contactPerson', 'name', e.target.value)} /></Field>
              <Field label="Phone" required><input className={inputCls} disabled={locked} value={form.contactPerson.phone} onChange={e => setNested('contactPerson', 'phone', e.target.value)} /></Field>
              <Field label="Email"><input className={inputCls} disabled={locked} value={form.contactPerson.email} onChange={e => setNested('contactPerson', 'email', e.target.value)} /></Field>
              <Field label="Designation"><input className={inputCls} disabled={locked} value={form.contactPerson.designation} onChange={e => setNested('contactPerson', 'designation', e.target.value)} /></Field>
            </div>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 text-sm font-semibold text-gray-600"><UserIcon className="w-4 h-4" /> Identity</div>
            <div className="grid sm:grid-cols-2 gap-4">
              <Field label="NID Number" required><input className={inputCls} disabled={locked} value={form.nidNumber} onChange={e => set('nidNumber', e.target.value)} /></Field>
              <Field label="Passport Number"><input className={inputCls} disabled={locked} value={form.passportNumber} onChange={e => set('passportNumber', e.target.value)} /></Field>
            </div>
            <Field label="Address" required><input className={inputCls} disabled={locked} value={form.address} onChange={e => set('address', e.target.value)} /></Field>
            <Field label="Skills" required><input className={inputCls} disabled={locked} value={form.skills} onChange={e => set('skills', e.target.value)} placeholder="e.g. React, Node.js, UI Design" /></Field>
            <Field label="Bio"><textarea rows={3} className={inputCls} disabled={locked} value={form.bio} onChange={e => set('bio', e.target.value)} /></Field>
            <Field label="Portfolio Links"><input className={inputCls} disabled={locked} value={form.portfolioLinks} onChange={e => set('portfolioLinks', e.target.value)} placeholder="https://…" /></Field>
          </>
        )}

        {/* Documents */}
        <div className="flex items-center gap-2 text-sm font-semibold text-gray-600 pt-2"><FileText className="w-4 h-4" /> Documents <span className="text-red-400">*</span></div>
        {(form.documents ?? []).length === 0 ? (
          <p className="text-sm text-gray-400 py-3 border border-dashed border-gray-200 rounded-xl text-center">No documents uploaded yet</p>
        ) : (
          <div className="space-y-2">
            {(form.documents ?? []).map((d, i) => (
              <div key={i} className="flex items-center gap-3 p-2.5 border border-gray-100 rounded-xl">
                <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                <a href={d.url} target="_blank" rel="noreferrer" className="text-sm text-gray-700 hover:text-purple-600 truncate flex-1">{d.name || DOC_LABELS[d.type] || d.type}</a>
                {!locked && <button onClick={() => removeDoc(i)} className="text-gray-400 hover:text-red-500"><X className="w-4 h-4" /></button>}
              </div>
            ))}
          </div>
        )}

        {!locked && (
          <div className="flex flex-wrap items-end gap-3 p-3 bg-gray-50 rounded-xl">
            <div>
              <p className="text-xs text-gray-400 mb-1">Type</p>
              <select value={addType} onChange={e => { setAddType(e.target.value); setAddName('') }} className="px-2 py-2 border border-gray-200 rounded-lg text-sm bg-white">
                {DOC_TYPES.map(t => <option key={t} value={t}>{DOC_LABELS[t]}</option>)}
              </select>
            </div>
            {addType === 'OTHER' && (
              <div>
                <p className="text-xs text-gray-400 mb-1">Name</p>
                <input value={addName} onChange={e => setAddName(e.target.value)} placeholder="Document name" className="px-2 py-2 border border-gray-200 rounded-lg text-sm bg-white w-44" />
              </div>
            )}
            <div>
              <p className="text-xs text-gray-400 mb-1">File</p>
              <button type="button" disabled={docUploading} onClick={() => fileRef.current?.click()} className="flex items-center gap-1.5 px-3 py-2 border-2 border-dashed border-gray-300 rounded-lg text-sm text-gray-500 hover:border-purple-400 hover:text-purple-600 hover:bg-purple-50 transition disabled:opacity-50">
                {docUploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
                {docUploading ? 'Uploading…' : 'Upload'}
              </button>
              <input ref={fileRef} type="file" accept="image/*,application/pdf" className="hidden" onChange={e => uploadDoc(e.target.files?.[0])} />
            </div>
          </div>
        )}

        {!locked && (
          <div className="pt-2">
            <button onClick={handleSave} disabled={saving} className="inline-flex items-center gap-2 px-5 py-2.5 bg-purple-600 text-white text-sm font-medium rounded-xl hover:bg-purple-700 transition disabled:opacity-50">
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
              {saving ? 'Saving…' : 'Save & Submit'}
            </button>
            <p className="text-xs text-gray-400 mt-2">Complete all required fields (*) to submit for verification.</p>
          </div>
        )}
      </div>
    </div>
  )
}
