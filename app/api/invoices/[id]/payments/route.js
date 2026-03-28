import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Invoice, Payment } from '@/models'
import { z } from 'zod'

const paymentSchema = z.object({
  amount:    z.number().positive(),
  method:    z.enum(['STRIPE', 'PAYPAL', 'BANK_TRANSFER', 'CASH', 'OTHER']),
  reference: z.string().optional().nullable(),
  paidAt:    z.string().optional().nullable(),
  notes:     z.string().optional().nullable(),
})

// GET /api/invoices/[id]/payments
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const payments = await Payment.find({ invoiceId: params.id }).sort({ createdAt: -1 })
    return NextResponse.json({ data: payments })
  } catch (err) {
    console.error('[GET /api/invoices/[id]/payments]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/invoices/[id]/payments
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const allowedRoles = ['SUPER_ADMIN', 'MANAGER']
    if (!allowedRoles.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const body   = await request.json()
    const parsed = paymentSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    const invoice = await Invoice.findById(params.id).lean()
    if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

    const { amount, method, reference, paidAt, notes } = parsed.data

    const payment = await new Payment({
      invoiceId: params.id,
      amount,
      method,
      reference,
      status:  'COMPLETED',
      paidAt:  paidAt ? new Date(paidAt) : new Date(),
      notes,
    }).save()

    const newPaid = (invoice.paidAmount || 0) + amount
    let newStatus = invoice.status
    if (newPaid > 0 && newPaid < invoice.total) newStatus = 'PARTIALLY_PAID'
    // PAID status is only set via Payment Confirmations — never directly here

    await Invoice.findByIdAndUpdate(params.id, { paidAmount: newPaid, status: newStatus })

    return NextResponse.json({ data: payment, invoiceStatus: newStatus, paidAmount: newPaid }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/invoices/[id]/payments]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
