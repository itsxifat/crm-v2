export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { AssetCategory, Asset, StockItem } from '@/models'
import { requirePerm, requireStaff } from '@/lib/rbac'
import { logActivity } from '@/lib/logActivity'
import { ensureCategoriesSeeded, TERMINAL_STATUSES, CATEGORY_TYPES } from '@/lib/inventory/assets'
import { errorResponse, escapeRegex } from '../reports/_lib/common'
import { createCategorySchema, applyCategoryRules, serializeCategory } from './_shared'

/** Map(categoryId → { assets, held, stockItems }) for the given category ids. */
async function usageCounts(ids) {
  const [assetRows, stockRows] = await Promise.all([
    Asset.aggregate([
      { $match: { categoryId: { $in: ids }, isArchived: { $ne: true } } },
      { $group: {
        _id: '$categoryId',
        assets: { $sum: 1 },
        held: { $sum: { $cond: [{ $in: ['$status', TERMINAL_STATUSES] }, 0, 1] } },
      } },
    ]),
    StockItem.aggregate([
      { $match: { categoryId: { $in: ids } } },
      { $group: { _id: '$categoryId', stockItems: { $sum: 1 } } },
    ]),
  ])
  const map = new Map()
  for (const r of assetRows) map.set(String(r._id), { assets: r.assets, held: r.held, stockItems: 0 })
  for (const r of stockRows) {
    const k = String(r._id)
    map.set(k, { assets: 0, held: 0, ...(map.get(k) || {}), stockItems: r.stockItems })
  }
  return map
}

// GET /api/inventory/categories?type=ASSET|CONSUMABLE&active=1&withCounts=1
// Any staff member (pickers on assets, purchases and stock use it). Seeds the defaults on first use.
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireStaff(session)
    if (denied) return denied

    await connectDB()
    await ensureCategoriesSeeded()

    const { searchParams } = new URL(request.url)
    const type = searchParams.get('type')
    const active = searchParams.get('active')
    const withCounts = searchParams.get('withCounts') === '1'

    const filter = {}
    if (type) {
      if (!CATEGORY_TYPES.includes(type)) return NextResponse.json({ error: 'type must be ASSET or CONSUMABLE' }, { status: 422 })
      filter.type = type
    }
    if (active === '1' || active === 'true') filter.isActive = { $ne: false }
    else if (active === '0' || active === 'false') filter.isActive = false

    const cats = await AssetCategory.find(filter).sort({ sortOrder: 1, name: 1 }).lean()
    const counts = withCounts && cats.length ? await usageCounts(cats.map(c => c._id)) : (withCounts ? new Map() : null)
    return NextResponse.json({ data: cats.map(c => serializeCategory(c, counts)) })
  } catch (err) {
    return errorResponse(err, '[GET /api/inventory/categories]')
  }
}

// POST /api/inventory/categories — create (inventory.manage)
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'inventory.manage')
    if (denied) return denied

    let body
    try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
    const parsed = createCategorySchema.safeParse(body ?? {})
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    await connectDB()
    await ensureCategoriesSeeded()
    const data = applyCategoryRules(parsed.data)

    const [nameClash, codeClash] = await Promise.all([
      AssetCategory.findOne({ name: { $regex: `^${escapeRegex(data.name)}$`, $options: 'i' } }).select('_id').lean(),
      AssetCategory.findOne({ code: data.code }).select('_id').lean(),
    ])
    if (nameClash) return NextResponse.json({ error: 'A category with this name already exists' }, { status: 409 })
    if (codeClash) return NextResponse.json({ error: `Code ${data.code} is already used by another category` }, { status: 409 })

    if (data.sortOrder === null || data.sortOrder === undefined) {
      const last = await AssetCategory.findOne({}).sort({ sortOrder: -1 }).select('sortOrder').lean()
      data.sortOrder = (Number(last?.sortOrder) || 0) + 10
    }
    if (data.residualPct === null) delete data.residualPct
    if (data.usefulLifeMonths === null) delete data.usefulLifeMonths

    const category = await new AssetCategory({ ...data, createdBy: session.user.id }).save()

    logActivity({
      userId: session.user.id,
      userRole: session.user.role,
      action: 'CREATE',
      entity: 'ASSET_CATEGORY',
      entityId: category._id.toString(),
      changes: JSON.stringify({ name: category.name, code: category.code, type: category.type, taxClass: category.taxClass }),
      request,
    })

    return NextResponse.json({ data: serializeCategory(category.toObject(), new Map()) }, { status: 201 })
  } catch (err) {
    return errorResponse(err, '[POST /api/inventory/categories]')
  }
}
