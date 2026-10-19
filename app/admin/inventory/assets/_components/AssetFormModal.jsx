'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Info, Loader2, Lock, Plus, X } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import DatePicker from '@/components/ui/DatePicker'
import FileUpload from '@/components/ui/FileUpload'
import PeoplePicker from '@/components/ui/PeoplePicker'
import { cn } from '@/lib/utils'
import { addDays } from '@/lib/finance/fiscal'
import { TAX_DEPRECIATION_CLASSES } from '@/lib/tax/catalog'
import {
  CONDITION_OPTIONS, DEPRECIATION_METHOD_OPTIONS, computeAssetCost, round2,
} from '@/lib/inventory/constants'
import {
  Field, inputCls, btnPrimary, btnSecondary, tk, dayKeyOf, apiJson, useAssetOptions, refId,
} from './shared'

const TAX_CLASS_OPTIONS = Object.entries(TAX_DEPRECIATION_CLASSES).map(([value, c]) => ({
  value, label: `${c.label} — ${c.rate}%${c.method === 'SL' ? ' SL' : ''}`,
}))

const num = (v) => (v === '' || v === null || v === undefined ? null : Number(v))
const str = (v) => (v === null || v === undefined ? '' : String(v))

function emptyForm() {
  return {
    name: '', categoryId: '', brand: '', model: '', quantity: '1', serialText: '', serialNumber: '',
    specs: '', description: '', condition: 'NEW', locationId: '', imageUrl: '',
    vendorId: '', vendorName: '', invoiceRef: '', mushakNo: '', purchaseDate: null,
    unitCost: '', vatAmount: '', vatCapitalized: true, otherCosts: '',
    capMode: 'AUTO', availableForUseDate: null,
    method: '', usefulLifeMonths: '', residualValue: '', decliningRatePct: '', taxClass: '',
    isExisting: false, asOfDate: null, openingAccumulated: '', taxWdv: '', taxWdvFiscalYear: '',
    employee: null, expectedReturnDate: null,
    warrantyExpiry: null, warrantyNotes: '',
    insProvider: '', insPolicyNo: '', insExpiry: null, insValue: '',
    notes: '', documents: [],
  }
}

function formFromAsset(a) {
  const f = emptyForm()
  return {
    ...f,
    name: str(a.name), categoryId: refId(a.categoryId) ?? '', brand: str(a.brand), model: str(a.model),
    serialNumber: str(a.serialNumber), specs: str(a.specs), description: str(a.description),
    condition: a.condition ?? 'GOOD', imageUrl: str(a.imageUrl),
    vendorId: refId(a.purchase?.vendorId) ?? '', vendorName: str(a.purchase?.vendorName),
    invoiceRef: str(a.purchase?.invoiceRef), mushakNo: str(a.purchase?.mushakNo), purchaseDate: dayKeyOf(a.purchase?.date),
    unitCost: str(a.purchase?.unitCost ?? ''), vatAmount: str(a.purchase?.vatAmount ?? ''),
    vatCapitalized: a.purchase?.vatCapitalized !== false, otherCosts: str(a.purchase?.otherCosts ?? ''),
    capMode: a.isCapitalized === false ? 'NO' : 'YES', availableForUseDate: dayKeyOf(a.availableForUseDate),
    method: a.depreciation?.method ?? '', usefulLifeMonths: str(a.depreciation?.usefulLifeMonths ?? ''),
    residualValue: str(a.depreciation?.residualValue ?? ''), decliningRatePct: str(a.depreciation?.decliningRatePct ?? ''),
    taxClass: a.taxClass ?? '',
    isExisting: Boolean(a.opening?.isExisting), asOfDate: dayKeyOf(a.opening?.asOfDate),
    openingAccumulated: str(a.opening?.accumulatedDepreciation ?? ''), taxWdv: str(a.opening?.taxWdv ?? ''),
    taxWdvFiscalYear: str(a.opening?.taxWdvFiscalYear),
    expectedReturnDate: dayKeyOf(a.expectedReturnDate),
    warrantyExpiry: dayKeyOf(a.warrantyExpiry), warrantyNotes: str(a.warrantyNotes),
    insProvider: str(a.insurance?.provider), insPolicyNo: str(a.insurance?.policyNo),
    insExpiry: dayKeyOf(a.insurance?.expiry), insValue: str(a.insurance?.insuredValue ?? ''),
    notes: str(a.notes), documents: (a.documents ?? []).map(d => ({ label: d.label ?? '', url: d.url })),
  }
}

function Toggle({ open, onToggle, title, subtitle, children }) {
  return (
    <div className="border border-gray-100 rounded-xl">
      <button type="button" onClick={onToggle} className="w-full flex items-center justify-between gap-3 px-4 py-3 text-left">
        <span className="min-w-0">
          <span className="block text-sm font-semibold text-gray-900">{title}</span>
          {subtitle && <span className="block text-xs text-gray-500 mt-0.5">{subtitle}</span>}
        </span>
        {open ? <ChevronDown className="w-4 h-4 text-gray-400 shrink-0" /> : <ChevronRight className="w-4 h-4 text-gray-400 shrink-0" />}
      </button>
      {open && <div className="px-4 pb-4 space-y-3">{children}</div>}
    </div>
  )
}

/**
 * Add existing asset(s) to the register, or edit an asset's details.
 * @param {{ open, onOpenChange, mode: 'create'|'edit', asset?, financials?: { locked, reasons, billLocked, billNo }, onSaved(result) }} props
 */
export default function AssetFormModal({ open, onOpenChange, mode = 'create', asset = null, financials = null, onSaved }) {
  const { categories, locations, vendors, settings, loading: optLoading, error: optError } = useAssetOptions()
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState({})
  const [sections, setSections] = useState({ depreciation: false, opening: false, warranty: false, assign: false, more: false })
  const [newDoc, setNewDoc] = useState({ label: '', url: '' })
  const isEdit = mode === 'edit'

  useEffect(() => {
    if (!open) return
    setErrors({})
    setNewDoc({ label: '', url: '' })
    if (isEdit && asset) {
      const f = formFromAsset(asset)
      setForm(f)
      setSections({ depreciation: false, opening: f.isExisting, warranty: Boolean(f.warrantyExpiry || f.insProvider), assign: false, more: Boolean(f.specs || f.description) })
    } else {
      setForm(emptyForm())
      setSections({ depreciation: false, opening: false, warranty: false, assign: false, more: false })
    }
  }, [open, isEdit, asset])

  const set = (patch) => setForm(f => ({ ...f, ...patch }))
  const category = categories.find(c => c.id === form.categoryId) ?? null
  const finLocked = isEdit && Boolean(financials?.locked)
  // After disposal only descriptions, photo, documents and notes can change.
  const ro = isEdit && ['SOLD', 'SCRAPPED', 'WRITTEN_OFF', 'DONATED'].includes(asset?.status)
  // An opening-register asset's cost and capitalisation are part of the go-live position.
  const openingValuesLocked = isEdit && Boolean(asset?.opening?.isExisting) && Boolean(settings?.openingLocked)
  const costLocked = finLocked || (isEdit && Boolean(financials?.billLocked)) || openingValuesLocked
  const threshold = Number(settings?.capitalizationThreshold ?? 10000)
  const goLive = settings?.goLiveDate || null
  const defaultAsOf = goLive ? addDays(goLive, -1) : null

  const unitCostTotal = useMemo(() => computeAssetCost({
    unitCost: Number(form.unitCost) || 0,
    vatAmount: Number(form.vatAmount) || 0,
    vatCapitalized: form.vatCapitalized,
    otherCosts: Number(form.otherCosts) || 0,
  }), [form.unitCost, form.vatAmount, form.vatCapitalized, form.otherCosts])

  const autoCapitalize = category ? (category.capitalize !== false && unitCostTotal >= threshold) : null
  const willCapitalize = form.capMode === 'AUTO' ? autoCapitalize : form.capMode === 'YES'
  const qty = Math.max(1, parseInt(form.quantity, 10) || 1)
  const serials = form.serialText.split(/[\r\n,]+/).map(s => s.trim()).filter(Boolean)
  const taxCls = TAX_DEPRECIATION_CLASSES[form.taxClass || category?.taxClass || 'OTHER']
  const lifeDefault = category?.usefulLifeMonths ?? null

  function validate() {
    const e = {}
    if (!form.name.trim()) e.name = 'Name is required'
    if (!form.categoryId) e.categoryId = 'Choose a category'
    if (!isEdit) {
      if (!(qty >= 1 && qty <= 500)) e.quantity = 'Between 1 and 500'
      if (serials.length > qty) e.serialText = `${serials.length} serials for ${qty} item${qty === 1 ? '' : 's'}`
      if (new Set(serials.map(s => s.toUpperCase())).size !== serials.length) e.serialText = 'A serial number is listed twice'
    }
    for (const k of ['unitCost', 'vatAmount', 'otherCosts', 'residualValue', 'openingAccumulated', 'taxWdv', 'insValue']) {
      if (form[k] !== '' && !(Number(form[k]) >= 0)) e[k] = 'Enter a positive amount'
    }
    if (form.usefulLifeMonths !== '' && !(Number(form.usefulLifeMonths) >= 1)) e.usefulLifeMonths = 'At least 1 month'
    if (form.isExisting && Number(form.openingAccumulated) > unitCostTotal + 0.005 && unitCostTotal > 0) {
      e.openingAccumulated = 'Cannot be more than the cost'
    }
    if (form.taxWdvFiscalYear && !/^\d{4}-\d{2}$/.test(form.taxWdvFiscalYear)) e.taxWdvFiscalYear = 'Like 2025-26'
    // Opening register: held before go-live, and not bought after the day it was held (as the opening import).
    if (form.isExisting && (!isEdit || (!finLocked && !settings?.openingLocked))) {
      const asOf = form.asOfDate || defaultAsOf
      if (goLive && asOf && asOf >= goLive) {
        e.asOfDate = `Must be before go-live (${goLive}) — add equipment acquired after go-live through a purchase bill`
      } else if (form.purchaseDate && asOf && form.purchaseDate > asOf) {
        e.purchaseDate = `After the opening date (${asOf}) — record it as a new purchase instead`
      }
    }
    setErrors(e)
    if (e.asOfDate) setSections(s => ({ ...s, opening: true }))
    return Object.keys(e).length === 0
  }

  function buildPayload() {
    const insurance = (form.insProvider || form.insPolicyNo || form.insExpiry || form.insValue !== '')
      ? { provider: form.insProvider || null, policyNo: form.insPolicyNo || null, expiry: form.insExpiry || null, insuredValue: num(form.insValue) }
      : null
    const docs = form.documents.filter(d => d.url).map(d => ({ label: d.label || null, url: d.url }))
    const p = {
      name: form.name.trim(),
      brand: form.brand || null,
      model: form.model || null,
      specs: form.specs || null,
      description: form.description || null,
      condition: form.condition || null,
      imageUrl: form.imageUrl || null,
      warrantyExpiry: form.warrantyExpiry || null,
      warrantyNotes: form.warrantyNotes || null,
      insurance,
      notes: form.notes || null,
      documents: docs,
      taxClass: form.taxClass || undefined,
    }
    const purchaseInfo = {
      vendorId: form.vendorId || null,
      vendorName: form.vendorId ? undefined : (form.vendorName || null),
      invoiceRef: form.invoiceRef || null,
      mushakNo: form.mushakNo || null,
    }
    const purchaseCost = {
      date: form.purchaseDate || null,
      unitCost: num(form.unitCost) ?? 0,
      vatAmount: num(form.vatAmount) ?? 0,
      vatCapitalized: form.vatCapitalized,
      otherCosts: num(form.otherCosts) ?? 0,
    }
    const depreciation = {
      ...(form.method ? { method: form.method } : {}),
      usefulLifeMonths: num(form.usefulLifeMonths),
      residualValue: num(form.residualValue),
      decliningRatePct: num(form.decliningRatePct),
    }
    const opening = form.isExisting
      ? { isExisting: true, asOfDate: form.asOfDate || null, accumulatedDepreciation: num(form.openingAccumulated) ?? 0, taxWdv: num(form.taxWdv), taxWdvFiscalYear: form.taxWdvFiscalYear || null }
      : { isExisting: false }

    if (!isEdit) {
      return {
        ...p,
        categoryId: form.categoryId,
        quantity: qty,
        serialNumbers: qty > 1 ? serials : [],
        serialNumber: qty === 1 ? (form.serialNumber || null) : null,
        locationId: form.locationId || null,
        purchase: { ...purchaseInfo, ...purchaseCost },
        availableForUseDate: form.availableForUseDate || null,
        ...(form.capMode === 'AUTO' ? {} : { isCapitalized: form.capMode === 'YES' }),
        depreciation,
        opening: form.isExisting ? opening : undefined,
        assignedEmployeeId: sections.assign && form.employee ? form.employee.id : null,
        expectedReturnDate: sections.assign && form.employee ? (form.expectedReturnDate || null) : null,
      }
    }

    const payload = {
      ...p,
      serialNumber: form.serialNumber || null,
      purchase: { ...purchaseInfo },
    }
    if (asset?.status === 'ASSIGNED') payload.expectedReturnDate = form.expectedReturnDate || null
    if (!finLocked) {
      payload.categoryId = form.categoryId
      if (!openingValuesLocked) payload.isCapitalized = form.capMode !== 'NO'
      payload.availableForUseDate = form.availableForUseDate || null
      payload.depreciation = depreciation
      if (!settings?.openingLocked) payload.opening = opening
    }
    if (!costLocked) {
      Object.assign(payload.purchase, purchaseCost)
    } else {
      delete payload.purchase.vendorId
      delete payload.purchase.vendorName
    }
    return payload
  }

  async function submit() {
    if (!validate()) {
      toast.error('Check the highlighted fields')
      return
    }
    setSaving(true)
    try {
      const body = buildPayload()
      const json = isEdit
        ? await apiJson(`/api/inventory/assets/${asset.id}`, { method: 'PUT', body: JSON.stringify(body) })
        : await apiJson('/api/inventory/assets', { method: 'POST', body: JSON.stringify(body) })
      if (isEdit) {
        toast.success(json.meta?.unchanged ? 'Nothing changed' : 'Asset updated')
      } else {
        const n = json.data?.length ?? 0
        toast.success(n === 1 ? `Added ${json.data[0].assetTag}` : `Added ${n} assets (${json.meta?.tags?.[0]} – ${json.meta?.tags?.[n - 1]})`)
      }
      onSaved?.(json)
      onOpenChange(false)
    } catch (err) {
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const addDoc = () => {
    if (!newDoc.url) return
    set({ documents: [...form.documents, { label: newDoc.label || '', url: newDoc.url }] })
    setNewDoc({ label: '', url: '' })
  }

  return (
    <Modal
      open={open}
      onOpenChange={(v) => !saving && onOpenChange(v)}
      size="xl"
      title={isEdit ? `Edit ${asset?.assetTag ?? 'asset'}` : 'Add existing asset'}
      description={isEdit
        ? 'Status, custody and location change through the asset actions.'
        : 'For equipment you already own (opening register, gifts, items bought outside a purchase bill). New purchases go through Purchases so the payment and VAT are recorded.'}
    >
      {optLoading && !categories.length ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="w-6 h-6 animate-spin text-gray-400" /></div>
      ) : optError && !categories.length ? (
        <div className="py-10 text-center text-sm text-red-600">{optError}</div>
      ) : (
        <div className="space-y-5">
          {ro && (
            <p className="flex items-start gap-2 text-xs text-amber-800 bg-amber-50 rounded-lg px-3 py-2">
              <Lock className="w-3.5 h-3.5 mt-0.5 shrink-0" />
              This asset has been disposed of — only the specifications, description, photo, documents, warranty notes and notes can be changed.
            </p>
          )}
          {/* Identity */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Field label="Asset name" required error={errors.name} className="sm:col-span-2">
              <input className={inputCls} disabled={ro} value={form.name} onChange={e => set({ name: e.target.value })} placeholder="e.g. MacBook Pro 14-inch M3" maxLength={200} />
            </Field>
            <Field label="Category" required error={errors.categoryId}
              hint={finLocked ? 'Locked — depreciation has been posted' : category ? `Tag series ${settings?.tagPrefix ?? 'EN'}-${category.code}-… · ${TAX_DEPRECIATION_CLASSES[category.taxClass]?.label ?? category.taxClass}` : null}>
              <select className={inputCls} value={form.categoryId} disabled={finLocked} onChange={e => set({ categoryId: e.target.value })}>
                <option value="">Select category</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
              </select>
            </Field>
            <Field label="Condition">
              <select className={inputCls} disabled={ro} value={form.condition} onChange={e => set({ condition: e.target.value })}>
                {CONDITION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </Field>
            <Field label="Brand"><input className={inputCls} disabled={ro} value={form.brand} onChange={e => set({ brand: e.target.value })} maxLength={100} /></Field>
            <Field label="Model"><input className={inputCls} disabled={ro} value={form.model} onChange={e => set({ model: e.target.value })} maxLength={100} /></Field>
            {!isEdit && (
              <Field label="Quantity" error={errors.quantity} hint="Each unit gets its own tag and history">
                <input type="number" min={1} max={500} className={inputCls} value={form.quantity} onChange={e => set({ quantity: e.target.value })} />
              </Field>
            )}
            {!isEdit && qty > 1 ? (
              <Field label="Serial numbers" error={errors.serialText} hint={`One per line — ${serials.length} of ${qty} entered (optional)`} className="sm:col-span-2">
                <textarea rows={3} className={cn(inputCls, 'font-mono')} value={form.serialText} onChange={e => set({ serialText: e.target.value })} placeholder={'C02XK1ABCD\nC02XK1ABCE'} />
              </Field>
            ) : (
              <Field label="Serial number" error={errors.serialNumber}>
                <input className={cn(inputCls, 'font-mono')} disabled={ro} value={form.serialNumber} onChange={e => set({ serialNumber: e.target.value })} maxLength={120} />
              </Field>
            )}
            {!isEdit && (
              <Field label="Location">
                <select className={inputCls} value={form.locationId} onChange={e => set({ locationId: e.target.value })}>
                  <option value="">No location</option>
                  {locations.map(l => <option key={l.id} value={l.id}>{l.name}{l.code ? ` (${l.code})` : ''}</option>)}
                </select>
              </Field>
            )}
          </div>

          {/* Purchase & cost */}
          <div className="border border-gray-100 rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-semibold text-gray-900">Purchase &amp; cost (per unit)</h3>
              {costLocked && (
                <span className="inline-flex items-center gap-1 text-xs text-amber-700 bg-amber-50 px-2 py-0.5 rounded-md">
                  <Lock className="w-3 h-3" /> {financials?.billLocked && !finLocked ? `From bill ${financials.billNo ?? ''}` : openingValuesLocked && !finLocked ? 'Opening balances locked' : 'Locked'}
                </span>
              )}
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Vendor">
                <select className={inputCls} value={form.vendorId} disabled={costLocked} onChange={e => set({ vendorId: e.target.value })}>
                  <option value="">{vendors.length ? 'Other / not listed' : 'Type the name →'}</option>
                  {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </Field>
              {!form.vendorId && (
                <Field label="Vendor name">
                  <input className={inputCls} value={form.vendorName} disabled={costLocked} onChange={e => set({ vendorName: e.target.value })} placeholder="e.g. Star Tech" />
                </Field>
              )}
              <Field label="Invoice / challan ref">
                <input className={inputCls} disabled={ro} value={form.invoiceRef} onChange={e => set({ invoiceRef: e.target.value })} />
              </Field>
              <Field label="Mushak-6.3 no.">
                <input className={inputCls} disabled={ro} value={form.mushakNo} onChange={e => set({ mushakNo: e.target.value })} />
              </Field>
              <Field label="Purchase date" error={errors.purchaseDate}>
                <DatePicker value={form.purchaseDate} onChange={v => set({ purchaseDate: v })} disabled={costLocked} />
              </Field>
              <Field label="Unit cost (excl. VAT)" error={errors.unitCost}>
                <input type="number" min={0} step="0.01" inputMode="decimal" className={inputCls} value={form.unitCost} disabled={costLocked} onChange={e => set({ unitCost: e.target.value })} />
              </Field>
              <Field label="VAT paid" error={errors.vatAmount}>
                <input type="number" min={0} step="0.01" inputMode="decimal" className={inputCls} value={form.vatAmount} disabled={costLocked} onChange={e => set({ vatAmount: e.target.value })} />
              </Field>
              <Field label="Other costs" error={errors.otherCosts} hint="Delivery, installation…">
                <input type="number" min={0} step="0.01" inputMode="decimal" className={inputCls} value={form.otherCosts} disabled={costLocked} onChange={e => set({ otherCosts: e.target.value })} />
              </Field>
              <div className="sm:col-span-2 flex items-start gap-2 pt-1">
                <input id="vatcap" type="checkbox" className="mt-0.5 rounded border-gray-300" checked={form.vatCapitalized} disabled={costLocked} onChange={e => set({ vatCapitalized: e.target.checked })} />
                <label htmlFor="vatcap" className="text-xs text-gray-600">
                  Add the VAT to the cost <span className="text-gray-400">— VAT on office equipment, furniture and vehicles cannot be claimed as input tax (VAT Act s.46), so it is part of the cost.</span>
                </label>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 bg-gray-50 rounded-lg px-3 py-2.5">
              <div className="text-sm">
                <span className="text-gray-500">Cost per unit </span>
                <span className="font-semibold text-gray-900">{tk(unitCostTotal)}</span>
                {!isEdit && qty > 1 && <span className="text-gray-500"> · total {tk(round2(unitCostTotal * qty))}</span>}
              </div>
              <div className="flex items-center gap-2">
                <label className="text-xs text-gray-500">Capitalize</label>
                <select className={cn(inputCls, 'w-auto py-1.5')} value={form.capMode} disabled={finLocked || openingValuesLocked} onChange={e => set({ capMode: e.target.value })}>
                  {!isEdit && <option value="AUTO">Auto ({autoCapitalize === null ? 'pick a category' : autoCapitalize ? 'yes' : 'no'})</option>}
                  <option value="YES">Yes — depreciate</option>
                  <option value="NO">No — expensed, tracked only</option>
                </select>
              </div>
            </div>
            {willCapitalize === false && (
              <p className="text-xs text-gray-500 flex items-start gap-1.5">
                <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                {category?.capitalize === false ? `${category.name} is set to be expensed.` : `Below the capitalization threshold of ${tk(threshold)}.`} The item is tagged and tracked but not depreciated.
              </p>
            )}
          </div>

          {/* Depreciation */}
          <Toggle open={sections.depreciation} onToggle={() => setSections(s => ({ ...s, depreciation: !s.depreciation }))}
            title="Depreciation & tax class"
            subtitle={finLocked ? 'Locked — depreciation has been posted' : `Book: ${form.method ? DEPRECIATION_METHOD_OPTIONS.find(o => o.value === form.method)?.label : (category?.depreciationMethod === 'DECLINING_BALANCE' ? 'Declining balance' : 'Straight-line')} over ${form.usefulLifeMonths || lifeDefault || '—'} months · Tax: ${taxCls?.label ?? '—'} ${taxCls?.rate ?? ''}%`}>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <Field label="Book method">
                <select className={inputCls} value={form.method} disabled={finLocked} onChange={e => set({ method: e.target.value })}>
                  <option value="">Category default</option>
                  {DEPRECIATION_METHOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
              <Field label="Useful life (months)" error={errors.usefulLifeMonths}>
                <input type="number" min={1} max={1200} className={inputCls} value={form.usefulLifeMonths} disabled={finLocked} placeholder={lifeDefault ? String(lifeDefault) : ''} onChange={e => set({ usefulLifeMonths: e.target.value })} />
              </Field>
              <Field label="Residual value" error={errors.residualValue}>
                <input type="number" min={0} step="0.01" className={inputCls} value={form.residualValue} disabled={finLocked} placeholder={category?.residualPct ? `${category.residualPct}% of cost` : '0'} onChange={e => set({ residualValue: e.target.value })} />
              </Field>
              {(form.method || category?.depreciationMethod) === 'DECLINING_BALANCE' && (
                <Field label="Declining rate % / year">
                  <input type="number" min={0} max={100} step="0.01" className={inputCls} value={form.decliningRatePct} disabled={finLocked} onChange={e => set({ decliningRatePct: e.target.value })} />
                </Field>
              )}
              <Field label="Available for use" hint="Depreciation starts here (default: purchase date)">
                <DatePicker value={form.availableForUseDate} onChange={v => set({ availableForUseDate: v })} disabled={finLocked} />
              </Field>
              <Field label="Tax class (Third Schedule)" className="sm:col-span-2" hint="Income Tax Act 2023 rate used for the tax WDV schedule">
                <select className={inputCls} disabled={ro} value={form.taxClass} onChange={e => set({ taxClass: e.target.value })}>
                  <option value="">Category default ({TAX_DEPRECIATION_CLASSES[category?.taxClass]?.label ?? '—'})</option>
                  {TAX_CLASS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
              </Field>
            </div>
          </Toggle>

          {/* Opening register */}
          <Toggle open={sections.opening} onToggle={() => setSections(s => ({ ...s, opening: !s.opening }))}
            title="Owned before go-live (opening register)"
            subtitle={form.isExisting ? `Accumulated depreciation ${tk(num(form.openingAccumulated) ?? 0)} carried in` : 'Bring in depreciation already charged in earlier books'}>
            {settings?.openingLocked || finLocked ? (
              <p className="text-xs text-amber-700 bg-amber-50 rounded-lg px-3 py-2">
                {settings?.openingLocked ? 'Opening balances are locked — opening values can no longer be changed.' : 'Locked — depreciation has been posted.'}
              </p>
            ) : null}
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input type="checkbox" className="mt-0.5 rounded border-gray-300" checked={form.isExisting}
                disabled={finLocked || Boolean(settings?.openingLocked)}
                onChange={e => set({ isExisting: e.target.checked })} />
              <span>This asset was owned before the system go-live{settings?.goLiveDate ? ` (${settings.goLiveDate})` : ''}</span>
            </label>
            {form.isExisting && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Values as of" error={errors.asOfDate}
                  hint={`Last day covered by the accumulated depreciation — before go-live (default: ${defaultAsOf ?? 'the day before go-live'})`}>
                  <DatePicker value={form.asOfDate} onChange={v => set({ asOfDate: v })} disabled={finLocked || Boolean(settings?.openingLocked)} placeholder={defaultAsOf ?? undefined} />
                </Field>
                <Field label="Accumulated depreciation (book)" error={errors.openingAccumulated} hint="From the fixed-asset schedule of the last audited accounts">
                  <input type="number" min={0} step="0.01" className={inputCls} value={form.openingAccumulated} disabled={finLocked || Boolean(settings?.openingLocked)} onChange={e => set({ openingAccumulated: e.target.value })} />
                </Field>
                <Field label="Tax written-down value" error={errors.taxWdv} hint="WDV brought forward at the start of the income year below">
                  <input type="number" min={0} step="0.01" className={inputCls} value={form.taxWdv} disabled={finLocked || Boolean(settings?.openingLocked)} onChange={e => set({ taxWdv: e.target.value })} />
                </Field>
                <Field label="Income year of that WDV" error={errors.taxWdvFiscalYear} hint="e.g. 2026-27">
                  <input className={inputCls} value={form.taxWdvFiscalYear} disabled={finLocked || Boolean(settings?.openingLocked)} placeholder="2026-27" onChange={e => set({ taxWdvFiscalYear: e.target.value })} />
                </Field>
              </div>
            )}
          </Toggle>

          {/* Assign now (create) */}
          {!isEdit && (
            <Toggle open={sections.assign} onToggle={() => setSections(s => ({ ...s, assign: !s.assign }))}
              title="Assign now (optional)" subtitle={form.employee ? `To ${form.employee.name}` : 'Hand it straight to an employee'}>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <Field label="Employee">
                  <PeoplePicker types={['EMPLOYEE']} value={form.employee} onChange={p => set({ employee: p })} placeholder="Search employees…" typeFilter={false} />
                </Field>
                <Field label="Expected return">
                  <DatePicker value={form.expectedReturnDate} onChange={v => set({ expectedReturnDate: v })} />
                </Field>
              </div>
              {form.isExisting && form.employee && <p className="text-xs text-gray-500">Opening assets are recorded as already handed over (no acknowledgement request).</p>}
            </Toggle>
          )}
          {isEdit && asset?.status === 'ASSIGNED' && (
            <Field label="Expected return" className="sm:w-1/2">
              <DatePicker value={form.expectedReturnDate} onChange={v => set({ expectedReturnDate: v })} />
            </Field>
          )}

          {/* Warranty & insurance */}
          <Toggle open={sections.warranty} onToggle={() => setSections(s => ({ ...s, warranty: !s.warranty }))}
            title="Warranty & insurance" subtitle={form.warrantyExpiry ? `Warranty until ${form.warrantyExpiry}` : 'Optional'}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Warranty expiry"><DatePicker value={form.warrantyExpiry} onChange={v => set({ warrantyExpiry: v })} disabled={ro} /></Field>
              <Field label="Warranty notes"><input className={inputCls} value={form.warrantyNotes} onChange={e => set({ warrantyNotes: e.target.value })} placeholder="e.g. 3-year onsite, call 096…" /></Field>
              <Field label="Insurer"><input className={inputCls} disabled={ro} value={form.insProvider} onChange={e => set({ insProvider: e.target.value })} /></Field>
              <Field label="Policy no."><input className={inputCls} disabled={ro} value={form.insPolicyNo} onChange={e => set({ insPolicyNo: e.target.value })} /></Field>
              <Field label="Policy expiry"><DatePicker value={form.insExpiry} onChange={v => set({ insExpiry: v })} disabled={ro} /></Field>
              <Field label="Insured value" error={errors.insValue}><input type="number" min={0} step="0.01" className={inputCls} disabled={ro} value={form.insValue} onChange={e => set({ insValue: e.target.value })} /></Field>
            </div>
          </Toggle>

          {/* Description, photo, documents */}
          <Toggle open={sections.more} onToggle={() => setSections(s => ({ ...s, more: !s.more }))}
            title="Description, photo & documents" subtitle={`${form.documents.length} document${form.documents.length === 1 ? '' : 's'}${form.imageUrl ? ' · photo' : ''}`}>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <Field label="Specifications / accessories" className="sm:col-span-2">
                <textarea rows={2} className={inputCls} value={form.specs} onChange={e => set({ specs: e.target.value })} placeholder="16 GB RAM, 512 GB SSD, charger, sleeve" />
              </Field>
              <Field label="Description" className="sm:col-span-2">
                <textarea rows={2} className={inputCls} value={form.description} onChange={e => set({ description: e.target.value })} />
              </Field>
              <div><FileUpload label="Photo" value={form.imageUrl} onUploaded={url => set({ imageUrl: url })} accept="image/*" bucket="assets" /></div>
              <div className="space-y-2">
                <span className="block text-sm font-medium text-gray-700">Documents</span>
                {form.documents.map((d, i) => (
                  <div key={`${d.url}-${i}`} className="flex items-center gap-2 text-xs bg-gray-50 rounded-lg px-2 py-1.5">
                    <span className="flex-1 truncate">{d.label || d.url.split('/').pop()}</span>
                    <button type="button" className="text-gray-400 hover:text-red-500" onClick={() => set({ documents: form.documents.filter((_, j) => j !== i) })}><X className="w-3.5 h-3.5" /></button>
                  </div>
                ))}
                <input className={inputCls} placeholder="Label (e.g. Invoice, Warranty card)" value={newDoc.label} onChange={e => setNewDoc(d => ({ ...d, label: e.target.value }))} />
                <FileUpload label={null} value={newDoc.url} onUploaded={url => setNewDoc(d => ({ ...d, url }))} bucket="assets" />
                {newDoc.url && (
                  <button type="button" className={btnSecondary} onClick={addDoc}><Plus className="w-4 h-4" /> Add document</button>
                )}
              </div>
            </div>
          </Toggle>

          <Field label="Notes">
            <textarea rows={2} className={inputCls} value={form.notes} onChange={e => set({ notes: e.target.value })} />
          </Field>
        </div>
      )}
      <ModalFooter className="-mx-4 sm:-mx-6 -mb-4 mt-5 sticky bottom-0 z-10">
        <button type="button" className={btnSecondary} onClick={() => onOpenChange(false)} disabled={saving}>Cancel</button>
        <button type="button" className={btnPrimary} onClick={submit} disabled={saving || optLoading}>
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          {isEdit ? 'Save changes' : qty > 1 ? `Add ${qty} assets` : 'Add asset'}
        </button>
      </ModalFooter>
    </Modal>
  )
}
