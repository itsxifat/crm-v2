/**
 * Credit notes (Mushak-6.7) and debit notes (Mushak-6.8) against issued
 * invoices — SERVER-ONLY helpers for /api/credit-notes routes.
 *
 * Effects (SPEC §8 / §10 V2):
 *   CREDIT + ADJUST_INVOICE  invoice.paidAmount += total (applyInvoicePayment) and creditedAmount += total
 *   CREDIT + REFUND          money out: EXPENSE OPERATING 'Sales Returns & Allowances' (P&L = value)
 *   DEBIT                    invoice.total += total, debitedAmount += total, PAID → PARTIALLY_PAID
 *   VAT invoices             CREDIT_NOTE (9.1 note 31/39) / DEBIT_NOTE (note 26/38) TaxEntry
 *
 * There are no Mongo transactions in this codebase: each step is atomic and a
 * failure undoes the earlier steps (delete note and entry, giving their numbers
 * back / reverse money). Issue and cancel hold a per-invoice lease
 * (claimInvoiceNoteLock), so every cap — billed, refundable, VAT, SD — is checked
 * on state that already includes every earlier note on the invoice.
 * Amounts on the note are in the INVOICE currency; tax entries are BDT.
 */

import mongoose from 'mongoose'
import { CreditNote, Invoice, TaxEntry, Transaction } from '@/models'
import { recordTaxEntry, voidTaxEntry } from '@/lib/tax/engine'
import { invoiceTaxTotals, snapshotInvoiceParties } from '@/lib/tax/invoiceVat'
import { round2, CREDIT_NOTE_REASONS, VAT_TREATMENTS } from '@/lib/tax/catalog'
import { applyInvoicePayment, revertInvoicePayment, pendingPaymentTotal } from '@/lib/paymentLedger'
import { postMoneyEntry, preflightMoneyEntry, reverseMoneyEntry } from '@/lib/finance/ledger'
import { assertBooksOpen, assertTaxOpen } from '@/lib/finance/settings'
import { releaseSequence } from '@/lib/sequence'
import { dhakaDate, dhakaDayStart, dhakaParts, parseDhakaDay } from '@/lib/dhakaTime'
import { isDayKey } from '@/lib/finance/fiscal'

export const NOTE_REASON_VALUES = CREDIT_NOTE_REASONS.map(r => r.value)
export const NOTE_KINDS = ['CREDIT', 'DEBIT']
export const NOTE_SETTLEMENTS = ['ADJUST_INVOICE', 'REFUND']
/** Read access to notes — mirrors ROUTE_PERMISSIONS '/admin/tax/notes' plus invoice viewers. */
export const NOTE_VIEW_PERMS = ['tax.view', 'tax.manage', 'tax.notes.manage', 'sales.invoices.view']
const NOTEABLE_STATUSES = ['SENT', 'PARTIALLY_PAID', 'OVERDUE', 'PAID']
const NO_VAT = ['ZERO_RATED', 'EXEMPT', 'NONE']
const NO_SD = ['ZERO_RATED', 'NONE']
const EPS = 0.01
/** Rule 40(1)(chha): buyer name/address/BIN mandatory above this VAT effect. */
export const NOTE_BUYER_VAT_THRESHOLD = 5000

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const numOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}
const str = (v) => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s || null
}
const n$ = (field) => ({ $convert: { input: `$${field}`, to: 'double', onError: 0, onNull: 0 } })

export function httpError(status, message, extra = null) {
  const err = new Error(message)
  err.status = status
  if (extra) Object.assign(err, extra)
  return err
}

const fmt = (n) => round2(n).toLocaleString('en-BD', { minimumFractionDigits: 2, maximumFractionDigits: 2 })

function idStr(v) {
  if (!v) return null
  return String(v._id ?? v)
}

/** BDT per unit of the invoice currency (1 for BDT; null when unknown). */
export function invoiceFx(invoice) {
  const cur = String(invoice?.currency || 'BDT').toUpperCase()
  if (cur === 'BDT') return 1
  const total = num(invoice?.total)
  const totalBDT = num(invoice?.totalBDT)
  return total > 0 && totalBDT > 0 ? totalBDT / total : null
}

/** Treatment of the invoice (NONE when missing). */
function treatmentOf(invoice) {
  const t = invoice?.vatTreatment
  return ['STANDARD', 'REDUCED', 'ZERO_RATED', 'EXEMPT', 'NONE'].includes(t) ? t : 'NONE'
}

/** Invoice lines as an array (legacy rows may hold a JSON string). */
function invoiceLines(invoice) {
  let items = invoice?.items
  if (typeof items === 'string') {
    try { items = JSON.parse(items) } catch { items = [] }
  }
  return Array.isArray(items) ? items.filter(i => i && typeof i === 'object') : []
}

/** Does a VAT rate belong to the treatment? Same rule as lib/invoiceTotals.js. */
function rateFitsTreatment(rate, treatment) {
  if (treatment === 'STANDARD') return rate === 15
  if (treatment === 'REDUCED') return rate > 0 && rate < 15
  return false
}

/**
 * VAT / SD rates a note line may carry. A note adjusts the original supply at
 * its original rates, so only the invoice's own line rates are accepted
 * (STANDARD exactly 15%, REDUCED above 0% and below 15%). A legacy invoice
 * without line rates falls back to its dominant rate, else the treatment's
 * default. SD: 0 (a line without SD) plus the invoice's line SD rates.
 * Non-VAT / zero-rated / exempt invoices carry no VAT rate (vatRates = []).
 * @returns {{ vatRates: number[], sdRates: number[] }} ascending
 */
export function allowedNoteRates(invoice, totals = invoiceTaxTotals(invoice)) {
  const treatment = totals.treatment
  const lines = invoiceLines(invoice)
  const lineRates = (key) => lines.map(l => numOrNull(l[key])).filter(r => r !== null).map(round2)
  const asc = (set) => [...set].sort((a, b) => a - b)

  let vatRates = []
  if (!NO_VAT.includes(treatment)) {
    const set = new Set(lineRates('vatRate').filter(r => rateFitsTreatment(r, treatment)))
    if (!set.size) {
      const own = round2(num(totals.vatRate))
      set.add(rateFitsTreatment(own, treatment) ? own : (VAT_TREATMENTS.find(t => t.value === treatment)?.defaultRate ?? 15))
    }
    vatRates = asc(set)
  }

  let sdRates = []
  if (!NO_SD.includes(treatment)) {
    const set = new Set([0, ...lineRates('sdRate').filter(r => r > 0 && r <= 500)])
    if (set.size === 1 && num(totals.sdRate) > 0) set.add(round2(num(totals.sdRate)))
    sdRates = asc(set)
  }
  return { vatRates, sdRates }
}

// ── per-invoice lease ──────────────────────────────────────────────────────

/** A lease older than this belongs to a request that died — it may be taken over. */
const NOTE_LOCK_TTL_MS = 2 * 60 * 1000
/** How long a request waits for another note on the same invoice to finish. */
const NOTE_LOCK_WAIT_MS = 10 * 1000
const NOTE_LOCK_POLL_MS = 150
const sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms))

/**
 * Serialise note work (issue / cancel) on one invoice: atomically claim the
 * invoice's note lease (owner token + claim time) and return the invoice AS READ
 * BY THE CLAIM, so limits are computed on state that includes every note issued
 * or cancelled by an earlier holder. While another request holds a live lease
 * this waits (up to NOTE_LOCK_WAIT_MS), then refuses with 409. The release only
 * clears the lease when it is still this request's (a request outliving the TTL
 * cannot clear the lease of the one that took over).
 * @returns {Promise<{ invoice: object, release: () => Promise<void> } | null>} null when the invoice does not exist
 */
async function claimInvoiceNoteLock(invoiceId) {
  const lockId = new mongoose.Types.ObjectId()
  const giveUpAt = Date.now() + NOTE_LOCK_WAIT_MS
  for (;;) {
    const now = new Date()
    const invoice = await Invoice.findOneAndUpdate(
      {
        _id: invoiceId,
        $or: [
          { noteLockId: null },
          { noteLockAt: null },
          { noteLockAt: { $lt: new Date(now.getTime() - NOTE_LOCK_TTL_MS) } },
        ],
      },
      { $set: { noteLockId: lockId, noteLockAt: now } },
      { new: true, timestamps: false },
    ).lean()
    if (invoice) {
      const release = () => Invoice.updateOne(
        { _id: invoice._id, noteLockId: lockId },
        { $unset: { noteLockId: 1, noteLockAt: 1 } },
        { timestamps: false },
      ).then(() => undefined).catch(e => console.error('[creditNotes] note lock release failed', e))
      return { invoice, release }
    }
    if (!(await Invoice.exists({ _id: invoiceId }))) return null
    if (Date.now() >= giveUpAt) {
      throw httpError(409, 'Another credit/debit note on this invoice is being processed — wait a moment, reload and try again')
    }
    await sleep(NOTE_LOCK_POLL_MS)
  }
}

/** Give back the number of a record that was rolled back (e.g. 'CN-2610-075' under 'creditnote'). */
async function giveBackNumber(counter, number) {
  const m = /^(.*-)(\d+)$/.exec(String(number ?? ''))
  if (!m) return
  await releaseSequence(`${counter}:${m[1]}`, Number(m[2]))
    .catch(e => console.error('[creditNotes] give back number failed', number, e))
}

// ── limits ─────────────────────────────────────────────────────────────────

/**
 * What can still be credited / refunded / debited on an invoice, from the
 * invoice and its ISSUED notes. All money in the invoice currency.
 */
export function noteLimits(invoice, notes = [], { pending = 0 } = {}) {
  const t = invoiceTaxTotals(invoice)
  const total = round2(num(invoice.total))
  const paid = round2(num(invoice.paidAmount))
  const due = Math.max(0, round2(total - paid))
  const credited = round2(num(invoice.creditedAmount))
  const debited = round2(num(invoice.debitedAmount))
  const withheldVds = round2(num(invoice.withheldVds))
  const withheldTds = round2(num(invoice.withheldTds))

  const issued = notes.filter(n => n.status === 'ISSUED')
  const sumOf = (list, k) => round2(list.reduce((s, n) => s + num(n[k]), 0))
  const credits = issued.filter(n => n.kind === 'CREDIT')
  const refunds = credits.filter(n => n.settlement === 'REFUND')
  const debits = issued.filter(n => n.kind === 'DEBIT')

  const creditTotal = sumOf(credits, 'totalAmount')
  const refundTotal = sumOf(refunds, 'totalAmount')
  const debitTotal = sumOf(debits, 'totalAmount')
  const creditVat = sumOf(credits, 'vatAmount')
  const creditSd = sumOf(credits, 'sdAmount')
  const debitVat = sumOf(debits, 'vatAmount')
  const debitSd = sumOf(debits, 'sdAmount')

  // Credit notes can never exceed what was billed (incl. debit notes).
  const creditable = Math.max(0, round2(total - creditTotal))
  // Money actually received and not yet refunded (paid = cash + VDS + TDS + credits applied).
  const cashReceived = Math.max(0, round2(paid - credited - withheldVds - withheldTds))
  const refundable = Math.max(0, round2(cashReceived - refundTotal))
  const pendingAmt = round2(num(pending))
  // Rates a note line may use; the default (a line without its own rate) is one of them.
  const { vatRates, sdRates } = allowedNoteRates(invoice, t)
  const dominantVat = round2(num(t.vatRate))

  return {
    currency: String(invoice.currency || 'BDT').toUpperCase(),
    treatment: t.treatment,
    isVat: t.treatment !== 'NONE',
    vatRate: NO_VAT.includes(t.treatment) ? 0 : (vatRates.includes(dominantVat) ? dominantVat : (vatRates[0] ?? dominantVat)),
    vatRates,
    sdRates,
    sdRate: NO_SD.includes(t.treatment) ? 0 : num(t.sdRate),
    hasSd: num(t.sdAmount) > 0,
    taxableValue: t.taxableValue,
    vatAmount: t.vatAmount,
    sdAmount: t.sdAmount,
    total, paid, due, credited, debited, withheldVds, withheldTds,
    cashReceived, refunded: refundTotal, pending: pendingAmt,
    creditTotal, debitTotal, creditVat, creditSd, debitVat, debitSd,
    maxAdjust: Math.max(0, round2(Math.min(due - pendingAmt, creditable))),
    maxRefund: Math.max(0, round2(Math.min(refundable, creditable))),
    maxCreditVat: Math.max(0, round2(t.vatAmount + debitVat - creditVat)),
    maxCreditSd: Math.max(0, round2(t.sdAmount + debitSd - creditSd)),
    noteable: NOTEABLE_STATUSES.includes(invoice.status),
  }
}

/** Limits for one invoice id (loads the invoice, its notes and pending claims). */
export async function limitsForInvoice(invoiceOrId) {
  const invoice = invoiceOrId?._id && invoiceOrId?.status
    ? invoiceOrId
    : await Invoice.findById(idStr(invoiceOrId)).lean()
  if (!invoice) return null
  const [notes, pending] = await Promise.all([
    CreditNote.find({ invoiceId: invoice._id, status: 'ISSUED' }).select('kind settlement status totalAmount vatAmount sdAmount').lean(),
    pendingPaymentTotal({ invoiceId: invoice._id }).catch(() => 0),
  ])
  return noteLimits(invoice, notes, { pending })
}

// ── items ──────────────────────────────────────────────────────────────────

/** `rate` snapped to the allowed rate it matches, or null (no list ⇒ any rate). */
function matchRate(rate, allowed) {
  if (!Array.isArray(allowed) || !allowed.length) return rate
  const hit = allowed.find(r => Math.abs(r - rate) < 0.005)
  return hit === undefined ? null : hit
}

const pctList = (rates) => rates.map(r => `${r}%`).join(' / ')

/**
 * Normalises note lines and computes SD / VAT like the invoice engine:
 * sd = value × sdRate%, vat = (value + sd) × vatRate%. Zero-rated / exempt /
 * non-VAT invoices carry no VAT (and zero-rated / non-VAT no SD).
 * `vatRates` / `sdRates` (from allowedNoteRates): when given, every line must
 * use one of them — a note adjusts the original supply at its original rates.
 */
export function computeNoteItems(items, { treatment = 'NONE', defaultVatRate = 0, vatRates = null, sdRates = null } = {}) {
  const errors = []
  const out = []
  ;(Array.isArray(items) ? items : []).forEach((raw, i) => {
    const description = str(raw?.description)
    const quantity = numOrNull(raw?.quantity) ?? 1
    const value = round2(num(raw?.value))
    let vatRate = NO_VAT.includes(treatment) ? 0 : (numOrNull(raw?.vatRate) ?? num(defaultVatRate))
    let sdRate = NO_SD.includes(treatment) ? 0 : (numOrNull(raw?.sdRate) ?? 0)
    if (!description) errors.push(`Line ${i + 1}: description is required`)
    if (!(quantity > 0)) errors.push(`Line ${i + 1}: quantity must be greater than 0`)
    if (!(value > 0)) errors.push(`Line ${i + 1}: value must be greater than 0`)
    if (vatRate < 0 || vatRate > 100) {
      errors.push(`Line ${i + 1}: VAT rate must be between 0 and 100%`)
    } else if (!NO_VAT.includes(treatment)) {
      const hit = matchRate(vatRate, vatRates)
      if (hit === null) {
        errors.push(vatRates.length === 1
          ? `Line ${i + 1}: VAT rate must be ${vatRates[0]}% — the rate charged on the invoice (a note adjusts the original supply at its original rate)`
          : `Line ${i + 1}: VAT rate must be one of the invoice's rates (${pctList(vatRates)}) — a note adjusts the original supply at its original rate`)
      } else vatRate = hit
    }
    if (sdRate < 0 || sdRate > 500) {
      errors.push(`Line ${i + 1}: SD rate must be between 0 and 500%`)
    } else if (!NO_SD.includes(treatment)) {
      const hit = matchRate(sdRate, sdRates)
      if (hit === null) {
        errors.push(sdRates.length === 1
          ? `Line ${i + 1}: this invoice charged no supplementary duty, so the note cannot carry SD`
          : `Line ${i + 1}: SD rate must be one the invoice charged (${pctList(sdRates)})`)
      } else sdRate = hit
    }
    vatRate = Math.min(100, Math.max(0, vatRate))
    sdRate = Math.min(500, Math.max(0, sdRate))
    const sdAmount = round2((value * Math.max(0, sdRate)) / 100)
    const vatAmount = round2(((value + sdAmount) * vatRate) / 100)
    out.push({ description, quantity, value, vatRate, vatAmount, sdAmount, sdRate })
  })
  if (!out.length) errors.push('Add at least one line')
  const valueAmount = round2(out.reduce((s, l) => s + l.value, 0))
  const sdAmount = round2(out.reduce((s, l) => s + l.sdAmount, 0))
  const vatAmount = round2(out.reduce((s, l) => s + l.vatAmount, 0))
  return {
    items: out,
    valueAmount,
    sdAmount,
    vatAmount,
    totalAmount: round2(valueAmount + sdAmount + vatAmount),
    errors,
  }
}

/** Weighted dominant VAT rate of note lines (for the tax entry's `rate`). */
function dominantRate(items, key) {
  const w = new Map()
  for (const l of items) w.set(l[key], (w.get(l[key]) ?? 0) + l.value)
  let best = 0
  let bestW = -1
  for (const [r, v] of w) if (v > bestW) { best = r; bestW = v }
  return best
}

// ── dates ──────────────────────────────────────────────────────────────────

/**
 * Issue date-time of a note: `issueDate` 'YYYY-MM-DD' + optional `issueTime`
 * 'HH:mm' (Dhaka), or an ISO `issuedAt`; default now.
 * @returns {Date}
 */
export function resolveIssuedAt({ issuedAt, issueDate, issueTime } = {}) {
  const now = new Date()
  if (issueDate) {
    const day = isDayKey(issueDate) ? parseDhakaDay(issueDate) : null
    if (!day) throw httpError(422, 'Invalid issue date')
    let h = 12
    let m = 0
    if (issueTime) {
      const tm = /^(\d{1,2}):(\d{2})$/.exec(String(issueTime).trim())
      if (!tm || Number(tm[1]) > 23 || Number(tm[2]) > 59) throw httpError(422, 'Invalid issue time (use HH:mm)')
      h = Number(tm[1]); m = Number(tm[2])
    } else {
      // Today without a time ⇒ now; another day ⇒ noon (Dhaka).
      const today = dhakaParts(now)
      const d = dhakaParts(day.start)
      if (d.year === today.year && d.month === today.month && d.day === today.day) return now
    }
    const { year, month, day: dd } = dhakaParts(day.start)
    return dhakaDate(year, month, dd, h, m)
  }
  if (issuedAt) {
    const d = new Date(issuedAt)
    if (Number.isNaN(d.getTime())) throw httpError(422, 'Invalid issue date')
    return d
  }
  return now
}

// ── issue ──────────────────────────────────────────────────────────────────

/**
 * Issue a credit or debit note.
 * @param {object} input validated body: { kind, invoiceId, reason, reasonText, items, settlement, refundAccountId, refundDate, issuedAt, issueDate, issueTime }
 * @param {{ userId }} ctx
 * @returns {Promise<{ note: object, taxEntry: object|null, transaction: object|null, warnings: string[] }>}
 */
export async function issueNote(input, { userId = null } = {}) {
  const kind = input.kind
  if (!NOTE_KINDS.includes(kind)) throw httpError(422, 'Choose credit or debit note')
  const settlement = kind === 'DEBIT' ? 'ADJUST_INVOICE' : (input.settlement || 'ADJUST_INVOICE')
  if (!NOTE_SETTLEMENTS.includes(settlement)) throw httpError(422, 'Invalid settlement')
  if (!NOTE_REASON_VALUES.includes(input.reason)) throw httpError(422, 'Choose a reason for the note')
  const reasonText = str(input.reasonText)
  if (input.reason === 'OTHER' && !reasonText) throw httpError(422, 'Describe the reason for the note')

  if (!mongoose.isValidObjectId(String(input.invoiceId ?? ''))) throw httpError(404, 'Invoice not found')
  // One note at a time per invoice: the caps below are read-then-write, so two
  // parallel notes could otherwise both pass them (double refund, VAT over-credit).
  const lease = await claimInvoiceNoteLock(input.invoiceId)
  if (!lease) throw httpError(404, 'Invoice not found')
  try {
    return await issueNoteLocked(lease.invoice, input, { kind, settlement, reasonText, userId })
  } finally {
    await lease.release()
  }
}

/** issueNote under the invoice's note lease; `invoice` is the one read by the claim. */
async function issueNoteLocked(invoice, input, { kind, settlement, reasonText, userId }) {
  if (invoice.status === 'DRAFT') throw httpError(409, 'Issue (send) the invoice before raising a credit or debit note against it')
  if (invoice.status === 'CANCELLED') throw httpError(409, 'This invoice is cancelled — notes cannot be raised against it')
  if (!NOTEABLE_STATUSES.includes(invoice.status)) throw httpError(409, `Notes cannot be raised against a ${invoice.status} invoice`)

  const treatment = treatmentOf(invoice)
  const isVat = treatment !== 'NONE'
  const limits = await limitsForInvoice(invoice)
  const computed = computeNoteItems(input.items, {
    treatment, defaultVatRate: limits.vatRate, vatRates: limits.vatRates, sdRates: limits.sdRates,
  })
  if (computed.errors.length) throw httpError(422, computed.errors[0], { details: computed.errors })

  const fx = invoiceFx(invoice)
  const cur = limits.currency
  const issuedAt = resolveIssuedAt(input)
  if (issuedAt.getTime() > Date.now() + 5 * 60 * 1000) throw httpError(422, 'The issue date cannot be in the future')
  const invoiceIssued = invoice.issuedAt ?? invoice.sentAt ?? invoice.issueDate ?? null
  if (invoiceIssued && issuedAt < dhakaDayStart(invoiceIssued)) {
    throw httpError(422, 'A note cannot be dated before its invoice was issued')
  }
  let refundDate = issuedAt
  if (kind === 'CREDIT' && settlement === 'REFUND' && input.refundDate) {
    if (!isDayKey(input.refundDate)) throw httpError(422, 'Invalid refund date')
    refundDate = parseDhakaDay(input.refundDate).start
    if (refundDate.getTime() > Date.now()) throw httpError(422, 'The refund date cannot be in the future')
  }

  // Limits
  const total = computed.totalAmount
  if (kind === 'CREDIT') {
    if (total > limits.total - limits.creditTotal + EPS) {
      throw httpError(422, `Credit notes on this invoice cannot exceed what was billed — at most ${cur} ${fmt(Math.max(0, limits.total - limits.creditTotal))} remains`)
    }
    if (isVat && computed.vatAmount > limits.maxCreditVat + EPS) {
      throw httpError(422, `The VAT on this credit note (${fmt(computed.vatAmount)}) is more than the VAT still on the invoice (${fmt(limits.maxCreditVat)})`)
    }
    if (isVat && computed.sdAmount > limits.maxCreditSd + EPS) {
      throw httpError(422, `The SD on this credit note (${fmt(computed.sdAmount)}) is more than the SD on the invoice (${fmt(limits.maxCreditSd)})`)
    }
    if (settlement === 'ADJUST_INVOICE' && total > limits.maxAdjust + EPS) {
      throw httpError(422, limits.pending > 0 && total <= limits.due + EPS
        ? `${cur} ${fmt(limits.pending)} is awaiting payment confirmation — credit at most ${cur} ${fmt(limits.maxAdjust)} against the due, or confirm / reject the pending payment first`
        : `A credit note adjusted against the invoice cannot exceed the amount due (${cur} ${fmt(limits.maxAdjust)}). Use a refund for money already received.`)
    }
    if (settlement === 'REFUND' && total > limits.maxRefund + EPS) {
      throw httpError(422, `A refund cannot exceed the money received on this invoice and not yet refunded (${cur} ${fmt(limits.maxRefund)})`)
    }
    if (settlement === 'REFUND' && fx === null) {
      throw httpError(422, `This ${cur} invoice has no BDT value recorded, so a refund cannot be posted to the ledger`)
    }
  }

  const toBDT = (v) => round2(num(v) * (fx ?? 1))
  const parties = await snapshotInvoiceParties(invoice)
  const sellerSnap = invoice.seller ?? {}
  const buyerSnap = invoice.buyer ?? {}
  const seller = {
    name:    str(sellerSnap.name) || parties.seller.name,
    bin:     str(sellerSnap.bin) || parties.seller.bin,
    address: str(sellerSnap.address) || parties.seller.address,
  }
  const buyer = {
    name:    str(buyerSnap.name) || parties.buyer.name,
    bin:     str(buyerSnap.bin) || parties.buyer.bin,
    address: str(buyerSnap.address) || parties.buyer.address,
  }
  const buyerTin = str(buyerSnap.tin) || parties.buyer.tin

  const warnings = []
  if (isVat && toBDT(computed.vatAmount) > NOTE_BUYER_VAT_THRESHOLD && !buyer.bin) {
    warnings.push(`The buyer has no BIN on record. For a VAT effect above Tk ${NOTE_BUYER_VAT_THRESHOLD.toLocaleString('en-BD')} the note must show the buyer's name, address and BIN.`)
  }
  if (isVat && !seller.bin) warnings.push('The company BIN is not set (Tax & VAT → Tax Settings), so the note prints without the seller BIN.')

  // 0) Refuse now whatever the later steps would refuse only after the note took
  //    its CN-/DN- number (a gap in the Mushak-6.7/6.8 serial): the books / VAT
  //    lock on the issue date, and every money-account rule of the refund.
  const booksLocked = await assertBooksOpen(issuedAt)
  if (booksLocked) throw httpError(409, booksLocked)
  if (isVat) {
    const taxLocked = await assertTaxOpen(issuedAt)
    if (taxLocked) throw httpError(409, taxLocked)
  }
  let refundEntry = null
  if (kind === 'CREDIT' && settlement === 'REFUND') {
    const totalBDT = toBDT(total)
    refundEntry = {
      type:        'EXPENSE',
      kind:        'OPERATING',
      category:    'Sales Returns & Allowances',
      amount:      total,
      currency:    cur,
      amountBDT:   totalBDT,
      plAmountBDT: toBDT(computed.valueAmount),
      accountId:   input.refundAccountId || null,
      date:        refundDate,
      invoiceId:   invoice._id,
      projectId:   invoice.projectId ?? invoice.projectIds?.[0] ?? null,
      clientId:    idStr(invoice.clientId),
      tax: {
        grossBDT: totalBDT,
        vatBDT:   toBDT(computed.vatAmount),
        sdBDT:    toBDT(computed.sdAmount),
        vdsBDT:   0,
        tdsBDT:   0,
      },
    }
    try {
      await preflightMoneyEntry(refundEntry)
    } catch (err) {
      if (err?.code === 'ACCOUNT_REQUIRED') throw httpError(422, 'Choose the money account the refund is paid from', { field: 'refundAccountId' })
      throw err
    }
  }

  // 1) The note (gets its CN-/DN- number)
  const noteDoc = new CreditNote({
    kind,
    invoiceId: invoice._id,
    clientId: invoice.clientId,
    invoiceNumber: invoice.invoiceNumber ?? null,
    invoiceDate: invoiceIssued,
    issuedAt,
    reason: input.reason,
    reasonText,
    items: computed.items.map(({ description, quantity, value, vatRate, vatAmount, sdAmount }) => ({ description, quantity, value, vatRate, vatAmount, sdAmount })),
    valueAmount: computed.valueAmount,
    vatAmount: computed.vatAmount,
    sdAmount: computed.sdAmount,
    totalAmount: total,
    settlement,
    refundAccountId: settlement === 'REFUND' ? (input.refundAccountId || null) : null,
    seller,
    buyer,
    status: 'ISSUED',
    createdBy: userId,
  })
  let note
  try {
    note = await noteDoc.save()
  } catch (err) {
    // Numbered in pre('validate') but never stored — give the number back.
    if (noteDoc.noteNo && !(await CreditNote.exists({ _id: noteDoc._id }).catch(() => true))) {
      await giveBackNumber('creditnote', noteDoc.noteNo)
    }
    throw err
  }

  let taxEntry = null
  let transaction = null
  let adjustedInvoice = false
  // A failed note never existed: its tax entry is removed (not voided — a VOID
  // "CN-… not issued" row would point at a note that is gone) and the CN-/DN-
  // and TAX- numbers are given back while no later number has been issued.
  const undo = async () => {
    if (adjustedInvoice) {
      // Take the credit back off the invoice (applyInvoicePayment already ran).
      await revertInvoicePayment(invoice._id, total, { priorStatus: invoice.status, priorPaidAt: invoice.paidAt ?? null })
        .catch(e => console.error('[issueNote] undo invoice adjustment failed', e))
    }
    if (transaction) {
      await Transaction.deleteOne({ _id: transaction._id }).catch(e => console.error('[issueNote] undo transaction failed', e))
    }
    // A kept (voided) tax entry still names this note's number — then the number
    // stays used, or a reissued CN-… would sit next to a "CN-… not issued" row.
    let entryKept = false
    if (taxEntry) {
      const removed = await TaxEntry.deleteOne({ _id: taxEntry._id, status: 'ACTIVE', filingId: null })
        .catch(e => { console.error('[issueNote] undo tax entry failed', e); return null })
      if (removed?.deletedCount) {
        await giveBackNumber('taxentry', taxEntry.entryNo)
      } else {
        entryKept = true
        // Picked up by a return meanwhile — keep it, but out of the figures.
        await voidTaxEntry(taxEntry._id, { reason: `Note ${note.noteNo} not issued`, userId, allowLocked: true })
          .catch(e => console.error('[issueNote] undo tax entry failed', e))
      }
    }
    const gone = await CreditNote.deleteOne({ _id: note._id })
      .catch(e => { console.error('[issueNote] undo note failed', e); return null })
    if (gone?.deletedCount && !entryKept) await giveBackNumber('creditnote', note.noteNo)
  }

  try {
    // 2) Tax sub-ledger (VAT invoices only — a non-VAT invoice has no VAT effect)
    if (isVat) {
      taxEntry = await recordTaxEntry({
        entryType:    kind === 'CREDIT' ? 'CREDIT_NOTE' : 'DEBIT_NOTE',
        date:         issuedAt,
        baseAmount:   toBDT(computed.valueAmount),
        rate:         dominantRate(computed.items, 'vatRate'),
        amount:       toBDT(computed.vatAmount),
        sdRate:       dominantRate(computed.items, 'sdRate'),
        sdAmount:     toBDT(computed.sdAmount),
        treatment,
        serviceCode:  str(invoice.serviceCode),
        partyType:    'CLIENT',
        partyId:      idStr(invoice.clientId),
        partyName:    buyer.name,
        partyBin:     buyer.bin,
        partyTin:     buyerTin,
        partyAddress: buyer.address,
        documentNo:   note.noteNo,
        documentDate: issuedAt,
        invoiceId:    invoice._id,
        creditNoteId: note._id,
        notes:        `${kind === 'CREDIT' ? 'Credit' : 'Debit'} note ${note.noteNo} against ${invoice.invoiceNumber ?? 'invoice'} — ${CREDIT_NOTE_REASONS.find(r => r.value === input.reason)?.label ?? input.reason}${reasonText ? `: ${reasonText}` : ''}${fx !== 1 && fx ? ` (converted from ${cur} at ${Math.round(fx * 10000) / 10000})` : ''}`,
      }, { userId })
    }

    // 3) Invoice / money effect
    if (kind === 'CREDIT' && settlement === 'ADJUST_INVOICE') {
      const applied = await applyInvoicePayment(invoice._id, total, issuedAt)
      if (!applied) throw httpError(409, 'The invoice balance changed in the meantime — reload and try again')
      adjustedInvoice = true
      await Invoice.updateOne({ _id: invoice._id }, [
        { $set: { creditedAmount: { $round: [{ $add: [n$('creditedAmount'), total] }, 2] } } },
      ])
    } else if (kind === 'CREDIT' && settlement === 'REFUND') {
      transaction = await postMoneyEntry({
        ...refundEntry,
        description: `Refund — credit note ${note.noteNo} on invoice ${invoice.invoiceNumber ?? ''}`.trim(),
        reference:   note.noteNo,
        taxEntryIds: taxEntry ? [taxEntry._id] : [],
      }, { userId })
    } else if (kind === 'DEBIT') {
      const addBDT = toBDT(total)
      const updated = await Invoice.findOneAndUpdate(
        { _id: invoice._id, status: { $in: NOTEABLE_STATUSES } },
        [
          { $set: {
            total:         { $round: [{ $add: [n$('total'), total] }, 2] },
            debitedAmount: { $round: [{ $add: [n$('debitedAmount'), total] }, 2] },
            totalBDT:      { $cond: [{ $eq: [{ $ifNull: ['$totalBDT', null] }, null] }, null, { $round: [{ $add: [n$('totalBDT'), addBDT] }, 2] }] },
          } },
          { $set: {
            status: { $cond: [{ $eq: ['$status', 'PAID'] }, 'PARTIALLY_PAID', '$status'] },
            paidAt: { $cond: [{ $eq: ['$status', 'PAID'] }, null, '$paidAt'] },
          } },
        ],
        { new: true },
      ).lean()
      if (!updated) throw httpError(409, 'The invoice changed in the meantime — reload and try again')
    }
  } catch (err) {
    await undo()
    throw err
  }

  // 4) Links (best effort — the effects above are already consistent)
  const linkSet = {}
  if (taxEntry) linkSet.taxEntryId = taxEntry._id
  if (transaction) linkSet.transactionId = transaction._id
  if (Object.keys(linkSet).length) {
    await CreditNote.updateOne({ _id: note._id }, { $set: linkSet }).catch(e => console.error('[issueNote] link note failed', e))
    Object.assign(note, linkSet)
  }
  if (taxEntry && transaction) {
    await TaxEntry.updateOne({ _id: taxEntry._id }, { $set: { transactionId: transaction._id } })
      .catch(e => console.error('[issueNote] link tax entry failed', e))
  }

  return { note, taxEntry, transaction, warnings }
}

// ── cancel ─────────────────────────────────────────────────────────────────

/**
 * Cancel an ISSUED note and reverse its effects (latest note first):
 *   CREDIT ADJUST  paidAmount −= total, creditedAmount −= total (status recomputed)
 *   CREDIT REFUND  reversal of the refund transaction (money back into the account)
 *   DEBIT          total −= total, debitedAmount −= total (refused when payments already cover it)
 *   VAT            the CREDIT_NOTE / DEBIT_NOTE entry is voided (refused once in a filed return)
 * @returns {Promise<{ note: object, reversal: object|null }>}
 */
export async function cancelNote(noteId, { reason, userId = null } = {}) {
  const why = str(reason)
  if (!why || why.length < 5) throw httpError(422, 'Give a reason for cancelling (at least 5 characters)')
  if (!mongoose.isValidObjectId(String(noteId ?? ''))) throw httpError(404, 'Not found')

  const note = await CreditNote.findById(noteId).lean()
  if (!note) throw httpError(404, 'Not found')
  if (note.status !== 'ISSUED') throw httpError(409, 'This note is already cancelled')

  // Same lease as issueNote: keeps "latest note first" true and stops a cancel
  // (e.g. of a debit note) from moving a cap another note is being checked against.
  const lease = await claimInvoiceNoteLock(note.invoiceId)
  if (!lease) throw httpError(409, 'The invoice of this note no longer exists')
  try {
    return await cancelNoteLocked(note._id, lease.invoice, { why, userId })
  } finally {
    await lease.release()
  }
}

/** cancelNote under the invoice's note lease; `invoice` is the one read by the claim. */
async function cancelNoteLocked(noteId, invoice, { why, userId }) {
  // Re-read under the lease: a note still being issued when the cancel arrived
  // only now carries its tax entry / refund links.
  const note = await CreditNote.findById(noteId).lean()
  if (!note) throw httpError(404, 'Not found')
  if (note.status !== 'ISSUED') throw httpError(409, 'This note is already cancelled')

  const later = await CreditNote.findOne({
    invoiceId: note.invoiceId,
    status: 'ISSUED',
    _id: { $ne: note._id },
    createdAt: { $gt: note.createdAt },
  }).select('noteNo').lean()
  if (later) throw httpError(409, `Cancel the later note ${later.noteNo} on this invoice first`)

  const amt = round2(num(note.totalAmount))
  const paid = num(invoice.paidAmount)
  const credited = num(invoice.creditedAmount)
  const total = num(invoice.total)

  if (note.kind === 'CREDIT' && note.settlement === 'ADJUST_INVOICE') {
    if (paid < amt - EPS || credited < amt - EPS) throw httpError(409, 'The invoice no longer carries this credit — it cannot be reversed automatically')
  }
  if (note.kind === 'DEBIT' && paid > total - amt + EPS) {
    throw httpError(409, 'Payments already cover part of this debit note — issue a credit note instead of cancelling it')
  }
  if (note.kind === 'DEBIT' && invoice.status === 'CANCELLED') throw httpError(409, 'The invoice is cancelled')

  // Claim the note first so two cancels cannot both reverse it.
  const claimed = await CreditNote.findOneAndUpdate(
    { _id: note._id, status: 'ISSUED' },
    { $set: { status: 'CANCELLED', cancelReason: why, cancelledAt: new Date(), cancelledBy: userId } },
    { new: true },
  )
  if (!claimed) throw httpError(409, 'This note is already cancelled')

  let voidedEntry = null
  let reversal = null
  try {
    // 1) VAT entry (refused for a filed return or a locked period)
    if (note.taxEntryId) {
      const entry = await TaxEntry.findById(note.taxEntryId).select('status').lean()
      if (entry && entry.status === 'ACTIVE') {
        voidedEntry = await voidTaxEntry(note.taxEntryId, { reason: `Note ${note.noteNo} cancelled: ${why}`, userId })
      }
    }

    // 2) Invoice / money
    if (note.kind === 'CREDIT' && note.settlement === 'ADJUST_INVOICE') {
      const res = await Invoice.findOneAndUpdate(
        {
          _id: note.invoiceId,
          status: { $in: NOTEABLE_STATUSES },
          $expr: { $and: [
            { $gte: [n$('paidAmount'), amt - EPS] },
            { $gte: [n$('creditedAmount'), amt - EPS] },
          ] },
        },
        [
          { $set: {
            paidAmount:     { $round: [{ $max: [0, { $subtract: [n$('paidAmount'), amt] }] }, 2] },
            creditedAmount: { $round: [{ $max: [0, { $subtract: [n$('creditedAmount'), amt] }] }, 2] },
          } },
          { $set: {
            status: {
              $cond: [
                { $gte: ['$paidAmount', { $subtract: [n$('total'), 0.01] }] }, 'PAID',
                { $cond: [{ $eq: ['$status', 'OVERDUE'] }, 'OVERDUE', { $cond: [{ $gt: ['$paidAmount', 0.005] }, 'PARTIALLY_PAID', 'SENT'] }] },
              ],
            },
            paidAt: { $cond: [{ $gte: ['$paidAmount', { $subtract: [n$('total'), 0.01] }] }, '$paidAt', null] },
          } },
        ],
        { new: true },
      ).lean()
      if (!res) throw httpError(409, 'The invoice changed in the meantime — reload and try again')
    } else if (note.kind === 'CREDIT' && note.settlement === 'REFUND') {
      if (note.transactionId) {
        const already = await Transaction.exists({ reversalOf: note.transactionId })
        if (!already) {
          reversal = await reverseMoneyEntry(note.transactionId, { userId, date: new Date(), reason: `Credit note ${note.noteNo} cancelled` })
        }
      }
    } else if (note.kind === 'DEBIT') {
      const res = await Invoice.findOneAndUpdate(
        {
          _id: note.invoiceId,
          status: { $in: NOTEABLE_STATUSES },
          $expr: { $lte: [n$('paidAmount'), { $add: [{ $subtract: [n$('total'), amt] }, EPS] }] },
        },
        [
          { $set: {
            total:         { $round: [{ $max: [0, { $subtract: [n$('total'), amt] }] }, 2] },
            debitedAmount: { $round: [{ $max: [0, { $subtract: [n$('debitedAmount'), amt] }] }, 2] },
            totalBDT:      { $cond: [{ $eq: [{ $ifNull: ['$totalBDT', null] }, null] }, null, { $round: [{ $max: [0, { $subtract: [n$('totalBDT'), round2(amt * (invoiceFx(invoice) ?? 1))] }] }, 2] }] },
          } },
          { $set: {
            status: {
              $cond: [
                { $and: [{ $gt: [n$('paidAmount'), 0.005] }, { $gte: [n$('paidAmount'), { $subtract: ['$total', 0.01] }] }] },
                'PAID', '$status',
              ],
            },
            paidAt: {
              $cond: [
                { $and: [{ $gt: [n$('paidAmount'), 0.005] }, { $gte: [n$('paidAmount'), { $subtract: ['$total', 0.01] }] }] },
                { $ifNull: ['$paidAt', '$$NOW'] }, '$paidAt',
              ],
            },
          } },
        ],
        { new: true },
      ).lean()
      if (!res) throw httpError(409, 'Payments already cover part of this debit note — issue a credit note instead')
    }
  } catch (err) {
    // Restore what was undone so far.
    if (voidedEntry) {
      await TaxEntry.updateOne(
        { _id: voidedEntry._id, status: 'VOID' },
        { $set: { status: 'ACTIVE', voidReason: null, voidedBy: null, voidedAt: null } },
      ).catch(e => console.error('[cancelNote] restore tax entry failed', e))
    }
    await CreditNote.updateOne(
      { _id: note._id, status: 'CANCELLED' },
      { $set: { status: 'ISSUED', cancelReason: null, cancelledAt: null, cancelledBy: null } },
    ).catch(e => console.error('[cancelNote] restore note failed', e))
    throw err
  }

  return { note: claimed, reversal }
}
