/**
 * lib/paymentLedger.js — SERVER-ONLY client-payment settlement.
 *
 * Atomic money-counter updates for client payments. Every counter helper here is
 * a single conditional MongoDB update, so two overlapping payment operations on
 * the same project / invoice can never lose an increment (no read-modify-write
 * in JS) and an invoice can never be paid past its total.
 *
 * Money fields on Invoice / Project are stored as Mixed (legacy), so values are
 * coerced with $convert inside the update pipeline rather than relying on $inc.
 *
 * settleInvoicePayment() is the one place a client settlement is booked:
 *   INCOME Transaction (cash ⇒ OPERATING on a money account; withholding only ⇒
 *   NON_CASH) with the VAT/SD carved out of the P&L (SPEC §8) → invoice credited
 *   (cash + VDS + TDS) → invoice.withheldVds/withheldTds → VDS_RECEIVABLE /
 *   TDS_RECEIVABLE tax entries → ids linked on the Transaction / ProjectPayment
 *   → project credited. Any failure undoes every step already taken.
 *
 * reverseClientSettlement() undoes one booked settlement (a confirmed
 * ProjectPayment, or a manual ledger receipt against an invoice) so it can be
 * recorded again correctly: reversing ledger row, VDS/TDS receivables voided,
 * invoice and project counters taken back — all-or-nothing as well.
 *
 * Errors meant for API callers are thrown as Error with `.status` (409 / 422);
 * map them with httpErrorPayload().
 */

import mongoose from 'mongoose'
import { Invoice, Project, ProjectPayment, MoneyAccount, TaxEntry, TaxFiling, Transaction, CreditNote } from '@/models'
import { postMoneyEntry, reverseMoneyEntry } from '@/lib/finance/ledger'
import { assertBooksOpen, requireAccountIfLive } from '@/lib/finance/settings'
import { periodLabel } from '@/lib/finance/fiscal'
import { invoiceTaxTotals, vatSdPortionOfSettlement } from '@/lib/tax/invoiceVat'
import { recordCustomerWithholding, recognizedVatSdForInvoice, reversedIncomeRowIds } from '@/lib/tax/withholding'
import { voidTaxEntry, getTdsSection } from '@/lib/tax/engine'
import { dhakaDayKey, dhakaDayStart, parseDhakaDay } from '@/lib/dhakaTime'
import { isValidObjectId } from '@/lib/objectId'
import { formatMoney } from '@/lib/currencies'
import { COMPANY_UNIT, ventureUnit } from '@/lib/units'

/** Invoice statuses that can still take a payment. */
export const PAYABLE_INVOICE_STATUSES = ['SENT', 'PARTIALLY_PAID', 'OVERDUE']

/** paymentMethod of a ProjectPayment / Transaction that settles an invoice with tax withheld only (no cash). */
export const WITHHOLDING_PAYMENT_METHOD = 'WITHHOLDING'

/** Ledger category of client settlements. */
export const PROJECT_REVENUE_CATEGORY = 'Project Revenue'

const EPS = 0.01

const num = (field) => ({ $convert: { input: `$${field}`, to: 'double', onError: 0, onNull: 0 } })

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

const toNum = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const idOf = (v) => (v === null || v === undefined || v === '' ? null : (v._id ?? v))

/** 'Invoice ENV2610A001' (or just 'The invoice'). */
export function invoiceLabel(invoice) {
  return invoice?.invoiceNumber ? `Invoice ${invoice.invoiceNumber}` : 'The invoice'
}

// ─────────────────────────────────────────────────────────────────────────────
// Business unit (venture / product / Company — lib/units.js)
// ─────────────────────────────────────────────────────────────────────────────

/** 'VENTURE:<project.venture>' of a project, or null (no id, no project, no venture). */
export async function projectUnit(projectId) {
  const id = idOf(projectId)
  if (!id || !isValidObjectId(String(id))) return null
  const project = await Project.findById(id).select('venture').lean()
  return ventureUnit(project?.venture || null) || null
}

/**
 * Unit of money settled against (or refunded on) an invoice: the invoice's own
 * unit, else the venture of its project, else the venture of `projectId` (the
 * project the settlement credits), else Company / shared. Never null.
 */
export async function invoiceUnit(invoice, { projectId = null } = {}) {
  if (typeof invoice?.unit === 'string' && invoice.unit) return invoice.unit
  const own = idOf(invoice?.projectId) ?? idOf(invoice?.projectIds?.[0])
  return (await projectUnit(own)) ?? (await projectUnit(projectId)) ?? COMPANY_UNIT
}

/** Error with an HTTP status (and optional extra props such as `field`). */
export function paymentError(message, status = 422, extra = null) {
  const err = new Error(message)
  err.status = status
  if (extra) Object.assign(err, extra)
  return err
}

/**
 * Map an error thrown by this module / the ledger / the tax engine to an API
 * response payload: { status, body } — or null when it is an unexpected error
 * (the route should log it and answer 500).
 */
export function httpErrorPayload(err, { txnId = null } = {}) {
  if (!err) return null
  if (err.code === 11000) {
    const isTxn = err.keyPattern?.txnId || /txnId/.test(String(err.message))
    // Unique reversalOf: a concurrent reversal of the same ledger row won.
    const isReversal = err.keyPattern?.reversalOf || /reversalOf|already been reversed/.test(String(err.message))
    const message = isTxn
      ? (txnId ? `Transaction ID "${txnId}" is already used by another ledger entry` : 'Transaction ID already exists')
      : isReversal ? 'This entry has already been reversed' : 'Duplicate record'
    return { status: 409, body: { error: message } }
  }
  if (!err.status || typeof err.status !== 'number') return null
  const body = { error: err.message || 'Request failed' }
  if (typeof err.code === 'string') body.code = err.code
  if (err.field) body.field = err.field
  if (err.available !== undefined) body.available = err.available
  return { status: err.status, body }
}

// ─────────────────────────────────────────────────────────────────────────────
// Dates & input normalisation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Business date from a request value. 'YYYY-MM-DD' ⇒ 00:00 UTC of that day
 * (06:00 Asia/Dhaka — the same Dhaka calendar day, and the representation the
 * existing payment & transaction forms round-trip with `date.slice(0, 10)`).
 * Full ISO strings / Date ⇒ that instant. Invalid ⇒ null.
 */
export function parseBusinessDate(value) {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const s = String(value).trim()
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const day = parseDhakaDay(s)
    if (!day || dhakaDayKey(day.start) !== s) return null // rejects 2026-02-31 & co.
    return new Date(`${s}T00:00:00.000Z`)
  }
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Same Dhaka calendar day? */
export function sameBusinessDay(a, b) {
  if (!a || !b) return false
  return dhakaDayKey(new Date(a)) === dhakaDayKey(new Date(b))
}

export const WITHHOLDING_FIELDS = [
  'vdsAmount', 'tdsAmount', 'tdsSection',
  'vdsCertificateNo', 'vdsCertificateDate', 'tdsCertificateNo', 'tdsCertificateDate',
]

/**
 * Normalised customer-withholding input. Each field comes from `body` when the
 * key is present (not undefined), else from `fallback` (e.g. the values stored
 * on a pending ProjectPayment). null/'' amounts ⇒ 0. Throws 422 on bad values.
 * Certificate / section fields are cleared when their amount is 0.
 * @returns {{ vdsAmount, tdsAmount, tdsSection, vdsCertificateNo, vdsCertificateDate, tdsCertificateNo, tdsCertificateDate }}
 */
export function readWithholding(body = {}, fallback = {}) {
  const src = body && typeof body === 'object' ? body : {}
  const fb = fallback && typeof fallback === 'object' ? fallback : {}
  const pick = (k) => (src[k] !== undefined ? src[k] : fb[k])

  const money = (k, label) => {
    const v = pick(k)
    if (v === null || v === undefined || v === '') return 0
    const n = Number(v)
    if (!Number.isFinite(n) || n < 0) throw paymentError(`${label} must be zero or a positive amount`, 422, { field: k })
    if (n > 1e12) throw paymentError(`${label} is too large`, 422, { field: k })
    return round2(n)
  }
  const text = (k, label, max) => {
    const v = pick(k)
    if (v === null || v === undefined) return null
    const s = String(v).trim()
    if (s.length > max) throw paymentError(`${label} is too long (max ${max} characters)`, 422, { field: k })
    return s || null
  }
  const date = (k, label) => {
    const v = pick(k)
    if (v === null || v === undefined || v === '') return null
    const d = parseBusinessDate(v)
    if (!d) throw paymentError(`${label} must be a valid date (YYYY-MM-DD)`, 422, { field: k })
    return d
  }

  const out = {
    vdsAmount:          money('vdsAmount', 'VDS withheld'),
    tdsAmount:          money('tdsAmount', 'TDS withheld'),
    tdsSection:         text('tdsSection', 'TDS section', 40),
    vdsCertificateNo:   text('vdsCertificateNo', 'VDS certificate (Mushak-6.6) number', 100),
    vdsCertificateDate: date('vdsCertificateDate', 'VDS certificate date'),
    tdsCertificateNo:   text('tdsCertificateNo', 'TDS certificate number', 100),
    tdsCertificateDate: date('tdsCertificateDate', 'TDS certificate date'),
  }
  if (!(out.vdsAmount > 0)) { out.vdsCertificateNo = null; out.vdsCertificateDate = null }
  if (!(out.tdsAmount > 0)) { out.tdsSection = null; out.tdsCertificateNo = null; out.tdsCertificateDate = null }
  return out
}

export function hasWithholding(w) {
  return !!w && (toNum(w.vdsAmount) > 0 || toNum(w.tdsAmount) > 0)
}

/** Total withheld (VDS + TDS). */
export function withheldTotal(w) {
  return w ? round2(toNum(w.vdsAmount) + toNum(w.tdsAmount)) : 0
}

/** Outstanding balance of an invoice in its own currency (total − settled). */
export function invoiceOutstanding(invoice) {
  if (!invoice) return 0
  return round2(toNum(invoice.total) - toNum(invoice.paidAmount))
}

/**
 * VDS cap of an invoice (invoice currency = BDT): its VAT — never the SD — as it
 * stands after its ISSUED notes: ADJUST_INVOICE credit notes take VAT off,
 * debit notes add VAT on (a REFUND credit note repays the money instead).
 * A 'No VAT' invoice issued under the VAT module (issuedAt set) carries no
 * output VAT, so its cap is 0. null ⇒ uncapped: only a legacy non-VAT invoice
 * issued before the VAT module (treatment NONE, issuedAt null).
 * @returns {Promise<{ cap:number, vatAmount:number, creditVat:number, debitVat:number, treatment:string }|null>}
 */
export async function invoiceVdsCap(invoice) {
  if (!invoice) return null
  const t = invoiceTaxTotals(invoice)
  if (t.treatment === 'NONE') {
    return invoice.issuedAt ? { cap: 0, vatAmount: 0, creditVat: 0, debitVat: 0, treatment: t.treatment } : null
  }
  const { creditVat, debitVat } = await invoiceNoteVat(invoice._id ?? invoice.id)
  return { cap: Math.max(0, round2(t.vatAmount - creditVat + debitVat)), vatAmount: t.vatAmount, creditVat, debitVat, treatment: t.treatment }
}

/**
 * Σ VDS on the invoice's PENDING_CONFIRMATION requests — VDS already claimed
 * against its cap but not confirmed yet, so a new request must leave room for it.
 */
export async function pendingVdsTotal(invoiceId, { excludeId = null } = {}) {
  const id = idOf(invoiceId)
  if (!id || !isValidObjectId(String(id))) return 0
  const match = { status: 'PENDING_CONFIRMATION', invoiceId: new mongoose.Types.ObjectId(String(id)) }
  if (excludeId) match._id = { $ne: new mongoose.Types.ObjectId(String(idOf(excludeId))) }
  const [row] = await ProjectPayment.aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: num('vdsAmount') } } },
  ])
  return round2(Number(row?.total ?? 0))
}

/**
 * Checks customer withholding against the invoice (no-op when nothing withheld):
 * an invoice is required, it must be in BDT, VDS needs a VAT invoice (or a legacy
 * non-VAT invoice issued before the VAT module, i.e. issuedAt null) and, with the
 * VDS already withheld on the invoice (plus `pendingVds` in pending requests),
 * may not exceed invoiceVdsCap(); the TDS section (when given) must exist.
 * Throws 422. This is the friendly pre-check — settleInvoicePayment() enforces
 * the cap again atomically when it books the VDS.
 */
export async function assertWithholdingAllowed(invoice, w, { date = new Date(), pendingVds = 0 } = {}) {
  if (!hasWithholding(w)) return
  // A certificate is issued for a deduction already made — it cannot predate it
  // (same rule as the certificates route; else note 29 claims VDS a period early).
  const dedDay = dhakaDayKey(date ?? new Date())
  for (const [field, amt, label] of [
    ['vdsCertificateDate', w.vdsAmount, 'VDS certificate (Mushak-6.6)'],
    ['tdsCertificateDate', w.tdsAmount, 'TDS certificate'],
  ]) {
    const certDate = toNum(amt) > 0 && w[field] ? new Date(w[field]) : null
    if (certDate && !Number.isNaN(certDate.getTime()) && dhakaDayKey(certDate) < dedDay) {
      throw paymentError(`The ${label} date is before the deduction (${dedDay})`, 422, { field })
    }
  }
  if (!invoice) throw paymentError('VDS / TDS withheld can only be recorded against an invoice — link the payment to an invoice')
  const cur = String(invoice.currency || 'BDT').toUpperCase()
  if (cur !== 'BDT') {
    throw paymentError(`Tax withheld at source can only be recorded on BDT invoices (${invoiceLabel(invoice)} is in ${cur})`)
  }
  if (toNum(w.vdsAmount) > 0) {
    // VDS is deducted from the VAT only (never the SD), as the VAT stands after
    // the invoice's issued notes — see invoiceVdsCap().
    const capInfo = await invoiceVdsCap(invoice)
    if (capInfo) {
      const { cap, vatAmount, creditVat, debitVat, treatment } = capInfo
      if (cap <= 0) {
        throw paymentError(
          treatment === 'NONE'
            ? 'This invoice carries no VAT, so no VDS can be withheld from it'
            : vatAmount > 0
              ? 'The VAT on this invoice has been fully credited by credit notes, so no VDS can be withheld from it'
              : 'This invoice carries no VAT (zero-rated / exempt), so no VDS can be withheld from it',
          422, { field: 'vdsAmount' },
        )
      }
      const withheld = toNum(invoice.withheldVds)
      const pending = Math.max(0, round2(toNum(pendingVds)))
      const already = round2(withheld + pending)
      if (already + toNum(w.vdsAmount) > cap + EPS) {
        const notesText = creditVat > 0 || debitVat > 0 ? ' after credit / debit notes' : ''
        const used = [
          withheld > 0 ? `${formatMoney(withheld, 'BDT')} already withheld` : null,
          pending > 0 ? `${formatMoney(pending, 'BDT')} in pending payment requests` : null,
        ].filter(Boolean)
        throw paymentError(
          `VDS cannot exceed the VAT on the invoice${notesText} (${formatMoney(cap, 'BDT')}${used.length ? `; ${used.join(', ')}, ${formatMoney(Math.max(0, round2(cap - already)), 'BDT')} left` : ''})`,
          422, { field: 'vdsAmount' },
        )
      }
    }
  }
  if (toNum(w.tdsAmount) > 0 && w.tdsSection) {
    const section = await getTdsSection(w.tdsSection, date ?? new Date())
    if (!section) throw paymentError(`Unknown TDS section ${w.tdsSection}`, 422, { field: 'tdsSection' })
  }
}

/**
 * Money account a receipt is posted to: must exist, be ACTIVE, hold the receipt
 * currency or BDT, and not open after `date`. null/'' ⇒ null. Throws 409/422.
 */
export async function loadPostingAccount(accountId, { currency = 'BDT', date = null } = {}) {
  if (accountId === null || accountId === undefined || accountId === '') return null
  if (!isValidObjectId(accountId)) throw paymentError('Invalid money account', 422, { field: 'accountId' })
  const account = await MoneyAccount.findById(accountId)
    .select('name type currency status openingDate isBankingChannel allowNegative creditLimit openingBalance last4')
    .lean()
  if (!account) throw paymentError('Money account not found', 422, { field: 'accountId' })
  if (account.status !== 'ACTIVE') throw paymentError(`${account.name} is archived — choose an active account`, 409, { field: 'accountId' })
  const ac = String(account.currency || 'BDT').toUpperCase()
  const tc = String(currency || 'BDT').toUpperCase()
  if (ac !== tc && ac !== 'BDT') {
    throw paymentError(`${account.name} holds ${ac}; a ${tc} receipt must go to a ${tc} or BDT account`, 422, { field: 'accountId' })
  }
  if (date && account.openingDate && new Date(date) < dhakaDayStart(account.openingDate)) {
    throw paymentError(`The date is before ${account.name}'s opening balance date — earlier receipts are already in its opening balance`, 422, { field: 'date' })
  }
  return account
}

/** Books lock + go-live account rule, checked up front so callers fail before claiming anything. */
export async function preflightPosting({ date, accountId = null, cash = 0 } = {}) {
  const locked = await assertBooksOpen(date)
  if (locked) throw paymentError(locked, 409, { code: 'BOOKS_LOCKED' })
  if (toNum(cash) > 0) {
    const missing = await requireAccountIfLive(date, accountId || null)
    if (missing) throw paymentError(missing, 422, { code: 'ACCOUNT_REQUIRED', field: 'accountId' })
  }
}

/** Ledger description of a settlement. */
export function settlementDescription({ cash = 0, vds = 0, tds = 0, note = null, label = null } = {}) {
  const parts = []
  if (toNum(cash) > 0) parts.push(note ? `Payment received: ${note}` : 'Payment received')
  else parts.push(note ? `Tax withheld at source: ${note}` : 'Tax withheld at source by client')
  const wh = []
  if (toNum(vds) > 0) wh.push(`VDS ${formatMoney(vds, 'BDT')}`)
  if (toNum(tds) > 0) wh.push(`TDS ${formatMoney(tds, 'BDT')}`)
  let text = parts[0]
  if (wh.length) text += toNum(cash) > 0 ? ` (+ ${wh.join(', ')} withheld)` : ` (${wh.join(', ')})`
  if (label) text += ` — ${label}`
  return text
}

// ─────────────────────────────────────────────────────────────────────────────
// Atomic counters
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sum of PENDING_CONFIRMATION settlement amounts (cash + VDS + TDS) matching
 * `filter` — money already claimed but not yet confirmed, so it must not be
 * requested again. `filter` holds id fields only, e.g. { invoiceId } or { projectId }.
 */
export async function pendingPaymentTotal(filter, { excludeId = null } = {}) {
  // aggregate() does not cast, so id values must be real ObjectIds
  const oid = (v) => (v instanceof mongoose.Types.ObjectId ? v : new mongoose.Types.ObjectId(String(v?._id ?? v)))
  const match = { status: 'PENDING_CONFIRMATION' }
  for (const [k, v] of Object.entries(filter)) match[k] = v == null ? v : oid(v)
  if (excludeId) match._id = { $ne: oid(excludeId) }
  const [row] = await ProjectPayment.aggregate([
    { $match: match },
    { $group: { _id: null, total: { $sum: { $add: [num('amount'), num('vdsAmount'), num('tdsAmount')] } } } },
  ])
  return round2(Number(row?.total ?? 0))
}

/**
 * Atomically apply `amount` to an invoice and recompute its status.
 * Only succeeds while the invoice is payable and the amount fits inside the
 * outstanding balance (0.01 tolerance). (There is no "cap" mode any more: an
 * over-receipt is refused, never booked as invoice revenue.)
 *
 * @returns {Promise<object|null>} the updated invoice (lean), or null when the
 *          invoice is missing, not payable, or the amount exceeds its balance.
 */
export async function applyInvoicePayment(invoiceId, amount, paidAt = new Date()) {
  const amt = Number(amount)
  if (!invoiceId || !Number.isFinite(amt) || amt <= 0) return null
  const settled = { $lte: [{ $subtract: [num('total'), '$paidAmount'] }, 0.01] }
  const filter = {
    _id: invoiceId,
    status: { $in: PAYABLE_INVOICE_STATUSES },
    $expr: { $lte: [{ $add: [num('paidAmount'), amt] }, { $add: [num('total'), 0.01] }] },
  }
  return Invoice.findOneAndUpdate(
    filter,
    [
      { $set: { paidAmount: { $round: [{ $min: [{ $add: [num('paidAmount'), amt] }, num('total')] }, 2] } } },
      { $set: {
        status: { $cond: [settled, 'PAID', 'PARTIALLY_PAID'] },
        paidAt: { $cond: [{ $and: [settled, { $eq: [{ $ifNull: ['$paidAt', null] }, null] }] }, paidAt, '$paidAt'] },
      } },
    ],
    { new: true },
  ).lean()
}

/**
 * Compensation for applyInvoicePayment(): atomically take `amount` back off the
 * invoice's settled amount and recompute its status — PAID if still fully
 * settled (another payment landed meanwhile), else OVERDUE when it was overdue,
 * PARTIALLY_PAID while something remains settled, SENT otherwise. Invoices that
 * left the payable/paid states meanwhile keep their status.
 * @returns {Promise<object|null>} the updated invoice (lean)
 */
export async function revertInvoicePayment(invoiceId, amount, { priorStatus = null, priorPaidAt = null } = {}) {
  const amt = Number(amount)
  if (!invoiceId || !Number.isFinite(amt) || amt <= 0) return null
  const wasOverdue = priorStatus === 'OVERDUE'
  return Invoice.findOneAndUpdate(
    { _id: invoiceId, status: { $in: [...PAYABLE_INVOICE_STATUSES, 'PAID'] } },
    [
      { $set: { paidAmount: { $round: [{ $max: [{ $subtract: [num('paidAmount'), amt] }, 0] }, 2] } } },
      { $set: {
        status: { $switch: {
          branches: [
            { case: { $lte: [{ $subtract: [num('total'), '$paidAmount'] }, 0.01] }, then: 'PAID' },
            { case: { $literal: wasOverdue }, then: 'OVERDUE' },
            { case: { $gt: ['$paidAmount', 0.01] }, then: 'PARTIALLY_PAID' },
          ],
          default: 'SENT',
        } },
      } },
      { $set: { paidAt: { $cond: [{ $eq: ['$status', 'PAID'] }, '$paidAt', { $literal: priorPaidAt ?? null }] } } },
    ],
    { new: true },
  ).lean()
}

/**
 * Atomically credit `amount` (BDT, net of output VAT/SD — the project value is a
 * net figure) to a project's paidAmount, keeping the
 * project value at or above what has been paid (the same invariant as
 * models/Project.js growProjectValueToPaid, which only runs on doc.save()).
 */
export async function creditProjectPaid(projectId, amount) {
  const amt = Number(amount)
  if (!projectId || !Number.isFinite(amt) || amt <= 0) return
  await Project.updateOne({ _id: projectId }, [
    { $set: { paidAmount: { $round: [{ $add: [num('paidAmount'), amt] }, 2] } } },
    { $set: {
      budget: { $cond: [{ $gt: ['$paidAmount', { $add: [num('budget'), 0.01] }] }, '$paidAmount', '$budget'] },
    } },
  ])
}

// ─────────────────────────────────────────────────────────────────────────────
// VAT already recognised on an invoice
// ─────────────────────────────────────────────────────────────────────────────

/**
 * VAT and VAT + SD already carved out of the P&L by earlier (un-reversed) INCOME
 * rows of the invoice, expressed in the INVOICE currency (what
 * vatSdPortionOfSettlement expects as alreadyRecognizedVatOnly / alreadyRecognizedVat).
 * BDT invoices: recognizedVatSdForInvoice. Foreign invoices: each row's BDT
 * tax converted back at that row's own rate (amount / amountBDT), or at the
 * invoice's totalBDT/total rate for rows in another currency. A row that has
 * been reversed (reverseClientSettlement) no longer counts.
 * @returns {Promise<{ total:number, vat:number }>}
 */
export async function recognizedInvoiceTaxSplit(invoice) {
  const id = idOf(invoice?._id ?? invoice?.id ?? invoice)
  if (!id || !isValidObjectId(id)) return { total: 0, vat: 0 }
  const cur = String(invoice?.currency || 'BDT').toUpperCase()
  if (cur === 'BDT') {
    const r = await recognizedVatSdForInvoice(id)
    return { total: r.total, vat: r.vat }
  }

  const reversed = await reversedIncomeRowIds(id)
  const rows = await Transaction.find({
    invoiceId: id, type: 'INCOME', reversalOf: null, tax: { $ne: null },
    ...(reversed.length ? { _id: { $nin: reversed } } : {}),
  })
    .select('amount amountBDT currency tax')
    .lean()
  const invFx = toNum(invoice?.totalBDT) > 0 && toNum(invoice?.total) > 0 ? toNum(invoice.totalBDT) / toNum(invoice.total) : null
  let total = 0
  let vat = 0
  for (const r of rows) {
    const vatBDT = toNum(r.tax?.vatBDT)
    const taxBDT = vatBDT + toNum(r.tax?.sdBDT)
    if (taxBDT <= 0) continue
    const rowCur = String(r.currency || 'BDT').toUpperCase()
    const amt = toNum(r.amount)
    const bdt = toNum(r.amountBDT)
    // invoice currency per BDT for this row
    let rate = null
    if (rowCur === cur && amt > 0 && bdt > 0) rate = amt / bdt
    else if (invFx) rate = 1 / invFx
    if (rate === null) continue
    total += taxBDT * rate
    vat += vatBDT * rate
  }
  return { total: round2(total), vat: round2(vat) }
}

/** VAT + SD already recognised on the invoice, in the invoice currency (recognizedInvoiceTaxSplit().total). */
export async function recognizedInvoiceTax(invoice) {
  return (await recognizedInvoiceTaxSplit(invoice)).total
}

/**
 * VAT + SD carried by the invoice's ISSUED credit / debit notes, in the INVOICE
 * currency (what vatSdPortionOfSettlement expects as creditNoteTax / debitNoteTax),
 * and the VAT-only part of each side (creditNoteVat / debitNoteVat), so the
 * settlement split follows the notes' own VAT : SD mix.
 * Only CREDIT notes settled by ADJUST_INVOICE reduce the tax the cash/withholding
 * settlements can carry — a REFUND note pays the money back instead and carries
 * its own tax reversal. Every ISSUED DEBIT note adds its tax.
 * A side with no notes is null, so the function keeps its ratio estimate from
 * creditedAmount / debitedAmount (0 when nothing was credited / debited).
 * @returns {Promise<{ creditNoteTax: number|null, debitNoteTax: number|null, creditNoteVat: number|null, debitNoteVat: number|null }>}
 */
export async function invoiceNoteTax(invoiceId) {
  const id = idOf(invoiceId)
  if (!id || !isValidObjectId(id)) return { creditNoteTax: null, debitNoteTax: null, creditNoteVat: null, debitNoteVat: null }
  const notes = await CreditNote.find({ invoiceId: id, status: 'ISSUED' })
    .select('kind settlement vatAmount sdAmount')
    .lean()
  const credits = notes.filter(n => n.kind === 'CREDIT' && (n.settlement ?? 'ADJUST_INVOICE') === 'ADJUST_INVOICE')
  const debits = notes.filter(n => n.kind === 'DEBIT')
  const sum = (list) => round2(list.reduce((s, n) => s + toNum(n.vatAmount) + toNum(n.sdAmount), 0))
  const vatOf = (list) => round2(list.reduce((s, n) => s + toNum(n.vatAmount), 0))
  return {
    creditNoteTax: credits.length ? sum(credits) : null,
    debitNoteTax:  debits.length ? sum(debits) : null,
    creditNoteVat: credits.length ? vatOf(credits) : null,
    debitNoteVat:  debits.length ? vatOf(debits) : null,
  }
}

/**
 * VAT only (no SD) of the invoice's ISSUED notes, in the invoice currency — the
 * VDS cap: creditVat = Σ CREDIT notes settled by ADJUST_INVOICE (a REFUND note
 * pays the money back instead), debitVat = Σ DEBIT notes.
 * @returns {Promise<{ creditVat: number, debitVat: number }>}
 */
export async function invoiceNoteVat(invoiceId) {
  const id = idOf(invoiceId)
  if (!id || !isValidObjectId(id)) return { creditVat: 0, debitVat: 0 }
  const notes = await CreditNote.find({ invoiceId: id, status: 'ISSUED' })
    .select('kind settlement vatAmount')
    .lean()
  let creditVat = 0
  let debitVat = 0
  for (const n of notes) {
    if (n.kind === 'CREDIT' && (n.settlement ?? 'ADJUST_INVOICE') === 'ADJUST_INVOICE') creditVat += toNum(n.vatAmount)
    else if (n.kind === 'DEBIT') debitVat += toNum(n.vatAmount)
  }
  return { creditVat: round2(creditVat), debitVat: round2(debitVat) }
}

// ─────────────────────────────────────────────────────────────────────────────
// Settlement
// ─────────────────────────────────────────────────────────────────────────────

async function voidCreatedEntries(entries, userId) {
  for (const e of entries) {
    try {
      await voidTaxEntry(e._id, { reason: 'Rolled back — the payment could not be completed', userId, allowLocked: true })
    } catch (err) {
      console.error('[paymentLedger] could not void rolled-back tax entry — deleting it', String(e._id), err?.message)
      await TaxEntry.deleteOne({ _id: e._id }).catch(e2 => console.error('[paymentLedger] tax entry delete failed', e2))
    }
  }
}

/**
 * Book one client settlement (see module header). All-or-nothing: if any step
 * fails, the steps already done are undone (Transaction deleted, invoice credit
 * and withheld counters reverted, tax entries created here voided) and the
 * error is rethrown (`.status` 409/422 for user errors). The caller owns the
 * ProjectPayment claim and must release / remove it when this throws.
 * The amount credited may never exceed the invoice's outstanding balance, and
 * the VDS is claimed against the invoice's VDS cap in one conditional update,
 * so concurrent settlements can neither overpay the invoice nor over-claim VDS.
 *
 * @param {object} p
 * @param {object|null} p.invoice        FRESH invoice (lean) — null for a project-level payment
 * @param {string|null} [p.projectId]    project credited with the settled BDT amount
 * @param {object|null} [p.projectPayment] ProjectPayment ({ _id }) to link (transactionId, taxEntryIds, settledAmount…)
 * @param {number} p.cash                cash received in `currency` (0 ⇒ withholding-only, NON_CASH row)
 * @param {string} [p.currency]          cash currency (must match the invoice unless invoiceCredit is given)
 * @param {number|null} [p.cashBDT]      BDT equivalent of the cash (required for non-BDT cash)
 * @param {object|null} [p.withholding]  readWithholding() output (BDT invoices only)
 * @param {number|null} [p.invoiceCredit] amount credited to the invoice in the invoice currency (default cash + VDS + TDS)
 * @param {Date} p.date                  ledger / tax date
 * @param {Date} [p.paidAt]              invoice.paidAt when this settles it (default now)
 * @param {string|null} [p.accountId] [p.channel] [p.cheque]
 * @param {object} [p.entry]             extra Transaction fields (category, description, reference, clientId, paymentMethod, receiptUrl, txnId, accountManager…).
 *                                       The row's `unit` is invoiceUnit(invoice); entry.unit is used only without an invoice.
 * @param {object} [p.paymentLink]       extra fields $set on the ProjectPayment on success
 * @param {string|null} [p.userId]
 * @returns {Promise<{ transaction, invoice, taxEntries, credit, cash, cashBDT, grossBDT, vds, tds, vatBDT, sdBDT, plAmountBDT, isFinal }>}
 */
export async function settleInvoicePayment({
  invoice = null,
  projectId = null,
  projectPayment = null,
  cash = 0,
  currency = 'BDT',
  cashBDT = null,
  withholding = null,
  invoiceCredit = null,
  date,
  paidAt = null,
  accountId = null,
  channel = null,
  cheque = null,
  entry = {},
  paymentLink = {},
  userId = null,
} = {}) {
  const w = withholding ?? readWithholding({})
  const vds = round2(toNum(w.vdsAmount))
  const tds = round2(toNum(w.tdsAmount))
  const cashAmt = round2(toNum(cash))
  const cur = String(currency || 'BDT').toUpperCase()
  const when = parseBusinessDate(date)
  if (!when) throw paymentError('A valid payment date is required', 422, { field: 'paymentDate' })
  if (cashAmt < 0) throw paymentError('Amount cannot be negative', 422, { field: 'amount' })
  if (!(cashAmt > 0) && !(vds + tds > 0)) throw paymentError('Enter the amount received or the tax withheld', 422, { field: 'amount' })
  if (vds + tds > 0) await assertWithholdingAllowed(invoice, w, { date: when })

  let bdtCash = 0
  if (cashAmt > 0) {
    if (cur === 'BDT') {
      bdtCash = cashAmt
    } else {
      bdtCash = round2(toNum(cashBDT))
      if (!(bdtCash > 0)) throw paymentError(`Enter the BDT amount received for this ${cur} payment`, 422, { field: 'amountBDT' })
    }
  }
  const grossBDT = round2(bdtCash + vds + tds)

  // ── invoice credit & VAT split (SPEC §8) ──
  const invoiceId = invoice ? idOf(invoice._id ?? invoice.id) : null
  let credit = 0
  let outstanding = 0
  let taxSplit = null
  let isFinal = false
  let vatBDT = 0
  let sdBDT = 0
  if (invoiceId) {
    const invCur = String(invoice.currency || 'BDT').toUpperCase()
    if (invoiceCredit === null || invoiceCredit === undefined) {
      if (cashAmt > 0 && cur !== invCur) {
        throw paymentError(`${invoiceLabel(invoice)} is in ${invCur}; record the payment in ${invCur}`, 422, { field: 'currency' })
      }
      credit = round2(cashAmt + vds + tds)
    } else {
      credit = round2(toNum(invoiceCredit))
    }
    if (!(credit > 0)) throw paymentError('Nothing to credit to the invoice', 422)
    outstanding = invoiceOutstanding(invoice)
    if (credit > outstanding + EPS) {
      throw paymentError(`Amount exceeds the invoice's outstanding balance of ${invCur} ${Math.max(0, outstanding).toFixed(2)}`, 409)
    }
    const settled = round2(Math.min(credit, Math.max(0, outstanding)))
    isFinal = settled >= outstanding - EPS
    // Both read BEFORE the new ledger row is posted.
    const [already, noteTax] = await Promise.all([recognizedInvoiceTaxSplit(invoice), invoiceNoteTax(invoiceId)])
    const portion = vatSdPortionOfSettlement(invoice, settled, {
      alreadyRecognizedVat:     already.total,
      alreadyRecognizedVatOnly: already.vat,
      isFinal,
      creditNoteTax: noteTax.creditNoteTax,
      debitNoteTax:  noteTax.debitNoteTax,
      creditNoteVat: noteTax.creditNoteVat,
      debitNoteVat:  noteTax.debitNoteVat,
    })
    // BDT per unit of invoice currency for this settlement
    const fx = invCur === 'BDT' ? 1 : (credit > 0 ? bdtCash / credit : 0)
    vatBDT = round2(portion.vat * fx)
    sdBDT = round2(portion.sd * fx)
    taxSplit = { grossBDT, vatBDT, sdBDT, vdsBDT: vds, tdsBDT: tds }
  }
  const plAmount = taxSplit ? Math.max(0, round2(grossBDT - vatBDT - sdBDT)) : null
  // Business unit: an invoice's settlement always follows the invoice (invoiceUnit);
  // a project-level payment without one takes entry.unit, else the project's venture.
  const unit = !invoiceId && typeof entry.unit === 'string' && entry.unit
    ? entry.unit
    : await invoiceUnit(invoiceId ? invoice : null, { projectId: entry.projectId ?? projectId })

  const undo = []
  const runUndo = async () => {
    for (const fn of undo.reverse()) {
      try { await fn() } catch (err) { console.error('[paymentLedger] compensation step failed', err) }
    }
  }

  let tx = null
  let updatedInvoice = null
  let entries = []
  try {
    // 0. Settlement breakdown on the invoice, claimed first: the VDS cap is
    //    checked inside the same conditional update, so of two concurrent
    //    settlements only the ones that still fit under it go through
    //    (assertWithholdingAllowed read invoice.withheldVds before either wrote).
    if (invoiceId && (vds > 0 || tds > 0)) {
      const capInfo = vds > 0 ? await invoiceVdsCap(invoice) : null
      const filter = { _id: invoiceId }
      if (capInfo) filter.$expr = { $lte: [{ $add: [num('withheldVds'), vds] }, capInfo.cap + EPS] }
      const res = await Invoice.updateOne(filter, [
        { $set: {
          withheldVds: { $round: [{ $add: [num('withheldVds'), vds] }, 2] },
          withheldTds: { $round: [{ $add: [num('withheldTds'), tds] }, 2] },
        } },
      ])
      if (!res.matchedCount) {
        const current = await Invoice.findById(invoiceId).select('withheldVds').lean()
        if (!current) throw paymentError('The invoice no longer exists', 409)
        const cap = capInfo?.cap ?? 0
        const already = round2(toNum(current.withheldVds))
        throw paymentError(
          `VDS cannot exceed the VAT on the invoice (${formatMoney(cap, 'BDT')}; ${formatMoney(already, 'BDT')} already withheld, ${formatMoney(Math.max(0, round2(cap - already)), 'BDT')} left) — another settlement recorded VDS on it meanwhile`,
          409, { field: 'vdsAmount' },
        )
      }
      undo.push(() => Invoice.updateOne({ _id: invoiceId }, [
        { $set: {
          withheldVds: { $round: [{ $max: [{ $subtract: [num('withheldVds'), vds] }, 0] }, 2] },
          withheldTds: { $round: [{ $max: [{ $subtract: [num('withheldTds'), tds] }, 0] }, 2] },
        } },
      ]))
    }

    // 1. Ledger row
    const base = {
      ...entry,
      category: (typeof entry.category === 'string' && entry.category.trim()) || PROJECT_REVENUE_CATEGORY,
      invoiceId: invoiceId ?? entry.invoiceId ?? null,
      projectId: entry.projectId ?? projectId ?? null,
      unit,
      date: when,
    }
    if (cashAmt > 0) {
      tx = await postMoneyEntry({
        ...base,
        type: 'INCOME',
        kind: 'OPERATING',
        amount: cashAmt,
        currency: cur,
        amountBDT: bdtCash,
        accountId: accountId || null,
        channel: channel || null,
        cheque: cheque || null,
        ...(taxSplit ? { plAmountBDT: plAmount, tax: taxSplit } : {}),
      }, { userId })
    } else {
      tx = await postMoneyEntry({
        ...base,
        type: 'INCOME',
        kind: 'NON_CASH',
        amount: grossBDT,
        currency: 'BDT',
        amountBDT: grossBDT,
        accountId: null,
        channel: null,
        paymentMethod: WITHHOLDING_PAYMENT_METHOD,
        plAmountBDT: plAmount ?? grossBDT,
        tax: taxSplit ?? { grossBDT, vatBDT: 0, sdBDT: 0, vdsBDT: vds, tdsBDT: tds },
      }, { userId })
    }
    const txId = tx._id
    undo.push(() => Transaction.deleteOne({ _id: txId }))

    // 2. Invoice credit (atomic; refuses when it no longer fits). The withheld
    //    counters were claimed in step 0, so the returned invoice includes them.
    if (invoiceId) {
      const priorStatus = invoice.status ?? null
      const priorPaidAt = invoice.paidAt ?? null
      updatedInvoice = await applyInvoicePayment(invoiceId, credit, paidAt ?? new Date())
      if (!updatedInvoice) {
        throw paymentError('The invoice was paid or changed in the meantime — this payment no longer fits its balance', 409)
      }
      undo.push(() => revertInvoicePayment(invoiceId, credit, { priorStatus, priorPaidAt }))
    }

    // 3. Tax sub-ledger (VDS_RECEIVABLE / TDS_RECEIVABLE)
    if (vds > 0 || tds > 0) {
      const ppId = projectPayment?._id ?? null
      const before = ppId
        ? new Set((await TaxEntry.find({ projectPaymentId: ppId, status: 'ACTIVE' }).distinct('_id')).map(String))
        : new Set()
      entries = await recordCustomerWithholding({
        invoice,
        // minimal reference — certificate / section values come from `w` only
        projectPayment: ppId ? { _id: ppId, clientId: invoice?.clientId ?? null, invoiceId } : null,
        vdsAmount: vds,
        tdsAmount: tds,
        tdsSection: w.tdsSection,
        vdsCertificate: w.vdsCertificateNo ? { number: w.vdsCertificateNo, date: w.vdsCertificateDate } : null,
        tdsCertificate: w.tdsCertificateNo ? { number: w.tdsCertificateNo, date: w.tdsCertificateDate } : null,
        date: when,
        userId,
        transactionId: txId,
        settledAmount: credit,
      })
      const created = entries.filter(e => !before.has(String(e._id)))
      if (created.length) undo.push(() => voidCreatedEntries(created, userId))
    }

    // 4. Link ids
    const taxEntryIds = entries.map(e => e._id)
    if (taxEntryIds.length) {
      await Transaction.updateOne({ _id: txId }, { $set: { taxEntryIds } })
      tx.taxEntryIds = taxEntryIds
    }
    if (projectPayment?._id) {
      const res = await ProjectPayment.updateOne({ _id: projectPayment._id }, {
        $set: {
          ...paymentLink,
          transactionId:      txId,
          taxEntryIds,
          settledAmount:      invoiceId ? credit : cashAmt,
          accountId:          tx.accountId ?? null,
          channel:            tx.channel ?? null,
          vdsAmount:          vds,
          tdsAmount:          tds,
          tdsSection:         tds > 0 ? (w.tdsSection ?? null) : null,
          vdsCertificateNo:   vds > 0 ? (w.vdsCertificateNo ?? null) : null,
          vdsCertificateDate: vds > 0 ? (w.vdsCertificateDate ?? null) : null,
          tdsCertificateNo:   tds > 0 ? (w.tdsCertificateNo ?? null) : null,
          tdsCertificateDate: tds > 0 ? (w.tdsCertificateDate ?? null) : null,
        },
      })
      if (!res.matchedCount) throw paymentError('The payment record was removed while it was being confirmed', 409)
    }
  } catch (err) {
    await runUndo()
    throw err
  }

  // 5. Project value is tracked in BDT — non-fatal once the settlement is booked.
  if (projectId) {
    try {
      // Project value is net of VAT/SD (InvoiceForm billedNet), so credit only the non-tax part.
      await creditProjectPaid(projectId, plAmount ?? grossBDT)
    } catch (err) {
      console.error('[paymentLedger] crediting the project failed', String(projectId), err)
    }
  }

  return {
    transaction: tx,
    invoice:     updatedInvoice,
    taxEntries:  entries,
    credit,
    cash:        cashAmt,
    cashBDT:     bdtCash,
    grossBDT,
    vds,
    tds,
    vatBDT,
    sdBDT,
    plAmountBDT: plAmount ?? bdtCash,
    isFinal,
  }
}

/** Compact JSON summary of a settlement result for API responses. */
export function settlementSummary(result) {
  if (!result) return null
  const tx = result.transaction
  return {
    transaction: tx ? {
      id:          String(tx._id),
      txnId:       tx.txnId ?? null,
      kind:        tx.kind,
      amount:      Number(tx.amount),
      currency:    tx.currency,
      amountBDT:   tx.amountBDT,
      accountId:   tx.accountId ? String(tx.accountId) : null,
      channel:     tx.channel ?? null,
      plAmountBDT: tx.plAmountBDT,
      tax:         tx.tax ?? null,
    } : null,
    taxEntries: (result.taxEntries ?? []).map(e => ({
      id:                String(e._id),
      entryNo:           e.entryNo ?? null,
      entryType:         e.entryType,
      amount:            e.amount,
      section:           e.section ?? null,
      certificateStatus: e.certificate?.status ?? null,
    })),
    invoice: result.invoice ? {
      id:          String(result.invoice._id),
      status:      result.invoice.status,
      paidAmount:  Number(result.invoice.paidAmount) || 0,
      total:       Number(result.invoice.total) || 0,
      withheldVds: Number(result.invoice.withheldVds) || 0,
      withheldTds: Number(result.invoice.withheldTds) || 0,
    } : null,
    settled:     result.credit,
    grossBDT:    result.grossBDT,
    vatBDT:      result.vatBDT,
    sdBDT:       result.sdBDT,
    plAmountBDT: result.plAmountBDT,
    isFinal:     result.isFinal,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Reversal (a booked client settlement → undone, to be recorded again)
// ─────────────────────────────────────────────────────────────────────────────

const FILED_RETURN_STATUSES = ['FILED', 'AMENDED']
const FILING_KIND_LABELS = {
  VAT_RETURN: 'VAT return', WHT_RETURN: 'withholding tax return',
  ADVANCE_TAX: 'advance tax return', INCOME_TAX_RETURN: 'income tax return',
}
const CUSTOMER_WITHHOLDING_TYPES = ['VDS_RECEIVABLE', 'TDS_RECEIVABLE']

/** Reason for a reversal (5–500 characters, trimmed); throws 422 otherwise. */
export function readReversalReason(reason) {
  const why = typeof reason === 'string' ? reason.trim() : ''
  if (why.length < 5) throw paymentError('Give a reason for reversing the payment (at least 5 characters)', 422, { field: 'reason' })
  if (why.length > 500) throw paymentError('The reason is too long (max 500 characters)', 422, { field: 'reason' })
  return why
}

/**
 * Atomically take a settlement back off an invoice: paidAmount −= settled,
 * withheldVds −= vds, withheldTds −= tds, status recomputed (PAID while still
 * fully settled, else OVERDUE when past due, PARTIALLY_PAID while something is
 * settled, SENT otherwise) and paidAt cleared unless still PAID. Guarded in the
 * same update: the invoice must still hold the settlement and the cash left on
 * it must still cover `refunded` (money repaid by REFUND credit notes).
 * @returns {Promise<object|null>} the updated invoice (lean), null when a guard failed
 */
async function takeSettlementOffInvoice(invoiceId, { settled, vds = 0, tds = 0, refunded = 0, wasOverdue = false }) {
  const minus = (field, amt) => ({ $subtract: [num(field), amt] })
  const cashLeft = {
    $subtract: [
      { $subtract: [{ $subtract: [minus('paidAmount', settled), num('creditedAmount')] }, minus('withheldVds', vds)] },
      minus('withheldTds', tds),
    ],
  }
  return Invoice.findOneAndUpdate(
    {
      _id: invoiceId,
      status: { $in: [...PAYABLE_INVOICE_STATUSES, 'PAID'] },
      $expr: { $and: [
        { $gte: [num('paidAmount'), settled - EPS] },
        { $gte: [num('withheldVds'), vds - EPS] },
        { $gte: [num('withheldTds'), tds - EPS] },
        { $gte: [cashLeft, refunded - EPS] },
      ] },
    },
    [
      { $set: {
        paidAmount:  { $round: [{ $max: [minus('paidAmount', settled), 0] }, 2] },
        withheldVds: { $round: [{ $max: [minus('withheldVds', vds), 0] }, 2] },
        withheldTds: { $round: [{ $max: [minus('withheldTds', tds), 0] }, 2] },
      } },
      { $set: {
        status: { $switch: {
          branches: [
            { case: { $lte: [{ $subtract: [num('total'), '$paidAmount'] }, 0.01] }, then: 'PAID' },
            { case: { $literal: !!wasOverdue }, then: 'OVERDUE' },
            { case: { $gt: ['$paidAmount', 0.01] }, then: 'PARTIALLY_PAID' },
          ],
          default: 'SENT',
        } },
      } },
      { $set: { paidAt: { $cond: [{ $eq: ['$status', 'PAID'] }, '$paidAt', null] } } },
    ],
    { new: true },
  ).lean()
}

/** Compensation for takeSettlementOffInvoice(): put the settlement back (best effort, unguarded). */
function restoreSettlementOnInvoice(invoiceId, { settled, vds = 0, tds = 0, paidAt = null }) {
  const settledNow = { $lte: [{ $subtract: [num('total'), '$paidAmount'] }, 0.01] }
  return Invoice.updateOne({ _id: invoiceId }, [
    { $set: {
      paidAmount:  { $round: [{ $add: [num('paidAmount'), settled] }, 2] },
      withheldVds: { $round: [{ $add: [num('withheldVds'), vds] }, 2] },
      withheldTds: { $round: [{ $add: [num('withheldTds'), tds] }, 2] },
    } },
    { $set: {
      status: { $cond: [
        settledNow, 'PAID',
        { $cond: [{ $and: [{ $eq: ['$status', 'SENT'] }, { $gt: ['$paidAmount', 0.01] }] }, 'PARTIALLY_PAID', '$status'] },
      ] },
    } },
    { $set: {
      paidAt: { $cond: [
        { $and: [{ $eq: ['$status', 'PAID'] }, { $eq: [{ $ifNull: ['$paidAt', null] }, null] }] },
        { $literal: paidAt ?? new Date() },
        '$paidAt',
      ] },
    } },
  ])
}

/**
 * Undo one booked client settlement so it can be recorded again correctly —
 * the income-side counterpart of reverseExpensePayment (lib/expensePayment.js).
 *
 * Target: a CONFIRMED ProjectPayment (`paymentId`), or a ledger row
 * (`transactionId`). A ledger row of a confirmed payment is reversed as that
 * payment; any other receipt booked against an invoice by settleInvoicePayment
 * (manual ledger income, POST /api/transactions) is reversed on its own.
 *
 *   pre-checks → claim (ProjectPayment CONFIRMED → REVERSING; for a bare ledger
 *   row the reversing entry is the claim — reversalOf is unique) → reversing
 *   ledger row dated today (reverseMoneyEntry: the cash goes back out of the
 *   account, the P&L amount is reversed) → the settled amount (cash + VDS + TDS)
 *   and the withheld VDS / TDS taken back off the invoice in one guarded update,
 *   status recomputed → VDS_RECEIVABLE / TDS_RECEIVABLE voided → the project's
 *   paidAmount reduced by the P&L amount it was credited → ProjectPayment REVERSED.
 * Any failure undoes the steps already taken and releases the claim. The
 * reversed row's VAT / SD stop counting as recognised on the invoice
 * (recognizedVatSdForInvoice leaves reversed rows out), so a payment recorded
 * again gets the right VAT split.
 *
 * Refused (409) when: the payment is not CONFIRMED (or already reversed / being
 * reversed) or has no ledger entry; the books are locked for the payment date or
 * today; the account it went into is archived; a VDS / TDS entry is in a filed
 * return or was claimed in one (record an adjustment instead) or is dated in
 * locked books; the invoice no longer holds this settlement or is cancelled;
 * REFUND credit notes repaid more than the cash that would remain (cancel the
 * refund note first). 422 for a missing / short reason.
 *
 * @param {{ paymentId?: string, transactionId?: string, reason: string, userId?: string }} p
 * @returns {Promise<{ payment, transaction, reversal, invoice, voidedEntries, settled, vds, tds, projectId, projectReducedBDT }>}
 *   payment: the REVERSED ProjectPayment document (null for a bare ledger row);
 *   transaction: the original row (lean); reversal: the reversing Transaction;
 *   invoice: the updated invoice (lean) or null; voidedEntries [{ entryNo, entryType, amount }]
 */
export async function reverseClientSettlement({ paymentId = null, transactionId = null, reason, userId = null } = {}) {
  const why = readReversalReason(reason)

  // ── The payment and its ledger row ──
  let pp = null
  let tx = null
  if (paymentId) {
    if (!isValidObjectId(String(paymentId))) throw paymentError('Not found', 404)
    pp = await ProjectPayment.findById(paymentId).lean()
    if (!pp) throw paymentError('Not found', 404)
  } else {
    if (!transactionId || !isValidObjectId(String(transactionId))) throw paymentError('Not found', 404)
    tx = await Transaction.findById(transactionId).lean()
    if (!tx) throw paymentError('Not found', 404)
    pp = await ProjectPayment.findOne({ transactionId: tx._id }).lean()
  }
  if (pp) {
    if (pp.status === 'REVERSING') throw paymentError('This payment is already being reversed', 409)
    if (pp.status === 'REVERSED') throw paymentError('This payment has already been reversed', 409)
    if (pp.status !== 'CONFIRMED') throw paymentError('Only a confirmed payment can be reversed — reject a pending request instead', 409)
    if (!pp.transactionId) throw paymentError('This payment has no ledger entry, so there is nothing to reverse', 409)
    if (!tx) tx = await Transaction.findById(pp.transactionId).lean()
    if (!tx) throw paymentError('The ledger entry of this payment no longer exists — check it in Accounts → Transactions', 409)
  }
  if (tx.type !== 'INCOME') throw paymentError('Only a client receipt (income entry) can be reversed here', 409)
  if (tx.reversalOf) throw paymentError('This entry is itself a reversal', 409)
  if (!pp && (!tx.invoiceId || !tx.tax)) {
    // Other income rows carry no invoice settlement — they are edited in Accounts instead.
    throw paymentError('Only a client receipt recorded against an invoice can be reversed here', 409)
  }
  const existingReversal = await Transaction.findOne({ reversalOf: tx._id }).select('txnId').lean()
  if (existingReversal) throw paymentError(`This entry was already reversed (${existingReversal.txnId ?? existingReversal._id})`, 409)

  // ── Pre-checks: nothing is claimed or written for a reversal that cannot finish ──
  const now = new Date()
  const todayLocked = await assertBooksOpen(now)
  if (todayLocked) throw paymentError(`${todayLocked} — the reversing entry cannot be posted today`, 409, { code: 'BOOKS_LOCKED' })
  for (const d of [tx.date, pp?.paymentDate]) {
    if (!d) continue
    const locked = await assertBooksOpen(d)
    if (locked) throw paymentError(`${locked} — the payment of ${dhakaDayKey(new Date(d))} cannot be reversed`, 409, { code: 'BOOKS_LOCKED' })
  }
  if (tx.accountId) {
    const acct = await MoneyAccount.findById(tx.accountId).select('name status').lean()
    if (acct && acct.status !== 'ACTIVE') throw paymentError(`${acct.name} is archived — reactivate it to reverse this payment`, 409, { field: 'accountId' })
  }

  // VDS / TDS receivables the settlement recorded.
  const linkedIds = [...(pp?.taxEntryIds ?? []), ...(tx.taxEntryIds ?? [])]
    .map(idOf).filter(v => v && isValidObjectId(String(v)))
  const entryOr = [{ transactionId: tx._id }]
  if (pp) entryOr.push({ projectPaymentId: pp._id })
  if (linkedIds.length) entryOr.push({ _id: { $in: linkedIds } })
  const entries = await TaxEntry.find({
    status: 'ACTIVE', isOpening: { $ne: true }, entryType: { $in: CUSTOMER_WITHHOLDING_TYPES }, $or: entryOr,
  }).select('entryNo entryType amount date filingId claimPeriod').sort({ createdAt: 1 }).lean()
  const filingIds = [...new Set(entries.map(e => (e.filingId ? String(e.filingId) : null)).filter(Boolean))]
  const filings = filingIds.length
    ? await TaxFiling.find({ _id: { $in: filingIds }, status: { $in: FILED_RETURN_STATUSES } }).select('kind periodKey').lean()
    : []
  const filedById = new Map(filings.map(f => [String(f._id), f]))
  const blockers = []
  for (const e of entries) {
    const filed = e.filingId ? filedById.get(String(e.filingId)) : null
    if (filed) {
      blockers.push(`${e.entryNo} is in the filed ${FILING_KIND_LABELS[filed.kind] ?? 'return'} ${filed.periodKey} — record an adjustment in the next return instead`)
    } else if (e.claimPeriod) {
      blockers.push(`${e.entryNo} was claimed in the filed VAT return for ${periodLabel(e.claimPeriod)} — record an adjustment in the next return instead`)
    }
    // The VDS receivable steps over the VAT lock (it is claimed in the first
    // open return, as when it was recorded) — the books lock still applies to both.
    const locked = await assertBooksOpen(e.date)
    if (locked) blockers.push(`${e.entryNo}: ${locked}`)
  }
  if (blockers.length) {
    throw paymentError(`This payment cannot be reversed: ${blockers[0]}${blockers.length > 1 ? ` (and ${blockers.length - 1} more)` : ''}`, 409)
  }

  // Invoice: what this settlement credited to it (invoice currency).
  const invoiceId = idOf(pp?.invoiceId ?? tx.invoiceId)
  const vds = round2(toNum(pp ? pp.vdsAmount : tx.tax?.vdsBDT))
  const tds = round2(toNum(pp ? pp.tdsAmount : tx.tax?.tdsBDT))
  let invoice = null
  let settled = 0
  let refunded = 0
  let wasOverdue = false
  if (invoiceId) {
    invoice = await Invoice.findById(invoiceId).lean()
    if (!invoice) throw paymentError('The invoice of this payment no longer exists', 409)
    if (![...PAYABLE_INVOICE_STATUSES, 'PAID'].includes(invoice.status)) {
      throw paymentError(`${invoiceLabel(invoice)} is ${String(invoice.status).toLowerCase()} — its payments cannot be reversed`, 409)
    }
    const invCur = String(invoice.currency || 'BDT').toUpperCase()
    if (pp) {
      settled = pp.settledAmount !== null && pp.settledAmount !== undefined
        ? round2(toNum(pp.settledAmount))
        : round2(toNum(pp.amount) + vds + tds)
    } else {
      const txCur = String(tx.currency || 'BDT').toUpperCase()
      settled = txCur === invCur ? round2(toNum(tx.amount)) : (invCur === 'BDT' ? round2(toNum(tx.amountBDT)) : 0)
    }
    if (!(settled > 0)) throw paymentError(`It is not clear how much of ${invoiceLabel(invoice)} this receipt settled — it cannot be reversed automatically`, 409)

    const paid = toNum(invoice.paidAmount)
    const credited = toNum(invoice.creditedAmount)
    const wVds = toNum(invoice.withheldVds)
    const wTds = toNum(invoice.withheldTds)
    if (paid + EPS < settled || wVds + EPS < vds || wTds + EPS < tds) {
      throw paymentError(`${invoiceLabel(invoice)} no longer holds this payment (${formatMoney(paid, invCur)} settled) — it cannot be reversed automatically`, 409)
    }
    const refunds = await CreditNote.find({ invoiceId, status: 'ISSUED', kind: 'CREDIT', settlement: 'REFUND' }).select('totalAmount').lean()
    refunded = round2(refunds.reduce((s, n) => s + toNum(n.totalAmount), 0))
    const cashLeft = round2(paid - settled - credited - (wVds - vds) - (wTds - tds))
    if (refunded > 0 && cashLeft + EPS < refunded) {
      throw paymentError(
        `Refund notes (Mushak-6.7) repaid ${formatMoney(refunded, invCur)} of the money received on ${invoiceLabel(invoice)}; without this payment only ${formatMoney(Math.max(0, cashLeft), invCur)} would remain — cancel the refund note first`,
        409,
      )
    }
    wasOverdue = !!invoice.dueDate && new Date(invoice.dueDate) < dhakaDayStart()
  }

  // Project: the P&L amount it was credited (settleInvoicePayment → creditProjectPaid).
  const projectId = idOf(pp ? pp.projectId : (invoice?.projectId ?? tx.projectId))
  const plCredited = round2(tx.plAmountBDT !== null && tx.plAmountBDT !== undefined
    ? toNum(tx.plAmountBDT)
    : (toNum(tx.tax?.grossBDT) || toNum(tx.amountBDT) || (String(tx.currency || 'BDT').toUpperCase() === 'BDT' ? toNum(tx.amount) : 0)))

  // ── Claim: one reversal at a time, never of a payment that changed meanwhile ──
  if (pp) {
    const claimed = await ProjectPayment.findOneAndUpdate(
      { _id: pp._id, status: 'CONFIRMED', transactionId: tx._id },
      { $set: { status: 'REVERSING' } },
      { new: true },
    )
    if (!claimed) throw paymentError('This payment was changed by someone else — reload it and try again', 409)
  }

  const undo = []
  const voidedEntries = []
  let reversal = null
  let updatedInvoice = null
  let projectReducedBDT = 0
  let done = null
  try {
    // 1. Ledger: the mirror row takes the cash back out of the account (dated
    //    today) and reverses the P&L amount. For a bare ledger row this is the claim.
    reversal = await reverseMoneyEntry(tx._id, { userId, date: now, reason: `client payment reversed — ${why}` })
    const revId = reversal._id
    undo.push(() => Transaction.deleteOne({ _id: revId }))

    // 2. Invoice: settled amount and withheld counters back off, status recomputed.
    if (invoiceId) {
      updatedInvoice = await takeSettlementOffInvoice(invoiceId, { settled, vds, tds, refunded, wasOverdue })
      if (!updatedInvoice) {
        throw paymentError(`${invoiceLabel(invoice)} changed while the payment was being reversed — reload it and try again`, 409)
      }
      const priorPaidAt = invoice.paidAt ?? now
      undo.push(() => restoreSettlementOnInvoice(invoiceId, { settled, vds, tds, paidAt: priorPaidAt }))
    }

    // 3. VDS / TDS receivables. requireActive: an entry voided meanwhile aborts the reversal.
    for (const e of entries) {
      await voidTaxEntry(e._id, {
        reason: `Client payment reversed: ${why}`,
        userId,
        allowLocked: e.entryType === 'VDS_RECEIVABLE',
        requireActive: true,
      })
      undo.push(() => TaxEntry.updateOne(
        { _id: e._id, status: 'VOID' },
        { $set: { status: 'ACTIVE', voidReason: null, voidedBy: null, voidedAt: null } },
      ))
      voidedEntries.push({ entryNo: e.entryNo, entryType: e.entryType, amount: e.amount })
    }

    // 4. Project paid amount (never below 0; the project value is left as it is).
    if (projectId && plCredited > 0) {
      const before = await Project.findOneAndUpdate(
        { _id: projectId },
        [{ $set: { paidAmount: { $round: [{ $max: [{ $subtract: [num('paidAmount'), plCredited] }, 0] }, 2] } } }],
        { new: false, projection: { paidAmount: 1 } },
      ).lean()
      if (before) {
        projectReducedBDT = round2(Math.min(plCredited, Math.max(0, toNum(before.paidAmount))))
        if (projectReducedBDT > 0) {
          const back = projectReducedBDT
          undo.push(() => Project.updateOne({ _id: projectId }, [
            { $set: { paidAmount: { $round: [{ $add: [num('paidAmount'), back] }, 2] } } },
          ]))
        }
      }
    }

    // 5. The payment record
    if (pp) {
      done = await ProjectPayment.findOneAndUpdate(
        { _id: pp._id, status: 'REVERSING' },
        { $set: {
          status:                'REVERSED',
          reversedBy:            userId || null,
          reversedAt:            now,
          reversalReason:        why,
          reversalTransactionId: reversal._id,
        } },
        { new: true },
      )
      if (!done) throw paymentError('This payment was changed while it was being reversed — reload it and try again', 409)
    }
  } catch (err) {
    for (const step of undo.reverse()) {
      await Promise.resolve().then(step)
        .catch(e => console.error('[paymentLedger] reversal compensation step failed', String(tx._id), e))
    }
    if (pp) {
      await ProjectPayment.updateOne({ _id: pp._id, status: 'REVERSING' }, { $set: { status: 'CONFIRMED' } })
        .catch(e => console.error('[paymentLedger] failed to release the reversal claim', String(pp._id), e))
    }
    throw err
  }

  return {
    payment:     done,
    transaction: tx,
    reversal,
    invoice:     updatedInvoice,
    voidedEntries,
    settled,
    vds,
    tds,
    projectId:   projectId ? String(projectId) : null,
    projectReducedBDT,
  }
}
