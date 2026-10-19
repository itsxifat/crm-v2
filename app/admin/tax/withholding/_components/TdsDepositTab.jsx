'use client'

import { useMemo, useState } from 'react'
import { Landmark, CheckCircle2, Eye, RefreshCw, Lock } from 'lucide-react'
import { usePermission } from '@/components/auth/Can'
import SelectTable, { SelectionBar } from '@/components/tax/SelectTable'
import DepositModal from '@/components/tax/DepositModal'
import TaxEntryDetailModal from '@/components/tax/TaxEntryDetailModal'
import Pagination from '@/components/ui/Pagination'
import Button from '@/components/ui/Button'
import { Card, CardHeader, CardTitle, CardDescription, CardAction } from '@/components/ui/Card'
import { DaysLeftBadge, EntryStatusBadge } from '@/components/tax/TaxBadges'
import { useTaxData } from '@/components/tax/useTaxData'
import { tk, fmtDay, payeeTypeLabel, depositBalance, depositPaid, sumBalance } from '@/components/tax/taxUi'
import { cn } from '@/lib/utils'

function Stat({ label, value, sub, toneCls = 'text-gray-900' }) {
  return (
    <Card className="p-5">
      <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
      <p className={cn('mt-2 text-2xl font-semibold tracking-tight tabular-nums', toneCls)}>{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </Card>
  )
}

/** "TDS to deposit": pending TDS_PAYABLE rows → challan deposit; recent deposits below. */
export default function TdsDepositTab() {
  const { can } = usePermission()
  const canDeposit = can('tax.deposits.manage')
  const payables = useTaxData('/api/tax/deposits?view=payables&kind=TDS')
  const [histPage, setHistPage] = useState(1)
  const history = useTaxData(`/api/tax/deposits?view=history&kind=TDS&status=all&limit=10&page=${histPage}`)
  const [selected, setSelected] = useState(new Set())
  const [depositOpen, setDepositOpen] = useState(false)
  const [detailId, setDetailId] = useState(null)

  const rows = useMemo(() => payables.data ?? [], [payables.data])
  const summary = payables.json?.summary
  const selectedRows = rows.filter(r => selected.has(r.id))

  const reloadAll = () => { setSelected(new Set()); payables.reload(); history.reload() }

  const selectWhere = (pred) => setSelected(new Set(rows.filter(pred).map(r => r.id)))
  const nextDue = rows.filter(r => !r.due?.overdue).map(r => r.due?.dueDate).filter(Boolean).sort()[0]

  const columns = [
    { key: 'date', label: 'Deducted', render: r => <div><p className="text-gray-900">{fmtDay(r.date)}</p><p className="font-mono text-[11px] text-gray-400">{r.entryNo}</p></div> },
    { key: 'party', label: 'Payee', render: r => (
      <div className="min-w-[160px]">
        <p className="font-medium text-gray-900">{r.partyName || '—'}</p>
        <p className="text-[11px] text-muted-foreground">{payeeTypeLabel(r.payeeType)}{r.partyTin ? ` · TIN ${r.partyTin}` : ' · no TIN'}</p>
      </div>
    ) },
    { key: 'section', label: 'Section', render: r => <span className="font-mono text-xs">{r.section || '—'}</span> },
    { key: 'base', label: 'Paid', className: 'text-right', cellClassName: 'text-right whitespace-nowrap tabular-nums', render: r => tk(r.baseAmount) },
    { key: 'rate', label: 'Rate', className: 'text-right', cellClassName: 'text-right tabular-nums', render: r => (
      <span>{r.rate != null ? `${r.rate}%` : '—'}{r.higherRateApplied && <span className="block text-[11px] text-amber-700">+50%</span>}</span>
    ) },
    { key: 'amount', label: 'TDS to deposit', className: 'text-right', cellClassName: 'text-right whitespace-nowrap tabular-nums', render: r => {
      const balance = depositBalance(r)
      const paid = depositPaid(r)
      return (
        <div>
          <p className="font-semibold text-gray-900">{tk(balance)}</p>
          {paid > 0 && <p className="text-[11px] text-blue-700" title={(r.deposit?.allocations ?? []).map(a => a.challanNo).filter(Boolean).join(', ') || undefined}>{tk(paid)} of {tk(r.amount)} paid</p>}
        </div>
      )
    } },
    { key: 'due', label: 'Deposit by', render: r => (
      <div className="whitespace-nowrap">
        <p className="text-gray-700">{fmtDay(r.due?.dueDate)}</p>
        <DaysLeftBadge daysLeft={r.due?.daysLeft} />
      </div>
    ) },
    { key: 'doc', label: 'Reference', render: r => <span className="text-xs text-muted-foreground">{r.documentNo || '—'}</span> },
  ]

  const histColumns = [
    { key: 'date', label: 'Date', render: r => <div><p>{fmtDay(r.date)}</p><p className="font-mono text-[11px] text-gray-400">{r.entryNo}</p></div> },
    { key: 'challan', label: 'Challan', render: r => <div><p className="font-mono text-xs text-gray-900">{r.deposit?.challanNo || r.documentNo}</p><p className="text-[11px] text-muted-foreground">{[r.challan?.bank, r.challan?.branch].filter(Boolean).join(', ')}</p></div> },
    { key: 'account', label: 'Paid from', render: r => <span className="text-xs">{r.transactionId?.accountId?.name ?? '—'}</span> },
    { key: 'settled', label: 'Deductions', className: 'text-right', cellClassName: 'text-right tabular-nums', render: r => r.settledCount },
    { key: 'amount', label: 'Amount', className: 'text-right', cellClassName: 'text-right whitespace-nowrap font-medium tabular-nums', render: r => tk(r.amount) },
    { key: 'status', label: 'Status', render: r => <EntryStatusBadge status={r.status} /> },
    { key: 'view', label: '', cellClassName: 'text-right', render: r => (
      <Button variant="ghost" size="icon-xs" className="text-gray-400 hover:text-gray-900" onClick={(e) => { e.stopPropagation(); setDetailId(r.id) }} aria-label="View deposit"><Eye /></Button>
    ) },
  ]

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <Stat label="Waiting for a challan" value={tk(summary?.amount)}
          sub={`${summary?.count ?? 0} deduction${summary?.count === 1 ? '' : 's'}${summary?.partPaid?.count ? ` · ${summary.partPaid.count} part-paid` : ''}`} />
        <Stat label="Overdue" value={tk(summary?.overdue?.amount)} toneCls={summary?.overdue?.count ? 'text-red-700' : 'text-gray-900'}
          sub={summary?.overdue?.count ? `${summary.overdue.count} late — 2% interest a month (s.143)` : 'Nothing overdue'} />
        <Stat label="Due within 7 days" value={tk(summary?.dueSoon?.amount)} sub={nextDue ? `Next deadline ${fmtDay(nextDue)}` : 'No upcoming deadline'} />
      </div>

      <Card className="overflow-hidden">
        <CardHeader className="flex-wrap items-center border-b border-gray-100 py-3">
          <div title="Deposit by challan within 2 weeks after the month of deduction (June: 7 days / next day / same day).">
            <CardTitle>Not yet deposited</CardTitle>
            <CardDescription>Due 2 weeks after the month of deduction</CardDescription>
          </div>
          <CardAction className="flex-wrap">
            {summary?.overdue?.count > 0 && <Button variant="outline" size="sm" onClick={() => selectWhere(r => r.due?.overdue)}>Select overdue</Button>}
            {nextDue && <Button variant="outline" size="sm" onClick={() => selectWhere(r => r.due?.dueDate && r.due.dueDate <= nextDue)}>Select due by {fmtDay(nextDue)}</Button>}
            <Button variant="ghost" size="icon-sm" className="text-gray-500" onClick={reloadAll} aria-label="Refresh"><RefreshCw className={cn(payables.loading && 'animate-spin')} /></Button>
          </CardAction>
        </CardHeader>
        {payables.error ? (
          <p className="px-5 py-6 text-sm text-red-600">{payables.error}</p>
        ) : (
          <SelectTable
            columns={columns}
            rows={rows}
            selected={canDeposit ? selected : null}
            onChange={setSelected}
            loading={payables.loading}
            emptyIcon={CheckCircle2}
            emptyTitle="No TDS waiting for deposit"
            emptyDescription="Deducted TDS shows here until deposited."
            onRowClick={r => setDetailId(r.id)}
          />
        )}
      </Card>

      <SelectionBar count={selectedRows.length} amount={sumBalance(selectedRows)} onClear={() => setSelected(new Set())}>
        <Button onClick={() => setDepositOpen(true)}><Landmark /> Record challan</Button>
      </SelectionBar>

      <Card className="overflow-hidden">
        <CardHeader className="border-b border-gray-100 py-3">
          <CardTitle>TDS challans</CardTitle>
        </CardHeader>
        {history.error ? <p className="px-5 py-6 text-sm text-red-600">{history.error}</p> : (
          <SelectTable columns={histColumns} rows={history.data ?? []} loading={history.loading} emptyTitle="No TDS deposits yet" onRowClick={r => setDetailId(r.id)} />
        )}
        {history.json?.meta?.pages > 1 && (
          <div className="border-t border-gray-100 px-4 py-3"><Pagination meta={history.json.meta} onPageChange={setHistPage} /></div>
        )}
      </Card>

      {!canDeposit && rows.length > 0 && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground">
          <Lock className="size-3.5" /> View only — depositing TDS needs the “Record challan deposits” permission.
        </p>
      )}

      <DepositModal open={depositOpen} onOpenChange={setDepositOpen} kind="TDS" entries={selectedRows} onSaved={reloadAll} />
      <TaxEntryDetailModal open={!!detailId} onOpenChange={(o) => { if (!o) setDetailId(null) }} entryId={detailId} onChanged={reloadAll} />
    </div>
  )
}
