'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import toast from 'react-hot-toast'
import { RefreshCw, PlusCircle, Undo2 } from 'lucide-react'
import ActionMenu from '@/components/ui/ActionMenu'
import Pagination from '@/components/ui/Pagination'
import EmptyState from '@/components/ui/EmptyState'
import DatePicker from '@/components/ui/DatePicker'
import { cn } from '@/lib/utils'
import { dayKeyLabel } from '@/lib/finance/fiscal'
import { KIND_LABELS } from '@/lib/finance/constants'
import { invalidateMoneyAccounts } from './MoneyAccountSelect'
import AccountIcon from './AccountIcon'
import { ReasonDialog } from './FinanceDialogs'
import { MOVEMENT_KIND_MAP } from './movementKinds'
import { formatAmount, fetchJson, todayKey, dayKeyOf, LABEL } from './accountTheme'

/**
 * Recent money movements (capital, drawings, loans, bank charges, interest, other income,
 * adjustments) with a Reverse action for mistakes.
 * Props: accountId?, refreshKey, limit, canManage, onChanged()
 */
export default function MovementsList({ accountId = null, refreshKey = 0, limit = 8, canManage = false, onChanged }) {
  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reversing, setReversing] = useState(null)
  const [revDate, setRevDate] = useState(todayKey())
  const seq = useRef(0)

  const load = useCallback(async () => {
    const id = ++seq.current
    setLoading(true)
    try {
      const qs = new URLSearchParams({ page: String(page), limit: String(limit) })
      if (accountId) qs.set('accountId', accountId)
      const json = await fetchJson(`/api/finance/movements?${qs}`)
      if (id !== seq.current) return
      setRows(json.data ?? [])
      setMeta(json.meta ?? null)
      setError(null)
    } catch (err) {
      if (id === seq.current) setError(err.message)
    } finally {
      if (id === seq.current) setLoading(false)
    }
  }, [accountId, page, limit])

  useEffect(() => { load() }, [load, refreshKey])

  const openReverse = (m) => {
    setReversing(m)
    setRevDate(todayKey())
  }

  const reverse = async (reason) => {
    try {
      const json = await fetchJson(`/api/finance/movements/${reversing.id}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reverse', reason, date: revDate }),
      })
      invalidateMoneyAccounts()
      const voided = json.data?.voidedTaxEntries ?? []
      toast.success(voided.length ? `Movement reversed — AIT credit ${voided.map(v => v.entryNo).join(', ')} voided` : 'Movement reversed')
      setReversing(null)
      load()
      onChanged?.()
    } catch (err) {
      toast.error(err.message)
    }
  }

  const labelOf = (m) => MOVEMENT_KIND_MAP[m.movementKind]?.label ?? m.category
  const cur = (m) => m.account?.currency ?? m.currency

  return (
    <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-50">
        <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2"><PlusCircle className="w-4 h-4 text-gray-400" /> Recent money movements</h2>
        <button type="button" onClick={load} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50" aria-label="Refresh movements">
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </button>
      </div>
      {error ? (
        <div className="px-4 py-8 text-center text-sm text-red-600">{error} <button type="button" onClick={load} className="ml-2 underline">Retry</button></div>
      ) : !loading && rows.length === 0 ? (
        <EmptyState icon={PlusCircle} title="No movements yet" description="Capital, drawings, loans, bank charges, interest and other income recorded with “Record movement” appear here." className="py-10" />
      ) : (
        <ul className="divide-y divide-gray-50">
          {loading && rows.length === 0 && [0, 1, 2].map(i => <li key={i} className="px-4 py-3"><div className="h-4 rounded bg-gray-100 animate-pulse" /></li>)}
          {rows.map(m => {
            const inbound = m.type === 'INCOME'
            return (
              <li key={m.id} className={cn('px-4 py-2.5 flex items-start gap-3', m.reversedBy && 'text-gray-400')}>
                {m.account && <AccountIcon account={m.account} size="xs" className="mt-0.5" />}
                <div className="min-w-0 flex-1">
                  <p className={cn('text-sm truncate', m.reversedBy ? 'text-gray-500' : 'text-gray-900')}>
                    <span className="font-medium">{labelOf(m)}</span>
                    {m.expenseCategory && <span className="text-gray-500"> · {m.expenseCategory}</span>}
                    {m.isReversal && <span className="ml-1.5 rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 align-middle">Reversal</span>}
                    {m.reversedBy && <span className="ml-1.5 rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600 align-middle" title={m.reversedBy.txnId ? `Reversed by ${m.reversedBy.txnId}` : undefined}>Reversed</span>}
                  </p>
                  <p className="text-[11px] text-gray-500 truncate">
                    {dayKeyLabel(m.date)}
                    {m.account && <> · <Link href={`/admin/finance/accounts/${m.account.id}`} className="hover:underline">{m.account.name}</Link></>}
                    {m.party && <> · {m.party}</>}
                    {m.kind !== 'OPERATING' && <> · {KIND_LABELS[m.kind] ?? m.kind} (not P&amp;L)</>}
                    {m.tax?.tdsBDT > 0 && <> · AIT {formatAmount(m.tax.tdsBDT, 'BDT')}</>}
                  </p>
                </div>
                <span className={cn('text-sm font-semibold tabular-nums whitespace-nowrap', m.reversedBy ? 'text-gray-400 line-through' : inbound ? 'text-emerald-700' : 'text-gray-900')}>
                  {inbound ? '+' : '−'}{formatAmount(m.accountAmount, cur(m))}
                </span>
                {canManage && (
                  <div className="-my-1 -mr-2 w-8 shrink-0">
                    {m.reversible && (
                      <ActionMenu items={[{ label: 'Reverse movement', icon: Undo2, onClick: () => openReverse(m), danger: true }]} />
                    )}
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
      {meta && meta.pages > 1 && (
        <div className="px-4 py-3 border-t border-gray-50"><Pagination meta={meta} onPageChange={setPage} /></div>
      )}

      <ReasonDialog
        open={!!reversing}
        onOpenChange={(v) => !v && setReversing(null)}
        title="Reverse money movement"
        description={reversing
          ? `Posts an opposite entry of ${formatAmount(reversing.accountAmount, cur(reversing))} (${labelOf(reversing).toLowerCase()}) on ${reversing.account?.name ?? 'the account'}. The original stays in the ledger.`
          : ''}
        confirmLabel="Reverse"
        danger
        placeholder="e.g. Wrong amount / entered twice / wrong account"
        onConfirm={reverse}
      >
        {reversing && (reversing.related?.length > 0 || reversing.tax?.tdsBDT > 0) && (
          <ul className="rounded-lg border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800 space-y-1">
            {reversing.related?.map(r => (
              <li key={r.id}>Also reverses {r.txnId ?? 'the linked entry'} ({r.category}, {formatAmount(r.accountAmount, cur(reversing))}) — recorded with it.</li>
            ))}
            {reversing.tax?.tdsBDT > 0 && (
              <li>Voids the AIT tax credit of {formatAmount(reversing.tax.tdsBDT, 'BDT')} recorded with this interest.</li>
            )}
          </ul>
        )}
        <div>
          <label className={LABEL}>Reversal date</label>
          <DatePicker value={revDate} onChange={v => setRevDate(v ?? todayKey())} clearable={false} />
          {reversing && <p className="mt-1 text-[11px] text-gray-500">On or after {dayKeyLabel(dayKeyOf(reversing.date))}. To correct an amount, reverse it and record the movement again.</p>}
        </div>
      </ReasonDialog>
    </div>
  )
}
