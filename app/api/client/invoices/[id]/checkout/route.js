export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Invoice } from '@/models'
import { getMyCompanyIds } from '@/lib/clientAccess'
import { isValidObjectId } from '@/lib/objectId'
import { getOrCreateLink, payUrl } from '@/lib/paymentLinks'
import { startInvoiceCheckout, PaymentFlowError } from '@/lib/onlinePayments'

// POST /api/client/invoices/:id/checkout — a signed-in client pays an invoice of
// one of their companies online. Opens an Enfinito Pay checkout and answers
// { url }; the customer comes back to the invoice's payment link page.
export async function POST(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || session.user.role !== 'CLIENT') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await connectDB()

    const clientIds = await getMyCompanyIds(session.user.id)
    const invoice = await Invoice.findOne({ _id: params.id, clientId: { $in: clientIds }, status: { $ne: 'DRAFT' } })
      .select('_id clientId status').lean()
    if (!invoice) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const link = await getOrCreateLink(invoice, null)
    const { url } = await startInvoiceCheckout({
      invoiceId: invoice._id,
      link,
      returnUrl: `${payUrl(link.token)}?checkout=return`,
      via:       'CLIENT_PORTAL',
      userId:    session.user.id,
    })
    return NextResponse.json({ url })
  } catch (err) {
    if (err instanceof PaymentFlowError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    console.error('[POST /api/client/invoices/:id/checkout]', err)
    return NextResponse.json({ error: 'Online payment is not available right now. Please try again in a few minutes.' }, { status: 500 })
  }
}
