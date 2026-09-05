/**
 * scripts/migrate-drop-project-discount.js
 *
 * Projects no longer carry a separate contract value and discount. `budget` IS
 * the project value — the net amount the client pays.
 *
 *   1. Fold any existing discount into the value so nothing changes in real
 *      terms:  budget = max(0, budget - discount), then drop the field.
 *      (A project sold at 100,000 with a 10,000 discount becomes a 90,000
 *      project — the same net value it already displayed.)
 *   2. Apply the new floor rule: a project's value can never sit below what the
 *      client has actually paid. Any project already paid above its value — the
 *      case that happens when extra invoices were raised and settled — is
 *      raised to the amount paid.
 *
 * DRY RUN BY DEFAULT. Pass --apply to write:
 *     npm run db:migrate-drop-project-discount -- --apply
 *
 * Safe to re-run.
 */

import 'dotenv/config'
import mongoose from 'mongoose'

const APPLY = process.argv.includes('--apply')

const MONGODB_URI = process.env.MONGODB_URI
if (!MONGODB_URI) {
  console.error('✗ MONGODB_URI is not set (check your .env)')
  process.exit(1)
}

const num    = (v) => { const x = Number(v); return Number.isFinite(x) ? x : 0 }
const round2 = (v) => Math.round(num(v) * 100) / 100
const money  = (v) => round2(v).toLocaleString('en-BD', { minimumFractionDigits: 2 })

async function main() {
  await mongoose.connect(MONGODB_URI)
  const db = mongoose.connection.db
  console.log(`✓ connected to ${db.databaseName}`)
  console.log(APPLY ? '⚠  APPLY MODE — changes will be written\n' : 'ℹ  DRY RUN — pass --apply to write\n')

  const projects = db.collection('projects')
  const all = await projects
    .find({}, { projection: { projectCode: 1, name: 1, budget: 1, discount: 1, paidAmount: 1 } })
    .toArray()

  console.log(`· ${all.length} project(s) found\n`)

  const folded = []
  const raised = []
  const ops    = []

  for (const p of all) {
    const discount = num(p.discount)
    const paid     = num(p.paidAmount)
    let   value    = num(p.budget)
    const before   = value

    // 1. Fold the discount into the value.
    if (discount > 0) {
      value = Math.max(0, round2(value - discount))
      folded.push({ p, before, discount, after: value })
    }

    // 2. Floor the value at what has actually been paid.
    if (paid > value + 0.01) {
      raised.push({ p, from: value, to: round2(paid) })
      value = round2(paid)
    }

    const set = {}
    if (round2(value) !== round2(before)) set.budget = round2(value)

    // The field goes away whether or not it held a value.
    const update = {}
    if (Object.keys(set).length) update.$set = set
    if (p.discount !== undefined) update.$unset = { discount: '' }
    if (Object.keys(update).length) ops.push({ updateOne: { filter: { _id: p._id }, update } })
  }

  console.log(`── 1. Discount folded into project value (${folded.length}) ──`)
  if (folded.length === 0) console.log('  (none carried a discount)')
  folded.slice(0, 25).forEach(f =>
    console.log(`  ${(f.p.projectCode ?? f.p._id).toString().padEnd(14)} ${money(f.before)} − ${money(f.discount)} → ${money(f.after)}`))
  if (folded.length > 25) console.log(`  … and ${folded.length - 25} more`)

  console.log(`\n── 2. Value raised to amount already paid (${raised.length}) ──`)
  if (raised.length === 0) console.log('  (no project is paid above its value)')
  raised.slice(0, 25).forEach(r =>
    console.log(`  ${(r.p.projectCode ?? r.p._id).toString().padEnd(14)} ${money(r.from)} → ${money(r.to)}`))
  if (raised.length > 25) console.log(`  … and ${raised.length - 25} more`)

  console.log(`\n── ${ops.length} project document(s) to update ──`)

  if (!APPLY) {
    console.log('\nℹ  Dry run complete — nothing written. Re-run with --apply.')
    await mongoose.disconnect()
    return
  }

  if (ops.length > 0) {
    const res = await projects.bulkWrite(ops, { ordered: false })
    console.log(`✓ modified ${res.modifiedCount} project(s)`)
  }

  const leftover = await projects.countDocuments({ discount: { $exists: true } })
  console.log(leftover === 0
    ? '✓ discount field removed from every project'
    : `✗ ${leftover} project(s) still carry a discount field`)

  await mongoose.disconnect()
  console.log('✓ done')
}

main().catch(async (err) => {
  console.error('✗ migration failed:', err)
  await mongoose.disconnect().catch(() => {})
  process.exit(1)
})
