'use client'

import { useState, useEffect, Suspense } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Plus, Loader2, ArrowLeft, Save } from 'lucide-react'
import toast from 'react-hot-toast'
import Link from 'next/link'
import { useConfig } from '@/lib/useConfig'
import { computeQuotation, previewQuotation, uniformVatRate } from '@/lib/quotation'
import QuotationVatCard from '../_components/QuotationVatCard'
import QuotationItemCard from '../_components/QuotationItemCard'
import QuotationTotals from '../_components/QuotationTotals'
import { useQuotationVat } from '../_components/useQuotationVat'
import { emptyItem, buildItemsPayload, fetchJson, QUOTATION_CURRENCIES } from '../_components/quotationUi'

// YYYY-MM-DD in the business timezone (toISOString() would give the UTC date)
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka' }).format(new Date())
// Masked PII placeholders (from /api/leads, /api/clients) must never be copied into the snapshot
const unmasked = (v) => (typeof v === 'string' && v.includes('••') ? '' : (v || ''))

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900'
const labelCls = 'block text-xs font-medium text-gray-600 mb-1'

function NewQuotationForm() {
  const router       = useRouter()
  const searchParams = useSearchParams()
  const [saving, setSaving] = useState(false)
  const { ventures, ventureCategories } = useConfig()

  // Source — pre-fill from URL params (?sourceType=LEAD&leadId=xxx or ?sourceType=CLIENT&clientId=xxx)
  const [sourceType, setSourceType] = useState(() => (searchParams.get('sourceType') === 'CLIENT' ? 'CLIENT' : 'LEAD'))
  const [leads,   setLeads]   = useState([])
  const [clients, setClients] = useState([])
  const [sourcesLoading, setSourcesLoading] = useState(true)
  const [leadId,   setLeadId]   = useState(() => searchParams.get('leadId') || '')
  const [clientId, setClientId] = useState(() => searchParams.get('clientId') || '')

  // Recipient (snapshot)
  const [recipientName,    setRecipientName]    = useState('')
  const [recipientCompany, setRecipientCompany] = useState('')
  const [recipientEmail,   setRecipientEmail]   = useState('')
  const [recipientPhone,   setRecipientPhone]   = useState('')
  const [recipientAddress, setRecipientAddress] = useState('')

  // Items
  const [items, setItems] = useState([emptyItem()])

  // Financials
  const [taxRate,  setTaxRate]  = useState(0)   // MFS charge %
  const [discount, setDiscount] = useState(0)

  // Dates
  const [issueDate,  setIssueDate]  = useState(today())
  const [validUntil, setValidUntil] = useState('')

  // Misc
  const [currency, setCurrency]           = useState('BDT')
  const [notes, setNotes]                 = useState('')
  const [terms, setTerms]                 = useState('')
  const [itemPriceOnly, setItemPriceOnly] = useState(false)

  // VAT — company defaults (and the client's VAT profile) until the user picks
  const vat = useQuotationVat({ clientId: sourceType === 'CLIENT' && clientId ? clientId : null, setItems })

  // Live totals with exactly the rules the server applies
  const payloadItems = buildItemsPayload(items, { perLineVat: vat.perLineVat, ratesOn: vat.ratesOn })
  const calcParams = {
    items: payloadItems, taxRate, discount,
    vatTreatment: vat.effectiveTreatment,
    defaultVatRate: vat.ratesOn ? vat.defaultVatRate : 0,
  }
  const preview = previewQuotation(calcParams)
  const lineRate = preview.items.length ? uniformVatRate(preview.items) : null
  const vatRowLabel = vat.effectiveTreatment === 'ZERO_RATED' ? 'VAT (zero-rated)'
    : vat.effectiveTreatment === 'EXEMPT' ? 'VAT (exempt)'
    : lineRate === null ? 'VAT' : `VAT (${lineRate}%)`

  // Load leads/clients. A record preselected via the URL may be outside the
  // first 200 — fetch it by id and add it to the options.
  useEffect(() => {
    const urlLeadId   = searchParams.get('leadId')
    const urlClientId = searchParams.get('clientId')
    const withRecord = async (list, url) => {
      if (!url || list.some(x => (x.id || x._id) === url.split('/').pop())) return list
      try {
        const r = await fetch(url)
        if (!r.ok) return list
        const j = await r.json()
        return j.data ? [j.data, ...list] : list
      } catch { return list }
    }
    let alive = true
    Promise.all([
      fetch('/api/leads?limit=200').then(r => r.json())
        .then(j => withRecord(j.data ?? [], urlLeadId ? `/api/leads/${urlLeadId}` : null))
        .then(list => { if (alive) setLeads(list) })
        .catch(() => {}),
      fetch('/api/clients?limit=200').then(r => r.json())
        .then(j => withRecord(j.data ?? [], urlClientId ? `/api/clients/${urlClientId}` : null))
        .then(list => { if (alive) setClients(list) })
        .catch(() => {}),
    ]).finally(() => { if (alive) setSourcesLoading(false) })
    return () => { alive = false }
  }, [searchParams])

  // Auto-fill recipient when lead/client selected
  useEffect(() => {
    if (sourceType === 'LEAD' && leadId) {
      const l = leads.find(x => x.id === leadId || x._id === leadId)
      if (l) {
        setRecipientName(unmasked(l.name))
        setRecipientCompany(unmasked(l.company))
        setRecipientEmail(unmasked(l.email))
        setRecipientPhone(unmasked(l.phone))
        setRecipientAddress(unmasked(l.location))
      }
    }
  }, [leadId, leads, sourceType])

  useEffect(() => {
    if (sourceType === 'CLIENT' && clientId) {
      const c = clients.find(x => x.id === clientId || x._id === clientId)
      if (c) {
        setRecipientName(unmasked(c.contactPerson || c.userId?.name))
        setRecipientCompany(unmasked(c.company))
        setRecipientEmail(unmasked(c.userId?.email))
        setRecipientPhone(unmasked(c.userId?.phone))
        setRecipientAddress([c.address, c.city, c.country].map(unmasked).filter(Boolean).join(', '))
      }
    }
  }, [clientId, clients, sourceType])

  function updateItem(idx, updated) {
    setItems(prev => prev.map((it, i) => i === idx ? updated : it))
  }
  function removeItem(idx) {
    setItems(prev => {
      const next = prev.filter((_, i) => i !== idx)
      return next.length ? next : [emptyItem()]
    })
  }
  function addItem() {
    setItems(prev => [...prev, vat.perLineVat ? { ...emptyItem(), vatRate: vat.defaultVatRate } : emptyItem()])
  }

  async function save(e) {
    e.preventDefault()
    if (sourceType === 'LEAD' && !leadId)     return toast.error('Select a lead')
    if (sourceType === 'CLIENT' && !clientId) return toast.error('Select a client')
    if (!items.length) return toast.error('Add at least one item')
    if (validUntil && issueDate && validUntil < issueDate) return toast.error('Valid until cannot be before the issue date')
    // Same rules the server applies (lib/quotation) — fail fast with its message.
    const check = computeQuotation(calcParams)
    if (check.error) return toast.error(check.error)

    setSaving(true)
    try {
      const payload = {
        sourceType,
        leadId:   sourceType === 'LEAD'   ? leadId   : null,
        clientId: sourceType === 'CLIENT' ? clientId : null,
        // Blank recipient fields are snapshotted server-side from the lead/client
        recipientName, recipientCompany, recipientEmail, recipientPhone, recipientAddress,
        items: payloadItems,
        issueDate, validUntil: validUntil || null,
        taxRate: Number(taxRate) || 0, discount: Number(discount) || 0,
        currency, notes: notes || null, terms: terms || null,
        itemPriceOnly,
        ...vat.bodyFields(),
      }
      const json = await fetchJson('/api/quotations', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload),
      })
      toast.success('Quotation created')
      router.push(`/admin/quotations/${json.data.id}`)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={save} className="space-y-6 max-w-6xl" data-component="new-quotation-form">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Link href="/admin/quotations" aria-label="Back to quotations" className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">New Quotation</h1>
            <p className="text-sm text-gray-500 mt-0.5">Auto-numbered on save</p>
          </div>
        </div>
        <button type="submit" disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-lg hover:bg-gray-800 disabled:opacity-50 transition-colors">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Quotation
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left column: Source + Recipient + VAT + Items */}
        <div className="lg:col-span-2 space-y-6 min-w-0">

          {/* Source selector */}
          <div className="bg-white border border-gray-100 rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-700">Source</h2>
            <div className="flex gap-3">
              {['LEAD', 'CLIENT'].map(t => (
                <button type="button" key={t}
                  onClick={() => { setSourceType(t); setLeadId(''); setClientId('') }}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium border transition-colors ${sourceType === t ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:bg-gray-50'}`}>
                  {t[0] + t.slice(1).toLowerCase()}
                </button>
              ))}
            </div>
            {sourceType === 'LEAD' ? (
              <select value={leadId} onChange={e => setLeadId(e.target.value)} required className={inputCls}>
                <option value="">{sourcesLoading ? 'Loading leads…' : leads.length ? '— Select Lead —' : 'No leads found'}</option>
                {leads.map(l => (
                  <option key={l.id || l._id} value={l.id || l._id}>{l.name}{l.company ? ` (${l.company})` : ''}</option>
                ))}
              </select>
            ) : (
              <select value={clientId} onChange={e => setClientId(e.target.value)} required className={inputCls}>
                <option value="">{sourcesLoading ? 'Loading clients…' : clients.length ? '— Select Client —' : 'No clients found'}</option>
                {clients.map(c => (
                  <option key={c.id || c._id} value={c.id || c._id}>{c.company}{c.contactPerson ? ` — ${c.contactPerson}` : ''}</option>
                ))}
              </select>
            )}
          </div>

          {/* Recipient info */}
          <div className="bg-white border border-gray-100 rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-700">Recipient Details <span className="font-normal text-gray-400">(snapshot — edit freely; blank fields are filled from the {sourceType === 'LEAD' ? 'lead' : 'client'} on save)</span></h2>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>Name</label>
                <input value={recipientName} onChange={e => setRecipientName(e.target.value)} maxLength={200} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Company</label>
                <input value={recipientCompany} onChange={e => setRecipientCompany(e.target.value)} maxLength={200} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Email</label>
                <input type="email" value={recipientEmail} onChange={e => setRecipientEmail(e.target.value)} maxLength={200} className={inputCls} />
              </div>
              <div>
                <label className={labelCls}>Phone</label>
                <input value={recipientPhone} onChange={e => setRecipientPhone(e.target.value)} maxLength={50} className={inputCls} />
              </div>
              <div className="sm:col-span-2">
                <label className={labelCls}>Address</label>
                <input value={recipientAddress} onChange={e => setRecipientAddress(e.target.value)} maxLength={500} className={inputCls} />
              </div>
            </div>
          </div>

          {/* VAT */}
          <QuotationVatCard vat={vat} setItems={setItems} sourceType={sourceType} currency={currency} />

          {/* Line items */}
          <div className="bg-white border border-gray-100 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-semibold text-gray-700">Items</h2>
            {items.map((item, idx) => (
              <QuotationItemCard key={idx} item={item} idx={idx} onChange={updateItem} onRemove={removeItem}
                ventures={ventures} ventureCategories={ventureCategories} currency={currency}
                line={preview.items[idx]} isVat={vat.isVat}
                showVatRate={vat.perLineVat && vat.ratesOn} defaultVatRate={vat.defaultVatRate}
                vatTreatment={vat.effectiveTreatment} />
            ))}
            <button type="button" onClick={addItem}
              className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 font-medium pt-1">
              <Plus className="w-4 h-4" /> Add Item
            </button>
          </div>

          {/* Notes & Terms */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-white border border-gray-100 rounded-xl p-4">
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Notes</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4} maxLength={5000}
                placeholder="Any notes for the client…"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none" />
            </div>
            <div className="bg-white border border-gray-100 rounded-xl p-4">
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Terms & Conditions</label>
              <textarea value={terms} onChange={e => setTerms(e.target.value)} rows={4} maxLength={5000}
                placeholder="Payment terms, validity, etc…"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-2 focus:ring-gray-900 resize-none" />
            </div>
          </div>
        </div>

        {/* Right column: Dates, Financials */}
        <div className="space-y-4">
          <div className="bg-white border border-gray-100 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-semibold text-gray-700">Dates</h2>
            <div>
              <label className={labelCls}>Issue Date</label>
              <input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Valid Until</label>
              <input type="date" value={validUntil} min={issueDate || undefined} onChange={e => setValidUntil(e.target.value)} className={inputCls} />
            </div>
            <div>
              <label className={labelCls}>Currency</label>
              <select value={currency} onChange={e => setCurrency(e.target.value)} className={inputCls}>
                {QUOTATION_CURRENCIES.map(c => <option key={c.value} value={c.value}>{c.label}</option>)}
              </select>
            </div>
          </div>

          <div className="bg-white border border-gray-100 rounded-xl p-5 space-y-3 lg:sticky lg:top-4">
            <h2 className="text-sm font-semibold text-gray-700">Summary</h2>
            <QuotationTotals
              preview={preview} currency={currency} isVat={vat.isVat} vatRowLabel={vatRowLabel}
              taxRate={taxRate} onTaxRate={setTaxRate} discount={discount} onDiscount={setDiscount}
              itemPriceOnly={itemPriceOnly} onItemPriceOnly={setItemPriceOnly}
              pendingDefault={!vat.vatTreatment && vat.vatInfoState !== 'loading'}
            />
          </div>
        </div>
      </div>
    </form>
  )
}

export default function NewQuotationPage() {
  return (
    <Suspense fallback={<div className="flex items-center justify-center min-h-[60vh]"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>}>
      <NewQuotationForm />
    </Suspense>
  )
}
