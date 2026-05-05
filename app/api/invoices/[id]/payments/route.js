export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Invoice, Payment, Transaction, Project } from '@/models'
import { z } from 'zod'

const paymentSchema = z.object({
  amount:    z.number().positive(),
  method:    z.string().min(1),
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

    const invoice = await Invoice.findById(params.id)
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

    // Update invoice paid amount and status
    const newPaid = Math.min((invoice.paidAmount || 0) + amount, invoice.total)
    const balance = invoice.total - newPaid
    let newStatus = invoice.status
    if (balance <= 0.01) {
      newStatus = 'PAID'
    } else if (newPaid > 0) {
      newStatus = 'PARTIALLY_PAID'
    }
    await Invoice.findByIdAndUpdate(params.id, { paidAmount: newPaid, status: newStatus })

    // Record income in the Transaction ledger so it appears on dashboard & accounts
    const projectId = invoice.projectId ?? null
    await new Transaction({
      type:          'INCOME',
      category:      'Invoice Payment',
      amount,
      currency:      invoice.currency ?? 'BDT',
      description:   `Payment received for invoice ${invoice.invoiceNumber}`,
      date:          paidAt ? new Date(paidAt) : new Date(),
      reference:     reference || invoice.invoiceNumber || null,
      projectId,
      invoiceId:     params.id,
      clientId:      invoice.clientId?.toString() ?? null,
      paymentMethod: method,
      createdBy:     session.user.id,
      accountManager: session.user.id,
    }).save()

    // Sync project received amount so project financials stay accurate
    if (projectId) {
      const proj = await Project.findById(projectId)
      if (proj) {
        proj.paidAmount = (proj.paidAmount ?? 0) + amount
        await proj.save()
      }
    }

    return NextResponse.json({ data: payment, invoiceStatus: newStatus, paidAmount: newPaid }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/invoices/[id]/payments]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
