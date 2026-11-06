export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import { getEnvoSettings, getPaySettings } from '@/lib/integrations/settings'
import { verifySignature } from '@/lib/integrations/signature'
import { envoPolicy, ensureEnvoProduct } from '@/lib/envo/policy'
import { syncBatch } from '@/lib/envo/sync'
import { reconcilePage, saveReconcileReport } from '@/lib/envo/reconcile'

const MAX_BATCH = 100
const MAX_PAGE = 1000
const MAX_BODY_BYTES = 4 * 1024 * 1024

const fail = (error, status, extra = {}) => NextResponse.json({ error, ...extra }, { status })

// POST /api/webhooks/envo — Envo's server talking to the CRM. Public (no session):
// the Envo-Signature over the raw body is the proof, with the secret from
// Configuration → Integrations → Envo. Every call says what it wants in `type`:
//   ping                                   the connection works
//   policy                                 tax settings to bill with
//   invoices.sync  { items: [...] }        make the CRM match these invoices (lib/envo/sync.js)
//   reconcile.page { fromId, toId, items } compare a range of invoices (lib/envo/reconcile.js)
//   reconcile.report { ... }               keep the result for the settings screen
// A failure answers 5xx and Envo sends it again; repeating any of these is harmless.
export async function POST(request) {
  try {
    if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) return fail('Too large', 413)
    const raw = Buffer.from(await request.arrayBuffer())
    if (raw.length > MAX_BODY_BYTES) return fail('Too large', 413)
    const settings = await getEnvoSettings()
    if (!settings.webhookSecret) return fail('Envo is not set up in the CRM', 503)
    if (!verifySignature(raw, request.headers.get('envo-signature'), settings.webhookSecret)) return fail('Invalid signature', 401)
    if (!settings.enabled) return fail('The Envo connection is turned off in the CRM', 503, { code: 'OFF' })

    let body
    try { body = JSON.parse(raw.toString('utf8')) } catch { return fail('Invalid JSON', 400) }

    await connectDB()
    switch (body?.type) {
      case 'ping':
        return NextResponse.json({ ok: true })

      case 'policy':
        await ensureEnvoProduct()
        return NextResponse.json({ policy: await envoPolicy(settings) })

      case 'invoices.sync': {
        const items = Array.isArray(body.items) ? body.items : null
        if (!items) return fail('items is required', 400)
        if (items.length > MAX_BATCH) return fail(`At most ${MAX_BATCH} invoices per call`, 413)
        await ensureEnvoProduct()
        // Without its own account, Envo's online money goes where Enfinito Pay's already does.
        const pay = settings.onlineAccountId ? null : await getPaySettings()
        const results = await syncBatch(items, { ...settings, onlineAccountId: settings.onlineAccountId || pay?.accountId || null })
        return NextResponse.json({ results, policyVersion: (await envoPolicy(settings)).version })
      }

      case 'reconcile.page': {
        const { fromId, toId, items } = body
        if (!Number.isInteger(fromId) || !Number.isInteger(toId) || !Array.isArray(items)) return fail('fromId, toId and items are required', 400)
        if (items.length > MAX_PAGE) return fail(`At most ${MAX_PAGE} invoices per page`, 413)
        return NextResponse.json(await reconcilePage({ fromId, toId, items }))
      }

      case 'reconcile.report':
        await saveReconcileReport(body.report ?? {})
        return NextResponse.json({ ok: true })

      default:
        return fail('Unknown type', 400)
    }
  } catch (err) {
    console.error('[POST /api/webhooks/envo]', err)
    return fail('Could not process the request', 500)
  }
}
