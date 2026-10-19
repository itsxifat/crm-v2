'use client'

import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Landmark, Loader2, AlertTriangle, Info } from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import DatePicker from '@/components/ui/DatePicker'
import FileUpload from '@/components/ui/FileUpload'
import MoneyAccountSelect, { invalidateMoneyAccounts } from '@/components/finance/MoneyAccountSelect'
import { BD_BANKS } from '@/lib/finance/constants'
import { CHALLAN_CODES } from '@/lib/tax/catalog'
import {
  inputCls, labelCls, hintCls, btnPrimary, btnGhost, tk, fmtDay, todayKey, fetchJson, fmtPeriod, depositBalance, sumBalance,
} from './taxUi'

const KIND_COPY = {
  TDS: { title: 'Deposit TDS by challan', what: 'TDS deductions', category: 'Tax Deposit — TDS' },
  VDS: { title: 'Deposit VDS by challan', what: 'VDS deductions', category: 'Tax Deposit — VDS' },
  VAT: { title: 'Pay VAT by challan', what: 'VAT return', category: 'VAT Payment' },
}

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

/**
 * Record a treasury challan: TDS / VDS deposits settle the selected payables;
 * VAT payments are linked to a VAT return period.
 *
 * Props:
 *   open, onOpenChange
 *   kind          'TDS' | 'VDS' | 'VAT'
 *   entries       selected payables (TDS_PAYABLE / VDS_PAYABLE rows) — TDS / VDS
 *   returnPeriod  { start:'YYYY-MM', end:'YYYY-MM', label } — VAT (optional; defaults to the last ended return)
 *   defaultAmount number — VAT (e.g. balance due on the return)
 *   onSaved(result)
 */
export default function DepositModal({ open, onOpenChange, kind = 'TDS', entries = [], returnPeriod = null, defaultAmount = null, onSaved }) {
  const copy = KIND_COPY[kind] ?? KIND_COPY.TDS
  const isVat = kind === 'VAT'
  // What is still owed on the selection (a part-paid deduction counts with its balance).
  const selectedTotal = useMemo(() => sumBalance(entries), [entries])

  const payeeTypes = useMemo(() => [...new Set(entries.map(e => e.payeeType || 'COMPANY'))], [entries])
  const defaultCode = useMemo(() => {
    if (kind === 'TDS') {
      if (payeeTypes.length !== 1) return ''
      return payeeTypes[0] === 'COMPANY' ? CHALLAN_CODES.TDS_COMPANY : CHALLAN_CODES.TDS_NON_COMPANY
    }
    if (kind === 'VDS') return CHALLAN_CODES.VAT_NEW
    return ''
  }, [kind, payeeTypes])

  const [form, setForm] = useState({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (!open) return
    setForm({
      challanNo: '',
      date: todayKey(),
      accountId: null,
      amount: isVat ? (defaultAmount != null && defaultAmount > 0 ? String(round2(defaultAmount)) : '') : String(selectedTotal || ''),
      interestAmount: '',
      bank: '',
      branch: '',
      accountCode: defaultCode,
      notes: '',
      allowPartial: false,
      attachment: null,
      returnStart: returnPeriod?.start ?? '',
      returnEnd: returnPeriod?.end ?? '',
    })
    setError(null)
    // Reset only when the modal opens — parents may pass new arrays/objects on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  const set = (k) => (v) => setForm(f => ({ ...f, [k]: v?.target ? (v.target.type === 'checkbox' ? v.target.checked : v.target.value) : v }))

  const amount = round2(Number(form.amount) || 0)
  const interest = round2(Number(form.interestAmount) || 0)
  const diff = round2(amount - selectedTotal)
  const partial = !isVat && amount > 0 && diff < -0.01
  const over = !isVat && diff > 0.01

  // Oldest-first allocation preview for a part payment (same rule as the server):
  // each deduction is paid its balance while the amount lasts; the last one
  // reached may be part-paid and keeps the rest as its balance.
  const allocation = useMemo(() => {
    if (isVat) return null
    const sorted = [...entries].sort((a, b) => new Date(a.date) - new Date(b.date) || String(a.entryNo).localeCompare(String(b.entryNo)))
    let left = amount
    let full = 0
    let part = null
    for (const e of sorted) {
      if (left <= 0.005) break
      const due = depositBalance(e)
      const share = round2(Math.min(due, left))
      if (share >= due - 0.005) full += 1
      else part = { entryNo: e.entryNo, paid: share, left: round2(due - share) }
      left = round2(left - share)
    }
    return { full, part, untouched: entries.length - full - (part ? 1 : 0) }
  }, [entries, amount, isVat])

  async function submit() {
    setError(null)
    if (!form.challanNo?.trim()) return setError('Enter the challan number')
    if (!form.date) return setError('Enter the challan date')
    if (!(amount > 0)) return setError('Enter the amount deposited')
    if (over) return setError(`The amount is more than the selected deductions (${tk(selectedTotal)}). Enter interest separately.`)
    if (partial && !form.allowPartial) return setError(`The amount is less than the selected deductions (${tk(selectedTotal)}). Tick "Part payment" to continue.`)
    if (isVat && form.returnStart && form.returnEnd && form.returnStart > form.returnEnd) return setError('The return start month must not be after its end month')

    setSaving(true)
    try {
      const body = {
        kind,
        challanNo: form.challanNo.trim(),
        date: form.date,
        accountId: form.accountId || null,
        amount,
        interestAmount: interest || 0,
        bank: form.bank || null,
        branch: form.branch || null,
        accountCode: form.accountCode || null,
        notes: form.notes || null,
        attachments: form.attachment ? [form.attachment] : [],
      }
      if (isVat) {
        if (form.returnStart) body.returnStart = form.returnStart
        if (form.returnEnd) body.returnEnd = form.returnEnd || form.returnStart
      } else {
        body.entryIds = entries.map(e => e.id)
        body.allowPartial = !!form.allowPartial
      }
      const json = await fetchJson('/api/tax/deposits', { method: 'POST', body })
      invalidateMoneyAccounts()
      const d = json.data
      const fullCount = (d.settledIds?.length ?? 0) - (d.partPaid?.length ?? 0)
      const partText = (d.partPaid ?? []).map(p => `; ${p.entryNo} part-paid (${tk(p.balance)} left)`).join('')
      toast.success(isVat
        ? `VAT payment recorded — challan ${body.challanNo}`
        : `Challan ${body.challanNo} recorded — ${fullCount} deduction${fullCount === 1 ? '' : 's'} marked deposited${partText}`)
      onSaved?.(d)
      onOpenChange?.(false)
    } catch (err) {
      setError(err.message)
    } finally {
      setSaving(false)
    }
  }

  const footer = (
    <ModalFooter>
      <button type="button" className={btnGhost} onClick={() => onOpenChange?.(false)} disabled={saving}>Cancel</button>
      <button type="button" className={btnPrimary} onClick={submit} disabled={saving}>
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Landmark className="w-4 h-4" />}
        Record challan
      </button>
    </ModalFooter>
  )

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={copy.title} description={`Posts a "${copy.category}" payment from the selected account — it does not affect profit.`} size="lg">
      <div className="space-y-4 mb-4">
        {!isVat && (
          <div className="rounded-lg border border-gray-100 bg-gray-50 p-3">
            <div className="flex items-center justify-between text-sm">
              <span className="text-gray-600">{entries.length} {copy.what} selected</span>
              <span className="font-semibold text-gray-900">{tk(selectedTotal)}</span>
            </div>
            <ul className="mt-2 max-h-36 overflow-y-auto divide-y divide-gray-100 text-xs">
              {entries.map(e => (
                <li key={e.id} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="min-w-0 truncate text-gray-700">
                    <span className="font-mono text-gray-400 mr-1.5">{e.entryNo}</span>
                    {e.partyName || '—'}{e.section ? <span className="text-gray-400"> · {e.section}</span> : null}
                  </span>
                  <span className="shrink-0 text-gray-500">
                    {fmtDay(e.date)} · <span className="font-medium text-gray-800">{tk(depositBalance(e))}</span>
                    {depositBalance(e) < (Number(e.amount) || 0) - 0.005 && <span className="text-gray-400"> of {tk(e.amount)}</span>}
                  </span>
                </li>
              ))}
            </ul>
            {kind === 'TDS' && payeeTypes.length > 1 && (
              <p className="mt-2 flex items-start gap-1.5 text-xs text-amber-700">
                <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                The selection mixes company and non-company payees. Treasury codes differ ({CHALLAN_CODES.TDS_COMPANY} company, {CHALLAN_CODES.TDS_NON_COMPANY} others) — use separate challans if your bank requires it.
              </p>
            )}
          </div>
        )}

        {isVat && (
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className={labelCls}>Return period — from</label>
              <input type="month" className={inputCls} value={form.returnStart ?? ''} onChange={set('returnStart')} />
            </div>
            <div>
              <label className={labelCls}>Return period — to</label>
              <input type="month" className={inputCls} value={form.returnEnd ?? ''} onChange={set('returnEnd')} />
            </div>
            <p className={`${hintCls} sm:col-span-2 -mt-1`}>
              {form.returnStart
                ? `Counts as a treasury deposit (note 58) of the ${form.returnStart === form.returnEnd || !form.returnEnd ? fmtPeriod(form.returnStart) : `${fmtPeriod(form.returnStart)} – ${fmtPeriod(form.returnEnd)}`} Mushak-9.1.`
                : 'Leave empty to link the payment to the return of the last ended period.'}
            </p>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Challan / e-payment no. *</label>
            <input className={inputCls} value={form.challanNo ?? ''} onChange={set('challanNo')} placeholder="e.g. 2627-0012345678" maxLength={60} />
          </div>
          <div>
            <label className={labelCls}>Challan date *</label>
            <DatePicker value={form.date ?? null} onChange={set('date')} clearable={false} />
          </div>
          <div className="sm:col-span-2">
            <label className={labelCls}>Paid from account</label>
            <MoneyAccountSelect value={form.accountId ?? null} onChange={(id) => setForm(f => ({ ...f, accountId: id }))} placeholder="Select the bank / wallet account" />
            <p className={hintCls}>Required once your books are live (after the go-live date).</p>
          </div>
          <div>
            <label className={labelCls}>{isVat ? 'VAT deposited (Tk) *' : 'Tax deposited (Tk) *'}</label>
            <input type="number" min="0" step="0.01" inputMode="decimal" className={inputCls} value={form.amount ?? ''} onChange={set('amount')} />
            {!isVat && Math.abs(diff) > 0.01 && amount > 0 && (
              <p className={`mt-1 text-[11px] ${over ? 'text-red-600' : 'text-amber-700'}`}>
                {over ? `${tk(diff)} more than the selection` : `${tk(-diff)} less than the selection`}
              </p>
            )}
          </div>
          <div>
            <label className={labelCls}>Interest / late fee paid (Tk)</label>
            <input type="number" min="0" step="0.01" inputMode="decimal" className={inputCls} value={form.interestAmount ?? ''} onChange={set('interestAmount')} placeholder="0" />
            <p className={hintCls}>Booked as "Tax Interest & Penalties" (not deductible).</p>
          </div>
        </div>

        {partial && (
          <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
            <input type="checkbox" className="mt-0.5 rounded border-amber-300" checked={!!form.allowPartial} onChange={set('allowPartial')} />
            <span>
              <span className="font-semibold">Part payment.</span> The oldest deductions are paid first:
              {allocation && ` ${allocation.full} settled in full`}
              {allocation?.part && `; ${allocation.part.entryNo} part-paid ${tk(allocation.part.paid)}, ${tk(allocation.part.left)} left to deposit later`}
              {allocation?.untouched > 0 && `; ${allocation.untouched} not paid by this challan`}.
            </span>
          </label>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div>
            <label className={labelCls}>Bank</label>
            <input className={inputCls} list="tax-deposit-banks" value={form.bank ?? ''} onChange={set('bank')} placeholder="Sonali Bank PLC" />
            <datalist id="tax-deposit-banks">
              {BD_BANKS.map(b => <option key={b} value={b} />)}
            </datalist>
          </div>
          <div>
            <label className={labelCls}>Branch</label>
            <input className={inputCls} value={form.branch ?? ''} onChange={set('branch')} placeholder="Motijheel" />
          </div>
          <div>
            <label className={labelCls}>Treasury account code</label>
            <input className={`${inputCls} font-mono`} value={form.accountCode ?? ''} onChange={set('accountCode')} placeholder={isVat ? '1/1133/0010/0311' : ''} />
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={labelCls}>Notes</label>
            <textarea rows={3} className={inputCls} value={form.notes ?? ''} onChange={set('notes')} maxLength={1000} />
          </div>
          <div>
            <FileUpload value={form.attachment} onUploaded={(url) => setForm(f => ({ ...f, attachment: url }))} label="Challan copy" bucket="tax" />
          </div>
        </div>

        {interest > 0 && (
          <p className="flex items-start gap-1.5 text-xs text-gray-500">
            <Info className="w-3.5 h-3.5 mt-0.5 shrink-0" />
            Total paid from the account: {tk(amount + interest)} ({tk(amount)} tax + {tk(interest)} interest).
          </p>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
      {footer}
    </Modal>
  )
}
