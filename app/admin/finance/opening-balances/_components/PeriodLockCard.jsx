'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, Info, Lock, LockOpen, RefreshCw, ShieldAlert } from 'lucide-react'
import toast from 'react-hot-toast'
import DatePicker from '@/components/ui/DatePicker'
import LoadingSpinner from '@/components/ui/LoadingSpinner'
import Badge from '@/components/ui/Badge'
import Button from '@/components/ui/Button'
import { Card, CardTitle } from '@/components/ui/Card'
import { Input, Label } from '@/components/ui/Input'
import Tabs from '@/components/ui/Tabs'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/Table'
import { addDays, dayKeyLabel, isDayKey } from '@/lib/finance/fiscal'
import { cn, formatDateTime } from '@/lib/utils'
import { HISTORY_ACTION_LABELS, OPENING_TAX_META } from '../_lib/meta'
import { Callout, apiFetch } from './shared'

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
    <div className="rounded-lg bg-gray-50 px-3 py-3">
      <p className="text-xs text-muted-foreground">{title}</p>
      <p className={cn('mt-0.5 flex items-center gap-1.5 text-sm font-semibold', tone === 'green' ? 'text-emerald-700' : tone === 'amber' ? 'text-amber-700' : 'text-gray-900')}>
        {tone === 'green' ? <Lock className="size-3.5" /> : <LockOpen className="size-3.5" />}
        {value}
      </p>
      {note && <p className="mt-0.5 text-xs text-muted-foreground">{note}</p>}
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
      if (json.unchanged) toast('Nothing changed', { icon: <Info className="size-4 shrink-0 text-blue-600" /> })
      else toast.success(field === 'lockedUntil' ? (value ? `Books locked up to ${dayKeyLabel(value)}` : 'Books lock removed') : (value ? `Tax period locked up to ${dayKeyLabel(value)}` : 'Tax lock removed'))
      for (const w of json.warnings ?? []) toast(w, { icon: <AlertTriangle className="size-4 shrink-0 text-amber-600" />, duration: 7000 })
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
    return <Card className="p-6"><LoadingSpinner /></Card>
  }
  if (error && !state) {
    return (
      <Card className="p-6 text-center">
        <p className="text-sm text-red-600">{error}</p>
        <Button variant="outline" size="sm" className="mt-3" onClick={() => load(1)}><RefreshCw /> Try again</Button>
      </Card>
    )
  }
  if (!state) return null

  const perms = state.permissions ?? {}
  const booksBack = state.lockedUntil && booksDate && booksDate < state.lockedUntil
  const taxBack = state.taxLockedUntil && (!taxDate || taxDate < state.taxLockedUntil)
  const booksReasonShort = booksBack && booksReason.trim().length < 10
  const lastFiling = state.recentVatFilings?.[0]

  return (
    <Card className="space-y-5 p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <CardTitle as="h2">Period lock</CardTitle>
        <Button variant="ghost" size="icon-sm" className="-my-1.5 text-gray-500" onClick={() => load(1)} aria-label="Refresh">
          <RefreshCw className={cn(loading && 'animate-spin')} />
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <LockTile
          title="Books locked to"
          value={state.lockedUntil ? dayKeyLabel(state.lockedUntil) : 'Open'}
          tone={state.lockedUntil ? 'green' : 'amber'}
          note="Entries on or before it are blocked"
        />
        <LockTile
          title="VAT locked to"
          value={state.taxLockedUntil ? dayKeyLabel(state.taxLockedUntil) : 'Open'}
          tone={state.taxLockedUntil ? 'green' : 'amber'}
          note={lastFiling ? `Set by VAT filing — last ${lastFiling.periodKey}${lastFiling.status === 'AMENDED' ? ' (amended)' : ''}` : 'Set when a VAT return is filed'}
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
        <div className="space-y-3 rounded-lg border border-gray-200/80 p-4">
          <p className="text-sm font-semibold text-gray-900">Books lock</p>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
            <div>
              <Label>Lock up to (inclusive)</Label>
              <DatePicker value={booksDate} onChange={setBooksDate} clearable={false} />
              {state.suggestedLockDate && (
                <button type="button" className="mt-1.5 text-xs text-muted-foreground hover:text-gray-900" onClick={() => setBooksDate(state.suggestedLockDate)}>
                  End of last month ({dayKeyLabel(state.suggestedLockDate)})
                </button>
              )}
            </div>
            <div>
              <Label htmlFor="books-reason" required={!!booksBack}>
                {booksBack ? 'Reason' : 'Note'}
                {!booksBack && state.lockedUntil && perms.canUnlock && (
                  <span className="ml-1 font-normal text-muted-foreground">(10+ characters to remove the lock)</span>
                )}
              </Label>
              <Input id="books-reason" value={booksReason} maxLength={500} onChange={e => setBooksReason(e.target.value)}
                placeholder={booksBack ? 'Min. 10 characters' : 'e.g. September reconciled'} />
            </div>
          </div>
          {booksBack && (
            <Callout tone="warning" icon={ShieldAlert}>
              Re-opens {dayKeyLabel(addDays(booksDate, 1))} – {dayKeyLabel(state.lockedUntil)}; only a super admin can unlock, and the reason is logged.
            </Callout>
          )}
          {state.goLiveDate && !state.openingLocked && booksDate && booksDate >= addDays(state.goLiveDate, -1) && !booksBack && (
            <Callout tone="info">Opening balances stay open — lock them in step 5.</Callout>
          )}
          <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
            {state.lockedUntil && perms.canUnlock && (
              <Button
                variant="ghost"
                loading={busy === 'books-clear'}
                disabled={!!busy || booksReason.trim().length < 10}
                title={booksReason.trim().length < 10 ? 'Enter a reason of at least 10 characters' : undefined}
                onClick={() => submit('lockedUntil', null, booksReason, 'books-clear')}
              >
                {busy !== 'books-clear' && <LockOpen />} Remove lock
              </Button>
            )}
            <Button
              variant={booksBack ? 'destructive' : 'outline'}
              loading={busy === 'books'}
              disabled={!!busy || !booksDate || booksDate === state.lockedUntil || (booksBack && (!perms.canUnlock || booksReasonShort))}
              onClick={() => submit('lockedUntil', booksDate, booksReason, 'books')}
            >
              {busy !== 'books' && (booksBack ? <LockOpen /> : <Lock />)}
              {booksBack ? `Unlock back to ${booksDate ? dayKeyLabel(booksDate) : ''}` : 'Lock books'}
            </Button>
          </div>
          {booksBack && !perms.canUnlock && <p className="text-right text-xs text-red-600">Only a super admin can move the lock back.</p>}

          <div className="border-t border-gray-100 pt-3">
            {!taxOpen ? (
              <button type="button" className="text-[13px] font-medium text-muted-foreground hover:text-gray-900" onClick={() => setTaxOpen(true)}>
                Change VAT lock…
              </button>
            ) : (
              <div className="space-y-3">
                <div>
                  <p className="text-sm font-semibold text-gray-900">VAT lock</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">Move it back only to correct a filed period, then file an amended return.</p>
                </div>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)]">
                  <div>
                    <Label>VAT locked to</Label>
                    <DatePicker value={taxDate} onChange={setTaxDate} />
                  </div>
                  <div>
                    <Label htmlFor="tax-reason" required={!!taxBack}>{taxBack ? 'Reason' : 'Note'}</Label>
                    <Input id="tax-reason" value={taxReason} maxLength={500} placeholder={taxBack ? 'Min. 10 characters' : undefined} onChange={e => setTaxReason(e.target.value)} />
                  </div>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
                  <Button variant="ghost" onClick={() => { setTaxOpen(false); setTaxDate(state.taxLockedUntil ?? null); setTaxReason('') }}>Cancel</Button>
                  <Button
                    variant={taxBack ? 'destructive' : 'outline'}
                    loading={busy === 'tax'}
                    disabled={!!busy || (taxDate ?? null) === (state.taxLockedUntil ?? null) || (taxBack && (!perms.canUnlock || taxReason.trim().length < 10))}
                    onClick={() => submit('taxLockedUntil', taxDate ?? null, taxReason, 'tax')}
                  >
                    {taxBack ? 'Unlock VAT period' : 'Save VAT lock'}
                  </Button>
                </div>
                {taxBack && !perms.canUnlock && <p className="text-right text-xs text-red-600">Only a super admin can move the VAT lock back.</p>}
              </div>
            )}
          </div>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Changing locks needs the “Lock / unlock accounting periods” permission.</p>
      )}

      <div>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-semibold text-gray-900">History</h3>
          <Tabs
            size="sm"
            value={scope}
            onChange={setScope}
            tabs={[{ value: 'all', label: 'All changes' }, { value: 'locks', label: 'Locks only' }]}
          />
        </div>
        {history.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted-foreground">No changes yet</p>
        ) : (
          <div className="overflow-hidden rounded-lg border border-gray-200/80">
            <Table className="min-w-[640px]">
              <TableHeader>
                <TableRow>
                  <TableHead className="w-40">When</TableHead>
                  <TableHead className="w-36">Who</TableHead>
                  <TableHead>What changed</TableHead>
                  <TableHead className="w-56">Reason</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map(row => (
                  <TableRow key={row.id} className="align-top">
                    <TableCell className="whitespace-nowrap py-2.5 text-xs text-muted-foreground">{formatDateTime(row.at)}</TableCell>
                    <TableCell className="py-2.5 text-xs">{row.user?.name ?? '—'}</TableCell>
                    <TableCell className="py-2.5 text-gray-900">
                      <Badge
                        variant={row.action === 'UNLOCK' ? 'danger' : row.action === 'LOCK' ? 'success' : 'default'}
                        className="mr-1.5 align-middle"
                      >
                        {HISTORY_ACTION_LABELS[row.action] ?? row.action}
                      </Badge>
                      {describe(row)}
                    </TableCell>
                    <TableCell className="py-2.5 text-xs text-muted-foreground">{row.changes?.reason || '—'}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
        {meta && meta.page < meta.pages && (
          <div className="mt-3 flex justify-center">
            <Button variant="outline" size="sm" loading={loadingMore} onClick={() => load(meta.page + 1)}>
              Load more
            </Button>
          </div>
        )}
        <p className="mt-2 text-xs text-muted-foreground">History is kept for about a year.</p>
      </div>
    </Card>
  )
}
