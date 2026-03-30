'use client'

import { useState, useEffect, useRef } from 'react'
import { X, Loader2, Plus, Trash2, Globe, Facebook, Instagram, Linkedin, Twitter, Youtube, Link2, Search } from 'lucide-react'
import toast from 'react-hot-toast'
import FileUpload from '@/components/ui/FileUpload'

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

export default function ClientModal({ open, onOpenChange, client, onSaved }) {
  const isEdit = !!client
  const [saving, setSaving] = useState(false)
  const [tab, setTab]       = useState('basic')
  const [form, setForm]     = useState(EMPTY)

  useEffect(() => {
    if (!open) return
    setTab('basic')
    if (isEdit) {
      setForm({
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
        parentClientId: client.parentClientId?._id ?? client.parentClientId ?? null,
        _parentLabel:   client.parentClientId
          ? `${client.parentClientId.company || client.parentClientId.userId?.name || ''} · ${client.parentClientId.clientCode || ''}`
          : '',
      })
    } else {
      setForm(EMPTY)
    }
  }, [open, client, isEdit])

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

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
    if (!form.email.trim()) { toast.error('Email is required'); return }
    setSaving(true)
    try {
      const body = {
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
        // Portfolio
        parentClientId: form.parentClientId || null,
      }

      const url    = isEdit ? `/api/clients/${client.id}` : '/api/clients'
      const method = isEdit ? 'PUT' : 'POST'
      const res    = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json   = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      onSaved(json.data, null, json.emailSent)
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

  const TABS = [
    { id: 'basic',    label: 'Basic Info'   },
    { id: 'contact',  label: 'Contact'      },
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
        <div className="flex border-b border-gray-100 px-6">
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`px-3 py-2.5 text-sm font-medium -mb-px border-b-2 transition-colors ${
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
                      <select value={form.businessType} onChange={e => set('businessType', e.target.value)} className={ic}>
                        <option value="">— Select type —</option>
                        {BUSINESS_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={lc}>Industry</label>
                      <select value={form.industry} onChange={e => set('industry', e.target.value)} className={ic}>
                        <option value="">— Select industry —</option>
                        {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={lc}>VAT / Tax Number</label>
                      <input value={form.vatNumber} onChange={e => set('vatNumber', e.target.value)}
                        placeholder="Optional" className={ic} />
                    </div>
                    <div>
                      <label className={lc}>Priority</label>
                      <select value={form.priority} onChange={e => set('priority', e.target.value)} className={ic}>
                        <option value="LOW">Low</option>
                        <option value="MEDIUM">Medium</option>
                        <option value="HIGH">High</option>
                        <option value="VIP">VIP</option>
                      </select>
                    </div>
                    <div className="col-span-2">
                      <label className={lc}>Logo</label>
                      <FileUpload value={form.logo} onChange={url => set('logo', url)} accept="image/*" label="Upload logo" />
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
                      <select value={form.industry} onChange={e => set('industry', e.target.value)} className={ic}>
                        <option value="">— Select industry —</option>
                        {INDUSTRIES.map(i => <option key={i} value={i}>{i}</option>)}
                      </select>
                    </div>
                    <div>
                      <label className={lc}>Priority</label>
                      <select value={form.priority} onChange={e => set('priority', e.target.value)} className={ic}>
                        <option value="LOW">Low</option>
                        <option value="MEDIUM">Medium</option>
                        <option value="HIGH">High</option>
                        <option value="VIP">VIP</option>
                      </select>
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
                <select value={form.country} onChange={e => set('country', e.target.value)} className={ic}>
                  {COUNTRIES.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div>
                <label className={lc}>Alt. Phone</label>
                <input value={form.altPhone} onChange={e => set('altPhone', e.target.value)}
                  placeholder="+8801XXXXXXXXX" className={ic} />
              </div>
              <div>
                <label className={lc}>Timezone</label>
                <select value={form.timezone} onChange={e => set('timezone', e.target.value)} className={ic}>
                  <option value="Asia/Dhaka">Asia/Dhaka (GMT+6)</option>
                  <option value="Asia/Kolkata">Asia/Kolkata (GMT+5:30)</option>
                  <option value="Asia/Karachi">Asia/Karachi (GMT+5)</option>
                  <option value="Asia/Dubai">Asia/Dubai (GMT+4)</option>
                  <option value="Asia/Singapore">Asia/Singapore (GMT+8)</option>
                  <option value="Asia/Tokyo">Asia/Tokyo (GMT+9)</option>
                  <option value="Asia/Shanghai">Asia/Shanghai (GMT+8)</option>
                  <option value="Europe/London">Europe/London (GMT+0)</option>
                  <option value="Europe/Berlin">Europe/Berlin (GMT+1)</option>
                  <option value="America/New_York">America/New_York (GMT-5)</option>
                  <option value="America/Los_Angeles">America/Los_Angeles (GMT-8)</option>
                  <option value="America/Chicago">America/Chicago (GMT-6)</option>
                  <option value="Australia/Sydney">Australia/Sydney (GMT+11)</option>
                  <option value="Pacific/Auckland">Pacific/Auckland (GMT+13)</option>
                  <option value="UTC">UTC (GMT+0)</option>
                </select>
              </div>
              <div className="col-span-2">
                <label className={lc}>Website</label>
                <input value={form.website} onChange={e => set('website', e.target.value)}
                  placeholder="https://company.com" className={ic} />
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
                  <select value={link.platform} onChange={e => updateSocialLink(i, 'platform', e.target.value)}
                    className="border border-gray-200 rounded-lg px-2 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 w-36 shrink-0">
                    {SOCIAL_PLATFORMS.map(p => <option key={p.value} value={p.value}>{p.label}</option>)}
                  </select>
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
