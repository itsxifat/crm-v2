'use client'

import { useEffect, useState, useRef } from 'react'
import Image from 'next/image'
import { useParams } from 'next/navigation'
import { Upload, X, FileText, Loader2, CheckCircle, AlertCircle, ChevronRight, ChevronLeft } from 'lucide-react'
import toast, { Toaster } from 'react-hot-toast'

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']
const DOC_TYPES = [
  { value: 'NID',              label: 'NID' },
  { value: 'BIRTH_CERTIFICATE', label: 'Birth Certificate' },
  { value: 'CV',               label: 'CV / Resume' },
  { value: 'PASSPORT',         label: 'Passport' },
  { value: 'ACADEMIC',         label: 'Academic Certificate' },
  { value: 'OTHER',            label: 'Other' },
]

const STEPS = ['Personal Info', 'Contact & Address', 'Photo & Documents']

function UploadBtn({ onUploaded, accept = 'image/*,application/pdf', children }) {
  const ref = useRef(null)
  const [busy, setBusy] = useState(false)

  async function handleFile(file) {
    if (!file) return
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res  = await fetch('/api/upload', { method: 'POST', body: fd })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Upload failed')
      onUploaded(json.url)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <button type="button" onClick={() => ref.current?.click()}
      disabled={busy}
      className="flex items-center gap-2 px-4 py-2 border-2 border-dashed border-gray-300 rounded-xl text-sm text-gray-500 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50 transition-all w-full justify-center disabled:opacity-50">
      {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Upload className="w-4 h-4" />}
      {busy ? 'Uploading…' : children}
      <input ref={ref} type="file" accept={accept} className="hidden"
        onChange={e => handleFile(e.target.files?.[0])} />
    </button>
  )
}

function Field({ label, required, children }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1">
        {label}{required && <span className="text-red-500 ml-0.5">*</span>}
      </label>
      {children}
    </div>
  )
}

const inputCls = 'w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition bg-white'

export default function OnboardingPage() {
  const { token } = useParams()
  const [loading, setLoading]   = useState(true)
  const [prefill, setPrefill]   = useState(null)
  const [error, setError]       = useState(null)
  const [step, setStep]         = useState(0)
  const [submitting, setSubmitting] = useState(false)
  const [done, setDone]         = useState(false)
  const [creds, setCreds]       = useState(null)   // { email, password }

  const [form, setForm] = useState({
    name: '', email: '', phone: '', secondaryPhone: '', homePhone: '',
    dateOfBirth: '', nidNumber: '', nidUrl: '', address: '', emergencyContact: '',
    bloodGroup: '', photo: '', documents: [],
  })

  useEffect(() => {
    fetch(`/api/onboarding/${token}`)
      .then(r => r.json())
      .then(j => {
        if (j.error) { setError(j.error); setLoading(false); return }
        setPrefill(j.data)
        setForm(f => ({ ...f, email: j.data.email || '' }))
        setLoading(false)
      })
      .catch(() => { setError('Failed to load. Please try again.'); setLoading(false) })
  }, [token])

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  function addDoc(url) {
    setForm(f => ({ ...f, documents: [...f.documents, { url, type: 'OTHER', name: '' }] }))
  }
  function removeDoc(i) {
    setForm(f => ({ ...f, documents: f.documents.filter((_, idx) => idx !== i) }))
  }
  function setDocField(i, k, v) {
    setForm(f => {
      const docs = [...f.documents]
      docs[i] = { ...docs[i], [k]: v }
      return { ...f, documents: docs }
    })
  }

  function validateStep() {
    if (step === 0) {
      if (!form.name.trim()) { toast.error('Full name is required'); return false }
      if (!form.email.trim()) { toast.error('Email is required'); return false }
      if (!form.phone.trim()) { toast.error('Primary phone is required'); return false }
    }
    if (step === 1) {
      if (!form.dateOfBirth) { toast.error('Date of birth is required'); return false }
      if (!form.nidNumber.trim()) { toast.error('NID number is required'); return false }
      if (!form.nidUrl) { toast.error('Please upload a copy of your NID'); return false }
      if (!form.address.trim()) { toast.error('Address is required'); return false }
    }
    if (step === 2) {
      if (!form.photo) { toast.error('Please upload your formal photo'); return false }
    }
    return true
  }

  async function handleSubmit() {
    if (!validateStep()) return
    setSubmitting(true)
    try {
      // Auto-include NID upload in documents list (tagged as NID type)
    const allDocs = [
      ...(form.nidUrl ? [{ url: form.nidUrl, type: 'NID', name: 'NID Copy' }] : []),
      ...form.documents,
    ]
    const res = await fetch(`/api/onboarding/${token}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, documents: allDocs }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Submission failed')
      setCreds({ email: json.email, password: json.password })
      setDone(true)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
    </div>
  )

  if (error) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-sm p-8 max-w-sm w-full text-center">
        <AlertCircle className="w-12 h-12 text-red-400 mx-auto mb-3" />
        <h2 className="text-lg font-semibold text-gray-800 mb-1">Link Error</h2>
        <p className="text-sm text-gray-500">{error}</p>
      </div>
    </div>
  )

  if (done) return (
    <div className="min-h-screen bg-gradient-to-br from-green-50 to-emerald-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl shadow-md p-8 max-w-sm w-full text-center">
        <CheckCircle className="w-14 h-14 text-green-500 mx-auto mb-4" />
        <h2 className="text-xl font-bold text-gray-800 mb-1">Account Created!</h2>
        <p className="text-sm text-gray-500 mb-6">
          Your information was submitted and your panel account is ready.
        </p>
        {creds && (
          <div className="bg-gray-50 border border-gray-200 rounded-xl p-4 text-left mb-4">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Your Login Credentials</p>
            <div className="space-y-2">
              <div>
                <p className="text-xs text-gray-400">Email</p>
                <p className="text-sm font-medium text-gray-800 break-all">{creds.email}</p>
              </div>
              <div>
                <p className="text-xs text-gray-400">Temporary Password</p>
                <p className="text-lg font-mono font-bold text-blue-700 tracking-widest">{creds.password}</p>
              </div>
            </div>
            <p className="text-xs text-orange-600 mt-3 flex items-start gap-1">
              <AlertCircle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              Save this password now — it will not be shown again. Change it after first login.
            </p>
          </div>
        )}
        <p className="text-xs text-gray-400">HR will add your employment details shortly.</p>
      </div>
    </div>
  )

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-indigo-50 flex items-center justify-center p-4 py-8">
      <Toaster position="top-center" />
      <div className="bg-white rounded-2xl shadow-md w-full max-w-lg flex flex-col" style={{ maxHeight: 'calc(100vh - 4rem)' }}>
        {/* Header */}
        <div className="bg-gradient-to-r from-blue-600 to-indigo-600 px-6 py-5 text-white rounded-t-2xl shrink-0">
          <h1 className="text-xl font-bold">Employee Onboarding</h1>
          <p className="text-sm text-blue-100 mt-0.5">Please fill in your information accurately</p>
        </div>

        {/* Stepper */}
        <div className="flex border-b border-gray-100 shrink-0">
          {STEPS.map((s, i) => (
            <div key={s} className={`flex-1 py-3 px-2 text-center text-xs font-medium transition-colors ${
              i === step ? 'text-blue-600 border-b-2 border-blue-600' :
              i < step   ? 'text-green-600' : 'text-gray-400'
            }`}>
              <span className={`inline-flex items-center justify-center w-5 h-5 rounded-full text-xs mr-1 ${
                i < step ? 'bg-green-100 text-green-600' :
                i === step ? 'bg-blue-100 text-blue-600' : 'bg-gray-100 text-gray-400'
              }`}>{i < step ? '✓' : i + 1}</span>
              {s}
            </div>
          ))}
        </div>

        {/* Form body — scrollable */}
        <div className="p-6 space-y-4 overflow-y-auto flex-1">

          {/* Step 0: Personal Info */}
          {step === 0 && <>
            <Field label="Full Name" required>
              <input className={inputCls} placeholder="As on NID" value={form.name}
                onChange={e => set('name', e.target.value)} />
            </Field>
            <Field label="Email Address" required>
              <input className={inputCls} type="email" placeholder="your@email.com" value={form.email}
                onChange={e => set('email', e.target.value)} />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Primary Phone" required>
                <input className={inputCls} placeholder="+880..." value={form.phone}
                  onChange={e => set('phone', e.target.value)} />
              </Field>
              <Field label="Secondary Phone">
                <input className={inputCls} placeholder="+880..." value={form.secondaryPhone}
                  onChange={e => set('secondaryPhone', e.target.value)} />
              </Field>
            </div>
            <Field label="Home Phone">
              <input className={inputCls} placeholder="+880..." value={form.homePhone}
                onChange={e => set('homePhone', e.target.value)} />
            </Field>
          </>}

          {/* Step 1: Contact & Address */}
          {step === 1 && <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date of Birth" required>
                <input className={inputCls} type="date" value={form.dateOfBirth}
                  onChange={e => set('dateOfBirth', e.target.value)} />
              </Field>
              <Field label="Blood Group">
                <select className={inputCls} value={form.bloodGroup}
                  onChange={e => set('bloodGroup', e.target.value)}>
                  <option value="">Select</option>
                  {BLOOD_GROUPS.map(g => <option key={g} value={g}>{g}</option>)}
                </select>
              </Field>
            </div>
            <Field label="NID Number" required>
              <input className={inputCls} placeholder="National ID number" value={form.nidNumber}
                onChange={e => set('nidNumber', e.target.value)} />
            </Field>
            <Field label="NID Copy (front & back)" required>
              {form.nidUrl ? (
                <div className="flex items-center gap-2 p-2.5 border border-green-200 rounded-xl bg-green-50">
                  <FileText className="w-4 h-4 text-green-600 shrink-0" />
                  <a href={form.nidUrl} target="_blank" rel="noopener noreferrer"
                    className="flex-1 text-xs text-green-700 hover:underline truncate">
                    {form.nidUrl.split('/').pop()}
                  </a>
                  <button type="button" onClick={() => set('nidUrl', '')}
                    className="p-0.5 text-gray-400 hover:text-red-500">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <UploadBtn accept="image/*,application/pdf" onUploaded={url => set('nidUrl', url)}>
                  Upload NID scan / photo (JPG, PNG or PDF)
                </UploadBtn>
              )}
            </Field>
            <Field label="Current Address" required>
              <textarea className={inputCls} rows={2} placeholder="Full address" value={form.address}
                onChange={e => set('address', e.target.value)} />
            </Field>
            <Field label="Emergency Contact">
              <input className={inputCls} placeholder="Name + phone number" value={form.emergencyContact}
                onChange={e => set('emergencyContact', e.target.value)} />
            </Field>
          </>}

          {/* Step 2: Photo & Documents */}
          {step === 2 && <>
            <Field label="Formal Photo" required>
              <p className="text-xs text-gray-400 mb-2">Clear face photo, plain background, no sunglasses. Used for your employee ID card.</p>
              {form.photo ? (
                <div className="flex items-center gap-3 p-3 border border-green-200 rounded-xl bg-green-50">
                  <Image src={form.photo} alt="photo" width={64} height={64} className="w-16 h-16 object-cover rounded-lg border border-green-200" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-green-700">Photo uploaded</p>
                    <p className="text-xs text-gray-500 truncate mt-0.5">{form.photo.split('/').pop()}</p>
                  </div>
                  <button type="button" onClick={() => set('photo', '')}
                    className="p-1 text-gray-400 hover:text-red-500">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <UploadBtn accept="image/*" onUploaded={url => set('photo', url)}>
                  Upload formal photo (JPG, PNG)
                </UploadBtn>
              )}
            </Field>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-sm font-medium text-gray-700">Documents</label>
                <UploadBtn accept="image/*,application/pdf" onUploaded={addDoc}>
                  <span className="text-xs">+ Add Document</span>
                </UploadBtn>
              </div>
              {form.documents.length === 0 && (
                <p className="text-xs text-gray-400 text-center py-4 border border-dashed border-gray-200 rounded-xl">
                  Upload NID, birth certificate, CV, passport, or other documents
                </p>
              )}
              <div className="space-y-2 mt-2">
                {form.documents.map((doc, i) => (
                  <div key={i} className="flex items-center gap-2 p-2.5 border border-gray-200 rounded-xl bg-gray-50">
                    <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                    <a href={doc.url} target="_blank" rel="noopener noreferrer"
                      className="flex-1 text-xs text-blue-600 hover:underline truncate">
                      {doc.url.split('/').pop()}
                    </a>
                    <select value={doc.type}
                      onChange={e => setDocField(i, 'type', e.target.value)}
                      className="text-xs border border-gray-200 rounded-lg px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-blue-500">
                      {DOC_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                    <button type="button" onClick={() => removeDoc(i)}
                      className="p-0.5 text-gray-400 hover:text-red-500">
                      <X className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          </>}
        </div>

        {/* Footer */}
        <div className="px-6 pb-6 flex items-center justify-between gap-3">
          <button type="button" onClick={() => setStep(s => s - 1)}
            disabled={step === 0}
            className="flex items-center gap-1 px-4 py-2.5 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors">
            <ChevronLeft className="w-4 h-4" /> Back
          </button>

          {step < STEPS.length - 1 ? (
            <button type="button" onClick={() => { if (validateStep()) setStep(s => s + 1) }}
              className="flex items-center gap-1 px-6 py-2.5 text-sm text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors font-medium ml-auto">
              Next <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button type="button" onClick={handleSubmit} disabled={submitting}
              className="flex items-center gap-2 px-6 py-2.5 text-sm text-white bg-green-600 rounded-xl hover:bg-green-700 disabled:opacity-50 transition-colors font-medium ml-auto">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              {submitting ? 'Submitting…' : 'Submit'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
