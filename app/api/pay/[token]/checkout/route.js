export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { findLinkByToken, payUrl } from '@/lib/paymentLinks'
import { startInvoiceCheckout, PaymentFlowError } from '@/lib/onlinePayments'
import { clientIpFromHeaders } from '@/lib/clientIp'
import { hit } from '@/lib/rateLimit'

// POST /api/pay/:token/checkout — public: opens (or reuses) an Enfinito Pay
// checkout for what is still due and answers { url } for the browser to go to.
export async function POST(request, { params }) {
  try {
    const ip = clientIpFromHeaders(h => request.headers.get(h)) ?? 'unknown'
    const rl = hit(`pay:checkout:${ip}`, 20, 10 * 60_000)
    if (!rl.ok) return NextResponse.json({ error: 'Too many attempts. Please wait a few minutes and try again.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })

    const link = await findLinkByToken(params.token)
    if (!link) return NextResponse.json({ error: 'This payment link is not valid or has been turned off.' }, { status: 404 })

    const { url } = await startInvoiceCheckout({
      invoiceId: link.invoiceId,
      link,
      returnUrl: `${payUrl(link.token)}?checkout=return`,
      via:       'PAYMENT_LINK',
    })
    return NextResponse.json({ url })
  } catch (err) {
    if (err instanceof PaymentFlowError) return NextResponse.json({ error: err.message, code: err.code }, { status: err.status })
    console.error('[POST /api/pay/:token/checkout]', err)
    return NextResponse.json({ error: 'Online payment is not available right now. Please try again in a few minutes.' }, { status: 500 })
  }
}
