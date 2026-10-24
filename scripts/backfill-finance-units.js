/**
 * scripts/backfill-finance-units.js
 *
 * Every money record now carries a business unit (lib/units.js):
 * 'VENTURE:<id>' · 'PRODUCT:<id>' · 'COMPANY', or null = Unassigned. New rows get
 * one when they are written; this script places the rows saved before that.
 * Only records whose unit is still null (or missing) are touched.
 *
 *   1. ProjectExpense.unit — its project's venture, else ProjectExpense.venture;
 *      salary: the employee's venture (SalarySlip / payee), a freelancer's salary
 *      COMPANY; purchase bills and asset repairs COMPANY.
 *   2. Invoice.unit — its project's venture (projectId, else projectIds[0]).
 *      Standalone invoices stay null (their settlements become Unassigned below).
 *   3. Transaction.unit, first rule that gives a unit:
 *        reversal          → the unit of the row it reverses (null stays null)
 *        expense payment   → the expense's unit (step 1; linked by
 *                            accountsTransactionId or reference = expense id)
 *        projectId         → the project's venture
 *        salary            → employee venture (paidToEmployeeId, category Salary);
 *                            freelancer salary (SalaryPayout.transactionId) COMPANY
 *        invoiceId         → the invoice's unit (step 2)
 *        COMPANY           → transfers (legs and fees), capital, drawings, loans,
 *                            adjustments, tax deposits / refunds / interest &
 *                            penalties, purchases and assets (bill, asset, sale,
 *                            disposal), depreciation, bank charges, interest
 *      Anything else stays null (Unassigned) and is listed by category so it can
 *      be re-tagged on Accounts → Transactions ("Change venture / product").
 *   4. Ensures the index { unit: 1, date: 1 } on transactions.
 *
 * A salary whose employee has no venture stays null: set the venture on the
 * employee and run this again. Rows are matched on `unit: null` when written, so
 * a unit set in the meantime is never overwritten.
 *
 * DRY RUN BY DEFAULT. Pass --apply to write:
 *     node scripts/backfill-finance-units.js --apply
 *     npm run db:backfill-finance-units -- --apply
 *
 * Safe to re-run.
 */

import 'dotenv/config'
import mongoose from 'mongoose'
import { COMPANY_UNIT, parseUnit, productUnit, ventureUnit } from '../lib/units.js'

const APPLY = process.argv.includes('--apply') || process.env.npm_config_apply === 'true'
const BATCH = 1000

const str = (v) => (v === null || v === undefined ? null : (String(v).trim() || null))
const key = (v) => (v === null || v === undefined ? null : String(v?._id ?? v))
const num = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }
const money = (v) => (Math.round(num(v) * 100) / 100).toLocaleString('en-BD', { minimumFractionDigits: 2 })

// Values still in the old `enc:v1:` ciphertext (scripts/decrypt-migrate.js) are no venture id.
const isCipher = (v) => typeof v === 'string' && v.startsWith('enc:')
const ventureOf = (venture) => (isCipher(venture) ? null : ventureUnit(venture))

// Rows that belong to the company as a whole (accounts, tax, assets are company-wide).
const TAX_KINDS = new Set(['TAX_PAYMENT', 'TAX_REFUND'])
const TAX_CATEGORIES = new Set(['Tax Interest & Penalties'])
const ASSET_KINDS = new Set(['ASSET_PURCHASE', 'ASSET_SALE'])
const DEPRECIATION_CATEGORIES = new Set(['Depreciation', 'Asset Impairment', 'Amortisation', 'Amortization'])
const FINANCING_KINDS = new Set(['CAPITAL', 'DRAWING', 'LOAN', 'ADJUSTMENT'])
// Bank / wallet charges and interest (a loan instalment's interest part included).
const BANK_CATEGORIES = new Set(['Bank Charges', 'Interest Expense', 'Interest Income'])
const BANK_MOVEMENTS = new Set(['BANK_CHARGE', 'INTEREST_INCOME', 'LOAN_REPAYMENT'])
const REPAIRS_CATEGORY = 'Repairs & Maintenance'
const ASSET_REPAIR_TITLE = /^\[[^\]]+\] repair\b/

/** Tally helper: Map<label, { count, bdt }>. */
function tally() {
  const m = new Map()
  return {
    add(label, bdt = 0) { const r = m.get(label) ?? { count: 0, bdt: 0 }; r.count++; r.bdt += num(bdt); m.set(label, r) },
    rows() { return [...m.entries()].sort((a, b) => b[1].count - a[1].count) },
    get size() { return m.size },
  }
}

function printTally(title, t, { withMoney = false } = {}) {
  if (!t.size) return
  console.log(title)
  for (const [label, r] of t.rows()) console.log(`  ${String(r.count).padStart(6)}  ${label}${withMoney ? `  (BDT ${money(r.bdt)})` : ''}`)
}

async function setUnits(collection, plan, label) {
  if (!plan.length) return
  let modified = 0
  for (let i = 0; i < plan.length; i += BATCH) {
    const ops = plan.slice(i, i + BATCH).map(p => ({
      updateOne: { filter: { _id: p._id, unit: null }, update: { $set: { unit: p.unit } } },
    }))
    const res = await collection.bulkWrite(ops, { ordered: false })
    modified += res.modifiedCount
  }
  console.log(`Set unit on ${modified} ${label}.`)
}

async function main() {
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI is not set')
  await mongoose.connect(uri)
  const db = mongoose.connection.db
  console.log(`Database: ${db.databaseName}${APPLY ? '' : ' (dry run)'}`)

  // ── Reference data ─────────────────────────────────────────────────────────
  const setting = await db.collection('settings').findOne({ key: 'crm_config' })
  let config = {}
  try { config = setting?.value ? JSON.parse(setting.value) : {} } catch { config = {} }
  const known = new Set([
    ...(config.ventures ?? []).map(v => ventureUnit(v?.id)),
    ...(config.products ?? []).map(p => productUnit(p?.id)),
    COMPANY_UNIT,
  ].filter(Boolean))

  const projectUnit = new Map()
  for (const p of await db.collection('projects').find({}, { projection: { venture: 1 } }).toArray()) {
    projectUnit.set(key(p._id), ventureOf(p.venture))
  }
  const employeeUnit = new Map()
  let cipherEmployees = 0
  for (const e of await db.collection('employees').find({}, { projection: { venture: 1 } }).toArray()) {
    if (isCipher(e.venture)) cipherEmployees++
    employeeUnit.set(key(e._id), ventureOf(e.venture))
  }
  const slipEmployee = new Map()
  for (const s of await db.collection('salaryslips').find({}, { projection: { employeeId: 1 } }).toArray()) {
    slipEmployee.set(key(s._id), key(s.employeeId))
  }
  const freelancerSalaryTx = new Set(
    (await db.collection('salarypayouts').find({ transactionId: { $ne: null } }, { projection: { transactionId: 1 } }).toArray())
      .map(p => key(p.transactionId)),
  )
  const projectOf = (id) => (id ? projectUnit.get(key(id)) ?? null : null)

  /** { unit, reason } for a salary paid to an employee (null unit: employee has no venture). */
  const employeeSalary = (employeeId) => {
    const unit = employeeUnit.get(key(employeeId)) ?? null
    return { unit, reason: unit ? 'salary (employee venture)' : null }
  }

  // ── 1. ProjectExpense.unit ─────────────────────────────────────────────────
  const expenses = await db.collection('projectexpenses').find({}, {
    projection: {
      expenseId: 1, projectId: 1, venture: 1, unit: 1, origin: 1, category: 1, title: 1, purchaseBillId: 1,
      employeeSalarySlipId: 1, salaryPayoutId: 1, paidToEmployeeId: 1, freelancerId: 1, accountsTransactionId: 1,
    },
  }).toArray()

  const expenseById = new Map()
  const expenseByTx = new Map()
  const expensePlan = []
  const expenseReasons = tally()
  const expenseLeft = tally()

  function expenseUnit(x) {
    const fromProject = projectOf(x.projectId)
    if (fromProject) return { unit: fromProject, reason: 'project venture' }
    const own = ventureOf(str(x.venture))
    if (own) return { unit: own, reason: 'expense venture' }
    if (x.origin === 'SALARY' || x.employeeSalarySlipId || x.salaryPayoutId) {
      if (x.salaryPayoutId || (x.freelancerId && !x.paidToEmployeeId)) return { unit: COMPANY_UNIT, reason: 'freelancer salary' }
      const employeeId = slipEmployee.get(key(x.employeeSalarySlipId)) ?? key(x.paidToEmployeeId)
      const s = employeeSalary(employeeId)
      return s.unit ? s : { unit: null, reason: 'salary: employee has no venture' }
    }
    if (x.purchaseBillId) return { unit: COMPANY_UNIT, reason: 'purchase bill' }
    if (x.category === REPAIRS_CATEGORY && ASSET_REPAIR_TITLE.test(String(x.title ?? ''))) return { unit: COMPANY_UNIT, reason: 'asset repair' }
    return { unit: null, reason: null }
  }

  for (const x of expenses) {
    let unit = str(x.unit)
    if (!unit) {
      const r = expenseUnit(x)
      unit = r.unit
      if (unit) { expensePlan.push({ _id: x._id, unit }); expenseReasons.add(r.reason) }
      else expenseLeft.add(r.reason ?? `${x.origin ?? 'OTHER'} · ${x.category ?? '(no category)'}`)
    }
    const entry = { unit, origin: x.origin }
    expenseById.set(key(x._id), entry)
    if (x.accountsTransactionId) expenseByTx.set(key(x.accountsTransactionId), entry)
  }

  console.log(`\nExpenses: ${expensePlan.length} to place, ${expenseLeft.rows().reduce((s, [, r]) => s + r.count, 0)} left Unassigned`)
  printTally(' placed by:', expenseReasons)
  printTally(' left Unassigned (origin · category):', expenseLeft)

  // ── 2. Invoice.unit ────────────────────────────────────────────────────────
  const invoices = await db.collection('invoices').find({}, { projection: { invoiceNumber: 1, projectId: 1, projectIds: 1, unit: 1 } }).toArray()
  const invoiceUnit = new Map()
  const invoicePlan = []
  const standalone = []
  for (const inv of invoices) {
    let unit = str(inv.unit)
    if (!unit) {
      unit = projectOf(inv.projectId ?? inv.projectIds?.[0])
      if (unit) invoicePlan.push({ _id: inv._id, unit })
      else standalone.push(inv.invoiceNumber ?? key(inv._id))
    }
    invoiceUnit.set(key(inv._id), unit)
  }
  console.log(`\nInvoices: ${invoicePlan.length} to place (project venture), ${standalone.length} left Unassigned (no project with a venture)`)
  if (standalone.length) console.log(`  ${standalone.slice(0, 20).join(', ')}${standalone.length > 20 ? `, … (+${standalone.length - 20})` : ''}`)

  // ── 3. Transaction.unit ────────────────────────────────────────────────────
  const rows = await db.collection('transactions').find({ unit: null }, {
    projection: {
      txnId: 1, type: 1, kind: 1, category: 1, amount: 1, amountBDT: 1, plAmountBDT: 1, currency: 1, date: 1,
      projectId: 1, invoiceId: 1, paidToEmployeeId: 1, freelancerId: 1, reference: 1, transferId: 1,
      purchaseBillId: 1, assetId: 1, movementKind: 1, reversalOf: 1,
    },
  }).toArray()

  function companyReason(tx) {
    const kind = tx.kind || 'OPERATING'
    if (kind === 'TRANSFER' || tx.transferId) return 'transfers'
    if (TAX_KINDS.has(kind) || TAX_CATEGORIES.has(tx.category)) return 'tax'
    if (ASSET_KINDS.has(kind) || tx.purchaseBillId || tx.assetId) return 'purchases & assets'
    if (DEPRECIATION_CATEGORIES.has(tx.category)) return 'depreciation'
    if (FINANCING_KINDS.has(kind)) return 'capital, drawings, loans & adjustments'
    if (BANK_CATEGORIES.has(tx.category) || BANK_MOVEMENTS.has(tx.movementKind)) return 'bank charges & interest'
    return null
  }

  function txUnit(tx) {
    const expense = expenseByTx.get(key(tx._id))
      ?? (tx.type === 'EXPENSE' && /^[0-9a-f]{24}$/i.test(String(tx.reference ?? '')) ? expenseById.get(String(tx.reference)) : null)
    if (expense?.unit) return { unit: expense.unit, reason: 'expense' }
    const fromProject = projectOf(tx.projectId)
    if (fromProject) return { unit: fromProject, reason: 'project venture' }
    if (freelancerSalaryTx.has(key(tx._id))) return { unit: COMPANY_UNIT, reason: 'freelancer salary' }
    if (tx.category === 'Salary' && tx.paidToEmployeeId) {
      const s = employeeSalary(tx.paidToEmployeeId)
      return s.unit ? s : { unit: null, reason: 'salary: employee has no venture' }
    }
    if (tx.invoiceId) {
      const unit = invoiceUnit.get(key(tx.invoiceId)) ?? null
      if (unit) return { unit, reason: 'invoice' }
    }
    const company = companyReason(tx)
    if (company) return { unit: COMPANY_UNIT, reason: `Company: ${company}` }
    if (expense?.origin === 'SALARY') return { unit: null, reason: 'salary: employee has no venture' }
    return { unit: null, reason: null }
  }

  const planned = new Map()            // tx id → unit (this run)
  const txPlan = []
  const txReasons = tally()
  const txLeft = tally()
  const plOf = (tx) => tx.plAmountBDT ?? tx.amountBDT ?? ((tx.currency || 'BDT') === 'BDT' ? tx.amount : 0)
  const leave = (tx, reason) => txLeft.add(reason ?? `${tx.type} · ${tx.category ?? '(no category)'}${tx.kind && tx.kind !== 'OPERATING' ? ` [${tx.kind}]` : ''}`, plOf(tx))

  const originals = rows.filter(r => !r.reversalOf)
  const reversals = rows.filter(r => r.reversalOf)
  for (const tx of originals) {
    const r = txUnit(tx)
    if (r.unit) { planned.set(key(tx._id), r.unit); txPlan.push({ _id: tx._id, unit: r.unit }); txReasons.add(r.reason, plOf(tx)) }
    else leave(tx, r.reason)
  }

  // A reversal follows the row it reverses, so the pair nets to zero in one unit.
  const outside = reversals.map(r => r.reversalOf).filter(id => !planned.has(key(id)))
  const stored = new Map(
    (outside.length ? await db.collection('transactions').find({ _id: { $in: outside } }, { projection: { unit: 1 } }).toArray() : [])
      .map(o => [key(o._id), str(o.unit)]),
  )
  for (const tx of reversals) {
    const unit = planned.get(key(tx.reversalOf)) ?? stored.get(key(tx.reversalOf)) ?? null
    if (unit) { txPlan.push({ _id: tx._id, unit }); txReasons.add('reversal (as the reversed row)', plOf(tx)) }
    else leave(tx, 'reversal of an Unassigned row')
  }

  const leftCount = txLeft.rows().reduce((s, [, r]) => s + r.count, 0)
  console.log(`\nTransactions without a unit: ${rows.length} — ${txPlan.length} to place, ${leftCount} left Unassigned`)
  printTally(' placed by (P&L BDT):', txReasons, { withMoney: true })
  printTally(' left Unassigned (type · category, P&L BDT) — re-tag on Accounts → Transactions:', txLeft, { withMoney: true })

  const byUnit = tally()
  for (const p of [...expensePlan, ...invoicePlan, ...txPlan]) byUnit.add(p.unit)
  printTally('\nUnits given (expenses + invoices + transactions):', byUnit)

  // ── Warnings ───────────────────────────────────────────────────────────────
  const unknown = byUnit.rows().filter(([u]) => parseUnit(u) && !known.has(u))
  if (unknown.length) {
    console.log('\n⚠ Not in Configuration → Ventures / Products (they still report, under their id):')
    for (const [u, r] of unknown) console.log(`  ${u}  (${r.count} record(s))`)
  }
  if (cipherEmployees) {
    console.log(`\n⚠ ${cipherEmployees} employee(s) still have an encrypted venture (enc:v1:…): run npm run db:decrypt, then this script again.`)
  }

  // ── Write ──────────────────────────────────────────────────────────────────
  if (APPLY) {
    console.log('')
    await setUnits(db.collection('projectexpenses'), expensePlan, 'expense(s)')
    await setUnits(db.collection('invoices'), invoicePlan, 'invoice(s)')
    await setUnits(db.collection('transactions'), txPlan, 'transaction(s)')
    await db.collection('transactions').createIndex({ unit: 1, date: 1 })
    console.log('Index unit_1_date_1 is in place.')
  } else {
    console.log('\nDry run only — re-run with --apply to write.')
  }

  await mongoose.disconnect()
}

main().catch(async (err) => {
  console.error(err)
  await mongoose.disconnect().catch(() => {})
  process.exit(1)
})
