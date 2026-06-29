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

      // Settle one assignment: move its amount OUT of whichever balance bucket
      // currently holds it, then mark it PAID. This keeps the wallet correct in
      // every case — a freelancer cashing out their wallet (IN_WALLET /
      // WITHDRAWAL_REQUESTED → withdrawableBalance), an admin direct-paying dues
      // that were only accepted (→ pendingBalance), or paying a never-accepted
      // assignment (→ no bucket). The old code flatly subtracted the full amount
      // from withdrawableBalance, which drove it negative on direct payments.
      let fromWithdrawable = 0
      let fromPending      = 0
      async function settleAssignment(assignmentId, amt) {
        if (!assignmentId) return
        const a = await FreelancerAssignment.findById(assignmentId).select('paymentStatus status').lean()
        if (a) {
          if (['IN_WALLET', 'WITHDRAWAL_REQUESTED'].includes(a.paymentStatus)) fromWithdrawable += amt
          else if (['ACCEPTED', 'IN_PROGRESS', 'COMPLETED'].includes(a.status)) fromPending += amt
          // else: never accepted → its amount was never credited to any balance
        }
        await FreelancerAssignment.findByIdAndUpdate(assignmentId, {
          paymentStatus:       'PAID',
          withdrawalRequestId: withdrawal._id,
        })
      }

      if (hasAllocations) {
        // 2a. For each allocation: create ProjectExpense + settle the assignment
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

          await settleAssignment(alloc.assignmentId, allocAmt)
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

        await settleAssignment(withdrawal.assignmentId, withdrawal.amount)
      }

      // 3. A pure wallet-balance withdrawal (no linked assignments) takes the whole
      //    amount out of the wallet. Otherwise deduct exactly what each assignment
      //    drew from each bucket.
      const hasLinks = hasAllocations || !!withdrawal.assignmentId
      if (!hasLinks) fromWithdrawable += withdrawal.amount
      await Freelancer.findByIdAndUpdate(freelancer._id, {
        $inc: { withdrawableBalance: -fromWithdrawable, pendingBalance: -fromPending },
      })

      // 4. Finalise withdrawal — it is now actually paid out (Transaction created),
      //    so the terminal status is PAID (matches the direct-payment route and lets
      //    the freelancer's panel show "Paid", not a perpetual "Approved").
      withdrawal.status        = 'PAID'
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

      // Do NOT refund withdrawableBalance: it is only deducted on approval, so a
      // PENDING→REJECTED request never had anything taken out. (The old refund
      // here inflated the wallet.) Instead, release any assignments that were
      // earmarked for this request so they go back to being withdrawable.
      const releaseIds = [
        ...(withdrawal.allocations ?? []).map(a => a.assignmentId),
        withdrawal.assignmentId,
      ].filter(Boolean)
      if (releaseIds.length) {
        await FreelancerAssignment.updateMany(
          { _id: { $in: releaseIds }, paymentStatus: 'WITHDRAWAL_REQUESTED' },
          { $set: { paymentStatus: 'IN_WALLET' }, $unset: { withdrawalRequestId: 1 } },
        )
      }

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
