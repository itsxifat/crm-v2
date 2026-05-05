export const dynamic = 'force-dynamic'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { FreelancerAssignment, Freelancer, Project, User } from '@/models'

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

    // If FREELANCER role, only show their own assignments
    if (session.user.role === 'FREELANCER') {
      const freelancer = await Freelancer.findOne({ userId: session.user.id })
      if (!freelancer) return Response.json({ error: 'Freelancer profile not found' }, { status: 404 })
      filter.freelancerId = freelancer._id
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
    const { projectId, freelancerId, paymentAmount, paymentNotes } = body

    // SUPER_ADMIN and MANAGER can always assign; EMPLOYEE only if they are the project manager
    if (!['SUPER_ADMIN', 'MANAGER'].includes(session.user.role)) {
      if (session.user.role !== 'EMPLOYEE') return Response.json({ error: 'Forbidden' }, { status: 403 })
      const project = await Project.findById(projectId).lean()
      if (!project) return Response.json({ error: 'Project not found' }, { status: 404 })
      const pmId = project.projectManagerId?.toString()
      if (pmId !== session.user.id) return Response.json({ error: 'Forbidden — only the project manager can assign freelancers' }, { status: 403 })
    }

    if (!projectId || !freelancerId || !paymentAmount) {
      return Response.json({ error: 'projectId, freelancerId and paymentAmount are required' }, { status: 400 })
    }

    const assignment = await FreelancerAssignment.create({
      projectId,
      freelancerId,
      assignedBy: session.user.id,
      paymentAmount: Number(paymentAmount),
      paymentNotes: paymentNotes || null,
    })

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
