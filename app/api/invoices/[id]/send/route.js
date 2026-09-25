export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Invoice } from '@/models'
import { logActivity } from '@/lib/logActivity'
import { requirePerm } from '@/lib/rbac'

// POST /api/invoices/[id]/send
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'sales.invoices.send')
    if (denied) return denied

    await connectDB()

    const invoice = await Invoice.findById(params.id)
      .populate({ path: 'clientId', populate: { path: 'userId', select: 'name email' } })

    if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

    if (invoice.status === 'PAID' || invoice.status === 'CANCELLED') {
      return NextResponse.json({ error: `Cannot send an invoice with status ${invoice.status}` }, { status: 400 })
    }

    // Only a DRAFT moves to SENT. Re-sending a PARTIALLY_PAID / OVERDUE / SENT
    // invoice just stamps sentAt and keeps its payment / overdue state.
    const updated = invoice.status === 'DRAFT'
      ? await Invoice.findOneAndUpdate(
          { _id: params.id, status: 'DRAFT' },
          { $set: { status: 'SENT', sentAt: new Date() } },
          { new: true }
        )
      : await Invoice.findOneAndUpdate(
          { _id: params.id, status: { $nin: ['PAID', 'CANCELLED'] } },
          { $set: { sentAt: new Date() } },
          { new: true }
        )
    if (!updated)
      return NextResponse.json({ error: 'Invoice status changed in the meantime. Reload and try again.' }, { status: 409 })

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'SEND',
      entity:   'INVOICE',
      entityId: params.id,
      changes:  JSON.stringify({ invoiceNumber: invoice.invoiceNumber, status: updated.status, sentAt: updated.sentAt }),
      request,
    })

    return NextResponse.json({
      message: `Invoice ${invoice.invoiceNumber} marked as sent`,
      sentTo:  invoice.clientId?.userId?.email ?? 'unknown',
      data:    updated,
    })
  } catch (err) {
    console.error('[POST /api/invoices/[id]/send]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
