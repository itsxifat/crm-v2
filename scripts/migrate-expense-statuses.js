/**
 * scripts/migrate-expense-statuses.js
 *
 * The expense lifecycle changed to: PENDING → PAID → AUTHORIZED (APPROVED removed).
 *   • Old PAID  (ledger entry + authorized scan) → AUTHORIZED  (fully done).
 *   • Old APPROVED (payment recorded, awaiting authorization) → PAID.
 *
 * Order matters: PAID→AUTHORIZED runs first so freshly-renamed APPROVED→PAID
 * rows are not swept into AUTHORIZED.
 *
 * NOTE: under the previous flow the ledger Transaction was created at the final
 * step, so some old APPROVED rows may not have an accountsTransactionId yet. This
 * script reports how many — those few rows can be re-checked or re-entered.
 *
 * SAFETY: dry-run by default; pass --apply (or `npm run db:migrate-expense-statuses -- --apply`).
 */

import 'dotenv/config'
import mongoose from 'mongoose'

const APPLY = process.argv.includes('--apply') || process.env.npm_config_apply === 'true'

async function main() {
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI is not set')
  await mongoose.connect(uri)

  const expenses = mongoose.connection.collection('projectexpenses')

  const paidCount = await expenses.countDocuments({ status: 'PAID' })
  const apprCount = await expenses.countDocuments({ status: 'APPROVED' })
  const apprNoTxn = await expenses.countDocuments({ status: 'APPROVED', accountsTransactionId: { $in: [null, undefined] } })

  console.log(`PAID → AUTHORIZED:   ${paidCount} row(s)`)
  console.log(`APPROVED → PAID:     ${apprCount} row(s)`)
  if (apprNoTxn > 0) console.log(`  ⚠ ${apprNoTxn} of those have no ledger entry yet (were pre-ledger) — re-check these in Finance.`)

  if (APPLY) {
    // 1) PAID → AUTHORIZED (settled rows with a ledger entry). Set authorizedAt from paidAt.
    const r1 = await expenses.updateMany(
      { status: 'PAID' },
      [{ $set: { status: 'AUTHORIZED', authorizedAt: { $ifNull: ['$paidAt', '$updatedAt'] }, authorizedBy: '$paidBy' } }],
    )
    console.log(`Updated ${r1.modifiedCount} row(s) → AUTHORIZED.`)

    // 2) APPROVED → PAID (payment already recorded; paidAt from reviewedAt).
    const r2 = await expenses.updateMany(
      { status: 'APPROVED' },
      [{ $set: { status: 'PAID', paidAt: { $ifNull: ['$paidAt', '$reviewedAt', '$updatedAt'] }, paidBy: { $ifNull: ['$paidBy', '$reviewedBy'] } } }],
    )
    console.log(`Updated ${r2.modifiedCount} row(s) → PAID.`)
  } else {
    console.log('Dry run only — re-run with --apply to write.')
  }

  await mongoose.disconnect()
}

main().catch(err => { console.error(err); process.exit(1) })
