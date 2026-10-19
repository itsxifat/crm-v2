'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { ArrowRight, ArrowLeftRight, Undo2, RefreshCw } from 'lucide-react'
import ActionMenu from '@/components/ui/ActionMenu'
import Pagination from '@/components/ui/Pagination'
import EmptyState from '@/components/ui/EmptyState'
import DatePicker from '@/components/ui/DatePicker'
import { cn } from '@/lib/utils'
import { dayKeyLabel } from '@/lib/finance/fiscal'
import { PAYMENT_CHANNEL_LABELS } from '@/lib/finance/constants'
import { invalidateMoneyAccounts } from './MoneyAccountSelect'
import AccountIcon from './AccountIcon'
import { ReasonDialog } from './FinanceDialogs'
import { formatAmount, fetchJson, todayKey, dayKeyOf, LABEL } from './accountTheme'

/**
 * Recent transfers (optionally for one account) with a Reverse action.
 * Props: accountId?, refreshKey (bump to reload), canManage, limit, onChanged()
 */
export default function TransfersList({ accountId = null, refreshKey = 0, canManage = false, limit = 8, onChanged, title = 'Recent transfers' }) {
  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState(null)
  const [page, setPage] = useState(1)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [reversing, setReversing] = useState(null)
  const [revDate, setRevDate] = useState(todayKey())
  const [revFee, setRevFee] = useState(true)
  const seq = useRef(0)

  const load = useCallback(async () => {
    const id = ++seq.current
    setLoading(true)
    try {
      const qs = new URLSearchParams({ page: String(page), limit: String(limit) })
      if (accountId) qs.set('accountId', accountId)
      const json = await fetchJson(`/api/finance/transfers?${qs}`)
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

  const openReverse = (t) => {
    setReversing(t)
    setRevDate(todayKey())
    setRevFee(true)
  }

  const reverse = async (reason) => {
    try {
      await fetchJson(`/api/finance/transfers/${reversing.transferId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'reverse', reason, date: revDate, reverseFee: revFee }),
      })
      invalidateMoneyAccounts()
      toast.success('Transfer reversed')
      setReversing(null)
      load()
      onChanged?.()
    } catch (err) {
      toast.error(err.message)
    }
  }

  return (
    <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
      <div className="flex items-center justify-between gap-3 px-4 py-3 border-b border-gray-50">
        <h2 className="text-sm font-semibold text-gray-900 flex items-center gap-2"><ArrowLeftRight className="w-4 h-4 text-gray-400" /> {title}</h2>
        <button type="button" onClick={load} className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-50" aria-label="Refresh transfers">
          <RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} />
        </button>
      </div>

      {error ? (
        <div className="px-4 py-8 text-center text-sm text-red-600">
          {error} <button type="button" onClick={load} className="ml-2 underline">Retry</button>
        </div>
      ) : !loading && rows.length === 0 ? (
        <EmptyState icon={ArrowLeftRight} title="No transfers yet" description="Bank deposits, cash withdrawals and wallet cash-outs show up here." className="py-10" />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-gray-400">
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">From → To</th>
                <th className="px-4 py-2 font-medium text-right">Amount</th>
                <th className="px-4 py-2 font-medium text-right">Fee</th>
                <th className="px-4 py-2 font-medium">Channel / ref</th>
                <th className="px-2 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {loading && rows.length === 0 && [0, 1, 2].map(i => (
                <tr key={i}><td colSpan={6} className="px-4 py-3"><div className="h-4 rounded bg-gray-100 animate-pulse" /></td></tr>
              ))}
              {rows.map(t => (
                <tr key={t.transferId} className={cn('align-top', t.reversedByTransferId && 'text-gray-400')}>
                  <td className="px-4 py-2.5 whitespace-nowrap text-gray-600">{dayKeyLabel(t.date)}</td>
                  <td className="px-4 py-2.5 min-w-[220px]">
                    <div className="flex items-center gap-1.5">
                      {t.from && <AccountIcon account={t.from} size="xs" />}
                      <span className="truncate max-w-[140px] font-medium text-gray-800" title={t.from?.name}>{t.from?.name ?? '—'}</span>
                      <ArrowRight className="w-3.5 h-3.5 text-gray-300 shrink-0" />
                      {t.to && <AccountIcon account={t.to} size="xs" />}
                      <span className="truncate max-w-[140px] font-medium text-gray-800" title={t.to?.name}>{t.to?.name ?? '—'}</span>
                    </div>
                    <div className="mt-0.5 flex flex-wrap gap-1">
                      {t.isReversal && <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">Reversal</span>}
                      {t.reversedByTransferId && <span className="rounded bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold text-gray-600">Reversed</span>}
                      {t.description && !t.description.startsWith('Transfer:') && <span className="text-[11px] text-gray-400 truncate max-w-[260px]" title={t.description}>{t.description}</span>}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums">
                    <span className="font-semibold text-gray-900">{formatAmount(t.amount, t.currency)}</span>
                    {t.currency !== t.toCurrency && (
                      <span className="block text-[11px] text-gray-500">→ {formatAmount(t.toAmount, t.toCurrency)}</span>
                    )}
                  </td>
                  <td className="px-4 py-2.5 text-right whitespace-nowrap tabular-nums text-gray-600">
                    {Math.abs(t.fee) > 0.004 ? formatAmount(t.fee, t.currency) : '—'}
                  </td>
                  <td className="px-4 py-2.5 text-xs text-gray-500">
                    {t.channel ? (PAYMENT_CHANNEL_LABELS[t.channel] ?? t.channel) : '—'}
                    {t.cheque?.no && <span className="block">Chq {t.cheque.no}{t.cheque.date ? ` · ${dayKeyLabel(t.cheque.date)}` : ''}</span>}
                    {t.reference && <span className="block truncate max-w-[160px]" title={t.reference}>{t.reference}</span>}
                  </td>
                  <td className="px-2 py-2.5 text-right">
                    {canManage && !t.isReversal && !t.reversedByTransferId && t.complete && (
                      <ActionMenu items={[{ label: 'Reverse transfer', icon: Undo2, onClick: () => openReverse(t), danger: true }]} />
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {meta && meta.pages > 1 && (
        <div className="px-4 py-3 border-t border-gray-50">
          <Pagination meta={meta} onPageChange={setPage} />
        </div>
      )}

      <ReasonDialog
        open={!!reversing}
        onOpenChange={(v) => !v && setReversing(null)}
        title="Reverse transfer"
        description={reversing ? `Posts an opposite transfer of ${formatAmount(reversing.toAmount, reversing.toCurrency)} from ${reversing.to?.name} back to ${reversing.from?.name}. The original stays in the ledger.` : ''}
        confirmLabel="Reverse"
        danger
        placeholder="e.g. Entered twice / wrong account"
        onConfirm={reverse}
      >
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className={LABEL}>Reversal date</label>
            <DatePicker value={revDate} onChange={v => setRevDate(v ?? todayKey())} clearable={false} />
            {reversing && <p className="mt-1 text-[11px] text-gray-500">On or after {dayKeyLabel(dayKeyOf(reversing.date))}</p>}
          </div>
          {reversing && Math.abs(reversing.fee) > 0.004 && (
            <label className="flex items-start gap-2 rounded-lg border border-gray-200 p-2.5 text-xs text-gray-700 cursor-pointer">
              <input type="checkbox" checked={revFee} onChange={e => setRevFee(e.target.checked)} className="mt-0.5 rounded border-gray-300 accent-gray-900" />
              <span>Also reverse the {formatAmount(reversing.fee, reversing.currency)} fee <span className="block text-gray-400">Untick if the bank kept the charge.</span></span>
            </label>
          )}
        </div>
      </ReasonDialog>
    </div>
  )
}
