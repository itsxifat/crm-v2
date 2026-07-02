/**
 * scripts/seed.js
 *
 * Bootstrap the first SUPER_ADMIN user.
 *
 * There is no public signup, and POST /api/users requires an existing
 * SUPER_ADMIN — so the very first admin has to be created out-of-band.
 * This writes directly to the `users` collection using the same field
 * encryption + blind index helpers the app uses, so login works normally.
 *
 * Run:
 *   npm run db:seed
 *   # or override the defaults:
 *   SEED_ADMIN_EMAIL=you@example.com SEED_ADMIN_PASSWORD='S3cret!pass' npm run db:seed
 *
 * SAFE TO RE-RUN — skips creation if the admin email already exists.
 */

import 'dotenv/config'
import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'

const MONGODB_URI = process.env.MONGODB_URI
if (!MONGODB_URI) { console.error('MONGODB_URI not set'); process.exit(1) }

const EMAIL    = (process.env.SEED_ADMIN_EMAIL    ?? 'enfinito.official@gmail.com').trim().toLowerCase()
const PASSWORD =  process.env.SEED_ADMIN_PASSWORD ?? 'Admin@123456'
const NAME     = (process.env.SEED_ADMIN_NAME     ?? 'Enfinito Admin').trim()

if (PASSWORD.length < 8) {
  console.error('SEED_ADMIN_PASSWORD must be at least 8 characters.')
  process.exit(1)
}

await mongoose.connect(MONGODB_URI)
console.log('Connected to MongoDB')

const users = mongoose.connection.db.collection('users')

const existing = await users.findOne({ email: EMAIL })
if (existing) {
  console.log(`\nUser ${EMAIL} already exists (role: ${existing.role}). Nothing to do.`)
  await mongoose.disconnect()
  process.exit(0)
}

// Ensure the unique email index exists (mirrors the Mongoose schema)
await users.createIndex({ email: 1 }, { unique: true })

const now = new Date()
await users.insertOne({
  email:     EMAIL,
  name:      NAME,
  password:  await bcrypt.hash(PASSWORD, 12),
  role:      'SUPER_ADMIN',
  avatar:    null,
  phone:     null,
  isActive:  true,
  lastLogin: null,
  createdAt: now,
  updatedAt: now,
})

console.log('\n✅ Created first SUPER_ADMIN')
console.log('   email:    ' + EMAIL)
console.log('   password: ' + PASSWORD)
console.log('\n   Log in at /login, then change this password.')

await mongoose.disconnect()
process.exit(0)
