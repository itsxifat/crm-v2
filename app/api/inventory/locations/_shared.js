/**
 * Shared validation & helpers for the inventory-location routes (not a route).
 */

import { z } from 'zod'
import { LOCATION_TYPES, LOCATION_TYPE_LABELS, TERMINAL_STATUSES } from '@/lib/inventory/constants'
import { Asset, StockItem, InventoryLocation, AssetAudit, AssetEvent, PurchaseBill } from '@/models'

const optText = (max) => z.preprocess(
  v => (typeof v === 'string' && !v.trim() ? null : v),
  z.string().trim().max(max, `At most ${max} characters`).optional().nullable(),
)

const code = z.preprocess(
  v => (typeof v === 'string' && !v.trim() ? null : v),
  z.string().trim()
    .transform(s => s.toUpperCase().replace(/\s+/g, ''))
    .pipe(z.string().regex(/^[A-Z0-9][A-Z0-9_-]{0,11}$/, 'Code must be up to 12 letters, digits, - or _'))
    .optional().nullable(),
)

const fields = {
  name:     z.string().trim().min(1, 'Name is required').max(100, 'Name is too long'),
  code,
  type:     z.enum(LOCATION_TYPES),
  parentId: z.preprocess(v => (v === '' ? null : v), z.string().regex(/^[a-f\d]{24}$/i, 'Invalid parent location').optional().nullable()),
  address:  optText(300),
  notes:    optText(1000),
  isActive: z.boolean(),
}

export const createLocationSchema = z.object({
  ...fields,
  type: fields.type.default('OFFICE'),
  isActive: fields.isActive.optional(),
})

export const updateLocationSchema = z.object(fields).partial()

/** Map(locationId → { assets, held, stockItems, children }). */
export async function locationUsage(ids) {
  const [assetRows, stockRows, childRows] = await Promise.all([
    Asset.aggregate([
      { $match: { locationId: { $in: ids }, isArchived: { $ne: true } } },
      { $group: {
        _id: '$locationId',
        assets: { $sum: 1 },
        held: { $sum: { $cond: [{ $in: ['$status', TERMINAL_STATUSES] }, 0, 1] } },
      } },
    ]),
    StockItem.aggregate([
      { $match: { locationId: { $in: ids } } },
      { $group: { _id: '$locationId', stockItems: { $sum: 1 } } },
    ]),
    InventoryLocation.aggregate([
      { $match: { parentId: { $in: ids } } },
      { $group: { _id: '$parentId', children: { $sum: 1 } } },
    ]),
  ])
  const map = new Map()
  const get = (k) => {
    if (!map.has(k)) map.set(k, { assets: 0, held: 0, stockItems: 0, children: 0 })
    return map.get(k)
  }
  for (const r of assetRows) Object.assign(get(String(r._id)), { assets: r.assets, held: r.held })
  for (const r of stockRows) get(String(r._id)).stockItems = r.stockItems
  for (const r of childRows) get(String(r._id)).children = r.children
  return map
}

/** true when the location is referenced anywhere (then it can only be deactivated). */
export async function locationInUse(id) {
  const checks = await Promise.all([
    Asset.exists({ locationId: id }),
    StockItem.exists({ locationId: id }),
    InventoryLocation.exists({ parentId: id }),
    AssetAudit.exists({ $or: [{ locationId: id }, { 'lines.expectedLocationId': id }, { 'lines.foundLocationId': id }] }),
    AssetEvent.exists({ $or: [{ fromLocationId: id }, { toLocationId: id }] }),
    PurchaseBill.exists({ 'lines.locationId': id }),
  ])
  return checks.some(Boolean)
}

/** API shape: location with its path (A › B › C) and usage. */
export function serializeLocation(l, { pathMap = null, usage = null } = {}) {
  const id = String(l._id ?? l.id)
  const meta = pathMap?.get(id)
  const u = usage?.get(id)
  return {
    id,
    name: l.name,
    code: l.code ?? null,
    type: l.type || 'OFFICE',
    typeLabel: LOCATION_TYPE_LABELS[l.type] ?? l.type,
    parentId: l.parentId ? String(l.parentId) : null,
    parentName: meta?.parentId ? (pathMap.get(meta.parentId)?.name ?? null) : null,
    path: meta?.path ?? l.name,
    depth: meta?.depth ?? 0,
    address: l.address ?? null,
    notes: l.notes ?? null,
    isActive: l.isActive !== false,
    createdAt: l.createdAt ?? null,
    updatedAt: l.updatedAt ?? null,
    ...(usage ? { assetCount: u?.assets ?? 0, heldCount: u?.held ?? 0, stockItemCount: u?.stockItems ?? 0, childCount: u?.children ?? 0 } : {}),
  }
}

/** Depth-first ordering: each parent followed by its children, siblings by name. */
export function treeOrder(list) {
  const byParent = new Map()
  const ids = new Set(list.map(l => l.id))
  for (const l of list) {
    const p = l.parentId && ids.has(l.parentId) ? l.parentId : '__root'
    if (!byParent.has(p)) byParent.set(p, [])
    byParent.get(p).push(l)
  }
  for (const arr of byParent.values()) arr.sort((a, b) => String(a.name).localeCompare(String(b.name)))
  const out = []
  const seen = new Set()
  const walk = (p) => {
    for (const l of byParent.get(p) || []) {
      if (seen.has(l.id)) continue
      seen.add(l.id)
      out.push(l)
      walk(l.id)
    }
  }
  walk('__root')
  for (const l of list) if (!seen.has(l.id)) out.push(l) // cycles (should not happen)
  return out
}
