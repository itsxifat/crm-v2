export const dynamic = 'force-dynamic'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { FreelancerAssignment, Freelancer, Project, User } from '@/models'
import { createNotification } from '@/lib/createNotification'
import { requireStaff } from '@/lib/rbac'
import { BASE_CURRENCY } from '@/lib/currencies'

export async function GET(req) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    await connectDB()

    const { searchParams } = new URL(req.url)
    const projectId    = searchParams.get('projectId')
    const freelancerId = searchParams.get('freelancerId')

    const filter = {}
    if (projectId)    filter.projectId    = projectId
    if (freelancerId) filter.freelancerId = freelancerId

    // FREELANCER → scoped to self. Everyone else must be staff (otherwise a
    // client/vendor could read every assignment and its payment amount).
    if (session.user.role === 'FREELANCER') {
      const freelancer = await Freelancer.findOne({ userId: session.user.id })
      if (!freelancer) return Response.json({ error: 'Freelancer profile not found' }, { status: 404 })
      filter.freelancerId = freelancer._id
    } else {
      const denied = requireStaff(session)
      if (denied) return denied
    }

    const assignments = await FreelancerAssignment.find(filter)
      .populate({ path: 'projectId', select: 'name projectCode venture' })
      .populate({
        path: 'freelancerId',
        populate: { path: 'userId', select: 'name email avatar' },
      })
      .populate({ path: 'assignedBy', select: 'name email' })
      .populate({ path: 'approvedBy', select: 'name email' })
      .sort({ createdAt: -1 })
      .lean()

    return Response.json({ data: assignments })
  } catch (err) {
    console.error('[freelancer-assignments GET]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}

export async function POST(req) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return Response.json({ error: 'Unauthorized' }, { status: 401 })

    await connectDB()

    const body = await req.json()
    const { projectId, freelancerId, paymentAmount, paymentNotes, currency, amountBDT } = body

    // SUPER_ADMIN and MANAGER can always assign; EMPLOYEE only if they are the project manager
    if (!['SUPER_ADMIN', 'MANAGER'].includes(session.user.role)) {
      if (session.user.role !== 'EMPLOYEE') return Response.json({ error: 'Forbidden' }, { status: 403 })
      const project = await Project.findById(projectId).lean()
      if (!project) return Response.json({ error: 'Project not found' }, { status: 404 })
      const pmId = project.projectManagerId?.toString()
      if (pmId !== session.user.id) return Response.json({ error: 'Forbidden — only the project manager can assign freelancers' }, { status: 403 })
    }

    if (!projectId || !freelancerId) {
      return Response.json({ error: 'projectId and freelancerId are required' }, { status: 400 })
    }

    const freelancer = await Freelancer.findById(freelancerId).populate('userId', 'name').lean()
    if (!freelancer) return Response.json({ error: 'Freelancer not found' }, { status: 404 })
    const isSalary = freelancer.employmentMode === 'SALARY'

    const assignmentData = {
      projectId,
      freelancerId,
      assignedBy: session.user.id,
      paymentNotes: paymentNotes || null,
    }

    if (isSalary) {
      // Salary-based hire: the engagement carries no per-work payment — their
      // recurring salary covers it.
      assignmentData.paymentAmount = null
      assignmentData.paymentStatus = 'NOT_REQUIRED'
    } else {
      if (!paymentAmount) {
        return Response.json({ error: 'paymentAmount is required for a project-based freelancer' }, { status: 400 })
      }
      const cur = currency || freelancer.paymentCurrency || BASE_CURRENCY
      if (cur !== BASE_CURRENCY && !amountBDT) {
        return Response.json({ error: 'Enter the BDT-equivalent for a non-BDT engagement amount' }, { status: 400 })
      }
      assignmentData.paymentAmount = Number(paymentAmount)
      assignmentData.currency      = cur
      assignmentData.amountBDT     = cur === BASE_CURRENCY ? Number(paymentAmount) : Number(amountBDT)
    }

    const assignment = await FreelancerAssignment.create(assignmentData)

    // Notify the freelancer so the engagement surfaces for them to accept.
    if (freelancer.userId?._id) {
      createNotification({
        userId:  freelancer.userId._id.toString(),
        title:   'New engagement',
        message: `You've been assigned to a project. Review and accept it.`,
        type:    'TASK',
        link:    '/freelancer',
      }).catch(() => {})
    }

    const populated = await FreelancerAssignment.findById(assignment._id)
      .populate({ path: 'projectId', select: 'name projectCode venture' })
      .populate({
        path: 'freelancerId',
        populate: { path: 'userId', select: 'name email avatar' },
      })
      .lean()

    return Response.json({ data: populated }, { status: 201 })
  } catch (err) {
    console.error('[freelancer-assignments POST]', err)
    return Response.json({ error: err.message }, { status: 500 })
  }
}
