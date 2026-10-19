'use client'

import { Plus, Trash2 } from 'lucide-react'
import { inputCls, labelCls, fmtAmount, toNum, round2 } from '../_lib/format'

/** Challan heads: VAT ⇒ Mushak-9.1 note 58, SD (supplementary duty) ⇒ note 59. */
export const CHALLAN_HEADS = [
  { value: 'VAT', label: 'VAT (note 58)' },
  { value: 'SD',  label: 'SD (note 59)' },
]

const headOf = (r) => (r?.head === 'SD' ? 'SD' : 'VAT')

/** Blank treasury challan row. */
export function emptyChallan(accountCode = '', head = 'VAT') {
  return { challanNo: '', date: '', bank: '', branch: '', accountCode, amount: '', head }
}

/** Server challan (Date / ISO date) → editable row. */
export function challanToRow(c) {
  const d = c?.date ? new Date(c.date) : null
  const day = d && !Number.isNaN(d.getTime()) ? new Date(d.getTime() + 6 * 3600 * 1000).toISOString().slice(0, 10) : ''
  return {
    challanNo:   c?.challanNo ?? '',
    date:        day,
    bank:        c?.bank ?? '',
    branch:      c?.branch ?? '',
    accountCode: c?.accountCode ?? '',
    amount:      c?.amount === null || c?.amount === undefined ? '' : String(c.amount),
    head:        headOf(c),
  }
}

/** Rows ready for the API (blank rows dropped). */
export function rowsToPayload(rows) {
  return rows
    .filter(r => String(r.challanNo ?? '').trim() || String(r.amount ?? '').trim())
    .map(r => ({
      challanNo:   String(r.challanNo ?? '').trim() || null,
      date:        r.date || null,
      bank:        String(r.bank ?? '').trim() || null,
      branch:      String(r.branch ?? '').trim() || null,
      accountCode: String(r.accountCode ?? '').trim() || null,
      amount:      r.amount === '' ? null : Number(r.amount),
      head:        headOf(r),
    }))
}

/** First problem in the rows, or null. */
export function challanProblem(rows) {
  for (const [i, r] of rows.entries()) {
    const used = String(r.challanNo ?? '').trim() || String(r.amount ?? '').trim()
    if (!used) continue
    if (String(r.amount ?? '').trim() === '' || !Number.isFinite(Number(r.amount)) || Number(r.amount) < 0) {
      return `Challan ${i + 1}: enter an amount of 0 or more`
    }
    if (!String(r.challanNo ?? '').trim()) return `Challan ${i + 1}: enter the challan / token number`
  }
  return null
}

export function challanTotal(rows) {
  return round2(rows.reduce((s, r) => s + toNum(r.amount), 0))
}

/** Totals per head: { VAT (note 58), SD (note 59) }. */
export function challanTotals(rows) {
  const out = { VAT: 0, SD: 0 }
  for (const r of rows) out[headOf(r)] += toNum(r.amount)
  return { VAT: round2(out.VAT), SD: round2(out.SD) }
}

/**
 * Editable list of treasury challans (Mushak-9.1 notes 58 / 59 sub-form):
 * head (VAT / SD), challan / token no., date, bank, branch, account code, amount.
 * Switching a row's head swaps a default account code for the other head's default.
 */
export default function ChallansEditor({ rows, onChange, defaultAccountCode = '', sdAccountCode = '', disabled = false }) {
  const update = (i, patch) => onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)))
  const remove = (i) => onChange(rows.filter((_, j) => j !== i))
  const add = () => onChange([...rows, emptyChallan(defaultAccountCode)])
  const setHead = (i, head) => {
    const r = rows[i]
    const code = String(r.accountCode ?? '').trim()
    const patch = { head }
    // Only replace an untouched default code — never one the user typed.
    if (['', defaultAccountCode || '', sdAccountCode || ''].includes(code)) {
      patch.accountCode = head === 'SD' ? (sdAccountCode || '') : (defaultAccountCode || '')
    }
    update(i, patch)
  }
  const totals = challanTotals(rows)

  return (
    <div className="space-y-3">
      {rows.length === 0 && (
        <p className="text-sm text-gray-500">No challans entered here. Deposits already recorded in the tax ledger are counted automatically.</p>
      )}
      {rows.map((r, i) => (
        <div key={i} className="border border-gray-100 rounded-lg p-3 bg-gray-50/60">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-semibold text-gray-700">Challan {i + 1}{headOf(r) === 'SD' ? ' · supplementary duty' : ''}</p>
            {!disabled && (
              <button type="button" onClick={() => remove(i)} className="p-1 text-gray-400 hover:text-red-600" aria-label={`Remove challan ${i + 1}`}>
                <Trash2 className="w-4 h-4" />
              </button>
            )}
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div>
              <label className={labelCls}>Paid for</label>
              <select className={inputCls} value={headOf(r)} disabled={disabled} onChange={e => setHead(i, e.target.value)}>
                {CHALLAN_HEADS.map(h => <option key={h.value} value={h.value}>{h.label}</option>)}
              </select>
            </div>
            <div>
              <label className={labelCls}>Challan / token no.</label>
              <input className={inputCls} value={r.challanNo} disabled={disabled} maxLength={60}
                onChange={e => update(i, { challanNo: e.target.value })} placeholder="e.g. 2627-0012345678" />
            </div>
            <div>
              <label className={labelCls}>Date</label>
              <input type="date" className={inputCls} value={r.date} disabled={disabled}
                onChange={e => update(i, { date: e.target.value })} />
            </div>
            <div>
              <label className={labelCls}>Amount (Tk)</label>
              <input type="number" min="0" step="0.01" inputMode="decimal" className={inputCls} value={r.amount} disabled={disabled}
                onChange={e => update(i, { amount: e.target.value })} />
            </div>
            <div>
              <label className={labelCls}>Bank / CGA</label>
              <input className={inputCls} value={r.bank} disabled={disabled} maxLength={120}
                onChange={e => update(i, { bank: e.target.value })} placeholder="e.g. Sonali Bank" />
            </div>
            <div>
              <label className={labelCls}>Branch</label>
              <input className={inputCls} value={r.branch} disabled={disabled} maxLength={120}
                onChange={e => update(i, { branch: e.target.value })} />
            </div>
            <div className="sm:col-span-3">
              <label className={labelCls}>Account code</label>
              <input className={inputCls} value={r.accountCode} disabled={disabled} maxLength={60}
                onChange={e => update(i, { accountCode: e.target.value })}
                placeholder={headOf(r) === 'SD' ? (sdAccountCode || '1/1133/0010/0721') : (defaultAccountCode || '1/1133/0010/0311')} />
            </div>
          </div>
        </div>
      ))}
      {!disabled && (
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <button type="button" onClick={add} className="inline-flex items-center gap-1.5 text-sm font-medium text-gray-700 hover:text-gray-900">
            <Plus className="w-4 h-4" /> Add challan
          </button>
          {rows.length > 0 && (
            <p className="text-xs text-gray-500">
              Entered here: <span className="font-semibold text-gray-800">VAT Tk {fmtAmount(totals.VAT)}</span>
              {totals.SD > 0 && <> · <span className="font-semibold text-gray-800">SD Tk {fmtAmount(totals.SD)}</span></>}
            </p>
          )}
        </div>
      )}
    </div>
  )
}
