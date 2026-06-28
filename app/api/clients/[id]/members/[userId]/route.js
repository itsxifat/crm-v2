export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Client, CompanyMembership } from '@/models'
import { logActivity } from '@/lib/logActivity'

const ALLOWED = ['SUPER_ADMIN', 'MANAGER']

// DELETE /api/clients/[id]/members/[userId] — revoke a person's access (soft).
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!ALLOWED.includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

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
