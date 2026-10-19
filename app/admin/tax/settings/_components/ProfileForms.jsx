'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { Loader2, CheckCircle2, AlertCircle, Info } from 'lucide-react'
import TaxCodeSelect from '@/components/tax/TaxCodeSelect'
import { cn } from '@/lib/utils'
import {
  isValidBin, isValidTin, normalizeBin, normalizeTin, VAT_TREATMENTS, VAT_RATE_OPTIONS, vatChallanCode, CHALLAN_CODES,
} from '@/lib/tax/catalog'
import { readJson, inputCls, labelCls, btnPrimary } from '../../vat-return/_lib/format'

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']

/** VAT commissionerates (the [OP] segment of the VAT account code). */
const COMMISSIONERATES = [
  { value: '0010', label: '0010 — Dhaka South' },
  { value: '0015', label: '0015 — Dhaka North' },
  { value: '0030', label: '0030 — Dhaka East' },
  { value: '0035', label: '0035 — Dhaka West' },
  { value: '0006', label: '0006 — Large Taxpayers Unit (LTU)' },
  { value: '0025', label: '0025 — Chattogram' },
  { value: '0040', label: '0040 — Cumilla' },
  { value: '0001', label: '0001 — Khulna' },
  { value: '0005', label: '0005 — Jashore' },
  { value: '0018', label: '0018 — Sylhet' },
  { value: '0020', label: '0020 — Rajshahi' },
  { value: '0045', label: '0045 — Rangpur' },
]

function Card({ title, description, children, footer }) {
  return (
    <section className="bg-white border border-gray-100 rounded-xl">
      <div className="px-4 sm:px-5 py-4 border-b border-gray-100">
        <h2 className="text-sm font-semibold text-gray-900">{title}</h2>
        {description && <p className="text-xs text-gray-500 mt-0.5">{description}</p>}
      </div>
      <div className="px-4 sm:px-5 py-4 space-y-4">{children}</div>
      {footer && <div className="px-4 sm:px-5 py-3 border-t border-gray-100 bg-gray-50/60 rounded-b-xl flex justify-end">{footer}</div>}
    </section>
  )
}

function Field({ label, hint, error, children, className }) {
  return (
    <div className={className}>
      <label className={labelCls}>{label}</label>
      {children}
      {error ? <p className="text-[11px] text-red-600 mt-1">{error}</p> : hint ? <p className="text-[11px] text-gray-400 mt-1">{hint}</p> : null}
    </div>
  )
}

function SaveButton({ saving, disabled, onClick, children = 'Save' }) {
  return (
    <button type="button" onClick={onClick} disabled={saving || disabled} className={btnPrimary}>
      {saving && <Loader2 className="w-4 h-4 animate-spin" />} {children}
    </button>
  )
}

async function putProfile(body) {
  const res = await fetch('/api/tax/profile', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const json = await readJson(res)
  return json.data
}

function fieldErrorsOf(err) {
  const fe = err?.details?.fieldErrors
  if (!fe) return {}
  return Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, Array.isArray(v) ? v[0] : String(v)]))
}

// ── Tax profile ──────────────────────────────────────────────────────────────

function profileFormFrom(profile) {
  const c = profile.company ?? {}
  return {
    bin: c.bin ?? '', tin: c.tin ?? '', tradeLicense: c.tradeLicense ?? '', vatCircle: c.vatCircle ?? '',
    issueAddress: c.issueAddress ?? '', signatoryName: c.signatoryName ?? '', signatoryDesignation: c.signatoryDesignation ?? '',
    commissionerateCode: profile.vat?.commissionerateCode ?? '',
    fiscalYearStartMonth: String(profile.fiscalYearStartMonth ?? 7),
  }
}

const isOtherCommissionerate = (code) => !!code && !COMMISSIONERATES.some(o => o.value === code)

export function ProfileForm({ profile, onSaved }) {
  const canEdit = profile.canEdit
  const [form, setForm] = useState(() => profileFormFrom(profile))
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [otherCode, setOtherCode] = useState(() => isOtherCommissionerate(profile.vat?.commissionerateCode))

  // Re-sync when the saved profile changes (after a save or reload).
  useEffect(() => {
    setOtherCode(isOtherCommissionerate(profile.vat?.commissionerateCode))
    setForm(profileFormFrom(profile))
    setErrors({})
  }, [profile])

  const set = (patch) => setForm(f => ({ ...f, ...patch }))
  const binOk = !form.bin || isValidBin(form.bin)
  const tinOk = !form.tin || isValidTin(form.tin)

  async function save() {
    const errs = {}
    if (!binOk) errs.bin = 'BIN is 13 digits (e.g. 000123456-0101) or the 9-digit core'
    if (!tinOk) errs.tin = 'e-TIN is 12 digits'
    if (form.commissionerateCode && !/^\d{4}$/.test(form.commissionerateCode)) errs.commissionerateCode = 'Commissionerate code is 4 digits'
    setErrors(errs)
    if (Object.keys(errs).length) { toast.error(Object.values(errs)[0]); return }
    setSaving(true)
    try {
      const body = {
        company: {
          bin: form.bin.trim() || null,
          tin: form.tin.trim() || null,
          tradeLicense: form.tradeLicense.trim() || null,
          vatCircle: form.vatCircle.trim() || null,
          issueAddress: form.issueAddress.trim() || null,
          signatoryName: form.signatoryName.trim() || null,
          signatoryDesignation: form.signatoryDesignation.trim() || null,
        },
        vat: { commissionerateCode: form.commissionerateCode || '' },
      }
      if (profile.canEditFiscalYear && Number(form.fiscalYearStartMonth) !== Number(profile.fiscalYearStartMonth)) {
        body.fiscalYearStartMonth = Number(form.fiscalYearStartMonth)
      }
      const data = await putProfile(body)
      toast.success('Tax profile saved')
      onSaved(data)
    } catch (err) {
      const fe = fieldErrorsOf(err)
      setErrors({
        bin: fe.bin ?? fe['company.bin'], tin: fe.tin ?? fe['company.tin'],
        commissionerateCode: fe['vat.commissionerateCode'] ?? fe.commissionerateCode,
      })
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const c = profile.company ?? {}
  return (
    <Card
      title="Tax profile"
      description="Printed on Mushak-6.3 invoices, 6.6 / TDS certificates, registers and the Mushak-9.1 working paper."
      footer={canEdit ? <SaveButton saving={saving} onClick={save}>Save profile</SaveButton> : null}
    >
      <div className="rounded-lg border border-gray-100 bg-gray-50 px-3 py-2.5 text-sm flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
        <div className="min-w-0">
          <p className="font-medium text-gray-900 truncate">{c.name || 'Company name not set'}</p>
          <p className="text-xs text-gray-500 truncate">{c.address || 'No address'}</p>
        </div>
        <Link href="/admin/config?tab=company" className="text-xs font-medium text-blue-600 hover:underline shrink-0">Edit name &amp; address in Configuration</Link>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="BIN (VAT registration no.)" error={errors.bin}
          hint={form.bin && binOk ? `Stored as ${normalizeBin(form.bin)}` : 'BIN is 13 digits, e.g. 000123456-0101'}>
          <div className="relative">
            <input className={cn(inputCls, 'font-mono pr-8', !binOk && 'border-red-300')} value={form.bin ?? ''} maxLength={20}
              disabled={!canEdit} onChange={e => set({ bin: e.target.value })} placeholder="000123456-0101" inputMode="numeric" />
            {form.bin && (binOk
              ? <CheckCircle2 className="w-4 h-4 text-emerald-500 absolute right-2.5 top-1/2 -translate-y-1/2" />
              : <AlertCircle className="w-4 h-4 text-red-500 absolute right-2.5 top-1/2 -translate-y-1/2" />)}
          </div>
        </Field>
        <Field label="e-TIN" error={errors.tin}
          hint={form.tin && tinOk ? `Stored as ${normalizeTin(form.tin)}` : '12 digits, from the e-TIN certificate'}>
          <div className="relative">
            <input className={cn(inputCls, 'font-mono pr-8', !tinOk && 'border-red-300')} value={form.tin ?? ''} maxLength={20}
              disabled={!canEdit} onChange={e => set({ tin: e.target.value })} placeholder="123456789012" inputMode="numeric" />
            {form.tin && (tinOk
              ? <CheckCircle2 className="w-4 h-4 text-emerald-500 absolute right-2.5 top-1/2 -translate-y-1/2" />
              : <AlertCircle className="w-4 h-4 text-red-500 absolute right-2.5 top-1/2 -translate-y-1/2" />)}
          </div>
        </Field>
        <Field label="Trade licence no.">
          <input className={inputCls} value={form.tradeLicense ?? ''} maxLength={80} disabled={!canEdit} onChange={e => set({ tradeLicense: e.target.value })} />
        </Field>
        <Field label="VAT circle / division" hint="e.g. Gulshan Circle, Dhaka North">
          <input className={inputCls} value={form.vatCircle ?? ''} maxLength={160} disabled={!canEdit} onChange={e => set({ vatCircle: e.target.value })} />
        </Field>
        <Field label="VAT commissionerate" error={errors.commissionerateCode}
          hint={`VAT account code: ${vatChallanCode(form.commissionerateCode || '0010')} · A-challan ${CHALLAN_CODES.VAT_NEW}`}>
          <div className="flex gap-2">
            <select
              className={inputCls}
              disabled={!canEdit}
              value={otherCode ? 'OTHER' : (form.commissionerateCode ?? '')}
              onChange={e => {
                if (e.target.value === 'OTHER') { setOtherCode(true); set({ commissionerateCode: '' }) }
                else { setOtherCode(false); set({ commissionerateCode: e.target.value }) }
              }}
            >
              <option value="">Select commissionerate</option>
              {COMMISSIONERATES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              <option value="OTHER">Other code…</option>
            </select>
            {otherCode && (
              <input className={cn(inputCls, 'w-28 font-mono')} value={form.commissionerateCode ?? ''} maxLength={4} placeholder="0000"
                disabled={!canEdit} onChange={e => set({ commissionerateCode: e.target.value.replace(/\D/g, '') })} />
            )}
          </div>
        </Field>
        <Field label="Fiscal year starts in"
          hint={profile.canEditFiscalYear
            ? 'Bangladesh income year runs July–June (banks & insurers: January).'
            : (profile.openingLocked ? 'Locked with the opening balances.' : 'Needs the "Manage opening balances & go-live" permission.')}>
          <select className={inputCls} value={form.fiscalYearStartMonth ?? '7'} disabled={!canEdit || !profile.canEditFiscalYear}
            onChange={e => set({ fiscalYearStartMonth: e.target.value })}>
            {MONTHS.map((m, i) => <option key={m} value={String(i + 1)}>{m}</option>)}
          </select>
        </Field>
        <Field label="Address where invoices are issued (Mushak-6.3)" className="sm:col-span-2"
          hint="Printed as the issue address on tax invoices. Leave blank to use the company address.">
          <textarea rows={2} className={`${inputCls} resize-none`} value={form.issueAddress ?? ''} maxLength={400} disabled={!canEdit}
            onChange={e => set({ issueAddress: e.target.value })} />
        </Field>
        <Field label="Authorised signatory — name" hint="Signs Mushak forms, certificates and the return declaration">
          <input className={inputCls} value={form.signatoryName ?? ''} maxLength={120} disabled={!canEdit} onChange={e => set({ signatoryName: e.target.value })} />
        </Field>
        <Field label="Authorised signatory — designation">
          <input className={inputCls} value={form.signatoryDesignation ?? ''} maxLength={120} disabled={!canEdit} onChange={e => set({ signatoryDesignation: e.target.value })} />
        </Field>
      </div>
    </Card>
  )
}

// ── VAT settings ─────────────────────────────────────────────────────────────

const REG_TYPES = [
  { value: 'REGISTERED',   label: 'VAT registered',   hint: 'Issues Mushak-6.3, files Mushak-9.1, claims input tax credit' },
  { value: 'TURNOVER',     label: 'Turnover tax',     hint: 'Enlisted (turnover up to Tk 50 lakh): 4% turnover tax, Mushak-9.2' },
  { value: 'UNREGISTERED', label: 'Not registered',   hint: 'No VAT charged on invoices' },
]

function vatFormFrom(profile) {
  const v = profile.vat ?? {}
  return {
    registrationType: v.registrationType ?? 'REGISTERED',
    returnFrequency: v.returnFrequency ?? 'MONTHLY',
    defaultSalesTreatment: v.defaultSalesTreatment ?? 'STANDARD',
    defaultSalesRate: String(v.defaultSalesRate ?? 15),
    defaultServiceCode: v.defaultServiceCode ?? null,
    isVdsEntity: v.isVdsEntity !== false,
  }
}

export function VatSettingsForm({ profile, onSaved }) {
  const canEdit = profile.canEdit
  const [form, setForm] = useState(() => vatFormFrom(profile))
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)
  const [codeHint, setCodeHint] = useState(null)

  useEffect(() => {
    setForm(vatFormFrom(profile))
    setErrors({})
    setCodeHint(null)
  }, [profile])

  const rateOptions = useMemo(() => {
    const opts = new Set(VAT_RATE_OPTIONS.filter(r => r > 0))
    if (form && Number(form.defaultSalesRate) > 0) opts.add(Number(form.defaultSalesRate))
    return [...opts].sort((a, b) => a - b)
  }, [form])

  const set = (patch) => setForm(f => ({ ...f, ...patch }))
  const registered = form.registrationType === 'REGISTERED'
  const zeroRate = ['ZERO_RATED', 'EXEMPT', 'NONE'].includes(form.defaultSalesTreatment)

  function setTreatment(value) {
    const meta = VAT_TREATMENTS.find(t => t.value === value)
    set({ defaultSalesTreatment: value, defaultSalesRate: String(meta?.defaultRate ?? 0) })
  }

  function setRegistration(value) {
    if (value !== 'REGISTERED') set({ registrationType: value, defaultSalesTreatment: 'NONE', defaultSalesRate: '0' })
    else set({ registrationType: value, ...(form.defaultSalesTreatment === 'NONE' ? { defaultSalesTreatment: 'STANDARD', defaultSalesRate: '15' } : {}) })
  }

  function setServiceCode(code, obj) {
    if (!code || !obj) { set({ defaultServiceCode: null }); setCodeHint(null); return }
    const patch = { defaultServiceCode: code }
    if (registered && obj.treatment && obj.treatment !== 'NONE') {
      patch.defaultSalesTreatment = obj.treatment
      patch.defaultSalesRate = String(Number(obj.vatRate) || 0)
      setCodeHint(`Default treatment set to ${VAT_TREATMENTS.find(t => t.value === obj.treatment)?.label ?? obj.treatment} at ${Number(obj.vatRate) || 0}% from ${code}.`)
    }
    set(patch)
  }

  async function save() {
    setSaving(true)
    setErrors({})
    try {
      const data = await putProfile({
        vat: {
          registrationType: form.registrationType,
          returnFrequency: form.returnFrequency,
          defaultSalesTreatment: form.defaultSalesTreatment,
          defaultSalesRate: zeroRate ? 0 : Number(form.defaultSalesRate),
          defaultServiceCode: form.defaultServiceCode || null,
          isVdsEntity: !!form.isVdsEntity,
        },
      })
      toast.success('VAT settings saved')
      onSaved(data)
    } catch (err) {
      const fe = fieldErrorsOf(err)
      setErrors({ defaultSalesTreatment: fe['vat.defaultSalesTreatment'], defaultSalesRate: fe['vat.defaultSalesRate'] })
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card
      title="VAT"
      description="Registration, return frequency and the defaults new invoices start with."
      footer={canEdit ? <SaveButton saving={saving} onClick={save}>Save VAT settings</SaveButton> : null}
    >
      <Field label="VAT registration">
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
          {REG_TYPES.map(r => (
            <button
              key={r.value}
              type="button"
              disabled={!canEdit}
              onClick={() => setRegistration(r.value)}
              className={cn(
                'text-left rounded-lg border px-3 py-2.5 transition',
                form.registrationType === r.value ? 'border-gray-900 ring-1 ring-gray-900 bg-gray-50' : 'border-gray-200 hover:border-gray-300',
                !canEdit && 'cursor-not-allowed opacity-70',
              )}
            >
              <p className="text-sm font-medium text-gray-900">{r.label}</p>
              <p className="text-[11px] text-gray-500 mt-0.5">{r.hint}</p>
            </button>
          ))}
        </div>
      </Field>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Return frequency"
          hint="Monthly returns resumed from Oct 2026 (VAT & SD (Amendment) Ordinance 2026). Jul–Sep 2026 is always one return, due 25 Oct 2026.">
          <select className={inputCls} value={form.returnFrequency} disabled={!canEdit || !registered} onChange={e => set({ returnFrequency: e.target.value })}>
            <option value="MONTHLY">Monthly (due the 15th of the next month)</option>
            <option value="QUARTERLY">Quarterly (due the 15th after the quarter)</option>
          </select>
        </Field>
        <Field label="Default VAT service code" hint={codeHint ?? 'Pre-selected on new invoices; sets the rate and Mushak-9.1 note.'}>
          <TaxCodeSelect kind="VAT_SERVICE" value={form.defaultServiceCode} onChange={setServiceCode} placeholder="No default" disabled={!canEdit} />
        </Field>
        <Field label="Default sales treatment" error={errors.defaultSalesTreatment}
          hint={registered ? 'Foreign clients default to zero-rated (export of services).' : 'Only “No VAT” applies until the company is VAT registered.'}>
          <select className={inputCls} value={form.defaultSalesTreatment} disabled={!canEdit} onChange={e => setTreatment(e.target.value)}>
            {VAT_TREATMENTS.map(t => (
              <option key={t.value} value={t.value} disabled={!registered && t.value !== 'NONE'}>{t.label}</option>
            ))}
          </select>
        </Field>
        <Field label="Default VAT rate" error={errors.defaultSalesRate} hint={zeroRate ? 'No VAT is charged under this treatment.' : 'Standard rate 15%; ITES and other reduced rates per the Third Schedule.'}>
          <select className={inputCls} value={zeroRate ? '0' : form.defaultSalesRate} disabled={!canEdit || zeroRate} onChange={e => set({ defaultSalesRate: e.target.value })}>
            {zeroRate && <option value="0">0%</option>}
            {!zeroRate && rateOptions.map(r => <option key={r} value={String(r)}>{r}%</option>)}
          </select>
        </Field>
      </div>

      <label className={cn('flex items-start gap-3 rounded-lg border border-gray-100 p-3', canEdit && 'cursor-pointer hover:bg-gray-50')}>
        <input type="checkbox" className="mt-0.5 rounded border-gray-300" disabled={!canEdit} checked={form.isVdsEntity} onChange={e => set({ isVdsEntity: e.target.checked })} />
        <span>
          <span className="block text-sm font-medium text-gray-900">We are a VDS withholding entity</span>
          <span className="block text-xs text-gray-500 mt-0.5">
            Companies, NGOs, banks, insurers, educational institutions and other specified entities must deduct VAT at source (s.49)
            from suppliers of listed services and issue Mushak-6.6. A registered entity pays it through note 24 of its own return.
          </span>
        </span>
      </label>
    </Card>
  )
}

// ── Income tax ───────────────────────────────────────────────────────────────

function incomeTaxFormFrom(profile) {
  const t = profile.incomeTax ?? {}
  return {
    isWithholdingEntity: t.isWithholdingEntity !== false,
    corporateRate: String(t.corporateRate ?? 27.5),
    cashlessRate: String(t.cashlessRate ?? 25),
    taxZone: t.taxZone ?? '',
    taxCircle: t.taxCircle ?? '',
    cashRatioThresholdPct: String(t.cashRatioThresholdPct ?? 50),
    cashDisallowPct: String(t.cashDisallowPct ?? 25),
  }
}

export function IncomeTaxForm({ profile, onSaved }) {
  const canEdit = profile.canEdit
  const [form, setForm] = useState(() => incomeTaxFormFrom(profile))
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    setForm(incomeTaxFormFrom(profile))
    setErrors({})
  }, [profile])

  const set = (patch) => setForm(f => ({ ...f, ...patch }))
  const pctOk = (v) => v !== '' && Number.isFinite(Number(v)) && Number(v) >= 0 && Number(v) <= 100

  async function save() {
    const errs = {}
    for (const k of ['corporateRate', 'cashlessRate', 'cashRatioThresholdPct', 'cashDisallowPct']) if (!pctOk(form[k])) errs[k] = 'Enter 0–100'
    setErrors(errs)
    if (Object.keys(errs).length) { toast.error('Check the highlighted rates'); return }
    setSaving(true)
    try {
      const data = await putProfile({
        incomeTax: {
          isWithholdingEntity: !!form.isWithholdingEntity,
          corporateRate: Number(form.corporateRate),
          cashlessRate: Number(form.cashlessRate),
          taxZone: form.taxZone.trim(),
          taxCircle: form.taxCircle.trim(),
          cashRatioThresholdPct: Number(form.cashRatioThresholdPct),
          cashDisallowPct: Number(form.cashDisallowPct),
        },
      })
      toast.success('Income-tax settings saved')
      onSaved(data)
    } catch (err) {
      const fe = fieldErrorsOf(err)
      setErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k.replace(/^incomeTax\./, ''), v])))
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  const pctInput = (k) => (
    <div className="relative">
      <input type="number" min="0" max="100" step="0.01" inputMode="decimal" className={cn(inputCls, 'pr-8', errors[k] && 'border-red-300')}
        value={form[k]} disabled={!canEdit} onChange={e => set({ [k]: e.target.value })} />
      <span className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-gray-400">%</span>
    </div>
  )

  return (
    <Card
      title="Income tax"
      description="Withholding status, tax office and the corporate-tax rules used for estimates and warnings."
      footer={canEdit ? <SaveButton saving={saving} onClick={save}>Save income-tax settings</SaveButton> : null}
    >
      <label className={cn('flex items-start gap-3 rounded-lg border border-gray-100 p-3', canEdit && 'cursor-pointer hover:bg-gray-50')}>
        <input type="checkbox" className="mt-0.5 rounded border-gray-300" disabled={!canEdit} checked={form.isWithholdingEntity} onChange={e => set({ isWithholdingEntity: e.target.checked })} />
        <span>
          <span className="block text-sm font-medium text-gray-900">We deduct income tax at source (TDS)</span>
          <span className="block text-xs text-gray-500 mt-0.5">
            Every company is a “specified person” under the Income Tax Act 2023 and must withhold tax from payments to contractors,
            service providers, landlords and staff, deposit it by challan and issue certificates.
          </span>
        </span>
      </label>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Taxes zone" hint="e.g. Taxes Zone-11, Dhaka">
          <input className={inputCls} value={form.taxZone} maxLength={120} disabled={!canEdit} onChange={e => set({ taxZone: e.target.value })} />
        </Field>
        <Field label="Taxes circle" hint="e.g. Circle-215 (Companies)">
          <input className={inputCls} value={form.taxCircle} maxLength={120} disabled={!canEdit} onChange={e => set({ taxCircle: e.target.value })} />
        </Field>
        <Field label="Corporate tax rate" error={errors.corporateRate} hint="Non-listed company: 27.5% (FY2026-27)">
          {pctInput('corporateRate')}
        </Field>
        <Field label="Reduced rate when all transactions are cashless" error={errors.cashlessRate} hint="25% for a non-listed company meeting the bank-transfer condition">
          {pctInput('cashlessRate')}
        </Field>
        <Field label="Cash payments threshold (s.55)" error={errors.cashRatioThresholdPct} hint="Warn when cash payments exceed this share of all payments">
          {pctInput('cashRatioThresholdPct')}
        </Field>
        <Field label="Share of cash payments disallowed" error={errors.cashDisallowPct} hint="Portion of cash payments added back when over the threshold">
          {pctInput('cashDisallowPct')}
        </Field>
      </div>
      <p className="text-[11px] text-gray-400 flex items-start gap-1.5">
        <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
        Withholding is done under the TDS sections below; challan code {CHALLAN_CODES.TDS_COMPANY} (company payees) / {CHALLAN_CODES.TDS_NON_COMPANY} (others).
      </p>
    </Card>
  )
}
