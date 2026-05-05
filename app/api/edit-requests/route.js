export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { EditRequest } from '@/models'

// POST /api/edit-requests  — create an edit request
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const { itemType, itemId, reason } = await request.json()
    if (!itemType || !itemId || !reason?.trim())
      return NextResponse.json({ error: 'itemType, itemId and reason are required' }, { status: 400 })

    await connectDB()

    // Only one PENDING request per item at a time
    const existing = await EditRequest.findOne({ itemId, itemType, status: 'PENDING' })
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
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

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
