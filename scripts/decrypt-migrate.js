/**
 * scripts/decrypt-migrate.js
 *
 * ONE-TIME MIGRATION: decrypt every encrypted field back to plaintext, in place.
 *
 * Why: we are removing application-level field encryption. The data already in
 * the database is stored as `enc:v1:…` ciphertext. This script reads each
 * document with the NATIVE MongoDB driver (so the Mongoose encryption hooks do
 * NOT re-encrypt on write), decrypts every configured field using the existing
 * key material, and writes the plaintext back.
 *
 * SAFETY
 *   • Idempotent — only values starting with `enc:v1:` are touched; already-
 *     plaintext values are skipped, so it is safe to re-run.
 *   • Dry-run by default reporting — pass nothing to see counts; pass --apply to write.
 *   • Run this BEFORE removing ENCRYPTION_MASTER_KEY / ENCRYPTION_HMAC_KEY from
 *     the environment (it needs them to decrypt).
 *   • TAKE A DATABASE BACKUP FIRST.
 *
 * RECOMMENDED SEQUENCE (zero-/low-downtime)
 *   1. Back up the database.
 *   2. node scripts/decrypt-migrate.js            # dry run — review the report
 *   3. node scripts/decrypt-migrate.js --apply    # decrypt in place
 *   4. Deploy the encryption-removed code.
 *   5. node scripts/decrypt-migrate.js --apply    # final pass: catches any docs
 *                                                 # the old code re-encrypted
 *                                                 # during the deploy window.
 *   6. Remove the ENCRYPTION_* env vars.
 *
 * Usage:
 *   node scripts/decrypt-migrate.js [--apply] [--only=users,clients]
 */

import 'dotenv/config'
import mongoose from 'mongoose'
import { decrypt } from '../lib/encryption.js'

const MONGODB_URI = process.env.MONGODB_URI
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1) }

const APPLY = process.argv.includes('--apply')
const onlyArg = process.argv.find(a => a.startsWith('--only='))
const ONLY = onlyArg ? onlyArg.split('=')[1].split(',').map(s => s.trim()) : null

// collection → encrypted fields (path + type). Mirrors each model's
// encryptionPlugin config. `field` (the decrypt context) MUST equal the path
// that was used to encrypt — i.e. the same dot-path string.
const FIELD_MAP = {
  users: [
    { path: 'email' }, { path: 'name' }, { path: 'phone' }, { path: 'avatar' },
  ],
  clients: [
    { path: 'company' }, { path: 'companyPhone' }, { path: 'companyEmail' },
    { path: 'contactPerson' }, { path: 'designation' }, { path: 'businessType' },
    { path: 'industry' }, { path: 'altPhone' }, { path: 'timezone' },
    { path: 'address' }, { path: 'city' }, { path: 'country' }, { path: 'vatNumber' },
    { path: 'website' }, { path: 'socialLinks', type: 'array' }, { path: 'logo' },
    { path: 'notes' }, { path: 'kyc.documentNumber' }, { path: 'kyc.primaryDoc' },
    { path: 'kyc.additionalDocs', type: 'array' }, { path: 'kyc.remarks' },
  ],
  employees: [
    { path: 'venture' }, { path: 'department' }, { path: 'position' }, { path: 'designation' },
    { path: 'salary', type: 'number' },
    { path: 'phone' }, { path: 'secondaryPhone' }, { path: 'homePhone' },
    { path: 'companyPhone' }, { path: 'companyWebmail' }, { path: 'address' },
    { path: 'nidNumber' }, { path: 'passportNumber' }, { path: 'bloodGroup' },
    { path: 'nationality' }, { path: 'dateOfBirth', type: 'date' },
    { path: 'emergencyContacts', type: 'array' }, { path: 'companyItems', type: 'array' },
    { path: 'documents', type: 'array' }, { path: 'appointmentLetterUrl' },
    { path: 'agreementUrl' }, { path: 'hrNotes' },
  ],
  freelancers: [
    { path: 'skills' }, { path: 'bio' }, { path: 'portfolioLinks' }, { path: 'rateType' },
    { path: 'hourlyRate', type: 'number' }, { path: 'pricing', type: 'array' },
    { path: 'paymentMethod.bank.bankName' }, { path: 'paymentMethod.bank.accountNumber' },
    { path: 'paymentMethod.bank.accountName' }, { path: 'paymentMethod.bank.routingNumber' },
    { path: 'paymentMethod.bank.swiftCode' }, { path: 'paymentMethod.bank.branch' },
    { path: 'paymentMethod.bank.division' }, { path: 'paymentMethod.bkash.accountName' },
    { path: 'paymentMethod.bkash.accountNumber' }, { path: 'agencyInfo.agencyName' },
    { path: 'agencyInfo.phone' }, { path: 'agencyInfo.address' }, { path: 'agencyInfo.type' },
    { path: 'contactPerson.name' }, { path: 'contactPerson.phone' },
    { path: 'contactPerson.email' }, { path: 'contactPerson.designation' },
  ],
  invoices: [
    { path: 'items', type: 'array' }, { path: 'subtotal', type: 'number' },
    { path: 'taxRate', type: 'number' }, { path: 'taxAmount', type: 'number' },
    { path: 'discount', type: 'number' }, { path: 'total', type: 'number' },
    { path: 'paidAmount', type: 'number' }, { path: 'currency' }, { path: 'notes' }, { path: 'terms' },
  ],
  leads: [
    { path: 'name' }, { path: 'designation' }, { path: 'email' }, { path: 'phone' },
    { path: 'alternativePhone' }, { path: 'company' }, { path: 'location' },
    { path: 'category' }, { path: 'subcategory' }, { path: 'service' }, { path: 'source' },
    { path: 'platform' }, { path: 'reference' }, { path: 'referenceId' },
    { path: 'links', type: 'array' }, { path: 'value', type: 'number' }, { path: 'notes' },
    { path: 'lostReason' }, { path: 'comments', type: 'array' }, { path: 'businessCategory' },
  ],
  leaves: [
    { path: 'type' }, { path: 'reason' }, { path: 'approvedBy' },
  ],
  projects: [
    { path: 'name' }, { path: 'description' }, { path: 'category' }, { path: 'subcategory' },
    { path: 'currency' }, { path: 'brief' }, { path: 'tags' }, { path: 'cancelReason' },
    { path: 'budget', type: 'number' }, { path: 'discount', type: 'number' },
    { path: 'approvedExpenses', type: 'number' }, { path: 'paidAmount', type: 'number' },
  ],
  quotations: [
    { path: 'recipientName' }, { path: 'recipientCompany' }, { path: 'recipientEmail' },
    { path: 'recipientPhone' }, { path: 'recipientAddress' }, { path: 'items', type: 'array' },
    { path: 'subtotal', type: 'number' }, { path: 'taxRate', type: 'number' },
    { path: 'taxAmount', type: 'number' }, { path: 'discount', type: 'number' },
    { path: 'total', type: 'number' }, { path: 'currency' }, { path: 'notes' }, { path: 'terms' },
  ],
  tasks: [
    { path: 'title' }, { path: 'description' },
    { path: 'estimatedHours', type: 'number' }, { path: 'actualHours', type: 'number' },
  ],
  transactions: [
    { path: 'category' }, { path: 'amount', type: 'number' }, { path: 'currency' },
    { path: 'description' }, { path: 'reference' }, { path: 'paidToName' },
    { path: 'vendor' }, { path: 'expenseCategory' }, { path: 'receiptUrl' },
  ],
  vendors: [
    { path: 'company' }, { path: 'contactName' }, { path: 'email' }, { path: 'phone' },
    { path: 'serviceType' }, { path: 'address' }, { path: 'website' }, { path: 'notes' },
  ],
  withdrawalrequests: [
    { path: 'amount', type: 'number' }, { path: 'method' }, { path: 'details' },
    { path: 'paymentDetails' }, { path: 'adminNote' }, { path: 'allocations', type: 'array' },
  ],
  auditlogs: [
    { path: 'userRole' }, { path: 'action' }, { path: 'entity' }, { path: 'entityId' },
    { path: 'changes' }, { path: 'ipAddress' }, { path: 'userAgent' },
  ],
}

// Blind-index fields to drop once the source field is plaintext.
const BLIND_INDEX_FIELDS = { users: ['emailIdx', 'phoneIdx'] }

const PREFIX = 'enc:v1:'
const isEnc = (v) => typeof v === 'string' && v.startsWith(PREFIX)
const getPath = (obj, path) => path.split('.').reduce((cur, k) => (cur == null ? cur : cur[k]), obj)

async function migrateCollection(db, name, fields) {
  const coll = db.collection(name)
  const cursor = coll.find({})
  let scanned = 0, changed = 0, fieldHits = 0, errors = 0
  let bulk = []

  for await (const doc of cursor) {
    scanned++
    const $set = {}
    const $unset = {}

    for (const { path, type = 'string' } of fields) {
      const raw = getPath(doc, path)
      if (!isEnc(raw)) continue
      try {
        const plain = decrypt(raw, name, path, type)
        // decrypt() returns the original string on failure — guard against that
        if (isEnc(plain)) { errors++; continue }
        $set[path] = plain
        fieldHits++
      } catch {
        errors++
      }
    }

    for (const idxField of (BLIND_INDEX_FIELDS[name] ?? [])) {
      if (doc[idxField] !== undefined) $unset[idxField] = ''
    }

    if (Object.keys($set).length || Object.keys($unset).length) {
      changed++
      const update = {}
      if (Object.keys($set).length)   update.$set = $set
      if (Object.keys($unset).length) update.$unset = $unset
      if (APPLY) bulk.push({ updateOne: { filter: { _id: doc._id }, update } })
    }

    if (bulk.length >= 500) { await coll.bulkWrite(bulk, { ordered: false }); bulk = [] }
  }
  if (APPLY && bulk.length) await coll.bulkWrite(bulk, { ordered: false })

  console.log(
    `  ${name.padEnd(18)} scanned=${scanned}  ${APPLY ? 'updated' : 'would update'}=${changed}  fields=${fieldHits}` +
    (errors ? `  decrypt-failures=${errors}` : '')
  )
  return { scanned, changed, fieldHits, errors }
}

async function cleanupIndexes(db) {
  // Drop blind-index definitions; ensure a plaintext unique index on users.email.
  const users = db.collection('users')
  for (const ix of ['emailIdx_1', 'phoneIdx_1']) {
    try { await users.dropIndex(ix); console.log(`  dropped index users.${ix}`) }
    catch { /* not present — fine */ }
  }
  try {
    await users.createIndex({ email: 1 }, { unique: true })
    console.log('  ensured unique index users.email_1')
  } catch (e) {
    console.warn('  ⚠ could not create unique users.email index (duplicates?) —', e.message)
  }
}

async function main() {
  console.log(`\n🔓 Decrypt migration — mode: ${APPLY ? 'APPLY (writing)' : 'DRY RUN (no writes)'}\n`)
  await mongoose.connect(MONGODB_URI, { bufferCommands: false })
  const db = mongoose.connection.db

  const totals = { scanned: 0, changed: 0, fieldHits: 0, errors: 0 }
  for (const [name, fields] of Object.entries(FIELD_MAP)) {
    if (ONLY && !ONLY.includes(name)) continue
    const r = await migrateCollection(db, name, fields)
    for (const k of Object.keys(totals)) totals[k] += r[k]
  }

  if (APPLY && !ONLY) await cleanupIndexes(db)

  console.log(`\nTotal: ${APPLY ? 'updated' : 'would update'} ${totals.changed} docs, ${totals.fieldHits} fields` +
    (totals.errors ? `, ${totals.errors} decrypt-failures (left untouched)` : '') + '\n')
  if (!APPLY) console.log('Dry run only. Re-run with --apply to write changes.\n')

  await mongoose.disconnect()
  process.exit(0)
}

main().catch(err => { console.error('Migration failed:', err); process.exit(1) })
