'use client'

import { useEffect, useMemo, useState } from 'react'
import toast from 'react-hot-toast'
import { Landmark, AlertTriangle } from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { Input, Textarea, Field } from '@/components/ui/Input'
import DatePicker from '@/components/ui/DatePicker'
import FileUpload from '@/components/ui/FileUpload'
import MoneyAccountSelect, { invalidateMoneyAccounts } from '@/components/finance/MoneyAccountSelect'
import { BD_BANKS } from '@/lib/finance/constants'
import { CHALLAN_CODES } from '@/lib/tax/catalog'
import {
  tk, fmtDay, todayKey, fetchJson, fmtPeriod, depositBalance, sumBalance,
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
      <Button variant="outline" onClick={() => onOpenChange?.(false)} disabled={saving}>Cancel</Button>
      <Button onClick={submit} loading={saving}>
        {!saving && <Landmark />}
        Record challan
      </Button>
    </ModalFooter>
  )

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={copy.title} description={`Books "${copy.category}" · no effect on profit`} size="lg">
      <div className="space-y-5">
        {!isVat && (
          <div className="rounded-lg border border-gray-200/80">
            <div className="flex items-center justify-between gap-3 border-b border-gray-100 px-3 py-2.5 text-sm">
              <span className="text-muted-foreground">{entries.length} {copy.what} selected</span>
              <span className="font-semibold text-gray-900 tabular-nums">{tk(selectedTotal)}</span>
            </div>
            <ul className="max-h-36 divide-y divide-gray-100 overflow-y-auto text-xs">
              {entries.map(e => (
                <li key={e.id} className="flex items-center justify-between gap-3 px-3 py-2">
                  <span className="min-w-0 truncate text-gray-700">
                    <span className="mr-1.5 font-mono text-gray-400">{e.entryNo}</span>
                    {e.partyName || '—'}{e.section ? <span className="text-gray-400"> · {e.section}</span> : null}
                  </span>
                  <span className="shrink-0 text-muted-foreground">
                    {fmtDay(e.date)} · <span className="font-medium text-gray-900 tabular-nums">{tk(depositBalance(e))}</span>
                    {depositBalance(e) < (Number(e.amount) || 0) - 0.005 && <span className="text-gray-400"> of {tk(e.amount)}</span>}
                  </span>
                </li>
              ))}
            </ul>
            {kind === 'TDS' && payeeTypes.length > 1 && (
              <div className="flex items-start gap-2 border-t border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-800 rounded-b-lg">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                <span>Mixes company ({CHALLAN_CODES.TDS_COMPANY}) and non-company ({CHALLAN_CODES.TDS_NON_COMPANY}) payees — use separate challans if your bank requires it.</span>
              </div>
            )}
          </div>
        )}

        {isVat && (
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Return period from">
              <Input type="month" value={form.returnStart ?? ''} onChange={set('returnStart')} />
            </Field>
            <Field label="Return period to">
              <Input type="month" value={form.returnEnd ?? ''} onChange={set('returnEnd')} />
            </Field>
            <p className="-mt-2 text-xs text-muted-foreground sm:col-span-2">
              {form.returnStart
                ? `Note 58 of the ${form.returnStart === form.returnEnd || !form.returnEnd ? fmtPeriod(form.returnStart) : `${fmtPeriod(form.returnStart)} – ${fmtPeriod(form.returnEnd)}`} Mushak-9.1`
                : 'Empty links it to the last ended return'}
            </p>
          </div>
        )}

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Challan / e-payment no." required>
            <Input value={form.challanNo ?? ''} onChange={set('challanNo')} placeholder="e.g. 2627-0012345678" maxLength={60} />
          </Field>
          <Field label="Challan date" required>
            <DatePicker value={form.date ?? null} onChange={set('date')} clearable={false} />
          </Field>
          <Field label="Paid from account" hint="Required after go-live" className="sm:col-span-2">
            <MoneyAccountSelect value={form.accountId ?? null} onChange={(id) => setForm(f => ({ ...f, accountId: id }))} placeholder="Select account…" />
          </Field>
          <Field
            label={isVat ? 'VAT deposited (Tk)' : 'Tax deposited (Tk)'}
            required
            error={!isVat && over && amount > 0 ? `${tk(diff)} more than the selection` : undefined}
            hint={!isVat && partial ? `${tk(-diff)} less than the selection` : undefined}
          >
            <Input type="number" min="0" step="0.01" inputMode="decimal" value={form.amount ?? ''} onChange={set('amount')} invalid={!isVat && over} className="tabular-nums" />
          </Field>
          <Field label="Interest / late fee (Tk)">
            <Input
              type="number" min="0" step="0.01" inputMode="decimal" value={form.interestAmount ?? ''} onChange={set('interestAmount')} placeholder="0.00"
              title='Booked as "Tax Interest & Penalties" (not deductible)' className="tabular-nums"
            />
          </Field>
        </div>

        {partial && (
          <label className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-[13px] text-amber-800">
            <input type="checkbox" className="mt-0.5 rounded border-amber-300" checked={!!form.allowPartial} onChange={set('allowPartial')} />
            <span>
              <span className="font-medium">Part payment</span> — oldest deductions first:
              {allocation && ` ${allocation.full} settled in full`}
              {allocation?.part && `; ${allocation.part.entryNo} part-paid ${tk(allocation.part.paid)}, ${tk(allocation.part.left)} left`}
              {allocation?.untouched > 0 && `; ${allocation.untouched} not paid by this challan`}.
            </span>
          </label>
        )}

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Bank">
            <Input list="tax-deposit-banks" value={form.bank ?? ''} onChange={set('bank')} placeholder="e.g. Sonali Bank" />
            <datalist id="tax-deposit-banks">
              {BD_BANKS.map(b => <option key={b} value={b} />)}
            </datalist>
          </Field>
          <Field label="Branch">
            <Input value={form.branch ?? ''} onChange={set('branch')} placeholder="e.g. Motijheel" />
          </Field>
          <Field label="Treasury account code">
            <Input className="font-mono" value={form.accountCode ?? ''} onChange={set('accountCode')} placeholder={isVat ? '1/1133/0010/0311' : ''} />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Notes">
            <Textarea rows={3} value={form.notes ?? ''} onChange={set('notes')} maxLength={1000} />
          </Field>
          <div>
            <FileUpload value={form.attachment} onUploaded={(url) => setForm(f => ({ ...f, attachment: url }))} label="Challan copy" bucket="tax" />
          </div>
        </div>

        {interest > 0 && (
          <p className="text-[13px] text-muted-foreground">
            Total from the account: <span className="font-medium text-gray-900 tabular-nums">{tk(amount + interest)}</span> ({tk(amount)} tax + {tk(interest)} interest)
          </p>
        )}

        {error && (
          <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
      {footer}
    </Modal>
  )
}
