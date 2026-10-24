/**
 * scripts/migrate-combined-invoices.js
 *
 * One-off migration for the multi-invoice-per-project + combined-invoice feature.
 *
 *   1. Drops the legacy UNIQUE index on invoices.projectId. Mongoose never
 *      removes an index it no longer declares, so without this step MongoDB
 *      keeps rejecting a project's second invoice with E11000.
 *   2. Creates a CombinedInvoice for every project that already carries two or
 *      more non-cancelled invoices.
 *
 * Run with:  npm run db:migrate-combined-invoices
 * Safe to re-run — both steps are idempotent.
 */

import 'dotenv/config'
import mongoose from 'mongoose'

const MONGODB_URI = process.env.MONGODB_URI
if (!MONGODB_URI) {
  console.error('✗ MONGODB_URI is not set (check your .env)')
  process.exit(1)
}

// Numbering must match models/CombinedInvoice.js: ENVYYMMC### (e.g. ENV2610C001).
// Month follows the business timezone (Asia/Dhaka), matching models/CombinedInvoice.js
function yymmOf(date = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Dhaka', year: '2-digit', month: '2-digit' })
    .formatToParts(date).map(p => [p.type, p.value]))
  return `${parts.year}${parts.month}`
}

function combinedNumberFor(seq, date = new Date()) {
  return `ENV${yymmOf(date)}C${String(seq).padStart(3, '0')}`
}

async function dropLegacyIndex(db) {
  const invoices = db.collection('invoices')
  let indexes
  try {
    indexes = await invoices.indexes()
  } catch {
    console.log('· invoices collection does not exist yet — nothing to drop')
    return
  }

  const legacy = indexes.filter(i => i.unique && i.key && Object.keys(i.key).join() === 'projectId')
  if (legacy.length === 0) {
    console.log('· no unique projectId index on invoices — already migrated')
    return
  }

  for (const idx of legacy) {
    await invoices.dropIndex(idx.name)
    console.log(`✓ dropped unique index "${idx.name}" on invoices.projectId`)
  }
}

async function backfillCombined(db) {
  const invoices  = db.collection('invoices')
  const projects  = db.collection('projects')
  const combineds = db.collection('combinedinvoices')

  // Projects with 2+ non-cancelled invoices, counting both the current
  // projectId field and the legacy projectIds array.
  const grouped = await invoices.aggregate([
    { $match: { status: { $ne: 'CANCELLED' } } },
    { $addFields: { _pid: { $ifNull: ['$projectId', { $arrayElemAt: ['$projectIds', 0] }] } } },
    { $match: { _pid: { $ne: null } } },
    { $group: { _id: '$_pid', count: { $sum: 1 }, clientId: { $first: '$clientId' }, currency: { $first: '$currency' } } },
    { $match: { count: { $gte: 2 } } },
  ]).toArray()

  console.log(`· ${grouped.length} project(s) qualify for a combined invoice`)
  if (grouped.length === 0) return

  const existing = await combineds
    .find({ projectId: { $in: grouped.map(g => g._id) } })
    .project({ projectId: 1 })
    .toArray()
  const have = new Set(existing.map(e => e.projectId.toString()))

  const missing = grouped.filter(g => !have.has(g._id.toString()))
  if (missing.length === 0) {
    console.log('· every qualifying project already has a combined invoice')
    return
  }

  // Continue the ENVYYMMC### sequence from whatever is already stored.
  const now  = new Date()
  const yymm = yymmOf(now)
  // Highest suffix already issued (NOT a count — a count reissues an existing
  // number after any delete and collides on the unique index), in either shape:
  // numbers issued before 2026-10 read ENV-2610C001. The model's counters (new
  // key and the old hyphenated one) are floors too, so a deleted number is never
  // reissued.
  const re = new RegExp(`^ENV-?${yymm}C(\\d+)$`)
  const usedDocs = await combineds
    .find({ combinedNumber: { $regex: re.source } })
    .project({ combinedNumber: 1 })
    .toArray()
  const counters = await db.collection('counters')
    .find({ _id: { $in: [`combinedInvoice:ENV${yymm}C`, `combinedInvoice:ENV-${yymm}C`] } })
    .toArray()
  const used = Math.max(
    usedDocs.reduce((m, d) => Math.max(m, parseInt(re.exec(d.combinedNumber)?.[1], 10) || 0), 0),
    ...counters.map(c => Number(c.seq) || 0),
  )

  const docs = []
  for (let i = 0; i < missing.length; i++) {
    const g = missing[i]
    const project = await projects.findOne({ _id: g._id }, { projection: { clientId: 1, currency: 1 } })
    const clientId = project?.clientId ?? g.clientId
    if (!clientId) {
      console.warn(`  ! skipping project ${g._id} — no client could be resolved`)
      continue
    }
    docs.push({
      combinedNumber: combinedNumberFor(used + docs.length + 1, now),
      projectId: g._id,
      clientId,
      currency:  project?.currency ?? g.currency ?? 'BDT',
      notes: null,
      terms: null,
      issuedAt:  now,
      createdBy: null,
      createdAt: now,
      updatedAt: now,
      __v: 0,
    })
  }

  if (docs.length === 0) return
  await combineds.insertMany(docs, { ordered: false })
  console.log(`✓ created ${docs.length} combined invoice(s)`)
  docs.forEach(d => console.log(`    ${d.combinedNumber}  ← project ${d.projectId}`))
}

async function main() {
  await mongoose.connect(MONGODB_URI)
  console.log('✓ connected to MongoDB\n')
  const db = mongoose.connection.db

  console.log('── 1. Drop legacy unique index ─────────────────────────────')
  await dropLegacyIndex(db)

  console.log('\n── 2. Backfill combined invoices ───────────────────────────')
  await backfillCombined(db)

  // Make sure the new indexes exist.
  await db.collection('invoices').createIndex({ projectId: 1 })
  await db.collection('combinedinvoices').createIndex({ projectId: 1 }, { unique: true })
  await db.collection('combinedinvoices').createIndex({ combinedNumber: 1 }, { unique: true, sparse: true })
  console.log('\n✓ indexes ensured')

  await mongoose.disconnect()
  console.log('✓ done')
}

main().catch(async (err) => {
  console.error('✗ migration failed:', err)
  await mongoose.disconnect().catch(() => {})
  process.exit(1)
})
