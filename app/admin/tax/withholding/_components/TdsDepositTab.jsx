'use client'

import { useMemo, useState } from 'react'
import { Landmark, AlertOctagon, Clock, CheckCircle2, Eye, RefreshCw } from 'lucide-react'
import { usePermission } from '@/components/auth/Can'
import SelectTable, { SelectionBar } from '@/components/tax/SelectTable'
import DepositModal from '@/components/tax/DepositModal'
import TaxEntryDetailModal from '@/components/tax/TaxEntryDetailModal'
import Pagination from '@/components/ui/Pagination'
import { TaxPill, DaysLeftBadge, EntryStatusBadge } from '@/components/tax/TaxBadges'
import { useTaxData } from '@/components/tax/useTaxData'
import { tk, fmtDay, payeeTypeLabel, btnPrimary, btnGhost, cardCls, depositBalance, depositPaid, sumBalance } from '@/components/tax/taxUi'
import { cn } from '@/lib/utils'

function Stat({ icon: Icon, label, value, sub, toneCls = 'text-gray-900' }) {
  return (
    <div className={cn(cardCls, 'p-4')}>
      <div className="flex items-center gap-2 text-xs font-medium text-gray-500"><Icon className="w-3.5 h-3.5" />{label}</div>
      <p className={cn('mt-1 text-lg font-semibold', toneCls)}>{value}</p>
      {sub && <p className="text-xs text-gray-500">{sub}</p>}
    </div>
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
    { key: 'date', label: 'Deducted', render: r => <div><p className="text-gray-900">{fmtDay(r.date)}</p><p className="text-[11px] font-mono text-gray-400">{r.entryNo}</p></div> },
    { key: 'party', label: 'Payee', render: r => (
      <div className="min-w-[160px]">
        <p className="font-medium text-gray-900">{r.partyName || '—'}</p>
        <p className="text-[11px] text-gray-500">{payeeTypeLabel(r.payeeType)}{r.partyTin ? ` · TIN ${r.partyTin}` : ' · no TIN'}</p>
      </div>
    ) },
    { key: 'section', label: 'Section', render: r => <span className="font-mono text-xs">{r.section || '—'}</span> },
    { key: 'base', label: 'Paid', className: 'text-right', cellClassName: 'text-right whitespace-nowrap', render: r => tk(r.baseAmount) },
    { key: 'rate', label: 'Rate', className: 'text-right', cellClassName: 'text-right', render: r => (
      <span>{r.rate != null ? `${r.rate}%` : '—'}{r.higherRateApplied && <span className="block text-[10px] text-amber-700">+50%</span>}</span>
    ) },
    { key: 'amount', label: 'TDS to deposit', className: 'text-right', cellClassName: 'text-right whitespace-nowrap', render: r => {
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
    { key: 'doc', label: 'Reference', render: r => <span className="text-xs text-gray-500">{r.documentNo || '—'}</span> },
  ]

  const histColumns = [
    { key: 'date', label: 'Date', render: r => <div><p>{fmtDay(r.date)}</p><p className="text-[11px] font-mono text-gray-400">{r.entryNo}</p></div> },
    { key: 'challan', label: 'Challan', render: r => <div><p className="font-mono text-xs text-gray-900">{r.deposit?.challanNo || r.documentNo}</p><p className="text-[11px] text-gray-500">{[r.challan?.bank, r.challan?.branch].filter(Boolean).join(', ')}</p></div> },
    { key: 'account', label: 'Paid from', render: r => <span className="text-xs">{r.transactionId?.accountId?.name ?? '—'}</span> },
    { key: 'settled', label: 'Deductions', className: 'text-right', cellClassName: 'text-right', render: r => r.settledCount },
    { key: 'amount', label: 'Amount', className: 'text-right', cellClassName: 'text-right whitespace-nowrap font-medium', render: r => tk(r.amount) },
    { key: 'status', label: 'Status', render: r => <EntryStatusBadge status={r.status} /> },
    { key: 'view', label: '', cellClassName: 'text-right', render: r => (
      <button type="button" className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100" onClick={(e) => { e.stopPropagation(); setDetailId(r.id) }} aria-label="View deposit"><Eye className="w-4 h-4" /></button>
    ) },
  ]

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Stat icon={Landmark} label="Waiting for a challan" value={tk(summary?.amount)}
          sub={`${summary?.count ?? 0} deduction${summary?.count === 1 ? '' : 's'}${summary?.partPaid?.count ? ` · ${summary.partPaid.count} part-paid` : ''}`} />
        <Stat icon={AlertOctagon} label="Overdue" value={tk(summary?.overdue?.amount)} toneCls={summary?.overdue?.count ? 'text-red-700' : 'text-gray-900'}
          sub={summary?.overdue?.count ? `${summary.overdue.count} past the deposit date — 2% interest a month (s.143)` : 'Nothing overdue'} />
        <Stat icon={Clock} label="Due within 7 days" value={tk(summary?.dueSoon?.amount)} sub={nextDue ? `Next deadline ${fmtDay(nextDue)}` : 'No upcoming deadline'} />
      </div>

      <div className={cardCls}>
        <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-b border-gray-100">
          <div>
            <h3 className="text-sm font-semibold text-gray-900">TDS deducted, not yet deposited</h3>
            <p className="text-xs text-gray-500">Deposit by challan within 2 weeks after the month of deduction (June: 7 days / next day / same day).</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {summary?.overdue?.count > 0 && <button type="button" className={btnGhost} onClick={() => selectWhere(r => r.due?.overdue)}>Select overdue</button>}
            {nextDue && <button type="button" className={btnGhost} onClick={() => selectWhere(r => r.due?.dueDate && r.due.dueDate <= nextDue)}>Select due by {fmtDay(nextDue)}</button>}
            <button type="button" className={btnGhost} onClick={reloadAll} aria-label="Refresh"><RefreshCw className={cn('w-4 h-4', payables.loading && 'animate-spin')} /></button>
          </div>
        </div>
        {payables.error ? (
          <p className="px-4 py-6 text-sm text-red-600">{payables.error}</p>
        ) : (
          <SelectTable
            columns={columns}
            rows={rows}
            selected={canDeposit ? selected : null}
            onChange={setSelected}
            loading={payables.loading}
            emptyIcon={CheckCircle2}
            emptyTitle="No TDS waiting for deposit"
            emptyDescription="Tax you deduct when paying suppliers, freelancers or salaries appears here until it is deposited by challan."
            onRowClick={r => setDetailId(r.id)}
          />
        )}
      </div>

      <SelectionBar count={selectedRows.length} amount={sumBalance(selectedRows)} onClear={() => setSelected(new Set())}>
        <button type="button" className={btnPrimary} onClick={() => setDepositOpen(true)}><Landmark className="w-4 h-4" /> Record challan</button>
      </SelectionBar>

      <div className={cardCls}>
        <div className="px-4 py-3 border-b border-gray-100">
          <h3 className="text-sm font-semibold text-gray-900">TDS challans recorded</h3>
        </div>
        {history.error ? <p className="px-4 py-6 text-sm text-red-600">{history.error}</p> : (
          <SelectTable columns={histColumns} rows={history.data ?? []} loading={history.loading} emptyTitle="No TDS deposits yet" emptyDescription="Challans you record appear here." onRowClick={r => setDetailId(r.id)} />
        )}
        {history.json?.meta?.pages > 1 && (
          <div className="px-4 py-3 border-t border-gray-100"><Pagination meta={history.json.meta} onPageChange={setHistPage} /></div>
        )}
      </div>

      {!canDeposit && rows.length > 0 && (
        <p className="text-xs text-gray-500"><TaxPill label="View only" color="gray" dot={false} /> You need the "Record challan deposits" permission to deposit TDS.</p>
      )}

      <DepositModal open={depositOpen} onOpenChange={setDepositOpen} kind="TDS" entries={selectedRows} onSaved={reloadAll} />
      <TaxEntryDetailModal open={!!detailId} onOpenChange={(o) => { if (!o) setDetailId(null) }} entryId={detailId} onChanged={reloadAll} />
    </div>
  )
}
