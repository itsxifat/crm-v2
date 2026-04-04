'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Plus, Trash2, ChevronDown, Loader2, ArrowLeft, Save } from 'lucide-react'
import toast from 'react-hot-toast'
import Link from 'next/link'
import { VENTURE_CATEGORIES } from '@/lib/ventures'

const VENTURES = ['ENSTUDIO', 'ENTECH', 'ENMARK']

const toDateInput = (d) => d ? new Date(d).toISOString().split('T')[0] : ''
const today = () => new Date().toISOString().split('T')[0]

const VENTURE_LABELS = { ENSTUDIO: 'Enstudio', ENTECH: 'Entech', ENMARK: 'Enmark' }

function ItemCard({ item, idx, onChange, onRemove }) {
  const venture    = item.venture || ''
  const categories = venture ? Object.keys(VENTURE_CATEGORIES[venture] || {}) : []
  const services   = (venture && item.service_category)
    ? (VENTURE_CATEGORIES[venture][item.service_category] || [])
    : []

  function upd(field, val) {
    const updated = { ...item, [field]: val }
    if (field === 'venture')          { updated.service_category = ''; updated.service = '' }
    if (field === 'service_category') { updated.service = '' }
    if (field === 'quantity' || field === 'rate') {
      updated.amount = (Number(updated.quantity) || 0) * (Number(updated.rate) || 0)
    }
    onChange(idx, updated)
  }

  const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 focus:border-transparent'
  const labelCls = 'block text-xs text-gray-500 mb-1 font-medium'

  return (
    <div className="border border-gray-100 rounded-xl p-4 space-y-3 bg-gray-50/50">
      {/* Row 1: index + delete */}
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-gray-400 uppercase tracking-wide">Item {idx + 1}</span>
        <button type="button" onClick={() => onRemove(idx)}
          className="p-1 rounded-lg text-gray-300 hover:text-red-500 hover:bg-red-50 transition-colors">
          <Trash2 className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Description — full width */}
      <div>
        <label className={labelCls}>Description</label>
        <input value={item.description} onChange={e => upd('description', e.target.value)}
          placeholder="Describe the service or deliverable…"
          className={inputCls} />
      </div>

      {/* Venture + Category + Service */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={labelCls}>Venture</label>
          <select value={item.venture} onChange={e => upd('venture', e.target.value)} className={inputCls}>
            <option value="">None</option>
            {VENTURES.map(v => <option key={v} value={v}>{VENTURE_LABELS[v] ?? v}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Category</label>
          <select value={item.service_category || ''} onChange={e => upd('service_category', e.target.value)}
            disabled={!categories.length} className={inputCls + (categories.length ? '' : ' opacity-40 cursor-not-allowed')}>
            <option value="">— Category —</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        </div>
        <div>
          <label className={labelCls}>Service</label>
          <select value={item.service || ''} onChange={e => upd('service', e.target.value)}
            disabled={!services.length} className={inputCls + (services.length ? '' : ' opacity-40 cursor-not-allowed')}>
            <option value="">— Service —</option>
            {services.map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </div>
      </div>

      {/* Qty + Rate + Amount */}
      <div className="grid grid-cols-3 gap-3">
        <div>
          <label className={labelCls}>Quantity</label>
          <input type="number" min="1" value={item.quantity} onChange={e => upd('quantity', e.target.value)}
            className={inputCls + ' text-right'} />
        </div>
        <div>
          <label className={labelCls}>Rate (৳)</label>
          <input type="number" min="0" value={item.rate} onChange={e => upd('rate', e.target.value)}
            placeholder="0" className={inputCls + ' text-right'} />
        </div>
        <div>
          <label className={labelCls}>Amount</label>
          <div className="w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white text-right font-semibold text-gray-800">
            ৳ {(item.amount || 0).toLocaleString()}
          </div>
        </div>
      </div>
    </div>
  )
}

const emptyItem = () => ({ description: '', venture: '', service_category: '', service: '', quantity: 1, rate: '', amount: 0 })

export default function NewQuotationPage() {
  const router = useRouter()
  const [saving, setSaving] = useState(false)

  // Source
  const [sourceType, setSourceType] = useState('LEAD')
  const [leads,   setLeads]   = useState([])
  const [clients, setClients] = useState([])
  const [leadId,   setLeadId]   = useState('')
  const [clientId, setClientId] = useState('')

  // Recipient (snapshot)
  const [recipientName,    setRecipientName]    = useState('')
  const [recipientCompany, setRecipientCompany] = useState('')
  const [recipientEmail,   setRecipientEmail]   = useState('')
  const [recipientPhone,   setRecipientPhone]   = useState('')
  const [recipientAddress, setRecipientAddress] = useState('')

  // Items
  const [items, setItems] = useState([emptyItem()])

  // Financials
  const [taxRate,  setTaxRate]  = useState(0)
  const [discount, setDiscount] = useState(0)

  // Dates
  const [issueDate,  setIssueDate]  = useState(today())
  const [validUntil, setValidUntil] = useState('')

  // Misc
  const [currency, setCurrency] = useState('BDT')
  const [notes, setNotes]       = useState('')
  const [terms, setTerms]       = useState('')

  // Computed
  const subtotal  = items.reduce((s, i) => s + (Number(i.amount) || 0), 0)
  const taxAmount = subtotal * (Number(taxRate) / 100)
  const total     = subtotal + taxAmount - Number(discount)

  // Load leads/clients
  useEffect(() => {
    fetch('/api/leads?limit=200').then(r => r.json()).then(j => setLeads(j.data ?? []))
    fetch('/api/clients?limit=200').then(r => r.json()).then(j => setClients(j.data ?? []))
  }, [])

  // Auto-fill recipient when lead/client selected
  useEffect(() => {
    if (sourceType === 'LEAD' && leadId) {
      const l = leads.find(x => x.id === leadId || x._id === leadId)
      if (l) {
        setRecipientName(l.name || '')
        setRecipientCompany(l.company || '')
        setRecipientEmail(l.email || '')
        setRecipientPhone(l.phone || '')
        setRecipientAddress(l.location || '')
      }
    }
  }, [leadId, leads, sourceType])

  useEffect(() => {
    if (sourceType === 'CLIENT' && clientId) {
      const c = clients.find(x => x.id === clientId || x._id === clientId)
      if (c) {
        setRecipientName(c.contactPerson || c.userId?.name || '')
        setRecipientCompany(c.company || '')
        setRecipientEmail(c.userId?.email || '')
        setRecipientPhone(c.userId?.phone || '')
        setRecipientAddress([c.address, c.city, c.country].filter(Boolean).join(', '))
      }
    }
  }, [clientId, clients, sourceType])

  function updateItem(idx, updated) {
    setItems(prev => prev.map((it, i) => i === idx ? updated : it))
  }
  function removeItem(idx) {
    setItems(prev => prev.filter((_, i) => i !== idx))
  }
  function addItem() {
    setItems(prev => [...prev, emptyItem()])
  }

  async function save(e) {
    e.preventDefault()
    if (!items.length) return toast.error('Add at least one item')
    if (sourceType === 'LEAD' && !leadId)     return toast.error('Select a lead')
    if (sourceType === 'CLIENT' && !clientId) return toast.error('Select a client')

    setSaving(true)
    try {
      const payload = {
        sourceType,
        leadId:   sourceType === 'LEAD'   ? leadId   : null,
        clientId: sourceType === 'CLIENT' ? clientId : null,
        recipientName, recipientCompany, recipientEmail, recipientPhone, recipientAddress,
        items: items.map(({ service_category, ...rest }) => ({ ...rest, quantity: Number(rest.quantity) || 1, rate: Number(rest.rate) || 0 })),
        issueDate, validUntil: validUntil || null,
        taxRate: Number(taxRate), discount: Number(discount),
        currency, notes: notes || null, terms: terms || null,
      }
      const res  = await fetch('/api/quotations', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Quotation created')
      router.push(`/admin/quotations/${json.data.id}`)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const fmt = (n) => `৳ ${(n ?? 0).toLocaleString('en-BD', { minimumFractionDigits: 2 })}`

  return (
    <form onSubmit={save} className="space-y-6 max-w-6xl">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <Link href="/admin/quotations" className="p-2 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-700 transition-colors">
            <ArrowLeft className="w-4 h-4" />
          </Link>
          <div>
            <h1 className="text-xl font-semibold text-gray-900">New Quotation</h1>
            <p className="text-sm text-gray-400 mt-0.5">Auto-numbered on save</p>
          </div>
        </div>
        <button type="submit" disabled={saving}
          className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-gray-800 disabled:opacity-50 transition-colors">
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Save Quotation
        </button>
      </div>

      <div className="grid grid-cols-3 gap-6">
        {/* Left column: Source + Recipient */}
        <div className="col-span-2 space-y-6">

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
              <select value={leadId} onChange={e => setLeadId(e.target.value)} required
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900">
                <option value="">— Select Lead —</option>
                {leads.map(l => (
                  <option key={l.id || l._id} value={l.id || l._id}>{l.name}{l.company ? ` (${l.company})` : ''}</option>
                ))}
              </select>
            ) : (
              <select value={clientId} onChange={e => setClientId(e.target.value)} required
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900">
                <option value="">— Select Client —</option>
                {clients.map(c => (
                  <option key={c.id || c._id} value={c.id || c._id}>{c.company}{c.contactPerson ? ` — ${c.contactPerson}` : ''}</option>
                ))}
              </select>
            )}
          </div>

          {/* Recipient info */}
          <div className="bg-white border border-gray-100 rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-semibold text-gray-700">Recipient Details <span className="font-normal text-gray-400">(snapshot — edit freely)</span></h2>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs text-gray-500 mb-1">Name</label>
                <input value={recipientName} onChange={e => setRecipientName(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Company</label>
                <input value={recipientCompany} onChange={e => setRecipientCompany(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Email</label>
                <input type="email" value={recipientEmail} onChange={e => setRecipientEmail(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">Phone</label>
                <input value={recipientPhone} onChange={e => setRecipientPhone(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
              </div>
              <div className="col-span-2">
                <label className="block text-xs text-gray-500 mb-1">Address</label>
                <input value={recipientAddress} onChange={e => setRecipientAddress(e.target.value)}
                  className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
              </div>
            </div>
          </div>

          {/* Line items */}
          <div className="bg-white border border-gray-100 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-semibold text-gray-700">Items</h2>
            {items.map((item, idx) => (
              <ItemCard key={idx} item={item} idx={idx} onChange={updateItem} onRemove={removeItem} />
            ))}
            <button type="button" onClick={addItem}
              className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 font-medium pt-1">
              <Plus className="w-4 h-4" /> Add Item
            </button>
          </div>

          {/* Notes & Terms */}
          <div className="grid grid-cols-2 gap-4">
            <div className="bg-white border border-gray-100 rounded-xl p-4">
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Notes</label>
              <textarea value={notes} onChange={e => setNotes(e.target.value)} rows={4}
                placeholder="Any notes for the client…"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400 resize-none" />
            </div>
            <div className="bg-white border border-gray-100 rounded-xl p-4">
              <label className="block text-xs font-semibold text-gray-500 uppercase tracking-wide mb-2">Terms & Conditions</label>
              <textarea value={terms} onChange={e => setTerms(e.target.value)} rows={4}
                placeholder="Payment terms, validity, etc…"
                className="w-full text-sm border border-gray-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-gray-400 resize-none" />
            </div>
          </div>
        </div>

        {/* Right column: Dates, Financials */}
        <div className="space-y-4">
          {/* Dates */}
          <div className="bg-white border border-gray-100 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-semibold text-gray-700">Dates</h2>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Issue Date</label>
              <input type="date" value={issueDate} onChange={e => setIssueDate(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Valid Until</label>
              <input type="date" value={validUntil} onChange={e => setValidUntil(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
            </div>
            <div>
              <label className="block text-xs text-gray-500 mb-1">Currency</label>
              <select value={currency} onChange={e => setCurrency(e.target.value)}
                className="w-full border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900">
                <option value="BDT">BDT (৳)</option>
                <option value="USD">USD ($)</option>
                <option value="EUR">EUR (€)</option>
                <option value="GBP">GBP (£)</option>
              </select>
            </div>
          </div>

          {/* Totals */}
          <div className="bg-white border border-gray-100 rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-semibold text-gray-700">Summary</h2>
            <div className="flex justify-between text-sm text-gray-600">
              <span>Subtotal</span><span className="font-medium">{fmt(subtotal)}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm text-gray-600 whitespace-nowrap">Tax (%)</label>
              <input type="number" min="0" max="100" step="0.5" value={taxRate}
                onChange={e => setTaxRate(e.target.value)}
                className="w-20 border border-gray-200 rounded-lg px-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-gray-400" />
            </div>
            {taxAmount > 0 && (
              <div className="flex justify-between text-sm text-gray-500">
                <span>Tax Amount</span><span>{fmt(taxAmount)}</span>
              </div>
            )}
            <div className="flex items-center justify-between gap-2">
              <label className="text-sm text-gray-600 whitespace-nowrap">Discount (৳)</label>
              <input type="number" min="0" value={discount}
                onChange={e => setDiscount(e.target.value)}
                className="w-24 border border-gray-200 rounded-lg px-2 py-1 text-sm text-right focus:outline-none focus:ring-1 focus:ring-gray-400" />
            </div>
            <div className="border-t border-gray-100 pt-3 flex justify-between">
              <span className="text-sm font-semibold text-gray-700">Total</span>
              <span className="text-base font-bold text-gray-900">{fmt(total)}</span>
            </div>
          </div>
        </div>
      </div>
    </form>
  )
}
