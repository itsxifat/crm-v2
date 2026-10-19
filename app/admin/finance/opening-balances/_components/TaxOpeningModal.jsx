'use client'

import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { Field, Input, Label, NativeSelect, Textarea, selectClass } from '@/components/ui/Input'
import DatePicker from '@/components/ui/DatePicker'
import TaxCodeSelect from '@/components/tax/TaxCodeSelect'
import { addPeriods, dayKeyLabel, periodLabel, taxPeriodOf, tdsDepositDueDate } from '@/lib/finance/fiscal'
import { dhakaDayKey } from '@/lib/dhakaTime'
import { cn } from '@/lib/utils'
import {
  CERTIFICATE_STATUS_LABELS, INPUT_TREATMENT_OPTIONS, OPENING_TAX_META, PAYEE_TYPE_OPTIONS,
} from '../_lib/meta'
import { Callout, Guidance, apiFetch, fieldErrorsOf, parseAmount } from './shared'

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
      description={asOf ? `As at end of ${dayKeyLabel(asOf)}` : undefined}
      size="lg"
    >
      <form id="tax-opening-form" onSubmit={submit} className="space-y-4">
        <Guidance what={meta.what} where={meta.where} />

        {figuresLocked && (
          <Callout tone="warning" title={`Books locked to ${dayKeyLabel(booksLock)}`}>
            Amount and date are fixed; other details stay editable.
          </Callout>
        )}

        {entryType === 'VAT_BALANCE_BF' && (
          <div>
            <Label>Balance side</Label>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
              {[
                { v: 'CREDIT', t: 'Credit carried forward', d: 'Reduces your next return (note 52)' },
                { v: 'PAYABLE', t: 'VAT still owed', d: 'Unpaid VAT from earlier returns' },
              ].map(o => (
                <button
                  type="button"
                  key={o.v}
                  onClick={() => set('balanceSide', o.v)}
                  disabled={figuresLocked}
                  className={cn(
                    'rounded-lg border px-3 py-2.5 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                    form.balanceSide === o.v ? 'border-gray-900 bg-gray-50 ring-1 ring-gray-900' : 'border-input hover:bg-gray-50',
                  )}
                >
                  <span className="block text-sm font-medium text-gray-900">{o.t}</span>
                  <span className="mt-0.5 block text-xs text-muted-foreground">{o.d}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {has('party') && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label={`${meta.partyLabel} name`} htmlFor="ot-party" required error={errors.partyName} className={cn(!has('bin') && !has('tin') && 'sm:col-span-2')}>
              <Input id="ot-party" value={form.partyName} maxLength={200} onChange={e => set('partyName', e.target.value)} />
            </Field>
            {has('bin') && (
              <Field label={`${meta.partyLabel} BIN`} htmlFor="ot-bin" error={errors.partyBin}>
                <Input id="ot-bin" value={form.partyBin} maxLength={20} placeholder="e.g. 000123456-0101" title="9 or 13 digits" onChange={e => set('partyBin', e.target.value)} />
              </Field>
            )}
            {has('tin') && (
              <Field label={`${meta.partyLabel} e-TIN`} htmlFor="ot-tin" error={errors.partyTin}>
                <Input id="ot-tin" value={form.partyTin} maxLength={20} placeholder="12 digits" onChange={e => set('partyTin', e.target.value)} />
              </Field>
            )}
          </div>
        )}

        {(has('payeeType') || has('section')) && (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {has('payeeType') && (
              <Field label="Payee type" htmlFor="ot-payee" hint="Sets the challan code">
                <NativeSelect
                  id="ot-payee"
                  value={form.payeeType}
                  disabled={figuresLocked}
                  title="Company 1112101, others 1111101"
                  onChange={e => set('payeeType', e.target.value)}
                >
                  {PAYEE_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                </NativeSelect>
              </Field>
            )}
            {has('section') && (
              <Field label="TDS section" required={entryType === 'TDS_PAYABLE'} error={errors.section} className={cn(!has('payeeType') && 'sm:col-span-2')}>
                <TaxCodeSelect
                  kind="TDS_SECTION"
                  value={form.section}
                  onChange={(code) => set('section', code)}
                  placeholder="Select…"
                  className={selectClass}
                  asOf={form.date || undefined}
                  disabled={figuresLocked}
                />
              </Field>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label={meta.dateLabel} required hint={meta.dateHint} error={errors.date || hints.dateError}>
            <DatePicker value={form.date} onChange={v => set('date', v)} clearable={false} disabled={figuresLocked} />
          </Field>
          {has('documentNo') && (
            <Field label={meta.documentLabel} htmlFor="ot-doc" error={errors.documentNo}>
              <Input id="ot-doc" value={form.documentNo} maxLength={80} onChange={e => set('documentNo', e.target.value)} />
            </Field>
          )}
        </div>

        {has('treatment') && (
          <Field label="VAT rate on the bill" htmlFor="ot-treat">
            <NativeSelect id="ot-treat" value={form.treatment} disabled={figuresLocked} onChange={e => set('treatment', e.target.value)}>
              {INPUT_TREATMENT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </NativeSelect>
          </Field>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {has('baseAmount') && (
            <Field label={meta.baseLabel} htmlFor="ot-base" error={errors.baseAmount}>
              <Input id="ot-base" type="number" inputMode="decimal" step="0.01" min="0" placeholder="0.00" value={form.baseAmount} disabled={figuresLocked} onChange={e => set('baseAmount', e.target.value)} />
            </Field>
          )}
          <Field
            label={`${meta.amountLabel} (৳)`}
            htmlFor="ot-amount"
            required
            hint={hints.rate != null ? `${hints.rate}% of the value` : undefined}
            error={errors.amount}
            className={cn(!has('baseAmount') && !has('sdAmount') && 'sm:col-span-2')}
          >
            <Input id="ot-amount" type="number" inputMode="decimal" step="0.01" min="0" placeholder="0.00" value={form.amount} disabled={figuresLocked} onChange={e => set('amount', e.target.value)} />
          </Field>
          {has('sdAmount') && (
            <Field label="SD balance (note 66)" htmlFor="ot-sd" error={errors.sdAmount}>
              <Input id="ot-sd" type="number" inputMode="decimal" step="0.01" min="0" placeholder="0.00" value={form.sdAmount} disabled={figuresLocked} onChange={e => set('sdAmount', e.target.value)} />
            </Field>
          )}
        </div>

        {hints.claim && (
          hints.claim.expired
            ? <Callout tone="error">Only claimable up to the {periodLabel(hints.claim.deadline)} return, before go-live — it will be refused.</Callout>
            : <Callout tone="info">Claimable up to the {periodLabel(hints.claim.deadline)} return.</Callout>
        )}
        {hints.depositDue && (
          <Callout tone={hints.depositOverdue ? 'warning' : 'info'}>
            Deposit {hints.depositOverdue ? 'was' : 'is'} due by {dayKeyLabel(hints.depositDue)}.
            {hints.depositOverdue && ' Late deposit costs 2% per month (ITA s.143) — deposit it from Tax & VAT → Withholding soon.'}
          </Callout>
        )}

        {has('certificate') && (
          <div className="space-y-3 rounded-lg border border-gray-200/80 p-4">
            <p className="text-sm font-semibold text-gray-900">{meta.certificateLabel}</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Status" htmlFor="ot-cs" error={errors.certStatus}>
                <NativeSelect id="ot-cs" value={form.certStatus} onChange={e => set('certStatus', e.target.value)}>
                  {certStatuses.map(s => <option key={s} value={s}>{CERTIFICATE_STATUS_LABELS[s]}</option>)}
                </NativeSelect>
              </Field>
              <Field label="Certificate no." htmlFor="ot-cn">
                <Input id="ot-cn" value={form.certNumber} maxLength={60} onChange={e => set('certNumber', e.target.value)} />
              </Field>
              <Field label="Certificate date" error={errors.certDate || hints.certDateError}>
                <DatePicker value={form.certDate} onChange={v => set('certDate', v)} disabled={form.certStatus === 'PENDING'} size="md" />
              </Field>
            </div>
          </div>
        )}

        <Field label="Notes" htmlFor="ot-notes">
          <Textarea id="ot-notes" rows={2} className="min-h-0" value={form.notes} maxLength={1000} onChange={e => set('notes', e.target.value)} />
        </Field>
      </form>
      <ModalFooter>
        <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Cancel</Button>
        <Button type="submit" form="tax-opening-form" loading={saving}>
          {entry ? 'Save changes' : 'Add balance'}
        </Button>
      </ModalFooter>
    </Modal>
  )
}
