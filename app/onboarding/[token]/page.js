'use client'

import { useEffect, useState, useRef, useCallback } from 'react'
import Image from 'next/image'
import { useParams } from 'next/navigation'
import {
  Upload, X, FileText, Loader2, CheckCircle, AlertCircle,
  ChevronRight, ChevronLeft, ChevronDown, Calendar,
  User, MapPin, Camera, Eye, EyeOff,
} from 'lucide-react'
import toast, { Toaster } from 'react-hot-toast'

// ─── Constants ────────────────────────────────────────────────────────────────

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']
const DOC_TYPES = [
  { value: 'NID',               label: 'NID' },
  { value: 'BIRTH_CERTIFICATE', label: 'Birth Certificate' },
  { value: 'CV',                label: 'CV / Resume' },
  { value: 'PASSPORT',          label: 'Passport' },
  { value: 'ACADEMIC',          label: 'Academic Certificate' },
  { value: 'OTHER',             label: 'Other' },
]
const STEPS = [
  { label: 'Personal Info',      icon: User },
  { label: 'Contact & Address',  icon: MapPin },
  { label: 'Photo & Documents',  icon: Camera },
]
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

// ─── Custom Dropdown ──────────────────────────────────────────────────────────

function Dropdown({ value, onChange, options, placeholder = 'Select', className = '' }) {
  const [open, setOpen]     = useState(false)
  const ref                  = useRef(null)
  const selected             = options.find(o => (typeof o === 'string' ? o : o.value) === value)
  const label                = selected ? (typeof selected === 'string' ? selected : selected.label) : null

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  return (
    <div ref={ref} className={`relative ${className}`}>
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center justify-between px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition hover:border-gray-300"
      >
        <span className={label ? 'text-gray-800' : 'text-gray-400'}>{label ?? placeholder}</span>
        <ChevronDown className={`w-4 h-4 text-gray-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 w-full bg-white border border-gray-100 rounded-xl shadow-lg py-1 max-h-52 overflow-y-auto">
          {options.map(opt => {
            const v = typeof opt === 'string' ? opt : opt.value
            const l = typeof opt === 'string' ? opt : opt.label
            return (
              <button
                key={v}
                type="button"
                onClick={() => { onChange(v); setOpen(false) }}
                className={`w-full text-left px-3 py-2 text-sm transition-colors ${
                  v === value ? 'bg-blue-50 text-blue-700 font-medium' : 'text-gray-700 hover:bg-gray-50'
                }`}
              >
                {l}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Custom Calendar Picker ───────────────────────────────────────────────────

function CalendarPicker({ value, onChange, placeholder = 'Pick a date', maxDate }) {
  const [open, setOpen]     = useState(false)
  const [viewYear, setViewYear] = useState(null)
  const [viewMonth, setViewMonth] = useState(null)
  const [mode, setMode]     = useState('day') // 'day' | 'month' | 'year'
  const ref                  = useRef(null)

  // Parse value
  const parsed = value ? new Date(value + 'T00:00:00') : null

  useEffect(() => {
    const base = parsed ?? new Date()
    setViewYear(base.getFullYear())
    setViewMonth(base.getMonth())
  }, [open]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    function handler(e) { if (ref.current && !ref.current.contains(e.target)) { setOpen(false); setMode('day') } }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  function selectDay(d) {
    const mm   = String(viewMonth + 1).padStart(2, '0')
    const dd   = String(d).padStart(2, '0')
    onChange(`${viewYear}-${mm}-${dd}`)
    setOpen(false)
    setMode('day')
  }

  function daysInMonth(y, m) { return new Date(y, m + 1, 0).getDate() }
  function firstWeekday(y, m) { return new Date(y, m, 1).getDay() }

  const maxDt = maxDate ? new Date(maxDate + 'T00:00:00') : null

  function isDisabled(d) {
    if (!maxDt) return false
    const dt = new Date(viewYear, viewMonth, d)
    return dt > maxDt
  }

  function isSelected(d) {
    if (!parsed) return false
    return parsed.getFullYear() === viewYear && parsed.getMonth() === viewMonth && parsed.getDate() === d
  }

  const displayLabel = parsed
    ? `${parsed.getDate()} ${MONTHS[parsed.getMonth()]} ${parsed.getFullYear()}`
    : null

  const yearRange = Array.from({ length: 100 }, (_, i) => new Date().getFullYear() - i)

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(o => !o)}
        className="w-full flex items-center gap-2 px-3 py-2.5 border border-gray-200 rounded-xl text-sm bg-white focus:outline-none focus:ring-2 focus:ring-blue-500 transition hover:border-gray-300"
      >
        <Calendar className="w-4 h-4 text-gray-400 shrink-0" />
        <span className={displayLabel ? 'text-gray-800 flex-1 text-left' : 'text-gray-400 flex-1 text-left'}>
          {displayLabel ?? placeholder}
        </span>
        {value && (
          <span onClick={e => { e.stopPropagation(); onChange('') }}
            className="p-0.5 text-gray-400 hover:text-red-500 rounded">
            <X className="w-3.5 h-3.5" />
          </span>
        )}
      </button>

      {open && viewYear !== null && (
        <div className="absolute z-50 mt-1 bg-white border border-gray-100 rounded-2xl shadow-xl p-4 w-72">
          {mode === 'day' && (
            <>
              {/* Month/Year header */}
              <div className="flex items-center justify-between mb-3">
                <button type="button" onClick={() => {
                  if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) } else setViewMonth(m => m - 1)
                }} className="p-1.5 hover:bg-gray-100 rounded-lg transition">
                  <ChevronLeft className="w-4 h-4 text-gray-500" />
                </button>
                <div className="flex gap-1">
                  <button type="button" onClick={() => setMode('month')}
                    className="text-sm font-semibold text-gray-800 hover:text-blue-600 px-1 transition">
                    {MONTHS[viewMonth]}
                  </button>
                  <button type="button" onClick={() => setMode('year')}
                    className="text-sm font-semibold text-gray-800 hover:text-blue-600 px-1 transition">
                    {viewYear}
                  </button>
                </div>
                <button type="button" onClick={() => {
                  if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) } else setViewMonth(m => m + 1)
                }} className="p-1.5 hover:bg-gray-100 rounded-lg transition">
                  <ChevronRight className="w-4 h-4 text-gray-500" />
                </button>
              </div>

              {/* Day names */}
              <div className="grid grid-cols-7 mb-1">
                {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
                  <div key={d} className="text-center text-xs text-gray-400 font-medium py-1">{d}</div>
                ))}
              </div>

              {/* Days grid */}
              <div className="grid grid-cols-7 gap-0.5">
                {Array.from({ length: firstWeekday(viewYear, viewMonth) }).map((_, i) => (
                  <div key={`e-${i}`} />
                ))}
                {Array.from({ length: daysInMonth(viewYear, viewMonth) }, (_, i) => i + 1).map(d => (
                  <button
                    key={d}
                    type="button"
                    disabled={isDisabled(d)}
                    onClick={() => selectDay(d)}
                    className={`w-8 h-8 mx-auto flex items-center justify-center text-xs rounded-full transition-colors
                      ${isSelected(d) ? 'bg-blue-600 text-white font-bold' : ''}
                      ${!isSelected(d) && !isDisabled(d) ? 'text-gray-700 hover:bg-blue-50 hover:text-blue-700' : ''}
                      ${isDisabled(d) ? 'text-gray-300 cursor-not-allowed' : ''}
                    `}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </>
          )}

          {mode === 'month' && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-gray-800">Select Month</span>
                <button type="button" onClick={() => setMode('day')} className="text-xs text-blue-600 hover:underline">Back</button>
              </div>
              <div className="grid grid-cols-3 gap-2">
                {MONTHS.map((m, i) => (
                  <button key={m} type="button" onClick={() => { setViewMonth(i); setMode('day') }}
                    className={`py-2 text-xs rounded-xl font-medium transition-colors
                      ${i === viewMonth ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-blue-50 hover:text-blue-700'}
                    `}>
                    {m.slice(0, 3)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {mode === 'year' && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-semibold text-gray-800">Select Year</span>
                <button type="button" onClick={() => setMode('day')} className="text-xs text-blue-600 hover:underline">Back</button>
              </div>
              <div className="grid grid-cols-4 gap-1.5 max-h-48 overflow-y-auto">
                {yearRange.map(y => (
                  <button key={y} type="button" onClick={() => { setViewYear(y); setMode('day') }}
                    className={`py-1.5 text-xs rounded-lg font-medium transition-colors
                      ${y === viewYear ? 'bg-blue-600 text-white' : 'text-gray-700 hover:bg-blue-50 hover:text-blue-700'}
                    `}>
                    {y}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Password Input ───────────────────────────────────────────────────────────

function PasswordInput({ value, onChange, placeholder }) {
  const [show, setShow] = useState(false)
  return (
    <div className="relative">
      <input
        type={show ? 'text' : 'password'}
        className="w-full px-3 py-2.5 pr-10 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition bg-white placeholder:text-gray-400 text-gray-800"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
      <button type="button" onClick={() => setShow(v => !v)} tabIndex={-1}
        className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600">
        {show ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
      </button>
    </div>
  )
}

// ─── Upload Button ────────────────────────────────────────────────────────────

function UploadBtn({ token, onUploaded, accept = 'image/*,application/pdf', children }) {
  const ref              = useRef(null)
  const [busy, setBusy]  = useState(false)

  async function handleFile(file) {
    if (!file) return
    setBusy(true)
    try {
      const fd = new FormData()
      fd.append('file', file)
      const res  = await fetch(`/api/onboarding/upload?token=${token}`, { method: 'POST', body: fd })
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
    <button type="button" onClick={() => ref.current?.click()} disabled={busy}
      className="flex items-center gap-2 px-4 py-3 border-2 border-dashed border-gray-200 rounded-xl text-sm text-gray-400 hover:border-blue-400 hover:text-blue-600 hover:bg-blue-50/50 transition-all w-full justify-center disabled:opacity-50 group">
      {busy
        ? <Loader2 className="w-4 h-4 animate-spin" />
        : <Upload className="w-4 h-4 group-hover:scale-110 transition-transform" />}
      <span>{busy ? 'Uploading…' : children}</span>
      <input ref={ref} type="file" accept={accept} className="hidden"
        onChange={e => handleFile(e.target.files?.[0])} />
    </button>
  )
}

// ─── Field Wrapper ────────────────────────────────────────────────────────────

function Field({ label, required, hint, children }) {
  return (
    <div>
      <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-1.5">
        {label}{required && <span className="text-red-400 ml-0.5">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  )
}

const inputCls = 'w-full px-3 py-2.5 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition bg-white placeholder:text-gray-400 text-gray-800'

// ─── Main Component ───────────────────────────────────────────────────────────

export default function OnboardingPage() {
  const { token }                       = useParams()
  const [loading, setLoading]           = useState(true)
  const [prefill, setPrefill]           = useState(null)
  const [error, setError]               = useState(null)
  const [step, setStep]                 = useState(0)
  const [submitting, setSubmitting]     = useState(false)
  const [done, setDone]                 = useState(false)
  const [creds, setCreds]               = useState(null)

  const [form, setForm] = useState({
    name: '', email: '', phone: '', secondaryPhone: '', homePhone: '',
    dateOfBirth: '', nidNumber: '', nidUrl: '', address: '', emergencyContact: '',
    bloodGroup: '', photo: '', documents: [], password: '', confirmPassword: '',
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
      docs[i]    = { ...docs[i], [k]: v }
      return { ...f, documents: docs }
    })
  }

  function validateStep() {
    if (step === 0) {
      if (!form.name.trim())  { toast.error('Full name is required');     return false }
      if (!form.email.trim()) { toast.error('Email is required');         return false }
      if (!form.phone.trim()) { toast.error('Primary phone is required'); return false }
      if (form.password.length < 8) { toast.error('Password must be at least 8 characters'); return false }
      if (form.password !== form.confirmPassword) { toast.error('Passwords do not match'); return false }
    }
    if (step === 1) {
      if (!form.dateOfBirth)       { toast.error('Date of birth is required');           return false }
      if (!form.nidNumber.trim())  { toast.error('NID number is required');              return false }
      if (!form.nidUrl)            { toast.error('Please upload a copy of your NID');    return false }
      if (!form.address.trim())    { toast.error('Address is required');                 return false }
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
      const allDocs = [
        ...(form.nidUrl ? [{ url: form.nidUrl, type: 'NID', name: 'NID Copy' }] : []),
        ...form.documents,
      ]
      const res  = await fetch(`/api/onboarding/${token}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...form, password: form.password, documents: allDocs }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Submission failed')
      setCreds({ email: json.email })
      setDone(true)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSubmitting(false)
    }
  }

  // ── Loading ──────────────────────────────────────────────────────────────────
  if (loading) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3">
        <Loader2 className="w-8 h-8 text-blue-500 animate-spin" />
        <p className="text-sm text-gray-400">Loading your onboarding form…</p>
      </div>
    </div>
  )

  // ── Error ────────────────────────────────────────────────────────────────────
  if (error) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 max-w-sm w-full text-center">
        <div className="w-14 h-14 bg-red-50 rounded-2xl flex items-center justify-center mx-auto mb-4">
          <AlertCircle className="w-7 h-7 text-red-400" />
        </div>
        <h2 className="text-base font-semibold text-gray-800 mb-1">Link Error</h2>
        <p className="text-sm text-gray-500">{error}</p>
      </div>
    </div>
  )

  // ── Done ─────────────────────────────────────────────────────────────────────
  if (done) return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4">
      <Toaster position="top-center" />
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-8 max-w-sm w-full text-center">
        <div className="w-16 h-16 bg-green-50 rounded-2xl flex items-center justify-center mx-auto mb-5">
          <CheckCircle className="w-8 h-8 text-green-500" />
        </div>
        <h2 className="text-xl font-bold text-gray-800 mb-1">You're all set!</h2>
        <p className="text-sm text-gray-500 mb-6">
          Your information was submitted successfully. Your account is ready.
        </p>
        {creds && (
          <div className="bg-gray-50 border border-gray-100 rounded-xl p-4 text-left">
            <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Your Login</p>
            <div>
              <p className="text-xs text-gray-400 mb-0.5">Email</p>
              <p className="text-sm font-medium text-gray-800 break-all">{creds.email}</p>
            </div>
            <div className="mt-2 pt-2 border-t border-gray-100 flex items-start gap-2">
              <CheckCircle className="w-3.5 h-3.5 text-green-500 shrink-0 mt-0.5" />
              <p className="text-xs text-green-700">Use the password you set during onboarding to sign in.</p>
            </div>
          </div>
        )}
        <p className="text-xs text-gray-400 mt-4">HR will complete your employment details shortly.</p>
      </div>
    </div>
  )

  const StepIcon = STEPS[step].icon

  // ── Main Form ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center p-4 py-8">
      <Toaster position="top-center" />
      <div className="bg-white rounded-2xl border border-gray-100 shadow-sm w-full max-w-lg flex flex-col" style={{ maxHeight: 'calc(100vh - 4rem)' }}>

        {/* Header */}
        <div className="px-6 py-5 border-b border-gray-50 shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-blue-600 rounded-xl flex items-center justify-center shrink-0">
              <StepIcon className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-base font-bold text-gray-900">Employee Onboarding</h1>
              <p className="text-xs text-gray-400 mt-0.5">Please fill in your information accurately</p>
            </div>
          </div>
        </div>

        {/* Stepper */}
        <div className="flex px-6 pt-4 pb-2 gap-2 shrink-0">
          {STEPS.map((s, i) => (
            <div key={s.label} className="flex-1 flex flex-col items-center gap-1">
              <div className={`w-full h-1 rounded-full transition-colors ${
                i < step ? 'bg-green-400' : i === step ? 'bg-blue-500' : 'bg-gray-100'
              }`} />
              <span className={`text-xs font-medium transition-colors hidden sm:block ${
                i === step ? 'text-blue-600' : i < step ? 'text-green-600' : 'text-gray-400'
              }`}>
                {i < step ? '✓ ' : ''}{s.label}
              </span>
            </div>
          ))}
        </div>

        {/* Step label for mobile */}
        <div className="px-6 pb-3 shrink-0 sm:hidden">
          <p className="text-xs font-semibold text-blue-600">Step {step + 1} of {STEPS.length}: {STEPS[step].label}</p>
        </div>

        {/* Form body — scrollable */}
        <div className="px-6 pb-4 space-y-4 overflow-y-auto flex-1 pt-2">

          {/* ── Step 0: Personal Info ───────────────────────────────────── */}
          {step === 0 && <>
            <Field label="Full Name" required hint="As it appears on your NID">
              <input className={inputCls} placeholder="e.g. Mohammad Rahman" value={form.name}
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
            <div className="pt-2 border-t border-gray-100">
              <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-3">Set Your Password</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Password" required hint="Min. 8 characters">
                  <PasswordInput value={form.password} onChange={v => set('password', v)} placeholder="Create password" />
                </Field>
                <Field label="Confirm Password" required>
                  <PasswordInput value={form.confirmPassword} onChange={v => set('confirmPassword', v)} placeholder="Repeat password" />
                </Field>
              </div>
            </div>
          </>}

          {/* ── Step 1: Contact & Address ───────────────────────────────── */}
          {step === 1 && <>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Date of Birth" required>
                <CalendarPicker
                  value={form.dateOfBirth}
                  onChange={v => set('dateOfBirth', v)}
                  placeholder="Select date"
                  maxDate={new Date().toISOString().slice(0, 10)}
                />
              </Field>
              <Field label="Blood Group">
                <Dropdown
                  value={form.bloodGroup}
                  onChange={v => set('bloodGroup', v)}
                  options={BLOOD_GROUPS}
                  placeholder="Select"
                />
              </Field>
            </div>
            <Field label="NID Number" required>
              <input className={inputCls} placeholder="National ID number" value={form.nidNumber}
                onChange={e => set('nidNumber', e.target.value)} />
            </Field>
            <Field label="NID Copy (front & back)" required hint="JPG, PNG or PDF · max 10 MB">
              {form.nidUrl ? (
                <div className="flex items-center gap-2 p-3 border border-green-100 rounded-xl bg-green-50/70">
                  <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4 text-green-600" />
                  </div>
                  <a href={form.nidUrl} target="_blank" rel="noopener noreferrer"
                    className="flex-1 text-xs font-medium text-green-700 hover:underline truncate">
                    {form.nidUrl.split('/').pop()}
                  </a>
                  <button type="button" onClick={() => set('nidUrl', '')}
                    className="p-1 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition">
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <UploadBtn token={token} accept="image/*,application/pdf" onUploaded={url => set('nidUrl', url)}>
                  Upload NID scan / photo
                </UploadBtn>
              )}
            </Field>
            <Field label="Current Address" required>
              <textarea className={inputCls} rows={2} placeholder="House, Road, Area, City" value={form.address}
                onChange={e => set('address', e.target.value)} />
            </Field>
            <Field label="Emergency Contact" hint="Name and phone number of someone we can contact">
              <input className={inputCls} placeholder="e.g. Rafiq (Father) · 01711..." value={form.emergencyContact}
                onChange={e => set('emergencyContact', e.target.value)} />
            </Field>
          </>}

          {/* ── Step 2: Photo & Documents ───────────────────────────────── */}
          {step === 2 && <>
            <Field label="Formal Photo" required hint="Clear face, plain background. Used for your employee ID card.">
              {form.photo ? (
                <div className="flex items-center gap-3 p-3 border border-green-100 rounded-xl bg-green-50/70">
                  <Image src={form.photo} alt="photo" width={56} height={56}
                    className="w-14 h-14 object-cover rounded-xl border border-green-200 shrink-0" />
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-semibold text-green-700">Photo uploaded</p>
                    <p className="text-xs text-gray-400 truncate mt-0.5">{form.photo.split('/').pop()}</p>
                  </div>
                  <button type="button" onClick={() => set('photo', '')}
                    className="p-1 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <UploadBtn token={token} accept="image/*" onUploaded={url => set('photo', url)}>
                  Upload formal photo (JPG, PNG)
                </UploadBtn>
              )}
            </Field>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                  Additional Documents
                </label>
                <UploadBtn token={token} accept="image/*,application/pdf" onUploaded={addDoc}>
                  <span className="text-xs font-medium">+ Add</span>
                </UploadBtn>
              </div>
              {form.documents.length === 0 ? (
                <div className="text-center py-5 border border-dashed border-gray-200 rounded-xl">
                  <FileText className="w-6 h-6 text-gray-300 mx-auto mb-1.5" />
                  <p className="text-xs text-gray-400">No documents added yet</p>
                  <p className="text-xs text-gray-300 mt-0.5">CV, passport, birth certificate, etc.</p>
                </div>
              ) : (
                <div className="space-y-2">
                  {form.documents.map((doc, i) => (
                    <div key={i} className="flex items-center gap-2 p-2.5 border border-gray-100 rounded-xl bg-gray-50/70">
                      <div className="w-7 h-7 bg-gray-100 rounded-lg flex items-center justify-center shrink-0">
                        <FileText className="w-3.5 h-3.5 text-gray-400" />
                      </div>
                      <a href={doc.url} target="_blank" rel="noopener noreferrer"
                        className="flex-1 text-xs text-blue-600 hover:underline truncate min-w-0">
                        {doc.url.split('/').pop()}
                      </a>
                      <Dropdown
                        value={doc.type}
                        onChange={v => setDocField(i, 'type', v)}
                        options={DOC_TYPES}
                        className="w-32 shrink-0"
                      />
                      <button type="button" onClick={() => removeDoc(i)}
                        className="p-1 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50 transition shrink-0">
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </>}
        </div>

        {/* Footer */}
        <div className="px-6 py-4 border-t border-gray-50 flex items-center justify-between gap-3 shrink-0">
          <button type="button" onClick={() => setStep(s => s - 1)} disabled={step === 0}
            className="flex items-center gap-1.5 px-4 py-2.5 text-sm text-gray-600 border border-gray-200 rounded-xl hover:bg-gray-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors font-medium">
            <ChevronLeft className="w-4 h-4" /> Back
          </button>

          {/* Progress dots */}
          <div className="flex gap-1.5">
            {STEPS.map((_, i) => (
              <div key={i} className={`w-1.5 h-1.5 rounded-full transition-colors ${
                i === step ? 'bg-blue-500 w-4' : i < step ? 'bg-green-400' : 'bg-gray-200'
              }`} />
            ))}
          </div>

          {step < STEPS.length - 1 ? (
            <button type="button" onClick={() => { if (validateStep()) setStep(s => s + 1) }}
              className="flex items-center gap-1.5 px-5 py-2.5 text-sm text-white bg-blue-600 rounded-xl hover:bg-blue-700 transition-colors font-medium">
              Next <ChevronRight className="w-4 h-4" />
            </button>
          ) : (
            <button type="button" onClick={handleSubmit} disabled={submitting}
              className="flex items-center gap-1.5 px-5 py-2.5 text-sm text-white bg-gray-900 rounded-xl hover:bg-black disabled:opacity-50 transition-colors font-medium">
              {submitting ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle className="w-4 h-4" />}
              {submitting ? 'Submitting…' : 'Submit'}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
