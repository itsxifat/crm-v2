export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Invoice, InvoiceItem } from '@/models'
import { logActivity } from '@/lib/logActivity'

// POST /api/invoices/[id]/send
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const allowedRoles = ['SUPER_ADMIN', 'MANAGER']
    if (!allowedRoles.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const invoice = await Invoice.findById(params.id)
      .populate({ path: 'clientId', populate: { path: 'userId', select: 'name email' } })

    if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })

    if (invoice.status === 'PAID' || invoice.status === 'CANCELLED') {
      return NextResponse.json({ error: `Cannot send an invoice with status ${invoice.status}` }, { status: 400 })
    }

    const updated = await Invoice.findByIdAndUpdate(
      params.id,
      { status: 'SENT', sentAt: new Date() },
      { new: true }
    )

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'SEND',
      entity:   'INVOICE',
      entityId: params.id,
      changes:  JSON.stringify({ invoiceNumber: invoice.invoiceNumber, status: 'SENT', sentAt: updated.sentAt }),
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
