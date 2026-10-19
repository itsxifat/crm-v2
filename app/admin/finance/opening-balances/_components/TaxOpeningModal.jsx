'use client'

import { useEffect, useMemo, useState } from 'react'
import { Loader2 } from 'lucide-react'
import toast from 'react-hot-toast'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import DatePicker from '@/components/ui/DatePicker'
import TaxCodeSelect from '@/components/tax/TaxCodeSelect'
import { addPeriods, dayKeyLabel, periodLabel, taxPeriodOf, tdsDepositDueDate } from '@/lib/finance/fiscal'
import { dhakaDayKey } from '@/lib/dhakaTime'
import { cn } from '@/lib/utils'
import {
  CERTIFICATE_STATUS_LABELS, INPUT_TREATMENT_OPTIONS, OPENING_TAX_META, PAYEE_TYPE_OPTIONS,
} from '../_lib/meta'
import { Callout, FieldError, Guidance, apiFetch, btnGhost, btnPrimary, fieldErrorsOf, inputCls, labelCls, parseAmount } from './shared'

function initialForm(entryType, entry, defaults) {
  if (entry) {
    return {
      balanceSide: entry.balanceSide ?? 'CREDIT',
      partyName:   entry.partyName ?? '',
      partyBin:    entry.partyBin ?? '',
      partyTin:    entry.partyTin ?? '',
      payeeType:   entry.payeeType ?? 'COMPANY',
      section:     entry.section ?? null,
      documentNo:  entry.documentNo ?? '',
      date:        entry.date ?? defaults.date,
      baseAmount:  entry.baseAmount ? String(entry.baseAmount) : '',
      amount:      entry.amount != null ? String(entry.amount) : '',
      sdAmount:    entry.sdAmount ? String(entry.sdAmount) : '',
      treatment:   entry.treatment ?? 'STANDARD',
      certStatus:  entry.certificate?.status && entry.certificate.status !== 'NOT_REQUIRED' ? entry.certificate.status : 'PENDING',
      certNumber:  entry.certificate?.number ?? '',
      certDate:    entry.certificate?.date ?? null,
      notes:       entry.notes ?? '',
    }
  }
  return {
    balanceSide: defaults.balanceSide ?? 'CREDIT',
    partyName: '', partyBin: '', partyTin: '', payeeType: 'COMPANY', section: null, documentNo: '',
    date: defaults.date, baseAmount: '', amount: '', sdAmount: '', treatment: 'STANDARD',
    certStatus: 'PENDING', certNumber: '', certDate: null, notes: '',
  }
}

/**
 * Add / edit one opening tax balance. `entryType` decides the fields;
 * each field explains what number to enter and where to find it.
 */
export default function TaxOpeningModal({ open, onOpenChange, entryType, entry = null, data, defaultSide = 'CREDIT', onSaved }) {
  const meta = OPENING_TAX_META[entryType] ?? OPENING_TAX_META.ADVANCE_TAX
  const fields = meta.fields
  const has = (f) => fields.includes(f)
  const asOf = data?.asOfDate ?? null
  const goLive = data?.goLiveDate ?? null
  const booksLock = data?.settings?.lockedUntil ?? null
  // A balance dated inside the books lock keeps its figures and date; only details can change.
  const figuresLocked = !!(entry?.date && booksLock && entry.date <= booksLock)

  const [form, setForm] = useState(() => initialForm(entryType, entry, { date: asOf, balanceSide: defaultSide }))
  const [errors, setErrors] = useState({})
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (open) {
      setForm(initialForm(entryType, entry, { date: asOf, balanceSide: defaultSide }))
      setErrors({})
    }
  }, [open, entryType, entry, asOf, defaultSide])

  const set = (key, value) => {
    setForm(f => ({ ...f, [key]: value }))
    setErrors(e => ({ ...e, [key]: undefined }))
  }

  const hints = useMemo(() => {
    const out = {}
    if (form.certStatus !== 'PENDING' && form.certDate && form.certDate > dhakaDayKey(new Date())) {
      out.certDateError = 'The certificate date cannot be in the future'
    }
    if (!form.date) return out
    if (asOf && form.date > asOf) out.dateError = `Must be on or before ${dayKeyLabel(asOf)} (the day before go-live)`
    else if (booksLock && !figuresLocked && form.date <= booksLock) {
      out.dateError = `Books are locked up to ${dayKeyLabel(booksLock)} — pick a later date or unlock the period first`
    }
    if (['INPUT_VAT', 'VDS_RECEIVABLE'].includes(entryType)) {
      const deadline = addPeriods(taxPeriodOf(form.date), 6)
      const expired = goLive && deadline < taxPeriodOf(goLive)
      out.claim = { deadline, expired }
    }
    if (entryType === 'TDS_PAYABLE') {
      const due = tdsDepositDueDate(form.date)
      out.depositDue = due
      out.depositOverdue = due && due < dhakaDayKey(new Date())
    }
    const base = parseAmount(form.baseAmount)
    const amt = parseAmount(form.amount)
    if (base && amt && base > 0 && !Number.isNaN(base) && !Number.isNaN(amt)) out.rate = Math.round((amt / base) * 10000) / 100
    return out
  }, [form.date, form.baseAmount, form.amount, form.certStatus, form.certDate, entryType, asOf, goLive, booksLock, figuresLocked])

  async function submit(e) {
    e?.preventDefault?.()
    const amount = parseAmount(form.amount)
    const sdAmount = parseAmount(form.sdAmount)
    const baseAmount = parseAmount(form.baseAmount)
    const errs = {}
    if (amount === null || Number.isNaN(amount) || amount < 0) errs.amount = 'Enter the amount'
    if (has('sdAmount') && sdAmount !== null && (Number.isNaN(sdAmount) || sdAmount < 0)) errs.sdAmount = 'Enter a valid amount'
    if (has('baseAmount') && baseAmount !== null && (Number.isNaN(baseAmount) || baseAmount < 0)) errs.baseAmount = 'Enter a valid amount'
    if (!form.date) errs.date = 'Pick the date'
    if (has('party') && !form.partyName.trim()) errs.partyName = `Enter the ${(meta.partyLabel || 'party').toLowerCase()}'s name`
    if (entryType === 'TDS_PAYABLE' && !form.section) errs.section = 'Choose the TDS section'
    if (Object.keys(errs).length) { setErrors(errs); return }

    const body = {
      entryType,
      amount,
      date: form.date,
      notes: form.notes,
      documentNo: has('documentNo') ? form.documentNo : null,
    }
    if (entryType === 'VAT_BALANCE_BF') { body.balanceSide = form.balanceSide; body.sdAmount = sdAmount ?? 0 }
    if (has('party')) body.partyName = form.partyName
    if (has('bin')) body.partyBin = form.partyBin
    if (has('tin')) body.partyTin = form.partyTin
    if (has('payeeType')) body.payeeType = form.payeeType
    if (has('section')) body.section = form.section
    if (has('baseAmount')) body.baseAmount = baseAmount ?? 0
    if (has('treatment')) body.treatment = form.treatment
    if (has('certificate')) {
      body.certificate = {
        status: form.certStatus,
        number: form.certNumber,
        date:   form.certStatus === 'PENDING' ? null : form.certDate,
      }
    }

    setSaving(true)
    try {
      const json = await apiFetch(entry ? `/api/finance/opening-balances/tax/${entry.id}` : '/api/finance/opening-balances/tax', {
        method: entry ? 'PUT' : 'POST',
        body,
      })
      toast.success(entry ? 'Opening balance updated' : 'Opening balance added')
      onSaved?.(json.data)
      onOpenChange(false)
    } catch (err) {
      const fe = fieldErrorsOf(err)
      const mapped = {}
      for (const [k, v] of Object.entries(fe)) {
        if (k === 'certificate.date') mapped.certDate = v
        else if (k === 'certificate.status') mapped.certStatus = v
        else mapped[k] = v
      }
      setErrors(mapped)
      toast.error(err.message === 'Validation failed' && Object.values(mapped)[0] ? Object.values(mapped)[0] : err.message)
    } finally {
      setSaving(false)
    }
  }

  const certStatuses = meta.certificateStatuses ?? []

  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={`${entry ? 'Edit' : 'Add'} — ${meta.title}`}
      description={asOf ? `Opening balance as at the end of ${dayKeyLabel(asOf)}` : undefined}
      size="lg"
    >
      <form id="tax-opening-form" onSubmit={submit} className="space-y-4">
        <Guidance what={meta.what} where={meta.where} />

        {figuresLocked && (
          <Callout tone="warning" title={`Books are locked up to ${dayKeyLabel(booksLock)}`}>
            This balance is dated in the locked period, so its amount and date cannot be changed. You can still correct the notes, party, document and certificate details.
          </Callout>
        )}

        {entryType === 'VAT_BALANCE_BF' && (
          <div>
            <span className={labelCls}>Which way is the balance?</span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {[
                { v: 'CREDIT', t: 'Credit carried forward', d: 'You paid more than due — it reduces your next return (note 52).' },
                { v: 'PAYABLE', t: 'VAT still owed', d: 'VAT from earlier returns that you have not paid yet.' },
              ].map(o => (
                <button
                  type="button"
                  key={o.v}
                  onClick={() => set('balanceSide', o.v)}
                  disabled={figuresLocked}
                  className={cn(
                    'text-left rounded-lg border px-3 py-2.5 transition-colors disabled:opacity-60 disabled:cursor-not-allowed',
                    form.balanceSide === o.v ? 'border-gray-900 ring-1 ring-gray-900 bg-gray-50' : 'border-gray-200 hover:border-gray-300',
                  )}
                >
                  <span className="block text-sm font-medium text-gray-900">{o.t}</span>
                  <span className="block text-xs text-gray-500">{o.d}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {has('party') && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className={cn(!has('bin') && !has('tin') && 'sm:col-span-2')}>
              <label className={labelCls} htmlFor="ot-party">{meta.partyLabel} name</label>
              <input id="ot-party" className={inputCls} value={form.partyName} maxLength={200} onChange={e => set('partyName', e.target.value)} />
              <FieldError message={errors.partyName} />
            </div>
            {has('bin') && (
              <div>
                <label className={labelCls} htmlFor="ot-bin">{meta.partyLabel} BIN <span className="text-gray-400 font-normal">(optional)</span></label>
                <input id="ot-bin" className={inputCls} value={form.partyBin} maxLength={20} placeholder="000123456-0101" onChange={e => set('partyBin', e.target.value)} />
                <p className="text-[11px] text-gray-400 mt-1">BIN is 9 or 13 digits, e.g. 000123456-0101</p>
                <FieldError message={errors.partyBin} />
              </div>
            )}
            {has('tin') && (
              <div>
                <label className={labelCls} htmlFor="ot-tin">{meta.partyLabel} e-TIN <span className="text-gray-400 font-normal">(optional)</span></label>
                <input id="ot-tin" className={inputCls} value={form.partyTin} maxLength={20} placeholder="12 digits" onChange={e => set('partyTin', e.target.value)} />
                <FieldError message={errors.partyTin} />
              </div>
            )}
          </div>
        )}

        {(has('payeeType') || has('section')) && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {has('payeeType') && (
              <div>
                <label className={labelCls} htmlFor="ot-payee">Payee type</label>
                <select id="ot-payee" className={inputCls} value={form.payeeType} disabled={figuresLocked} onChange={e => set('payeeType', e.target.value)}>
                  {PAYEE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </select>
                <p className="text-[11px] text-gray-400 mt-1">Decides the challan code (company 1112101, others 1111101).</p>
              </div>
            )}
            {has('section') && (
              <div className={cn(!has('payeeType') && 'sm:col-span-2')}>
                <label className={labelCls}>TDS section {entryType === 'TDS_RECEIVABLE' && <span className="text-gray-400 font-normal">(optional)</span>}</label>
                <TaxCodeSelect
                  kind="TDS_SECTION"
                  value={form.section}
                  onChange={(code) => set('section', code)}
                  placeholder="Choose section"
                  className={inputCls}
                  asOf={form.date || undefined}
                  disabled={figuresLocked}
                />
                <FieldError message={errors.section} />
              </div>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className={labelCls}>{meta.dateLabel}</label>
            <DatePicker value={form.date} onChange={v => set('date', v)} clearable={false} disabled={figuresLocked} />
            <p className="text-[11px] text-gray-400 mt-1">{meta.dateHint}</p>
            <FieldError message={errors.date || hints.dateError} />
          </div>
          {has('documentNo') && (
            <div>
              <label className={labelCls} htmlFor="ot-doc">{meta.documentLabel} <span className="text-gray-400 font-normal">(optional)</span></label>
              <input id="ot-doc" className={inputCls} value={form.documentNo} maxLength={80} onChange={e => set('documentNo', e.target.value)} />
              <FieldError message={errors.documentNo} />
            </div>
          )}
        </div>

        {has('treatment') && (
          <div>
            <label className={labelCls} htmlFor="ot-treat">VAT rate on the bill</label>
            <select id="ot-treat" className={inputCls} value={form.treatment} disabled={figuresLocked} onChange={e => set('treatment', e.target.value)}>
              {INPUT_TREATMENT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          {has('baseAmount') && (
            <div>
              <label className={labelCls} htmlFor="ot-base">{meta.baseLabel} <span className="text-gray-400 font-normal">(optional)</span></label>
              <input id="ot-base" type="number" inputMode="decimal" step="0.01" min="0" className={inputCls} value={form.baseAmount} disabled={figuresLocked} onChange={e => set('baseAmount', e.target.value)} />
              <FieldError message={errors.baseAmount} />
            </div>
          )}
          <div className={cn(!has('baseAmount') && !has('sdAmount') && 'sm:col-span-2')}>
            <label className={labelCls} htmlFor="ot-amount">{meta.amountLabel} (৳)</label>
            <input id="ot-amount" type="number" inputMode="decimal" step="0.01" min="0" className={inputCls} value={form.amount} disabled={figuresLocked} onChange={e => set('amount', e.target.value)} />
            {hints.rate != null && <p className="text-[11px] text-gray-400 mt-1">Works out to {hints.rate}% of the value.</p>}
            <FieldError message={errors.amount} />
          </div>
          {has('sdAmount') && (
            <div>
              <label className={labelCls} htmlFor="ot-sd">SD balance (note 66) <span className="text-gray-400 font-normal">(optional)</span></label>
              <input id="ot-sd" type="number" inputMode="decimal" step="0.01" min="0" className={inputCls} value={form.sdAmount} disabled={figuresLocked} onChange={e => set('sdAmount', e.target.value)} />
              <FieldError message={errors.sdAmount} />
            </div>
          )}
        </div>

        {hints.claim && (
          hints.claim.expired
            ? <Callout tone="error">This can only be claimed up to the {periodLabel(hints.claim.deadline)} return, which is before go-live — it is no longer claimable and will be refused.</Callout>
            : <Callout tone="info">Claimable up to the {periodLabel(hints.claim.deadline)} return. The tax ledger warns before the window closes.</Callout>
        )}
        {hints.depositDue && (
          <Callout tone={hints.depositOverdue ? 'warning' : 'info'}>
            Deposit {hints.depositOverdue ? 'was' : 'is'} due by {dayKeyLabel(hints.depositDue)}.
            {hints.depositOverdue && ' Late deposit costs 2% per month (ITA s.143) — deposit it from Tax & VAT → Withholding soon.'}
          </Callout>
        )}

        {has('certificate') && (
          <div className="rounded-lg border border-gray-100 p-3 space-y-3">
            <p className="text-sm font-medium text-gray-900">{meta.certificateLabel}</p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className={labelCls} htmlFor="ot-cs">Status</label>
                <select id="ot-cs" className={inputCls} value={form.certStatus} onChange={e => set('certStatus', e.target.value)}>
                  {certStatuses.map(s => <option key={s} value={s}>{CERTIFICATE_STATUS_LABELS[s]}</option>)}
                </select>
                <FieldError message={errors.certStatus} />
              </div>
              <div>
                <label className={labelCls} htmlFor="ot-cn">Certificate no.</label>
                <input id="ot-cn" className={inputCls} value={form.certNumber} maxLength={60} onChange={e => set('certNumber', e.target.value)} />
              </div>
              <div>
                <label className={labelCls}>Certificate date</label>
                <DatePicker value={form.certDate} onChange={v => set('certDate', v)} disabled={form.certStatus === 'PENDING'} size="md" />
                <FieldError message={errors.certDate || hints.certDateError} />
              </div>
            </div>
          </div>
        )}

        <div>
          <label className={labelCls} htmlFor="ot-notes">Notes <span className="text-gray-400 font-normal">(optional)</span></label>
          <textarea id="ot-notes" rows={2} className={inputCls} value={form.notes} maxLength={1000} onChange={e => set('notes', e.target.value)} />
        </div>
      </form>
      <ModalFooter className="-mx-4 sm:-mx-6 -mb-4 mt-4">
        <button type="button" className={btnGhost} onClick={() => onOpenChange(false)} disabled={saving}>Cancel</button>
        <button type="submit" form="tax-opening-form" className={btnPrimary} disabled={saving}>
          {saving && <Loader2 className="w-4 h-4 animate-spin" />}
          {entry ? 'Save changes' : 'Add balance'}
        </button>
      </ModalFooter>
    </Modal>
  )
}
