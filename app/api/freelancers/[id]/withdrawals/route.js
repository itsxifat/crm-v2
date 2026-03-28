import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Freelancer, WithdrawalRequest } from '@/models'
import { z } from 'zod'

const approvalSchema = z.object({
  action:    z.enum(['approve', 'reject']),
  adminNote: z.string().optional().nullable(),
})

// GET /api/freelancers/[id]/withdrawals
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const withdrawals = await WithdrawalRequest.find({ freelancerId: params.id }).sort({ createdAt: -1 })
    return NextResponse.json({ data: withdrawals })
  } catch (err) {
    console.error('[GET /api/freelancers/[id]/withdrawals]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/freelancers/[id]/withdrawals?requestId=xxx
export async function PATCH(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const allowedRoles = ['SUPER_ADMIN', 'MANAGER']
    if (!allowedRoles.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const { searchParams } = new URL(request.url)
    const requestId = searchParams.get('requestId')
    if (!requestId) return NextResponse.json({ error: 'requestId required' }, { status: 400 })

    const body   = await request.json()
    const parsed = approvalSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    const { action, adminNote } = parsed.data

    const withdrawal = await WithdrawalRequest.findById(requestId).lean()
    if (!withdrawal) return NextResponse.json({ error: 'Withdrawal not found' }, { status: 404 })
    if (withdrawal.status !== 'PENDING') {
      return NextResponse.json({ error: 'Withdrawal already processed' }, { status: 400 })
    }

    const newStatus = action === 'approve' ? 'APPROVED' : 'REJECTED'

    const updated = await WithdrawalRequest.findByIdAndUpdate(
      requestId,
      { status: newStatus, adminNote: adminNote ?? null, processedBy: session.user.id, processedAt: new Date() },
      { new: true }
    )

    // Deduct from wallet on approval
    if (action === 'approve') {
      const freelancer = await Freelancer.findById(params.id).lean()
      if (freelancer && freelancer.walletBalance >= withdrawal.amount) {
        await Freelancer.findByIdAndUpdate(params.id, { walletBalance: freelancer.walletBalance - withdrawal.amount })
      }
    }

    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error('[PATCH /api/freelancers/[id]/withdrawals]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
