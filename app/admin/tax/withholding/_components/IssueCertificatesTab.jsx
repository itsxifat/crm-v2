'use client'

import { useMemo, useState } from 'react'
import { Printer, FileCheck, Landmark, Eye, RefreshCw, CheckCircle2 } from 'lucide-react'
import { usePermission } from '@/components/auth/Can'
import SelectTable, { SelectionBar } from '@/components/tax/SelectTable'
import DepositModal from '@/components/tax/DepositModal'
import CertificateModal from '@/components/tax/CertificateModal'
import TaxEntryDetailModal from '@/components/tax/TaxEntryDetailModal'
import { CertificateBadge, DepositBadge, DaysLeftBadge, TaxPill } from '@/components/tax/TaxBadges'
import toast from 'react-hot-toast'
import { useTaxData, usePrintThenReload, issueCertificateThenPrint } from '@/components/tax/useTaxData'
import { tk, fmtDay, btnPrimary, btnGhost, sumAmount, cardCls, partyKeyOf } from '@/components/tax/taxUi'
import { cn } from '@/lib/utils'

const STATUS_TABS = [
  { value: 'PENDING', label: 'To issue' },
  { value: 'ISSUED', label: 'Issued' },
  { value: 'all', label: 'All' },
]

const COPY = {
  VDS: {
    title: 'VDS deducted from suppliers',
    help: 'Issue Mushak-6.6 to each supplier — registered withholders within 3 working days after filing the VAT return; unregistered withholders within 3 working days after depositing the VDS.',
    print: 'Issue Mushak-6.6',
    empty: 'No VDS deductions waiting for a Mushak-6.6',
    emptyHelp: 'VAT you withhold when paying VAT-registered suppliers appears here.',
  },
  TDS: {
    title: 'TDS certificates to issue',
    help: 'Issue a certificate (Tofsil-2; Tofsil-1 for salary under s.86) for tax deducted from each payee within two weeks after the month of deduction, once the TDS is deposited.',
    print: 'Issue TDS certificate',
    empty: 'No TDS certificates waiting',
    emptyHelp: 'Deductions appear here when you withhold income tax from a payment.',
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
    { key: 'date', label: 'Deducted', render: r => <div><p className="text-gray-900 whitespace-nowrap">{fmtDay(r.date)}</p><p className="text-[11px] font-mono text-gray-400">{r.entryNo}</p></div> },
    { key: 'party', label: type === 'VDS' ? 'Supplier' : 'Payee', render: r => (
      <div className="min-w-[150px]">
        <p className="font-medium text-gray-900">{r.partyName || '—'}</p>
        <p className="text-[11px] text-gray-500 font-mono">{type === 'VDS' ? (r.partyBin ? `BIN ${r.partyBin}` : 'No BIN') : (r.partyTin ? `TIN ${r.partyTin}` : 'No TIN')}</p>
      </div>
    ) },
    { key: 'doc', label: type === 'VDS' ? 'Invoice' : 'Reference', render: r => <span className="text-xs text-gray-600">{r.documentNo || '—'}</span> },
    { key: 'code', label: type === 'VDS' ? 'Service' : 'Section', render: r => <span className="font-mono text-xs">{(type === 'VDS' ? r.serviceCode : r.section) || '—'}</span> },
    { key: 'base', label: 'Value', className: 'text-right', cellClassName: 'text-right whitespace-nowrap', render: r => tk(r.baseAmount) },
    { key: 'amount', label: type === 'VDS' ? 'VDS' : 'TDS', className: 'text-right', cellClassName: 'text-right whitespace-nowrap font-semibold text-gray-900', render: r => tk(r.amount) },
    { key: 'deposit', label: 'Deposit', render: r => <div className="space-y-0.5"><DepositBadge deposit={r.deposit} />{r.deposit?.challanNo && <p className="text-[11px] font-mono text-gray-500">{r.deposit.challanNo}</p>}</div> },
    { key: 'cert', label: 'Certificate', render: r => (
      <div className="space-y-0.5">
        <CertificateBadge certificate={r.certificate} />
        {r.certificate?.number && <p className="text-[11px] font-mono text-gray-600">{r.certificate.number}</p>}
        {r.certificate?.status === 'PENDING' && r.readiness && !r.readiness.ready && <p className="text-[11px] text-amber-700 max-w-[200px]">{r.readiness.reason}</p>}
      </div>
    ) },
    { key: 'due', label: 'Issue by', render: r => r.due && r.certificate?.status === 'PENDING'
      ? <div className="whitespace-nowrap"><p className="text-gray-700">{fmtDay(r.due.date)}</p><DaysLeftBadge daysLeft={r.due.daysLeft} /></div>
      : <span className="text-xs text-gray-400">{r.certificate?.date ? fmtDay(r.certificate.date) : '—'}</span> },
    { key: 'view', label: '', cellClassName: 'text-right', render: r => (
      <button type="button" className="p-1.5 rounded-lg text-gray-400 hover:text-gray-700 hover:bg-gray-100" onClick={(e) => { e.stopPropagation(); setDetailId(r.id) }} aria-label="View entry"><Eye className="w-4 h-4" /></button>
    ) },
  ]

  return (
    <div className="space-y-4">
      <div className={cardCls}>
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 border-b border-gray-100">
          <div className="max-w-2xl">
            <h3 className="text-sm font-semibold text-gray-900">{copy.title}</h3>
            <p className="text-xs text-gray-500">{copy.help}</p>
            {type === 'VDS' && !registered && <p className="mt-1 text-xs text-amber-700">Your company is not VAT registered: deposit VDS by challan within 15 days of paying the supplier, then issue the 6.6.</p>}
          </div>
          <div className="flex items-center gap-2">
            <div className="inline-flex rounded-lg border border-gray-200 p-0.5 bg-gray-50">
              {STATUS_TABS.map(s => (
                <button key={s.value} type="button" onClick={() => { setStatus(s.value); setSelected(new Set()) }}
                  className={cn('px-3 py-1.5 text-xs font-medium rounded-md', status === s.value ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-800')}>
                  {s.label}
                </button>
              ))}
            </div>
            <button type="button" className={btnGhost} onClick={refresh} aria-label="Refresh"><RefreshCw className={cn('w-4 h-4', loading && 'animate-spin')} /></button>
          </div>
        </div>
        {json?.summary && (
          <div className="flex flex-wrap gap-2 px-4 py-2.5 border-b border-gray-50 text-xs">
            <TaxPill label={`${json.summary.issue[type].pending.count} to issue · ${tk(json.summary.issue[type].pending.amount)}`} color="amber" />
            <TaxPill label={`${json.summary.issue[type].ready.count} ready now`} color="blue" />
            {json.summary.issue[type].overdue.count > 0 && <TaxPill label={`${json.summary.issue[type].overdue.count} overdue`} color="red" />}
            <TaxPill label={`${json.summary.issue[type].issued.count} issued`} color="green" />
          </div>
        )}
        {error ? <p className="px-4 py-6 text-sm text-red-600">{error}</p> : (
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
      </div>

      <SelectionBar count={selectedRows.length} amount={sumAmount(selectedRows)} onClear={() => setSelected(new Set())}>
        {type === 'VDS' && allDepositPending && canDeposit && (
          <button type="button" className={btnGhost} onClick={() => setDepositOpen(true)}><Landmark className="w-4 h-4" /> Deposit VDS</button>
        )}
        {!numbered && canManage && (
          <button type="button" className={btnGhost} onClick={() => setCertOpen(true)}><FileCheck className="w-4 h-4" /> Record issued manually</button>
        )}
        {numbered ? (
          <button type="button" className={btnPrimary} onClick={() => print(false)}><Printer className="w-4 h-4" /> Reprint {numbered}</button>
        ) : allReady && canManage ? (
          <>
            <button type="button" className={btnGhost} onClick={() => print(true)}>Preview</button>
            <button type="button" className={btnPrimary} onClick={() => print(false)}><Printer className="w-4 h-4" /> {copy.print}</button>
          </>
        ) : (
          <button type="button" className={btnPrimary} onClick={() => print(true)} title={allReady ? 'You need the Manage tax permission to issue' : 'Some selected entries are not ready to be certified'}>
            <Printer className="w-4 h-4" /> Preview draft
          </button>
        )}
      </SelectionBar>

      <CertificateModal open={certOpen} onOpenChange={setCertOpen} entries={selectedRows} onSaved={refresh} />
      <DepositModal open={depositOpen} onOpenChange={setDepositOpen} kind="VDS" entries={selectedRows} onSaved={refresh} />
      <TaxEntryDetailModal open={!!detailId} onOpenChange={(o) => { if (!o) setDetailId(null) }} entryId={detailId} onChanged={refresh} />
    </div>
  )
}
