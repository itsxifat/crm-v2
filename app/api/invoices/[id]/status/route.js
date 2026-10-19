export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Invoice, ProjectPayment, CreditNote } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { maskDoc, INVOICE_PII } from '@/lib/pii'
import { isValidObjectId } from '@/lib/objectId'
import { ensureCombinedInvoice } from '@/lib/combinedInvoice'
import { logActivity } from '@/lib/logActivity'
import { voidInvoiceOutputVat } from '@/lib/tax/invoiceVat'
import { issueDraftInvoice } from '../send/issue'

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
    const body = await request.json().catch(() => null)
    const status = typeof body?.status === 'string' ? body.status : null
    if (!status) return NextResponse.json({ error: 'Status is required' }, { status: 400 })

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
      // Credit / debit notes change the invoice and the VAT return — cancel them first.
      const openNotes = await CreditNote.countDocuments({ invoiceId: invoice._id, status: 'ISSUED' })
      if (openNotes > 0)
        return NextResponse.json({ error: 'This invoice has credit or debit notes. Cancel them before cancelling the invoice.' }, { status: 409 })
    }

    let updated
    let warnings = []

    if (invoice.status === 'DRAFT' && status === 'SENT') {
      // Tax point: issuedAt, party snapshots and the OUTPUT_VAT entry.
      try {
        const issued = await issueDraftInvoice(invoice, { userId: session.user.id, stampSentAt: false })
        updated = issued.invoice
        warnings = issued.warnings
      } catch (err) {
        if (err.status) return NextResponse.json({ error: err.message }, { status: err.status })
        throw err
      }
    } else {
      const set = { status }
      if (status === 'SENT' && !invoice.sentAt) set.sentAt = new Date()

      // Conditional on the status we validated against, so two concurrent
      // transitions can't both apply.
      updated = await Invoice.findOneAndUpdate(
        { _id: invoice._id, status: invoice.status },
        { $set: set },
        { new: true },
      )
      if (!updated)
        return NextResponse.json({ error: 'Invoice status changed in the meantime. Reload and try again.' }, { status: 409 })

      // A cancelled supply carries no output VAT. Voiding is refused when the VAT
      // was already declared in a filed return (or the period is locked) — then
      // the invoice stays as it was and a credit note (Mushak-6.7) is needed.
      if (status === 'CANCELLED') {
        try {
          await voidInvoiceOutputVat(invoice._id, { userId: session.user.id, reason: 'Invoice cancelled' })
        } catch (err) {
          await Invoice.updateOne(
            { _id: invoice._id, status: 'CANCELLED' },
            { $set: { status: invoice.status } },
          ).catch(e => console.error('[PATCH /api/invoices/:id/status] rollback failed', e))
          if (err.status) return NextResponse.json({ error: err.message }, { status: err.status })
          throw err
        }
      }
    }

    // Issuing an invoice can push its project over the "needs a combined
    // invoice" line — make sure one exists.
    const projectId = invoice.projectId ?? invoice.projectIds?.[0] ?? null
    if (projectId) {
      try { await ensureCombinedInvoice(projectId, { createdBy: session.user.id }) }
      catch (e) { console.error('[PATCH /api/invoices/:id/status] ensureCombinedInvoice', e) }
    }

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'STATUS_CHANGE',
      entity:   'INVOICE',
      entityId: params.id,
      changes:  JSON.stringify({
        invoiceNumber: invoice.invoiceNumber,
        status: { from: invoice.status, to: updated.status },
        ...(invoice.status === 'DRAFT' && updated.status === 'SENT' ? { issuedAt: updated.issuedAt } : {}),
      }),
      request,
    })

    // Masked like GET /api/invoices/:id — the buyer snapshot carries the e-TIN.
    return NextResponse.json({
      data: maskDoc(session, updated.toJSON(), INVOICE_PII),
      ...(warnings.length ? { warning: warnings.join(' '), warnings } : {}),
    })
  } catch (err) {
    console.error('[PATCH /api/invoices/:id/status]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
