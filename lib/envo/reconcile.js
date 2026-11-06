/**
 * lib/envo/reconcile.js — SERVER-ONLY. Do Envo and the CRM agree?
 *
 * Envo walks its invoices in id ranges and sends each page; this compares it with
 * the CRM's invoices in that range, in both directions, and checks the ledger holds
 * what the invoice says was received. It only reports: fixing is a push from Envo
 * (missing here) or a person's decision (changed here).
 */
import connectDB from '@/lib/mongodb'
import { CreditNote, EnvoSync, Invoice, Setting, TaxEntry, Transaction } from '@/models'

const LAST_RUN_KEY = 'envo_reconcile_last'

const cents = (v) => Math.round((Number(v) || 0) * 100)
const toMoney = (c) => c / 100

/** CRM status a healthy invoice has for each Envo status. */
const EXPECTED_STATUS = { unpaid: 'DRAFT', paid: 'PAID', void: 'CANCELLED' }

/** Σ cash booked on each invoice: income rows less their reversals, in BDT. */
async function ledgerByInvoice(ids) {
  if (!ids.length) return new Map()
  const rows = await Transaction.aggregate([
    { $match: { invoiceId: { $in: ids } } },
    { $group: {
      _id: '$invoiceId',
      net: { $sum: { $cond: [{ $eq: ['$type', 'INCOME'] }, { $ifNull: ['$amountBDT', 0] }, { $multiply: [{ $ifNull: ['$amountBDT', 0] }, -1] }] } },
    } },
  ])
  return new Map(rows.map(r => [String(r._id), Number(r.net) || 0]))
}

async function sumByInvoice(Model, match, field) {
  if (!match.invoiceId.$in.length) return new Map()
  const rows = await Model.aggregate([{ $match: match }, { $group: { _id: '$invoiceId', total: { $sum: `$${field}` } } }])
  return new Map(rows.map(r => [String(r._id), Number(r.total) || 0]))
}

/**
 * One page: `items` are Envo's invoices with fromId < id <= toId.
 * @returns {{ diffs: Array<{ id, number, code, detail }>, crm: { count, total, vat, paid } }}
 */
export async function reconcilePage({ fromId, toId, items }) {
  await connectDB()
  const rows = await Invoice.find({ envoId: { $gt: fromId, $lte: toId } })
    .select('envoId invoiceNumber status total vatAmount sdAmount paidAmount creditedAmount debitedAmount withheldVds withheldTds vatTreatment')
    .lean()
  const byId = new Map(rows.map(r => [r.envoId, r]))
  const issuedIds = rows.filter(r => r.status !== 'DRAFT' && r.status !== 'CANCELLED').map(r => r._id)
  const [ledger, refunds, vatEntries] = await Promise.all([
    ledgerByInvoice(issuedIds),
    sumByInvoice(CreditNote, { invoiceId: { $in: issuedIds }, kind: 'CREDIT', settlement: 'REFUND', status: 'ISSUED' }, 'totalAmount'),
    sumByInvoice(TaxEntry, { invoiceId: { $in: issuedIds }, entryType: 'OUTPUT_VAT', status: 'ACTIVE' }, 'amount'),
  ])

  // What the books hold after refunds and credit notes: the figure Envo's "received" has to equal.
  const keptOf = (inv) => (inv.status === 'DRAFT' || inv.status === 'CANCELLED')
    ? 0
    : (Number(inv.paidAmount) || 0) - (Number(inv.creditedAmount) || 0) - (Number(inv.withheldVds) || 0) - (Number(inv.withheldTds) || 0) - (refunds.get(String(inv._id)) ?? 0)

  const diffs = []
  const seen = new Set()
  const add = (id, number, code, detail) => diffs.push({ id, number, code, detail })

  for (const it of items) {
    seen.add(it.id)
    const inv = byId.get(it.id)
    if (!inv) {
      // A void that never reached the CRM is not missing: nothing was billed.
      if (it.status !== 'void') add(it.id, it.number, 'MISSING_IN_CRM', `${it.status} in Envo, not in the CRM`)
      continue
    }
    if (inv.invoiceNumber !== it.number) add(it.id, it.number, 'NUMBER_DIFFERS', `${inv.invoiceNumber} in the CRM`)
    // Refunded before it was ever issued: nothing was billed, so it stays a draft.
    const neverIssued = it.status === 'paid' && inv.status === 'DRAFT' && !(Number(it.paid) > 0)
    if (!neverIssued && inv.status !== EXPECTED_STATUS[it.status]) add(it.id, it.number, 'STATUS_DIFFERS', `${it.status} in Envo, ${inv.status} in the CRM`)
    if (cents(inv.total) !== cents(it.total)) add(it.id, it.number, 'TOTAL_DIFFERS', `${it.total} in Envo, ${inv.total} in the CRM`)
    if (cents(inv.vatAmount) !== cents(it.vat)) add(it.id, it.number, 'VAT_DIFFERS', `${it.vat} in Envo, ${inv.vatAmount} in the CRM`)
    if (cents(inv.sdAmount) !== cents(it.sd)) add(it.id, it.number, 'SD_DIFFERS', `${it.sd} in Envo, ${inv.sdAmount} in the CRM`)
    if (inv.status !== 'DRAFT' && inv.status !== 'CANCELLED') {
      const kept = keptOf(inv)
      if (it.status === 'paid' && cents(kept) !== cents(it.paid)) add(it.id, it.number, 'PAID_DIFFERS', `${it.paid} received in Envo, ${kept} kept in the CRM`)
      const booked = ledger.get(String(inv._id)) ?? 0
      if (cents(kept) !== cents(booked)) add(it.id, it.number, 'LEDGER_DIFFERS', `${kept} on the invoice, ${booked} in the ledger`)
      if (inv.vatTreatment !== 'NONE') {
        const entered = vatEntries.get(String(inv._id))
        if (entered === undefined) add(it.id, it.number, 'VAT_ENTRY_MISSING', 'Issued, but its output VAT is not in the tax ledger')
        else if (cents(entered) !== cents(inv.vatAmount)) add(it.id, it.number, 'VAT_ENTRY_DIFFERS', `${inv.vatAmount} on the invoice, ${entered} in the tax ledger`)
      }
    }
  }
  for (const inv of rows) {
    if (!seen.has(inv.envoId)) add(inv.envoId, inv.invoiceNumber, 'MISSING_IN_ENVO', `${inv.status} in the CRM, not in Envo`)
  }

  const billed = rows.filter(r => r.status !== 'CANCELLED')
  const sum = (key) => toMoney(billed.reduce((s, r) => s + cents(r[key]), 0))
  return {
    diffs,
    crm: { count: billed.length, total: sum('total'), vat: sum('vatAmount'), paid: toMoney(billed.reduce((s, r) => s + cents(keptOf(r)), 0)) },
  }
}

export async function saveReconcileReport(report) {
  await connectDB()
  await Setting.findOneAndUpdate(
    { key: LAST_RUN_KEY },
    { key: LAST_RUN_KEY, value: JSON.stringify({ ...report, receivedAt: new Date().toISOString() }), group: 'integrations' },
    { upsert: true },
  )
}

/** For Configuration → Integrations: how the connection stands. */
export async function envoStatus() {
  await connectDB()
  const [states, problems, last, booked] = await Promise.all([
    EnvoSync.aggregate([{ $group: { _id: '$state', count: { $sum: 1 }, last: { $max: '$syncedAt' } } }]),
    EnvoSync.find({ state: { $in: ['REVIEW', 'REJECTED'] } }).sort({ updatedAt: -1 }).limit(20)
      .select('envoId number invoiceId state code note total syncedAt').lean(),
    Setting.findOne({ key: LAST_RUN_KEY }).lean(),
    Invoice.countDocuments({ envoId: { $gt: 0 }, status: 'PAID' }),
  ])
  const byState = Object.fromEntries(states.map(s => [s._id, s]))
  let reconcile = null
  try { reconcile = last?.value ? JSON.parse(last.value) : null } catch { reconcile = null }
  return {
    ok:       byState.OK?.count ?? 0,
    review:   byState.REVIEW?.count ?? 0,
    rejected: byState.REJECTED?.count ?? 0,
    paid:     booked,
    lastSyncedAt: states.map(s => s.last).filter(Boolean).sort((a, b) => new Date(a) - new Date(b)).pop() ?? null,
    problems: problems.map(p => ({
      envoId: p.envoId, number: p.number, invoiceId: p.invoiceId ? String(p.invoiceId) : null,
      state: p.state, code: p.code, note: p.note, total: p.total, at: p.syncedAt,
    })),
    reconcile,
  }
}
