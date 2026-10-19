'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  Loader2, ListChecks, Printer, Undo2, ShieldCheck, Info, Search, Receipt, Percent, X, Save, CheckCircle2, AlertTriangle,
} from 'lucide-react'
import DatePicker from '@/components/ui/DatePicker'
import EmptyState from '@/components/ui/EmptyState'
import FileUpload from '@/components/ui/FileUpload'
import { cn } from '@/lib/utils'
import { dayKeyLabel, taxPeriodOf, addPeriods, periodLastDay } from '@/lib/finance/fiscal'
import { PAYMENT_CHANNEL_LABELS } from '@/lib/finance/constants'
import { invalidateMoneyAccounts } from './MoneyAccountSelect'
import AmountInput from './AmountInput'
import { ConfirmDialog, ReasonDialog, FieldError } from './FinanceDialogs'
import {
  INPUT, LABEL, BTN_PRIMARY, BTN_SECONDARY, formatAmount, formatSigned, fetchJson, todayKey, dayKeyOf,
  parseAmount, plainAmount, round2,
} from './accountTheme'

const STATUS_BADGE = {
  IN_PROGRESS: 'bg-sky-50 text-sky-700',
  COMPLETED: 'bg-emerald-50 text-emerald-700',
  UNDONE: 'bg-gray-100 text-gray-600',
}
const STATUS_LABEL = { IN_PROGRESS: 'In progress', COMPLETED: 'Completed', UNDONE: 'Undone' }
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'in', label: 'Money in' },
  { key: 'out', label: 'Money out' },
  { key: 'open', label: 'Not ticked' },
  { key: 'ticked', label: 'Ticked' },
]

function defaultStatementDate(account) {
  const lastMonthEnd = periodLastDay(addPeriods(taxPeriodOf(todayKey()), -1))
  const last = dayKeyOf(account?.lastReconciledDate)
  return last && last >= lastMonthEnd ? todayKey() : lastMonthEnd
}

/**
 * Bank / wallet reconciliation for one account: start a session (statement date +
 * closing balance), tick the items that appear on the statement, watch the
 * difference in the sticky footer, finish at zero; history with report & undo.
 * Props: account, canReconcile, onChanged() (refresh account), onRecordMovement(kind), refreshKey
 */
export default function ReconcilePanel({ account, canReconcile, onChanged, onRecordMovement, refreshKey = 0 }) {
  const currency = account?.currency ?? 'BDT'
  const cash = account?.type === 'CASH' || account?.type === 'PETTY_CASH'
  const noun = cash ? 'cash count' : 'statement'
  const sessionId = account?.reconciliationInProgress?.id ?? null

  // history
  const [history, setHistory] = useState([])
  const [histLoading, setHistLoading] = useState(true)
  const [histError, setHistError] = useState(null)

  // session
  const [session, setSession] = useState(null)
  const [sessLoading, setSessLoading] = useState(false)
  const [sessError, setSessError] = useState(null)
  const [stmtDate, setStmtDate] = useState('')
  const [stmtBalance, setStmtBalance] = useState('')
  const [notes, setNotes] = useState('')
  const [attachment, setAttachment] = useState('')
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')
  const [pending, setPending] = useState(0)
  const [saving, setSaving] = useState(false)
  const [finishing, setFinishing] = useState(false)
  const toggleSeq = useRef(0)

  // start form
  const [startDate, setStartDate] = useState(() => defaultStatementDate(account))
  const [startBalance, setStartBalance] = useState('')
  const [startNotes, setStartNotes] = useState('')
  const [startAttachment, setStartAttachment] = useState('')
  const [startErrors, setStartErrors] = useState({})
  const [starting, setStarting] = useState(false)

  const [confirmCancel, setConfirmCancel] = useState(false)
  const [undoTarget, setUndoTarget] = useState(null)

  const loadHistory = useCallback(async () => {
    if (!account?.id) return
    setHistLoading(true)
    try {
      const json = await fetchJson(`/api/finance/reconciliations?accountId=${account.id}&limit=50`)
      setHistory(json.data ?? [])
      setHistError(null)
    } catch (err) {
      setHistError(err.message)
    } finally {
      setHistLoading(false)
    }
  }, [account?.id])

  const applySession = useCallback((data) => {
    setSession(data)
    setStmtDate(dayKeyOf(data.reconciliation.statementDate))
    setStmtBalance(plainAmount(data.reconciliation.statementBalance))
    setNotes(data.reconciliation.notes ?? '')
    setAttachment(data.reconciliation.attachmentUrl ?? '')
  }, [])

  const loadSession = useCallback(async (id) => {
    if (!id) { setSession(null); return }
    setSessLoading(true)
    try {
      const json = await fetchJson(`/api/finance/reconciliations/${id}`)
      applySession(json.data)
      setSessError(null)
    } catch (err) {
      setSessError(err.message)
    } finally {
      setSessLoading(false)
    }
  }, [applySession])

  useEffect(() => { loadHistory() }, [loadHistory, refreshKey])
  useEffect(() => { loadSession(sessionId) }, [loadSession, sessionId, refreshKey])
  const lastReconciledKey = dayKeyOf(account?.lastReconciledDate)
  useEffect(() => {
    setStartDate(defaultStatementDate({ lastReconciledDate: lastReconciledKey || null }))
  }, [account?.id, lastReconciledKey])

  const refreshAll = () => {
    invalidateMoneyAccounts()
    onChanged?.()
    loadHistory()
  }

  // ── start ──
  async function start() {
    const e = {}
    if (!startDate) e.statementDate = 'Pick the statement date'
    else if (startDate > todayKey()) e.statementDate = 'The statement date cannot be in the future'
    if (!Number.isFinite(parseAmount(startBalance))) e.statementBalance = `Enter the closing balance on the ${noun}`
    setStartErrors(e)
    if (Object.keys(e).length) return
    setStarting(true)
    try {
      const json = await fetchJson('/api/finance/reconciliations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          accountId: account.id, statementDate: startDate, statementBalance: parseAmount(startBalance),
          notes: startNotes.trim() || null, attachmentUrl: startAttachment || null,
        }),
      })
      toast.success('Reconciliation started — tick the items on the statement')
      setStartBalance(''); setStartNotes(''); setStartAttachment('')
      await loadSession(json.data.id)
      refreshAll()
    } catch (err) {
      const fe = err.details?.fieldErrors ?? {}
      setStartErrors(Object.fromEntries(Object.entries(fe).map(([k, v]) => [k, v?.[0]])))
      toast.error(err.message)
    } finally {
      setStarting(false)
    }
  }

  // ── toggle (optimistic) ──
  async function toggle(ids, cleared) {
    if (!session || !ids.length) return
    const idSet = new Set(ids)
    const before = session.rows
    setSession(s => ({ ...s, rows: s.rows.map(r => (idSet.has(r.id) ? { ...r, cleared } : r)) }))
    const mySeq = ++toggleSeq.current
    setPending(p => p + 1)
    try {
      const json = await fetchJson(`/api/finance/reconciliations/${session.reconciliation.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'toggle', transactionIds: ids, cleared }),
      })
      if (mySeq === toggleSeq.current) {
        setSession(s => ({ ...s, summary: json.data.summary, reconciliation: json.data.reconciliation }))
      }
    } catch (err) {
      setSession(s => ({ ...s, rows: s.rows.map(r => (idSet.has(r.id) ? (before.find(b => b.id === r.id) ?? r) : r)) }))
      toast.error(err.message)
    } finally {
      setPending(p => p - 1)
    }
  }

  const rec = session?.reconciliation
  const summary = session?.summary
  const savedBalance = rec ? round2(rec.statementBalance) : 0
  const typedBalance = parseAmount(stmtBalance)
  const dirty = !!rec && (
    (stmtDate && stmtDate !== dayKeyOf(rec.statementDate))
    || (Number.isFinite(typedBalance) && Math.abs(round2(typedBalance) - savedBalance) > 0.004)
    || (notes.trim() || '') !== (rec.notes ?? '')
    || (attachment || '') !== (rec.attachmentUrl ?? '')
  )
  const liveStatement = Number.isFinite(typedBalance) ? round2(typedBalance) : savedBalance
  const difference = summary ? round2(liveStatement - summary.clearedBalance) : 0
  const balanced = Math.abs(difference) < 0.005

  async function saveDetails({ quiet = false } = {}) {
    if (!rec) return false
    if (!Number.isFinite(typedBalance)) { toast.error(`Enter the ${noun} closing balance`); return false }
    setSaving(true)
    try {
      await fetchJson(`/api/finance/reconciliations/${rec.id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', statementDate: stmtDate, statementBalance: typedBalance, notes: notes.trim() || null, attachmentUrl: attachment || null }),
      })
      await loadSession(rec.id)
      if (!quiet) toast.success('Saved')
      return true
    } catch (err) {
      toast.error(err.message)
      return false
    } finally {
      setSaving(false)
    }
  }

  async function finish() {
    if (!rec) return
    setFinishing(true)
    try {
      if (dirty && !(await saveDetails({ quiet: true }))) return
      await fetchJson(`/api/finance/reconciliations/${rec.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'complete' }),
      })
      toast.success(`${account.name} reconciled to ${dayKeyLabel(stmtDate || rec.statementDate)}`)
      setSession(null)
      refreshAll()
    } catch (err) {
      toast.error(err.message)
      loadSession(rec.id)
    } finally {
      setFinishing(false)
    }
  }

  async function cancelSession() {
    try {
      await fetchJson(`/api/finance/reconciliations/${rec.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'cancel' }),
      })
      toast.success('Reconciliation discarded')
      setConfirmCancel(false)
      setSession(null)
      refreshAll()
    } catch (err) {
      toast.error(err.message)
    }
  }

  async function undo(reason) {
    try {
      await fetchJson(`/api/finance/reconciliations/${undoTarget.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'undo', reason }),
      })
      toast.success('Reconciliation undone — its items are back to “cleared”')
      setUndoTarget(null)
      refreshAll()
    } catch (err) {
      toast.error(err.message)
    }
  }

  const rows = useMemo(() => session?.rows ?? [], [session])
  const visible = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return rows.filter(r => {
      if (filter === 'in' && r.type !== 'INCOME') return false
      if (filter === 'out' && r.type !== 'EXPENSE') return false
      if (filter === 'open' && r.cleared) return false
      if (filter === 'ticked' && !r.cleared) return false
      if (!needle) return true
      return [r.description, r.category, r.reference, r.txnId, r.party, r.counterAccount, r.cheque?.no, plainAmount(r.amount)]
        .some(v => v && String(v).toLowerCase().includes(needle))
    })
  }, [rows, filter, q])
  const visibleOpen = visible.filter(r => !r.cleared)
  const visibleTicked = visible.filter(r => r.cleared)
  const counts = useMemo(() => ({
    in: rows.filter(r => r.type === 'INCOME').length,
    out: rows.filter(r => r.type === 'EXPENSE').length,
    ticked: rows.filter(r => r.cleared).length,
  }), [rows])

  const lastCompleted = history.find(h => h.status === 'COMPLETED')
  // The live session above already shows the in-progress one.
  const pastSessions = history.filter(h => h.status !== 'IN_PROGRESS')

  // ───────────────────────────────── render ─────────────────────────────────
  return (
    <div className="space-y-6">
      {!canReconcile && (
        <p className="flex items-start gap-2 rounded-xl border border-gray-100 bg-white px-4 py-3 text-sm text-gray-600">
          <Info className="w-4 h-4 mt-0.5 shrink-0 text-gray-400" />
          You can view reconciliation history. Reconciling needs the “Reconcile bank/wallet statements” permission.
        </p>
      )}

      {/* Start a session */}
      {canReconcile && !sessionId && !session && (
        <div className="bg-white border border-gray-100 rounded-xl p-5">
          <div className="flex items-start gap-3">
            <span className="w-10 h-10 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center shrink-0"><ListChecks className="w-5 h-5" /></span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold text-gray-900">{cash ? 'Count the cash' : 'Reconcile with a statement'}</h3>
              <p className="text-xs text-gray-500 mt-0.5">
                {cash
                  ? 'Enter the cash you counted and tick the entries it reflects. The difference must be zero to finish.'
                  : `Enter the closing balance from the ${account?.type === 'MFS' ? 'wallet' : 'bank'} statement, then tick each item that appears on it. The difference must be zero to finish.`}
                {lastCompleted && <> Last reconciled to <strong>{dayKeyLabel(lastCompleted.statementDate)}</strong> at {formatAmount(lastCompleted.statementBalance, currency)}.</>}
              </p>
            </div>
          </div>
          <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div>
              <label className={LABEL}>{cash ? 'Count date' : 'Statement end date'} <span className="text-red-500">*</span></label>
              <DatePicker value={startDate || null} onChange={v => setStartDate(v ?? '')} clearable={false} />
              <FieldError message={startErrors.statementDate} />
            </div>
            <div>
              <label className={LABEL}>{cash ? 'Cash counted' : 'Closing balance on statement'} ({currency}) <span className="text-red-500">*</span></label>
              <AmountInput value={startBalance} onChange={setStartBalance} currency={currency} allowNegative error={startErrors.statementBalance} />
              <FieldError message={startErrors.statementBalance} />
            </div>
            <div>
              <label className={LABEL}>Note</label>
              <input value={startNotes} onChange={e => setStartNotes(e.target.value)} placeholder="e.g. Sep 2026 e-statement" className={INPUT} />
            </div>
          </div>
          <div className="mt-3 flex flex-col sm:flex-row sm:items-end gap-3">
            <div className="flex-1"><FileUpload value={startAttachment} onUploaded={setStartAttachment} label={`${cash ? 'Count sheet' : 'Statement'} (optional)`} /></div>
            <button type="button" className={BTN_PRIMARY} onClick={start} disabled={starting}>
              {starting && <Loader2 className="w-4 h-4 animate-spin" />} Start reconciliation
            </button>
          </div>
        </div>
      )}

      {/* Working session */}
      {(sessLoading && !session) && (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-gray-300" /></div>
      )}
      {sessError && !session && (
        <div className="bg-white border border-red-100 rounded-xl p-6 text-center text-sm text-red-600">
          {sessError} <button type="button" onClick={() => loadSession(sessionId)} className="ml-2 underline">Retry</button>
        </div>
      )}
      {session && rec?.status === 'IN_PROGRESS' && (
        <div className="space-y-4">
          {/* Statement details */}
          <div className="bg-white border border-gray-100 rounded-xl p-4">
            <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
              <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2">
                <ListChecks className="w-4 h-4 text-sky-600" /> Reconciliation in progress
                <span className="text-xs font-normal text-gray-400">started {dayKeyLabel(rec.createdAt)}{rec.createdBy ? ` by ${rec.createdBy}` : ''}</span>
              </h3>
              <a href={`/api/finance/reconciliations/${rec.id}/report`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900">
                <Printer className="w-3.5 h-3.5" /> Draft report
              </a>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className={LABEL}>{cash ? 'Count date' : 'Statement end date'}</label>
                <DatePicker value={stmtDate || null} onChange={v => setStmtDate(v ?? '')} clearable={false} disabled={!canReconcile} />
              </div>
              <div>
                <label className={LABEL}>{cash ? 'Cash counted' : 'Closing balance on statement'} ({currency})</label>
                <AmountInput value={stmtBalance} onChange={setStmtBalance} currency={currency} allowNegative disabled={!canReconcile} />
              </div>
              <div>
                <label className={LABEL}>Note</label>
                <input value={notes} onChange={e => setNotes(e.target.value)} disabled={!canReconcile} className={INPUT} />
              </div>
            </div>
            <div className="mt-3 flex flex-col sm:flex-row sm:items-end gap-3">
              <div className="flex-1"><FileUpload value={attachment} onUploaded={setAttachment} label={`${cash ? 'Count sheet' : 'Statement'} (optional)`} /></div>
              {canReconcile && (
                <button type="button" className={BTN_SECONDARY} onClick={() => saveDetails()} disabled={!dirty || saving}>
                  {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save details
                </button>
              )}
            </div>
            {dirty && <p className="mt-2 text-[11px] text-amber-700">Unsaved changes — they are saved automatically when you finish.</p>}
          </div>

          {/* Items */}
          <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
            <div className="flex flex-col lg:flex-row lg:items-center gap-3 px-4 py-3 border-b border-gray-50">
              <div className="flex flex-wrap gap-1.5">
                {FILTERS.map(f => (
                  <button
                    key={f.key}
                    type="button"
                    onClick={() => setFilter(f.key)}
                    className={cn('rounded-full px-3 py-1 text-xs font-medium border', filter === f.key ? 'bg-gray-900 text-white border-gray-900' : 'border-gray-200 text-gray-600 hover:bg-gray-50')}
                  >
                    {f.label}
                    {f.key === 'in' && <span className="ml-1 opacity-60">{counts.in}</span>}
                    {f.key === 'out' && <span className="ml-1 opacity-60">{counts.out}</span>}
                    {f.key === 'ticked' && <span className="ml-1 opacity-60">{counts.ticked}</span>}
                  </button>
                ))}
              </div>
              <div className="relative lg:ml-auto lg:w-64">
                <Search className="w-3.5 h-3.5 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" />
                <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find amount, ref, cheque…" className="w-full border border-gray-200 rounded-lg pl-8 pr-7 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
                {q && <button type="button" onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400" aria-label="Clear"><X className="w-3.5 h-3.5" /></button>}
              </div>
            </div>
            {canReconcile && (
              <div className="flex flex-wrap items-center gap-2 px-4 py-2 border-b border-gray-50 bg-gray-50/50 text-xs">
                <button type="button" disabled={!visibleOpen.length} onClick={() => toggle(visibleOpen.map(r => r.id), true)} className="font-medium text-gray-700 hover:text-gray-900 disabled:opacity-40">Tick all shown ({visibleOpen.length})</button>
                <span className="text-gray-300">|</span>
                <button type="button" disabled={!visibleTicked.length} onClick={() => toggle(visibleTicked.map(r => r.id), false)} className="font-medium text-gray-700 hover:text-gray-900 disabled:opacity-40">Untick shown ({visibleTicked.length})</button>
                {onRecordMovement && (
                  <span className="sm:ml-auto flex flex-wrap gap-2">
                    <button type="button" onClick={() => onRecordMovement('BANK_CHARGE')} className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 py-1 font-medium text-gray-600 hover:bg-gray-50"><Receipt className="w-3.5 h-3.5" /> Add bank charge</button>
                    <button type="button" onClick={() => onRecordMovement('INTEREST_INCOME')} className="inline-flex items-center gap-1 rounded-full border border-gray-200 bg-white px-2.5 py-1 font-medium text-gray-600 hover:bg-gray-50"><Percent className="w-3.5 h-3.5" /> Add interest</button>
                  </span>
                )}
              </div>
            )}

            {rows.length === 0 ? (
              <EmptyState icon={ListChecks} title="Nothing to tick" description={`There are no uncleared entries up to ${dayKeyLabel(rec.statementDate)}. If the ${noun} shows charges or interest, add them above.`} className="py-10" />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm min-w-[640px]">
                  <thead>
                    <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
                      <th className="pl-4 pr-2 py-2 w-10"><span className="sr-only">Cleared</span></th>
                      <th className="px-2 py-2 font-medium w-28">Date</th>
                      <th className="px-2 py-2 font-medium">Details</th>
                      <th className="px-4 py-2 font-medium text-right w-32">In</th>
                      <th className="px-4 py-2 font-medium text-right w-32">Out</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {visible.map(r => (
                      <tr
                        key={r.id}
                        onClick={() => canReconcile && toggle([r.id], !r.cleared)}
                        className={cn('align-top transition-colors', canReconcile && 'cursor-pointer', r.cleared ? 'bg-emerald-50/40 hover:bg-emerald-50/70' : 'hover:bg-gray-50')}
                      >
                        <td className="pl-4 pr-2 py-2.5" onClick={e => e.stopPropagation()}>
                          <input
                            type="checkbox"
                            checked={!!r.cleared}
                            disabled={!canReconcile}
                            onChange={e => toggle([r.id], e.target.checked)}
                            className="w-4 h-4 rounded border-gray-300 accent-emerald-600"
                            aria-label={`Cleared: ${r.description}`}
                          />
                        </td>
                        <td className="px-2 py-2.5 text-gray-600 whitespace-nowrap">{dayKeyLabel(r.date)}</td>
                        <td className="px-2 py-2.5">
                          <p className="text-gray-900">{r.description}</p>
                          <p className="text-[11px] text-gray-500 flex flex-wrap gap-x-2">
                            <span>{r.category}</span>
                            {r.txnId && <span className="font-mono text-gray-400">{r.txnId}</span>}
                            {r.counterAccount && <span>{r.type === 'EXPENSE' ? 'to' : 'from'} {r.counterAccount}</span>}
                            {!r.counterAccount && r.party && <span>{r.party}</span>}
                            {r.cheque?.no && <span>Chq {r.cheque.no}</span>}
                            {r.reference && <span>Ref {r.reference}</span>}
                            {r.channel && <span>{PAYMENT_CHANNEL_LABELS[r.channel] ?? r.channel}</span>}
                          </p>
                        </td>
                        <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap text-emerald-700">{r.type === 'INCOME' ? formatAmount(r.amount, currency) : ''}</td>
                        <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap text-gray-900">{r.type === 'EXPENSE' ? formatAmount(r.amount, currency) : ''}</td>
                      </tr>
                    ))}
                    {visible.length === 0 && (
                      <tr><td colSpan={5} className="px-4 py-8 text-center text-sm text-gray-500">No items match.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
            {(session.laterUncleared > 0 || session.truncated) && (
              <div className="px-4 py-2.5 border-t border-gray-50 text-[11px] text-gray-500 space-y-0.5">
                {session.laterUncleared > 0 && <p>{session.laterUncleared} uncleared item{session.laterUncleared === 1 ? ' is' : 's are'} dated after {dayKeyLabel(rec.statementDate)} and not shown — they belong to the next {noun}.</p>}
                {session.truncated && <p className="text-amber-700">Showing the first {rows.length} of {session.total} items — reconcile in smaller date steps.</p>}
              </div>
            )}
          </div>

          {/* Sticky difference footer */}
          <div className="sticky bottom-0 z-20 -mx-4 sm:-mx-6 px-4 sm:px-6 py-3 bg-white/95 backdrop-blur border-t border-gray-200 shadow-[0_-6px_16px_rgba(15,23,42,0.06)]">
            <div className="flex flex-col xl:flex-row xl:items-center gap-3">
              <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-x-4 gap-y-1.5 flex-1 text-xs">
                <div><p className="text-gray-500">Opening (reconciled)</p><p className="font-semibold tabular-nums text-gray-900">{formatAmount(summary.openingBalance, currency)}</p></div>
                <div><p className="text-gray-500">Ticked in</p><p className="font-semibold tabular-nums text-emerald-700">+{formatAmount(summary.clearedIn ?? 0, currency)}</p></div>
                <div><p className="text-gray-500">Ticked out</p><p className="font-semibold tabular-nums text-gray-900">−{formatAmount(summary.clearedOut ?? 0, currency)}</p></div>
                <div><p className="text-gray-500">Cleared balance</p><p className="font-semibold tabular-nums text-gray-900">{formatAmount(summary.clearedBalance, currency)}</p></div>
                <div><p className="text-gray-500">{cash ? 'Counted' : 'Statement'}{dirty ? ' (unsaved)' : ''}</p><p className="font-semibold tabular-nums text-gray-900">{formatAmount(liveStatement, currency)}</p></div>
                <div className={cn('rounded-lg px-2 py-1 -my-1', balanced ? 'bg-emerald-50' : 'bg-red-50')}>
                  <p className={cn('font-medium flex items-center gap-1', balanced ? 'text-emerald-700' : 'text-red-700')}>
                    {balanced ? <CheckCircle2 className="w-3.5 h-3.5" /> : <AlertTriangle className="w-3.5 h-3.5" />} Difference
                  </p>
                  <p className={cn('text-sm font-bold tabular-nums', balanced ? 'text-emerald-700' : 'text-red-700')}>{balanced ? formatAmount(0, currency) : formatSigned(difference, currency)}</p>
                </div>
              </div>
              {canReconcile && (
                <div className="flex gap-2 xl:shrink-0">
                  <button type="button" className={cn(BTN_SECONDARY, 'flex-1 xl:flex-none')} onClick={() => setConfirmCancel(true)} disabled={finishing}>Discard</button>
                  <button type="button" className={cn(BTN_PRIMARY, 'flex-1 xl:flex-none')} onClick={finish} disabled={!balanced || finishing || pending > 0 || saving}>
                    {(finishing || pending > 0) && <Loader2 className="w-4 h-4 animate-spin" />}
                    <ShieldCheck className="w-4 h-4" /> Finish
                  </button>
                </div>
              )}
            </div>
            {!balanced && (
              <p className="mt-1.5 text-[11px] text-gray-500">
                {difference > 0 ? `The ${noun} shows ${formatAmount(difference, currency)} more than you've ticked — look for unticked receipts or unrecorded interest.` : `You've ticked ${formatAmount(-difference, currency)} more than the ${noun} shows — look for unticked payments, bank charges or items ticked by mistake.`}
              </p>
            )}
          </div>
        </div>
      )}

      {/* History */}
      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        <div className="px-4 py-3 border-b border-gray-50 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-900">Reconciliation history</h3>
          {histLoading && <Loader2 className="w-4 h-4 animate-spin text-gray-300" />}
        </div>
        {histError ? (
          <div className="px-4 py-8 text-center text-sm text-red-600">{histError} <button type="button" onClick={loadHistory} className="ml-2 underline">Retry</button></div>
        ) : !histLoading && pastSessions.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="Not reconciled yet" description={`Reconcile against each ${noun} so the cleared balance here always matches the ${cash ? 'cash in the box' : 'bank'}.`} className="py-10" />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm min-w-[640px]">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
                  <th className="px-4 py-2 font-medium">{cash ? 'Count date' : 'Statement date'}</th>
                  <th className="px-4 py-2 font-medium text-right">Balance</th>
                  <th className="px-4 py-2 font-medium text-right">Items</th>
                  <th className="px-4 py-2 font-medium">Status</th>
                  <th className="px-4 py-2 font-medium">By</th>
                  <th className="px-4 py-2" />
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {pastSessions.map(h => (
                  <tr key={h.id} className="align-top">
                    <td className="px-4 py-2.5 whitespace-nowrap text-gray-800">{dayKeyLabel(h.statementDate)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums whitespace-nowrap font-medium">{formatAmount(h.statementBalance, currency)}</td>
                    <td className="px-4 py-2.5 text-right tabular-nums text-gray-600">{h.itemCount}</td>
                    <td className="px-4 py-2.5">
                      <span className={cn('inline-flex rounded-full px-2 py-0.5 text-[11px] font-semibold', STATUS_BADGE[h.status])}>{STATUS_LABEL[h.status] ?? h.status}</span>
                      {h.status === 'UNDONE' && h.undoReason && <p className="mt-0.5 text-[11px] text-gray-500 max-w-[260px]">“{h.undoReason}”{h.undoneBy ? ` — ${h.undoneBy}` : ''}</p>}
                    </td>
                    <td className="px-4 py-2.5 text-xs text-gray-500 whitespace-nowrap">
                      {h.status === 'COMPLETED' || h.status === 'UNDONE'
                        ? <>{h.completedBy ?? '—'}{h.completedAt ? <span className="block">{dayKeyLabel(h.completedAt)}</span> : null}</>
                        : (h.createdBy ?? '—')}
                    </td>
                    <td className="px-4 py-2.5 text-right whitespace-nowrap">
                      <a href={`/api/finance/reconciliations/${h.id}/report`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-gray-600 hover:text-gray-900">
                        <Printer className="w-3.5 h-3.5" /> Report
                      </a>
                      {canReconcile && h.canUndo && (
                        <button type="button" onClick={() => setUndoTarget(h)} className="ml-3 inline-flex items-center gap-1 text-xs font-medium text-rose-600 hover:text-rose-700">
                          <Undo2 className="w-3.5 h-3.5" /> Undo
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Discard this reconciliation?"
        description="All ticks in this session are cleared and the session is deleted. Nothing in the ledger changes."
        confirmLabel="Discard"
        danger
        onConfirm={cancelSession}
      />
      <ReasonDialog
        open={!!undoTarget}
        onOpenChange={(v) => !v && setUndoTarget(null)}
        title="Undo reconciliation"
        description={undoTarget ? `Re-opens the ${dayKeyLabel(undoTarget.statementDate)} reconciliation. Its ${undoTarget.itemCount} items go back to “cleared” and can be reconciled again.` : ''}
        confirmLabel="Undo reconciliation"
        danger
        placeholder="e.g. Wrong statement balance entered"
        onConfirm={undo}
      />
    </div>
  )
}
