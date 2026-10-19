'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { Input, Textarea, NativeSelect, Field } from '@/components/ui/Input'
import DatePicker from '@/components/ui/DatePicker'
import FileUpload from '@/components/ui/FileUpload'
import MoneyAccountSelect, { invalidateMoneyAccounts } from '@/components/finance/MoneyAccountSelect'
import TaxCodeSelect from '@/components/tax/TaxCodeSelect'
import { BD_BANKS } from '@/lib/finance/constants'
import {
  VAT_RATE_OPTIONS, VAT_RETURN_NOTES, VAT_INCREASE_NOTES, SUPPLIER_VAT_TYPES, INPUT_NON_CREDIT_REASONS,
  isValidBin, isValidTin, normalizeBin,
} from '@/lib/tax/catalog'
import { tk, todayKey, fetchJson } from './taxUi'

export const MANUAL_ENTRY_TYPES = [
  { value: 'VAT_ADJUSTMENT', label: 'VAT adjustment (increase / decrease)', perm: 'tax.manage' },
  { value: 'INPUT_VAT',      label: 'Input VAT — purchase not recorded elsewhere', perm: 'tax.manage' },
  { value: 'OUTPUT_VAT',     label: 'Output VAT — sale outside invoicing', perm: 'tax.manage' },
  { value: 'TDS_RECEIVABLE', label: 'AIT / TDS deducted from us (credit)', perm: 'tax.manage' },
  { value: 'ADVANCE_TAX',    label: 'Advance income tax payment', perm: 'tax.deposits.manage' },
]

const TREATMENTS = [
  { value: 'STANDARD',   label: 'Standard (15%)' },
  { value: 'REDUCED',    label: 'Reduced rate' },
  { value: 'ZERO_RATED', label: 'Zero-rated' },
  { value: 'EXEMPT',     label: 'Exempt' },
]

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const n = (v) => (v === '' || v === null || v === undefined ? 0 : Number(v) || 0)

function blank(type) {
  return {
    entryType: type,
    date: todayKey(),
    notes: '',
    attachment: null,
    documentNo: '',
    documentDate: null,
    // VAT adjustment
    direction: 'INCREASE',
    adjustmentNote: 27,
    reason: '',
    // purchase / sale
    partyName: '',
    partyBin: '',
    partyTin: '',
    partyType: 'CLIENT',
    supplierVatType: 'REGISTERED',
    treatment: 'STANDARD',
    rate: type === 'TDS_RECEIVABLE' ? '' : '15',
    baseAmount: '',
    sdAmount: '',
    amount: '',
    serviceCode: null,
    creditable: true,
    nonCreditReason: '',
    bankingChannel: true,
    // TDS receivable
    section: null,
    certificateNo: '',
    certificateDate: null,
    // advance tax
    challanNo: '',
    accountId: null,
    bank: '',
    branch: '',
    accountCode: '',
    instalment: '',
  }
}

/**
 * Manual tax entry / advance tax payment.
 * Props: open, onOpenChange, initialType, types (allowed values), onSaved(row)
 */
export default function TaxEntryFormModal({ open, onOpenChange, initialType = 'VAT_ADJUSTMENT', types = null, onSaved }) {
  const allowed = useMemo(() => MANUAL_ENTRY_TYPES.filter(t => !types || types.includes(t.value)), [types])
  const [form, setForm] = useState(() => blank(initialType))
  const [amountTouched, setAmountTouched] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)
  const [itc, setItc] = useState(null)

  useEffect(() => {
    if (!open) return
    const start = allowed.some(t => t.value === initialType) ? initialType : allowed[0]?.value
    setForm(blank(start))
    setAmountTouched(false)
    setError(null)
    setItc(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const type = form.entryType
  const set = (k) => (v) => setForm(f => ({ ...f, [k]: v?.target ? (v.target.type === 'checkbox' ? v.target.checked : v.target.value) : v }))

  // Auto VAT / TDS from base × rate until the user edits the amount
  useEffect(() => {
    if (amountTouched) return
    if (type === 'INPUT_VAT' || type === 'OUTPUT_VAT') {
      if (['ZERO_RATED', 'EXEMPT'].includes(form.treatment)) { setForm(f => ({ ...f, amount: '0' })); return }
      if (form.baseAmount === '' || form.rate === '') return
      const vat = round2(((n(form.baseAmount) + n(form.sdAmount)) * n(form.rate)) / 100)
      setForm(f => ({ ...f, amount: String(vat) }))
    } else if (type === 'TDS_RECEIVABLE') {
      if (form.baseAmount === '' || form.rate === '') return
      setForm(f => ({ ...f, amount: String(round2((n(form.baseAmount) * n(form.rate)) / 100)) }))
    }
  }, [type, form.baseAmount, form.sdAmount, form.rate, form.treatment, amountTouched])

  // Live input-tax-credit check (debounced)
  const itcTimer = useRef(null)
  useEffect(() => {
    if (!open || type !== 'INPUT_VAT') return
    if (itcTimer.current) clearTimeout(itcTimer.current)
    itcTimer.current = setTimeout(async () => {
      try {
        const qs = new URLSearchParams({
          type: 'itc',
          supplierVatType: form.supplierVatType,
          hasMushak: form.documentNo && isValidBin(form.partyBin) ? '1' : '0',
          gross: String(round2(n(form.baseAmount) + n(form.sdAmount) + n(form.amount))),
          bank: form.bankingChannel ? '1' : '0',
        })
        const json = await fetchJson(`/api/tax/suggest?${qs.toString()}`)
        setItc(json.data)
      } catch {
        setItc(null)
      }
    }, 400)
    return () => clearTimeout(itcTimer.current)
  }, [open, type, form.supplierVatType, form.documentNo, form.partyBin, form.baseAmount, form.sdAmount, form.amount, form.bankingChannel])

  async function submit() {
    setError(null)
    if (!form.date) return setError('Enter the date')
    const body = { entryType: type, date: form.date, notes: form.notes || null, attachments: form.attachment ? [form.attachment] : [] }

    if (type === 'VAT_ADJUSTMENT') {
      if (!(n(form.amount) > 0)) return setError('Enter the adjustment amount')
      if (form.reason.trim().length < 5) return setError('Explain the adjustment (at least 5 characters)')
      Object.assign(body, {
        direction: form.direction,
        adjustmentNote: form.direction === 'DECREASE' ? 32 : Number(form.adjustmentNote),
        amount: round2(n(form.amount)),
        reason: form.reason.trim(),
        documentNo: form.documentNo || null,
      })
    } else if (type === 'INPUT_VAT' || type === 'OUTPUT_VAT') {
      if (!form.partyName.trim()) return setError(type === 'INPUT_VAT' ? 'Enter the supplier' : 'Enter the buyer')
      if (form.partyBin && !isValidBin(form.partyBin)) return setError('BIN is 9 or 13 digits, e.g. 000123456-0101')
      if (type === 'OUTPUT_VAT' && !form.documentNo.trim()) return setError('Enter the Mushak-6.3 / invoice number')
      if (form.baseAmount === '' || n(form.baseAmount) < 0) return setError('Enter the value excluding VAT')
      Object.assign(body, {
        partyName: form.partyName.trim(),
        partyBin: form.partyBin ? normalizeBin(form.partyBin) : null,
        documentNo: form.documentNo || null,
        documentDate: form.documentDate || null,
        treatment: form.treatment,
        rate: ['ZERO_RATED', 'EXEMPT'].includes(form.treatment) ? 0 : (form.rate === '' ? null : n(form.rate)),
        baseAmount: round2(n(form.baseAmount)),
        sdAmount: round2(n(form.sdAmount)),
        amount: round2(n(form.amount)),
        serviceCode: form.serviceCode || null,
      })
      if (type === 'INPUT_VAT') {
        Object.assign(body, {
          supplierVatType: form.supplierVatType,
          creditable: !!form.creditable,
          nonCreditReason: form.creditable ? null : (form.nonCreditReason || null),
          bankingChannel: !!form.bankingChannel,
        })
      }
    } else if (type === 'TDS_RECEIVABLE') {
      if (!form.partyName.trim()) return setError('Enter who deducted the tax')
      if (form.partyTin && !isValidTin(form.partyTin)) return setError('TIN is 12 digits')
      if (!(n(form.amount) > 0)) return setError('Enter the tax deducted')
      if (form.certificateNo && !form.certificateDate) return setError('Enter the certificate date')
      Object.assign(body, {
        partyName: form.partyName.trim(),
        partyType: form.partyType,
        partyTin: form.partyTin || null,
        section: form.section || null,
        baseAmount: form.baseAmount === '' ? null : round2(n(form.baseAmount)),
        rate: form.rate === '' ? null : n(form.rate),
        amount: round2(n(form.amount)),
        documentNo: form.documentNo || null,
        certificateNo: form.certificateNo || null,
        certificateDate: form.certificateDate || null,
      })
    } else if (type === 'ADVANCE_TAX') {
      if (!(n(form.amount) > 0)) return setError('Enter the amount paid')
      if (!form.challanNo.trim()) return setError('Enter the challan number')
      Object.assign(body, {
        amount: round2(n(form.amount)),
        challanNo: form.challanNo.trim(),
        accountId: form.accountId || null,
        bank: form.bank || null,
        branch: form.branch || null,
        accountCode: form.accountCode || null,
        instalment: form.instalment ? Number(form.instalment) : null,
      })
    }

    setSaving(true)
    try {
      const json = await fetchJson('/api/tax/entries', { method: 'POST', body })
      if (type === 'ADVANCE_TAX' && json.transactionId) invalidateMoneyAccounts()
      toast.success(`${json.data?.entryNo ?? 'Entry'} recorded`)
      onSaved?.(json.data)
      onOpenChange?.(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const vatLike = type === 'INPUT_VAT' || type === 'OUTPUT_VAT'
  const title = type === 'ADVANCE_TAX' ? 'Record advance income tax' : 'New tax entry'

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={title} size="lg">
      <div className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-2">
          {allowed.length > 1 && (
            <Field label="Entry type">
              <NativeSelect value={type} onChange={(e) => { setForm(blank(e.target.value)); setAmountTouched(false); setError(null) }}>
                {allowed.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
              </NativeSelect>
            </Field>
          )}
          <div title={type === 'VAT_ADJUSTMENT' ? 'The adjustment goes into the return of this date’s tax period' : undefined}>
            <Field label={type === 'ADVANCE_TAX' ? 'Payment date' : type === 'VAT_ADJUSTMENT' ? 'Tax period date' : 'Tax point / date'} required>
              <DatePicker value={form.date} onChange={set('date')} clearable={false} />
            </Field>
          </div>
        </div>

        {/* VAT adjustment */}
        {type === 'VAT_ADJUSTMENT' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Direction">
              <NativeSelect value={form.direction} onChange={(e) => setForm(f => ({ ...f, direction: e.target.value, adjustmentNote: e.target.value === 'DECREASE' ? 32 : 27 }))}>
                <option value="INCREASE">Increasing (adds to VAT payable)</option>
                <option value="DECREASE">Decreasing (reduces VAT payable)</option>
              </NativeSelect>
            </Field>
            <Field label="Mushak-9.1 note">
              {form.direction === 'INCREASE' ? (
                <NativeSelect value={form.adjustmentNote} onChange={set('adjustmentNote')}>
                  {VAT_INCREASE_NOTES.map(no => <option key={no} value={no}>{no} — {VAT_RETURN_NOTES[no]?.label}</option>)}
                </NativeSelect>
              ) : (
                <Input value={`32 — ${VAT_RETURN_NOTES[32]?.label}`} disabled />
              )}
            </Field>
            <Field label="Amount (Tk)" required>
              <Input type="number" min="0" step="0.01" inputMode="decimal" className="tabular-nums" value={form.amount} onChange={set('amount')} placeholder="0.00" />
            </Field>
            <Field label="Reference">
              <Input value={form.documentNo} onChange={set('documentNo')} placeholder="Order / letter no." />
            </Field>
            <Field label="Reason" required className="sm:col-span-2">
              <Input value={form.reason} onChange={set('reason')} maxLength={500} placeholder="e.g. Interest on late Aug 2026 VAT" />
            </Field>
          </div>
        )}

        {/* Input / output VAT */}
        {vatLike && (
          <>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label={type === 'INPUT_VAT' ? 'Supplier' : 'Buyer'} required>
                <Input value={form.partyName} onChange={set('partyName')} maxLength={200} />
              </Field>
              <Field
                label={type === 'INPUT_VAT' ? 'Supplier BIN' : 'Buyer BIN'}
                error={form.partyBin && !isValidBin(form.partyBin) ? 'BIN is 9 or 13 digits' : undefined}
              >
                <Input className="font-mono" value={form.partyBin} onChange={set('partyBin')} placeholder="000123456-0101" invalid={!!form.partyBin && !isValidBin(form.partyBin)} />
              </Field>
              {type === 'INPUT_VAT' && (
                <Field label="Supplier VAT status">
                  <NativeSelect value={form.supplierVatType} onChange={set('supplierVatType')}>
                    {SUPPLIER_VAT_TYPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </NativeSelect>
                </Field>
              )}
              <Field label={type === 'INPUT_VAT' ? 'Supplier Mushak-6.3 no.' : 'Mushak-6.3 / invoice no.'} required={type !== 'INPUT_VAT'}>
                <Input value={form.documentNo} onChange={set('documentNo')} maxLength={80} />
              </Field>
              <Field label="Document date">
                <DatePicker value={form.documentDate} onChange={set('documentDate')} />
              </Field>
              <Field label="VAT service code">
                <TaxCodeSelect kind="VAT_SERVICE" value={form.serviceCode} onChange={(code, row) => {
                  setForm(f => ({
                    ...f, serviceCode: code,
                    ...(row?.vatRate != null ? { rate: String(row.vatRate), treatment: row.treatment || f.treatment } : {}),
                  }))
                }} placeholder="Optional" />
              </Field>
            </div>

            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
              <Field label="Treatment">
                <NativeSelect value={form.treatment} onChange={set('treatment')}>
                  {TREATMENTS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </NativeSelect>
              </Field>
              <Field label="VAT rate %">
                <NativeSelect value={form.rate} onChange={set('rate')} disabled={['ZERO_RATED', 'EXEMPT'].includes(form.treatment)}>
                  {VAT_RATE_OPTIONS.map(r => <option key={r} value={String(r)}>{r}%</option>)}
                </NativeSelect>
              </Field>
              <Field label="Value excl. VAT" required>
                <Input type="number" min="0" step="0.01" inputMode="decimal" className="tabular-nums" value={form.baseAmount} onChange={set('baseAmount')} placeholder="0.00" />
              </Field>
              <Field label="SD (Tk)">
                <Input type="number" min="0" step="0.01" inputMode="decimal" className="tabular-nums" value={form.sdAmount} onChange={set('sdAmount')} placeholder="0.00" />
              </Field>
              <div className="col-span-2">
                <Field label="VAT (Tk)">
                  <Input type="number" min="0" step="0.01" inputMode="decimal" className="tabular-nums" value={form.amount}
                    onChange={(e) => { setAmountTouched(true); set('amount')(e) }} />
                </Field>
                <p className="mt-1.5 text-xs text-muted-foreground">
                  Total incl. VAT <span className="font-medium text-gray-700 tabular-nums">{tk(n(form.baseAmount) + n(form.sdAmount) + n(form.amount))}</span>
                  {amountTouched && <button type="button" className="ml-2 font-medium text-gray-900 underline-offset-4 hover:underline" onClick={() => setAmountTouched(false)}>Recalculate</button>}
                </p>
              </div>
            </div>

            {type === 'INPUT_VAT' && (
              <div className="space-y-3 rounded-lg bg-gray-50 p-4">
                <label className="flex items-center gap-2 text-sm text-gray-900">
                  <input type="checkbox" className="rounded border-gray-300" checked={!!form.bankingChannel} onChange={set('bankingChannel')} />
                  Paid via bank / MFS <span className="text-muted-foreground">(needed for ITC over Tk 1,00,000)</span>
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-900">
                  <input type="checkbox" className="rounded border-gray-300" checked={!!form.creditable} onChange={set('creditable')} />
                  Claim as input tax credit
                </label>
                {itc && (
                  <p className={`flex items-start gap-1.5 text-[13px] ${itc.creditable ? 'text-emerald-700' : 'text-amber-700'}`}>
                    {itc.creditable ? <CheckCircle2 className="mt-0.5 size-4 shrink-0" /> : <AlertTriangle className="mt-0.5 size-4 shrink-0" />}
                    {itc.creditable ? 'Creditable — statutory checks pass.' : `Not creditable: ${itc.reasonLabel}`}
                  </p>
                )}
                {!form.creditable && (
                  <Field label="Why not creditable">
                    <NativeSelect value={form.nonCreditReason} onChange={set('nonCreditReason')}>
                      <option value="">Auto (from the checks)</option>
                      {Object.entries(INPUT_NON_CREDIT_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </NativeSelect>
                  </Field>
                )}
              </div>
            )}
          </>
        )}

        {/* TDS / AIT receivable */}
        {type === 'TDS_RECEIVABLE' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Deducted by" required>
              <Input value={form.partyName} onChange={set('partyName')} placeholder="Customer or bank" maxLength={200} />
            </Field>
            <Field label="Party type">
              <NativeSelect value={form.partyType} onChange={set('partyType')}>
                <option value="CLIENT">Customer</option>
                <option value="OTHER">Bank / other</option>
              </NativeSelect>
            </Field>
            <Field label="Their TIN">
              <Input className="font-mono" value={form.partyTin} onChange={set('partyTin')} placeholder="12 digits" />
            </Field>
            <Field label="Section">
              <TaxCodeSelect kind="TDS_SECTION" value={form.section} onChange={(code, row) => setForm(f => ({ ...f, section: code, ...(row ? { rate: String(row.rateCompany ?? '') } : {}) }))} placeholder="Optional" />
            </Field>
            <Field label="Amount paid to us (Tk)">
              <Input type="number" min="0" step="0.01" inputMode="decimal" className="tabular-nums" value={form.baseAmount} onChange={set('baseAmount')} placeholder="0.00" />
            </Field>
            <Field label="Rate %">
              <Input type="number" min="0" max="100" step="0.01" inputMode="decimal" className="tabular-nums" value={form.rate} onChange={set('rate')} />
            </Field>
            <Field label="Tax deducted (Tk)" required>
              <Input type="number" min="0" step="0.01" inputMode="decimal" className="tabular-nums" value={form.amount} onChange={(e) => { setAmountTouched(true); set('amount')(e) }} placeholder="0.00" />
            </Field>
            <Field label="Reference">
              <Input value={form.documentNo} onChange={set('documentNo')} maxLength={80} placeholder="Invoice / statement no." />
            </Field>
            <Field label="Certificate no.">
              <Input value={form.certificateNo} onChange={set('certificateNo')} maxLength={60} placeholder="If received" />
            </Field>
            <Field label="Certificate date">
              <DatePicker value={form.certificateDate} onChange={set('certificateDate')} />
            </Field>
          </div>
        )}

        {/* Advance income tax */}
        {type === 'ADVANCE_TAX' && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Amount paid (Tk)" required>
              <Input type="number" min="0" step="0.01" inputMode="decimal" className="tabular-nums" value={form.amount} onChange={set('amount')} placeholder="0.00" />
            </Field>
            <Field label="Instalment">
              <NativeSelect
                value={form.instalment}
                onChange={set('instalment')}
                title="Marks this instalment paid on the compliance calendar. Split one instalment over several challans by picking it again."
              >
                <option value="">—</option>
                <option value="1">1st (by 15 Sep)</option>
                <option value="2">2nd (by 15 Dec)</option>
                <option value="3">3rd (by 15 Mar)</option>
                <option value="4">4th (by 15 Jun)</option>
              </NativeSelect>
            </Field>
            <Field label="Challan / e-payment no." required>
              <Input value={form.challanNo} onChange={set('challanNo')} maxLength={60} />
            </Field>
            <Field label="Paid from account" hint="Empty only if recorded before go-live">
              <MoneyAccountSelect value={form.accountId} onChange={(id) => setForm(f => ({ ...f, accountId: id }))} placeholder="Select account…" />
            </Field>
            <Field label="Bank">
              <Input list="adv-tax-banks" value={form.bank} onChange={set('bank')} />
              <datalist id="adv-tax-banks">{BD_BANKS.map(b => <option key={b} value={b} />)}</datalist>
            </Field>
            <Field label="Branch">
              <Input value={form.branch} onChange={set('branch')} />
            </Field>
            <Field label="Treasury account code" className="sm:col-span-2">
              <Input className="font-mono" value={form.accountCode} onChange={set('accountCode')} />
            </Field>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Notes">
            <Textarea rows={3} value={form.notes} onChange={set('notes')} maxLength={1000} />
          </Field>
          <FileUpload value={form.attachment} onUploaded={(url) => setForm(f => ({ ...f, attachment: url }))} label="Supporting document" bucket="tax" />
        </div>

        {type === 'OUTPUT_VAT' && (
          <div className="flex items-start gap-2 rounded-lg border border-gray-200/80 bg-gray-50 px-3 py-2.5 text-[13px] text-gray-700">
            <Info className="mt-0.5 size-4 shrink-0 text-gray-500" />
            <span>Invoiced sales post output VAT automatically — use this only for sales outside the CRM.</span>
          </div>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
      <ModalFooter>
        <Button variant="outline" onClick={() => onOpenChange?.(false)} disabled={saving}>Cancel</Button>
        <Button onClick={submit} loading={saving} disabled={!allowed.length}>
          Record entry
        </Button>
      </ModalFooter>
    </Modal>
  )
}
