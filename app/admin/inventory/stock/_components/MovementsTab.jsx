'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, Download, History, RotateCcw } from 'lucide-react'
import DataTable from '@/components/ui/DataTable'
import Pagination from '@/components/ui/Pagination'
import FilterSelect from '@/components/ui/FilterSelect'
import DatePicker from '@/components/ui/DatePicker'
import PeoplePicker from '@/components/ui/PeoplePicker'
import EmptyState from '@/components/ui/EmptyState'
import { InventoryBadge } from '@/components/inventory/AssetStatusBadge'
import { formatDate } from '@/lib/utils'
import { dhakaDayKey } from '@/lib/dhakaTime'
import { STOCK_MOVEMENT_TYPES, STOCK_MOVEMENT_META } from '@/lib/inventory/constants'
import { movementParty } from './ItemHistoryModal'
import { qtyText, tk } from './stockShared'

const TYPE_OPTIONS = STOCK_MOVEMENT_TYPES.filter(t => t !== 'TRANSFER').map(t => ({ value: t, label: STOCK_MOVEMENT_META[t].label }))

/** Movement ledger with filters, totals and CSV export. */
export default function MovementsTab({ items = [], itemId, onItemChange, refreshKey = 0 }) {
  const [rows, setRows] = useState([])
  const [meta, setMeta] = useState(null)
  const [totals, setTotals] = useState(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(null)
  const [type, setType] = useState('')
  const [employee, setEmployee] = useState(null)
  const [start, setStart] = useState(null)
  const [end, setEnd] = useState(null)
  const [page, setPage] = useState(1)
  const seq = useRef(0)

  const filterKey = JSON.stringify({ itemId, type, emp: employee?.id ?? null, start, end })
  const lastKey = useRef(filterKey)
  useEffect(() => {
    if (lastKey.current !== filterKey) { lastKey.current = filterKey; setPage(1) }
  }, [filterKey])

  const query = useCallback((extra = {}) => {
    const qs = new URLSearchParams()
    if (itemId) qs.set('stockItemId', itemId)
    if (type) qs.set('type', type)
    if (employee?.id) qs.set('employeeId', employee.id)
    if (start) qs.set('start', start)
    if (end) qs.set('end', end)
    for (const [k, v] of Object.entries(extra)) qs.set(k, String(v))
    return qs
  }, [itemId, type, employee, start, end])

  const load = useCallback(async () => {
    const id = ++seq.current
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/inventory/stock/movements?${query({ page, limit: 30 })}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not load movements')
      if (id !== seq.current) return
      setRows(json.data ?? [])
      setMeta(json.meta ?? null)
      setTotals(json.totals ?? null)
    } catch (err) {
      if (id === seq.current) setError(err.message)
    } finally {
      if (id === seq.current) setLoading(false)
    }
  }, [query, page])

  useEffect(() => { load() }, [load, refreshKey])

  const hasFilters = Boolean(itemId || type || employee || start || end)
  function reset() {
    onItemChange?.('')
    setType('')
    setEmployee(null)
    setStart(null)
    setEnd(null)
  }

  const columns = [
    {
      key: 'date', label: 'Date',
      render: (m) => (
        <div className="whitespace-nowrap">
          <p className="text-gray-800">{m.date ? formatDate(dhakaDayKey(m.date)) : '—'}</p>
          <p className="text-[11px] text-gray-400">{m.movementNo}</p>
        </div>
      ),
    },
    {
      key: 'item', label: 'Item',
      render: (m) => (
        <div className="min-w-[160px]">
          <p className="text-gray-900">{m.item?.name ?? '—'}</p>
          <p className="text-[11px] text-gray-400">{m.item?.sku}</p>
        </div>
      ),
    },
    {
      key: 'type', label: 'Type',
      render: (m) => {
        const t = STOCK_MOVEMENT_META[m.type] ?? { label: m.type, color: 'gray' }
        return <InventoryBadge label={t.label} color={t.color} />
      },
    },
    {
      key: 'qty', label: 'Qty',
      render: (m) => (
        <span className={`whitespace-nowrap font-medium ${m.direction === 'OUT' ? 'text-orange-600' : 'text-green-700'}`}>
          {m.direction === 'OUT' ? '−' : '+'}{qtyText(m.qty)} {m.item?.unit ?? ''}
        </span>
      ),
    },
    { key: 'totalCost', label: 'Value', render: (m) => <span className="whitespace-nowrap">{tk(m.totalCost)}</span> },
    { key: 'qtyAfter', label: 'Balance when recorded', render: (m) => <span className="text-gray-500">{m.qtyAfter !== null && m.qtyAfter !== undefined ? qtyText(m.qtyAfter) : '—'}</span> },
    {
      key: 'party', label: 'To / from',
      render: (m) => (
        <div className="min-w-[160px]">
          {m.purchaseBill
            ? <Link href={`/admin/inventory/purchases/${m.purchaseBill.id}`} className="text-gray-800 hover:underline">{m.purchaseBill.billNo}</Link>
            : <span className="text-gray-800">{movementParty(m) ?? '—'}</span>}
          {(m.reason || m.reference) && <p className="text-[11px] text-gray-400">{[m.reason, m.reference].filter(Boolean).join(' · ')}</p>}
        </div>
      ),
    },
    { key: 'by', label: 'By', render: (m) => <span className="text-gray-500 whitespace-nowrap">{m.createdBy?.name ?? '—'}</span> },
  ]

  return (
    <div className="space-y-4">
      <div className="bg-white border border-gray-100 rounded-xl p-4 flex flex-wrap items-center gap-3">
        <select value={itemId || ''} onChange={e => onItemChange?.(e.target.value)}
          className="border border-gray-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-gray-900 max-w-full sm:w-64">
          <option value="">All items</option>
          {itemId && !items.some(i => i.id === itemId) && <option value={itemId}>Selected item</option>}
          {items.map(i => <option key={i.id} value={i.id}>{i.name} · {i.sku}</option>)}
        </select>
        <FilterSelect value={type} onChange={v => setType(v ?? '')} options={TYPE_OPTIONS} placeholder="All types" />
        <div className="w-full sm:w-56">
          <PeoplePicker types={['EMPLOYEE']} typeFilter={false} value={employee} onChange={setEmployee} placeholder="Any employee" />
        </div>
        <div className="flex items-center gap-2">
          <DatePicker value={start} onChange={setStart} placeholder="From" size="sm" />
          <span className="text-gray-300">–</span>
          <DatePicker value={end} onChange={setEnd} placeholder="To" size="sm" />
        </div>
        {hasFilters && (
          <button type="button" onClick={reset} className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-900">
            <RotateCcw className="w-3.5 h-3.5" /> Reset
          </button>
        )}
        <a href={`/api/inventory/stock/movements?${query({ format: 'csv' })}`}
          className="ml-auto inline-flex items-center gap-1.5 border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 rounded-lg px-3 py-2 text-sm font-medium">
          <Download className="w-4 h-4" /> CSV
        </a>
      </div>

      {totals && (totals.inCount + totals.outCount) > 0 && (
        <div className="flex flex-wrap gap-3 text-xs text-gray-600">
          <span className="rounded-lg bg-green-50 text-green-800 px-2.5 py-1">In: {totals.inCount} · {tk(totals.inValue, 0)}</span>
          <span className="rounded-lg bg-orange-50 text-orange-800 px-2.5 py-1">Out: {totals.outCount} · {tk(totals.outValue, 0)}</span>
        </div>
      )}

      <div className="bg-white border border-gray-100 rounded-xl overflow-hidden">
        {error ? (
          <EmptyState icon={AlertCircle} title="Could not load movements" description={error}
            action={<button type="button" onClick={load} className="text-sm font-medium text-gray-900 underline">Try again</button>} />
        ) : (
          <>
            <DataTable columns={columns} data={rows} loading={loading} emptyIcon={History}
              emptyTitle={hasFilters ? 'No movements match these filters' : 'No stock movements yet'}
              emptyDescription={hasFilters ? 'Try a wider date range or clear the filters.' : 'Receipts from purchase bills, issues and adjustments appear here.'} />
            {meta && meta.pages > 1 && (
              <div className="px-4 py-3 border-t border-gray-100">
                <Pagination meta={meta} onPageChange={setPage} />
              </div>
            )}
          </>
        )}
      </div>
    </div>
  )
}
