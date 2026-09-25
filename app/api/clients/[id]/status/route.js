export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { User, Client } from '@/models'
import { logActivity } from '@/lib/logActivity'
import { isValidObjectId } from '@/lib/objectId'

// PATCH /api/clients/[id]/status  { isActive: boolean }
// Deactivate (false) or reactivate (true) a client account. Both are audit-logged.
export async function PATCH(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (session.user.role !== 'SUPER_ADMIN')
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Client not found' }, { status: 404 })
    await connectDB()

    const { isActive } = await request.json()
    if (typeof isActive !== 'boolean')
      return NextResponse.json({ error: 'isActive (boolean) is required' }, { status: 422 })

    const client = await Client.findById(params.id).lean()
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

    // Company-level switch: deactivating cuts off every member of THIS company
    // (see lib/clientAccess.js) without disabling people's own accounts, which
    // may belong to other companies too.
    await Client.findByIdAndUpdate(params.id, { $set: { isActive } })
    // Legacy clients were deactivated by disabling the owner's login; undo that
    // on reactivation (only ever for CLIENT accounts, never staff).
    if (isActive) {
      await User.findOneAndUpdate({ _id: client.userId, role: 'CLIENT', isActive: false }, { $set: { isActive: true } })
    }

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   isActive ? 'REACTIVATE' : 'DEACTIVATE',
      entity:   'CLIENT',
      entityId: params.id,
      changes:  JSON.stringify({ clientCode: client.clientCode, isActive }),
      request,
    })

    return NextResponse.json({
      success: true,
      isActive,
      message: isActive ? 'Client reactivated' : 'Client deactivated',
    })
  } catch (err) {
    console.error('[PATCH /api/clients/[id]/status]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
