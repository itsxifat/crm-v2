'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { AlertTriangle, CalendarRange, CheckCircle2, Plus, RotateCcw, Save, Wallet } from 'lucide-react'
import toast from 'react-hot-toast'
import DatePicker from '@/components/ui/DatePicker'
import EmptyState from '@/components/ui/EmptyState'
import Badge from '@/components/ui/Badge'
import Button, { buttonVariants } from '@/components/ui/Button'
import { Card, CardDescription, CardTitle } from '@/components/ui/Card'
import { Label } from '@/components/ui/Input'
import { Table, TableBody, TableCell, TableFooter, TableHead, TableHeader, TableRow } from '@/components/ui/Table'
import { Can } from '@/components/auth/Can'
import { dayKeyLabel } from '@/lib/finance/fiscal'
import { cn } from '@/lib/utils'
import { accountBalanceHint } from '../_lib/meta'
import { round2 } from '../_lib/position'
import { Callout, Guidance, Money, apiFetch, inputCls, parseAmount } from './shared'

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
      for (const w of json.warnings ?? []) toast(w, { icon: <AlertTriangle className="size-4 shrink-0 text-amber-600" />, duration: 7000 })
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
    <Card className="space-y-5 p-5 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <CardTitle as="h2">Money accounts</CardTitle>
          <CardDescription>
            {data.asOfDate ? `Balances at end of ${dayKeyLabel(data.asOfDate)}` : 'Set the go-live date first.'}
          </CardDescription>
        </div>
        <Can perm="finance.accounts.manage">
          <Link href="/admin/finance/accounts?new=1" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            <Plus /> New account
          </Link>
        </Can>
      </div>

      <Guidance
        what="What each bank account, cash box and mobile wallet held at close of business the day before go-live."
        where="Bank or wallet statement closing balance; count the cash box. Loans, overdrafts and cards are owed — enter them as negative."
      >
        <p>
          <span className="font-medium text-gray-800">Uncleared cheques: </span>
          enter the statement balance, then record unprocessed items as entries dated on the go-live day.
        </p>
      </Guidance>

      {locked && (
        <Callout tone="neutral" title="Opening balances are locked">Only a super admin can unlock them (step 5).</Callout>
      )}

      {!accounts.length ? (
        <EmptyState
          icon={Wallet}
          title="No money accounts yet"
          description="Add accounts, then enter their go-live balances."
          action={<Link href="/admin/finance/accounts?new=1" className={buttonVariants()}><Plus /> New account</Link>}
        />
      ) : (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[13px] text-muted-foreground">
              {visible.length} account{visible.length === 1 ? '' : 's'}
              {hiddenArchived > 0 && ` · ${hiddenArchived} empty archived hidden`}
            </p>
            {!readOnly && goLive && (
              <Button variant="ghost" size="xs" onClick={applyGoLiveToAll}>
                <CalendarRange /> Use {dayKeyLabel(goLive)} for all
              </Button>
            )}
          </div>

          <div className="overflow-hidden rounded-lg border border-gray-200/80">
            <Table className="min-w-[760px]">
              <TableHeader>
                <TableRow>
                  <TableHead>Account</TableHead>
                  <TableHead className="w-44 px-2">Balance date</TableHead>
                  <TableHead className="w-44 px-2 text-right">Opening balance</TableHead>
                  <TableHead className="w-56 px-2 pr-4">Statement reference</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {visible.map(acc => {
                  const bal = valueOf(acc, draft, 'openingBalance')
                  const date = valueOf(acc, draft, 'openingDate')
                  const ref = valueOf(acc, draft, 'openingReference')
                  const isDirty = !!draft[acc.id]
                  const err = rowErrors[acc.id]
                  const owedType = ['LOAN_OD', 'CARD'].includes(acc.type)
                  return (
                    <TableRow key={acc.id} className={cn('align-top', isDirty && 'bg-amber-50/40 hover:bg-amber-50/60')}>
                      <TableCell className="align-top">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium text-gray-900">{acc.name}</span>
                          {acc.status === 'ARCHIVED' && <Badge>Archived</Badge>}
                          {acc.currency !== 'BDT' && <Badge variant="outline">{acc.currency}</Badge>}
                        </div>
                        <p className="mt-0.5 text-xs text-muted-foreground">
                          {acc.typeLabel}
                          {acc.bankName ? ` · ${acc.bankName}` : ''}
                          {acc.mfsProvider ? ` · ${MFS_LABELS[acc.mfsProvider] ?? acc.mfsProvider}` : ''}
                          {acc.last4 ? ` ••${acc.last4}` : ''}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5">
                          {acc.reconciledCount > 0 && (
                            <span className="inline-flex items-center gap-1 text-xs text-emerald-700">
                              <CheckCircle2 className="size-3.5" /> Reconciled{acc.lastReconciled ? ` to ${dayKeyLabel(acc.lastReconciled)}` : ''}
                            </span>
                          )}
                          {acc.preOpeningCount > 0 && (
                            <span className="inline-flex items-center gap-1 text-xs text-amber-700">
                              <AlertTriangle className="size-3.5" /> {acc.preOpeningCount} entr{acc.preOpeningCount === 1 ? 'y' : 'ies'} before the balance date ignored
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="px-2 align-top">
                        <DatePicker
                          value={date || null}
                          onChange={v => setField(acc, 'openingDate', v)}
                          disabled={readOnly}
                          size="sm"
                          placeholder="Not set"
                        />
                        {goLive && date && date !== goLive && (
                          <p className="mt-1 text-xs text-amber-700">{date < goLive ? 'Before go-live' : 'After go-live (opened later)'}</p>
                        )}
                        {goLive && !date && <p className="mt-1 text-xs text-amber-700">Set to {dayKeyLabel(goLive)}</p>}
                      </TableCell>
                      <TableCell className="px-2 align-top">
                        <div className="relative">
                          <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-xs text-gray-400">{acc.currency === 'BDT' ? '৳' : acc.currency}</span>
                          <input
                            type="number"
                            inputMode="decimal"
                            step="0.01"
                            className={cn(inputCls, 'h-8 text-right tabular-nums', acc.currency === 'BDT' ? 'pl-6' : 'pl-11')}
                            aria-invalid={err ? true : undefined}
                            value={bal ?? ''}
                            disabled={readOnly}
                            title={readOnly ? undefined : accountBalanceHint(acc.type)}
                            onChange={e => setField(acc, 'openingBalance', e.target.value)}
                            aria-label={`Opening balance of ${acc.name}`}
                          />
                        </div>
                        {err && <p className="mt-1 text-xs text-red-600">{err}</p>}
                        {!err && owedType && (
                          <p className="mt-1 text-xs text-muted-foreground">Owed? Enter as negative.</p>
                        )}
                      </TableCell>
                      <TableCell className="px-2 pr-4 align-top">
                        <input
                          type="text"
                          className={cn(inputCls, 'h-8')}
                          value={ref ?? ''}
                          maxLength={200}
                          disabled={readOnly}
                          placeholder="e.g. Statement p.4"
                          onChange={e => setField(acc, 'openingReference', e.target.value)}
                        />
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
              {totals.length > 0 && (
                <TableFooter>
                  <TableRow className="hover:bg-transparent">
                    <TableCell className="font-semibold text-gray-900" colSpan={2}>Total</TableCell>
                    <TableCell className="px-2 text-right" colSpan={1}>
                      <div className="space-y-0.5">
                        {totals.map(([cur, v]) => (
                          <div key={cur}><Money value={v} currency={cur} className="text-sm font-semibold tabular-nums text-gray-900" /></div>
                        ))}
                      </div>
                    </TableCell>
                    <TableCell />
                  </TableRow>
                </TableFooter>
              )}
            </Table>
          </div>
        </>
      )}

      {data.currencies?.length > 0 && (
        <div className="space-y-3 rounded-lg bg-gray-50 p-4">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Exchange rates at go-live</h3>
            <p
              className="mt-0.5 text-xs text-muted-foreground"
              title="Use your bank's rate (or Bangladesh Bank's). Only used to show foreign-currency balances in the position."
            >
              Taka per unit on {data.asOfDate ? dayKeyLabel(data.asOfDate) : 'the day before go-live'}
            </p>
          </div>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {data.currencies.map(cur => {
              const v = fxDraft[cur] !== undefined ? fxDraft[cur] : (data.fxRates?.[cur] ?? '')
              return (
                <div key={cur}>
                  <Label htmlFor={`fx-${cur}`}>1 {cur} = ৳</Label>
                  <input
                    id={`fx-${cur}`}
                    type="number"
                    inputMode="decimal"
                    step="0.0001"
                    min="0"
                    className={inputCls}
                    value={v ?? ''}
                    disabled={readOnly}
                    placeholder="0.00"
                    onChange={e => setFxDraft(prev => ({ ...prev, [cur]: e.target.value }))}
                  />
                </div>
              )
            })}
          </div>
        </div>
      )}

      {!readOnly && accounts.length > 0 && (
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:items-center sm:justify-end">
          {dirty && <p className="text-xs text-amber-700 sm:mr-auto">Unsaved changes</p>}
          <Button variant="outline" disabled={!dirty || saving} onClick={discard}>
            <RotateCcw /> Discard
          </Button>
          <Button loading={saving} disabled={!dirty} onClick={save}>
            {!saving && <Save />}
            Save balances
          </Button>
        </div>
      )}
    </Card>
  )
}
