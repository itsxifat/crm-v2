'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import toast from 'react-hot-toast'
import { ArrowRight, ArrowLeftRight, Undo2, RefreshCw } from 'lucide-react'
import ActionMenu from '@/components/ui/ActionMenu'
import Pagination from '@/components/ui/Pagination'
import EmptyState from '@/components/ui/EmptyState'
import DatePicker from '@/components/ui/DatePicker'
import Button from '@/components/ui/Button'
import Badge from '@/components/ui/Badge'
import { Card, CardTitle } from '@/components/ui/Card'
import { Label } from '@/components/ui/Input'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
import { cn } from '@/lib/utils'
import { dayKeyLabel } from '@/lib/finance/fiscal'
import { PAYMENT_CHANNEL_LABELS } from '@/lib/finance/constants'
import { invalidateMoneyAccounts } from './MoneyAccountSelect'
import AccountIcon from './AccountIcon'
import { ReasonDialog } from './FinanceDialogs'
import { formatAmount, fetchJson, todayKey, dayKeyOf } from './accountTheme'

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
    <Card className="overflow-hidden">
      <div className="flex items-center justify-between gap-3 border-b border-gray-100 py-2.5 pl-5 pr-3">
        <CardTitle as="h2">{title}</CardTitle>
        <Button variant="ghost" size="icon-sm" onClick={load} aria-label="Refresh transfers" className="text-gray-500">
          <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
        </Button>
      </div>

      {error ? (
        <div className="px-4 py-8 text-center text-sm text-red-600">
          {error} <button type="button" onClick={load} className="ml-2 font-medium underline underline-offset-4">Retry</button>
        </div>
      ) : !loading && rows.length === 0 ? (
        <EmptyState icon={ArrowLeftRight} title="No transfers yet" className="py-10" />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="pl-5">Date</TableHead>
              <TableHead>From → To</TableHead>
              <TableHead className="text-right">Amount</TableHead>
              <TableHead className="text-right">Fee</TableHead>
              <TableHead>Channel / ref</TableHead>
              <TableHead className="w-10 px-2"><span className="sr-only">Actions</span></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading && rows.length === 0 && [0, 1, 2].map(i => (
              <TableRow key={i}><TableCell colSpan={6} className="pl-5"><div className="h-4 animate-pulse rounded-md bg-gray-100" /></TableCell></TableRow>
            ))}
            {rows.map(t => (
              <TableRow key={t.transferId} className={cn('align-top', t.reversedByTransferId && 'text-gray-400')}>
                <TableCell className="whitespace-nowrap pl-5 text-gray-600">{dayKeyLabel(t.date)}</TableCell>
                <TableCell className="min-w-[220px]">
                  <div className="flex items-center gap-1.5">
                    {t.from && <AccountIcon account={t.from} size="xs" />}
                    <span className="max-w-[140px] truncate font-medium text-gray-900" title={t.from?.name}>{t.from?.name ?? '—'}</span>
                    <ArrowRight className="size-3.5 shrink-0 text-gray-300" />
                    {t.to && <AccountIcon account={t.to} size="xs" />}
                    <span className="max-w-[140px] truncate font-medium text-gray-900" title={t.to?.name}>{t.to?.name ?? '—'}</span>
                  </div>
                  {(t.isReversal || t.reversedByTransferId || (t.description && !t.description.startsWith('Transfer:'))) && (
                    <div className="mt-1 flex flex-wrap items-center gap-1">
                      {t.isReversal && <Badge variant="warning">Reversal</Badge>}
                      {t.reversedByTransferId && <Badge>Reversed</Badge>}
                      {t.description && !t.description.startsWith('Transfer:') && <span className="max-w-[260px] truncate text-xs text-muted-foreground" title={t.description}>{t.description}</span>}
                    </div>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums">
                  <span className="font-semibold text-gray-900">{formatAmount(t.amount, t.currency)}</span>
                  {t.currency !== t.toCurrency && (
                    <span className="block text-xs text-muted-foreground">→ {formatAmount(t.toAmount, t.toCurrency)}</span>
                  )}
                </TableCell>
                <TableCell className="whitespace-nowrap text-right tabular-nums text-gray-600">
                  {Math.abs(t.fee) > 0.004 ? formatAmount(t.fee, t.currency) : '—'}
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {t.channel ? (PAYMENT_CHANNEL_LABELS[t.channel] ?? t.channel) : '—'}
                  {t.cheque?.no && <span className="block">Chq {t.cheque.no}{t.cheque.date ? ` · ${dayKeyLabel(t.cheque.date)}` : ''}</span>}
                  {t.reference && <span className="block max-w-[160px] truncate" title={t.reference}>{t.reference}</span>}
                </TableCell>
                <TableCell className="px-2 py-2 text-right">
                  {canManage && !t.isReversal && !t.reversedByTransferId && t.complete && (
                    <ActionMenu items={[{ label: 'Reverse transfer', icon: Undo2, onClick: () => openReverse(t), danger: true }]} />
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      {meta && meta.pages > 1 && (
        <div className="border-t border-gray-100 px-4 py-3">
          <Pagination meta={meta} onPageChange={setPage} />
        </div>
      )}

      <ReasonDialog
        open={!!reversing}
        onOpenChange={(v) => !v && setReversing(null)}
        title="Reverse transfer"
        description={reversing ? `Posts an opposite transfer of ${formatAmount(reversing.toAmount, reversing.toCurrency)} from ${reversing.to?.name} back to ${reversing.from?.name}; the original stays in the ledger.` : ''}
        confirmLabel="Reverse"
        danger
        placeholder="e.g. Entered twice / wrong account"
        onConfirm={reverse}
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label>Reversal date</Label>
            <DatePicker value={revDate} onChange={v => setRevDate(v ?? todayKey())} clearable={false} />
            {reversing && <p className="mt-1.5 text-xs text-muted-foreground">On or after {dayKeyLabel(dayKeyOf(reversing.date))}</p>}
          </div>
          {reversing && Math.abs(reversing.fee) > 0.004 && (
            <label className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-gray-200/80 p-3 text-[13px] text-gray-900 hover:bg-gray-50 sm:mt-6">
              <input type="checkbox" checked={revFee} onChange={e => setRevFee(e.target.checked)} className="mt-0.5" />
              <span>
                Also reverse the {formatAmount(reversing.fee, reversing.currency)} fee
                <span className="mt-0.5 block text-xs text-muted-foreground">Untick if the bank kept the charge</span>
              </span>
            </label>
          )}
        </div>
      </ReasonDialog>
    </Card>
  )
}
