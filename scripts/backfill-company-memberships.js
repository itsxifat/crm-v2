/**
 * scripts/backfill-company-memberships.js
 *
 * ONE-TIME MIGRATION: create an OWNER CompanyMembership for every existing
 * Client, linking it to that Client's legacy `userId`. This is the bridge from
 * the old "one Client per User" model to the new many-to-many membership model.
 *
 * SAFETY
 *   • Idempotent — uses upsert on the unique (userId, clientId) index, so
 *     re-running never creates duplicates.
 *   • Dry-run by default (prints what it would do); pass --apply to write.
 *   • Skips Clients with no userId (logs them for manual review).
 *
 * Usage:
 *   node scripts/backfill-company-memberships.js            # dry run
 *   node scripts/backfill-company-memberships.js --apply    # write memberships
 */

import 'dotenv/config'
import mongoose from 'mongoose'

const APPLY = process.argv.includes('--apply')

async function main() {
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI is not set')
  await mongoose.connect(uri)

  const clients     = mongoose.connection.collection('clients')
  const memberships = mongoose.connection.collection('companymemberships')

  const all = await clients.find({}).project({ _id: 1, userId: 1, clientCode: 1 }).toArray()
  console.log(`Found ${all.length} client(s).`)

  let created = 0, existing = 0, skipped = 0
  const now = new Date()

  for (const c of all) {
    if (!c.userId) {
      skipped++
      console.warn(`  SKIP  client ${c._id} (${c.clientCode ?? 'no code'}) — no userId`)
      continue
    }

    const filter = { userId: c.userId, clientId: c._id }
    const already = await memberships.findOne(filter)
    if (already) { existing++; continue }

    if (APPLY) {
      await memberships.updateOne(
        filter,
        {
          $set:        { status: 'ACTIVE', role: 'OWNER', updatedAt: now },
          $setOnInsert: { addedBy: null, createdAt: now, __v: 0 },
        },
        { upsert: true },
      )
    }
    created++
    console.log(`  ${APPLY ? 'CREATE' : 'WOULD CREATE'}  OWNER membership  user ${c.userId} → client ${c._id} (${c.clientCode ?? '—'})`)
  }

  console.log('\nSummary:')
  console.log(`  created:  ${created}${APPLY ? '' : ' (dry run)'}`)
  console.log(`  existing: ${existing}`)
  console.log(`  skipped:  ${skipped}`)
  if (!APPLY) console.log('\nDry run only — re-run with --apply to write.')

  await mongoose.disconnect()
}

main().catch(err => { console.error(err); process.exit(1) })
