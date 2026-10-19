'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Plus, ShoppingCart, FileClock, Send, AlertCircle, PackageCheck, Eye, X, RotateCcw,
} from 'lucide-react'
import DataTable from '@/components/ui/DataTable'
import Pagination from '@/components/ui/Pagination'
import SearchInput from '@/components/ui/SearchInput'
import FilterSelect from '@/components/ui/FilterSelect'
import DatePicker from '@/components/ui/DatePicker'
import StatsCard from '@/components/ui/StatsCard'
import ActionMenu from '@/components/ui/ActionMenu'
import EmptyState from '@/components/ui/EmptyState'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import { Can, usePermission } from '@/components/auth/Can'
import { formatDate } from '@/lib/utils'
import { BillStatusBadge, PaymentStatusBadge } from './_components/badges'
import { tk, qtyText } from './_components/billMath'

const STATUS_OPTIONS = [
  { value: 'DRAFT', label: 'Draft' },
  { value: 'RECEIVED', label: 'Received' },
  { value: 'CANCELLED', label: 'Cancelled' },
]

const PAYMENT_OPTIONS = [
  { value: 'UNPAID', label: 'Unpaid' },
  { value: 'REQUESTED', label: 'With Accounts' },
  { value: 'PAID', label: 'Paid' },
]

function lineSummary(lines = []) {
  let assets = 0
  let stock = 0
  let expense = 0
  for (const l of lines) {
    if (l.lineType === 'ASSET') assets += Number(l.qty) || 0
    else if (l.lineType === 'CONSUMABLE') stock += 1
    else expense += 1
  }
  return [
    assets ? `${qtyText(assets)} asset${assets === 1 ? '' : 's'}` : null,
    stock ? `${stock} stock` : null,
    expense ? `${expense} expense` : null,
  ].filter(Boolean).join(' · ') || '—'
}

function StatValue({ count, amount, amountFirst = false }) {
  if (count === undefined || count === null) return <span className="text-gray-300">—</span>
  if (amountFirst) {
    return (
      <span>
        {tk(amount, 0)}
        <span className="block text-xs font-normal text-gray-400">{count} bill{count === 1 ? '' : 's'}</span>
      </span>
    )
  }
  return (
    <span>
      {count}
      {count > 0 && <span className="block text-xs font-normal text-gray-400">{tk(amount, 0)}</span>}
    </span>
  )
}

function PurchasesPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { can } = usePermission()
  const vendorId = searchParams.get('vendorId') || ''

  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState(null)
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [vendorName, setVendorName] = useState(null)

  const [search, setSearch] = useState('')
  const [status, setStatus] = useState(searchParams.get('status') || '')
  const [paymentStatus, setPaymentStatus] = useState(searchParams.get('paymentStatus') || '')
  const [startDate, setStartDate] = useState(null)
  const [endDate, setEndDate] = useState(null)
  const [page, setPage] = useState(1)
  const loadSeq = useRef(0)

  const filterKey = JSON.stringify({ search, status, paymentStatus, startDate, endDate, vendorId })
  const lastKey = useRef(filterKey)
  useEffect(() => {
    if (lastKey.current !== filterKey) {
      lastKey.current = filterKey
      setPage(1)
    }
  }, [filterKey])

  const load = useCallback(async () => {
    const seq = ++loadSeq.current
    setLoading(true)
    setError(null)
    try {
      const qs = new URLSearchParams({ page: String(page), limit: '20', summary: '1' })
      if (search) qs.set('search', search)
      if (status) qs.set('status', status)
      if (paymentStatus) qs.set('paymentStatus', paymentStatus)
      if (startDate) qs.set('startDate', startDate)
      if (endDate) qs.set('endDate', endDate)
      if (vendorId) qs.set('vendorId', vendorId)
      const res = await fetch(`/api/inventory/purchases?${qs}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Failed to load purchase bills')
      if (seq !== loadSeq.current) return
      setRows(json.data ?? [])
      setMeta(json.meta ?? null)
      setSummary(json.summary ?? null)
      if (vendorId && json.data?.[0]?.vendorName) setVendorName(json.data[0].vendorName)
    } catch (err) {
      if (seq === loadSeq.current) setError(err.message)
    } finally {
      if (seq === loadSeq.current) setLoading(false)
    }
  }, [page, search, status, paymentStatus, startDate, endDate, vendorId])

  useEffect(() => { load() }, [load])

  // Vendor name for the filter chip when the vendor has no bills on this page.
  useEffect(() => {
    if (!vendorId) { setVendorName(null); return }
    let alive = true
    fetch(`/api/vendors/${vendorId}`).then(r => r.json().then(j => ({ ok: r.ok, j }))).then(({ ok, j }) => {
      if (alive && ok && j.data?.company) setVendorName(j.data.company)
    }).catch(() => {})
    return () => { alive = false }
  }, [vendorId])

  const hasFilters = Boolean(search || status || paymentStatus || startDate || endDate)
  function resetFilters() {
    setSearch('')
    setStatus('')
    setPaymentStatus('')
    setStartDate(null)
    setEndDate(null)
  }

  function clearVendor() {
    const qs = new URLSearchParams(searchParams.toString())
    qs.delete('vendorId')
    router.replace(`/admin/inventory/purchases${qs.toString() ? `?${qs}` : ''}`)
  }

  const newHref = vendorId ? `/admin/inventory/purchases/new?vendorId=${vendorId}` : '/admin/inventory/purchases/new'

  const columns = [
    {
      key: 'billNo', label: 'Bill', sortable: true,
      render: (b) => (
        <div>
          <Link href={`/admin/inventory/purchases/${b.id}`} className="font-medium text-gray-900 hover:underline" onClick={e => e.stopPropagation()}>
            {b.billNo ?? 'Draft'}
          </Link>
          <p className="text-xs text-gray-400">{b.billDay ? formatDate(b.billDay) : '—'}</p>
        </div>
      ),
    },
    {
      key: 'vendorName', label: 'Supplier', sortable: true,
      render: (b) => (
        <div className="min-w-[160px]">
          <p className="text-gray-900">{b.vendorName ?? '—'}</p>
          <p className="text-xs text-gray-400">
            {[b.supplierInvoiceNo ? `Inv ${b.supplierInvoiceNo}` : null, b.mushakNo ? `Mushak ${b.mushakNo}` : null].filter(Boolean).join(' · ') || 'No invoice no.'}
          </p>
        </div>
      ),
    },
    { key: 'lines', label: 'Items', render: (b) => <span className="text-gray-600 whitespace-nowrap">{lineSummary(b.lines)}</span> },
    { key: 'total', label: 'Total', sortable: true, render: (b) => <span className="whitespace-nowrap">{tk(b.total, 0)}</span> },
    {
      key: 'netPayable', label: 'Net payable', sortable: true,
      render: (b) => (
        <div className="whitespace-nowrap">
          <span className="font-medium text-gray-900">{tk(b.netPayable, 0)}</span>
          {(Number(b.tds?.amount) || 0) + (Number(b.vds?.amount) || 0) > 0 && <p className="text-[11px] text-gray-400">after VDS/TDS</p>}
        </div>
      ),
    },
    { key: 'status', label: 'Status', render: (b) => <BillStatusBadge status={b.status} /> },
    { key: 'payment', label: 'Payment', render: (b) => <PaymentStatusBadge bill={b} /> },
    {
      key: 'actions', label: '', className: 'w-10',
      render: (b) => (
        <div onClick={e => e.stopPropagation()}>
          <ActionMenu items={[
            { label: 'Open', icon: Eye, href: `/admin/inventory/purchases/${b.id}` },
            b.status === 'DRAFT' && can('inventory.purchase') && { label: 'Receive…', icon: PackageCheck, href: `/admin/inventory/purchases/${b.id}?receive=1` },
          ].filter(Boolean)} />
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Purchases</h1>
          <p className="text-sm text-gray-500">Supplier bills — receive assets and stock, then pay or send to Accounts.</p>
        </div>
        <Can perm="inventory.purchase">
          <Link href={newHref} className="inline-flex items-center gap-1.5 bg-gray-900 text-white hover:bg-gray-800 rounded-lg px-4 py-2 text-sm font-medium">
            <Plus className="w-4 h-4" /> New purchase bill
          </Link>
        </Can>
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <StatsCard title="Drafts" icon={FileClock} color="yellow"
          value={<StatValue count={summary?.drafts} amount={summary?.draftAmount} />} />
        <StatsCard title="With Accounts" icon={Send} color="blue"
          value={<StatValue count={summary?.requested} amount={summary?.requestedAmount} />} />
        <StatsCard title="Unpaid" icon={AlertCircle} color="red"
          value={<StatValue count={summary?.unpaid} amount={summary?.unpaidAmount} />} />
        <StatsCard title="Received this month" icon={ShoppingCart} color="green"
          value={<StatValue count={summary?.monthCount} amount={summary?.monthAmount} amountFirst />} />
      </div>

      <div className="bg-white border border-gray-100 rounded-xl p-4 flex flex-wrap items-center gap-3">
        <SearchInput value={search} onChange={setSearch} placeholder="Bill no., supplier, invoice, item…" className="w-full sm:w-64" />
        <FilterSelect value={status} onChange={v => setStatus(v ?? '')} options={STATUS_OPTIONS} placeholder="All statuses" />
        <FilterSelect value={paymentStatus} onChange={v => setPaymentStatus(v ?? '')} options={PAYMENT_OPTIONS} placeholder="All payments" />
        <div className="flex items-center gap-2">
          <DatePicker value={startDate} onChange={setStartDate} placeholder="From" size="sm" />
          <span className="text-gray-300">–</span>
          <DatePicker value={endDate} onChange={setEndDate} placeholder="To" size="sm" />
        </div>
        {vendorId && (
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-gray-100 px-2.5 py-1 text-xs text-gray-700">
            Vendor: {vendorName ?? '…'}
            <button type="button" onClick={clearVendor} className="text-gray-400 hover:text-gray-700" aria-label="Clear vendor filter"><X className="w-3.5 h-3.5" /></button>
          </span>
        )}
        {hasFilters && (
          <button type="button" onClick={resetFilters} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
            <RotateCcw className="w-3.5 h-3.5" /> Reset
          </button>
        )}
      </div>

      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        {error ? (
          <EmptyState icon={AlertCircle} title="Could not load purchase bills" description={error}
            action={<button type="button" onClick={load} className="text-sm font-medium text-gray-900 underline">Try again</button>} />
        ) : !loading && rows.length === 0 && !hasFilters ? (
          <EmptyState
            icon={ShoppingCart}
            title={vendorId ? 'No bills from this vendor yet' : 'No purchase bills yet'}
            description="Record a supplier bill to tag new equipment, stock up consumables and pay the supplier with the right VAT and withholding."
            action={can('inventory.purchase') ? (
              <Link href={newHref} className="inline-flex items-center gap-1.5 bg-gray-900 text-white hover:bg-gray-800 rounded-lg px-4 py-2 text-sm font-medium">
                <Plus className="w-4 h-4" /> New purchase bill
              </Link>
            ) : null}
          />
        ) : (
          <>
            <DataTable
              columns={columns}
              data={rows}
              loading={loading}
              emptyTitle="No bills match these filters"
              emptyDescription="Try a different search or clear the filters."
              emptyIcon={ShoppingCart}
              onRowClick={(b) => router.push(`/admin/inventory/purchases/${b.id}`)}
            />
            {meta && meta.pages > 1 && (
              <div className="px-4 py-3 border-t border-gray-100">
                <Pagination meta={meta} onPageChange={(p) => { setPage(p); if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' }) }} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}

export default function PurchasesPageWrapper() {
  return (
    <Suspense fallback={<PageLoader />}>
      <PurchasesPage />
    </Suspense>
  )
}

