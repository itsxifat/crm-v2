'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CalendarRange, CheckCircle2, Landmark, Loader2, Plus, RotateCcw, Save, Wallet } from 'lucide-react'
import toast from 'react-hot-toast'
import DatePicker from '@/components/ui/DatePicker'
import EmptyState from '@/components/ui/EmptyState'
import { Can } from '@/components/auth/Can'
import { dayKeyLabel } from '@/lib/finance/fiscal'
import { cn } from '@/lib/utils'
import { accountBalanceHint } from '../_lib/meta'
import { round2 } from '../_lib/position'
import { Callout, Guidance, Money, apiFetch, btnGhost, btnPrimary, cardCls, inputCls, labelCls, parseAmount } from './shared'

const MFS_LABELS = { BKASH: 'bKash', NAGAD: 'Nagad', ROCKET: 'Rocket', UPAY: 'Upay', TAP: 'Tap', MCASH: 'mCash', OKWALLET: 'OK Wallet', OTHER: 'Wallet' }

function valueOf(acc, draft, key) {
  const d = draft[acc.id]
  return d && d[key] !== undefined ? d[key] : acc[key]
}

export default function MoneyAccountsStep({ data, canEdit, draft, setDraft, fxDraft, setFxDraft, onSaved }) {
  const [saving, setSaving] = useState(false)
  const [rowErrors, setRowErrors] = useState({})
  const locked = data.openingLocked
  const readOnly = !canEdit || locked
  const goLive = data.goLiveDate
  const accounts = data.moneyAccounts ?? []
  const visible = accounts.filter(a => a.status === 'ACTIVE' || Math.abs(a.openingBalance) >= 0.005 || draft[a.id])
  const hiddenArchived = accounts.length - visible.length

  const dirtyIds = Object.keys(draft)
  const fxDirty = Object.keys(fxDraft).length > 0
  const dirty = dirtyIds.length > 0 || fxDirty

  const totals = useMemo(() => {
    const byCur = {}
    for (const a of visible) {
      const n = parseAmount(valueOf(a, draft, 'openingBalance'))
      if (n === null || Number.isNaN(n)) continue
      byCur[a.currency] = round2((byCur[a.currency] || 0) + n)
    }
    return Object.entries(byCur)
  }, [visible, draft])

  function setField(acc, key, value) {
    setDraft(prev => {
      const cur = { ...(prev[acc.id] ?? {}), [key]: value }
      // Drop the row from the draft when it matches the saved values again.
      const same = ['openingBalance', 'openingDate', 'openingReference'].every(k => {
        if (cur[k] === undefined) return true
        if (k === 'openingBalance') {
          const n = parseAmount(cur[k])
          return n !== null && !Number.isNaN(n) && Math.abs(n - acc.openingBalance) < 0.005
        }
        return (cur[k] || null) === (acc[k] || null)
      })
      const next = { ...prev }
      if (same) delete next[acc.id]
      else next[acc.id] = cur
      return next
    })
    setRowErrors(prev => ({ ...prev, [acc.id]: null }))
  }

  function applyGoLiveToAll() {
    if (!goLive) return
    setDraft(prev => {
      const next = { ...prev }
      for (const a of accounts) {
        if (a.status !== 'ACTIVE') continue
        const cur = { ...(next[a.id] ?? {}) }
        if (a.openingDate === goLive) delete cur.openingDate
        else cur.openingDate = goLive
        if (Object.keys(cur).length) next[a.id] = cur
        else delete next[a.id]
      }
      return next
    })
  }

  function discard() {
    setDraft({})
    setFxDraft({})
    setRowErrors({})
  }

  async function save() {
    const rows = []
    const errs = {}
    for (const id of dirtyIds) {
      const acc = accounts.find(a => a.id === id)
      if (!acc) continue
      const d = draft[id]
      const row = { id }
      if (d.openingBalance !== undefined) {
        const n = parseAmount(d.openingBalance)
        if (n === null || Number.isNaN(n)) { errs[id] = 'Enter a number (0 if empty)'; continue }
        row.openingBalance = round2(n)
      }
      if (d.openingDate !== undefined) row.openingDate = d.openingDate || null
      if (d.openingReference !== undefined) row.openingReference = d.openingReference ?? ''
      rows.push(row)
    }
    const fxRates = {}
    for (const [cur, raw] of Object.entries(fxDraft)) {
      const n = parseAmount(raw)
      if (n !== null && (Number.isNaN(n) || n <= 0)) { toast.error(`${cur}: enter a rate greater than 0`); return }
      fxRates[cur] = n
    }
    if (Object.keys(errs).length) {
      setRowErrors(errs)
      toast.error('Fix the highlighted balances')
      return
    }
    setSaving(true)
    try {
      const json = await apiFetch('/api/finance/opening-balances/money-accounts', {
        method: 'PUT',
        body: { rows, ...(fxDirty ? { fxRates } : {}) },
      })
      toast.success(rows.length ? `Saved ${rows.length} account${rows.length === 1 ? '' : 's'}` : 'Exchange rates saved')
      for (const w of json.warnings ?? []) toast(w, { icon: '⚠️', duration: 7000 })
      discard()
      onSaved?.(json)
    } catch (err) {
      const fe = err.details?.fieldErrors ?? {}
      const mapped = {}
      for (const [k, v] of Object.entries(fe)) {
        const m = /^rows\.(\d+)\./.exec(k)
        if (m && rows[Number(m[1])]) mapped[rows[Number(m[1])].id] = Array.isArray(v) ? v[0] : String(v)
      }
      setRowErrors(mapped)
      toast.error(err.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className={`${cardCls} p-4 sm:p-6 space-y-5`}>
      <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center shrink-0">
            <Landmark className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Step 2 — Money accounts</h2>
            <p className="text-sm text-gray-500">
              {data.asOfDate ? `Balances at the end of ${dayKeyLabel(data.asOfDate)}.` : 'Set the go-live date in step 1 first.'}
            </p>
          </div>
        </div>
        <Can perm="finance.accounts.manage">
          <Link href="/admin/finance/accounts?new=1" className={cn(btnGhost, 'shrink-0')}>
            <Plus className="w-4 h-4" /> Add account
          </Link>
        </Can>
      </div>

      <Guidance
        what="For every bank account, cash box and mobile wallet, the money it held at close of business on the day before go-live."
        where="Bank — the closing balance on your bank statement for that day. bKash/Nagad — the balance in the merchant statement or app. Cash — count the cash box. Loans, overdrafts and card balances are amounts owed: enter them as negative numbers."
      >
        <p>
          <span className="font-medium text-gray-800">Uncleared cheques: </span>
          enter the statement balance here. Record cheques you issued (or deposits) the bank had not yet processed as payments/receipts dated on the go-live day, so you can tick them off when they clear.
        </p>
      </Guidance>

      {locked && (
        <Callout tone="neutral" title="Opening balances are locked">Balances are read-only. A super admin can unlock them in step 5.</Callout>
      )}

      {!accounts.length ? (
        <EmptyState
          icon={Wallet}
          title="No money accounts yet"
          description="Add your bank accounts, cash box and mobile wallets first — then come back to enter what each held at go-live."
          action={<Link href="/admin/finance/accounts?new=1" className={btnPrimary}><Plus className="w-4 h-4" /> Add money accounts</Link>}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-gray-500">
              {visible.length} account{visible.length === 1 ? '' : 's'}
              {hiddenArchived > 0 && ` · ${hiddenArchived} archived account${hiddenArchived === 1 ? '' : 's'} with no opening balance hidden`}
            </p>
            {!readOnly && goLive && (
              <button type="button" className="inline-flex items-center gap-1.5 text-xs font-medium text-gray-700 hover:text-gray-900" onClick={applyGoLiveToAll}>
                <CalendarRange className="w-3.5 h-3.5" /> Use go-live date ({dayKeyLabel(goLive)}) for all
              </button>
            )}
          </div>

          <div className="overflow-x-auto -mx-4 sm:mx-0">
            <table className="w-full min-w-[760px] text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                  <th className="py-2 px-4 sm:px-2 font-semibold">Account</th>
                  <th className="py-2 px-2 font-semibold w-44">Balance date</th>
                  <th className="py-2 px-2 font-semibold w-44 text-right">Opening balance</th>
                  <th className="py-2 px-2 font-semibold w-56">Statement reference</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {visible.map(acc => {
                  const bal = valueOf(acc, draft, 'openingBalance')
                  const date = valueOf(acc, draft, 'openingDate')
                  const ref = valueOf(acc, draft, 'openingReference')
                  const isDirty = !!draft[acc.id]
                  const err = rowErrors[acc.id]
                  const owedType = ['LOAN_OD', 'CARD'].includes(acc.type)
                  return (
                    <tr key={acc.id} className={cn('align-top', isDirty && 'bg-amber-50/40')}>
                      <td className="py-3 px-4 sm:px-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="font-medium text-gray-900">{acc.name}</span>
                          {acc.status === 'ARCHIVED' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-gray-100 text-gray-500">Archived</span>}
                          {acc.currency !== 'BDT' && <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-50 text-indigo-700">{acc.currency}</span>}
                        </div>
                        <p className="text-xs text-gray-500">
                          {acc.typeLabel}
                          {acc.bankName ? ` · ${acc.bankName}` : ''}
                          {acc.mfsProvider ? ` · ${MFS_LABELS[acc.mfsProvider] ?? acc.mfsProvider}` : ''}
                          {acc.last4 ? ` ••${acc.last4}` : ''}
                        </p>
                        {!readOnly && (
                          <p className="text-[11px] text-gray-400 mt-0.5 max-w-xs">{accountBalanceHint(acc.type)}</p>
                        )}
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1">
                          {acc.reconciledCount > 0 && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-emerald-700">
                              <CheckCircle2 className="w-3 h-3" /> Reconciled{acc.lastReconciled ? ` to ${dayKeyLabel(acc.lastReconciled)}` : ''}
                            </span>
                          )}
                          {acc.preOpeningCount > 0 && (
                            <span className="inline-flex items-center gap-1 text-[11px] text-amber-700">
                              <AlertTriangle className="w-3 h-3" /> {acc.preOpeningCount} entr{acc.preOpeningCount === 1 ? 'y' : 'ies'} before the balance date are ignored
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-3 px-2">
                        <DatePicker
                          value={date || null}
                          onChange={v => setField(acc, 'openingDate', v)}
                          disabled={readOnly}
                          size="sm"
                          placeholder="Not set"
                        />
                        {goLive && date && date !== goLive && (
                          <p className="text-[11px] text-amber-700 mt-1">{date < goLive ? 'Before go-live' : 'After go-live (opened later)'}</p>
                        )}
                        {goLive && !date && <p className="text-[11px] text-amber-700 mt-1">Set to {dayKeyLabel(goLive)}</p>}
                      </td>
                      <td className="py-3 px-2">
                        <div className="relative">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">{acc.currency === 'BDT' ? '৳' : acc.currency}</span>
                          <input
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            className={cn(inputCls, 'text-right tabular-nums', acc.currency === 'BDT' ? 'pl-6' : 'pl-11', err && 'border-red-300 focus:ring-red-500')}
                            value={bal ?? ''}
                            disabled={readOnly}
                            onChange={e => setField(acc, 'openingBalance', e.target.value)}
                            aria-label={`Opening balance of ${acc.name}`}
                          />
                        </div>
                        {err && <p className="text-[11px] text-red-600 mt-1">{err}</p>}
                        {!err && owedType && (
                          <p className="text-[11px] text-gray-400 mt-1">Owed? Enter as negative.</p>
                        )}
                      </td>
                      <td className="py-3 px-2">
                        <input
                          type="text"
                          className={inputCls}
                          value={ref ?? ''}
                          maxLength={200}
                          disabled={readOnly}
                          placeholder="e.g. Statement p.4, 30-Sep-2026"
                          onChange={e => setField(acc, 'openingReference', e.target.value)}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              {totals.length > 0 && (
                <tfoot>
                  <tr className="border-t border-gray-100">
                    <td className="py-3 px-4 sm:px-2 text-sm font-semibold text-gray-900" colSpan={2}>Total</td>
                    <td className="py-3 px-2 text-right" colSpan={1}>
                      <div className="space-y-0.5">
                        {totals.map(([cur, v]) => (
                          <div key={cur}><Money value={v} currency={cur} className="text-sm font-semibold tabular-nums" /></div>
                        ))}
                      </div>
                    </td>
                    <td />
                  </tr>
                </tfoot>
              )}
            </table>
          </div>
        </>
      )}

      {data.currencies?.length > 0 && (
        <div className="rounded-lg border border-gray-100 p-3 sm:p-4 space-y-3">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Exchange rates on go-live</h3>
            <p className="text-xs text-gray-500">
              Taka per unit on {data.asOfDate ? dayKeyLabel(data.asOfDate) : 'the day before go-live'} — use your bank&apos;s rate (or Bangladesh Bank&apos;s). Used only to show foreign-currency balances in the position statement.
            </p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {data.currencies.map(cur => {
              const v = fxDraft[cur] !== undefined ? fxDraft[cur] : (data.fxRates?.[cur] ?? '')
              return (
                <div key={cur}>
                  <label className={labelCls} htmlFor={`fx-${cur}`}>1 {cur} = ৳</label>
                  <input
                    id={`fx-${cur}`}
                    type="number"
                    inputMode="decimal"
                    step="0.0001"
                    min="0"
                    className={inputCls}
                    value={v ?? ''}
                    disabled={readOnly}
                    placeholder="e.g. 122.50"
                    onChange={e => setFxDraft(prev => ({ ...prev, [cur]: e.target.value }))}
                  />
                </div>
              )
            })}
          </div>
        </div>
      )}

      {!readOnly && accounts.length > 0 && (
        <div className="flex flex-col-reverse sm:flex-row sm:items-center sm:justify-end gap-2">
          {dirty && <p className="text-xs text-amber-700 sm:mr-auto">Unsaved changes — the position on the right already includes them.</p>}
          <button type="button" className={btnGhost} disabled={!dirty || saving} onClick={discard}>
            <RotateCcw className="w-4 h-4" /> Discard
          </button>
          <button type="button" className={btnPrimary} disabled={!dirty || saving} onClick={save}>
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            Save balances
          </button>
        </div>
      )}
    </div>
  )
}
