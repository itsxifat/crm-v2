/**
 * lib/tax/purchaseRegister.js — SERVER-ONLY purchase sources shared by the
 * Mushak-6.1 / 6.10 registers (app/api/tax/registers) and the Mushak-9.1
 * DISCLOSURE_6_10 warning (lib/tax/vatReturn), so both see the same purchases.
 *
 *  - loadPurchases(range)            received BDT purchase bills, INPUT_VAT entries not
 *                                    represented by such a bill, and paid supplier
 *                                    expenses that recorded no input VAT
 *  - billParty / billDoc             seller and document columns of a bill
 *  - expensePurchase(expense)        6.1 / 6.10 columns of a no-VAT expense
 *  - disclosurePurchaseRows(loaded)  Mushak-6.10 Part A rows (value above Tk 2,00,000)
 *
 * range = { from: Date, to: Date (exclusive) }. Amounts are BDT, rounded to 2 dp.
 */

import { TaxEntry, PurchaseBill, ProjectExpense } from '@/models'
import { round2, DISCLOSURE_THRESHOLD } from '@/lib/tax/catalog'
import { dhakaDayKey, parseDhakaDay } from '@/lib/dhakaTime'
import { getFinanceSettings } from '@/lib/finance/settings'

export const PURCHASE_ROW_LIMIT = 10000

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const str = (v) => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s || null
}
const dayKey = (d) => {
  if (!d) return null
  const t = new Date(d)
  return Number.isNaN(t.getTime()) ? null : dhakaDayKey(t)
}
const idStr = (v) => (v ? String(v._id ?? v) : null)
const uniqIds = (list) => [...new Set(list.filter(Boolean).map(String))]
const refObj = (v) => (v && typeof v === 'object' && v._id ? v : null)

const BILL_SELECT = [
  'billNo', 'vendorId', 'vendorName', 'supplierBin', 'supplierVatType', 'supplierInvoiceNo', 'mushakNo', 'mushakDate',
  'billDate', 'currency', 'status', 'lines', 'subtotal', 'vatTotal', 'sdTotal', 'otherCosts', 'total', 'vatCreditable',
].join(' ')

const ENTRY_SELECT = [
  'entryNo', 'entryType', 'isOpening', 'date', 'period', 'baseAmount', 'rate', 'amount', 'sdAmount', 'treatment',
  'serviceCode', 'creditable', 'nonCreditReason', 'claimPeriod', 'claimDeadline', 'partyType', 'partyName', 'partyBin',
  'partyTin', 'partyAddress', 'documentNo', 'documentDate', 'expenseId', 'purchaseBillId', 'notes',
].join(' ')

// Expenses that are not purchases from a seller: payroll and staff reimbursements.
const NON_PURCHASE_ORIGINS = ['SALARY', 'REIMBURSEMENT']

export const SELLER_VAT_TYPE_LABELS = {
  REGISTERED:   'VAT-registered seller',
  TURNOVER:     'Turnover-tax seller',
  UNREGISTERED: 'Unregistered seller',
  FOREIGN:      'Foreign seller',
}

/**
 * Paid supplier expenses (no purchase bill) dated by payment in the range that
 * have no ACTIVE INPUT_VAT entry — purchases without VAT (unregistered /
 * turnover-tax sellers, exempt supplies) that the INPUT_VAT path never sees.
 * Payments before the go-live date are left out (the tax ledger starts there).
 */
async function loadNoVatExpenses(range) {
  const settings = await getFinanceSettings()
  const goLive = settings?.goLiveDate ? parseDhakaDay(settings.goLiveDate)?.start ?? null : null
  const from = goLive && goLive > range.from ? goLive : range.from
  if (!(from < range.to)) return { expenses: [], truncated: false }

  const cands = await ProjectExpense.find({
    status: { $in: ['PAID', 'AUTHORIZED'] },          // AUTHORIZED is the step after PAID
    paidAt: { $gte: from, $lt: range.to },              // same date the INPUT_VAT path uses
    origin: { $nin: NON_PURCHASE_ORIGINS },
    purchaseBillId: null,                               // bills are registered from the bill itself
    salaryPayoutId: null,
    employeeSalarySlipId: null,
    paidToEmployeeId: null,
    category: { $not: /salary/i },
  })
    .select('expenseId expenseInvoiceNo title category origin date paidAt amount currency amountBDT tax vendorId freelancerId agencyId paidToName')
    .populate({ path: 'vendorId', select: 'company address bin vatRegistrationType' })
    .populate({ path: 'agencyId', select: 'userId agencyInfo.agencyName bin address', populate: { path: 'userId', select: 'name' } })
    .populate({ path: 'freelancerId', select: 'userId agencyInfo.agencyName bin address', populate: { path: 'userId', select: 'name' } })
    .sort({ paidAt: 1, _id: 1 })
    .limit(PURCHASE_ROW_LIMIT + 1)
    .lean()
  if (!cands.length) return { expenses: [], truncated: false }

  const withVat = new Set((await TaxEntry.distinct('expenseId', {
    status: 'ACTIVE', entryType: 'INPUT_VAT', expenseId: { $in: cands.map(x => x._id) },
  })).map(String))
  return { expenses: cands.filter(x => !withVat.has(String(x._id))), truncated: cands.length > PURCHASE_ROW_LIMIT }
}

/**
 * Received BDT purchase bills in the range + INPUT_VAT entries in the range that
 * are not represented by such a bill (a bill's purchases are registered on the
 * bill date, its input VAT entry — created on payment — is not counted again)
 * + paid supplier expenses with no input VAT entry.
 */
export async function loadPurchases(range) {
  const [bills, entries, noVat] = await Promise.all([
    PurchaseBill.find({ status: 'RECEIVED', billDate: { $gte: range.from, $lt: range.to } })
      .select(BILL_SELECT)
      .populate({ path: 'vendorId', select: 'company address bin' })
      .sort({ billDate: 1, billNo: 1 })
      .limit(PURCHASE_ROW_LIMIT + 1)
      .lean(),
    TaxEntry.find({ status: 'ACTIVE', isOpening: { $ne: true }, entryType: 'INPUT_VAT', date: { $gte: range.from, $lt: range.to } })
      .select(ENTRY_SELECT)
      .sort({ date: 1, entryNo: 1 })
      .limit(PURCHASE_ROW_LIMIT + 1)
      .lean(),
    loadNoVatExpenses(range),
  ])
  const bdtBills = bills.filter(b => (b.currency || 'BDT').toUpperCase() === 'BDT')

  const linkedBillIds = uniqIds(entries.map(e => e.purchaseBillId))
  const linkedBills = linkedBillIds.length
    ? await PurchaseBill.find({ _id: { $in: linkedBillIds } }).select('status currency').lean()
    : []
  const represented = new Set(
    linkedBills.filter(b => b.status === 'RECEIVED' && (b.currency || 'BDT').toUpperCase() === 'BDT').map(b => String(b._id)),
  )
  const looseEntries = entries.filter(e => !(e.purchaseBillId && represented.has(String(e.purchaseBillId))))

  const billIds = bdtBills.map(b => b._id)
  const expenseIds = uniqIds(looseEntries.map(e => e.expenseId))
  const [billVat, expenses] = await Promise.all([
    billIds.length
      ? TaxEntry.find({ status: 'ACTIVE', entryType: 'INPUT_VAT', purchaseBillId: { $in: billIds } })
          .select('entryType purchaseBillId creditable nonCreditReason claimPeriod treatment').lean()
      : [],
    expenseIds.length ? ProjectExpense.find({ _id: { $in: expenseIds } }).select('title category').lean() : [],
  ])
  const vatByBill = new Map(billVat.map(v => [String(v.purchaseBillId), v]))
  const expenseById = new Map(expenses.map(x => [String(x._id), x]))

  return {
    bills: bdtBills,
    entries: looseEntries,
    noVatExpenses: noVat.expenses,
    vatByBill,
    expenseById,
    truncated: bills.length > PURCHASE_ROW_LIMIT || entries.length > PURCHASE_ROW_LIMIT || noVat.truncated,
  }
}

export function billParty(bill) {
  const vendor = bill.vendorId && typeof bill.vendorId === 'object' ? bill.vendorId : null
  return {
    name:    str(bill.vendorName) ?? str(vendor?.company),
    address: str(vendor?.address),
    bin:     str(bill.supplierBin) ?? str(vendor?.bin),
  }
}

export function billDoc(bill) {
  return {
    challanNo:   str(bill.mushakNo) ?? str(bill.supplierInvoiceNo) ?? bill.billNo ?? null,
    challanDate: dayKey(bill.mushakDate ?? bill.billDate),
  }
}

/**
 * 6.1 / 6.10 columns of a paid expense without an INPUT_VAT entry. Document and
 * seller follow lib/tax/withholding (supplier's 6.3 no., else the paid-invoice no.).
 * BDT conversion as lib/expensePayment expenseSettlement (amountBDT / amount).
 */
export function expensePurchase(x) {
  const vendor = refObj(x.vendorId)
  const firm = refObj(x.agencyId) ?? refObj(x.freelancerId)
  const tax = x.tax && typeof x.tax === 'object' ? x.tax : {}
  const currency = (str(x.currency) || 'BDT').toUpperCase()
  const gross = round2(num(x.amount))
  const grossBDT = currency === 'BDT' ? gross : round2(num(x.amountBDT) > 0 ? num(x.amountBDT) : gross)
  const fx = currency === 'BDT' ? 1 : (gross > 0 ? grossBDT / gross : 1)
  const vatBDT = round2(Math.max(0, num(tax.vatAmount) * fx))
  const vatType = (str(tax.supplierVatType) ?? str(vendor?.vatRegistrationType))?.toUpperCase() ?? null
  return {
    date:          dayKey(x.paidAt),
    challanNo:     str(tax.mushakNo) ?? str(x.expenseInvoiceNo) ?? str(x.expenseId),
    challanDate:   dayKey(tax.mushakDate ?? x.date ?? x.paidAt),
    sellerName:    str(vendor?.company) ?? str(firm?.agencyInfo?.agencyName) ?? str(firm?.userId?.name) ?? str(x.paidToName),
    sellerAddress: str(vendor?.address) ?? str(firm?.address),
    sellerBin:     str(tax.supplierBin) ?? str(vendor?.bin) ?? str(firm?.bin),
    description:   str(x.title) ?? str(x.category) ?? 'Purchase',
    grossBDT,
    vatBDT,
    value:         round2(Math.max(0, grossBDT - vatBDT)),
    vatType,
    vatTypeLabel:  vatType ? (SELLER_VAT_TYPE_LABELS[vatType] ?? null) : null,
    expenseNo:     str(x.expenseInvoiceNo) ?? str(x.expenseId),
    expenseId:     idStr(x._id),
  }
}

/** Mushak-6.10 Part A (purchases above Tk 2,00,000, value incl. VAT & SD) from loadPurchases(). */
export function disclosurePurchaseRows({ bills = [], entries = [], noVatExpenses = [] } = {}) {
  const rows = []
  for (const bill of bills) {
    const value = round2(num(bill.total))
    if (value <= DISCLOSURE_THRESHOLD) continue
    const party = billParty(bill)
    rows.push({
      part: 'A', date: dayKey(bill.billDate), ...billDoc(bill), value,
      partyName: party.name, partyAddress: party.address, partyBin: party.bin,
      purchaseBillId: String(bill._id),
    })
  }
  for (const e of entries) {
    const value = round2(num(e.baseAmount) + num(e.sdAmount) + num(e.amount))
    if (value <= DISCLOSURE_THRESHOLD) continue
    rows.push({
      part: 'A', date: dayKey(e.date), challanNo: str(e.documentNo) ?? e.entryNo, challanDate: dayKey(e.documentDate ?? e.date), value,
      partyName: str(e.partyName), partyAddress: str(e.partyAddress), partyBin: str(e.partyBin),
      entryId: String(e._id),
    })
  }
  for (const x of noVatExpenses) {
    const p = expensePurchase(x)
    if (p.grossBDT <= DISCLOSURE_THRESHOLD) continue
    rows.push({
      part: 'A', date: p.date, challanNo: p.challanNo, challanDate: p.challanDate, value: p.grossBDT,
      partyName: p.sellerName, partyAddress: p.sellerAddress, partyBin: p.sellerBin,
      expenseId: p.expenseId,
    })
  }
  return rows
}
