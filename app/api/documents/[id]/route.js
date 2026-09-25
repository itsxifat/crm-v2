export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Document } from '@/models'
import { requireStaff } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'

// GET /api/documents/[id] — admin document library (staff-only). External
// portals use their own scoped endpoints (e.g. /api/client/documents).
// Linked Client / Freelancer records are populated with display fields only —
// never bank, KYC, salary or invite-token data.
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requireStaff(session)
    if (denied) return denied

    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()

    const doc = await Document.findById(params.id)
      .populate({ path: 'clientId',     select: 'company clientCode userId', populate: { path: 'userId', select: 'name' } })
      .populate({ path: 'projectId', select: 'id name' })
      .populate({ path: 'freelancerId', select: 'type agencyInfo.agencyName userId', populate: { path: 'userId', select: 'name' } })
      .populate({ path: 'vendorId', select: 'id company' })

    if (!doc) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ data: doc })
  } catch (err) {
    console.error('[GET /api/documents/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/documents/[id]
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const allowedRoles = ['SUPER_ADMIN', 'MANAGER']
    if (!allowedRoles.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()
    await Document.findByIdAndDelete(params.id)
    return NextResponse.json({ message: 'Document deleted' })
  } catch (err) {
    console.error('[DELETE /api/documents/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
