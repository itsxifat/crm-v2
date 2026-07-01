export const dynamic = 'force-dynamic'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { FreelancerAssignment, Freelancer, Project, ProjectExpense } from '@/models'

export async function PATCH(req, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    await connectDB()

    const { id } = await params
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
      assignment.status = 'CANCELLED'
      await assignment.save()

    } else if (action === 'request_payment') {
      // Send delivered work to payment: create a PENDING ProjectExpense for the
      // account manager to approve. Salary-based engagements (NOT_REQUIRED) and
      // amount-less engagements have nothing to request.
      if (!isAdmin && !(await isProjectManager())) return Response.json({ error: 'Forbidden' }, { status: 403 })
      if (assignment.paymentStatus !== 'PENDING') {
        return Response.json({ error: 'Payment request already submitted, settled, or not required' }, { status: 400 })
      }
      if (!assignment.paymentAmount || assignment.paymentAmount <= 0) {
        return Response.json({ error: 'This engagement has no payable amount' }, { status: 400 })
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

      const expense = await ProjectExpense.create({
        projectId:   assignment.projectId,
        venture:     project?.venture ?? null,
        title:       `${expenseCategory} — ${displayName}`,
        amount:      assignment.paymentAmount,
        currency:    assignment.currency ?? 'BDT',
        amountBDT:   assignment.amountBDT ?? assignment.paymentAmount,
        category:    expenseCategory,
        date:        new Date(),
        notes:       assignment.paymentNotes ?? null,
        freelancerId: assignment.freelancerId,
        paidToName:   displayName,
        submittedBy:  session.user.id,
        status:       'PENDING',
      })

      assignment.paymentStatus = 'PAYMENT_REQUESTED'
      assignment.expenseId     = expense._id
      await assignment.save()

    } else if (action === 'edit') {
      if (!isAdmin && !(await isProjectManager())) return Response.json({ error: 'Forbidden' }, { status: 403 })
      const { paymentAmount, currency, amountBDT, paymentNotes, status: newStatus } = body
      if (paymentAmount !== undefined) assignment.paymentAmount = paymentAmount === null ? null : Number(paymentAmount)
      if (currency      !== undefined) assignment.currency      = currency || 'BDT'
      if (amountBDT     !== undefined) assignment.amountBDT     = amountBDT === null ? null : Number(amountBDT)
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
    const assignment = await FreelancerAssignment.findById(id)
    if (!assignment) return Response.json({ error: 'Assignment not found' }, { status: 404 })

    if (assignment.paymentStatus === 'PAID') {
      return Response.json({ error: 'Cannot delete a settled (paid) assignment' }, { status: 400 })
    }

    await assignment.deleteOne()
    return Response.json({ success: true })
  } catch (err) {
    console.error('[freelancer-assignments DELETE]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
