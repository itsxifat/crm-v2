export const dynamic = 'force-dynamic'
import { PRODUCTS } from '@/lib/products/catalog'
import { productWebhook } from '@/lib/products/webhook'

// POST /api/webhooks/envo — Envo's server talking to the CRM (Envo-Signature).
// The calls and what they do: lib/products/webhook.js, docs/envo.md.
export const POST = productWebhook(PRODUCTS.envo)
