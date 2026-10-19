/**
 * scripts/migrate-tax-challan-keys.js
 *
 * One ACTIVE deposit row per treasury challan and type is now enforced by the
 * partial unique index `uniq_active_deposit_challan` on TaxEntry { entryType,
 * challanKey } (challanKey = normalised deposit.challanNo, lib/tax/challanKey.js).
 * Rows saved before the field existed have no key, so the index does not see them.
 *
 *   1. Backfills challanKey on non-opening TDS_DEPOSIT / VAT_PAYMENT / ADVANCE_TAX
 *      rows. Where ACTIVE rows already share a challan, only the oldest is keyed;
 *      the others are REPORTED so they can be checked and voided by hand.
 *   2. Ensures the unique index exists.
 *   3. Backfills `instalment` on ADVANCE_TAX rows from their "Instalment N of 4"
 *      note (the tax dashboard reads the note as a fallback, so this is optional).
 *
 * SAFETY: dry-run by default; pass --apply to write.
 *   node scripts/migrate-tax-challan-keys.js [--apply]
 */

import 'dotenv/config'
import mongoose from 'mongoose'
import { challanKeyOf } from '../lib/tax/challanKey.js'

const APPLY = process.argv.includes('--apply') || process.env.npm_config_apply === 'true'
const TYPES = ['TDS_DEPOSIT', 'VAT_PAYMENT', 'ADVANCE_TAX']

async function main() {
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI is not set')
  await mongoose.connect(uri)
  const entries = mongoose.connection.collection('taxentries')

  // ── 1. challanKey ──────────────────────────────────────────────────────────
  const rows = await entries.find(
    { entryType: { $in: TYPES }, isOpening: { $ne: true }, $or: [{ challanKey: { $exists: false } }, { challanKey: null }] },
    { projection: { entryNo: 1, entryType: 1, status: 1, 'deposit.challanNo': 1, createdAt: 1 } },
  ).sort({ createdAt: 1, _id: 1 }).toArray()

  // Keys already taken by keyed ACTIVE rows (saved after the change).
  const taken = new Set((await entries.find(
    { entryType: { $in: TYPES }, status: 'ACTIVE', challanKey: { $type: 'string' } },
    { projection: { entryType: 1, challanKey: 1 } },
  ).toArray()).map(r => `${r.entryType}|${r.challanKey}`))

  const toKey = []
  const duplicates = []
  for (const r of rows) {
    const key = challanKeyOf(r.deposit?.challanNo)
    if (!key) continue
    if (r.status === 'ACTIVE') {
      const k = `${r.entryType}|${key}`
      if (taken.has(k)) { duplicates.push({ ...r, key }); continue }
      taken.add(k)
    }
    toKey.push({ _id: r._id, key })
  }

  console.log(`challanKey to backfill: ${toKey.length} row(s)`)
  if (duplicates.length) {
    console.log(`⚠ ${duplicates.length} ACTIVE row(s) repeat a challan already recorded — left unkeyed; check and void them by hand:`)
    for (const d of duplicates) console.log(`  ${d.entryNo}  ${d.entryType}  challan "${d.deposit?.challanNo}" (key ${d.key})`)
  }

  // ── 3. instalment (ADVANCE_TAX) ────────────────────────────────────────────
  const adv = await entries.find(
    { entryType: 'ADVANCE_TAX', $or: [{ instalment: { $exists: false } }, { instalment: null }], notes: { $regex: '\\bInstalment [1-4] of 4\\b' } },
    { projection: { notes: 1 } },
  ).toArray()
  const instalments = adv
    .map(r => ({ _id: r._id, n: Number(/\bInstalment ([1-4]) of 4\b/.exec(r.notes ?? '')?.[1]) || null }))
    .filter(r => r.n)
  console.log(`instalment to backfill from notes: ${instalments.length} advance-tax row(s)`)

  if (APPLY) {
    if (toKey.length) {
      const res = await entries.bulkWrite(toKey.map(r => ({ updateOne: { filter: { _id: r._id }, update: { $set: { challanKey: r.key } } } })), { ordered: false })
      console.log(`Set challanKey on ${res.modifiedCount} row(s).`)
    }
    await entries.createIndex(
      { entryType: 1, challanKey: 1 },
      { unique: true, name: 'uniq_active_deposit_challan', partialFilterExpression: { status: 'ACTIVE', challanKey: { $type: 'string' } } },
    )
    console.log('Index uniq_active_deposit_challan is in place.')
    if (instalments.length) {
      const res = await entries.bulkWrite(instalments.map(r => ({ updateOne: { filter: { _id: r._id }, update: { $set: { instalment: r.n } } } })), { ordered: false })
      console.log(`Set instalment on ${res.modifiedCount} row(s).`)
    }
  } else {
    console.log('Dry run only — re-run with --apply to write.')
  }

  await mongoose.disconnect()
}

main().catch(async (err) => {
  console.error(err)
  await mongoose.disconnect().catch(() => {})
  process.exit(1)
})
