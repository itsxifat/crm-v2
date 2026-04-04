export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { ProjectPayment, Transaction, Invoice, Project } from '@/models'
import { createNotification } from '@/lib/createNotification'

// PATCH /api/project-payments/:pid  — confirm or reject
export async function PATCH(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!['SUPER_ADMIN', 'MANAGER'].includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await connectDB()

    const payment = await ProjectPayment.findById(params.pid).populate('projectId').populate('invoiceId')
    if (!payment) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (payment.status !== 'PENDING_CONFIRMATION')
      return NextResponse.json({ error: 'Payment already processed' }, { status: 409 })

    const { action, rejectionNote, txnId, accountManager } = await request.json()

    if (action === 'confirm') {
      const project = payment.projectId
      const invoiceId = payment.invoiceId?._id ?? payment.invoiceId ?? null
      const tx = await new Transaction({
        type:           'INCOME',
        category:       'Project Revenue',
        amount:         payment.amount,
        currency:       'BDT',
        description:    `Payment received${payment.description ? ': ' + payment.description : ''} — ${project?.name ?? (payment.invoiceId?.invoiceNumber ?? 'Invoice')}`,
        date:           payment.paymentDate,
        reference:      project?.projectCode ?? payment.invoiceId?.invoiceNumber ?? null,
        projectId:      payment.projectId?._id ?? payment.projectId ?? null,
        invoiceId,
        clientId:       payment.clientId?.toString() ?? null,
        paymentMethod:  payment.paymentMethod,
        receiptUrl:     payment.receiptUrl ?? null,
        txnId:          txnId || undefined,
        accountManager: accountManager || session.user.id,
        createdBy:      session.user.id,
      }).save()

      payment.status        = 'CONFIRMED'
      payment.confirmedBy   = session.user.id
      payment.confirmedAt   = new Date()
      payment.transactionId = tx._id
      await payment.save()

      // ── Sync paidAmount on Project (only if linked) ────────────────────────
      if (payment.projectId) {
        await Project.findByIdAndUpdate(
          payment.projectId?._id ?? payment.projectId,
          { $inc: { paidAmount: payment.amount } }
        )
      }

      // ── Auto-update linked invoice ────────────────────────────────────────
      if (payment.invoiceId) {
        const invoice = await Invoice.findById(payment.invoiceId._id ?? payment.invoiceId)
        if (invoice && invoice.status !== 'CANCELLED') {
          const newPaid = Math.min(
            (invoice.paidAmount ?? 0) + payment.amount,
            invoice.total
          )
          invoice.paidAmount = newPaid
          const balance = invoice.total - newPaid
          if (balance <= 0.01) {
            invoice.status = 'PAID'
            if (!invoice.paidAt) invoice.paidAt = new Date()
          } else {
            invoice.status = 'PARTIALLY_PAID'
          }
          await invoice.save()
        }
      }

      // Notify requester
      if (payment.submittedBy && payment.submittedBy.toString() !== session.user.id) {
        await createNotification({
          userId:  payment.submittedBy.toString(),
          title:   'Payment confirmed',
          message: `Your payment of ৳${payment.amount.toLocaleString()} has been confirmed.`,
          type:    'PAYMENT',
          link:    payment.invoiceId ? `/admin/invoices/${payment.invoiceId._id ?? payment.invoiceId}` : '/admin/accounts',
        })
      }

      return NextResponse.json({ data: payment.toJSON() })
    }

    if (action === 'reject') {
      payment.status        = 'REJECTED'
      payment.confirmedBy   = session.user.id
      payment.confirmedAt   = new Date()
      payment.rejectionNote = rejectionNote || null
      await payment.save()

      // Notify requester
      if (payment.submittedBy && payment.submittedBy.toString() !== session.user.id) {
        await createNotification({
          userId:  payment.submittedBy.toString(),
          title:   'Payment rejected',
          message: `Your payment request was rejected.${rejectionNote ? ' Note: ' + rejectionNote : ''}`,
          type:    'PAYMENT',
          link:    '/admin/accounts',
        })
      }

      return NextResponse.json({ data: payment.toJSON() })
    }

    return NextResponse.json({ error: 'Invalid action. Use "confirm" or "reject".' }, { status: 400 })
  } catch (err) {
    console.error('[PATCH /api/project-payments/:pid]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
