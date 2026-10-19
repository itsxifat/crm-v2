'use client'

import { useMemo, useState } from 'react'
import { Printer, FileCheck, Landmark, Eye, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react'
import { usePermission } from '@/components/auth/Can'
import SelectTable, { SelectionBar } from '@/components/tax/SelectTable'
import DepositModal from '@/components/tax/DepositModal'
import CertificateModal from '@/components/tax/CertificateModal'
import TaxEntryDetailModal from '@/components/tax/TaxEntryDetailModal'
import { CertificateBadge, DepositBadge, DaysLeftBadge, TaxPill } from '@/components/tax/TaxBadges'
import toast from 'react-hot-toast'
import { useTaxData, usePrintThenReload, issueCertificateThenPrint } from '@/components/tax/useTaxData'
import { tk, fmtDay, sumAmount, partyKeyOf } from '@/components/tax/taxUi'
import Button from '@/components/ui/Button'
import Tabs from '@/components/ui/Tabs'
import { Card, CardTitle, CardDescription } from '@/components/ui/Card'
import { cn } from '@/lib/utils'

const STATUS_TABS = [
  { value: 'PENDING', label: 'To issue' },
  { value: 'ISSUED', label: 'Issued' },
  { value: 'all', label: 'All' },
]

const COPY = {
  VDS: {
    title: 'VDS deducted from suppliers',
    help: 'Issue Mushak-6.6 within 3 working days of filing the VAT return (unregistered: of depositing the VDS).',
    print: 'Issue Mushak-6.6',
    empty: 'Nothing to issue',
    emptyHelp: 'VDS you withhold from suppliers shows here.',
  },
  TDS: {
    title: 'TDS certificates to issue',
    help: 'Tofsil-2 (salary s.86: Tofsil-1) within 2 weeks after the month of deduction, once deposited.',
    print: 'Issue TDS certificate',
    empty: 'Nothing to issue',
    emptyHelp: 'TDS you withhold from payments shows here.',
  },
}

/** Certificates WE issue: Mushak-6.6 (type VDS) or TDS certificates (type TDS). */
export default function IssueCertificatesTab({ type = 'VDS' }) {
  const copy = COPY[type]
  const { can } = usePermission()
  const canManage = can('tax.manage')
  const canDeposit = can('tax.deposits.manage')
  const [status, setStatus] = useState('PENDING')
  const { json, loading, error, reload } = useTaxData(`/api/tax/certificates?direction=issue&type=${type}&status=${status}&limit=500`)
  const rows = useMemo(() => json?.data ?? [], [json])
  const [selected, setSelected] = useState(new Set())
  const [certOpen, setCertOpen] = useState(false)
  const [depositOpen, setDepositOpen] = useState(false)
  const [detailId, setDetailId] = useState(null)
  const refresh = () => { setSelected(new Set()); reload() }
  const printDoc = usePrintThenReload(refresh)
  const registered = (json?.registrationType ?? 'REGISTERED') === 'REGISTERED'

  const selectedRows = rows.filter(r => selected.has(r.id))
  const numbered = selectedRows.find(r => r.certificate?.number)?.certificate?.number ?? null
  const allReady = selectedRows.length > 0 && selectedRows.every(r => r.readiness?.ready)
  const allDepositPending = selectedRows.length > 0 && selectedRows.every(r => r.deposit?.status === 'PENDING')

  const canSelect = (row, sel) => {
    if (!sel.length) return true
    if (partyKeyOf(row) !== partyKeyOf(sel[0])) return 'One certificate covers one party'
    const n = sel[0].certificate?.number ?? null
    if ((row.certificate?.number ?? null) !== n) return n ? `Part of certificate ${n} only` : 'Already on another certificate'
    return true
  }

  async function print(preview = false) {
    const ids = numbered ? rows.filter(r => r.certificate?.number === numbered).map(r => r.id) : selectedRows.map(r => r.id)
    const kind = type.toLowerCase()
    if (preview || numbered) {
      printDoc(`/api/tax/certificates/${kind}/print?ids=${ids.join(',')}${preview ? '&preview=1' : ''}`)
      return
    }
    // Issuing assigns the certificate number (POST); the print view then reprints it.
    try {
      const issued = await issueCertificateThenPrint(kind, ids)
      toast.success(`Certificate ${issued?.number ?? ''} issued`)
      refresh()
    } catch (err) {
      toast.error(err.details?.length ? `${err.message}: ${err.details.join('; ')}` : err.message)
    }
  }

  const columns = [
    { key: 'date', label: 'Deducted', render: r => <div><p className="whitespace-nowrap text-gray-900">{fmtDay(r.date)}</p><p className="font-mono text-[11px] text-gray-400">{r.entryNo}</p></div> },
    { key: 'party', label: type === 'VDS' ? 'Supplier' : 'Payee', render: r => (
      <div className="min-w-[150px]">
        <p className="font-medium text-gray-900">{r.partyName || '—'}</p>
        <p className="font-mono text-[11px] text-muted-foreground">{type === 'VDS' ? (r.partyBin ? `BIN ${r.partyBin}` : 'No BIN') : (r.partyTin ? `TIN ${r.partyTin}` : 'No TIN')}</p>
      </div>
    ) },
    { key: 'doc', label: type === 'VDS' ? 'Invoice' : 'Reference', render: r => <span className="text-xs text-gray-600">{r.documentNo || '—'}</span> },
    { key: 'code', label: type === 'VDS' ? 'Service' : 'Section', render: r => <span className="font-mono text-xs">{(type === 'VDS' ? r.serviceCode : r.section) || '—'}</span> },
    { key: 'base', label: 'Value', className: 'text-right', cellClassName: 'text-right whitespace-nowrap tabular-nums', render: r => tk(r.baseAmount) },
    { key: 'amount', label: type === 'VDS' ? 'VDS' : 'TDS', className: 'text-right', cellClassName: 'text-right whitespace-nowrap font-semibold text-gray-900 tabular-nums', render: r => tk(r.amount) },
    { key: 'deposit', label: 'Deposit', render: r => <div className="space-y-0.5"><DepositBadge deposit={r.deposit} />{r.deposit?.challanNo && <p className="font-mono text-[11px] text-muted-foreground">{r.deposit.challanNo}</p>}</div> },
    { key: 'cert', label: 'Certificate', render: r => (
      <div className="space-y-0.5">
        <CertificateBadge certificate={r.certificate} />
        {r.certificate?.number && <p className="font-mono text-[11px] text-gray-600">{r.certificate.number}</p>}
        {r.certificate?.status === 'PENDING' && r.readiness && !r.readiness.ready && <p className="max-w-[200px] text-[11px] text-amber-700">{r.readiness.reason}</p>}
      </div>
    ) },
    { key: 'due', label: 'Issue by', render: r => r.due && r.certificate?.status === 'PENDING'
      ? <div className="whitespace-nowrap"><p className="text-gray-700">{fmtDay(r.due.date)}</p><DaysLeftBadge daysLeft={r.due.daysLeft} /></div>
      : <span className="text-xs text-gray-400">{r.certificate?.date ? fmtDay(r.certificate.date) : '—'}</span> },
    { key: 'view', label: '', cellClassName: 'text-right', render: r => (
      <Button variant="ghost" size="icon-xs" className="text-gray-400 hover:text-gray-900" onClick={(e) => { e.stopPropagation(); setDetailId(r.id) }} aria-label="View entry"><Eye /></Button>
    ) },
  ]

  return (
    <div className="space-y-4">
      {type === 'VDS' && !registered && (
        <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2.5 text-sm text-amber-800">
          <AlertTriangle className="mt-0.5 size-4 shrink-0" />
          Not VAT registered: deposit VDS by challan within 15 days of paying the supplier, then issue the 6.6.
        </div>
      )}

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 border-b border-gray-100 px-5 py-3">
          <div className="max-w-2xl">
            <CardTitle>{copy.title}</CardTitle>
            <CardDescription>{copy.help}</CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Tabs size="sm" value={status} onChange={(v) => { setStatus(v); setSelected(new Set()) }} tabs={STATUS_TABS} />
            <Button variant="ghost" size="icon-sm" className="text-gray-500" onClick={refresh} aria-label="Refresh"><RefreshCw className={cn(loading && 'animate-spin')} /></Button>
          </div>
        </div>
        {json?.summary && (
          <div className="flex flex-wrap gap-2 border-b border-gray-100 px-5 py-2.5 text-xs">
            <TaxPill label={`${json.summary.issue[type].pending.count} to issue · ${tk(json.summary.issue[type].pending.amount)}`} color="amber" />
            <TaxPill label={`${json.summary.issue[type].ready.count} ready now`} color="blue" />
            {json.summary.issue[type].overdue.count > 0 && <TaxPill label={`${json.summary.issue[type].overdue.count} overdue`} color="red" />}
            <TaxPill label={`${json.summary.issue[type].issued.count} issued`} color="green" />
          </div>
        )}
        {error ? <p className="px-5 py-6 text-sm text-red-600">{error}</p> : (
          <SelectTable
            columns={columns}
            rows={rows}
            selected={selected}
            onChange={setSelected}
            canSelect={canSelect}
            loading={loading}
            emptyIcon={CheckCircle2}
            emptyTitle={status === 'PENDING' ? copy.empty : 'No certificates'}
            emptyDescription={status === 'PENDING' ? copy.emptyHelp : undefined}
            onRowClick={r => setDetailId(r.id)}
          />
        )}
      </Card>

      <SelectionBar count={selectedRows.length} amount={sumAmount(selectedRows)} onClear={() => setSelected(new Set())}>
        {type === 'VDS' && allDepositPending && canDeposit && (
          <Button variant="outline" onClick={() => setDepositOpen(true)}><Landmark /> Deposit VDS</Button>
        )}
        {!numbered && canManage && (
          <Button variant="outline" onClick={() => setCertOpen(true)}><FileCheck /> Record issued manually</Button>
        )}
        {numbered ? (
          <Button onClick={() => print(false)}><Printer /> Reprint {numbered}</Button>
        ) : allReady && canManage ? (
          <>
            <Button variant="outline" onClick={() => print(true)}>Preview</Button>
            <Button onClick={() => print(false)}><Printer /> {copy.print}</Button>
          </>
        ) : (
          <Button onClick={() => print(true)} title={allReady ? 'You need the Manage tax permission to issue' : 'Some selected entries are not ready to be certified'}>
            <Printer /> Preview draft
          </Button>
        )}
      </SelectionBar>

      <CertificateModal open={certOpen} onOpenChange={setCertOpen} entries={selectedRows} onSaved={refresh} />
      <DepositModal open={depositOpen} onOpenChange={setDepositOpen} kind="VDS" entries={selectedRows} onSaved={refresh} />
      <TaxEntryDetailModal open={!!detailId} onOpenChange={(o) => { if (!o) setDetailId(null) }} entryId={detailId} onChanged={refresh} />
    </div>
  )
}
