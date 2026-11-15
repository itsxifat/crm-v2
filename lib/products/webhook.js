/**
 * lib/products/webhook.js — SERVER-ONLY. A product's server talking to the CRM
 * (POST /api/webhooks/envo, POST /api/webhooks/ncom). Public (no session): the
 * <Label>-Signature over the raw body is the proof (Envo-Signature, Ncom-Signature,
 * signed like Enfinito Pay's), with the secret from Configuration → Integrations.
 * Every call says what it wants in `type`:
 *   ping                                   the connection works
 *   policy                                 tax settings to bill with
 *   invoices.sync  { items: [...] }        make the CRM match these invoices (lib/products/sync.js)
 *   reconcile.page { fromId, toId, items } compare a range of invoices (lib/products/reconcile.js)
 *   reconcile.report { ... }               keep the result for the settings screen
 * A failure answers 5xx and the product sends it again; repeating any of these is harmless.
 */
import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import { getPaySettings, getProductSettings } from '@/lib/integrations/settings'
import { verifySignature } from '@/lib/integrations/signature'
import { productPolicy, ensureProduct } from '@/lib/products/policy'
import { syncBatch } from '@/lib/products/sync'
import { reconcilePage, saveReconcileReport } from '@/lib/products/reconcile'

const MAX_BATCH = 100
const MAX_PAGE = 1000
const MAX_BODY_BYTES = 4 * 1024 * 1024

const fail = (error, status, extra = {}) => NextResponse.json({ error, ...extra }, { status })

export function productWebhook(product) {
  const L = product.label
  return async function POST(request) {
    try {
      if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) return fail('Too large', 413)
      const raw = Buffer.from(await request.arrayBuffer())
      if (raw.length > MAX_BODY_BYTES) return fail('Too large', 413)
      const settings = await getProductSettings(product)
      if (!settings.webhookSecret) return fail(`${L} is not set up in the CRM`, 503)
      if (!verifySignature(raw, request.headers.get(product.signatureHeader), settings.webhookSecret)) return fail('Invalid signature', 401)
      if (!settings.enabled) return fail(`The ${L} connection is turned off in the CRM`, 503, { code: 'OFF' })

      let body
      try { body = JSON.parse(raw.toString('utf8')) } catch { return fail('Invalid JSON', 400) }

      await connectDB()
      switch (body?.type) {
        case 'ping':
          return NextResponse.json({ ok: true })

        case 'policy':
          await ensureProduct(product)
          return NextResponse.json({ policy: await productPolicy(product, settings) })

        case 'invoices.sync': {
          const items = Array.isArray(body.items) ? body.items : null
          if (!items) return fail('items is required', 400)
          if (items.length > MAX_BATCH) return fail(`At most ${MAX_BATCH} invoices per call`, 413)
          await ensureProduct(product)
          // Without its own account, the product's online money goes where Enfinito Pay's already does.
          const pay = settings.onlineAccountId ? null : await getPaySettings()
          const results = await syncBatch(product, items, { ...settings, onlineAccountId: settings.onlineAccountId || pay?.accountId || null })
          return NextResponse.json({ results, policyVersion: (await productPolicy(product, settings)).version })
        }

        case 'reconcile.page': {
          const { fromId, toId, items } = body
          if (!Number.isInteger(fromId) || !Number.isInteger(toId) || !Array.isArray(items)) return fail('fromId, toId and items are required', 400)
          if (items.length > MAX_PAGE) return fail(`At most ${MAX_PAGE} invoices per page`, 413)
          return NextResponse.json(await reconcilePage(product, { fromId, toId, items }))
        }

        case 'reconcile.report':
          await saveReconcileReport(product, body.report ?? {})
          return NextResponse.json({ ok: true })

        default:
          return fail('Unknown type', 400)
      }
    } catch (err) {
      console.error(`[POST /api/webhooks/${product.key}]`, err)
      return fail('Could not process the request', 500)
    }
  }
}
