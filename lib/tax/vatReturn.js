/**
 * lib/tax/vatReturn.js — SERVER-ONLY Mushak-9.1 (VAT return) computation and filing.
 *
 *  - computeVatReturn({ start, end })   every 9.1 note 1–68 (0 when empty) from the
 *                                        tax sub-ledger, with drill-down entry lists
 *  - fileVatReturn({ ... })              freeze a computation into a FILED TaxFiling,
 *                                        mark claimed credits, link entries, lock the period
 *  - vatReturnPeriodKey(start, end)      '2026-10' or '2026-07..2026-09'
 *  - statutorySplitOf / vatReturnRangeProblem   which ranges can be prepared, paid and filed
 *                                        as one return (single Jul–Sep 2026 return, overlaps)
 *  - laterVatReturnsToAmend(filing)      filed later returns whose brought-forward balance
 *                                        (note 52 / 53) no longer matches this return
 *
 * Periods are 'YYYY-MM' (Dhaka). All amounts are BDT, rounded half-up to 2 dp.
 *
 * Note shapes in `notes`:
 *   1–9   { a: value, b: SD, c: VAT }           (Part 3, output)
 *   10–23 { a: value, b: VAT } (+ '18a')        (Part 4, input)
 *   24–68 number                                (Parts 5–11)
 */

import mongoose from 'mongoose'
import { TaxEntry, TaxFiling, Invoice } from '@/models'
import {
  round2, vatReturnNoteOf, isValidBin, vatReturnOverrideFor,
  BUYER_BIN_THRESHOLD, DISCLOSURE_THRESHOLD, CLAIM_WINDOW_PERIODS,
} from '@/lib/tax/catalog'
import { getFinanceSettings, getCompanyProfile, saveFinanceSettings } from '@/lib/finance/settings'
import {
  isPeriod, taxPeriodOf, addPeriods, periodRange, periodsBetween, periodLabel, periodLastDay,
  fiscalYearOf, toInstant, dayKeyLabel,
} from '@/lib/finance/fiscal'
import { dhakaDayKey } from '@/lib/dhakaTime'
import { invoiceTaxTotals } from '@/lib/tax/invoiceVat'
import { loadPurchases, disclosurePurchaseRows } from '@/lib/tax/purchaseRegister'
import { challanKeyOf } from '@/lib/tax/challanKey'

const FILED_STATUSES = ['FILED', 'AMENDED']
const RETURN_TYPES = ['ORIGINAL', 'LATE', 'AMENDED', 'FULL_ADDITIONAL']
// Warnings about the carry-forward chain (note 52) — live only, never frozen into a snapshot.
const CHAIN_WARNING_CODES = ['CARRY_FORWARD_CHANGED', 'PREVIOUS_RETURN_STALE']
const MAX_PERIODS = 12

const OUTPUT_NOTES = [1, 2, 3, 4, 5, 6, 7, 8]
const INPUT_CREDIT_NOTES = [10, 11, 12, 13, 14, 15, 16, 17, 18, '18a']
const INPUT_CREDIT_TOTAL_NOTES = [14, 15, 16, 17, 18, '18a']   // 23b = 14b + 15b + 16b + 17b + 18b + 18a(b)
const INPUT_ZERO_EXEMPT_NOTES = [10, 11, 12, 13]
const INPUT_NONCREDIT_NOTES = [19, 20, 21, 22]
const INCREASE_NOTES = [24, 25, 26, 27, 41, 43, 44]
const DECREASE_NOTES = [29, 30, 31, 32]

const RANGE_TYPES = ['OUTPUT_VAT', 'INPUT_VAT', 'VDS_PAYABLE', 'VAT_ADJUSTMENT', 'DEBIT_NOTE', 'CREDIT_NOTE']

const ENTRY_SELECT = [
  'entryNo', 'entryType', 'isOpening', 'status', 'date', 'period', 'baseAmount', 'rate', 'amount', 'sdRate', 'sdAmount',
  'treatment', 'serviceCode', 'creditable', 'nonCreditReason', 'claimPeriod', 'claimDeadline',
  'adjustmentDirection', 'adjustmentNote', 'balanceSide', 'section',
  'partyType', 'partyId', 'partyName', 'partyBin', 'partyTin', 'partyAddress', 'documentNo', 'documentDate',
  'certificate', 'deposit', 'challan', 'bankingChannel',
  'invoiceId', 'creditNoteId', 'expenseId', 'projectPaymentId', 'transactionId', 'purchaseBillId', 'assetId', 'filingId',
  'notes',
].join(' ')

// ── small utilities ─────────────────────────────────────────────────────────

const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const str = (v) => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s || null
}

const idStr = (v) => (v ? String(v._id ?? v) : null)

const money = (n) => `Tk ${round2(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

/** '2026-10' for a single period, '2026-07..2026-09' for a range. */
export function vatReturnPeriodKey(start, end) {
  return start === end ? start : `${start}..${end}`
}

function rangeLabel(start, end) {
  return start === end ? periodLabel(start) : `${periodLabel(start)} – ${periodLabel(end)}`
}

function assertRange(start, end) {
  if (!isPeriod(start) || !isPeriod(end)) throw httpError(400, 'Tax period must be YYYY-MM')
  if (start > end) throw httpError(400, 'Start period must not be after the end period')
  if (periodsBetween(start, end).length > MAX_PERIODS) throw httpError(400, `Choose at most ${MAX_PERIODS} tax periods`)
}

/**
 * The statutory single return (e.g. Jul–Sep 2026) that the range start..end
 * splits — covers only part of it, or more than it — else null.
 */
export function statutorySplitOf(start, end) {
  if (!isPeriod(start) || !isPeriod(end) || start > end) return null
  const o = periodsBetween(start, end).map(vatReturnOverrideFor).find(Boolean)
  return o && (o.start !== start || o.end !== end) ? o : null
}

/**
 * Why start..end cannot be prepared, paid or filed as one return — or null.
 *
 *  - RETURN_OVERLAP (409)   the range overlaps a filed return for another range.
 *  - PERIOD_OVERRIDE (422)  the range splits a statutory single return (Jul–Sep 2026)
 *                           that can still be filed as a whole. Once part of that
 *                           return was filed on its own (data from before this rule),
 *                           the whole can never be filed, so its months stay allowed
 *                           (e.g. amending, paying or filing the remaining months).
 *
 * The deposit route, the draft route, fileVatReturn and the page (result.fileable)
 * all use this, so a payment is only ever linked to a return that can be filed.
 * @returns {Promise<null|{ status, code, message, suggest: { start, end, label } }>}
 */
export async function vatReturnRangeProblem(start, end) {
  if (!isPeriod(start) || !isPeriod(end) || start > end) return null
  const periodKey = vatReturnPeriodKey(start, end)
  const split = statutorySplitOf(start, end)
  const lo = split && split.start < start ? split.start : start
  const hi = split && split.end > end ? split.end : end
  const filed = await TaxFiling.find({
    kind: 'VAT_RETURN', status: { $in: FILED_STATUSES }, periodStart: { $lte: hi }, periodEnd: { $gte: lo },
  }).select('periodKey periodStart periodEnd').lean()

  const overlap = filed.find(f => f.periodKey !== periodKey && f.periodStart <= end && f.periodEnd >= start)
  if (overlap) {
    return {
      status: 409, code: 'RETURN_OVERLAP',
      message: `${rangeLabel(start, end)} overlaps the filed return for ${overlap.periodKey}`,
      suggest: isPeriod(overlap.periodStart) && isPeriod(overlap.periodEnd)
        ? { start: overlap.periodStart, end: overlap.periodEnd, label: rangeLabel(overlap.periodStart, overlap.periodEnd) }
        : null,
    }
  }
  if (split) {
    const splitKey = vatReturnPeriodKey(split.start, split.end)
    const partFiled = filed.some(f => f.periodKey !== splitKey && f.periodStart <= split.end && f.periodEnd >= split.start)
    if (!partFiled) {
      return {
        status: 422, code: 'PERIOD_OVERRIDE',
        message: `${split.label} is a single return — use ${split.start} to ${split.end}`,
        suggest: { start: split.start, end: split.end, label: split.label },
      }
    }
  }
  return null
}

/** Balance a filed return carries into the next one (note 65 / 66). */
function carryForwardOf(f) {
  const s = f?.snapshot || {}
  return {
    vat: round2(num(s.carryForward ?? s.closingBalance ?? f?.closingBalance)),
    sd:  round2(num(s.sdCarryForward ?? s.sdClosingBalance)),
  }
}

/** Opening VAT / SD balance brought forward (VAT_BALANCE_BF) up to `end`: credit − payable. */
function openingBalanceOf(balanceBf) {
  const credit = balanceBf.filter(e => e.balanceSide !== 'PAYABLE')
  const payable = balanceBf.filter(e => e.balanceSide === 'PAYABLE')
  return {
    vat: round2(sumAmount(credit) - sumAmount(payable)),
    sd:  round2(sumAmount(credit, 'sdAmount') - sumAmount(payable, 'sdAmount')),
  }
}

/** The filed return a return starting at `start` brings its balance forward from (note 52). */
function previousFiledReturn(start, select = null) {
  const q = TaxFiling.findOne({ kind: 'VAT_RETURN', status: { $in: FILED_STATUSES }, periodEnd: { $lt: start } })
    .sort({ periodEnd: -1, filedAt: -1 })
  if (select) q.select(select)
  return q.lean()
}

/**
 * Note 52 / 53 the filed return `f` would bring forward if it were filed today:
 * the carry-forward of the return filed before it, else the opening balance.
 */
async function liveBroughtForward(f) {
  const before = await previousFiledReturn(f.periodStart, 'periodKey periodStart periodEnd closingBalance snapshot.carryForward snapshot.closingBalance snapshot.sdCarryForward snapshot.sdClosingBalance')
  if (before) return { ...carryForwardOf(before), from: before }
  const bf = await TaxEntry.find({ status: 'ACTIVE', entryType: 'VAT_BALANCE_BF', period: { $lte: f.periodEnd } })
    .select('amount sdAmount balanceSide').lean()
  return { ...openingBalanceOf(bf), from: null }
}

/** Due date of the return for [start, end]: statutory override, else the 15th of the next month. */
function returnDueDate(start, end) {
  const o = vatReturnOverrideFor(start)
  if (o && o.start === start && o.end === end) return o.dueDate
  return `${addPeriods(end, 1)}-15`
}

/** Last claimable period of an INPUT_VAT / VDS_RECEIVABLE entry. */
function deadlineOf(e) {
  return e.claimDeadline || (e.period ? addPeriods(e.period, CLAIM_WINDOW_PERIODS) : null)
}

/** Comparable challan number (case, spaces and separators ignored) — the same key as TaxEntry.challanKey. */
function challanKey(v) {
  return challanKeyOf(v)
}

function normalizeChallans(list) {
  if (!Array.isArray(list)) return []
  return list
    .filter(c => c && typeof c === 'object')
    .map(c => ({
      challanNo:   str(c.challanNo ?? c.number ?? c.no),
      date:        toInstant(c.date),
      bank:        str(c.bank),
      branch:      str(c.branch),
      accountCode: str(c.accountCode),
      amount:      round2(num(c.amount)),
      // VAT ⇒ note 58, SD (supplementary duty) ⇒ note 59.
      head:        String(c.head ?? '').trim().toUpperCase() === 'SD' ? 'SD' : 'VAT',
    }))
    .filter(c => c.challanNo || c.amount !== 0)
}

function emptyNotes() {
  const notes = {}
  for (let i = 1; i <= 9; i++) notes[i] = { a: 0, b: 0, c: 0 }
  for (let i = 10; i <= 23; i++) notes[i] = { a: 0, b: 0 }
  notes['18a'] = { a: 0, b: 0 }
  for (let i = 24; i <= 68; i++) notes[i] = 0
  return notes
}

function roundNotes(notes) {
  for (const k of Object.keys(notes)) {
    const v = notes[k]
    if (typeof v === 'number') notes[k] = round2(v)
    else for (const c of Object.keys(v)) v[c] = round2(v[c])
  }
  return notes
}

// ── note mapping (mirrors catalog.vatReturnNoteOf, constrained to each part) ─

function outputNote(e) {
  // vatReturnNoteOf already reports a rated supply by its rate (STANDARD at 5% → 7).
  const n = vatReturnNoteOf(e)
  if (OUTPUT_NOTES.includes(n)) return n
  const r = num(e.rate)
  return r > 0 && r < 15 ? 7 : 4
}

function inputCreditNote(e) {
  const n = vatReturnNoteOf({ ...e, creditable: true })
  return INPUT_CREDIT_NOTES.includes(n) ? n : 14
}

function inputNonCreditNote(e) {
  const n = vatReturnNoteOf({ ...e, creditable: false })
  return INPUT_NONCREDIT_NOTES.includes(n) ? n : 21
}

/** VAT_ADJUSTMENT ⇒ { side:'INCREASE'|'DECREASE', note } or null when unclassifiable. */
function adjustmentNoteOf(e) {
  const n = Number(e.adjustmentNote)
  if (e.adjustmentDirection === 'INCREASE') return { side: 'INCREASE', note: INCREASE_NOTES.includes(n) ? n : 27 }
  if (e.adjustmentDirection === 'DECREASE') return { side: 'DECREASE', note: DECREASE_NOTES.includes(n) ? n : 32 }
  if (INCREASE_NOTES.includes(n)) return { side: 'INCREASE', note: n }
  if (DECREASE_NOTES.includes(n)) return { side: 'DECREASE', note: n }
  return null
}

/** Compact drill-down row for one TaxEntry. */
function toLine(e, note) {
  const cert = e.certificate
  const dep = e.deposit
  return {
    id:              String(e._id),
    entryNo:         e.entryNo ?? null,
    entryType:       e.entryType,
    note,
    date:            e.date ?? null,
    period:          e.period ?? null,
    isOpening:       !!e.isOpening,
    partyType:       e.partyType ?? null,
    partyId:         e.partyId ?? null,
    partyName:       e.partyName ?? null,
    partyBin:        e.partyBin ?? null,
    partyTin:        e.partyTin ?? null,
    partyAddress:    e.partyAddress ?? null,
    documentNo:      e.documentNo ?? null,
    documentDate:    e.documentDate ?? null,
    treatment:       e.treatment ?? null,
    serviceCode:     e.serviceCode ?? null,
    rate:            e.rate ?? null,
    base:            round2(num(e.baseAmount)),
    sd:              round2(num(e.sdAmount)),
    amount:          round2(num(e.amount)),
    creditable:      e.creditable ?? null,
    nonCreditReason: e.nonCreditReason ?? null,
    claimPeriod:     e.claimPeriod ?? null,
    claimDeadline:   deadlineOf(e),
    adjustmentDirection: e.adjustmentDirection ?? null,
    adjustmentNote:  e.adjustmentNote ?? null,
    balanceSide:     e.balanceSide ?? null,
    bankingChannel:  e.bankingChannel ?? null,
    certificate:     cert ? { status: cert.status ?? null, number: cert.number ?? null, date: cert.date ?? null } : null,
    deposit:         dep ? { status: dep.status ?? null, challanNo: dep.challanNo ?? null, date: dep.date ?? null, accountCode: dep.accountCode ?? null } : null,
    challan:         e.challan ? { bank: e.challan.bank ?? null, branch: e.challan.branch ?? null, accountCode: e.challan.accountCode ?? null } : null,
    invoiceId:       idStr(e.invoiceId),
    creditNoteId:    idStr(e.creditNoteId),
    expenseId:       idStr(e.expenseId),
    transactionId:   idStr(e.transactionId),
    filingId:        idStr(e.filingId),
    notes:           e.notes ?? null,
  }
}

function sumAmount(rows, field = 'amount') {
  return round2(rows.reduce((s, r) => s + num(r[field]), 0))
}

// ── computation ─────────────────────────────────────────────────────────────

async function buildVatReturn({ start, end, challans, refundRequested }) {
  assertRange(start, end)
  const periodKey = vatReturnPeriodKey(start, end)
  const periods = periodsBetween(start, end)
  const inRange = (p) => !!p && p >= start && p <= end
  const active = { status: 'ACTIVE' }

  const [settings, company, filing, prevFiling, rangeProblem] = await Promise.all([
    getFinanceSettings(),
    getCompanyProfile(),
    TaxFiling.findOne({ kind: 'VAT_RETURN', periodKey }).lean(),
    previousFiledReturn(start),
    vatReturnRangeProblem(start, end),
  ])

  const challanList = normalizeChallans(challans !== undefined ? challans : filing?.challans)
  const refund = refundRequested !== undefined && refundRequested !== null
    ? round2(num(refundRequested))
    : round2(num(filing?.refundRequested))

  const olderThan = addPeriods(end, -4)
  const expiredBefore = addPeriods(start, -CLAIM_WINDOW_PERIODS)

  const [rangeEntries, inputCredit, vdsReceived, payments, balanceBf, pendingVds, expired, purchases, prevLive] = await Promise.all([
    TaxEntry.find({ ...active, period: { $gte: start, $lte: end }, entryType: { $in: RANGE_TYPES } })
      .select(ENTRY_SELECT).sort({ date: 1, entryNo: 1 }).lean(),
    // Creditable input VAT: claimed in this return, or unclaimed and still inside its window.
    TaxEntry.find({
      ...active, entryType: 'INPUT_VAT', creditable: true,
      $or: [
        { claimPeriod: { $gte: start, $lte: end } },
        { claimPeriod: null, period: { $lte: end }, $or: [{ claimDeadline: { $gte: start } }, { claimDeadline: null }] },
      ],
    }).select(ENTRY_SELECT).sort({ date: 1, entryNo: 1 }).lean(),
    // VDS deducted by customers: only with the Mushak-6.6 in hand.
    TaxEntry.find({
      ...active, entryType: 'VDS_RECEIVABLE', 'certificate.status': 'RECEIVED',
      $or: [
        { claimPeriod: { $gte: start, $lte: end } },
        { claimPeriod: null, $or: [{ claimDeadline: { $gte: start } }, { claimDeadline: null }] },
      ],
    }).select(ENTRY_SELECT).sort({ date: 1, entryNo: 1 }).lean(),
    // Treasury deposits: linked to this return, or unlinked and dated from the period start on
    // (period in range, or matched to one of this return's challans below).
    TaxEntry.find({
      ...active, entryType: 'VAT_PAYMENT',
      $or: [
        ...(filing ? [{ filingId: filing._id }] : []),
        { filingId: null, period: { $gte: start } },
      ],
    }).select(ENTRY_SELECT).sort({ date: 1, entryNo: 1 }).lean(),
    prevFiling
      ? Promise.resolve([])
      : TaxEntry.find({ ...active, entryType: 'VAT_BALANCE_BF', period: { $lte: end } }).select(ENTRY_SELECT).sort({ date: 1 }).lean(),
    // Warnings
    olderThan
      ? TaxEntry.find({
          ...active, entryType: 'VDS_RECEIVABLE', 'certificate.status': { $ne: 'RECEIVED' },
          claimPeriod: null, period: { $lte: olderThan },
        }).select('_id entryNo amount period claimDeadline partyName').lean()
      : Promise.resolve([]),
    TaxEntry.find({
      ...active, claimPeriod: null,
      $and: [
        { $or: [{ entryType: 'INPUT_VAT', creditable: true }, { entryType: 'VDS_RECEIVABLE' }] },
        { $or: [{ claimDeadline: { $lt: start } }, { claimDeadline: null, period: { $lt: expiredBefore } }] },
      ],
    }).select('_id entryNo entryType amount period claimDeadline').lean(),
    // Mushak-6.10 Part A: the same purchases as the register (bills, input VAT, no-VAT expenses)
    loadPurchases({ from: periodRange(start).start, to: periodRange(end).next }),
    // Is the previous return's own brought-forward balance still current?
    prevFiling ? liveBroughtForward(prevFiling) : Promise.resolve(null),
  ])

  const notes = emptyNotes()
  const lines = { output: [], input: [], inputNonCreditable: [], increasing: [], decreasing: [], deposits: [] }
  const noteEntries = {}
  const warnings = []
  const entryIds = new Set()
  const claimIds = []

  const push = (group, line) => {
    lines[group].push(line)
    ;(noteEntries[line.note] ||= []).push(line)
    if (line.id) entryIds.add(line.id)
  }

  // Part 3 — output (1–8) · Part 5/6 — notes and adjustments from the period
  const unclassified = []
  for (const e of rangeEntries) {
    switch (e.entryType) {
      case 'OUTPUT_VAT': {
        const n = outputNote(e)
        notes[n].a += num(e.baseAmount)
        notes[n].b += num(e.sdAmount)
        notes[n].c += num(e.amount)
        push('output', toLine(e, n))
        break
      }
      case 'INPUT_VAT': {
        if (e.creditable !== true) {
          // Not admissible for credit — informational (19 / 20 / 21)
          const n = inputNonCreditNote(e)
          notes[n].a += num(e.baseAmount)
          notes[n].b += num(e.amount)
          push('inputNonCreditable', toLine(e, n))
        }
        break
      }
      case 'VDS_PAYABLE':
        notes[24] += num(e.amount)
        push('increasing', toLine(e, 24))
        break
      case 'DEBIT_NOTE':
        notes[26] += num(e.amount)
        notes[38] += num(e.sdAmount)
        push('increasing', toLine(e, 26))
        break
      case 'CREDIT_NOTE':
        notes[31] += num(e.amount)
        notes[39] += num(e.sdAmount)
        push('decreasing', toLine(e, 31))
        break
      case 'VAT_ADJUSTMENT': {
        const adj = adjustmentNoteOf(e)
        if (!adj) { unclassified.push(e); break }
        notes[adj.note] += num(e.amount)
        push(adj.side === 'INCREASE' ? 'increasing' : 'decreasing', toLine(e, adj.note))
        break
      }
      default:
        break
    }
  }

  // Part 4 — creditable input (10–18a)
  for (const e of inputCredit) {
    const claimable = inRange(e.claimPeriod) ||
      (!e.claimPeriod && e.period <= end && (deadlineOf(e) ?? '') >= start)
    if (!claimable) continue
    const n = inputCreditNote(e)
    notes[n].a += num(e.baseAmount)
    notes[n].b += num(e.amount)
    push('input', toLine(e, n))
    if (!e.claimPeriod) claimIds.push(String(e._id))
  }

  // Part 6 — VDS deducted by customers (29)
  for (const e of vdsReceived) {
    // Claimable from the later of the certificate's period and the entry's own
    // period (a certificate can never make a deduction claimable before it happened).
    const certPeriod = [taxPeriodOf(e.certificate?.date ?? e.date), e.period].filter(Boolean).sort().pop() ?? null
    const claimable = inRange(e.claimPeriod) ||
      (!e.claimPeriod && !!certPeriod && certPeriod <= end && (deadlineOf(e) ?? '') >= start)
    if (!claimable) continue
    notes[29] += num(e.amount)
    push('decreasing', toLine(e, 29))
    if (!e.claimPeriod) claimIds.push(String(e._id))
  }

  // Part 9 — treasury deposits (58 VAT, 59 SD)
  const challanKeys = new Set(challanList.map(c => challanKey(c.challanNo)).filter(Boolean))
  const matchedKeys = new Set()
  for (const e of payments) {
    const key = challanKey(e.deposit?.challanNo) || challanKey(e.documentNo)
    const linked = filing && e.filingId && String(e.filingId) === String(filing._id)
    if (!linked && !inRange(e.period) && !(key && challanKeys.has(key))) continue
    if (key) matchedKeys.add(key)
    const paid = num(e.amount)
    const sdPaid = num(e.sdAmount)
    // A payment of supplementary duty only (amount 0, sdAmount > 0) is an SD line (note 59).
    const sdOnly = !(paid > 0) && sdPaid > 0
    notes[58] += paid
    notes[59] += sdPaid
    push('deposits', {
      ...toLine(e, sdOnly ? 59 : 58),
      ...(sdOnly ? { amount: round2(sdPaid) } : {}),
      head:        sdOnly ? 'SD' : 'VAT',
      source:      'ENTRY',
      challanNo:   e.deposit?.challanNo ?? e.documentNo ?? null,
      bank:        e.challan?.bank ?? null,
      branch:      e.challan?.branch ?? null,
      accountCode: e.challan?.accountCode ?? e.deposit?.accountCode ?? null,
    })
    // A VAT payment recorded with interest / late fee keeps the tax principal in
    // baseAmount (amount = whole challan). The extra is part of note 50 via note 41,
    // otherwise it would surface as a spurious credit in the closing balance (65).
    const principal = num(e.baseAmount)
    const interest = principal > 0 && paid > principal + 0.005 ? round2(paid - principal) : 0
    if (interest > 0) {
      notes[41] += interest
      push('increasing', {
        ...toLine(e, 41),
        base:   0,
        amount: interest,
        notes:  `Interest / late fee paid with challan ${e.deposit?.challanNo ?? e.documentNo ?? ''}`.trim(),
      })
    }
  }
  for (const c of challanList) {
    const key = challanKey(c.challanNo)
    if (key && matchedKeys.has(key)) continue
    if (key) matchedKeys.add(key)
    // An SD challan settles note 51 (note 59); it must not inflate the VAT deposits (58).
    const isSd = c.head === 'SD'
    notes[isSd ? 59 : 58] += c.amount
    push('deposits', {
      id: null, entryNo: null, entryType: 'CHALLAN', note: isSd ? 59 : 58, head: isSd ? 'SD' : 'VAT', source: 'CHALLAN',
      date: c.date, period: c.date ? taxPeriodOf(c.date) : null,
      partyName: null, partyBin: null, documentNo: c.challanNo, documentDate: c.date,
      challanNo: c.challanNo, bank: c.bank, branch: c.branch, accountCode: c.accountCode,
      base: 0, sd: isSd ? c.amount : 0, amount: c.amount,
    })
  }

  // Note 52 — closing balance of the last tax period
  let previousClosingBalance = 0
  let previousSdClosingBalance = 0
  let previousSource = null
  if (prevFiling) {
    const cf = carryForwardOf(prevFiling)
    previousClosingBalance = cf.vat
    previousSdClosingBalance = cf.sd
    previousSource = {
      type:           'FILING',
      filingId:       String(prevFiling._id),
      periodKey:      prevFiling.periodKey,
      periodEnd:      prevFiling.periodEnd,
      status:         prevFiling.status,
      closingBalance: round2(num(prevFiling.closingBalance)),
    }
    if (prevFiling.periodEnd !== addPeriods(start, -1)) {
      warnings.push({
        level: 'warning', code: 'RETURN_GAP',
        message: `No filed return between ${periodLabel(prevFiling.periodEnd)} and ${periodLabel(start)} — the previous closing balance comes from the ${prevFiling.periodKey} return. File the missing periods first.`,
      })
    }
  } else {
    const opening = openingBalanceOf(balanceBf)
    previousClosingBalance = opening.vat
    previousSdClosingBalance = opening.sd
    if (balanceBf.length) {
      previousSource = { type: 'OPENING', entryIds: balanceBf.map(e => String(e._id)) }
      for (const e of balanceBf) {
        const line = toLine(e, 52)
        if (e.balanceSide === 'PAYABLE') line.amount = -line.amount
        ;(noteEntries[52] ||= []).push(line)
        entryIds.add(line.id)
      }
    } else {
      warnings.push({
        level: 'info', code: 'NO_OPENING_BALANCE',
        message: 'No earlier return is filed in the system and no VAT balance brought forward is recorded, so note 52 is 0. Record the closing balance of your last Mushak-9.1 under Opening balances if you had one.',
      })
    }
  }
  notes[52] = previousClosingBalance
  notes[53] = previousSdClosingBalance

  // Totals and net tax (Part 3 → Part 10)
  for (const col of ['a', 'b', 'c']) notes[9][col] = OUTPUT_NOTES.reduce((s, n) => s + notes[n][col], 0)
  notes[23].a = INPUT_CREDIT_NOTES.reduce((s, n) => s + notes[n].a, 0)
  notes[23].b = INPUT_CREDIT_TOTAL_NOTES.reduce((s, n) => s + notes[n].b, 0)
  roundNotes(notes)

  notes[28] = round2(notes[24] + notes[25] + notes[26] + notes[27])
  notes[33] = round2(notes[29] + notes[30] + notes[31] + notes[32])
  notes[34] = round2(notes[9].c - notes[23].b + notes[28] - notes[33])
  notes[35] = round2(notes[34] - (notes[52] + notes[56]))
  notes[36] = round2(notes[9].b + notes[38] - (notes[39] + notes[40]))
  notes[37] = round2(notes[36] - (notes[53] + notes[57]))
  // eVAT: 50 = 35 + 41 + 43 + 44 and 65 = 58 − 50 − 67 (51 / 66 likewise for SD).
  // A negative 50 (credit larger than interest / penalties) means nothing to
  // deposit — shown as 0 — while the credit still flows into the closing balance.
  const net50 = round2(notes[35] + notes[41] + notes[43] + notes[44])
  const net51 = round2(notes[37] + notes[42])
  notes[50] = round2(Math.max(0, net50))
  notes[51] = round2(Math.max(0, net51))
  // Closing balance before the refund request (67 may not exceed 58 − 50).
  const closingBalance = round2(Math.max(0, notes[58] - net50))
  const sdClosingBalance = round2(Math.max(0, notes[59] - net51))
  const carryForward = round2(Math.max(0, closingBalance - refund))
  notes[65] = carryForward
  notes[66] = sdClosingBalance
  notes[67] = refund
  notes[68] = 0

  // ── warnings ──
  const currentPeriod = taxPeriodOf(new Date())
  const todayKey = dhakaDayKey(new Date())
  const dueDate = returnDueDate(start, end)
  const isFiled = !!filing && FILED_STATUSES.includes(filing.status)

  if (settings?.vat?.registrationType && settings.vat.registrationType !== 'REGISTERED') {
    warnings.push({
      level: 'info', code: 'NOT_REGISTERED',
      message: `The company's VAT registration type is ${settings.vat.registrationType}. Mushak-9.1 is filed by VAT-registered persons; turnover-tax units file Mushak-9.2.`,
    })
  }
  if (!isValidBin(company?.bin)) {
    warnings.push({ level: 'warning', code: 'COMPANY_BIN_MISSING', message: 'Company BIN is missing or invalid — set it in Tax settings before filing.' })
  }
  // A range that splits a statutory single return (Jul–Sep 2026) cannot be drafted,
  // paid or filed (vatReturnRangeProblem) — unless part of that return was already
  // filed on its own, in which case its months are filed separately.
  const split = statutorySplitOf(start, end)
  if (rangeProblem?.code === 'PERIOD_OVERRIDE') {
    warnings.push({
      level: 'warning', code: 'PERIOD_OVERRIDE',
      message: `${split?.label ?? rangeProblem.suggest?.label} is a single return. Select ${rangeProblem.suggest.start} to ${rangeProblem.suggest.end} — this range cannot be saved, paid or filed.`,
      suggest: rangeProblem.suggest,
    })
  } else if (split && !isFiled && !rangeProblem) {
    // (Not with RETURN_OVERLAP: e.g. Aug viewed after the whole Jul–Sep return was filed.)
    warnings.push({
      level: 'info', code: 'PERIOD_OVERRIDE',
      message: `${split.label} is a single return, but part of it was already filed as a separate return, so its remaining months are filed separately too.`,
    })
  }
  if (rangeProblem?.code === 'RETURN_OVERLAP') {
    warnings.push({
      level: 'danger', code: 'RETURN_OVERLAP',
      message: `${rangeProblem.message} — this range cannot be saved, paid or filed. Open the filed return instead.`,
      suggest: rangeProblem.suggest,
    })
  }

  // Note 52 / 53 of a filed return no longer match the balance it would bring
  // forward today (the earlier return was amended, filed late, or the opening
  // balance changed): the change never reaches the later returns until this one
  // is amended too (s.66).
  const filedNotes = isFiled ? filing.snapshot?.notes : null
  if (filedNotes && filedNotes[52] !== undefined && filedNotes[52] !== null) {
    const f52 = round2(num(filedNotes[52]))
    const f53 = round2(num(filedNotes[53]))
    if (Math.abs(f52 - previousClosingBalance) > 0.005 || Math.abs(f53 - previousSdClosingBalance) > 0.005) {
      const from = prevFiling ? `the ${rangeLabel(prevFiling.periodStart, prevFiling.periodEnd)} return` : 'the opening VAT balance'
      const sdPart = Math.abs(f53 - previousSdClosingBalance) > 0.005 ? `; note 53 (SD): filed ${money(f53)}, now ${money(previousSdClosingBalance)}` : ''
      warnings.push({
        level: 'danger', code: 'CARRY_FORWARD_CHANGED',
        message: `The balance brought forward from ${from} changed after this return was filed (note 52: filed ${money(f52)}, now ${money(previousClosingBalance)}${sdPart}). File an amended return (s.66) for this period so the change reaches the later returns.`,
        filed: f52, now: previousClosingBalance, sdFiled: f53, sdNow: previousSdClosingBalance,
      })
    }
  }
  // The previous return itself is stale: its note 52 / 53 as filed differ from what
  // it would bring forward today, so this return's note 52 is out of date as well.
  const prevNotes = prevFiling?.snapshot?.notes
  if (prevLive && prevNotes && prevNotes[52] !== undefined && prevNotes[52] !== null) {
    const p52 = round2(num(prevNotes[52]))
    const p53 = round2(num(prevNotes[53]))
    if (Math.abs(p52 - prevLive.vat) > 0.005 || Math.abs(p53 - prevLive.sd) > 0.005) {
      const prevLabel = rangeLabel(prevFiling.periodStart, prevFiling.periodEnd)
      warnings.push({
        level: 'warning', code: 'PREVIOUS_RETURN_STALE',
        message: `Note 52 comes from the ${prevLabel} return as filed, but that return's own brought-forward balance has changed since (filed ${money(p52)}, now ${money(prevLive.vat)}). Amend the ${prevLabel} return first, then this one.`,
        periodKey: prevFiling.periodKey,
      })
    }
  }
  if (end >= currentPeriod) {
    warnings.push({ level: 'info', code: 'PERIOD_OPEN', message: `${periodLabel(end)} has not ended yet — figures are provisional.` })
  } else if (!isFiled && todayKey > dueDate) {
    warnings.push({
      level: 'danger', code: 'RETURN_OVERDUE',
      message: `This return was due on ${dayKeyLabel(dueDate)} and is not filed. Interest (note 41) and a late-filing penalty (note 43) may apply.`,
    })
  }

  // VDS receivable without a Mushak-6.6 for more than 4 periods (still claimable)
  const staleVds = pendingVds.filter(e => (deadlineOf(e) ?? '') >= start)
  if (staleVds.length) {
    const earliestDeadline = staleVds.map(deadlineOf).sort()[0]
    warnings.push({
      level: 'warning', code: 'VDS_CERTIFICATE_PENDING',
      message: `${staleVds.length} VDS deduction(s) by customers (${money(sumAmount(staleVds))}) still have no Mushak-6.6 after 4+ periods. Collect the certificates — the earliest claim window closes in ${periodLabel(earliestDeadline)}.`,
      count: staleVds.length, amount: sumAmount(staleVds), entryIds: staleVds.map(e => String(e._id)),
    })
  }

  // Credits whose claim window has closed unclaimed
  const expiredInput = expired.filter(e => e.entryType === 'INPUT_VAT')
  const expiredVds = expired.filter(e => e.entryType === 'VDS_RECEIVABLE')
  if (expiredInput.length) {
    warnings.push({
      level: 'danger', code: 'INPUT_VAT_EXPIRED',
      message: `${expiredInput.length} input VAT credit(s) (${money(sumAmount(expiredInput))}) passed the ${CLAIM_WINDOW_PERIODS}-period claim window unclaimed. Mark them non-creditable (claim window expired).`,
      count: expiredInput.length, amount: sumAmount(expiredInput), entryIds: expiredInput.map(e => String(e._id)),
    })
  }
  if (expiredVds.length) {
    warnings.push({
      level: 'danger', code: 'VDS_RECEIVABLE_EXPIRED',
      message: `${expiredVds.length} VDS deduction(s) by customers (${money(sumAmount(expiredVds))}) can no longer be claimed — the ${CLAIM_WINDOW_PERIODS}-period window has closed.`,
      count: expiredVds.length, amount: sumAmount(expiredVds), entryIds: expiredVds.map(e => String(e._id)),
    })
  }

  // Input VAT included here that expires within one period — claim it in this return
  const expiringBy = addPeriods(end, 1)
  const expiring = lines.input.filter(l => !l.claimPeriod && l.claimDeadline && l.claimDeadline <= expiringBy)
  if (expiring.length) {
    warnings.push({
      level: 'warning', code: 'INPUT_VAT_EXPIRING',
      message: `${expiring.length} input VAT credit(s) (${money(sumAmount(expiring))}) expire by ${periodLabel(expiringBy)}. File this return on time to claim them.`,
      count: expiring.length, amount: sumAmount(expiring), entryIds: expiring.map(l => l.id),
    })
  }

  // Zero-rated / exempt purchases should carry no VAT
  const zeroWithVat = lines.input.filter(l => INPUT_ZERO_EXEMPT_NOTES.includes(l.note) && l.amount > 0)
  if (zeroWithVat.length) {
    warnings.push({
      level: 'warning', code: 'ZERO_EXEMPT_INPUT_WITH_VAT',
      message: `${zeroWithVat.length} zero-rated/exempt purchase(s) carry VAT (${money(sumAmount(zeroWithVat))}); it is not counted in note 23. Check the purchase treatment.`,
      count: zeroWithVat.length, amount: sumAmount(zeroWithVat), entryIds: zeroWithVat.map(l => l.id),
    })
  }

  // Sales above Tk 25,000 without the buyer's BIN (Mushak-6.3 requirement)
  const noBin = lines.output.filter(l => ['STANDARD', 'REDUCED'].includes(l.treatment) && l.base > BUYER_BIN_THRESHOLD && !isValidBin(l.partyBin))
  if (noBin.length) {
    warnings.push({
      level: 'warning', code: 'BUYER_BIN_MISSING',
      message: `${noBin.length} sale(s) above ${money(BUYER_BIN_THRESHOLD)} have no valid buyer BIN. Add the client's BIN (a VDS-withholding buyer needs it on the Mushak-6.3).`,
      count: noBin.length, amount: round2(noBin.reduce((s, l) => s + l.base, 0)), entryIds: noBin.map(l => l.id),
    })
  }

  // Foreign-currency sales recorded at face value (before issuing required a BDT
  // value): their base/VAT are not Taka figures and understate the return. An
  // entry already corrected to Taka (base ≠ the invoice's face value) is fine.
  const outInvoiceIds = [...new Set(lines.output.map(l => l.invoiceId).filter(id => id && mongoose.isValidObjectId(id)))]
  if (outInvoiceIds.length) {
    const unconverted = await Invoice.find({
      _id: { $in: outInvoiceIds },
      currency: { $exists: true, $nin: [null, '', 'BDT'] },
      totalBDT: { $not: { $gt: 0 } },   // missing / null / 0
    }).lean()
    if (unconverted.length) {
      const faceBase = new Map(unconverted.map(i => [String(i._id), invoiceTaxTotals(i).taxableValue]))
      const rows = lines.output.filter(l => faceBase.has(l.invoiceId) && Math.abs(l.base - faceBase.get(l.invoiceId)) < 0.01)
      if (rows.length) warnings.push({
        level: 'warning', code: 'OUTPUT_VAT_UNCONVERTED',
        message: `${rows.length} foreign-currency sale(s) have no BDT value and were recorded at face value. Correct their base / VAT to Taka before filing.`,
        count: rows.length, amount: round2(rows.reduce((s, l) => s + l.base, 0)), entryIds: rows.map(l => l.id),
      })
    }
  }

  // Mushak-6.10 disclosure (purchases and sales above Tk 2,00,000). Purchases come
  // from the same sources as the register: received bills, input VAT entries and
  // paid supplier expenses without VAT (lib/tax/purchaseRegister).
  const bigPurchases = disclosurePurchaseRows(purchases)
  const bigSales = lines.output.filter(l => l.base + l.sd + l.amount > DISCLOSURE_THRESHOLD)
  if (bigPurchases.length || bigSales.length) {
    warnings.push({
      level: 'info', code: 'DISCLOSURE_6_10',
      message: `Mushak-6.10 disclosure needed: ${bigPurchases.length} purchase(s) and ${bigSales.length} sale(s) above ${money(DISCLOSURE_THRESHOLD)} in this period.`,
      count: bigPurchases.length + bigSales.length,
      entryIds: [...bigPurchases.map(r => r.entryId).filter(Boolean), ...bigSales.map(l => l.id)],
      billIds: bigPurchases.map(r => r.purchaseBillId).filter(Boolean),
      expenseIds: bigPurchases.map(r => r.expenseId).filter(Boolean),
    })
  }

  // Mushak-6.6 certificates we still have to issue to suppliers
  const toIssue = lines.increasing.filter(l => l.entryType === 'VDS_PAYABLE' && !['ISSUED', 'NOT_REQUIRED'].includes(l.certificate?.status))
  if (toIssue.length) {
    warnings.push({
      level: 'info', code: 'VDS_CERTIFICATE_TO_ISSUE',
      message: `${toIssue.length} VDS deduction(s) from suppliers (${money(sumAmount(toIssue))}) still need a Mushak-6.6 issued.`,
      count: toIssue.length, amount: sumAmount(toIssue), entryIds: toIssue.map(l => l.id),
    })
  }

  if (unclassified.length) {
    warnings.push({
      level: 'warning', code: 'ADJUSTMENT_UNCLASSIFIED',
      message: `${unclassified.length} VAT adjustment(s) (${money(sumAmount(unclassified))}) have no direction or 9.1 note and are left out of the return.`,
      count: unclassified.length, amount: sumAmount(unclassified), entryIds: unclassified.map(e => String(e._id)),
    })
  }

  const noChallanNo = challanList.filter(c => !c.challanNo)
  if (noChallanNo.length) {
    warnings.push({ level: 'warning', code: 'CHALLAN_NUMBER_MISSING', message: `${noChallanNo.length} treasury deposit(s) have no challan number.` })
  }

  if (notes[50] > 0 && notes[58] + 0.005 < notes[50]) {
    warnings.push({
      level: isFiled ? 'warning' : 'info', code: 'DEPOSIT_SHORT',
      message: `Treasury deposits (${money(notes[58])}) are below the net VAT payable (${money(notes[50])}) by ${money(notes[50] - notes[58])}. Pay by challan before submitting the return.`,
      amount: round2(notes[50] - notes[58]),
    })
  }
  // Supplementary duty is deposited under its own code (note 59), not with the VAT.
  if (notes[51] > 0 && notes[59] + 0.005 < notes[51]) {
    warnings.push({
      level: isFiled ? 'warning' : 'info', code: 'SD_DEPOSIT_SHORT',
      message: `SD treasury deposits (${money(notes[59])}) are below the net SD payable (note 51, ${money(notes[51])}) by ${money(notes[51] - notes[59])}. Pay the SD by challan and enter it with the return as an SD challan (note 59) before submitting.`,
      amount: round2(notes[51] - notes[59]),
    })
  }

  for (const key of Object.keys(lines)) lines[key].sort((x, y) => new Date(x.date ?? 0) - new Date(y.date ?? 0))

  const result = {
    start,
    end,
    periodKey,
    periods,
    label: rangeLabel(start, end),
    dueDate,
    taxpayer: {
      name:      str(company?.name),
      bin:       str(company?.bin),
      tin:       str(company?.tin),
      address:   str(company?.address),
      vatCircle: str(company?.vatCircle),
    },
    registrationType: settings?.vat?.registrationType ?? null,
    returnFrequency:  settings?.vat?.returnFrequency ?? null,
    notes,
    noteEntries,
    lines,
    summary: {
      taxableSales:     notes[9].a,
      outputSd:         notes[9].b,
      output:           notes[9].c,
      input:            notes[23].b,
      increasing:       notes[28],
      decreasing:       notes[33],
      netPayable:       notes[34],
      previousCredit:   notes[52],
      netAfterBalance:  notes[35],
      estimatedPayable: notes[50],
      deposits:         notes[58],
      balanceDue:       round2(Math.max(0, notes[50] - notes[58])),
      closingBalance,
      sdPayable:        notes[51],
      sdDeposits:       notes[59],
      sdBalanceDue:     round2(Math.max(0, notes[51] - notes[59])),
    },
    previousClosingBalance,
    previousSdClosingBalance,
    previousSource,
    closingBalance,
    carryForward,
    sdClosingBalance,
    sdCarryForward: sdClosingBalance,
    refundRequested: refund,
    challans: challanList,
    filing: filing
      ? { id: String(filing._id), status: filing.status, returnType: filing.returnType ?? null, filedAt: filing.filedAt ?? null, acknowledgementNo: filing.acknowledgementNo ?? null }
      : null,
    // false ⇒ this range cannot be saved as a draft, paid or filed (see rangeProblem)
    fileable:     !rangeProblem,
    rangeProblem: rangeProblem ? { code: rangeProblem.code, message: rangeProblem.message, suggest: rangeProblem.suggest ?? null } : null,
    warnings,
    entryIds: [...entryIds],
    computedAt: new Date(),
  }

  return { result, claimIds, settings, filing }
}

/**
 * Compute Mushak-9.1 for the tax periods start..end ('YYYY-MM', inclusive).
 * Every note 1–68 is present (0 when empty); `noteEntries[n]` and `lines.*`
 * hold the TaxEntries behind each note for drill-down.
 * Optional `challans` override the filing's challans (used when filing).
 *
 * @returns {Promise<{ start, end, periodKey, notes, noteEntries, lines:{ output, input,
 *   inputNonCreditable, increasing, decreasing, deposits }, summary, previousClosingBalance,
 *   closingBalance, carryForward, warnings, entryIds, ... }>}
 */
export async function computeVatReturn({ start, end, challans, refundRequested } = {}) {
  const { result } = await buildVatReturn({ start, end, challans, refundRequested })
  return result
}

// ── filing ──────────────────────────────────────────────────────────────────

function historyEntryOf(existing) {
  const s = existing.snapshot || {}
  return {
    status:            existing.status,
    returnType:        existing.returnType ?? null,
    filedAt:           existing.filedAt ?? null,
    filedBy:           existing.filedBy ? String(existing.filedBy) : null,
    acknowledgementNo: existing.acknowledgementNo ?? null,
    netPayable:        existing.netPayable ?? null,
    closingBalance:    existing.closingBalance ?? null,
    refundRequested:   existing.refundRequested ?? 0,
    challans:          existing.challans ?? [],
    notes:             s.notes ?? null,
    summary:           s.summary ?? null,
    previousClosingBalance: s.previousClosingBalance ?? null,
    entryIds:          s.entryIds ?? [],
    computedAt:        s.computedAt ?? null,
    filingNotes:       existing.notes ?? null,
    supersededAt:      new Date(),
  }
}

/**
 * File (or amend) the VAT return for start..end.
 *
 * - One TaxFiling per periodKey (unique {kind, periodKey}). A FILED/AMENDED
 *   return can only be replaced with returnType 'AMENDED' (409 otherwise); the
 *   earlier version is kept in snapshot.history[]. 'AMENDED' (s.66) is only
 *   allowed for a period that is already FILED or AMENDED — an existing DRAFT
 *   does not count (422 otherwise). The status follows that state.
 * - Refuses periods that have not ended, filing dates before the period end,
 *   ranges overlapping another filed return, and ranges that split a statutory
 *   single return (vatReturnRangeProblem).
 * - The snapshot leaves out the CARRY_FORWARD_CHANGED / PREVIOUS_RETURN_STALE
 *   warnings (filing this version resolves them); laterVatReturnsToAmend()
 *   tells the caller which later filed returns now need amending.
 * - Sets claimPeriod = end on included INPUT_VAT / VDS_RECEIVABLE that had none,
 *   filingId on every included entry, and finance settings taxLockedUntil =
 *   last day of `end` (when later than the current lock).
 *
 * @returns {Promise<object>} the TaxFiling document
 */
export async function fileVatReturn({
  start, end, returnType, acknowledgementNo, filedAt, challans, notes, userId = null, refundRequested,
} = {}) {
  assertRange(start, end)
  const currentPeriod = taxPeriodOf(new Date())
  if (end >= currentPeriod) throw httpError(422, `${periodLabel(end)} has not ended yet — a return can be filed only after the tax period closes`)

  const filedDate = filedAt ? toInstant(filedAt) : new Date()
  if (!filedDate) throw httpError(422, 'Invalid filing date')
  const filedKey = dhakaDayKey(filedDate)
  if (filedKey <= periodLastDay(end)) throw httpError(422, 'The filing date must be after the end of the tax period')
  if (filedKey > dhakaDayKey(new Date())) throw httpError(422, 'The filing date cannot be in the future')

  if (returnType != null && returnType !== '' && !RETURN_TYPES.includes(returnType)) {
    throw httpError(422, `Return type must be one of ${RETURN_TYPES.join(', ')}`)
  }

  if (Array.isArray(challans)) {
    for (const c of challans) {
      const amt = Number(c?.amount)
      if (c && (c.amount === '' || c.amount == null || !Number.isFinite(amt) || amt < 0)) throw httpError(422, 'Each challan needs an amount of 0 or more')
      if (c?.date && !toInstant(c.date)) throw httpError(422, 'Invalid challan date')
    }
  } else if (challans != null) {
    throw httpError(422, 'Challans must be a list')
  }
  if (refundRequested != null && refundRequested !== '' && !(Number(refundRequested) >= 0)) {
    throw httpError(422, 'Refund requested must be 0 or more')
  }

  const periodKey = vatReturnPeriodKey(start, end)
  const label = rangeLabel(start, end)
  const existing = await TaxFiling.findOne({ kind: 'VAT_RETURN', periodKey }).lean()
  const amending = !!existing && FILED_STATUSES.includes(existing.status)
  if (amending && returnType !== 'AMENDED') {
    throw httpError(409, `The VAT return for ${label} is already filed. File an amended return (s.66) to change it.`)
  }
  // s.66 corrects a return already submitted — there is nothing to amend yet.
  if (!amending && returnType === 'AMENDED') {
    throw httpError(422, `There is no filed return for ${label} to amend — file it as Original (s.64) or Late (s.65)`)
  }

  // Overlaps another filed return, or splits the single Jul–Sep 2026 return.
  const problem = await vatReturnRangeProblem(start, end)
  if (problem) throw httpError(problem.status, problem.message)

  const dueDate = returnDueDate(start, end)
  const type = returnType || (filedKey > dueDate ? 'LATE' : 'ORIGINAL')
  const refundInput = refundRequested != null && refundRequested !== '' ? Number(refundRequested) : undefined

  const { result, claimIds, settings } = await buildVatReturn({
    start, end,
    challans: Array.isArray(challans) ? challans : undefined,
    refundRequested: refundInput,
  })
  if (result.refundRequested > result.closingBalance + 0.005) {
    throw httpError(422, `Refund requested cannot exceed the closing balance (${money(result.closingBalance)})`)
  }

  const history = amending ? [...(existing.snapshot?.history ?? []), historyEntryOf(existing)] : (existing?.snapshot?.history ?? [])
  const computed = { ...result }
  delete computed.filing // live filing summary — not part of the frozen return
  delete computed.fileable
  delete computed.rangeProblem
  // Filing this version brings note 52 up to date — do not freeze a warning that
  // asks for exactly this amendment (the "As filed" view would show it forever).
  computed.warnings = (result.warnings ?? []).filter(w => !CHAIN_WARNING_CODES.includes(w.code))
  const snapshot = {
    ...computed,
    version: 1,
    returnType: type,
    filedAt: filedDate,
    acknowledgementNo: str(acknowledgementNo),
    history,
  }

  const fields = {
    kind:              'VAT_RETURN',
    periodKey,
    periodStart:       start,
    periodEnd:         end,
    fiscalYear:        fiscalYearOf(periodRange(end).start, settings?.fiscalYearStartMonth ?? 7),
    // From the state, not the requested type: only a filed return can be AMENDED.
    status:            amending ? 'AMENDED' : 'FILED',
    returnType:        type,
    snapshot,
    netPayable:        result.notes[50],
    closingBalance:    result.closingBalance,
    refundRequested:   result.refundRequested,
    challans:          result.challans,
    filedAt:           filedDate,
    filedBy:           userId || null,
    acknowledgementNo: str(acknowledgementNo),
    notes:             str(notes),
  }

  let filing
  if (existing) {
    const guard = { _id: existing._id, status: existing.status }
    if (existing.updatedAt) guard.updatedAt = existing.updatedAt
    filing = await TaxFiling.findOneAndUpdate(guard, { $set: fields }, { new: true })
    if (!filing) throw httpError(409, 'This return was changed by someone else just now — reload and try again')
  } else {
    try {
      filing = await TaxFiling.create({ ...fields, createdBy: userId || null })
    } catch (err) {
      if (err?.code === 11000) throw httpError(409, `The VAT return for ${label} is being filed by someone else — reload and try again`)
      throw err
    }
  }

  // Link the sub-ledger to this filing.
  const filingId = filing._id
  const entryObjectIds = result.entryIds.map(id => new mongoose.Types.ObjectId(id))
  const claimObjectIds = claimIds.map(id => new mongoose.Types.ObjectId(id))
  try {
    if (claimObjectIds.length) {
      await TaxEntry.updateMany({ _id: { $in: claimObjectIds }, claimPeriod: null }, { $set: { claimPeriod: end } })
    }
    if (entryObjectIds.length) {
      await TaxEntry.updateMany({ _id: { $in: entryObjectIds } }, { $set: { filingId } })
    }
    // An amendment releases entries that are no longer part of the return.
    const released = await TaxEntry.find({ filingId, _id: { $nin: entryObjectIds } }).select('_id').lean()
    if (released.length) {
      const ids = released.map(r => r._id)
      await TaxEntry.updateMany({ _id: { $in: ids } }, { $set: { filingId: null } })
      await TaxEntry.updateMany(
        { _id: { $in: ids }, entryType: { $in: ['INPUT_VAT', 'VDS_RECEIVABLE'] }, claimPeriod: { $gte: start, $lte: end } },
        { $set: { claimPeriod: null } },
      )
    }
  } catch (err) {
    // Compensate so the filing can be retried cleanly.
    try {
      if (!existing) {
        await TaxFiling.deleteOne({ _id: filingId })
        await TaxEntry.updateMany({ filingId }, { $set: { filingId: null } })
        if (claimObjectIds.length) {
          await TaxEntry.updateMany({ _id: { $in: claimObjectIds }, claimPeriod: end }, { $set: { claimPeriod: null } })
        }
      } else {
        const restore = {}
        for (const k of Object.keys(fields)) restore[k] = existing[k] ?? null
        await TaxFiling.updateOne({ _id: filingId }, { $set: restore })
      }
    } catch (undoErr) {
      console.error('[fileVatReturn] compensation failed', undoErr)
    }
    throw err
  }

  // Lock VAT entries up to the end of the filed period.
  const lastDay = periodLastDay(end)
  try {
    const fresh = await getFinanceSettings()
    const current = fresh?.taxLockedUntil ? String(fresh.taxLockedUntil) : null
    if (!current || current < lastDay) await saveFinanceSettings({ taxLockedUntil: lastDay })
  } catch (err) {
    console.error('[fileVatReturn] could not set taxLockedUntil', err)
  }

  return filing
}

/**
 * Filed returns after `filing` that brought forward a different closing balance
 * than `filing` now carries (note 65 / 66 → the next return's note 52 / 53): the
 * next filed return's 52 / 53 as filed is compared with this carry-forward. When
 * they differ, that return and every later one need an amended return (s.66), in
 * period order. Empty when the chain is intact or nothing later is filed.
 * @param {object} filing  TaxFiling (lean or doc) of a VAT return just filed / amended
 * @returns {Promise<string[]>} periodKeys, earliest first
 */
export async function laterVatReturnsToAmend(filing) {
  if (!filing?.periodEnd) return []
  const later = await TaxFiling.find({
    kind: 'VAT_RETURN', status: { $in: FILED_STATUSES }, periodStart: { $gt: filing.periodEnd },
  }).sort({ periodStart: 1, periodEnd: 1 }).select('periodKey periodStart periodEnd snapshot.notes').lean()
  if (!later.length) return []
  const cf = carryForwardOf(filing)
  const nextNotes = later[0].snapshot?.notes
  const intact = !!nextNotes && nextNotes[52] !== undefined && nextNotes[52] !== null &&
    Math.abs(round2(num(nextNotes[52])) - cf.vat) <= 0.005 &&
    Math.abs(round2(num(nextNotes[53])) - cf.sd) <= 0.005
  return intact ? [] : later.map(f => f.periodKey)
}
