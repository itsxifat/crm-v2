export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Client, CompanyMembership } from '@/models'
import { logActivity } from '@/lib/logActivity'
import { requirePerm } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'

// DELETE /api/clients/[id]/members/[userId] — revoke a person's access (soft).
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'sales.customers.update')
    if (denied) return denied
    if (!isValidObjectId(params.id) || !isValidObjectId(params.userId))
      return NextResponse.json({ error: 'Member not found' }, { status: 404 })

    await connectDB()

    const client = await Client.findById(params.id).select('clientCode').lean()
    if (!client) return NextResponse.json({ error: 'Company not found' }, { status: 404 })

    // Don't allow removing the last active member of a company (would orphan it).
    const activeCount = await CompanyMembership.countDocuments({ clientId: params.id, status: 'ACTIVE' })
    if (activeCount <= 1) {
      return NextResponse.json({ error: 'Cannot remove the only remaining member of a company' }, { status: 409 })
    }

    const membership = await CompanyMembership.findOneAndUpdate(
      { clientId: params.id, userId: params.userId, status: 'ACTIVE' },
      { $set: { status: 'REMOVED' } },
      { new: true },
    )
    if (!membership) return NextResponse.json({ error: 'Member not found' }, { status: 404 })

    // Concurrent removals could both pass the count check above; if that left the
    // company with nobody, undo this removal.
    const remaining = await CompanyMembership.countDocuments({ clientId: params.id, status: 'ACTIVE' })
    if (remaining === 0) {
      await CompanyMembership.updateOne({ _id: membership._id, status: 'REMOVED' }, { $set: { status: 'ACTIVE' } })
      return NextResponse.json({ error: 'Cannot remove the only remaining member of a company' }, { status: 409 })
    }

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'MEMBER_REMOVE',
      entity:   'CLIENT',
      entityId: params.id,
      changes:  JSON.stringify({ clientCode: client.clientCode, removedUserId: params.userId }),
      request,
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/clients/[id]/members/[userId]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
