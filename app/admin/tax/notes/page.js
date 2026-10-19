'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  FileMinus, FilePlus, Printer, Copy, ExternalLink, Ban, Download, Plus, Search, Loader2, X, Scale,
} from 'lucide-react'
import DataTable from '@/components/ui/DataTable'
import Pagination from '@/components/ui/Pagination'
import SearchInput from '@/components/ui/SearchInput'
import FilterSelect from '@/components/ui/FilterSelect'
import DatePicker from '@/components/ui/DatePicker'
import ActionMenu from '@/components/ui/ActionMenu'
import StatsCard from '@/components/ui/StatsCard'
import Modal from '@/components/ui/Modal'
import Badge from '@/components/ui/Badge'
import Button, { buttonVariants } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { Input } from '@/components/ui/Input'
import PageHeader from '@/components/ui/PageHeader'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import { usePermission } from '@/components/auth/Can'
import { CREDIT_NOTE_REASONS } from '@/lib/tax/catalog'
import { formatMoney } from '@/lib/currencies'
import { cn } from '@/lib/utils'
import CreditNoteModal, { CancelNoteModal } from './_components/CreditNoteModal'

const KIND_OPTIONS = [
  { value: 'CREDIT', label: 'Credit notes (6.7)' },
  { value: 'DEBIT', label: 'Debit notes (6.8)' },
]
const STATUS_OPTIONS = [
  { value: 'ISSUED', label: 'Issued' },
  { value: 'CANCELLED', label: 'Cancelled' },
]
const SETTLEMENT_OPTIONS = [
  { value: 'ADJUST_INVOICE', label: 'Adjusted against invoice' },
  { value: 'REFUND', label: 'Refunded' },
]
const EMPTY_FILTERS = { search: '', kind: '', status: '', settlement: '', startDate: '', endDate: '' }

const fmtDate = (d) => (d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Dhaka' }) : '—')
const fmtTime = (d) => (d ? new Date(d).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit', hour12: true, timeZone: 'Asia/Dhaka' }) : '')
const reasonLabel = (v) => CREDIT_NOTE_REASONS.find(r => r.value === v)?.label ?? v
const bdt = (n) => formatMoney(n, 'BDT')

function KindBadge({ kind }) {
  const debit = kind === 'DEBIT'
  return <Badge variant={debit ? 'warning' : 'teal'}>{debit ? 'Debit 6.8' : 'Credit 6.7'}</Badge>
}

function StatusBadge({ status }) {
  const cancelled = status === 'CANCELLED'
  return <Badge variant={cancelled ? 'default' : 'success'} dot>{cancelled ? 'Cancelled' : 'Issued'}</Badge>
}

// ─── Invoice picker for a new note ─────────────────────────────────────────────

function InvoicePickerModal({ open, onOpenChange, onPick }) {
  const [q, setQ] = useState('')
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)
  const [picking, setPicking] = useState(null)

  useEffect(() => { if (open) { setQ(''); setRows([]); setError(null) } }, [open])

  useEffect(() => {
    if (!open) return undefined
    let alive = true
    const timer = setTimeout(async () => {
      setLoading(true)
      setError(null)
      try {
        const params = new URLSearchParams({ limit: '15', sort: 'createdAt', dir: 'desc' })
        if (q.trim()) params.set('search', q.trim())
        const res = await fetch(`/api/invoices?${params}`)
        const json = await res.json().catch(() => ({}))
        if (!res.ok) throw new Error(res.status === 403 ? 'You need permission to view invoices — open the invoice instead.' : (json.error || 'Couldn’t search invoices'))
        if (alive) setRows((json.data ?? []).filter(r => !['DRAFT', 'CANCELLED'].includes(r.status)))
      } catch (err) {
        if (alive) setError(err.message)
      } finally {
        if (alive) setLoading(false)
      }
    }, 300)
    return () => { alive = false; clearTimeout(timer) }
  }, [q, open])

  async function pick(row, kind) {
    setPicking(`${row.id}:${kind}`)
    try {
      const res = await fetch(`/api/invoices/${row.id}`)
      const json = await res.json().catch(() => ({}))
      onPick(res.ok ? json.data : row, kind)
    } catch {
      onPick(row, kind)
    } finally {
      setPicking(null)
    }
  }

  return (
    <Modal open={open} onOpenChange={onOpenChange} title="New credit / debit note" description="Pick an issued invoice." size="lg">
      <div className="space-y-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-gray-400" />
          <Input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Invoice no. or client…" className="pl-9" />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="size-5 animate-spin text-gray-400" /></div>
        ) : rows.length === 0 && !error ? (
          <p className="py-8 text-center text-sm text-muted-foreground">{q ? 'No results' : 'No issued invoices yet'}</p>
        ) : (
          <ul className="divide-y divide-gray-100 rounded-lg border border-gray-200/80">
            {rows.map(r => (
              <li key={r.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <p className="font-mono text-sm font-medium text-gray-900">{r.invoiceNumber}</p>
                  <p className="truncate text-xs text-muted-foreground">
                    {r.clientId?.company ?? r.clientId?.userId?.name ?? '—'} · {formatMoney(r.total, r.currency || 'BDT')}
                    {Number(r.due) > 0 ? ` · due ${formatMoney(r.due, r.currency || 'BDT')}` : ' · settled'}
                    {r.vatTreatment && r.vatTreatment !== 'NONE' ? ` · VAT ${r.vatTreatment.replace('_', ' ').toLowerCase()}` : ' · no VAT'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" size="xs" onClick={() => pick(r, 'CREDIT')} disabled={!!picking}>
                    {picking === `${r.id}:CREDIT` ? <Loader2 className="size-3.5 animate-spin" /> : <FileMinus className="size-3.5" />} Credit
                  </Button>
                  <Button variant="outline" size="xs" onClick={() => pick(r, 'DEBIT')} disabled={!!picking}>
                    {picking === `${r.id}:DEBIT` ? <Loader2 className="size-3.5 animate-spin" /> : <FilePlus className="size-3.5" />} Debit
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Modal>
  )
}

// ─── Page ──────────────────────────────────────────────────────────────────────

function NotesPageInner() {
  const searchParams = useSearchParams()
  const invoiceFilter = searchParams.get('invoiceId') || ''
  const { can } = usePermission()
  const canManage = can('tax.notes.manage')

  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [page, setPage] = useState(1)
  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState(null)
  const [summary, setSummary] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [pickerOpen, setPickerOpen] = useState(false)
  const [noteTarget, setNoteTarget] = useState(null)   // { invoice, kind }
  const [cancelTarget, setCancelTarget] = useState(null)
  const loadSeq = useRef(0)

  const queryString = useCallback((extra = {}) => {
    const p = new URLSearchParams()
    for (const [k, v] of Object.entries({ ...filters, ...extra })) if (v) p.set(k, String(v))
    if (invoiceFilter) p.set('invoiceId', invoiceFilter)
    return p.toString()
  }, [filters, invoiceFilter])

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/credit-notes?${queryString({ page, limit: 20 })}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Couldn’t load notes')
      if (seq !== loadSeq.current) return
      setRows(json.data ?? [])
      setMeta(json.meta ?? null)
      setSummary(json.summary ?? [])
    } catch (err) {
      if (seq === loadSeq.current) setError(err.message)
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [queryString, page])

  useEffect(() => { load() }, [load])

  const setFilter = (k, v) => { setFilters(f => ({ ...f, [k]: v ?? '' })); setPage(1) }
  const hasFilters = Object.values(filters).some(Boolean)

  const pick = (kind, status) => summary.filter(s => s.kind === kind && s.status === status && s.currency === 'BDT')
  const sumOf = (list, k) => list.reduce((s, r) => s + (Number(r[k]) || 0), 0)
  const credits = pick('CREDIT', 'ISSUED')
  const debits = pick('DEBIT', 'ISSUED')
  const cancelledCount = summary.filter(s => s.status === 'CANCELLED').reduce((s, r) => s + r.count, 0)
  const foreignCount = summary.filter(s => s.currency !== 'BDT' && s.status === 'ISSUED').reduce((s, r) => s + r.count, 0)
  const netVat = sumOf(debits, 'vat') - sumOf(credits, 'vat')

  const columns = [
    {
      key: 'noteNo', label: 'Note', render: (n) => (
        <div className="space-y-1">
          <p className="whitespace-nowrap font-mono text-sm font-medium text-gray-900">{n.noteNo}</p>
          <KindBadge kind={n.kind} />
        </div>
      ),
    },
    {
      key: 'issuedAt', label: 'Issued', render: (n) => (
        <div className="whitespace-nowrap">
          <p className="text-sm text-gray-700">{fmtDate(n.issuedAt)}</p>
          <p className="text-xs text-muted-foreground">{fmtTime(n.issuedAt)}</p>
        </div>
      ),
    },
    {
      key: 'invoiceNumber', label: 'Invoice', render: (n) => {
        const id = n.invoiceId?.id ?? n.invoiceId?._id ?? (typeof n.invoiceId === 'string' ? n.invoiceId : null)
        return id ? (
          <Link href={`/admin/invoices/${id}`} className="whitespace-nowrap font-mono text-sm font-medium text-gray-900 underline-offset-4 hover:underline">
            {n.invoiceNumber ?? n.invoiceId?.invoiceNumber ?? 'Invoice'}
          </Link>
        ) : <span className="text-sm text-muted-foreground">{n.invoiceNumber ?? '—'}</span>
      },
    },
    {
      key: 'client', label: 'Client', render: (n) => (
        <div className="min-w-[140px]">
          <p className="text-sm text-gray-900">{n.clientId?.company ?? n.buyer?.name ?? n.clientId?.userId?.name ?? '—'}</p>
          {n.buyer?.bin && <p className="text-xs text-muted-foreground">BIN {n.buyer.bin}</p>}
        </div>
      ),
    },
    {
      key: 'reason', label: 'Reason', render: (n) => (
        <div className="min-w-[140px] max-w-[240px]">
          <p className="text-sm text-gray-700">{reasonLabel(n.reason)}</p>
          {n.reasonText && <p className="truncate text-xs text-muted-foreground" title={n.reasonText}>{n.reasonText}</p>}
        </div>
      ),
    },
    {
      key: 'vatAmount', label: 'VAT', className: 'text-right [&>div]:justify-end', cellClassName: 'text-right', render: (n) => (
        <span className="whitespace-nowrap text-sm tabular-nums text-gray-700">{formatMoney(n.vatAmount, n.invoiceId?.currency || 'BDT')}</span>
      ),
    },
    {
      key: 'totalAmount', label: 'Total', className: 'text-right [&>div]:justify-end', cellClassName: 'text-right', render: (n) => (
        <div className="whitespace-nowrap">
          <p className={cn('text-sm font-medium tabular-nums', n.kind === 'DEBIT' ? 'text-amber-700' : 'text-teal-700')}>
            {n.kind === 'DEBIT' ? '+' : '−'}{formatMoney(n.totalAmount, n.invoiceId?.currency || 'BDT')}
          </p>
          <p className="text-xs text-muted-foreground">
            {n.kind === 'DEBIT' ? 'Added to invoice' : n.settlement === 'REFUND' ? `Refunded${n.refundAccountId?.name ? ` · ${n.refundAccountId.name}` : ''}` : 'Adjusted on invoice'}
          </p>
        </div>
      ),
    },
    { key: 'status', label: 'Status', render: (n) => <StatusBadge status={n.status} /> },
    {
      key: 'actions', label: '', cellClassName: 'text-right', render: (n) => (
        <ActionMenu items={[
          { label: 'Print (original)', icon: Printer, onClick: () => window.open(`/api/credit-notes/${n.id}/print`, '_blank', 'noopener') },
          { label: 'Print duplicate', icon: Copy, onClick: () => window.open(`/api/credit-notes/${n.id}/print?copy=duplicate`, '_blank', 'noopener') },
          (n.invoiceId?.id || n.invoiceId?._id) && { label: 'Open invoice', icon: ExternalLink, href: `/admin/invoices/${n.invoiceId.id ?? n.invoiceId._id}` },
          canManage && n.status === 'ISSUED' && { label: 'Cancel note', icon: Ban, danger: true, onClick: () => setCancelTarget(n) },
        ]} />
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Credit & debit notes"
        description="Mushak-6.7 / 6.8"
        actions={(
          <>
            <a href={`/api/credit-notes?${queryString({ format: 'csv' })}`} className={buttonVariants({ variant: 'outline' })}>
              <Download /> Export CSV
            </a>
            {canManage && (
              <Button onClick={() => setPickerOpen(true)}><Plus /> New note</Button>
            )}
          </>
        )}
      />

      {invoiceFilter && (
        <div className="flex items-center justify-between gap-3 rounded-lg border border-gray-200/80 bg-gray-50 px-3 py-2.5 text-sm text-gray-700">
          <span>Showing notes of one invoice</span>
          <Link href="/admin/tax/notes" className={buttonVariants({ variant: 'ghost', size: 'xs' })}><X /> Show all</Link>
        </div>
      )}

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatsCard title="Credit notes issued" value={String(sumOf(credits, 'count'))} icon={FileMinus} color="teal"
          changeLabel={`VAT reduced ${bdt(sumOf(credits, 'vat'))}`} />
        <StatsCard title="Debit notes issued" value={String(sumOf(debits, 'count'))} icon={FilePlus} color="orange"
          changeLabel={`VAT increased ${bdt(sumOf(debits, 'vat'))}`} />
        <StatsCard title="Net VAT effect" value={`${netVat > 0 ? '+' : netVat < 0 ? '−' : ''}${bdt(Math.abs(netVat))}`} icon={Scale} color={netVat > 0 ? 'orange' : 'emerald'}
          changeLabel={foreignCount ? `BDT only · ${foreignCount} in other currencies` : 'BDT notes'} />
        <StatsCard title="Cancelled" value={String(cancelledCount)} icon={Ban} color="red" />
      </div>

      <Card className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-2 border-b border-gray-100 p-3">
          <SearchInput value={filters.search} onChange={v => setFilter('search', v)} placeholder="Search…" className="w-full sm:w-64" />
          <FilterSelect value={filters.kind} onChange={v => setFilter('kind', v)} options={KIND_OPTIONS} placeholder="All types" />
          <FilterSelect value={filters.status} onChange={v => setFilter('status', v)} options={STATUS_OPTIONS} placeholder="Any status" />
          <FilterSelect value={filters.settlement} onChange={v => setFilter('settlement', v)} options={SETTLEMENT_OPTIONS} placeholder="Any settlement" />
          <div className="flex items-center gap-2">
            <DatePicker value={filters.startDate || null} onChange={v => setFilter('startDate', v)} placeholder="From" className="w-36" />
            <span className="text-gray-300">–</span>
            <DatePicker value={filters.endDate || null} onChange={v => setFilter('endDate', v)} placeholder="To" className="w-36" />
          </div>
          {hasFilters && (
            <Button variant="ghost" size="sm" className="ml-auto" onClick={() => { setFilters(EMPTY_FILTERS); setPage(1) }}>Reset</Button>
          )}
        </div>

        {error ? (
          <div className="px-6 py-10 text-center">
            <p className="text-sm text-red-600">{error}</p>
            <Button variant="outline" size="sm" className="mt-3" onClick={load}>Try again</Button>
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={rows}
            loading={loading}
            emptyIcon={FileMinus}
            emptyTitle={hasFilters ? 'No results' : 'No notes yet'}
            emptyDescription={hasFilters ? 'Try clearing the filters.' : 'Issue one from an invoice or with New note.'}
          />
        )}
        {meta && meta.pages > 1 && (
          <div className="border-t border-gray-100 px-4 py-3">
            <Pagination meta={meta} onPageChange={setPage} />
          </div>
        )}
      </Card>

      <InvoicePickerModal
        open={pickerOpen}
        onOpenChange={setPickerOpen}
        onPick={(invoice, kind) => { setPickerOpen(false); setNoteTarget({ invoice, kind }) }}
      />
      {noteTarget && (
        <CreditNoteModal
          open={!!noteTarget}
          onOpenChange={(v) => { if (!v) setNoteTarget(null) }}
          invoice={noteTarget.invoice}
          initialKind={noteTarget.kind}
          onIssued={() => { setPage(1); load() }}
        />
      )}
      {cancelTarget && (
        <CancelNoteModal
          open={!!cancelTarget}
          onOpenChange={(v) => { if (!v) setCancelTarget(null) }}
          note={cancelTarget}
          onCancelled={() => load()}
        />
      )}
    </div>
  )
}

export default function CreditDebitNotesPage() {
  return (
    <Suspense fallback={<PageLoader />}>
      <NotesPageInner />
    </Suspense>
  )
}
