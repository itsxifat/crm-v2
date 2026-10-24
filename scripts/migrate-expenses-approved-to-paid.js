/**
 * scripts/migrate-expenses-approved-to-paid.js
 *
 * The expense lifecycle is now three-stage: PENDING → APPROVED → PAID.
 * Previously "approve" was terminal and immediately created the Transaction,
 * bumped the project budget and marked the payment settled — so those historical
 * rows are APPROVED yet already fully paid (they carry accountsTransactionId).
 * This flips them to PAID so the Accounts queue and every surface show them
 * consistently, backfills `origin` for legacy project expenses, and assigns an
 * `expenseId` (EXPYYMM####, e.g. EXP26100001) to any expense created before that
 * field existed.
 *
 * SAFETY
 *   • Only flips APPROVED docs that were already synced to a Transaction.
 *   • Dry-run by default; pass --apply to write.
 *
 * Usage:
 *   node scripts/migrate-expenses-approved-to-paid.js          # dry run
 *   node scripts/migrate-expenses-approved-to-paid.js --apply  # write
 *   npm run db:migrate-expenses -- --apply                     # write (note the --)
 */

import 'dotenv/config'
import mongoose from 'mongoose'

// Accept --apply as a direct arg, or via npm (which turns `npm run … --apply`
// into npm_config_apply rather than passing it through to the script).
const APPLY = process.argv.includes('--apply') || process.env.npm_config_apply === 'true'

async function main() {
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI is not set')
  await mongoose.connect(uri)

  const expenses = mongoose.connection.collection('projectexpenses')

  // 1) Already-settled APPROVED rows → PAID (paidAt from reviewedAt).
  const paidFilter = { status: 'APPROVED', accountsTransactionId: { $ne: null } }
  const paidCount  = await expenses.countDocuments(paidFilter)
  console.log(`Found ${paidCount} settled APPROVED expense(s) to migrate to PAID.`)

  // 2) Legacy project expenses missing `origin` → PROJECT.
  const originFilter = { projectId: { $ne: null }, origin: { $in: [null, undefined] } }
  const originCount  = await expenses.countDocuments(originFilter)
  console.log(`Found ${originCount} legacy project expense(s) missing origin.`)

  // 3) Expenses missing `expenseId` → assign EXPYYMM#### in creation order.
  const idFilter  = { expenseId: { $in: [null, undefined] } }
  const idMissing = await expenses.find(idFilter).sort({ createdAt: 1 }).project({ _id: 1, createdAt: 1 }).toArray()
  console.log(`Found ${idMissing.length} expense(s) missing an expense id.`)

  if (APPLY) {
    if (paidCount > 0) {
      const res = await expenses.updateMany(paidFilter, [
        { $set: { status: 'PAID', paidAt: { $ifNull: ['$reviewedAt', '$updatedAt'] }, paidBy: '$reviewedBy' } },
      ])
      console.log(`Updated ${res.modifiedCount} row(s) → PAID.`)
    }
    if (originCount > 0) {
      const res = await expenses.updateMany(originFilter, { $set: { origin: 'PROJECT' } })
      console.log(`Backfilled origin=PROJECT on ${res.modifiedCount} row(s).`)
    }
    if (idMissing.length > 0) {
      // Continue each month's numbering after any ids already present, through the
      // same counter as ProjectExpense.nextNumber (projectExpense:expenseId:EXPYYMM),
      // floored at the highest id in either shape (EXP26100001 / EXP-2610-0001, NOT
      // a count — a count reissues an id after a delete) and at the old hyphenated
      // counter key.
      const counters = mongoose.connection.collection('counters')
      const floors = {}
      for (const doc of idMissing) {
        const d = new Date(doc.createdAt ?? Date.now())
        const yymm = `${String(d.getFullYear()).slice(-2)}${String(d.getMonth() + 1).padStart(2, '0')}`
        if (floors[yymm] == null) {
          const re = new RegExp(`^EXP-?${yymm}-?(\\d{4,})$`)
          const used = await expenses.find({ expenseId: { $regex: re.source } }).project({ expenseId: 1 }).toArray()
          const legacy = await counters.findOne({ _id: `projectExpense:expenseId:EXP-${yymm}-` })
          floors[yymm] = Math.max(
            used.reduce((m, r) => Math.max(m, parseInt(re.exec(r.expenseId)?.[1], 10) || 0), 0),
            Number(legacy?.seq) || 0,
          )
        }
        const res = await counters.findOneAndUpdate(
          { _id: `projectExpense:expenseId:EXP${yymm}` },
          [{ $set: { seq: { $add: [{ $max: [{ $ifNull: ['$seq', 0] }, floors[yymm]] }, 1] } } }],
          { upsert: true, returnDocument: 'after' },
        )
        const seq = (res?.seq !== undefined ? res : res?.value).seq
        const expenseId = `EXP${yymm}${String(seq).padStart(4, '0')}`
        await expenses.updateOne({ _id: doc._id }, { $set: { expenseId } })
      }
      console.log(`Assigned expense ids to ${idMissing.length} row(s).`)
    }
  } else {
    console.log('Dry run only — re-run with --apply to write.')
  }

  await mongoose.disconnect()
}

main().catch(err => { console.error(err); process.exit(1) })
