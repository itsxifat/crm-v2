import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Freelancer, FreelancerAssignment, WithdrawalRequest } from '@/models'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    if (session.user.role !== 'FREELANCER') {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const freelancer = await Freelancer.findOne({ userId: session.user.id })
      .populate({ path: 'userId', select: 'name email avatar role' })
      .lean()

    if (!freelancer) {
      return Response.json({ error: 'Freelancer profile not found' }, { status: 404 })
    }

    const assignments = await FreelancerAssignment.find({ freelancerId: freelancer._id })
      .populate({ path: 'projectId', select: 'name projectCode venture status' })
      .sort({ createdAt: -1 })
      .lean()

    const withdrawals = await WithdrawalRequest.find({ freelancerId: freelancer._id })
      .sort({ createdAt: -1 })
      .limit(10)
      .lean()

    return Response.json({
      data: {
        freelancer,
        assignments,
        withdrawals,
      },
    })
  } catch (err) {
    console.error('[freelancer/dashboard GET]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
