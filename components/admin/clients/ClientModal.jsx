'use client'

import { useState, useEffect, useRef } from 'react'
import { X, Plus, Trash2, Globe, Facebook, Instagram, Linkedin, Twitter, Youtube, Link2, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import FileUpload from '@/components/ui/FileUpload'
import Select from '@/components/ui/Select'
import TaxCodeSelect from '@/components/tax/TaxCodeSelect'
import Button from '@/components/ui/Button'
import Tabs from '@/components/ui/Tabs'
import { Input, Textarea, NativeSelect, Label, Field, inputClass } from '@/components/ui/Input'
import { cn } from '@/lib/utils'
import { BIN_REGEX, TIN_REGEX, normalizeBin } from '@/lib/tax/catalog'

const VAT_REGISTRATION_TYPES = [
  { value: 'REGISTERED',   label: 'VAT registered (has BIN)' },
  { value: 'TURNOVER',     label: 'Turnover tax enlisted' },
  { value: 'UNREGISTERED', label: 'Not VAT registered' },
  { value: 'FOREIGN',      label: 'Foreign / overseas' },
]

// Masked placeholders from the API ('••••••••9012') — never validated or re-sent.
const isMaskedValue = v => typeof v === 'string' && v.includes('••')
const binDigits = v => String(v ?? '').replace(/\s+/g, '')
const tinDigits = v => String(v ?? '').replace(/[\s-]+/g, '')

/** Normalised BIN ('' when blank) or null when invalid. */
function cleanBin(v) {
  const s = binDigits(v)
  if (!s) return ''
  if (!BIN_REGEX.test(s)) return null
  return normalizeBin(s) || s
}

/** Normalised TIN ('' when blank) or null when invalid. */
function cleanTin(v) {
  const s = tinDigits(v)
  if (!s) return ''
  return TIN_REGEX.test(s) ? s : null
}

/** Tax-identity part of the request body, normalised so edits can be diffed. */
function taxBody(f) {
  const bin = cleanBin(f.bin)
  const tin = isMaskedValue(f.tin) ? f.tin : cleanTin(f.tin)
  return {
    bin:                 bin || null,
    tin:                 tin || null,
    vatRegistrationType: f.vatRegistrationType || null,
    isVdsEntity:         !!f.isVdsEntity,
    isTdsEntity:         !!f.isTdsEntity,
    // The section only applies while the client deducts TDS.
    defaultTdsSection:   f.isTdsEntity ? (f.defaultTdsSection || null) : null,
    taxNotes:            f.taxNotes?.trim() || null,
  }
}

/** First field-level message from a 422 { details: zod.flatten() } response. */
function firstValidationMessage(json) {
  const fe = json?.details?.fieldErrors
  if (fe && typeof fe === 'object') {
    for (const msgs of Object.values(fe)) {
      if (Array.isArray(msgs) && msgs.length) return msgs[0]
    }
  }
  return null
}

const SOCIAL_PLATFORMS = [
  { value: 'facebook',  label: 'Facebook',  Icon: Facebook },
  { value: 'instagram', label: 'Instagram', Icon: Instagram },
  { value: 'linkedin',  label: 'LinkedIn',  Icon: Linkedin },
  { value: 'twitter',   label: 'Twitter/X', Icon: Twitter },
  { value: 'youtube',   label: 'YouTube',   Icon: Youtube },
  { value: 'website',   label: 'Website',   Icon: Globe },
  { value: 'other',     label: 'Other',     Icon: Globe},
]

const INDUSTRIES = [
  'Technology', 'E-Commerce', 'Healthcare', 'Education', 'Finance',
  'Real Estate', 'Manufacturing', 'Retail', 'Media & Entertainment',
  'Food & Beverage', 'Travel & Tourism', 'Fashion & Apparel',
  'Construction', 'Logistics', 'NGO / Non-profit', 'Government', 'Other',
]

const COUNTRIES = ['Bangladesh', 'India', 'USA', 'UK', 'Canada', 'Australia', 'UAE', 'Singapore', 'Germany', 'France', 'Other']

const BUSINESS_TYPES = [
  'Sole Proprietorship', 'Partnership', 'Private Limited (Pvt. Ltd.)',
  'Public Limited (Ltd.)', 'LLC', 'LLP', 'One Person Company (OPC)',
  'NGO / Non-profit', 'Government / Public Sector', 'Cooperative', 'Other',
]

const EMPTY = {
  clientType: 'COMPANY',
  // Company info
  company: '', companyPhone: '', companyEmail: '', businessType: '', industry: '',
  vatNumber: '', website: '', logo: '',
  // Concerned person
  name: '', email: '', phone: '', designation: '',
  contactPerson: '',
  // Other
  priority: 'MEDIUM', altPhone: '', timezone: 'Asia/Dhaka',
  address: '', city: '', country: 'Bangladesh',
  socialLinks: [], notes: '',
  // Tax identity
  bin: '', tin: '', vatRegistrationType: '', isVdsEntity: false, isTdsEntity: false,
  defaultTdsSection: '', taxNotes: '',
  _binFromLegacy: false,  // BIN pre-filled from the legacy vatNumber (display only)
  // Portfolio link
  parentClientId: null,   // _id of the "owner" client (individual or primary company)
  _parentLabel: '',       // display label, not sent to API
}

// ─── Parent client search dropdown ───────────────────────────────────────────

// onChange(id, label, { name, email, phone }) — passes contact info so form can auto-fill
function ParentClientSearch({ value, label, onChange }) {
  const [query,   setQuery]   = useState('')
  const [results, setResults] = useState([])
  const [open,    setOpen]    = useState(false)
  const [loading, setLoading] = useState(false)
  const ref = useRef(null)

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false) }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [])

  useEffect(() => {
    if (!query.trim()) { setResults([]); return }
    setLoading(true)
    const t = setTimeout(async () => {
      const res  = await fetch(`/api/clients?search=${encodeURIComponent(query)}&limit=8`)
      const json = await res.json()
      setResults(json.data ?? [])
      setLoading(false)
    }, 300)
    return () => clearTimeout(t)
  }, [query])

  function select(c) {
    const displayName = c.clientType === 'COMPANY' ? (c.company || c.userId?.name) : c.userId?.name
    onChange(c._id ?? c.id, `${displayName} · ${c.clientCode}`, {
      name:  c.userId?.name  ?? '',
      email: c.userId?.email ?? '',
      phone: c.userId?.phone ?? '',
    })
    setQuery('')
    setResults([])
    setOpen(false)
  }

  function clear() { onChange(null, '', null); setQuery('') }

  if (value) {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-gray-200/80 bg-gray-50 px-3 py-1.5">
        <Link2 className="size-4 shrink-0 text-gray-500" />
        <span className="flex-1 text-sm font-medium text-gray-900">{label}</span>
        <Button variant="ghost" size="icon-xs" onClick={clear} className="text-gray-400" aria-label="Unlink">
          <X />
        </Button>
      </div>
    )
  }

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder="Search clients…"
          className={cn(inputClass, 'pl-9')}
        />
      </div>
      {open && (query || results.length > 0) && (
        <div className="absolute left-0 right-0 top-full z-30 mt-1 max-h-48 overflow-y-auto rounded-xl border border-gray-200/80 bg-white p-1 shadow-lg">
          {loading && <p className="px-2 py-1.5 text-xs text-muted-foreground">Searching…</p>}
          {!loading && results.length === 0 && query && <p className="px-2 py-1.5 text-xs text-muted-foreground">No results</p>}
          {results.map(c => {
            const name = c.clientType === 'COMPANY' ? (c.company || c.userId?.name) : c.userId?.name
            return (
              <button key={c._id ?? c.id} type="button" onClick={() => select(c)}
                className="flex w-full items-center gap-3 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-gray-100">
                <div className={`size-1.5 shrink-0 rounded-full ${c.clientType === 'INDIVIDUAL' ? 'bg-blue-500' : 'bg-violet-500'}`} />
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-gray-900">{name}</p>
                  <p className="text-xs text-muted-foreground">{c.clientCode} · {c.userId?.email}</p>
                </div>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ─── Modal ────────────────────────────────────────────────────────────────────

export default function ClientModal({ open, onOpenChange, client, onSaved, initialTab = 'basic' }) {
  const isEdit = !!client
  const [saving, setSaving] = useState(false)
  const [tab, setTab]       = useState('basic')
  const [form, setForm]     = useState(EMPTY)
  // Snapshot of the form as loaded for edit — only fields that differ are sent,
  // so masked display values (e.g. 'j•••@g••.com') are never written back.
  const initialRef = useRef(null)

  useEffect(() => {
    if (!open) return
    setTab(initialTab || 'basic')
    if (isEdit) {
      // Legacy records kept the BIN in vatNumber — offer it as the BIN.
      const legacyBin = !client.bin && client.vatNumber && !isMaskedValue(client.vatNumber)
        && BIN_REGEX.test(binDigits(client.vatNumber))
        ? (normalizeBin(binDigits(client.vatNumber)) || binDigits(client.vatNumber))
        : null
      const initial = {
        clientType:    client.clientType    ?? 'COMPANY',
        // Company info
        company:       client.company       ?? '',
        companyPhone:  client.companyPhone  ?? '',
        companyEmail:  client.companyEmail  ?? '',
        businessType:  client.businessType  ?? '',
        industry:      client.industry      ?? '',
        vatNumber:     client.vatNumber     ?? '',
        website:       client.website       ?? '',
        logo:          client.logo          ?? '',
        // Concerned person
        contactPerson: client.contactPerson ?? '',
        name:          client.userId?.name  ?? '',
        email:         client.userId?.email ?? '',
        phone:         client.userId?.phone ?? '',
        designation:   client.designation   ?? '',
        // Other
        priority:      client.priority      ?? 'MEDIUM',
        altPhone:      client.altPhone      ?? '',
        timezone:      client.timezone      ?? 'Asia/Dhaka',
        address:       client.address       ?? '',
        city:          client.city          ?? '',
        country:       client.country       ?? 'Bangladesh',
        socialLinks:    client.socialLinks   ?? [],
        notes:          client.notes         ?? '',
        // Tax identity
        bin:                 client.bin                 ?? '',
        tin:                 client.tin                 ?? '',
        vatRegistrationType: client.vatRegistrationType ?? '',
        isVdsEntity:         !!client.isVdsEntity,
        isTdsEntity:         !!client.isTdsEntity,
        defaultTdsSection:   client.defaultTdsSection   ?? '',
        taxNotes:            client.taxNotes            ?? '',
        _binFromLegacy:      false,
        parentClientId: typeof client.parentClientId === 'object'
          ? (client.parentClientId?.id ?? client.parentClientId?._id ?? null)
          : (client.parentClientId ?? null),
        _parentLabel:   client.parentClientId
          ? `${client.parentClientId.company || client.parentClientId.userId?.name || ''} · ${client.parentClientId.clientCode || ''}`
          : '',
      }
      // The snapshot keeps the stored (empty) BIN so a legacy pre-fill is saved.
      initialRef.current = initial
      setForm(legacyBin
        ? { ...initial, bin: legacyBin, vatRegistrationType: initial.vatRegistrationType || 'REGISTERED', _binFromLegacy: true }
        : initial)
    } else {
      initialRef.current = null
      setForm(EMPTY)
    }
  }, [open, client, isEdit, initialTab])

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  // Typing a valid BIN marks the client VAT registered when no status is set.
  function setBin(v) {
    setForm(f => ({
      ...f,
      bin: v,
      _binFromLegacy: false,
      vatRegistrationType: !f.vatRegistrationType && BIN_REGEX.test(binDigits(v)) ? 'REGISTERED' : f.vatRegistrationType,
    }))
  }

  // An overseas client with no VAT status yet is marked FOREIGN (export of
  // services is usually zero-rated) — the user can still change it.
  function setCountry(v) {
    setForm(f => ({
      ...f,
      country: v,
      vatRegistrationType: !f.vatRegistrationType && v && v !== 'Bangladesh' ? 'FOREIGN' : f.vatRegistrationType,
    }))
  }

  const binInvalid = !!binDigits(form.bin) && cleanBin(form.bin) === null
  const tinChanged = form.tin !== (initialRef.current?.tin ?? '')
  const tinInvalid = !!tinDigits(form.tin) && !(isMaskedValue(form.tin) && !tinChanged) && cleanTin(form.tin) === null

  function addSocialLink() {
    setForm(f => ({ ...f, socialLinks: [...f.socialLinks, { platform: 'facebook', url: '' }] }))
  }
  function updateSocialLink(i, key, val) {
    setForm(f => {
      const links = [...f.socialLinks]
      links[i] = { ...links[i], [key]: val }
      return { ...f, socialLinks: links }
    })
  }
  function removeSocialLink(i) {
    setForm(f => ({ ...f, socialLinks: f.socialLinks.filter((_, idx) => idx !== i) }))
  }

  async function handleSubmit(e) {
    e.preventDefault()
    if (!form.name.trim())  { toast.error('Name is required');  return }
    if (!isEdit && !form.parentClientId && !form.email.trim()) { toast.error('Email is required'); return }
    if (binInvalid) { setTab('tax'); toast.error('BIN must be 9 or 13 digits, e.g. 000123456-0101'); return }
    if (isMaskedValue(form.tin) && tinChanged) {
      setTab('tax'); toast.error('Clear the hidden TIN and type the full 12-digit e-TIN'); return
    }
    if (tinInvalid) { setTab('tax'); toast.error('TIN must be the 12-digit e-TIN'); return }
    setSaving(true)
    try {
      let body = {
        // Concerned person (used for login + notifications)
        name:           form.name.trim(),
        email:          form.email.trim(),
        phone:          form.phone          || null,
        designation:    form.designation    || null,
        // Company info
        clientType:     form.clientType,
        company:        form.company        || null,
        companyPhone:   form.companyPhone   || null,
        companyEmail:   form.companyEmail   || null,
        contactPerson:  form.contactPerson  || null,
        businessType:   form.businessType   || null,
        industry:       form.industry       || null,
        vatNumber:      form.vatNumber      || null,
        website:        form.website        || null,
        logo:           form.logo           || null,
        // Other
        priority:       form.priority,
        altPhone:       form.altPhone       || null,
        timezone:       form.timezone       || null,
        address:        form.address        || null,
        city:           form.city           || null,
        country:        form.country        || 'Bangladesh',
        socialLinks:    form.socialLinks.filter(s => s.url?.trim()),
        notes:          form.notes          || null,
        // Tax identity
        ...taxBody(form),
        // Portfolio
        parentClientId: form.parentClientId || null,
      }

      if (isEdit) {
        // Login email and parent link are not editable here; send only changed fields.
        delete body.email
        delete body.parentClientId
        const init = initialRef.current ?? {}
        const initBody = {
          name: (init.name ?? '').trim(), phone: init.phone || null, designation: init.designation || null,
          clientType: init.clientType, company: init.company || null, companyPhone: init.companyPhone || null,
          companyEmail: init.companyEmail || null, contactPerson: init.contactPerson || null,
          businessType: init.businessType || null, industry: init.industry || null,
          vatNumber: init.vatNumber || null, website: init.website || null, logo: init.logo || null,
          priority: init.priority, altPhone: init.altPhone || null, timezone: init.timezone || null,
          address: init.address || null, city: init.city || null, country: init.country || 'Bangladesh',
          socialLinks: (init.socialLinks ?? []).filter(s => s.url?.trim()), notes: init.notes || null,
          ...taxBody(init),
        }
        body = Object.fromEntries(
          Object.entries(body).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify(initBody[k]))
        )
      } else if (form.parentClientId) {
        // Linked to an existing contact — the server uses the parent's account;
        // never send the (possibly masked) contact details back.
        delete body.email
        delete body.phone
      }

      const url    = isEdit ? `/api/clients/${client.id}` : '/api/clients'
      const method = isEdit ? 'PUT' : 'POST'
      const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json   = await res.json()
      if (!res.ok) throw new Error(firstValidationMessage(json) ?? json.error ?? 'Failed')
      onSaved(json.data, null, json.emailSent, json.linkedToExisting)
      onOpenChange(false)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  if (!open) return null

  const warn = 'mt-1.5 text-xs text-amber-700'

  const PRIORITY_OPTIONS = [
    { value: 'LOW',    label: 'Low' },
    { value: 'MEDIUM', label: 'Medium' },
    { value: 'HIGH',   label: 'High' },
    { value: 'VIP',    label: 'VIP' },
  ]

  const TABS = [
    { id: 'basic',    label: 'Basic info'   },
    { id: 'contact',  label: 'Contact'      },
    { id: 'tax',      label: 'Tax & VAT'    },
    { id: 'social',   label: 'Social links' },
    { id: 'notes',    label: 'Notes'        },
  ]
  const tabIds    = TABS.map(t => t.id)
  const tabIndex  = tabIds.indexOf(tab)
  const isFirst   = tabIndex === 0
  const isLast    = tabIndex === tabIds.length - 1

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-[2px]" onClick={() => onOpenChange(false)} />
      <div className="relative flex max-h-[92vh] w-full max-w-2xl flex-col rounded-2xl border border-gray-200/80 bg-white shadow-2xl">

        {/* Header */}
        <div className="flex items-start justify-between gap-4 px-6 pt-5 pb-3">
          <div>
            <h2 className="text-base font-semibold tracking-tight text-gray-900">{isEdit ? 'Edit client' : 'New client'}</h2>
            {isEdit && <p className="mt-0.5 font-mono text-xs text-muted-foreground">#{client.clientCode}</p>}
          </div>
          <Button variant="ghost" size="icon-sm" onClick={() => onOpenChange(false)} className="-mr-1.5 -mt-0.5 text-gray-400" aria-label="Close">
            <X />
          </Button>
        </div>

        {/* Tabs */}
        <Tabs
          variant="underline"
          className="px-6"
          value={tab}
          onChange={setTab}
          tabs={TABS.map(t => ({ value: t.id, label: t.label }))}
        />

        {/* Body */}
        <form id="client-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5">

          {/* ── BASIC INFO ── */}
          {tab === 'basic' && (
            <div className="space-y-6">
              {/* Client Type */}
              <div>
                <Label>Client type</Label>
                <Tabs
                  value={form.clientType}
                  onChange={v => set('clientType', v)}
                  tabs={[
                    { value: 'COMPANY',    label: 'Company' },
                    { value: 'INDIVIDUAL', label: 'Individual' },
                  ]}
                />
              </div>

              {/* ── Portfolio link (new clients only) ── */}
              {!isEdit && (
                <Field
                  label={<>Link to existing contact <span className="font-normal text-muted-foreground">(optional)</span></>}
                  hint="Reuses their login; no new account"
                >
                  <div title="Use this when the same person owns multiple companies.">
                    <ParentClientSearch
                      value={form.parentClientId}
                      label={form._parentLabel}
                      onChange={(id, label, contact) => setForm(f => ({
                        ...f,
                        parentClientId: id,
                        _parentLabel:   label,
                        // Auto-fill contact person info from the linked client — clear on unlink
                        name:  contact ? contact.name  : f.name,
                        email: contact ? contact.email : f.email,
                        phone: contact ? contact.phone : f.phone,
                      }))}
                    />
                  </div>
                </Field>
              )}

              {/* ── Company Information ── */}
              {form.clientType === 'COMPANY' && (
                <div className="space-y-4">
                  <SectionTitle>Company information</SectionTitle>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Company name" required className="sm:col-span-2">
                      <Input value={form.company} onChange={e => set('company', e.target.value)}
                        placeholder="Acme Corporation" />
                    </Field>
                    <Field label="Company phone">
                      <Input value={form.companyPhone} onChange={e => set('companyPhone', e.target.value)}
                        placeholder="+8801…" />
                    </Field>
                    <Field label="Company email">
                      <Input type="email" value={form.companyEmail} onChange={e => set('companyEmail', e.target.value)}
                        placeholder="info@company.com" />
                    </Field>
                    <Field label="Business type">
                      <Select value={form.businessType} onChange={v => set('businessType', v ?? '')}
                        options={BUSINESS_TYPES.map(t => ({ value: t, label: t }))}
                        placeholder="Select…"
                      />
                    </Field>
                    <Field label="Industry">
                      <Select value={form.industry} onChange={v => set('industry', v ?? '')}
                        options={INDUSTRIES.map(i => ({ value: i, label: i }))}
                        placeholder="Select…"
                      />
                    </Field>
                    <Field label="BIN" error={binInvalid ? 'BIN must be 9 or 13 digits' : undefined}>
                      <Input value={form.bin} onChange={e => setBin(e.target.value)} inputMode="numeric"
                        placeholder="000123456-0101" className="font-mono" invalid={binInvalid}
                        title="VAT registration number. More tax details in the Tax & VAT tab." />
                    </Field>
                    <Field label="Priority">
                      <Select value={form.priority} onChange={v => set('priority', v ?? 'MEDIUM')}
                        options={PRIORITY_OPTIONS}
                        placeholder="Select…"
                      />
                    </Field>
                    <div className="sm:col-span-2">
                      <FileUpload value={form.logo} onUploaded={url => set('logo', url)} accept="image/*" label="Logo" />
                    </div>
                  </div>
                </div>
              )}

              {/* ── Concerned Person / Individual Details ── */}
              <div className="space-y-4">
                <SectionTitle
                  title={form.clientType === 'COMPANY'
                    ? 'This person receives all notifications and has portal access.'
                    : 'Used for login and notifications.'}
                >
                  {form.clientType === 'COMPANY' ? 'Concerned person' : 'Client details'}
                </SectionTitle>

                {/* When linked to existing contact — show read-only card, hide editable fields */}
                {!isEdit && form.parentClientId ? (
                  <div className="flex items-start gap-3 rounded-lg bg-gray-50 p-3">
                    <Link2 className="mt-0.5 size-4 shrink-0 text-gray-500" />
                    <div className="flex-1 space-y-0.5">
                      <p className="text-sm font-medium text-gray-900">{form.name || '—'}</p>
                      <p className="text-xs text-muted-foreground">{form.email}</p>
                      {form.phone && <p className="text-xs text-muted-foreground">{form.phone}</p>}
                      <p className="pt-1 text-xs text-gray-600">Existing account · no new login</p>
                    </div>
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label={form.clientType === 'COMPANY' ? 'Contact person' : 'Full name'} required>
                      <Input value={form.name} onChange={e => set('name', e.target.value)} required
                        placeholder={form.clientType === 'COMPANY' ? 'John Doe' : 'Jane Smith'} />
                    </Field>
                    <Field label="Designation">
                      <Input value={form.designation} onChange={e => set('designation', e.target.value)}
                        placeholder="e.g. CEO" />
                    </Field>
                    <Field label="Login email" required hint={!isEdit ? 'Login details are emailed automatically' : undefined}>
                      <Input type="email" value={form.email} onChange={e => set('email', e.target.value)} required
                        disabled={isEdit} placeholder="person@company.com"
                        title="Used for login and notifications" />
                    </Field>
                    <Field label="Phone">
                      <Input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+8801…"
                        title="Used for notifications" />
                    </Field>
                  </div>
                )}

                {/* Industry + Priority for individual clients */}
                {form.clientType === 'INDIVIDUAL' && (
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Industry">
                      <Select value={form.industry} onChange={v => set('industry', v ?? '')}
                        options={INDUSTRIES.map(i => ({ value: i, label: i }))}
                        placeholder="Select…"
                      />
                    </Field>
                    <Field label="Priority">
                      <Select value={form.priority} onChange={v => set('priority', v ?? 'MEDIUM')}
                        options={PRIORITY_OPTIONS}
                        placeholder="Select…"
                      />
                    </Field>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── CONTACT ── */}
          {tab === 'contact' && (
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Address" className="sm:col-span-2">
                <Input value={form.address} onChange={e => set('address', e.target.value)}
                  placeholder="Street address" />
              </Field>
              <Field label="City">
                <Input value={form.city} onChange={e => set('city', e.target.value)} placeholder="Dhaka" />
              </Field>
              <Field label="Country">
                <Select value={form.country} onChange={v => setCountry(v ?? 'Bangladesh')}
                  options={COUNTRIES.map(c => ({ value: c, label: c }))}
                  placeholder="Select…"
                />
              </Field>
              <Field label="Alt. phone">
                <Input value={form.altPhone} onChange={e => set('altPhone', e.target.value)}
                  placeholder="+8801…" />
              </Field>
              <Field label="Timezone">
                <Select value={form.timezone} onChange={v => set('timezone', v ?? 'Asia/Dhaka')}
                  options={[
                    { value: 'Asia/Dhaka',          label: 'Asia/Dhaka (GMT+6)' },
                    { value: 'Asia/Kolkata',         label: 'Asia/Kolkata (GMT+5:30)' },
                    { value: 'Asia/Karachi',         label: 'Asia/Karachi (GMT+5)' },
                    { value: 'Asia/Dubai',           label: 'Asia/Dubai (GMT+4)' },
                    { value: 'Asia/Singapore',       label: 'Asia/Singapore (GMT+8)' },
                    { value: 'Asia/Tokyo',           label: 'Asia/Tokyo (GMT+9)' },
                    { value: 'Asia/Shanghai',        label: 'Asia/Shanghai (GMT+8)' },
                    { value: 'Europe/London',        label: 'Europe/London (GMT+0)' },
                    { value: 'Europe/Berlin',        label: 'Europe/Berlin (GMT+1)' },
                    { value: 'America/New_York',     label: 'America/New_York (GMT-5)' },
                    { value: 'America/Los_Angeles',  label: 'America/Los_Angeles (GMT-8)' },
                    { value: 'America/Chicago',      label: 'America/Chicago (GMT-6)' },
                    { value: 'Australia/Sydney',     label: 'Australia/Sydney (GMT+11)' },
                    { value: 'Pacific/Auckland',     label: 'Pacific/Auckland (GMT+13)' },
                    { value: 'UTC',                  label: 'UTC (GMT+0)' },
                  ]}
                  placeholder="Select…"
                />
              </Field>
              <Field label="Website" className="sm:col-span-2">
                <Input value={form.website} onChange={e => set('website', e.target.value)}
                  placeholder="https://company.com" />
              </Field>
            </div>
          )}

          {/* ── TAX & VAT ── */}
          {tab === 'tax' && (
            <div className="space-y-6">
              <div className="space-y-4">
                <SectionTitle title="Printed on Mushak-6.3 VAT invoices and used to track VDS and TDS / AIT this client deducts.">
                  Registration
                </SectionTitle>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field
                    label="BIN"
                    error={binInvalid ? 'BIN must be 9 or 13 digits, e.g. 000123456-0101' : undefined}
                    hint={form._binFromLegacy ? undefined : '13 digits'}
                  >
                    <Input value={form.bin} onChange={e => setBin(e.target.value)} inputMode="numeric"
                      placeholder="000123456-0101" className="font-mono" invalid={binInvalid}
                      title="Needed on Mushak-6.3 for supplies above Tk 25,000 and for the client to claim input VAT." />
                    {!binInvalid && form._binFromLegacy && (
                      <p className={warn}>Filled from the old VAT number; saved as the BIN.</p>
                    )}
                  </Field>
                  <Field
                    label="TIN (e-TIN)"
                    error={isMaskedValue(form.tin) && tinChanged
                      ? 'Clear the hidden TIN fully, then type the new 12-digit e-TIN.'
                      : tinInvalid ? 'TIN must be the 12-digit e-TIN' : undefined}
                    hint={isMaskedValue(form.tin) ? 'Hidden. Leave as is, or replace fully.' : undefined}
                  >
                    <Input value={form.tin} onChange={e => set('tin', e.target.value)} inputMode="numeric"
                      placeholder="12-digit e-TIN" className="font-mono" invalid={tinInvalid}
                      title="Shown on TDS certificates the client issues to you." />
                  </Field>
                  <Field
                    label="VAT registration status"
                    hint={form.vatRegistrationType === 'FOREIGN' ? 'Exports are usually zero-rated' : undefined}
                  >
                    <NativeSelect value={form.vatRegistrationType} onChange={e => set('vatRegistrationType', e.target.value)}>
                      <option value="">Not specified</option>
                      {VAT_REGISTRATION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </NativeSelect>
                    {form.vatRegistrationType !== 'FOREIGN' && (
                      form.country && form.country !== 'Bangladesh' && !form.vatRegistrationType ? (
                        <p className={warn}>Client is outside Bangladesh. Consider Foreign.</p>
                      ) : form.vatRegistrationType === 'REGISTERED' && !binDigits(form.bin) ? (
                        <p className={warn}>Add the BIN for a VAT-registered client.</p>
                      ) : null
                    )}
                  </Field>
                  <Field label="Foreign VAT / other tax ID" hint="Overseas clients only; BD clients use BIN">
                    <Input value={form.vatNumber} onChange={e => set('vatNumber', e.target.value)}
                      placeholder="e.g. EU VAT ID" />
                  </Field>
                </div>
              </div>

              <div className="space-y-4">
                <SectionTitle>Tax withheld by this client</SectionTitle>
                <label
                  className="flex cursor-pointer items-start gap-3"
                  title="Government bodies, NGOs, banks, insurers, schools and limited companies deduct VAT when they pay and should give you a Mushak-6.6 certificate."
                >
                  <input type="checkbox" checked={form.isVdsEntity} onChange={e => set('isVdsEntity', e.target.checked)}
                    className="mt-0.5 size-4 rounded border-gray-300" />
                  <span>
                    <span className="block text-sm font-medium text-gray-900">Withholds VAT at source (VDS)</span>
                    <span className="block text-xs text-muted-foreground">Issues Mushak-6.6 certificates</span>
                  </span>
                </label>
                <label
                  className="flex cursor-pointer items-start gap-3"
                  title="Companies and other specified payers deduct advance income tax and give a TDS certificate. It counts as tax already paid."
                >
                  <input type="checkbox" checked={form.isTdsEntity} onChange={e => set('isTdsEntity', e.target.checked)}
                    className="mt-0.5 size-4 rounded border-gray-300" />
                  <span>
                    <span className="block text-sm font-medium text-gray-900">Deducts income tax at source (TDS / AIT)</span>
                    <span className="block text-xs text-muted-foreground">Issues TDS certificates</span>
                  </span>
                </label>
                {form.isTdsEntity && (
                  <Field label="Default TDS section" hint='IT work: usually s.90 "Any other service"' className="sm:w-1/2 sm:pl-7">
                    <TaxCodeSelect kind="TDS_SECTION" value={form.defaultTdsSection || null}
                      onChange={code => set('defaultTdsSection', code ?? '')}
                      placeholder="Select section…" />
                  </Field>
                )}
              </div>

              <Field label="Tax notes">
                <Textarea value={form.taxNotes} onChange={e => set('taxNotes', e.target.value)}
                  rows={3} placeholder="e.g. Sends Mushak-6.6 quarterly"
                  className="resize-none" />
              </Field>
            </div>
          )}

          {/* ── SOCIAL LINKS ── */}
          {tab === 'social' && (
            <div className="space-y-3">
              {form.socialLinks.length === 0 && (
                <p className="py-6 text-center text-sm text-muted-foreground">No social links yet</p>
              )}
              {form.socialLinks.map((link, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-36 shrink-0">
                    <Select value={link.platform} onChange={v => updateSocialLink(i, 'platform', v ?? 'facebook')}
                      options={SOCIAL_PLATFORMS.map(p => ({ value: p.value, label: p.label }))}
                      placeholder="Platform"
                    />
                  </div>
                  <Input value={link.url} onChange={e => updateSocialLink(i, 'url', e.target.value)}
                    placeholder="https://…" className="flex-1" />
                  <Button variant="ghost" size="icon-sm" onClick={() => removeSocialLink(i)}
                    className="text-gray-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove link">
                    <Trash2 />
                  </Button>
                </div>
              ))}
              <Button variant="outline" onClick={addSocialLink} className="w-full border-dashed">
                <Plus /> Add social link
              </Button>
            </div>
          )}

          {/* ── NOTES ── */}
          {tab === 'notes' && (
            <Field label="Internal notes" hint="Not visible to the client">
              <Textarea value={form.notes} onChange={e => set('notes', e.target.value)}
                rows={8} placeholder="Notes…"
                className="resize-none" />
            </Field>
          )}

        </form>

        {/* Footer */}
        <div className="flex items-center justify-between gap-2 rounded-b-2xl border-t border-gray-100 bg-gray-50/60 px-6 py-3.5">
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <div className="flex items-center gap-2">
            {!isFirst && (
              <Button variant="outline" onClick={() => setTab(tabIds[tabIndex - 1])}>
                Back
              </Button>
            )}
            {!isLast ? (
              <Button onClick={() => setTab(tabIds[tabIndex + 1])}>
                Next
              </Button>
            ) : (
              <Button type="submit" form="client-form" loading={saving}>
                {isEdit ? 'Save changes' : 'Create client'}
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function SectionTitle({ children, title }) {
  return (
    <h3 className="border-b border-gray-100 pb-2 text-sm font-semibold text-gray-900" title={title}>
      {children}
    </h3>
  )
}
