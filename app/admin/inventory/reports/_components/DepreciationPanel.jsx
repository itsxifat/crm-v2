'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import {
  TrendingDown, Play, History, Loader2, CheckCircle2, AlertTriangle, RotateCcw, Info, RefreshCw,
} from 'lucide-react'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import { cn } from '@/lib/utils'
import { fmtMoney, fmtTk, fmtPeriod, fmtDay, currentPeriod, shiftPeriod, fetchJson, errorText } from './format'

const inputCls = 'w-full border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900'
const btnPrimary = 'inline-flex items-center justify-center gap-1.5 bg-gray-900 text-white hover:bg-gray-800 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed'
const btnGhost = 'inline-flex items-center justify-center gap-1.5 border border-gray-200 text-gray-700 hover:bg-gray-50 rounded-lg px-3 py-2 text-sm font-medium disabled:opacity-50'

const CONVENTION_LABEL = {
  PRORATA_DAYS: 'Pro-rata by days',
  FULL_MONTH: 'Full month',
}

function RunStatus({ status, interrupted = false }) {
  const posted = status === 'POSTED'
  const posting = status === 'POSTING'
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-medium',
      posted ? 'bg-green-50 text-green-700' : posting ? 'bg-amber-50 text-amber-700' : 'bg-gray-100 text-gray-500')}>
      <span className={cn('w-1.5 h-1.5 rounded-full', posted ? 'bg-green-500' : posting ? 'bg-amber-500' : 'bg-gray-400')} />
      {posted ? 'Posted' : posting ? (interrupted ? 'Interrupted' : 'Posting…') : 'Reversed'}
    </span>
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
    <div className={cn('bg-white border border-gray-100 rounded-xl p-5 flex flex-col', className)}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-purple-50 ring-4 ring-purple-100 flex items-center justify-center shrink-0">
            <TrendingDown className="w-5 h-5 text-purple-600" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-gray-900">Depreciation</h3>
            <p className="text-xs text-gray-500">Monthly book depreciation run</p>
          </div>
        </div>
        <button onClick={load} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-600 hover:bg-gray-100" aria-label="Refresh">
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </button>
      </div>

      {loading && !info ? (
        <div className="py-10 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
      ) : error ? (
        <div className="mt-4 text-sm text-red-600 bg-red-50 rounded-lg p-3">
          {error}
          <button onClick={load} className="ml-2 underline">Retry</button>
        </div>
      ) : info ? (
        <>
          <div className="mt-4 rounded-lg bg-gray-50 p-4">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-gray-500">Next month to post</p>
              {preview?.posted ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-green-700"><CheckCircle2 className="w-3.5 h-3.5" /> Up to date</span>
              ) : status?.due ? (
                <span className="inline-flex items-center gap-1 text-xs font-medium text-amber-700"><AlertTriangle className="w-3.5 h-3.5" /> Due</span>
              ) : (
                <span className="text-xs font-medium text-gray-500">Not yet due</span>
              )}
            </div>
            <p className="mt-1 text-lg font-semibold text-gray-900">{preview?.label ?? fmtPeriod(info.period)}</p>
            <p className="text-sm text-gray-600">
              {fmtTk(preview?.total ?? 0, 2)} across {preview?.assetCount ?? 0} asset{preview?.assetCount === 1 ? '' : 's'}
            </p>
            {inProgressMonth && !preview?.posted && (
              <p className="mt-2 text-xs text-gray-500">This month is still in progress — post it after month end so the charge covers the whole month.</p>
            )}
            {preview?.blockedReason && !preview?.posted && !inProgressMonth && (
              <p className="mt-2 text-xs text-amber-700">{preview.blockedReason}</p>
            )}
          </div>

          <dl className="mt-4 grid grid-cols-2 gap-3 text-xs">
            <div>
              <dt className="text-gray-500">Last run</dt>
              <dd className="mt-0.5 font-medium text-gray-900">
                {lastRun ? `${fmtPeriod(lastRun.period)} · ${fmtTk(lastRun.totalAmount, 0)}` : 'None yet'}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Method</dt>
              <dd className="mt-0.5 font-medium text-gray-900">
                {CONVENTION_LABEL[info.settings?.convention] ?? info.settings?.convention}
                {info.settings?.postToLedger === false && <span className="block text-amber-700 font-normal">Not posted to ledger</span>}
              </dd>
            </div>
          </dl>

          <div className="mt-auto pt-4 flex flex-wrap gap-2">
            <button className={btnPrimary} onClick={() => { setTab('run'); setOpen(true) }}>
              <Play className="w-4 h-4" /> {canRun ? 'Preview & run' : 'Preview'}
            </button>
            <button className={btnGhost} onClick={() => { setTab('history'); setOpen(true) }}>
              <History className="w-4 h-4" /> History
            </button>
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
    </div>
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
      toast.success(`Depreciation for ${preview.label} posted`)
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
    if (reason.trim().length < 5) { toast.error('Give a reason of at least 5 characters'); return }
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
    <Modal open={open} onOpenChange={onOpenChange} title="Book depreciation" description="Preview, post and review monthly depreciation runs" size="xl">
      <div className="flex gap-1 border-b border-gray-100 -mt-1 mb-4">
        {[['run', 'Preview & run'], ['history', 'History']].map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)}
            className={cn('px-3 py-2 text-sm font-medium border-b-2 -mb-px', tab === k ? 'border-gray-900 text-gray-900' : 'border-transparent text-gray-500 hover:text-gray-700')}>
            {l}
          </button>
        ))}
      </div>

      {error && <div className="mb-3 text-sm text-red-600 bg-red-50 rounded-lg p-3">{error}</div>}

      {tab === 'run' ? (
        <div className="space-y-4">
          <div className="flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="sm:w-56">
              <label className="block text-xs font-medium text-gray-600 mb-1">Month</label>
              <select className={inputCls} value={period} onChange={e => setPeriod(e.target.value)}>
                {options.map(p => <option key={p} value={p}>{fmtPeriod(p)}{runs.find(r => r.period === p && r.status === 'POSTED') ? ' — posted' : ''}</option>)}
              </select>
            </div>
            {loading && <Loader2 className="w-4 h-4 animate-spin text-gray-400 mb-3" />}
          </div>

          {preview && (
            <>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Figure label={preview.posted ? 'Posted' : 'To post'} value={fmtTk(preview.total, 2)} />
                <Figure label="Assets" value={preview.assetCount} />
                <Figure label="Catch-up lines" value={catchUps} hint={catchUps ? 'Missed months included' : null} />
                <Figure label="Ledger" value={preview.postToLedger ? 'Non-cash expense' : 'Not posted'} />
              </div>

              {preview.posted && preview.run && (
                <div className="flex items-start gap-2 text-sm text-green-800 bg-green-50 rounded-lg p-3">
                  <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />
                  <div>
                    Posted on {fmtDay(preview.run.createdAt)}{preview.run.notes ? <span className="block text-xs text-green-700 whitespace-pre-line mt-1">{preview.run.notes}</span> : null}
                  </div>
                </div>
              )}
              {!preview.posted && preview.blockedReason && (
                <div className="flex items-start gap-2 text-sm text-amber-800 bg-amber-50 rounded-lg p-3">
                  <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> {preview.blockedReason}
                </div>
              )}
              {!preview.posted && preview.period === currentPeriod() && !preview.blockedReason && (
                <div className="flex items-start gap-2 text-sm text-gray-700 bg-gray-50 rounded-lg p-3">
                  <Info className="w-4 h-4 mt-0.5 shrink-0" /> {preview.label} is still in progress. Posting now charges the full month; usually you post after month end.
                </div>
              )}

              <div className="border border-gray-100 rounded-xl overflow-hidden">
                <div className="overflow-x-auto max-h-[45vh]">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-gray-50">
                      <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                        <th className="px-3 py-2">Tag</th>
                        <th className="px-3 py-2">Asset</th>
                        <th className="px-3 py-2">Months</th>
                        <th className="px-3 py-2 text-right">Amount</th>
                        <th className="px-3 py-2 text-right">Accumulated after</th>
                        <th className="px-3 py-2 text-right">Book value after</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {(preview.lines || []).length === 0 ? (
                        <tr><td colSpan={6} className="px-3 py-8 text-center text-sm text-gray-500">No asset needs depreciation for this month.</td></tr>
                      ) : preview.lines.map(l => (
                        <tr key={l.assetId}>
                          <td className="px-3 py-2 font-mono text-xs whitespace-nowrap">
                            <Link href={`/admin/inventory/assets/${l.assetId}`} className="text-blue-600 hover:underline">{l.tag ?? '—'}</Link>
                          </td>
                          <td className="px-3 py-2 text-gray-700">{l.name}</td>
                          <td className="px-3 py-2 text-xs text-gray-500 whitespace-nowrap">
                            {l.catchUp ? `${fmtPeriod(l.fromPeriod)} – ${preview.label} (${l.months})` : '1'}
                          </td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(l.amount)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-600">{l.accumulatedAfter == null ? '' : fmtMoney(l.accumulatedAfter)}</td>
                          <td className="px-3 py-2 text-right tabular-nums text-gray-600">{l.bookValueAfter == null ? '' : fmtMoney(l.bookValueAfter)}</td>
                        </tr>
                      ))}
                    </tbody>
                    {(preview.lines || []).length > 0 && (
                      <tfoot className="bg-gray-50 font-semibold">
                        <tr>
                          <td className="px-3 py-2" colSpan={3}>Total</td>
                          <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(preview.total)}</td>
                          <td colSpan={2} />
                        </tr>
                      </tfoot>
                    )}
                  </table>
                </div>
              </div>

              {canRun && !preview.posted && preview.canRun && (
                <div>
                  <label className="block text-xs font-medium text-gray-600 mb-1">Note (optional)</label>
                  <input className={inputCls} value={notes} maxLength={500} onChange={e => setNotes(e.target.value)} placeholder="e.g. Month-end close" />
                </div>
              )}
            </>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {runs.length === 0 ? (
            <p className="text-sm text-gray-500 py-8 text-center">No depreciation has been posted yet.</p>
          ) : (
            <div className="border border-gray-100 rounded-xl overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-gray-50">
                  <tr className="text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                    <th className="px-3 py-2">Month</th>
                    <th className="px-3 py-2">Status</th>
                    <th className="px-3 py-2 text-right">Assets</th>
                    <th className="px-3 py-2 text-right">Amount</th>
                    <th className="px-3 py-2">Posted</th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {runs.map(r => (
                    <tr key={r.id} className="align-top">
                      <td className="px-3 py-2 font-medium text-gray-900 whitespace-nowrap">{r.label}</td>
                      <td className="px-3 py-2"><RunStatus status={r.status} interrupted={r.interrupted} /></td>
                      <td className="px-3 py-2 text-right tabular-nums">{r.assetCount}</td>
                      <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.totalAmount)}</td>
                      <td className="px-3 py-2 text-xs text-gray-500">
                        {fmtDay(r.createdAt)} · {r.runByName}
                        {r.status === 'REVERSED' && (
                          <span className="block text-gray-400">Reversed {fmtDay(r.reversedAt)}{r.reversedByName ? ` by ${r.reversedByName}` : ''}{r.reversalReason ? ` — ${r.reversalReason}` : ''}</span>
                        )}
                        {r.status === 'POSTING' && (
                          <span className="block text-amber-700">
                            {r.interrupted ? `Interrupted while posting — run ${r.label} again to recover it` : 'Posting in progress…'}
                          </span>
                        )}
                        {r.notes && r.status !== 'POSTING' && <span className="block text-gray-400 whitespace-pre-line">{r.notes}</span>}
                      </td>
                      <td className="px-3 py-2 text-right">
                        {canRun && latestPosted?.id === r.id && (
                          <button className="inline-flex items-center gap-1 text-xs font-medium text-red-600 hover:text-red-700"
                            onClick={() => { setReverseFor(r); setReason('') }}>
                            <RotateCcw className="w-3.5 h-3.5" /> Reverse
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {reverseFor && (
            <div className="border border-red-100 bg-red-50/50 rounded-xl p-4 space-y-3">
              <p className="text-sm text-gray-800">
                Reverse the <strong>{reverseFor.label}</strong> run ({fmtTk(reverseFor.totalAmount, 2)})? Each asset&apos;s accumulated depreciation goes back to its previous value and a reversing ledger entry is dated the last day of {reverseFor.label}. You can post the month again afterwards.
              </p>
              <div>
                <label className="block text-xs font-medium text-gray-600 mb-1">Reason</label>
                <input className={inputCls} value={reason} maxLength={500} onChange={e => setReason(e.target.value)} placeholder="e.g. Assets were missing from the register when posted" />
              </div>
              <div className="flex justify-end gap-2">
                <button className={btnGhost} onClick={() => setReverseFor(null)} disabled={reversing}>Cancel</button>
                <button className="inline-flex items-center gap-1.5 bg-red-600 text-white hover:bg-red-700 rounded-lg px-4 py-2 text-sm font-medium disabled:opacity-50"
                  onClick={reverse} disabled={reversing || reason.trim().length < 5}>
                  {reversing && <Loader2 className="w-4 h-4 animate-spin" />} Reverse run
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {tab === 'run' && (
        <ModalFooter className="-mx-4 sm:-mx-6 -mb-4 mt-4">
          <button className={btnGhost} onClick={() => onOpenChange(false)}>Close</button>
          {canRun && preview && !preview.posted && (
            <button className={btnPrimary} onClick={post} disabled={posting || loading || !preview.canRun}>
              {posting ? <Loader2 className="w-4 h-4 animate-spin" /> : <Play className="w-4 h-4" />}
              Post {preview.label}
            </button>
          )}
        </ModalFooter>
      )}
    </Modal>
  )
}

function Figure({ label, value, hint }) {
  return (
    <div className="rounded-lg border border-gray-100 p-3">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="mt-0.5 text-sm font-semibold text-gray-900">{value}</p>
      {hint && <p className="text-xs text-gray-400">{hint}</p>}
    </div>
  )
}
