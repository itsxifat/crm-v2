/**
 * lib/paymentLinks.js — SERVER-ONLY. Invoice payment links: /pay/<token> opens a
 * page where the customer pays what is still due with Enfinito Pay.
 *
 * One ACTIVE link per invoice ("Create link" returns it again), revocable. The
 * token is 32 random bytes; anyone holding it can see the invoice summary and
 * pay it, nothing else.
 */
import crypto from 'node:crypto'
import connectDB from '@/lib/mongodb'
import { Invoice, PaymentLink, Project, Client, User } from '@/models'
import { appBaseUrl, sendPaymentLinkEmail } from '@/lib/mailer'
import { sendWhatsAppText } from '@/lib/whatsapp'
import { getCompanyProfile } from '@/lib/finance/settings'
import { getPaySettings, payReady } from '@/lib/integrations/settings'
import { amountPayableOnline, notPayableReason } from '@/lib/onlinePayments'
import { clientDisplayName } from '@/lib/encloud/sync'
import { invoiceOutstanding, round2 } from '@/lib/paymentLedger'
import { formatMoney } from '@/lib/currencies'

const TOKEN_RE = /^[A-Za-z0-9_-]{43}$/

export const payUrl = (token) => `${appBaseUrl()}/pay/${token}`

export function linkJson(link) {
  if (!link) return null
  return {
    id:           String(link._id),
    url:          link.token ? payUrl(link.token) : null,
    status:       link.status,
    views:        link.views ?? 0,
    lastViewedAt: link.lastViewedAt ?? null,
    sends:        (link.sends ?? []).slice(-10).reverse(),
    createdAt:    link.createdAt,
  }
}

export async function activeLinkOf(invoiceId) {
  await connectDB()
  return PaymentLink.findOne({ invoiceId, status: 'ACTIVE' }).select('+token').lean()
}

/** The invoice's active link, made if there is none. */
export async function getOrCreateLink(invoice, userId = null) {
  const existing = await activeLinkOf(invoice._id)
  if (existing) return existing
  try {
    const doc = await new PaymentLink({
      token:     crypto.randomBytes(32).toString('base64url'),
      invoiceId: invoice._id,
      clientId:  invoice.clientId?._id ?? invoice.clientId ?? null,
      createdBy: userId,
    }).save()
    return PaymentLink.findById(doc._id).select('+token').lean()
  } catch (err) {
    // Two clicks at once: the other request made it.
    if (err?.code === 11000) return activeLinkOf(invoice._id)
    throw err
  }
}

export async function revokeLink(invoiceId, userId = null) {
  await connectDB()
  return PaymentLink.findOneAndUpdate(
    { invoiceId, status: 'ACTIVE' },
    { $set: { status: 'REVOKED', revokedBy: userId, revokedAt: new Date() } },
    { new: true },
  ).lean()
}

/** An ACTIVE link by its token (null for anything else, including malformed tokens). */
export async function findLinkByToken(token) {
  if (!TOKEN_RE.test(String(token ?? ''))) return null
  await connectDB()
  return PaymentLink.findOne({ token, status: 'ACTIVE' }).select('+token').lean()
}

/** Who the invoice is addressed to: display name, email and phone. */
export async function invoiceContact(invoice) {
  const client = await Client.findById(invoice.clientId?._id ?? invoice.clientId)
    .select('company contactPerson companyEmail companyPhone userId clientCode').lean()
  const user = client?.userId ? await User.findById(client.userId).select('name email phone').lean() : null
  return {
    name:  clientDisplayName(client, user),
    // The person greets better than a company name in "Hi …".
    greet: client?.contactPerson || user?.name || clientDisplayName(client, user),
    email: client?.companyEmail || user?.email || null,
    phone: client?.companyPhone || user?.phone || null,
  }
}

/**
 * What the customer sees on /pay/<token>: the invoice summary and whether (and
 * how much) it can be paid now. No internal ids or notes.
 */
export async function publicPaymentView(link) {
  await connectDB()
  const invoice = await Invoice.findById(link.invoiceId)
    .select('invoiceNumber status currency total paidAmount issueDate dueDate items clientId projectId projectIds')
    .lean()
  if (!invoice) return null
  const pid = invoice.projectId ?? invoice.projectIds?.[0] ?? null
  const [project, contact, company, settings] = await Promise.all([
    pid ? Project.findById(pid).select('name clientId').lean() : null,
    invoiceContact(invoice),
    getCompanyProfile(),
    getPaySettings(),
  ])
  const reason = notPayableReason(invoice)
  const amount = reason ? 0 : await amountPayableOnline(invoice)
  const outstanding = Math.max(0, round2(invoiceOutstanding(invoice)))
  const enabled = payReady(settings)
  return {
    invoice: {
      number:    invoice.invoiceNumber,
      status:    invoice.status,
      currency:  String(invoice.currency || 'BDT').toUpperCase(),
      total:     round2(Number(invoice.total) || 0),
      paid:      round2(Number(invoice.paidAmount) || 0),
      due:       outstanding,
      issueDate: invoice.issueDate ?? null,
      dueDate:   invoice.dueDate ?? null,
      items:     (Array.isArray(invoice.items) ? invoice.items : []).slice(0, 50).map(i => ({
        description: String(i?.description ?? '').slice(0, 300),
        quantity:    Number(i?.quantity) || null,
        amount:      round2(Number(i?.lineTotal ?? i?.amount) || 0),
      })),
    },
    project:  project && String(project.clientId) === String(invoice.clientId) ? { name: project.name } : null,
    client:   { name: contact.name },
    company:  { name: company.name || 'Enfinito', email: company.email || null, phone: company.phone || null, website: company.website || null },
    payment: {
      enabled,
      payable:  enabled && !reason && amount > 0,
      amount,
      // Part of the balance is waiting for confirmation (a transfer the customer reported).
      pending:  !reason && amount < outstanding - 0.005 ? round2(outstanding - amount) : 0,
      reason:   !enabled ? 'Online payment is not available right now. Please contact us to pay.' : reason,
      testMode: enabled && String(settings.secretKey).startsWith('sk_test_'),
    },
  }
}

export async function recordView(link) {
  await PaymentLink.updateOne({ _id: link._id }, { $inc: { views: 1 }, $set: { lastViewedAt: new Date() } })
}

// ─── Sending ──────────────────────────────────────────────────────────────────

/** WhatsApp wants international digits: 01XXXXXXXXX → 8801XXXXXXXXX. */
export function whatsappNumber(phone) {
  const digits = String(phone ?? '').replace(/\D/g, '')
  if (/^01[3-9]\d{8}$/.test(digits)) return `88${digits}`
  if (/^1[3-9]\d{8}$/.test(digits)) return `880${digits}`
  return digits.length >= 8 ? digits : null
}

export function whatsappMessage({ name, invoiceNumber, amountText, link, note }) {
  return [
    `Hi ${name || 'there'},`,
    '',
    `Here is the link to pay invoice ${invoiceNumber} (${amountText} due) online with bKash, Nagad, card or net banking:`,
    link,
    ...(note ? ['', note] : []),
    '',
    'Thank you!',
  ].join('\n')
}

/**
 * Sends the invoice's link by email or WhatsApp and notes it on the link.
 * @returns {Promise<{ to: string }>}
 */
export async function sendLink({ link, invoice, channel, to, note = null, userId = null }) {
  const contact = await invoiceContact(invoice)
  const amount = round2(Math.max(0, invoiceOutstanding(invoice)))
  const args = {
    name:          contact.greet,
    invoiceNumber: invoice.invoiceNumber,
    amountText:    formatMoney(amount, String(invoice.currency || 'BDT').toUpperCase()),
    link:          payUrl(link.token),
    note:          note ? String(note).trim().slice(0, 1000) : null,
  }
  let recipient
  if (channel === 'EMAIL') {
    recipient = String(to || contact.email || '').trim().toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
      throw Object.assign(new Error('Enter the email address to send the link to'), { status: 422 })
    }
    await sendPaymentLinkEmail({ to: recipient, ...args, dueDate: invoice.dueDate })
  } else {
    recipient = whatsappNumber(to || contact.phone)
    if (!recipient) throw Object.assign(new Error('Enter the WhatsApp number to send the link to'), { status: 422 })
    const sent = await sendWhatsAppText({ to: recipient, message: whatsappMessage(args), purpose: 'invoice' })
    if (!sent) throw Object.assign(new Error('No WhatsApp account is set up. Add one in Configuration → WhatsApp, or copy the link.'), { status: 409 })
  }
  await PaymentLink.updateOne({ _id: link._id }, { $push: { sends: { channel, to: recipient, at: new Date(), by: userId } } })
  return { to: recipient }
}
