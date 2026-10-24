export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Invoice } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { isMaskedValue } from '@/lib/pii'
import { getPaySettings, payReady } from '@/lib/integrations/settings'
import { getOrCreateLink, sendLink, linkJson, activeLinkOf } from '@/lib/paymentLinks'
import { notPayableReason } from '@/lib/onlinePayments'
import { z } from 'zod'

const bodySchema = z.object({
  channel: z.enum(['EMAIL', 'WHATSAPP']),
  to:      z.string().trim().max(200).optional().nullable(),
  note:    z.string().trim().max(1000).optional().nullable(),
})

// POST /api/invoices/:id/payment-link/send — { channel: 'EMAIL'|'WHATSAPP', to?, note? }
// Sends the invoice's payment link (made if there is none). `to` defaults to
// the client's email / phone.
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'sales.invoices.send')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    await connectDB()

    let raw
    try { raw = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
    const parsed = bodySchema.safeParse(raw ?? {})
    if (!parsed.success) return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    const { channel, note } = parsed.data
    let to = parsed.data.to || null
    // A masked prefill (staff without pii.contact.view) means "the client's own".
    if (to && isMaskedValue(to)) to = null

    const invoice = await Invoice.findById(params.id).select('invoiceNumber status currency total paidAmount dueDate clientId').lean()
    if (!invoice) return NextResponse.json({ error: 'Invoice not found' }, { status: 404 })
    if (!payReady(await getPaySettings())) return NextResponse.json({ error: 'Set up Enfinito Pay in Configuration → Integrations first' }, { status: 409 })
    const reason = notPayableReason(invoice)
    if (reason) return NextResponse.json({ error: reason }, { status: 409 })

    const link = await getOrCreateLink(invoice, session.user.id)
    let sent
    try {
      sent = await sendLink({ link, invoice, channel, to, note, userId: session.user.id })
    } catch (err) {
      if (err?.status) return NextResponse.json({ error: err.message }, { status: err.status })
      console.error('[POST /api/invoices/:id/payment-link/send] sending failed', err)
      return NextResponse.json({ error: `Could not send the ${channel === 'EMAIL' ? 'email' : 'WhatsApp message'}: ${err?.message || 'unknown error'}` }, { status: 502 })
    }

    logActivity({
      userId: session.user.id, userRole: session.user.role, action: 'SEND', entity: 'PAYMENT_LINK',
      entityId: String(link._id),
      changes: JSON.stringify({ invoiceId: String(invoice._id), invoiceNumber: invoice.invoiceNumber, channel, to: sent.to }),
      request,
    })
    return NextResponse.json({ data: linkJson(await activeLinkOf(invoice._id)), sentTo: sent.to })
  } catch (err) {
    console.error('[POST /api/invoices/:id/payment-link/send]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
