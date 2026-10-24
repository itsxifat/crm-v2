export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Invoice, EncloudLink } from '@/models'
import { requirePerm, canDoAny } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { getEncloudSettings, encloudReady } from '@/lib/integrations/settings'
import { wantedDue, syncInvoiceDue } from '@/lib/encloud/sync'
import { z } from 'zod'

const fail = (error, status) => NextResponse.json({ error }, { status })
const INVOICE_FIELDS = 'invoiceNumber status currency total paidAmount dueDate clientId projectId projectIds'

async function state(invoice, settings) {
  const link = await EncloudLink.findOne({ kind: 'DUE', refId: invoice._id }).lean()
  const wanted = wantedDue(invoice, { settings, link })
  const remote = link?.remote ?? null
  return {
    enabled:  encloudReady(settings),
    lockDues: settings.lockDues !== false,
    lockWhen: settings.lockWhen === 'OVERDUE' ? 'OVERDUE' : 'ISSUED',
    mode:     link?.mode ?? 'AUTO',
    offReason: link?.offReason ?? null,
    offAt:    link?.offAt ?? null,
    wanted,
    pushed:   link?.pushed ?? null,
    remote,
    // Locked = encloud last said the due is open.
    locked:   remote ? remote.status === 'open' : link?.pushed?.status === 'open',
    syncedAt: link?.syncedAt ?? null,
    error:    link?.error ?? null,
    nextAttemptAt: link?.nextAttemptAt ?? null,
  }
}

// GET /api/invoices/:id/files-lock — does this invoice lock the client's files in encloud?
export async function GET(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'sales.invoices.view')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return fail('Invoice not found', 404)
    await connectDB()
    const invoice = await Invoice.findById(params.id).select(INVOICE_FIELDS).lean()
    if (!invoice) return fail('Invoice not found', 404)
    return NextResponse.json({ data: await state(invoice, await getEncloudSettings()) })
  } catch (err) {
    console.error('[GET /api/invoices/:id/files-lock]', err)
    return fail('Internal server error', 500)
  }
}

const bodySchema = z.object({ action: z.enum(['lock', 'unlock', 'sync']) })

// POST /api/invoices/:id/files-lock — { action }
//   unlock: stop locking the client's files for this invoice (the due is cancelled in encloud)
//   lock:   lock them again while the invoice is unpaid
//   sync:   make encloud match the invoice now (also overrides changes made in encloud)
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return fail('Unauthorised', 401)
    if (!isValidObjectId(params.id)) return fail('Invoice not found', 404)
    let raw
    try { raw = await request.json() } catch { return fail('Invalid JSON body', 400) }
    const parsed = bodySchema.safeParse(raw ?? {})
    if (!parsed.success) return fail('Choose lock, unlock or sync', 422)
    const { action } = parsed.data
    // Giving files away unpaid is a finance decision; re-syncing is not.
    const allowed = action === 'sync'
      ? canDoAny(session, ['finance.payments.confirm', 'sales.invoices.update'])
      : canDoAny(session, ['finance.payments.confirm'])
    if (!allowed) return fail('Forbidden', 403)

    await connectDB()
    const settings = await getEncloudSettings()
    if (!encloudReady(settings)) return fail('Connect encloud in Configuration → Integrations first', 409)
    const invoice = await Invoice.findById(params.id).select(INVOICE_FIELDS).lean()
    if (!invoice) return fail('Invoice not found', 404)

    if (action === 'unlock') {
      await EncloudLink.updateOne(
        { kind: 'DUE', refId: invoice._id },
        { $set: { mode: 'OFF', offReason: `Unlocked by ${session.user.name ?? 'staff'}`, offBy: session.user.id, offAt: new Date() }, $setOnInsert: { kind: 'DUE', refId: invoice._id } },
        { upsert: true },
      )
    } else if (action === 'lock') {
      await EncloudLink.updateOne(
        { kind: 'DUE', refId: invoice._id },
        { $set: { mode: 'AUTO', offReason: null, offBy: null, offAt: null }, $setOnInsert: { kind: 'DUE', refId: invoice._id } },
        { upsert: true },
      )
    }

    let syncError = null
    try {
      await syncInvoiceDue(invoice._id, { force: true, settings })
    } catch (err) {
      syncError = err?.message || 'encloud could not be updated'
    }

    logActivity({
      userId: session.user.id, userRole: session.user.role,
      action: action === 'unlock' ? 'UNLOCK' : action === 'lock' ? 'LOCK' : 'SYNC',
      entity: 'INVOICE_FILES', entityId: String(invoice._id),
      changes: JSON.stringify({ invoiceNumber: invoice.invoiceNumber, action, error: syncError }),
      request,
    })
    const data = await state(invoice, settings)
    if (syncError) return NextResponse.json({ data, error: `Saved, but encloud was not updated yet: ${syncError}. It is retried automatically.` }, { status: 502 })
    return NextResponse.json({ data })
  } catch (err) {
    console.error('[POST /api/invoices/:id/files-lock]', err)
    return fail('Internal server error', 500)
  }
}
