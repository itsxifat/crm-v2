/**
 * lib/expensePayment.js — SERVER-ONLY expense settlement pipeline.
 *
 * Every outgoing payment (vendor, freelancer, agency, salary, reimbursement,
 * project spend, purchase bill) is a ProjectExpense that moves
 * PENDING → PAID → AUTHORIZED. Paying it:
 *   • posts ONE EXPENSE Transaction through lib/finance/ledger.postMoneyEntry —
 *     cash = net payable (gross − VDS − TDS), dated on the payment date, on the
 *     money account it was paid from, with the tax breakdown and P&L amount;
 *   • records the tax sub-ledger through lib/tax/withholding.recordPayeeWithholding —
 *     INPUT_VAT (VAT in the bill), VDS_PAYABLE, TDS_PAYABLE;
 *   • flips the linked records (project cost, freelancer assignment, salary
 *     payout / slip) and notifies the payee.
 *
 * `amount` on the expense is the GROSS bill (incl. VAT) in `currency`;
 * `tax` amounts are in the same currency and converted to BDT with
 * amountBDT / amount. Errors carry `.status` (and `.field` / `.details` for
 * validation) so routes can map them:
 *   catch (err) { if (err.status) return NextResponse.json({ error: err.message, ...(err.details && { details: err.details }) }, { status: err.status }) }
 */

import { z } from 'zod'
import connectDB from '@/lib/mongodb'
import {
  Project, ProjectExpense, Transaction, FreelancerAssignment, SalaryPayout, Freelancer, SalarySlip,
  MoneyAccount, TaxEntry, TaxFiling, Vendor, Employee, PurchaseBill, Asset,
} from '@/models'
import { createNotification } from '@/lib/createNotification'
import { logActivity } from '@/lib/logActivity'
import { isValidObjectId } from '@/lib/objectId'
import { canDo } from '@/lib/rbac'
import { isValidCurrency, formatMoney } from '@/lib/currencies'
import { dhakaDayKey, parseDhakaDay } from '@/lib/dhakaTime'
import {
  postMoneyEntry, reverseMoneyEntry, normalizeChannel, channelFromPaymentMethod, isBankingChannel,
  CASH_ACCOUNT_TYPES, PAYMENT_CHANNEL_VALUES,
} from '@/lib/finance/ledger'
import { getFinanceSettings, assertBooksOpen, assertTaxOpen, requireAccountIfLive } from '@/lib/finance/settings'
import {
  isDayKey, toInstant, taxPeriodOf, addPeriods, vatReturnPeriodFor, periodLabel,
} from '@/lib/finance/fiscal'
import { recordPayeeWithholding } from '@/lib/tax/withholding'
import { inputVatCreditability, voidTaxEntry } from '@/lib/tax/engine'
import {
  round2, VAT_TREATMENT_VALUES, SUPPLIER_VAT_TYPES, INPUT_NON_CREDIT_REASONS, isValidBin, normalizeBin,
  catalogTdsSection, CLAIM_WINDOW_PERIODS, vatReturnOverrideFor, isVatEntryType,
} from '@/lib/tax/catalog'
import { accountTypeLabel, PAYMENT_CHANNEL_LABELS, MFS_PROVIDER_LABELS } from '@/lib/finance/constants'

const EPS = 0.005

// ─────────────────────────────────────────────────────────────────────────────
// Small utilities
// ─────────────────────────────────────────────────────────────────────────────

function httpError(status, message, extra = null) {
  const err = new Error(message)
  err.status = status
  if (extra) Object.assign(err, extra)
  return err
}

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const str = (v) => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s || null
}

const idOf = (v) => (v === null || v === undefined || v === '' ? null : (v?._id ?? v))

/** Plain object of an expense's tax sub-document (null when absent). */
function taxObj(expense) {
  const t = expense?.tax
  if (!t) return null
  return typeof t.toObject === 'function' ? t.toObject() : { ...t }
}

// Calendar day in the business timezone (Asia/Dhaka, UTC+6, no DST).
const DHAKA_OFFSET_MS = 6 * 60 * 60 * 1000
function ymd(date) {
  const d = new Date(new Date(date).getTime() + DHAKA_OFFSET_MS)
  return `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, '0')}${String(d.getUTCDate()).padStart(2, '0')}`
}

function catSlug(s) {
  return String(s || 'OTHER').toUpperCase().replace(/[^A-Z0-9]+/g, '').slice(0, 12) || 'OTHER'
}

// ─────────────────────────────────────────────────────────────────────────────
// Combined-invoice batch references (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

// Deterministic reference for a combined/authorized invoice covering a group of
// expenses. Stable across print → pay because it derives only from the group's
// shared date + category. Mixed groups collapse to MULTI / MIXED.
export function computeBatchRef(expenses) {
  const days = new Set(expenses.map(e => ymd(e.date)))
  const cats = new Set(expenses.map(e => e.category || 'OTHER'))
  const dayPart = days.size === 1 ? [...days][0] : 'MULTI'
  const catPart = cats.size === 1 ? catSlug([...cats][0]) : 'MIXED'
  return `EXB-${dayPart}-${catPart}`
}

// The batch reference the given expenses already share (persisted when the
// combined invoice was first printed / authorized), or null if they don't all
// carry the same one.
export function sharedBatchRef(expenses) {
  const refs = new Set(expenses.map(e => e.batchInvoiceNo ?? null))
  return refs.size === 1 ? [...refs][0] : null
}

// A batch reference that no other batch uses yet: the deterministic base
// (EXB-YYYYMMDD-CATEGORY) for the first batch, then -2, -3, … for later batches
// with the same date + category.
export async function allocateBatchRef(expenses) {
  const base = computeBatchRef(expenses)
  const esc  = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const used = await ProjectExpense.distinct('batchInvoiceNo', { batchInvoiceNo: { $regex: `^${esc}(-\\d+)?$` } })
  if (used.length === 0) return base
  const highest = Math.max(1, ...used.map(r => Number(String(r).slice(base.length + 1)) || 1))
  return `${base}-${highest + 1}`
}

// Undo the pending links of an expense that will never be paid (rejected or
// deleted before payment), so the source records don't get stuck:
//   • FreelancerAssignment  → back to paymentStatus PENDING (can request again)
//   • SalaryPayout          → CANCELLED
//   • SalarySlip            → deleted (frees the period for regeneration)
//   • PurchaseBill          → payment REQUESTED → UNPAID (can be paid / requested again)
export async function unwindExpenseLinks(expense) {
  await FreelancerAssignment.updateMany(
    { expenseId: expense._id, paymentStatus: 'PAYMENT_REQUESTED' },
    { $set: { paymentStatus: 'PENDING', expenseId: null } },
  )
  if (expense.salaryPayoutId) {
    await SalaryPayout.updateOne(
      { _id: expense.salaryPayoutId, status: 'PENDING' },
      { $set: { status: 'CANCELLED' } },
    )
  }
  if (expense.employeeSalarySlipId) {
    await SalarySlip.deleteOne({ _id: expense.employeeSalarySlipId, expenseId: expense._id })
  }
  if (expense.purchaseBillId) {
    // Same transition as the purchases module's read-time sync; only the bill
    // whose open request is THIS expense is touched.
    await PurchaseBill.updateOne(
      { _id: idOf(expense.purchaseBillId), 'payment.expenseId': expense._id, 'payment.status': 'REQUESTED' },
      { $set: { 'payment.status': 'UNPAID', 'payment.accountId': null, 'payment.paymentMethod': null } },
    ).catch(err => console.error('[expensePayment] purchase bill unwind failed', String(expense._id), err))
  }
}

/**
 * $set fragment that makes a purchase bill show the withholding actually applied
 * when its expense was paid: Accounts may change VDS / TDS at payment (TDS can
 * depend on the payment channel, ITA s.142) — only the bill's VAT is locked
 * (lockPurchaseBillVat). Bills are BDT-only; {} for any other currency or an
 * expense without tax details.
 * @param {object} expense  the paid ProjectExpense (document or lean, with tax / currency / amount)
 * @returns {object} dotted PurchaseBill paths → values
 */
export function billWithholdingSet(expense) {
  const t = taxObj(expense)
  if (!t || (str(expense?.currency) || 'BDT').toUpperCase() !== 'BDT') return {}
  const vds = round2(num(t.vdsAmount))
  const tds = round2(num(t.tdsAmount))
  const net = t.netPayable === null || t.netPayable === undefined ? null : Number(t.netPayable)
  return {
    'vds.amount':            vds,
    'vds.serviceCode':       str(t.vatServiceCode),
    'vds.rate':              vds > 0 ? (t.vdsRate ?? null) : null,
    'tds.amount':            tds,
    'tds.section':           str(t.tdsSection),
    'tds.rate':              tds > 0 ? (t.tdsRate ?? null) : null,
    'tds.higherRateApplied': tds > 0 && Boolean(t.higherRateApplied),
    netPayable:              round2(Number.isFinite(net) ? net : num(expense.amount) - vds - tds),
  }
}

/**
 * Accounts paid the payment request of a purchase bill (PATCH /api/expenses/:id
 * action 'pay'): mark the bill PAID with the ledger row / account / method and
 * the VDS / TDS / net payable actually applied (billWithholdingSet), and link its
 * assets — the same result as the purchases module's read-time sync, written
 * immediately. Only a bill whose open request is this expense is touched (bills
 * paid on receipt / "pay now" in Inventory set their own payment fields).
 * Never throws: the payment itself is complete.
 * @param {object} expense  the PAID ProjectExpense (document or lean)
 */
export async function markPurchaseBillPaid(expense) {
  const billId = idOf(expense?.purchaseBillId)
  if (!billId || !expense?._id || !['PAID', 'AUTHORIZED'].includes(expense.status)) return
  const txId = idOf(expense.accountsTransactionId)
  const set = {
    'payment.status':        'PAID',
    'payment.expenseId':     expense._id,
    'payment.transactionId': txId ?? null,
    ...billWithholdingSet(expense),
  }
  if (idOf(expense.accountId)) set['payment.accountId'] = idOf(expense.accountId)
  if (expense.paymentMethod) set['payment.paymentMethod'] = expense.paymentMethod
  try {
    const res = await PurchaseBill.updateOne(
      { _id: billId, 'payment.expenseId': expense._id, 'payment.status': 'REQUESTED' },
      { $set: set },
    )
    if (res.modifiedCount && txId) {
      await Asset.updateMany(
        { 'purchase.billId': billId },
        { $set: { 'purchase.expenseId': expense._id, 'purchase.transactionId': txId } },
      )
    }
  } catch (err) {
    console.error('[expensePayment] purchase bill payment sync failed', String(expense._id), err)
  }
}

/**
 * The payment of a purchase bill's request was reversed (reverseExpensePayment):
 * the expense is PENDING again, so the bill goes back to "payment requested" —
 * exactly like a REQUEST-mode bill: no paid-from account / method (markPurchaseBillPaid
 * writes them again when Accounts pays) — and its assets drop the reversed ledger
 * link. Stock, assets and costs are untouched.
 * Never throws: the reversal itself is complete.
 * @param {object} expense  the expense as it was before the reversal (lean)
 */
export async function markPurchaseBillReversed(expense) {
  const billId = idOf(expense?.purchaseBillId)
  if (!billId || !expense?._id) return
  try {
    const res = await PurchaseBill.updateOne(
      { _id: billId, 'payment.expenseId': expense._id, 'payment.status': 'PAID' },
      { $set: {
        'payment.status': 'REQUESTED', 'payment.mode': 'REQUEST', 'payment.transactionId': null,
        'payment.accountId': null, 'payment.paymentMethod': null,
      } },
    )
    if (res.modifiedCount) {
      await Asset.updateMany(
        { 'purchase.billId': billId, 'purchase.transactionId': idOf(expense.accountsTransactionId) ?? null },
        { $set: { 'purchase.transactionId': null } },
      )
    }
  } catch (err) {
    console.error('[expensePayment] purchase bill reversal sync failed', String(expense._id), err)
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Expense tax sub-document (VAT in the bill, VDS / TDS we withhold)
// ─────────────────────────────────────────────────────────────────────────────

export const EXPENSE_TAX_DEFAULTS = Object.freeze({
  vatAmount: 0, vatRate: null, vatCreditable: false, treatment: null,
  supplierBin: null, supplierVatType: null, mushakNo: null, mushakDate: null,
  vatServiceCode: null, vdsRate: null, vdsAmount: 0,
  tdsSection: null, tdsRate: null, tdsAmount: 0, tdsBase: null,
  payeeType: null, hasPsr: null, higherRateApplied: false,
  netPayable: null, taxDeductible: true,
})

const SUPPLIER_VAT_TYPE_VALUES = SUPPLIER_VAT_TYPES.map(t => t.value)

/** A vendor's VAT registration type as an expense tax.supplierVatType; null when not on file. */
export function supplierVatTypeOf(vendor) {
  const t = str(vendor?.vatRegistrationType)?.toUpperCase() ?? null
  return SUPPLIER_VAT_TYPE_VALUES.includes(t) ? t : null
}
const PAYEE_TYPE_VALUES = ['COMPANY', 'INDIVIDUAL', 'NON_RESIDENT']
const TAX_LABELS = {
  vatAmount: 'VAT in the bill', vdsAmount: 'VDS', tdsAmount: 'TDS', tdsBase: 'TDS base',
  vatRate: 'VAT rate', vdsRate: 'VDS rate', tdsRate: 'TDS rate',
}

function taxFieldError(field, message) {
  return httpError(422, message, { field: `tax.${field}` })
}

function coerceBool(field, v, fallback) {
  if (v === null || v === undefined || v === '') return fallback
  if (typeof v === 'boolean') return v
  if (v === 'true' || v === 1 || v === '1') return true
  if (v === 'false' || v === 0 || v === '0') return false
  throw taxFieldError(field, `${field} must be true or false`)
}

function coerceEnum(field, v, values, label) {
  const s = str(v)
  if (!s) return null
  const up = s.toUpperCase()
  if (!values.includes(up)) throw taxFieldError(field, `${label} must be one of ${values.join(', ')}`)
  return up
}

function coerceText(field, v, max, label) {
  const s = str(v)
  if (!s) return null
  if (s.length > max) throw taxFieldError(field, `${label} is too long (max ${max} characters)`)
  return s
}

/**
 * Validate & normalise an expense `tax` input, merged over `base` (the stored
 * tax, if any). Only keys present in `input` change; unknown keys are ignored.
 * Amounts are in the expense currency. netPayable is always recomputed as
 * amount − VDS − TDS.
 *
 * Rules: amounts ≥ 0; rates 0–100; VAT ≤ bill; VDS ≤ VAT in the bill;
 * TDS ≤ bill excluding VAT; TDS needs a section; VDS + TDS < bill (something
 * must be paid); supplier BIN 9 or 13 digits. tdsBase (optional, ≥ 0; 0/blank ⇒
 * null) is the amount the TDS is computed on when that is not the bill excluding
 * VAT — salary: gross pay — and TDS may not exceed it.
 *
 * @param {object|null|undefined} input
 * @param {{ amount: number, base?: object|null }} opts  amount = gross bill (> 0)
 * @returns {object|undefined} plain tax object, or undefined when there is no input and no base
 * @throws Error .status 422, .field 'tax.<key>'
 */
export function buildExpenseTax(input, { amount, base = null } = {}) {
  const baseObj = base ? (typeof base.toObject === 'function' ? base.toObject() : { ...base }) : null
  if ((input === undefined || input === null) && !baseObj) return undefined
  if (input !== undefined && input !== null && (typeof input !== 'object' || Array.isArray(input))) {
    throw httpError(422, 'Tax details must be an object', { field: 'tax' })
  }

  const out = { ...EXPENSE_TAX_DEFAULTS }
  if (baseObj) {
    for (const k of Object.keys(EXPENSE_TAX_DEFAULTS)) {
      if (baseObj[k] !== undefined) out[k] = baseObj[k]
    }
  }
  const src = input ?? {}
  const has = (k) => Object.prototype.hasOwnProperty.call(src, k) && src[k] !== undefined

  for (const k of ['vatAmount', 'vdsAmount', 'tdsAmount']) {
    if (!has(k)) continue
    const v = src[k]
    if (v === null || v === '') { out[k] = 0; continue }
    const n = Number(v)
    if (!Number.isFinite(n) || n < 0) throw taxFieldError(k, `${TAX_LABELS[k]} must be zero or a positive amount`)
    out[k] = round2(n)
  }
  for (const k of ['vatRate', 'vdsRate', 'tdsRate']) {
    if (!has(k)) continue
    const v = src[k]
    if (v === null || v === '') { out[k] = null; continue }
    const n = Number(v)
    if (!Number.isFinite(n) || n < 0 || n > 100) throw taxFieldError(k, `${TAX_LABELS[k]} must be between 0 and 100%`)
    out[k] = n
  }
  if (has('tdsBase')) {
    const v = src.tdsBase
    if (v === null || v === '') out.tdsBase = null
    else {
      const n = Number(v)
      if (!Number.isFinite(n) || n < 0) throw taxFieldError('tdsBase', `${TAX_LABELS.tdsBase} must be zero or a positive amount`)
      out.tdsBase = n > 0 ? round2(n) : null
    }
  }
  if (has('vatCreditable'))     out.vatCreditable     = coerceBool('vatCreditable', src.vatCreditable, false)
  if (has('higherRateApplied')) out.higherRateApplied = coerceBool('higherRateApplied', src.higherRateApplied, false)
  if (has('taxDeductible'))     out.taxDeductible     = coerceBool('taxDeductible', src.taxDeductible, true)
  if (has('hasPsr'))            out.hasPsr            = coerceBool('hasPsr', src.hasPsr, null)
  if (has('treatment'))       out.treatment       = coerceEnum('treatment', src.treatment, VAT_TREATMENT_VALUES, 'VAT treatment')
  if (has('supplierVatType')) out.supplierVatType = coerceEnum('supplierVatType', src.supplierVatType, SUPPLIER_VAT_TYPE_VALUES, 'Supplier VAT status')
  if (has('payeeType'))       out.payeeType       = coerceEnum('payeeType', src.payeeType, PAYEE_TYPE_VALUES, 'Payee type')
  if (has('supplierBin')) {
    const raw = str(src.supplierBin)
    if (!raw) out.supplierBin = null
    else {
      const compact = raw.replace(/\s+/g, '')
      if (!isValidBin(compact)) throw taxFieldError('supplierBin', 'Supplier BIN must be 9 or 13 digits, e.g. 000123456-0101')
      out.supplierBin = normalizeBin(compact)
    }
  }
  if (has('mushakNo'))       out.mushakNo       = coerceText('mushakNo', src.mushakNo, 60, 'Mushak-6.3 number')
  if (has('vatServiceCode')) out.vatServiceCode = coerceText('vatServiceCode', src.vatServiceCode, 40, 'VAT service code')
  if (has('tdsSection'))     out.tdsSection     = coerceText('tdsSection', src.tdsSection, 40, 'TDS section')
  if (has('mushakDate')) {
    if (!str(src.mushakDate)) out.mushakDate = null
    else {
      const d = toInstant(src.mushakDate)
      if (!d) throw taxFieldError('mushakDate', 'Mushak-6.3 date must be a valid date (YYYY-MM-DD)')
      out.mushakDate = d
    }
  }

  // Cross-field checks against the gross bill.
  const gross = round2(num(amount))
  const vat = round2(num(out.vatAmount))
  const vds = round2(num(out.vdsAmount))
  const tds = round2(num(out.tdsAmount))
  if (vat > gross + EPS) throw taxFieldError('vatAmount', 'VAT cannot be more than the bill amount')
  if (vds > vat + EPS) {
    throw taxFieldError('vdsAmount', vat > 0
      ? 'VDS cannot be more than the VAT in the bill'
      : 'Enter the VAT in the bill before deducting VDS — VDS cannot exceed the VAT charged')
  }
  if (tds > round2(gross - vat) + EPS) throw taxFieldError('tdsAmount', 'TDS cannot be more than the bill value excluding VAT')
  if (tds > 0 && num(out.tdsBase) > 0 && tds > round2(num(out.tdsBase)) + EPS) {
    throw taxFieldError('tdsAmount', 'TDS cannot be more than the amount it is deducted from (TDS base)')
  }
  if (tds > 0 && !out.tdsSection) throw taxFieldError('tdsSection', 'Select the TDS section for the tax deducted')
  if (vds + tds >= gross - EPS) throw taxFieldError('tdsAmount', 'VDS + TDS cannot take the whole bill — the net payable must be more than zero')
  if (vat <= 0) out.vatCreditable = false

  out.vatAmount = vat
  out.vdsAmount = vds
  out.tdsAmount = tds
  out.netPayable = round2(gross - vds - tds)
  return out
}

/**
 * BDT settlement figures of an expense (pure). Tax amounts are converted with
 * the expense's BDT rate (amountBDT / amount), exactly like recordPayeeWithholding.
 * @returns {{ currency, gross, grossBDT, fx, vat, vds, tds, net, vatBDT, vdsBDT, tdsBDT, netBDT, capitalizedBDT, hasTax, tax }}
 */
export function expenseSettlement(expense) {
  const e = expense ?? {}
  const currency = (str(e.currency) || 'BDT').toUpperCase()
  const gross = round2(num(e.amount))
  const bdtRaw = e.amountBDT === null || e.amountBDT === undefined || e.amountBDT === '' ? null : num(e.amountBDT)
  const grossBDT = currency === 'BDT' ? gross : round2(bdtRaw !== null && bdtRaw > 0 ? bdtRaw : gross)
  const fx = currency === 'BDT' ? 1 : (gross > 0 ? grossBDT / gross : 1)
  const t = taxObj(e)
  const vat = round2(num(t?.vatAmount))
  const vds = round2(num(t?.vdsAmount))
  const tds = round2(num(t?.tdsAmount))
  const net = round2(gross - vds - tds)
  const vatBDT = round2(vat * fx)
  const vdsBDT = round2(vds * fx)
  const tdsBDT = round2(tds * fx)
  return {
    currency, gross, grossBDT, fx, vat, vds, tds, net,
    vatBDT, vdsBDT, tdsBDT,
    netBDT: round2(grossBDT - vdsBDT - tdsBDT),
    capitalizedBDT: round2(num(e.capitalizedAmountBDT)),
    hasTax: !!t,
    tax: t,
  }
}

/**
 * Ledger kind & P&L amount of an expense payment (SPEC §8 "Expense paid"), and
 * costBDT — the bill excluding creditable input VAT (the VAT goes to the VAT
 * return, not to cost): what the payment adds to the project's cost.
 */
function ledgerKind(fig, creditable) {
  const creditableVat = creditable ? fig.vatBDT : 0
  const capitalized = fig.capitalizedBDT
  const chargeable = round2(fig.grossBDT - creditableVat)
  const isAsset = capitalized > 0 && capitalized >= chargeable - EPS
  return {
    kind: isAsset ? 'ASSET_PURCHASE' : 'OPERATING',
    plAmountBDT: isAsset ? 0 : Math.max(0, round2(chargeable - capitalized)),
    costBDT: Math.max(0, chargeable),
  }
}

// Salary / rent paid outside a bank are disallowed for income tax (ITA 2023 s.55).
// Same patterns as the payment form (app/admin/accounts/page.js).
const SALARY_RE = /\bsalar(y|ies)\b|\bwages?\b|\bpayroll\b/i
const RENT_RE   = /\brent(al)?s?\b/i   // rent, rental(s), house rent, office rent…
// Channels that are not a bank / mobile-wallet transfer for the s.55 cash rule.
const CASH_RULE_CHANNELS = ['CASH', 'CHEQUE', 'OTHER']

function salaryOrRent(expense) {
  const text = `${expense?.category ?? ''} ${expense?.subcategory ?? ''}`
  if (expense?.origin === 'SALARY' || SALARY_RE.test(text)) return 'SALARY'
  if (RENT_RE.test(text)) return 'RENT'
  return null
}

/**
 * s.55 "cash": paid in cash / by bearer cheque / some other way, or from a money
 * account that is not a banking channel (cash, petty cash, or flagged non-banking).
 */
function isCashLikePayment(channel, account) {
  if (channel && CASH_RULE_CHANNELS.includes(channel)) return true
  return !!account && (CASH_ACCOUNT_TYPES.includes(account.type) || account.isBankingChannel === false)
}

/**
 * BIN and VAT status of the expense's payee from its master record (vendor, else
 * agency / freelancer) — the same fallbacks recordPayeeWithholding uses when the
 * bill carries no supplier BIN / supplier VAT status. Freelancers have no VAT
 * status on file (vatType null ⇒ the caller's default).
 * @returns {Promise<{ bin: string|null, vatType: string|null }>}
 */
async function payeeTaxOf(expense) {
  const none = { bin: null, vatType: null }
  try {
    const vendorId = idOf(expense?.vendorId)
    if (vendorId) {
      if (!isValidObjectId(vendorId)) return none
      const v = await Vendor.findById(vendorId).select('bin vatRegistrationType').lean()
      return { bin: str(v?.bin), vatType: supplierVatTypeOf(v) }
    }
    const fid = idOf(expense?.agencyId) ?? idOf(expense?.freelancerId)
    if (fid && isValidObjectId(fid)) {
      const f = await Freelancer.findById(fid).select('bin').lean()
      return { bin: str(f?.bin), vatType: null }
    }
  } catch (err) {
    console.error('[expensePayment] payee tax lookup failed', String(expense?._id), err)
  }
  return none
}

/** Why creditable input VAT was lost on this payment (human text), from evaluatePayment(). */
function nonCreditReasonText(ev) {
  if (ev.creditCheck && !ev.creditCheck.creditable) {
    if (ev.creditCheck.reason === 'NO_MUSHAK' && ev.binMissing) {
      return 'the supplier BIN is missing or invalid — the Mushak-6.3 must show the supplier BIN'
    }
    return INPUT_NON_CREDIT_REASONS[ev.creditCheck.reason] ?? ev.creditCheck.reason
  }
  if (!ev.registered) return 'the company is not VAT registered'
  if (ev.expired) {
    return `${INPUT_NON_CREDIT_REASONS.EXPIRED} — this Mushak-6.3 could be claimed up to ${periodLabel(ev.claimDeadline)}`
  }
  return 'it is not creditable'
}

/**
 * Channel, banking status, input-VAT creditability and compliance warnings for
 * paying `expense` from `account` (lean MoneyAccount or null) on `paidAt` —
 * mirrors the checks recordPayeeWithholding applies so the ledger P&L matches
 * the tax entries: a Mushak-6.3 showing a valid supplier BIN, the s.46 banking
 * rule, VAT registration, and the claim window (the 6.3's period + 6 must not
 * end before the VAT return that contains the payment date).
 */
async function evaluatePayment(expense, { account = null, channel = null, paymentMethod = null, paidAt = null } = {}) {
  const settings = await getFinanceSettings()
  const ch = normalizeChannel(channel) ?? channelFromPaymentMethod(paymentMethod, account)
  const banking = isBankingChannel({ channel: ch, account })
  const cashLike = isCashLikePayment(ch, account)
  const fig = expenseSettlement(expense)
  const tax = fig.tax
  const registered = settings?.vat?.registrationType === 'REGISTERED'

  // Supplier VAT status / BIN: the bill's, else the payee's master record (s.46:
  // no input credit from a turnover-tax or unregistered supplier), else REGISTERED.
  const ownVatType = str(tax?.supplierVatType)?.toUpperCase() || null
  const payeeTax = (fig.vatBDT > 0 || fig.vdsBDT > 0) && (!ownVatType || !str(tax?.supplierBin))
    ? await payeeTaxOf(expense)
    : { bin: null, vatType: null }
  const supplierVatType = ownVatType || payeeTax.vatType || 'REGISTERED'

  let creditable = false
  let creditCheck = null
  let binMissing = false
  let claimDeadline = null
  let expired = false
  if (fig.vatBDT > 0) {
    // s.46: the 6.3 must show the supplier's BIN (ours is on every 6.3 we receive).
    const supplierBin = str(tax?.supplierBin) || payeeTax.bin
    binMissing = !isValidBin(supplierBin)
    creditCheck = inputVatCreditability({
      ourTreatment:    settings?.vat?.defaultSalesTreatment || 'STANDARD',
      supplierVatType,
      hasMushak:       !!str(tax?.mushakNo) && !binMissing,
      excludedItem:    false,
      grossAmount:     fig.grossBDT,
      bankingChannel:  banking !== false,
    })
    // Claim window: the 6.3's own period (else the bill date) + 6 periods; the
    // earliest return this credit can reach is the one containing the payment.
    const payDate = toInstant(paidAt) ?? new Date()
    const payPeriod = taxPeriodOf(payDate)
    const docDate = toInstant(tax?.mushakDate) ?? toInstant(expense?.date) ?? payDate
    claimDeadline = addPeriods(taxPeriodOf(docDate), CLAIM_WINDOW_PERIODS)
    const payReturn = vatReturnOverrideFor(payPeriod)
      ?? vatReturnPeriodFor(payPeriod, settings?.vat?.returnFrequency ?? 'MONTHLY')
    expired = !!claimDeadline && claimDeadline < (payReturn?.start ?? payPeriod)
    creditable = !!tax?.vatCreditable && creditCheck.creditable && registered && !expired
  }

  const kindOfCost = salaryOrRent(expense)
  const nonDeductibleCash = cashLike && !!kindOfCost

  const warnings = []
  if (nonDeductibleCash) {
    warnings.push({
      code: kindOfCost === 'SALARY' ? 'CASH_SALARY' : 'CASH_RENT',
      message: `${kindOfCost === 'SALARY' ? 'Salary' : 'Rent'} paid in cash is not an allowable expense for income tax (ITA 2023 s.55) — it is recorded as non-deductible. Pay through a bank or mobile wallet to keep it deductible.`,
    })
  }
  if (fig.vatBDT > 0 && tax?.vatCreditable && !creditable) {
    const reason = nonCreditReasonText({ creditCheck, registered, expired, claimDeadline, binMissing })
    warnings.push({ code: 'NO_ITC', message: `Input VAT is not creditable: ${reason}. It is charged to expenses instead.` })
  }
  if (fig.tdsBDT > 0 && !banking && !tax?.higherRateApplied && str(tax?.tdsSection) !== '86-SALARY') {
    warnings.push({
      code: 'TDS_HIGHER_RATE',
      message: 'This payment is not by bank transfer — TDS should be deducted at the 50% higher rate (ITA 2023 s.142).',
    })
  }
  if (fig.vdsBDT > 0 && ['UNREGISTERED', 'TURNOVER', 'FOREIGN'].includes(supplierVatType)) {
    warnings.push({ code: 'VDS_SUPPLIER', message: 'VDS was deducted from a supplier who is not VAT registered — check that a Mushak-6.6 is really due.' })
  }

  return {
    settings, channel: ch, banking, cashLike, figures: fig, creditable, creditCheck, registered,
    binMissing, claimDeadline, expired, nonDeductibleCash, warnings,
    supplierVatType, payeeVatType: payeeTax.vatType,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Payment
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 'YYYY-MM-DD' (Dhaka day; today ⇒ now), Date or ISO string → Date. Empty ⇒ now.
 * @throws 422 on an invalid value
 */
export function resolvePaidDate(value) {
  if (value === null || value === undefined || value === '') return new Date()
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw httpError(422, 'Invalid payment date', { field: 'paidAt' })
    return value
  }
  const s = String(value).trim()
  if (isDayKey(s)) return s === dhakaDayKey(new Date()) ? new Date() : parseDhakaDay(s).start
  const d = new Date(s)
  if (Number.isNaN(d.getTime())) throw httpError(422, 'Payment date must be a valid date (YYYY-MM-DD)', { field: 'paidAt' })
  return d
}

/** crm_config payment-method value implied by a money account (used when none is given). */
export function paymentMethodForAccount(account) {
  if (!account) return null
  const linked = (account.linkedPaymentMethods ?? []).map(v => str(v)).filter(Boolean)
  if (linked.length) return linked[0].toUpperCase()
  if (CASH_ACCOUNT_TYPES.includes(account.type)) return 'CASH'
  if (account.type === 'MFS') return str(account.mfsProvider) && account.mfsProvider !== 'OTHER' ? account.mfsProvider : 'OTHER'
  if (account.type === 'CARD') return 'CARD'
  if (account.type === 'GATEWAY') return 'ONLINE'
  return 'BANK_TRANSFER'
}

const isDuplicateTxnId = (err) =>
  err?.code === 11000 && !!(err?.keyPattern?.txnId || err?.keyValue?.txnId !== undefined || /txnId|Transaction ID/i.test(String(err?.message)))

// Posts the ledger entry, using the accountant-entered external reference as
// txnId when it is free. Transaction.txnId is globally unique, but one bank
// transfer can legitimately settle several expenses, so when the reference is
// already taken the system generates the txnId and the reference is kept in
// the description instead of failing the payment.
async function postLedgerEntry(data, externalRef, userId) {
  if (externalRef) {
    try {
      return await postMoneyEntry({ ...data, txnId: externalRef }, { userId })
    } catch (err) {
      if (!isDuplicateTxnId(err)) throw err
    }
  }
  return postMoneyEntry({
    ...data,
    description: externalRef ? `${data.description} (Ref: ${externalRef})` : data.description,
  }, { userId })
}

/**
 * PENDING → PAID. Records the payment (method / txn id / proof / account /
 * channel / date), posts the EXPENSE Transaction for the NET cash paid on the
 * payment date, records INPUT_VAT / VDS_PAYABLE / TDS_PAYABLE, bumps the
 * project cost by the bill excluding creditable input VAT (recorded as
 * expense.projectCostBDT), and flips any linked FreelancerAssignment / SalaryPayout.
 *
 * The caller owns the payment-field guards and must first claim the expense
 * atomically (conditional findOneAndUpdate on status PENDING) so a repeated
 * request can never pay twice — see payExpenseNow(). Persist `expense.tax`,
 * `currency` and `amountBDT` on the document before calling.
 *
 * If posting or the tax entries fail, the ledger row is removed again and
 * `expense.accountsTransactionId` is left null so the claim can be released.
 *
 * @param {import('mongoose').Document} expense  claimed ProjectExpense document
 * @param {object} opts
 * @param {string} opts.userId
 * @param {string} opts.paymentMethod           crm_config payment-method value
 * @param {string} [opts.paymentProofUrl]
 * @param {string} [opts.paymentTxnId]          external reference (used as txnId when free)
 * @param {string} [opts.accountManager]
 * @param {string} [opts.accountId]             MoneyAccount paid from (required after go-live)
 * @param {string} [opts.channel]               PAYMENT_CHANNELS value (default from method + account)
 * @param {Date|string} [opts.paidAt]           payment date — the ledger date (default now)
 * @param {{no,date,bank}} [opts.cheque]
 * @param {object} [opts.payee]                 override for recordPayeeWithholding
 * @returns {Promise<import('mongoose').Document>} the created Transaction
 */
export async function payExpense(expense, {
  userId, paymentMethod, paymentProofUrl = null, paymentTxnId = null, accountManager,
  accountId = null, channel = null, paidAt = null, cheque = null, payee = null,
} = {}) {
  const paidDate = resolvePaidDate(paidAt)

  let account = null
  const accountRef = idOf(accountId)
  if (accountRef) {
    if (!isValidObjectId(accountRef)) throw httpError(422, 'Invalid money account', { field: 'accountId' })
    account = await MoneyAccount.findById(accountRef).lean()
    if (!account) throw httpError(422, 'Money account not found', { field: 'accountId' })
  }

  const ev = await evaluatePayment(expense, { account, channel, paymentMethod, paidAt: paidDate })
  const fig = ev.figures
  if (!(fig.net > 0)) throw httpError(422, 'Net payable must be greater than zero')
  // A purchase bill whose assets were costed NET of creditable VAT must keep that
  // credit — paying it in a way that loses the credit (e.g. cash for a supply over
  // Tk 1,00,000, VAT Act s.46) would leave the assets under-costed.
  if (expense.purchaseBillId && expense.tax?.vatCreditable && fig.vatBDT > 0 && !ev.creditable
      && Number(expense.capitalizedAmountBDT) > 0) {
    const why = ev.creditCheck && !ev.creditCheck.creditable ? ev.creditCheck.reason : null
    const [fix, field] = why === 'CASH_OVER_LIMIT'
      ? ['Pay through a bank or mobile-wallet account, or cancel the bill and re-enter it with VAT not creditable.', 'accountId']
      : why === 'NO_MUSHAK'
        ? ['Enter the supplier\'s Mushak-6.3 number and BIN, or cancel the bill and re-enter it with VAT not creditable.', ev.binMissing ? 'tax.supplierBin' : 'tax.mushakNo']
        : ['Cancel the bill and re-enter it with VAT not creditable.', 'tax.vatCreditable']
    throw httpError(422, `This purchase bill's assets were costed without VAT because the input VAT is creditable, but paying it now makes it non-creditable (${nonCreditReasonText(ev)}). ${fix}`, { field })
  }

  expense.paymentMethod   = paymentMethod ?? null
  expense.paymentProofUrl = paymentProofUrl
  expense.paymentTxnId    = paymentTxnId
  expense.paidBy          = userId
  expense.paidAt          = paidDate
  expense.status          = 'PAID'
  expense.accountId       = account?._id ?? null
  expense.channel         = ev.channel ?? null

  // Server-computed net payable; cash salary/rent is non-deductible (s.55).
  if (expense.tax) {
    expense.tax.netPayable = fig.net
    if (ev.nonDeductibleCash) expense.tax.taxDeductible = false
    // The supplier VAT status taken from the payee's master record is kept on the
    // bill, so it shows what the input VAT was judged on (and the tax entries,
    // which read the saved bill, use the same status).
    if (!str(expense.tax.supplierVatType) && ev.payeeVatType && fig.vatBDT > 0) expense.tax.supplierVatType = ev.payeeVatType
  } else if (ev.nonDeductibleCash) {
    expense.tax = { ...EXPENSE_TAX_DEFAULTS, netPayable: fig.net, taxDeductible: false }
  }
  const taxDeductible = expense.tax ? expense.tax.taxDeductible !== false : true

  const { kind, plAmountBDT } = ledgerKind(fig, ev.creditable)
  const project = expense.projectId
    ? await Project.findById(idOf(expense.projectId)).select('projectCode venture').lean()
    : null

  const txn = await postLedgerEntry({
    type:             'EXPENSE',
    kind,
    category:         expense.category,
    expenseCategory:  expense.subcategory ?? null,
    description:      project ? `[${project.projectCode ?? project.venture ?? ''}] ${expense.title}` : expense.title,
    amount:           fig.net,
    currency:         fig.currency,
    amountBDT:        fig.netBDT,
    date:             paidDate,
    reference:        expense._id.toString(),
    projectId:        idOf(expense.projectId),
    receiptUrl:       expense.paymentProofUrl ?? expense.invoiceUrl ?? null,
    paymentMethod:    expense.paymentMethod ?? null,
    accountManager:   accountManager || userId,
    createdBy:        userId,
    paidBy:           userId,
    freelancerId:     idOf(expense.freelancerId)?.toString() ?? null,
    agencyId:         idOf(expense.agencyId),
    vendorId:         idOf(expense.vendorId)?.toString() ?? null,
    paidToEmployeeId: idOf(expense.paidToEmployeeId),
    paidToName:       expense.paidToName ?? null,
    accountId:        account?._id ?? null,
    channel:          ev.channel,
    cheque:           cheque ?? null,
    plAmountBDT,
    purchaseBillId:   idOf(expense.purchaseBillId),
    tax: {
      grossBDT:           fig.grossBDT,
      vatBDT:             fig.vatBDT,
      sdBDT:              0,
      vdsBDT:             fig.vdsBDT,
      tdsBDT:             fig.tdsBDT,
      inputVatCreditable: fig.vatBDT > 0 ? ev.creditable : null,
      taxDeductible,
    },
  }, expense.paymentTxnId || null, userId)

  const undoLedger = async () => {
    await Transaction.deleteOne({ _id: txn._id })
      .catch(e => console.error('[expensePayment] compensating ledger delete failed', String(txn._id), e))
    expense.syncedToAccounts      = false
    expense.accountsTransactionId = null
  }

  expense.syncedToAccounts      = true
  expense.accountsTransactionId = txn._id
  // Nothing is on the project's cost yet; the amount is recorded below as it is added.
  expense.projectCostBDT        = project ? 0 : null
  try {
    await expense.save()
  } catch (err) {
    await undoLedger()
    throw err
  }

  // Tax sub-ledger (expense.tax is saved above, as recordPayeeWithholding expects).
  let entries = []
  try {
    entries = await recordPayeeWithholding({
      expense, transaction: txn, date: paidDate, userId, bankingChannel: ev.banking, payee,
    })
  } catch (err) {
    await undoLedger()
    await ProjectExpense.updateOne(
      { _id: expense._id },
      { $set: { syncedToAccounts: false, accountsTransactionId: null } },
    ).catch(e => console.error('[expensePayment] failed to unlink ledger row after tax failure', String(expense._id), e))
    throw err
  }

  // The INPUT_VAT entry actually recorded decides whether the VAT is creditable.
  const inputVat = entries.find(e => e.entryType === 'INPUT_VAT')
  const finalCreditable = inputVat && typeof inputVat.creditable === 'boolean' ? inputVat.creditable : ev.creditable

  if (entries.length) {
    const ids = entries.map(e => e._id)
    const set = { taxEntryIds: ids }
    // Keep the P&L consistent with the INPUT_VAT entry actually recorded.
    if (finalCreditable !== ev.creditable) {
      const fixed = ledgerKind(fig, finalCreditable)
      set.kind = fixed.kind
      set.plAmountBDT = fixed.plAmountBDT
      set['tax.inputVatCreditable'] = finalCreditable
    }
    try {
      await Transaction.updateOne({ _id: txn._id }, { $set: set })
      txn.taxEntryIds = ids
      if (set.kind) {
        txn.kind = set.kind
        txn.plAmountBDT = set.plAmountBDT
        if (txn.tax) txn.tax.inputVatCreditable = set['tax.inputVatCreditable']
      }
      expense.taxEntryIds = ids
      await expense.save()
    } catch (err) {
      // The entries already carry expenseId / transactionId; a failed back-link
      // must not undo a completed payment.
      console.error('[expensePayment] linking tax entries failed', String(expense._id), err)
    }
  }

  if (project) {
    // Project cost = the bill excluding creditable input VAT (that VAT is
    // recovered in the VAT return; project revenue is likewise net of output VAT).
    // The amount is recorded on the expense first — guarded on this payment still
    // standing — so a reversal takes off exactly what was added; then the atomic
    // increment (never a read-modify-write of the running total).
    const projectCostBDT = ledgerKind(fig, finalCreditable).costBDT
    const recorded = await ProjectExpense.updateOne(
      { _id: expense._id, status: { $in: REVERSIBLE_STATUSES }, accountsTransactionId: txn._id },
      { $set: { projectCostBDT } },
    )
    if (recorded.matchedCount && projectCostBDT > 0) {
      try {
        await Project.updateOne({ _id: project._id }, { $inc: { approvedExpenses: projectCostBDT } })
      } catch (err) {
        await ProjectExpense.updateOne(
          { _id: expense._id, accountsTransactionId: txn._id, projectCostBDT },
          { $set: { projectCostBDT: 0 } },
        ).catch(e => console.error('[expensePayment] failed to reset the recorded project cost', String(expense._id), e))
        throw err
      }
    }
    if (recorded.matchedCount) expense.projectCostBDT = projectCostBDT
  }

  const linkedAssignment = await FreelancerAssignment.findOne({ expenseId: expense._id })
  if (linkedAssignment) {
    linkedAssignment.paymentStatus = 'PAID'
    linkedAssignment.approvedAt    = new Date()
    linkedAssignment.approvedBy    = userId
    await linkedAssignment.save()
  }

  if (expense.salaryPayoutId) {
    const payout = await SalaryPayout.findById(idOf(expense.salaryPayoutId))
    if (payout && payout.status !== 'PAID') {
      payout.status        = 'PAID'
      payout.amountBDT     = fig.grossBDT
      payout.transactionId = txn._id
      payout.approvedBy    = userId
      payout.approvedAt    = new Date()
      await payout.save()

      const freelancer = await Freelancer.findById(payout.freelancerId).populate('userId', 'name').lean()
      if (freelancer?.userId?._id) {
        createNotification({
          userId:  freelancer.userId._id.toString(),
          title:   'Salary paid',
          message: `Your salary for ${payout.period} has been paid.`,
          type:    'PAYMENT',
          link:    '/freelancer',
        }).catch(() => {})
      }
    }
  }

  if (expense.employeeSalarySlipId) {
    const slip = await SalarySlip.findById(idOf(expense.employeeSalarySlipId))
      .populate({ path: 'employeeId', populate: { path: 'userId', select: 'name' } })
    const staffUserId = slip?.employeeId?.userId?._id
    if (staffUserId) {
      createNotification({
        userId:  staffUserId.toString(),
        title:   'Salary paid',
        message: `Your salary for ${slip.period} has been paid.`,
        type:    'PAYMENT',
        link:    '/admin/profile',
      }).catch(() => {})
    }
  }

  return txn
}

// ─── Request body for "pay" ──────────────────────────────────────────────────

const blankToUndef = (v) => (v === '' || v === null ? undefined : v)
const optStr = (max) => z.preprocess(blankToUndef, z.string().trim().max(max).optional())

const payBodySchema = z.object({
  note:            optStr(2000),
  accountManager:  optStr(40),
  currency:        optStr(10),
  amountBDT:       z.preprocess(blankToUndef, z.coerce.number().positive('BDT amount must be greater than zero').optional()),
  paymentMethod:   optStr(40),
  paymentProofUrl: optStr(1000),
  paymentTxnId:    optStr(120),
  accountId:       optStr(40),
  channel:         optStr(40),
  paidAt:          optStr(40),
  cheque:          z.preprocess(blankToUndef, z.object({
    no:   optStr(40),
    date: optStr(40),
    bank: optStr(120),
  }).optional()),
  tax:             z.preprocess(blankToUndef, z.record(z.any()).optional()),
}).passthrough()

/**
 * Validate the "pay" request body. Throws 422 { message:'Validation failed', details }.
 * @returns {object} parsed body (strings trimmed; blanks dropped)
 */
export function parsePayBody(body) {
  const parsed = payBodySchema.safeParse(body ?? {})
  if (!parsed.success) throw httpError(422, 'Validation failed', { details: parsed.error.flatten() })
  const d = parsed.data
  for (const k of ['note', 'accountManager', 'currency', 'paymentMethod', 'paymentProofUrl', 'paymentTxnId', 'accountId', 'channel', 'paidAt']) {
    if (d[k] === '') d[k] = undefined
  }
  return d
}

/**
 * Expense raised from a purchase bill: the bill fixed its VAT amount and whether
 * that VAT is creditable when it was received, and its assets were costed on
 * that basis — so a payment may not change either. Returns the pay body's `tax`
 * without vatAmount / vatCreditable (the stored values are kept), plus a
 * warning when the body tried to change them. Any other expense: unchanged.
 * @param {object} expense     ProjectExpense (document or lean)
 * @param {object|undefined} taxInput  the pay body's `tax`
 * @returns {{ input: object|undefined, warning: {code:string, message:string}|null }}
 */
export function lockPurchaseBillVat(expense, taxInput) {
  if (!idOf(expense?.purchaseBillId) || !taxInput || typeof taxInput !== 'object' || Array.isArray(taxInput)) {
    return { input: taxInput, warning: null }
  }
  const stored = taxObj(expense) ?? {}
  const input = { ...taxInput }
  const changed = []
  if (input.vatAmount !== undefined) {
    const v = input.vatAmount === null || input.vatAmount === '' ? 0 : Number(input.vatAmount)
    if (!Number.isFinite(v) || Math.abs(round2(v) - round2(num(stored.vatAmount))) > EPS) changed.push('VAT amount')
    delete input.vatAmount
  }
  if (input.vatCreditable !== undefined) {
    const raw = input.vatCreditable
    const wanted = raw === true || raw === 'true' || raw === 1 || raw === '1'
    if (wanted !== !!stored.vatCreditable) changed.push('input-tax credit')
    delete input.vatCreditable
  }
  if (!changed.length) return { input, warning: null }
  const vatText = formatMoney(round2(num(stored.vatAmount)), (str(expense.currency) || 'BDT').toUpperCase())
  return {
    input,
    warning: {
      code: 'VAT_LOCKED',
      message: `This payment settles a purchase bill, so its VAT stays as the bill recorded it (${vatText}, ${stored.vatCreditable ? 'creditable' : 'not creditable'}) — the bill's assets were costed on that basis. The ${changed.join(' and ')} entered here was ignored; to change it, cancel the bill and re-enter it.`,
    },
  }
}

/**
 * The complete "pay an expense now" sequence used by PATCH /api/expenses/:id
 * (action 'pay') and by purchase bills paid on receipt:
 *   validate body → claim PENDING → PAID atomically → persist currency / BDT /
 *   tax → assign the EXV voucher number → payExpense() → on failure release
 *   the claim (unless the ledger row survived).
 *
 * body (all optional unless noted):
 *   paymentMethod    crm_config value (CASH, BANK_TRANSFER, BKASH…); derived from the account when omitted.
 *                    One of paymentMethod / accountId is required.
 *   accountId        MoneyAccount id — REQUIRED for payment dates on/after finance goLiveDate
 *   channel          PAYMENT_CHANNELS value (CASH, CHEQUE, AC_PAYEE_CHEQUE, PAY_ORDER, BEFTN, RTGS, NPSB,
 *                    BANK_TRANSFER, MFS, CARD, GATEWAY, CHALLAN, INTERNAL, OTHER); default from method + account
 *   paidAt           'YYYY-MM-DD' payment date (Dhaka; default today; not in the future) — the ledger date
 *   paymentTxnId     external reference; paymentProofUrl  uploaded proof (one of them required when requireProof)
 *   cheque           { no, date:'YYYY-MM-DD', bank }
 *   currency         override the expense currency; amountBDT  BDT equivalent of the GROSS bill (required for non-BDT)
 *   note             review note; accountManager  User id
 *   tax              { vatAmount, vatRate, vatCreditable, treatment, supplierBin, supplierVatType, mushakNo,
 *                      mushakDate, vatServiceCode, vdsRate, vdsAmount, tdsSection, tdsRate, tdsAmount, tdsBase,
 *                      payeeType, hasPsr, higherRateApplied, taxDeductible } — amounts in the expense currency,
 *                    merged over the stored tax; netPayable is recomputed (amount − VDS − TDS).
 *                    Purchase-bill expenses keep the bill's vatAmount / vatCreditable (lockPurchaseBillVat).
 *
 * @param {string} expenseId
 * @param {object} body
 * @param {object} session   next-auth session (needs finance.payments.confirm)
 * @param {{ requireProof?: boolean, request?: Request }} [options]
 * @returns {Promise<{ expense, transaction, taxEntries, warnings }>}
 *   expense / transaction are mongoose documents; taxEntries lean TaxEntry rows;
 *   warnings [{ code, message }] (compliance hints — the payment was recorded).
 * @throws Error with .status (401/403/404/409/422; .details for body validation, .field for a bad field)
 */
export async function payExpenseNow(expenseId, body = {}, session, { requireProof = false, request = null } = {}) {
  await connectDB()
  const userId = session?.user?.id
  if (!userId) throw httpError(401, 'Unauthorised')
  if (!canDo(session, 'finance.payments.confirm')) throw httpError(403, 'Forbidden')
  const id = idOf(expenseId)
  if (!isValidObjectId(id)) throw httpError(404, 'Not found')

  const input = parsePayBody(body)

  const expense = await ProjectExpense.findById(id)
  if (!expense) throw httpError(404, 'Not found')
  if (expense.status !== 'PENDING') throw httpError(422, 'Only pending expenses can be paid')

  const amount = round2(num(expense.amount))
  if (!(amount > 0)) throw httpError(422, 'This expense has no amount to pay — correct or reject it')

  // Actual spend currency + BDT equivalent of the gross bill (taxes are in BDT).
  const currency = (input.currency ?? expense.currency ?? 'BDT').toUpperCase()
  if (!isValidCurrency(currency)) throw httpError(422, 'Invalid currency', { field: 'currency' })
  let amountBDT
  if (currency === 'BDT') {
    amountBDT = amount
  } else {
    amountBDT = input.amountBDT ?? (num(expense.amountBDT) > 0 ? num(expense.amountBDT) : null)
    if (!(amountBDT > 0)) throw httpError(422, 'Enter the BDT-equivalent for this foreign-currency expense', { field: 'amountBDT' })
    amountBDT = round2(amountBDT)
  }

  // A purchase bill's VAT was settled when the bill was received: its assets were
  // costed net (creditable) or gross (not creditable) of that VAT, so the payment
  // keeps the bill's VAT amount and credit — only the other tax details may change.
  const { input: taxInput, warning: vatLockWarning } = lockPurchaseBillVat(expense, input.tax)
  const tax = buildExpenseTax(taxInput, { amount, base: expense.tax })
  const netPayable = round2(amount - num(tax?.vdsAmount) - num(tax?.tdsAmount))
  if (!(netPayable > 0)) throw httpError(422, 'Net payable must be greater than zero')

  // Money account
  let account = null
  if (input.accountId) {
    if (!isValidObjectId(input.accountId)) throw httpError(422, 'Invalid money account', { field: 'accountId' })
    account = await MoneyAccount.findById(input.accountId).lean()
    if (!account) throw httpError(422, 'Money account not found', { field: 'accountId' })
    if (account.status !== 'ACTIVE') throw httpError(409, `${account.name} is archived — choose an active account`, { field: 'accountId' })
    const acctCur = account.currency || 'BDT'
    if (acctCur !== currency && acctCur !== 'BDT') {
      throw httpError(422, `${account.name} holds ${acctCur} but this expense is in ${currency} — pay it from a ${currency} or BDT account`, { field: 'accountId' })
    }
  }

  const paymentMethod = input.paymentMethod ? input.paymentMethod.toUpperCase() : paymentMethodForAccount(account)
  if (!paymentMethod) throw httpError(422, 'Select the payment method or the account it was paid from', { field: 'paymentMethod' })

  if (input.channel) {
    // Channel codes and legacy method codes (BKASH → MFS…) are accepted; anything else is a typo.
    const raw = input.channel.toUpperCase()
    const ch = normalizeChannel(raw)
    if (!ch || (ch === 'OTHER' && raw !== 'OTHER' && !PAYMENT_CHANNEL_VALUES.includes(raw))) {
      throw httpError(422, `Unknown payment channel — use one of ${PAYMENT_CHANNEL_VALUES.join(', ')}`, { field: 'channel' })
    }
  }

  if (requireProof && !input.paymentProofUrl && !input.paymentTxnId) {
    throw httpError(422, 'Provide a transaction ID or upload payment proof', { field: 'paymentTxnId' })
  }

  if (input.accountManager && !isValidObjectId(input.accountManager)) {
    throw httpError(422, 'Invalid account manager', { field: 'accountManager' })
  }

  const paidDate = resolvePaidDate(input.paidAt)
  if (dhakaDayKey(paidDate) > dhakaDayKey(new Date())) {
    throw httpError(422, 'Payment date cannot be in the future', { field: 'paidAt' })
  }

  // Period locks & go-live rule up front, so nothing is claimed for a doomed payment.
  const booksLocked = await assertBooksOpen(paidDate)
  if (booksLocked) throw httpError(409, booksLocked, { code: 'BOOKS_LOCKED', field: 'paidAt' })
  if (num(tax?.vdsAmount) > 0) {
    const taxLocked = await assertTaxOpen(paidDate)
    if (taxLocked) throw httpError(409, taxLocked, { field: 'paidAt' })
  }
  const missingAccount = await requireAccountIfLive(paidDate, account?._id ?? null)
  if (missingAccount) throw httpError(422, missingAccount, { code: 'ACCOUNT_REQUIRED', field: 'accountId' })

  let cheque = null
  if (input.cheque && (input.cheque.no || input.cheque.bank || input.cheque.date)) {
    const chequeDate = input.cheque.date ? toInstant(input.cheque.date) : null
    if (input.cheque.date && !chequeDate) throw httpError(422, 'Cheque date must be a valid date', { field: 'cheque.date' })
    cheque = { no: input.cheque.no ?? null, bank: input.cheque.bank ?? null, date: chequeDate }
  }

  // Claim the PENDING → PAID transition atomically: a double-click or two
  // accountants paying at once can only ever produce one ledger entry.
  // projectCostBDT 0 from the claim on: nothing is on the project's cost yet, so a
  // reversal racing this payment takes nothing off (null would mean "older payment,
  // gross added" — see reverseExpensePayment).
  const claimed = await ProjectExpense.findOneAndUpdate(
    { _id: expense._id, status: 'PENDING' },
    { $set: { status: 'PAID', paidBy: userId, paidAt: paidDate, projectCostBDT: idOf(expense.projectId) ? 0 : null } },
    { new: true },
  )
  if (!claimed) throw httpError(422, 'Only pending expenses can be paid')

  let txn
  try {
    claimed.reviewedBy = userId
    claimed.reviewedAt = new Date()
    claimed.reviewNote = input.note ?? null
    claimed.currency   = currency
    claimed.amountBDT  = amountBDT
    if (tax !== undefined) claimed.tax = tax

    if (!claimed.expenseInvoiceNo) claimed.expenseInvoiceNo = await ProjectExpense.nextNumber('expenseInvoiceNo', 'EXV')

    txn = await payExpense(claimed, {
      userId,
      paymentMethod,
      paymentProofUrl: input.paymentProofUrl ?? null,
      paymentTxnId:    input.paymentTxnId ?? null,
      accountManager:  input.accountManager ?? null,
      accountId:       account?._id ?? null,
      channel:         input.channel ?? null,
      paidAt:          paidDate,
      cheque,
    })
  } catch (err) {
    // No ledger entry survived — release the claim so it can be retried.
    if (!claimed.accountsTransactionId) {
      await ProjectExpense.updateOne(
        { _id: claimed._id, status: 'PAID', accountsTransactionId: null },
        { $set: {
          status: 'PENDING', paidBy: null, paidAt: null, syncedToAccounts: false,
          accountId: null, channel: null, paymentMethod: null, paymentTxnId: null, paymentProofUrl: null,
          projectCostBDT: null,
        } },
      ).catch(e => console.error('[expensePayment] failed to release payment claim', String(claimed._id), e))
    }
    throw err
  }

  const [taxEntries, ev] = await Promise.all([
    claimed.taxEntryIds?.length
      ? TaxEntry.find({ _id: { $in: claimed.taxEntryIds } })
        .select('entryNo entryType amount baseAmount rate creditable nonCreditReason section treatment certificate deposit')
        .lean()
      : Promise.resolve([]),
    evaluatePayment(claimed, { account, channel: claimed.channel, paymentMethod, paidAt: paidDate }),
  ])

  const fig = expenseSettlement(claimed)
  logActivity({
    userId,
    userRole: session.user.role,
    action:   'PAYMENT',
    entity:   'EXPENSE',
    entityId: claimed._id.toString(),
    changes:  JSON.stringify({
      expenseId:     claimed.expenseId ?? null,
      voucherNo:     claimed.expenseInvoiceNo ?? null,
      status:        { from: 'PENDING', to: 'PAID' },
      gross:         fig.gross,
      netPaid:       fig.net,
      currency:      fig.currency,
      vat:           fig.vat,
      vds:           fig.vds,
      tds:           fig.tds,
      account:       account ? account.name : null,
      channel:       claimed.channel ?? null,
      paidAt:        dhakaDayKey(paidDate),
      transactionId: txn?._id?.toString() ?? null,
      txnId:         txn?.txnId ?? null,
      kind:          txn?.kind ?? null,
      taxEntries:    taxEntries.map(t => t.entryNo),
      ...(idOf(claimed.projectId) && { projectCostAddedBDT: claimed.projectCostBDT ?? null }),
    }),
    request,
  })

  return {
    expense: claimed, transaction: txn, taxEntries,
    warnings: vatLockWarning ? [vatLockWarning, ...ev.warnings] : ev.warnings,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Authorisation (unchanged)
// ─────────────────────────────────────────────────────────────────────────────

// PAID → AUTHORIZED. Attaches the scan of the printed & authorized invoice.
// No ledger change (that already happened at payment). Caller owns the
// PAID-status + scan guards.
export async function authorizeExpense(expense, { userId, signedInvoiceUrl, batchInvoiceNo = null }) {
  expense.signedInvoiceUrl = signedInvoiceUrl
  expense.authorizedBy     = userId
  expense.authorizedAt     = new Date()
  if (batchInvoiceNo) expense.batchInvoiceNo = batchInvoiceNo
  expense.status           = 'AUTHORIZED'
  await expense.save()
  return expense
}

// ─────────────────────────────────────────────────────────────────────────────
// Reversal (PAID / AUTHORIZED → PENDING)
// ─────────────────────────────────────────────────────────────────────────────

const REVERSIBLE_STATUSES = ['PAID', 'AUTHORIZED']
const FILED_RETURN_STATUSES = ['FILED', 'AMENDED']
const FILING_KIND_LABELS = {
  VAT_RETURN: 'VAT return', WHT_RETURN: 'withholding tax return',
  ADVANCE_TAX: 'advance tax return', INCOME_TAX_RETURN: 'income tax return',
}

/**
 * The EXPENSE ledger row a payment posted: expense.accountsTransactionId, else
 * (legacy payments without the back-link) the newest un-reversed EXPENSE row
 * that references the expense. null when there is none.
 */
async function paymentLedgerRow(expense) {
  const txId = idOf(expense.accountsTransactionId)
  if (txId && isValidObjectId(txId)) {
    const row = await Transaction.findById(txId).lean()
    if (row) return row
  }
  const rows = await Transaction.find({ reference: String(expense._id), type: 'EXPENSE', reversalOf: null })
    .sort({ createdAt: -1 })
    .lean()
  if (!rows.length) return null
  const reversed = new Set(
    (await Transaction.find({ reversalOf: { $in: rows.map(r => r._id) } }).select('reversalOf').lean())
      .map(r => String(r.reversalOf)),
  )
  return rows.find(r => !reversed.has(String(r._id))) ?? null
}

/**
 * Undo a recorded expense payment so it can be paid again correctly
 * (PATCH /api/expenses/:id action 'reverse'):
 *   pre-checks → claim PAID / AUTHORIZED → REVERSING atomically → void the
 *   payment's tax entries (INPUT_VAT / VDS_PAYABLE / TDS_PAYABLE) → post the
 *   reversing ledger row (reverseMoneyEntry, dated today) → take what the payment
 *   added (projectCostBDT; gross for older payments) off the project cost, put a
 *   FreelancerAssignment back to PAYMENT_REQUESTED and a
 *   SalaryPayout back to PENDING → expense back to PENDING with the payment
 *   fields cleared (the old voucher number is kept in paymentNote / reviewNote).
 * Any failure undoes the steps already taken and restores the prior status.
 *
 * Refused (409) when: a linked tax entry is in a filed return (VAT or WHT),
 * deposited by challan, or on an issued certificate; the books are locked for
 * the payment date (or today, the reversal date); a VDS / TDS entry's period is
 * locked; the account paid from is archived; the expense came from a purchase
 * bill (cancel the bill instead).
 * A SalarySlip carries no payment state (it reads the expense), so it needs no change.
 *
 * @param {string} expenseId
 * @param {{ reason: string, session: object, request?: Request }} opts  reason ≥ 5 characters
 * @returns {Promise<{ expense, reversal, voidedEntries, warnings }>}
 *   expense: the PENDING ProjectExpense document; reversal: the reversing
 *   Transaction (null when none was posted); voidedEntries [{ entryNo, entryType, amount }];
 *   warnings [{ code, message }]
 * @throws Error with .status (401/403/404/409/422)
 */
export async function reverseExpensePayment(expenseId, { reason, session, request = null } = {}) {
  await connectDB()
  const userId = session?.user?.id
  if (!userId) throw httpError(401, 'Unauthorised')
  if (!canDo(session, 'finance.payments.confirm')) throw httpError(403, 'Forbidden')
  const id = idOf(expenseId)
  if (!isValidObjectId(id)) throw httpError(404, 'Not found')
  const why = typeof reason === 'string' ? reason.trim() : ''
  if (why.length < 5) throw httpError(422, 'Give a reason for reversing the payment (at least 5 characters)', { field: 'reason' })
  if (why.length > 500) throw httpError(422, 'The reason is too long (max 500 characters)', { field: 'reason' })

  const expense = await ProjectExpense.findById(id).lean()
  if (!expense) throw httpError(404, 'Not found')
  if (expense.status === 'REVERSING') throw httpError(409, 'This payment is already being reversed')
  if (!REVERSIBLE_STATUSES.includes(expense.status)) throw httpError(409, 'Only a paid or authorized expense can be reversed')

  // A purchase bill's payment can be reversed like any other: the bill keeps its
  // stock and assets and goes back to "payment requested" (see markPurchaseBillUnpaid).

  // ── Pre-checks: nothing is claimed or written for a reversal that cannot finish ──
  const now = new Date()
  if (expense.paidAt) {
    const locked = await assertBooksOpen(expense.paidAt)
    if (locked) throw httpError(409, `${locked} — the payment of ${dhakaDayKey(expense.paidAt)} cannot be reversed`, { code: 'BOOKS_LOCKED' })
  }
  const todayLocked = await assertBooksOpen(now)
  if (todayLocked) throw httpError(409, `${todayLocked} — the reversing entry cannot be posted today`, { code: 'BOOKS_LOCKED' })

  const txn = await paymentLedgerRow(expense)
  if (txn?.reversalOf) throw httpError(409, 'The ledger entry linked to this expense is itself a reversal — check it in Accounts → Transactions')
  const existingReversal = txn ? await Transaction.findOne({ reversalOf: txn._id }).select('txnId').lean() : null
  if (txn && !existingReversal && txn.accountId) {
    const acct = await MoneyAccount.findById(txn.accountId).select('name status').lean()
    if (acct && acct.status !== 'ACTIVE') throw httpError(409, `${acct.name} is archived — reactivate it to reverse this payment`, { field: 'accountId' })
  }

  const entryIds = (expense.taxEntryIds ?? []).map(idOf).filter(Boolean)
  const entries = await TaxEntry.find({
    status: 'ACTIVE',
    isOpening: { $ne: true },
    $or: [{ expenseId: expense._id }, ...(entryIds.length ? [{ _id: { $in: entryIds } }] : [])],
  }).select('entryNo entryType amount date filingId claimPeriod certificate deposit').sort({ createdAt: 1 }).lean()

  const filingIds = [...new Set(entries.map(e => (e.filingId ? String(e.filingId) : null)).filter(Boolean))]
  const filings = filingIds.length
    ? await TaxFiling.find({ _id: { $in: filingIds }, status: { $in: FILED_RETURN_STATUSES } }).select('kind periodKey status').lean()
    : []
  const filedById = new Map(filings.map(f => [String(f._id), f]))
  const blockers = []
  for (const e of entries) {
    const filed = e.filingId ? filedById.get(String(e.filingId)) : null
    if (filed) {
      blockers.push(`${e.entryNo} is in the filed ${FILING_KIND_LABELS[filed.kind] ?? 'return'} ${filed.periodKey} — record an adjustment instead`)
    } else if (e.claimPeriod) {
      blockers.push(`${e.entryNo} was claimed in the filed VAT return for ${periodLabel(e.claimPeriod)} — record an adjustment instead`)
    }
    if (e.deposit?.status === 'DEPOSITED') {
      blockers.push(`${e.entryNo} was deposited by challan${e.deposit.challanNo ? ` ${e.deposit.challanNo}` : ''} — void that deposit first`)
    } else if ((Number(e.deposit?.paidAmount) || 0) > 0) {
      // Part-paid by a challan: voiding the deduction would strand the money deposited.
      const nos = [...new Set((e.deposit.allocations ?? []).map(a => a.challanNo).filter(Boolean))].join(', ')
      blockers.push(`${e.entryNo} was part-deposited by challan${nos ? ` ${nos}` : ''} — void that deposit first`)
    }
    if (e.certificate?.status === 'ISSUED') {
      blockers.push(`${e.entryNo} is on certificate${e.certificate.number ? ` ${e.certificate.number}` : ''} issued to the party`)
    }
    // Same locks voidTaxEntry applies. Input VAT was recorded past the VAT lock
    // (its claim window carries it into the first open return) and voids the same way.
    if (e.entryType !== 'INPUT_VAT') {
      const locked = await assertBooksOpen(e.date)
      const taxLocked = !locked && isVatEntryType(e.entryType) ? await assertTaxOpen(e.date) : null
      if (locked || taxLocked) blockers.push(`${e.entryNo}: ${locked || taxLocked}`)
    }
  }
  if (blockers.length) {
    throw httpError(409, `This payment cannot be reversed: ${blockers[0]}${blockers.length > 1 ? ` (and ${blockers.length - 1} more)` : ''}`, { details: blockers })
  }

  const payAccountId = idOf(expense.accountId)
  const payAccount = payAccountId && isValidObjectId(payAccountId)
    ? await MoneyAccount.findById(payAccountId).select('name type isBankingChannel').lean()
    : null

  // What the payment added to the project's cost: the amount it recorded
  // (projectCostBDT — the bill excluding creditable input VAT); payments made
  // before that was recorded added the gross bill.
  const fig = expenseSettlement(expense)
  const recordedCost = expense.projectCostBDT === null || expense.projectCostBDT === undefined ? null : Number(expense.projectCostBDT)
  const projectCost = idOf(expense.projectId)
    ? (Number.isFinite(recordedCost) ? round2(Math.max(0, recordedCost)) : fig.grossBDT)
    : 0

  // ── Claim: one reversal at a time, and never of a payment that changed meanwhile ──
  // (projectCostBDT is part of the guard: a payment still adding its project cost
  // makes the claim fail, so the amount taken off is the amount that was added).
  const fromStatus = expense.status
  const claimed = await ProjectExpense.findOneAndUpdate(
    {
      _id: expense._id, status: fromStatus, accountsTransactionId: expense.accountsTransactionId ?? null,
      projectCostBDT: expense.projectCostBDT ?? null,
    },
    { $set: { status: 'REVERSING' } },
    { new: true },
  )
  if (!claimed) throw httpError(409, 'This expense was changed by someone else — reload it and try again')

  const voucher = expense.expenseInvoiceNo ?? null
  const warnings = []
  const undo = []
  const voidedEntries = []
  let reversal = null
  let assignmentsReset = 0
  let payoutReset = false
  let done
  try {
    // 1. Tax entries the payment recorded.
    for (const e of entries) {
      const v = await voidTaxEntry(e._id, {
        reason: `Payment${voucher ? ` ${voucher}` : ''} reversed: ${why}`,
        userId,
        allowLocked: e.entryType === 'INPUT_VAT',
      })
      if (v?.voidedBy && String(v.voidedBy) === String(userId)) {
        undo.push(() => TaxEntry.updateOne(
          { _id: e._id, status: 'VOID' },
          { $set: { status: 'ACTIVE', voidReason: null, voidedBy: null, voidedAt: null } },
        ))
      }
      voidedEntries.push({ entryNo: e.entryNo, entryType: e.entryType, amount: e.amount })
    }

    // 2. Ledger: the mirror row puts the net cash back into the account (dated today).
    if (txn && !existingReversal) {
      const label = [expense.expenseId, voucher ? `(${voucher})` : null].filter(Boolean).join(' ')
      reversal = await reverseMoneyEntry(txn._id, {
        userId,
        date: now,
        reason: `${label ? `expense ${label} ` : 'expense '}payment reversed — ${why}`,
      })
      undo.push(() => Transaction.deleteOne({ _id: reversal._id }))
    } else if (existingReversal) {
      warnings.push({
        code: 'ALREADY_REVERSED',
        message: `The ledger entry ${txn.txnId ?? txn._id} was already reversed (${existingReversal.txnId ?? existingReversal._id}) — no new reversing entry was posted.`,
      })
    } else {
      warnings.push({ code: 'NO_LEDGER_ROW', message: 'No ledger entry was found for this payment — only its tax entries and status were reset.' })
    }

    // 3. Project cost: take off what the payment added (projectCost above).
    const projectId = idOf(expense.projectId)
    if (projectId && projectCost > 0) {
      const bump = (delta) => Project.updateOne({ _id: projectId }, [
        { $set: { approvedExpenses: { $round: [{ $add: [{ $convert: { input: '$approvedExpenses', to: 'double', onError: 0, onNull: 0 } }, delta] }, 2] } } },
      ])
      await bump(-projectCost)
      undo.push(() => bump(projectCost))
    }

    // 4. Freelancer payment request: paid → awaiting payment again.
    const assignments = await FreelancerAssignment.find({ expenseId: expense._id, paymentStatus: 'PAID' })
      .select('approvedAt approvedBy').lean()
    if (assignments.length) {
      const res = await FreelancerAssignment.updateMany(
        { _id: { $in: assignments.map(a => a._id) }, paymentStatus: 'PAID' },
        { $set: { paymentStatus: 'PAYMENT_REQUESTED', approvedAt: null, approvedBy: null } },
      )
      assignmentsReset = res.modifiedCount ?? assignments.length
      undo.push(async () => {
        for (const a of assignments) {
          await FreelancerAssignment.updateOne(
            { _id: a._id, paymentStatus: 'PAYMENT_REQUESTED' },
            { $set: { paymentStatus: 'PAID', approvedAt: a.approvedAt ?? null, approvedBy: a.approvedBy ?? null } },
          )
        }
      })
    }

    // 5. Temp-salary payout: paid → pending (its expense is pending again).
    const payoutId = idOf(expense.salaryPayoutId)
    if (payoutId) {
      const before = await SalaryPayout.findOneAndUpdate(
        { _id: payoutId, status: 'PAID' },
        { $set: { status: 'PENDING', transactionId: null, approvedBy: null, approvedAt: null } },
      ).lean()
      if (before) {
        payoutReset = true
        undo.push(() => SalaryPayout.updateOne(
          { _id: payoutId, status: 'PENDING' },
          { $set: { status: 'PAID', transactionId: before.transactionId ?? null, approvedBy: before.approvedBy ?? null, approvedAt: before.approvedAt ?? null } },
        ))
      }
    }

    // 6. The expense: back to PENDING with the payment cleared; history kept in the notes.
    const history = [
      `${dhakaDayKey(now)}: payment${voucher ? ` ${voucher}` : ''} of ${formatMoney(fig.net, fig.currency)}`,
      expense.paidAt ? ` paid ${dhakaDayKey(expense.paidAt)}` : '',
      txn?.txnId ? `, ledger ${txn.txnId}` : '',
      reversal?.txnId ? `, reversed by ${reversal.txnId}` : '',
      expense.batchInvoiceNo ? `, batch ${expense.batchInvoiceNo}` : '',
      voidedEntries.length ? `, tax entries voided ${voidedEntries.map(v => v.entryNo).join(' ')}` : '',
      ` — reversed: ${why}`,
    ].join('')
    const prevNote = str(expense.paymentNote)
    const paymentNote = (prevNote ? `${prevNote}\n${history}` : history).slice(-4000)
    const set = {
      status:                'PENDING',
      paymentMethod:         null,
      paymentProofUrl:       null,
      paymentTxnId:          null,
      paidBy:                null,
      paidAt:                null,
      accountId:             null,
      channel:               null,
      syncedToAccounts:      false,
      accountsTransactionId: null,
      taxEntryIds:           [],
      expenseInvoiceNo:      null,
      signedInvoiceUrl:      null,
      authorizedBy:          null,
      authorizedAt:          null,
      batchInvoiceNo:        null,
      projectCostBDT:        null,
      reviewedBy:            userId,
      reviewedAt:            now,
      reviewNote:            `Payment${voucher ? ` ${voucher}` : ''} reversed: ${why}`.slice(0, 2000),
      paymentNote,
    }
    // Cash salary / rent was forced non-deductible by that payment (s.55);
    // the next payment decides again.
    if (expense.tax && salaryOrRent(expense) && isCashLikePayment(normalizeChannel(expense.channel), payAccount)) {
      set['tax.taxDeductible'] = true
    }
    done = await ProjectExpense.findOneAndUpdate(
      { _id: expense._id, status: 'REVERSING' },
      { $set: set },
      { new: true },
    )
    if (!done) throw httpError(409, 'This expense was changed while its payment was being reversed — reload it and try again')
  } catch (err) {
    for (const step of undo.reverse()) {
      await Promise.resolve().then(step)
        .catch(e => console.error('[expensePayment] reversal compensation step failed', String(expense._id), e))
    }
    await ProjectExpense.updateOne({ _id: expense._id, status: 'REVERSING' }, { $set: { status: fromStatus } })
      .catch(e => console.error('[expensePayment] failed to release reversal claim', String(expense._id), e))
    throw err
  }

  if (expense.purchaseBillId) await markPurchaseBillReversed(expense)

  logActivity({
    userId,
    userRole: session.user.role,
    action:   'REVERSE',
    entity:   'EXPENSE',
    entityId: String(expense._id),
    changes:  JSON.stringify({
      expenseId:        expense.expenseId ?? null,
      voucherNo:        voucher,
      status:           { from: fromStatus, to: 'PENDING' },
      reason:           why,
      gross:            fig.gross,
      netPaid:          fig.net,
      currency:         fig.currency,
      paidAt:           expense.paidAt ? dhakaDayKey(expense.paidAt) : null,
      transaction:      txn?.txnId ?? (txn ? String(txn._id) : null),
      reversal:         reversal?.txnId ?? (reversal ? String(reversal._id) : null),
      taxEntriesVoided: voidedEntries.map(v => v.entryNo),
      projectCostReducedBDT: projectCost,
      assignmentsReset,
      payoutReset,
      batchInvoiceNo:   expense.batchInvoiceNo ?? null,
    }),
    request,
  })

  return { expense: done, reversal, voidedEntries, warnings }
}

// ─────────────────────────────────────────────────────────────────────────────
// Display helpers (vouchers / slips)
// ─────────────────────────────────────────────────────────────────────────────

/** 'Name · Bank — Current ••1234' style label for a (populated) money account; null when none. */
export function moneyAccountText(account) {
  if (!account || typeof account !== 'object' || !account.name) return null
  const provider = account.mfsProvider && account.mfsProvider !== 'OTHER' ? (MFS_PROVIDER_LABELS[account.mfsProvider] ?? account.mfsProvider) : null
  const detail = str(account.bankName) || provider || accountTypeLabel(account.type)
  const head = detail && detail !== account.name ? `${account.name} · ${detail}` : account.name
  return `${head}${account.last4 ? ` ••${account.last4}` : ''}`
}

/** Payment channel label (BEFTN, Cash…) or null. */
export function channelText(channel) {
  const c = str(channel)
  return c ? (PAYMENT_CHANNEL_LABELS[c.toUpperCase()] ?? c) : null
}

/**
 * The input-VAT credit each paid expense's payment actually recorded — not the
 * credit requested on the bill (tax.vatCreditable), which the payment may have
 * refused (no Mushak-6.3 / supplier BIN, turnover or unregistered supplier, cash
 * over Tk 1,00,000, claim window closed…). From the ACTIVE INPUT_VAT entry, else
 * the payment's ledger row (tax.inputVatCreditable). Unpaid expenses, bills
 * without VAT and payments that recorded neither are left out. ≤ 2 queries.
 * @param {object[]} expenses  ProjectExpense documents or lean rows
 * @returns {Promise<Map<string, { creditable: boolean, nonCreditReason: string|null, reasonLabel: string|null }>>}
 *   keyed by expense _id
 */
export async function inputVatOutcomesFor(expenses) {
  const out = new Map()
  const list = (expenses ?? []).filter(e => e?._id && REVERSIBLE_STATUSES.includes(e.status) && num(taxObj(e)?.vatAmount) > 0)
  if (!list.length) return out
  const entries = await TaxEntry.find({
    expenseId: { $in: list.map(e => e._id) }, entryType: 'INPUT_VAT', status: 'ACTIVE', isOpening: { $ne: true },
  }).select('expenseId creditable nonCreditReason').sort({ createdAt: 1 }).lean()
  for (const t of entries) {
    if (typeof t.creditable !== 'boolean') continue
    const reason = t.creditable ? null : (t.nonCreditReason ?? null)
    out.set(String(t.expenseId), { creditable: t.creditable, nonCreditReason: reason, reasonLabel: reason ? (INPUT_NON_CREDIT_REASONS[reason] ?? reason) : null })
  }
  const rest = list.filter(e => !out.has(String(e._id)) && isValidObjectId(idOf(e.accountsTransactionId)))
  if (rest.length) {
    const rows = await Transaction.find({ _id: { $in: rest.map(e => idOf(e.accountsTransactionId)) } }).select('tax.inputVatCreditable').lean()
    const byId = new Map(rows.map(r => [String(r._id), r.tax?.inputVatCreditable]))
    for (const e of rest) {
      const c = byId.get(String(idOf(e.accountsTransactionId)))
      if (typeof c === 'boolean') out.set(String(e._id), { creditable: c, nonCreditReason: null, reasonLabel: null })
    }
  }
  return out
}

/**
 * 's.90 — Any other service (90-OTHER)' for a TDS section code; the code itself when unknown.
 * `resolve` (code, date) → section row: pass lib/tax/engine tdsSectionResolver() so
 * custom sections from Tax settings print too; defaults to the static catalog.
 */
export function tdsSectionText(code, date = new Date(), resolve = catalogTdsSection) {
  const c = str(code)
  if (!c) return null
  const row = resolve(c, date)
  if (!row) return c
  return row.section ? `s.${row.section} — ${row.label} (${row.code ?? c})` : `${row.label ?? c} (${row.code ?? c})`
}

// ─────────────────────────────────────────────────────────────────────────────
// Payee tax profiles (for the payment form)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Tax profile of each expense's payee, for pre-filling the payment form:
 * Map(expenseId → { type, id, name, payeeType, hasPsr, bin, vatRegistrationType,
 *   defaultTdsSection, defaultVatServiceCode, hasTin }). TIN itself is never
 * returned (PII) — only whether one is on file. Batched: ≤ 3 queries.
 */
export async function payeeProfilesFor(expenses) {
  const list = (expenses ?? []).filter(Boolean)
  const result = new Map()
  if (!list.length) return result

  const idStr = (v) => {
    const raw = idOf(v)
    return raw ? String(raw) : null
  }
  const vendorIds = new Set()
  const freelancerIds = new Set()
  const employeeIds = new Set()
  for (const e of list) {
    if (idStr(e.vendorId)) vendorIds.add(idStr(e.vendorId))
    if (idStr(e.agencyId)) freelancerIds.add(idStr(e.agencyId))
    if (idStr(e.freelancerId)) freelancerIds.add(idStr(e.freelancerId))
    if (idStr(e.paidToEmployeeId)) employeeIds.add(idStr(e.paidToEmployeeId))
  }

  const [vendors, freelancers, employees] = await Promise.all([
    vendorIds.size
      ? Vendor.find({ _id: { $in: [...vendorIds] } })
        .select('company bin tin vatRegistrationType payeeType hasPsr defaultTdsSection defaultVatServiceCode').lean()
      : [],
    freelancerIds.size
      ? Freelancer.find({ _id: { $in: [...freelancerIds] } })
        .select('type userId agencyInfo.agencyName bin tin payeeType hasPsr').populate('userId', 'name').lean()
      : [],
    employeeIds.size
      ? Employee.find({ _id: { $in: [...employeeIds] } }).select('userId tin').populate('userId', 'name').lean()
      : [],
  ])
  const vById = new Map(vendors.map(v => [String(v._id), v]))
  const fById = new Map(freelancers.map(f => [String(f._id), f]))
  const eById = new Map(employees.map(x => [String(x._id), x]))

  for (const e of list) {
    const key = String(e._id ?? e.id)
    let profile = null
    const v = vById.get(idStr(e.vendorId))
    const f = fById.get(idStr(e.agencyId)) ?? fById.get(idStr(e.freelancerId))
    const emp = eById.get(idStr(e.paidToEmployeeId))
    if (v) {
      profile = {
        type: 'VENDOR', id: String(v._id), name: v.company ?? null,
        payeeType: v.payeeType ?? 'COMPANY', hasPsr: typeof v.hasPsr === 'boolean' ? v.hasPsr : null,
        bin: v.bin ?? null, vatRegistrationType: v.vatRegistrationType ?? null,
        defaultTdsSection: v.defaultTdsSection ?? null, defaultVatServiceCode: v.defaultVatServiceCode ?? null,
        hasTin: !!str(v.tin),
      }
    } else if (f) {
      const isAgency = f.type === 'AGENCY'
      profile = {
        type: isAgency ? 'AGENCY' : 'FREELANCER', id: String(f._id),
        name: (isAgency ? f.agencyInfo?.agencyName : null) ?? f.userId?.name ?? null,
        payeeType: f.payeeType ?? (isAgency ? 'COMPANY' : 'INDIVIDUAL'),
        hasPsr: typeof f.hasPsr === 'boolean' ? f.hasPsr : null,
        bin: f.bin ?? null, vatRegistrationType: str(f.bin) ? 'REGISTERED' : null,
        defaultTdsSection: null, defaultVatServiceCode: null,
        hasTin: !!str(f.tin),
      }
    } else if (emp) {
      profile = {
        type: 'EMPLOYEE', id: String(emp._id), name: emp.userId?.name ?? null,
        payeeType: 'INDIVIDUAL', hasPsr: null, bin: null, vatRegistrationType: null,
        defaultTdsSection: e.origin === 'SALARY' ? '86-SALARY' : null, defaultVatServiceCode: null,
        hasTin: !!str(emp.tin),
      }
    } else {
      profile = {
        type: 'OTHER', id: null, name: e.paidToName ?? null,
        payeeType: null, hasPsr: null, bin: null, vatRegistrationType: null,
        defaultTdsSection: null, defaultVatServiceCode: null, hasTin: false,
      }
    }
    result.set(key, profile)
  }
  return result
}
