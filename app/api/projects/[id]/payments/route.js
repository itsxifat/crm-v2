export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Project, ProjectPayment } from '@/models'

// GET /api/projects/:id/payments
export async function GET(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    await connectDB()

    const payments = await ProjectPayment.find({ projectId: params.id })
      .sort({ paymentDate: -1 })
      .populate('submittedBy', 'name avatar')
      .populate('confirmedBy', 'name')

    return NextResponse.json({ data: payments.map(p => p.toJSON()) })
  } catch (err) {
    console.error('[GET /api/projects/:id/payments]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/projects/:id/payments  — record a client payment
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    await connectDB()

    const project = await Project.findById(params.id)
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const body = await request.json()
    const { amount, currency, paymentMethod, paymentDate, description, notes, receiptUrl } = body

    if (!amount || Number(amount) <= 0) {
      return NextResponse.json({ error: 'Amount must be greater than 0' }, { status: 422 })
    }

    const payment = await new ProjectPayment({
      projectId:     params.id,
      clientId:      project.clientId,
      submittedBy:   session.user.id,
      amount:        Number(amount),
      currency:      currency ?? project.currency ?? 'BDT',
      paymentMethod: paymentMethod ?? 'BANK_TRANSFER',
      paymentDate:   paymentDate ? new Date(paymentDate) : new Date(),
      description:   description || null,
      notes:         notes || null,
      receiptUrl:    receiptUrl || null,
      status:        'PENDING_CONFIRMATION',
    }).save()

    await payment.populate('submittedBy', 'name avatar')

    return NextResponse.json({ data: payment.toJSON() }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/projects/:id/payments]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
