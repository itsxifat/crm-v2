export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import { OnlinePayment } from '@/models'
import { getPaySettings } from '@/lib/integrations/settings'
import { verifySignature } from '@/lib/integrations/signature'
import { claimEvent, finishEvent } from '@/lib/integrations/inbox'
import { settleCheckout } from '@/lib/onlinePayments'

const PROVIDER = 'ENFINITO_PAY'

// POST /api/webhooks/enfinito-pay — Enfinito Pay's signed events
// (payment.succeeded / failed / refunded, checkout.expired / cancelled).
// Public (no session): the Enfinito-Signature over the raw body is the proof.
// Any 2xx acknowledges; a failure answers 500 and Enfinito Pay sends it again.
export async function POST(request) {
  let event = null
  try {
    const raw = Buffer.from(await request.arrayBuffer())
    const settings = await getPaySettings()
    if (!settings.webhookSecret) {
      return NextResponse.json({ error: 'Online payment webhooks are not set up' }, { status: 503 })
    }
    if (!verifySignature(raw, request.headers.get('enfinito-signature'), settings.webhookSecret)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
    }
    try { event = JSON.parse(raw.toString('utf8')) } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
    if (!event?.id || !event?.type) return NextResponse.json({ error: 'Not an event' }, { status: 400 })

    await connectDB()
    if (!(await claimEvent(PROVIDER, event))) return NextResponse.json({ received: true, duplicate: true })

    const session = event.data
    const op = session?.id ? await OnlinePayment.findOne({ checkoutId: session.id }).select('_id').lean() : null
    if (!op) {
      // Not a checkout this CRM opened (another product, or one cleared since).
      await finishEvent(PROVIDER, event, 'IGNORED')
      return NextResponse.json({ received: true })
    }
    const outcome = await settleCheckout(op._id, session, 'webhook')
    await finishEvent(PROVIDER, event, 'PROCESSED')
    return NextResponse.json({ received: true, outcome })
  } catch (err) {
    console.error('[POST /api/webhooks/enfinito-pay]', err)
    if (event?.id) await finishEvent(PROVIDER, event, 'FAILED', err?.message).catch(() => {})
    return NextResponse.json({ error: 'Could not process the event' }, { status: 500 })
  }
}
