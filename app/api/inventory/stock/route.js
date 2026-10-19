export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { StockItem } from '@/models'
import { requirePerm, canDoAny } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { assertBooksOpen } from '@/lib/finance/settings'
import { moveStock } from '@/lib/inventory/stock'
import {
  itemSchema, serializeItem, ITEM_POPULATE, validationError, httpError, escapeRegex, csvResponse, todayKey, checkItemRefs,
} from './_lib/stock'
import { errorResponse, readJson } from '../purchases/_lib/http'

const VIEW_PERMS = ['inventory.view', 'inventory.manage', 'inventory.assign']

/** Items at or below their reorder level, or empty. */
const LOW_STOCK_EXPR = {
  $expr: {
    $or: [
      { $lte: [{ $ifNull: ['$qtyOnHand', 0] }, 0] },
      { $and: [{ $gt: [{ $ifNull: ['$reorderLevel', 0] }, 0] }, { $lte: [{ $ifNull: ['$qtyOnHand', 0] }, '$reorderLevel'] }] },
    ],
  },
}

const SORTS = {
  name: { name: 1 },
  sku: { sku: 1 },
  qty: { qtyOnHand: 1, name: 1 },
  value: { stockValue: -1, name: 1 },
  updated: { updatedAt: -1 },
}

// GET /api/inventory/stock?search=&categoryId=&lowStock=1&status=active|inactive|all&sort=&page=&limit=&format=csv
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canDoAny(session, VIEW_PERMS)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await connectDB()
    const { searchParams } = new URL(request.url)
    const csv = searchParams.get('format') === 'csv'
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)
    const limit = csv ? 10000 : Math.min(200, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10) || 50))

    const filter = {}
    const status = searchParams.get('status') ?? 'active'
    if (status === 'active') filter.isActive = { $ne: false }
    else if (status === 'inactive') filter.isActive = false
    const categoryId = searchParams.get('categoryId')
    if (categoryId) {
      if (!isValidObjectId(categoryId)) return NextResponse.json({ error: 'Invalid category' }, { status: 400 })
      filter.categoryId = categoryId
    }
    const search = (searchParams.get('search') ?? '').trim()
    if (search) {
      const re = { $regex: escapeRegex(search.slice(0, 100)), $options: 'i' }
      filter.$or = [{ sku: re }, { name: re }, { notes: re }]
    }
    if (searchParams.get('lowStock') === '1') Object.assign(filter, LOW_STOCK_EXPR)
    const sort = SORTS[searchParams.get('sort')] ?? SORTS.name

    const [rows, total] = await Promise.all([
      StockItem.find(filter).sort(sort).skip(csv ? 0 : (page - 1) * limit).limit(limit).populate(ITEM_POPULATE).lean(),
      StockItem.countDocuments(filter),
    ])
    const data = rows.map(serializeItem)

    if (csv) {
      return csvResponse(`consumables-${todayKey()}.csv`,
        ['SKU', 'Item', 'Category', 'Unit', 'On hand', 'Average cost (BDT)', 'Stock value (BDT)', 'Reorder level', 'Reorder qty', 'Location', 'Preferred vendor', 'Status'],
        data.map(i => [i.sku, i.name, i.category?.name ?? '', i.unit, i.qtyOnHand, i.avgCost, i.stockValue, i.reorderLevel, i.reorderQty, i.location?.name ?? '', i.preferredVendor?.company ?? '', i.status]))
    }

    const [agg] = await StockItem.aggregate([
      { $match: { isActive: { $ne: false } } },
      {
        $group: {
          _id: null,
          items: { $sum: 1 },
          value: { $sum: { $convert: { input: '$stockValue', to: 'double', onError: 0, onNull: 0 } } },
          out: { $sum: { $cond: [{ $lte: [{ $ifNull: ['$qtyOnHand', 0] }, 0] }, 1, 0] } },
          low: {
            $sum: {
              $cond: [{
                $and: [
                  { $gt: [{ $ifNull: ['$qtyOnHand', 0] }, 0] },
                  { $gt: [{ $ifNull: ['$reorderLevel', 0] }, 0] },
                  { $lte: [{ $ifNull: ['$qtyOnHand', 0] }, '$reorderLevel'] },
                ],
              }, 1, 0],
            },
          },
        },
      },
    ])

    return NextResponse.json({
      data,
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
      summary: {
        items: agg?.items ?? 0,
        value: Math.round(((agg?.value ?? 0) + Number.EPSILON) * 100) / 100,
        low: agg?.low ?? 0,
        out: agg?.out ?? 0,
      },
    })
  } catch (err) {
    return errorResponse(err, '[GET /api/inventory/stock]')
  }
}

// POST /api/inventory/stock — create a stock item (optionally with opening stock)
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'inventory.manage')
    if (denied) return denied

    await connectDB()
    const body = await readJson(request)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    const parsed = itemSchema.safeParse(body)
    if (!parsed.success) throw validationError(parsed.error)
    const d = parsed.data

    await checkItemRefs(d)
    if (d.sku && await StockItem.exists({ sku: d.sku })) throw httpError(409, `SKU ${d.sku} is already used`)
    const dup = await StockItem.findOne({
      name: { $regex: `^${escapeRegex(d.name)}$`, $options: 'i' },
      categoryId: d.categoryId ?? null,
    }).select('sku').lean()
    if (dup) throw httpError(409, `"${d.name}" already exists in this category (${dup.sku})`)

    let openingKey = null
    if (d.opening) {
      openingKey = d.opening.date ?? todayKey()
      if (openingKey > todayKey()) throw httpError(422, 'Opening date cannot be in the future')
      const locked = await assertBooksOpen(openingKey)
      if (locked) throw httpError(409, locked)
    }

    const item = await new StockItem({
      ...(d.sku ? { sku: d.sku } : {}),
      name: d.name,
      categoryId: d.categoryId ?? null,
      unit: d.unit || 'pcs',
      reorderLevel: d.reorderLevel ?? 0,
      reorderQty: d.reorderQty ?? 0,
      preferredVendorId: d.preferredVendorId ?? null,
      locationId: d.locationId ?? null,
      notes: d.notes ?? null,
      isActive: d.isActive !== false,
      createdBy: session.user.id,
    }).save()

    let movement = null
    if (d.opening) {
      try {
        const res = await moveStock({
          stockItemId: item._id, type: 'OPENING', qty: d.opening.qty, unitCost: d.opening.unitCost,
          date: openingKey, reason: 'Opening stock', userId: session.user.id,
        })
        movement = res.movement
      } catch (err) {
        await StockItem.deleteOne({ _id: item._id }).catch(e => console.error('[POST /api/inventory/stock] cleanup failed', e))
        throw err
      }
    }

    logActivity({
      userId: session.user.id,
      userRole: session.user.role,
      action: 'CREATE',
      entity: 'STOCK_ITEM',
      entityId: item._id.toString(),
      changes: JSON.stringify({
        sku: item.sku, name: item.name, unit: item.unit, reorderLevel: item.reorderLevel,
        opening: d.opening ? { qty: d.opening.qty, unitCost: d.opening.unitCost, movementNo: movement?.movementNo ?? null } : null,
      }),
      request,
    })

    const fresh = await StockItem.findById(item._id).populate(ITEM_POPULATE).lean()
    return NextResponse.json({ data: serializeItem(fresh) }, { status: 201 })
  } catch (err) {
    return errorResponse(err, '[POST /api/inventory/stock]')
  }
}
