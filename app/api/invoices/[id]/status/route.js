import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Invoice } from '@/models'

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
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!['SUPER_ADMIN','MANAGER'].includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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
    return NextResponse.json({ data: invoice.toJSON() })
  } catch (err) {
    console.error('[PATCH /api/invoices/:id/status]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
