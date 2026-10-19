'use client'

import { useState, useEffect, useCallback } from 'react'
import { useSession } from 'next-auth/react'
import {
  Plus, X, Loader2, Pencil, Trash2,
  Building2, Phone, Mail, Globe, MapPin, User, FileText, Settings2, AlertTriangle,
} from 'lucide-react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { dhakaDayKey } from '@/lib/dhakaTime'
import { usePermission } from '@/components/auth/Can'
import TaxCodeSelect from '@/components/tax/TaxCodeSelect'
import { BIN_REGEX, TIN_REGEX, normalizeBin } from '@/lib/tax/catalog'
import Button, { buttonVariants } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import PageHeader from '@/components/ui/PageHeader'
import Badge from '@/components/ui/Badge'
import EmptyState from '@/components/ui/EmptyState'
import SearchInput from '@/components/ui/SearchInput'
import Pagination from '@/components/ui/Pagination'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import { Input, Textarea, NativeSelect, Field } from '@/components/ui/Input'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'

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

const BILL_STATUS_VARIANT = {
  DRAFT:     'default',
  RECEIVED:  'success',
  CANCELLED: 'danger',
}
const BILL_PAYMENT_VARIANT = {
  UNPAID:    'warning',
  REQUESTED: 'primary',
  PAID:      'success',
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

// ─── Shared dialog shell (hand-built overlay, styled like <Modal>) ────────────

function DialogShell({ title, description, onClose, footer, children, className = 'max-w-lg', z = 'z-50' }) {
  return (
    <div className={`fixed inset-0 ${z} flex items-center justify-center bg-black/40 p-4 backdrop-blur-[2px]`}>
      <div className={`flex max-h-[90vh] w-full flex-col rounded-2xl border border-gray-200/80 bg-white shadow-2xl ${className}`}>
        <div className="flex shrink-0 items-start justify-between gap-4 px-6 pt-5 pb-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold tracking-tight text-gray-900">{title}</h3>
            {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
          </div>
          {onClose && (
            <Button variant="ghost" size="icon-sm" onClick={onClose} className="-mr-1.5 -mt-0.5 text-gray-400" aria-label="Close">
              <X />
            </Button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto px-6 pt-1 pb-5">{children}</div>
        {footer && (
          <div className="flex shrink-0 flex-wrap justify-end gap-2 rounded-b-2xl border-t border-gray-100 bg-gray-50/60 px-6 py-3.5">
            {footer}
          </div>
        )}
      </div>
    </div>
  )
}

function SectionTitle({ children, title, action }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-2">
      <h4 className="text-sm font-semibold text-gray-900" title={title}>{children}</h4>
      {action}
    </div>
  )
}

const quietBox = 'rounded-lg bg-gray-50 py-4 text-center text-[13px] text-muted-foreground'
const textLink = 'text-[13px] font-medium text-gray-900 hover:underline underline-offset-4'

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
    <DialogShell
      title="Service types"
      onClose={onClose}
      className="max-w-sm"
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} loading={saving}>Save</Button>
      </>}
    >
      <div className="space-y-3">
        {/* Add new */}
        <div className="flex gap-2">
          <Input
            value={newType}
            onChange={e => setNewType(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && add()}
            placeholder="New service type…"
            className="flex-1"
          />
          <Button variant="outline" size="icon" onClick={add} aria-label="Add">
            <Plus />
          </Button>
        </div>

        {/* List */}
        <div className="max-h-64 space-y-1.5 overflow-y-auto">
          {list.length === 0 && <p className="py-4 text-center text-[13px] text-muted-foreground">No service types yet</p>}
          {list.map((t, i) => (
            <div key={i} className="flex items-center justify-between rounded-lg bg-gray-50 py-1 pl-3 pr-1">
              <span className="text-sm text-gray-700">{t}</span>
              <Button variant="ghost" size="icon-xs" onClick={() => remove(i)} className="text-gray-400 hover:bg-red-50 hover:text-red-600" aria-label="Remove">
                <X />
              </Button>
            </div>
          ))}
        </div>
      </div>
    </DialogShell>
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

  return (
    <DialogShell
      title={isEdit ? 'Edit vendor' : 'New vendor'}
      onClose={onClose}
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} loading={saving}>
          {isEdit ? 'Save changes' : 'Add vendor'}
        </Button>
      </>}
    >
      <div className="space-y-6">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Company name" required className="sm:col-span-2">
            <Input value={form.company} onChange={e => set('company', e.target.value)} placeholder="e.g. Acme Supplies Ltd." />
          </Field>
          <Field label="Contact person">
            <Input value={form.contactName} onChange={e => set('contactName', e.target.value)} placeholder="Full name" />
          </Field>
          <Field label="Phone">
            <Input value={form.phone} onChange={e => set('phone', e.target.value)} placeholder="+880…" />
          </Field>
          <Field label="Email">
            <Input type="email" value={form.email} onChange={e => set('email', e.target.value)} placeholder="vendor@example.com" />
          </Field>
          <Field label="Service type">
            <NativeSelect value={form.serviceType} onChange={e => set('serviceType', e.target.value)}>
              <option value="">Select…</option>
              {serviceTypes.map(s => <option key={s} value={s}>{s}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Website" className="sm:col-span-2">
            <Input value={form.website} onChange={e => set('website', e.target.value)} placeholder="https://…" />
          </Field>
          <Field label="Address" className="sm:col-span-2">
            <Input value={form.address} onChange={e => set('address', e.target.value)} placeholder="Street, city, country" />
          </Field>
          <Field label="Notes" className="sm:col-span-2">
            <Textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={3} placeholder="e.g. Payment terms" className="resize-none" />
          </Field>
        </div>

        {/* ── Tax identity ── */}
        <div className="border-t border-gray-100 pt-5">
          <SectionTitle title="Used for input VAT credit, VDS (Mushak-6.6) and TDS when you pay this vendor.">
            Tax identity
          </SectionTitle>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="BIN" error={binInvalid ? 'BIN must be 9 or 13 digits' : undefined} hint="13 digits">
              <Input value={form.bin} onChange={e => setBin(e.target.value)} inputMode="numeric"
                placeholder="000123456-0101" className="font-mono" invalid={binInvalid} />
            </Field>
            <Field
              label="TIN (e-TIN)"
              error={tinMaskEdit ? 'Clear the hidden TIN fully, then type the new one'
                : tinInvalid ? 'TIN must be 12 digits' : undefined}
              hint={tinUntouched ? 'Hidden. Leave as is or replace it.' : undefined}
            >
              <Input value={form.tin} onChange={e => set('tin', e.target.value)} inputMode="numeric"
                placeholder="12-digit e-TIN" className="font-mono" invalid={tinInvalid || tinMaskEdit}
                title="Printed on the TDS certificate you issue" />
            </Field>
            <Field label="VAT status" hint={form.vatRegistrationType === 'FOREIGN' ? 'No BIN or Mushak-6.3 from foreign suppliers' : undefined}>
              <NativeSelect value={form.vatRegistrationType} onChange={e => set('vatRegistrationType', e.target.value)}>
                <option value="">Not specified</option>
                {VAT_REGISTRATION_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </NativeSelect>
              {['TURNOVER', 'UNREGISTERED'].includes(form.vatRegistrationType) && (
                <p className="mt-1.5 text-xs text-amber-700">No input VAT credit or VDS on these purchases.</p>
              )}
            </Field>
            <Field label="Trade licence no.">
              <Input value={form.tradeLicense} onChange={e => set('tradeLicense', e.target.value)} placeholder="Optional" />
            </Field>
            <Field label="Payee type">
              <NativeSelect value={form.payeeType} onChange={e => set('payeeType', e.target.value)} title="Sets the TDS rate">
                {PAYEE_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </NativeSelect>
            </Field>
            <div className="flex items-end">
              <label
                className="flex cursor-pointer items-start gap-2.5 pb-1"
                title="Proof of return submission. Without it TDS is 50% higher (ITA 2023 s.142)."
              >
                <input type="checkbox" checked={form.hasPsr} onChange={e => set('hasPsr', e.target.checked)}
                  className="mt-0.5 size-4 rounded border-gray-300" />
                <span>
                  <span className="block text-sm font-medium text-gray-900">PSR on file</span>
                  <span className="block text-xs text-muted-foreground">Without it, TDS is 50% higher</span>
                </span>
              </label>
            </div>
            <Field label="Default TDS section">
              <TaxCodeSelect kind="TDS_SECTION" value={form.defaultTdsSection || null}
                onChange={code => set('defaultTdsSection', code ?? '')} placeholder="Select section…" />
            </Field>
            <Field label="Default VAT service code">
              <TaxCodeSelect kind="VAT_SERVICE" value={form.defaultVatServiceCode || null}
                onChange={code => set('defaultVatServiceCode', code ?? '')} placeholder="Select service…" />
            </Field>
          </div>
        </div>
      </div>
    </DialogShell>
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
    <DialogShell
      title="Delete vendor"
      className="max-w-sm"
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button variant="destructive" onClick={confirm} loading={deleting}>Delete</Button>
      </>}
    >
      <p className="text-sm text-muted-foreground">
        Delete <strong className="font-medium text-gray-900">{vendor.company}</strong>? This can&apos;t be undone.
      </p>
    </DialogShell>
  )
}

// ─── Purchase Modal ───────────────────────────────────────────────────────────

const STATUS_VARIANT = {
  pending:   'warning',
  received:  'success',
  cancelled: 'danger',
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
    <DialogShell
      title={isEdit ? 'Edit purchase' : 'New purchase'}
      onClose={onClose}
      z="z-[60]"
      footer={<>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        <Button onClick={save} loading={saving}>
          {isEdit ? 'Save changes' : 'Add purchase'}
        </Button>
      </>}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Item / product" required className="sm:col-span-2">
          <Input value={form.item} onChange={e => set('item', e.target.value)} placeholder="e.g. Office chair" />
        </Field>
        <Field label="Description" className="sm:col-span-2">
          <Input value={form.description} onChange={e => set('description', e.target.value)} placeholder="Optional" />
        </Field>
        <Field label="Quantity">
          <Input type="number" min="0" value={form.quantity} onChange={e => handleQty(e.target.value)} className="tabular-nums" />
        </Field>
        <Field label="Unit price" required>
          <Input type="number" min="0" step="0.01" value={form.unitPrice} onChange={e => handleUnit(e.target.value)} placeholder="0.00" className="tabular-nums" />
        </Field>
        <Field label="Total amount">
          <Input type="number" min="0" step="0.01" value={form.totalAmount} onChange={e => set('totalAmount', e.target.value)} placeholder="0.00" className="tabular-nums" />
        </Field>
        <Field label="Date" required>
          <Input type="date" value={form.date} onChange={e => set('date', e.target.value)} />
        </Field>
        <Field label="Category">
          <Input value={form.category} onChange={e => set('category', e.target.value)} placeholder="e.g. Hardware" />
        </Field>
        <Field label="Status">
          <NativeSelect value={form.status} onChange={e => set('status', e.target.value)}>
            <option value="pending">Pending</option>
            <option value="received">Received</option>
            <option value="cancelled">Cancelled</option>
          </NativeSelect>
        </Field>
        <Field label="Invoice / bill ref" className="sm:col-span-2">
          <Input value={form.invoiceRef} onChange={e => set('invoiceRef', e.target.value)} placeholder="INV-001" />
        </Field>
        <Field label="Notes" className="sm:col-span-2">
          <Textarea value={form.notes} onChange={e => set('notes', e.target.value)} rows={2} className="resize-none" />
        </Field>
      </div>
    </DialogShell>
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
      <SectionTitle
        action={
          <div className="flex items-center gap-3">
            {state.status === 'ok' && state.total > state.rows.length && (
              <Link href={`/admin/inventory/purchases?vendorId=${encodeURIComponent(vendorId)}`} className={textLink}>
                View all {state.total}
              </Link>
            )}
            {canCreate && state.status === 'ok' && (
              <Link href={`/admin/inventory/purchases/new?vendorId=${encodeURIComponent(vendorId)}`}
                className={buttonVariants({ variant: 'outline', size: 'xs' })}>
                <Plus /> New bill
              </Link>
            )}
          </div>
        }
      >
        Purchase bills
      </SectionTitle>

      {state.loading ? (
        <LoadingSpinner size="sm" className="py-4" />
      ) : state.status === 'forbidden' ? (
        <p className={quietBox} title="Inventory permission needed">No access to purchase bills</p>
      ) : state.status === 'unavailable' ? (
        <p className={quietBox}>Couldn&apos;t load purchase bills</p>
      ) : state.rows.length === 0 ? (
        <p className={quietBox} title="Record equipment and supply purchases in Inventory → Purchases.">No purchase bills yet</p>
      ) : (
        <div className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200/80">
          {state.rows.map(b => {
            const id = b.id ?? b._id
            const payStatus = b.payment?.status
            return (
              <Link key={id} href={`/admin/inventory/purchases/${id}`}
                className="flex items-start justify-between gap-3 px-4 py-3 transition-colors hover:bg-gray-50/70">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-gray-900">
                    {b.billNo || 'Draft bill'}
                    {b.supplierInvoiceNo ? <span className="font-normal text-muted-foreground"> · {b.supplierInvoiceNo}</span> : null}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {fmtDate(b.billDate)}
                    {b.mushakNo ? ` · Mushak ${b.mushakNo}` : ''}
                    {Array.isArray(b.lines) ? ` · ${b.lines.length} line${b.lines.length !== 1 ? 's' : ''}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 flex-col items-end gap-1">
                  <span className="text-sm font-medium text-gray-900 tabular-nums">{fmtCur(b.total, b.currency)}</span>
                  <div className="flex items-center gap-1">
                    {b.status && (
                      <Badge variant={BILL_STATUS_VARIANT[b.status] ?? 'default'} className="capitalize">
                        {String(b.status).toLowerCase()}
                      </Badge>
                    )}
                    {payStatus && b.status === 'RECEIVED' && (
                      <Badge variant={BILL_PAYMENT_VARIANT[payStatus] ?? 'default'} className="capitalize">
                        {String(payStatus).toLowerCase()}
                      </Badge>
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
      <SectionTitle
        action={
          <Badge variant={vendor.hasPsr ? 'success' : 'warning'}>
            {vendor.hasPsr ? 'PSR on file' : 'No PSR — TDS +50%'}
          </Badge>
        }
      >
        Tax identity
      </SectionTitle>
      {noIdentity && (
        <div className="mb-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          <p className="flex-1">
            No BIN or TIN on file, so input VAT can&apos;t be claimed.{' '}
            {onEdit && <button onClick={onEdit} className="font-medium underline underline-offset-4">Add tax details</button>}
          </p>
        </div>
      )}
      <div className="grid grid-cols-1 gap-x-4 gap-y-3 rounded-lg border border-gray-200/80 px-4 py-3 sm:grid-cols-2">
        {items.map(([label, value, mono]) => (
          <div key={label} className="min-w-0">
            <p className="text-xs text-muted-foreground">{label}</p>
            <p className={`text-sm break-words ${value ? 'text-gray-900' : 'text-gray-300'} ${mono && value ? 'font-mono' : ''}`}>{value || '—'}</p>
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

  const contactRow = 'flex min-w-0 items-center gap-2 text-sm text-gray-700'
  const contactIcon = 'size-4 shrink-0 text-gray-400'

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-4 backdrop-blur-[2px] sm:items-center">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-2xl border border-gray-200/80 bg-white shadow-2xl">
        {/* Header */}
        <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-gray-100 bg-white px-6 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex size-9 shrink-0 items-center justify-center rounded-lg border border-gray-200/80 bg-white shadow-xs">
              <Building2 className="size-4 text-gray-600" />
            </div>
            <div className="min-w-0">
              <h3 className="truncate text-base font-semibold tracking-tight text-gray-900">{vendor.company}</h3>
              {vendor.serviceType && <p className="text-xs text-muted-foreground">{vendor.serviceType}</p>}
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Button variant="outline" size="sm" onClick={onEdit}>
              <Pencil /> Edit
            </Button>
            <Button variant="ghost" size="icon-sm" onClick={onClose} className="text-gray-400" aria-label="Close">
              <X />
            </Button>
          </div>
        </div>

        <div className="space-y-6 p-6">
          {/* Contact info */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {vendor.contactName && (
              <div className={contactRow}>
                <User className={contactIcon} />
                <span>{vendor.contactName}</span>
              </div>
            )}
            {vendor.phone && (
              <div className={contactRow}>
                <Phone className={contactIcon} />
                <span className="tabular-nums">{vendor.phone}</span>
              </div>
            )}
            {vendor.email && (
              <div className={contactRow}>
                <Mail className={contactIcon} />
                <a href={`mailto:${vendor.email}`} className="truncate font-medium text-gray-900 hover:underline underline-offset-4">{vendor.email}</a>
              </div>
            )}
            {vendor.website && (
              <div className={contactRow}>
                <Globe className={contactIcon} />
                <a href={vendor.website} target="_blank" rel="noreferrer" className="truncate font-medium text-gray-900 hover:underline underline-offset-4">{vendor.website}</a>
              </div>
            )}
            {vendor.address && (
              <div className={`${contactRow} sm:col-span-2`}>
                <MapPin className={contactIcon} />
                <span>{vendor.address}</span>
              </div>
            )}
          </div>

          {vendor.notes && (
            <div className="rounded-lg bg-gray-50 px-4 py-3 text-sm text-gray-600">
              <p className="mb-1 text-xs font-medium text-gray-900">Notes</p>
              <p className="whitespace-pre-wrap">{vendor.notes}</p>
            </div>
          )}

          <VendorTaxIdentity vendor={detail ?? vendor} onEdit={onEdit} />

          <VendorPurchaseBills vendorId={vendor.id} />

          {loading && <LoadingSpinner className="py-8" />}

          {detail && (
            <>
              {/* Purchases */}
              <div>
                <SectionTitle
                  action={
                    <div className="flex items-center gap-3">
                      <span className="text-[13px] text-muted-foreground">
                        Total <span className="font-medium text-gray-900 tabular-nums">{fmt(detail.totalPurchased)}</span>
                      </span>
                      {canDelete && (
                        <Button variant="outline" size="xs" onClick={() => setPurchaseModal(true)}>
                          <Plus /> Add
                        </Button>
                      )}
                    </div>
                  }
                >
                  Purchase records
                </SectionTitle>
                {detail.purchases?.length === 0 ? (
                  <p className={quietBox}>No purchases yet</p>
                ) : (
                  <div className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200/80">
                    {detail.purchases.map(p => (
                      <div key={p._id ?? p.id} className="flex items-start justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium text-gray-900">{p.item}</p>
                          <p className="text-xs text-muted-foreground">
                            {fmtDate(p.date)}
                            {p.category ? ` · ${p.category}` : ''}
                            {p.invoiceRef ? ` · ${p.invoiceRef}` : ''}
                          </p>
                          <p className="mt-0.5 text-xs text-gray-600 tabular-nums">
                            {p.quantity} × {fmt(p.unitPrice)} = <span className="font-medium text-gray-900">{fmt(p.totalAmount)}</span>
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <Badge variant={STATUS_VARIANT[p.status] ?? 'default'} className="mr-1 capitalize">
                            {p.status}
                          </Badge>
                          {canDelete && (
                            <>
                              <Button variant="ghost" size="icon-xs" onClick={() => setEditPurchase(p)} className="text-gray-400" aria-label="Edit purchase">
                                <Pencil />
                              </Button>
                              <Button variant="ghost" size="icon-xs" onClick={() => deletePurchase(p)} disabled={deletingId === (p._id ?? p.id)}
                                className="text-gray-400 hover:bg-red-50 hover:text-red-600" aria-label="Delete purchase">
                                {deletingId === (p._id ?? p.id) ? <Loader2 className="animate-spin" /> : <Trash2 />}
                              </Button>
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
                  <SectionTitle
                    action={
                      <span className="text-[13px] text-muted-foreground">
                        Total paid <span className="font-medium text-gray-900 tabular-nums">{fmt(detail.totalPaid)}</span>
                      </span>
                    }
                  >
                    Payment history
                  </SectionTitle>
                  <div className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200/80">
                    {detail.payments.map(p => (
                      <div key={p._id ?? p.id} className="flex items-center justify-between gap-3 px-4 py-3">
                        <div className="min-w-0">
                          <p className="text-sm font-medium text-gray-900 tabular-nums">{fmt(p.amount)}</p>
                          <p className="text-xs text-muted-foreground">{fmtDate(p.date)}{p.description ? ` · ${p.description}` : ''}</p>
                        </div>
                        <Badge variant={p.status === 'paid' ? 'success' : 'warning'} className="capitalize">
                          {p.status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Documents */}
              {detail.documents?.length > 0 && (
                <div>
                  <SectionTitle>Documents</SectionTitle>
                  <div className="divide-y divide-gray-100 overflow-hidden rounded-lg border border-gray-200/80">
                    {detail.documents.map(doc => (
                      <div key={doc._id ?? doc.id} className="flex items-center gap-3 px-4 py-2.5">
                        <FileText className="size-4 shrink-0 text-gray-400" />
                        <a href={doc.fileUrl} target="_blank" rel="noreferrer" className="truncate text-sm font-medium text-gray-900 hover:underline underline-offset-4">{doc.title ?? doc.fileName ?? 'Document'}</a>
                        <span className="ml-auto shrink-0 text-xs text-muted-foreground">{fmtDate(doc.createdAt)}</span>
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
      <PageHeader
        title="Vendors"
        description={`${total} vendor${total !== 1 ? 's' : ''}`}
        actions={<>
          <Button variant="outline" onClick={() => setStModal(true)}>
            <Settings2 /> Service types
          </Button>
          <Button onClick={() => setAddModal(true)}>
            <Plus /> New vendor
          </Button>
        </>}
      />

      {/* Search */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput
          value={search}
          onChange={setSearch}
          placeholder="Search vendors or BIN…"
          className="w-full sm:w-72"
        />
      </div>

      {/* Table */}
      <Card className="overflow-hidden">
        {loading ? (
          <LoadingSpinner className="py-16" />
        ) : vendors.length === 0 ? (
          <EmptyState
            icon={Building2}
            title={search ? 'No results' : 'No vendors yet'}
            action={!search && (
              <Button variant="outline" size="sm" onClick={() => setAddModal(true)}>
                <Plus /> New vendor
              </Button>
            )}
          />
        ) : (
          <>
            <Table className="min-w-[700px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Company</TableHead>
                  <TableHead>Contact</TableHead>
                  <TableHead>Service type</TableHead>
                  <TableHead className="text-right">Purchases</TableHead>
                  <TableHead className="text-right">Total purchased</TableHead>
                  <TableHead>Added</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {vendors.map(v => {
                  return (
                    <TableRow key={v.id}>
                      <TableCell>
                        <button onClick={() => setDetail(v)} className="text-left">
                          <p className="font-medium text-gray-900 hover:underline underline-offset-4">{v.company}</p>
                          {v.email && <p className="mt-0.5 text-xs text-muted-foreground">{v.email}</p>}
                          {v.bin
                            ? <p className="mt-0.5 font-mono text-[11px] text-muted-foreground">BIN {v.bin}</p>
                            : ['TURNOVER', 'UNREGISTERED', 'FOREIGN'].includes(v.vatRegistrationType)
                              ? <p className="mt-0.5 text-[11px] text-muted-foreground">{VAT_REG_LABELS[v.vatRegistrationType]}</p>
                              : null}
                        </button>
                      </TableCell>
                      <TableCell>
                        <p className="text-gray-700">{v.contactName || '—'}</p>
                        {v.phone && <p className="text-xs text-muted-foreground tabular-nums">{v.phone}</p>}
                      </TableCell>
                      <TableCell>
                        {v.serviceType
                          ? <Badge>{v.serviceType}</Badge>
                          : <span className="text-xs text-gray-400">—</span>}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">{v.purchaseCount ?? 0}</TableCell>
                      <TableCell className="text-right font-medium text-gray-900 tabular-nums">{v.totalPurchaseAmount > 0 ? fmt(v.totalPurchaseAmount) : '—'}</TableCell>
                      <TableCell className="whitespace-nowrap text-xs text-muted-foreground">{fmtDate(v.createdAt)}</TableCell>
                      <TableCell>
                        <div className="flex items-center justify-end gap-1">
                          <Button variant="ghost" size="icon-sm" onClick={() => setEditModal(v)} className="text-gray-400" aria-label="Edit vendor">
                            <Pencil />
                          </Button>
                          {canDelete && (
                            <Button variant="ghost" size="icon-sm" onClick={() => setDelModal(v)}
                              className="text-gray-400 hover:bg-red-50 hover:text-red-600" aria-label="Delete vendor">
                              <Trash2 />
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>

            {/* Pagination */}
            {pages > 1 && (
              <div className="border-t border-gray-100 px-4 py-3">
                <Pagination page={page} pages={pages} total={total} limit={limit} onChange={setPage} />
              </div>
            )}
          </>
        )}
      </Card>

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
