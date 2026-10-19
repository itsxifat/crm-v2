'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Download, FileCheck, Printer, RefreshCw, Eye, FileSearch } from 'lucide-react'
import { usePermission } from '@/components/auth/Can'
import SearchInput from '@/components/ui/SearchInput'
import Pagination from '@/components/ui/Pagination'
import Button, { buttonVariants } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { NativeSelect } from '@/components/ui/Input'
import PageHeader from '@/components/ui/PageHeader'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import SelectTable, { SelectionBar } from '@/components/tax/SelectTable'
import CertificateModal from '@/components/tax/CertificateModal'
import TaxEntryDetailModal from '@/components/tax/TaxEntryDetailModal'
import { CertificateBadge, DepositBadge, DaysLeftBadge, TaxPill } from '@/components/tax/TaxBadges'
import toast from 'react-hot-toast'
import { useTaxData, usePrintThenReload, issueCertificateThenPrint } from '@/components/tax/useTaxData'
import {
  tk, fmtDay, fmtPeriod, sumAmount, partyKeyOf, fiscalYearOptions,
} from '@/components/tax/taxUi'
import { cn } from '@/lib/utils'

const DIRECTIONS = [
  { value: 'all', label: 'All certificates' },
  { value: 'collect', label: 'To collect (customers)' },
  { value: 'issue', label: 'To issue (suppliers / payees)' },
]
const TYPES = [
  { value: 'all', label: 'VDS & TDS' },
  { value: 'VDS', label: 'VDS — Mushak-6.6' },
  { value: 'TDS', label: 'TDS / AIT' },
]
const STATUSES = [
  { value: 'PENDING', label: 'Pending' },
  { value: 'DONE', label: 'Received / issued' },
  { value: 'NOT_REQUIRED', label: 'Not required' },
  { value: 'all', label: 'All' },
]

function SummaryCard({ title, pending, extra, href }) {
  return (
    <Link href={href} className="block rounded-xl border border-gray-200/80 bg-white p-5 shadow-xs transition-colors hover:border-gray-300">
      <p className="text-[13px] font-medium text-muted-foreground">{title}</p>
      <p className="mt-1.5 text-lg font-semibold tabular-nums text-gray-900">{pending?.count ?? 0} <span className="text-sm font-normal text-muted-foreground">· {tk(pending?.amount)}</span></p>
      <div className="mt-2 flex min-h-[20px] flex-wrap gap-1.5">{extra}</div>
    </Link>
  )
}

function CertificatesTracker() {
  const sp = useSearchParams()
  const { can } = usePermission()
  const canManage = can('tax.manage')
  const fyOptions = useMemo(() => fiscalYearOptions(5), [])

  const [direction, setDirection] = useState(['collect', 'issue'].includes(sp.get('direction')) ? sp.get('direction') : 'all')
  const [type, setType] = useState(['VDS', 'TDS'].includes(sp.get('type')) ? sp.get('type') : 'all')
  const [status, setStatus] = useState(STATUSES.some(s => s.value === sp.get('status')) ? sp.get('status') : 'PENDING')
  const [fy, setFy] = useState('')
  const [search, setSearch] = useState('')
  const [page, setPage] = useState(1)
  const [selected, setSelected] = useState(new Set())

  const params = new URLSearchParams({ direction, type, status, page: String(page), limit: '50' })
  if (fy) params.set('fiscalYear', fy)
  if (search) params.set('search', search)
  const { json, loading, error, reload } = useTaxData(`/api/tax/certificates?${params.toString()}`)
  const rows = useMemo(() => json?.data ?? [], [json])
  const summary = json?.summary

  // Reset paging & selection when filters change
  const filterKey = [direction, type, status, fy, search].join('|')
  const lastKey = useRef(filterKey)
  useEffect(() => {
    if (lastKey.current !== filterKey) { lastKey.current = filterKey; setPage(1); setSelected(new Set()) }
  }, [filterKey])

  const [certOpen, setCertOpen] = useState(false)
  const [detailId, setDetailId] = useState(null)
  const refresh = () => { setSelected(new Set()); reload() }
  const printDoc = usePrintThenReload(refresh)

  const selectedRows = rows.filter(r => selected.has(r.id))
  const first = selectedRows[0]
  const numbered = selectedRows.find(r => r.certificate?.number)?.certificate?.number ?? null
  const canSelect = (row, sel) => {
    if (!sel.length) return true
    if (row.entryType !== sel[0].entryType) return 'Select one kind of certificate at a time'
    if (partyKeyOf(row) !== partyKeyOf(sel[0])) return 'One certificate covers one party'
    if (row.direction === 'ISSUE' && (row.certificate?.number ?? null) !== (sel[0].certificate?.number ?? null)) return 'Part of a different certificate'
    return true
  }

  async function print(preview) {
    const ids = numbered ? rows.filter(r => r.certificate?.number === numbered).map(r => r.id) : selectedRows.map(r => r.id)
    const kind = first.certType.toLowerCase()
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

  const csvParams = new URLSearchParams(params)
  csvParams.delete('page'); csvParams.delete('limit'); csvParams.set('format', 'csv')

  const columns = [
    { key: 'date', label: 'Deducted', render: r => <div><p className="whitespace-nowrap text-gray-900">{fmtDay(r.date)}</p><p className="font-mono text-xs text-muted-foreground">{r.entryNo}</p></div> },
    { key: 'kind', label: 'Certificate', render: r => (
      <div className="space-y-0.5">
        <TaxPill label={r.direction === 'COLLECT' ? 'Collect' : 'Issue'} color={r.direction === 'COLLECT' ? 'indigo' : 'orange'} dot={false} />
        <p className="whitespace-nowrap text-xs text-muted-foreground">{r.certType === 'VDS' ? 'Mushak-6.6 (VDS)' : r.direction === 'COLLECT' ? 'TDS / AIT certificate' : 'TDS certificate'}</p>
      </div>
    ) },
    { key: 'party', label: 'Party', render: r => (
      <div className="min-w-[150px]">
        <p className="font-medium text-gray-900">{r.partyName || '—'}</p>
        <p className="font-mono text-xs text-muted-foreground">{r.certType === 'VDS' ? (r.partyBin ? `BIN ${r.partyBin}` : '') : (r.partyTin ? `TIN ${r.partyTin}` : '')}</p>
      </div>
    ) },
    { key: 'doc', label: 'Document', render: r => <span className="text-xs text-gray-600">{r.documentNo || '—'}</span> },
    { key: 'amount', label: 'Withheld', className: 'text-right', cellClassName: 'text-right whitespace-nowrap tabular-nums font-semibold text-gray-900', render: r => tk(r.amount) },
    { key: 'cert', label: 'Status', render: r => (
      <div className="space-y-0.5">
        <CertificateBadge certificate={r.certificate} />
        {r.certificate?.number && <p className="font-mono text-xs text-gray-600">{r.certificate.number}</p>}
      </div>
    ) },
    { key: 'due', label: 'Due / claim by', render: r => {
      if (r.certificate?.status !== 'PENDING' || !r.due) return <span className="text-xs text-gray-400">{r.certificate?.date ? fmtDay(r.certificate.date) : '—'}</span>
      if (r.due.kind === 'PERIOD') return <TaxPill label={r.due.overdue ? `Expired ${fmtPeriod(r.due.period)}` : `Claim by ${fmtPeriod(r.due.period)}`} color={r.due.overdue ? 'red' : 'gray'} dot={!!r.due.overdue} />
      return <div className="whitespace-nowrap"><p className="text-gray-700">{fmtDay(r.due.date)}</p><DaysLeftBadge daysLeft={r.due.daysLeft} /></div>
    } },
    { key: 'deposit', label: 'Deposit', render: r => r.direction === 'ISSUE' ? <DepositBadge deposit={r.deposit} /> : <span className="text-xs text-gray-300">—</span> },
    { key: 'view', label: '', cellClassName: 'text-right', render: r => (
      <Button variant="ghost" size="icon-sm" className="text-gray-500" onClick={(e) => { e.stopPropagation(); setDetailId(r.id) }} aria-label="View entry" title="View entry"><Eye /></Button>
    ) },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Certificates"
        back="/admin/tax"
        backLabel="Tax & VAT"
        actions={
          <>
            <a href={`/api/tax/certificates?${csvParams.toString()}`} className={buttonVariants({ variant: 'outline' })}><Download /> CSV</a>
            <Button variant="outline" size="icon" onClick={refresh} aria-label="Refresh" title="Refresh">
              <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
            </Button>
          </>
        }
      />

      {summary && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <SummaryCard title="Mushak-6.6 to collect" pending={summary.collect.VDS.pending} href="/admin/tax/withholding?tab=vds-receivable"
            extra={<>
              {summary.collect.VDS.expiring.count > 0 && <TaxPill label={`${summary.collect.VDS.expiring.count} expiring`} color="orange" />}
              {summary.collect.VDS.expired.count > 0 && <TaxPill label={`${summary.collect.VDS.expired.count} expired`} color="red" />}
            </>} />
          <SummaryCard title="TDS certificates to collect" pending={summary.collect.TDS.pending} href="/admin/tax/withholding?tab=ait"
            extra={<TaxPill label={`${summary.collect.TDS.received.count} received`} color="green" />} />
          <SummaryCard title="Mushak-6.6 to issue" pending={summary.issue.VDS.pending} href="/admin/tax/withholding?tab=vds-issue"
            extra={<>
              {summary.issue.VDS.ready.count > 0 && <TaxPill label={`${summary.issue.VDS.ready.count} ready`} color="blue" />}
              {summary.issue.VDS.overdue.count > 0 && <TaxPill label={`${summary.issue.VDS.overdue.count} overdue`} color="red" />}
            </>} />
          <SummaryCard title="TDS certificates to issue" pending={summary.issue.TDS.pending} href="/admin/tax/withholding?tab=tds-certs"
            extra={<>
              {summary.issue.TDS.ready.count > 0 && <TaxPill label={`${summary.issue.TDS.ready.count} ready`} color="blue" />}
              {summary.issue.TDS.overdue.count > 0 && <TaxPill label={`${summary.issue.TDS.overdue.count} overdue`} color="red" />}
            </>} />
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search…" className="w-full sm:w-64" />
        <NativeSelect className="w-full sm:w-auto" value={direction} onChange={e => setDirection(e.target.value)} aria-label="Direction">
          {DIRECTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </NativeSelect>
        <NativeSelect className="w-full sm:w-auto" value={type} onChange={e => setType(e.target.value)} aria-label="Type">
          {TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </NativeSelect>
        <NativeSelect className="w-full sm:w-auto" value={status} onChange={e => setStatus(e.target.value)} aria-label="Status">
          {STATUSES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </NativeSelect>
        <NativeSelect className="w-full sm:w-auto" value={fy} onChange={e => setFy(e.target.value)} aria-label="Income year">
          <option value="">All income years</option>
          {fyOptions.map(f => <option key={f} value={f}>FY {f}</option>)}
        </NativeSelect>
        {(direction !== 'all' || type !== 'all' || status !== 'PENDING' || fy || search) && (
          <Button variant="ghost" onClick={() => { setDirection('all'); setType('all'); setStatus('PENDING'); setFy(''); setSearch('') }}>Reset</Button>
        )}
      </div>

      <Card className="overflow-hidden">
        {error ? <p className="px-4 py-6 text-sm text-red-600">{error}</p> : (
          <SelectTable
            columns={columns}
            rows={rows}
            selected={selected}
            onChange={setSelected}
            canSelect={canSelect}
            loading={loading}
            emptyIcon={FileSearch}
            emptyTitle={status === 'PENDING' ? 'No certificates pending' : 'No results'}
            emptyDescription={status === 'PENDING' ? 'Every deduction has its certificate.' : 'Try another filter or income year.'}
            onRowClick={r => setDetailId(r.id)}
          />
        )}
        {json?.meta?.pages > 1 && <div className="border-t border-gray-100 px-4 py-3"><Pagination meta={json.meta} onPageChange={setPage} /></div>}
      </Card>

      <SelectionBar count={selectedRows.length} amount={sumAmount(selectedRows)} onClear={() => setSelected(new Set())}>
        {first?.direction === 'COLLECT' && canManage && (
          <Button size="sm" onClick={() => setCertOpen(true)}><FileCheck /> Record certificate</Button>
        )}
        {first?.direction === 'ISSUE' && (
          <>
            {!numbered && canManage && <Button variant="outline" size="sm" onClick={() => setCertOpen(true)}><FileCheck /> Record issued manually</Button>}
            {numbered
              ? <Button size="sm" onClick={() => print(false)}><Printer /> Reprint {numbered}</Button>
              : selectedRows.every(r => r.readiness?.ready) && canManage
                ? <Button size="sm" onClick={() => print(false)}><Printer /> Issue certificate</Button>
                : <Button size="sm" onClick={() => print(true)}><Printer /> Preview draft</Button>}
          </>
        )}
      </SelectionBar>

      <CertificateModal open={certOpen} onOpenChange={setCertOpen} entries={selectedRows} onSaved={refresh} />
      <TaxEntryDetailModal open={!!detailId} onOpenChange={(o) => { if (!o) setDetailId(null) }} entryId={detailId} onChanged={refresh} />
    </div>
  )
}

export default function CertificatesPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <CertificatesTracker />
    </Suspense>
  )
}
