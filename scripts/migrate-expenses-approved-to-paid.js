/**
 * scripts/migrate-expenses-approved-to-paid.js
 *
 * The expense lifecycle is now three-stage: PENDING → APPROVED → PAID.
 * Previously "approve" was terminal and immediately created the Transaction,
 * bumped the project budget and marked the payment settled — so those historical
 * rows are APPROVED yet already fully paid (they carry accountsTransactionId).
 * This flips them to PAID so the Accounts queue and every surface show them
 * consistently, and backfills `origin` for legacy project expenses.
 *
 * SAFETY
 *   • Only flips APPROVED docs that were already synced to a Transaction.
 *   • Dry-run by default; pass --apply to write.
 *
 * Usage:
 *   node scripts/migrate-expenses-approved-to-paid.js          # dry run
 *   node scripts/migrate-expenses-approved-to-paid.js --apply  # write
 */

import 'dotenv/config'
import mongoose from 'mongoose'

const APPLY = process.argv.includes('--apply')

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
  } else {
    console.log('Dry run only — re-run with --apply to write.')
  }

  await mongoose.disconnect()
}

main().catch(err => { console.error(err); process.exit(1) })
