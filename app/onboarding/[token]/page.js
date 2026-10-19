'use client'

import { Fragment, useEffect, useState, useRef } from 'react'
import Image from 'next/image'
import { useParams } from 'next/navigation'
import {
  Upload, X, FileText, Loader2, CheckCircle2, AlertCircle, Check,
  ChevronRight, ChevronLeft, ChevronDown, Calendar,
  Eye, EyeOff, Plus,
} from 'lucide-react'
import toast, { Toaster } from 'react-hot-toast'
import { dhakaDayKey } from '@/lib/dhakaTime'
import { cn } from '@/lib/utils'
import Button, { buttonVariants } from '@/components/ui/Button'
import { Card, CardHeader, CardTitle, CardAction, CardContent, CardFooter } from '@/components/ui/Card'
import { Input, Textarea, Field, inputClass } from '@/components/ui/Input'
import LoadingSpinner from '@/components/ui/LoadingSpinner'

// ─── Constants ────────────────────────────────────────────────────────────────

const BLOOD_GROUPS = ['A+', 'A-', 'B+', 'B-', 'AB+', 'AB-', 'O+', 'O-']
const DOC_TYPES = [
  { value: 'NID',               label: 'NID' },
  { value: 'BIRTH_CERTIFICATE', label: 'Birth certificate' },
  { value: 'CV',                label: 'CV / resume' },
  { value: 'PASSPORT',          label: 'Passport' },
  { value: 'ACADEMIC',          label: 'Academic certificate' },
  { value: 'OTHER',             label: 'Other' },
]
const STEPS = [
  { label: 'Personal info' },
  { label: 'Contact & address' },
  { label: 'Photo & documents' },
]
const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December']

// ─── Brand mark ───────────────────────────────────────────────────────────────

function Brand({ className }) {
  return (
    <Image
      src="/en-logo.png"
      alt="Enfinito"
      width={112}
      height={26}
      priority
      className={cn('h-6 w-auto object-contain', className)}
    />
  )
}

// ─── Status icon tile ─────────────────────────────────────────────────────────

function IconTile({ children }) {
  return (
    <div className="mx-auto flex size-10 items-center justify-center rounded-lg border border-gray-200/80 bg-white shadow-xs">
      {children}
    </div>
  )
}

// ─── Stepper ──────────────────────────────────────────────────────────────────

function Stepper({ step, className }) {
  return (
    <ol className={cn('flex items-center gap-2', className)}>
      {STEPS.map((s, i) => {
        const isDone   = i < step
        const isActive = i === step
        return (
          <Fragment key={s.label}>
            <li className="flex shrink-0 items-center gap-2">
              <span
                className={cn(
                  'flex size-7 items-center justify-center rounded-full text-xs font-medium transition-colors',
                  isDone || isActive
                    ? 'bg-gray-900 text-white'
                    : 'border border-gray-200 bg-white text-gray-500'
                )}
              >
                {isDone ? <Check className="size-4" /> : i + 1}
              </span>
              <span
                className={cn(
                  'text-sm',
                  isActive ? 'font-medium text-gray-900' : 'hidden text-gray-500 sm:inline',
                  isDone && 'text-gray-700'
                )}
              >
                {s.label}
              </span>
            </li>
            {i < STEPS.length - 1 && <li aria-hidden className="h-px min-w-4 flex-1 bg-gray-200" />}
          </Fragment>
        )
      })}
    </ol>
  )
}

// ─── Custom Dropdown ──────────────────────────────────────────────────────────

function Dropdown({ value, onChange, options, placeholder = 'Select…', className = '' }) {
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
        className={cn(inputClass, 'cursor-pointer items-center justify-between gap-2 text-left')}
      >
        <span className={cn('truncate', label ? 'text-gray-900' : 'text-gray-400')}>{label ?? placeholder}</span>
        <ChevronDown className={cn('size-4 shrink-0 text-gray-400 transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div className="absolute z-50 mt-1 max-h-52 w-full min-w-[8rem] overflow-y-auto rounded-lg border border-gray-200/80 bg-white p-1 shadow-lg">
          {options.map(opt => {
            const v = typeof opt === 'string' ? opt : opt.value
            const l = typeof opt === 'string' ? opt : opt.label
            return (
              <button
                key={v}
                type="button"
                onClick={() => { onChange(v); setOpen(false) }}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
                  v === value ? 'bg-gray-100 font-medium text-gray-900' : 'text-gray-700 hover:bg-gray-100'
                )}
              >
                {l}
                {v === value && <Check className="size-4 shrink-0 text-gray-900" />}
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
        className={cn(inputClass, 'cursor-pointer items-center gap-2 text-left')}
      >
        <Calendar className="size-4 shrink-0 text-gray-400" />
        <span className={cn('flex-1 truncate text-left', displayLabel ? 'text-gray-900' : 'text-gray-400')}>
          {displayLabel ?? placeholder}
        </span>
        {value && (
          <span onClick={e => { e.stopPropagation(); onChange('') }}
            className="rounded p-0.5 text-gray-400 hover:text-gray-700">
            <X className="size-4" />
          </span>
        )}
      </button>

      {open && viewYear !== null && (
        <div className="absolute z-50 mt-1 w-72 rounded-xl border border-gray-200/80 bg-white p-3 shadow-lg">
          {mode === 'day' && (
            <>
              {/* Month/Year header */}
              <div className="mb-2 flex items-center justify-between">
                <Button variant="ghost" size="icon-xs" aria-label="Previous month" onClick={() => {
                  if (viewMonth === 0) { setViewMonth(11); setViewYear(y => y - 1) } else setViewMonth(m => m - 1)
                }}>
                  <ChevronLeft />
                </Button>
                <div className="flex gap-0.5">
                  <button type="button" onClick={() => setMode('month')}
                    className="rounded-md px-1.5 py-0.5 text-sm font-medium text-gray-900 transition-colors hover:bg-gray-100">
                    {MONTHS[viewMonth]}
                  </button>
                  <button type="button" onClick={() => setMode('year')}
                    className="rounded-md px-1.5 py-0.5 text-sm font-medium text-gray-900 tabular-nums transition-colors hover:bg-gray-100">
                    {viewYear}
                  </button>
                </div>
                <Button variant="ghost" size="icon-xs" aria-label="Next month" onClick={() => {
                  if (viewMonth === 11) { setViewMonth(0); setViewYear(y => y + 1) } else setViewMonth(m => m + 1)
                }}>
                  <ChevronRight />
                </Button>
              </div>

              {/* Day names */}
              <div className="mb-1 grid grid-cols-7">
                {['Su','Mo','Tu','We','Th','Fr','Sa'].map(d => (
                  <div key={d} className="py-1 text-center text-xs font-medium text-gray-400">{d}</div>
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
                    className={cn(
                      'mx-auto flex size-8 items-center justify-center rounded-md text-xs tabular-nums transition-colors',
                      isSelected(d) && 'bg-gray-900 font-medium text-white',
                      !isSelected(d) && !isDisabled(d) && 'text-gray-700 hover:bg-gray-100 hover:text-gray-900',
                      isDisabled(d) && 'cursor-not-allowed text-gray-300'
                    )}
                  >
                    {d}
                  </button>
                ))}
              </div>
            </>
          )}

          {mode === 'month' && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-900">Select month</span>
                <Button variant="ghost" size="xs" onClick={() => setMode('day')}>Back</Button>
              </div>
              <div className="grid grid-cols-3 gap-1.5">
                {MONTHS.map((m, i) => (
                  <button key={m} type="button" onClick={() => { setViewMonth(i); setMode('day') }}
                    className={cn(
                      'rounded-md py-2 text-xs font-medium transition-colors',
                      i === viewMonth ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                    )}>
                    {m.slice(0, 3)}
                  </button>
                ))}
              </div>
            </div>
          )}

          {mode === 'year' && (
            <div>
              <div className="mb-2 flex items-center justify-between">
                <span className="text-sm font-medium text-gray-900">Select year</span>
                <Button variant="ghost" size="xs" onClick={() => setMode('day')}>Back</Button>
              </div>
              <div className="grid max-h-48 grid-cols-4 gap-1.5 overflow-y-auto">
                {yearRange.map(y => (
                  <button key={y} type="button" onClick={() => { setViewYear(y); setMode('day') }}
                    className={cn(
                      'rounded-md py-1.5 text-xs font-medium tabular-nums transition-colors',
                      y === viewYear ? 'bg-gray-900 text-white' : 'text-gray-700 hover:bg-gray-100 hover:text-gray-900'
                    )}>
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
      <Input
        type={show ? 'text' : 'password'}
        className="pr-9"
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
      <button type="button" onClick={() => setShow(v => !v)} tabIndex={-1}
        aria-label={show ? 'Hide password' : 'Show password'}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700">
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  )
}

// ─── Upload Button ────────────────────────────────────────────────────────────

function UploadBtn({ token, onUploaded, accept = 'image/*,application/pdf', compact = false, children }) {
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

  const Icon = compact ? Plus : Upload

  return (
    <button type="button" onClick={() => ref.current?.click()} disabled={busy}
      className={compact
        ? buttonVariants({ variant: 'outline', size: 'xs' })
        : 'flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-dashed border-gray-300 bg-white px-3 text-sm font-medium text-gray-600 transition-colors hover:border-gray-400 hover:bg-gray-50 hover:text-gray-900 disabled:pointer-events-none disabled:opacity-50'}>
      {busy
        ? <Loader2 className="size-4 animate-spin" />
        : <Icon className="size-4" />}
      <span>{busy ? 'Uploading…' : children}</span>
      <input ref={ref} type="file" accept={accept} className="hidden"
        onChange={e => {
          const file = e.target.files?.[0]
          e.target.value = '' // allow picking the same file again later
          handleFile(file)
        }} />
    </button>
  )
}

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
    dateOfBirth: '', nidNumber: '', nidUrl: '', address: '',
    emergencyContacts: [{ name: '', relation: '', phone: '' }],
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
    <div className="flex min-h-screen items-center justify-center bg-gray-50 p-4">
      <LoadingSpinner size="lg" />
    </div>
  )

  // ── Error ────────────────────────────────────────────────────────────────────
  if (error) return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-gray-50 p-4">
      <Brand />
      <Card className="w-full max-w-sm p-6 text-center">
        <IconTile><AlertCircle className="size-5 text-red-600" /></IconTile>
        <h2 className="mt-4 text-base font-semibold text-gray-900">Link unavailable</h2>
        <p className="mt-1 text-sm text-muted-foreground">{error}</p>
      </Card>
    </div>
  )

  // ── Done ─────────────────────────────────────────────────────────────────────
  if (done) return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-8 bg-gray-50 p-4">
      <Toaster position="top-center" />
      <Brand />
      <Card className="w-full max-w-sm p-6 text-center">
        <IconTile><CheckCircle2 className="size-5 text-emerald-600" /></IconTile>
        <h2 className="mt-4 text-base font-semibold text-gray-900">You're all set</h2>
        <p className="mt-1 text-sm text-muted-foreground">Sign in with the password you just set.</p>
        {creds && (
          <div className="mt-5 rounded-lg bg-gray-50 px-3 py-2.5 text-left">
            <p className="text-xs text-muted-foreground">Sign-in email</p>
            <p className="mt-0.5 break-all text-sm font-medium text-gray-900">{creds.email}</p>
          </div>
        )}
      </Card>
    </div>
  )

  // ── Main Form ─────────────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen bg-gray-50">
      <Toaster position="top-center" />
      <div className="mx-auto max-w-2xl px-4 py-10 sm:py-16">
        <Brand />
        <h1 className="mt-8 text-lg font-semibold tracking-tight text-gray-900">Employee onboarding</h1>

        <Stepper step={step} className="mt-5" />

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>{STEPS[step].label}</CardTitle>
            <CardAction>
              <span className="text-xs text-muted-foreground tabular-nums">Step {step + 1} of {STEPS.length}</span>
            </CardAction>
          </CardHeader>

          <CardContent>
            {/* ── Step 0: Personal info ───────────────────────────────────── */}
            {step === 0 && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Full name" required hint="As it appears on your NID" className="sm:col-span-2">
                  <Input placeholder="e.g. Mohammad Rahman" value={form.name}
                    onChange={e => set('name', e.target.value)} />
                </Field>
                <Field label="Email" required className="sm:col-span-2">
                  {/* The invited address is fixed — the account is created for that email only. */}
                  <Input type="email" placeholder="you@example.com" value={form.email}
                    readOnly={!!prefill?.email}
                    className={prefill?.email ? 'bg-gray-50 text-gray-600' : undefined}
                    onChange={e => set('email', e.target.value)} />
                </Field>
                <Field label="Primary phone" required>
                  <Input placeholder="+880…" value={form.phone}
                    onChange={e => set('phone', e.target.value)} />
                </Field>
                <Field label="Secondary phone">
                  <Input placeholder="+880…" value={form.secondaryPhone}
                    onChange={e => set('secondaryPhone', e.target.value)} />
                </Field>
                <Field label="Home phone">
                  <Input placeholder="+880…" value={form.homePhone}
                    onChange={e => set('homePhone', e.target.value)} />
                </Field>

                <div aria-hidden className="border-t border-gray-100 sm:col-span-2" />

                <Field label="Password" required hint="At least 8 characters">
                  <PasswordInput value={form.password} onChange={v => set('password', v)} placeholder="Create password" />
                </Field>
                <Field label="Confirm password" required>
                  <PasswordInput value={form.confirmPassword} onChange={v => set('confirmPassword', v)} placeholder="Repeat password" />
                </Field>
              </div>
            )}

            {/* ── Step 1: Contact & address ───────────────────────────────── */}
            {step === 1 && (
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Date of birth" required>
                  <CalendarPicker
                    value={form.dateOfBirth}
                    onChange={v => set('dateOfBirth', v)}
                    placeholder="Select date"
                    maxDate={dhakaDayKey()}
                  />
                </Field>
                <Field label="Blood group">
                  <Dropdown
                    value={form.bloodGroup}
                    onChange={v => set('bloodGroup', v)}
                    options={BLOOD_GROUPS}
                    placeholder="Select…"
                  />
                </Field>
                <Field label="NID number" required className="sm:col-span-2">
                  <Input placeholder="National ID number" value={form.nidNumber}
                    onChange={e => set('nidNumber', e.target.value)} />
                </Field>
                <Field label="NID copy (front & back)" required hint="JPG, PNG or PDF, max 10 MB" className="sm:col-span-2">
                  {form.nidUrl ? (
                    <div className="flex items-center gap-2.5 rounded-lg border border-gray-200/80 bg-white py-1.5 pl-3 pr-1.5">
                      <FileText className="size-4 shrink-0 text-gray-500" />
                      <a href={form.nidUrl} target="_blank" rel="noopener noreferrer"
                        className="min-w-0 flex-1 truncate text-sm font-medium text-gray-900 underline-offset-4 hover:underline">
                        {form.nidUrl.split('/').pop()}
                      </a>
                      <CheckCircle2 className="size-4 shrink-0 text-emerald-600" />
                      <Button variant="ghost" size="icon-xs" aria-label="Remove NID copy" onClick={() => set('nidUrl', '')}>
                        <X />
                      </Button>
                    </div>
                  ) : (
                    <UploadBtn token={token} accept="image/*,application/pdf" onUploaded={url => set('nidUrl', url)}>
                      Upload NID
                    </UploadBtn>
                  )}
                </Field>
                <Field label="Current address" required className="sm:col-span-2">
                  <Textarea rows={2} className="min-h-0" placeholder="House, road, area, city" value={form.address}
                    onChange={e => set('address', e.target.value)} />
                </Field>

                <div className="space-y-2 sm:col-span-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-gray-900">Emergency contacts</p>
                    <Button variant="ghost" size="xs"
                      onClick={() => set('emergencyContacts', [...(form.emergencyContacts ?? []), { name: '', relation: '', phone: '' }])}>
                      <Plus /> Add contact
                    </Button>
                  </div>
                  {(form.emergencyContacts ?? []).map((c, i) => (
                    <div key={i} className="space-y-2 rounded-lg border border-gray-200/80 p-3">
                      {(form.emergencyContacts ?? []).length > 1 && (
                        <div className="flex items-center justify-between">
                          <span className="text-xs font-medium text-muted-foreground">Contact {i + 1}</span>
                          <Button variant="ghost" size="icon-xs" aria-label={`Remove contact ${i + 1}`}
                            onClick={() => set('emergencyContacts', form.emergencyContacts.filter((_, j) => j !== i))}>
                            <X />
                          </Button>
                        </div>
                      )}
                      <div className="grid gap-2 sm:grid-cols-3">
                        <Input placeholder="Name" value={c.name}
                          onChange={e => { const updated = [...form.emergencyContacts]; updated[i] = { ...c, name: e.target.value }; set('emergencyContacts', updated) }} />
                        <Input placeholder="Relation" value={c.relation}
                          onChange={e => { const updated = [...form.emergencyContacts]; updated[i] = { ...c, relation: e.target.value }; set('emergencyContacts', updated) }} />
                        <Input placeholder="Phone" value={c.phone}
                          onChange={e => { const updated = [...form.emergencyContacts]; updated[i] = { ...c, phone: e.target.value }; set('emergencyContacts', updated) }} />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* ── Step 2: Photo & documents ───────────────────────────────── */}
            {step === 2 && (
              <div className="grid gap-6">
                <Field label="Formal photo" required hint="Clear face, plain background">
                  {form.photo ? (
                    <div className="flex items-center gap-3 rounded-lg border border-gray-200/80 bg-white p-2.5 pr-1.5">
                      <Image src={form.photo} alt="photo" width={56} height={56}
                        className="size-12 shrink-0 rounded-md border border-gray-200/80 object-cover" />
                      <div className="min-w-0 flex-1">
                        <p className="flex items-center gap-1.5 text-sm font-medium text-gray-900">
                          <CheckCircle2 className="size-4 shrink-0 text-emerald-600" /> Photo uploaded
                        </p>
                        <p className="mt-0.5 truncate text-xs text-muted-foreground">{form.photo.split('/').pop()}</p>
                      </div>
                      <Button variant="ghost" size="icon-xs" aria-label="Remove photo" onClick={() => set('photo', '')}>
                        <X />
                      </Button>
                    </div>
                  ) : (
                    <UploadBtn token={token} accept="image/*" onUploaded={url => set('photo', url)}>
                      Upload photo
                    </UploadBtn>
                  )}
                </Field>

                <div className="space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-sm font-medium text-gray-900">Additional documents</p>
                    <UploadBtn token={token} accept="image/*,application/pdf" onUploaded={addDoc} compact>
                      Add
                    </UploadBtn>
                  </div>
                  {form.documents.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-gray-200 py-6 text-center">
                      <FileText className="mx-auto size-5 text-gray-400" />
                      <p className="mt-2 text-sm text-gray-600">No documents yet</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">CV, passport, certificates, etc.</p>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      {form.documents.map((doc, i) => (
                        <div key={i} className="flex items-center gap-2.5 rounded-lg border border-gray-200/80 bg-white py-1.5 pl-3 pr-1.5">
                          <FileText className="size-4 shrink-0 text-gray-500" />
                          <a href={doc.url} target="_blank" rel="noopener noreferrer"
                            className="min-w-0 flex-1 truncate text-sm text-gray-900 underline-offset-4 hover:underline">
                            {doc.url.split('/').pop()}
                          </a>
                          <Dropdown
                            value={doc.type}
                            onChange={v => setDocField(i, 'type', v)}
                            options={DOC_TYPES}
                            className="w-40 shrink-0"
                          />
                          <Button variant="ghost" size="icon-xs" aria-label="Remove document" onClick={() => removeDoc(i)}>
                            <X />
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </CardContent>

          <CardFooter className="justify-between">
            <Button variant="outline" onClick={() => setStep(s => s - 1)} disabled={step === 0}>
              <ChevronLeft /> Back
            </Button>

            {step < STEPS.length - 1 ? (
              <Button onClick={() => { if (validateStep()) setStep(s => s + 1) }}>
                Next <ChevronRight />
              </Button>
            ) : (
              <Button onClick={handleSubmit} loading={submitting}>
                {!submitting && <Check />}
                {submitting ? 'Submitting…' : 'Submit'}
              </Button>
            )}
          </CardFooter>
        </Card>
      </div>
    </div>
  )
}
