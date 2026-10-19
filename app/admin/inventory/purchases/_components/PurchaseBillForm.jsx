'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  AlertTriangle, CheckCircle2, ChevronDown, Copy, FileText, Info, Laptop, Loader2, Package, PackageCheck,
  Plus, Receipt, Save, Trash2, X,
} from 'lucide-react'
import DatePicker from '@/components/ui/DatePicker'
import FileUpload from '@/components/ui/FileUpload'
import DocPreview from '@/components/ui/DocPreview'
import PeoplePicker from '@/components/ui/PeoplePicker'
import WithholdingFields, { emptyWithholding } from '@/components/tax/WithholdingFields'
import { usePermission } from '@/components/auth/Can'
import { cn } from '@/lib/utils'
import { dhakaDayKey } from '@/lib/dhakaTime'
import { VAT_RATE_OPTIONS, isValidBin } from '@/lib/tax/catalog'
import { STOCK_UNITS, SUPPLIER_VAT_TYPES, SUPPLIER_VAT_TYPE_LABELS } from '@/lib/inventory/constants'
import VendorPicker from './VendorPicker'
import {
  allocateOtherCosts, billToForm, computeLine, computeTotals, emptyLine, formToPayload, lineProblems, num,
  qtyText, serialsOf, tk, unitCostOf,
} from './billMath'

const ic = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 disabled:bg-gray-50'
const lc = 'block text-xs font-medium text-gray-600 mb-1'
const card = 'bg-white border border-gray-100 rounded-xl'

const TYPE_STYLE = {
  ASSET:      { label: 'Asset',       cls: 'bg-blue-50 text-blue-700',     icon: Laptop },
  CONSUMABLE: { label: 'Consumable',  cls: 'bg-teal-50 text-teal-700',     icon: Package },
  EXPENSE:    { label: 'Expense',     cls: 'bg-gray-100 text-gray-600',    icon: Receipt },
}

function newForm(presetVendor) {
  return {
    vendor: presetVendor ?? null,
    vendorName: presetVendor?.company ?? '',
    supplierBin: presetVendor?.bin ?? '',
    supplierVatType: presetVendor?.vatRegistrationType || 'REGISTERED',
    supplierInvoiceNo: '',
    mushakNo: '',
    mushakDate: null,
    billDate: dhakaDayKey(new Date()),
    otherCosts: '',
    vatCreditable: false,
    vatCreditableTouched: false,
    bankingChannel: true,
    oneOffPsr: true,
    withholding: {
      ...emptyWithholding(),
      tdsSection: presetVendor?.defaultTdsSection ?? null,
      vatServiceCode: presetVendor?.defaultVatServiceCode ?? null,
    },
    attachments: [],
    notes: '',
    lines: [emptyLine('ASSET')],
  }
}

/**
 * Purchase bill editor (new bill or a DRAFT). Saves through POST / PUT
 * /api/inventory/purchases and reports back with onSaved(bill, { receive }).
 */
export default function PurchaseBillForm({ bill = null, options, presetVendor = null, onSaved, extraActions = null }) {
  const [form, setForm] = useState(() => (bill ? { ...billToForm(bill), oneOffPsr: true } : newForm(presetVendor)))
  const [submitted, setSubmitted] = useState(false)
  const [saving, setSaving] = useState(null)
  const [serverError, setServerError] = useState(null)
  const [itc, setItc] = useState({ loading: false, data: null })
  const { can } = usePermission()
  const canAssign = can('inventory.assign')

  const categories = useMemo(() => options?.categories ?? [], [options])
  const stockItems = useMemo(() => options?.stockItems ?? [], [options])
  const locations = useMemo(() => options?.locations ?? [], [options])
  const settings = options?.settings ?? {}
  const threshold = num(settings.capitalizationThreshold ?? 10000)
  const catById = useMemo(() => new Map(categories.map(c => [c.id, c])), [categories])

  const set = (patch) => setForm(f => ({ ...f, ...(typeof patch === 'function' ? patch(f) : patch) }))
  const setLine = (key, patch) => setForm(f => ({
    ...f,
    lines: f.lines.map(l => (l.key === key ? { ...l, ...(typeof patch === 'function' ? patch(l) : patch) } : l)),
  }))

  // ── totals & VAT credit ──
  const totals = computeTotals(form.lines, form.otherCosts, {
    tdsAmount: form.withholding?.tdsAmount, vdsAmount: form.withholding?.vdsAmount,
  })
  const alloc = allocateOtherCosts(form.lines, form.otherCosts)
  const companyRegistered = (settings.vatRegistrationType ?? 'REGISTERED') === 'REGISTERED'
  const vatBlockedReason = !(totals.vatTotal > 0)
    ? 'No VAT on this bill'
    : !companyRegistered
      ? 'The company is not VAT registered — input VAT cannot be claimed'
      : form.supplierVatType !== 'REGISTERED'
        ? 'Only VAT-registered suppliers issue a creditable Mushak-6.3'
        : null
  const excludedItem = form.lines.some(l => {
    const c = l.categoryId ? catById.get(l.categoryId) : null
    return c ? !c.inputVatCreditable : false
  })
  const defaultCreditable = !vatBlockedReason &&
    (settings.defaultSalesTreatment ?? 'STANDARD') === 'STANDARD' &&
    form.lines.every(l => Boolean(l.categoryId && catById.get(l.categoryId)?.inputVatCreditable))
  const vatCreditable = vatBlockedReason ? false : (form.vatCreditableTouched ? form.vatCreditable : defaultCreditable)

  const payload = useMemo(
    () => ({ ...formToPayload(form), vatCreditable }),
    [form, vatCreditable],
  )
  const payloadJson = JSON.stringify(payload)
  const baseline = useRef(null)
  if (baseline.current === null) baseline.current = bill ? payloadJson : ''
  const dirty = bill ? payloadJson !== baseline.current : true

  // Warn before leaving with unsaved edits.
  useEffect(() => {
    if (!dirty || !bill) return undefined
    const onBeforeUnload = (e) => { e.preventDefault(); e.returnValue = '' }
    window.addEventListener('beforeunload', onBeforeUnload)
    return () => window.removeEventListener('beforeunload', onBeforeUnload)
  }, [dirty, bill])

  // Input-VAT creditability hint (server rule set, incl. the company's sales treatment).
  useEffect(() => {
    if (!(totals.vatTotal > 0)) { setItc({ loading: false, data: null }); return undefined }
    const ctrl = new AbortController()
    setItc(s => ({ ...s, loading: true }))
    const t = setTimeout(async () => {
      try {
        const qs = new URLSearchParams({
          type: 'itc',
          supplierVatType: form.supplierVatType || 'REGISTERED',
          hasMushak: form.mushakNo?.trim() ? '1' : '0',
          excludedItem: excludedItem ? '1' : '0',
          gross: String(totals.total),
          bank: form.bankingChannel ? '1' : '0',
        })
        const res = await fetch(`/api/tax/suggest?${qs}`, { signal: ctrl.signal })
        const json = await res.json().catch(() => ({}))
        setItc({ loading: false, data: res.ok ? json.data : null })
      } catch (err) {
        if (err?.name !== 'AbortError') setItc({ loading: false, data: null })
      }
    }, 400)
    return () => { clearTimeout(t); ctrl.abort() }
  }, [totals.vatTotal, totals.total, form.supplierVatType, form.mushakNo, excludedItem, form.bankingChannel])

  // ── supplier ──
  function pickVendor(v) {
    set(f => ({
      vendor: v,
      vendorName: v?.company ?? '',
      supplierBin: v ? (v.bin ?? '') : f.supplierBin,
      supplierVatType: v ? (v.vatRegistrationType || 'REGISTERED') : f.supplierVatType,
      withholding: v ? {
        ...f.withholding,
        tdsSection: f.withholding?.tdsSection || v.defaultTdsSection || null,
        vatServiceCode: f.withholding?.vatServiceCode || v.defaultVatServiceCode || null,
      } : f.withholding,
    }))
  }

  // ── lines ──
  function addLine(type) {
    set(f => ({ lines: [...f.lines, emptyLine(type, { vatRate: f.lines[f.lines.length - 1]?.vatRate ?? '' })] }))
  }
  function duplicateLine(key) {
    set(f => {
      const i = f.lines.findIndex(l => l.key === key)
      if (i < 0) return {}
      const copy = { ...emptyLine(f.lines[i].lineType), ...f.lines[i], key: emptyLine().key, id: null, serialText: '' }
      const lines = [...f.lines]
      lines.splice(i + 1, 0, copy)
      return { lines }
    })
  }
  function removeLine(key) {
    set(f => ({ lines: f.lines.length > 1 ? f.lines.filter(l => l.key !== key) : f.lines }))
  }

  // ── validation & save ──
  const binProblem = form.supplierBin?.trim() && !isValidBin(form.supplierBin.replace(/\s+/g, ''))
    ? 'BIN is 9 or 13 digits, e.g. 000123456-0101' : null
  const today = dhakaDayKey(new Date())

  function firstProblem() {
    if (!form.vendor && !form.vendorName?.trim()) return 'Choose a vendor or type the supplier name'
    if (!form.billDate) return 'Enter the bill date'
    if (form.billDate > today) return 'Bill date cannot be in the future'
    if (binProblem) return binProblem
    for (const [i, l] of form.lines.entries()) {
      const p = lineProblems(l)
      if (p.length) return `Line ${i + 1}: ${p[0]}`
    }
    if (totals.netPayable < -0.005) return 'Withholding is more than the bill total'
    return null
  }

  async function save(receive) {
    setSubmitted(true)
    setServerError(null)
    const problem = firstProblem()
    if (problem) { toast.error(problem); return }
    if (bill && !dirty) { onSaved?.(bill, { receive }); return }
    setSaving(receive ? 'receive' : 'draft')
    try {
      const res = await fetch(bill ? `/api/inventory/purchases/${bill.id}` : '/api/inventory/purchases', {
        method: bill ? 'PUT' : 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payloadJson,
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not save the bill')
      baseline.current = payloadJson
      if (!receive) toast.success(bill ? 'Draft saved' : `Draft ${json.data?.billNo ?? ''} saved`)
      onSaved?.(json.data, { receive })
    } catch (err) {
      setServerError(err.message)
      toast.error(err.message)
    } finally {
      setSaving(null)
    }
  }

  const counts = form.lines.reduce((acc, l) => {
    if (l.lineType === 'ASSET') acc.assets += num(l.qty)
    else if (l.lineType === 'CONSUMABLE') acc.stock += 1
    else acc.expense += 1
    return acc
  }, { assets: 0, stock: 0, expense: 0 })

  const payeeType = form.vendor?.payeeType ?? 'COMPANY'
  const hasPsr = form.vendor ? Boolean(form.vendor.hasPsr) : Boolean(form.oneOffPsr)

  return (
    <div className="grid grid-cols-1 xl:grid-cols-3 gap-4 items-start">
      <datalist id="pb-vat-rates">
        {VAT_RATE_OPTIONS.map(r => <option key={r} value={r} />)}
      </datalist>
      <datalist id="pb-units">
        {STOCK_UNITS.map(u => <option key={u} value={u} />)}
      </datalist>

      {/* ── Left: supplier + lines ── */}
      <div className="xl:col-span-2 space-y-4 min-w-0">
        <section className={cn(card, 'p-4 space-y-3')}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-gray-900">Supplier & documents</h2>
            {form.vendor && !form.vendor.bin && form.supplierVatType === 'REGISTERED' && (
              <span className="text-[11px] text-amber-700">Vendor has no BIN on file — enter it from the Mushak-6.3</span>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="sm:col-span-2">
              <label className={lc}>Supplier <span className="text-red-500">*</span></label>
              {!form.vendor && form.vendorName ? (
                <div className="flex items-center gap-2">
                  <input value={form.vendorName} onChange={e => set({ vendorName: e.target.value })} className={ic} maxLength={200} placeholder="Supplier name" />
                  <button type="button" onClick={() => set({ vendorName: '' })} className="shrink-0 text-xs text-gray-500 hover:text-gray-900 underline underline-offset-2">
                    Pick vendor
                  </button>
                </div>
              ) : (
                <VendorPicker value={form.vendor} onChange={pickVendor} onOneOff={(name) => set({ vendor: null, vendorName: name })} />
              )}
            </div>
            <div>
              <label className={lc}>Bill date <span className="text-red-500">*</span></label>
              <DatePicker value={form.billDate} onChange={v => set({ billDate: v })} clearable={false} />
            </div>
            <div>
              <label className={lc}>Supplier BIN</label>
              <input value={form.supplierBin} onChange={e => set({ supplierBin: e.target.value })} className={cn(ic, binProblem && submitted && 'border-red-300')} placeholder="000123456-0101" maxLength={20} />
              <p className={cn('mt-1 text-[11px]', binProblem ? 'text-red-600' : 'text-gray-400')}>{binProblem ?? 'BIN is 13 digits, e.g. 000123456-0101'}</p>
            </div>
            <div>
              <label className={lc}>Supplier VAT status</label>
              <select value={form.supplierVatType} onChange={e => set({ supplierVatType: e.target.value })} className={ic}>
                {SUPPLIER_VAT_TYPES.map(t => <option key={t} value={t}>{SUPPLIER_VAT_TYPE_LABELS[t] ?? t}</option>)}
              </select>
            </div>
            <div>
              <label className={lc}>Supplier invoice no.</label>
              <input value={form.supplierInvoiceNo} onChange={e => set({ supplierInvoiceNo: e.target.value })} className={ic} maxLength={100} placeholder="INV-2026-0412" />
            </div>
            <div>
              <label className={lc}>Mushak-6.3 no.</label>
              <input value={form.mushakNo} onChange={e => set({ mushakNo: e.target.value })} className={ic} maxLength={100} placeholder="Tax invoice number" />
            </div>
            <div>
              <label className={lc}>Mushak-6.3 date</label>
              <DatePicker value={form.mushakDate} onChange={v => set({ mushakDate: v })} placeholder="Same as bill" />
            </div>
            {!form.vendor && form.vendorName && (
              <label className="flex items-center gap-2 text-sm text-gray-700 self-end pb-2">
                <input type="checkbox" checked={form.oneOffPsr} onChange={e => set({ oneOffPsr: e.target.checked })} className="rounded border-gray-300" />
                Supplier showed PSR
              </label>
            )}
          </div>

          <div>
            <label className={lc}>Bill / Mushak scans</label>
            <div className="space-y-2">
              {form.attachments.map((url) => (
                <div key={url} className="flex items-center gap-2">
                  <DocPreview url={url} compact className="flex-1 min-w-0" />
                  <button type="button" onClick={() => set(f => ({ attachments: f.attachments.filter(a => a !== url) }))}
                    className="p-1.5 text-gray-400 hover:text-red-600" aria-label="Remove attachment">
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ))}
              {form.attachments.length < 20 && (
                <FileUpload value={null} label={null} bucket="assets"
                  onUploaded={(url) => { if (url) set(f => ({ attachments: f.attachments.includes(url) ? f.attachments : [...f.attachments, url] })) }} />
              )}
            </div>
          </div>
        </section>

        <section className={cn(card, 'p-4 space-y-3')}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h2 className="text-sm font-semibold text-gray-900">Items</h2>
              <p className="text-xs text-gray-500">
                {qtyText(counts.assets)} asset{counts.assets === 1 ? '' : 's'} to tag · {counts.stock} stock line{counts.stock === 1 ? '' : 's'} · {counts.expense} expense line{counts.expense === 1 ? '' : 's'}
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(TYPE_STYLE).map(([type, s]) => {
                const Icon = s.icon
                return (
                  <button key={type} type="button" onClick={() => addLine(type)}
                    className="inline-flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50">
                    <Plus className="w-3.5 h-3.5" /><Icon className="w-3.5 h-3.5 text-gray-400" /> {s.label}
                  </button>
                )
              })}
            </div>
          </div>

          <div className="space-y-3">
            {form.lines.map((line, i) => (
              <LineEditor
                key={line.key}
                index={i}
                line={line}
                onChange={(patch) => setLine(line.key, patch)}
                onRemove={form.lines.length > 1 ? () => removeLine(line.key) : null}
                onDuplicate={() => duplicateLine(line.key)}
                categories={categories}
                catById={catById}
                stockItems={stockItems}
                locations={locations}
                threshold={threshold}
                vatCreditable={vatCreditable}
                otherShare={alloc[i]}
                showProblems={submitted}
                canAssign={canAssign}
              />
            ))}
          </div>
        </section>

        <section className={cn(card, 'p-4')}>
          <label className={lc}>Notes</label>
          <textarea value={form.notes} onChange={e => set({ notes: e.target.value })} rows={2} maxLength={2000} className={ic}
            placeholder="Delivery details, warranty terms, who approved the purchase…" />
        </section>
      </div>

      {/* ── Right: totals, VAT credit, withholding, actions ── */}
      <div className="space-y-4 xl:sticky xl:top-4">
        <section className={cn(card, 'p-4 space-y-2 text-sm')}>
          <h2 className="text-sm font-semibold text-gray-900 mb-1">Totals</h2>
          <Row label="Subtotal (excl. VAT)" value={tk(totals.subtotal)} />
          <Row label="VAT" value={tk(totals.vatTotal)} />
          {totals.sdTotal > 0 && <Row label="Supplementary duty" value={tk(totals.sdTotal)} />}
          <div className="flex items-center justify-between gap-3">
            <span className="text-gray-500">Other costs</span>
            <input type="number" min="0" step="0.01" inputMode="decimal" value={form.otherCosts}
              onChange={e => set({ otherCosts: e.target.value })}
              className="w-32 border border-gray-200 rounded-lg px-2 py-1 text-sm text-right focus:outline-none focus:ring-2 focus:ring-gray-900" placeholder="0.00" />
          </div>
          {num(form.otherCosts) > 0 && <p className="text-[11px] text-gray-400">Delivery / installation — added to the cost of assets and stock pro rata.</p>}
          <div className="border-t border-gray-100 pt-2">
            <Row label="Bill total" value={tk(totals.total)} strong />
          </div>
        </section>

        <section className={cn(card, 'p-4 space-y-2')}>
          <label className={cn('flex items-start gap-2 text-sm', vatBlockedReason ? 'text-gray-400' : 'text-gray-800')}>
            <input
              type="checkbox"
              className="mt-0.5 rounded border-gray-300"
              disabled={Boolean(vatBlockedReason)}
              checked={vatCreditable}
              onChange={e => set({ vatCreditable: e.target.checked, vatCreditableTouched: true })}
            />
            <span>
              <span className="font-medium">VAT creditable</span>
              <span className="block text-xs text-gray-500">
                {vatCreditable ? 'VAT is claimed as input tax credit (not added to cost).' : 'VAT is added to the cost of the items.'}
              </span>
            </span>
          </label>
          <ItcHint blocked={vatBlockedReason} itc={itc} claimed={vatCreditable} />
          <label className="flex items-start gap-2 text-sm text-gray-800 pt-1">
            <input type="checkbox" className="mt-0.5 rounded border-gray-300" checked={form.bankingChannel}
              onChange={e => set({ bankingChannel: e.target.checked })} />
            <span>
              <span className="font-medium">Paid through bank / MFS</span>
              <span className="block text-xs text-gray-500">Cash payments attract 50% higher TDS and lose input VAT over ৳ 1,00,000.</span>
            </span>
          </label>
        </section>

        <WithholdingFields
          mode="PAYEE"
          baseAmount={totals.taxableBase}
          vatAmount={totals.vatTotal}
          payeeType={payeeType}
          hasPsr={hasPsr}
          bankingChannel={form.bankingChannel}
          supplierVatType={form.supplierVatType}
          date={form.billDate}
          value={form.withholding}
          onChange={(w) => set({ withholding: w })}
          compact
        />

        <section className={cn(card, 'p-4 space-y-3')}>
          <div className="flex items-end justify-between gap-2">
            <div>
              <p className="text-xs text-gray-500">Net payable to supplier</p>
              <p className={cn('text-2xl font-semibold', totals.netPayable < 0 ? 'text-red-600' : 'text-gray-900')}>{tk(totals.netPayable)}</p>
            </div>
            {totals.withheld > 0 && <p className="text-xs text-gray-500 text-right">{tk(totals.total)} − {tk(totals.withheld)} withheld</p>}
          </div>

          {serverError && (
            <p className="flex items-start gap-2 text-xs text-red-700 bg-red-50 rounded-lg px-3 py-2">
              <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" /> {serverError}
            </p>
          )}

          <div className="flex flex-col sm:flex-row xl:flex-col gap-2">
            <button type="button" onClick={() => save(true)} disabled={Boolean(saving)}
              className="flex-1 inline-flex items-center justify-center gap-1.5 bg-gray-900 text-white hover:bg-gray-800 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-60">
              {saving === 'receive' ? <Loader2 className="w-4 h-4 animate-spin" /> : <PackageCheck className="w-4 h-4" />}
              {bill ? (dirty ? 'Save & receive…' : 'Receive…') : 'Save & receive…'}
            </button>
            <button type="button" onClick={() => save(false)} disabled={Boolean(saving) || (bill && !dirty)}
              className="flex-1 inline-flex items-center justify-center gap-1.5 border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50">
              {saving === 'draft' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {bill ? (dirty ? 'Save draft' : 'Saved') : 'Save as draft'}
            </button>
            {extraActions}
          </div>
          <p className="text-[11px] text-gray-400 leading-snug">
            Receiving tags each asset (one per unit), adds consumables to stock and records the payment — or sends it to Accounts.
          </p>
        </section>
      </div>
    </div>
  )
}

function Row({ label, value, strong }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span className={strong ? 'font-medium text-gray-900' : 'text-gray-500'}>{label}</span>
      <span className={strong ? 'font-semibold text-gray-900' : 'text-gray-900'}>{value}</span>
    </div>
  )
}

function ItcHint({ blocked, itc, claimed }) {
  if (blocked) {
    return <p className="flex items-start gap-1.5 text-[11px] text-gray-500"><Info className="w-3 h-3 mt-0.5 shrink-0" />{blocked}</p>
  }
  if (itc.loading && !itc.data) {
    return <p className="flex items-center gap-1.5 text-[11px] text-gray-400"><Loader2 className="w-3 h-3 animate-spin" /> Checking VAT credit rules…</p>
  }
  const d = itc.data
  if (!d) return null
  if (d.creditable) {
    return (
      <p className="flex items-start gap-1.5 text-[11px] text-green-700">
        <CheckCircle2 className="w-3 h-3 mt-0.5 shrink-0" />
        Creditable under the VAT rules — keep the Mushak-6.3 with both BINs and claim within 6 tax periods.
      </p>
    )
  }
  return (
    <p className={cn('flex items-start gap-1.5 text-[11px]', claimed ? 'text-amber-700' : 'text-gray-500')}>
      <AlertTriangle className="w-3 h-3 mt-0.5 shrink-0" />
      {claimed ? 'Claim may be disallowed: ' : 'Not creditable: '}{d.reasonLabel ?? d.reason}
    </p>
  )
}

// ── one line ─────────────────────────────────────────────────────────────────

function LineEditor({
  index, line, onChange, onRemove, onDuplicate, categories, catById, stockItems, locations, threshold,
  vatCreditable, otherShare, showProblems, canAssign = true,
}) {
  const c = computeLine(line)
  const cat = line.categoryId ? catById.get(line.categoryId) : null
  const style = TYPE_STYLE[line.lineType] ?? TYPE_STYLE.EXPENSE
  const TypeIcon = style.icon
  const problems = showProblems ? lineProblems(line) : []
  const serials = serialsOf(line)
  const qty = num(line.qty)
  const unitCost = unitCostOf(line, { vatCreditable, otherShare })
  const [open, setOpen] = useState(() => Boolean(line.expanded || line.assignee || line.serialText || line.locationId || line.brand || line.warrantyMonths))

  const assetCats = categories.filter(x => x.type === 'ASSET')
  const consumableCats = categories.filter(x => x.type === 'CONSUMABLE')
  const itemsForCat = line.categoryId ? stockItems.filter(s => s.categoryId === line.categoryId) : stockItems
  const selectValue = `${line.lineType}:${line.categoryId || ''}`

  function onCategory(v) {
    const [type, id] = v.split(':')
    onChange(l => ({
      lineType: type,
      categoryId: id || '',
      stockItemId: type === 'CONSUMABLE' && l.stockItemId && stockItems.find(s => s.id === l.stockItemId)?.categoryId === id ? l.stockItemId : '',
      unit: type === 'ASSET' ? 'pcs' : (l.unit || 'pcs'),
      capitalize: type === 'ASSET' ? l.capitalize : null,
      qty: type === 'ASSET' && !Number.isInteger(num(l.qty)) ? Math.max(1, Math.round(num(l.qty))) : l.qty,
    }))
  }

  function onStockItem(id) {
    const item = stockItems.find(s => s.id === id)
    onChange(l => ({
      stockItemId: id,
      categoryId: item?.categoryId || l.categoryId,
      unit: item?.unit || l.unit,
      description: l.description?.trim() ? l.description : (item?.name ?? ''),
    }))
  }

  // Capitalisation outcome shown on asset lines.
  let capText = null
  let capTone = 'text-gray-500'
  if (line.lineType === 'ASSET') {
    if (line.capitalize === true) { capText = 'Capitalised (manual)'; capTone = 'text-blue-700' }
    else if (line.capitalize === false) { capText = 'Expensed (manual)'; capTone = 'text-gray-600' }
    else if (cat && cat.capitalize === false) { capText = 'Expensed — category policy'; capTone = 'text-gray-600' }
    else if (unitCost >= threshold) { capText = `Capitalised — unit cost ≥ ${tk(threshold, 0)}`; capTone = 'text-blue-700' }
    else { capText = `Expensed — below the ${tk(threshold, 0)} threshold`; capTone = 'text-gray-600' }
  }

  return (
    <div className={cn('rounded-xl border p-3', problems.length ? 'border-red-200 bg-red-50/30' : 'border-gray-100 bg-gray-50/40')}>
      <div className="flex items-center justify-between gap-2 mb-2">
        <span className="flex items-center gap-2 min-w-0">
          <span className="text-xs font-semibold text-gray-400 w-5">{index + 1}</span>
          <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-[11px] font-medium', style.cls)}>
            <TypeIcon className="w-3 h-3" /> {style.label}
          </span>
          {cat && <span className="text-[11px] text-gray-400 truncate">{cat.code}</span>}
        </span>
        <span className="flex items-center gap-1">
          <button type="button" onClick={onDuplicate} className="p-1.5 text-gray-400 hover:text-gray-700 rounded-md hover:bg-white" title="Duplicate line">
            <Copy className="w-3.5 h-3.5" />
          </button>
          {onRemove && (
            <button type="button" onClick={onRemove} className="p-1.5 text-gray-400 hover:text-red-600 rounded-md hover:bg-white" title="Remove line">
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          )}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-12 gap-2">
        <div className="col-span-2 md:col-span-3">
          <label className={lc}>Category</label>
          <select value={selectValue} onChange={e => onCategory(e.target.value)} className={ic}>
            {!line.categoryId && line.lineType !== 'EXPENSE' && <option value={`${line.lineType}:`}>Choose…</option>}
            <optgroup label="Assets — tagged one by one">
              {assetCats.map(x => <option key={x.id} value={`ASSET:${x.id}`}>{x.name}</option>)}
            </optgroup>
            <optgroup label="Consumables — stock by quantity">
              {consumableCats.map(x => <option key={x.id} value={`CONSUMABLE:${x.id}`}>{x.name}</option>)}
            </optgroup>
            <optgroup label="Expense / service — no stock">
              <option value="EXPENSE:">Service or other expense</option>
            </optgroup>
          </select>
        </div>
        <div className="col-span-2 md:col-span-4">
          <label className={lc}>Description</label>
          <input value={line.description} onChange={e => onChange({ description: e.target.value })} className={ic} maxLength={300}
            placeholder={line.lineType === 'ASSET' ? 'e.g. Dell Latitude 5440 laptop' : line.lineType === 'CONSUMABLE' ? 'e.g. A4 paper 80gsm' : 'e.g. Installation service'} />
        </div>
        <div className="col-span-1 md:col-span-1">
          <label className={lc}>Qty</label>
          <input type="number" min="0" step={line.lineType === 'ASSET' ? '1' : 'any'} inputMode="decimal" value={line.qty}
            onChange={e => onChange({ qty: e.target.value })} className={ic} />
        </div>
        <div className="col-span-1 md:col-span-2">
          <label className={lc}>Unit price</label>
          <input type="number" min="0" step="0.01" inputMode="decimal" value={line.unitPrice}
            onChange={e => onChange({ unitPrice: e.target.value })} className={ic} placeholder="excl. VAT" />
        </div>
        <div className="col-span-1 md:col-span-1">
          <label className={lc}>VAT %</label>
          <input type="number" min="0" max="100" step="0.1" inputMode="decimal" list="pb-vat-rates" value={line.vatRate}
            onChange={e => onChange({ vatRate: e.target.value })} className={ic} placeholder="0" />
        </div>
        <div className="col-span-1 md:col-span-1 flex flex-col justify-end">
          <span className="text-[11px] text-gray-400 md:text-right">Total</span>
          <span className="text-sm font-semibold text-gray-900 md:text-right whitespace-nowrap">{tk(c.lineTotal, 0)}</span>
        </div>
      </div>

      {line.lineType === 'CONSUMABLE' && (
        <div className="grid grid-cols-2 md:grid-cols-12 gap-2 mt-2">
          <div className="col-span-2 md:col-span-7">
            <label className={lc}>Stock item</label>
            <select value={line.stockItemId || ''} onChange={e => onStockItem(e.target.value)} className={ic}>
              <option value="">New stock item — “{line.description?.trim() || 'description'}”</option>
              {itemsForCat.map(s => <option key={s.id} value={s.id}>{s.name} · {s.sku} ({qtyText(s.qtyOnHand)} {s.unit} on hand)</option>)}
            </select>
          </div>
          <div className="col-span-1 md:col-span-2">
            <label className={lc}>Unit</label>
            <input value={line.unit} onChange={e => onChange({ unit: e.target.value })} list="pb-units" className={ic} maxLength={20} />
          </div>
          <div className="col-span-1 md:col-span-3 flex flex-col justify-end">
            <span className="text-[11px] text-gray-400">Cost per {line.unit || 'unit'} into stock</span>
            <span className="text-sm text-gray-800">{tk(unitCost)}</span>
          </div>
        </div>
      )}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        <span className="text-gray-500">VAT {tk(c.vatAmount)}{c.sdAmount > 0 ? ` · SD ${tk(c.sdAmount)}` : ''}</span>
        {line.lineType === 'ASSET' && (
          <>
            <span className="text-gray-500">Unit cost {tk(unitCost)}</span>
            <span className={capTone}>{capText}</span>
            {serials.length > 0 && (
              <span className={serials.length === qty ? 'text-green-700' : serials.length > qty ? 'text-red-600' : 'text-amber-700'}>
                {serials.length}/{qtyText(qty)} serials
              </span>
            )}
            {line.assignee && <span className="text-blue-700">→ {line.assignee.name}</span>}
          </>
        )}
        <button type="button" onClick={() => setOpen(o => !o)} className="ml-auto inline-flex items-center gap-1 text-gray-600 hover:text-gray-900 font-medium">
          {open ? 'Less' : line.lineType === 'ASSET' ? 'Serials, assignee & more' : 'More'}
          <ChevronDown className={cn('w-3.5 h-3.5 transition-transform', open && 'rotate-180')} />
        </button>
      </div>

      {open && (
        <div className="grid grid-cols-2 md:grid-cols-6 gap-2 mt-3 pt-3 border-t border-gray-100">
          {line.lineType === 'ASSET' && (
            <>
              <div className="col-span-1 md:col-span-2">
                <label className={lc}>Brand</label>
                <input value={line.brand} onChange={e => onChange({ brand: e.target.value })} className={ic} maxLength={100} />
              </div>
              <div className="col-span-1 md:col-span-2">
                <label className={lc}>Model</label>
                <input value={line.model} onChange={e => onChange({ model: e.target.value })} className={ic} maxLength={100} />
              </div>
              <div className="col-span-1 md:col-span-1">
                <label className={lc}>Capitalise</label>
                <select value={line.capitalize === null ? 'AUTO' : line.capitalize ? 'YES' : 'NO'}
                  onChange={e => onChange({ capitalize: e.target.value === 'AUTO' ? null : e.target.value === 'YES' })} className={ic}>
                  <option value="AUTO">Auto</option>
                  <option value="YES">Yes — fixed asset</option>
                  <option value="NO">No — expense</option>
                </select>
              </div>
              <div className="col-span-1 md:col-span-1">
                <label className={lc}>Warranty (months)</label>
                <input type="number" min="0" max="240" step="1" value={line.warrantyMonths}
                  onChange={e => onChange({ warrantyMonths: e.target.value })} className={ic} placeholder="e.g. 36" />
              </div>
              <div className="col-span-2 md:col-span-3">
                <label className={lc}>Assign on receipt to</label>
                {canAssign || line.assignee ? (
                  <PeoplePicker types={['EMPLOYEE']} typeFilter={false} value={line.assignee} onChange={p => onChange({ assignee: p })} placeholder="Keep in stock" />
                ) : (
                  <p className="text-xs text-gray-400 py-2">Assets go into stock — someone with the assign permission hands them out.</p>
                )}
                {line.assignee && !canAssign && (
                  <p className="mt-1 text-[11px] text-amber-700">You cannot assign assets — clear this or ask someone who can to receive the bill.</p>
                )}
                {line.assignee && canAssign && cat?.requiresAcknowledgement !== false && (
                  <p className="mt-1 text-[11px] text-gray-400">They will be asked to acknowledge receipt in My Assets.</p>
                )}
              </div>
            </>
          )}
          {line.lineType !== 'EXPENSE' && (
            <div className={cn('col-span-2', line.lineType === 'ASSET' ? 'md:col-span-3' : 'md:col-span-2')}>
              <label className={lc}>Location</label>
              <select value={line.locationId || ''} onChange={e => onChange({ locationId: e.target.value })} className={ic}>
                <option value="">Not set</option>
                {locations.map(l => <option key={l.id} value={l.id}>{l.name}{l.code ? ` (${l.code})` : ''}</option>)}
              </select>
            </div>
          )}
          {line.lineType === 'ASSET' && (
            <div className="col-span-2 md:col-span-6">
              <label className={lc}>
                Serial numbers <span className="text-gray-400 font-normal">— one per line, {qtyText(qty)} needed (or leave empty)</span>
              </label>
              <textarea rows={Math.min(6, Math.max(2, serials.length + 1))} value={line.serialText}
                onChange={e => onChange({ serialText: e.target.value })} className={cn(ic, 'font-mono text-xs')}
                placeholder={'SN-1234567\nSN-1234568'} />
            </div>
          )}
          {line.lineType === 'EXPENSE' && (
            <div className="col-span-1 md:col-span-2">
              <label className={lc}>Unit</label>
              <input value={line.unit || ''} onChange={e => onChange({ unit: e.target.value })} list="pb-units" className={ic} maxLength={20} placeholder="e.g. month, job" />
            </div>
          )}
          <div className="col-span-1 md:col-span-2">
            <label className={lc}>VAT amount <span className="text-gray-400 font-normal">(as on Mushak)</span></label>
            <input type="number" min="0" step="0.01" value={line.vatAmount} onChange={e => onChange({ vatAmount: e.target.value })}
              className={ic} placeholder={c.vatComputed.toFixed(2)} />
          </div>
          <div className="col-span-1 md:col-span-2">
            <label className={lc}>SD amount</label>
            <input type="number" min="0" step="0.01" value={line.sdAmount} onChange={e => onChange({ sdAmount: e.target.value })}
              className={ic} placeholder="0.00" />
          </div>
        </div>
      )}

      {problems.length > 0 && (
        <ul className="mt-2 space-y-0.5">
          {problems.map(p => (
            <li key={p} className="flex items-center gap-1.5 text-[11px] text-red-600"><AlertTriangle className="w-3 h-3" /> {p}</li>
          ))}
        </ul>
      )}
      {line.lineType === 'ASSET' && serials.length > 0 && serials.length < qty && !problems.length && (
        <p className="mt-1 flex items-center gap-1.5 text-[11px] text-amber-700">
          <FileText className="w-3 h-3" /> Enter all {qtyText(qty)} serial numbers before receiving, or clear the list.
        </p>
      )}
    </div>
  )
}
