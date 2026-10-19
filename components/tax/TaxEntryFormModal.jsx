'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { Loader2, Plus, AlertTriangle, CheckCircle2, Info } from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import DatePicker from '@/components/ui/DatePicker'
import FileUpload from '@/components/ui/FileUpload'
import MoneyAccountSelect, { invalidateMoneyAccounts } from '@/components/finance/MoneyAccountSelect'
import TaxCodeSelect from '@/components/tax/TaxCodeSelect'
import { BD_BANKS } from '@/lib/finance/constants'
import {
  VAT_RATE_OPTIONS, VAT_RETURN_NOTES, VAT_INCREASE_NOTES, SUPPLIER_VAT_TYPES, INPUT_NON_CREDIT_REASONS,
  isValidBin, isValidTin, normalizeBin,
} from '@/lib/tax/catalog'
import { inputCls, labelCls, hintCls, btnPrimary, btnGhost, tk, todayKey, fetchJson } from './taxUi'

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
    <Modal open={open} onOpenChange={onOpenChange} title={title} description="Manual entries go straight to the tax ledger and the returns that use them." size="lg">
      <div className="space-y-4 mb-4">
        {allowed.length > 1 && (
          <div>
            <label className={labelCls}>Entry type</label>
            <select className={inputCls} value={type} onChange={(e) => { setForm(blank(e.target.value)); setAmountTouched(false); setError(null) }}>
              {allowed.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>{type === 'ADVANCE_TAX' ? 'Payment date *' : type === 'VAT_ADJUSTMENT' ? 'Tax period date *' : 'Tax point / date *'}</label>
            <DatePicker value={form.date} onChange={set('date')} clearable={false} />
            {type === 'VAT_ADJUSTMENT' && <p className={hintCls}>The adjustment goes into the return of this date's tax period.</p>}
          </div>
        </div>

        {/* VAT adjustment */}
        {type === 'VAT_ADJUSTMENT' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Direction</label>
              <select className={inputCls} value={form.direction} onChange={(e) => setForm(f => ({ ...f, direction: e.target.value, adjustmentNote: e.target.value === 'DECREASE' ? 32 : 27 }))}>
                <option value="INCREASE">Increasing (adds to VAT payable)</option>
                <option value="DECREASE">Decreasing (reduces VAT payable)</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Mushak-9.1 note</label>
              {form.direction === 'INCREASE' ? (
                <select className={inputCls} value={form.adjustmentNote} onChange={set('adjustmentNote')}>
                  {VAT_INCREASE_NOTES.map(no => <option key={no} value={no}>{no} — {VAT_RETURN_NOTES[no]?.label}</option>)}
                </select>
              ) : (
                <input className={inputCls} value={`32 — ${VAT_RETURN_NOTES[32]?.label}`} disabled />
              )}
            </div>
            <div>
              <label className={labelCls}>Amount (Tk) *</label>
              <input type="number" min="0" step="0.01" inputMode="decimal" className={inputCls} value={form.amount} onChange={set('amount')} />
            </div>
            <div>
              <label className={labelCls}>Reference</label>
              <input className={inputCls} value={form.documentNo} onChange={set('documentNo')} placeholder="Order / letter no." />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Reason *</label>
              <input className={inputCls} value={form.reason} onChange={set('reason')} maxLength={500} placeholder="e.g. Interest on late payment of Aug 2026 VAT" />
            </div>
          </div>
        )}

        {/* Input / output VAT */}
        {vatLike && (
          <>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className={labelCls}>{type === 'INPUT_VAT' ? 'Supplier *' : 'Buyer *'}</label>
                <input className={inputCls} value={form.partyName} onChange={set('partyName')} maxLength={200} />
              </div>
              <div>
                <label className={labelCls}>{type === 'INPUT_VAT' ? 'Supplier BIN' : 'Buyer BIN'}</label>
                <input className={`${inputCls} font-mono`} value={form.partyBin} onChange={set('partyBin')} placeholder="000123456-0101" />
                {form.partyBin && !isValidBin(form.partyBin) && <p className="mt-1 text-[11px] text-red-600">BIN is 9 or 13 digits</p>}
              </div>
              {type === 'INPUT_VAT' && (
                <div>
                  <label className={labelCls}>Supplier VAT status</label>
                  <select className={inputCls} value={form.supplierVatType} onChange={set('supplierVatType')}>
                    {SUPPLIER_VAT_TYPES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label className={labelCls}>{type === 'INPUT_VAT' ? 'Supplier Mushak-6.3 no.' : 'Mushak-6.3 / invoice no. *'}</label>
                <input className={inputCls} value={form.documentNo} onChange={set('documentNo')} maxLength={80} />
              </div>
              <div>
                <label className={labelCls}>Document date</label>
                <DatePicker value={form.documentDate} onChange={set('documentDate')} />
              </div>
              <div>
                <label className={labelCls}>VAT service code</label>
                <TaxCodeSelect kind="VAT_SERVICE" value={form.serviceCode} onChange={(code, row) => {
                  setForm(f => ({
                    ...f, serviceCode: code,
                    ...(row?.vatRate != null ? { rate: String(row.vatRate), treatment: row.treatment || f.treatment } : {}),
                  }))
                }} className={inputCls} placeholder="Optional" />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className={labelCls}>Treatment</label>
                <select className={inputCls} value={form.treatment} onChange={set('treatment')}>
                  {TREATMENTS.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>VAT rate %</label>
                <select className={inputCls} value={form.rate} onChange={set('rate')} disabled={['ZERO_RATED', 'EXEMPT'].includes(form.treatment)}>
                  {VAT_RATE_OPTIONS.map(r => <option key={r} value={String(r)}>{r}%</option>)}
                </select>
              </div>
              <div>
                <label className={labelCls}>Value excl. VAT *</label>
                <input type="number" min="0" step="0.01" inputMode="decimal" className={inputCls} value={form.baseAmount} onChange={set('baseAmount')} />
              </div>
              <div>
                <label className={labelCls}>SD (Tk)</label>
                <input type="number" min="0" step="0.01" inputMode="decimal" className={inputCls} value={form.sdAmount} onChange={set('sdAmount')} placeholder="0" />
              </div>
              <div className="col-span-2 sm:col-span-2">
                <label className={labelCls}>VAT (Tk)</label>
                <input type="number" min="0" step="0.01" inputMode="decimal" className={inputCls} value={form.amount}
                  onChange={(e) => { setAmountTouched(true); set('amount')(e) }} />
                <p className={hintCls}>
                  Total incl. VAT {tk(n(form.baseAmount) + n(form.sdAmount) + n(form.amount))}
                  {amountTouched && <button type="button" className="ml-2 text-gray-600 underline" onClick={() => setAmountTouched(false)}>recalculate</button>}
                </p>
              </div>
            </div>

            {type === 'INPUT_VAT' && (
              <div className="rounded-lg border border-gray-100 bg-gray-50 p-3 space-y-2">
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" className="rounded border-gray-300" checked={!!form.bankingChannel} onChange={set('bankingChannel')} />
                  Paid through a bank / MFS (needed for ITC above Tk 1,00,000)
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-700">
                  <input type="checkbox" className="rounded border-gray-300" checked={!!form.creditable} onChange={set('creditable')} />
                  Claim as input tax credit
                </label>
                {itc && (
                  <p className={`flex items-start gap-1.5 text-xs ${itc.creditable ? 'text-green-700' : 'text-amber-700'}`}>
                    {itc.creditable ? <CheckCircle2 className="w-3.5 h-3.5 mt-0.5 shrink-0" /> : <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />}
                    {itc.creditable ? 'Statutory checks pass — this VAT can be credited.' : `Not creditable: ${itc.reasonLabel}`}
                  </p>
                )}
                {!form.creditable && (
                  <div>
                    <label className={labelCls}>Why not creditable</label>
                    <select className={inputCls} value={form.nonCreditReason} onChange={set('nonCreditReason')}>
                      <option value="">Work it out from the checks</option>
                      {Object.entries(INPUT_NON_CREDIT_REASONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                )}
              </div>
            )}
          </>
        )}

        {/* TDS / AIT receivable */}
        {type === 'TDS_RECEIVABLE' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Deducted by *</label>
              <input className={inputCls} value={form.partyName} onChange={set('partyName')} placeholder="Customer or bank" maxLength={200} />
            </div>
            <div>
              <label className={labelCls}>Party type</label>
              <select className={inputCls} value={form.partyType} onChange={set('partyType')}>
                <option value="CLIENT">Customer</option>
                <option value="OTHER">Bank / other</option>
              </select>
            </div>
            <div>
              <label className={labelCls}>Their TIN</label>
              <input className={`${inputCls} font-mono`} value={form.partyTin} onChange={set('partyTin')} placeholder="12 digits" />
            </div>
            <div>
              <label className={labelCls}>Section</label>
              <TaxCodeSelect kind="TDS_SECTION" value={form.section} onChange={(code, row) => setForm(f => ({ ...f, section: code, ...(row ? { rate: String(row.rateCompany ?? '') } : {}) }))} className={inputCls} placeholder="Optional" />
            </div>
            <div>
              <label className={labelCls}>Amount paid to us (Tk)</label>
              <input type="number" min="0" step="0.01" inputMode="decimal" className={inputCls} value={form.baseAmount} onChange={set('baseAmount')} />
            </div>
            <div>
              <label className={labelCls}>Rate %</label>
              <input type="number" min="0" max="100" step="0.01" inputMode="decimal" className={inputCls} value={form.rate} onChange={set('rate')} />
            </div>
            <div>
              <label className={labelCls}>Tax deducted (Tk) *</label>
              <input type="number" min="0" step="0.01" inputMode="decimal" className={inputCls} value={form.amount} onChange={(e) => { setAmountTouched(true); set('amount')(e) }} />
            </div>
            <div>
              <label className={labelCls}>Reference (invoice / statement)</label>
              <input className={inputCls} value={form.documentNo} onChange={set('documentNo')} maxLength={80} />
            </div>
            <div>
              <label className={labelCls}>Certificate no.</label>
              <input className={inputCls} value={form.certificateNo} onChange={set('certificateNo')} maxLength={60} placeholder="If received" />
            </div>
            <div>
              <label className={labelCls}>Certificate date</label>
              <DatePicker value={form.certificateDate} onChange={set('certificateDate')} />
            </div>
          </div>
        )}

        {/* Advance income tax */}
        {type === 'ADVANCE_TAX' && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Amount paid (Tk) *</label>
              <input type="number" min="0" step="0.01" inputMode="decimal" className={inputCls} value={form.amount} onChange={set('amount')} />
            </div>
            <div>
              <label className={labelCls}>Instalment</label>
              <select className={inputCls} value={form.instalment} onChange={set('instalment')}>
                <option value="">—</option>
                <option value="1">1st (by 15 Sep)</option>
                <option value="2">2nd (by 15 Dec)</option>
                <option value="3">3rd (by 15 Mar)</option>
                <option value="4">4th (by 15 Jun)</option>
              </select>
              <p className={hintCls}>Marks this instalment as paid on the compliance calendar. Pay one instalment in several challans by picking the same instalment.</p>
            </div>
            <div>
              <label className={labelCls}>Challan / e-payment no. *</label>
              <input className={inputCls} value={form.challanNo} onChange={set('challanNo')} maxLength={60} />
            </div>
            <div>
              <label className={labelCls}>Paid from account</label>
              <MoneyAccountSelect value={form.accountId} onChange={(id) => setForm(f => ({ ...f, accountId: id }))} placeholder="Select the account (posts the payment)" />
              <p className={hintCls}>Leave empty only for a payment already recorded elsewhere (before go-live).</p>
            </div>
            <div>
              <label className={labelCls}>Bank</label>
              <input className={inputCls} list="adv-tax-banks" value={form.bank} onChange={set('bank')} />
              <datalist id="adv-tax-banks">{BD_BANKS.map(b => <option key={b} value={b} />)}</datalist>
            </div>
            <div>
              <label className={labelCls}>Branch</label>
              <input className={inputCls} value={form.branch} onChange={set('branch')} />
            </div>
            <div className="sm:col-span-2">
              <label className={labelCls}>Treasury account code</label>
              <input className={`${inputCls} font-mono`} value={form.accountCode} onChange={set('accountCode')} />
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Notes</label>
            <textarea rows={3} className={inputCls} value={form.notes} onChange={set('notes')} maxLength={1000} />
          </div>
          <FileUpload value={form.attachment} onUploaded={(url) => setForm(f => ({ ...f, attachment: url }))} label="Supporting document" bucket="tax" />
        </div>

        {type === 'OUTPUT_VAT' && (
          <p className="flex items-start gap-1.5 text-xs text-gray-500">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            Sales invoiced in the CRM record their output VAT automatically when the invoice is sent — use this only for sales made outside it.
          </p>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
      <ModalFooter>
        <button type="button" className={btnGhost} onClick={() => onOpenChange?.(false)} disabled={saving}>Cancel</button>
        <button type="button" className={btnPrimary} onClick={submit} disabled={saving || !allowed.length}>
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plus className="w-4 h-4" />}
          Record
        </button>
      </ModalFooter>
    </Modal>
  )
}
