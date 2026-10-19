'use client'

import { Suspense, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { Download, Plus, CreditCard, RefreshCw, ListChecks, Ban, Eye, Printer } from 'lucide-react'
import { usePermission } from '@/components/auth/Can'
import SearchInput from '@/components/ui/SearchInput'
import Pagination from '@/components/ui/Pagination'
import DataTable from '@/components/ui/DataTable'
import ActionMenu from '@/components/ui/ActionMenu'
import Button, { buttonVariants } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input, NativeSelect } from '@/components/ui/Input'
import PageHeader from '@/components/ui/PageHeader'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import TaxEntryFormModal, { MANUAL_ENTRY_TYPES } from '@/components/tax/TaxEntryFormModal'
import TaxEntryDetailModal from '@/components/tax/TaxEntryDetailModal'
import VoidEntryModal from '@/components/tax/VoidEntryModal'
import { EntryTypeBadge, CertificateBadge, DepositBadge, TaxPill } from '@/components/tax/TaxBadges'
import { useTaxData } from '@/components/tax/useTaxData'
import {
  tk, fmtDay, fmtPeriod, ENTRY_TYPE_OPTIONS, fiscalYearOptions,
  CERT_STATUS_META, DEPOSIT_STATUS_META,
} from '@/components/tax/taxUi'
import { cn } from '@/lib/utils'

const NOTE_ENTRY_TYPES = ['CREDIT_NOTE', 'DEBIT_NOTE']

/** Id of the Mushak-6.7 / 6.8 note behind a CREDIT_NOTE / DEBIT_NOTE entry (string or populated ref). */
function creditNoteIdOf(r) {
  const v = r?.creditNoteId
  if (!v) return null
  return typeof v === 'object' ? (v.id ?? v._id ?? null) : String(v)
}

const OPENING_OPTIONS = [
  { value: '', label: 'Opening & regular' },
  { value: '0', label: 'Exclude opening balances' },
  { value: '1', label: 'Opening balances only' },
]

function TaxLedger() {
  const router = useRouter()
  const sp = useSearchParams()
  const { can } = usePermission()
  const canManage = can('tax.manage')
  const canDeposit = can('tax.deposits.manage')
  const fyOptions = useMemo(() => fiscalYearOptions(5), [])

  const [search, setSearch] = useState('')
  const [entryType, setEntryType] = useState(() => {
    const t = sp.get('entryType')
    return ENTRY_TYPE_OPTIONS.some(o => o.value === t) ? t : ''
  })
  const [status, setStatus] = useState('ACTIVE')
  const [fy, setFy] = useState(sp.get('fiscalYear') ?? '')
  const [period, setPeriod] = useState(/^\d{4}-\d{2}$/.test(sp.get('period') ?? '') ? sp.get('period') : '')
  const [certificateStatus, setCertificateStatus] = useState('')
  const [depositStatus, setDepositStatus] = useState('')
  const [opening, setOpening] = useState('')
  const [page, setPage] = useState(1)

  const [formOpen, setFormOpen] = useState(false)
  const [formType, setFormType] = useState('VAT_ADJUSTMENT')
  const [detailId, setDetailId] = useState(sp.get('id'))
  const [voidRow, setVoidRow] = useState(null)

  // Deep links: ?new=advance | ?new=entry
  useEffect(() => {
    const n = sp.get('new')
    if (n === 'advance' && canDeposit) { setFormType('ADVANCE_TAX'); setFormOpen(true) }
    else if (n === 'entry' && canManage) { setFormType('VAT_ADJUSTMENT'); setFormOpen(true) }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canDeposit, canManage])

  const params = new URLSearchParams({ page: String(page), limit: '25', status })
  if (search) params.set('search', search)
  if (entryType) params.set('entryType', entryType)
  if (fy) params.set('fiscalYear', fy)
  if (period) params.set('period', period)
  if (certificateStatus) params.set('certificateStatus', certificateStatus)
  if (depositStatus) params.set('depositStatus', depositStatus)
  if (opening) params.set('isOpening', opening)
  const { json, loading, error, reload } = useTaxData(`/api/tax/entries?${params.toString()}`)
  const rows = json?.data ?? []

  const filterKey = [search, entryType, status, fy, period, certificateStatus, depositStatus, opening].join('|')
  const lastKey = useRef(filterKey)
  useEffect(() => {
    if (lastKey.current !== filterKey) { lastKey.current = filterKey; setPage(1) }
  }, [filterKey])

  const csvParams = new URLSearchParams(params)
  csvParams.delete('page'); csvParams.delete('limit'); csvParams.set('format', 'csv')

  const allowedTypes = MANUAL_ENTRY_TYPES.filter(t => can(t.perm)).map(t => t.value)
  const filtersActive = !!(search || entryType || status !== 'ACTIVE' || fy || period || certificateStatus || depositStatus || opening)

  function closeDetail(o) {
    if (o) return
    setDetailId(null)
    if (sp.get('id')) router.replace('/admin/tax/entries', { scroll: false })
  }

  const columns = [
    { key: 'date', label: 'Entry', render: r => (
      <div className="min-w-[110px]">
        <p className="font-mono text-xs text-gray-900">{r.entryNo}</p>
        <p className="text-xs text-muted-foreground">{fmtDay(r.date)} · {fmtPeriod(r.period)}</p>
      </div>
    ) },
    { key: 'type', label: 'Type', render: r => (
      <div className="space-y-1">
        <EntryTypeBadge type={r.entryType} />
        <div className="flex flex-wrap gap-1">
          {r.status === 'VOID' && <TaxPill label="Void" color="red" />}
          {r.isOpening && <TaxPill label="Opening" color="cyan" dot={false} />}
        </div>
      </div>
    ) },
    { key: 'party', label: 'Party / document', render: r => (
      <div className="min-w-[160px] max-w-[260px]">
        <p className="truncate text-gray-900">{r.partyName || (r.notes ? <span className="text-muted-foreground">{r.notes}</span> : '—')}</p>
        <p className="truncate text-xs text-muted-foreground">{[r.documentNo, r.section, r.partyBin && `BIN ${r.partyBin}`].filter(Boolean).join(' · ') || ' '}</p>
      </div>
    ) },
    { key: 'base', label: 'Base', className: 'text-right', cellClassName: 'text-right whitespace-nowrap tabular-nums text-gray-600', render: r => (r.baseAmount ? tk(r.baseAmount) : '—') },
    { key: 'rate', label: 'Rate', className: 'text-right', cellClassName: 'text-right whitespace-nowrap tabular-nums text-gray-600', render: r => (r.rate != null ? `${r.rate}%` : '—') },
    { key: 'amount', label: 'Tax', className: 'text-right', cellClassName: cn('text-right whitespace-nowrap tabular-nums font-semibold'), render: r => <span className={r.status === 'VOID' ? 'text-gray-400 line-through' : 'text-gray-900'}>{tk(r.amount)}</span> },
    { key: 'note', label: '9.1', render: r => (r.note != null ? <span className="text-xs tabular-nums text-muted-foreground">{r.note}</span> : <span className="text-xs text-gray-300">—</span>) },
    { key: 'track', label: 'Certificate / deposit', render: r => (
      <div className="flex flex-col items-start gap-1">
        {r.certificate?.status && r.certificate.status !== 'NOT_REQUIRED' && <CertificateBadge certificate={r.certificate} />}
        {r.deposit?.status && r.deposit.status !== 'NOT_REQUIRED' && <DepositBadge deposit={r.deposit} />}
      </div>
    ) },
    { key: 'actions', label: '', cellClassName: 'text-right', render: r => (
      <div onClick={e => e.stopPropagation()}>
        <ActionMenu items={[
          { label: 'View details', icon: Eye, onClick: () => setDetailId(r.id) },
          NOTE_ENTRY_TYPES.includes(r.entryType) && creditNoteIdOf(r) && {
            label: r.entryType === 'DEBIT_NOTE' ? 'Print Mushak-6.8' : 'Print Mushak-6.7',
            icon: Printer,
            onClick: () => window.open(`/api/credit-notes/${creditNoteIdOf(r)}/print`, '_blank', 'noopener'),
          },
          r.status === 'ACTIVE' && !r.isOpening && (['TDS_DEPOSIT', 'VAT_PAYMENT', 'ADVANCE_TAX'].includes(r.entryType) ? (canManage || canDeposit) : canManage) && {
            label: 'Void…', icon: Ban, danger: true, onClick: () => setVoidRow(r),
          },
        ].filter(Boolean)} />
      </div>
    ) },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Tax ledger"
        back="/admin/tax"
        backLabel="Tax & VAT"
        actions={
          <>
            <a href={`/api/tax/entries?${csvParams.toString()}`} className={buttonVariants({ variant: 'outline' })}><Download /> CSV</a>
            {canDeposit && (
              <Button variant="outline" onClick={() => { setFormType('ADVANCE_TAX'); setFormOpen(true) }}>
                <CreditCard /> Advance tax payment
              </Button>
            )}
            {canManage && (
              <Button onClick={() => { setFormType('VAT_ADJUSTMENT'); setFormOpen(true) }}>
                <Plus /> New entry
              </Button>
            )}
          </>
        }
      />

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search…" className="w-full sm:w-64" />
        <NativeSelect className="w-full sm:w-auto" value={entryType} onChange={e => setEntryType(e.target.value)} aria-label="Entry type">
          <option value="">All types</option>
          {ENTRY_TYPE_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </NativeSelect>
        <NativeSelect className="w-full sm:w-auto" value={fy} onChange={e => setFy(e.target.value)} aria-label="Income year">
          <option value="">All years</option>
          {fyOptions.map(f => <option key={f} value={f}>FY {f}</option>)}
        </NativeSelect>
        <Input type="month" className="w-full sm:w-40" value={period} onChange={e => setPeriod(e.target.value)} aria-label="Tax period" />
        <NativeSelect className="w-full sm:w-auto" value={certificateStatus} onChange={e => setCertificateStatus(e.target.value)} aria-label="Certificate status">
          <option value="">Any certificate</option>
          {Object.entries(CERT_STATUS_META).map(([k, m]) => <option key={k} value={k}>Certificate: {m.label}</option>)}
        </NativeSelect>
        <NativeSelect className="w-full sm:w-auto" value={depositStatus} onChange={e => setDepositStatus(e.target.value)} aria-label="Deposit status">
          <option value="">Any deposit</option>
          {Object.entries(DEPOSIT_STATUS_META).map(([k, m]) => <option key={k} value={k}>Deposit: {m.label}</option>)}
        </NativeSelect>
        <NativeSelect className="w-full sm:w-auto" value={opening} onChange={e => setOpening(e.target.value)} aria-label="Opening balances">
          {OPENING_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </NativeSelect>
        <NativeSelect className="w-full sm:w-auto" value={status} onChange={e => setStatus(e.target.value)} aria-label="Status">
          <option value="ACTIVE">Active</option>
          <option value="VOID">Void</option>
          <option value="all">Active &amp; void</option>
        </NativeSelect>
        {filtersActive && (
          <Button variant="ghost" onClick={() => {
            setSearch(''); setEntryType(''); setStatus('ACTIVE'); setFy(''); setPeriod(''); setCertificateStatus(''); setDepositStatus(''); setOpening('')
          }}>Reset</Button>
        )}
        <Button variant="outline" size="icon" className="ml-auto" onClick={reload} aria-label="Refresh" title="Refresh">
          <RefreshCw className={cn('size-4', loading && 'animate-spin')} />
        </Button>
      </div>

      <Card className="overflow-hidden">
        {json?.totals && (
          <div className="flex flex-wrap items-center gap-x-6 gap-y-1 border-b border-gray-100 px-4 py-3 text-[13px] text-muted-foreground">
            <span><span className="font-semibold tabular-nums text-gray-900">{json.totals.count}</span> entr{json.totals.count === 1 ? 'y' : 'ies'}</span>
            <span>Tax <span className="font-semibold tabular-nums text-gray-900">{tk(json.totals.amount)}</span></span>
            <span>Base <span className="font-semibold tabular-nums text-gray-900">{tk(json.totals.baseAmount)}</span></span>
            {!entryType && <span className="text-xs text-gray-400">Mixed types — filter by type for a meaningful sum</span>}
          </div>
        )}
        {error ? (
          <p className="px-4 py-6 text-sm text-red-600">{error}</p>
        ) : (
          <DataTable
            columns={columns}
            data={rows}
            loading={loading}
            emptyIcon={ListChecks}
            emptyTitle={filtersActive ? 'No results' : 'No tax entries yet'}
            emptyDescription={filtersActive
              ? 'Try another type, period or income year.'
              : 'Entries appear as invoices, payments and bills post.'}
            onRowClick={r => setDetailId(r.id)}
          />
        )}
        {json?.meta?.pages > 1 && <div className="border-t border-gray-100 px-4 py-3"><Pagination meta={json.meta} onPageChange={setPage} /></div>}
      </Card>

      <TaxEntryFormModal
        open={formOpen}
        onOpenChange={setFormOpen}
        initialType={formType}
        types={formType === 'ADVANCE_TAX' ? ['ADVANCE_TAX'] : allowedTypes}
        onSaved={(row) => { reload(); if (row?.id) setDetailId(row.id) }}
      />
      <TaxEntryDetailModal open={!!detailId} onOpenChange={closeDetail} entryId={detailId} onChanged={reload} />
      <VoidEntryModal open={!!voidRow} onOpenChange={(o) => { if (!o) setVoidRow(null) }} entry={voidRow} onSaved={reload} />
    </div>
  )
}

export default function TaxEntriesPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <TaxLedger />
    </Suspense>
  )
}
