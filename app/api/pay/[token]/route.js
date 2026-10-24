export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { findLinkByToken, publicPaymentView, recordView } from '@/lib/paymentLinks'
import { returnFromCheckout, methodLabel } from '@/lib/onlinePayments'
import { clientIpFromHeaders } from '@/lib/clientIp'
import { hit } from '@/lib/rateLimit'

const NOT_FOUND = { error: 'This payment link is not valid or has been turned off. Please ask us for a new one.' }

// GET /api/pay/:token[?session_id=cs_…] — public: what the customer sees on
// /pay/<token>. With session_id (added by Enfinito Pay on the way back) it also
// reports that checkout's result, asked of Enfinito Pay server to server.
export async function GET(request, { params }) {
  try {
    const ip = clientIpFromHeaders(h => request.headers.get(h)) ?? 'unknown'
    const rl = hit(`pay:view:${ip}`, 120, 60_000)
    if (!rl.ok) return NextResponse.json({ error: 'Too many requests. Please wait a moment.' }, { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } })

    const link = await findLinkByToken(params.token)
    if (!link) return NextResponse.json(NOT_FOUND, { status: 404 })

    const sessionId = new URL(request.url).searchParams.get('session_id')
    let outcome = null
    if (sessionId) {
      const r = await returnFromCheckout({ link, sessionId }).catch(err => {
        console.error('[GET /api/pay/:token] return check failed', err?.message)
        return { status: 'pending', onlinePayment: null }
      })
      if (r) {
        const op = r.onlinePayment
        outcome = {
          status:        r.status,
          amount:        op?.amountPaid ?? op?.amount ?? null,
          method:        methodLabel(op?.method),
          transactionId: op?.transactionId ?? null,
          paidAt:        op?.paidAt ?? null,
        }
      }
    } else {
      recordView(link).catch(() => {})
    }

    const view = await publicPaymentView(link)
    if (!view) return NextResponse.json(NOT_FOUND, { status: 404 })
    return NextResponse.json({ data: view, outcome })
  } catch (err) {
    console.error('[GET /api/pay/:token]', err)
    return NextResponse.json({ error: 'Something went wrong. Please try again.' }, { status: 500 })
  }
}
