export const dynamic = 'force-dynamic'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { SalaryPayout } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { maskList } from '@/lib/pii'

// Payouts populate a (trimmed) Freelancer; mask what FREELANCER_PII would hide.
const SALARY_PAYOUT_PII = {
  'pii.contact.view':   [['freelancerId.userId.email', 'email']],
  'pii.financial.view': [['freelancerId.salaryAmount', 'money']],
}

// GET /api/admin/salary-payouts?status=PENDING — list salary payouts for review.
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'finance.payments.confirm')
    if (denied) return denied

    await connectDB()
    const status = new URL(request.url).searchParams.get('status')
    const filter = status ? { status: String(status) } : {}

    const payouts = await SalaryPayout.find(filter)
      // Minimal freelancer fields only — never bank/bKash, NID/passport or inviteToken.
      .populate({
        path: 'freelancerId',
        select: 'type userId employmentMode salaryAmount salaryCurrency salaryDay',
        populate: { path: 'userId', select: 'name email avatar' },
      })
      .sort({ status: 1, period: -1, createdAt: -1 })
      .lean()

    return Response.json({ data: maskList(session, payouts, SALARY_PAYOUT_PII) })
  } catch (err) {
    console.error('[admin/salary-payouts GET]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
