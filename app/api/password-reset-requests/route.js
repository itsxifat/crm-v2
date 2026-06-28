export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { requirePerm } from '@/lib/rbac'
import connectDB from '@/lib/mongodb'
import { PasswordResetRequest } from '@/models'

// GET /api/password-reset-requests?status=PENDING
// Staff queue of client password-reset requests. Gated by a dedicated permission.
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'sales.customers.passwordReset')
    if (denied) return denied

    await connectDB()

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')
    const filter = status ? { status } : {}

    const [requests, pendingCount] = await Promise.all([
      PasswordResetRequest.find(filter)
        .sort({ status: 1, createdAt: -1 })
        .limit(100)
        .populate({ path: 'userId',     select: 'name email isActive' })
        .populate({ path: 'clientId',   select: 'clientCode company' })
        .populate({ path: 'reviewedBy', select: 'name' })
        .lean(),
      PasswordResetRequest.countDocuments({ status: 'PENDING' }),
    ])

    return NextResponse.json({
      data: requests.map(r => ({
        id:         r._id.toString(),
        status:     r.status,
        email:      r.email,
        user:       r.userId   ? { id: r.userId._id.toString(), name: r.userId.name, email: r.userId.email, isActive: r.userId.isActive } : null,
        client:     r.clientId ? { id: r.clientId._id.toString(), clientCode: r.clientId.clientCode, company: r.clientId.company } : null,
        reviewedBy: r.reviewedBy ? r.reviewedBy.name : null,
        reviewedAt: r.reviewedAt ?? null,
        note:       r.note ?? null,
        createdAt:  r.createdAt,
      })),
      pendingCount,
    })
  } catch (err) {
    console.error('[GET /api/password-reset-requests]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
