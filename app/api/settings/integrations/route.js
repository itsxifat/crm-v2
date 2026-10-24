export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { MoneyAccount, EncloudLink, OnlinePayment } from '@/models'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { appBaseUrl } from '@/lib/mailer'
import {
  getPaySettings, getEncloudSettings, savePaySettings, saveEncloudSettings,
  maskPaySettings, maskEncloudSettings, enfinitoPayApiBase, keyMode, SECRET_MASK,
} from '@/lib/integrations/settings'
import { z } from 'zod'

const fail = (error, status, extra = {}) => NextResponse.json({ error, ...extra }, { status })
const superAdminOnly = (session) => (!session || session.user.role !== 'SUPER_ADMIN') ? fail('Forbidden', 403) : null

async function payload() {
  await connectDB()
  const [pay, enc, accounts, linkStats, errors, review] = await Promise.all([
    getPaySettings(),
    getEncloudSettings(),
    MoneyAccount.find({ status: 'ACTIVE', currency: 'BDT' }).select('name type').sort({ type: 1, name: 1 }).lean(),
    EncloudLink.aggregate([{ $group: { _id: '$kind', count: { $sum: 1 }, last: { $max: '$syncedAt' } } }]),
    EncloudLink.find({ error: { $ne: null } }).sort({ errorAt: -1 }).limit(5).select('kind refId error errorAt').lean(),
    OnlinePayment.countDocuments({ 'booking.status': 'REVIEW' }),
  ])
  const app = appBaseUrl()
  const byKind = Object.fromEntries(linkStats.map(s => [s._id, s]))
  return {
    pay:     maskPaySettings(pay),
    encloud: maskEncloudSettings(enc),
    urls: {
      app,
      returnDomain:   (() => { try { return new URL(app).host } catch { return app } })(),
      payWebhook:     `${app}/api/webhooks/enfinito-pay`,
      encloudWebhook: `${app}/api/webhooks/encloud`,
    },
    // Not the real Enfinito Pay (ENFINITO_PAY_API_URL points at a stand-in).
    payApiOverride: enfinitoPayApiBase() !== 'https://pay.enfinito.com/api/v1' ? enfinitoPayApiBase() : null,
    canSaveSecrets: (process.env.ENCRYPTION_MASTER_KEY ?? '').length >= 64,
    accounts: accounts.map(a => ({ id: String(a._id), name: a.name, type: a.type })),
    status: {
      encloud: {
        clients:  byKind.CLIENT?.count ?? 0,
        projects: byKind.PROJECT?.count ?? 0,
        dues:     byKind.DUE?.count ?? 0,
        lastSyncedAt: [byKind.CLIENT?.last, byKind.PROJECT?.last, byKind.DUE?.last].filter(Boolean).sort().pop() ?? null,
        errors: errors.map(e => ({ kind: e.kind, refId: String(e.refId), error: e.error, at: e.errorAt })),
        fullSyncRunning: !!globalThis.__encloudFullSync,
      },
      payments: { review },
    },
  }
}

// GET /api/settings/integrations — Enfinito Pay & encloud settings (secrets masked).
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    const denied = superAdminOnly(session)
    if (denied) return denied
    return NextResponse.json({ data: await payload() })
  } catch (err) {
    console.error('[GET /api/settings/integrations]', err)
    return fail('Internal server error', 500)
  }
}

const secret = z.string().trim().max(500)
const paySchema = z.object({
  enabled:       z.boolean().optional(),
  secretKey:     secret.optional(),
  webhookSecret: secret.optional(),
  accountId:     z.string().trim().max(64).nullable().optional(),
}).strict()
const encloudSchema = z.object({
  enabled:       z.boolean().optional(),
  baseUrl:       z.string().trim().max(300).optional(),
  apiKey:        secret.optional(),
  webhookSecret: secret.optional(),
  autoFolders:   z.boolean().optional(),
  lockDues:      z.boolean().optional(),
  lockWhen:      z.enum(['ISSUED', 'OVERDUE']).optional(),
  bookPayments:  z.boolean().optional(),
}).strict()
const bodySchema = z.object({ pay: paySchema.optional(), encloud: encloudSchema.optional() })

const given = (v) => v !== undefined && v !== SECRET_MASK

// PUT /api/settings/integrations — { pay?, encloud? }. A secret sent as the mask keeps the stored one; '' clears it.
export async function PUT(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = superAdminOnly(session)
    if (denied) return denied
    await connectDB()

    let raw
    try { raw = await request.json() } catch { return fail('Invalid JSON body', 400) }
    const parsed = bodySchema.safeParse(raw ?? {})
    if (!parsed.success) return fail('Some settings are not valid', 422, { details: parsed.error.flatten() })
    const { pay, encloud } = parsed.data
    const touchesSecrets = [pay?.secretKey, pay?.webhookSecret, encloud?.apiKey, encloud?.webhookSecret].some(v => given(v) && v)
    if (touchesSecrets && (process.env.ENCRYPTION_MASTER_KEY ?? '').length < 64) {
      return fail('Keys are stored encrypted: set ENCRYPTION_MASTER_KEY on the server first', 409)
    }

    if (pay) {
      if (given(pay.secretKey) && pay.secretKey && !keyMode(pay.secretKey)) {
        return fail('The secret key starts with sk_test_ or sk_live_ (Enfinito Pay admin → your product → API keys)', 422, { field: 'pay.secretKey' })
      }
      if (given(pay.webhookSecret) && pay.webhookSecret && !pay.webhookSecret.startsWith('whsec_')) {
        return fail('The webhook signing secret starts with whsec_', 422, { field: 'pay.webhookSecret' })
      }
      if (pay.accountId) {
        if (!isValidObjectId(pay.accountId)) return fail('Choose a money account', 422, { field: 'pay.accountId' })
        const acc = await MoneyAccount.findOne({ _id: pay.accountId, status: 'ACTIVE' }).select('currency').lean()
        if (!acc) return fail('That money account is not active', 422, { field: 'pay.accountId' })
        if (String(acc.currency || 'BDT').toUpperCase() !== 'BDT') return fail('Online payments are in taka: choose a BDT account', 422, { field: 'pay.accountId' })
      }
      const current = await getPaySettings()
      const nextKey = given(pay.secretKey) ? pay.secretKey : current.secretKey
      if ((pay.enabled ?? current.enabled) && !keyMode(nextKey)) {
        return fail('Add the secret key before turning online payment on', 422, { field: 'pay.secretKey' })
      }
    }

    if (encloud) {
      if (encloud.baseUrl !== undefined) {
        let u = null
        try { u = new URL(encloud.baseUrl) } catch { /* below */ }
        const local = u && /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname)
        if (!u || !(u.protocol === 'https:' || (u.protocol === 'http:' && local))) {
          return fail('Enter encloud’s address, e.g. https://enfinito.cloud', 422, { field: 'encloud.baseUrl' })
        }
        encloud.baseUrl = u.origin
      }
      if (given(encloud.apiKey) && encloud.apiKey && !/^enc_[0-9a-f]{12}_[A-Za-z0-9_-]{20,100}$/.test(encloud.apiKey)) {
        return fail('The API key looks like enc_…_… (encloud → Admin → CRM & API → New API key)', 422, { field: 'encloud.apiKey' })
      }
      if (given(encloud.webhookSecret) && encloud.webhookSecret && !encloud.webhookSecret.startsWith('whsec_')) {
        return fail('The events secret starts with whsec_ (encloud → Admin → CRM & API → Make secret)', 422, { field: 'encloud.webhookSecret' })
      }
      const current = await getEncloudSettings()
      const nextKey = given(encloud.apiKey) ? encloud.apiKey : current.apiKey
      if ((encloud.enabled ?? current.enabled) && !nextKey) {
        return fail('Add the API key before connecting encloud', 422, { field: 'encloud.apiKey' })
      }
    }

    if (pay) await savePaySettings(pay)
    if (encloud) await saveEncloudSettings(encloud)

    const redact = (o) => o && Object.fromEntries(Object.entries(o).map(([k, v]) => [k, /secret|key/i.test(k) && k !== 'accountId' ? (given(v) ? (v ? 'changed' : 'cleared') : 'kept') : v]))
    logActivity({
      userId: session.user.id, userRole: session.user.role, action: 'UPDATE', entity: 'SETTINGS',
      entityId: 'integrations', changes: JSON.stringify({ pay: redact(pay), encloud: redact(encloud) }), request,
    })
    return NextResponse.json({ data: await payload() })
  } catch (err) {
    console.error('[PUT /api/settings/integrations]', err)
    return fail('Internal server error', 500)
  }
}
