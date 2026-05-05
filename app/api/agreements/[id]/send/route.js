export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Agreement } from '@/models'

// POST /api/agreements/[id]/send
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const allowedRoles = ['SUPER_ADMIN', 'MANAGER']
    if (!allowedRoles.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const agreement = await Agreement.findById(params.id)
      .populate({ path: 'clientId',     populate: { path: 'userId', select: 'name email' } })
      .populate({ path: 'freelancerId', populate: { path: 'userId', select: 'name email' } })
      .populate({ path: 'vendorId', select: 'company email' })

    if (!agreement) return NextResponse.json({ error: 'Agreement not found' }, { status: 404 })

    if (agreement.status === 'SIGNED') {
      return NextResponse.json({ error: 'Agreement is already signed' }, { status: 400 })
    }

    const updated = await Agreement.findByIdAndUpdate(
      params.id,
      { status: 'SENT' },
      { new: true }
    )

    const recipientEmail =
      agreement.clientId?.userId?.email ||
      agreement.freelancerId?.userId?.email ||
      agreement.vendorId?.email ||
      null

    return NextResponse.json({
      message: `Agreement "${agreement.title}" marked as sent`,
      sentTo:  recipientEmail,
      data:    updated,
    })
  } catch (err) {
    console.error('[POST /api/agreements/[id]/send]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
