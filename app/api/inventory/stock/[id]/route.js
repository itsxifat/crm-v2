export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { StockItem, StockMovement, PurchaseBill } from '@/models'
import { requirePerm, canDoAny } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import {
  itemSchema, serializeItem, serializeMovement, ITEM_POPULATE, MOVEMENT_POPULATE, validationError, httpError,
  escapeRegex, checkItemRefs,
} from '../_lib/stock'
import { errorResponse, readJson } from '../../purchases/_lib/http'

const VIEW_PERMS = ['inventory.view', 'inventory.manage', 'inventory.assign']
const EDITABLE = ['sku', 'name', 'categoryId', 'unit', 'reorderLevel', 'reorderQty', 'preferredVendorId', 'locationId', 'notes', 'isActive']
const round4 = (n) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000

// GET /api/inventory/stock/[id] — item + recent movements (newest first, each with balanceAfter:
// the balance after it in date order) + totals by type
export async function GET(_request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canDoAny(session, VIEW_PERMS)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()
    const item = await StockItem.findById(params.id).populate(ITEM_POPULATE).lean()
    if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const [movements, byType, [net]] = await Promise.all([
      StockMovement.find({ stockItemId: item._id }).sort({ date: -1, createdAt: -1 }).limit(25).populate(MOVEMENT_POPULATE).lean(),
      StockMovement.aggregate([
        { $match: { stockItemId: item._id } },
        { $group: { _id: '$type', qty: { $sum: '$qty' }, value: { $sum: '$totalCost' }, count: { $sum: 1 } } },
      ]),
      StockMovement.aggregate([
        { $match: { stockItemId: item._id } },
        { $group: { _id: null, qty: { $sum: { $cond: [{ $eq: ['$direction', 'IN'] }, '$qty', { $multiply: ['$qty', -1] }] } } } },
      ]),
    ])

    // qtyAfter is the balance when a movement was recorded, which is not its dated
    // balance for a back-dated one: walk back from the net of all movements instead.
    let balance = round4(net?.qty ?? 0)
    const rows = movements.map((m) => {
      const row = { ...serializeMovement(m), balanceAfter: balance }
      balance = round4(balance - (m.direction === 'IN' ? 1 : -1) * (Number(m.qty) || 0))
      return row
    })

    return NextResponse.json({
      data: {
        ...serializeItem(item),
        movements: rows,
        totals: Object.fromEntries(byType.map(r => [r._id, { qty: r.qty, value: Math.round((r.value + Number.EPSILON) * 100) / 100, count: r.count }])),
      },
    })
  } catch (err) {
    return errorResponse(err, '[GET /api/inventory/stock/[id]]')
  }
}

// PUT /api/inventory/stock/[id] — edit item details (quantity and cost only change through movements)
export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'inventory.manage')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()
    const existing = await StockItem.findById(params.id).lean()
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await readJson(request)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    const parsed = itemSchema.partial().omit({ opening: true }).safeParse(body)
    if (!parsed.success) throw validationError(parsed.error)

    const set = {}
    for (const key of EDITABLE) {
      if (!Object.prototype.hasOwnProperty.call(body, key)) continue
      set[key] = parsed.data[key] ?? null
    }
    if ('name' in set && !set.name) throw httpError(422, 'Item name is required')
    if ('unit' in set && !set.unit) set.unit = 'pcs'
    if ('reorderLevel' in set) set.reorderLevel = set.reorderLevel ?? 0
    if ('reorderQty' in set) set.reorderQty = set.reorderQty ?? 0
    if ('isActive' in set) set.isActive = set.isActive !== false
    if ('sku' in set) {
      if (!set.sku) delete set.sku // SKU stays when cleared
      else if (set.sku !== existing.sku && await StockItem.exists({ sku: set.sku, _id: { $ne: existing._id } })) {
        throw httpError(409, `SKU ${set.sku} is already used`)
      }
    }

    // Only the references being changed need checking.
    await checkItemRefs({
      categoryId: 'categoryId' in set && String(set.categoryId ?? '') !== String(existing.categoryId ?? '') ? set.categoryId : null,
      locationId: 'locationId' in set && String(set.locationId ?? '') !== String(existing.locationId ?? '') ? set.locationId : null,
      preferredVendorId: 'preferredVendorId' in set && String(set.preferredVendorId ?? '') !== String(existing.preferredVendorId ?? '') ? set.preferredVendorId : null,
    })

    const name = set.name ?? existing.name
    const categoryId = 'categoryId' in set ? set.categoryId : existing.categoryId
    if (('name' in set || 'categoryId' in set)) {
      const dup = await StockItem.findOne({
        _id: { $ne: existing._id },
        name: { $regex: `^${escapeRegex(name)}$`, $options: 'i' },
        categoryId: categoryId ?? null,
      }).select('sku').lean()
      if (dup) throw httpError(409, `"${name}" already exists in this category (${dup.sku})`)
    }

    const changes = {}
    for (const [k, v] of Object.entries(set)) {
      const before = existing[k] === undefined || existing[k] === null ? null : String(existing[k])
      const after = v === undefined || v === null ? null : String(v)
      if (before !== after) changes[k] = { from: existing[k] ?? null, to: v ?? null }
    }
    if (!Object.keys(changes).length) {
      const same = await StockItem.findById(params.id).populate(ITEM_POPULATE).lean()
      return NextResponse.json({ data: serializeItem(same) })
    }

    const updated = await StockItem.findByIdAndUpdate(params.id, { $set: set }, { new: true, runValidators: true })
      .populate(ITEM_POPULATE).lean()

    logActivity({
      userId: session.user.id,
      userRole: session.user.role,
      action: 'isActive' in changes ? (set.isActive ? 'REACTIVATE' : 'DEACTIVATE') : 'UPDATE',
      entity: 'STOCK_ITEM',
      entityId: params.id,
      changes: JSON.stringify({ sku: updated.sku, ...changes }),
      request,
    })

    return NextResponse.json({ data: serializeItem(updated) })
  } catch (err) {
    return errorResponse(err, '[PUT /api/inventory/stock/[id]]')
  }
}

// DELETE /api/inventory/stock/[id] — only an item that never moved (otherwise deactivate it)
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'inventory.manage')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()
    const item = await StockItem.findById(params.id).select('sku name').lean()
    if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const [moved, onBill] = await Promise.all([
      StockMovement.exists({ stockItemId: item._id }),
      PurchaseBill.exists({ 'lines.stockItemId': item._id, status: { $ne: 'CANCELLED' } }),
    ])
    if (moved) return NextResponse.json({ error: 'This item has stock history — deactivate it instead' }, { status: 409 })
    if (onBill) return NextResponse.json({ error: 'This item is used on a purchase bill — deactivate it instead' }, { status: 409 })

    await StockItem.deleteOne({ _id: item._id })
    logActivity({
      userId: session.user.id,
      userRole: session.user.role,
      action: 'DELETE',
      entity: 'STOCK_ITEM',
      entityId: params.id,
      changes: JSON.stringify({ sku: item.sku, name: item.name }),
      request,
    })
    return NextResponse.json({ success: true })
  } catch (err) {
    return errorResponse(err, '[DELETE /api/inventory/stock/[id]]')
  }
}
