/**
 * Seed script for EN-CRM (MongoDB / Mongoose)
 * Run: node scripts/seed.js
 */

import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import path from 'path'

// Load env from project root
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: path.join(root, '.env.local') })
dotenv.config({ path: path.join(root, '.env') }) // fallback to .env

const MONGODB_URI = process.env.MONGODB_URI
if (!MONGODB_URI) {
  console.error('MONGODB_URI is not set. Check .env or .env.local')
  process.exit(1)
}

// ─── Schemas ──────────────────────────────────────────────────────────────────
const { Schema } = mongoose

const opts = { timestamps: true }

const User = mongoose.models.User ?? mongoose.model('User', new Schema(
  { email: String, password: String, name: String, role: String, avatar: String, phone: String, isActive: { type: Boolean, default: true }, lastLogin: Date },
  opts
))

const Setting = mongoose.models.Setting ?? mongoose.model('Setting', new Schema(
  { key: { type: String, unique: true }, value: String, group: { type: String, default: 'general' } },
  opts
))

// ─── Seed data ────────────────────────────────────────────────────────────────

const ADMIN_EMAIL = 'admin@en-tech.agency'
const DEFAULT_PASSWORD = 'enfinito1234'

async function seed() {
  await mongoose.connect(MONGODB_URI, { bufferCommands: false })
  console.log('Connected to MongoDB')

  // ── Super Admin ───────────────────────────────────────────────────────────────
  // Only create if not exists. If exists, NEVER overwrite the password.
  const existing = await User.findOne({ email: ADMIN_EMAIL })

  if (existing) {
    console.log('✅ Super admin already exists — password unchanged.')
  } else {
    const hashed = await bcrypt.hash(DEFAULT_PASSWORD, 12)
    await User.create({
      email:    ADMIN_EMAIL,
      password: hashed,
      name:     'Super Admin',
      role:     'SUPER_ADMIN',
      isActive: true,
    })
    console.log('✅ Super admin created.')
    console.log(`   Email:    ${ADMIN_EMAIL}`)
    console.log(`   Password: ${DEFAULT_PASSWORD}`)
    console.log('   Change this password after first login.')
  }

  // ── Default Settings (upsert — safe to re-run) ────────────────────────────────
  const defaults = [
    { key: 'company_name',     value: 'En-Tech Agency',             group: 'general' },
    { key: 'company_email',    value: 'hello@en-tech.agency',       group: 'general' },
    { key: 'company_phone',    value: '',                            group: 'general' },
    { key: 'company_address',  value: '',                            group: 'general' },
    { key: 'default_currency', value: 'BDT',                        group: 'billing' },
    { key: 'invoice_prefix',   value: 'INV',                        group: 'billing' },
    { key: 'tax_rate',         value: '0',                          group: 'billing' },
  ]

  for (const s of defaults) {
    await Setting.findOneAndUpdate(
      { key: s.key },
      { $setOnInsert: s },   // only insert if not exists — never overwrites
      { upsert: true }
    )
  }
  console.log('✅ Default settings ensured.')

  await mongoose.disconnect()
}

seed().catch(err => {
  console.error('Seed failed:', err)
  process.exit(1)
})
