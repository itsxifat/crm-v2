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
  tk, fmtDay, fmtPeriod, sumAmount, partyKeyOf, fiscalYearOptions,
} from '@/components/tax/taxUi'
import Button from '@/components/ui/Button'
import Tabs from '@/components/ui/Tabs'
import { Card, CardTitle, CardDescription } from '@/components/ui/Card'
import { NativeSelect } from '@/components/ui/Input'
import { cn } from '@/lib/utils'

const STATUS_TABS = [
  { value: 'PENDING', label: 'Certificate pending' },
  { value: 'RECEIVED', label: 'Received' },
  { value: 'all', label: 'All' },
]

function Stat({ label, value, sub, toneCls = 'text-gray-900' }) {
  return (
    <Card className="p-5">
      <p className="text-[13px] font-medium text-muted-foreground">{label}</p>
      <p className={cn('mt-2 text-2xl font-semibold tracking-tight tabular-nums', toneCls)}>{value}</p>
      {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
    </Card>
  )
}

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
    { key: 'date', label: 'Deducted', render: r => <div><p className="whitespace-nowrap text-gray-900">{fmtDay(r.date)}</p><p className="font-mono text-[11px] text-gray-400">{r.entryNo}</p></div> },
    { key: 'party', label: isAit ? 'Customer / bank' : 'Customer', render: r => (
      <div className="min-w-[150px]">
        <p className="font-medium text-gray-900">{r.partyName || '—'}</p>
        {r.partyBin && <p className="font-mono text-[11px] text-muted-foreground">BIN {r.partyBin}</p>}
      </div>
    ) },
    { key: 'doc', label: isAit ? 'Invoice / reference' : 'Invoice', render: r => <span className="text-xs text-gray-600">{r.documentNo || '—'}</span> },
    ...(isAit ? [{ key: 'section', label: 'Section', render: r => <span className="font-mono text-xs">{r.section || '—'}</span> }] : []),
    { key: 'base', label: isAit ? 'Paid to us' : 'Value', className: 'text-right', cellClassName: 'text-right whitespace-nowrap tabular-nums', render: r => tk(r.baseAmount) },
    { key: 'amount', label: isAit ? 'AIT' : 'VDS', className: 'text-right', cellClassName: 'text-right whitespace-nowrap font-semibold text-gray-900 tabular-nums', render: r => tk(r.amount) },
    { key: 'cert', label: 'Certificate', render: r => (
      <div className="space-y-0.5">
        <CertificateBadge certificate={r.certificate} />
        {r.certificate?.number && <p className="font-mono text-[11px] text-gray-600">{r.certificate.number} · {fmtDay(r.certificate.date)}</p>}
      </div>
    ) },
    ...(!isAit ? [{ key: 'claim', label: 'Claim', render: r => r.claimPeriod
      ? <TaxPill label={`Claimed ${fmtPeriod(r.claimPeriod)}`} color="green" />
      : r.due?.period
        ? <TaxPill label={r.due.overdue ? `Expired ${fmtPeriod(r.due.period)}` : `By ${fmtPeriod(r.due.period)} return`} color={r.due.overdue ? 'red' : 'gray'} dot={!!r.due.overdue} />
        : <span className="text-xs text-gray-400">—</span> }] : []),
    { key: 'view', label: '', cellClassName: 'text-right', render: r => (
      <Button variant="ghost" size="icon-xs" className="text-gray-400 hover:text-gray-900" onClick={(e) => { e.stopPropagation(); setDetailId(r.id) }} aria-label="View entry"><Eye /></Button>
    ) },
  ]

  return (
    <div className="space-y-4">
      {isAit && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Stat label={`AIT credit — FY ${fy}`} value={tk(totals.all)} sub="Set off against income tax" />
          <Stat label="With certificate" value={tk(totals.withCert)} />
          <Stat label="Certificate missing" value={tk(totals.missing)} toneCls={totals.missingCount ? 'text-amber-700' : 'text-gray-900'}
            sub={`${totals.missingCount} deduction${totals.missingCount === 1 ? '' : 's'}`} />
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-5 py-3">
          <div className="max-w-2xl">
            <CardTitle>{isAit ? 'TDS deducted by customers & banks' : 'VDS deducted by customers'}</CardTitle>
            <CardDescription>
              {isAit
                ? 'Collect each certificate — it proves the credit at assessment.'
                : 'Claim via note 29 with the customer’s Mushak-6.6, in the payment period or the next 6.'}
            </CardDescription>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {isAit && (
              <NativeSelect className="h-8 w-auto text-[13px]" value={fy} onChange={e => { setFy(e.target.value); setSelected(new Set()) }} aria-label="Income year">
                {fyOptions.map(f => <option key={f} value={f}>FY {f}</option>)}
              </NativeSelect>
            )}
            <Tabs size="sm" value={status} onChange={(v) => { setStatus(v); setSelected(new Set()) }} tabs={STATUS_TABS} />
            {isAit && canManage && <Button variant="outline" size="sm" onClick={() => setAddOpen(true)}><Plus /> Add AIT</Button>}
            <Button variant="ghost" size="icon-sm" className="text-gray-500" onClick={refresh} aria-label="Refresh"><RefreshCw className={cn(loading && 'animate-spin')} /></Button>
          </div>
        </div>
        {!isAit && json?.summary && (
          <div className="flex flex-wrap gap-2 border-b border-gray-100 px-5 py-2.5 text-xs">
            <TaxPill label={`${json.summary.collect.VDS.pending.count} pending · ${tk(json.summary.collect.VDS.pending.amount)}`} color="amber" />
            {json.summary.collect.VDS.expiring.count > 0 && <TaxPill label={`${json.summary.collect.VDS.expiring.count} expiring soon`} color="orange" />}
            {json.summary.collect.VDS.expired.count > 0 && <TaxPill label={`${json.summary.collect.VDS.expired.count} expired`} color="red" />}
            <TaxPill label={`${json.summary.collect.VDS.received.count} received`} color="green" />
          </div>
        )}
        {error ? <p className="px-5 py-6 text-sm text-red-600">{error}</p> : (
          <SelectTable
            columns={columns}
            rows={rows}
            selected={canManage ? selected : null}
            onChange={setSelected}
            canSelect={canSelect}
            loading={loading}
            emptyIcon={Inbox}
            emptyTitle={isAit ? `No AIT deductions in FY ${fy}` : 'No VDS deductions'}
            emptyDescription={isAit
              ? 'Record TDS on a customer payment to see it here.'
              : 'Record VDS on a customer payment to see it here.'}
            onRowClick={r => setDetailId(r.id)}
          />
        )}
      </Card>

      <SelectionBar count={selectedRows.length} amount={sumAmount(selectedRows)} onClear={() => setSelected(new Set())}>
        <Button onClick={() => setCertOpen(true)}><FileCheck /> Record certificate</Button>
      </SelectionBar>

      <CertificateModal open={certOpen} onOpenChange={setCertOpen} entries={selectedRows} onSaved={refresh} />
      <TaxEntryDetailModal open={!!detailId} onOpenChange={(o) => { if (!o) setDetailId(null) }} entryId={detailId} onChanged={refresh} />
      {isAit && <TaxEntryFormModal open={addOpen} onOpenChange={setAddOpen} initialType="TDS_RECEIVABLE" types={['TDS_RECEIVABLE']} onSaved={refresh} />}
    </div>
  )
}
