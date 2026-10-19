export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { InventoryLocation } from '@/models'
import { requirePerm, requireStaff } from '@/lib/rbac'
import { logActivity } from '@/lib/logActivity'
import { errorResponse, escapeRegex, loadLocationMap } from '../reports/_lib/common'
import { createLocationSchema, serializeLocation, locationUsage, treeOrder } from './_shared'

// GET /api/inventory/locations?active=1&withCounts=1 — any staff (pickers use it).
// Returned in tree order (parent then children) with a display path.
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireStaff(session)
    if (denied) return denied

    await connectDB()
    const { searchParams } = new URL(request.url)
    const active = searchParams.get('active')
    const withCounts = searchParams.get('withCounts') === '1'

    const pathMap = await loadLocationMap()
    let rows = await InventoryLocation.find({}).lean()
    if (active === '1' || active === 'true') rows = rows.filter(r => r.isActive !== false)
    else if (active === '0' || active === 'false') rows = rows.filter(r => r.isActive === false)

    const usage = withCounts && rows.length ? await locationUsage(rows.map(r => r._id)) : (withCounts ? new Map() : null)
    const data = treeOrder(rows.map(r => serializeLocation(r, { pathMap, usage })))
    return NextResponse.json({ data })
  } catch (err) {
    return errorResponse(err, '[GET /api/inventory/locations]')
  }
}

// POST /api/inventory/locations — create (inventory.manage)
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'inventory.manage')
    if (denied) return denied

    let body
    try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
    const parsed = createLocationSchema.safeParse(body ?? {})
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }
    const data = parsed.data

    await connectDB()
    if (data.parentId) {
      const parent = await InventoryLocation.findById(data.parentId).select('_id').lean()
      if (!parent) return NextResponse.json({ error: 'Parent location not found' }, { status: 422 })
    }
    if (data.code) {
      const clash = await InventoryLocation.findOne({ code: data.code }).select('_id').lean()
      if (clash) return NextResponse.json({ error: `Code ${data.code} is already used by another location` }, { status: 409 })
    }
    const sibling = await InventoryLocation.findOne({
      parentId: data.parentId || null,
      name: { $regex: `^${escapeRegex(data.name)}$`, $options: 'i' },
    }).select('_id').lean()
    if (sibling) return NextResponse.json({ error: 'A location with this name already exists at this level' }, { status: 409 })

    const doc = { ...data, parentId: data.parentId || null, createdBy: session.user.id }
    if (!doc.code) delete doc.code
    const location = await new InventoryLocation(doc).save()

    logActivity({
      userId: session.user.id,
      userRole: session.user.role,
      action: 'CREATE',
      entity: 'INVENTORY_LOCATION',
      entityId: location._id.toString(),
      changes: JSON.stringify({ name: location.name, code: location.code ?? null, type: location.type, parentId: location.parentId ? String(location.parentId) : null }),
      request,
    })

    const pathMap = await loadLocationMap()
    return NextResponse.json({ data: serializeLocation(location.toObject(), { pathMap }) }, { status: 201 })
  } catch (err) {
    return errorResponse(err, '[POST /api/inventory/locations]')
  }
}
