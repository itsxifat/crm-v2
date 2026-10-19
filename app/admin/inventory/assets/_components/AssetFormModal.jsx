'use client'

import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, Info, Loader2, Lock, Plus, X } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import DatePicker from '@/components/ui/DatePicker'
import FileUpload from '@/components/ui/FileUpload'
import PeoplePicker from '@/components/ui/PeoplePicker'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import { Input, Textarea, NativeSelect, Label } from '@/components/ui/Input'
import { addDays } from '@/lib/finance/fiscal'
import { TAX_DEPRECIATION_CLASSES } from '@/lib/tax/catalog'
import {
  CONDITION_OPTIONS, DEPRECIATION_METHOD_OPTIONS, computeAssetCost, round2,
} from '@/lib/inventory/constants'
import {
  Field, tk, dayKeyOf, apiJson, useAssetOptions, refId,
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
    <div className="rounded-lg border border-gray-200/80">
      <button type="button" onClick={onToggle} aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 rounded-lg px-4 py-3 text-left transition-colors hover:bg-gray-50/70">
        <span className="min-w-0">
          <span className="block text-sm font-medium text-gray-900">{title}</span>
          {subtitle && <span className="mt-0.5 block truncate text-xs text-muted-foreground">{subtitle}</span>}
        </span>
        {open ? <ChevronDown className="size-4 shrink-0 text-gray-400" /> : <ChevronRight className="size-4 shrink-0 text-gray-400" />}
      </button>
      {open && <div className="space-y-4 px-4 pb-4 pt-1">{children}</div>}
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
        ? 'Status, custody and location change via asset actions.'
        : 'For equipment you already own. Record new buys under Purchases.'}
    >
      {optLoading && !categories.length ? (
        <div className="flex items-center justify-center py-16"><Loader2 className="size-5 animate-spin text-gray-400" /></div>
      ) : optError && !categories.length ? (
        <div className="py-10 text-center text-sm text-red-600">{optError}</div>
      ) : (
        <div className="space-y-5">
          {ro && (
            <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
              <Lock className="mt-0.5 size-4 shrink-0" />
              Disposed — only specs, description, photo, documents, warranty notes and notes can change.
            </p>
          )}
          {/* Identity */}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Asset name" required error={errors.name} className="sm:col-span-2">
              <Input disabled={ro} value={form.name} onChange={e => set({ name: e.target.value })} placeholder="e.g. MacBook Pro 14-inch M3" maxLength={200} />
            </Field>
            <Field label="Category" required error={errors.categoryId}
              hint={finLocked ? 'Locked — depreciation posted' : category ? `Tags ${settings?.tagPrefix ?? 'EN'}-${category.code}-… · ${TAX_DEPRECIATION_CLASSES[category.taxClass]?.label ?? category.taxClass}` : null}>
              <NativeSelect value={form.categoryId} disabled={finLocked} onChange={e => set({ categoryId: e.target.value })}>
                <option value="">Select category</option>
                {categories.map(c => <option key={c.id} value={c.id}>{c.name} ({c.code})</option>)}
              </NativeSelect>
            </Field>
            <Field label="Condition">
              <NativeSelect disabled={ro} value={form.condition} onChange={e => set({ condition: e.target.value })}>
                {CONDITION_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </NativeSelect>
            </Field>
            <Field label="Brand"><Input disabled={ro} value={form.brand} onChange={e => set({ brand: e.target.value })} maxLength={100} /></Field>
            <Field label="Model"><Input disabled={ro} value={form.model} onChange={e => set({ model: e.target.value })} maxLength={100} /></Field>
            {!isEdit && (
              <Field label="Quantity" error={errors.quantity} hint="Each unit gets its own tag">
                <Input type="number" min={1} max={500} value={form.quantity} onChange={e => set({ quantity: e.target.value })} />
              </Field>
            )}
            {!isEdit && qty > 1 ? (
              <Field label="Serial numbers" error={errors.serialText} hint={`One per line · ${serials.length} of ${qty}`} className="sm:col-span-2">
                <Textarea rows={3} className="font-mono" value={form.serialText} onChange={e => set({ serialText: e.target.value })} placeholder={'C02XK1ABCD\nC02XK1ABCE'} />
              </Field>
            ) : (
              <Field label="Serial number" error={errors.serialNumber}>
                <Input className="font-mono" disabled={ro} value={form.serialNumber} onChange={e => set({ serialNumber: e.target.value })} maxLength={120} />
              </Field>
            )}
            {!isEdit && (
              <Field label="Location">
                <NativeSelect value={form.locationId} onChange={e => set({ locationId: e.target.value })}>
                  <option value="">No location</option>
                  {locations.map(l => <option key={l.id} value={l.id}>{l.name}{l.code ? ` (${l.code})` : ''}</option>)}
                </NativeSelect>
              </Field>
            )}
          </div>

          {/* Purchase & cost */}
          <div className="space-y-4 rounded-lg border border-gray-200/80 p-4">
            <div className="flex items-center justify-between gap-2">
              <h3 className="text-sm font-medium text-gray-900">Purchase &amp; cost (per unit)</h3>
              {costLocked && (
                <Badge variant="warning">
                  <Lock className="size-3" /> {financials?.billLocked && !finLocked ? `From bill ${financials.billNo ?? ''}` : openingValuesLocked && !finLocked ? 'Opening balances locked' : 'Locked'}
                </Badge>
              )}
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Vendor">
                <NativeSelect value={form.vendorId} disabled={costLocked} onChange={e => set({ vendorId: e.target.value })}>
                  <option value="">{vendors.length ? 'Other / not listed' : 'Type the name'}</option>
                  {vendors.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                </NativeSelect>
              </Field>
              {!form.vendorId && (
                <Field label="Vendor name">
                  <Input value={form.vendorName} disabled={costLocked} onChange={e => set({ vendorName: e.target.value })} placeholder="e.g. Star Tech" />
                </Field>
              )}
              <Field label="Invoice / challan ref">
                <Input disabled={ro} value={form.invoiceRef} onChange={e => set({ invoiceRef: e.target.value })} />
              </Field>
              <Field label="Mushak-6.3 no.">
                <Input disabled={ro} value={form.mushakNo} onChange={e => set({ mushakNo: e.target.value })} />
              </Field>
              <Field label="Purchase date" error={errors.purchaseDate}>
                <DatePicker value={form.purchaseDate} onChange={v => set({ purchaseDate: v })} disabled={costLocked} />
              </Field>
              <Field label="Unit cost (excl. VAT)" error={errors.unitCost}>
                <Input type="number" min={0} step="0.01" inputMode="decimal" value={form.unitCost} disabled={costLocked} onChange={e => set({ unitCost: e.target.value })} />
              </Field>
              <Field label="VAT paid" error={errors.vatAmount}>
                <Input type="number" min={0} step="0.01" inputMode="decimal" value={form.vatAmount} disabled={costLocked} onChange={e => set({ vatAmount: e.target.value })} />
              </Field>
              <Field label="Other costs" error={errors.otherCosts}>
                <Input type="number" min={0} step="0.01" inputMode="decimal" value={form.otherCosts} disabled={costLocked} onChange={e => set({ otherCosts: e.target.value })} />
              </Field>
              <div className="flex items-center gap-2 sm:col-span-2" title="VAT on office equipment, furniture and vehicles can't be claimed as input tax (VAT Act s.46), so it is part of the cost.">
                <input id="vatcap" type="checkbox" className="rounded border-gray-300" checked={form.vatCapitalized} disabled={costLocked} onChange={e => set({ vatCapitalized: e.target.checked })} />
                <label htmlFor="vatcap" className="text-sm text-gray-700">
                  Add VAT to cost <span className="text-muted-foreground">(not claimable — VAT Act s.46)</span>
                </label>
              </div>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg bg-gray-50 px-3 py-2.5">
              <div className="text-sm">
                <span className="text-muted-foreground">Cost per unit </span>
                <span className="font-semibold tabular-nums text-gray-900">{tk(unitCostTotal)}</span>
                {!isEdit && qty > 1 && <span className="text-muted-foreground"> · total {tk(round2(unitCostTotal * qty))}</span>}
              </div>
              <div className="flex items-center gap-2">
                <label htmlFor="capmode" className="text-[13px] text-muted-foreground">Capitalize</label>
                <NativeSelect id="capmode" className="h-8 w-auto" value={form.capMode} disabled={finLocked || openingValuesLocked} onChange={e => set({ capMode: e.target.value })}>
                  {!isEdit && <option value="AUTO">Auto ({autoCapitalize === null ? 'pick a category' : autoCapitalize ? 'yes' : 'no'})</option>}
                  <option value="YES">Yes — depreciate</option>
                  <option value="NO">No — expensed, tracked only</option>
                </NativeSelect>
              </div>
            </div>
            {willCapitalize === false && (
              <p className="flex items-start gap-1.5 text-xs text-muted-foreground">
                <Info className="mt-px size-3.5 shrink-0" />
                {category?.capitalize === false ? `${category.name} is set to be expensed.` : `Below the ${tk(threshold)} capitalization threshold.`} Tracked, not depreciated.
              </p>
            )}
          </div>

          {/* Depreciation */}
          <Toggle open={sections.depreciation} onToggle={() => setSections(s => ({ ...s, depreciation: !s.depreciation }))}
            title="Depreciation & tax class"
            subtitle={finLocked ? 'Locked — depreciation posted' : `Book: ${form.method ? DEPRECIATION_METHOD_OPTIONS.find(o => o.value === form.method)?.label : (category?.depreciationMethod === 'DECLINING_BALANCE' ? 'Declining balance' : 'Straight-line')} over ${form.usefulLifeMonths || lifeDefault || '—'} months · Tax: ${taxCls?.label ?? '—'} ${taxCls?.rate ?? ''}%`}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Book method">
                <NativeSelect value={form.method} disabled={finLocked} onChange={e => set({ method: e.target.value })}>
                  <option value="">Category default</option>
                  {DEPRECIATION_METHOD_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Useful life (months)" error={errors.usefulLifeMonths}>
                <Input type="number" min={1} max={1200} value={form.usefulLifeMonths} disabled={finLocked} placeholder={lifeDefault ? String(lifeDefault) : ''} onChange={e => set({ usefulLifeMonths: e.target.value })} />
              </Field>
              <Field label="Residual value" error={errors.residualValue}>
                <Input type="number" min={0} step="0.01" value={form.residualValue} disabled={finLocked} placeholder={category?.residualPct ? `${category.residualPct}% of cost` : '0'} onChange={e => set({ residualValue: e.target.value })} />
              </Field>
              {(form.method || category?.depreciationMethod) === 'DECLINING_BALANCE' && (
                <Field label="Declining rate (% / year)">
                  <Input type="number" min={0} max={100} step="0.01" value={form.decliningRatePct} disabled={finLocked} onChange={e => set({ decliningRatePct: e.target.value })} />
                </Field>
              )}
              <Field label="Available for use" hint="Depreciation start; defaults to purchase date">
                <DatePicker value={form.availableForUseDate} onChange={v => set({ availableForUseDate: v })} disabled={finLocked} />
              </Field>
              <Field label="Tax class (Third Schedule)" className="sm:col-span-2">
                <NativeSelect disabled={ro} value={form.taxClass} onChange={e => set({ taxClass: e.target.value })}>
                  <option value="">Category default ({TAX_DEPRECIATION_CLASSES[category?.taxClass]?.label ?? '—'})</option>
                  {TAX_CLASS_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </NativeSelect>
              </Field>
            </div>
          </Toggle>

          {/* Opening register */}
          <Toggle open={sections.opening} onToggle={() => setSections(s => ({ ...s, opening: !s.opening }))}
            title="Owned before go-live (opening register)"
            subtitle={form.isExisting ? `Accumulated depreciation ${tk(num(form.openingAccumulated) ?? 0)} carried in` : 'Optional'}>
            {settings?.openingLocked || finLocked ? (
              <p className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                <Lock className="mt-0.5 size-4 shrink-0" />
                {settings?.openingLocked ? 'Opening balances are locked.' : 'Locked — depreciation posted.'}
              </p>
            ) : null}
            <label className="flex items-start gap-2 text-sm text-gray-700">
              <input type="checkbox" className="mt-0.5 rounded border-gray-300" checked={form.isExisting}
                disabled={finLocked || Boolean(settings?.openingLocked)}
                onChange={e => set({ isExisting: e.target.checked })} />
              <span>Owned before go-live{settings?.goLiveDate ? ` (${settings.goLiveDate})` : ''}</span>
            </label>
            {form.isExisting && (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Values as of" error={errors.asOfDate}
                  hint={`Before go-live · default ${defaultAsOf ?? 'day before go-live'}`}>
                  <DatePicker value={form.asOfDate} onChange={v => set({ asOfDate: v })} disabled={finLocked || Boolean(settings?.openingLocked)} placeholder={defaultAsOf ?? undefined} />
                </Field>
                <Field label="Accumulated depreciation (book)" error={errors.openingAccumulated} hint="From the last audited fixed-asset schedule">
                  <Input type="number" min={0} step="0.01" value={form.openingAccumulated} disabled={finLocked || Boolean(settings?.openingLocked)} onChange={e => set({ openingAccumulated: e.target.value })} />
                </Field>
                <Field label="Tax written-down value" error={errors.taxWdv} hint="Brought forward at start of income year">
                  <Input type="number" min={0} step="0.01" value={form.taxWdv} disabled={finLocked || Boolean(settings?.openingLocked)} onChange={e => set({ taxWdv: e.target.value })} />
                </Field>
                <Field label="Income year of that WDV" error={errors.taxWdvFiscalYear}>
                  <Input value={form.taxWdvFiscalYear} disabled={finLocked || Boolean(settings?.openingLocked)} placeholder="2026-27" onChange={e => set({ taxWdvFiscalYear: e.target.value })} />
                </Field>
              </div>
            )}
          </Toggle>

          {/* Assign now (create) */}
          {!isEdit && (
            <Toggle open={sections.assign} onToggle={() => setSections(s => ({ ...s, assign: !s.assign }))}
              title="Assign now" subtitle={form.employee ? `To ${form.employee.name}` : 'Optional'}>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Employee">
                  <PeoplePicker types={['EMPLOYEE']} value={form.employee} onChange={p => set({ employee: p })} placeholder="Search employees…" typeFilter={false} />
                </Field>
                <Field label="Expected return">
                  <DatePicker value={form.expectedReturnDate} onChange={v => set({ expectedReturnDate: v })} />
                </Field>
              </div>
              {form.isExisting && form.employee && <p className="text-xs text-muted-foreground">Recorded as already handed over — no acknowledgement request.</p>}
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
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Warranty expiry"><DatePicker value={form.warrantyExpiry} onChange={v => set({ warrantyExpiry: v })} disabled={ro} /></Field>
              <Field label="Warranty notes"><Input value={form.warrantyNotes} onChange={e => set({ warrantyNotes: e.target.value })} placeholder="e.g. 3-year onsite, call 096…" /></Field>
              <Field label="Insurer"><Input disabled={ro} value={form.insProvider} onChange={e => set({ insProvider: e.target.value })} /></Field>
              <Field label="Policy no."><Input disabled={ro} value={form.insPolicyNo} onChange={e => set({ insPolicyNo: e.target.value })} /></Field>
              <Field label="Policy expiry"><DatePicker value={form.insExpiry} onChange={v => set({ insExpiry: v })} disabled={ro} /></Field>
              <Field label="Insured value" error={errors.insValue}><Input type="number" min={0} step="0.01" disabled={ro} value={form.insValue} onChange={e => set({ insValue: e.target.value })} /></Field>
            </div>
          </Toggle>

          {/* Description, photo, documents */}
          <Toggle open={sections.more} onToggle={() => setSections(s => ({ ...s, more: !s.more }))}
            title="Description, photo & documents" subtitle={`${form.documents.length} document${form.documents.length === 1 ? '' : 's'}${form.imageUrl ? ' · photo' : ''}`}>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Specifications / accessories" className="sm:col-span-2">
                <Textarea rows={2} value={form.specs} onChange={e => set({ specs: e.target.value })} placeholder="16 GB RAM, 512 GB SSD, charger, sleeve" />
              </Field>
              <Field label="Description" className="sm:col-span-2">
                <Textarea rows={2} value={form.description} onChange={e => set({ description: e.target.value })} />
              </Field>
              <div><FileUpload label="Photo" value={form.imageUrl} onUploaded={url => set({ imageUrl: url })} accept="image/*" bucket="assets" /></div>
              <div className="space-y-2">
                <Label className="mb-0">Documents</Label>
                {form.documents.map((d, i) => (
                  <div key={`${d.url}-${i}`} className="flex items-center gap-2 rounded-lg bg-gray-50 py-1 pl-2.5 pr-1 text-xs">
                    <span className="flex-1 truncate">{d.label || d.url.split('/').pop()}</span>
                    <Button variant="ghost" size="icon-xs" className="text-gray-400 hover:text-red-600" aria-label="Remove document" onClick={() => set({ documents: form.documents.filter((_, j) => j !== i) })}><X className="size-3.5" /></Button>
                  </div>
                ))}
                <Input placeholder="Label, e.g. Invoice" value={newDoc.label} onChange={e => setNewDoc(d => ({ ...d, label: e.target.value }))} />
                <FileUpload label={null} value={newDoc.url} onUploaded={url => setNewDoc(d => ({ ...d, url }))} bucket="assets" />
                {newDoc.url && (
                  <Button variant="outline" size="sm" onClick={addDoc}><Plus /> Add document</Button>
                )}
              </div>
            </div>
          </Toggle>

          <Field label="Notes">
            <Textarea rows={2} value={form.notes} onChange={e => set({ notes: e.target.value })} />
          </Field>
        </div>
      )}
      <ModalFooter className="sticky bottom-0 z-10">
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
        <Button onClick={submit} loading={saving} disabled={optLoading}>
          {isEdit ? 'Save changes' : qty > 1 ? `Add ${qty} assets` : 'Add asset'}
        </Button>
      </ModalFooter>
    </Modal>
  )
}
