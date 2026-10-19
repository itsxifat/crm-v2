export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { AssetCategory, Asset, StockItem, PurchaseBill } from '@/models'
import { requirePerm, requireStaff } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { errorResponse, escapeRegex } from '../../reports/_lib/common'
import { updateCategorySchema, applyCategoryRules, serializeCategory } from '../_shared'

const EDITABLE = [
  'name', 'code', 'type', 'taxClass', 'depreciationMethod', 'usefulLifeMonths', 'residualPct', 'decliningRatePct',
  'capitalize', 'requiresAcknowledgement', 'inputVatCreditable', 'description', 'isActive', 'sortOrder',
]

async function usage(id) {
  const [assets, stockItems, bills] = await Promise.all([
    Asset.countDocuments({ categoryId: id }),
    StockItem.countDocuments({ categoryId: id }),
    PurchaseBill.countDocuments({ 'lines.categoryId': id }),
  ])
  return { assets, stockItems, bills, used: assets + stockItems + bills > 0 }
}

// GET /api/inventory/categories/[id]
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireStaff(session)
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()
    const category = await AssetCategory.findById(params.id).lean()
    if (!category) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const u = await usage(category._id)
    const counts = new Map([[String(category._id), { assets: u.assets, held: u.assets, stockItems: u.stockItems }]])
    return NextResponse.json({ data: { ...serializeCategory(category, counts), billCount: u.bills } })
  } catch (err) {
    return errorResponse(err, '[GET /api/inventory/categories/[id]]')
  }
}

// PUT /api/inventory/categories/[id] — partial update (inventory.manage)
export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'inventory.manage')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    let body
    try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
    const parsed = updateCategorySchema.safeParse(body ?? {})
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    await connectDB()
    const category = await AssetCategory.findById(params.id)
    if (!category) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const data = applyCategoryRules(parsed.data, category.toObject())
    const codeChanging = data.code !== undefined && data.code !== category.code
    const typeChanging = data.type !== undefined && data.type !== category.type

    if (data.name !== undefined && data.name.toLowerCase() !== String(category.name).toLowerCase()) {
      const clash = await AssetCategory.findOne({ _id: { $ne: category._id }, name: { $regex: `^${escapeRegex(data.name)}$`, $options: 'i' } }).select('_id').lean()
      if (clash) return NextResponse.json({ error: 'A category with this name already exists' }, { status: 409 })
    }
    if (codeChanging || typeChanging) {
      const u = await usage(category._id)
      if (codeChanging && u.assets > 0) {
        return NextResponse.json({ error: `Code ${category.code} is already used in ${u.assets} asset tag${u.assets === 1 ? '' : 's'} and cannot be changed. Create a new category instead.` }, { status: 409 })
      }
      if (typeChanging && (u.assets > 0 || u.stockItems > 0)) {
        return NextResponse.json({ error: 'This category already has assets or stock items, so its type cannot change' }, { status: 409 })
      }
      if (codeChanging) {
        const clash = await AssetCategory.findOne({ _id: { $ne: category._id }, code: data.code }).select('_id').lean()
        if (clash) return NextResponse.json({ error: `Code ${data.code} is already used by another category` }, { status: 409 })
      }
    }

    const before = category.toObject()
    for (const k of EDITABLE) {
      if (data[k] === undefined) continue
      if (k === 'usefulLifeMonths' && data[k] === null) { category.usefulLifeMonths = undefined; continue }
      if (k === 'residualPct' && data[k] === null) { category.residualPct = 0; continue }
      if (k === 'sortOrder' && data[k] === null) continue
      category[k] = data[k]
    }
    await category.save()

    const changes = {}
    for (const k of EDITABLE) {
      const from = before[k] ?? null
      const to = category[k] ?? null
      if (JSON.stringify(from) !== JSON.stringify(to)) changes[k] = { from, to }
    }
    if (Object.keys(changes).length) {
      logActivity({
        userId: session.user.id,
        userRole: session.user.role,
        action: 'UPDATE',
        entity: 'ASSET_CATEGORY',
        entityId: category._id.toString(),
        changes: JSON.stringify({ name: category.name, ...changes }),
        request,
      })
    }

    return NextResponse.json({ data: serializeCategory(category.toObject()) })
  } catch (err) {
    return errorResponse(err, '[PUT /api/inventory/categories/[id]]')
  }
}

// DELETE /api/inventory/categories/[id] — hard delete when unused, otherwise deactivate.
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'inventory.manage')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()
    const category = await AssetCategory.findById(params.id)
    if (!category) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const u = await usage(category._id)
    if (u.used) {
      const wasActive = category.isActive !== false
      if (wasActive) {
        category.isActive = false
        await category.save()
        logActivity({
          userId: session.user.id,
          userRole: session.user.role,
          action: 'UPDATE',
          entity: 'ASSET_CATEGORY',
          entityId: category._id.toString(),
          changes: JSON.stringify({ name: category.name, isActive: { from: true, to: false }, reason: 'in use — deactivated instead of deleted' }),
          request,
        })
      }
      return NextResponse.json({
        data: serializeCategory(category.toObject()),
        deactivated: true,
        message: `"${category.name}" is used by ${u.assets} asset(s), ${u.stockItems} stock item(s) and ${u.bills} purchase bill(s), so it was deactivated instead of deleted.`,
      })
    }

    await AssetCategory.deleteOne({ _id: category._id })
    logActivity({
      userId: session.user.id,
      userRole: session.user.role,
      action: 'DELETE',
      entity: 'ASSET_CATEGORY',
      entityId: category._id.toString(),
      changes: JSON.stringify({ name: category.name, code: category.code }),
      request,
    })
    return NextResponse.json({ data: { id: category._id.toString() }, deleted: true })
  } catch (err) {
    return errorResponse(err, '[DELETE /api/inventory/categories/[id]]')
  }
}
