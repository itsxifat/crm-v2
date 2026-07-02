/**
 * scripts/drop-collections.js
 *
 * Drops every collection in the target database EXCEPT the ones in KEEP.
 * Intended for wiping a demo/staging DB back to just leads + configuration.
 *
 * ⚠ DESTRUCTIVE & IRREVERSIBLE — take a backup first.
 *
 * SAFETY
 *   • Dry-run by default: lists every collection marked KEEP / DROP with counts.
 *   • Only drops when you pass --apply.
 *
 * Usage:
 *   node scripts/drop-collections.js                 # dry run (shows plan)
 *   node scripts/drop-collections.js --apply         # actually drop
 *   npm run db:drop-collections -- --apply           # (note the --)
 */

import 'dotenv/config'
import mongoose from 'mongoose'

// Collections to PRESERVE. `settings` holds the crm_config document + all config.
const KEEP = new Set(['leads', 'settings'])

const APPLY = process.argv.includes('--apply') || process.env.npm_config_apply === 'true'

async function main() {
  const uri = process.env.MONGODB_URI
  if (!uri) throw new Error('MONGODB_URI is not set')
  await mongoose.connect(uri, { bufferCommands: false })
  const db = mongoose.connection

  console.log(`\nDatabase: ${db.name}   mode: ${APPLY ? 'APPLY (dropping)' : 'DRY RUN'}\n`)

  const cols  = await db.db.listCollections().toArray()
  const names = cols.map(c => c.name).filter(n => !n.startsWith('system.')).sort()

  for (const name of names) {
    const count = await db.collection(name).countDocuments()
    console.log(`  ${KEEP.has(name) ? 'KEEP ' : 'DROP '} ${name.padEnd(24)} ${count} docs`)
  }

  if (APPLY) {
    let dropped = 0
    for (const name of names) {
      if (KEEP.has(name)) continue
      await db.collection(name).drop().catch(e => { if (e.codeName !== 'NamespaceNotFound') throw e })
      dropped++
    }
    console.log(`\nDropped ${dropped} collection(s). Kept: ${[...KEEP].join(', ')}.\n`)
  } else {
    console.log('\nDry run only — re-run with --apply to drop the DROP-marked collections.\n')
  }

  await mongoose.disconnect()
  process.exit(0)
}

main().catch(err => { console.error('Failed:', err); process.exit(1) })
