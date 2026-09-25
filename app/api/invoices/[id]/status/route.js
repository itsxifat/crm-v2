export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Invoice, ProjectPayment } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { ensureCombinedInvoice } from '@/lib/combinedInvoice'

// PAID is intentionally excluded from all manual transitions.
// It is only set automatically when a payment is confirmed via Payment Confirmations.
const TRANSITIONS = {
  DRAFT:          ['SENT', 'CANCELLED'],
  SENT:           ['PARTIALLY_PAID', 'OVERDUE', 'CANCELLED'],
  PARTIALLY_PAID: ['OVERDUE'],
  OVERDUE:        ['PARTIALLY_PAID', 'CANCELLED'],
  PAID:           [],
  CANCELLED:      [],
}

export async function PATCH(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'sales.invoices.update')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await connectDB()

    // paidAmount is deliberately NOT accepted: the paid total only changes
    // through confirmed payments (Payment Confirmations), never by hand.
    const { status } = await request.json()
    const invoice = await Invoice.findById(params.id)
    if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (status === 'PAID')
      return NextResponse.json({ error: 'Invoice cannot be manually marked as paid. Payment must be confirmed by an account manager via Payment Confirmations.' }, { status: 403 })

    const allowed = TRANSITIONS[invoice.status] ?? []
    if (!allowed.includes(status))
      return NextResponse.json({ error: `Cannot transition from ${invoice.status} to ${status}` }, { status: 422 })

    const paid  = Number(invoice.paidAmount) || 0
    const total = Number(invoice.total) || 0

    // PARTIALLY_PAID must reflect money actually recorded against the invoice.
    if (status === 'PARTIALLY_PAID' && !(paid > 0 && paid < total - 0.01))
      return NextResponse.json({ error: 'Invoice can only be marked partially paid once a confirmed payment covers part of it.' }, { status: 422 })

    // Money received (or awaiting confirmation) must not silently disappear from
    // invoice totals: block cancelling until it is refunded / rejected.
    if (status === 'CANCELLED') {
      if (paid > 0)
        return NextResponse.json({ error: 'This invoice has confirmed payments and cannot be cancelled. Record a refund first.' }, { status: 409 })
      const openPayments = await ProjectPayment.countDocuments({
        invoiceId: invoice._id,
        status: { $in: ['PENDING_CONFIRMATION', 'CONFIRMED'] },
      })
      if (openPayments > 0)
        return NextResponse.json({ error: 'This invoice has pending or confirmed payments. Reject or refund them before cancelling.' }, { status: 409 })
    }

    const set = { status }
    if (status === 'SENT' && !invoice.sentAt) set.sentAt = new Date()

    // Conditional on the status we validated against, so two concurrent
    // transitions can't both apply.
    const updated = await Invoice.findOneAndUpdate(
      { _id: invoice._id, status: invoice.status },
      { $set: set },
      { new: true },
    )
    if (!updated)
      return NextResponse.json({ error: 'Invoice status changed in the meantime. Reload and try again.' }, { status: 409 })

    // Issuing an invoice can push its project over the "needs a combined
    // invoice" line — make sure one exists.
    const projectId = invoice.projectId ?? invoice.projectIds?.[0] ?? null
    if (projectId) {
      try { await ensureCombinedInvoice(projectId, { createdBy: session.user.id }) }
      catch (e) { console.error('[PATCH /api/invoices/:id/status] ensureCombinedInvoice', e) }
    }

    return NextResponse.json({ data: updated.toJSON() })
  } catch (err) {
    console.error('[PATCH /api/invoices/:id/status]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
