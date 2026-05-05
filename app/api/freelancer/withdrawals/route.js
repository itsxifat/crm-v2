export const dynamic = 'force-dynamic'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Freelancer, WithdrawalRequest, FreelancerAssignment } from '@/models'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    if (session.user.role !== 'FREELANCER') {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const freelancer = await Freelancer.findOne({ userId: session.user.id })
    if (!freelancer) return Response.json({ error: 'Freelancer profile not found' }, { status: 404 })

    const withdrawals = await WithdrawalRequest.find({ freelancerId: freelancer._id })
      .populate({ path: 'projectId', select: 'name projectCode' })
      .sort({ createdAt: -1 })
      .lean()

    return Response.json({ data: withdrawals })
  } catch (err) {
    console.error('[freelancer/withdrawals GET]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    if (session.user.role !== 'FREELANCER') {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const freelancer = await Freelancer.findOne({ userId: session.user.id })
    if (!freelancer) return Response.json({ error: 'Freelancer profile not found' }, { status: 404 })

    const body = await req.json()
    const { amount, method, paymentDetails, assignmentId, projectId } = body

    if (!amount || !method) {
      return Response.json({ error: 'Amount and method are required' }, { status: 400 })
    }
    if (Number(amount) <= 0) {
      return Response.json({ error: 'Amount must be greater than 0' }, { status: 400 })
    }
    if (freelancer.withdrawableBalance < Number(amount)) {
      return Response.json({ error: 'Insufficient withdrawable balance' }, { status: 400 })
    }

    const withdrawal = await WithdrawalRequest.create({
      freelancerId:   freelancer._id,
      amount:         Number(amount),
      method,
      paymentDetails: paymentDetails || null,
      assignmentId:   assignmentId   || null,
      projectId:      projectId      || null,
      status:         'PENDING',
    })

    // Update assignment paymentStatus if provided
    if (assignmentId) {
      await FreelancerAssignment.findByIdAndUpdate(assignmentId, {
        paymentStatus:       'WITHDRAWAL_REQUESTED',
        withdrawalRequestId: withdrawal._id,
      })
    }

    return Response.json({ data: withdrawal }, { status: 201 })
  } catch (err) {
    console.error('[freelancer/withdrawals POST]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
