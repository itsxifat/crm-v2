/**
 * scripts/migrate-expenses-approved-to-paid.js
 *
 * The expense lifecycle is now three-stage: PENDING → APPROVED → PAID.
 * Previously "approve" was terminal and immediately created the Transaction,
 * bumped the project budget and marked the payment settled — so those historical
 * rows are APPROVED yet already fully paid (they carry accountsTransactionId).
 * This flips them to PAID so the Accounts queue and every surface show them
 * consistently, backfills `origin` for legacy project expenses, and assigns an
 * `expenseId` (EXP-YYMM-####) to any expense created before that field existed.
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

  // 3) Expenses missing `expenseId` → assign EXP-YYMM-#### in creation order.
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
      // Continue each month's numbering after any ids already present.
      const perMonth = {}
      for (const doc of idMissing) {
        const d = new Date(doc.createdAt ?? Date.now())
        const yymm = `${String(d.getFullYear()).slice(-2)}${String(d.getMonth() + 1).padStart(2, '0')}`
        if (perMonth[yymm] == null) {
          perMonth[yymm] = await expenses.countDocuments({ expenseId: { $regex: `^EXP-${yymm}-` } })
        }
        perMonth[yymm] += 1
        const expenseId = `EXP-${yymm}-${String(perMonth[yymm]).padStart(4, '0')}`
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
