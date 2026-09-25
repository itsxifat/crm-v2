export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { EditRequest, ProjectExpense } from '@/models'
import { requirePerm, requireStaff } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'

// POST /api/edit-requests  — create an edit request
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    // Staff only (canDo is false for CLIENT / FREELANCER / VENDOR).
    const denied  = requirePerm(session, 'finance.expenses.submit')
    if (denied) return denied

    const { itemType, itemId, reason } = await request.json()
    if (!itemType || !itemId || typeof reason !== 'string' || !reason.trim())
      return NextResponse.json({ error: 'itemType, itemId and reason are required' }, { status: 400 })
    if (itemType !== 'PROJECT_EXPENSE' || !isValidObjectId(itemId))
      return NextResponse.json({ error: 'Invalid item' }, { status: 400 })

    await connectDB()

    if (!(await ProjectExpense.exists({ _id: itemId })))
      return NextResponse.json({ error: 'Item not found' }, { status: 404 })

    // Only one PENDING request per requester per item at a time — someone else's
    // pending request can't block yours.
    const existing = await EditRequest.findOne({ itemId, itemType, requesterId: session.user.id, status: 'PENDING' })
    if (existing)
      return NextResponse.json({ error: 'A pending edit request already exists for this item' }, { status: 409 })

    const doc = await EditRequest.create({
      requesterId: session.user.id,
      itemType,
      itemId,
      reason: reason.trim(),
    })

    return NextResponse.json({ data: doc.toJSON() }, { status: 201 })
  } catch (err) {
    console.error('[edit-requests POST]', err)
    return NextResponse.json({ error: err.message ?? 'Server error' }, { status: 500 })
  }
}

// GET /api/edit-requests  — list edit requests
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requireStaff(session)
    if (denied) return denied

    await connectDB()

    const filter = {}

    if (session.user.role === 'SUPER_ADMIN') {
      // Owner sees all PENDING requests
      filter.status = 'PENDING'
    } else {
      // Manager sees their own requests
      filter.requesterId = session.user.id
    }

    const docs = await EditRequest.find(filter)
      .sort({ createdAt: -1 })
      .populate('requesterId', 'name email avatar')
      .populate('reviewedBy', 'name')

    return NextResponse.json({ data: docs.map(d => d.toJSON()) })
  } catch (err) {
    console.error('[edit-requests GET]', err)
    return NextResponse.json({ error: err.message ?? 'Server error' }, { status: 500 })
  }
}
