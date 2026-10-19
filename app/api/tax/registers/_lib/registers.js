/**
 * Server-side register builders: Mushak-6.2 (sales), Mushak-6.1 (purchases),
 * Mushak-6.10 (disclosure above Tk 2 lakh), VDS and TDS registers.
 *
 * Every builder returns flat rows keyed by the column keys of ./columns.js
 * (plus a few link fields such as entryId / invoiceId / purchaseBillId), so the
 * JSON view, the CSV export and the HTML print share one source of truth.
 * Amounts are BDT, rounded half-up to 2 decimals; dates are Dhaka 'YYYY-MM-DD'.
 */

import { TaxEntry, Invoice, CreditNote } from '@/models'
import {
  round2, vatReturnNoteOf, isValidBin, INPUT_NON_CREDIT_REASONS, CREDIT_NOTE_REASONS,
  CERTIFICATE_STATUSES, DEPOSIT_STATUSES, PAYEE_TYPES, BUYER_BIN_THRESHOLD, DISCLOSURE_THRESHOLD,
} from '@/lib/tax/catalog'
import { dhakaDayKey, parseDhakaDay } from '@/lib/dhakaTime'
import { periodLabel, periodFirstDay, periodLastDay, taxPeriodOf } from '@/lib/finance/fiscal'
import { maskIdentity } from '@/lib/pii'
import {
  loadPurchases, billParty, billDoc, expensePurchase, disclosurePurchaseRows,
} from '@/lib/tax/purchaseRegister'
import { REGISTERS, REGISTER_TYPES } from './columns'

export const MAX_ROWS = 10000
const MAX_DAYS = 731

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

function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

const CERT_LABELS = Object.fromEntries(CERTIFICATE_STATUSES.map(s => [s.value, s.label]))
const DEPOSIT_LABELS = Object.fromEntries(DEPOSIT_STATUSES.map(s => [s.value, s.label]))
const PAYEE_LABELS = Object.fromEntries(PAYEE_TYPES.map(s => [s.value, s.label]))
const NOTE_REASON_LABELS = Object.fromEntries(CREDIT_NOTE_REASONS.map(s => [s.value, s.label]))
const TREATMENT_SHORT = { STANDARD: 'Standard', REDUCED: 'Reduced', ZERO_RATED: 'Zero-rated', EXEMPT: 'Exempt', NONE: 'No VAT' }
const LINE_TYPE_LABELS = { ASSET: 'Fixed asset', CONSUMABLE: 'Consumable', EXPENSE: 'Expense' }

// ── date range ───────────────────────────────────────────────────────────────

/**
 * ?start=YYYY-MM-DD&end=YYYY-MM-DD (inclusive, Dhaka days). Defaults to the
 * current calendar month. → { start, end, from: Date, to: Date (exclusive), label }
 */
export function parseRegisterRange(startStr, endStr) {
  const month = taxPeriodOf(new Date())
  const start = str(startStr) ?? periodFirstDay(month)
  const end = str(endStr) ?? periodLastDay(month)
  const s = parseDhakaDay(start)
  const e = parseDhakaDay(end)
  if (!s || !e || dhakaDayKey(s.start) !== start || dhakaDayKey(e.start) !== end) {
    throw httpError(400, 'start and end must be dates (YYYY-MM-DD)')
  }
  if (start > end) throw httpError(400, 'The start date must not be after the end date')
  const days = Math.round((e.next.getTime() - s.start.getTime()) / 86400000)
  if (days > MAX_DAYS) throw httpError(400, 'Choose a range of at most 2 years')
  return { start, end, from: s.start, to: e.next, label: rangeLabel(start, end) }
}

function rangeLabel(start, end) {
  const sp = start.slice(0, 7)
  const ep = end.slice(0, 7)
  if (start === periodFirstDay(sp) && end === periodLastDay(ep)) {
    return sp === ep ? periodLabel(sp) : `${periodLabel(sp)} – ${periodLabel(ep)}`
  }
  return `${start} to ${end}`
}

// ── helpers ──────────────────────────────────────────────────────────────────

/** Split `total` across `weights` (half-up 2 dp, remainder on the last line) so the parts add up exactly. */
function allocate(total, weights) {
  const t = round2(total)
  const sum = weights.reduce((s, w) => s + w, 0)
  if (!(sum > 0)) return weights.map((_, i) => (i === weights.length - 1 ? t : 0))
  let used = 0
  return weights.map((w, i) => {
    if (i === weights.length - 1) return round2(t - used)
    const part = round2((t * w) / sum)
    used = round2(used + part)
    return part
  })
}

function sumRows(rows, columns) {
  const totals = {}
  for (const c of columns) {
    if (!c.total) continue
    totals[c.key] = round2(rows.reduce((s, r) => s + num(r[c.key]), 0))
  }
  return totals
}

function numberRows(rows) {
  rows.forEach((r, i) => { r.serial = i + 1 })
  return rows
}

function byDateThenDoc(a, b) {
  return String(a.date ?? '').localeCompare(String(b.date ?? '')) ||
    String(a.challanNo ?? a.invoiceNo ?? a.documentNo ?? '').localeCompare(String(b.challanNo ?? b.invoiceNo ?? b.documentNo ?? ''), undefined, { numeric: true })
}

function itcRemark(e) {
  if (!e) return null
  if (e.creditable === true) {
    const note = vatReturnNoteOf(e)
    return `Input tax credit (note ${note})${e.claimPeriod ? ` · claimed ${periodLabel(e.claimPeriod)}` : ''}`
  }
  const reason = INPUT_NON_CREDIT_REASONS[e.nonCreditReason] ?? 'not creditable'
  return `No ITC — ${reason} (note ${vatReturnNoteOf({ ...e, creditable: false })})`
}

function saleRemark(e, lineRate = null) {
  const t = e.treatment || 'STANDARD'
  const parts = [TREATMENT_SHORT[t] ?? t]
  const rate = lineRate ?? e.rate
  if (!['ZERO_RATED', 'EXEMPT', 'NONE'].includes(t) && rate !== null && rate !== undefined && rate !== '') parts[0] += ` ${num(rate)}%`
  if (e.serviceCode) parts.push(e.serviceCode)
  if (['STANDARD', 'REDUCED'].includes(t) && num(e.baseAmount) > BUYER_BIN_THRESHOLD && !isValidBin(e.partyBin)) parts.push('Buyer BIN missing')
  return parts.join(' · ')
}

const ENTRY_FIELDS = [
  'entryNo', 'entryType', 'isOpening', 'date', 'period', 'baseAmount', 'rate', 'amount', 'sdAmount', 'treatment',
  'serviceCode', 'creditable', 'nonCreditReason', 'claimPeriod', 'claimDeadline', 'section', 'payeeType',
  'higherRateApplied', 'higherRateReason', 'partyType', 'partyName', 'partyBin', 'partyTin', 'partyAddress',
  'documentNo', 'documentDate', 'certificate', 'deposit', 'challan', 'invoiceId', 'creditNoteId', 'expenseId',
  'purchaseBillId', 'notes',
].join(' ')

async function findEntries(filter, range) {
  return TaxEntry.find({ status: 'ACTIVE', ...filter, date: { $gte: range.from, $lt: range.to } })
    .select(ENTRY_FIELDS)
    .sort({ date: 1, entryNo: 1 })
    .limit(MAX_ROWS + 1)
    .lean()
}

// ── Mushak-6.2 sales register ────────────────────────────────────────────────

async function buildSales(range) {
  const entries = await findEntries({ isOpening: { $ne: true }, entryType: { $in: ['OUTPUT_VAT', 'CREDIT_NOTE', 'DEBIT_NOTE'] } }, range)

  const invoiceIds = uniqIds(entries.filter(e => e.entryType === 'OUTPUT_VAT').map(e => e.invoiceId))
  const noteIds = uniqIds(entries.filter(e => e.entryType !== 'OUTPUT_VAT').map(e => e.creditNoteId))
  const [invoices, notes] = await Promise.all([
    invoiceIds.length ? Invoice.find({ _id: { $in: invoiceIds } }).select('invoiceNumber items').lean() : [],
    noteIds.length ? CreditNote.find({ _id: { $in: noteIds } }).select('noteNo kind invoiceNumber reason reasonText').lean() : [],
  ])
  const invById = new Map(invoices.map(i => [String(i._id), i]))
  const noteById = new Map(notes.map(n => [String(n._id), n]))

  const rows = []
  const summary = {
    invoices: 0,
    sales:  { taxableValue: 0, sd: 0, vat: 0 },
    credit: { count: 0, taxableValue: 0, sd: 0, vat: 0 },
    debit:  { count: 0, taxableValue: 0, sd: 0, vat: 0 },
  }

  for (const e of entries) {
    const base = round2(num(e.baseAmount))
    const sd = round2(num(e.sdAmount))
    const vat = round2(num(e.amount))
    const common = {
      date:         dayKey(e.date),
      buyerName:    str(e.partyName),
      buyerAddress: str(e.partyAddress),
      buyerBin:     str(e.partyBin),
      challanDate:  dayKey(e.documentDate ?? e.date),
      entryId:      String(e._id),
      entryNo:      e.entryNo ?? null,
      invoiceId:    idStr(e.invoiceId),
    }

    if (e.entryType === 'OUTPUT_VAT') {
      summary.invoices += 1
      summary.sales.taxableValue += base
      summary.sales.sd += sd
      summary.sales.vat += vat
      const inv = e.invoiceId ? invById.get(String(e.invoiceId)) : null
      const challanNo = str(e.documentNo) ?? str(inv?.invoiceNumber) ?? e.entryNo
      const items = Array.isArray(inv?.items) ? inv.items.filter(it => it && typeof it === 'object') : []
      const weights = items.map(it => Math.max(0, num(it.taxableValue ?? it.amount)))

      if (items.length > 1 && weights.some(w => w > 0)) {
        // One register line per invoice line; amounts re-allocated so they add up to the tax entry exactly.
        const vatWeights = items.map(it => Math.max(0, num(it.vatAmount)))
        const sdWeights = items.map(it => Math.max(0, num(it.sdAmount)))
        const bases = allocate(base, weights)
        const vats = allocate(vat, vatWeights.some(w => w > 0) ? vatWeights : weights)
        const sds = allocate(sd, sdWeights.some(w => w > 0) ? sdWeights : weights)
        items.forEach((it, i) => {
          rows.push({
            ...common,
            kind:         'INVOICE',
            challanNo,
            description:  str(it.description) ?? `Line ${i + 1}`,
            quantity:     num(it.quantity) || null,
            taxableValue: bases[i],
            sd:           sds[i],
            vat:          vats[i],
            remarks:      saleRemark(e, it.vatRate ?? null),
          })
        })
      } else {
        const it = items[0]
        rows.push({
          ...common,
          kind:         'INVOICE',
          challanNo,
          description:  str(it?.description) ?? str(e.notes) ?? (challanNo ? `Supply — ${challanNo}` : 'Supply'),
          quantity:     it ? (num(it.quantity) || null) : null,
          taxableValue: base,
          sd,
          vat,
          remarks:      saleRemark(e, it?.vatRate ?? null),
        })
      }
      continue
    }

    // Credit note (Mushak-6.7) reduces sales; debit note (6.8) increases them.
    const isCredit = e.entryType === 'CREDIT_NOTE'
    const sign = isCredit ? -1 : 1
    const note = e.creditNoteId ? noteById.get(String(e.creditNoteId)) : null
    const bucket = isCredit ? summary.credit : summary.debit
    bucket.count += 1
    bucket.taxableValue += base
    bucket.sd += sd
    bucket.vat += vat
    const reason = NOTE_REASON_LABELS[note?.reason] ?? str(note?.reasonText)
    rows.push({
      ...common,
      kind:         isCredit ? 'CREDIT_NOTE' : 'DEBIT_NOTE',
      creditNoteId: idStr(e.creditNoteId),
      challanNo:    str(note?.noteNo) ?? str(e.documentNo) ?? e.entryNo,
      description:  `${isCredit ? 'Credit note' : 'Debit note'}${reason ? ` — ${reason}` : ''}`,
      quantity:     null,
      taxableValue: round2(sign * base),
      sd:           round2(sign * sd),
      vat:          round2(sign * vat),
      remarks:      `Mushak-${isCredit ? '6.7' : '6.8'}${note?.invoiceNumber ? ` against ${note.invoiceNumber}` : ''}`,
    })
  }

  for (const b of [summary.sales, summary.credit, summary.debit]) {
    for (const k of ['taxableValue', 'sd', 'vat']) b[k] = round2(b[k])
  }
  summary.net = {
    taxableValue: round2(summary.sales.taxableValue - summary.credit.taxableValue + summary.debit.taxableValue),
    sd:           round2(summary.sales.sd - summary.credit.sd + summary.debit.sd),
    vat:          round2(summary.sales.vat - summary.credit.vat + summary.debit.vat),
  }

  rows.sort(byDateThenDoc)
  return { rows: numberRows(rows), summary, truncated: entries.length > MAX_ROWS }
}

// ── purchases: bills + input VAT entries + paid purchases without VAT ────────
// (sources shared with the Mushak-9.1 disclosure warning: lib/tax/purchaseRegister)

async function buildPurchases(range) {
  const { bills, entries, noVatExpenses, vatByBill, expenseById, truncated } = await loadPurchases(range)
  const rows = []
  const summary = {
    bills: bills.length, otherPurchases: entries.length, noVatPurchases: noVatExpenses.length,
    value: 0, sd: 0, vat: 0, creditableVat: 0,
  }

  for (const bill of bills) {
    const party = billParty(bill)
    const doc = billDoc(bill)
    const itcEntry = vatByBill.get(String(bill._id))
    const itc = itcEntry
      ? itcRemark(itcEntry)
      : (num(bill.vatTotal) > 0 ? (bill.vatCreditable ? 'Input VAT creditable — recorded when the bill is paid' : 'No ITC (bill marked not creditable)') : null)
    if (itcEntry?.creditable === true) summary.creditableVat += num(bill.vatTotal)

    for (const line of bill.lines ?? []) {
      const value = round2(num(line.qty) * num(line.unitPrice))
      const vat = round2(num(line.vatAmount))
      const sd = round2(num(line.sdAmount))
      rows.push({
        date:           dayKey(bill.billDate),
        ...doc,
        sellerName:     party.name,
        sellerAddress:  party.address,
        sellerBin:      party.bin,
        description:    [str(line.description), str(line.brand), str(line.model)].filter(Boolean).join(' '),
        quantity:       num(line.qty) || null,
        value,
        sd,
        vat,
        remarks:        [bill.billNo, LINE_TYPE_LABELS[line.lineType] ?? null, line.unit ? `unit: ${line.unit}` : null, vat > 0 ? itc : null].filter(Boolean).join(' · '),
        purchaseBillId: String(bill._id),
        kind:           'BILL',
      })
      summary.value += value
      summary.sd += sd
      summary.vat += vat
    }
    if (num(bill.otherCosts) > 0) {
      rows.push({
        date:           dayKey(bill.billDate),
        ...doc,
        sellerName:     party.name,
        sellerAddress:  party.address,
        sellerBin:      party.bin,
        description:    'Other costs on the bill (freight, installation, etc.)',
        quantity:       null,
        value:          round2(num(bill.otherCosts)),
        sd:             0,
        vat:            0,
        remarks:        bill.billNo,
        purchaseBillId: String(bill._id),
        kind:           'BILL',
      })
      summary.value += num(bill.otherCosts)
    }
  }

  for (const e of entries) {
    const exp = e.expenseId ? expenseById.get(String(e.expenseId)) : null
    const value = round2(num(e.baseAmount))
    const sd = round2(num(e.sdAmount))
    const vat = round2(num(e.amount))
    rows.push({
      date:          dayKey(e.date),
      challanNo:     str(e.documentNo) ?? e.entryNo,
      challanDate:   dayKey(e.documentDate),
      sellerName:    str(e.partyName),
      sellerAddress: str(e.partyAddress),
      sellerBin:     str(e.partyBin),
      description:   str(exp?.title) ?? str(e.notes) ?? (e.serviceCode ? `Supply ${e.serviceCode}` : 'Purchase'),
      quantity:      null,
      value,
      sd,
      vat,
      remarks:       [itcRemark(e), e.entryNo].filter(Boolean).join(' · '),
      entryId:       String(e._id),
      expenseId:     idStr(e.expenseId),
      purchaseBillId: idStr(e.purchaseBillId),
      kind:          'ENTRY',
    })
    summary.value += value
    summary.sd += sd
    summary.vat += vat
    if (e.creditable === true) summary.creditableVat += vat
  }

  // Paid purchases that recorded no input VAT (unregistered / turnover-tax sellers,
  // exempt supplies) — every business purchase belongs in the 6.1 (rule 40).
  for (const x of noVatExpenses) {
    const p = expensePurchase(x)
    rows.push({
      date:          p.date,
      challanNo:     p.challanNo,
      challanDate:   p.challanDate,
      sellerName:    p.sellerName,
      sellerAddress: p.sellerAddress,
      sellerBin:     p.sellerBin,
      description:   p.description,
      quantity:      null,
      value:         p.value,
      sd:            0,
      vat:           p.vatBDT,
      remarks:       [p.vatBDT > 0 ? 'VAT not recorded in the tax ledger — no input tax credit' : 'No VAT charged', p.vatTypeLabel, p.expenseNo].filter(Boolean).join(' · '),
      expenseId:     p.expenseId,
      kind:          'EXPENSE',
    })
    summary.value += p.value
    summary.vat += p.vatBDT
  }

  for (const k of ['value', 'sd', 'vat', 'creditableVat']) summary[k] = round2(summary[k])
  rows.sort(byDateThenDoc)
  return { rows: numberRows(rows), summary, truncated }
}

// ── Mushak-6.10 disclosure ───────────────────────────────────────────────────

async function buildDisclosure(range) {
  const [purchases, sales] = await Promise.all([
    loadPurchases(range),
    findEntries({ isOpening: { $ne: true }, entryType: 'OUTPUT_VAT' }, range),
  ])

  const partA = disclosurePurchaseRows(purchases)

  const partB = []
  for (const e of sales) {
    const value = round2(num(e.baseAmount) + num(e.sdAmount) + num(e.amount))
    if (value <= DISCLOSURE_THRESHOLD) continue
    partB.push({
      part: 'B', date: dayKey(e.date), challanNo: str(e.documentNo) ?? e.entryNo, challanDate: dayKey(e.documentDate ?? e.date), value,
      partyName: str(e.partyName), partyAddress: str(e.partyAddress), partyBin: str(e.partyBin),
      entryId: String(e._id), invoiceId: idStr(e.invoiceId),
    })
  }

  const sortPart = (rows) => numberRows(rows.sort((a, b) =>
    String(a.challanDate ?? a.date ?? '').localeCompare(String(b.challanDate ?? b.date ?? '')) ||
    String(a.challanNo ?? '').localeCompare(String(b.challanNo ?? ''), undefined, { numeric: true })))

  sortPart(partA)
  sortPart(partB)
  const summary = {
    threshold: DISCLOSURE_THRESHOLD,
    A: { count: partA.length, value: round2(partA.reduce((s, r) => s + r.value, 0)) },
    B: { count: partB.length, value: round2(partB.reduce((s, r) => s + r.value, 0)) },
  }
  return { rows: [...partA, ...partB], summary, truncated: sales.length > MAX_ROWS || purchases.truncated }
}

// ── VDS register ─────────────────────────────────────────────────────────────

async function buildVds(range) {
  const entries = await findEntries({ entryType: { $in: ['VDS_PAYABLE', 'VDS_RECEIVABLE'] } }, range)
  const summary = {
    byUs:        { count: 0, value: 0, vds: 0, certificatesToIssue: 0 },
    byCustomers: { count: 0, value: 0, vds: 0, certificatesPending: 0 },
  }
  const rows = entries.map(e => {
    const payable = e.entryType === 'VDS_PAYABLE'
    const cert = e.certificate ?? {}
    const dep = e.deposit ?? {}
    const bucket = payable ? summary.byUs : summary.byCustomers
    bucket.count += 1
    bucket.value += num(e.baseAmount)
    bucket.vds += num(e.amount)
    if (payable && !['ISSUED', 'NOT_REQUIRED'].includes(cert.status)) bucket.certificatesToIssue += 1
    if (!payable && cert.status !== 'RECEIVED') bucket.certificatesPending += 1

    let returnNote
    if (payable) {
      returnNote = dep.status === 'VIA_RETURN' ? 'Note 24 — paid via the return'
        : dep.status === 'PENDING' && num(dep.paidAmount) > 0 ? `Note 24 · Part-deposited (${round2(num(dep.paidAmount))} of ${round2(num(e.amount))})`
        : `Note 24 · ${DEPOSIT_LABELS[dep.status] ?? 'deposit not recorded'}`
    } else if (e.claimPeriod) {
      returnNote = `Note 29 — claimed ${periodLabel(e.claimPeriod)}`
    } else if (cert.status === 'RECEIVED') {
      returnNote = 'Note 29 — claimable'
    } else {
      returnNote = e.claimDeadline ? `Collect 6.6 — claim by ${periodLabel(e.claimDeadline)}` : 'Collect 6.6'
    }

    return {
      date:          dayKey(e.date),
      direction:     payable ? 'Us — from supplier (note 24)' : 'Customer — from our sale (note 29)',
      partyBin:      str(e.partyBin),
      partyName:     str(e.partyName),
      partyAddress:  str(e.partyAddress),
      value:         round2(num(e.baseAmount)),
      vds:           round2(num(e.amount)),
      invoiceNo:     str(e.documentNo),
      invoiceDate:   dayKey(e.documentDate),
      certNo:        str(cert.number),
      certDate:      dayKey(cert.date),
      certStatus:    CERT_LABELS[cert.status] ?? null,
      accountCode:   str(dep.accountCode) ?? str(e.challan?.accountCode),
      // Several challans may have paid one deduction (part payments): list them all.
      depositSerial: str([...new Set((dep.allocations ?? []).map(a => a?.challanNo).filter(Boolean))].join(', ')) ?? str(dep.challanNo),
      depositDate:   dayKey(dep.date),
      returnNote,
      remarks:       [e.isOpening ? 'Opening balance' : null, e.entryNo].filter(Boolean).join(' · '),
      entryId:       String(e._id),
      invoiceId:     idStr(e.invoiceId),
      kind:          e.entryType,
    }
  })
  for (const b of [summary.byUs, summary.byCustomers]) {
    b.value = round2(b.value)
    b.vds = round2(b.vds)
  }
  rows.sort(byDateThenDoc)
  return { rows: numberRows(rows), summary, truncated: entries.length > MAX_ROWS }
}

// ── TDS register ─────────────────────────────────────────────────────────────

async function buildTds(range, { maskTin }) {
  const entries = await findEntries({ entryType: { $in: ['TDS_PAYABLE', 'TDS_RECEIVABLE'] } }, range)
  const summary = {
    byUs:        { count: 0, base: 0, tds: 0, undeposited: 0, undepositedAmount: 0 },
    byCustomers: { count: 0, base: 0, tds: 0, certificatesPending: 0 },
  }
  const rows = entries.map(e => {
    const payable = e.entryType === 'TDS_PAYABLE'
    const cert = e.certificate ?? {}
    const dep = e.deposit ?? {}
    const bucket = payable ? summary.byUs : summary.byCustomers
    bucket.count += 1
    bucket.base += num(e.baseAmount)
    bucket.tds += num(e.amount)
    if (payable && dep.status === 'PENDING') {
      bucket.undeposited += 1
      // What is still owed — a challan may have paid part of it (deposit.paidAmount).
      bucket.undepositedAmount += Math.max(0, num(e.amount) - num(dep.paidAmount))
    }
    if (!payable && cert.status !== 'RECEIVED') bucket.certificatesPending += 1
    const tin = str(e.partyTin)
    return {
      date:          dayKey(e.date),
      direction:     payable ? 'Us — from payee' : 'Customer — AIT credit',
      section:       str(e.section),
      partyName:     str(e.partyName),
      partyTin:      tin && maskTin ? maskIdentity(tin) : tin,
      payeeType:     PAYEE_LABELS[e.payeeType] ?? null,
      documentNo:    str(e.documentNo),
      base:          round2(num(e.baseAmount)),
      rate:          e.rate === null || e.rate === undefined ? null : num(e.rate),
      tds:           round2(num(e.amount)),
      certNo:        str(cert.number),
      certDate:      dayKey(cert.date),
      certStatus:    CERT_LABELS[cert.status] ?? null,
      // Several challans may have paid one deduction (part payments): list them all.
      challanNo:     str([...new Set((dep.allocations ?? []).map(a => a?.challanNo).filter(Boolean))].join(', ')) ?? str(dep.challanNo),
      challanDate:   dayKey(dep.date) ?? dayKey(dep.allocations?.[dep.allocations.length - 1]?.date),
      depositStatus: payable
        ? (dep.status === 'PENDING' && num(dep.paidAmount) > 0 ? `Part-deposited (${round2(num(dep.paidAmount))} of ${round2(num(e.amount))})` : (DEPOSIT_LABELS[dep.status] ?? null))
        : null,
      remarks:       [
        e.isOpening ? 'Opening balance' : null,
        e.higherRateApplied ? `Higher rate (s.142)${e.higherRateReason ? `: ${e.higherRateReason}` : ''}` : null,
        e.entryNo,
      ].filter(Boolean).join(' · '),
      entryId:       String(e._id),
      kind:          e.entryType,
    }
  })
  summary.byUs.base = round2(summary.byUs.base)
  summary.byUs.tds = round2(summary.byUs.tds)
  summary.byUs.undepositedAmount = round2(summary.byUs.undepositedAmount)
  summary.byCustomers.base = round2(summary.byCustomers.base)
  summary.byCustomers.tds = round2(summary.byCustomers.tds)
  rows.sort(byDateThenDoc)
  return { rows: numberRows(rows), summary, truncated: entries.length > MAX_ROWS }
}

// ── entry point ──────────────────────────────────────────────────────────────

/**
 * Build a register.
 * @param {{ type: 'sales'|'purchases'|'disclosure'|'vds'|'tds', range: object, maskTin?: boolean }} o
 * @returns {Promise<{ type, form, formBn, title, rule, hint, numbered, landscape, parts, start, end, label, columns, rows, totals, summary, truncated }>}
 */
export async function buildRegister({ type, range, maskTin = false }) {
  if (!REGISTER_TYPES.includes(type)) throw httpError(400, `type must be one of ${REGISTER_TYPES.join(', ')}`)
  const def = REGISTERS[type]
  let built
  switch (type) {
    case 'sales':      built = await buildSales(range); break
    case 'purchases':  built = await buildPurchases(range); break
    case 'disclosure': built = await buildDisclosure(range); break
    case 'vds':        built = await buildVds(range); break
    case 'tds':        built = await buildTds(range, { maskTin }); break
    default:           throw httpError(400, 'Unknown register type')
  }
  const rows = built.rows.slice(0, MAX_ROWS)
  const totals = type === 'disclosure'
    ? {
        A: sumRows(rows.filter(r => r.part === 'A'), def.columns),
        B: sumRows(rows.filter(r => r.part === 'B'), def.columns),
      }
    : sumRows(rows, def.columns)

  return {
    type,
    form:      def.form,
    formBn:    def.formBn ?? null,
    title:     def.title,
    rule:      def.rule,
    hint:      def.hint,
    numbered:  def.numbered,
    landscape: def.landscape,
    parts:     def.parts ?? null,
    start:     range.start,
    end:       range.end,
    label:     range.label,
    columns:   def.columns,
    rows,
    totals,
    summary:   built.summary,
    truncated: built.truncated || built.rows.length > MAX_ROWS,
  }
}
