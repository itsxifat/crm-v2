export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Invoice } from '@/models'
import { requirePerm } from '@/lib/rbac'
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
    await connectDB()

    const { status, paidAmount } = await request.json()
    const invoice = await Invoice.findById(params.id)
    if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (status === 'PAID')
      return NextResponse.json({ error: 'Invoice cannot be manually marked as paid. Payment must be confirmed by an account manager via Payment Confirmations.' }, { status: 403 })

    const allowed = TRANSITIONS[invoice.status] ?? []
    if (!allowed.includes(status))
      return NextResponse.json({ error: `Cannot transition from ${invoice.status} to ${status}` }, { status: 422 })

    invoice.status = status
    if (status === 'SENT' && !invoice.sentAt) invoice.sentAt = new Date()
    if (status === 'PARTIALLY_PAID' && paidAmount) invoice.paidAmount = Number(paidAmount)

    await invoice.save()

    // Issuing an invoice can push its project over the "needs a combined
    // invoice" line — make sure one exists.
    const projectId = invoice.projectId ?? invoice.projectIds?.[0] ?? null
    if (projectId) {
      try { await ensureCombinedInvoice(projectId, { createdBy: session.user.id }) }
      catch (e) { console.error('[PATCH /api/invoices/:id/status] ensureCombinedInvoice', e) }
    }

    return NextResponse.json({ data: invoice.toJSON() })
  } catch (err) {
    console.error('[PATCH /api/invoices/:id/status]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
