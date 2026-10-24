/**
 * lib/onlinePayments.js — SERVER-ONLY. Payments taken online with Enfinito Pay.
 *
 * Money arrives two ways:
 *   CRM     — the CRM's own checkout, opened from a payment link (/pay/<token>)
 *             or the client portal. Only Enfinito Pay's answer (the signed
 *             webhook, or the checkout retrieved server to server) settles it;
 *             the browser coming back proves nothing.
 *   ENCLOUD — the customer paid on an encloud link and encloud reported the paid
 *             due (lib/encloud/events.js).
 *
 * Either way it is booked like any confirmed client payment: a ProjectPayment
 * settled by settleInvoicePayment() into the money account chosen for online
 * payments, so the invoice, project, ledger and VAT split come out exactly as for
 * a bank receipt. When that cannot happen automatically (no account chosen, books
 * locked, more than is still due, a test payment) it waits in Payment
 * Confirmations and finance is told why.
 */
import connectDB from '@/lib/mongodb'
import { Invoice, Project, Client, User, ProjectPayment, OnlinePayment, Transaction } from '@/models'
import { createCheckout, retrieveCheckout, bdMobile, EnfinitoPayError } from '@/lib/enfinitoPay'
import { getPaySettings, getEncloudSettings, keyMode, payReady } from '@/lib/integrations/settings'
import {
  PAYABLE_INVOICE_STATUSES, invoiceOutstanding, pendingPaymentTotal, round2, invoiceLabel,
  loadPostingAccount, preflightPosting, settleInvoicePayment, settlementDescription,
} from '@/lib/paymentLedger'
import { createNotification } from '@/lib/createNotification'
import { inventoryManagerUserIds } from '@/app/api/my-assets/_lib/shared'
import { clientDisplayName, syncSoon } from '@/lib/encloud/sync'
import { formatMoney } from '@/lib/currencies'
import { dhakaDayKey } from '@/lib/dhakaTime'

/** ProjectPayment / Transaction paymentMethod of online payments. */
export const ONLINE_PAYMENT_METHOD = 'ENFINITO_PAY'

// A visitor who comes back within this window is sent to the checkout they already opened.
const REUSE_MINUTES = 45

export class PaymentFlowError extends Error {
  constructor(message, status = 409, code = null) {
    super(message)
    this.status = status
    this.code = code
  }
}

const METHOD_LABELS = {
  bkash: 'bKash', nagad: 'Nagad', rocket: 'Rocket', upay: 'Upay', 'ok-wallet': 'OK Wallet', mcash: 'mCash',
  'islamic-wallet': 'Islamic Wallet', tap: 'Tap', 'st-pay': 'ST Pay', gpay: 'GPay', 'pathao-pay': 'Pathao Pay',
  visa: 'Visa', mastercard: 'Mastercard', 'dbbl-nexus': 'DBBL Nexus', amex: 'American Express',
  citytouch: 'CityTouch', cellfin: 'Cellfin', 'premier-net': 'Premier Net', 'ucb-one': 'UCB One', 'pubali-pi': 'Pubali PI',
}

export const methodLabel = (m) => (m ? METHOD_LABELS[m] ?? String(m) : null)

const bdt = (n) => formatMoney(n, 'BDT')
const message = (err) => String(err?.message || err || 'Unknown error').slice(0, 300)

/** Test checkouts move no money. They are booked only when this is set (development). */
const bookTestPayments = () => process.env.ENFINITO_PAY_BOOK_TEST_PAYMENTS === '1'

async function notifyFinance({ title, message: text, link }) {
  const ids = await inventoryManagerUserIds({ perms: ['finance.payments.confirm'] })
  if (ids.length) await createNotification({ userId: ids, title, message: text, type: 'PAYMENT', link })
}

/** The invoice's project, when it belongs to the invoice's client (as for payment requests). */
async function invoiceProject(invoice) {
  const pid = invoice.projectId?._id ?? invoice.projectId ?? invoice.projectIds?.[0]?._id ?? invoice.projectIds?.[0] ?? null
  if (!pid) return null
  const p = await Project.findById(pid).select('name projectCode clientId').lean()
  return p && String(p.clientId) === String(invoice.clientId) ? p : null
}

/**
 * What paying this invoice online would charge now: its balance less money
 * already waiting in Payment Confirmations, so nothing is collected twice.
 */
export async function amountPayableOnline(invoice) {
  const pending = await pendingPaymentTotal({ invoiceId: invoice._id })
  return Math.max(0, round2(invoiceOutstanding(invoice) - pending))
}

/** Why the invoice cannot be paid online right now, or null. */
export function notPayableReason(invoice) {
  if (!invoice) return 'This invoice no longer exists'
  if (invoice.status === 'PAID') return 'This invoice is paid'
  if (invoice.status === 'CANCELLED') return 'This invoice was cancelled'
  if (!PAYABLE_INVOICE_STATUSES.includes(invoice.status)) return 'This invoice has not been issued yet'
  const cur = String(invoice.currency || 'BDT').toUpperCase()
  if (cur !== 'BDT') return `Online payment is in taka only; this invoice is in ${cur}. Please contact us to pay.`
  return null
}

// ─────────────────────────────────────────────────────────────────────────────
// Checkout (source CRM)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Opens an Enfinito Pay checkout for what is still due on the invoice — or sends
 * the visitor back to the one they opened a moment ago.
 *
 * @param {object} p
 * @param {object} p.link       the invoice's PaymentLink (the customer returns to /pay/<token>)
 * @param {string} p.returnUrl  where Enfinito Pay sends the customer back (?session_id= is added)
 * @param {'PAYMENT_LINK'|'CLIENT_PORTAL'} p.via
 * @returns {Promise<{ url: string }>}
 */
export async function startInvoiceCheckout({ invoiceId, link, returnUrl, via, userId = null }) {
  await connectDB()
  const settings = await getPaySettings()
  if (!payReady(settings)) throw new PaymentFlowError('Online payment is not available right now. Please contact us to pay.', 503, 'payments_off')
  const live = keyMode(settings.secretKey) === 'live'

  const invoice = await Invoice.findById(invoiceId).lean()
  const reason = notPayableReason(invoice)
  if (reason) throw new PaymentFlowError(reason, 409, invoice?.status === 'PAID' ? 'paid' : 'not_payable')
  const amount = await amountPayableOnline(invoice)
  if (!(amount > 0)) {
    throw new PaymentFlowError('There is nothing left to pay online: the rest of this invoice is waiting for our confirmation', 409, 'nothing_due')
  }

  // Same link, same amount, still open at Enfinito Pay: send them back to it.
  const recent = await OnlinePayment.findOne({
    invoiceId: invoice._id, source: 'CRM', paymentLinkId: link?._id ?? null, amount,
    status: { $in: ['INITIATED', 'FAILED'] }, checkoutUrl: { $ne: null }, livemode: live,
    createdAt: { $gt: new Date(Date.now() - REUSE_MINUTES * 60_000) },
  }).sort({ createdAt: -1 }).lean()
  if (recent?.checkoutId) {
    const session = await retrieveCheckout(recent.checkoutId).catch(() => null)
    if (session && ['open', 'processing', 'failed'].includes(session.status)) return { url: recent.checkoutUrl }
    if (session && (await settleCheckout(recent._id, session, 'reuse_check')) === 'paid') {
      throw new PaymentFlowError('This invoice was just paid. Thank you!', 409, 'paid')
    }
  }

  const [project, client] = await Promise.all([
    invoiceProject(invoice),
    Client.findById(invoice.clientId).select('company contactPerson companyEmail companyPhone userId clientCode').lean(),
  ])
  const user = client?.userId ? await User.findById(client.userId).select('name email phone').lean() : null
  const outstanding = round2(invoiceOutstanding(invoice))
  const number = invoice.invoiceNumber || String(invoice._id)

  const op = await OnlinePayment.create({
    source: 'CRM', startedVia: via, startedBy: userId,
    invoiceId: invoice._id, clientId: invoice.clientId, projectId: project?._id ?? null, paymentLinkId: link?._id ?? null,
    amount, currency: 'BDT', livemode: live,
  })
  try {
    const session = await createCheckout({
      reference: number.slice(0, 64),
      items: [{ name: `Invoice ${number}${amount < outstanding - 0.005 ? ' (balance)' : ''}`.slice(0, 200), amount }],
      description: (project?.name ? `${project.name}` : clientDisplayName(client, user)).slice(0, 200),
      customer: {
        name:  clientDisplayName(client, user).slice(0, 100),
        email: client?.companyEmail || user?.email || undefined,
        phone: bdMobile(client?.companyPhone) ?? bdMobile(user?.phone),
      },
      success_url: returnUrl,
      cancel_url:  returnUrl,
      metadata: {
        source:            'crm',
        invoice_id:        String(invoice._id),
        invoice_number:    number,
        online_payment_id: String(op._id),
        ...(link?._id ? { payment_link_id: String(link._id) } : {}),
      },
    }, `crm-online-payment-${op._id}`)
    await OnlinePayment.updateOne({ _id: op._id }, {
      $set: {
        checkoutId:  session.id,
        checkoutUrl: session.url,
        expiresAt:   session.expires_at ? new Date(session.expires_at) : null,
        livemode:    !!session.livemode,
      },
    })
    return { url: session.url }
  } catch (err) {
    await OnlinePayment.updateOne({ _id: op._id }, { $set: { status: 'CANCELLED', note: `Checkout not opened: ${message(err)}` } })
    if (err instanceof EnfinitoPayError) {
      console.error(`[online-payments] checkout for ${number} not opened:`, err.message)
      throw new PaymentFlowError('Online payment is not available right now. Please try again in a few minutes.', 502, err.code)
    }
    throw err
  }
}

/**
 * Applies Enfinito Pay's answer about a checkout — from the webhook, the
 * customer's return or the reconcile job; safe to repeat: only the first "paid"
 * books the payment.
 * @returns {Promise<'paid'|'pending'|'failed'|'cancelled'|'expired'|'refunded'|'unknown'>}
 */
export async function settleCheckout(onlinePaymentId, session, via) {
  await connectDB()
  const op = await OnlinePayment.findById(onlinePaymentId).lean()
  if (!op || !session?.id || op.checkoutId !== session.id) return 'unknown'
  const event = { type: session.status, via, at: new Date() }

  if (session.status === 'paid') {
    // Paid is final: book it even if this checkout was given up on here.
    const claimed = await OnlinePayment.findOneAndUpdate(
      { _id: op._id, status: { $nin: ['PAID', 'REFUNDED'] } },
      {
        $set: {
          status:               'PAID',
          amountPaid:           round2(Number(session.amount_total)),
          livemode:             !!session.livemode,
          method:               session.payment?.method ?? null,
          transactionId:        session.payment?.transaction_id ?? null,
          gatewayInvoiceNumber: session.payment?.invoice_number ?? null,
          payerMobile:          session.payment?.payer_mobile ?? null,
          paidAt:               session.payment?.paid_at ? new Date(session.payment.paid_at) : new Date(),
        },
        $push: { events: event },
      },
      { new: true },
    ).lean()
    if (claimed) await bookOnlinePayment(claimed._id)
    return 'paid'
  }

  if (session.status === 'refunded') {
    const refunded = await OnlinePayment.findOneAndUpdate(
      { _id: op._id, status: 'PAID' },
      { $set: { status: 'REFUNDED' }, $push: { events: event } },
      { new: true },
    ).lean()
    if (refunded) {
      const inv = await Invoice.findById(op.invoiceId).select('invoiceNumber').lean()
      await notifyFinance({
        title:   'Online payment refunded',
        message: `Enfinito Pay refunded ${bdt(op.amountPaid ?? op.amount)} paid on ${invoiceLabel(inv)}${op.transactionId ? ` (transaction ${op.transactionId})` : ''}. Reverse the payment in the CRM so the invoice shows it as due again.`,
        link:    `/admin/invoices/${op.invoiceId}`,
      })
    }
    return 'refunded'
  }

  if (session.status === 'expired' || session.status === 'cancelled') {
    await OnlinePayment.updateOne(
      { _id: op._id, status: { $in: ['INITIATED', 'FAILED'] } },
      { $set: { status: session.status === 'expired' ? 'EXPIRED' : 'CANCELLED' }, $push: { events: event } },
    )
    return session.status
  }

  if (session.status === 'failed') {
    // The customer may try again until the checkout expires.
    await OnlinePayment.updateOne({ _id: op._id, status: 'INITIATED' }, { $set: { status: 'FAILED' }, $push: { events: event } })
    return 'failed'
  }
  return 'pending'   // open / processing
}

// ─────────────────────────────────────────────────────────────────────────────
// Booking
// ─────────────────────────────────────────────────────────────────────────────

/** The gateway's transaction id as the ledger Transaction ID, unless another entry already uses it. */
async function usableTxnId(id) {
  const s = String(id ?? '').trim().slice(0, 100)
  if (!s) return null
  return (await Transaction.exists({ txnId: s })) ? null : s
}

/**
 * Books a PAID online payment as a confirmed ProjectPayment. Idempotent: the
 * booking is claimed first, and a payment record made by an earlier attempt is
 * reused rather than created again.
 * @returns {Promise<{ status: 'BOOKED'|'REVIEW', note?: string }|null>} null when there was nothing to do
 */
export async function bookOnlinePayment(onlinePaymentId) {
  await connectDB()
  const op = await OnlinePayment.findOneAndUpdate(
    { _id: onlinePaymentId, status: 'PAID', 'booking.status': 'PENDING' },
    { $set: { 'booking.status': 'BOOKING', 'booking.at': new Date() } },
    { new: true },
  ).lean()
  if (!op) return null

  const paid = round2(op.amountPaid ?? op.amount)
  let invoice = null
  const review = async (note, { notify = true } = {}) => {
    await OnlinePayment.updateOne({ _id: op._id }, { $set: { 'booking.status': 'REVIEW', 'booking.note': note, 'booking.at': new Date() } })
    if (notify) {
      await notifyFinance({
        title:   'Online payment needs a check',
        message: `${bdt(paid)} was paid online${invoice ? ` on ${invoiceLabel(invoice)}` : ''}, but it was not booked automatically: ${note}`,
        link:    op.projectPaymentId || invoice ? `/admin/invoices/${op.invoiceId}` : '/admin/accounts?tab=confirmations',
      })
    }
    return { status: 'REVIEW', note }
  }

  try {
    const [settings, encloudSettings] = await Promise.all([getPaySettings(), getEncloudSettings()])
    invoice = await Invoice.findById(op.invoiceId).lean()
    if (!invoice) return review('the invoice was deleted after the payment. Refund the customer or record the money another way.')

    // The payment record — reuse the one an earlier attempt made.
    let pp = op.projectPaymentId ? await ProjectPayment.findById(op.projectPaymentId).lean() : null
    if (!pp) {
      const project = await invoiceProject(invoice)
      const via = op.source === 'ENCLOUD' ? 'on an encloud link' : op.startedVia === 'CLIENT_PORTAL' ? 'from the client portal' : 'with a payment link'
      pp = (await new ProjectPayment({
        projectId:     project?._id ?? null,
        invoiceId:     invoice._id,
        clientId:      invoice.clientId,
        submittedBy:   op.startedBy ?? null,
        amount:        paid,
        currency:      'BDT',
        amountBDT:     paid,
        paymentMethod: ONLINE_PAYMENT_METHOD,
        channel:       'GATEWAY',
        accountId:     settings.accountId || null,
        paymentDate:   op.paidAt ?? new Date(),
        description:   `Paid online with Enfinito Pay${op.method ? ` (${methodLabel(op.method)})` : ''}`,
        notes:         [
          `Paid ${via}`,
          op.transactionId ? `transaction ${op.transactionId}` : null,
          op.payerMobile ? `wallet ${op.payerMobile}` : null,
          op.livemode === false ? 'TEST payment: no money moved' : null,
        ].filter(Boolean).join(' · '),
        settledAmount: paid,
        status:        'PENDING_CONFIRMATION',
      }).save()).toObject()
      await OnlinePayment.updateOne({ _id: op._id }, { $set: { projectPaymentId: pp._id } })
      op.projectPaymentId = pp._id
    }
    if (pp.status === 'CONFIRMED') {
      await OnlinePayment.updateOne({ _id: op._id }, { $set: { 'booking.status': 'BOOKED', 'booking.note': null, 'booking.at': new Date() } })
      return { status: 'BOOKED' }
    }
    if (pp.status !== 'PENDING_CONFIRMATION') return review(`its payment record is ${String(pp.status).toLowerCase().replace(/_/g, ' ')}.`)

    // Reasons to leave it for finance.
    if (op.source === 'CRM' && Math.abs(paid - round2(op.amount)) >= 0.01) {
      return review(`Enfinito Pay reported ${bdt(paid)} for a checkout of ${bdt(op.amount)}. Check the payment before confirming it.`)
    }
    if (op.livemode === false && !bookTestPayments()) {
      return review('it is a test payment (sk_test_ key), so no money moved. Reject it in Payment Confirmations.', { notify: keyMode(settings.secretKey) === 'live' })
    }
    if (op.source === 'ENCLOUD' && encloudSettings.bookPayments === false) {
      return review('payments made on encloud links are set to wait for confirmation. Confirm it in Payment Confirmations.')
    }
    if (!settings.accountId) {
      return review('no money account is chosen for online payments. Choose one in Configuration → Integrations, then confirm the payment in Payment Confirmations.')
    }
    if (!PAYABLE_INVOICE_STATUSES.includes(invoice.status)) {
      return review(`${invoiceLabel(invoice)} is already ${String(invoice.status).toLowerCase().replace(/_/g, ' ')}. Check whether the customer paid twice and refund them if so.`)
    }
    const outstanding = invoiceOutstanding(invoice)
    if (paid > outstanding + 0.01) {
      return review(`that is more than the ${bdt(outstanding)} still due. Check whether the customer paid twice and refund the difference.`)
    }
    // Booked on the day it was paid, never a future day.
    const paidAt = op.paidAt ? new Date(op.paidAt) : new Date()
    const date = dhakaDayKey(paidAt) > dhakaDayKey(new Date()) ? new Date() : paidAt
    try {
      await loadPostingAccount(settings.accountId, { currency: 'BDT', date })
      await preflightPosting({ date, accountId: settings.accountId, cash: paid })
    } catch (err) {
      return review(`${message(err)}.`)
    }

    // Claim it exactly like Payment Confirmations does.
    const claimed = await ProjectPayment.findOneAndUpdate(
      { _id: pp._id, status: 'PENDING_CONFIRMATION' },
      { $set: { status: 'CONFIRMED', confirmedBy: null, confirmedAt: new Date(), currency: 'BDT', amountBDT: paid, accountId: settings.accountId } },
      { new: true },
    )
    if (!claimed) {
      const now = await ProjectPayment.findById(pp._id).select('status').lean()
      if (now?.status === 'CONFIRMED') {
        await OnlinePayment.updateOne({ _id: op._id }, { $set: { 'booking.status': 'BOOKED', 'booking.at': new Date() } })
        return { status: 'BOOKED' }
      }
      return review('someone handled its payment record meanwhile.', { notify: false })
    }
    const project = claimed.projectId ? await Project.findById(claimed.projectId).select('name projectCode').lean() : null
    try {
      await settleInvoicePayment({
        invoice,
        projectId:      project?._id ?? claimed.projectId ?? null,
        projectPayment: claimed,
        cash:           paid,
        currency:       'BDT',
        cashBDT:        paid,
        date,
        paidAt:         date,
        accountId:      settings.accountId,
        channel:        'GATEWAY',
        userId:         null,
        entry: {
          category:      'Project Revenue',
          description:   settlementDescription({ cash: paid, note: claimed.description, label: project?.name ?? invoice.invoiceNumber }),
          reference:     project?.projectCode ?? invoice.invoiceNumber ?? null,
          clientId:      invoice.clientId ? String(invoice.clientId) : null,
          paymentMethod: ONLINE_PAYMENT_METHOD,
          txnId:         (await usableTxnId(op.transactionId)) || undefined,
          createdBy:     null,
        },
      })
    } catch (err) {
      await ProjectPayment.updateOne(
        { _id: claimed._id, status: 'CONFIRMED', transactionId: null },
        { $set: { status: 'PENDING_CONFIRMATION', confirmedBy: null, confirmedAt: null } },
      )
      return review(`${message(err)}.`)
    }

    await OnlinePayment.updateOne({ _id: op._id }, { $set: { 'booking.status': 'BOOKED', 'booking.note': null, 'booking.at': new Date() } })
    await notifyFinance({
      title:   'Payment received online',
      message: `${bdt(paid)} for ${invoiceLabel(invoice)} was paid with Enfinito Pay${op.method ? ` (${methodLabel(op.method)})` : ''}${op.source === 'ENCLOUD' ? ' on an encloud link' : ''} and booked to the online payments account.`,
      link:    `/admin/invoices/${invoice._id}`,
    })
    // The files in encloud unlock once the invoice is paid.
    syncSoon('invoice', invoice._id)
    return { status: 'BOOKED' }
  } catch (err) {
    // Unexpected: hand it back so the reconcile job tries again.
    await OnlinePayment.updateOne(
      { _id: op._id, 'booking.status': 'BOOKING' },
      { $set: { 'booking.status': 'PENDING', 'booking.note': message(err) } },
    ).catch(() => {})
    throw err
  }
}

/**
 * A customer paid a due on an encloud link (due.paid with paid_via
 * "enfinito_pay"). Recorded once per payment — the due's id plus when it was
 * paid, as a due can be paid again after a refund reopened it — and booked.
 */
export async function recordEncloudPayment({ invoice, due }) {
  await connectDB()
  const project = await invoiceProject(invoice)
  const paidAt = due.paid_at ? new Date(due.paid_at) : new Date()
  const amount = round2(Number(due.amount))
  let op
  try {
    op = await OnlinePayment.create({
      source:       'ENCLOUD',
      startedVia:   'ENCLOUD',
      invoiceId:    invoice._id,
      clientId:     invoice.clientId,
      projectId:    project?._id ?? null,
      amount,
      amountPaid:   amount,
      currency:     'BDT',
      status:       'PAID',
      paidAt,
      externalRef:  `encloud:due:${due.id}:${due.paid_at ?? 'unknown'}`,
      encloudDueId: Number(due.id) || null,
      events:       [{ type: 'due.paid', via: 'encloud', at: new Date() }],
    })
  } catch (err) {
    if (err?.code === 11000) return null   // this payment is already recorded
    throw err
  }
  return bookOnlinePayment(op._id)
}

// ─────────────────────────────────────────────────────────────────────────────
// Return & reconcile
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The customer came back from the checkout with ?session_id=. Only a checkout
 * opened from this very link is looked up, and the answer comes from Enfinito Pay.
 * @returns {Promise<{ status: string, onlinePayment: object }|null>}
 */
export async function returnFromCheckout({ link, sessionId }) {
  if (!link?._id || !/^cs_[A-Za-z0-9_]{6,120}$/.test(String(sessionId ?? ''))) return null
  await connectDB()
  const op = await OnlinePayment.findOne({ checkoutId: sessionId, paymentLinkId: link._id }).lean()
  if (!op) return null
  if (op.status === 'PAID' || op.status === 'REFUNDED') return { status: op.status.toLowerCase(), onlinePayment: op }
  const session = await retrieveCheckout(op.checkoutId).catch(() => null)
  const status = session ? await settleCheckout(op._id, session, 'return') : 'pending'
  return { status, onlinePayment: await OnlinePayment.findById(op._id).lean() }
}

/**
 * Background pass (lib/integrations/worker.js):
 *   - checkouts with no answer yet are asked about directly (a webhook may be lost)
 *   - paid payments not booked yet are booked
 *   - a booking interrupted half-way is handed to finance to check, never redone blindly
 */
export async function reconcileOnlinePayments() {
  await connectDB()
  const now = Date.now()
  let checked = 0

  const settings = await getPaySettings()
  if (payReady(settings)) {
    const open = await OnlinePayment.find({
      source: 'CRM', status: { $in: ['INITIATED', 'FAILED'] }, checkoutId: { $type: 'string' },
      createdAt: { $lt: new Date(now - 2 * 60_000), $gt: new Date(now - 3 * 86_400_000) },
    }).sort({ createdAt: 1 }).limit(25).lean()
    for (const op of open) {
      const session = await retrieveCheckout(op.checkoutId).catch(() => null)
      if (session) await settleCheckout(op._id, session, 'reconcile')
      checked += 1
    }
    // Never answered in three days: give up on it.
    await OnlinePayment.updateMany(
      { source: 'CRM', status: { $in: ['INITIATED', 'FAILED'] }, createdAt: { $lte: new Date(now - 3 * 86_400_000) } },
      { $set: { status: 'EXPIRED', note: 'No answer from Enfinito Pay in three days' } },
    )
  }

  const unbooked = await OnlinePayment.find({ status: 'PAID', 'booking.status': 'PENDING', updatedAt: { $lt: new Date(now - 60_000) } })
    .select('_id').limit(25).lean()
  for (const op of unbooked) {
    await bookOnlinePayment(op._id).catch(err => console.error('[online-payments] booking failed', String(op._id), message(err)))
  }

  const interrupted = await OnlinePayment.find({ 'booking.status': 'BOOKING', 'booking.at': { $lt: new Date(now - 10 * 60_000) } })
    .select('_id invoiceId amount amountPaid').lean()
  for (const op of interrupted) {
    const r = await OnlinePayment.updateOne(
      { _id: op._id, 'booking.status': 'BOOKING' },
      { $set: { 'booking.status': 'REVIEW', 'booking.note': 'Booking was interrupted. Check the invoice and Payment Confirmations before confirming it.' } },
    )
    if (r.modifiedCount) {
      await notifyFinance({
        title:   'Online payment needs a check',
        message: `Booking ${bdt(op.amountPaid ?? op.amount)} paid online was interrupted. Check the invoice and Payment Confirmations before confirming it.`,
        link:    `/admin/invoices/${op.invoiceId}`,
      })
    }
  }
  return { checked, booked: unbooked.length }
}

/** Online payments of an invoice for the admin panel (newest first). */
export async function onlinePaymentsOf(invoiceId) {
  await connectDB()
  const rows = await OnlinePayment.find({ invoiceId, status: { $ne: 'CANCELLED' }, $or: [{ checkoutId: { $type: 'string' } }, { source: 'ENCLOUD' }] })
    .sort({ createdAt: -1 }).limit(50).lean()
  return rows.map(r => ({
    id:            String(r._id),
    source:        r.source,
    startedVia:    r.startedVia,
    amount:        r.amount,
    amountPaid:    r.amountPaid,
    status:        r.status,
    livemode:      r.livemode,
    method:        r.method,
    methodLabel:   methodLabel(r.method),
    transactionId: r.transactionId,
    payerMobile:   r.payerMobile,
    paidAt:        r.paidAt,
    booking:       r.booking ?? null,
    projectPaymentId: r.projectPaymentId ? String(r.projectPaymentId) : null,
    createdAt:     r.createdAt,
  }))
}
