export const dynamic = 'force-dynamic'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { FreelancerAssignment, Freelancer, Project, ProjectExpense } from '@/models'
import { isValidObjectId } from '@/lib/objectId'

// Display-only freelancer fields for populated responses — never bank, KYC,
// salary or invite-token data.
const FREELANCER_DISPLAY_FIELDS = 'type agencyInfo.agencyName employmentMode paymentCurrency userId'

// If the assignment has a pending payment request, reject the linked PENDING
// expense so it can no longer be paid. Returns false when the expense has
// already been paid (caller must refuse the action).
async function withdrawPaymentRequest(assignment, userId, note) {
  if (assignment.paymentStatus !== 'PAYMENT_REQUESTED') return true
  if (assignment.expenseId) {
    const expense = await ProjectExpense.findById(assignment.expenseId).select('status').lean()
    if (expense && expense.status === 'PENDING') {
      const rejected = await ProjectExpense.findOneAndUpdate(
        { _id: assignment.expenseId, status: 'PENDING' },
        { $set: { status: 'REJECTED', reviewedBy: userId, reviewedAt: new Date(), reviewNote: note } },
      )
      if (!rejected) return false // paid in the meantime
    } else if (expense && expense.status !== 'REJECTED') {
      return false // PAID / AUTHORIZED
    }
  }
  assignment.paymentStatus = 'PENDING'
  assignment.expenseId     = null
  return true
}

export async function PATCH(req, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    await connectDB()

    const { id } = await params
    if (!isValidObjectId(id)) return Response.json({ error: 'Assignment not found' }, { status: 404 })
    const body   = await req.json()
    const { action } = body

    const assignment = await FreelancerAssignment.findById(id)
    if (!assignment) return Response.json({ error: 'Assignment not found' }, { status: 404 })

    const isAdmin    = ['SUPER_ADMIN', 'MANAGER'].includes(session.user.role)
    const isFreelancer = session.user.role === 'FREELANCER'

    // PM-of-record (project manager) may complete/request payment for their own project.
    const isProjectManager = async () => {
      const project = await Project.findById(assignment.projectId).select('projectManagerId').lean()
      return project && String(project.projectManagerId) === String(session.user.id)
    }

    if (action === 'accept') {
      // Freelancer accepts the assignment
      if (!isFreelancer) return Response.json({ error: 'Forbidden' }, { status: 403 })

      // Verify this freelancer owns this assignment
      const freelancer = await Freelancer.findOne({ userId: session.user.id })
      if (!freelancer || String(freelancer._id) !== String(assignment.freelancerId)) {
        return Response.json({ error: 'Forbidden' }, { status: 403 })
      }
      if (assignment.status !== 'ASSIGNED') {
        return Response.json({ error: 'Assignment cannot be accepted in current status' }, { status: 400 })
      }

      assignment.status     = 'ACCEPTED'
      assignment.acceptedAt = new Date()
      await assignment.save()

    } else if (action === 'start') {
      if (!isFreelancer && !isAdmin) return Response.json({ error: 'Forbidden' }, { status: 403 })
      if (isFreelancer) {
        // A freelancer may only start their own engagement.
        const freelancer = await Freelancer.findOne({ userId: session.user.id })
        if (!freelancer || String(freelancer._id) !== String(assignment.freelancerId)) {
          return Response.json({ error: 'Forbidden' }, { status: 403 })
        }
      }
      if (assignment.status !== 'ACCEPTED') {
        return Response.json({ error: 'Assignment must be ACCEPTED before starting' }, { status: 400 })
      }
      assignment.status = 'IN_PROGRESS'
      await assignment.save()

    } else if (action === 'complete') {
      // Work delivered — marked done by an admin or the project manager.
      if (!isAdmin && !(await isProjectManager())) return Response.json({ error: 'Forbidden' }, { status: 403 })
      if (!['IN_PROGRESS', 'ACCEPTED'].includes(assignment.status)) {
        return Response.json({ error: 'Assignment must be in progress to complete' }, { status: 400 })
      }
      assignment.status      = 'COMPLETED'
      assignment.completedAt = new Date()
      await assignment.save()

    } else if (action === 'cancel') {
      if (!isAdmin && !(await isProjectManager())) return Response.json({ error: 'Forbidden' }, { status: 403 })
      if (assignment.paymentStatus === 'PAID') {
        return Response.json({ error: 'Cannot cancel a settled (paid) assignment' }, { status: 400 })
      }
      // Withdraw any pending payment request so the expense can't be paid.
      if (!(await withdrawPaymentRequest(assignment, session.user.id, 'Engagement cancelled'))) {
        return Response.json({ error: 'The payment for this assignment has already been made' }, { status: 409 })
      }
      assignment.status = 'CANCELLED'
      await assignment.save()

    } else if (action === 'request_payment') {
      // Send delivered work to payment: create a PENDING ProjectExpense for the
      // account manager to approve. Salary-based engagements (NOT_REQUIRED) and
      // amount-less engagements have nothing to request.
      if (!isAdmin && !(await isProjectManager())) return Response.json({ error: 'Forbidden' }, { status: 403 })
      if (assignment.status !== 'COMPLETED') {
        return Response.json({ error: 'Only delivered (completed) work can be sent to payment' }, { status: 400 })
      }
      if (assignment.paymentStatus !== 'PENDING') {
        return Response.json({ error: 'Payment request already submitted, settled, or not required' }, { status: 400 })
      }
      if (!assignment.paymentAmount || assignment.paymentAmount <= 0) {
        return Response.json({ error: 'This engagement has no payable amount' }, { status: 400 })
      }
      if ((assignment.currency || 'BDT') !== 'BDT' && !(Number(assignment.amountBDT) > 0)) {
        return Response.json({ error: 'Set the BDT-equivalent amount on this engagement before requesting payment' }, { status: 400 })
      }

      // Claim the assignment atomically so concurrent requests (double-click,
      // two admins) can't both create a payable expense.
      const claimed = await FreelancerAssignment.findOneAndUpdate(
        { _id: id, status: 'COMPLETED', paymentStatus: 'PENDING' },
        { $set: { paymentStatus: 'PAYMENT_REQUESTED' } },
        { new: true },
      )
      if (!claimed) {
        return Response.json({ error: 'Payment request already submitted, settled, or not required' }, { status: 409 })
      }

      const project    = await Project.findById(assignment.projectId).lean()
      const freelancer = await Freelancer.findById(assignment.freelancerId)
        .populate('userId', 'name email')
        .lean()

      const isAgency      = freelancer?.type === 'AGENCY'
      const displayName   = isAgency
        ? (freelancer?.agencyInfo?.agencyName ?? freelancer?.userId?.name ?? 'Unknown')
        : (freelancer?.userId?.name ?? 'Unknown')
      const expenseCategory = isAgency ? 'Agency Payment' : 'Freelancer Payment'

      let expense
      try {
        expense = await ProjectExpense.create({
          projectId:   claimed.projectId,
          origin:      isAgency ? 'AGENCY' : 'FREELANCER',
          venture:     project?.venture ?? null,
          title:       `${expenseCategory} — ${displayName}`,
          amount:      claimed.paymentAmount,
          currency:    claimed.currency ?? 'BDT',
          // BDT engagements: the BDT figure IS the amount (never a stale copy).
          amountBDT:   (claimed.currency ?? 'BDT') === 'BDT' ? claimed.paymentAmount : claimed.amountBDT,
          category:    expenseCategory,
          date:        new Date(),
          notes:       claimed.paymentNotes ?? null,
          freelancerId: claimed.freelancerId,
          ...(isAgency && { agencyId: claimed.freelancerId }),
          paidToName:   displayName,
          submittedBy:  session.user.id,
          status:       'PENDING',
        })
      } catch (e) {
        // Roll back the claim so the request can be retried.
        await FreelancerAssignment.updateOne(
          { _id: id, paymentStatus: 'PAYMENT_REQUESTED', expenseId: null },
          { $set: { paymentStatus: 'PENDING' } },
        )
        throw e
      }

      await FreelancerAssignment.updateOne({ _id: id }, { $set: { expenseId: expense._id } })

    } else if (action === 'edit') {
      if (!isAdmin && !(await isProjectManager())) return Response.json({ error: 'Forbidden' }, { status: 403 })
      const { paymentAmount, currency, amountBDT, paymentNotes, status: newStatus } = body
      // Once payment is requested or settled the amount is frozen on the
      // expense / ledger, so editing it here would make the figures disagree.
      const amountLocked = !['PENDING', 'NOT_REQUIRED'].includes(assignment.paymentStatus)
      const sameNum = (a, b) => (a == null && b == null) || (a != null && b != null && Number(a) === Number(b))
      const changesAmount =
        (paymentAmount !== undefined && !sameNum(paymentAmount, assignment.paymentAmount)) ||
        (currency      !== undefined && (currency || 'BDT') !== (assignment.currency || 'BDT')) ||
        (amountBDT     !== undefined && !sameNum(amountBDT, assignment.amountBDT))
      if (amountLocked && changesAmount) {
        return Response.json({ error: 'The amount cannot be changed after payment has been requested or made' }, { status: 400 })
      }
      if (amountLocked && newStatus === 'CANCELLED' && assignment.status !== 'CANCELLED') {
        return Response.json({ error: 'Use the cancel action to cancel an assignment with a payment request' }, { status: 400 })
      }
      if (paymentAmount !== undefined && paymentAmount !== null && !(Number(paymentAmount) >= 0)) {
        return Response.json({ error: 'Payment amount must be a valid number' }, { status: 400 })
      }
      const nextCurrency = currency !== undefined ? (currency || 'BDT') : (assignment.currency || 'BDT')
      if (nextCurrency !== 'BDT' && changesAmount && !amountLocked) {
        // A foreign-currency amount or currency change must come with a fresh
        // BDT-equivalent, otherwise the stored BDT figure goes stale.
        const amountOrCurrencyChanged =
          (paymentAmount !== undefined && !sameNum(paymentAmount, assignment.paymentAmount)) ||
          (currency !== undefined && nextCurrency !== (assignment.currency || 'BDT'))
        if (amountOrCurrencyChanged && (amountBDT === undefined || amountBDT === null || !(Number(amountBDT) > 0))) {
          return Response.json({ error: 'Enter the BDT-equivalent for a non-BDT amount' }, { status: 400 })
        }
      }
      if (paymentAmount !== undefined) assignment.paymentAmount = paymentAmount === null ? null : Number(paymentAmount)
      if (currency      !== undefined) assignment.currency      = currency || 'BDT'
      if (amountBDT     !== undefined) assignment.amountBDT     = amountBDT === null ? null : Number(amountBDT)
      // For BDT engagements the BDT-equivalent always equals the amount.
      if (!amountLocked && (assignment.currency || 'BDT') === 'BDT') assignment.amountBDT = assignment.paymentAmount
      if (paymentNotes  !== undefined) assignment.paymentNotes  = paymentNotes || null
      if (newStatus     !== undefined) {
        const validStatuses = ['ASSIGNED', 'ACCEPTED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED']
        if (!validStatuses.includes(newStatus)) {
          return Response.json({ error: 'Invalid status' }, { status: 400 })
        }
        assignment.status = newStatus
      }
      await assignment.save()

    } else {
      return Response.json({ error: 'Invalid action' }, { status: 400 })
    }

    const updated = await FreelancerAssignment.findById(id)
      .populate({ path: 'projectId', select: 'name projectCode venture' })
      .populate({
        path: 'freelancerId',
        select: FREELANCER_DISPLAY_FIELDS,
        populate: { path: 'userId', select: 'name email avatar' },
      })
      .lean()

    return Response.json({ data: updated })
  } catch (err) {
    console.error('[freelancer-assignments PATCH]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function DELETE(req, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })
    if (!['SUPER_ADMIN', 'MANAGER'].includes(session.user.role)) {
      return Response.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()
    const { id } = await params
    if (!isValidObjectId(id)) return Response.json({ error: 'Assignment not found' }, { status: 404 })
    const assignment = await FreelancerAssignment.findById(id)
    if (!assignment) return Response.json({ error: 'Assignment not found' }, { status: 404 })

    if (assignment.paymentStatus === 'PAID') {
      return Response.json({ error: 'Cannot delete a settled (paid) assignment' }, { status: 400 })
    }
    // Withdraw any pending payment request so the orphaned expense can't be paid.
    if (!(await withdrawPaymentRequest(assignment, session.user.id, 'Engagement deleted'))) {
      return Response.json({ error: 'The payment for this assignment has already been made' }, { status: 409 })
    }

    await assignment.deleteOne()
    return Response.json({ success: true })
  } catch (err) {
    console.error('[freelancer-assignments DELETE]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
