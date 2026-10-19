'use client'

import { useCallback, useEffect, useState } from 'react'
import Link from 'next/link'
import { AlertCircle, ArrowRightLeft, History, Loader2 } from 'lucide-react'
import Modal from '@/components/ui/Modal'
import Button from '@/components/ui/Button'
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from '@/components/ui/Table'
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
      if (!res.ok) throw new Error(json.error || "Couldn't load the item")
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
        <div className="flex items-center justify-center py-16 text-gray-400"><Loader2 className="size-5 animate-spin" /></div>
      ) : error ? (
        <div className="flex flex-col items-center gap-3 py-12 text-center">
          <AlertCircle className="size-5 text-red-500" />
          <p className="text-sm text-gray-600">{error}</p>
          <Button variant="outline" size="sm" onClick={load}>Try again</Button>
        </div>
      ) : data ? (
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Tile label="On hand" value={`${qtyText(data.qtyOnHand)} ${data.unit}`} extra={status && <InventoryBadge label={status.label} color={status.color} className="mt-1.5" />} />
            <Tile label="Average cost" value={tk(data.avgCost)} />
            <Tile label="Stock value" value={tk(data.stockValue)} />
            <Tile label="Reorder at" value={data.reorderLevel ? `${qtyText(data.reorderLevel)} ${data.unit}` : 'Only when empty'} extra={data.reorderQty ? <span className="text-xs text-gray-400">order {qtyText(data.reorderQty)}</span> : null} />
          </div>

          {Object.keys(data.totals ?? {}).length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {Object.entries(data.totals).map(([type, t]) => (
                <span key={type} className="inline-flex items-center gap-1.5 rounded-md border border-gray-200/80 bg-white px-2 py-1 text-xs text-gray-600 tabular-nums">
                  <span className="font-medium text-gray-900">{STOCK_MOVEMENT_META[type]?.label ?? type}</span>
                  {qtyText(t.qty)} {data.unit} · {tk(t.value, 0)}
                </span>
              ))}
            </div>
          )}

          {((onMove && data.isActive) || onShowAll) && (
            <div className="flex flex-wrap gap-2">
              {onMove && data.isActive && (
                <Button size="sm" onClick={() => onMove(data)}>
                  <ArrowRightLeft /> Record movement
                </Button>
              )}
              {onShowAll && (
                <Button variant="outline" size="sm" onClick={() => onShowAll(data)}>
                  <History /> All movements
                </Button>
              )}
            </div>
          )}

          <div className="overflow-hidden rounded-lg border border-gray-200/80">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="px-3">Date</TableHead>
                  <TableHead className="px-3">Movement</TableHead>
                  <TableHead className="px-3 text-right">Qty</TableHead>
                  <TableHead className="px-3 text-right">Value</TableHead>
                  <TableHead className="px-3 text-right" title="Quantity on hand after the movement, in date order">Balance</TableHead>
                  <TableHead className="px-3">To / from</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(data.movements ?? []).length === 0 ? (
                  <TableRow className="hover:bg-transparent"><TableCell colSpan={6} className="px-3 py-8 text-center text-sm text-muted-foreground">No movements yet</TableCell></TableRow>
                ) : data.movements.map(m => {
                  const meta = STOCK_MOVEMENT_META[m.type] ?? { label: m.type, color: 'gray' }
                  const party = movementParty(m)
                  const balance = m.balanceAfter ?? m.qtyAfter
                  return (
                    <TableRow key={m.id}>
                      <TableCell className="whitespace-nowrap px-3 py-2.5 align-top text-gray-600">{m.date ? formatDate(dhakaDayKey(m.date)) : '—'}</TableCell>
                      <TableCell className="px-3 py-2.5 align-top">
                        <InventoryBadge label={meta.label} color={meta.color} />
                        <p className="mt-0.5 text-xs text-gray-400">{m.movementNo}{m.createdBy ? ` · ${m.createdBy.name}` : ''}</p>
                      </TableCell>
                      <TableCell className={`whitespace-nowrap px-3 py-2.5 text-right align-top font-medium tabular-nums ${m.direction === 'OUT' ? 'text-orange-600' : 'text-emerald-700'}`}>
                        {m.direction === 'OUT' ? '−' : '+'}{qtyText(m.qty)}
                      </TableCell>
                      <TableCell className="whitespace-nowrap px-3 py-2.5 text-right align-top tabular-nums">{tk(m.totalCost)}</TableCell>
                      <TableCell className={`whitespace-nowrap px-3 py-2.5 text-right align-top tabular-nums ${num(balance) < 0 ? 'text-red-600' : 'text-gray-500'}`}>{balance !== null && balance !== undefined ? qtyText(balance) : '—'}</TableCell>
                      <TableCell className="min-w-[160px] px-3 py-2.5 align-top">
                        {m.purchaseBill ? (
                          <Link href={`/admin/inventory/purchases/${m.purchaseBill.id}`} className="font-medium text-gray-900 underline-offset-4 hover:underline">{m.purchaseBill.billNo}</Link>
                        ) : (
                          <span className="text-gray-800">{party ?? '—'}</span>
                        )}
                        {(m.reason || m.reference) && (
                          <p className="text-xs text-gray-400">{[m.reason, m.reference].filter(Boolean).join(' · ')}</p>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                })}
              </TableBody>
            </Table>
          </div>
          {num(data.movements?.length) >= 25 && <p className="text-xs text-muted-foreground">Latest 25 movements shown.</p>}
        </div>
      ) : null}
    </Modal>
  )
}

function Tile({ label, value, extra }) {
  return (
    <div className="min-w-0 rounded-lg bg-gray-50 px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-0.5 text-base font-semibold tabular-nums text-gray-900">{value}</p>
      {extra}
    </div>
  )
}
