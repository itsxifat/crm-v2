'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import {
  Laptop, Plus, Download, Printer, X, UserCheck, Undo2, ArrowLeftRight, Eye, FileText, Package, Wrench,
  ShieldAlert, Wallet, ShoppingCart, RefreshCw, CheckCircle2,
} from 'lucide-react'
import DataTable from '@/components/ui/DataTable'
import Pagination from '@/components/ui/Pagination'
import SearchInput from '@/components/ui/SearchInput'
import FilterSelect from '@/components/ui/FilterSelect'
import StatsCard from '@/components/ui/StatsCard'
import ActionMenu from '@/components/ui/ActionMenu'
import EmptyState from '@/components/ui/EmptyState'
import PageHeader from '@/components/ui/PageHeader'
import Badge from '@/components/ui/Badge'
import Button, { buttonVariants } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import AssetStatusBadge, { AssetConditionBadge } from '@/components/inventory/AssetStatusBadge'
import { usePermission } from '@/components/auth/Can'
import { STATUS_OPTIONS, CONDITION_OPTIONS, STATUS_META } from '@/lib/inventory/constants'
import { availableAssetActions, returnActionLabel } from '@/lib/inventory/actions'
import AssetFormModal from './_components/AssetFormModal'
import AssetActionModal from './_components/AssetActionModal'
import LabelPrintModal from './_components/LabelPrintModal'
import {
  tk, holderName, apiJson, useAssetOptions, openPrint, labelsUrl,
} from './_components/shared'

const VIEW_OPTIONS = [
  { value: 'ACTIVE', label: 'Active' },
  ...STATUS_OPTIONS,
  { value: 'DISPOSED', label: 'Disposed' },
  { value: 'ALL', label: 'All statuses' },
]
const WARRANTY_OPTIONS = [
  { value: '30', label: 'Warranty ends ≤ 30 days' },
  { value: '60', label: 'Warranty ends ≤ 60 days' },
  { value: '90', label: 'Warranty ends ≤ 90 days' },
  { value: 'expired', label: 'Warranty expired' },
]
const CAP_OPTIONS = [
  { value: 'true', label: 'Capitalized' },
  { value: 'false', label: 'Expensed' },
]
const ACK_FILTER_LABELS = { PENDING: 'Awaiting acknowledgement', DECLINED: 'Hand-over declined', ACCEPTED: 'Acknowledged' }
const SORT_VALUES = ['-createdAt', 'tag', '-tag', 'name', '-name', 'cost', '-cost', 'status', 'warranty', 'createdAt', 'purchaseDate', '-purchaseDate']

/** Initial filters from the URL (dashboard / report links). */
function filtersFromUrl(sp) {
  const status = (sp.get('status') ?? '').split(',').map(s => s.trim().toUpperCase()).filter(Boolean).join(',')
  const sort = sp.get('sort') ?? ''
  const warranty = (sp.get('warranty') ?? '').toLowerCase()
  const cap = sp.get('isCapitalized') ?? ''
  const ack = (sp.get('ack') ?? sp.get('ackStatus') ?? '').split(',').map(s => s.trim().toUpperCase()).filter(a => ACK_FILTER_LABELS[a]).join(',')
  return {
    search: sp.get('search') ?? '',
    view: status || 'ACTIVE',
    categoryId: sp.get('categoryId') ?? '',
    locationId: sp.get('locationId') ?? '',
    condition: (sp.get('condition') ?? '').toUpperCase(),
    warranty: ['30', '60', '90', 'expired'].includes(warranty) ? warranty : '',
    capitalized: cap === 'true' || cap === 'false' ? cap : '',
    employeeId: sp.get('assignedEmployeeId') ?? '',
    ack,
    sort: SORT_VALUES.includes(sort) ? sort : '-createdAt',
  }
}

const SORT_OPTIONS = [
  { value: '-createdAt', label: 'Newest first' },
  { value: 'tag', label: 'Tag A→Z' },
  { value: 'name', label: 'Name A→Z' },
  { value: '-cost', label: 'Cost high→low' },
  { value: 'warranty', label: 'Warranty ending soonest' },
]

function AssetsPage() {
  const router = useRouter()
  const sp = useSearchParams()
  const { can, ready } = usePermission()
  const { categories, locations, settings } = useAssetOptions()

  const initial = useMemo(() => filtersFromUrl(sp), []) // eslint-disable-line react-hooks/exhaustive-deps
  const [search, setSearch] = useState(initial.search)
  const [view, setView] = useState(initial.view)
  const [categoryId, setCategoryId] = useState(initial.categoryId)
  const [locationId, setLocationId] = useState(initial.locationId)
  const [condition, setCondition] = useState(initial.condition)
  const [warranty, setWarranty] = useState(initial.warranty)
  const [capitalized, setCapitalized] = useState(initial.capitalized)
  const [employeeId, setEmployeeId] = useState(initial.employeeId)
  const [ack, setAck] = useState(initial.ack)
  const [sort, setSort] = useState(initial.sort)
  const [page, setPage] = useState(1)

  // A new link to this page (e.g. from the dashboard) while it is open re-applies the URL filters.
  const spKey = sp.toString()
  const lastSpKey = useRef(spKey)
  useEffect(() => {
    if (lastSpKey.current === spKey) return
    lastSpKey.current = spKey
    const f = filtersFromUrl(new URLSearchParams(spKey))
    setSearch(f.search); setView(f.view); setCategoryId(f.categoryId); setLocationId(f.locationId)
    setCondition(f.condition); setWarranty(f.warranty); setCapitalized(f.capitalized)
    setEmployeeId(f.employeeId); setAck(f.ack); setSort(f.sort)
  }, [spKey])

  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState(null)
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [selected, setSelected] = useState(() => new Map()) // id → tag
  const [createOpen, setCreateOpen] = useState(false)
  const [labelIds, setLabelIds] = useState(null)
  const [quick, setQuick] = useState(null) // { action, asset }
  const [justCreated, setJustCreated] = useState(null)
  const seq = useRef(0)

  const params = useMemo(() => {
    const p = new URLSearchParams()
    if (search.trim()) p.set('search', search.trim())
    if (view && view !== 'ALL') p.set('status', view)
    if (categoryId) p.set('categoryId', categoryId)
    if (locationId) p.set('locationId', locationId)
    if (condition) p.set('condition', condition)
    if (employeeId) p.set('assignedEmployeeId', employeeId)
    if (ack) p.set('ack', ack)
    if (warranty === 'expired') p.set('warrantyExpired', '1')
    else if (warranty) p.set('warrantyExpiringDays', warranty)
    if (capitalized) p.set('isCapitalized', capitalized)
    if (sort) p.set('sort', sort)
    return p
  }, [search, view, categoryId, locationId, condition, employeeId, ack, warranty, capitalized, sort])

  const filterKey = params.toString()
  useEffect(() => { setPage(1) }, [filterKey])

  const load = useCallback(async () => {
    const mine = ++seq.current
    setLoading(true)
    try {
      const q = new URLSearchParams(params)
      q.set('page', String(page))
      q.set('limit', '25')
      q.set('summary', '1')
      const json = await apiJson(`/api/inventory/assets?${q}`)
      if (mine !== seq.current) return
      setRows(json.data ?? [])
      setMeta(json.meta ?? null)
      setSummary(json.summary ?? null)
      setError(null)
    } catch (err) {
      if (mine !== seq.current) return
      setError(err.message)
    } finally {
      if (mine === seq.current) setLoading(false)
    }
  }, [params, page])

  useEffect(() => { load() }, [load])

  const filtersActive = Boolean(search || (view && view !== 'ACTIVE') || categoryId || locationId || condition || warranty || capitalized || employeeId || ack)
  const resetFilters = () => {
    setSearch(''); setView('ACTIVE'); setCategoryId(''); setLocationId(''); setCondition(''); setWarranty(''); setCapitalized('')
    setEmployeeId(''); setAck('')
    if (spKey) router.replace('/admin/inventory/assets')
  }
  // A status list from a link (e.g. "IN_REPAIR,DAMAGED") is not one of the fixed options — show it as its own option.
  const viewOptions = VIEW_OPTIONS.some(o => o.value === view)
    ? VIEW_OPTIONS
    : [...VIEW_OPTIONS, { value: view, label: view.split(',').map(s => STATUS_META[s]?.label ?? s).join(' + ') }]

  const toggle = (row) => setSelected(prev => {
    const next = new Map(prev)
    if (next.has(row.id)) next.delete(row.id)
    else next.set(row.id, row.assetTag)
    return next
  })
  const allOnPage = rows.length > 0 && rows.every(r => selected.has(r.id))
  const togglePage = () => setSelected(prev => {
    const next = new Map(prev)
    if (allOnPage) rows.forEach(r => next.delete(r.id))
    else rows.forEach(r => next.set(r.id, r.assetTag))
    return next
  })

  const by = summary?.byStatus ?? {}
  const count = (...s) => s.reduce((n, k) => n + (by[k]?.count ?? 0), 0)
  const modalSettings = settings ? {
    convention: settings.depreciationConvention, lockedUntil: settings.lockedUntil,
    vatRegistrationType: settings.vatRegistrationType, defaultSalesRate: settings.defaultSalesRate,
    postDepreciationToLedger: settings.postDepreciationToLedger,
  } : null

  const csvHref = (ids = null) => {
    const q = ids ? new URLSearchParams({ ids: ids.join(','), archived: '1' }) : new URLSearchParams(params)
    q.set('format', 'csv')
    return `/api/inventory/assets?${q}`
  }

  const rowActions = (row) => {
    const acts = ready ? availableAssetActions(row, can) : []
    const has = (k) => acts.some(a => a.key === k)
    return [
      { label: 'Open', icon: Eye, href: `/admin/inventory/assets/${row.id}` },
      has('assign') && { label: 'Assign', icon: UserCheck, onClick: () => setQuick({ action: 'assign', asset: row }) },
      has('return') && { label: returnActionLabel(row), icon: Undo2, onClick: () => setQuick({ action: 'return', asset: row }) },
      has('transfer') && { label: 'Move location', icon: ArrowLeftRight, onClick: () => setQuick({ action: 'transfer', asset: row }) },
      has('repair_send') && { label: 'Send to repair', icon: Wrench, onClick: () => setQuick({ action: 'repair_send', asset: row }) },
      { label: 'Print label', icon: Printer, onClick: () => openPrint(labelsUrl([row.id], { size: 'small' })) },
      row.status === 'ASSIGNED' && row.assignedEmployeeId && { label: 'Hand-over form', icon: FileText, onClick: () => openPrint(`/api/inventory/assets/${row.id}/handover`) },
    ]
  }

  const columns = [
    {
      key: 'select',
      label: (
        <input type="checkbox" aria-label="Select all on this page" className="rounded border-gray-300"
          checked={allOnPage} onChange={togglePage} onClick={e => e.stopPropagation()} />
      ),
      className: 'w-10',
      render: (row) => (
        <input type="checkbox" aria-label={`Select ${row.assetTag}`} className="rounded border-gray-300"
          checked={selected.has(row.id)} onChange={() => toggle(row)} onClick={e => e.stopPropagation()} />
      ),
    },
    {
      key: 'assetTag', label: 'Tag', sortable: true,
      render: (row) => <span className="whitespace-nowrap font-mono text-xs font-medium text-gray-900">{row.assetTag}</span>,
    },
    {
      key: 'name', label: 'Asset', sortable: true,
      render: (row) => (
        <div className="min-w-[180px] max-w-[280px]">
          <p className="truncate font-medium text-gray-900">{row.name}</p>
          <p className="truncate text-xs text-muted-foreground">{[row.brand, row.model, row.serialNumber ? `S/N ${row.serialNumber}` : null].filter(Boolean).join(' · ') || '—'}</p>
        </div>
      ),
    },
    { key: 'category', label: 'Category', render: (row) => <span className="whitespace-nowrap">{row.categoryId?.name ?? '—'}</span> },
    {
      key: 'status', label: 'Status', sortable: true,
      render: (row) => (
        <div className="flex flex-col items-start gap-1">
          <AssetStatusBadge status={row.status} />
          {row.acknowledgement?.status === 'PENDING' && <span className="whitespace-nowrap text-[11px] text-amber-600">Awaiting acknowledgement</span>}
          {row.acknowledgement?.status === 'DECLINED' && <span className="whitespace-nowrap text-[11px] text-red-600">Hand-over declined</span>}
        </div>
      ),
    },
    { key: 'condition', label: 'Condition', render: (row) => <AssetConditionBadge condition={row.condition} /> },
    {
      key: 'holder', label: 'With',
      render: (row) => {
        const name = holderName(row)
        if (!name) return <span className="text-gray-300">—</span>
        return (
          <div className="min-w-[120px]">
            <p className="truncate text-gray-900">{name}</p>
            {row.assignedEmployeeId?.employeeId && <p className="text-xs text-muted-foreground">{row.assignedEmployeeId.employeeId}</p>}
          </div>
        )
      },
    },
    { key: 'location', label: 'Location', render: (row) => <span className="whitespace-nowrap">{row.locationId?.name ?? '—'}</span> },
    {
      key: 'cost', label: 'Cost', sortable: true, className: 'text-right [&>div]:justify-end', cellClassName: 'text-right tabular-nums whitespace-nowrap',
      render: (row) => tk(row.cost),
    },
    {
      key: 'bookValue', label: 'Book value', sortable: true, className: 'text-right [&>div]:justify-end', cellClassName: 'text-right tabular-nums whitespace-nowrap',
      render: (row) => (row.isCapitalized === false ? <span className="text-xs text-gray-400">Expensed</span> : tk(row.bookValue)),
    },
    {
      key: 'actions', label: '', className: 'w-10',
      render: (row) => <div onClick={e => e.stopPropagation()}><ActionMenu items={rowActions(row)} /></div>,
    },
  ]

  const noAssetsAtAll = summary && summary.total === 0 && !filtersActive

  const statBtn = 'rounded-xl text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50'
  const statCard = 'h-full p-4 transition-colors hover:border-gray-300'
  const repairCount = count('IN_REPAIR', 'DAMAGED')
  const lostCount = count('LOST', 'STOLEN')

  return (
    <div className="space-y-6">
      <PageHeader
        title="Assets"
        actions={(
          <>
            <a href={csvHref()} className={buttonVariants({ variant: 'outline' })}><Download /> Export CSV</a>
            {ready && can('inventory.purchase') && (
              <Button variant="outline" href="/admin/inventory/purchases/new"><ShoppingCart /> New purchase</Button>
            )}
            {ready && can('inventory.manage') && (
              <Button onClick={() => setCreateOpen(true)}><Plus /> Add existing asset</Button>
            )}
          </>
        )}
      />

      {/* Stats */}
      <div className="space-y-2">
        <div className="grid grid-cols-2 gap-4 lg:grid-cols-3 xl:grid-cols-6">
          <button type="button" className={statBtn} onClick={() => setView('ACTIVE')}>
            <StatsCard title="Active assets" value={summary ? summary.active.toLocaleString() : '—'} icon={Package} className={statCard} />
          </button>
          <button type="button" className={statBtn} onClick={() => setView('ASSIGNED')}>
            <StatsCard title="Assigned" value={summary ? count('ASSIGNED') : '—'} icon={UserCheck} className={statCard} />
          </button>
          <button type="button" className={statBtn} onClick={() => setView('IN_STOCK')}>
            <StatsCard title="In stock" value={summary ? count('IN_STOCK') : '—'} icon={Laptop} className={statCard} />
          </button>
          <button type="button" className={statBtn} onClick={() => setView(count('IN_REPAIR') >= count('DAMAGED') ? 'IN_REPAIR' : 'DAMAGED')}>
            <StatsCard title="Repair / damaged" value={summary ? repairCount : '—'} icon={Wrench} color={repairCount ? 'orange' : 'gray'} className={statCard} />
          </button>
          <button type="button" className={statBtn} onClick={() => setView(count('LOST') >= count('STOLEN') ? 'LOST' : 'STOLEN')}>
            <StatsCard title="Lost / stolen" value={summary ? lostCount : '—'} icon={ShieldAlert} color={lostCount ? 'red' : 'gray'} className={statCard} />
          </button>
          <StatsCard title="Net book value" value={summary ? tk(summary.bookValue) : '—'} icon={Wallet} className="h-full p-4" />
        </div>
        {summary?.pendingAck > 0 && (
          <button type="button" onClick={() => setAck('PENDING')} className="text-left text-[13px] font-medium text-amber-700 underline-offset-4 hover:underline">
            {summary.pendingAck} hand-over{summary.pendingAck === 1 ? '' : 's'} awaiting acknowledgement
          </button>
        )}
      </div>

      {justCreated && (
        <div className="flex flex-col gap-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2.5 text-sm text-emerald-800 sm:flex-row sm:items-center sm:gap-3">
          <div className="flex flex-1 items-center gap-2">
            <CheckCircle2 className="size-4 shrink-0" />
            <span>Added {justCreated.length} assets: {justCreated[0].assetTag} – {justCreated[justCreated.length - 1].assetTag}. Label each before hand-out.</span>
          </div>
          <div className="flex items-center gap-1">
            <Button variant="outline" size="sm" onClick={() => setLabelIds(justCreated.map(a => a.id))}><Printer /> Print labels</Button>
            <Button variant="ghost" size="icon-sm" className="text-emerald-700 hover:bg-emerald-100 hover:text-emerald-900" onClick={() => setJustCreated(null)} aria-label="Dismiss"><X /></Button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search assets…" className="w-full sm:w-64" />
        <FilterSelect value={view} onChange={v => setView(v || 'ACTIVE')} options={viewOptions} placeholder="Active" className="w-full sm:w-44" />
        <FilterSelect value={categoryId} onChange={v => setCategoryId(v || '')} options={categories.map(c => ({ value: c.id, label: c.name }))} placeholder="All categories" className="w-full sm:w-44" />
        <FilterSelect value={locationId} onChange={v => setLocationId(v || '')} options={locations.map(l => ({ value: l.id, label: l.name }))} placeholder="All locations" className="w-full sm:w-40" />
        <FilterSelect value={condition} onChange={v => setCondition(v || '')} options={CONDITION_OPTIONS} placeholder="Any condition" className="w-full sm:w-36" />
        <FilterSelect value={warranty} onChange={v => setWarranty(v || '')} options={WARRANTY_OPTIONS} placeholder="Any warranty" className="w-full sm:w-48" />
        <FilterSelect value={capitalized} onChange={v => setCapitalized(v || '')} options={CAP_OPTIONS} placeholder="Capitalization" className="w-full sm:w-40" />
        <FilterSelect value={sort} onChange={v => setSort(v || '-createdAt')} options={SORT_OPTIONS} placeholder="Newest first" className="w-full sm:w-44" />
        {employeeId && <Badge>Filtered to one employee</Badge>}
        {ack && (
          <Badge variant="warning" className="pr-1">
            {ack.split(',').map(a => ACK_FILTER_LABELS[a] ?? a).join(' / ')}
            <button type="button" onClick={() => setAck('')} aria-label="Clear acknowledgement filter" className="rounded-full p-0.5 hover:bg-amber-100 hover:text-amber-900"><X className="size-3" /></button>
          </Badge>
        )}
        {filtersActive && <Button variant="ghost" size="sm" onClick={resetFilters}>Reset</Button>}
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl border border-gray-200/80 bg-white px-3 py-2 shadow-lg">
          <span className="px-1 text-sm font-medium text-gray-900">{selected.size} selected</span>
          <span className="flex-1" />
          <Button variant="outline" size="sm" onClick={() => setLabelIds([...selected.keys()])}>
            <Printer /> Print labels
          </Button>
          <a href={csvHref([...selected.keys()])} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            <Download /> Export CSV
          </a>
          <Button variant="ghost" size="sm" onClick={() => setSelected(new Map())}>
            <X /> Clear
          </Button>
        </div>
      )}

      {/* Table */}
      {error && !rows.length ? (
        <Card>
          <EmptyState icon={ShieldAlert} title="Couldn't load assets" description={error}
            action={<Button onClick={load}><RefreshCw /> Retry</Button>} />
        </Card>
      ) : noAssetsAtAll ? (
        <Card>
          <EmptyState icon={Laptop} title="No assets yet"
            description="Record a purchase or add equipment you own."
            action={(
              <div className="flex flex-wrap justify-center gap-2">
                {can('inventory.purchase') && <Button variant="outline" href="/admin/inventory/purchases/new"><ShoppingCart /> New purchase</Button>}
                {can('inventory.manage') && <Button variant="outline" onClick={() => setCreateOpen(true)}><Plus /> Add existing asset</Button>}
              </div>
            )} />
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <DataTable
            columns={columns}
            data={rows}
            loading={loading && !rows.length}
            emptyTitle="No results"
            emptyDescription="Try another search or clear the filters."
            emptyIcon={Laptop}
            onRowClick={(row) => router.push(`/admin/inventory/assets/${row.id}`)}
          />
          {meta && meta.pages > 1 && (
            <div className="border-t border-gray-100 px-4 py-3">
              <Pagination meta={meta} onPageChange={setPage} />
            </div>
          )}
        </Card>
      )}

      {/* Modals */}
      {createOpen && (
        <AssetFormModal open={createOpen} onOpenChange={setCreateOpen} mode="create"
          onSaved={(json) => {
            const created = json.data ?? []
            if (created.length === 1) router.push(`/admin/inventory/assets/${created[0].id}`)
            else { setJustCreated(created.map(a => ({ id: a.id, assetTag: a.assetTag }))); load() }
          }} />
      )}
      <LabelPrintModal open={Boolean(labelIds)} onOpenChange={(v) => { if (!v) setLabelIds(null) }} ids={labelIds ?? []} />
      {quick && (
        <AssetActionModal open={Boolean(quick)} onOpenChange={(v) => { if (!v) setQuick(null) }}
          action={quick.action} asset={quick.asset} settings={modalSettings} onDone={() => load()} />
      )}
    </div>
  )
}

export default function AssetsPageWrapper() {
  return (
    <Suspense fallback={<PageLoader />}>
      <AssetsPage />
    </Suspense>
  )
}
