export const dynamic = 'force-dynamic'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Freelancer, FreelancerAssignment } from '@/models'

// GET /api/admin/freelancers/[id]/due-summary
// Returns all unpaid assignments for a freelancer ordered oldest-first,
// along with total due amount. Used to populate the Dues tab and Pay modal.
export async function GET(req, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    if (!['SUPER_ADMIN', 'MANAGER'].includes(session.user.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const { id } = await params

    const freelancer = await Freelancer.findById(id)
      .populate({ path: 'userId', select: 'name email avatar' })
      .lean()
    if (!freelancer) return Response.json({ error: 'Freelancer not found' }, { status: 404 })

    // Fetch all assignments that have not been fully paid yet, oldest first
    const assignments = await FreelancerAssignment.find({
      freelancerId: id,
      paymentStatus: { $nin: ['PAID'] },
      paymentAmount: { $gt: 0 },
    })
      .populate({ path: 'projectId', select: 'name projectCode venture' })
      .sort({ createdAt: 1 }) // oldest first for FIFO allocation
      .lean()

    const totalDue = assignments.reduce((sum, a) => sum + (a.paymentAmount ?? 0), 0)

    return Response.json({
      data: {
        freelancer: {
          id:    freelancer._id,
          name:  freelancer.userId?.name,
          email: freelancer.userId?.email,
          pendingBalance:     freelancer.pendingBalance ?? 0,
          withdrawableBalance: freelancer.withdrawableBalance ?? 0,
        },
        totalDue,
        assignments: assignments.map(a => ({
          id:            a._id,
          paymentAmount: a.paymentAmount,
          paymentStatus: a.paymentStatus,
          status:        a.status,
          createdAt:     a.createdAt,
          project: a.projectId
            ? { id: a.projectId._id, name: a.projectId.name, code: a.projectId.projectCode, venture: a.projectId.venture }
            : null,
        })),
      },
    })
  } catch (err) {
    console.error('[admin/freelancers/due-summary GET]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
