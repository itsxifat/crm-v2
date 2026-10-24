export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import { getEncloudSettings } from '@/lib/integrations/settings'
import { verifySignature } from '@/lib/integrations/signature'
import { claimEvent, finishEvent } from '@/lib/integrations/inbox'
import { handleEncloudEvent } from '@/lib/encloud/events'

const PROVIDER = 'ENCLOUD'

// POST /api/webhooks/encloud — encloud's signed events (due.paid, due.updated,
// share.verified, files.added, ping). Set this address in encloud under
// Admin → CRM & API → Events to the CRM. Public (no session): the
// Encloud-Signature over the raw body is the proof. A failure answers 500 and
// encloud sends the event again later (for about two days).
export async function POST(request) {
  let event = null
  try {
    const raw = Buffer.from(await request.arrayBuffer())
    const settings = await getEncloudSettings()
    if (!settings.webhookSecret) {
      return NextResponse.json({ error: 'encloud events are not set up in the CRM' }, { status: 503 })
    }
    if (!verifySignature(raw, request.headers.get('encloud-signature'), settings.webhookSecret)) {
      return NextResponse.json({ error: 'Invalid signature' }, { status: 400 })
    }
    try { event = JSON.parse(raw.toString('utf8')) } catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 }) }
    if (!event?.id || !event?.type) return NextResponse.json({ error: 'Not an event' }, { status: 400 })

    await connectDB()
    if (!(await claimEvent(PROVIDER, event))) return NextResponse.json({ received: true, duplicate: true })

    const outcome = await handleEncloudEvent(event)
    await finishEvent(PROVIDER, event, outcome === 'IGNORED' ? 'IGNORED' : 'PROCESSED')
    return NextResponse.json({ received: true })
  } catch (err) {
    console.error('[POST /api/webhooks/encloud]', err)
    if (event?.id) await finishEvent(PROVIDER, event, 'FAILED', err?.message).catch(() => {})
    return NextResponse.json({ error: 'Could not process the event' }, { status: 500 })
  }
}
