export const dynamic = 'force-dynamic'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { SalaryPayout } from '@/models'
import { requirePerm } from '@/lib/rbac'

// GET /api/admin/salary-payouts?status=PENDING — list salary payouts for review.
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'finance.payments.confirm')
    if (denied) return denied

    await connectDB()
    const status = new URL(request.url).searchParams.get('status')
    const filter = status ? { status } : {}

    const payouts = await SalaryPayout.find(filter)
      .populate({ path: 'freelancerId', populate: { path: 'userId', select: 'name email avatar' } })
      .sort({ status: 1, period: -1, createdAt: -1 })
      .lean()

    return Response.json({ data: payouts })
  } catch (err) {
    console.error('[admin/salary-payouts GET]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
