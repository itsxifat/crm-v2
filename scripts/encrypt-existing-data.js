/**
 * scripts/encrypt-existing-data.js
 *
 * One-time migration: encrypt all plaintext data stored before the
 * encryption plugin was enabled across every collection.
 *
 * Run once after deploying:
 *   node --env-file=.env scripts/encrypt-existing-data.js
 *
 * SAFE TO RE-RUN — already-encrypted values (enc:v1:...) are skipped.
 * Take a mongodump backup before running on production.
 */

import 'dotenv/config'
import mongoose from 'mongoose'
import { encrypt, blindIndex, isEncrypted } from '../lib/encryption.js'

const MONGODB_URI = process.env.MONGODB_URI
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1) }

await mongoose.connect(MONGODB_URI)
console.log('Connected to MongoDB\n')

// ── Helpers ───────────────────────────────────────────────────────────────────

function getDeep(obj, path) {
  return path.split('.').reduce((o, k) => o?.[k], obj)
}

function setDeep(obj, path, value) {
  const keys = path.split('.')
  const last = keys.pop()
  const parent = keys.reduce((o, k) => { if (!o[k]) o[k] = {}; return o[k] }, obj)
  parent[last] = value
}

function encryptValue(value, collection, path) {
  if (value === null || value === undefined) return value
  if (typeof value === 'string' && isEncrypted(value)) return value  // already done
  return encrypt(value, collection, path)
}

async function migrateCollection({ collectionName, fields, blindIndexes = [] }) {
  const col    = mongoose.connection.db.collection(collectionName)
  const cursor = col.find({})
  let total = 0, updated = 0

  for await (const doc of cursor) {
    total++
    const $set = {}
    let dirty  = false

    // Capture plaintext originals for blind indexes before encrypting
    const originals = {}
    for (const { path } of blindIndexes) {
      originals[path] = getDeep(doc, path)
    }

    // Encrypt each field
    for (const { path } of fields) {
      const value = getDeep(doc, path)
      if (value === null || value === undefined) continue
      if (typeof value === 'string' && isEncrypted(value)) continue
      $set[path] = encryptValue(value, collectionName, path)
      dirty = true
    }

    // Write blind indexes from plaintext originals
    for (const { path, indexField } of blindIndexes) {
      const original = originals[path]
      if (original === null || original === undefined) continue
      $set[indexField] = blindIndex(original, collectionName, path)
      dirty = true
    }

    if (dirty) {
      await col.updateOne({ _id: doc._id }, { $set })
      updated++
    }
  }

  console.log(`  ${collectionName.padEnd(22)} ${updated}/${total} documents updated`)
}

// ── Run migrations ────────────────────────────────────────────────────────────

await migrateCollection({
  collectionName: 'users',
  fields: [
    { path: 'email' }, { path: 'name' }, { path: 'phone' }, { path: 'avatar' },
  ],
  blindIndexes: [
    { path: 'email', indexField: 'emailIdx' },
    { path: 'phone', indexField: 'phoneIdx' },
  ],
})

await migrateCollection({
  collectionName: 'employees',
  fields: [
    { path: 'venture' }, { path: 'department' }, { path: 'position' }, { path: 'designation' },
    { path: 'salary' }, { path: 'phone' }, { path: 'secondaryPhone' }, { path: 'homePhone' },
    { path: 'companyPhone' }, { path: 'companyWebmail' }, { path: 'address' },
    { path: 'nidNumber' }, { path: 'passportNumber' }, { path: 'bloodGroup' }, { path: 'nationality' },
    { path: 'dateOfBirth' }, { path: 'emergencyContacts' }, { path: 'companyItems' },
    { path: 'documents' }, { path: 'appointmentLetterUrl' }, { path: 'agreementUrl' },
    { path: 'hrNotes' },
  ],
})

await migrateCollection({
  collectionName: 'clients',
  fields: [
    { path: 'company' }, { path: 'companyPhone' }, { path: 'companyEmail' },
    { path: 'contactPerson' }, { path: 'designation' }, { path: 'businessType' },
    { path: 'industry' }, { path: 'altPhone' }, { path: 'timezone' },
    { path: 'address' }, { path: 'city' }, { path: 'country' }, { path: 'vatNumber' },
    { path: 'website' }, { path: 'socialLinks' }, { path: 'logo' }, { path: 'notes' },
    { path: 'kyc.documentNumber' }, { path: 'kyc.primaryDoc' },
    { path: 'kyc.additionalDocs' }, { path: 'kyc.remarks' },
  ],
})

await migrateCollection({
  collectionName: 'freelancers',
  fields: [
    { path: 'skills' }, { path: 'bio' }, { path: 'portfolioLinks' },
    { path: 'rateType' }, { path: 'hourlyRate' }, { path: 'pricing' },
    { path: 'paymentMethod.bank.bankName' }, { path: 'paymentMethod.bank.accountNumber' },
    { path: 'paymentMethod.bank.accountName' }, { path: 'paymentMethod.bank.routingNumber' },
    { path: 'paymentMethod.bank.swiftCode' }, { path: 'paymentMethod.bank.branch' },
    { path: 'paymentMethod.bank.division' }, { path: 'paymentMethod.bkash.accountName' },
    { path: 'paymentMethod.bkash.accountNumber' },
    { path: 'agencyInfo.agencyName' }, { path: 'agencyInfo.phone' },
    { path: 'agencyInfo.address' }, { path: 'agencyInfo.type' },
    { path: 'contactPerson.name' }, { path: 'contactPerson.phone' },
    { path: 'contactPerson.email' }, { path: 'contactPerson.designation' },
  ],
})

await migrateCollection({
  collectionName: 'leads',
  fields: [
    { path: 'name' }, { path: 'designation' }, { path: 'email' }, { path: 'phone' },
    { path: 'alternativePhone' }, { path: 'company' }, { path: 'location' },
    { path: 'category' }, { path: 'subcategory' }, { path: 'service' },
    { path: 'source' }, { path: 'platform' }, { path: 'reference' }, { path: 'referenceId' },
    { path: 'links' }, { path: 'value' }, { path: 'notes' }, { path: 'lostReason' },
    { path: 'comments' },
  ],
})

await migrateCollection({
  collectionName: 'leadactivities',
  fields: [{ path: 'type' }, { path: 'note' }, { path: 'createdByName' }],
})

await migrateCollection({
  collectionName: 'vendors',
  fields: [
    { path: 'company' }, { path: 'contactName' }, { path: 'email' }, { path: 'phone' },
    { path: 'serviceType' }, { path: 'address' }, { path: 'website' }, { path: 'notes' },
  ],
})

await migrateCollection({
  collectionName: 'projects',
  fields: [
    { path: 'name' }, { path: 'description' }, { path: 'category' }, { path: 'subcategory' },
    { path: 'currency' }, { path: 'brief' }, { path: 'tags' }, { path: 'cancelReason' },
    { path: 'budget' }, { path: 'discount' }, { path: 'approvedExpenses' }, { path: 'paidAmount' },
  ],
})

await migrateCollection({
  collectionName: 'invoices',
  fields: [
    { path: 'items' }, { path: 'subtotal' }, { path: 'taxRate' }, { path: 'taxAmount' },
    { path: 'discount' }, { path: 'total' }, { path: 'paidAmount' },
    { path: 'currency' }, { path: 'notes' }, { path: 'terms' },
  ],
})

await migrateCollection({
  collectionName: 'quotations',
  fields: [
    { path: 'recipientName' }, { path: 'recipientCompany' }, { path: 'recipientEmail' },
    { path: 'recipientPhone' }, { path: 'recipientAddress' },
    { path: 'items' }, { path: 'subtotal' }, { path: 'taxRate' }, { path: 'taxAmount' },
    { path: 'discount' }, { path: 'total' }, { path: 'currency' },
    { path: 'notes' }, { path: 'terms' },
  ],
})

await migrateCollection({
  collectionName: 'tasks',
  fields: [
    { path: 'title' }, { path: 'description' },
    { path: 'estimatedHours' }, { path: 'actualHours' },
  ],
})

await migrateCollection({
  collectionName: 'transactions',
  fields: [
    { path: 'category' }, { path: 'amount' }, { path: 'currency' },
    { path: 'description' }, { path: 'reference' },
    { path: 'paidToName' }, { path: 'vendor' }, { path: 'receiptUrl' },
  ],
})

await migrateCollection({
  collectionName: 'leaves',
  fields: [{ path: 'type' }, { path: 'reason' }, { path: 'approvedBy' }],
})

await migrateCollection({
  collectionName: 'withdrawalrequests',
  fields: [
    { path: 'amount' }, { path: 'method' }, { path: 'details' },
    { path: 'paymentDetails' }, { path: 'adminNote' }, { path: 'allocations' },
  ],
})

await migrateCollection({
  collectionName: 'auditlogs',
  fields: [
    { path: 'userRole' }, { path: 'action' }, { path: 'entity' },
    { path: 'entityId' }, { path: 'changes' }, { path: 'ipAddress' }, { path: 'userAgent' },
  ],
})

await mongoose.disconnect()
console.log('\nMigration complete. All existing data is now encrypted.')
