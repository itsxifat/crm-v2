'use client'

import { Suspense, useCallback, useEffect, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import toast from 'react-hot-toast'
import {
  AlertCircle, AlertTriangle, ArrowDownLeft, ArrowUpRight, Boxes, Download, History, PackageX, Pencil, Plus,
  Power, RotateCcw, ShoppingCart, Trash2, Wallet, Wrench,
} from 'lucide-react'
import DataTable from '@/components/ui/DataTable'
import Pagination from '@/components/ui/Pagination'
import SearchInput from '@/components/ui/SearchInput'
import FilterSelect from '@/components/ui/FilterSelect'
import StatsCard from '@/components/ui/StatsCard'
import ActionMenu from '@/components/ui/ActionMenu'
import EmptyState from '@/components/ui/EmptyState'
import Modal, { ModalFooter } from '@/components/ui/Modal'
import Button, { buttonVariants } from '@/components/ui/Button'
import { Card } from '@/components/ui/Card'
import PageHeader from '@/components/ui/PageHeader'
import Tabs from '@/components/ui/Tabs'
import { PageLoader } from '@/components/ui/LoadingSpinner'
import { InventoryBadge } from '@/components/inventory/AssetStatusBadge'
import { Can, usePermission } from '@/components/auth/Can'
import { cn } from '@/lib/utils'
import { useInventoryOptions, invalidateInventoryOptions } from '../purchases/_components/useInventoryOptions'
import StockItemModal from './_components/StockItemModal'
import MovementModal from './_components/MovementModal'
import ItemHistoryModal from './_components/ItemHistoryModal'
import MovementsTab from './_components/MovementsTab'
import { ITEM_STATUS_META, qtyText, tk } from './_components/stockShared'

const STATUS_FILTERS = [
  { value: 'active', label: 'Active' },
  { value: 'inactive', label: 'Inactive' },
  { value: 'all', label: 'Active & inactive' },
]

const SORT_OPTIONS = [
  { value: 'name', label: 'Name' },
  { value: 'qty', label: 'Lowest quantity' },
  { value: 'value', label: 'Highest value' },
  { value: 'updated', label: 'Recently moved' },
]

function StockPage() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const { can } = usePermission()
  const { options, reload: reloadOptions } = useInventoryOptions()
  const categories = options?.categories ?? []
  const consumableCats = categories.filter(c => c.type === 'CONSUMABLE')

  const [tab, setTab] = useState(searchParams.get('tab') === 'movements' ? 'movements' : 'items')
  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState(null)
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)

  const [search, setSearch] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [lowOnly, setLowOnly] = useState(searchParams.get('lowStock') === '1')
  const [status, setStatus] = useState('active')
  const [sort, setSort] = useState('name')
  const [page, setPage] = useState(1)
  const [refreshKey, setRefreshKey] = useState(0)
  const seq = useRef(0)

  const [itemModal, setItemModal] = useState({ open: false, item: null })
  const [moveModal, setMoveModal] = useState({ open: false, item: null, type: 'ISSUE' })
  const [historyId, setHistoryId] = useState(searchParams.get('item') || null)
  const [movementItemId, setMovementItemId] = useState(searchParams.get('stockItemId') || '')
  const [deleteItem, setDeleteItem] = useState(null)
  const [busy, setBusy] = useState(false)

  const filterKey = JSON.stringify({ search, categoryId, lowOnly, status, sort })
  const lastKey = useRef(filterKey)
  useEffect(() => {
    if (lastKey.current !== filterKey) { lastKey.current = filterKey; setPage(1) }
  }, [filterKey])

  const itemsQuery = useCallback((extra = {}) => {
    const qs = new URLSearchParams({ status, sort })
    if (search) qs.set('search', search)
    if (categoryId) qs.set('categoryId', categoryId)
    if (lowOnly) qs.set('lowStock', '1')
    for (const [k, v] of Object.entries(extra)) qs.set(k, String(v))
    return qs
  }, [status, sort, search, categoryId, lowOnly])

  const load = useCallback(async () => {
    const id = ++seq.current
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/inventory/stock?${itemsQuery({ page, limit: 30 })}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || "Couldn't load stock items")
      if (id !== seq.current) return
      setRows(json.data ?? [])
      setMeta(json.meta ?? null)
      setSummary(json.summary ?? null)
    } catch (err) {
      if (id === seq.current) setError(err.message)
    } finally {
      if (id === seq.current) setLoading(false)
    }
  }, [itemsQuery, page])

  useEffect(() => { load() }, [load, refreshKey])

  // A link followed while this page is open (notification, report, purchase bill) re-applies
  // ?item= / ?lowStock= — the URL is otherwise only written from state below.
  const spKey = searchParams.toString()
  const lastSpKey = useRef(spKey)
  useEffect(() => {
    if (lastSpKey.current === spKey) return
    lastSpKey.current = spKey
    const qs = new URLSearchParams(spKey)
    const item = qs.get('item')
    if (item) setHistoryId(item)
    setLowOnly(qs.get('lowStock') === '1')
    if (qs.get('tab') === 'movements') setTab('movements')
  }, [spKey])

  // Keep the URL in step with the tab / opened item (shareable, back-button friendly).
  useEffect(() => {
    const qs = new URLSearchParams()
    if (tab === 'movements') qs.set('tab', 'movements')
    if (historyId) qs.set('item', historyId)
    if (lowOnly) qs.set('lowStock', '1')
    const next = `/admin/inventory/stock${qs.toString() ? `?${qs}` : ''}`
    router.replace(next, { scroll: false })
  }, [tab, historyId, lowOnly, router])

  function changed() {
    invalidateInventoryOptions()
    reloadOptions()
    setRefreshKey(k => k + 1)
  }

  async function toggleActive(item) {
    setBusy(true)
    try {
      const res = await fetch(`/api/inventory/stock/${item.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isActive: !item.isActive }),
      })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not update the item')
      toast.success(item.isActive ? `${item.name} deactivated` : `${item.name} reactivated`)
      changed()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  async function confirmDelete() {
    if (!deleteItem) return
    setBusy(true)
    try {
      const res = await fetch(`/api/inventory/stock/${deleteItem.id}`, { method: 'DELETE' })
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not delete the item')
      toast.success(`${deleteItem.name} deleted`)
      setDeleteItem(null)
      changed()
    } catch (err) {
      toast.error(err.message)
    } finally {
      setBusy(false)
    }
  }

  const canAssign = can('inventory.assign')
  const canManage = can('inventory.manage')
  const hasFilters = Boolean(search || categoryId || lowOnly || status !== 'active')

  const columns = [
    {
      key: 'name', label: 'Item', sortable: true,
      render: (i) => (
        <div className="min-w-[180px]">
          <button type="button" onClick={(e) => { e.stopPropagation(); setHistoryId(i.id) }} className="text-left font-medium text-gray-900 underline-offset-4 hover:underline">
            {i.name}
          </button>
          <p className="text-xs text-gray-400">{i.sku}{i.location ? ` · ${i.location.name}` : ''}</p>
        </div>
      ),
    },
    { key: 'category', label: 'Category', render: (i) => <span className="text-gray-600">{i.category?.name ?? '—'}</span> },
    {
      key: 'qtyOnHand', label: 'On hand', sortable: true, className: '[&>div]:justify-end', cellClassName: 'text-right tabular-nums',
      render: (i) => <span className={cn('font-medium whitespace-nowrap', i.status === 'OUT' ? 'text-red-600' : i.status === 'LOW' ? 'text-amber-700' : 'text-gray-900')}>{qtyText(i.qtyOnHand)} {i.unit}</span>,
    },
    {
      key: 'avgCost', label: 'Avg cost', sortable: true, className: '[&>div]:justify-end', cellClassName: 'text-right tabular-nums',
      render: (i) => <span className="whitespace-nowrap">{tk(i.avgCost)}</span>,
    },
    {
      key: 'stockValue', label: 'Value', sortable: true, className: '[&>div]:justify-end', cellClassName: 'text-right tabular-nums',
      render: (i) => <span className="whitespace-nowrap">{tk(i.stockValue, 0)}</span>,
    },
    {
      key: 'reorderLevel', label: 'Reorder at', className: '[&>div]:justify-end', cellClassName: 'text-right tabular-nums',
      render: (i) => <span className="text-gray-500 whitespace-nowrap">{i.reorderLevel ? `${qtyText(i.reorderLevel)} ${i.unit}` : '—'}</span>,
    },
    {
      key: 'status', label: 'Status',
      render: (i) => {
        const m = ITEM_STATUS_META[i.status] ?? ITEM_STATUS_META.OK
        return <InventoryBadge label={m.label} color={m.color} />
      },
    },
    {
      key: 'actions', label: '', className: 'w-10',
      render: (i) => (
        <div onClick={e => e.stopPropagation()}>
          <ActionMenu items={[
            canAssign && i.isActive && { label: 'Issue', icon: ArrowUpRight, onClick: () => setMoveModal({ open: true, item: i, type: 'ISSUE' }), disabled: i.qtyOnHand <= 0, hint: i.qtyOnHand <= 0 ? 'Out of stock' : undefined },
            canAssign && { label: 'Return to store', icon: ArrowDownLeft, onClick: () => setMoveModal({ open: true, item: i, type: 'RETURN' }) },
            canManage && { label: 'Adjust quantity', icon: Wrench, onClick: () => setMoveModal({ open: true, item: i, type: 'ADJUST_IN' }) },
            canManage && { label: 'Mark damaged', icon: PackageX, onClick: () => setMoveModal({ open: true, item: i, type: 'DAMAGED' }), disabled: i.qtyOnHand <= 0 },
            { label: 'History', icon: History, onClick: () => setHistoryId(i.id) },
            can('inventory.purchase') && { label: 'Buy more', icon: ShoppingCart, href: '/admin/inventory/purchases/new' },
            canManage && { label: 'Edit', icon: Pencil, onClick: () => setItemModal({ open: true, item: i }) },
            canManage && { label: i.isActive ? 'Deactivate' : 'Reactivate', icon: Power, onClick: () => toggleActive(i), disabled: busy },
            canManage && { label: 'Delete', icon: Trash2, danger: true, onClick: () => setDeleteItem(i) },
          ].filter(Boolean)} />
        </div>
      ),
    },
  ]

  return (
    <div className="space-y-6">
      <PageHeader
        title="Consumables"
        actions={(
          <>
            <a href={`/api/inventory/stock?${itemsQuery({ format: 'csv' })}`} className={buttonVariants({ variant: 'outline' })}>
              <Download /> Export CSV
            </a>
            <Can perm="inventory.manage">
              <Button onClick={() => setItemModal({ open: true, item: null })}>
                <Plus /> Add item
              </Button>
            </Can>
          </>
        )}
      />

      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <StatsCard title="Items" value={summary ? summary.items : '—'} icon={Boxes} color="blue" />
        <StatsCard title="Stock value" value={summary ? tk(summary.value, 0) : '—'} icon={Wallet} color="green" />
        <StatsCard title="Low stock" value={summary ? summary.low : '—'} icon={AlertTriangle} color="yellow" />
        <StatsCard title="Out of stock" value={summary ? summary.out : '—'} icon={PackageX} color="red" />
      </div>

      <Tabs
        variant="underline"
        value={tab}
        onChange={setTab}
        tabs={[{ value: 'items', label: 'Items' }, { value: 'movements', label: 'Movements' }]}
      />

      {tab === 'items' ? (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <SearchInput value={search} onChange={setSearch} placeholder="Search SKU or name…" className="w-full sm:w-64" />
            <FilterSelect value={categoryId} onChange={v => setCategoryId(v ?? '')} options={consumableCats.map(c => ({ value: c.id, label: c.name }))} placeholder="All categories" />
            <FilterSelect value={status} onChange={v => setStatus(v || 'active')} options={STATUS_FILTERS} placeholder="Active" />
            <FilterSelect value={sort} onChange={v => setSort(v || 'name')} options={SORT_OPTIONS} placeholder="Sort" />
            <label className="inline-flex h-9 cursor-pointer items-center gap-2 rounded-lg border border-input bg-white px-3 text-sm text-gray-700 shadow-xs hover:bg-gray-50">
              <input type="checkbox" checked={lowOnly} onChange={e => setLowOnly(e.target.checked)} className="rounded border-gray-300" />
              Low / out of stock
            </label>
            {hasFilters && (
              <Button variant="ghost" size="sm" onClick={() => { setSearch(''); setCategoryId(''); setLowOnly(false); setStatus('active') }}>
                <RotateCcw /> Reset
              </Button>
            )}
          </div>

          <Card className="overflow-hidden">
            {error ? (
              <EmptyState icon={AlertCircle} title="Couldn't load stock" description={error}
                action={<Button variant="outline" size="sm" onClick={load}>Try again</Button>} />
            ) : !loading && rows.length === 0 && !hasFilters ? (
              <EmptyState icon={Boxes} title="No consumables yet"
                description="Added from purchase bills or by hand."
                action={(canManage || can('inventory.purchase')) ? (
                  <div className="flex flex-wrap justify-center gap-2">
                    {canManage && (
                      <Button variant="outline" size="sm" onClick={() => setItemModal({ open: true, item: null })}>
                        <Plus /> Add item
                      </Button>
                    )}
                    {can('inventory.purchase') && (
                      <Button variant="outline" size="sm" href="/admin/inventory/purchases/new">
                        <ShoppingCart /> New purchase bill
                      </Button>
                    )}
                  </div>
                ) : null}
              />
            ) : (
              <>
                <DataTable columns={columns} data={rows} loading={loading} emptyIcon={Boxes}
                  emptyTitle={lowOnly ? 'Nothing is running low' : 'No results'}
                  emptyDescription={lowOnly ? 'Every active item is above its reorder level.' : 'Try a different search or clear the filters.'}
                  onRowClick={(i) => setHistoryId(i.id)} />
                {meta && meta.pages > 1 && (
                  <div className="border-t border-gray-100 px-4 py-3">
                    <Pagination meta={meta} onPageChange={setPage} />
                  </div>
                )}
              </>
            )}
          </Card>
        </>
      ) : (
        <MovementsTab
          items={options?.stockItems ?? []}
          itemId={movementItemId}
          onItemChange={setMovementItemId}
          refreshKey={refreshKey}
        />
      )}

      <StockItemModal
        open={itemModal.open}
        onOpenChange={(v) => setItemModal(s => ({ ...s, open: v }))}
        item={itemModal.item}
        categories={categories}
        locations={options?.locations ?? []}
        onSaved={changed}
      />
      <MovementModal
        open={moveModal.open}
        onOpenChange={(v) => setMoveModal(s => ({ ...s, open: v }))}
        item={moveModal.item}
        initialType={moveModal.type}
        onDone={changed}
      />
      <ItemHistoryModal
        open={Boolean(historyId)}
        onOpenChange={(v) => { if (!v) setHistoryId(null) }}
        itemId={historyId}
        refreshKey={refreshKey}
        onMove={(canAssign || canManage) ? (item) => setMoveModal({ open: true, item, type: canAssign ? 'ISSUE' : 'ADJUST_IN' }) : null}
        onShowAll={(item) => { setHistoryId(null); setMovementItemId(item.id); setTab('movements') }}
      />

      <Modal open={Boolean(deleteItem)} onOpenChange={(v) => { if (!v && !busy) setDeleteItem(null) }} title={`Delete ${deleteItem?.name ?? 'item'}?`}
        description="This can't be undone. Items with stock history can only be deactivated." size="sm">
        <ModalFooter>
          <Button variant="outline" onClick={() => setDeleteItem(null)} disabled={busy}>Keep</Button>
          <Button variant="destructive" onClick={confirmDelete} loading={busy}>Delete</Button>
        </ModalFooter>
      </Modal>
    </div>
  )
}

export default function StockPageWrapper() {
  return (
    <Suspense fallback={<PageLoader />}>
      <StockPage />
    </Suspense>
  )
}

