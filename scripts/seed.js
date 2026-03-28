/**
 * Seed script for EN-CRM
 * Run: npm run db:seed
 */

const mongoose = require('mongoose')
const bcrypt   = require('bcryptjs')
const dotenv   = require('dotenv')
const path     = require('path')

// Load env from project root
const root = path.resolve(__dirname, '..')
dotenv.config({ path: path.join(root, '.env.local') })
dotenv.config({ path: path.join(root, '.env') })

const MONGODB_URI = process.env.MONGODB_URI
if (!MONGODB_URI) {
  console.error('❌  MONGODB_URI is not set. Check .env or .env.local')
  process.exit(1)
}

// ─── Schemas (minimal, for seed use only) ────────────────────────────────────
const { Schema } = mongoose

const User = mongoose.models.User || mongoose.model('User', new Schema(
  {
    email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    name:     { type: String, required: true },
    role:     { type: String, default: 'SUPER_ADMIN' },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
))

const Setting = mongoose.models.Setting || mongoose.model('Setting', new Schema(
  { key: { type: String, unique: true }, value: String, group: { type: String, default: 'general' } },
  { timestamps: true }
))

// ─── Config ───────────────────────────────────────────────────────────────────
const ADMIN_EMAIL    = 'admin@crm.enfinito'
const DEFAULT_PASS   = 'enfinito1234'

// ─── Seed ─────────────────────────────────────────────────────────────────────
async function seed() {
  await mongoose.connect(MONGODB_URI, { bufferCommands: false })
  console.log('Connected to MongoDB')

  // ── Super Admin ──────────────────────────────────────────────────────────────
  const existing = await User.findOne({ email: ADMIN_EMAIL })

  if (existing) {
    console.log('✅  Super admin already exists — password unchanged.')
  } else {
    const hashed = await bcrypt.hash(DEFAULT_PASS, 12)
    await User.create({
      email:    ADMIN_EMAIL,
      password: hashed,
      name:     'Super Admin',
      role:     'SUPER_ADMIN',
      isActive: true,
    })
    console.log('✅  Super admin created.')
    console.log(`    Email:    ${ADMIN_EMAIL}`)
    console.log(`    Password: ${DEFAULT_PASS}`)
    console.log('    ⚠  Change this password after first login.')
  }

  // ── Default Settings (upsert — safe to re-run) ────────────────────────────
  const defaults = [
    { key: 'company_name',     value: 'Enfinito',   group: 'general' },
    { key: 'company_email',    value: '',            group: 'general' },
    { key: 'company_phone',    value: '',            group: 'general' },
    { key: 'company_address',  value: '',            group: 'general' },
    { key: 'default_currency', value: 'BDT',         group: 'billing' },
    { key: 'invoice_prefix',   value: 'INV',         group: 'billing' },
    { key: 'tax_rate',         value: '0',           group: 'billing' },
  ]

  for (const s of defaults) {
    await Setting.findOneAndUpdate(
      { key: s.key },
      { $setOnInsert: s },
      { upsert: true }
    )
  }
  console.log('✅  Default settings ensured.')

  await mongoose.disconnect()
  console.log('\nDone.')
}

seed().catch(err => {
  console.error('❌  Seed failed:', err.message)
  process.exit(1)
})
