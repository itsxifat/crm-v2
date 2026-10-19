'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, ArrowRightLeft, History, Loader2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import { InventoryBadge } from '@/components/inventory/AssetStatusBadge'
import { formatDate } from '@/lib/utils'
import { dhakaDayKey } from '@/lib/dhakaTime'
import { STOCK_MOVEMENT_META } from '@/lib/inventory/constants'
import { ITEM_STATUS_META, num, qtyText, tk } from './stockShared'

export function movementParty(m) {
  if (m.employee) return m.employee.name
  if (m.department) return m.department.name
  if (m.project) return m.project.code ? `${m.project.code} · ${m.project.name}` : m.project.name
  if (m.purchaseBill) return m.purchaseBill.billNo
  return null
}

/** Item card + totals by movement type + the 25 latest movements. */
export default function ItemHistoryModal({ open, onOpenChange, itemId, refreshKey = 0, onMove, onShowAll }) {
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  const load = useCallback(async () => {
    if (!itemId) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`/api/inventory/stock/${itemId}`)
      const json = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(json.error || 'Could not load the item')
      setData(json.data)
    } catch (err) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }, [itemId])

  useEffect(() => {
    if (open) load()
    else setData(null)
  }, [open, load, refreshKey])

  const status = data ? (ITEM_STATUS_META[data.status] ?? ITEM_STATUS_META.OK) : null

  return (
    <Modal open={open} onOpenChange={onOpenChange} title={data?.name ?? 'Stock history'}
      description={data ? `${data.sku}${data.category ? ` · ${data.category.name}` : ''}${data.location ? ` · ${data.location.name}` : ''}` : undefined} size="xl">
      {loading && !data ? (
        <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="w-5 h-5 animate-spin" /></div>
      ) : error ? (
        <div className="flex flex-col items-center gap-2 py-12 text-center">
          <AlertCircle className="w-6 h-6 text-red-400" />
          <p className="text-sm text-gray-600">{error}</p>
          <button type="button" onClick={load} className="text-sm font-medium text-gray-900 underline">Try again</button>
        </div>
      ) : data ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
            <Tile label="On hand" value={`${qtyText(data.qtyOnHand)} ${data.unit}`} extra={status && <InventoryBadge label={status.label} color={status.color} />} />
            <Tile label="Average cost" value={tk(data.avgCost)} />
            <Tile label="Stock value" value={tk(data.stockValue)} />
            <Tile label="Reorder at" value={data.reorderLevel ? `${qtyText(data.reorderLevel)} ${data.unit}` : 'Only when empty'} extra={data.reorderQty ? <span className="text-[11px] text-gray-400">order {qtyText(data.reorderQty)}</span> : null} />
          </div>

          {Object.keys(data.totals ?? {}).length > 0 && (
            <div className="flex flex-wrap gap-2">
              {Object.entries(data.totals).map(([type, t]) => (
                <span key={type} className="inline-flex items-center gap-1.5 rounded-lg bg-gray-50 border border-gray-100 px-2.5 py-1 text-xs text-gray-600">
                  <span className="font-medium text-gray-800">{STOCK_MOVEMENT_META[type]?.label ?? type}</span>
                  {qtyText(t.qty)} {data.unit} · {tk(t.value, 0)}
                </span>
              ))}
            </div>
          )}

          <div className="flex flex-wrap gap-2">
            {onMove && data.isActive && (
              <button type="button" onClick={() => onMove(data)}
                className="inline-flex items-center gap-1.5 bg-gray-900 text-white hover:bg-gray-800 rounded-lg px-3 py-1.5 text-sm font-medium">
                <ArrowRightLeft className="w-4 h-4" /> Record movement
              </button>
            )}
            {onShowAll && (
              <button type="button" onClick={() => onShowAll(data)}
                className="inline-flex items-center gap-1.5 border border-gray-200 bg-white text-gray-700 hover:bg-gray-50 rounded-lg px-3 py-1.5 text-sm font-medium">
                <History className="w-4 h-4" /> All movements
              </button>
            )}
          </div>

          <div className="overflow-x-auto border border-gray-100 rounded-xl">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-gray-50/60 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider">
                  <th className="px-3 py-2">Date</th>
                  <th className="px-3 py-2">Movement</th>
                  <th className="px-3 py-2 text-right">Qty</th>
                  <th className="px-3 py-2 text-right">Value</th>
                  <th className="px-3 py-2 text-right" title="Quantity on hand after the movement, in date order">Balance</th>
                  <th className="px-3 py-2">To / from</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {(data.movements ?? []).length === 0 ? (
                  <tr><td colSpan={6} className="px-3 py-8 text-center text-sm text-gray-400">No movements yet.</td></tr>
                ) : data.movements.map(m => {
                  const meta = STOCK_MOVEMENT_META[m.type] ?? { label: m.type, color: 'gray' }
                  const party = movementParty(m)
                  const balance = m.balanceAfter ?? m.qtyAfter
                  return (
                    <tr key={m.id} className="align-top">
                      <td className="px-3 py-2 whitespace-nowrap text-gray-600">{m.date ? formatDate(dhakaDayKey(m.date)) : '—'}</td>
                      <td className="px-3 py-2">
                        <InventoryBadge label={meta.label} color={meta.color} />
                        <p className="text-[11px] text-gray-400 mt-0.5">{m.movementNo}{m.createdBy ? ` · ${m.createdBy.name}` : ''}</p>
                      </td>
                      <td className={`px-3 py-2 text-right whitespace-nowrap font-medium ${m.direction === 'OUT' ? 'text-orange-600' : 'text-green-700'}`}>
                        {m.direction === 'OUT' ? '−' : '+'}{qtyText(m.qty)}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap text-gray-700">{tk(m.totalCost)}</td>
                      <td className={`px-3 py-2 text-right whitespace-nowrap ${num(balance) < 0 ? 'text-red-600' : 'text-gray-500'}`}>{balance !== null && balance !== undefined ? qtyText(balance) : '—'}</td>
                      <td className="px-3 py-2 min-w-[160px]">
                        {m.purchaseBill ? (
                          <Link href={`/admin/inventory/purchases/${m.purchaseBill.id}`} className="text-gray-800 hover:underline">{m.purchaseBill.billNo}</Link>
                        ) : (
                          <span className="text-gray-800">{party ?? '—'}</span>
                        )}
                        {(m.reason || m.reference) && (
                          <p className="text-[11px] text-gray-400">{[m.reason, m.reference].filter(Boolean).join(' · ')}</p>
                        )}
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
          {num(data.movements?.length) >= 25 && <p className="text-xs text-gray-400">Showing the latest 25 movements.</p>}
        </div>
      ) : null}
    </Modal>
  )
}

function Tile({ label, value, extra }) {
  return (
    <div className="rounded-xl border border-gray-100 bg-gray-50/60 px-3 py-2">
      <p className="text-[11px] text-gray-500">{label}</p>
      <p className="text-base font-semibold text-gray-900">{value}</p>
      {extra}
    </div>
  )
}
