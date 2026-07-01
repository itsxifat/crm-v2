export const dynamic = 'force-dynamic'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { SalaryPayout, ProjectExpense } from '@/models'
import { requirePerm } from '@/lib/rbac'

// PATCH /api/admin/salary-payouts/[id] — cancel a pending salary payout.
//
// Approval & payment now flow through the unified expense pipeline: the cron
// creates a linked SALARY-origin ProjectExpense that is approved → voucher →
// marked paid (with a signed-scan upload) via /api/expenses/[id]. This route
// only cancels a payout that hasn't been paid yet, and rejects its linked expense.
export async function PATCH(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'finance.payments.confirm')
    if (denied) return denied

    await connectDB()
    const { action, note } = await request.json()
    if (action !== 'cancel') {
      return Response.json({ error: 'Salary payouts are approved & paid from the Expenses queue. This endpoint only supports "cancel".' }, { status: 422 })
    }

    const payout = await SalaryPayout.findById(params.id)
    if (!payout) return Response.json({ error: 'Not found' }, { status: 404 })
    if (payout.status !== 'PENDING') return Response.json({ error: 'Already processed' }, { status: 409 })

    payout.status = 'CANCELLED'
    payout.note = note ?? null
    await payout.save()

    // Reject the linked expense so it drops out of the approval queue.
    await ProjectExpense.updateOne(
      { salaryPayoutId: payout._id, status: { $in: ['PENDING', 'APPROVED'] } },
      { $set: { status: 'REJECTED', reviewedBy: session.user.id, reviewedAt: new Date(), reviewNote: note ?? 'Salary payout cancelled' } },
    )

    return Response.json({ data: payout.toJSON() })
  } catch (err) {
    console.error('[admin/salary-payouts PATCH]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
