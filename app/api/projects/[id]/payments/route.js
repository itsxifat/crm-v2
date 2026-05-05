export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Project, ProjectPayment, Transaction, Invoice } from '@/models'

const ADMIN_ROLES = ['SUPER_ADMIN', 'MANAGER']

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
// Admins (SUPER_ADMIN / MANAGER) are auto-confirmed and immediately update the ledger.
// All other roles create a PENDING_CONFIRMATION record for admin review.
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    await connectDB()

    const project = await Project.findById(params.id)
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const body = await request.json()
    const { amount, currency, paymentMethod, paymentDate, description, notes, receiptUrl, invoiceId: bodyInvoiceId } = body

    if (!amount || Number(amount) <= 0) {
      return NextResponse.json({ error: 'Amount must be greater than 0' }, { status: 422 })
    }

    const isAdmin    = ADMIN_ROLES.includes(session.user.role)
    const parsedDate = paymentDate ? new Date(paymentDate) : new Date()
    const parsedAmt  = Number(amount)

    // Auto-resolve the linked invoice for this project if caller did not supply one
    let invoiceId = bodyInvoiceId || null
    let linkedInvoice = null
    if (!invoiceId) {
      linkedInvoice = await Invoice.findOne({
        $or: [{ projectId: params.id }, { projectIds: params.id }],
        status: { $nin: ['CANCELLED'] },
      }).select('_id total paidAmount').lean()
      if (linkedInvoice) invoiceId = linkedInvoice._id.toString()
    } else {
      linkedInvoice = await Invoice.findById(invoiceId).select('_id total paidAmount').lean()
    }

    // Outstanding balance check — prefer invoice balance, fall back to project budget
    if (linkedInvoice) {
      const outstanding = Math.max(0, Number(linkedInvoice.total ?? 0) - Number(linkedInvoice.paidAmount ?? 0))
      if (outstanding > 0.01 && parsedAmt > outstanding + 0.01) {
        return NextResponse.json(
          { error: `Amount exceeds outstanding invoice balance of BDT ${outstanding.toFixed(2)}` },
          { status: 422 }
        )
      }
    } else {
      const budget  = Number(project.budget ?? 0)
      const disc    = Number(project.discount ?? 0)
      const paid    = Number(project.paidAmount ?? 0)
      const outstanding = Math.max(0, budget - disc - paid)
      if (budget > 0 && parsedAmt > outstanding + 0.01) {
        return NextResponse.json(
          { error: `Amount exceeds outstanding project balance of BDT ${outstanding.toFixed(2)}` },
          { status: 422 }
        )
      }
    }

    const paymentData = {
      projectId:     params.id,
      invoiceId:     invoiceId || null,
      clientId:      project.clientId,
      submittedBy:   session.user.id,
      amount:        parsedAmt,
      currency:      currency ?? project.currency ?? 'BDT',
      paymentMethod: paymentMethod ?? 'BANK_TRANSFER',
      paymentDate:   parsedDate,
      description:   description || null,
      notes:         notes || null,
      receiptUrl:    receiptUrl || null,
    }

    if (isAdmin) {
      // Admins confirm immediately — no separate confirmation step required
      const tx = await new Transaction({
        type:           'INCOME',
        category:       'Project Revenue',
        amount:         parsedAmt,
        currency:       currency ?? project.currency ?? 'BDT',
        description:    `Payment received${description ? ': ' + description : ''} — ${project.name ?? project.projectCode}`,
        date:           parsedDate,
        reference:      project.projectCode ?? null,
        projectId:      params.id,
        invoiceId:      invoiceId || null,
        clientId:       project.clientId?.toString() ?? null,
        paymentMethod:  paymentMethod ?? 'BANK_TRANSFER',
        receiptUrl:     receiptUrl || null,
        accountManager: session.user.id,
        createdBy:      session.user.id,
      }).save()

      const payment = await new ProjectPayment({
        ...paymentData,
        status:        'CONFIRMED',
        confirmedBy:   session.user.id,
        confirmedAt:   new Date(),
        transactionId: tx._id,
      }).save()

      project.paidAmount = (project.paidAmount ?? 0) + parsedAmt
      await project.save()

      // Sync linked invoice paidAmount and status
      if (invoiceId) {
        const inv = await Invoice.findById(invoiceId)
        if (inv && !['PAID', 'CANCELLED'].includes(inv.status)) {
          const newPaid = Math.min((inv.paidAmount ?? 0) + parsedAmt, inv.total)
          inv.paidAmount = newPaid
          const bal = inv.total - newPaid
          if (bal <= 0.01) {
            inv.status = 'PAID'
            if (!inv.paidAt) inv.paidAt = new Date(parsedDate)
          } else if (newPaid > 0) {
            inv.status = 'PARTIALLY_PAID'
          }
          await inv.save()
        }
      }

      await payment.populate('submittedBy', 'name avatar')
      return NextResponse.json({ data: payment.toJSON() }, { status: 201 })
    }

    // Non-admin path: pending confirmation
    const payment = await new ProjectPayment({
      ...paymentData,
      status: 'PENDING_CONFIRMATION',
    }).save()

    await payment.populate('submittedBy', 'name avatar')
    return NextResponse.json({ data: payment.toJSON() }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/projects/:id/payments]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
