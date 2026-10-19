'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { History, Loader2, Lock, LockOpen, RefreshCw, ShieldAlert } from 'lucide-react'
import toast from 'react-hot-toast'
import DatePicker from '@/components/ui/DatePicker'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import { addDays, dayKeyLabel, isDayKey } from '@/lib/finance/fiscal'
import { cn, formatDateTime } from '@/lib/utils'
import { HISTORY_ACTION_LABELS, OPENING_TAX_META } from '../_lib/meta'
import { Callout, apiFetch, btnDanger, btnGhost, btnPrimary, cardCls, inputCls, labelCls } from './shared'

const SETTING_LABELS = {
  goLiveDate: 'Go-live date',
  fiscalYearStartMonth: 'Fiscal year start month',
  lockedUntil: 'Books lock',
  taxLockedUntil: 'Tax lock',
}

function fmtVal(v) {
  if (v === null || v === undefined || v === '') return '—'
  if (typeof v === 'boolean') return v ? 'Yes' : 'No'
  if (typeof v === 'number') return v.toLocaleString('en-BD', { maximumFractionDigits: 2 })
  if (typeof v === 'string' && isDayKey(v)) return dayKeyLabel(v)
  return String(v)
}

const tk = (n) => `৳${Number(n || 0).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

/** One-line plain-English description of an audit row. */
function describe(row) {
  const c = row.changes ?? {}
  if (row.entity === 'FINANCE_SETTINGS') {
    if (c.summary) return c.summary
    if (Array.isArray(c.changes)) {
      const parts = c.changes.slice(0, 4).map(ch => `${SETTING_LABELS[ch.key] ?? ch.key}: ${fmtVal(ch.from)} → ${fmtVal(ch.to)}`)
      if (c.changes.length > 4) parts.push(`+${c.changes.length - 4} more`)
      return `Settings changed — ${parts.join('; ')}`
    }
    return 'Finance settings changed'
  }
  // OPENING_BALANCE
  if (row.action === 'LOCK') return `Opening balances locked${c.equity !== undefined ? ` — opening equity ${tk(c.equity)}` : ''}`
  if (row.action === 'UNLOCK') return 'Opening balances unlocked'
  if (c.kind === 'MONEY_ACCOUNT') {
    const parts = []
    if (c.openingBalance) parts.push(`balance ${fmtVal(c.openingBalance.from)} → ${fmtVal(c.openingBalance.to)}${c.currency && c.currency !== 'BDT' ? ` ${c.currency}` : ''}`)
    if (c.openingDate) parts.push(`date ${fmtVal(c.openingDate.from)} → ${fmtVal(c.openingDate.to)}`)
    if (c.openingReference) parts.push('reference updated')
    return `${c.account ?? 'Account'}: ${parts.join(', ') || 'updated'}`
  }
  if (c.kind === 'FX_RATES') {
    return `Go-live exchange rates: ${(c.changes ?? []).map(x => `${x.currency} ${fmtVal(x.from)} → ${fmtVal(x.to)}`).join(', ')}`
  }
  if (c.kind === 'TAX') {
    const label = OPENING_TAX_META[c.entryType]?.title ?? c.entryType ?? 'Tax balance'
    if (row.action === 'CREATE') return `${label} added${c.amount !== undefined ? ` — ${tk(Number(c.amount) + Number(c.sdAmount || 0))}` : ''}${c.entryNo ? ` (${c.entryNo})` : ''}`
    if (row.action === 'VOID') return `${label} removed${c.entryNo ? ` (${c.entryNo})` : ''}`
    const changed = Object.keys(c).filter(k => !['kind', 'entryNo', 'entryType'].includes(k))
    return `${label} edited${c.entryNo ? ` (${c.entryNo})` : ''}${changed.length ? ` — ${changed.slice(0, 4).join(', ')}` : ''}`
  }
  if (c.kind === 'inventory-opening') {
    const a = c.assets ?? {}
    const s = c.stock ?? {}
    const parts = []
    if (a.count) parts.push(`${a.count} asset${a.count === 1 ? '' : 's'} (book value ${tk(a.bookValue)})`)
    if (a.expensedCount) parts.push(`${a.expensedCount} of them expensed`)
    if (s.count) parts.push(`${s.count} stock item${s.count === 1 ? '' : 's'} (${tk(s.value)})`)
    return `Inventory opening imported${c.asOfDate ? ` as of ${fmtVal(c.asOfDate)}` : ''}${parts.length ? ` — ${parts.join(', ')}` : ''}`
  }
  return HISTORY_ACTION_LABELS[row.action] ?? row.action
}

function LockTile({ title, value, note, tone = 'gray' }) {
  return (
    <div className="rounded-lg border border-gray-100 px-3 py-3">
      <p className="text-[11px] text-gray-500">{title}</p>
      <p className={cn('text-sm font-semibold mt-0.5 flex items-center gap-1.5', tone === 'green' ? 'text-emerald-700' : tone === 'amber' ? 'text-amber-700' : 'text-gray-900')}>
        {tone === 'green' ? <Lock className="w-3.5 h-3.5" /> : <LockOpen className="w-3.5 h-3.5" />}
        {value}
      </p>
      {note && <p className="text-[11px] text-gray-400 mt-0.5">{note}</p>}
    </div>
  )
}

export default function PeriodLockCard({ refreshKey = 0, onChanged }) {
  const [state, setState] = useState(null)
  const [history, setHistory] = useState([])
  const [meta, setMeta] = useState(null)
  const [loading, setLoading] = useState(true)
  const [loadingMore, setLoadingMore] = useState(false)
  const [error, setError] = useState(null)
  const [scope, setScope] = useState('all')
  const [booksDate, setBooksDate] = useState(null)
  const [booksReason, setBooksReason] = useState('')
  const [taxOpen, setTaxOpen] = useState(false)
  const [taxDate, setTaxDate] = useState(null)
  const [taxReason, setTaxReason] = useState('')
  const [busy, setBusy] = useState(null)
  const seq = useRef(0)

  const load = useCallback(async (page = 1) => {
    const my = ++seq.current
    if (page === 1) setLoading(true)
    else setLoadingMore(true)
    setError(null)
    try {
      const json = await apiFetch(`/api/finance/periods?scope=${scope}&page=${page}&limit=20`)
      if (my !== seq.current) return
      const { history: rows, ...rest } = json.data
      setState(rest)
      setMeta(json.meta)
      setHistory(prev => (page === 1 ? rows : [...prev, ...rows]))
      if (page === 1) {
        const suggested = rest.suggestedLockDate && (!rest.lockedUntil || rest.suggestedLockDate > rest.lockedUntil) ? rest.suggestedLockDate : rest.lockedUntil
        setBooksDate(suggested ?? null)
        setTaxDate(rest.taxLockedUntil ?? null)
      }
    } catch (err) {
      if (my === seq.current) setError(err.message)
    } finally {
      if (my === seq.current) { setLoading(false); setLoadingMore(false) }
    }
  }, [scope])

  useEffect(() => { load(1) }, [load, refreshKey])

  async function submit(field, value, reason, key) {
    setBusy(key)
    try {
      const json = await apiFetch('/api/finance/periods', { method: 'POST', body: { [field]: value, reason } })
      if (json.unchanged) toast('Nothing changed', { icon: 'ℹ️' })
      else toast.success(field === 'lockedUntil' ? (value ? `Books locked up to ${dayKeyLabel(value)}` : 'Books lock removed') : (value ? `Tax period locked up to ${dayKeyLabel(value)}` : 'Tax lock removed'))
      for (const w of json.warnings ?? []) toast(w, { icon: '⚠️', duration: 7000 })
      if (field === 'lockedUntil') setBooksReason('')
      else { setTaxReason(''); setTaxOpen(false) }
      await load(1)
      onChanged?.()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(null)
    }
  }

  if (loading && !state) {
    return <div className={`${cardCls} p-6`}><LoadingSpinner /></div>
  }
  if (error && !state) {
    return (
      <div className={`${cardCls} p-6 text-center`}>
        <p className="text-sm text-red-600">{error}</p>
        <button type="button" className={cn(btnGhost, 'mt-3')} onClick={() => load(1)}><RefreshCw className="w-4 h-4" /> Try again</button>
      </div>
    )
  }
  if (!state) return null

  const perms = state.permissions ?? {}
  const booksBack = state.lockedUntil && booksDate && booksDate < state.lockedUntil
  const taxBack = state.taxLockedUntil && (!taxDate || taxDate < state.taxLockedUntil)
  const booksReasonShort = booksBack && booksReason.trim().length < 10
  const lastFiling = state.recentVatFilings?.[0]

  return (
    <div className={`${cardCls} p-4 sm:p-6 space-y-5`}>
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="w-9 h-9 rounded-lg bg-slate-100 text-slate-700 flex items-center justify-center shrink-0">
            <Lock className="w-4 h-4" />
          </div>
          <div>
            <h2 className="text-base font-semibold text-gray-900">Period lock</h2>
            <p className="text-sm text-gray-500">
              Lock months that are closed (reconciled, VAT filed, reported) so no one can add or change entries dated in them.
            </p>
          </div>
        </div>
        <button type="button" className="p-2 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100" onClick={() => load(1)} aria-label="Refresh">
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <LockTile
          title="Books locked up to"
          value={state.lockedUntil ? dayKeyLabel(state.lockedUntil) : 'Open'}
          tone={state.lockedUntil ? 'green' : 'amber'}
          note="Payments, receipts, tax and asset entries dated on/before this day are blocked."
        />
        <LockTile
          title="VAT locked up to"
          value={state.taxLockedUntil ? dayKeyLabel(state.taxLockedUntil) : 'Open'}
          tone={state.taxLockedUntil ? 'green' : 'amber'}
          note={lastFiling ? `Set when a VAT return is filed — last: ${lastFiling.periodKey}${lastFiling.status === 'AMENDED' ? ' (amended)' : ''}` : 'Set automatically when a VAT return is filed.'}
        />
        <LockTile
          title="Opening balances"
          value={state.openingLocked ? 'Locked' : 'Open'}
          tone={state.openingLocked ? 'green' : 'amber'}
          note={state.openingLocked
            ? `${state.openingLockedBy?.name ? `By ${state.openingLockedBy.name}` : 'Locked'}${state.openingLockedAt ? ` · ${formatDateTime(state.openingLockedAt)}` : ''}`
            : (state.goLiveDate ? `Go-live ${dayKeyLabel(state.goLiveDate)}` : 'Go-live not set')}
        />
      </div>

      {perms.canLock ? (
        <div className="rounded-lg border border-gray-100 p-3 sm:p-4 space-y-3">
          <p className="text-sm font-medium text-gray-900">Change the books lock</p>
          <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] gap-3">
            <div>
              <label className={labelCls}>Lock up to and including</label>
              <DatePicker value={booksDate} onChange={setBooksDate} clearable={false} />
              {state.suggestedLockDate && (
                <button type="button" className="text-[11px] text-gray-500 hover:text-gray-900 mt-1" onClick={() => setBooksDate(state.suggestedLockDate)}>
                  End of last month ({dayKeyLabel(state.suggestedLockDate)})
                </button>
              )}
            </div>
            <div>
              <label className={labelCls} htmlFor="books-reason">
                {booksBack
                  ? 'Reason for unlocking (at least 10 characters)'
                  : (state.lockedUntil && perms.canUnlock ? 'Note (removing the lock needs a reason of 10+ characters)' : 'Note (optional)')}
              </label>
              <input id="books-reason" className={inputCls} value={booksReason} maxLength={500} onChange={e => setBooksReason(e.target.value)}
                placeholder={booksBack ? 'e.g. Bank charge for August was missed' : 'e.g. September reconciled and reported'} />
            </div>
          </div>
          {booksBack && (
            <Callout tone="warning" icon={ShieldAlert}>
              This re-opens {dayKeyLabel(addDays(booksDate, 1))} – {dayKeyLabel(state.lockedUntil)}. Only a super admin can unlock, and the reason is kept in the history.
            </Callout>
          )}
          {state.goLiveDate && !state.openingLocked && booksDate && booksDate >= addDays(state.goLiveDate, -1) && !booksBack && (
            <Callout tone="info">Opening balances are still open. Locking the books does not lock them — use step 5 for that.</Callout>
          )}
          <div className="flex flex-col sm:flex-row sm:justify-end gap-2">
            {state.lockedUntil && perms.canUnlock && (
              <button
                type="button"
                className={btnGhost}
                disabled={!!busy || booksReason.trim().length < 10}
                title={booksReason.trim().length < 10 ? 'Enter a reason of at least 10 characters' : undefined}
                onClick={() => submit('lockedUntil', null, booksReason, 'books-clear')}
              >
                {busy === 'books-clear' ? <Loader2 className="w-4 h-4 animate-spin" /> : <LockOpen className="w-4 h-4" />} Remove lock
              </button>
            )}
            <button
              type="button"
              className={booksBack ? btnDanger : btnPrimary}
              disabled={!!busy || !booksDate || booksDate === state.lockedUntil || (booksBack && (!perms.canUnlock || booksReasonShort))}
              onClick={() => submit('lockedUntil', booksDate, booksReason, 'books')}
            >
              {busy === 'books' ? <Loader2 className="w-4 h-4 animate-spin" /> : booksBack ? <LockOpen className="w-4 h-4" /> : <Lock className="w-4 h-4" />}
              {booksBack ? `Unlock back to ${booksDate ? dayKeyLabel(booksDate) : ''}` : 'Lock books'}
            </button>
          </div>
          {booksBack && !perms.canUnlock && <p className="text-xs text-red-600 text-right">Only a super admin can move the lock back.</p>}

          <div className="border-t border-gray-100 pt-3">
            {!taxOpen ? (
              <button type="button" className="text-xs font-medium text-gray-600 hover:text-gray-900" onClick={() => setTaxOpen(true)}>
                Change the VAT lock manually…
              </button>
            ) : (
              <div className="space-y-3">
                <p className="text-sm font-medium text-gray-900">VAT lock</p>
                <p className="text-xs text-gray-500">Normally moved by filing a VAT return. Move it back only to correct a filed period (then file an amended return).</p>
                <div className="grid grid-cols-1 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)] gap-3">
                  <div>
                    <label className={labelCls}>VAT locked up to</label>
                    <DatePicker value={taxDate} onChange={setTaxDate} />
                  </div>
                  <div>
                    <label className={labelCls} htmlFor="tax-reason">{taxBack ? 'Reason (at least 10 characters)' : 'Note (optional)'}</label>
                    <input id="tax-reason" className={inputCls} value={taxReason} maxLength={500} onChange={e => setTaxReason(e.target.value)} />
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row sm:justify-end gap-2">
                  <button type="button" className={btnGhost} onClick={() => { setTaxOpen(false); setTaxDate(state.taxLockedUntil ?? null); setTaxReason('') }}>Cancel</button>
                  <button
                    type="button"
                    className={taxBack ? btnDanger : btnPrimary}
                    disabled={!!busy || (taxDate ?? null) === (state.taxLockedUntil ?? null) || (taxBack && (!perms.canUnlock || taxReason.trim().length < 10))}
                    onClick={() => submit('taxLockedUntil', taxDate ?? null, taxReason, 'tax')}
                  >
                    {busy === 'tax' && <Loader2 className="w-4 h-4 animate-spin" />}
                    {taxBack ? 'Unlock VAT period' : 'Save VAT lock'}
                  </button>
                </div>
                {taxBack && !perms.canUnlock && <p className="text-xs text-red-600 text-right">Only a super admin can move the VAT lock back.</p>}
              </div>
            )}
          </div>
        </div>
      ) : (
        <p className="text-xs text-gray-500">You can view the locks. Changing them needs the “Lock / unlock accounting periods” permission.</p>
      )}

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2 mb-2">
          <h3 className="text-sm font-semibold text-gray-900 flex items-center gap-2"><History className="w-4 h-4 text-gray-400" /> History</h3>
          <div className="inline-flex rounded-lg border border-gray-200 p-0.5 text-xs">
            {[['all', 'All changes'], ['locks', 'Locks only']].map(([k, l]) => (
              <button key={k} type="button" onClick={() => setScope(k)}
                className={cn('px-2.5 py-1 rounded-md font-medium', scope === k ? 'bg-gray-900 text-white' : 'text-gray-600 hover:text-gray-900')}>
                {l}
              </button>
            ))}
          </div>
        </div>
        {history.length === 0 ? (
          <p className="text-sm text-gray-400 py-4 text-center">No changes recorded yet.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400 border-b border-gray-100">
                  <th className="py-2 pr-2 font-semibold w-40">When</th>
                  <th className="py-2 px-2 font-semibold w-36">Who</th>
                  <th className="py-2 px-2 font-semibold">What changed</th>
                  <th className="py-2 pl-2 font-semibold w-56">Reason</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {history.map(row => (
                  <tr key={row.id} className="align-top">
                    <td className="py-2 pr-2 text-xs text-gray-500 whitespace-nowrap">{formatDateTime(row.at)}</td>
                    <td className="py-2 px-2 text-xs text-gray-700">{row.user?.name ?? '—'}</td>
                    <td className="py-2 px-2 text-sm text-gray-800">
                      <span className={cn(
                        'inline-block mr-1.5 text-[10px] px-1.5 py-0.5 rounded font-medium align-middle',
                        row.action === 'UNLOCK' ? 'bg-red-50 text-red-700' : row.action === 'LOCK' ? 'bg-emerald-50 text-emerald-700' : 'bg-gray-100 text-gray-600',
                      )}>
                        {HISTORY_ACTION_LABELS[row.action] ?? row.action}
                      </span>
                      {describe(row)}
                    </td>
                    <td className="py-2 pl-2 text-xs text-gray-500">{row.changes?.reason || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {meta && meta.page < meta.pages && (
          <div className="flex justify-center mt-3">
            <button type="button" className={btnGhost} disabled={loadingMore} onClick={() => load(meta.page + 1)}>
              {loadingMore && <Loader2 className="w-4 h-4 animate-spin" />} Load more
            </button>
          </div>
        )}
        <p className="text-[11px] text-gray-400 mt-2">Activity history is kept for about a year.</p>
      </div>
    </div>
  )
}
