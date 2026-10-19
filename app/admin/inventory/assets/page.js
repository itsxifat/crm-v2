'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
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
import AssetStatusBadge, { AssetConditionBadge } from '@/components/inventory/AssetStatusBadge'
import { usePermission } from '@/components/auth/Can'
import { cn } from '@/lib/utils'
import { STATUS_OPTIONS, CONDITION_OPTIONS, STATUS_META } from '@/lib/inventory/constants'
import { availableAssetActions, returnActionLabel } from '@/lib/inventory/actions'
import AssetFormModal from './_components/AssetFormModal'
import AssetActionModal from './_components/AssetActionModal'
import LabelPrintModal from './_components/LabelPrintModal'
import {
  btnPrimary, btnSecondary, cardCls, tk, holderName, apiJson, useAssetOptions, openPrint, labelsUrl,
} from './_components/shared'

const VIEW_OPTIONS = [
  { value: 'ACTIVE', label: 'Active (not disposed)' },
  ...STATUS_OPTIONS,
  { value: 'DISPOSED', label: 'Disposed (sold, scrapped…)' },
  { value: 'ALL', label: 'Everything' },
]
const WARRANTY_OPTIONS = [
  { value: '30', label: 'Warranty ends ≤ 30 days' },
  { value: '60', label: 'Warranty ends ≤ 60 days' },
  { value: '90', label: 'Warranty ends ≤ 90 days' },
  { value: 'expired', label: 'Warranty expired' },
]
const CAP_OPTIONS = [
  { value: 'true', label: 'Capitalized' },
  { value: 'false', label: 'Expensed (tracked only)' },
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
      render: (row) => <span className="font-mono text-xs font-semibold text-gray-900 whitespace-nowrap">{row.assetTag}</span>,
    },
    {
      key: 'name', label: 'Asset', sortable: true,
      render: (row) => (
        <div className="min-w-[180px] max-w-[280px]">
          <p className="font-medium text-gray-900 truncate">{row.name}</p>
          <p className="text-xs text-gray-400 truncate">{[row.brand, row.model, row.serialNumber ? `S/N ${row.serialNumber}` : null].filter(Boolean).join(' · ') || '—'}</p>
        </div>
      ),
    },
    { key: 'category', label: 'Category', render: (row) => <span className="whitespace-nowrap">{row.categoryId?.name ?? '—'}</span> },
    {
      key: 'status', label: 'Status', sortable: true,
      render: (row) => (
        <div className="flex flex-col items-start gap-1">
          <AssetStatusBadge status={row.status} />
          {row.acknowledgement?.status === 'PENDING' && <span className="text-[11px] text-amber-600 whitespace-nowrap">awaiting acknowledgement</span>}
          {row.acknowledgement?.status === 'DECLINED' && <span className="text-[11px] text-red-600 whitespace-nowrap">hand-over declined</span>}
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
            <p className="text-gray-900 truncate">{name}</p>
            {row.assignedEmployeeId?.employeeId && <p className="text-xs text-gray-400">{row.assignedEmployeeId.employeeId}</p>}
          </div>
        )
      },
    },
    { key: 'location', label: 'Location', render: (row) => <span className="whitespace-nowrap">{row.locationId?.name ?? '—'}</span> },
    {
      key: 'cost', label: 'Cost', sortable: true, className: 'text-right', cellClassName: 'text-right tabular-nums whitespace-nowrap',
      render: (row) => tk(row.cost),
    },
    {
      key: 'bookValue', label: 'Book value', sortable: true, className: 'text-right', cellClassName: 'text-right tabular-nums whitespace-nowrap',
      render: (row) => (row.isCapitalized === false ? <span className="text-xs text-gray-400">expensed</span> : tk(row.bookValue)),
    },
    {
      key: 'actions', label: '', className: 'w-10',
      render: (row) => <div onClick={e => e.stopPropagation()}><ActionMenu items={rowActions(row)} /></div>,
    },
  ]

  const noAssetsAtAll = summary && summary.total === 0 && !filtersActive

  return (
    <div className="space-y-5">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">Assets</h1>
          <p className="text-sm text-gray-500">Fixed-asset register — tags, custody, condition, value and depreciation.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={csvHref()} className={btnSecondary}><Download className="w-4 h-4" /> Export CSV</a>
          {ready && can('inventory.purchase') && (
            <Link href="/admin/inventory/purchases/new" className={btnSecondary}><ShoppingCart className="w-4 h-4" /> New purchase</Link>
          )}
          {ready && can('inventory.manage') && (
            <button type="button" className={btnPrimary} onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4" /> Add existing asset</button>
          )}
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-3">
        <button type="button" className="text-left" onClick={() => setView('ACTIVE')}>
          <StatsCard title="Active assets" value={summary ? summary.active.toLocaleString() : '—'} icon={Package} color="blue" className="p-4 hover:shadow-md transition-shadow" />
        </button>
        <button type="button" className="text-left" onClick={() => setView('ASSIGNED')}>
          <StatsCard title="Assigned" value={summary ? count('ASSIGNED') : '—'} icon={UserCheck} color="indigo" className="p-4 hover:shadow-md transition-shadow" />
        </button>
        <button type="button" className="text-left" onClick={() => setView('IN_STOCK')}>
          <StatsCard title="In stock" value={summary ? count('IN_STOCK') : '—'} icon={Laptop} color="green" className="p-4 hover:shadow-md transition-shadow" />
        </button>
        <button type="button" className="text-left" onClick={() => setView(count('IN_REPAIR') >= count('DAMAGED') ? 'IN_REPAIR' : 'DAMAGED')}>
          <StatsCard title="Repair / damaged" value={summary ? count('IN_REPAIR', 'DAMAGED') : '—'} icon={Wrench} color="orange" className="p-4 hover:shadow-md transition-shadow" />
        </button>
        <button type="button" className="text-left" onClick={() => setView(count('LOST') >= count('STOLEN') ? 'LOST' : 'STOLEN')}>
          <StatsCard title="Lost / stolen" value={summary ? count('LOST', 'STOLEN') : '—'} icon={ShieldAlert} color="red" className="p-4 hover:shadow-md transition-shadow" />
        </button>
        <StatsCard title="Net book value" value={summary ? tk(summary.bookValue) : '—'} icon={Wallet} color="teal" className="p-4" />
      </div>
      {summary?.pendingAck > 0 && (
        <button type="button" onClick={() => setAck('PENDING')} className="text-xs text-amber-700 hover:underline text-left">
          {summary.pendingAck} hand-over{summary.pendingAck === 1 ? ' is' : 's are'} waiting for the employee&apos;s acknowledgement.
        </button>
      )}

      {justCreated && (
        <div className="flex flex-col sm:flex-row sm:items-center gap-3 rounded-xl border border-green-100 bg-green-50 px-4 py-3 text-sm text-green-800">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span className="flex-1">Added {justCreated.length} assets: {justCreated[0].assetTag} – {justCreated[justCreated.length - 1].assetTag}. Stick a label on each before handing them out.</span>
          <div className="flex gap-2">
            <button type="button" className={btnSecondary} onClick={() => setLabelIds(justCreated.map(a => a.id))}><Printer className="w-4 h-4" /> Print labels</button>
            <button type="button" className="p-2 text-green-700 hover:text-green-900" onClick={() => setJustCreated(null)} aria-label="Dismiss"><X className="w-4 h-4" /></button>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className={cn(cardCls, 'p-4 flex flex-wrap items-center gap-3')}>
        <SearchInput value={search} onChange={setSearch} placeholder="Tag, name, serial, brand, holder…" className="w-full sm:w-72" />
        <FilterSelect value={view} onChange={v => setView(v || 'ACTIVE')} options={viewOptions} placeholder="Active (not disposed)" className="w-full sm:w-52" />
        <FilterSelect value={categoryId} onChange={v => setCategoryId(v || '')} options={categories.map(c => ({ value: c.id, label: c.name }))} placeholder="All categories" className="w-full sm:w-48" />
        <FilterSelect value={locationId} onChange={v => setLocationId(v || '')} options={locations.map(l => ({ value: l.id, label: l.name }))} placeholder="All locations" className="w-full sm:w-40" />
        <FilterSelect value={condition} onChange={v => setCondition(v || '')} options={CONDITION_OPTIONS} placeholder="Any condition" className="w-full sm:w-36" />
        <FilterSelect value={warranty} onChange={v => setWarranty(v || '')} options={WARRANTY_OPTIONS} placeholder="Any warranty" className="w-full sm:w-48" />
        <FilterSelect value={capitalized} onChange={v => setCapitalized(v || '')} options={CAP_OPTIONS} placeholder="Capitalized or not" className="w-full sm:w-44" />
        <FilterSelect value={sort} onChange={v => setSort(v || '-createdAt')} options={SORT_OPTIONS} placeholder="Newest first" className="w-full sm:w-44" />
        {filtersActive && <button type="button" onClick={resetFilters} className="text-sm text-gray-500 hover:text-gray-900">Reset</button>}
        {employeeId && <span className="text-xs bg-blue-50 text-blue-700 rounded-md px-2 py-1">Filtered to one employee</span>}
        {ack && (
          <span className="inline-flex items-center gap-1 text-xs bg-amber-50 text-amber-700 rounded-md px-2 py-1">
            {ack.split(',').map(a => ACK_FILTER_LABELS[a] ?? a).join(' / ')}
            <button type="button" onClick={() => setAck('')} aria-label="Clear acknowledgement filter" className="hover:text-amber-900"><X className="w-3 h-3" /></button>
          </span>
        )}
      </div>

      {/* Bulk bar */}
      {selected.size > 0 && (
        <div className="sticky top-2 z-20 flex flex-wrap items-center gap-2 rounded-xl bg-gray-900 text-white px-4 py-2.5 shadow-lg">
          <span className="text-sm font-medium">{selected.size} selected</span>
          <span className="flex-1" />
          <button type="button" className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/20 px-3 py-1.5 text-sm" onClick={() => setLabelIds([...selected.keys()])}>
            <Printer className="w-4 h-4" /> Print labels
          </button>
          <a href={csvHref([...selected.keys()])} className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 hover:bg-white/20 px-3 py-1.5 text-sm">
            <Download className="w-4 h-4" /> Export CSV
          </a>
          <button type="button" className="inline-flex items-center gap-1 rounded-lg px-2 py-1.5 text-sm text-white/70 hover:text-white" onClick={() => setSelected(new Map())}>
            <X className="w-4 h-4" /> Clear
          </button>
        </div>
      )}

      {/* Table */}
      {error && !rows.length ? (
        <div className={cardCls}>
          <EmptyState icon={ShieldAlert} title="Could not load assets" description={error}
            action={<button type="button" className={btnPrimary} onClick={load}><RefreshCw className="w-4 h-4" /> Retry</button>} />
        </div>
      ) : noAssetsAtAll ? (
        <div className={cardCls}>
          <EmptyState icon={Laptop} title="No assets yet"
            description="Record a purchase bill to receive new equipment, or add the equipment you already own (with its opening value) to start the register."
            action={(
              <div className="flex flex-wrap gap-2 justify-center">
                {can('inventory.purchase') && <Link href="/admin/inventory/purchases/new" className={btnSecondary}><ShoppingCart className="w-4 h-4" /> New purchase</Link>}
                {can('inventory.manage') && <button type="button" className={btnPrimary} onClick={() => setCreateOpen(true)}><Plus className="w-4 h-4" /> Add existing asset</button>}
              </div>
            )} />
        </div>
      ) : (
        <div className={cn(cardCls, 'overflow-hidden')}>
          <DataTable
            columns={columns}
            data={rows}
            loading={loading && !rows.length}
            emptyTitle="No assets match"
            emptyDescription="Try another search or clear the filters."
            emptyIcon={Laptop}
            onRowClick={(row) => router.push(`/admin/inventory/assets/${row.id}`)}
          />
          {meta && meta.pages > 1 && (
            <div className="px-4 py-3 border-t border-gray-100">
              <Pagination meta={meta} onPageChange={setPage} />
            </div>
          )}
        </div>
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
    <Suspense fallback={<div className="flex items-center justify-center min-h-[60vh]"><div className="w-7 h-7 border-2 border-gray-300 border-t-gray-700 rounded-full animate-spin" /></div>}>
      <AssetsPage />
    </Suspense>
  )
}
