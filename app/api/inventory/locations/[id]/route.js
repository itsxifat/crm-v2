export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { InventoryLocation } from '@/models'
import { requirePerm, requireStaff } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { errorResponse, escapeRegex, loadLocationMap } from '../../reports/_lib/common'
import { updateLocationSchema, serializeLocation, locationUsage, locationInUse } from '../_shared'

const EDITABLE = ['name', 'code', 'type', 'parentId', 'address', 'notes', 'isActive']

// GET /api/inventory/locations/[id]
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireStaff(session)
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()
    const location = await InventoryLocation.findById(params.id).lean()
    if (!location) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const [pathMap, usage] = await Promise.all([loadLocationMap(), locationUsage([location._id])])
    return NextResponse.json({ data: serializeLocation(location, { pathMap, usage }) })
  } catch (err) {
    return errorResponse(err, '[GET /api/inventory/locations/[id]]')
  }
}

// PUT /api/inventory/locations/[id] — partial update (inventory.manage)
export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'inventory.manage')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    let body
    try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
    const parsed = updateLocationSchema.safeParse(body ?? {})
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }
    const data = parsed.data

    await connectDB()
    const location = await InventoryLocation.findById(params.id)
    if (!location) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (data.parentId !== undefined && data.parentId) {
      if (data.parentId === String(location._id)) return NextResponse.json({ error: 'A location cannot be its own parent' }, { status: 422 })
      const parent = await InventoryLocation.findById(data.parentId).select('_id').lean()
      if (!parent) return NextResponse.json({ error: 'Parent location not found' }, { status: 422 })
    }
    if (data.code !== undefined && data.code && data.code !== location.code) {
      const clash = await InventoryLocation.findOne({ _id: { $ne: location._id }, code: data.code }).select('_id').lean()
      if (clash) return NextResponse.json({ error: `Code ${data.code} is already used by another location` }, { status: 409 })
    }
    const nextName = data.name ?? location.name
    const nextParent = data.parentId !== undefined ? (data.parentId || null) : (location.parentId || null)
    if (data.name !== undefined || data.parentId !== undefined) {
      const sibling = await InventoryLocation.findOne({
        _id: { $ne: location._id },
        parentId: nextParent,
        name: { $regex: `^${escapeRegex(nextName)}$`, $options: 'i' },
      }).select('_id').lean()
      if (sibling) return NextResponse.json({ error: 'A location with this name already exists at this level' }, { status: 409 })
    }

    const before = location.toObject()
    for (const k of EDITABLE) {
      if (data[k] === undefined) continue
      if (k === 'code') { location.code = data.code || undefined; continue }
      if (k === 'parentId') { location.parentId = data.parentId || null; continue }
      location[k] = data[k]
    }
    await location.save() // model refuses parent loops

    const changes = {}
    for (const k of EDITABLE) {
      const from = before[k] == null ? null : String(before[k])
      const to = location[k] == null ? null : String(location[k])
      if (from !== to) changes[k] = { from, to }
    }
    if (Object.keys(changes).length) {
      logActivity({
        userId: session.user.id,
        userRole: session.user.role,
        action: 'UPDATE',
        entity: 'INVENTORY_LOCATION',
        entityId: location._id.toString(),
        changes: JSON.stringify({ name: location.name, ...changes }),
        request,
      })
    }

    const pathMap = await loadLocationMap()
    return NextResponse.json({ data: serializeLocation(location.toObject(), { pathMap }) })
  } catch (err) {
    return errorResponse(err, '[PUT /api/inventory/locations/[id]]')
  }
}

// DELETE /api/inventory/locations/[id] — hard delete when unused, otherwise deactivate.
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'inventory.manage')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()
    const location = await InventoryLocation.findById(params.id)
    if (!location) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (await locationInUse(location._id)) {
      if (location.isActive !== false) {
        location.isActive = false
        await location.save()
        logActivity({
          userId: session.user.id,
          userRole: session.user.role,
          action: 'UPDATE',
          entity: 'INVENTORY_LOCATION',
          entityId: location._id.toString(),
          changes: JSON.stringify({ name: location.name, isActive: { from: true, to: false }, reason: 'in use — deactivated instead of deleted' }),
          request,
        })
      }
      const pathMap = await loadLocationMap()
      return NextResponse.json({
        data: serializeLocation(location.toObject(), { pathMap }),
        deactivated: true,
        message: `"${location.name}" is referenced by assets, stock, sub-locations or history, so it was deactivated instead of deleted.`,
      })
    }

    await InventoryLocation.deleteOne({ _id: location._id })
    logActivity({
      userId: session.user.id,
      userRole: session.user.role,
      action: 'DELETE',
      entity: 'INVENTORY_LOCATION',
      entityId: location._id.toString(),
      changes: JSON.stringify({ name: location.name, code: location.code ?? null }),
      request,
    })
    return NextResponse.json({ data: { id: location._id.toString() }, deleted: true })
  } catch (err) {
    return errorResponse(err, '[DELETE /api/inventory/locations/[id]]')
  }
}
