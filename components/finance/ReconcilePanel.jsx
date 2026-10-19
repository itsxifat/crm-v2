'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import {
  Loader2, ListChecks, Printer, Undo2, ShieldCheck, Info, Search, Receipt, Percent, X, Save, CheckCircle2, AlertTriangle,
} from 'lucide-react'
import DatePicker from '@/components/ui/DatePicker'
import EmptyState from '@/components/ui/EmptyState'
import FileUpload from '@/components/ui/FileUpload'
import Button, { buttonVariants } from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import Tabs from '@/components/ui/Tabs'
import { Card, CardTitle } from '@/components/ui/Card'
import { Input, Label } from '@/components/ui/Input'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { cn } from '@/lib/utils'
import { dayKeyLabel, taxPeriodOf, addPeriods, periodLastDay } from '@/lib/finance/fiscal'
import { PAYMENT_CHANNEL_LABELS } from '@/lib/finance/constants'
import { invalidateMoneyAccounts } from './MoneyAccountSelect'
import AmountInput from './AmountInput'
import { ConfirmDialog, ReasonDialog, FieldError } from './FinanceDialogs'
import {
  formatAmount, formatSigned, fetchJson, todayKey, dayKeyOf, parseAmount, plainAmount, round2,
} from './accountTheme'

/** Badge variant per reconciliation status. */
const STATUS_BADGE = {
  IN_PROGRESS: 'primary',
  COMPLETED: 'success',
  UNDONE: 'default',
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
      toast.success('Reconciliation started')
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
      toast.success('Reconciliation undone')
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
        <p className="flex items-start gap-2 rounded-lg border border-gray-200/80 bg-gray-50 px-3 py-2.5 text-sm text-gray-600">
          <Info className="mt-0.5 size-4 shrink-0 text-gray-400" />
          View only — reconciling needs the “Reconcile bank/wallet statements” permission.
        </p>
      )}

      {/* Start a session */}
      {canReconcile && !sessionId && !session && (
        <Card className="p-5">
          <h3 className="text-sm font-semibold text-gray-900">{cash ? 'Count the cash' : 'Reconcile with a statement'}</h3>
          <p className="mt-1 text-[13px] text-muted-foreground">
            {cash
              ? 'Enter the cash counted, then tick the entries it reflects.'
              : `Enter the ${account?.type === 'MFS' ? 'wallet' : 'bank'} statement's closing balance, then tick each item on it.`}
            {lastCompleted && <> Last reconciled to <span className="font-medium text-gray-900">{dayKeyLabel(lastCompleted.statementDate)}</span> at {formatAmount(lastCompleted.statementBalance, currency)}.</>}
          </p>
          <div className="mt-5 grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Label required>{cash ? 'Count date' : 'Statement end date'}</Label>
              <DatePicker value={startDate || null} onChange={v => setStartDate(v ?? '')} clearable={false} />
              <FieldError message={startErrors.statementDate} />
            </div>
            <div>
              <Label required>{cash ? 'Cash counted' : 'Closing balance on statement'} ({currency})</Label>
              <AmountInput value={startBalance} onChange={setStartBalance} currency={currency} allowNegative error={startErrors.statementBalance} />
              <FieldError message={startErrors.statementBalance} />
            </div>
            <div>
              <Label>Note</Label>
              <Input value={startNotes} onChange={e => setStartNotes(e.target.value)} placeholder="e.g. Sep 2026 e-statement" />
            </div>
          </div>
          <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
            <div className="flex-1"><FileUpload value={startAttachment} onUploaded={setStartAttachment} label={`${cash ? 'Count sheet' : 'Statement'} (optional)`} /></div>
            <Button onClick={start} loading={starting}>
              {!starting && <ListChecks />} Start reconciliation
            </Button>
          </div>
        </Card>
      )}

      {/* Working session */}
      {(sessLoading && !session) && (
        <div className="flex justify-center py-10"><Loader2 className="size-5 animate-spin text-gray-300" /></div>
      )}
      {sessError && !session && (
        <Card className="p-6 text-center text-sm text-red-600">
          {sessError} <button type="button" onClick={() => loadSession(sessionId)} className="ml-2 font-medium underline underline-offset-4">Retry</button>
        </Card>
      )}
      {session && rec?.status === 'IN_PROGRESS' && (
        <div className="space-y-4">
          {/* Statement details */}
          <Card className="p-5">
            <div className="mb-4 flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="text-sm font-semibold text-gray-900">Reconciliation</h3>
                  <Badge variant="primary" dot>In progress</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Started {dayKeyLabel(rec.createdAt)}{rec.createdBy ? ` by ${rec.createdBy}` : ''}</p>
              </div>
              <a
                href={`/api/finance/reconciliations/${rec.id}/report`}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonVariants({ variant: 'ghost', size: 'sm' })}
              >
                <Printer /> Draft report
              </a>
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <div>
                <Label>{cash ? 'Count date' : 'Statement end date'}</Label>
                <DatePicker value={stmtDate || null} onChange={v => setStmtDate(v ?? '')} clearable={false} disabled={!canReconcile} />
              </div>
              <div>
                <Label>{cash ? 'Cash counted' : 'Closing balance on statement'} ({currency})</Label>
                <AmountInput value={stmtBalance} onChange={setStmtBalance} currency={currency} allowNegative disabled={!canReconcile} />
              </div>
              <div>
                <Label>Note</Label>
                <Input value={notes} onChange={e => setNotes(e.target.value)} disabled={!canReconcile} />
              </div>
            </div>
            <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
              <div className="flex-1"><FileUpload value={attachment} onUploaded={setAttachment} label={`${cash ? 'Count sheet' : 'Statement'} (optional)`} /></div>
              {canReconcile && (
                <Button variant="outline" onClick={() => saveDetails()} loading={saving} disabled={!dirty}>
                  {!saving && <Save />} Save details
                </Button>
              )}
            </div>
            {dirty && <p className="mt-2 text-xs text-amber-700">Unsaved changes — saved automatically when you finish.</p>}
          </Card>

          {/* Items */}
          <Card className="overflow-hidden">
            <div className="flex flex-col gap-2 border-b border-gray-100 p-3 lg:flex-row lg:items-center">
              <Tabs
                size="sm"
                value={filter}
                onChange={setFilter}
                tabs={FILTERS.map(f => ({
                  value: f.key,
                  label: f.label,
                  count: f.key === 'in' ? counts.in : f.key === 'out' ? counts.out : f.key === 'ticked' ? counts.ticked : undefined,
                }))}
              />
              <div className="relative lg:ml-auto lg:w-64">
                <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
                <Input value={q} onChange={e => setQ(e.target.value)} placeholder="Amount, ref, cheque…" className="h-8 pl-8 pr-8 text-[13px]" />
                {q && (
                  <button type="button" onClick={() => setQ('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-700" aria-label="Clear">
                    <X className="size-3.5" />
                  </button>
                )}
              </div>
            </div>
            {canReconcile && (
              <div className="flex flex-wrap items-center gap-1 border-b border-gray-100 bg-gray-50/60 px-3 py-1.5">
                <Button variant="ghost" size="xs" disabled={!visibleOpen.length} onClick={() => toggle(visibleOpen.map(r => r.id), true)}>
                  Tick all shown ({visibleOpen.length})
                </Button>
                <Button variant="ghost" size="xs" disabled={!visibleTicked.length} onClick={() => toggle(visibleTicked.map(r => r.id), false)}>
                  Untick shown ({visibleTicked.length})
                </Button>
                {onRecordMovement && (
                  <span className="flex flex-wrap gap-1.5 sm:ml-auto">
                    <Button variant="outline" size="xs" onClick={() => onRecordMovement('BANK_CHARGE')}><Receipt /> Add bank charge</Button>
                    <Button variant="outline" size="xs" onClick={() => onRecordMovement('INTEREST_INCOME')}><Percent /> Add interest</Button>
                  </span>
                )}
              </div>
            )}

            {rows.length === 0 ? (
              <EmptyState icon={ListChecks} title="Nothing to tick" description={`No uncleared entries up to ${dayKeyLabel(rec.statementDate)}.`} className="py-10" />
            ) : (
              <Table className="min-w-[640px]">
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10 pl-4 pr-2"><span className="sr-only">Cleared</span></TableHead>
                    <TableHead className="w-28 px-2">Date</TableHead>
                    <TableHead className="px-2">Details</TableHead>
                    <TableHead className="w-32 text-right">In</TableHead>
                    <TableHead className="w-32 text-right">Out</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visible.map(r => (
                    <TableRow
                      key={r.id}
                      onClick={() => canReconcile && toggle([r.id], !r.cleared)}
                      className={cn('align-top', canReconcile && 'cursor-pointer', r.cleared ? 'bg-emerald-50/40 hover:bg-emerald-50/70' : '')}
                    >
                      <TableCell className="pl-4 pr-2" onClick={e => e.stopPropagation()}>
                        <input
                          type="checkbox"
                          checked={!!r.cleared}
                          disabled={!canReconcile}
                          onChange={e => toggle([r.id], e.target.checked)}
                          className="size-4 rounded"
                          aria-label={`Cleared: ${r.description}`}
                        />
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-2 text-gray-600">{dayKeyLabel(r.date)}</TableCell>
                      <TableCell className="px-2">
                        <p className="text-gray-900">{r.description}</p>
                        <p className="mt-0.5 flex flex-wrap gap-x-2 text-xs text-muted-foreground">
                          <span>{r.category}</span>
                          {r.txnId && <span className="font-mono text-gray-400">{r.txnId}</span>}
                          {r.counterAccount && <span>{r.type === 'EXPENSE' ? 'to' : 'from'} {r.counterAccount}</span>}
                          {!r.counterAccount && r.party && <span>{r.party}</span>}
                          {r.cheque?.no && <span>Chq {r.cheque.no}</span>}
                          {r.reference && <span>Ref {r.reference}</span>}
                          {r.channel && <span>{PAYMENT_CHANNEL_LABELS[r.channel] ?? r.channel}</span>}
                        </p>
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums text-emerald-700">{r.type === 'INCOME' ? formatAmount(r.amount, currency) : ''}</TableCell>
                      <TableCell className="whitespace-nowrap text-right tabular-nums text-gray-900">{r.type === 'EXPENSE' ? formatAmount(r.amount, currency) : ''}</TableCell>
                    </TableRow>
                  ))}
                  {visible.length === 0 && (
                    <TableRow className="hover:bg-transparent">
                      <TableCell colSpan={5} className="py-8 text-center text-sm text-muted-foreground">No results</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            )}
            {(session.laterUncleared > 0 || session.truncated) && (
              <div className="space-y-0.5 border-t border-gray-100 px-4 py-2.5 text-xs text-muted-foreground">
                {session.laterUncleared > 0 && <p>{session.laterUncleared} uncleared item{session.laterUncleared === 1 ? '' : 's'} after {dayKeyLabel(rec.statementDate)} hidden — they belong to the next {noun}.</p>}
                {session.truncated && <p className="text-amber-700">Showing the first {rows.length} of {session.total} items — reconcile in smaller date steps.</p>}
              </div>
            )}
          </Card>

          {/* Sticky difference footer (bleeds to the page padding: p-4 sm:p-6 lg:p-8) */}
          <div className="sticky bottom-0 z-20 -mx-4 border-t border-gray-200/80 bg-white/95 px-4 py-3 backdrop-blur sm:-mx-6 sm:px-6 lg:-mx-8 lg:px-8">
            <div className="flex flex-col gap-3 xl:flex-row xl:items-center">
              <div className="grid flex-1 grid-cols-2 gap-x-4 gap-y-2 text-xs sm:grid-cols-3 lg:grid-cols-6">
                <div><p className="text-muted-foreground">Opening (reconciled)</p><p className="font-semibold tabular-nums text-gray-900">{formatAmount(summary.openingBalance, currency)}</p></div>
                <div><p className="text-muted-foreground">Ticked in</p><p className="font-semibold tabular-nums text-emerald-700">+{formatAmount(summary.clearedIn ?? 0, currency)}</p></div>
                <div><p className="text-muted-foreground">Ticked out</p><p className="font-semibold tabular-nums text-gray-900">−{formatAmount(summary.clearedOut ?? 0, currency)}</p></div>
                <div><p className="text-muted-foreground">Cleared balance</p><p className="font-semibold tabular-nums text-gray-900">{formatAmount(summary.clearedBalance, currency)}</p></div>
                <div><p className="text-muted-foreground">{cash ? 'Counted' : 'Statement'}{dirty ? ' (unsaved)' : ''}</p><p className="font-semibold tabular-nums text-gray-900">{formatAmount(liveStatement, currency)}</p></div>
                <div className={cn('-my-1 rounded-lg px-2 py-1 ring-1 ring-inset', balanced ? 'bg-emerald-50 ring-emerald-600/15' : 'bg-red-50 ring-red-600/15')}>
                  <p className={cn('flex items-center gap-1 font-medium', balanced ? 'text-emerald-700' : 'text-red-700')}>
                    {balanced ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />} Difference
                  </p>
                  <p className={cn('text-sm font-semibold tabular-nums', balanced ? 'text-emerald-700' : 'text-red-700')}>{balanced ? formatAmount(0, currency) : formatSigned(difference, currency)}</p>
                </div>
              </div>
              {canReconcile && (
                <div className="flex gap-2 xl:shrink-0">
                  <Button variant="outline" className="flex-1 xl:flex-none" onClick={() => setConfirmCancel(true)} disabled={finishing}>Discard</Button>
                  <Button className="flex-1 xl:flex-none" onClick={finish} loading={finishing || pending > 0} disabled={!balanced || saving}>
                    {!(finishing || pending > 0) && <ShieldCheck />} Finish
                  </Button>
                </div>
              )}
            </div>
            {!balanced && (
              <p className="mt-2 text-xs text-muted-foreground">
                {difference > 0
                  ? `The ${noun} shows ${formatAmount(difference, currency)} more than ticked — check for unticked receipts or unrecorded interest.`
                  : `You've ticked ${formatAmount(-difference, currency)} more than the ${noun} — check for unticked payments, bank charges or wrong ticks.`}
              </p>
            )}
          </div>
        </div>
      )}

      {/* History */}
      <Card className="overflow-hidden">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-3.5">
          <CardTitle>Reconciliation history</CardTitle>
          {histLoading && <Loader2 className="size-4 animate-spin text-gray-300" />}
        </div>
        {histError ? (
          <div className="px-4 py-8 text-center text-sm text-red-600">
            {histError} <button type="button" onClick={loadHistory} className="ml-2 font-medium underline underline-offset-4">Retry</button>
          </div>
        ) : !histLoading && pastSessions.length === 0 ? (
          <EmptyState icon={ShieldCheck} title="Not reconciled yet" className="py-10" />
        ) : (
          <Table className="min-w-[640px]">
            <TableHeader>
              <TableRow>
                <TableHead className="pl-5">{cash ? 'Count date' : 'Statement date'}</TableHead>
                <TableHead className="text-right">Balance</TableHead>
                <TableHead className="text-right">Items</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>By</TableHead>
                <TableHead><span className="sr-only">Actions</span></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {pastSessions.map(h => (
                <TableRow key={h.id} className="align-top">
                  <TableCell className="whitespace-nowrap pl-5 text-gray-900">{dayKeyLabel(h.statementDate)}</TableCell>
                  <TableCell className="whitespace-nowrap text-right font-medium tabular-nums text-gray-900">{formatAmount(h.statementBalance, currency)}</TableCell>
                  <TableCell className="text-right tabular-nums text-gray-600">{h.itemCount}</TableCell>
                  <TableCell>
                    <Badge variant={STATUS_BADGE[h.status] ?? 'default'}>{STATUS_LABEL[h.status] ?? h.status}</Badge>
                    {h.status === 'UNDONE' && h.undoReason && <p className="mt-1 max-w-[260px] text-xs text-muted-foreground">“{h.undoReason}”{h.undoneBy ? ` — ${h.undoneBy}` : ''}</p>}
                  </TableCell>
                  <TableCell className="whitespace-nowrap text-xs text-muted-foreground">
                    {h.status === 'COMPLETED' || h.status === 'UNDONE'
                      ? <>{h.completedBy ?? '—'}{h.completedAt ? <span className="block">{dayKeyLabel(h.completedAt)}</span> : null}</>
                      : (h.createdBy ?? '—')}
                  </TableCell>
                  <TableCell className="whitespace-nowrap py-2 text-right">
                    <div className="inline-flex items-center gap-1">
                      <a
                        href={`/api/finance/reconciliations/${h.id}/report`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className={buttonVariants({ variant: 'ghost', size: 'xs' })}
                      >
                        <Printer className="size-3.5" /> Report
                      </a>
                      {canReconcile && h.canUndo && (
                        <Button variant="ghost" size="xs" onClick={() => setUndoTarget(h)} className="text-red-600 hover:bg-red-50 hover:text-red-700">
                          <Undo2 className="size-3.5" /> Undo
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <ConfirmDialog
        open={confirmCancel}
        onOpenChange={setConfirmCancel}
        title="Discard this reconciliation?"
        description="Deletes this session and its ticks. The ledger isn't changed."
        confirmLabel="Discard"
        danger
        onConfirm={cancelSession}
      />
      <ReasonDialog
        open={!!undoTarget}
        onOpenChange={(v) => !v && setUndoTarget(null)}
        title="Undo reconciliation"
        description={undoTarget ? `Re-opens the ${dayKeyLabel(undoTarget.statementDate)} reconciliation; its ${undoTarget.itemCount} items go back to “cleared”.` : ''}
        confirmLabel="Undo reconciliation"
        danger
        placeholder="e.g. Wrong statement balance entered"
        onConfirm={undo}
      />
    </div>
  )
}
