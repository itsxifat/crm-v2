export const dynamic = 'force-dynamic'
import { PRODUCTS } from '@/lib/products/catalog'
import { productWebhook } from '@/lib/products/webhook'

// POST /api/webhooks/ncom — NCOM's server talking to the CRM (Ncom-Signature).
// The calls and what they do: lib/products/webhook.js, docs/ncom.md.
export const POST = productWebhook(PRODUCTS.ncom)
