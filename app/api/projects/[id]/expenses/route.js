export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Project, ProjectExpense } from '@/models'

// GET /api/projects/:id/expenses
export async function GET(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    await connectDB()

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

// POST /api/projects/:id/expenses
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    await connectDB()

    const project = await Project.findById(params.id)
    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await request.json()
    const expense = await new ProjectExpense({
      projectId:    params.id,
      venture:      project.venture ?? 'ENTECH',
      title:        body.title,
      amount:       body.amount,
      category:     body.category,
      date:         body.date ? new Date(body.date) : new Date(),
      notes:        body.notes ?? null,
      invoiceUrl:   body.invoiceUrl ?? null,
      freelancerId: body.freelancerId ?? null,
      submittedBy:  session.user.id,
      status:       'PENDING',
    }).save()

    return NextResponse.json({ data: expense.toJSON() }, { status: 201 })
  } catch (err) {
    console.error('[POST expenses]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
