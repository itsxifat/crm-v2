export const dynamic = 'force-dynamic'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Freelancer, FreelancerAssignment, SalaryPayout } from '@/models'

// Sum a list of {currency, amount} into per-currency buckets so we never add
// two different currencies together. Returns { totals: [{currency,total}], count }.
function groupByCurrency(rows) {
  const map = new Map()
  for (const r of rows) {
    const cur = r.currency || 'BDT'
    map.set(cur, (map.get(cur) || 0) + (Number(r.amount) || 0))
  }
  return {
    totals: [...map.entries()].map(([currency, total]) => ({ currency, total })),
    count: rows.length,
  }
}

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

    const payable = assignments.filter(a => a.paymentStatus !== 'NOT_REQUIRED' && a.paymentAmount)

    // Bucket 1 — accepted/committed but not yet delivered.
    const acceptedRows = payable
      .filter(a => ['ACCEPTED', 'IN_PROGRESS'].includes(a.status))
      .map(a => ({ currency: a.currency, amount: a.paymentAmount }))

    // Bucket 2 — delivered, awaiting payment.
    const awaitingRows = payable
      .filter(a => a.status === 'COMPLETED' && a.paymentStatus !== 'PAID')
      .map(a => ({ currency: a.currency, amount: a.paymentAmount }))

    // Bucket 3 — settled (lifetime).
    const paidRows = payable
      .filter(a => a.paymentStatus === 'PAID')
      .map(a => ({ currency: a.currency, amount: a.paymentAmount }))

    // Salary payouts (temporary salary-based freelancers).
    const salaryPayouts = await SalaryPayout.find({ freelancerId: freelancer._id })
      .sort({ period: -1 })
      .lean()

    const salaryPending = salaryPayouts
      .filter(p => p.status === 'PENDING')
      .map(p => ({ currency: p.currency, amount: p.amount }))
    const salaryPaid = salaryPayouts
      .filter(p => p.status === 'PAID')
      .map(p => ({ currency: p.currency, amount: p.amount }))

    return Response.json({
      data: {
        freelancer,
        assignments,
        salaryPayouts,
        summary: {
          accepted:        groupByCurrency(acceptedRows),
          awaitingPayment: groupByCurrency(awaitingRows),
          paid:            groupByCurrency(paidRows),
          salaryPending:   groupByCurrency(salaryPending),
          salaryPaid:      groupByCurrency(salaryPaid),
        },
      },
    })
  } catch (err) {
    console.error('[freelancer/dashboard GET]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
