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
  return (
    <span className={cn('inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium',
      debit ? 'bg-amber-50 text-amber-700' : 'bg-teal-50 text-teal-700')}>
      {debit ? <FilePlus className="w-3 h-3" /> : <FileMinus className="w-3 h-3" />}
      {debit ? 'Debit 6.8' : 'Credit 6.7'}
    </span>
  )
}

function StatusBadge({ status }) {
  const cancelled = status === 'CANCELLED'
  return (
    <span className={cn('inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full text-[11px] font-medium',
      cancelled ? 'bg-gray-100 text-gray-500' : 'bg-green-50 text-green-700')}>
      <span className={cn('w-1.5 h-1.5 rounded-full', cancelled ? 'bg-gray-400' : 'bg-green-500')} />
      {cancelled ? 'Cancelled' : 'Issued'}
    </span>
  )
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
        if (!res.ok) throw new Error(res.status === 403 ? 'You need permission to view invoices to pick one here — open the invoice instead.' : (json.error || 'Failed to search invoices'))
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
    <Modal open={open} onOpenChange={onOpenChange} title="New credit / debit note" description="Choose the issued invoice the note adjusts." size="lg">
      <div className="space-y-3">
        <div className="relative">
          <Search className="w-4 h-4 text-gray-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input autoFocus value={q} onChange={e => setQ(e.target.value)} placeholder="Invoice number or client…"
            className="w-full border border-gray-200 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gray-900" />
        </div>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {loading ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-gray-400" /></div>
        ) : rows.length === 0 && !error ? (
          <p className="text-sm text-gray-500 text-center py-8">{q ? 'No issued invoices match.' : 'No issued invoices yet.'}</p>
        ) : (
          <ul className="divide-y divide-gray-50 border border-gray-100 rounded-xl">
            {rows.map(r => (
              <li key={r.id} className="px-4 py-3 flex flex-wrap items-center gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-medium text-gray-900 font-mono">{r.invoiceNumber}</p>
                  <p className="text-xs text-gray-500 truncate">
                    {r.clientId?.company ?? r.clientId?.userId?.name ?? '—'} · {formatMoney(r.total, r.currency || 'BDT')}
                    {Number(r.due) > 0 ? ` · due ${formatMoney(r.due, r.currency || 'BDT')}` : ' · settled'}
                    {r.vatTreatment && r.vatTreatment !== 'NONE' ? ` · VAT ${r.vatTreatment.replace('_', ' ').toLowerCase()}` : ' · no VAT'}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <button type="button" onClick={() => pick(r, 'CREDIT')} disabled={!!picking}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                    {picking === `${r.id}:CREDIT` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FileMinus className="w-3.5 h-3.5" />} Credit
                  </button>
                  <button type="button" onClick={() => pick(r, 'DEBIT')} disabled={!!picking}
                    className="flex items-center gap-1 px-3 py-1.5 text-xs font-medium border border-gray-200 rounded-lg hover:bg-gray-50 disabled:opacity-50">
                    {picking === `${r.id}:DEBIT` ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <FilePlus className="w-3.5 h-3.5" />} Debit
                  </button>
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
      if (!res.ok) throw new Error(json.error || 'Failed to load notes')
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
          <p className="font-mono text-sm font-medium text-gray-900 whitespace-nowrap">{n.noteNo}</p>
          <KindBadge kind={n.kind} />
        </div>
      ),
    },
    {
      key: 'issuedAt', label: 'Issued', render: (n) => (
        <div className="whitespace-nowrap">
          <p className="text-sm text-gray-700">{fmtDate(n.issuedAt)}</p>
          <p className="text-xs text-gray-400">{fmtTime(n.issuedAt)}</p>
        </div>
      ),
    },
    {
      key: 'invoiceNumber', label: 'Invoice', render: (n) => {
        const id = n.invoiceId?.id ?? n.invoiceId?._id ?? (typeof n.invoiceId === 'string' ? n.invoiceId : null)
        return id ? (
          <Link href={`/admin/invoices/${id}`} className="font-mono text-sm text-blue-600 hover:text-blue-700 whitespace-nowrap">
            {n.invoiceNumber ?? n.invoiceId?.invoiceNumber ?? 'Invoice'}
          </Link>
        ) : <span className="text-sm text-gray-500">{n.invoiceNumber ?? '—'}</span>
      },
    },
    {
      key: 'client', label: 'Client', render: (n) => (
        <div className="min-w-[140px]">
          <p className="text-sm text-gray-800">{n.clientId?.company ?? n.buyer?.name ?? n.clientId?.userId?.name ?? '—'}</p>
          {n.buyer?.bin && <p className="text-xs text-gray-400">BIN {n.buyer.bin}</p>}
        </div>
      ),
    },
    {
      key: 'reason', label: 'Reason', render: (n) => (
        <div className="min-w-[140px] max-w-[240px]">
          <p className="text-sm text-gray-700">{reasonLabel(n.reason)}</p>
          {n.reasonText && <p className="text-xs text-gray-400 truncate" title={n.reasonText}>{n.reasonText}</p>}
        </div>
      ),
    },
    {
      key: 'vatAmount', label: 'VAT', render: (n) => (
        <span className="text-sm text-gray-700 whitespace-nowrap">{formatMoney(n.vatAmount, n.invoiceId?.currency || 'BDT')}</span>
      ),
    },
    {
      key: 'totalAmount', label: 'Total', render: (n) => (
        <div className="whitespace-nowrap text-right sm:text-left">
          <p className={cn('text-sm font-semibold', n.kind === 'DEBIT' ? 'text-amber-700' : 'text-teal-700')}>
            {n.kind === 'DEBIT' ? '+' : '−'}{formatMoney(n.totalAmount, n.invoiceId?.currency || 'BDT')}
          </p>
          <p className="text-xs text-gray-400">
            {n.kind === 'DEBIT' ? 'Added to invoice' : n.settlement === 'REFUND' ? `Refunded${n.refundAccountId?.name ? ` · ${n.refundAccountId.name}` : ''}` : 'Adjusted on invoice'}
          </p>
        </div>
      ),
    },
    { key: 'status', label: 'Status', render: (n) => <StatusBadge status={n.status} /> },
    {
      key: 'actions', label: '', render: (n) => (
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
    <div className="space-y-6 pb-10">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Credit &amp; debit notes</h1>
          <p className="text-sm text-gray-500">Mushak-6.7 / 6.8 issued against tax invoices. They adjust the invoice and the VAT return (notes 31 and 26).</p>
        </div>
        <div className="flex items-center gap-2">
          <a href={`/api/credit-notes?${queryString({ format: 'csv' })}`}
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-gray-200 rounded-lg hover:bg-gray-50 text-gray-700 bg-white">
            <Download className="w-4 h-4" /> CSV
          </a>
          {canManage && (
            <button type="button" onClick={() => setPickerOpen(true)}
              className="flex items-center gap-1.5 bg-gray-900 text-white hover:bg-gray-800 rounded-lg px-4 py-2 text-sm font-medium">
              <Plus className="w-4 h-4" /> New note
            </button>
          )}
        </div>
      </div>

      {invoiceFilter && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-blue-100 bg-blue-50/60 px-4 py-2.5 text-sm text-blue-800">
          <span>Showing notes of one invoice.</span>
          <Link href="/admin/tax/notes" className="flex items-center gap-1 text-xs font-medium hover:text-blue-900"><X className="w-3.5 h-3.5" /> Show all</Link>
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatsCard title="Credit notes issued" value={String(sumOf(credits, 'count'))} icon={FileMinus} color="teal"
          changeLabel={`VAT reduced ${bdt(sumOf(credits, 'vat'))}`} />
        <StatsCard title="Debit notes issued" value={String(sumOf(debits, 'count'))} icon={FilePlus} color="orange"
          changeLabel={`VAT increased ${bdt(sumOf(debits, 'vat'))}`} />
        <StatsCard title="Net VAT effect" value={`${netVat > 0 ? '+' : netVat < 0 ? '−' : ''}${bdt(Math.abs(netVat))}`} icon={Scale} color={netVat > 0 ? 'orange' : 'emerald'}
          changeLabel={foreignCount ? `BDT notes only · ${foreignCount} in other currencies` : 'On the VAT return (BDT)'} />
        <StatsCard title="Cancelled" value={String(cancelledCount)} icon={Ban} color="red" changeLabel="Reversed notes" />
      </div>

      <div className="bg-white border border-gray-100 rounded-xl p-4 flex flex-wrap items-center gap-3">
        <SearchInput value={filters.search} onChange={v => setFilter('search', v)} placeholder="Note no., invoice no., buyer…" className="w-full sm:w-64" />
        <FilterSelect value={filters.kind} onChange={v => setFilter('kind', v)} options={KIND_OPTIONS} placeholder="All types" />
        <FilterSelect value={filters.status} onChange={v => setFilter('status', v)} options={STATUS_OPTIONS} placeholder="Any status" />
        <FilterSelect value={filters.settlement} onChange={v => setFilter('settlement', v)} options={SETTLEMENT_OPTIONS} placeholder="Any settlement" />
        <div className="flex items-center gap-2">
          <DatePicker value={filters.startDate || null} onChange={v => setFilter('startDate', v)} placeholder="From" className="w-36" />
          <span className="text-gray-300">–</span>
          <DatePicker value={filters.endDate || null} onChange={v => setFilter('endDate', v)} placeholder="To" className="w-36" />
        </div>
        {hasFilters && (
          <button type="button" onClick={() => { setFilters(EMPTY_FILTERS); setPage(1) }} className="text-sm text-gray-500 hover:text-gray-800">Reset</button>
        )}
      </div>

      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        {error ? (
          <div className="px-6 py-10 text-center">
            <p className="text-sm text-red-600">{error}</p>
            <button type="button" onClick={load} className="mt-3 text-sm font-medium text-gray-700 hover:text-gray-900">Try again</button>
          </div>
        ) : (
          <DataTable
            columns={columns}
            data={rows}
            loading={loading}
            emptyIcon={FileMinus}
            emptyTitle={hasFilters ? 'No notes match these filters' : 'No credit or debit notes yet'}
            emptyDescription={hasFilters
              ? 'Clear the filters to see every note.'
              : 'Issue a credit note (discount, cancelled or returned supply) or a debit note (extra charge) from an issued invoice, or use “New note”.'}
          />
        )}
        {meta && meta.pages > 1 && (
          <div className="px-4 py-3 border-t border-gray-100">
            <Pagination meta={meta} onPageChange={setPage} />
          </div>
        )}
      </div>

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
