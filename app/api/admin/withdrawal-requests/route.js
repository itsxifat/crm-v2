export const dynamic = 'force-dynamic'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { WithdrawalRequest } from '@/models'

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    if (!['SUPER_ADMIN', 'MANAGER'].includes(session.user.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const { searchParams } = new URL(req.url)
    const status = searchParams.get('status')

    const filter = {}
    if (status) filter.status = status

    const withdrawals = await WithdrawalRequest.find(filter)
      .populate({
        path: 'freelancerId',
        populate: { path: 'userId', select: 'name email avatar' },
      })
      .populate({ path: 'projectId', select: 'name projectCode venture' })
      .populate({ path: 'processedBy', select: 'name email' })
      .populate({ path: 'allocations.projectId', select: 'name projectCode venture' })
      .sort({ createdAt: -1 })
      .lean()

    return Response.json({ data: withdrawals })
  } catch (err) {
    console.error('[admin/withdrawal-requests GET]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
