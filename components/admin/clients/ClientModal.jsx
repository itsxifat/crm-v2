'use client'

import { useState, useEffect, useRef } from 'react'
import { X, Loader2, Plus, Trash2, Globe, Facebook, Instagram, Linkedin, Twitter, Youtube, Link2, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import FileUpload from '@/components/ui/FileUpload'
import Select from '@/components/ui/Select'
import TaxCodeSelect from '@/components/tax/TaxCodeSelect'
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

  const ic = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500'

  if (value) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg">
        <Link2 className="w-4 h-4 text-blue-500 shrink-0" />
        <span className="text-sm text-blue-700 font-medium flex-1">{label}</span>
        <button type="button" onClick={clear} className="p-0.5 text-blue-400 hover:text-blue-700">
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    )
  }

  return (
    <div ref={ref} className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          value={query}
          onChange={e => { setQuery(e.target.value); setOpen(true) }}
          onFocus={() => setOpen(true)}
          placeholder="Search by name, company, or code…"
          className={`${ic} pl-9`}
        />
      </div>
      {open && (query || results.length > 0) && (
        <div className="absolute top-full mt-1 left-0 right-0 bg-white border border-gray-100 rounded-xl shadow-lg py-1 z-30 max-h-48 overflow-y-auto">
          {loading && <p className="px-4 py-2 text-xs text-gray-400">Searching…</p>}
          {!loading && results.length === 0 && query && <p className="px-4 py-2 text-xs text-gray-400">No clients found</p>}
          {results.map(c => {
            const name = c.clientType === 'COMPANY' ? (c.company || c.userId?.name) : c.userId?.name
            return (
              <button key={c._id ?? c.id} type="button" onClick={() => select(c)}
                className="w-full flex items-center gap-3 px-4 py-2 hover:bg-gray-50 text-left transition-colors">
                <div className={`w-1.5 h-1.5 rounded-full shrink-0 ${c.clientType === 'INDIVIDUAL' ? 'bg-blue-500' : 'bg-violet-500'}`} />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">{name}</p>
                  <p className="text-xs text-gray-400">{c.clientCode} · {c.userId?.email}</p>
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

  const ic = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500'
  const lc = 'block text-xs font-medium text-gray-600 mb-1'

  const hc = 'text-xs text-gray-400 mt-1'

  const TABS = [
    { id: 'basic',    label: 'Basic Info'   },
    { id: 'contact',  label: 'Contact'      },
    { id: 'tax',      label: 'Tax & VAT'    },
    { id: 'social',   label: 'Social Links' },
    { id: 'notes',    label: 'Notes'        },
  ]
  const tabIds    = TABS.map(t => t.id)
  const tabIndex  = tabIds.indexOf(tab)
  const isFirst   = tabIndex === 0
  const isLast    = tabIndex === tabIds.length - 1

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm" onClick={() => onOpenChange(false)} />
      <div className="relative bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[92vh] flex flex-col">

        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div>
            <h2 className="text-base font-semibold text-gray-900">{isEdit ? 'Edit Client' : 'Add New Client'}</h2>
            {isEdit && <p className="text-xs text-gray-400 mt-0.5">#{client.clientCode}</p>}
          </div>
          <button onClick={() => onOpenChange(false)} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100">
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-100 px-6 overflow-x-auto">
          {TABS.map(t => (
            <button key={t.id} type="button" onClick={() => setTab(t.id)}
              className={`px-3 py-2.5 text-sm font-medium whitespace-nowrap -mb-px border-b-2 transition-colors ${
                tab === t.id ? 'border-blue-600 text-blue-600' : 'border-transparent text-gray-400 hover:text-gray-600'
              }`}>
              {t.label}
            </button>
          ))}
        </div>

        {/* Body */}
        <form id="client-form" onSubmit={handleSubmit} className="flex-1 overflow-y-auto px-6 py-5">

          {/* ── BASIC INFO ── */}
          {tab === 'basic' && (
            <div className="space-y-6">
              {/* Client Type */}
              <div>
                <label className={lc}>Client Type</label>
                <div className="flex gap-3">
                  {['COMPANY', 'INDIVIDUAL'].map(t => (
                    <button key={t} type="button"
                      onClick={() => set('clientType', t)}
                      className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${
                        form.clientType === t
                          ? 'bg-blue-600 text-white border-blue-600'
                          : 'bg-white text-gray-600 border-gray-200 hover:border-gray-300'
                      }`}>
                      {t === 'INDIVIDUAL' ? 'Individual' : 'Company'}
                    </button>
                  ))}
                </div>
              </div>

              {/* ── Portfolio link (new clients only) ── */}
              {!isEdit && (
                <div>
                  <label className={lc}>
                    <span className="flex items-center gap-1.5">
                      <Link2 className="w-3.5 h-3.5" />
                      Link to Existing Contact <span className="text-gray-400 font-normal">(optional)</span>
                    </span>
                  </label>
                  <p className="text-xs text-gray-400 mb-1.5">
                    Use this when the same person owns multiple companies. The contact's existing login will be reused — no new account is created.
                  </p>
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
              )}

              {/* ── Company Information ── */}
              {form.clientType === 'COMPANY' && (
                <div className="space-y-3">
                  <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-100 pb-1.5">Company Information</p>
                  <div className="grid grid-cols-2 gap-4">
                    <div className="col-span-2">
                      <label className={lc}>Company Name *</label>
                      <input value={form.company} onChange={e => set('company', e.target.value)}
                        placeholder="Acme Corporation" className={ic} />
                    </div>
                    <div>
                      <label className={lc}>Company Phone</label>
                      <input value={form.companyPhone} onChange={e => set('companyPhone', e.target.value)}
                        placeholder="+8801XXXXXXXXX" className={ic} />
                    </div>
                    <div>
                      <label className={lc}>Company Email</label>
                      <input type="email" value={form.companyEmail} onChange={e => set('companyEmail', e.target.value)}
                        placeholder="info@company.com" className={ic} />
                    </div>
                    <div>
                      <label className={lc}>Business Type</label>
                      <Select value={form.businessType} onChange={v => set('businessType', v ?? '')}
                        options={BUSINESS_TYPES.map(t => ({ value: t, label: t }))}
                        placeholder="— Select type —"
                      />
                    </div>
                    <div>
                      <label className={lc}>Industry</label>
                      <Select value={form.industry} onChange={v => set('industry', v ?? '')}
                        options={INDUSTRIES.map(i => ({ value: i, label: i }))}
                        placeholder="— Select industry —"
                      />
                    </div>
                    <div className="col-span-2 sm:col-span-1">
                      <label className={lc}>BIN (VAT registration no.)</label>
                      <input value={form.bin} onChange={e => setBin(e.target.value)} inputMode="numeric"
                        placeholder="000123456-0101" className={`${ic} font-mono ${binInvalid ? 'border-red-300' : ''}`} />
                      <p className={binInvalid ? 'text-xs text-red-500 mt-1' : hc}>
                        {binInvalid ? 'BIN must be 9 or 13 digits' : 'More tax details in the Tax & VAT tab.'}
                      </p>
                    </div>
                    <div>
                      <label className={lc}>Priority</label>
                      <Select value={form.priority} onChange={v => set('priority', v ?? 'MEDIUM')}
                        options={[
                          { value: 'LOW',    label: 'Low' },
                          { value: 'MEDIUM', label: 'Medium' },
                          { value: 'HIGH',   label: 'High' },
                          { value: 'VIP',    label: 'VIP' },
                        ]}
                        placeholder="Select priority…"
                      />
                    </div>
                    <div className="col-span-2">
                      <label className={lc}>Logo</label>
                      <FileUpload value={form.logo} onUploaded={url => set('logo', url)} accept="image/*" label="Upload logo" />
                    </div>
                  </div>
                </div>
              )}

              {/* ── Concerned Person / Individual Details ── */}
              <div className="space-y-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-100 pb-1.5">
                  {form.clientType === 'COMPANY' ? 'Concerned Person' : 'Client Details'}
                </p>

                {/* When linked to existing contact — show read-only card, hide editable fields */}
                {!isEdit && form.parentClientId ? (
                  <div className="flex items-start gap-3 p-3 bg-gray-50 border border-gray-200 rounded-xl">
                    <Link2 className="w-4 h-4 text-blue-500 mt-0.5 shrink-0" />
                    <div className="space-y-0.5 flex-1">
                      <p className="text-sm font-semibold text-gray-800">{form.name || '—'}</p>
                      <p className="text-xs text-gray-500">{form.email}</p>
                      {form.phone && <p className="text-xs text-gray-400">{form.phone}</p>}
                      <p className="text-xs text-blue-600 mt-1">Using existing account — no new login will be created.</p>
                    </div>
                  </div>
                ) : (
                  <>
                    <p className="text-xs text-blue-600 bg-blue-50 rounded-lg px-3 py-2">
                      {form.clientType === 'COMPANY'
                        ? 'This person will receive all notifications and have portal access.'
                        : 'This information will be used for login and notifications.'}
                    </p>
                    <div className="grid grid-cols-2 gap-4">
                      <div>
                        <label className={lc}>{form.clientType === 'COMPANY' ? 'Contact Person Name *' : 'Full Name *'}</label>
                        <input value={form.name} onChange={e => set('name', e.target.value)} required
                          placeholder={form.clientType === 'COMPANY' ? 'John Doe' : 'Jane Smith'} className={ic} />
                      </div>
                      <div>
                        <label className={lc}>Designation</label>
                        <input value={form.designation} onChange={e => set('designation', e.target.value)}
                          placeholder="CEO, Director…" className={ic} />
                      </div>
                      <div>
                        <label className={lc}>Email (for login & notifications) *</label>
                        <input type="email" value={form.email} onChange={e => set('email', e.target.value)} required
                          disabled={isEdit} placeholder="person@company.com" className={ic} />
                      </div>
                      <div>
                        <label className={lc}>Phone (for notifications)</label>
                        <input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+8801XXXXXXXXX" className={ic} />
                      </div>
                      {!isEdit && (
                        <div className="col-span-2 flex items-start gap-2 p-3 bg-blue-50 border border-blue-100 rounded-xl text-xs text-blue-700">
                          <span className="mt-0.5">ℹ</span>
                          <span>A secure password will be auto-generated and sent to the client's email along with their Client ID and login instructions.</span>
                        </div>
                      )}
                    </div>
                  </>
                )}

                {/* Industry + Priority for individual clients */}
                {form.clientType === 'INDIVIDUAL' && (
                  <div className="grid grid-cols-2 gap-4 mt-1">
                    <div>
                      <label className={lc}>Industry</label>
                      <Select value={form.industry} onChange={v => set('industry', v ?? '')}
                        options={INDUSTRIES.map(i => ({ value: i, label: i }))}
                        placeholder="— Select industry —"
                      />
                    </div>
                    <div>
                      <label className={lc}>Priority</label>
                      <Select value={form.priority} onChange={v => set('priority', v ?? 'MEDIUM')}
                        options={[
                          { value: 'LOW',    label: 'Low' },
                          { value: 'MEDIUM', label: 'Medium' },
                          { value: 'HIGH',   label: 'High' },
                          { value: 'VIP',    label: 'VIP' },
                        ]}
                        placeholder="Select priority…"
                      />
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* ── CONTACT ── */}
          {tab === 'contact' && (
            <div className="grid grid-cols-2 gap-4">
              <div className="col-span-2">
                <label className={lc}>Address</label>
                <input value={form.address} onChange={e => set('address', e.target.value)}
                  placeholder="Street address" className={ic} />
              </div>
              <div>
                <label className={lc}>City</label>
                <input value={form.city} onChange={e => set('city', e.target.value)} placeholder="Dhaka" className={ic} />
              </div>
              <div>
                <label className={lc}>Country</label>
                <Select value={form.country} onChange={v => setCountry(v ?? 'Bangladesh')}
                  options={COUNTRIES.map(c => ({ value: c, label: c }))}
                  placeholder="Select country…"
                />
              </div>
              <div>
                <label className={lc}>Alt. Phone</label>
                <input value={form.altPhone} onChange={e => set('altPhone', e.target.value)}
                  placeholder="+8801XXXXXXXXX" className={ic} />
              </div>
              <div>
                <label className={lc}>Timezone</label>
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
                  placeholder="Select timezone…"
                />
              </div>
              <div className="col-span-2">
                <label className={lc}>Website</label>
                <input value={form.website} onChange={e => set('website', e.target.value)}
                  placeholder="https://company.com" className={ic} />
              </div>
            </div>
          )}

          {/* ── TAX & VAT ── */}
          {tab === 'tax' && (
            <div className="space-y-6">
              <p className="text-xs text-gray-500 bg-gray-50 border border-gray-100 rounded-lg px-3 py-2">
                Printed on Mushak-6.3 VAT invoices and used to track the VAT (VDS) and income tax (TDS / AIT)
                this client deducts from your payments.
              </p>

              <div className="space-y-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-100 pb-1.5">Registration</p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className={lc}>BIN (VAT registration no.)</label>
                    <input value={form.bin} onChange={e => setBin(e.target.value)} inputMode="numeric"
                      placeholder="000123456-0101" className={`${ic} font-mono ${binInvalid ? 'border-red-300' : ''}`} />
                    {binInvalid
                      ? <p className="text-xs text-red-500 mt-1">BIN must be 9 or 13 digits, e.g. 000123456-0101</p>
                      : <p className={hc}>13 digits, e.g. 000123456-0101. Needed on Mushak-6.3 for supplies above Tk 25,000 and for the client to claim input VAT.</p>}
                    {form._binFromLegacy && (
                      <p className="text-xs text-amber-600 mt-1">Filled in from the old VAT number. Saving stores it as the BIN.</p>
                    )}
                  </div>
                  <div>
                    <label className={lc}>TIN (e-TIN)</label>
                    <input value={form.tin} onChange={e => set('tin', e.target.value)} inputMode="numeric"
                      placeholder="12-digit e-TIN" className={`${ic} font-mono ${tinInvalid ? 'border-red-300' : ''}`} />
                    {isMaskedValue(form.tin) && tinChanged
                      ? <p className="text-xs text-red-500 mt-1">Clear the hidden TIN fully, then type the new 12-digit e-TIN.</p>
                      : tinInvalid
                        ? <p className="text-xs text-red-500 mt-1">TIN must be the 12-digit e-TIN</p>
                        : <p className={hc}>
                            {isMaskedValue(form.tin) ? 'Hidden for privacy. Leave it as is, or replace it with the full number.' : 'Shown on TDS certificates the client issues to you.'}
                          </p>}
                  </div>
                  <div>
                    <label className={lc}>VAT registration status</label>
                    <select value={form.vatRegistrationType} onChange={e => set('vatRegistrationType', e.target.value)} className={ic}>
                      <option value="">Not specified</option>
                      {VAT_REGISTRATION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                    </select>
                    {form.vatRegistrationType === 'FOREIGN' ? (
                      <p className={hc}>Services exported to overseas clients are usually zero-rated.</p>
                    ) : form.country && form.country !== 'Bangladesh' && !form.vatRegistrationType ? (
                      <p className="text-xs text-amber-600 mt-1">This client is outside Bangladesh. Consider marking them Foreign.</p>
                    ) : form.vatRegistrationType === 'REGISTERED' && !binDigits(form.bin) ? (
                      <p className="text-xs text-amber-600 mt-1">Add the BIN for a VAT-registered client.</p>
                    ) : null}
                  </div>
                  <div>
                    <label className={lc}>Foreign VAT / other tax ID</label>
                    <input value={form.vatNumber} onChange={e => set('vatNumber', e.target.value)}
                      placeholder="e.g. EU VAT ID (optional)" className={ic} />
                    <p className={hc}>For overseas clients. Bangladesh clients: use the BIN.</p>
                  </div>
                </div>
              </div>

              <div className="space-y-3">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-100 pb-1.5">Tax this client deducts from your payments</p>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={form.isVdsEntity} onChange={e => set('isVdsEntity', e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                  <span>
                    <span className="block text-sm font-medium text-gray-800">Withholds VAT at source (VDS)</span>
                    <span className="block text-xs text-gray-400">Government bodies, NGOs, banks, insurers, schools and limited companies deduct VAT when they pay and should give you a Mushak-6.6 certificate.</span>
                  </span>
                </label>
                <label className="flex items-start gap-3 cursor-pointer">
                  <input type="checkbox" checked={form.isTdsEntity} onChange={e => set('isTdsEntity', e.target.checked)}
                    className="mt-0.5 w-4 h-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500" />
                  <span>
                    <span className="block text-sm font-medium text-gray-800">Deducts income tax at source (TDS / AIT)</span>
                    <span className="block text-xs text-gray-400">Companies and other specified payers deduct advance income tax and give a TDS certificate. It counts as tax already paid.</span>
                  </span>
                </label>
                {form.isTdsEntity && (
                  <div className="sm:w-1/2 sm:pl-7">
                    <label className={lc}>Default TDS section</label>
                    <TaxCodeSelect kind="TDS_SECTION" value={form.defaultTdsSection || null}
                      onChange={code => set('defaultTdsSection', code ?? '')}
                      placeholder="Select section…" className={ic} />
                    <p className={hc}>IT and digital marketing work usually falls under s.90 &quot;Any other service&quot;.</p>
                  </div>
                )}
              </div>

              <div>
                <label className={lc}>Tax notes</label>
                <textarea value={form.taxNotes} onChange={e => set('taxNotes', e.target.value)}
                  rows={3} placeholder="e.g. Sends Mushak-6.6 quarterly; finance contact for certificates…"
                  className={`${ic} resize-none`} />
              </div>
            </div>
          )}

          {/* ── SOCIAL LINKS ── */}
          {tab === 'social' && (
            <div className="space-y-3">
              {form.socialLinks.length === 0 && (
                <p className="text-sm text-gray-400 text-center py-6">No social links added yet</p>
              )}
              {form.socialLinks.map((link, i) => (
                <div key={i} className="flex items-center gap-2">
                  <div className="w-36 shrink-0">
                    <Select value={link.platform} onChange={v => updateSocialLink(i, 'platform', v ?? 'facebook')}
                      options={SOCIAL_PLATFORMS.map(p => ({ value: p.value, label: p.label }))}
                      placeholder="Platform"
                      size="sm"
                    />
                  </div>
                  <input value={link.url} onChange={e => updateSocialLink(i, 'url', e.target.value)}
                    placeholder="https://…" className={`${ic} flex-1`} />
                  <button type="button" onClick={() => removeSocialLink(i)}
                    className="p-2 text-gray-400 hover:text-red-500 transition-colors shrink-0">
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>
              ))}
              <button type="button" onClick={addSocialLink}
                className="flex items-center gap-2 px-3 py-2 text-sm text-blue-600 border border-dashed border-blue-300 rounded-lg hover:bg-blue-50 w-full justify-center">
                <Plus className="w-4 h-4" /> Add Social Link
              </button>
            </div>
          )}

          {/* ── NOTES ── */}
          {tab === 'notes' && (
            <div>
              <label className={lc}>Internal Notes (admin use only)</label>
              <textarea value={form.notes} onChange={e => set('notes', e.target.value)}
                rows={8} placeholder="Any internal notes about this client…"
                className={`${ic} resize-none`} />
              <p className="text-xs text-gray-400 mt-1.5">These notes are not visible to the client.</p>
            </div>
          )}

        </form>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-6 py-4 border-t border-gray-100">
          <button type="button" onClick={() => onOpenChange(false)}
            className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
            Cancel
          </button>
          <div className="flex items-center gap-3">
            {!isFirst && (
              <button type="button" onClick={() => setTab(tabIds[tabIndex - 1])}
                className="px-4 py-2 text-sm font-medium text-gray-600 border border-gray-200 rounded-lg hover:bg-gray-50">
                Back
              </button>
            )}
            {!isLast ? (
              <button type="button" onClick={() => setTab(tabIds[tabIndex + 1])}
                className="px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700">
                Next
              </button>
            ) : (
              <button type="submit" form="client-form" disabled={saving}
                className="px-5 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 disabled:opacity-60 flex items-center gap-2">
                {saving && <Loader2 className="w-4 h-4 animate-spin" />}
                {isEdit ? 'Save Changes' : 'Add Client'}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
