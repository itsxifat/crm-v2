/**
 * lib/tax/withholding.js — SERVER-ONLY tax sub-ledger postings for settlements.
 *
 *  - recordCustomerWithholding(...)   a client withheld VDS and/or TDS from our invoice
 *                                     ⇒ VDS_RECEIVABLE (Mushak-9.1 note 29 once the 6.6 arrives)
 *                                     ⇒ TDS_RECEIVABLE (advance income tax credit)
 *  - recordPayeeWithholding(...)      we paid a supplier/payee bill
 *                                     ⇒ INPUT_VAT (notes 14/16 creditable, 19/20/21 not)
 *                                     ⇒ VDS_PAYABLE (note 24, we issue Mushak-6.6)
 *                                     ⇒ TDS_PAYABLE (deposit by challan, issue TDS certificate)
 *  - totalRecognizedVatForInvoice(id) VAT + SD already carved out of INCOME rows for an invoice
 *  - recognizedVatSdForInvoice(id)    the same, VAT and SD kept apart (reversed rows left out)
 *
 * All TaxEntry amounts are BDT. Each function is all-or-nothing: entries it
 * created are removed again if a later one fails, and repeated calls for the
 * same payment / expense return the existing entries instead of duplicating.
 */

import mongoose from 'mongoose'
import { TaxEntry, Transaction, Invoice, Client, Vendor, Freelancer, Employee, ProjectExpense } from '@/models'
import { recordTaxEntry } from '@/lib/tax/engine'
import {
  round2, inputVatCreditability, VAT_TREATMENTS, normalizeBin, isValidBin, normalizeTin,
  CLAIM_WINDOW_PERIODS, vatReturnOverrideFor,
} from '@/lib/tax/catalog'
import { getFinanceSettings, assertBooksOpen } from '@/lib/finance/settings'
import { toInstant, taxPeriodOf, addPeriods, vatReturnPeriodFor } from '@/lib/finance/fiscal'
import { invoiceTaxTotals, snapshotInvoiceParties } from '@/lib/tax/invoiceVat'

const PARTY_TYPES = ['CLIENT', 'VENDOR', 'FREELANCER', 'AGENCY', 'EMPLOYEE', 'OTHER']
const PAYEE_TYPES = ['COMPANY', 'INDIVIDUAL', 'NON_RESIDENT']
const TREATMENT_VALUES = VAT_TREATMENTS.map(t => t.value)

// ── small utilities ─────────────────────────────────────────────────────────

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

function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

function cleanBin(v) {
  const s = str(v)
  if (!s) return null
  return isValidBin(s) ? normalizeBin(s) : s
}

function cleanTin(v) {
  const s = str(v)
  return s ? normalizeTin(s) : null
}

function idOf(ref) {
  if (!ref) return null
  const s = String(ref._id ?? ref)
  return mongoose.isValidObjectId(s) ? s : null
}

function plain(sub) {
  if (!sub) return null
  return typeof sub.toObject === 'function' ? sub.toObject() : { ...sub }
}

/** Rate actually applied, as a percentage of the base (null when no base). */
function impliedRate(amount, base) {
  return base > 0 ? round2((amount * 100) / base) : null
}

/** Remove entries created earlier in a failed call (best effort, never throws). */
async function rollback(created) {
  if (!created.length) return
  try {
    await TaxEntry.deleteMany({ _id: { $in: created.map(e => e._id) } })
  } catch (err) {
    console.error('[withholding] rollback of tax entries failed', err)
  }
}

/**
 * Create the entries in order; on failure remove the ones created so far and rethrow.
 * `allowLocked` is used only to step over the VAT lock (filed return) for credits
 * that are claimed in a later open return — the books lock is still enforced here.
 */
async function createAll(specs, existingByType, userId) {
  const created = []
  const out = []
  try {
    for (const { data, allowLocked } of specs) {
      const existing = existingByType.get(data.entryType)
      if (existing) { out.push(existing); continue }
      if (allowLocked) {
        const booksLocked = await assertBooksOpen(data.date)
        if (booksLocked) throw httpError(409, booksLocked)
      }
      const entry = await recordTaxEntry(data, { userId, allowLocked })
      created.push(entry)
      out.push(entry)
    }
  } catch (err) {
    await rollback(created)
    throw err
  }
  return out
}

/**
 * Certificate sub-document from an input of shape { number, date, url } or a
 * bare certificate number. Number present ⇒ `receivedStatus`, else PENDING.
 */
function certificateOf(input, fallback = {}, receivedStatus = 'RECEIVED') {
  let number = null
  let date = null
  let url = null
  if (typeof input === 'string' || typeof input === 'number') {
    number = str(input)
  } else if (input && typeof input === 'object') {
    number = str(input.number ?? input.no ?? input.certificateNo)
    date = input.date ?? input.certificateDate ?? null
    url = str(input.url)
  }
  if (!number) number = str(fallback.number)
  if (!date) date = fallback.date ?? null
  const d = toInstant(date)
  return number
    ? { status: receivedStatus, number, date: d, url }
    : { status: 'PENDING', number: null, date: null, url: null }
}

// ── customer withholding (client withheld VDS / TDS from our invoice) ───────

async function loadInvoice(invoice, projectPayment) {
  if (invoice && typeof invoice === 'object' && !(invoice instanceof mongoose.Types.ObjectId) &&
      (invoice.invoiceNumber !== undefined || invoice.vatTreatment !== undefined)) return invoice
  const id = idOf(invoice) || idOf(projectPayment?.invoiceId)
  return id ? Invoice.findById(id).lean() : null
}

async function clientParty(invoice, projectPayment) {
  if (invoice) {
    const stored = plain(invoice.buyer)
    if (stored && (str(stored.name) || str(stored.bin))) {
      return { id: idOf(invoice.clientId), name: str(stored.name), bin: cleanBin(stored.bin), tin: cleanTin(stored.tin), address: str(stored.address) }
    }
    const { buyer } = await snapshotInvoiceParties(invoice)
    return { id: idOf(invoice.clientId), ...buyer }
  }
  const clientId = idOf(projectPayment?.clientId)
  if (!clientId) return { id: null, name: null, bin: null, tin: null, address: null }
  const { buyer } = await snapshotInvoiceParties({ clientId })
  return { id: clientId, ...buyer }
}

/**
 * Record tax a client withheld at source from a settlement of our invoice.
 *
 * VDS ⇒ VDS_RECEIVABLE: treatment from the invoice; certificate RECEIVED when a
 *       6.6 number is given, else PENDING (claimable in note 29 only once received,
 *       within the payment period + 6). Not blocked by the VAT lock — the claim
 *       lands in the first open return.
 * TDS ⇒ TDS_RECEIVABLE: section, certificate likewise (advance income tax credit).
 * baseAmount = the share of the invoice's taxable value this settlement covers.
 *
 * @param {object} p
 * @param {object|string} p.invoice          Invoice (doc / lean / id) — falls back to projectPayment.invoiceId
 * @param {object} [p.projectPayment]        ProjectPayment (amount, settledAmount, vds/tds certificate fields)
 * @param {number} [p.vdsAmount] [p.tdsAmount]  BDT
 * @param {string} [p.tdsSection]
 * @param {object|string} [p.vdsCertificate] [p.tdsCertificate]  { number, date, url } or number
 * @param {Date|string} [p.date]             payment date (default projectPayment.paymentDate ?? now)
 * @param {number} [p.settledAmount]         cash + VDS + TDS credited to the invoice (default from projectPayment)
 * @returns {Promise<object[]>} [VDS_RECEIVABLE?, TDS_RECEIVABLE?]
 */
export async function recordCustomerWithholding({
  invoice, projectPayment = null, vdsAmount = 0, tdsAmount = 0, tdsSection = null,
  vdsCertificate = null, tdsCertificate = null, date = null, userId = null, transactionId = null,
  settledAmount = null,
} = {}) {
  const vds = round2(num(vdsAmount))
  const tds = round2(num(tdsAmount))
  if (vds < 0 || tds < 0) throw httpError(422, 'Withheld VDS / TDS cannot be negative')
  if (vds <= 0 && tds <= 0) return []

  const inv = await loadInvoice(invoice, projectPayment)
  if (!inv && !projectPayment) throw httpError(400, 'An invoice or payment is required to record customer withholding')

  const totals = inv ? invoiceTaxTotals(inv) : null
  const fx = totals?.fxRate ?? 1

  // Share of the invoice this settlement covers ⇒ base for the 9.1 sub-form / TDS base.
  let settled = numOrNull(settledAmount)
  if (settled === null && projectPayment) {
    settled = numOrNull(projectPayment.settledAmount)
    if (settled === null) settled = num(projectPayment.amount) + vds + tds
  }
  let base = 0
  if (totals) {
    const share = settled !== null && totals.total > 0 ? Math.min(1, Math.max(0, settled / totals.total)) : 1
    base = round2(totals.taxableValue * share * fx)
  } else if (settled !== null) {
    base = round2(settled)
  }

  const party = await clientParty(inv, projectPayment)
  const taxDate = toInstant(date) ?? toInstant(projectPayment?.paymentDate) ?? new Date()
  const invoiceId = inv?._id ?? (idOf(projectPayment?.invoiceId) || null)
  const projectPaymentId = projectPayment?._id ?? null
  const txId = transactionId ?? projectPayment?.transactionId ?? null

  let section = str(tdsSection) || str(projectPayment?.tdsSection)
  if (!section && tds > 0 && party.id) {
    const client = await Client.findById(party.id).select('defaultTdsSection').lean()
    section = str(client?.defaultTdsSection)
  }

  const common = {
    date:         taxDate,
    partyType:    'CLIENT',
    partyId:      party.id,
    partyName:    party.name,
    partyBin:     party.bin,
    partyTin:     party.tin,
    partyAddress: party.address,
    documentNo:   str(inv?.invoiceNumber),
    documentDate: inv?.issuedAt ?? inv?.issueDate ?? null,
    invoiceId,
    projectPaymentId,
    transactionId: txId,
  }

  const specs = []
  if (vds > 0) {
    const treatment = totals && totals.treatment !== 'NONE' ? totals.treatment : null
    specs.push({
      allowLocked: true, // claimed in the first open return (claimDeadline governs)
      data: {
        ...common,
        entryType:   'VDS_RECEIVABLE',
        baseAmount:  base,
        rate:        impliedRate(vds, base),
        amount:      vds,
        treatment,
        serviceCode: str(inv?.serviceCode),
        certificate: certificateOf(vdsCertificate, { number: projectPayment?.vdsCertificateNo, date: projectPayment?.vdsCertificateDate }),
      },
    })
  }
  if (tds > 0) {
    specs.push({
      allowLocked: false,
      data: {
        ...common,
        entryType:   'TDS_RECEIVABLE',
        baseAmount:  base,
        rate:        impliedRate(tds, base),
        amount:      tds,
        section,
        payeeType:   'COMPANY', // we are the payee
        certificate: certificateOf(tdsCertificate, { number: projectPayment?.tdsCertificateNo, date: projectPayment?.tdsCertificateDate }),
      },
    })
  }

  // Idempotency: a retried confirmation of the same payment reuses its entries.
  const existingByType = new Map()
  if (projectPaymentId) {
    const rows = await TaxEntry.find({
      projectPaymentId,
      entryType: { $in: specs.map(s => s.data.entryType) },
      status:    'ACTIVE',
      isOpening: { $ne: true },
    })
    for (const r of rows) if (!existingByType.has(r.entryType)) existingByType.set(r.entryType, r)
  }

  return createAll(specs, existingByType, userId)
}

// ── payee withholding (we paid a supplier / freelancer / employee) ──────────

function normPartyType(v) {
  const s = str(v)?.toUpperCase()
  return s && PARTY_TYPES.includes(s) ? s : null
}

function normPayeeType(v) {
  const s = str(v)?.toUpperCase()
  return s && PAYEE_TYPES.includes(s) ? s : null
}

/** Supplier VAT status (REGISTERED | TURNOVER | UNREGISTERED | FOREIGN) or null. */
function normVatType(v) {
  const s = str(v)?.toUpperCase()
  return s && ['REGISTERED', 'TURNOVER', 'UNREGISTERED', 'FOREIGN'].includes(s) ? s : null
}

/** Payee identity from the caller, completed from the linked Vendor / Freelancer / Employee. */
async function resolvePayee(expense, payee) {
  const p = {
    type:      normPartyType(payee?.type),
    id:        str(payee?.id ?? payee?._id),
    name:      str(payee?.name),
    bin:       cleanBin(payee?.bin),
    tin:       cleanTin(payee?.tin),
    address:   str(payee?.address),
    payeeType: normPayeeType(payee?.payeeType),
    hasPsr:    typeof payee?.hasPsr === 'boolean' ? payee.hasPsr : null,
    vatType:   normVatType(payee?.vatType),
  }
  const complete = p.type && p.name && (p.tin || p.bin)
  if (!complete) {
    try {
      if (expense.vendorId && (!p.type || p.type === 'VENDOR')) {
        const v = await Vendor.findById(idOf(expense.vendorId)).select('company address bin tin payeeType hasPsr vatRegistrationType').lean()
        if (v) {
          p.type ||= 'VENDOR'
          p.id ||= String(v._id)
          p.name ||= str(v.company)
          p.bin ||= cleanBin(v.bin)
          p.tin ||= cleanTin(v.tin)
          p.address ||= str(v.address)
          p.payeeType ||= normPayeeType(v.payeeType)
          p.vatType ||= normVatType(v.vatRegistrationType)
          if (p.hasPsr === null && typeof v.hasPsr === 'boolean') p.hasPsr = v.hasPsr
        }
      } else if ((expense.agencyId || expense.freelancerId) && (!p.type || p.type === 'AGENCY' || p.type === 'FREELANCER')) {
        const f = await Freelancer.findById(idOf(expense.agencyId || expense.freelancerId))
          .select('userId type agencyInfo tin bin payeeType hasPsr address')
          .populate('userId', 'name')
          .lean()
        if (f) {
          p.type ||= f.type === 'AGENCY' ? 'AGENCY' : 'FREELANCER'
          p.id ||= String(f._id)
          p.name ||= str(f.agencyInfo?.agencyName) || str(f.userId?.name)
          p.bin ||= cleanBin(f.bin)
          p.tin ||= cleanTin(f.tin)
          p.address ||= str(f.address)
          p.payeeType ||= normPayeeType(f.payeeType)
          if (p.hasPsr === null && typeof f.hasPsr === 'boolean') p.hasPsr = f.hasPsr
        }
      } else if (expense.paidToEmployeeId && (!p.type || p.type === 'EMPLOYEE')) {
        const e = await Employee.findById(idOf(expense.paidToEmployeeId)).select('userId tin address').populate('userId', 'name').lean()
        if (e) {
          p.type ||= 'EMPLOYEE'
          p.id ||= String(e._id)
          p.name ||= str(e.userId?.name)
          p.tin ||= cleanTin(e.tin)
          p.address ||= str(e.address)
          p.payeeType ||= 'INDIVIDUAL'
        }
      }
    } catch (err) {
      console.error('[withholding] payee lookup failed', err)
    }
  }
  if (!p.name) p.name = str(expense.paidToName)
  if (!p.type) p.type = 'OTHER'
  return p
}

/** INPUT_VAT treatment of a purchase: explicit, else from its VAT rate (15% ⇒ STANDARD). */
function purchaseTreatment(tax, rate) {
  const t = str(tax?.treatment)?.toUpperCase()
  if (t && TREATMENT_VALUES.includes(t) && t !== 'NONE') return t
  if (rate === null || Math.abs(rate - 15) < 0.5) return 'STANDARD'
  return rate > 0 ? 'REDUCED' : 'EXEMPT'
}

async function loadExpense(expense) {
  if (!expense) return null
  if (typeof expense === 'string' || expense instanceof mongoose.Types.ObjectId) {
    const id = idOf(expense)
    return id ? ProjectExpense.findById(id).lean() : null
  }
  return expense
}

/**
 * Record the tax side of a paid supplier / payee bill from `expense.tax`
 * (amounts in the expense currency; converted to BDT with amountBDT/amount).
 *
 * INPUT_VAT    (vatAmount > 0)  creditable when the bill is marked creditable AND
 *              inputVatCreditability(...) passes AND the company is VAT registered;
 *              otherwise nonCreditReason. Not blocked by the VAT lock (claim
 *              window carries it into the first open return).
 * VDS_PAYABLE  (vdsAmount > 0)  certificate PENDING (we issue Mushak-6.6);
 *              deposit VIA_RETURN for a VAT-registered company, else PENDING.
 * TDS_PAYABLE  (tdsAmount > 0)  deposit PENDING, certificate PENDING.
 *
 * @param {object} p
 * @param {object|string} p.expense     ProjectExpense (doc / lean / id) with `tax`
 * @param {object} [p.transaction]      the EXPENSE Transaction of the payment
 * @param {Date|string} [p.date]        payment date (default transaction.date ?? expense.paidAt ?? now)
 * @param {boolean} [p.bankingChannel]  paid through a bank / MFS (s.46 & s.142)
 * @param {{type,id,name,bin,tin,address?,payeeType?,hasPsr?}} [p.payee]
 * @returns {Promise<object[]>} [INPUT_VAT?, VDS_PAYABLE?, TDS_PAYABLE?]
 */
export async function recordPayeeWithholding({ expense, transaction = null, date = null, userId = null, bankingChannel, payee = null } = {}) {
  const exp = await loadExpense(expense)
  if (!exp) throw httpError(404, 'Expense not found')
  const tax = plain(exp.tax) || {}

  // BDT conversion of the bill (tax amounts are in the expense currency).
  const currency = str(exp.currency)?.toUpperCase() || 'BDT'
  const gross = num(exp.amount)
  const fx = currency === 'BDT' ? 1 : (num(exp.amountBDT) > 0 && gross > 0 ? num(exp.amountBDT) / gross : 1)
  const grossBDT = currency === 'BDT' ? round2(gross) : (num(exp.amountBDT) > 0 ? round2(num(exp.amountBDT)) : round2(gross))
  const vatBDT = round2(num(tax.vatAmount) * fx)
  const vdsBDT = round2(num(tax.vdsAmount) * fx)
  const tdsBDT = round2(num(tax.tdsAmount) * fx)
  if (vatBDT < 0 || vdsBDT < 0 || tdsBDT < 0) throw httpError(422, 'VAT / VDS / TDS amounts cannot be negative')
  if (vatBDT <= 0 && vdsBDT <= 0 && tdsBDT <= 0) return []

  const settings = await getFinanceSettings()
  const party = await resolvePayee(exp, payee)
  const taxDate = toInstant(date) ?? toInstant(transaction?.date) ?? toInstant(exp.paidAt) ?? new Date()
  const banking = typeof bankingChannel === 'boolean' ? bankingChannel : null

  // Value of the supply excluding VAT — base for the 6.1 register, the 9.1
  // note-24 sub-form and TDS (withholding is computed on the value excl. VAT).
  const valueExVat = round2(Math.max(0, grossBDT - vatBDT))
  const vatRate = numOrNull(tax.vatRate) ?? (vatBDT > 0 ? impliedRate(vatBDT, valueExVat) : null)
  const treatment = purchaseTreatment(tax, vatRate)
  const supplierBin = cleanBin(tax.supplierBin) || party.bin
  const supplierDoc = str(tax.mushakNo) || str(exp.expenseInvoiceNo) || str(exp.expenseId)
  const supplierDocDate = toInstant(tax.mushakDate) ?? toInstant(exp.date) ?? null
  const registered = settings?.vat?.registrationType === 'REGISTERED'

  const common = {
    date:           taxDate,
    partyType:      party.type,
    partyId:        party.id,
    partyName:      party.name,
    partyBin:       supplierBin,
    partyTin:       party.tin,
    partyAddress:   party.address,
    bankingChannel: banking,
    expenseId:      exp._id ?? null,
    transactionId:  transaction?._id ?? null,
    purchaseBillId: exp.purchaseBillId ?? null,
  }

  const specs = []

  if (vatBDT > 0) {
    const check = inputVatCreditability({
      ourTreatment:    settings?.vat?.defaultSalesTreatment || 'STANDARD',
      // The bill's supplier VAT status, else the payee's master record (s.46: no
      // credit from a turnover-tax / unregistered supplier), else REGISTERED.
      supplierVatType: str(tax.supplierVatType)?.toUpperCase() || party.vatType || 'REGISTERED',
      // s.46: a Mushak-6.3 showing the supplier's BIN (ours is on every 6.3 we receive)
      hasMushak:       !!str(tax.mushakNo) && isValidBin(supplierBin),
      excludedItem:    false,
      grossAmount:     grossBDT,
      bankingChannel:  banking !== false,
    })
    // s.46 claim window: the 6.3's own period + 6, not the payment date. The
    // earliest return this entry can reach is the one containing the payment.
    const payPeriod = taxPeriodOf(taxDate)
    const claimDeadline = addPeriods(taxPeriodOf(supplierDocDate ?? taxDate), CLAIM_WINDOW_PERIODS)
    const payReturn = vatReturnOverrideFor(payPeriod) ?? vatReturnPeriodFor(payPeriod, settings?.vat?.returnFrequency ?? 'MONTHLY')
    const expired = !!claimDeadline && claimDeadline < (payReturn?.start ?? payPeriod)
    let creditable = !!tax.vatCreditable && check.creditable && registered && !expired
    let reason = null
    let note = null
    if (!creditable) {
      if (!check.creditable) {
        reason = check.reason
        if (reason === 'NO_MUSHAK' && str(tax.mushakNo)) note = 'Supplier BIN missing or invalid — the Mushak-6.3 must show the supplier BIN'
      } else if (!registered) {
        reason = 'OTHER'
        note = `Company VAT registration type is ${settings?.vat?.registrationType || 'not set'} — no input tax credit`
      } else if (tax.vatCreditable && expired) {
        reason = 'EXPIRED'
        note = `Mushak-6.3 claim window closed after ${claimDeadline}`
      } else {
        // Marked non-creditable by the user although the statutory checks pass —
        // typically an item excluded from "input" (office equipment, rent…).
        reason = exp.purchaseBillId || num(exp.capitalizedAmountBDT) > 0 ? 'EXCLUDED_ITEM' : 'OTHER'
      }
      creditable = false
    }
    specs.push({
      allowLocked: true, // claim window (6 periods) carries it into the first open return
      data: {
        ...common,
        entryType:       'INPUT_VAT',
        baseAmount:      valueExVat,
        rate:            vatRate,
        amount:          vatBDT,
        treatment,
        serviceCode:     str(tax.vatServiceCode),
        creditable,
        nonCreditReason: reason,
        claimDeadline,
        documentNo:      supplierDoc,
        documentDate:    supplierDocDate,
        notes:           note,
      },
    })
  }

  if (vdsBDT > 0) {
    specs.push({
      allowLocked: false, // reported in note 24 of the period it was deducted
      data: {
        ...common,
        entryType:    'VDS_PAYABLE',
        baseAmount:   valueExVat,
        rate:         numOrNull(tax.vdsRate) ?? impliedRate(vdsBDT, valueExVat),
        amount:       vdsBDT,
        treatment:    vatBDT > 0 ? treatment : null,
        serviceCode:  str(tax.vatServiceCode),
        documentNo:   supplierDoc,
        documentDate: supplierDocDate,
        certificate:  { status: 'PENDING' },
        deposit:      { status: registered ? 'VIA_RETURN' : 'PENDING' },
      },
    })
  }

  if (tdsBDT > 0) {
    // TDS is computed on the bill excl. VAT, unless the bill says otherwise
    // (salary: gross pay, not the net cash + tax that the expense carries).
    const tdsBaseBDT = num(tax.tdsBase) > 0 ? round2(num(tax.tdsBase) * fx) : valueExVat
    const hasPsr = typeof tax.hasPsr === 'boolean' ? tax.hasPsr : party.hasPsr
    const higher = !!tax.higherRateApplied
    const reasons = []
    if (higher) {
      if (hasPsr === false) reasons.push('Payee has no PSR')
      if (banking === false) reasons.push('Payment not through a banking channel')
      if (!reasons.length) reasons.push('Higher rate under s.142')
    }
    const payeeType = normPayeeType(tax.payeeType) || party.payeeType ||
      (['EMPLOYEE', 'FREELANCER'].includes(party.type) ? 'INDIVIDUAL' : (['VENDOR', 'AGENCY'].includes(party.type) ? 'COMPANY' : null))
    specs.push({
      allowLocked: false,
      data: {
        ...common,
        entryType:         'TDS_PAYABLE',
        baseAmount:        tdsBaseBDT,
        rate:              numOrNull(tax.tdsRate) ?? impliedRate(tdsBDT, tdsBaseBDT),
        amount:            tdsBDT,
        section:           str(tax.tdsSection),
        payeeType,
        higherRateApplied: higher,
        higherRateReason:  higher ? reasons.join('; ') : null,
        documentNo:        str(exp.expenseInvoiceNo) || str(exp.expenseId) || supplierDoc,
        documentDate:      toInstant(exp.date) ?? null,
        certificate:       { status: 'PENDING' },
        deposit:           { status: 'PENDING' },
      },
    })
  }

  // Idempotency: paying the same expense twice never duplicates its tax entries.
  const existingByType = new Map()
  if (exp._id) {
    const rows = await TaxEntry.find({
      expenseId: exp._id,
      entryType: { $in: specs.map(s => s.data.entryType) },
      status:    'ACTIVE',
      isOpening: { $ne: true },
    })
    for (const r of rows) if (!existingByType.has(r.entryType)) existingByType.set(r.entryType, r)
  }

  return createAll(specs, existingByType, userId)
}

// ── recognised VAT on an invoice ────────────────────────────────────────────

/**
 * Ids of the invoice's INCOME rows that have been reversed (reverseMoneyEntry —
 * e.g. a client payment reversed in Accounts). Their reversal rows carry no
 * `tax`, so the reversed rows themselves must be left out of every "already
 * recognised" sum, or the next settlement would carve out too little VAT.
 * @returns {Promise<import('mongoose').Types.ObjectId[]>}
 */
export async function reversedIncomeRowIds(invoiceId) {
  const id = idOf(invoiceId)
  if (!id) return []
  const ids = await Transaction.distinct('reversalOf', {
    invoiceId: new mongoose.Types.ObjectId(id),
    reversalOf: { $type: 'objectId' },
  })
  return ids.filter(Boolean)
}

/**
 * Σ tax.vatBDT and Σ tax.sdBDT over the (un-reversed) INCOME transactions
 * linked to the invoice — the VAT / SD already carved out of revenue by
 * earlier settlements, kept apart (BDT).
 * @returns {Promise<{ vat:number, sd:number, total:number }>}
 */
export async function recognizedVatSdForInvoice(invoiceId) {
  const id = idOf(invoiceId)
  if (!id) return { vat: 0, sd: 0, total: 0 }
  const toNum = (path) => ({ $convert: { input: path, to: 'double', onError: 0, onNull: 0 } })
  const reversed = await reversedIncomeRowIds(id)
  const [row] = await Transaction.aggregate([
    { $match: {
      invoiceId: new mongoose.Types.ObjectId(id),
      type: 'INCOME',
      reversalOf: null,
      ...(reversed.length ? { _id: { $nin: reversed } } : {}),
    } },
    { $group: { _id: null, vat: { $sum: toNum('$tax.vatBDT') }, sd: { $sum: toNum('$tax.sdBDT') } } },
  ])
  const vat = round2(num(row?.vat))
  const sd = round2(num(row?.sd))
  return { vat, sd, total: round2(vat + sd) }
}

/**
 * Σ tax.vatBDT + tax.sdBDT over the (un-reversed) INCOME transactions linked
 * to the invoice — the VAT/SD already carved out of revenue by earlier settlements.
 * @returns {Promise<number>}
 */
export async function totalRecognizedVatForInvoice(invoiceId) {
  return (await recognizedVatSdForInvoice(invoiceId)).total
}
