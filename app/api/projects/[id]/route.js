export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Project, ProjectExpense, ProjectRenewal, Task, Milestone, Employee, Invoice } from '@/models'
import mongoose from 'mongoose'

// Resolve whether the current session user can view project financials.
// SUPER_ADMIN and MANAGER always can. EMPLOYEE requires the customRole
// to have permissions.projects.viewFinancials === true.
async function resolveCanViewFinancials(session) {
  if (['SUPER_ADMIN', 'MANAGER'].includes(session.user.role)) return true
  if (session.user.role !== 'EMPLOYEE') return false
  const emp = await Employee.findOne({ userId: session.user.id })
    .populate({ path: 'customRoleId', select: 'permissions' })
    .lean()
  return emp?.customRoleId?.permissions?.projects?.viewFinancials === true
}

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

    const canViewFinancials = await resolveCanViewFinancials(session)

    const [expenses, renewals, tasks, milestones] = await Promise.all([
      canViewFinancials
        ? ProjectExpense.find({ projectId: params.id }).sort({ createdAt: -1 })
            .populate('submittedBy', 'name avatar')
            .populate('reviewedBy', 'name')
        : Promise.resolve([]),
      ProjectRenewal.find({ projectId: params.id }).sort({ periodStart: -1 }),
      Task.find({ projectId: params.id }).sort({ createdAt: -1 }),
      Milestone.find({ projectId: params.id }).sort({ dueDate: 1 }),
    ])

    const data = project.toJSON()
    data.tasks      = tasks.map(t => t.toJSON())
    data.renewals   = renewals.map(r => r.toJSON())
    data.milestones = milestones.map(m => m.toJSON())

    if (canViewFinancials) {
      data.profit            = (data.paidAmount ?? 0) - (data.approvedExpenses ?? 0)
      data.contractedProfit  = (data.budget ?? 0) - (data.discount ?? 0) - (data.approvedExpenses ?? 0)
      data.dueAmount         = Math.max(0, (data.budget ?? 0) - (data.discount ?? 0) - (data.paidAmount ?? 0))
      data.expenses          = expenses.map(e => e.toJSON())
    } else {
      // Strip all financial fields — never expose pricing to unpermitted users
      delete data.budget
      delete data.discount
      delete data.paidAmount
      delete data.approvedExpenses
      delete data.profit
      delete data.dueAmount
      data.expenses = []
    }

    return NextResponse.json({ data, meta: { canViewFinancials } })
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
    delete body.orderDate  // immutable

    const project = await Project.findById(params.id)
    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Capture pre-update values to detect what changed
    const prevDiscount = Number(project.discount ?? 0)
    const prevDeadline = project.deadline?.toISOString().slice(0, 10) ?? null

    // Apply allowed fields via read-modify-save so encryption hooks fire correctly
    const ALLOWED = ['name','description','clientId','venture','category','subcategory',
      'projectType','projectManagerId','priority','startDate','deadline',
      'budget','discount','currency','tags','status']
    for (const field of ALLOWED) {
      if (body[field] !== undefined) {
        if (field === 'startDate' || field === 'deadline') {
          project[field] = body[field] ? new Date(body[field]) : null
        } else {
          project[field] = body[field]
        }
      }
    }
    await project.save()

    await project.populate([
      { path: 'clientId', populate: { path: 'userId', select: 'name avatar' } },
      { path: 'projectManagerId', select: 'name avatar' },
    ])

    const pid         = new mongoose.Types.ObjectId(params.id)
    const newDiscount = Number(project.discount ?? 0)
    const newDeadline = project.deadline?.toISOString().slice(0, 10) ?? null

    // Sync linked invoice: dueDate on deadline change, discount on discount/budget change
    const discountChanged = newDiscount !== prevDiscount || body.budget !== undefined
    const deadlineChanged = newDeadline !== prevDeadline && newDeadline !== null

    if (discountChanged || deadlineChanged) {
      const inv = await Invoice.findOne({
        $or: [{ projectId: pid }, { projectIds: pid }],
        status: { $nin: ['PAID', 'CANCELLED'] },
      })
      if (inv) {
        if (discountChanged) {
          inv.discount = newDiscount
          inv.total    = Math.max(0, Number(inv.subtotal ?? 0) + Number(inv.taxAmount ?? 0) - newDiscount)
        }
        if (deadlineChanged) {
          inv.dueDate = new Date(project.deadline)
        }
        await inv.save()
      }
    }

    const data = project.toJSON()
    data.profit           = (data.paidAmount ?? 0) - (data.approvedExpenses ?? 0)
    data.contractedProfit = (data.budget ?? 0) - (data.discount ?? 0) - (data.approvedExpenses ?? 0)
    data.dueAmount        = Math.max(0, (data.budget ?? 0) - (data.discount ?? 0) - (data.paidAmount ?? 0))
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
