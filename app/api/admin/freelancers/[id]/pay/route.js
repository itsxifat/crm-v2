export const dynamic = 'force-dynamic'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Freelancer, FreelancerAssignment, WithdrawalRequest } from '@/models'
import { z } from 'zod'

const schema = z.object({
  amount:         z.number().positive(),
  method:         z.string().min(1),
  paymentDetails: z.string().optional().default(''),
  note:           z.string().optional().default(''),
})

// POST /api/admin/freelancers/[id]/pay
// Admin initiates a bulk/partial payment for a freelancer.
// Allocates FIFO (oldest assignments first).
// Creates a PENDING WithdrawalRequest (goes to Accounts for approval).
// Does NOT immediately mark assignments PAID — that happens on approval.
export async function POST(req, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    if (!['SUPER_ADMIN', 'MANAGER'].includes(session.user.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const { id } = await params
    const body   = await req.json()
    const parsed = schema.safeParse({ ...body, amount: Number(body.amount) })
    if (!parsed.success) {
      return Response.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    const { amount, method, paymentDetails, note } = parsed.data

    const freelancer = await Freelancer.findById(id).populate({ path: 'userId', select: 'name' }).lean()
    if (!freelancer) return Response.json({ error: 'Freelancer not found' }, { status: 404 })

    // Get all unpaid assignments ordered oldest-first (FIFO allocation)
    const assignments = await FreelancerAssignment.find({
      freelancerId: id,
      paymentStatus: { $nin: ['PAID'] },
      paymentAmount: { $gt: 0 },
    })
      .populate({ path: 'projectId', select: 'name projectCode venture' })
      .sort({ createdAt: 1 })
      .lean()

    const totalDue = assignments.reduce((sum, a) => sum + (a.paymentAmount ?? 0), 0)

    if (totalDue === 0) {
      return Response.json({ error: 'No outstanding dues for this freelancer' }, { status: 400 })
    }
    if (amount > totalDue) {
      return Response.json({ error: `Amount exceeds total due (৳${totalDue.toLocaleString()})` }, { status: 400 })
    }

    // Build FIFO allocations
    const allocations = []
    let remaining = amount

    for (const a of assignments) {
      if (remaining <= 0) break
      const allocAmt = Math.min(remaining, a.paymentAmount)
      allocations.push({
        assignmentId: a._id,
        projectId:    a.projectId?._id ?? null,
        amount:       allocAmt,
      })
      remaining -= allocAmt
    }

    // Create a PENDING WithdrawalRequest (pending approval in Accounts)
    const withdrawal = await new WithdrawalRequest({
      freelancerId:    id,
      amount,
      method,
      details:         paymentDetails || null,
      paymentDetails:  paymentDetails || null,
      status:          'PENDING',
      adminNote:       note || null,
      isDirectPayment: true,
      allocations,
      // link first project for backwards compat display
      projectId:    allocations[0]?.projectId ?? null,
      assignmentId: allocations[0]?.assignmentId ?? null,
    }).save()

    return Response.json({ data: withdrawal }, { status: 201 })
  } catch (err) {
    console.error('[admin/freelancers/pay POST]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
