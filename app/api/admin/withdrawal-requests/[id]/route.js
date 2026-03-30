export const dynamic = 'force-dynamic'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { WithdrawalRequest, Freelancer, Transaction, ProjectExpense, FreelancerAssignment } from '@/models'

export async function PATCH(req, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    if (!['SUPER_ADMIN', 'MANAGER'].includes(session.user.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const { id } = await params
    const body   = await req.json()
    const { action, adminNote } = body

    const withdrawal = await WithdrawalRequest.findById(id)
      .populate({
        path: 'freelancerId',
        populate: { path: 'userId', select: 'name email' },
      })
    if (!withdrawal) return Response.json({ error: 'Withdrawal request not found' }, { status: 404 })

    if (action === 'approve') {
      if (withdrawal.status !== 'PENDING') {
        return Response.json({ error: 'Only PENDING requests can be approved' }, { status: 400 })
      }

      const freelancer     = withdrawal.freelancerId
      const freelancerName = freelancer?.userId?.name ?? 'Freelancer'

      // 1. Create Transaction
      const tx = await Transaction.create({
        type:        'EXPENSE',
        category:    'Freelancer Payment',
        amount:      withdrawal.amount,
        description: `Freelancer Payment - ${freelancerName}`,
        date:        new Date(),
        projectId:   withdrawal.projectId || null,
        freelancerId: String(freelancer._id),
        createdBy:   session.user.id,
      })

      // 2. Create ProjectExpense if projectId exists
      if (withdrawal.projectId) {
        await ProjectExpense.create({
          projectId:             withdrawal.projectId,
          title:                 `Freelancer Payment - ${freelancerName}`,
          amount:                withdrawal.amount,
          category:              'Freelancer Payment',
          date:                  new Date(),
          submittedBy:           session.user.id,
          status:                'APPROVED',
          reviewedBy:            session.user.id,
          reviewedAt:            new Date(),
          syncedToAccounts:      true,
          accountsTransactionId: tx._id,
        })
      }

      // 3. Deduct from freelancer withdrawableBalance
      await Freelancer.findByIdAndUpdate(freelancer._id, {
        $inc: { withdrawableBalance: -withdrawal.amount },
      })

      // 4. Update withdrawal request
      withdrawal.status        = 'APPROVED'
      withdrawal.processedBy   = session.user.id
      withdrawal.processedAt   = new Date()
      withdrawal.transactionId = tx._id
      if (adminNote) withdrawal.adminNote = adminNote
      await withdrawal.save()

      // 5. Update assignment paymentStatus if assignmentId exists
      if (withdrawal.assignmentId) {
        await FreelancerAssignment.findByIdAndUpdate(withdrawal.assignmentId, {
          paymentStatus: 'PAID',
        })
      }

    } else if (action === 'reject') {
      if (withdrawal.status !== 'PENDING') {
        return Response.json({ error: 'Only PENDING requests can be rejected' }, { status: 400 })
      }

      withdrawal.status      = 'REJECTED'
      withdrawal.adminNote   = adminNote || null
      withdrawal.processedBy = session.user.id
      withdrawal.processedAt = new Date()
      await withdrawal.save()

      // Return amount to withdrawableBalance
      await Freelancer.findByIdAndUpdate(withdrawal.freelancerId._id ?? withdrawal.freelancerId, {
        $inc: { withdrawableBalance: withdrawal.amount },
      })

    } else {
      return Response.json({ error: 'Invalid action' }, { status: 400 })
    }

    const updated = await WithdrawalRequest.findById(id)
      .populate({
        path: 'freelancerId',
        populate: { path: 'userId', select: 'name email avatar' },
      })
      .populate({ path: 'projectId', select: 'name projectCode' })
      .lean()

    return Response.json({ data: updated })
  } catch (err) {
    console.error('[admin/withdrawal-requests PATCH]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
