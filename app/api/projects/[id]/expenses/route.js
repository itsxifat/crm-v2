export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Project, ProjectExpense, Freelancer, Vendor, Employee } from '@/models'
import { requireStaff } from '@/lib/rbac'
import { canAccess } from '@/lib/permissions'
import { canAccessProject, canViewProjectFinancials } from '@/lib/projectAccess'
import { isValidObjectId } from '@/lib/objectId'

// GET /api/projects/:id/expenses — internal cost data: staff who can view the
// project AND project financials (same gate as GET /api/projects/:id).
export async function GET(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requireStaff(session)
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!canViewProjectFinancials(session))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await connectDB()

    if (!(await Project.exists({ _id: params.id })))
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!(await canAccessProject(session, params.id)))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const expenses = await ProjectExpense.find({ projectId: params.id })
      .sort({ createdAt: -1 })
      .populate('submittedBy', 'name avatar')
      .populate('reviewedBy', 'name')

    return NextResponse.json({ data: expenses.map(e => e.toJSON()) })
  } catch (err) {
    console.error('[GET expenses]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/projects/:id/expenses — same gate as company/project expenses on
// POST /api/expenses (accounts.addTransaction), plus access to this project.
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requireStaff(session)
    if (denied) return denied
    if (!canAccess(session, 'accounts', 'addTransaction'))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await connectDB()

    const project = await Project.findById(params.id)
    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!(await canAccessProject(session, project)))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body = await request.json()
    const amount = Number(body.amount)
    if (!Number.isFinite(amount) || amount < 0)
      return NextResponse.json({ error: 'Amount must be a non-negative number' }, { status: 422 })

    // Payee references must be well-formed and exist (at most one payee).
    const payeeRefs = [
      ['freelancerId',     Freelancer],
      ['agencyId',         Freelancer],
      ['vendorId',         Vendor],
      ['paidToEmployeeId', Employee],
    ].filter(([key]) => body[key])
    if (payeeRefs.length > 1)
      return NextResponse.json({ error: 'Select a single payee' }, { status: 422 })
    for (const [key, Model] of payeeRefs) {
      if (!isValidObjectId(body[key]) || !(await Model.exists({ _id: body[key] })))
        return NextResponse.json({ error: 'Selected payee not found' }, { status: 422 })
    }

    const expense = await new ProjectExpense({
      projectId:        params.id,
      origin:           'PROJECT',
      venture:          project.venture ?? null,
      title:            body.title,
      amount:           amount,
      category:         body.category,
      subcategory:      body.subcategory ?? null,
      date:             body.date ? new Date(body.date) : new Date(),
      notes:            body.notes ?? null,
      invoiceUrl:       body.invoiceUrl ?? null,
      freelancerId:     body.freelancerId     ?? null,
      agencyId:         body.agencyId         ?? null,
      vendorId:         body.vendorId         ?? null,
      paidToEmployeeId: body.paidToEmployeeId ?? null,
      paidToName:       body.paidToName       ?? null,
      submittedBy:      session.user.id,
      status:           'PENDING',
    }).save()

    return NextResponse.json({ data: expense.toJSON() }, { status: 201 })
  } catch (err) {
    console.error('[POST expenses]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
