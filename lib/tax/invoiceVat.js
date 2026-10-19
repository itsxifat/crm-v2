/**
 * lib/tax/invoiceVat.js — SERVER-ONLY output-VAT helpers for sales invoices.
 *
 *  - invoiceTaxTotals(invoice)            pure: taxable value / VAT / SD / total with legacy fallbacks
 *  - snapshotInvoiceParties(invoice)      seller (company profile) + buyer (client) as of the tax point
 *  - recordInvoiceOutputVat(invoice, …)   one OUTPUT_VAT TaxEntry per issued VAT invoice (idempotent)
 *  - voidInvoiceOutputVat(invoiceId, …)   void it when the invoice is cancelled
 *  - vatPortionOfSettlement(invoice, …)   VAT + SD contained in a settlement (cash + VDS + TDS)
 *  - vatSdPortionOfSettlement(invoice, …) same, split into { vat, sd, total } by the VAT : SD left after notes
 *
 * Money convention: Invoice money fields are legacy `Mixed`, so everything is
 * coerced with Number(). Tax amounts written to TaxEntry are BDT.
 */

import mongoose from 'mongoose'
import { Invoice, Client, TaxEntry, TaxFiling } from '@/models'
import { recordTaxEntry, voidTaxEntry } from '@/lib/tax/engine'
import { round2, VAT_TREATMENTS, VAT_RATE_OPTIONS, normalizeBin, isValidBin, normalizeTin, treatmentForRate } from '@/lib/tax/catalog'
import { getCompanyProfile, getFinanceSettings } from '@/lib/finance/settings'

const TREATMENT_VALUES = VAT_TREATMENTS.map(t => t.value)
const NO_VAT_TREATMENTS = ['ZERO_RATED', 'EXEMPT', 'NONE']
const FILED_STATUSES = ['FILED', 'AMENDED']

// ── small utilities ─────────────────────────────────────────────────────────

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

/** Number or null (null/''/NaN ⇒ null). */
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

function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

/** BIN for storage/printing: normalised when it is a valid BIN, else the trimmed raw value. */
function cleanBin(v) {
  const s = str(v)
  if (!s) return null
  return isValidBin(s) ? normalizeBin(s) : s
}

function idOf(ref) {
  if (!ref) return null
  const raw = ref._id ?? ref
  const s = String(raw)
  return mongoose.isValidObjectId(s) ? s : null
}

/** Invoice items as an array (legacy rows may hold a JSON string). */
function itemsOf(invoice) {
  let items = invoice?.items
  if (typeof items === 'string') {
    try { items = JSON.parse(items) } catch { items = [] }
  }
  return Array.isArray(items) ? items.filter(i => i && typeof i === 'object') : []
}

/** Plain object of a (possibly Mongoose) sub-document. */
function plain(sub) {
  if (!sub) return null
  return typeof sub.toObject === 'function' ? sub.toObject() : { ...sub }
}

/** Snap a derived percentage to a statutory rate when it is within 0.05 pp of one. */
function snapRate(rate) {
  if (!Number.isFinite(rate)) return null
  const hit = VAT_RATE_OPTIONS.find(r => Math.abs(r - rate) < 0.05)
  return hit ?? round2(rate)
}

/** Weighted dominant value of `field` across lines (weight = line taxable value). */
function dominantLineValue(items, field) {
  const weights = new Map()
  for (const it of items) {
    const v = numOrNull(it[field])
    if (v === null) continue
    const w = it.taxableValue != null ? num(it.taxableValue) : num(it.amount ?? num(it.quantity) * num(it.rate))
    weights.set(v, (weights.get(v) ?? 0) + Math.max(0, w))
  }
  if (!weights.size) return null
  let best = null
  let bestW = -1
  for (const [v, w] of weights) {
    // ties ⇒ the higher rate (conservative for the return)
    if (w > bestW || (w === bestW && v > best)) { best = v; bestW = w }
  }
  return best
}

// ── totals ──────────────────────────────────────────────────────────────────

/**
 * VAT figures of an invoice in the INVOICE currency, with fallbacks for legacy
 * documents (no VAT fields ⇒ vatAmount 0, taxableValue = subtotal − discount).
 *
 * @returns {{ taxableValue:number, vatAmount:number, sdAmount:number, total:number,
 *             subtotal:number, discount:number, mfsCharge:number, treatment:string,
 *             vatRate:number, sdRate:number, currency:string, fxRate:number|null }}
 *   fxRate = BDT per 1 unit of the invoice currency (1 for BDT, from totalBDT/total
 *   otherwise, null when unknown).
 */
export function invoiceTaxTotals(invoice) {
  const inv = invoice || {}
  const items = itemsOf(inv)

  const itemsSubtotal = round2(items.reduce((s, it) => s + (it.amount != null ? num(it.amount) : num(it.quantity) * num(it.rate)), 0))
  const subtotal = inv.subtotal != null && inv.subtotal !== '' ? round2(num(inv.subtotal)) : itemsSubtotal
  const discount = round2(num(inv.discount))
  const mfsCharge = round2(num(inv.taxAmount))

  let taxableValue
  if (numOrNull(inv.taxableValue) !== null) {
    taxableValue = round2(Number(inv.taxableValue))
  } else if (items.some(it => numOrNull(it.taxableValue) !== null)) {
    taxableValue = round2(items.reduce((s, it) => s + num(it.taxableValue), 0))
  } else {
    taxableValue = round2(Math.max(0, subtotal - discount))
  }

  const treatment = TREATMENT_VALUES.includes(inv.vatTreatment) ? inv.vatTreatment : 'NONE'
  // Zero-rated / exempt supplies carry no VAT whatever the stored figure says.
  const vatAmount = treatment === 'ZERO_RATED' || treatment === 'EXEMPT' ? 0 : round2(num(inv.vatAmount))
  const sdAmount = round2(num(inv.sdAmount))

  const total = inv.total != null && inv.total !== ''
    ? round2(num(inv.total))
    : round2(taxableValue + sdAmount + vatAmount + mfsCharge)

  // Dominant VAT / SD rates (lines first, then derived from the amounts).
  let vatRate = 0
  let sdRate = 0
  if (!NO_VAT_TREATMENTS.includes(treatment)) {
    vatRate = dominantLineValue(items, 'vatRate')
    if (vatRate === null) vatRate = numOrNull(inv.vatRate)
    if (vatRate === null && vatAmount > 0 && taxableValue + sdAmount > 0) vatRate = snapRate((vatAmount * 100) / (taxableValue + sdAmount))
    if (vatRate === null) vatRate = VAT_TREATMENTS.find(t => t.value === treatment)?.defaultRate ?? 0
  }
  sdRate = dominantLineValue(items, 'sdRate')
  if (sdRate === null) sdRate = sdAmount > 0 && taxableValue > 0 ? snapRate((sdAmount * 100) / taxableValue) : 0

  const currency = str(inv.currency)?.toUpperCase() || 'BDT'
  let fxRate = null
  if (currency === 'BDT') fxRate = 1
  else if (num(inv.totalBDT) > 0 && total > 0) fxRate = num(inv.totalBDT) / total

  return { taxableValue, vatAmount, sdAmount, total, subtotal, discount, mfsCharge, treatment, vatRate, sdRate, currency, fxRate }
}

// ── parties ─────────────────────────────────────────────────────────────────

async function loadClient(ref) {
  const id = idOf(ref)
  if (!id) return null
  return Client.findById(id)
    .select('company contactPerson clientType address city country bin tin vatNumber userId')
    .populate('userId', 'name')
    .lean()
}

function buyerFromClient(client) {
  if (!client) return { name: null, bin: null, tin: null, address: null }
  const name = str(client.company) || str(client.contactPerson) || str(client.userId?.name) || null
  const address = [client.address, client.city, client.country].map(str).filter(Boolean).join(', ') || null
  return {
    name,
    bin: cleanBin(client.bin) || cleanBin(client.vatNumber),
    tin: str(client.tin) ? normalizeTin(client.tin) : null,
    address,
  }
}

/**
 * Seller (company profile) and buyer (client) details as they are right now —
 * store them on the invoice at the tax point (DRAFT → SENT).
 * @returns {Promise<{ seller:{name,bin,address}, buyer:{name,bin,tin,address} }>}
 */
export async function snapshotInvoiceParties(invoice) {
  const [company, client] = await Promise.all([getCompanyProfile(), loadClient(invoice?.clientId)])
  const seller = {
    name:    str(company?.name),
    bin:     cleanBin(company?.bin),
    address: str(company?.address),
  }
  return { seller, buyer: buyerFromClient(client) }
}

/** Buyer snapshot stored on the invoice, else a fresh one from the client. */
async function buyerOf(invoice) {
  const stored = plain(invoice?.buyer)
  if (stored && (str(stored.name) || str(stored.bin))) {
    return { name: str(stored.name), bin: cleanBin(stored.bin), tin: str(stored.tin), address: str(stored.address) }
  }
  const { buyer } = await snapshotInvoiceParties(invoice)
  return buyer
}

async function resolveInvoice(invoice) {
  if (!invoice) return null
  if (typeof invoice === 'string' || invoice instanceof mongoose.Types.ObjectId) {
    const id = idOf(invoice)
    return id ? Invoice.findById(id).lean() : null
  }
  // A bare reference ({ _id } / partial select) — load the full invoice.
  if (invoice.vatTreatment === undefined && invoice.invoiceNumber === undefined) {
    const id = idOf(invoice)
    return id ? Invoice.findById(id).lean() : null
  }
  return invoice
}

async function linkInvoiceEntry(invoice, invoiceId, entryId) {
  await Invoice.updateOne({ _id: invoiceId }, { $set: { outputVatEntryId: entryId } })
  // keep an in-memory Mongoose document in step, so a later save() does not revert it
  if (invoice && typeof invoice.set === 'function') {
    try { invoice.set('outputVatEntryId', entryId) } catch { /* field absent on an old schema — ignore */ }
  }
}

function activeOutputFilter(invoiceId) {
  return { invoiceId, entryType: 'OUTPUT_VAT', status: 'ACTIVE', isOpening: { $ne: true } }
}

// ── output VAT ──────────────────────────────────────────────────────────────

/**
 * Record the OUTPUT_VAT entry of an issued VAT invoice (Mushak-9.1 notes 1/3/4/7).
 * Idempotent: an existing ACTIVE OUTPUT_VAT for the invoice is returned as is.
 * Returns null when the invoice is not a VAT invoice (treatment NONE/missing)
 * or is cancelled. Zero-rated / exempt invoices get an entry with amount 0 so
 * their value reaches notes 1 / 3.
 *
 * @param {object|string} invoice  Invoice document / lean object / id
 * @param {{ userId?, date? }} [opts]  date defaults to invoice.issuedAt ?? now
 * @returns {Promise<object|null>} the TaxEntry
 */
export async function recordInvoiceOutputVat(invoice, { userId = null, date } = {}) {
  const inv = await resolveInvoice(invoice)
  if (!inv) throw httpError(404, 'Invoice not found')
  const invoiceId = inv._id ?? inv.id
  if (!invoiceId) throw httpError(400, 'Invoice has no id')

  const existing = await TaxEntry.findOne(activeOutputFilter(invoiceId))
  if (existing) {
    if (String(inv.outputVatEntryId ?? '') !== String(existing._id)) await linkInvoiceEntry(invoice, invoiceId, existing._id)
    return existing
  }

  const totals = invoiceTaxTotals(inv)
  if (totals.treatment === 'NONE') return null
  if (inv.status === 'CANCELLED') return null

  const settings = await getFinanceSettings()
  const buyer = await buyerOf(inv)
  const items = itemsOf(inv)

  // Tax amounts are BDT. Non-BDT invoices (typically zero-rated exports) are
  // converted with the invoice's own BDT equivalent (totalBDT / total). Without
  // it nothing is recorded: a face-value entry would understate the return.
  if (totals.currency !== 'BDT' && !(totals.fxRate > 0) && totals.total > 0) {
    throw httpError(422, `Invoice in ${totals.currency} has no BDT value (totalBDT) — set it before recording output VAT`)
  }
  const fx = totals.fxRate ?? 1
  const base = round2(totals.taxableValue * fx)
  const vat = round2(totals.vatAmount * fx)
  const sd = round2(totals.sdAmount * fx)
  let note = null
  if (totals.currency !== 'BDT' && totals.fxRate) {
    note = `Invoice in ${totals.currency}; converted to BDT at ${Math.round(totals.fxRate * 10000) / 10000} (totalBDT / total)`
  }
  // The Mushak-9.1 note follows the rate (15% → note 4, reduced → note 7), so a
  // rated entry is labelled by its rate too (legacy invoices could mismatch).
  const treatment = ['STANDARD', 'REDUCED'].includes(totals.treatment) && totals.vatRate > 0
    ? treatmentForRate(totals.vatRate)
    : totals.treatment

  const issuedAt = inv.issuedAt ?? null
  const taxDate = date ?? issuedAt ?? new Date()
  const serviceCode = str(inv.serviceCode) || str(items.find(it => str(it.serviceCode))?.serviceCode) || str(settings?.vat?.defaultServiceCode) || null
  const clientId = idOf(inv.clientId)

  const data = {
    entryType:    'OUTPUT_VAT',
    date:         taxDate,
    baseAmount:   base,
    rate:         totals.vatRate,
    amount:       vat,
    sdRate:       totals.sdRate,
    sdAmount:     sd,
    treatment,
    serviceCode,
    partyType:    'CLIENT',
    partyId:      clientId,
    partyName:    buyer.name,
    partyBin:     buyer.bin,
    partyTin:     buyer.tin,
    partyAddress: buyer.address,
    documentNo:   str(inv.invoiceNumber),
    documentDate: issuedAt ?? taxDate,
    invoiceId,
    notes:        note,
  }

  let entry
  try {
    entry = await recordTaxEntry(data, { userId })
  } catch (err) {
    // Unique partial index {invoiceId, entryType} for ACTIVE OUTPUT_VAT: a
    // concurrent call won the race — return its entry. (recordTaxEntry reports
    // the duplicate as a 409; a 409 from a period lock finds no entry and rethrows.)
    if (err?.code === 11000 || err?.status === 409) {
      const dup = await TaxEntry.findOne(activeOutputFilter(invoiceId))
      if (dup) {
        await linkInvoiceEntry(invoice, invoiceId, dup._id)
        return dup
      }
    }
    throw err
  }

  await linkInvoiceEntry(invoice, invoiceId, entry._id)
  return entry
}

/**
 * Void the ACTIVE OUTPUT_VAT entry(ies) of a cancelled invoice and clear
 * invoice.outputVatEntryId. Refuses (409) when the VAT was already declared
 * in a filed return — a credit note (Mushak-6.7) is needed instead.
 * @returns {Promise<object[]>} the voided entries
 */
export async function voidInvoiceOutputVat(invoiceId, { userId = null, reason } = {}) {
  const id = idOf(invoiceId)
  if (!id) throw httpError(400, 'Invalid invoice id')

  const entries = await TaxEntry.find(activeOutputFilter(id)).select('_id filingId entryNo').lean()
  if (!entries.length) {
    await Invoice.updateOne({ _id: id, outputVatEntryId: { $ne: null } }, { $set: { outputVatEntryId: null } })
    return []
  }

  const filingIds = entries.map(e => e.filingId).filter(Boolean)
  if (filingIds.length) {
    const filed = await TaxFiling.findOne({ _id: { $in: filingIds }, status: { $in: FILED_STATUSES } }).select('periodKey').lean()
    if (filed) {
      throw httpError(409, `Output VAT on this invoice was declared in the filed VAT return for ${filed.periodKey}. Issue a credit note (Mushak-6.7) instead of cancelling.`)
    }
  }

  const why = str(reason) || 'Invoice cancelled'
  const voided = []
  for (const e of entries) {
    voided.push(await voidTaxEntry(e._id, { reason: why, userId }))
  }
  await Invoice.updateOne(
    { _id: id, outputVatEntryId: { $in: entries.map(e => e._id) } },
    { $set: { outputVatEntryId: null } },
  )
  return voided
}

// ── settlement split ────────────────────────────────────────────────────────

function settlementTaxBasis(invoice, { creditNoteTax = null, debitNoteTax = null, creditNoteVat = null, debitNoteVat = null } = {}) {
  const t = invoiceTaxTotals(invoice)
  const taxTotal = round2(t.vatAmount + t.sdAmount)
  const debited = num(invoice?.debitedAmount)
  const credited = num(invoice?.creditedAmount)
  // Debit notes raise invoice.total; the tax ratio is taken on the original total.
  const originalTotal = t.total - debited
  if (taxTotal <= 0 || originalTotal <= 0.005) return { ratio: 0, recognizable: 0, vatLeft: 0, vatShare: 0, totals: t }
  const ratio = taxTotal / originalTotal
  const cnTax = creditNoteTax != null ? num(creditNoteTax) : credited * ratio
  const dnTax = debitNoteTax != null ? num(debitNoteTax) : debited * ratio
  // Tax that cash/withholding settlements can carry: credit notes applied to the
  // invoice never become cash, debit notes add their own tax.
  const recognizable = Math.max(0, round2(taxTotal + dnTax - cnTax))
  // The VAT part of it, as the VAT stands after the notes (each note carries its
  // own VAT : SD mix — a note on the SD line takes SD off, not VAT). Without the
  // notes' own VAT figures they are estimated at the invoice's VAT share.
  const origVatShare = t.vatAmount / taxTotal
  const cnVat = creditNoteVat != null ? num(creditNoteVat) : cnTax * origVatShare
  const dnVat = debitNoteVat != null ? num(debitNoteVat) : dnTax * origVatShare
  const vatLeft = Math.min(recognizable, Math.max(0, round2(t.vatAmount + dnVat - cnVat)))
  return { ratio, recognizable, vatLeft, vatShare: recognizable > 0 ? vatLeft / recognizable : 0, totals: t }
}

/**
 * VAT + SD contained in a settlement of `settledAmount` (cash + VDS + TDS, in
 * the invoice currency): share = (vatAmount + sdAmount) × settled / total.
 * With isFinal (the settlement clears the invoice) the remainder is returned:
 * (vatAmount + sdAmount) − alreadyRecognizedVat. Credit/debit notes applied to
 * the invoice are taken into account (estimated at the invoice's tax ratio
 * unless creditNoteTax / debitNoteTax are given). Never negative and never
 * more than the tax still unrecognised.
 * @returns {number}
 */
export function vatPortionOfSettlement(invoice, settledAmount, { alreadyRecognizedVat = 0, isFinal = false, creditNoteTax = null, debitNoteTax = null } = {}) {
  const { ratio, recognizable } = settlementTaxBasis(invoice, { creditNoteTax, debitNoteTax })
  if (ratio <= 0) return 0
  const remaining = Math.max(0, round2(recognizable - num(alreadyRecognizedVat)))
  if (isFinal) return remaining
  const settled = num(settledAmount)
  if (settled <= 0) return 0
  return Math.min(round2(settled * ratio), remaining)
}

/**
 * vatPortionOfSettlement split into its VAT and SD parts, pro rata to the VAT :
 * SD still left on the invoice after its notes (creditNoteVat / debitNoteVat =
 * the VAT-only part of creditNoteTax / debitNoteTax; estimated at the invoice's
 * VAT share when not given). The final settlement (isFinal) takes exactly the
 * VAT still unrecognised — vatLeft − alreadyRecognizedVatOnly (VAT only, no SD,
 * already carved out by earlier settlements) — so rounding and earlier splits
 * never leave VAT on the SD side or vice versa (without alreadyRecognizedVatOnly
 * the final one is split pro rata too). Same options plus those three.
 * @returns {{ vat:number, sd:number, total:number }}
 */
export function vatSdPortionOfSettlement(invoice, settledAmount, opts = {}) {
  const total = vatPortionOfSettlement(invoice, settledAmount, opts)
  if (total <= 0) return { vat: 0, sd: 0, total: 0 }
  const { vatShare, vatLeft } = settlementTaxBasis(invoice, opts)
  const knowsVatOnly = opts.alreadyRecognizedVatOnly !== null && opts.alreadyRecognizedVatOnly !== undefined
  const vat = opts.isFinal && knowsVatOnly
    ? round2(Math.min(total, Math.max(0, vatLeft - num(opts.alreadyRecognizedVatOnly))))
    : round2(Math.min(total, total * vatShare))
  return { vat, sd: round2(total - vat), total }
}
