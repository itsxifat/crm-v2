'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import {
  Play, History, Loader2, CheckCircle2, AlertTriangle, RotateCcw, Info, RefreshCw,
} from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Tabs from '@/components/ui/Tabs'
import { Card, CardTitle } from '@/components/ui/Card'
import { Input, NativeSelect, Field } from '@/components/ui/Input'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { cn } from '@/lib/utils'
import { fmtMoney, fmtTk, fmtPeriod, fmtDay, currentPeriod, shiftPeriod, fetchJson, errorText } from './format'

const CONVENTION_LABEL = {
  PRORATA_DAYS: 'Pro-rata by days',
  FULL_MONTH: 'Full month',
}

function RunStatus({ status, interrupted = false }) {
  const posted = status === 'POSTED'
  const posting = status === 'POSTING'
  return (
    <Badge variant={posted ? 'success' : posting ? 'warning' : 'default'} dot>
      {posted ? 'Posted' : posting ? (interrupted ? 'Interrupted' : 'Posting…') : 'Reversed'}
    </Badge>
  )
}

/**
 * Dashboard card for monthly book depreciation: next due month with a
 * preview total, last run, and a modal to preview / post / review / reverse runs.
 */
export default function DepreciationPanel({ canRun = false, onChanged, className }) {
  const [info, setInfo] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState('run')

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const json = await fetchJson('/api/inventory/depreciation?lines=0')
      setInfo(json.data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const status = info?.status
  const preview = info?.preview
  const lastRun = status?.lastRun
  const inProgressMonth = preview && preview.period === currentPeriod()

  const afterChange = () => {
    load()
    onChanged?.()
  }

  return (
    <Card className={cn('flex flex-col p-5', className)}>
      <div className="flex items-center justify-between gap-3">
        <CardTitle>Depreciation</CardTitle>
        <Button variant="ghost" size="icon-xs" onClick={load} aria-label="Refresh" className="-mr-1 text-gray-400">
          <RefreshCw className={cn(loading && 'animate-spin')} />
        </Button>
      </div>

      {loading && !info ? (
        <div className="flex justify-center py-10"><Loader2 className="size-5 animate-spin text-gray-400" /></div>
      ) : error ? (
        <div className="mt-4 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">
          {error}
          <button type="button" onClick={load} className="ml-2 font-medium underline underline-offset-4">Retry</button>
        </div>
      ) : info ? (
        <>
          <div className="mt-4 rounded-lg bg-gray-50 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs text-muted-foreground">Next month to post</p>
              {preview?.posted ? (
                <Badge variant="success" dot>Up to date</Badge>
              ) : status?.due ? (
                <Badge variant="warning" dot>Due</Badge>
              ) : (
                <Badge>Not yet due</Badge>
              )}
            </div>
            <p className="mt-1 text-lg font-semibold tracking-tight text-gray-900">{preview?.label ?? fmtPeriod(info.period)}</p>
            <p className="text-sm text-gray-600 tabular-nums">
              {fmtTk(preview?.total ?? 0, 2)} · {preview?.assetCount ?? 0} asset{preview?.assetCount === 1 ? '' : 's'}
            </p>
            {inProgressMonth && !preview?.posted && (
              <p className="mt-2 text-xs text-muted-foreground">Month in progress — post after month end.</p>
            )}
            {preview?.blockedReason && !preview?.posted && !inProgressMonth && (
              <p className="mt-2 text-xs text-amber-700">{preview.blockedReason}</p>
            )}
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
            <div>
              <dt className="text-muted-foreground">Last run</dt>
              <dd className="mt-0.5 font-medium text-gray-900">
                {lastRun ? `${fmtPeriod(lastRun.period)} · ${fmtTk(lastRun.totalAmount, 0)}` : 'None yet'}
              </dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Method</dt>
              <dd className="mt-0.5 font-medium text-gray-900">
                {CONVENTION_LABEL[info.settings?.convention] ?? info.settings?.convention}
                {info.settings?.postToLedger === false && <span className="block font-normal text-amber-700">Not posted to ledger</span>}
              </dd>
            </div>
          </dl>

          <div className="mt-auto flex flex-wrap gap-2 pt-4">
            <Button size="sm" onClick={() => { setTab('run'); setOpen(true) }}>
              <Play /> {canRun ? 'Preview & run' : 'Preview'}
            </Button>
            <Button size="sm" variant="outline" onClick={() => { setTab('history'); setOpen(true) }}>
              <History /> History
            </Button>
          </div>
        </>
      ) : null}

      {open && (
        <DepreciationModal
          open={open}
          onOpenChange={setOpen}
          tab={tab}
          setTab={setTab}
          canRun={canRun}
          initialPeriod={info?.period}
          onChanged={afterChange}
        />
      )}
    </Card>
  )
}

function periodOptions(runs, extra) {
  const cur = currentPeriod()
  const set = new Set()
  for (let i = 0; i < 36; i++) set.add(shiftPeriod(cur, -i))
  for (const r of runs || []) set.add(r.period)
  if (extra) set.add(extra)
  return [...set].sort().reverse()
}

function DepreciationModal({ open, onOpenChange, tab, setTab, canRun, initialPeriod, onChanged }) {
  const [period, setPeriod] = useState(initialPeriod || shiftPeriod(currentPeriod(), -1))
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [notes, setNotes] = useState('')
  const [posting, setPosting] = useState(false)
  const [reverseFor, setReverseFor] = useState(null)
  const [reason, setReason] = useState('')
  const [reversing, setReversing] = useState(false)

  const load = useCallback(async (p) => {
    setLoading(true)
    setError(null)
    try {
      const json = await fetchJson(`/api/inventory/depreciation?period=${encodeURIComponent(p)}`)
      setData(json.data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { if (open) load(period) }, [open, period, load])

  const preview = data?.preview
  const runs = useMemo(() => data?.runs ?? [], [data])
  const latestPosted = runs.find(r => r.status === 'POSTED') ?? null
  const options = useMemo(() => periodOptions(runs, period), [runs, period])
  const catchUps = (preview?.lines || []).filter(l => l.catchUp).length

  async function post() {
    if (!preview) return
    const msg = preview.total > 0
      ? `Post depreciation of ${fmtTk(preview.total, 2)} for ${preview.label}?${data?.settings?.postToLedger !== false ? ` A non-cash expense dated the last day of ${preview.label} is added to the ledger.` : ''}`
      : `Nothing to depreciate for ${preview.label}. Record the month as done anyway?`
    if (!window.confirm(msg)) return
    setPosting(true)
    try {
      await fetchJson('/api/inventory/depreciation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'run', period, notes: notes.trim() || null }),
      })
      toast.success(`${preview.label} depreciation posted`)
      setNotes('')
      await load(period)
      onChanged?.()
    } catch (err) {
      toast.error(errorText(err))
    } finally {
      setPosting(false)
    }
  }

  async function reverse() {
    if (!reverseFor) return
    if (reason.trim().length < 5) { toast.error('Reason must be at least 5 characters'); return }
    setReversing(true)
    try {
      await fetchJson('/api/inventory/depreciation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reverse', period: reverseFor.period, reason: reason.trim() }),
      })
      toast.success(`${reverseFor.label} run reversed`)
      setReverseFor(null)
      setReason('')
      await load(period)
      onChanged?.()
    } catch (err) {
      toast.error(errorText(err))
    } finally {
      setReversing(false)
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="Book depreciation" size="xl">
      <Tabs
        variant="underline"
        value={tab}
        onChange={setTab}
        className="mb-4"
        tabs={[{ value: 'run', label: 'Preview & run' }, { value: 'history', label: 'History' }]}
      />

      {error && <div className="mb-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-sm text-red-700">{error}</div>}

      {tab === 'run' ? (
        <div className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
            <Field label="Month" className="sm:w-56">
              <NativeSelect value={period} onChange={e => setPeriod(e.target.value)}>
                {options.map(p => <option key={p} value={p}>{fmtPeriod(p)}{runs.find(r => r.period === p && r.status === 'POSTED') ? ' — posted' : ''}</option>)}
              </NativeSelect>
            </Field>
            {loading && <Loader2 className="mb-2.5 size-4 animate-spin text-gray-400" />}
          </div>

          {preview && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Figure label={preview.posted ? 'Posted' : 'To post'} value={fmtTk(preview.total, 2)} />
                <Figure label="Assets" value={preview.assetCount} />
                <Figure label="Catch-up lines" value={catchUps} hint={catchUps ? 'Includes missed months' : null} />
                <Figure label="Ledger" value={preview.postToLedger ? 'Non-cash expense' : 'Not posted'} />
              </div>

              {preview.posted && preview.run && (
                <div className="flex items-start gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0" />
                  <div>
                    Posted on {fmtDay(preview.run.createdAt)}{preview.run.notes ? <span className="mt-1 block whitespace-pre-line text-xs text-emerald-700">{preview.run.notes}</span> : null}
                  </div>
                </div>
              )}
              {!preview.posted && preview.blockedReason && (
                <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
                  <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {preview.blockedReason}
                </div>
              )}
              {!preview.posted && preview.period === currentPeriod() && !preview.blockedReason && (
                <div className="flex items-start gap-2 rounded-lg border border-gray-200/80 bg-gray-50 px-3 py-2.5 text-sm text-gray-700">
                  <Info className="mt-0.5 size-4 shrink-0 text-gray-500" /> {preview.label} is still in progress — posting now charges the full month.
                </div>
              )}

              <div className="overflow-hidden rounded-lg border border-gray-200/80">
                <Table wrapperClassName="max-h-[45vh] overflow-y-auto">
                  <TableHeader className="sticky top-0 z-[1] bg-white">
                    <TableRow>
                      <TableHead>Tag</TableHead>
                      <TableHead>Asset</TableHead>
                      <TableHead>Months</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead className="text-right">Accumulated after</TableHead>
                      <TableHead className="text-right">Book value after</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {(preview.lines || []).length === 0 ? (
                      <tr><td colSpan={6} className="px-4 py-8 text-center text-sm text-muted-foreground">Nothing to depreciate this month</td></tr>
                    ) : preview.lines.map(l => (
                      <TableRow key={l.assetId}>
                        <TableCell className="whitespace-nowrap py-2.5 font-mono text-xs">
                          <Link href={`/admin/inventory/assets/${l.assetId}`} className="font-medium text-gray-900 underline-offset-4 hover:underline">{l.tag ?? '—'}</Link>
                        </TableCell>
                        <TableCell className="py-2.5">{l.name}</TableCell>
                        <TableCell className="whitespace-nowrap py-2.5 text-xs text-muted-foreground">
                          {l.catchUp ? `${fmtPeriod(l.fromPeriod)} – ${preview.label} (${l.months})` : '1'}
                        </TableCell>
                        <TableCell className="py-2.5 text-right tabular-nums">{fmtMoney(l.amount)}</TableCell>
                        <TableCell className="py-2.5 text-right tabular-nums text-gray-600">{l.accumulatedAfter == null ? '' : fmtMoney(l.accumulatedAfter)}</TableCell>
                        <TableCell className="py-2.5 text-right tabular-nums text-gray-600">{l.bookValueAfter == null ? '' : fmtMoney(l.bookValueAfter)}</TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                  {(preview.lines || []).length > 0 && (
                    <tfoot className="border-t border-gray-200 bg-gray-50/60 font-semibold text-gray-900">
                      <tr>
                        <td className="px-4 py-2.5" colSpan={3}>Total</td>
                        <td className="px-4 py-2.5 text-right tabular-nums">{fmtMoney(preview.total)}</td>
                        <td colSpan={2} />
                      </tr>
                    </tfoot>
                  )}
                </Table>
              </div>

              {canRun && !preview.posted && preview.canRun && (
                <Field label="Note">
                  <Input value={notes} maxLength={500} onChange={e => setNotes(e.target.value)} placeholder="Optional" />
                </Field>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {runs.length === 0 ? (
            <p className="py-8 text-center text-sm text-muted-foreground">No runs yet</p>
          ) : (
            <div className="overflow-hidden rounded-lg border border-gray-200/80">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Month</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Assets</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Posted</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map(r => (
                    <TableRow key={r.id} className="align-top">
                      <TableCell className="whitespace-nowrap font-medium text-gray-900">{r.label}</TableCell>
                      <TableCell><RunStatus status={r.status} interrupted={r.interrupted} /></TableCell>
                      <TableCell className="text-right tabular-nums">{r.assetCount}</TableCell>
                      <TableCell className="text-right tabular-nums">{fmtMoney(r.totalAmount)}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {fmtDay(r.createdAt)} · {r.runByName}
                        {r.status === 'REVERSED' && (
                          <span className="block text-gray-400">Reversed {fmtDay(r.reversedAt)}{r.reversedByName ? ` by ${r.reversedByName}` : ''}{r.reversalReason ? ` — ${r.reversalReason}` : ''}</span>
                        )}
                        {r.status === 'POSTING' && (
                          <span className="block text-amber-700">
                            {r.interrupted ? `Interrupted — run ${r.label} again to recover it` : 'Posting in progress…'}
                          </span>
                        )}
                        {r.notes && r.status !== 'POSTING' && <span className="block whitespace-pre-line text-gray-400">{r.notes}</span>}
                      </TableCell>
                      <TableCell className="text-right">
                        {canRun && latestPosted?.id === r.id && (
                          <Button variant="ghost" size="xs" className="text-red-600 hover:bg-red-50 hover:text-red-700"
                            onClick={() => { setReverseFor(r); setReason('') }}>
                            <RotateCcw className="size-3.5" /> Reverse
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          {reverseFor && (
            <div className="space-y-3 rounded-lg border border-red-200 bg-red-50/60 p-4">
              <p className="text-sm text-gray-800">
                Reverse the <strong className="font-semibold">{reverseFor.label}</strong> run ({fmtTk(reverseFor.totalAmount, 2)})? Depreciation is restored and a reversing ledger entry is dated the last day of {reverseFor.label}.
              </p>
              <Field label="Reason" required>
                <Input value={reason} maxLength={500} onChange={e => setReason(e.target.value)} placeholder="At least 5 characters" />
              </Field>
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setReverseFor(null)} disabled={reversing}>Cancel</Button>
                <Button variant="destructive" size="sm" onClick={reverse} loading={reversing} disabled={reason.trim().length < 5}>
                  Reverse run
                </Button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'run' && (
        <ModalFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
          {canRun && preview && !preview.posted && (
            <Button onClick={post} loading={posting} disabled={loading || !preview.canRun}>
              {!posting && <Play />}
              Post {preview.label}
            </Button>
          )}
        </ModalFooter>
      )}
    </Modal>
  )
}

function Figure({ label, value, hint }) {
  return (
    <div className="rounded-lg border border-gray-200/80 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-sm font-semibold tabular-nums text-gray-900">{value}</p>
      {hint && <p className="text-xs text-gray-400">{hint}</p>}
    </div>
  )
}
