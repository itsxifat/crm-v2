import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Project, ProjectExpense, ProjectRenewal, Task, Milestone } from '@/models'

// GET /api/projects/:id
export async function GET(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    await connectDB()

    const project = await Project.findById(params.id)
      .populate({ path: 'clientId', populate: { path: 'userId', select: 'name email avatar phone' } })
      .populate('projectManagerId', 'name avatar email')
      .populate('teamMembers', 'name avatar email')

    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const [expenses, renewals, tasks, milestones] = await Promise.all([
      ProjectExpense.find({ projectId: params.id }).sort({ createdAt: -1 })
        .populate('submittedBy', 'name avatar')
        .populate('reviewedBy', 'name'),
      ProjectRenewal.find({ projectId: params.id }).sort({ periodStart: -1 }),
      Task.find({ projectId: params.id }).sort({ createdAt: -1 }),
      Milestone.find({ projectId: params.id }).sort({ dueDate: 1 }),
    ])

    const data = project.toJSON()
    data.profit     = (data.paidAmount ?? 0) - (data.approvedExpenses ?? 0)
    data.dueAmount  = Math.max(0, (data.budget ?? 0) - (data.discount ?? 0) - (data.paidAmount ?? 0))
    data.expenses   = expenses.map(e => e.toJSON())
    data.renewals   = renewals.map(r => r.toJSON())
    data.tasks      = tasks.map(t => t.toJSON())
    data.milestones = milestones.map(m => m.toJSON())

    return NextResponse.json({ data })
  } catch (err) {
    console.error('[GET /api/projects/:id]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/projects/:id
export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!['SUPER_ADMIN','MANAGER'].includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await connectDB()

    const body = await request.json()
    delete body.orderDate                                  // immutable — never update
    if (body.startDate) body.startDate = new Date(body.startDate)
    if (body.deadline)  body.deadline  = new Date(body.deadline)

    const project = await Project.findByIdAndUpdate(params.id, body, { new: true, runValidators: true })
      .populate({ path: 'clientId', populate: { path: 'userId', select: 'name avatar' } })
      .populate('projectManagerId', 'name avatar')

    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const data = project.toJSON()
    data.profit = (data.budget ?? 0) - (data.discount ?? 0) - (data.approvedExpenses ?? 0)
    return NextResponse.json({ data })
  } catch (err) {
    console.error('[PUT /api/projects/:id]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/projects/:id
export async function DELETE(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (session.user.role !== 'SUPER_ADMIN')
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await connectDB()

    const project = await Project.findByIdAndDelete(params.id)
    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await Promise.all([
      ProjectExpense.deleteMany({ projectId: params.id }),
      ProjectRenewal.deleteMany({ projectId: params.id }),
      Task.deleteMany({ projectId: params.id }),
      Milestone.deleteMany({ projectId: params.id }),
    ])
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/projects/:id]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
