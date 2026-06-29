export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { WithdrawalRequest } from '@/models'
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

    // DEPRECATED settlement path. This route used to only flip the status and
    // adjust an unused `walletBalance` field — it did NOT record a Transaction or
    // ProjectExpense, mark the assignments PAID, or touch `withdrawableBalance`.
    // That made a withdrawal look settled here while showing unpaid in Accounts,
    // the wallet and the freelancer's panel. All approvals now go through the
    // canonical route, which does the full settlement atomically.
    void requestId; void action; void adminNote
    return NextResponse.json(
      { error: 'Process this withdrawal from the Accounts → Withdrawals queue (PATCH /api/admin/withdrawal-requests/[id]).' },
      { status: 410 },
    )
  } catch (err) {
    console.error('[PATCH /api/freelancers/[id]/withdrawals]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
