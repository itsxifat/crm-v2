/**
 * scripts/migrate-withdrawals-approved-to-paid.js
 *
 * The withdrawal lifecycle now uses PAID as the single terminal "paid out" status.
 * Older rows that were fully settled were left as APPROVED (a Transaction was
 * created, assignments marked PAID, wallet adjusted — they ARE paid). This flips
 * those historical rows to PAID so every surface (Accounts filter, freelancer
 * panel, wallet) shows them consistently.
 *
 * SAFETY
 *   • Only touches WithdrawalRequest docs with status === 'APPROVED'.
 *   • Dry-run by default; pass --apply to write.
 *
 * Usage:
 *   node scripts/migrate-withdrawals-approved-to-paid.js          # dry run
 *   node scripts/migrate-withdrawals-approved-to-paid.js --apply  # write
 */

import 'dotenv/config'
import mongoose from 'mongoose'

const APPLY = process.argv.includes('--apply')

async function main() {
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI is not set')
  await mongoose.connect(uri)

  const withdrawals = mongoose.connection.collection('withdrawalrequests')
  const count = await withdrawals.countDocuments({ status: 'APPROVED' })
  console.log(`Found ${count} APPROVED withdrawal(s) to migrate to PAID.`)

  if (APPLY && count > 0) {
    const res = await withdrawals.updateMany({ status: 'APPROVED' }, { $set: { status: 'PAID' } })
    console.log(`Updated ${res.modifiedCount} row(s) → PAID.`)
  } else if (!APPLY) {
    console.log('Dry run only — re-run with --apply to write.')
  }

  await mongoose.disconnect()
}

main().catch(err => { console.error(err); process.exit(1) })
