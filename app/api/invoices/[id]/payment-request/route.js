import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Invoice, ProjectPayment } from '@/models'

// POST /api/invoices/:id/payment-request
// Records a payment against an invoice — goes to Payment Confirmations for manual approval.
// On confirmation the invoice paidAmount + status are updated automatically.
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    await connectDB()

    const invoice = await Invoice.findById(params.id).populate('projectIds')
    if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

    if (['PAID', 'CANCELLED'].includes(invoice.status))
      return NextResponse.json({ error: `Cannot add payment to a ${invoice.status.toLowerCase()} invoice` }, { status: 409 })

    const body = await request.json()
    const { amount, paymentMethod, paymentDate, description, notes, receiptUrl } = body

    if (!amount || Number(amount) <= 0)
      return NextResponse.json({ error: 'Amount must be greater than 0' }, { status: 422 })

    const balance = invoice.total - (invoice.paidAmount ?? 0)
    if (Number(amount) > balance + 0.01)
      return NextResponse.json({ error: `Amount exceeds outstanding balance of BDT ${balance.toFixed(2)}` }, { status: 422 })

    // Use first linked project (or require one)
    const projectId = invoice.projectIds?.[0]?._id ?? invoice.projectIds?.[0]
    if (!projectId)
      return NextResponse.json({ error: 'Invoice must be linked to a project to record payments' }, { status: 422 })

    const payment = await new ProjectPayment({
      projectId,
      invoiceId:     invoice._id,
      clientId:      invoice.clientId,
      submittedBy:   session.user.id,
      amount:        Number(amount),
      currency:      invoice.currency ?? 'BDT',
      paymentMethod: paymentMethod ?? 'BANK_TRANSFER',
      paymentDate:   paymentDate ? new Date(paymentDate) : new Date(),
      description:   description || `Payment for invoice ${invoice.invoiceNumber}`,
      notes:         notes || null,
      receiptUrl:    receiptUrl || null,
      status:        'PENDING_CONFIRMATION',
    }).save()

    return NextResponse.json({ data: payment.toJSON() }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/invoices/:id/payment-request]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// GET /api/invoices/:id/payment-request — list all payment requests for this invoice
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    await connectDB()

    const payments = await ProjectPayment.find({ invoiceId: params.id })
      .sort({ createdAt: -1 })
      .populate('submittedBy', 'name email')
      .populate('confirmedBy', 'name')
      .lean()

    return NextResponse.json({ data: payments.map(p => ({ ...p, id: p._id.toString() })) })
  } catch (err) {
    console.error('[GET /api/invoices/:id/payment-request]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
