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
import Button from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import PageHeader from '@/components/ui/PageHeader'
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
          <Link href={`/admin/inventory/purchases/${b.id}`} className="font-medium text-gray-900 hover:underline underline-offset-4" onClick={e => e.stopPropagation()}>
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
    {
      key: 'total', label: 'Total', sortable: true, className: '[&>div]:justify-end', cellClassName: 'text-right tabular-nums',
      render: (b) => <span className="whitespace-nowrap">{tk(b.total, 0)}</span>,
    },
    {
      key: 'netPayable', label: 'Net payable', sortable: true, className: '[&>div]:justify-end', cellClassName: 'text-right tabular-nums',
      render: (b) => (
        <div className="whitespace-nowrap">
          <span className="font-medium text-gray-900">{tk(b.netPayable, 0)}</span>
          {(Number(b.tds?.amount) || 0) + (Number(b.vds?.amount) || 0) > 0 && <p className="text-xs text-gray-400">after VDS/TDS</p>}
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
    <div className="space-y-6">
      <PageHeader
        title="Purchases"
        actions={(
          <Can perm="inventory.purchase">
            <Button href={newHref}><Plus /> New purchase bill</Button>
          </Can>
        )}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatsCard title="Drafts" icon={FileClock} color="yellow"
          value={<StatValue count={summary?.drafts} amount={summary?.draftAmount} />} />
        <StatsCard title="With Accounts" icon={Send} color="blue"
          value={<StatValue count={summary?.requested} amount={summary?.requestedAmount} />} />
        <StatsCard title="Unpaid" icon={AlertCircle} color="red"
          value={<StatValue count={summary?.unpaid} amount={summary?.unpaidAmount} />} />
        <StatsCard title="Received this month" icon={ShoppingCart} color="green"
          value={<StatValue count={summary?.monthCount} amount={summary?.monthAmount} amountFirst />} />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search bills…" className="w-full sm:w-64" />
        <FilterSelect value={status} onChange={v => setStatus(v ?? '')} options={STATUS_OPTIONS} placeholder="All statuses" />
        <FilterSelect value={paymentStatus} onChange={v => setPaymentStatus(v ?? '')} options={PAYMENT_OPTIONS} placeholder="All payments" />
        <div className="flex items-center gap-2">
          <DatePicker value={startDate} onChange={setStartDate} placeholder="From" size="sm" />
          <span className="text-gray-300">–</span>
          <DatePicker value={endDate} onChange={setEndDate} placeholder="To" size="sm" />
        </div>
        {vendorId && (
          <span className="inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-200/80 bg-white pl-2.5 pr-1 text-[13px] text-gray-700 shadow-xs">
            Vendor: <span className="font-medium text-gray-900">{vendorName ?? '…'}</span>
            <Button variant="ghost" size="icon-xs" onClick={clearVendor} aria-label="Clear vendor filter" className="size-6 text-gray-400">
              <X className="size-3.5" />
            </Button>
          </span>
        )}
        {hasFilters && (
          <Button variant="ghost" size="sm" onClick={resetFilters}>
            <RotateCcw /> Reset
          </Button>
        )}
      </div>

      <Card className="overflow-hidden">
        {error ? (
          <EmptyState icon={AlertCircle} title="Couldn't load purchase bills" description={error}
            action={<Button variant="outline" size="sm" onClick={load}>Try again</Button>} />
        ) : !loading && rows.length === 0 && !hasFilters ? (
          <EmptyState
            icon={ShoppingCart}
            title={vendorId ? 'No bills from this vendor yet' : 'No purchase bills yet'}
            action={can('inventory.purchase') ? (
              <Button href={newHref} variant="outline" size="sm"><Plus /> New purchase bill</Button>
            ) : null}
          />
        ) : (
          <>
            <DataTable
              columns={columns}
              data={rows}
              loading={loading}
              emptyTitle="No results"
              emptyDescription="Try a different search or clear the filters."
              emptyIcon={ShoppingCart}
              onRowClick={(b) => router.push(`/admin/inventory/purchases/${b.id}`)}
            />
            {meta && meta.pages > 1 && (
              <div className="border-t border-gray-100 px-4 py-3">
                <Pagination meta={meta} onPageChange={(p) => { setPage(p); if (typeof window !== 'undefined') window.scrollTo({ top: 0, behavior: 'smooth' }) }} />
              </div>
            )}
          </>
        )}
      </Card>
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

