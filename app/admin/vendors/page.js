'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import {
  Plus, Search, X, Loader2, Pencil, Trash2,
  Building2, Phone, Mail, Globe, MapPin, Tag, FileText, Settings2,
  ShoppingCart, Receipt,
} from 'lucide-react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { dhakaDayKey } from '@/lib/dhakaTime'
import { usePermission } from '@/components/auth/Can'
import TaxCodeSelect from '@/components/tax/TaxCodeSelect'
import { BIN_REGEX, TIN_REGEX, normalizeBin } from '@/lib/tax/catalog'

const fmtDate = (d) => d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const fmt     = (n) => `৳ ${(Number(n) || 0).toLocaleString('en-BD', { minimumFractionDigits: 2 })}`
const fmtCur  = (n, currency) => (!currency || currency === 'BDT')
  ? fmt(n)
  : `${currency} ${(Number(n) || 0).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

// ─── Tax identity helpers ─────────────────────────────────────────────────────

const VAT_REGISTRATION_TYPES = [
  { value: 'REGISTERED',   label: 'VAT registered (has BIN)' },
  { value: 'TURNOVER',     label: 'Turnover tax enlisted' },
  { value: 'UNREGISTERED', label: 'Not VAT registered' },
  { value: 'FOREIGN',      label: 'Foreign supplier' },
]
const VAT_REG_LABELS = Object.fromEntries(VAT_REGISTRATION_TYPES.map(t => [t.value, t.label]))

const PAYEE_TYPES = [
  { value: 'COMPANY',      label: 'Company / firm' },
  { value: 'INDIVIDUAL',   label: 'Individual / proprietor' },
  { value: 'NON_RESIDENT', label: 'Non-resident (foreign)' },
]
const PAYEE_LABELS = Object.fromEntries(PAYEE_TYPES.map(t => [t.value, t.label]))

const BILL_STATUS_COLORS = {
  DRAFT:     'bg-gray-100 text-gray-600',
  RECEIVED:  'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-700',
}
const BILL_PAYMENT_COLORS = {
  UNPAID:    'bg-yellow-50 text-yellow-700',
  REQUESTED: 'bg-blue-50 text-blue-700',
  PAID:      'bg-green-50 text-green-700',
}

// Masked placeholders from the API ('••••••••9012') are never validated or re-sent.
const isMaskedValue = v => typeof v === 'string' && v.includes('••')
const binDigits = v => String(v ?? '').replace(/\s+/g, '')
const tinDigits = v => String(v ?? '').replace(/[\s-]+/g, '')

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

// code → label map for tax codes (cached per page load).
const taxCodeCache = {}
function useTaxCodeLabels(kind, enabled) {
  const [labels, setLabels] = useState(() => taxCodeCache[kind] ?? null)
  useEffect(() => {
    if (!enabled || taxCodeCache[kind]) { if (taxCodeCache[kind]) setLabels(taxCodeCache[kind]); return }
    let alive = true
    fetch(`/api/tax/codes?kind=${kind}`)
      .then(r => (r.ok ? r.json() : null))
      .then(j => {
        const map = Object.fromEntries((Array.isArray(j?.data) ? j.data : []).map(c => [c.code, c.label]))
        taxCodeCache[kind] = map
        if (alive) setLabels(map)
      })
      .catch(() => {})
    return () => { alive = false }
  }, [kind, enabled])
  return labels ?? {}
}

// ─── Service Types Manager Modal ──────────────────────────────────────────────

function ServiceTypesModal({ types, onClose, onSaved }) {
  const [list,    setList]    = useState([...types])
  const [newType, setNewType] = useState('')
  const [saving,  setSaving]  = useState(false)

  function add() {
    const t = newType.trim()
    if (!t) return
    if (list.includes(t)) { toast.error('Already exists'); return }
    setList(l => [...l, t])
    setNewType('')
  }

  function remove(i) { setList(l => l.filter((_, idx) => idx !== i)) }

  async function save() {
    setSaving(true)
    try {
      const res  = await fetch('/api/vendors/service-types', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ types: list }),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error)
      toast.success('Service types saved')
      onSaved(json.data)
      onClose()
    } catch (err) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl border border-gray-200 w-full max-w-sm p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">Manage Service Types</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100"><X className="w-4 h-4 text-gray-400" /></button>
        </div>

        {/* Add new */}
        <div className="flex gap-2">
          <input
            value={newType}
            onChange={e => setNewType(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && add()}
            placeholder="New service type…"
            className="flex-1 border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
          />
          <button onClick={add}
            className="px-3 py-2 bg-gray-900 text-white text-sm rounded-lg hover:bg-gray-800 flex items-center gap-1">
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* List */}
        <div className="space-y-1.5 max-h-64 overflow-y-auto">
          {list.length === 0 && <p className="text-xs text-gray-400 text-center py-4">No service types yet</p>}
          {list.map((t, i) => (
            <div key={i} className="flex items-center justify-between px-3 py-2 bg-gray-50 rounded-lg">
              <span className="text-sm text-gray-700">{t}</span>
              <button onClick={() => remove(i)} className="p-1 text-gray-400 hover:text-red-500 transition-colors">
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          ))}
        </div>

        <div className="flex gap-2 justify-end pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-40 flex items-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />} Save
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Vendor Modal ─────────────────────────────────────────────────────────────

function VendorModal({ vendor, onClose, onSaved, serviceTypes = [] }) {
  const isEdit = !!vendor
  const [form, setForm] = useState({
    company:     vendor?.company     ?? '',
    contactName: vendor?.contactName ?? '',
    email:       vendor?.email       ?? '',
    phone:       vendor?.phone       ?? '',
    serviceType: vendor?.serviceType ?? '',
    address:     vendor?.address     ?? '',
    website:     vendor?.website     ?? '',
    notes:       vendor?.notes       ?? '',
    // Tax identity & withholding defaults
    bin:                   vendor?.bin                   ?? '',
    tin:                   vendor?.tin                   ?? '',
    tradeLicense:          vendor?.tradeLicense          ?? '',
    vatRegistrationType:   vendor?.vatRegistrationType   ?? '',
    payeeType:             vendor?.payeeType             ?? 'COMPANY',
    hasPsr:                !!vendor?.hasPsr,
    defaultTdsSection:     vendor?.defaultTdsSection     ?? '',
    defaultVatServiceCode: vendor?.defaultVatServiceCode ?? '',
  })
  const [saving, setSaving] = useState(false)
  const initialTin = vendor?.tin ?? ''

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  // A valid BIN marks the vendor VAT registered when no status is set yet.
  function setBin(v) {
    setForm(f => ({
      ...f,
      bin: v,
      vatRegistrationType: !f.vatRegistrationType && BIN_REGEX.test(binDigits(v)) ? 'REGISTERED' : f.vatRegistrationType,
    }))
  }

  const binInvalid   = !!binDigits(form.bin) && !BIN_REGEX.test(binDigits(form.bin))
  const tinUntouched = isMaskedValue(form.tin) && form.tin === initialTin
  const tinMaskEdit  = isMaskedValue(form.tin) && form.tin !== initialTin
  const tinInvalid   = !!tinDigits(form.tin) && !tinUntouched && !TIN_REGEX.test(tinDigits(form.tin))

  async function save() {
    if (!form.company.trim()) { toast.error('Company name is required'); return }
    if (binInvalid)  { toast.error('BIN must be 9 or 13 digits, e.g. 000123456-0101'); return }
    if (tinMaskEdit) { toast.error('Clear the hidden TIN fully, then type the full 12-digit e-TIN'); return }
    if (tinInvalid)  { toast.error('TIN must be the 12-digit e-TIN'); return }
    setSaving(true)
    try {
      const url    = isEdit ? `/api/vendors/${vendor.id}` : '/api/vendors'
      const method = isEdit ? 'PUT' : 'POST'
      const bin    = binDigits(form.bin)
      const body   = {
        ...form,
        email:   form.email   || null,
        website: form.website || null,
        bin:     bin ? (normalizeBin(bin) || bin) : null,
        tin:     tinDigits(form.tin) || null,
        tradeLicense:          form.tradeLicense.trim() || null,
        vatRegistrationType:   form.vatRegistrationType || null,
        payeeType:             form.payeeType || 'COMPANY',
        hasPsr:                !!form.hasPsr,
        defaultTdsSection:     form.defaultTdsSection || null,
        defaultVatServiceCode: form.defaultVatServiceCode || null,
      }
      // An untouched (masked) TIN is left as stored.
      if (tinUntouched) delete body.tin
      const res    = await fetch(url, {
        method, headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const json = await res.json()
      if (!res.ok) throw new Error(firstValidationMessage(json) ?? json.error ?? 'Failed')
      toast.success(isEdit ? 'Vendor updated' : 'Vendor added')
      onSaved(); onClose()
    } catch (err) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  const ic = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900'
  const lc = 'block text-xs font-medium text-gray-500 mb-1'
  const hc = 'text-xs text-gray-400 mt-1'

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl border border-gray-200 w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">{isEdit ? 'Edit Vendor' : 'Add Vendor'}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100"><X className="w-4 h-4 text-gray-400" /></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">Company Name *</label>
            <input value={form.company} onChange={e => set('company', e.target.value)} placeholder="e.g. Acme Supplies Ltd." className={ic} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Contact Person</label>
            <input value={form.contactName} onChange={e => set('contactName', e.target.value)} placeholder="Full name" className={ic} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Phone</label>
            <input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+880…" className={ic} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Email</label>
            <input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="vendor@example.com" className={ic} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Service Type</label>
            <select value={form.serviceType} onChange={e => set('serviceType', e.target.value)} className={ic}>
              <option value="">Select…</option>
              {serviceTypes.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">Website</label>
            <input value={form.website} onChange={e => set('website', e.target.value)} placeholder="https://…" className={ic} />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">Address</label>
            <input value={form.address} onChange={e => set('address', e.target.value)} placeholder="Street, City, Country" className={ic} />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3} placeholder="Payment terms, special instructions…" className={`${ic} resize-none`} />
          </div>
        </div>

        {/* ── Tax identity ── */}
        <div className="border-t border-gray-100 pt-4 space-y-3">
          <div>
            <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Tax identity</p>
            <p className="text-xs text-gray-400 mt-0.5">Used for input VAT credit, VDS (Mushak-6.6) and TDS when you pay this vendor.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={lc}>BIN</label>
              <input value={form.bin} onChange={e => setBin(e.target.value)} inputMode="numeric"
                placeholder="000123456-0101" className={`${ic} font-mono ${binInvalid ? 'border-red-300' : ''}`} />
              <p className={binInvalid ? 'text-xs text-red-500 mt-1' : hc}>
                {binInvalid ? 'BIN must be 9 or 13 digits' : '13 digits, e.g. 000123456-0101'}
              </p>
            </div>
            <div>
              <label className={lc}>TIN (e-TIN)</label>
              <input value={form.tin} onChange={e => set('tin', e.target.value)} inputMode="numeric"
                placeholder="12-digit e-TIN" className={`${ic} font-mono ${tinInvalid || tinMaskEdit ? 'border-red-300' : ''}`} />
              <p className={tinInvalid || tinMaskEdit ? 'text-xs text-red-500 mt-1' : hc}>
                {tinMaskEdit ? 'Clear the hidden TIN fully, then type the new one'
                  : tinInvalid ? 'TIN must be 12 digits'
                  : tinUntouched ? 'Hidden for privacy. Leave as is or replace it.'
                  : 'Printed on the TDS certificate you issue'}
              </p>
            </div>
            <div>
              <label className={lc}>VAT status</label>
              <select value={form.vatRegistrationType} onChange={e => set('vatRegistrationType', e.target.value)} className={ic}>
                <option value="">Not specified</option>
                {VAT_REGISTRATION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
              {['TURNOVER', 'UNREGISTERED'].includes(form.vatRegistrationType) && (
                <p className="text-xs text-amber-600 mt-1">No input VAT credit and no VDS on purchases from this vendor.</p>
              )}
              {form.vatRegistrationType === 'FOREIGN' && (
                <p className={hc}>No BIN or Mushak-6.3 from a foreign supplier.</p>
              )}
            </div>
            <div>
              <label className={lc}>Trade licence no.</label>
              <input value={form.tradeLicense} onChange={e => set('tradeLicense', e.target.value)} placeholder="Optional" className={ic} />
            </div>
            <div>
              <label className={lc}>Payee type (for TDS rate)</label>
              <select value={form.payeeType} onChange={e => set('payeeType', e.target.value)} className={ic}>
                {PAYEE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </select>
            </div>
            <div className="flex items-end">
              <label className="flex items-start gap-2 cursor-pointer pb-1">
                <input type="checkbox" checked={form.hasPsr} onChange={e => set('hasPsr', e.target.checked)}
                  className="mt-0.5 w-4 h-4 rounded border-gray-300 text-gray-900 focus:ring-gray-900" />
                <span>
                  <span className="block text-sm font-medium text-gray-800">PSR on file</span>
                  <span className="block text-xs text-gray-400">Proof of return submission. Without it TDS is 50% higher (ITA 2023 s.142).</span>
                </span>
              </label>
            </div>
            <div>
              <label className={lc}>Default TDS section</label>
              <TaxCodeSelect kind="TDS_SECTION" value={form.defaultTdsSection || null}
                onChange={code => set('defaultTdsSection', code ?? '')} placeholder="Select section…" className={ic} />
            </div>
            <div>
              <label className={lc}>Default VAT service code</label>
              <TaxCodeSelect kind="VAT_SERVICE" value={form.defaultVatServiceCode || null}
                onChange={code => set('defaultVatServiceCode', code ?? '')} placeholder="Select service…" className={ic} />
            </div>
          </div>
        </div>

        <div className="flex gap-2 justify-end pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-40 flex items-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {isEdit ? 'Save Changes' : 'Add Vendor'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Delete Confirm ───────────────────────────────────────────────────────────

function DeleteConfirm({ vendor, onClose, onDeleted }) {
  const [deleting, setDeleting] = useState(false)

  async function confirm() {
    setDeleting(true)
    try {
      const res = await fetch(`/api/vendors/${vendor.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Vendor deleted')
      onDeleted(); onClose()
    } catch (err) { toast.error(err.message) }
    finally { setDeleting(false) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl border border-gray-200 w-full max-w-sm p-6 space-y-4">
        <h3 className="text-base font-semibold text-gray-900">Delete Vendor</h3>
        <p className="text-sm text-gray-500">Are you sure you want to delete <strong>{vendor.company}</strong>? This cannot be undone.</p>
        <div className="flex gap-2 justify-end">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={confirm} disabled={deleting}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 rounded-lg hover:bg-red-700 disabled:opacity-40 flex items-center gap-2">
            {deleting && <Loader2 className="w-4 h-4 animate-spin" />} Delete
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Purchase Modal ───────────────────────────────────────────────────────────

const STATUS_COLORS = {
  pending:   'bg-yellow-100 text-yellow-700',
  received:  'bg-green-100 text-green-700',
  cancelled: 'bg-red-100 text-red-700',
}

function PurchaseModal({ vendorId, purchase, onClose, onSaved }) {
  const isEdit = !!purchase
  const today  = dhakaDayKey()
  const [form, setForm] = useState({
    item:        purchase?.item        ?? '',
    description: purchase?.description ?? '',
    quantity:    purchase?.quantity    ?? 1,
    unitPrice:   purchase?.unitPrice   ?? '',
    totalAmount: purchase?.totalAmount ?? '',
    date:        purchase?.date ? purchase.date.slice(0, 10) : today,
    category:    purchase?.category    ?? '',
    status:      purchase?.status      ?? 'pending',
    invoiceRef:  purchase?.invoiceRef  ?? '',
    notes:       purchase?.notes       ?? '',
  })
  const [saving, setSaving] = useState(false)
  const ic = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900'

  function set(k, v) { setForm(f => ({ ...f, [k]: v })) }

  // Auto-calculate total when qty or unit price changes
  function handleQty(v) {
    const q = parseFloat(v) || 0
    setForm(f => ({ ...f, quantity: q, totalAmount: (q * (parseFloat(f.unitPrice) || 0)).toFixed(2) }))
  }
  function handleUnit(v) {
    const u = parseFloat(v) || 0
    setForm(f => ({ ...f, unitPrice: v, totalAmount: ((parseFloat(f.quantity) || 0) * u).toFixed(2) }))
  }

  async function save() {
    if (!form.item.trim())   { toast.error('Item name is required'); return }
    if (!form.unitPrice)     { toast.error('Unit price is required'); return }
    if (!form.date)          { toast.error('Date is required'); return }
    setSaving(true)
    try {
      const url    = isEdit ? `/api/purchases/${purchase.id}` : '/api/purchases'
      const method = isEdit ? 'PUT' : 'POST'
      const body   = {
        ...form,
        vendorId,
        quantity:    parseFloat(form.quantity)    || 1,
        unitPrice:   parseFloat(form.unitPrice)   || 0,
        totalAmount: parseFloat(form.totalAmount) || 0,
        description: form.description || null,
        category:    form.category    || null,
        invoiceRef:  form.invoiceRef  || null,
        notes:       form.notes       || null,
      }
      const res  = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Failed')
      toast.success(isEdit ? 'Purchase updated' : 'Purchase added')
      onSaved(); onClose()
    } catch (err) { toast.error(err.message) }
    finally { setSaving(false) }
  }

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl border border-gray-200 w-full max-w-lg p-6 space-y-4 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between">
          <h3 className="text-base font-semibold text-gray-900">{isEdit ? 'Edit Purchase' : 'Add Purchase'}</h3>
          <button onClick={onClose} className="p-1 rounded-lg hover:bg-gray-100"><X className="w-4 h-4 text-gray-400" /></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">Item / Product *</label>
            <input value={form.item} onChange={e => set('item', e.target.value)} placeholder="e.g. Office Chair" className={ic} />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">Description</label>
            <input value={form.description} onChange={e => set('description', e.target.value)} placeholder="Optional details" className={ic} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Quantity</label>
            <input type="number" min="0" value={form.quantity} onChange={e => handleQty(e.target.value)} className={ic} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Unit Price *</label>
            <input type="number" min="0" step="0.01" value={form.unitPrice} onChange={e => handleUnit(e.target.value)} placeholder="0.00" className={ic} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Total Amount</label>
            <input type="number" min="0" step="0.01" value={form.totalAmount} onChange={e => set('totalAmount', e.target.value)} placeholder="0.00" className={ic} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Date *</label>
            <input type="date" value={form.date} onChange={e => set('date', e.target.value)} className={ic} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Category</label>
            <input value={form.category} onChange={e => set('category', e.target.value)} placeholder="e.g. Hardware" className={ic} />
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Status</label>
            <select value={form.status} onChange={e => set('status', e.target.value)} className={ic}>
              <option value="pending">Pending</option>
              <option value="received">Received</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">Invoice / Bill Ref</label>
            <input value={form.invoiceRef} onChange={e => set('invoiceRef', e.target.value)} placeholder="INV-001" className={ic} />
          </div>
          <div className="col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} className={`${ic} resize-none`} />
          </div>
        </div>

        <div className="flex gap-2 justify-end pt-1">
          <button onClick={onClose} className="px-4 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50">Cancel</button>
          <button onClick={save} disabled={saving}
            className="px-4 py-2 text-sm font-medium text-white bg-gray-900 rounded-lg hover:bg-gray-800 disabled:opacity-40 flex items-center gap-2">
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            {isEdit ? 'Save Changes' : 'Add Purchase'}
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Vendor Detail Panel ──────────────────────────────────────────────────────

// Read-only list of the vendor's purchase bills (inventory module). The bills
// API may be unavailable or forbidden for this user — degrade quietly.
function VendorPurchaseBills({ vendorId }) {
  const { can, ready } = usePermission()
  const [state, setState] = useState({ loading: true, rows: [], total: 0, status: 'ok' })

  useEffect(() => {
    let alive = true
    setState(s => ({ ...s, loading: true }))
    fetch(`/api/inventory/purchases?vendorId=${encodeURIComponent(vendorId)}&limit=10`)
      .then(async res => {
        if (!alive) return
        if (res.status === 403) { setState({ loading: false, rows: [], total: 0, status: 'forbidden' }); return }
        if (!res.ok)            { setState({ loading: false, rows: [], total: 0, status: 'unavailable' }); return }
        const json = await res.json().catch(() => ({}))
        if (!alive) return
        const rows = Array.isArray(json?.data) ? json.data : []
        setState({ loading: false, rows, total: Number(json?.meta?.total) || rows.length, status: 'ok' })
      })
      .catch(() => { if (alive) setState({ loading: false, rows: [], total: 0, status: 'unavailable' }) })
    return () => { alive = false }
  }, [vendorId])

  const canCreate = ready && can('inventory.purchase')

  return (
    <div>
      <div className="flex items-center justify-between mb-3 gap-2">
        <h4 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
          <ShoppingCart className="w-4 h-4 text-gray-400" /> Purchase bills
        </h4>
        <div className="flex items-center gap-3">
          {state.status === 'ok' && state.total > state.rows.length && (
            <Link href={`/admin/inventory/purchases?vendorId=${encodeURIComponent(vendorId)}`} className="text-xs text-blue-600 hover:underline">
              View all {state.total}
            </Link>
          )}
          {canCreate && state.status === 'ok' && (
            <Link href={`/admin/inventory/purchases/new?vendorId=${encodeURIComponent(vendorId)}`}
              className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800">
              <Plus className="w-3.5 h-3.5" /> New bill
            </Link>
          )}
        </div>
      </div>

      {state.loading ? (
        <div className="flex justify-center py-4"><Loader2 className="w-4 h-4 animate-spin text-gray-400" /></div>
      ) : state.status === 'forbidden' ? (
        <p className="text-xs text-gray-400 text-center py-4 border border-dashed border-gray-200 rounded-lg">
          You don&apos;t have access to purchase bills (Inventory permission needed).
        </p>
      ) : state.status === 'unavailable' ? (
        <p className="text-xs text-gray-400 text-center py-4 border border-dashed border-gray-200 rounded-lg">
          Purchase bills couldn&apos;t be loaded right now.
        </p>
      ) : state.rows.length === 0 ? (
        <p className="text-xs text-gray-400 text-center py-4 border border-dashed border-gray-200 rounded-lg">
          No purchase bills from this vendor yet. Record equipment and supply purchases in Inventory → Purchases.
        </p>
      ) : (
        <div className="divide-y divide-gray-50 border border-gray-100 rounded-lg overflow-hidden">
          {state.rows.map(b => {
            const id = b.id ?? b._id
            const payStatus = b.payment?.status
            return (
              <Link key={id} href={`/admin/inventory/purchases/${id}`}
                className="flex items-start justify-between px-4 py-3 gap-3 hover:bg-gray-50 transition-colors">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-800 truncate">
                    {b.billNo || 'Draft bill'}
                    {b.supplierInvoiceNo ? <span className="text-gray-400 font-normal"> · {b.supplierInvoiceNo}</span> : null}
                  </p>
                  <p className="text-xs text-gray-400">
                    {fmtDate(b.billDate)}
                    {b.mushakNo ? ` · Mushak ${b.mushakNo}` : ''}
                    {Array.isArray(b.lines) ? ` · ${b.lines.length} line${b.lines.length !== 1 ? 's' : ''}` : ''}
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1 shrink-0">
                  <span className="text-sm font-semibold text-gray-800">{fmtCur(b.total, b.currency)}</span>
                  <div className="flex items-center gap-1">
                    {b.status && (
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${BILL_STATUS_COLORS[b.status] ?? 'bg-gray-100 text-gray-600'}`}>
                        {String(b.status).toLowerCase()}
                      </span>
                    )}
                    {payStatus && b.status === 'RECEIVED' && (
                      <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${BILL_PAYMENT_COLORS[payStatus] ?? 'bg-gray-100 text-gray-600'}`}>
                        {String(payStatus).toLowerCase()}
                      </span>
                    )}
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}

// Vendor tax identity summary (BIN / TIN / VAT status / TDS defaults).
function VendorTaxIdentity({ vendor, onEdit }) {
  const tdsLabels = useTaxCodeLabels('TDS_SECTION', !!vendor.defaultTdsSection)
  const vatLabels = useTaxCodeLabels('VAT_SERVICE', !!vendor.defaultVatServiceCode)
  const items = [
    ['BIN', vendor.bin, true],
    ['TIN (e-TIN)', vendor.tin, true],
    ['VAT status', VAT_REG_LABELS[vendor.vatRegistrationType], false],
    ['Trade licence', vendor.tradeLicense, false],
    ['Payee type', PAYEE_LABELS[vendor.payeeType] ?? PAYEE_LABELS.COMPANY, false],
    ['Default TDS section', vendor.defaultTdsSection
      ? `${vendor.defaultTdsSection}${tdsLabels[vendor.defaultTdsSection] ? ` — ${tdsLabels[vendor.defaultTdsSection]}` : ''}` : null, false],
    ['Default VAT service', vendor.defaultVatServiceCode
      ? `${vendor.defaultVatServiceCode}${vatLabels[vendor.defaultVatServiceCode] ? ` — ${vatLabels[vendor.defaultVatServiceCode]}` : ''}` : null, false],
  ]
  const noIdentity = !vendor.bin && !vendor.tin && !vendor.vatRegistrationType

  return (
    <div>
      <div className="flex items-center justify-between mb-3">
        <h4 className="text-sm font-semibold text-gray-800 flex items-center gap-2">
          <Receipt className="w-4 h-4 text-gray-400" /> Tax identity
        </h4>
        <span className={`text-[11px] font-medium px-2 py-0.5 rounded-full ${vendor.hasPsr ? 'bg-green-50 text-green-700' : 'bg-amber-50 text-amber-700'}`}>
          {vendor.hasPsr ? 'PSR on file' : 'No PSR — TDS +50%'}
        </span>
      </div>
      {noIdentity && (
        <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2 mb-3">
          No BIN or TIN on file. Without the supplier&apos;s BIN you can&apos;t claim input VAT.{' '}
          {onEdit && <button onClick={onEdit} className="font-medium underline">Add tax details</button>}
        </p>
      )}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-2 border border-gray-100 rounded-lg px-4 py-3">
        {items.map(([label, value, mono]) => (
          <div key={label} className="min-w-0">
            <p className="text-[11px] text-gray-400">{label}</p>
            <p className={`text-sm break-words ${value ? 'text-gray-800' : 'text-gray-300'} ${mono && value ? 'font-mono' : ''}`}>{value || '—'}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

function VendorDetail({ vendor, onClose, onEdit }) {
  const { data: session } = useSession()
  const [detail,       setDetail]       = useState(null)
  const [loading,      setLoading]      = useState(true)
  const [purchaseModal, setPurchaseModal] = useState(false)
  const [editPurchase, setEditPurchase] = useState(null)
  const [deletingId,   setDeletingId]   = useState(null)

  const canDelete = session?.user?.role === 'SUPER_ADMIN' || session?.user?.role === 'MANAGER'

  function loadDetail() {
    setLoading(true)
    fetch(`/api/vendors/${vendor.id}`)
      .then(r => r.json())
      .then(j => setDetail(j.data ?? null))
      .finally(() => setLoading(false))
  }

  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { loadDetail() }, [vendor.id])

  async function deletePurchase(p) {
    setDeletingId(p.id)
    try {
      const res = await fetch(`/api/purchases/${p.id}`, { method: 'DELETE' })
      if (!res.ok) throw new Error((await res.json()).error)
      toast.success('Purchase deleted')
      loadDetail()
    } catch (err) { toast.error(err.message) }
    finally { setDeletingId(null) }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/40 p-4">
      <div className="bg-white rounded-xl border border-gray-200 w-full max-w-2xl max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100 sticky top-0 bg-white z-10">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-gray-100 flex items-center justify-center">
              <Building2 className="w-5 h-5 text-gray-500" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-gray-900">{vendor.company}</h3>
              {vendor.serviceType && <p className="text-xs text-gray-400">{vendor.serviceType}</p>}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button onClick={onEdit} className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50">
              <Pencil className="w-3.5 h-3.5" /> Edit
            </button>
            <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100"><X className="w-4 h-4 text-gray-400" /></button>
          </div>
        </div>

        <div className="p-6 space-y-6">
          {/* Contact info */}
          <div className="grid grid-cols-2 gap-3">
            {vendor.contactName && (
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Tag className="w-4 h-4 text-gray-400 shrink-0" />
                <span>{vendor.contactName}</span>
              </div>
            )}
            {vendor.phone && (
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Phone className="w-4 h-4 text-gray-400 shrink-0" />
                <span>{vendor.phone}</span>
              </div>
            )}
            {vendor.email && (
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Mail className="w-4 h-4 text-gray-400 shrink-0" />
                <a href={`mailto:${vendor.email}`} className="text-blue-600 hover:underline truncate">{vendor.email}</a>
              </div>
            )}
            {vendor.website && (
              <div className="flex items-center gap-2 text-sm text-gray-600">
                <Globe className="w-4 h-4 text-gray-400 shrink-0" />
                <a href={vendor.website} target="_blank" rel="noreferrer" className="text-blue-600 hover:underline truncate">{vendor.website}</a>
              </div>
            )}
            {vendor.address && (
              <div className="flex items-center gap-2 text-sm text-gray-600 col-span-2">
                <MapPin className="w-4 h-4 text-gray-400 shrink-0" />
                <span>{vendor.address}</span>
              </div>
            )}
          </div>

          {vendor.notes && (
            <div className="bg-gray-50 rounded-lg px-4 py-3 text-sm text-gray-600 border border-gray-100">
              <p className="font-medium text-gray-700 mb-1 text-xs">Notes</p>
              <p className="whitespace-pre-wrap">{vendor.notes}</p>
            </div>
          )}

          <VendorTaxIdentity vendor={detail ?? vendor} onEdit={onEdit} />

          <VendorPurchaseBills vendorId={vendor.id} />

          {loading && (
            <div className="flex justify-center py-8">
              <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            </div>
          )}

          {detail && (
            <>
              {/* Purchases */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h4 className="text-sm font-semibold text-gray-800">Purchase records</h4>
                  <div className="flex items-center gap-3">
                    <span className="text-xs text-gray-400">Total: <strong>{fmt(detail.totalPurchased)}</strong></span>
                    {canDelete && (
                      <button onClick={() => setPurchaseModal(true)}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs font-medium bg-gray-900 text-white rounded-lg hover:bg-gray-800">
                        <Plus className="w-3.5 h-3.5" /> Add
                      </button>
                    )}
                  </div>
                </div>
                {detail.purchases?.length === 0 ? (
                  <p className="text-xs text-gray-400 text-center py-4 border border-dashed border-gray-200 rounded-lg">No purchases recorded</p>
                ) : (
                  <div className="divide-y divide-gray-50 border border-gray-100 rounded-lg overflow-hidden">
                    {detail.purchases.map(p => (
                      <div key={p._id ?? p.id} className="flex items-start justify-between px-4 py-3 gap-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-800 truncate">{p.item}</p>
                          <p className="text-xs text-gray-400">
                            {fmtDate(p.date)}
                            {p.category ? ` · ${p.category}` : ''}
                            {p.invoiceRef ? ` · ${p.invoiceRef}` : ''}
                          </p>
                          <p className="text-xs text-gray-500 mt-0.5">
                            {p.quantity} × {fmt(p.unitPrice)} = <strong>{fmt(p.totalAmount)}</strong>
                          </p>
                        </div>
                        <div className="flex items-center gap-2 shrink-0">
                          <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${STATUS_COLORS[p.status] ?? 'bg-gray-100 text-gray-600'}`}>
                            {p.status}
                          </span>
                          {canDelete && (
                            <>
                              <button onClick={() => setEditPurchase(p)}
                                className="p-1 rounded text-gray-400 hover:text-gray-700 hover:bg-gray-100">
                                <Pencil className="w-3 h-3" />
                              </button>
                              <button onClick={() => deletePurchase(p)} disabled={deletingId === (p._id ?? p.id)}
                                className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-red-50 disabled:opacity-40">
                                {deletingId === (p._id ?? p.id) ? <Loader2 className="w-3 h-3 animate-spin" /> : <Trash2 className="w-3 h-3" />}
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Payment history */}
              {detail.payments?.length > 0 && (
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <h4 className="text-sm font-semibold text-gray-800">Payment History</h4>
                    <span className="text-xs text-gray-400">Total paid: <strong>{fmt(detail.totalPaid)}</strong></span>
                  </div>
                  <div className="divide-y divide-gray-50 border border-gray-100 rounded-lg overflow-hidden">
                    {detail.payments.map(p => (
                      <div key={p._id ?? p.id} className="flex items-center justify-between px-4 py-3">
                        <div>
                          <p className="text-sm font-medium text-gray-800">{fmt(p.amount)}</p>
                          <p className="text-xs text-gray-400">{fmtDate(p.date)}{p.description ? ` · ${p.description}` : ''}</p>
                        </div>
                        <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${p.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-yellow-100 text-yellow-700'}`}>
                          {p.status}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Documents */}
              {detail.documents?.length > 0 && (
                <div>
                  <h4 className="text-sm font-semibold text-gray-800 mb-3">Documents</h4>
                  <div className="space-y-2">
                    {detail.documents.map(doc => (
                      <div key={doc._id ?? doc.id} className="flex items-center gap-3 px-4 py-2 border border-gray-100 rounded-lg">
                        <FileText className="w-4 h-4 text-gray-400 shrink-0" />
                        <a href={doc.fileUrl} target="_blank" rel="noreferrer" className="text-sm text-blue-600 hover:underline truncate">{doc.title ?? doc.fileName ?? 'Document'}</a>
                        <span className="text-xs text-gray-400 ml-auto shrink-0">{fmtDate(doc.createdAt)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>

      {purchaseModal && (
        <PurchaseModal
          vendorId={vendor.id}
          onClose={() => setPurchaseModal(false)}
          onSaved={loadDetail}
        />
      )}
      {editPurchase && (
        <PurchaseModal
          vendorId={vendor.id}
          purchase={editPurchase}
          onClose={() => setEditPurchase(null)}
          onSaved={loadDetail}
        />
      )}
    </div>
  )
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function VendorsPage() {
  const { data: session } = useSession()
  const [vendors,      setVendors]      = useState([])
  const [loading,      setLoading]      = useState(true)
  const [search,       setSearch]       = useState('')
  const [page,         setPage]         = useState(1)
  const [total,        setTotal]        = useState(0)
  const [serviceTypes, setServiceTypes] = useState([])
  const [addModal,     setAddModal]     = useState(false)
  const [editModal,    setEditModal]    = useState(null)
  const [delModal,     setDelModal]     = useState(null)
  const [detail,       setDetail]       = useState(null)
  const [stModal,      setStModal]      = useState(false)

  const canDelete = session?.user?.role === 'SUPER_ADMIN'
  const limit = 20

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ page, limit })
      if (search) params.set('search', search)
      const res  = await fetch(`/api/vendors?${params}`)
      const json = await res.json()
      setVendors(json.data ?? [])
      setTotal(json.meta?.total ?? 0)
    } catch { toast.error('Failed to load vendors') }
    finally { setLoading(false) }
  }, [page, search])

  useEffect(() => { load() }, [load])
  useEffect(() => { setPage(1) }, [search])

  useEffect(() => {
    fetch('/api/vendors/service-types').then(r => r.json()).then(j => setServiceTypes(j.data ?? []))
  }, [])

  const pages = Math.ceil(total / limit)

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Vendors</h1>
          <p className="text-sm text-gray-400 mt-0.5">{total} vendor{total !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => setStModal(true)}
            className="flex items-center gap-2 px-3 py-2 border border-gray-200 text-gray-600 text-sm font-medium rounded-xl hover:bg-gray-50 transition-colors">
            <Settings2 className="w-4 h-4" /> Service Types
          </button>
          <button onClick={() => setAddModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-gray-900 text-white text-sm font-medium rounded-xl hover:bg-gray-800 transition-colors">
            <Plus className="w-4 h-4" /> Add Vendor
          </button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search by company, contact, email or BIN…"
          className="w-full pl-9 pr-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-gray-900"
        />
        {search && (
          <button onClick={() => setSearch('')} className="absolute right-3 top-1/2 -translate-y-1/2">
            <X className="w-4 h-4 text-gray-400 hover:text-gray-600" />
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        {loading ? (
          <div className="flex justify-center py-16">
            <Loader2 className="w-6 h-6 animate-spin text-gray-400" />
          </div>
        ) : vendors.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Building2 className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">{search ? 'No vendors match your search' : 'No vendors yet'}</p>
            {!search && <button onClick={() => setAddModal(true)} className="mt-3 text-sm text-blue-600 hover:underline">Add your first vendor</button>}
          </div>
        ) : (
          <>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[700px]">
                <thead>
                  <tr className="border-b border-gray-100 bg-gray-50">
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Company</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Contact</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Service Type</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Purchases</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Total Purchased</th>
                    <th className="text-left px-4 py-3 text-xs font-semibold text-gray-500 uppercase tracking-wide">Added</th>
                    <th className="px-4 py-3" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {vendors.map(v => {
                    return (
                      <tr key={v.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-4 py-3">
                          <button onClick={() => setDetail(v)} className="text-left">
                            <p className="text-sm font-medium text-gray-900 hover:text-blue-600 transition-colors">{v.company}</p>
                            {v.email && <p className="text-xs text-gray-400 mt-0.5">{v.email}</p>}
                            {v.bin
                              ? <p className="text-[11px] text-gray-400 font-mono mt-0.5">BIN {v.bin}</p>
                              : ['TURNOVER', 'UNREGISTERED', 'FOREIGN'].includes(v.vatRegistrationType)
                                ? <p className="text-[11px] text-gray-400 mt-0.5">{VAT_REG_LABELS[v.vatRegistrationType]}</p>
                                : null}
                          </button>
                        </td>
                        <td className="px-4 py-3">
                          <p className="text-sm text-gray-700">{v.contactName || '—'}</p>
                          {v.phone && <p className="text-xs text-gray-400">{v.phone}</p>}
                        </td>
                        <td className="px-4 py-3">
                          {v.serviceType
                            ? <span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-700">{v.serviceType}</span>
                            : <span className="text-xs text-gray-400">—</span>}
                        </td>
                        <td className="px-4 py-3 text-sm text-gray-600">{v.purchaseCount ?? 0}</td>
                        <td className="px-4 py-3 text-sm font-medium text-gray-800">{v.totalPurchaseAmount > 0 ? fmt(v.totalPurchaseAmount) : '—'}</td>
                        <td className="px-4 py-3 text-xs text-gray-400">{fmtDate(v.createdAt)}</td>
                        <td className="px-4 py-3">
                          <div className="flex items-center gap-1 justify-end">
                            <button onClick={() => setEditModal(v)}
                              className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-colors">
                              <Pencil className="w-3.5 h-3.5" />
                            </button>
                            {canDelete && (
                              <button onClick={() => setDelModal(v)}
                                className="p-1.5 rounded-lg text-gray-400 hover:text-red-600 hover:bg-red-50 transition-colors">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>

            {/* Pagination */}
            {pages > 1 && (
              <div className="flex items-center justify-between px-4 py-3 border-t border-gray-100">
                <p className="text-xs text-gray-400">Page {page} of {pages} · {total} total</p>
                <div className="flex gap-2">
                  <button disabled={page <= 1} onClick={() => setPage(p => p - 1)}
                    className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">Previous</button>
                  <button disabled={page >= pages} onClick={() => setPage(p => p + 1)}
                    className="px-3 py-1.5 text-xs border border-gray-200 rounded-lg disabled:opacity-40 hover:bg-gray-50">Next</button>
                </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* Modals */}
      {addModal  && <VendorModal serviceTypes={serviceTypes} onClose={() => setAddModal(false)} onSaved={load} />}
      {editModal && <VendorModal serviceTypes={serviceTypes} vendor={editModal} onClose={() => setEditModal(null)} onSaved={load} />}
      {stModal   && <ServiceTypesModal types={serviceTypes} onClose={() => setStModal(false)} onSaved={setServiceTypes} />}
      {delModal  && <DeleteConfirm vendor={delModal} onClose={() => setDelModal(null)} onDeleted={load} />}
      {detail    && (
        <VendorDetail
          vendor={detail}
          onClose={() => setDetail(null)}
          onEdit={() => { setEditModal(detail); setDetail(null) }}
        />
      )}
    </div>
  )
}
