export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Payment } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'

// GET /api/invoices/[id]/payments — legacy Payment rows for this invoice
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'sales.invoices.view')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()

    const payments = await Payment.find({ invoiceId: params.id }).sort({ createdAt: -1 })
    return NextResponse.json({ data: payments })
  } catch (err) {
    console.error('[GET /api/invoices/[id]/payments]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/invoices/[id]/payments — RETIRED.
// This used to mark the invoice paid and book INCOME + project credit directly,
// bypassing Payment Confirmations (double-counting income when both paths were
// used, reviving cancelled invoices and over-crediting on overpayment). All
// invoice payments now go through the single ProjectPayment flow:
//   POST /api/invoices/:id/payment-request  → confirmed in Payment Confirmations.
export async function POST() {
  const session = await getServerSession(authOptions)
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  return NextResponse.json({
    error: 'Direct invoice payments are no longer supported. Record the payment with POST /api/invoices/:id/payment-request; it is applied once confirmed in Payment Confirmations.',
  }, { status: 410 })
}
