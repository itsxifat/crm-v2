export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { PurchaseBill } from '@/models'
import { requirePerm, canDoAny } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { buildBillDoc, loadBillDetail } from '../_lib/purchases'
import { errorResponse, readJson } from '../_lib/http'

const VIEW_PERMS = ['inventory.view', 'inventory.purchase']

// GET /api/inventory/purchases/[id] — bill with lines, created assets, stock movements and payment
export async function GET(_request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canDoAny(session, VIEW_PERMS)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()
    const data = await loadBillDetail(params.id)
    if (!data) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ data })
  } catch (err) {
    return errorResponse(err, '[GET /api/inventory/purchases/[id]]')
  }
}

// PUT /api/inventory/purchases/[id] — edit a DRAFT bill (full replace of the editable fields)
export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'inventory.purchase')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()
    const existing = await PurchaseBill.findById(params.id).select('status billNo total netPayable lines vendorName').lean()
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (existing.status !== 'DRAFT') {
      return NextResponse.json({ error: 'Only draft bills can be edited' }, { status: 409 })
    }

    const body = await readJson(request)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    const { doc } = await buildBillDoc(body)

    const updated = await PurchaseBill.findOneAndUpdate(
      { _id: params.id, status: 'DRAFT' },
      { $set: doc },
      { new: true, runValidators: true },
    ).lean()
    if (!updated) return NextResponse.json({ error: 'This bill was received or cancelled meanwhile — reload it' }, { status: 409 })

    const changes = {}
    if (existing.vendorName !== updated.vendorName) changes.vendor = { from: existing.vendorName, to: updated.vendorName }
    if (Number(existing.total) !== Number(updated.total)) changes.total = { from: existing.total, to: updated.total }
    if (Number(existing.netPayable) !== Number(updated.netPayable)) changes.netPayable = { from: existing.netPayable, to: updated.netPayable }
    if ((existing.lines?.length ?? 0) !== (updated.lines?.length ?? 0)) changes.lines = { from: existing.lines?.length ?? 0, to: updated.lines?.length ?? 0 }

    logActivity({
      userId: session.user.id,
      userRole: session.user.role,
      action: 'UPDATE',
      entity: 'PURCHASE_BILL',
      entityId: params.id,
      changes: JSON.stringify({ billNo: existing.billNo, ...changes }),
      request,
    })

    return NextResponse.json({ data: await loadBillDetail(params.id) })
  } catch (err) {
    return errorResponse(err, '[PUT /api/inventory/purchases/[id]]')
  }
}

// DELETE /api/inventory/purchases/[id] — remove a DRAFT bill (received bills are cancelled instead)
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'inventory.purchase')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()
    const removed = await PurchaseBill.findOneAndDelete({ _id: params.id, status: 'DRAFT' }).lean()
    if (!removed) {
      const exists = await PurchaseBill.exists({ _id: params.id })
      if (!exists) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json({ error: 'Only draft bills can be deleted — cancel a received bill instead' }, { status: 409 })
    }

    logActivity({
      userId: session.user.id,
      userRole: session.user.role,
      action: 'DELETE',
      entity: 'PURCHASE_BILL',
      entityId: params.id,
      changes: JSON.stringify({ billNo: removed.billNo, vendor: removed.vendorName, total: removed.total }),
      request,
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    return errorResponse(err, '[DELETE /api/inventory/purchases/[id]]')
  }
}
