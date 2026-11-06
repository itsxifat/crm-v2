/**
 * lib/envo/sync.js — SERVER-ONLY. Envo's invoices and payments in the books.
 *
 * Envo sells the package, takes the money and pushes the WHOLE state of an invoice
 * whenever it changes (POST /api/webhooks/envo). Each push makes the CRM match that
 * state, so a repeat, a retry after a timeout or a late delivery changes nothing:
 *
 *   unpaid → a DRAFT invoice: not billed yet, no VAT, nothing in the books
 *   void   → that draft CANCELLED (never created if it had not reached the CRM)
 *   paid   → issued (tax point + OUTPUT_VAT on the day it was paid), and each payment
 *            booked by settleInvoicePayment like any confirmed client payment,
 *            so the ledger, the VAT split and the reports come out as for a bank receipt
 *
 * Nothing can land twice: Client, Invoice and ProjectPayment carry a unique envoId
 * and every ledger row a fixed Transaction ID (ENVOP<id> income, ENVOF<id> fee), all
 * enforced by unique indexes. EnvoSync's lease keeps two pushes of one invoice apart.
 *
 * Money that cannot be booked automatically (books locked, no money account, paid
 * twice…) waits in Payment Confirmations and finance is told why, as for Enfinito
 * Pay. Envo keeps retrying, so fixing the cause is enough.
 */
import crypto from 'node:crypto'
import { z } from 'zod'
import connectDB from '@/lib/mongodb'
import { Client, CreditNote, EnvoSync, Invoice, ProjectPayment, Transaction, User } from '@/models'
import { computeInvoiceTotals } from '@/lib/invoiceTotals'
import {
  PAYABLE_INVOICE_STATUSES, applyInvoicePayment, invoiceLabel, invoiceOutstanding, loadPostingAccount, preflightPosting,
  round2, settleInvoicePayment, settlementDescription,
} from '@/lib/paymentLedger'
import { postMoneyEntry } from '@/lib/finance/ledger'
import { issueDraftInvoice, ensureIssuedOutputVat } from '@/app/api/invoices/[id]/send/issue'
import { ensureMembership } from '@/lib/clientAccess'
import { createNotification } from '@/lib/createNotification'
import { inventoryManagerUserIds } from '@/app/api/my-assets/_lib/shared'
import { dhakaDayKey } from '@/lib/dhakaTime'
import { formatMoney } from '@/lib/currencies'
import { ENVO_UNIT, invoicePolicyProblem } from '@/lib/envo/policy'

const LEASE_MS = 3 * 60_000
// A claim older than this with no ledger row was left by a process that died
// (settlement takes well under a second; Payment Confirmations claims the same way).
const STALE_CLAIM_MS = 5 * 60_000
const EPS = 0.005
const CONCURRENCY = 6

// Paid on a gateway; everything else is money an Envo admin marked as received.
const ONLINE_METHODS = { enfinito_pay: 'ENFINITO_PAY', sslcommerz: 'SSLCOMMERZ' }
const ONLINE_LABELS = { enfinito_pay: 'Enfinito Pay', sslcommerz: 'SSLCommerz' }
const MANUAL_METHODS = { bkash: 'BKASH', nagad: 'NAGAD', rocket: 'ROCKET', bank: 'BANK_TRANSFER', cash: 'CASH', other: 'OTHER' }

const cents = (v) => Math.round((Number(v) || 0) * 100)
const sameMoney = (a, b) => cents(a) === cents(b)
const bdt = (n) => formatMoney(n, 'BDT')

const money = z.coerce.number().finite().min(0).max(1e12)
const when = z.coerce.date()
const text = (max) => z.string().trim().max(max)

const docSchema = z.object({
  id:      z.number().int().positive(),
  version: z.number().int().min(0),
  number:  z.string().trim().regex(/^[A-Z0-9-]{3,40}$/),
  status:  z.enum(['unpaid', 'paid', 'void']),
  createdAt: when,
  dueAt:     when.nullable().optional(),
  paidAt:    when.nullable().optional(),
  currency:  z.literal('BDT'),
  vatTreatment:  z.enum(['STANDARD', 'REDUCED', 'ZERO_RATED', 'EXEMPT', 'NONE']),
  serviceCode:   text(20).nullable().optional(),
  policyVersion: text(40).nullable().optional(),
  items: z.array(z.object({
    description: text(300).min(1),
    quantity:    z.number().positive(),
    rate:        money,
    vatRate:     z.number().min(0).max(100),
    sdRate:      z.number().min(0).max(500),
  })).min(1).max(20),
  totals: z.object({ subtotal: money, taxableValue: money, sdAmount: money, vatAmount: money, total: money }),
  customer: z.object({
    id:      z.number().int().positive(),
    name:    text(200).min(1),
    email:   text(200).email(),
    // The owner's login, verified by Envo. The address above is whatever the account says: never proof of who they are.
    verifiedEmail: text(200).email().nullable().optional(),
    phone:   text(60).optional().default(''),
    address: text(500).optional().default(''),
  }),
  payments: z.array(z.object({
    id:        z.number().int().positive(),
    method:    z.enum(['enfinito_pay', 'sslcommerz', 'manual']),
    status:    z.enum(['succeeded', 'refunded']),
    livemode:  z.boolean().nullable().optional(),
    amount:    money,
    paidAt:    when,
    channel:   text(40).optional().default(''),
    reference: text(120).optional().default(''),
    tranId:    text(120).nullable().optional(),
    bankTranId: text(120).nullable().optional(),
    cardType:  text(80).nullable().optional(),
    gatewayFee: money.nullable().optional(),
  })).max(50),
})

/** Something finance has to deal with: `kind` REVIEW keeps the state, REJECTED wrote nothing. */
class SyncStop extends Error {
  constructor(kind, code, message) {
    super(message)
    this.kind = kind
    this.code = code
  }
}
const review = (code, message) => new SyncStop('REVIEW', code, message)
const rejected = (code, message) => new SyncStop('REJECTED', code, message)

// ─────────────────────────────────────────────────────────────────────────────
// Validation
// ─────────────────────────────────────────────────────────────────────────────

/** The CRM's own calculation of the invoice. A figure that differs is refused, never "corrected". */
function recalculate(doc) {
  const calc = computeInvoiceTotals({
    items:          doc.items.map(i => ({ ...i, description: i.description })),
    vatTreatment:   doc.vatTreatment,
    defaultVatRate: doc.items[0]?.vatRate ?? 0,
  })
  if (calc.error) throw rejected('INVALID_TAX', calc.error)
  for (const key of ['subtotal', 'taxableValue', 'sdAmount', 'vatAmount', 'total']) {
    if (!sameMoney(calc[key], doc.totals[key])) {
      throw rejected('TOTALS_MISMATCH', `${key} is ${doc.totals[key]} in Envo but the CRM calculates ${calc[key]}`)
    }
  }
  return calc
}

// ─────────────────────────────────────────────────────────────────────────────
// Customer
// ─────────────────────────────────────────────────────────────────────────────

// Not a bcrypt hash, so no password ever matches: a customer only Envo knows has
// no CRM portal until finance activates one.
const NO_LOGIN = '!envo-customer-no-crm-login'

/**
 * The CRM person behind a customer. An account's billing email can be set to anything in Envo, so only the
 * owner's verified login may find an existing person: anyone else's clients, BIN and portal stay out of reach.
 */
async function findOrCreateUser(customer) {
  const placeholder = `envo-account-${customer.id}@customers.envo.invalid`
  const verified = customer.verifiedEmail?.toLowerCase() ?? null
  const person = verified ? await User.findOne({ email: verified }).select('role').lean() : null
  if (person?.role === 'CLIENT') return person
  // Not verified, or a CRM staff member who also holds an Envo account: the address stays theirs.
  const email = verified && !person ? verified : placeholder
  return (await User.findOne({ email }).select('role').lean()) ?? createUser(email, customer)
}

async function createUser(email, customer) {
  try {
    const user = await new User({ email, password: NO_LOGIN, name: customer.name, role: 'CLIENT', phone: customer.phone || null, isActive: false, mustChangePassword: true }).save()
    return user.toObject()
  } catch (err) {
    if (err?.code !== 11000) throw err
    return User.findOne({ email }).select('role').lean()   // created by a concurrent push
  }
}

async function ensureClient(customer) {
  const contact = { company: customer.name, companyEmail: customer.email.toLowerCase(), companyPhone: customer.phone || null, address: customer.address || null }
  const existing = await Client.findOne({ envoId: customer.id }).select('envoOwned company companyEmail companyPhone address vatRegistrationType clientCode').lean()
  if (existing) {
    if (existing.envoOwned && Object.entries(contact).some(([k, v]) => (existing[k] ?? null) !== v)) {
      await Client.updateOne({ _id: existing._id }, { $set: contact })
    }
    return existing
  }

  const user = await findOrCreateUser(customer)

  // Already a CRM client with one company: this is that customer, not a new one.
  const companies = await Client.find({ userId: user._id }).select('_id envoId').limit(2).lean()
  if (companies.length === 1 && companies[0].envoId == null) {
    const linked = await Client.findOneAndUpdate(
      { _id: companies[0]._id, envoId: { $exists: false } },
      { $set: { envoId: customer.id, envoOwned: false } },
      { new: true },
    ).lean()
    if (linked) return linked
  }

  try {
    const client = await new Client({
      ...contact,
      userId:         user._id,
      parentClientId: companies[0]?._id ?? null,
      envoId:         customer.id,
      envoOwned:      true,
      clientType:     'COMPANY',
      contactPerson:  customer.name,
      country:        'Bangladesh',
      notes:          `Created automatically from Envo (account ${customer.id}).`,
    }).save()
    await ensureMembership({ userId: user._id, clientId: client._id, role: 'OWNER' })
    return client.toObject()
  } catch (err) {
    if (err?.code !== 11000 || !(err.keyPattern?.envoId || /envoId/.test(String(err.message)))) throw err
    return Client.findOne({ envoId: customer.id }).lean()   // created by a concurrent push
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Invoice
// ─────────────────────────────────────────────────────────────────────────────

/** Invoice fields Envo may never change once sent. */
function assertSameInvoice(inv, doc, calc) {
  if (inv.invoiceNumber !== doc.number) {
    throw rejected('NUMBER_CHANGED', `Envo invoice ${doc.id} is ${doc.number} now but ${inv.invoiceNumber} in the CRM`)
  }
  for (const [key, a, b] of [
    ['total', (Number(inv.total) || 0) - (Number(inv.debitedAmount) || 0), calc.total], ['VAT', inv.vatAmount, calc.vatAmount], ['SD', inv.sdAmount, calc.sdAmount], ['subtotal', inv.subtotal, calc.subtotal],
  ]) {
    if (!sameMoney(a, b)) throw rejected('AMOUNT_CHANGED', `${invoiceLabel(inv)}: ${key} is ${a} in the CRM but ${b} in Envo`)
  }
}

async function ensureDraft(doc, client, calc) {
  const existing = await Invoice.findOne({ envoId: doc.id }).lean()
  if (existing) {
    assertSameInvoice(existing, doc, calc)
    return existing
  }
  try {
    const saved = await new Invoice({
      envoId:        doc.id,
      invoiceNumber: doc.number,
      clientId:      client._id,
      unit:          ENVO_UNIT,
      status:        'DRAFT',
      // '[ENVO]' fills the ID column of the invoice print (project code otherwise).
      items:         calc.items.map(i => ({ ...i, description: `[ENVO] ${i.description}` })),
      issueDate:     doc.createdAt,
      dueDate:       doc.dueAt ?? null,
      subtotal:      calc.subtotal,
      taxRate:       0,
      taxAmount:     0,
      discount:      0,
      total:         calc.total,
      currency:      'BDT',
      totalBDT:      calc.total,
      vatTreatment:  calc.vatTreatment,
      taxableValue:  calc.taxableValue,
      vatAmount:     calc.vatAmount,
      sdAmount:      calc.sdAmount,
      serviceCode:   calc.vatTreatment === 'NONE' ? null : (doc.serviceCode ?? null),
    }).save()
    return saved.toObject()
  } catch (err) {
    if (err?.code !== 11000) throw err
    if (err.keyPattern?.invoiceNumber || /invoiceNumber/.test(String(err.message))) {
      throw rejected('NUMBER_TAKEN', `Invoice number ${doc.number} already belongs to another CRM invoice`)
    }
    const raced = await Invoice.findOne({ envoId: doc.id }).lean()
    if (!raced) throw err
    assertSameInvoice(raced, doc, calc)
    return raced
  }
}

/** Never in the future: the ledger and VAT refuse money on a day that has not happened. */
function bookingDate(value) {
  const d = new Date(value)
  return dhakaDayKey(d) > dhakaDayKey(new Date()) ? new Date() : d
}

/** DRAFT → issued, the tax point being the day it was paid. */
async function issue(inv, paidAt) {
  if (inv.status !== 'DRAFT') {
    // Issued by a run that died before the VAT entry.
    const { warnings } = await ensureIssuedOutputVat(inv)
    if (warnings.length) throw review('VAT_NOT_RECORDED', warnings[0])
    return inv
  }
  const issuedAt = bookingDate(paidAt)
  await Invoice.updateOne({ _id: inv._id, status: 'DRAFT' }, { $set: { issuedAt } })
  try {
    const { invoice } = await issueDraftInvoice({ ...inv, issuedAt }, { userId: null, stampSentAt: false })
    return invoice.toObject ? invoice.toObject() : invoice
  } catch (err) {
    if (err?.status === 409 && /changed in the meantime/.test(String(err.message))) return Invoice.findById(inv._id).lean()
    if (err?.status) throw review('NOT_ISSUED', err.message)
    throw err
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Payments
// ─────────────────────────────────────────────────────────────────────────────

const isOnline = (p) => p.method in ONLINE_METHODS

function methodOf(p) {
  return ONLINE_METHODS[p.method] ?? MANUAL_METHODS[String(p.channel).toLowerCase()] ?? 'OTHER'
}

function accountFor(p, settings) {
  if (isOnline(p)) return settings.onlineAccountId || null
  return settings.manualAccounts?.[String(p.channel).toLowerCase()] || settings.manualAccounts?.other || null
}

async function ensurePaymentRecord(p, inv, settings) {
  const existing = await ProjectPayment.findOne({ envoId: p.id }).lean()
  if (existing) return existing
  const online = isOnline(p)
  try {
    const pp = await new ProjectPayment({
      envoId:        p.id,
      invoiceId:     inv._id,
      clientId:      inv.clientId,
      amount:        round2(p.amount),
      currency:      'BDT',
      amountBDT:     round2(p.amount),
      paymentMethod: methodOf(p),
      channel:       online ? 'GATEWAY' : null,
      accountId:     accountFor(p, settings),
      paymentDate:   bookingDate(p.paidAt),
      description:   online
        ? `Paid online through Envo (${ONLINE_LABELS[p.method]}${p.cardType ? `, ${p.cardType}` : ''})`
        : `Paid by ${p.channel || 'other means'}, marked as paid in Envo`,
      notes:         [
        `Envo payment ${p.id}`,
        p.bankTranId ? `transaction ${p.bankTranId}` : null,
        p.tranId ? `checkout ${p.tranId}` : null,
        p.reference ? `reference ${p.reference}` : null,
      ].filter(Boolean).join(' · '),
      settledAmount: round2(p.amount),
      status:        'PENDING_CONFIRMATION',
    }).save()
    return pp.toObject()
  } catch (err) {
    if (err?.code !== 11000) throw err
    return ProjectPayment.findOne({ envoId: p.id }).lean()
  }
}

/**
 * A run died between claiming the payment and linking its ledger row. With a row
 * ENVOP<id> it was posted: finish what is left. Without one nothing was: release it.
 * A person's confirmation carries their own Transaction ID, so it cannot be told
 * from here whether it was posted: that one is for finance to check.
 * @returns {Promise<boolean>} true when it is booked
 */
async function finishInterrupted(pp, txnId) {
  const age = Date.now() - new Date(pp.confirmedAt ?? pp.updatedAt).getTime()
  if (age < STALE_CLAIM_MS) throw new SyncStop('RETRY', 'BEING_CONFIRMED', 'This payment is being confirmed right now')
  if (pp.confirmedBy) {
    throw review('INTERRUPTED', `Confirming ${bdt(pp.amount)} in Payment Confirmations was interrupted. Check the invoice and the ledger before confirming it again.`)
  }
  const tx = await Transaction.findOne({ txnId }).select('_id accountId channel').lean()
  if (!tx) {
    await ProjectPayment.updateOne(
      { _id: pp._id, status: 'CONFIRMED', transactionId: null },
      { $set: { status: 'PENDING_CONFIRMATION', confirmedBy: null, confirmedAt: null } },
    )
    return false
  }
  const inv = await Invoice.findById(pp.invoiceId).lean()
  const credit = round2(pp.settledAmount ?? pp.amount)
  if (PAYABLE_INVOICE_STATUSES.includes(inv?.status) && invoiceOutstanding(inv) >= credit - EPS) {
    await applyInvoicePayment(inv._id, credit, pp.paymentDate ?? new Date())
  }
  await ProjectPayment.updateOne({ _id: pp._id }, { $set: { transactionId: tx._id, settledAmount: credit, accountId: tx.accountId ?? null, channel: tx.channel ?? null } })
  return true
}

/**
 * What the books say was received on an invoice and kept: settled, less credit notes applied, tax
 * withheld and refunds paid back. This is the figure that has to equal what Envo says it received.
 */
export async function keptOnInvoice(inv) {
  const notes = await CreditNote.find({ invoiceId: inv._id, kind: 'CREDIT', settlement: 'REFUND', status: 'ISSUED' }).select('totalAmount').lean()
  const refunds = notes.reduce((sum, n) => sum + (Number(n.totalAmount) || 0), 0)
  return round2((Number(inv.paidAmount) || 0) - (Number(inv.creditedAmount) || 0) - (Number(inv.withheldVds) || 0) - (Number(inv.withheldTds) || 0) - refunds)
}

async function bookPayment(p, invoiceId, settings) {
  const txnId = `ENVOP${p.id}`
  let inv = await Invoice.findById(invoiceId).lean()
  let pp = await ensurePaymentRecord(p, inv, settings)
  if (String(pp.invoiceId) !== String(inv._id)) {
    throw review('PAYMENT_ON_OTHER_INVOICE', `Envo payment ${p.id} is recorded against another invoice in the CRM`)
  }
  if (!sameMoney(pp.amount, p.amount)) {
    throw review('PAYMENT_CHANGED', `Envo payment ${p.id} is ${bdt(p.amount)} in Envo but ${bdt(pp.amount)} in the CRM`)
  }

  if (pp.status === 'CONFIRMED' && !pp.transactionId) {
    if (await finishInterrupted(pp, txnId)) return ProjectPayment.findById(pp._id).lean()
    pp = await ProjectPayment.findById(pp._id).lean()
  }
  if (pp.status === 'CONFIRMED') return pp
  if (pp.status !== 'PENDING_CONFIRMATION') {
    // Rejected or reversed by finance: their decision stands, it is never booked again.
    // Recorded again by hand since: the invoice shows the money, and that settles it.
    inv = await Invoice.findById(invoiceId).lean()
    if (inv.status === 'PAID' && cents(await keptOnInvoice(inv)) >= cents(p.amount)) return pp
    throw review('CHANGED_IN_CRM', `${bdt(p.amount)} paid on ${invoiceLabel(inv)} is ${String(pp.status).toLowerCase().replace(/_/g, ' ')} in the CRM but paid in Envo. Refund the customer, or record it again in Accounts → Transactions against this invoice.`)
  }

  const accountId = accountFor(p, settings)
  if (!accountId) {
    throw review('NO_ACCOUNT', `No money account is chosen for ${isOnline(p) ? 'online payments' : `${p.channel || 'manual'} payments`}. Choose one in Configuration → Integrations → Envo.`)
  }
  inv = await Invoice.findById(invoiceId).lean()
  if (!PAYABLE_INVOICE_STATUSES.includes(inv.status)) {
    throw review('NOT_PAYABLE', `${invoiceLabel(inv)} is already ${String(inv.status).toLowerCase().replace(/_/g, ' ')} but Envo reports ${bdt(p.amount)} more. Check whether the customer paid twice and refund them if so.`)
  }
  if (p.amount > invoiceOutstanding(inv) + 0.01) {
    throw review('OVERPAID', `Envo reports ${bdt(p.amount)} on ${invoiceLabel(inv)} but only ${bdt(invoiceOutstanding(inv))} is due. Check whether the customer paid twice and refund the difference.`)
  }

  const date = bookingDate(p.paidAt)
  try {
    await loadPostingAccount(accountId, { currency: 'BDT', date })
    await preflightPosting({ date, accountId, cash: p.amount })
  } catch (err) {
    if (err?.status) throw review(err.code || 'NOT_BOOKABLE', err.message)
    throw err
  }

  // Claim it exactly like Payment Confirmations does.
  const claimed = await ProjectPayment.findOneAndUpdate(
    { _id: pp._id, status: 'PENDING_CONFIRMATION' },
    { $set: { status: 'CONFIRMED', confirmedBy: null, confirmedAt: new Date(), currency: 'BDT', amountBDT: round2(p.amount), accountId } },
    { new: true },
  )
  if (!claimed) throw new SyncStop('RETRY', 'BEING_CONFIRMED', 'This payment is being confirmed right now')
  try {
    await settleInvoicePayment({
      invoice:        inv,
      projectPayment: claimed,
      cash:           round2(p.amount),
      currency:       'BDT',
      cashBDT:        round2(p.amount),
      date,
      paidAt:         date,
      accountId,
      channel:        isOnline(p) ? 'GATEWAY' : null,
      userId:         null,
      entry: {
        category:      settings.incomeCategory || 'Envo Subscriptions',
        description:   settlementDescription({ cash: p.amount, note: claimed.description, label: inv.invoiceNumber }),
        reference:     p.bankTranId || p.tranId || p.reference || inv.invoiceNumber,
        clientId:      String(inv.clientId),
        paymentMethod: methodOf(p),
        txnId,
        createdBy:     null,
      },
    })
  } catch (err) {
    // The ledger already has this row: a run we cannot see got this far. The claim stays,
    // and once it is old enough finishInterrupted() takes up the row.
    if (err?.code === 11000) throw new SyncStop('RETRY', 'ALREADY_POSTED', 'This payment was already posted; checking it again')
    await ProjectPayment.updateOne(
      { _id: claimed._id, status: 'CONFIRMED', transactionId: null },
      { $set: { status: 'PENDING_CONFIRMATION', confirmedBy: null, confirmedAt: null } },
    )
    if (err?.status) throw review(err.code || 'NOT_BOOKABLE', err.message)
    throw err
  }
  return ProjectPayment.findById(claimed._id).lean()
}

/** What the gateway kept from a payment, as the CRM is set to count it. */
function gatewayFeeOf(p, settings) {
  if (!isOnline(p) || settings.gatewayFeeMode === 'NONE') return 0
  const reported = p.gatewayFee === null || p.gatewayFee === undefined ? null : round2(p.gatewayFee)
  if (settings.gatewayFeeMode === 'ACTUAL' && reported !== null) return reported
  return round2(p.amount * (Number(settings.gatewayFeePercent) || 0) / 100)
}

/** The gateway's cost as an Envo expense on the same account, once (ENVOF<id>). */
async function bookGatewayFee(p, pp, inv, settings) {
  const fee = gatewayFeeOf(p, settings)
  if (!(fee > 0) || !pp.accountId) return
  const txnId = `ENVOF${p.id}`
  if (await Transaction.exists({ txnId })) return
  try {
    await postMoneyEntry({
      type:        'EXPENSE',
      kind:        'OPERATING',
      category:    settings.gatewayFeeCategory || 'Payment Gateway Charges',
      amount:      fee,
      currency:    'BDT',
      amountBDT:   fee,
      date:        bookingDate(p.paidAt),
      accountId:   pp.accountId,
      channel:     'GATEWAY',
      paymentMethod: methodOf(p),
      description: `${ONLINE_LABELS[p.method]} charge on ${inv.invoiceNumber}`,
      reference:   inv.invoiceNumber,
      clientId:    String(inv.clientId),
      unit:        inv.unit || ENVO_UNIT,
      txnId,
    }, { userId: null })
  } catch (err) {
    if (err?.code === 11000) return
    if (err?.status) throw review('FEE_NOT_BOOKED', `The ${bdt(fee)} ${ONLINE_LABELS[p.method]} charge on ${inv.invoiceNumber} was not booked: ${err.message}`)
    throw err
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// One invoice
// ─────────────────────────────────────────────────────────────────────────────

async function applyState(doc, settings, calc) {
  // Void and never seen here: there is nothing to cancel, and no number to burn.
  if (doc.status === 'void' && !(await Invoice.exists({ envoId: doc.id }))) return { invoice: null, clientId: null, payments: [] }

  const client = await ensureClient(doc.customer)
  const policy = invoicePolicyProblem(doc, settings, client)
  if (policy) throw rejected('POLICY_MISMATCH', policy)

  let inv = await ensureDraft(doc, client, calc)
  const payments = []

  if (doc.status === 'void') {
    if (inv.status === 'DRAFT') {
      await Invoice.updateOne({ _id: inv._id, status: 'DRAFT' }, { $set: { status: 'CANCELLED' } })
    } else if (inv.status !== 'CANCELLED') {
      throw review('VOID_BUT_ISSUED', `${invoiceLabel(inv)} was cancelled in Envo but is ${String(inv.status).toLowerCase().replace(/_/g, ' ')} in the CRM`)
    }
  } else if (doc.status === 'unpaid') {
    if (inv.status !== 'DRAFT') {
      throw review('UNPAID_BUT_ISSUED', `${invoiceLabel(inv)} is unpaid in Envo but ${String(inv.status).toLowerCase().replace(/_/g, ' ')} in the CRM`)
    }
  } else {
    if (inv.status === 'CANCELLED') throw review('PAID_BUT_CANCELLED', `${invoiceLabel(inv)} is paid in Envo but cancelled in the CRM`)
    const received = doc.payments.filter(p => p.status === 'succeeded' && p.amount > 0)
    const refunded = doc.payments.filter(p => p.status === 'refunded')
    // A test key moves no money: it stays out of the books altogether (not issued, no VAT).
    if (!settings.bookTestPayments && received.some(p => p.livemode === false)) {
      throw review('TEST_PAYMENT', `${invoiceLabel(inv)} was paid with an Enfinito Pay test key, so no money moved. It is not booked.`)
    }
    if (!received.length && !refunded.length) throw review('PAID_WITHOUT_PAYMENT', `${invoiceLabel(inv)} is paid in Envo but Envo reports no payment for it`)
    // Refunded before it was booked: it must not wait to be confirmed as money received.
    for (const p of refunded) {
      await ProjectPayment.updateOne(
        { envoId: p.id, status: 'PENDING_CONFIRMATION' },
        { $set: { status: 'REJECTED', rejectionNote: 'Refunded at the gateway before it was booked', confirmedAt: new Date() } },
      )
    }
    if (received.length) {
      // The tax point is the day the money was paid, the same day as the income it goes with.
      inv = await issue(inv, received[0].paidAt)
      for (const p of received) {
        const pp = await bookPayment(p, inv._id, settings)
        payments.push({ id: p.id, status: pp.status, transactionId: pp.transactionId ? String(pp.transactionId) : null, txnId: `ENVOP${p.id}` })
        if (pp.status === 'CONFIRMED') await bookGatewayFee(p, pp, inv, settings)
      }
    }
    // Never issued: nothing to agree on. Otherwise the invoice must be settled, and hold what Envo received.
    inv = await Invoice.findById(inv._id).lean()
    if (inv.status !== 'DRAFT') {
      const wanted = received.reduce((sum, p) => sum + cents(p.amount), 0)
      const kept = cents(await keptOnInvoice(inv))
      const due = invoiceOutstanding(inv)
      if (kept !== wanted || due > 0.01) {
        // The CRM never moves the ledger by itself: a credit note takes the money and its VAT back.
        if (refunded.length) {
          const amount = bdt(refunded.reduce((sum, p) => sum + p.amount, 0))
          throw review('REFUNDED', due > 0.01
            ? `${amount} on ${invoiceLabel(inv)} was refunded at the gateway. It still shows ${bdt(due)} due with its VAT: raise a credit note to clear it.`
            : `${amount} on ${invoiceLabel(inv)} was refunded at the gateway. Raise a credit note with a refund, so the books show the money and the VAT going back.`)
        }
        if (kept < wanted || due > 0.01) throw review('NOT_FULLY_PAID', `${invoiceLabel(inv)} is paid in Envo but ${bdt(due)} is still due in the CRM (${bdt(kept / 100)} received against ${bdt(wanted / 100)})`)
        throw review('CHANGED_IN_CRM', `${invoiceLabel(inv)} holds ${bdt(kept / 100)} in the CRM but ${bdt(wanted / 100)} in Envo`)
      }
    }
  }
  return { invoice: await Invoice.findById(inv._id).lean(), clientId: client._id, payments }
}

async function crmView(inv, client) {
  if (!inv) return null
  return {
    invoiceId:  String(inv._id),
    number:     inv.invoiceNumber,
    status:     inv.status,
    total:      Number(inv.total) || 0,
    vatAmount:  Number(inv.vatAmount) || 0,
    sdAmount:   Number(inv.sdAmount) || 0,
    paidAmount: Number(inv.paidAmount) || 0,
    received:   await keptOnInvoice(inv),
    issuedAt:   inv.issuedAt ?? null,
    clientCode: client?.clientCode ?? null,
    seller:     inv.seller ?? null,
    buyer:      inv.buyer ? { name: inv.buyer.name ?? null, bin: inv.buyer.bin ?? null, address: inv.buyer.address ?? null } : null,
  }
}

/**
 * Makes the CRM match one invoice's state. Never throws for a bad invoice: every
 * outcome is an answer Envo records.
 * @returns {Promise<{ id:number, version:number, status:'ok'|'review'|'rejected'|'retry', code?:string, message?:string, crm?:object, payments?:Array, isNew?:boolean }>}
 */
export async function syncInvoice(raw, settings) {
  const parsed = docSchema.safeParse(raw)
  const id = Number(raw?.id) || 0
  const version = Number(raw?.version) || 0
  if (!parsed.success) {
    const problem = parsed.error.issues[0]
    const message = `${problem?.path?.join('.') || 'invoice'}: ${problem?.message}`
    const isNew = Number.isInteger(id) && id > 0
      ? await noteOutcome({ envoId: id }, { state: 'REJECTED', code: 'INVALID', note: message, number: typeof raw?.number === 'string' ? raw.number.slice(0, 40) : null, syncedAt: new Date() })
      : false
    return { id, version, status: 'rejected', code: 'INVALID', message, isNew }
  }
  const doc = parsed.data

  let calc
  try {
    calc = recalculate(doc)
    if (doc.status === 'paid' && !doc.paidAt && !doc.payments.length && calc.total > 0) throw rejected('INVALID', 'A paid invoice needs a payment date')
  } catch (err) {
    if (!(err instanceof SyncStop)) throw err
    const isNew = await recordOutcome(doc, { state: 'REJECTED', code: err.code, note: err.message })
    return { id, version, status: 'rejected', code: err.code, message: err.message, isNew }
  }

  // Only one run at a time per invoice; a retry during a slow run waits for its turn.
  const now = new Date()
  const leaseId = crypto.randomUUID()
  const claimed = await EnvoSync.findOneAndUpdate(
    { envoId: doc.id, $or: [{ leaseUntil: null }, { leaseUntil: { $lt: now } }] },
    { $set: { leaseUntil: new Date(now.getTime() + LEASE_MS), leaseId }, $inc: { attempts: 1 }, $setOnInsert: { envoId: doc.id, state: 'RUNNING' } },
    { upsert: true, new: true },
  ).lean().catch(err => { if (err?.code === 11000) return null; throw err })
  if (!claimed) return { id, version, status: 'retry', code: 'BUSY', message: 'Another push of this invoice is running' }
  const release = () => EnvoSync.updateOne({ envoId: doc.id, leaseId }, { $set: { leaseUntil: null } })

  // A push delayed behind a newer one (it timed out in Envo and ran late) must not undo what the newer one saw.
  if (claimed.envoVersion !== null && claimed.envoVersion !== undefined && doc.version < claimed.envoVersion) {
    await release()
    return { id, version, status: 'retry', code: 'STALE', message: `A newer state of this invoice (${claimed.envoVersion}) is already here` }
  }

  try {
    const { invoice, clientId, payments } = await applyState(doc, settings, calc)
    const client = clientId ? await Client.findById(clientId).select('clientCode').lean() : null
    await recordOutcome(doc, { state: 'OK', code: null, note: null, invoiceId: invoice?._id ?? null, clientId }, leaseId)
    return { id, version, status: 'ok', crm: await crmView(invoice, client), payments }
  } catch (err) {
    if (err instanceof SyncStop) {
      if (err.kind === 'RETRY') {
        await release()
        return { id, version, status: 'retry', code: err.code, message: err.message }
      }
      const inv = await Invoice.findOne({ envoId: doc.id }).lean()
      const client = inv ? await Client.findById(inv.clientId).select('clientCode').lean() : null
      const isNew = await recordOutcome(doc, { state: err.kind, code: err.code, note: err.message, invoiceId: inv?._id ?? null, clientId: inv?.clientId ?? null }, leaseId)
      return {
        id, version,
        status: err.kind === 'REVIEW' ? 'review' : 'rejected',
        code: err.code, message: err.message,
        crm: await crmView(inv, client),
        isNew,
        link: inv ? `/admin/invoices/${inv._id}` : null,
      }
    }
    await release().catch(() => {})
    console.error(`[envo] invoice ${doc.id} failed`, err)
    return { id, version, status: 'retry', code: 'ERROR', message: String(err?.message || err).slice(0, 300) }
  }
}

/** Stores where an invoice stands. @returns {Promise<boolean>} true when this is a new reason (finance is told once). */
async function noteOutcome(filter, set) {
  const before = await EnvoSync.findOneAndUpdate(filter, { $set: { ...set, note: set.note ? String(set.note).slice(0, 1000) : null } }, { upsert: true, new: false })
    .select('code').lean()
    .catch(err => { if (err?.code === 11000) return { code: set.code }; throw err })   // a run that lost its lease records nothing
  return (before?.code ?? null) !== set.code
}

function recordOutcome(doc, { state, code, note, invoiceId, clientId }, leaseId = null) {
  return noteOutcome(leaseId ? { envoId: doc.id, leaseId } : { envoId: doc.id }, {
    state, code, note,
    number: doc.number, envoStatus: doc.status, envoVersion: doc.version, total: doc.totals.total,
    syncedAt: new Date(), leaseUntil: null, leaseId: null,
    ...(invoiceId !== undefined ? { invoiceId } : {}),
    ...(clientId !== undefined ? { clientId } : {}),
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// A batch
// ─────────────────────────────────────────────────────────────────────────────

let indexesReady = null

/**
 * The unique indexes are what makes this safe, so nothing runs before they exist. Only these: an index
 * that failed elsewhere on these models has nothing to do with Envo and must not stop its money.
 */
function ensureIndexes() {
  indexesReady ??= (async () => {
    await Promise.all([Client, Invoice, ProjectPayment].map(m => m.collection.createIndex(
      { envoId: 1 }, { unique: true, partialFilterExpression: { envoId: { $gt: 0 } } },
    )))
    await EnvoSync.collection.createIndex({ envoId: 1 }, { unique: true })
    await Transaction.init().catch(() => {})   // on a new database, the collection and its indexes come from this
    const ledger = await Transaction.collection.indexes()
    if (!ledger.some(i => i.unique && i.key?.txnId === 1)) throw new Error('The ledger has no unique Transaction ID index')
  })().catch((err) => {
    indexesReady = null   // the next push tries again
    throw err
  })
  return indexesReady
}

/**
 * Handles one batch. A customer's invoices run in order, and at most CONCURRENCY
 * customers at a time, so a peak queues up in Envo instead of swamping the CRM.
 */
export async function syncBatch(items, settings) {
  await connectDB()
  await ensureIndexes()

  const byCustomer = new Map()
  items.forEach((item, i) => {
    const key = String(item?.customer?.id ?? `?${i}`)
    if (!byCustomer.has(key)) byCustomer.set(key, [])
    byCustomer.get(key).push({ item, i })
  })
  const queue = [...byCustomer.values()]
  const results = new Array(items.length)
  const worker = async () => {
    for (let group = queue.shift(); group; group = queue.shift()) {
      for (const { item, i } of group) {
        results[i] = await syncInvoice(item, settings).catch(err => {
          console.error('[envo] push failed', err)
          return { id: Number(item?.id) || 0, version: Number(item?.version) || 0, status: 'retry', code: 'ERROR', message: String(err?.message || err).slice(0, 300) }
        })
      }
    }
  }
  await Promise.all(Array.from({ length: CONCURRENCY }, worker))
  // The work is done: a failed notification must not make Envo send it all again.
  await notifyFinance(results).catch(err => console.error('[envo] notifying finance failed', err))
  return results
}

/** One message per reason, however many invoices it held up: a peak must not flood finance. */
async function notifyFinance(results) {
  const fresh = results.filter(r => (r.status === 'review' || r.status === 'rejected') && r.isNew)
  if (!fresh.length) return
  const groups = new Map()
  for (const r of fresh) groups.set(r.code, [...(groups.get(r.code) ?? []), r])
  const ids = await inventoryManagerUserIds({ perms: ['finance.payments.confirm'] })
  if (!ids.length) return
  for (const list of groups.values()) {
    const refused = list[0].status === 'rejected'
    await createNotification({
      userId:  ids,
      title:   refused
        ? (list.length === 1 ? 'Envo invoice refused' : `${list.length} Envo invoices refused`)
        : (list.length === 1 ? 'Envo payment needs a check' : `${list.length} Envo payments need a check`),
      message: list[0].message,
      type:    'PAYMENT',
      link:    list.length === 1 && list[0].link ? list[0].link : '/admin/config?tab=integrations',
    })
  }
}
