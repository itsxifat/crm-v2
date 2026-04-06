export const dynamic = 'force-dynamic'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { WithdrawalRequest, Freelancer, Transaction, ProjectExpense, FreelancerAssignment, Project } from '@/models'

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
      const hasAllocations = withdrawal.allocations?.length > 0

      // 1. Create a single Transaction for the total amount
      const tx = await Transaction.create({
        type:          'EXPENSE',
        category:      'Freelancer Payment',
        amount:        withdrawal.amount,
        description:   `Freelancer Payment - ${freelancerName}${adminNote ? ` — ${adminNote}` : ''}`,
        date:          new Date(),
        projectId:     withdrawal.projectId || null,
        freelancerId:  String(freelancer._id),
        paymentMethod: mapMethod(withdrawal.method),
        paidBy:        session.user.id,
        createdBy:     session.user.id,
        reference:     withdrawal.details || null,
      })

      if (hasAllocations) {
        // 2a. For each allocation: create ProjectExpense + mark assignment PAID
        for (const alloc of withdrawal.allocations) {
          const allocAmt = alloc.amount

          if (alloc.projectId) {
            // Fetch project for venture info
            const project = await Project.findById(alloc.projectId).select('name venture').lean()

            await ProjectExpense.create({
              projectId:             alloc.projectId,
              venture:               project?.venture ?? null,
              title:                 `Freelancer Payment - ${freelancerName}`,
              amount:                allocAmt,
              category:              'Freelancer Payment',
              date:                  new Date(),
              freelancerId:          String(freelancer._id),
              submittedBy:           session.user.id,
              status:                'APPROVED',
              reviewedBy:            session.user.id,
              reviewedAt:            new Date(),
              notes:                 adminNote || null,
              syncedToAccounts:      true,
              accountsTransactionId: tx._id,
            })
          }

          if (alloc.assignmentId) {
            await FreelancerAssignment.findByIdAndUpdate(alloc.assignmentId, {
              paymentStatus:       'PAID',
              withdrawalRequestId: withdrawal._id,
            })
          }
        }
      } else {
        // 2b. Legacy single-assignment path
        if (withdrawal.projectId) {
          const project = await Project.findById(withdrawal.projectId).select('name venture').lean()
          await ProjectExpense.create({
            projectId:             withdrawal.projectId,
            venture:               project?.venture ?? null,
            title:                 `Freelancer Payment - ${freelancerName}`,
            amount:                withdrawal.amount,
            category:              'Freelancer Payment',
            date:                  new Date(),
            freelancerId:          String(freelancer._id),
            submittedBy:           session.user.id,
            status:                'APPROVED',
            reviewedBy:            session.user.id,
            reviewedAt:            new Date(),
            syncedToAccounts:      true,
            accountsTransactionId: tx._id,
          })
        }

        if (withdrawal.assignmentId) {
          await FreelancerAssignment.findByIdAndUpdate(withdrawal.assignmentId, {
            paymentStatus:       'PAID',
            withdrawalRequestId: withdrawal._id,
          })
        }
      }

      // 3. Deduct from freelancer withdrawableBalance (if it had been credited)
      await Freelancer.findByIdAndUpdate(freelancer._id, {
        $inc: { withdrawableBalance: -withdrawal.amount },
      })

      // 4. Finalise withdrawal
      withdrawal.status        = 'APPROVED'
      withdrawal.processedBy   = session.user.id
      withdrawal.processedAt   = new Date()
      withdrawal.transactionId = tx._id
      if (adminNote) withdrawal.adminNote = adminNote
      await withdrawal.save()

    } else if (action === 'reject') {
      if (withdrawal.status !== 'PENDING') {
        return Response.json({ error: 'Only PENDING requests can be rejected' }, { status: 400 })
      }

      withdrawal.status      = 'REJECTED'
      withdrawal.adminNote   = adminNote || null
      withdrawal.processedBy = session.user.id
      withdrawal.processedAt = new Date()
      await withdrawal.save()

      // Return amount to withdrawableBalance only if it was already deducted
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
      .populate({ path: 'allocations.projectId', select: 'name projectCode venture' })
      .lean()

    return Response.json({ data: updated })
  } catch (err) {
    console.error('[admin/withdrawal-requests PATCH]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

function mapMethod(method) {
  const MAP = {
    BKASH:         'ONLINE',
    BANK:          'BANK_TRANSFER',
    BANK_TRANSFER: 'BANK_TRANSFER',
    CASH:          'CASH',
    CARD:          'CARD',
    CHEQUE:        'CHEQUE',
    PAYPAL:        'ONLINE',
    ONLINE:        'ONLINE',
  }
  return MAP[method?.toUpperCase()] ?? 'OTHER'
}
