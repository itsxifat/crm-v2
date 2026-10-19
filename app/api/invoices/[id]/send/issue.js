/**
 * Invoice tax point helpers shared by POST /api/invoices/[id]/send and
 * PATCH /api/invoices/[id]/status (SERVER-ONLY — not a route file).
 *
 *  - issueDraftInvoice(invoice, …)   DRAFT → SENT: issuedAt, seller/buyer snapshots, OUTPUT_VAT entry
 *  - ensureIssuedOutputVat(invoice, …) repair path for an already issued VAT invoice without its entry
 *  - issueWarnings(invoice)          Mushak-6.3 compliance warnings (missing BINs)
 *
 * The status flip and the OUTPUT_VAT entry are written separately (no Mongo
 * transactions in this codebase), so a failed VAT posting rolls the invoice
 * back to DRAFT — an issued VAT invoice without its output VAT would silently
 * go missing from the VAT return.
 */

import { Invoice } from '@/models'
import {
  snapshotInvoiceParties, recordInvoiceOutputVat, voidInvoiceOutputVat, invoiceTaxTotals,
} from '@/lib/tax/invoiceVat'
import { BUYER_BIN_THRESHOLD } from '@/lib/tax/catalog'
import { getCompanyProfile } from '@/lib/finance/settings'

function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

const plain = (sub) => (sub && typeof sub.toObject === 'function' ? sub.toObject() : (sub ?? null))

/** True when the invoice carries a VAT treatment (Mushak-6.3 applies). */
export function isVatTreatment(invoice) {
  const t = invoice?.vatTreatment
  return !!t && t !== 'NONE'
}

/**
 * Compliance warnings for an issued VAT invoice (never blocking):
 *  - buyer BIN missing while the taxable value is over Tk 25,000 (Rule 40(1)(c)(iv))
 *  - company BIN not configured (the seller BIN is mandatory on Mushak-6.3)
 * @returns {Promise<string[]>}
 */
export async function issueWarnings(invoice) {
  const warnings = []
  if (!isVatTreatment(invoice)) return warnings
  const t = invoiceTaxTotals(invoice)
  const valueBDT = t.taxableValue * (t.fxRate ?? 1)
  const buyer = plain(invoice.buyer)
  if (['STANDARD', 'REDUCED'].includes(t.treatment) && !buyer?.bin && valueBDT > BUYER_BIN_THRESHOLD + 0.005) {
    warnings.push(
      `The client has no BIN on record. Mushak-6.3 needs the buyer's name, address and BIN when the supply is over Tk ${BUYER_BIN_THRESHOLD.toLocaleString('en-BD')} — add it on the client profile so the client can claim input VAT.`,
    )
  }
  const seller = plain(invoice.seller)
  if (!seller?.bin) {
    let companyBin = ''
    try { companyBin = (await getCompanyProfile())?.bin ?? '' } catch { companyBin = '' }
    if (!companyBin) warnings.push('The company BIN is not set (Tax & VAT → Tax Settings), so Mushak-6.3 prints without the seller BIN.')
  }
  return warnings
}

/**
 * Issue a DRAFT invoice: status SENT, sentAt, issuedAt (tax point), seller /
 * buyer snapshots, then the OUTPUT_VAT TaxEntry (VAT invoices only; zero-rated
 * and exempt invoices get a 0-VAT entry so their value reaches the return).
 *
 * @param {object} invoice  the invoice as read (Mongoose doc or lean), status DRAFT
 * @param {{ userId?: string|null, stampSentAt?: boolean }} [opts]
 *        stampSentAt: true ⇒ sentAt = now (send route); false ⇒ only when empty (status route)
 * @returns {Promise<{ invoice: object, outputVatEntry: object|null, warnings: string[] }>}
 * @throws Error with .status (409 when the status changed meanwhile or VAT could not be posted)
 */
export async function issueDraftInvoice(invoice, { userId = null, stampSentAt = true } = {}) {
  // Mushak-6.3 and the VAT return need Taka figures: a foreign-currency VAT
  // invoice must carry its BDT value before the tax point (checked before the
  // status flip, so there is nothing to roll back).
  const t = invoiceTaxTotals(invoice)
  if (t.treatment !== 'NONE' && t.currency !== 'BDT' && !(t.fxRate > 0) && t.total > 0) {
    throw httpError(422, `Set the BDT value of this ${t.currency} invoice (edit the draft and enter its BDT total or exchange rate) before issuing — Mushak-6.3 and the VAT return need Taka figures.`)
  }

  const id = invoice._id ?? invoice.id
  const now = new Date()
  const prev = {
    sentAt:   invoice.sentAt ?? null,
    issuedAt: invoice.issuedAt ?? null,
    seller:   plain(invoice.seller),
    buyer:    plain(invoice.buyer),
  }
  const issuedAt = prev.issuedAt ?? now
  const parties = await snapshotInvoiceParties(invoice)

  const set = {
    status:   'SENT',
    issuedAt,
    sentAt:   stampSentAt ? now : (prev.sentAt ?? now),
    seller:   parties.seller,
    buyer:    parties.buyer,
  }

  // Conditional on DRAFT, so two concurrent issues can't both apply.
  const updated = await Invoice.findOneAndUpdate({ _id: id, status: 'DRAFT' }, { $set: set }, { new: true })
  if (!updated) throw httpError(409, 'Invoice status changed in the meantime. Reload and try again.')

  let outputVatEntry = null
  try {
    outputVatEntry = await recordInvoiceOutputVat(updated, { userId, date: issuedAt })
  } catch (err) {
    // Roll the invoice back to DRAFT and drop any half-written VAT entry.
    try {
      await voidInvoiceOutputVat(id, { userId, reason: 'Invoice issue rolled back' })
    } catch (e) {
      console.error('[issueDraftInvoice] rollback: void output VAT failed', e)
    }
    const restore = { status: 'DRAFT', sentAt: prev.sentAt, issuedAt: prev.issuedAt, outputVatEntryId: null }
    const unset = {}
    if (prev.seller) restore.seller = prev.seller
    else unset.seller = 1
    if (prev.buyer) restore.buyer = prev.buyer
    else unset.buyer = 1
    await Invoice.updateOne(
      { _id: id, status: 'SENT' },
      Object.keys(unset).length ? { $set: restore, $unset: unset } : { $set: restore },
    ).catch(e => console.error('[issueDraftInvoice] rollback: restore DRAFT failed', e))
    const wrapped = httpError(err?.status ?? 500, err?.status
      ? `Invoice not issued — output VAT could not be recorded: ${err.message}`
      : 'Invoice not issued — output VAT could not be recorded. Try again.')
    wrapped.cause = err
    throw wrapped
  }

  const warnings = await issueWarnings(updated)
  return { invoice: updated, outputVatEntry, warnings }
}

/**
 * Repair path for an already issued VAT invoice whose OUTPUT_VAT entry is
 * missing (e.g. issued before VAT went live). Idempotent; never throws —
 * problems come back as warnings.
 * @returns {Promise<{ outputVatEntry: object|null, warnings: string[] }>}
 */
export async function ensureIssuedOutputVat(invoice, { userId = null } = {}) {
  const warnings = []
  if (!isVatTreatment(invoice) || ['DRAFT', 'CANCELLED'].includes(invoice.status) || invoice.outputVatEntryId) {
    return { outputVatEntry: null, warnings }
  }
  try {
    const date = invoice.issuedAt ?? invoice.sentAt ?? invoice.issueDate ?? new Date()
    const outputVatEntry = await recordInvoiceOutputVat(invoice, { userId, date })
    return { outputVatEntry, warnings }
  } catch (err) {
    console.error('[ensureIssuedOutputVat]', err)
    warnings.push(`Output VAT for this invoice is not recorded yet: ${err?.status ? err.message : 'unexpected error'}. Ask the tax team to add it in Tax & VAT → Tax Ledger.`)
    return { outputVatEntry: null, warnings }
  }
}
