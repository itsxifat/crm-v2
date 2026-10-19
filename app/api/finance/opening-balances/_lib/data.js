/**
 * Server-side assembly of the opening-balance picture (B2). Not a route.
 *
 * Reads every sub-ledger's opening figure — money accounts, opening tax
 * entries, existing fixed assets, opening stock and client invoices that were
 * unpaid at go-live — and builds the position statement with the pure helpers
 * shared with the wizard page.
 */

import connectDB from '@/lib/mongodb'
import {
  MoneyAccount, TaxEntry, Asset, StockMovement, Invoice, Transaction, CreditNote, Reconciliation, User,
} from '@/models'
import { getFinanceSettings } from '@/lib/finance/settings'
import { accountTypeLabel, accountTypeGroup } from '@/lib/finance/constants'
import { addDays, dayKeyLabel, fiscalYearOf } from '@/lib/finance/fiscal'
import { dhakaDayKey, parseDhakaDay } from '@/lib/dhakaTime'
import { maskList, TAX_ENTRY_PII } from '@/lib/pii'
import { openingCostStages } from '@/lib/inventory/assets'
import {
  OPENING_TAX_TYPES, computeOpeningPosition, plural, readFxRates, round2, summarizeOpeningTax,
} from '@/app/admin/finance/opening-balances/_lib/position'

const PAYABLE_STATUSES = ['SENT', 'PARTIALLY_PAID', 'OVERDUE']
const toNum = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0 }
const idStr = (v) => (v == null ? null : String(v))
const dayOf = (d) => (d ? dhakaDayKey(d) : null)

/** Opening TaxEntry (lean) → API shape. */
export function serializeTaxEntry(e) {
  if (!e) return null
  const cert = e.certificate ?? {}
  const dep = e.deposit ?? {}
  const used = !!(e.filingId || e.claimPeriod || dep.depositEntryId || dep.status === 'DEPOSITED' || (Number(dep.paidAmount) || 0) > 0)
  return {
    id:            idStr(e._id ?? e.id),
    entryNo:       e.entryNo ?? null,
    entryType:     e.entryType,
    status:        e.status,
    isOpening:     !!e.isOpening,
    date:          dayOf(e.date),
    period:        e.period ?? null,
    fiscalYear:    e.fiscalYear ?? null,
    baseAmount:    toNum(e.baseAmount),
    rate:          e.rate ?? null,
    amount:        toNum(e.amount),
    sdAmount:      toNum(e.sdAmount),
    treatment:     e.treatment ?? null,
    creditable:    e.creditable ?? null,
    claimDeadline: e.claimDeadline ?? null,
    claimPeriod:   e.claimPeriod ?? null,
    balanceSide:   e.balanceSide ?? null,
    section:       e.section ?? null,
    payeeType:     e.payeeType ?? null,
    partyType:     e.partyType ?? null,
    partyName:     e.partyName ?? null,
    partyBin:      e.partyBin ?? null,
    partyTin:      e.partyTin ?? null,
    documentNo:    e.documentNo ?? null,
    documentDate:  dayOf(e.documentDate),
    certificate:   { status: cert.status ?? 'NOT_REQUIRED', number: cert.number ?? null, date: dayOf(cert.date) },
    deposit:       { status: dep.status ?? 'NOT_REQUIRED', challanNo: dep.challanNo ?? null, date: dayOf(dep.date) },
    filingId:      idStr(e.filingId),
    notes:         e.notes ?? null,
    used,
    createdAt:     e.createdAt ?? null,
    updatedAt:     e.updatedAt ?? null,
  }
}

async function accountRows(goLive) {
  const accounts = await MoneyAccount.find({})
    .select('name code type currency openingBalance openingDate openingReference status last4 bankName mfsProvider isDefault')
    .sort({ status: 1, type: 1, name: 1 })
    .lean()
  if (!accounts.length) return []
  const ids = accounts.map(a => a._id)

  const [txStats, recStats] = await Promise.all([
    Transaction.aggregate([
      { $match: { accountId: { $in: ids } } },
      { $group: { _id: '$accountId', count: { $sum: 1 }, firstDate: { $min: '$date' } } },
    ]),
    Reconciliation.aggregate([
      { $match: { accountId: { $in: ids }, status: 'COMPLETED' } },
      { $group: { _id: '$accountId', count: { $sum: 1 }, last: { $max: '$statementDate' } } },
    ]),
  ])
  const txBy = new Map(txStats.map(r => [String(r._id), r]))
  const recBy = new Map(recStats.map(r => [String(r._id), r]))

  // Exact count of entries dated before each account's opening date (ignored in its balance).
  const preOpening = await Promise.all(accounts.map(a => {
    const st = txBy.get(String(a._id))
    if (!a.openingDate || !st?.firstDate || new Date(st.firstDate) >= new Date(a.openingDate)) return 0
    return Transaction.countDocuments({ accountId: a._id, date: { $lt: a.openingDate } })
  }))

  return accounts.map((a, i) => {
    const id = String(a._id)
    const st = txBy.get(id)
    const rec = recBy.get(id)
    const openingDate = dayOf(a.openingDate)
    return {
      id,
      name:             a.name,
      code:             a.code ?? null,
      type:             a.type,
      typeLabel:        accountTypeLabel(a.type),
      group:            accountTypeGroup(a.type),
      currency:         a.currency || 'BDT',
      status:           a.status,
      last4:            a.last4 ?? null,
      bankName:         a.bankName ?? null,
      mfsProvider:      a.mfsProvider ?? null,
      isDefault:        !!a.isDefault,
      openingBalance:   round2(toNum(a.openingBalance)),
      openingDate,
      openingReference: a.openingReference ?? null,
      txCount:          st?.count ?? 0,
      preOpeningCount:  preOpening[i] || 0,
      reconciledCount:  rec?.count ?? 0,
      lastReconciled:   dayOf(rec?.last),
      dateMatchesGoLive: !!goLive && openingDate === goLive,
    }
  })
}

async function openingTaxEntries(session) {
  const docs = await TaxEntry.find({ isOpening: true, status: 'ACTIVE', entryType: { $in: OPENING_TAX_TYPES } })
    .sort({ entryType: 1, date: 1, createdAt: 1 })
    .lean()
  return maskList(session, docs.map(serializeTaxEntry), TAX_ENTRY_PII)
}

async function openingAssets(goLiveRange, asOfRange) {
  const match = { 'opening.isExisting': true, isArchived: { $ne: true } }
  const [groups, mismatched] = await Promise.all([
    Asset.aggregate([
      { $match: match },
      // Cost at go-live: repairs capitalised on/after go-live are later additions,
      // so the opening position does not drift after go-live (or after the lock).
      ...openingCostStages(goLiveRange?.start ?? null),
      {
        $group: {
          _id: { $ifNull: ['$isCapitalized', true] },
          count:       { $sum: 1 },
          cost:        { $sum: '$openingCost' },
          accumulated: { $sum: { $ifNull: ['$opening.accumulatedDepreciation', 0] } },
          bookValue:   { $sum: { $max: [0, { $subtract: ['$openingCost', { $ifNull: ['$opening.accumulatedDepreciation', 0] }] }] } },
        },
      },
    ]),
    goLiveRange && asOfRange
      ? Asset.countDocuments({
        ...match,
        $or: [{ 'opening.asOfDate': { $lt: asOfRange.start } }, { 'opening.asOfDate': { $gte: goLiveRange.start } }, { 'opening.asOfDate': null }],
      })
      : Promise.resolve(0),
  ])
  const cap = groups.find(g => g._id !== false) ?? {}
  const nonCap = groups.find(g => g._id === false) ?? {}
  return {
    count:               cap.count ?? 0,
    cost:                round2(cap.cost ?? 0),
    accumulated:         round2(cap.accumulated ?? 0),
    bookValue:           round2(cap.bookValue ?? 0),
    nonCapitalizedCount: nonCap.count ?? 0,
    nonCapitalizedCost:  round2(nonCap.cost ?? 0),
    asOfMismatchCount:   mismatched,
  }
}

async function openingStock() {
  const [row] = await StockMovement.aggregate([
    { $match: { type: 'OPENING' } },
    {
      $group: {
        _id:      null,
        value:    { $sum: { $ifNull: ['$totalCost', 0] } },
        lines:    { $sum: 1 },
        items:    { $addToSet: '$stockItemId' },
        lastDate: { $max: '$date' },
      },
    },
  ])
  return {
    items:    row?.items?.length ?? 0,
    lines:    row?.lines ?? 0,
    value:    round2(row?.value ?? 0),
    lastDate: dayOf(row?.lastDate),
  }
}

/**
 * Client invoices issued before go-live that were unpaid AT go-live.
 * due at go-live = current due + settlements recorded since go-live (cash and
 * withholding rows, credit notes applied; receipts reversed since go-live net
 * out) − debit notes raised since go-live, so the opening figure stays stable as
 * old invoices get paid.
 */
async function openingReceivables(goLiveRange, fxRates) {
  const empty = { count: 0, amount: 0, currentOutstanding: 0, settledSinceGoLive: 0, unconverted: [], invoices: [] }
  if (!goLiveRange) return empty
  const since = goLiveRange.start

  // A client receipt reversed on/after go-live (reverseMoneyEntry: an EXPENSE row
  // with reversalOf) put its amount back on the invoice: a receipt dated since
  // go-live then nets to nothing (sign 0), and one dated before go-live raised the
  // due since go-live, so it counts negative (sign −1). Other receipts: sign 1.
  const reversedIds = await Transaction.distinct('reversalOf', {
    type: 'EXPENSE', invoiceId: { $ne: null }, reversalOf: { $type: 'objectId' }, date: { $gte: since },
  })
  const sign = reversedIds.length
    ? { $cond: [{ $in: ['$_id', reversedIds] }, { $cond: [{ $gte: ['$date', since] }, 0, -1] }, 1] }
    : 1

  const [txRows, noteRows] = await Promise.all([
    Transaction.aggregate([
      { $match: {
        type: 'INCOME', invoiceId: { $ne: null }, reversalOf: null,
        $or: [{ date: { $gte: since } }, ...(reversedIds.length ? [{ _id: { $in: reversedIds } }] : [])],
      } },
      { $addFields: { _sign: sign } },
      {
        $group: {
          _id: '$invoiceId',
          grossBDT: {
            $sum: { $multiply: ['$_sign', {
              $cond: [
                { $ne: [{ $ifNull: ['$tax.grossBDT', null] }, null] },
                { $convert: { input: '$tax.grossBDT', to: 'double', onError: 0, onNull: 0 } },
                {
                  $cond: [
                    { $ne: [{ $ifNull: ['$amountBDT', null] }, null] },
                    { $convert: { input: '$amountBDT', to: 'double', onError: 0, onNull: 0 } },
                    {
                      $cond: [
                        { $in: [{ $ifNull: ['$currency', 'BDT'] }, ['BDT', '']] },
                        { $convert: { input: '$amount', to: 'double', onError: 0, onNull: 0 } },
                        0,
                      ],
                    },
                  ],
                },
              ],
            }] },
          },
          rows: { $push: { currency: { $ifNull: ['$currency', 'BDT'] }, amount: { $multiply: ['$_sign', { $convert: { input: '$amount', to: 'double', onError: 0, onNull: 0 } }] } } },
        },
      },
    ]),
    CreditNote.aggregate([
      { $match: { status: 'ISSUED', issuedAt: { $gte: since } } },
      {
        $group: {
          _id: '$invoiceId',
          credits: { $sum: { $cond: [{ $and: [{ $eq: ['$kind', 'CREDIT'] }, { $ne: ['$settlement', 'REFUND'] }] }, { $ifNull: ['$totalAmount', 0] }, 0] } },
          debits:  { $sum: { $cond: [{ $eq: ['$kind', 'DEBIT'] }, { $ifNull: ['$totalAmount', 0] }, 0] } },
        },
      },
    ]),
  ])
  const txBy = new Map(txRows.map(r => [String(r._id), r]))
  const noteBy = new Map(noteRows.map(r => [String(r._id), r]))
  const touched = [...new Set([...txBy.keys(), ...noteBy.keys()])]

  const invoices = await Invoice.find({
    issueDate: { $lt: since },
    status: { $in: [...PAYABLE_STATUSES, 'PAID'] },
    $or: [{ status: { $in: PAYABLE_STATUSES } }, { _id: { $in: touched } }],
  })
    .select('invoiceNumber status total paidAmount currency totalBDT issueDate clientId buyer.name')
    .populate({ path: 'clientId', select: 'company contactPerson userId', populate: { path: 'userId', select: 'name' } })
    .lean()

  let amount = 0
  let currentOutstanding = 0
  let settledSinceGoLive = 0
  const unconverted = {}
  const rows = []

  for (const inv of invoices) {
    const id = String(inv._id)
    const cur = String(inv.currency || 'BDT').toUpperCase()
    const total = toNum(inv.total)
    const paid = toNum(inv.paidAmount)
    const currentDue = Math.max(0, total - paid)
    const tx = txBy.get(id)
    const notes = noteBy.get(id)
    const settled = cur === 'BDT'
      ? toNum(tx?.grossBDT)
      : (tx?.rows ?? []).filter(r => String(r.currency || 'BDT').toUpperCase() === cur).reduce((s, r) => s + toNum(r.amount), 0)
    const credits = toNum(notes?.credits)
    const debits = toNum(notes?.debits)
    const totalAtGoLive = Math.max(0, total - debits)
    const due = round2(Math.min(totalAtGoLive, Math.max(0, currentDue - debits + settled + credits)))
    if (due <= 0.005) continue

    let factor = null
    if (cur === 'BDT') factor = 1
    else if (toNum(inv.totalBDT) > 0 && total > 0) factor = toNum(inv.totalBDT) / total
    else if (fxRates[cur]) factor = fxRates[cur]

    if (factor === null) {
      unconverted[cur] = round2((unconverted[cur] || 0) + due)
    } else {
      amount += due * factor
      currentOutstanding += currentDue * factor
      settledSinceGoLive += (due - currentDue) * factor
    }
    const client = inv.clientId && typeof inv.clientId === 'object' ? inv.clientId : null
    // Buyer as on the invoice (snapshot at DRAFT → SENT), else the client now:
    // company → contact person → the person's own name (User.name).
    const liveName = client ? (client.company || client.contactPerson || client.userId?.name || null) : null
    rows.push({
      id,
      invoiceNumber: inv.invoiceNumber ?? null,
      status:        inv.status,
      clientName:    inv.buyer?.name || liveName,
      issueDate:     dayOf(inv.issueDate),
      currency:      cur,
      dueAtGoLive:   due,
      dueAtGoLiveBDT: factor === null ? null : round2(due * factor),
      currentDue:    round2(currentDue),
    })
  }

  rows.sort((a, b) => (b.dueAtGoLiveBDT ?? 0) - (a.dueAtGoLiveBDT ?? 0))
  return {
    count:              rows.length,
    amount:             round2(amount),
    currentOutstanding: round2(currentOutstanding),
    settledSinceGoLive: round2(Math.max(0, settledSinceGoLive)),
    unconverted:        Object.entries(unconverted).map(([currency, value]) => ({ currency, amount: value })),
    invoices:           rows.slice(0, 15),
  }
}

/** Readiness checklist shown in step 5. level: 'error' blocks locking. */
function buildChecks({ settings, accounts, taxSummary, assets, stock, receivables, position }) {
  const checks = []
  const goLive = settings.goLiveDate
  if (!goLive) {
    checks.push({ level: 'error', step: 1, message: 'Set the go-live date first — every opening figure is "as at" the day before it.' })
  } else {
    if (!goLive.endsWith('-01')) {
      checks.push({ level: 'info', step: 1, message: `Go-live is ${dayKeyLabel(goLive)}, not the 1st of a month. That works, but VAT returns and bank statements line up more easily on a month start.` })
    }
  }

  const active = accounts.filter(a => a.status === 'ACTIVE')
  if (!active.length) {
    checks.push({ level: 'warning', step: 2, message: 'No money accounts yet. Add your bank accounts, cash box and mobile wallets, then enter their balances.' })
  }
  if (goLive) {
    const noDate = active.filter(a => !a.openingDate)
    if (noDate.length) checks.push({ level: 'warning', step: 2, message: `${plural(noDate.length, 'account')} without a balance date — the balance then counts every entry ever posted. Set it to the go-live date.` })
    const before = active.filter(a => a.openingDate && a.openingDate < goLive)
    if (before.length) checks.push({ level: 'warning', step: 2, message: `${plural(before.length, 'account')} with a balance date before go-live (${before.map(a => a.name).join(', ')}).` })
    const later = active.filter(a => a.openingDate && a.openingDate > goLive && Math.abs(a.openingBalance) > 0.005)
    if (later.length) checks.push({ level: 'info', step: 2, message: `${plural(later.length, 'account')} starting after go-live with a non-zero balance — fine for accounts opened later.` })
  }
  const pre = accounts.filter(a => a.preOpeningCount > 0)
  if (pre.length) {
    checks.push({ level: 'warning', step: 2, message: `${plural(pre.reduce((s, a) => s + a.preOpeningCount, 0), 'entry', 'entries')} on ${plural(pre.length, 'account')} dated before the balance date — ignored in the balance.` })
  }
  const missingFx = [...new Set(position.unconverted.map(u => u.currency).concat(receivables.unconverted.map(u => u.currency)))]
  if (missingFx.length) {
    checks.push({ level: 'warning', step: 2, message: `No go-live exchange rate for ${missingFx.join(', ')} — those balances are left out of the position.` })
  }

  const taxCount = Object.values(taxSummary.counts).reduce((s, n) => s + n, 0)
  if (settings.vat?.registrationType === 'REGISTERED' && !taxSummary.counts.VAT_CREDIT && !taxSummary.counts.VAT_PAYABLE) {
    checks.push({ level: 'info', step: 3, message: 'No VAT balance brought forward. If your last Mushak-9.1 showed a closing balance (note 65), enter it in step 3.' })
  }
  // Only one b/f line per side is allowed (rows left from before that rule was enforced).
  for (const [bucket, label] of [['VAT_CREDIT', 'VAT credit'], ['VAT_PAYABLE', 'VAT payable']]) {
    if (taxSummary.counts[bucket] > 1) {
      checks.push({ level: 'warning', step: 3, message: `${taxSummary.counts[bucket]} ${label} brought forward lines — only one is allowed and the first VAT return adds them all (note 52). Remove the duplicate.` })
    }
  }
  if (!taxCount) {
    checks.push({ level: 'info', step: 3, message: 'No opening tax balances entered. Skip this only if nothing was owed or claimable at go-live.' })
  }
  if (!assets.count && !assets.nonCapitalizedCount) {
    checks.push({ level: 'info', step: 4, message: 'No existing fixed assets imported. Import laptops, furniture and other equipment you already own from Inventory → Settings → Opening import.' })
  }
  if (assets.asOfMismatchCount) {
    checks.push({ level: 'warning', step: 4, message: `${plural(assets.asOfMismatchCount, 'opening asset')} with no "as of" date or one other than the day before go-live — their depreciation may start on the wrong day.` })
  }
  if (!stock.lines) {
    checks.push({ level: 'info', step: 4, message: 'No opening stock. Enter stationery, toner and other consumables on hand in Inventory → Consumables if you track them.' })
  }
  if (position.equity < -0.005) {
    checks.push({ level: 'warning', step: 5, message: 'Liabilities exceed assets, so opening equity is negative. Double-check the payable figures and loan balances.' })
  }
  return checks
}

/**
 * Everything the opening-balance wizard needs.
 * @param {object} session next-auth session (for PII masking of party TINs)
 */
export async function loadOpeningData(session) {
  await connectDB()
  const settings = await getFinanceSettings()
  const goLive = settings.goLiveDate
  const goLiveRange = goLive ? parseDhakaDay(goLive) : null
  const asOfDate = goLive ? addDays(goLive, -1) : null
  const asOfRange = asOfDate ? parseDhakaDay(asOfDate) : null
  const fxRates = readFxRates(settings.openingFxRates)

  const [accounts, taxOpenings, assets, stock, receivables, lockedByUser] = await Promise.all([
    accountRows(goLive),
    openingTaxEntries(session),
    openingAssets(goLiveRange, asOfRange),
    openingStock(),
    openingReceivables(goLiveRange, fxRates),
    settings.openingLockedBy && /^[a-f0-9]{24}$/i.test(settings.openingLockedBy)
      ? User.findById(settings.openingLockedBy).select('name').lean()
      : Promise.resolve(null),
  ])

  const tax = summarizeOpeningTax(taxOpenings)
  const position = computeOpeningPosition({ accounts, fxRates, tax, fixedAssets: assets, stock, receivables })
  const currencies = [...new Set([
    ...accounts.filter(a => a.currency && a.currency !== 'BDT').map(a => a.currency),
    ...receivables.unconverted.map(u => u.currency),
    ...Object.keys(fxRates),
  ])].sort()

  return {
    settings,
    goLiveDate:       goLive,
    asOfDate,
    goLiveFiscalYear: goLive ? fiscalYearOf(goLive, settings.fiscalYearStartMonth) : null,
    openingLocked:    !!settings.openingLocked,
    openingLockedAt:  settings.openingLockedAt ?? null,
    openingLockedBy:  lockedByUser ? { id: String(lockedByUser._id), name: lockedByUser.name } : (settings.openingLockedBy ? { id: settings.openingLockedBy, name: null } : null),
    fxRates,
    currencies,
    moneyAccounts: accounts,
    taxOpenings,
    tax,
    assets,
    stock,
    receivables,
    position,
    checks: buildChecks({ settings, accounts, taxSummary: tax, assets, stock, receivables, position }),
  }
}
