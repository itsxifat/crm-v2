/**
 * scripts/backfill-expense-project-cost.js
 *
 * Two corrections for expense payments recorded before the fixes in
 * lib/expensePayment.js:
 *
 *   1. Project cost excluded creditable input VAT only from the P&L, not from the
 *      project: Project.approvedExpenses was raised by the GROSS bill, so every
 *      project bill with creditable VAT overstated project cost (and understated
 *      profit) by that VAT. For each PAID / AUTHORIZED project expense that has no
 *      projectCostBDT yet:
 *        • projectCostBDT = gross BDT − creditable input VAT (the ledger row's
 *          tax.inputVatCreditable / tax.vatBDT) — the amount a reversal takes off;
 *        • Project.approvedExpenses −= that VAT (only when it was creditable).
 *      The expense is claimed first (projectCostBDT still null, payment unchanged),
 *      so a re-run never subtracts twice.
 *
 *   2. Purchase bills paid through Accounts kept the VDS / TDS / net payable they
 *      were requested with, even when Accounts changed the withholding at payment.
 *      Every RECEIVED bill whose payment request (payment.expenseId) is PENDING,
 *      PAID or AUTHORIZED gets the expense's withholding and net payable (BDT bills
 *      only — same fields as billWithholdingSet in lib/expensePayment.js).
 *
 * DRY RUN BY DEFAULT. Pass --apply to write:
 *     node scripts/backfill-expense-project-cost.js --apply
 *
 * Safe to re-run.
 */

import 'dotenv/config'
import mongoose from 'mongoose'

const APPLY = process.argv.includes('--apply') || process.env.npm_config_apply === 'true'

const num    = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }
const round2 = (v) => Math.round((num(v) + Number.EPSILON) * 100) / 100
const money  = (v) => round2(v).toLocaleString('en-BD', { minimumFractionDigits: 2 })
const str    = (v) => (v === null || v === undefined ? null : (String(v).trim() || null))
const near   = (a, b) => Math.abs(num(a) - num(b)) < 0.005

/** Same fields / rules as billWithholdingSet in lib/expensePayment.js. */
function billWithholdingSet(expense) {
  const t = expense?.tax
  if (!t || (str(expense?.currency) || 'BDT').toUpperCase() !== 'BDT') return {}
  const vds = round2(t.vdsAmount)
  const tds = round2(t.tdsAmount)
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

const get = (doc, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), doc)

async function main() {
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI is not set (check your .env)')
  await mongoose.connect(uri)
  const db = mongoose.connection.db
  console.log(`✓ connected to ${db.databaseName}`)
  console.log(APPLY ? '⚠  APPLY MODE — changes will be written\n' : 'ℹ  DRY RUN — pass --apply to write\n')

  const expenses     = db.collection('projectexpenses')
  const transactions = db.collection('transactions')
  const projects     = db.collection('projects')
  const bills        = db.collection('purchasebills')

  // ── 1. Project cost ────────────────────────────────────────────────────────
  const paid = await expenses.find(
    {
      status: { $in: ['PAID', 'AUTHORIZED'] },
      projectId: { $ne: null },
      accountsTransactionId: { $ne: null },
      $or: [{ projectCostBDT: { $exists: false } }, { projectCostBDT: null }],
    },
    { projection: { expenseId: 1, projectId: 1, amount: 1, amountBDT: 1, currency: 1, accountsTransactionId: 1, status: 1 } },
  ).toArray()
  const txById = new Map(
    (await transactions.find({ _id: { $in: paid.map(e => e.accountsTransactionId) } }, { projection: { tax: 1 } }).toArray())
      .map(t => [String(t._id), t]),
  )

  let recorded = 0
  let corrected = 0
  let vatTotal = 0
  console.log(`── 1. Project cost of ${paid.length} paid project expense(s) without a recorded amount ──`)
  for (const e of paid) {
    const tx = txById.get(String(e.accountsTransactionId))
    const currency = (str(e.currency) || 'BDT').toUpperCase()
    const grossBDT = round2(num(tx?.tax?.grossBDT) > 0 ? tx.tax.grossBDT
      : currency === 'BDT' ? e.amount : (num(e.amountBDT) > 0 ? e.amountBDT : e.amount))
    const creditableVat = tx?.tax?.inputVatCreditable === true ? round2(tx.tax.vatBDT) : 0
    const cost = round2(Math.max(0, grossBDT - creditableVat))
    if (creditableVat > 0) {
      corrected++
      vatTotal = round2(vatTotal + creditableVat)
      if (corrected <= 25) console.log(`  ${(e.expenseId ?? e._id).toString().padEnd(16)} gross ${money(grossBDT)} − creditable VAT ${money(creditableVat)} → cost ${money(cost)}`)
    }
    if (!APPLY) continue
    // Claim: only while nothing is recorded and the payment is unchanged.
    const claim = await expenses.updateOne(
      {
        _id: e._id, status: { $in: ['PAID', 'AUTHORIZED'] }, accountsTransactionId: e.accountsTransactionId,
        $or: [{ projectCostBDT: { $exists: false } }, { projectCostBDT: null }],
      },
      { $set: { projectCostBDT: cost } },
    )
    if (!claim.modifiedCount) continue
    recorded++
    if (creditableVat > 0) {
      await projects.updateOne({ _id: e.projectId }, [
        { $set: { approvedExpenses: { $round: [{ $add: [{ $convert: { input: '$approvedExpenses', to: 'double', onError: 0, onNull: 0 } }, -creditableVat] }, 2] } } },
      ])
    }
  }
  if (corrected > 25) console.log(`  … and ${corrected - 25} more`)
  console.log(`  ${corrected} with creditable input VAT — project cost overstated by ${money(vatTotal)} in total`)
  if (APPLY) console.log(`  ✓ recorded projectCostBDT on ${recorded} expense(s)`)

  // ── 2. Purchase-bill withholding ───────────────────────────────────────────
  const linked = await bills.find(
    { status: 'RECEIVED', 'payment.expenseId': { $ne: null }, 'payment.status': { $in: ['PAID', 'REQUESTED'] } },
    { projection: { billNo: 1, payment: 1, vds: 1, tds: 1, netPayable: 1 } },
  ).toArray()
  const expById = new Map(
    (await expenses.find(
      { _id: { $in: linked.map(b => b.payment.expenseId) }, status: { $in: ['PENDING', 'PAID', 'AUTHORIZED'] } },
      { projection: { tax: 1, currency: 1, amount: 1, status: 1 } },
    ).toArray()).map(x => [String(x._id), x]),
  )
  const ops = []
  console.log(`\n── 2. Withholding of ${linked.length} purchase bill(s) with a payment request ──`)
  for (const b of linked) {
    const x = expById.get(String(b.payment.expenseId))
    if (!x) continue
    const set = billWithholdingSet(x)
    // Only bills whose amounts differ (a code / rate left beside a zero amount is not a difference).
    const changed = ['vds.amount', 'tds.amount', 'netPayable'].some(path => path in set && !near(get(b, path), set[path]))
      || ('tds.higherRateApplied' in set && Boolean(b.tds?.higherRateApplied) !== set['tds.higherRateApplied'])
    if (!changed) continue
    ops.push({ updateOne: { filter: { _id: b._id, 'payment.expenseId': b.payment.expenseId }, update: { $set: set } } })
    if (ops.length <= 25) {
      console.log(`  ${(b.billNo ?? b._id).toString().padEnd(14)} VDS ${money(b.vds?.amount)} → ${money(set['vds.amount'])}, TDS ${money(b.tds?.amount)} → ${money(set['tds.amount'])}, net ${money(b.netPayable)} → ${money(set.netPayable)}`)
    }
  }
  if (ops.length > 25) console.log(`  … and ${ops.length - 25} more`)
  console.log(`  ${ops.length} bill(s) to update`)
  if (APPLY && ops.length) {
    const res = await bills.bulkWrite(ops, { ordered: false })
    console.log(`  ✓ modified ${res.modifiedCount} bill(s)`)
  }

  if (!APPLY) console.log('\nℹ  Dry run complete — nothing written. Re-run with --apply.')
  await mongoose.disconnect()
  console.log('✓ done')
}

main().catch(async (err) => {
  console.error('✗ backfill failed:', err)
  await mongoose.disconnect().catch(() => {})
  process.exit(1)
})
