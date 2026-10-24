export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Invoice } from '@/models'
import { requirePerm, canDo } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { maskEmail, maskPhone } from '@/lib/pii'
import { getPaySettings, payReady, keyMode } from '@/lib/integrations/settings'
import { activeLinkOf, getOrCreateLink, revokeLink, linkJson, invoiceContact } from '@/lib/paymentLinks'
import { amountPayableOnline, notPayableReason, onlinePaymentsOf } from '@/lib/onlinePayments'

const fail = (error, status) => NextResponse.json({ error }, { status })

async function load(id) {
  if (!isValidObjectId(id)) return null
  await connectDB()
  return Invoice.findById(id).select('invoiceNumber status currency total paidAmount dueDate clientId').lean()
}

// GET /api/invoices/:id/payment-link — the invoice's online payment state:
// whether Enfinito Pay is set up, the active payment link, what it would charge
// now, the payments taken online, and the client's contact for sending it.
export async function GET(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'sales.invoices.view')
    if (denied) return denied
    const invoice = await load(params.id)
    if (!invoice) return fail('Invoice not found', 404)

    const settings = await getPaySettings()
    const reason = notPayableReason(invoice)
    const [link, amount, payments, contact] = await Promise.all([
      activeLinkOf(invoice._id),
      reason ? 0 : amountPayableOnline(invoice),
      onlinePaymentsOf(invoice._id),
      invoiceContact(invoice),
    ])
    const seeContact = canDo(session, 'pii.contact.view')
    return NextResponse.json({
      data: {
        enabled:   payReady(settings),
        mode:      keyMode(settings.secretKey),
        accountSet: !!settings.accountId,
        payable:   !reason && amount > 0,
        reason,
        amount,
        link:      linkJson(link),
        payments,
        contact:   {
          name:  contact.greet,
          email: contact.email ? (seeContact ? contact.email : maskEmail(contact.email)) : null,
          phone: contact.phone ? (seeContact ? contact.phone : maskPhone(contact.phone)) : null,
          masked: !seeContact,
        },
      },
    })
  } catch (err) {
    console.error('[GET /api/invoices/:id/payment-link]', err)
    return fail('Internal server error', 500)
  }
}

// POST /api/invoices/:id/payment-link — the invoice's active link (made if none).
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'sales.invoices.send')
    if (denied) return denied
    const invoice = await load(params.id)
    if (!invoice) return fail('Invoice not found', 404)
    if (!payReady(await getPaySettings())) return fail('Set up Enfinito Pay in Configuration → Integrations first', 409)
    const reason = notPayableReason(invoice)
    if (reason) return fail(reason, 409)

    const before = await activeLinkOf(invoice._id)
    const link = await getOrCreateLink(invoice, session.user.id)
    if (!before) {
      logActivity({
        userId: session.user.id, userRole: session.user.role, action: 'CREATE', entity: 'PAYMENT_LINK',
        entityId: String(link._id), changes: JSON.stringify({ invoiceId: String(invoice._id), invoiceNumber: invoice.invoiceNumber }), request,
      })
    }
    return NextResponse.json({ data: linkJson(link) }, { status: before ? 200 : 201 })
  } catch (err) {
    console.error('[POST /api/invoices/:id/payment-link]', err)
    return fail('Internal server error', 500)
  }
}

// DELETE /api/invoices/:id/payment-link — turns the active link off (it stops working at once).
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'sales.invoices.send')
    if (denied) return denied
    const invoice = await load(params.id)
    if (!invoice) return fail('Invoice not found', 404)

    const link = await revokeLink(invoice._id, session.user.id)
    if (!link) return fail('This invoice has no active payment link', 404)
    logActivity({
      userId: session.user.id, userRole: session.user.role, action: 'CANCEL', entity: 'PAYMENT_LINK',
      entityId: String(link._id), changes: JSON.stringify({ invoiceId: String(invoice._id), invoiceNumber: invoice.invoiceNumber }), request,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[DELETE /api/invoices/:id/payment-link]', err)
    return fail('Internal server error', 500)
  }
}
