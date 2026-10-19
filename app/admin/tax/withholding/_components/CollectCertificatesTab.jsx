'use client'

import { useMemo, useState } from 'react'
import { FileCheck, Eye, RefreshCw, Plus, Inbox } from 'lucide-react'
import { usePermission } from '@/components/auth/Can'
import SelectTable, { SelectionBar } from '@/components/tax/SelectTable'
import CertificateModal from '@/components/tax/CertificateModal'
import TaxEntryDetailModal from '@/components/tax/TaxEntryDetailModal'
import TaxEntryFormModal from '@/components/tax/TaxEntryFormModal'
import { CertificateBadge, TaxPill } from '@/components/tax/TaxBadges'
import { useTaxData } from '@/components/tax/useTaxData'
import {
  tk, fmtDay, fmtPeriod, btnPrimary, btnGhost, sumAmount, cardCls, partyKeyOf, fiscalYearOptions, inputCls,
} from '@/components/tax/taxUi'
import { cn } from '@/lib/utils'

const STATUS_TABS = [
  { value: 'PENDING', label: 'Certificate pending' },
  { value: 'RECEIVED', label: 'Received' },
  { value: 'all', label: 'All' },
]

/**
 * Certificates we must COLLECT from customers:
 *   type VDS — VAT deducted by customers (Mushak-6.6 needed to claim note 29)
 *   type TDS — AIT / TDS deducted by customers (credit against income tax)
 */
export default function CollectCertificatesTab({ type = 'VDS' }) {
  const { can } = usePermission()
  const canManage = can('tax.manage')
  const isAit = type === 'TDS'
  const fyOptions = useMemo(() => fiscalYearOptions(5), [])
  const [fy, setFy] = useState(isAit ? fyOptions[0] : '')
  const [status, setStatus] = useState(isAit ? 'all' : 'PENDING')
  const url = `/api/tax/certificates?direction=collect&type=${type}&status=${status}&limit=500${fy ? `&fiscalYear=${fy}` : ''}`
  const { json, loading, error, reload } = useTaxData(url)
  const rows = useMemo(() => json?.data ?? [], [json])
  const [selected, setSelected] = useState(new Set())
  const [certOpen, setCertOpen] = useState(false)
  const [detailId, setDetailId] = useState(null)
  const [addOpen, setAddOpen] = useState(false)
  const refresh = () => { setSelected(new Set()); reload() }

  const selectedRows = rows.filter(r => selected.has(r.id))
  const canSelect = (row, sel) => (!sel.length || partyKeyOf(row) === partyKeyOf(sel[0]) ? true : 'One certificate covers one customer')

  const totals = useMemo(() => {
    const withCert = rows.filter(r => r.certificate?.status === 'RECEIVED')
    const missing = rows.filter(r => r.certificate?.status === 'PENDING')
    return { all: sumAmount(rows), withCert: sumAmount(withCert), missing: sumAmount(missing), missingCount: missing.length }
  }, [rows])

  const columns = [
    { key: 'date', label: 'Deducted', render: r => <div><p className="text-gray-900 whitespace-nowrap">{fmtDay(r.date)}</p><p className="text-[11px] font-mono text-gray-400">{r.entryNo}</p></div> },
    { key: 'party', label: isAit ? 'Customer / bank' : 'Customer', render: r => (
      <div className="min-w-[150px]">
        <p className="font-medium text-gray-900">{r.partyName || '—'}</p>
        {r.partyBin && <p className="text-[11px] font-mono text-gray-500">BIN {r.partyBin}</p>}
      </div>
    ) },
    { key: 'doc', label: isAit ? 'Invoice / reference' : 'Invoice', render: r => <span className="text-xs text-gray-600">{r.documentNo || '—'}</span> },
    ...(isAit ? [{ key: 'section', label: 'Section', render: r => <span className="font-mono text-xs">{r.section || '—'}</span> }] : []),
    { key: 'base', label: isAit ? 'Paid to us' : 'Value', className: 'text-right', cellClassName: 'text-right whitespace-nowrap', render: r => tk(r.baseAmount) },
    { key: 'amount', label: isAit ? 'AIT' : 'VDS', className: 'text-right', cellClassName: 'text-right whitespace-nowrap font-semibold text-gray-900', render: r => tk(r.amount) },
    { key: 'cert', label: 'Certificate', render: r => (
      <div className="space-y-0.5">
        <CertificateBadge certificate={r.certificate} />
        {r.certificate?.number && <p className="text-[11px] font-mono text-gray-600">{r.certificate.number} · {fmtDay(r.certificate.date)}</p>}
      </div>
    ) },
    ...(!isAit ? [{ key: 'claim', label: 'Claim', render: r => r.claimPeriod
      ? <TaxPill label={`Claimed ${fmtPeriod(r.claimPeriod)}`} color="green" />
      : r.due?.period
        ? <TaxPill label={r.due.overdue ? `Expired ${fmtPeriod(r.due.period)}` : `By ${fmtPeriod(r.due.period)} return`} color={r.due.overdue ? 'red' : 'gray'} dot={!!r.due.overdue} />
        : <span className="text-xs text-gray-400">—</span> }] : []),
    { key: 'view', label: '', cellClassName: 'text-right', render: r => (
      <button type="button" className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100" onClick={(e) => { e.stopPropagation(); setDetailId(r.id) }} aria-label="View entry"><Eye className="w-4 h-4" /></button>
    ) },
  ]

  return (
    <div className="space-y-4">
      {isAit && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <div className={cn(cardCls, 'p-4')}>
            <p className="text-xs font-medium text-gray-500">AIT credit — FY {fy}</p>
            <p className="mt-1 text-lg font-semibold text-gray-900">{tk(totals.all)}</p>
            <p className="text-xs text-gray-500">Set off against the company's income tax for the year</p>
          </div>
          <div className={cn(cardCls, 'p-4')}>
            <p className="text-xs font-medium text-gray-500">With certificate</p>
            <p className="mt-1 text-lg font-semibold text-gray-900">{tk(totals.withCert)}</p>
          </div>
          <div className={cn(cardCls, 'p-4')}>
            <p className="text-xs font-medium text-gray-500">Certificate missing</p>
            <p className={cn('mt-1 text-lg font-semibold', totals.missingCount ? 'text-amber-700' : 'text-gray-900')}>{tk(totals.missing)}</p>
            <p className="text-xs text-gray-500">{totals.missingCount} deduction{totals.missingCount === 1 ? '' : 's'} — ask the customer for the certificate</p>
          </div>
        </div>
      )}

      <div className={cardCls}>
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 border-b border-gray-100">
          <div className="max-w-2xl">
            <h3 className="text-sm font-semibold text-gray-900">{isAit ? 'Income tax deducted from us by customers and banks' : 'VAT deducted at source by customers'}</h3>
            <p className="text-xs text-gray-500">
              {isAit
                ? 'Collect each customer\'s TDS certificate (and the bank\'s certificate for tax deducted on interest) — it proves the credit at assessment.'
                : 'Collect the customer\'s Mushak-6.6. With it in hand, the VDS is claimed as a decreasing adjustment (note 29) in the return of the period the payment was received or one of the next 6 periods.'}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isAit && (
              <select className={cn(inputCls, 'w-auto py-1.5')} value={fy} onChange={e => { setFy(e.target.value); setSelected(new Set()) }} aria-label="Income year">
                {fyOptions.map(f => <option key={f} value={f}>FY {f}</option>)}
              </select>
            )}
            <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
              {STATUS_TABS.map(s => (
                <button key={s.value} type="button" onClick={() => { setStatus(s.value); setSelected(new Set()) }}
                  className={cn('px-3 py-1.5 text-xs font-medium rounded-md', status === s.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800')}>
                  {s.label}
                </button>
              ))}
            </div>
            {isAit && canManage && <button type="button" className={btnGhost} onClick={() => setAddOpen(true)}><Plus className="w-4 h-4" /> Add AIT</button>}
            <button type="button" className={btnGhost} onClick={refresh} aria-label="Refresh"><RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} /></button>
          </div>
        </div>
        {!isAit && json?.summary && (
          <div className="flex flex-wrap gap-2 px-4 py-2.5 border-b border-gray-50 text-xs">
            <TaxPill label={`${json.summary.collect.VDS.pending.count} pending · ${tk(json.summary.collect.VDS.pending.amount)}`} color="amber" />
            {json.summary.collect.VDS.expiring.count > 0 && <TaxPill label={`${json.summary.collect.VDS.expiring.count} expiring soon`} color="orange" />}
            {json.summary.collect.VDS.expired.count > 0 && <TaxPill label={`${json.summary.collect.VDS.expired.count} expired`} color="red" />}
            <TaxPill label={`${json.summary.collect.VDS.received.count} received`} color="green" />
          </div>
        )}
        {error ? <p className="px-4 py-6 text-sm text-red-600">{error}</p> : (
          <SelectTable
            columns={columns}
            rows={rows}
            selected={canManage ? selected : null}
            onChange={setSelected}
            canSelect={canSelect}
            loading={loading}
            emptyIcon={Inbox}
            emptyTitle={isAit ? `No AIT deductions in FY ${fy}` : 'No VDS deductions here'}
            emptyDescription={isAit
              ? 'When a customer pays you net of income tax, record the TDS on the payment — it appears here as a credit.'
              : 'When a customer pays you net of VAT withheld, record the VDS on the payment — it appears here until you collect their Mushak-6.6.'}
            onRowClick={r => setDetailId(r.id)}
          />
        )}
      </div>

      <SelectionBar count={selectedRows.length} amount={sumAmount(selectedRows)} onClear={() => setSelected(new Set())}>
        <button type="button" className={btnPrimary} onClick={() => setCertOpen(true)}><FileCheck className="w-4 h-4" /> Record certificate</button>
      </SelectionBar>

      <CertificateModal open={certOpen} onOpenChange={setCertOpen} entries={selectedRows} onSaved={refresh} />
      <TaxEntryDetailModal open={!!detailId} onOpenChange={(o) => { if (!o) setDetailId(null) }} entryId={detailId} onChanged={refresh} />
      {isAit && <TaxEntryFormModal open={addOpen} onOpenChange={setAddOpen} initialType="TDS_RECEIVABLE" types={['TDS_RECEIVABLE']} onSaved={refresh} />}
    </div>
  )
}
