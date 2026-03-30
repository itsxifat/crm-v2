/**
 * Seed 10 individual dummy clients for local development.
 * Run: node scripts/seed-clients.js
 */

import mongoose from 'mongoose'
import bcrypt from 'bcryptjs'
import dotenv from 'dotenv'
import { fileURLToPath } from 'url'
import path from 'path'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
dotenv.config({ path: path.join(root, '.env.local') })
dotenv.config({ path: path.join(root, '.env') })

const MONGODB_URI = process.env.MONGODB_URI
if (!MONGODB_URI) { console.error('MONGODB_URI is not set.'); process.exit(1) }

// ─── Inline schemas (mirrors models) ─────────────────────────────────────────

const UserSchema = new mongoose.Schema({
  email:    { type: String, required: true, unique: true, lowercase: true, trim: true },
  password: { type: String, required: true },
  name:     { type: String, required: true },
  role:     { type: String, enum: ['SUPER_ADMIN','MANAGER','EMPLOYEE','FREELANCER','CLIENT','VENDOR'], default: 'CLIENT' },
  avatar:   String,
  phone:    String,
  isActive: { type: Boolean, default: true },
  lastLogin: Date,
}, { timestamps: true })

const SocialLinkSchema = new mongoose.Schema({
  platform: String, url: String, label: { type: String, default: null },
}, { _id: false })

const KycDocSchema = new mongoose.Schema({
  url: { type: String, required: true }, name: { type: String, default: null }, uploadedAt: { type: Date, default: Date.now },
}, { _id: false })

const ClientSchema = new mongoose.Schema({
  userId:        { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
  clientCode:    { type: String, unique: true, sparse: true },
  clientType:    { type: String, enum: ['INDIVIDUAL', 'COMPANY'], default: 'INDIVIDUAL' },
  company:       { type: String, default: null },
  companyPhone:  { type: String, default: null },
  companyEmail:  { type: String, default: null },
  contactPerson: { type: String, default: null },
  designation:   { type: String, default: null },
  businessType:  { type: String, default: null },
  industry:      { type: String, default: null },
  priority:      { type: String, enum: ['LOW','MEDIUM','HIGH','VIP'], default: 'MEDIUM' },
  altPhone:      { type: String, default: null },
  timezone:      { type: String, default: null },
  address:       { type: String, default: null },
  city:          { type: String, default: null },
  country:       { type: String, default: 'Bangladesh' },
  vatNumber:     { type: String, default: null },
  website:       { type: String, default: null },
  socialLinks:   [SocialLinkSchema],
  logo:          { type: String, default: null },
  notes:         { type: String, default: null },
  kyc: {
    status:         { type: String, enum: ['NOT_SUBMITTED','PENDING','VERIFIED','REJECTED'], default: 'NOT_SUBMITTED' },
    documentType:   { type: String, default: null },
    documentNumber: { type: String, default: null },
    primaryDoc:     { type: String, default: null },
    additionalDocs: [KycDocSchema],
    remarks:        { type: String, default: null },
    reviewedBy:     { type: mongoose.Schema.Types.ObjectId, ref: 'User', default: null },
    reviewedAt:     { type: Date, default: null },
    submittedAt:    { type: Date, default: null },
  },
}, { timestamps: true })

// Auto-generate clientCode
ClientSchema.pre('save', async function () {
  if (this.clientCode) return
  const now    = new Date()
  const yy     = String(now.getFullYear()).slice(-2)
  const mm     = String(now.getMonth() + 1).padStart(2, '0')
  const prefix = `ENCL-${yy}${mm}`
  const count  = await mongoose.model('Client').countDocuments({ clientCode: { $regex: `^${prefix}` } })
  const seq    = count + 1
  const letter = String.fromCharCode(65 + Math.floor((seq - 1) / 999))
  const num    = ((seq - 1) % 999) + 1
  this.clientCode = `${prefix}${letter}${String(num).padStart(3, '0')}`
})

const User   = mongoose.models.User   || mongoose.model('User',   UserSchema)
const Client = mongoose.models.Client || mongoose.model('Client', ClientSchema)

// ─── Dummy data ───────────────────────────────────────────────────────────────

const CLIENTS = [
  {
    user: { name: 'Rafiqul Islam',    email: 'rafiq@example.com',   phone: '01711-223344' },
    client: { clientType: 'INDIVIDUAL', industry: 'Retail',          city: 'Dhaka',      country: 'Bangladesh', priority: 'HIGH',   address: '45 Gulshan Ave, Dhaka',        designation: 'Business Owner', businessType: 'Retail Shop',        notes: 'Long-term client, prefers WhatsApp contact.',   kyc: { status: 'VERIFIED', documentType: 'NID', documentNumber: '1991-0123456' } },
  },
  {
    user: { name: 'Nusrat Jahan',     email: 'nusrat@example.com',  phone: '01812-334455' },
    client: { clientType: 'INDIVIDUAL', industry: 'Fashion',          city: 'Chittagong', country: 'Bangladesh', priority: 'MEDIUM', address: '12 Agrabad, Chittagong',       designation: 'Entrepreneur',   businessType: 'Boutique',           notes: 'Interested in social media marketing packages.', kyc: { status: 'PENDING',  documentType: 'NID', documentNumber: '1994-0234567' } },
  },
  {
    user: { name: 'Tanvir Ahmed',     email: 'tanvir@example.com',  phone: '01913-445566' },
    client: { clientType: 'COMPANY',    company: 'TechBridge Ltd',    companyPhone: '029-112233', companyEmail: 'info@techbridge.com', industry: 'Technology', city: 'Dhaka', country: 'Bangladesh', priority: 'VIP', address: '88 Banani, Dhaka', contactPerson: 'Tanvir Ahmed', designation: 'CTO', businessType: 'Software Company', website: 'https://techbridge.com', vatNumber: 'VAT-20240001', notes: 'VIP client — priority support.', kyc: { status: 'VERIFIED', documentType: 'TRADE_LICENSE', documentNumber: 'TL-2024-00123' } },
  },
  {
    user: { name: 'Sadia Akter',      email: 'sadia@example.com',   phone: '01614-556677' },
    client: { clientType: 'INDIVIDUAL', industry: 'Food & Beverage',  city: 'Sylhet',     country: 'Bangladesh', priority: 'MEDIUM', address: '7 Zindabazar, Sylhet',         designation: 'Owner',          businessType: 'Restaurant',         notes: 'Runs a restaurant chain, needs branding help.',   kyc: { status: 'NOT_SUBMITTED' } },
  },
  {
    user: { name: 'Mizanur Rahman',   email: 'mizan@example.com',   phone: '01715-667788' },
    client: { clientType: 'COMPANY',    company: 'GreenBuild Const.', companyPhone: '029-887766', companyEmail: 'contact@greenbuild.com', industry: 'Construction', city: 'Dhaka', country: 'Bangladesh', priority: 'HIGH', address: '200 Tejgaon, Dhaka', contactPerson: 'Mizanur Rahman', designation: 'MD', businessType: 'Construction Firm', website: 'https://greenbuild.com.bd', notes: 'Large infrastructure projects, quarterly billing.', kyc: { status: 'VERIFIED', documentType: 'TRADE_LICENSE', documentNumber: 'TL-2023-00567' } },
  },
  {
    user: { name: 'Farjana Begum',    email: 'farjana@example.com', phone: '01816-778899' },
    client: { clientType: 'INDIVIDUAL', industry: 'Education',        city: 'Rajshahi',   country: 'Bangladesh', priority: 'LOW',    address: '33 Shaheb Bazar, Rajshahi',    designation: 'Director',       businessType: 'Coaching Centre',    notes: 'Seasonal campaigns around exam periods.',         kyc: { status: 'NOT_SUBMITTED' } },
  },
  {
    user: { name: 'Shahadat Hossain', email: 'shahadat@example.com',phone: '01917-889900' },
    client: { clientType: 'COMPANY',    company: 'MedPlus Healthcare', companyPhone: '029-223344', companyEmail: 'admin@medplus.com', industry: 'Healthcare', city: 'Dhaka', country: 'Bangladesh', priority: 'HIGH', address: '55 Dhanmondi, Dhaka', contactPerson: 'Shahadat Hossain', designation: 'CEO', businessType: 'Hospital Group', website: 'https://medplus.com.bd', vatNumber: 'VAT-20240088', notes: 'Multi-location hospital chain, monthly retainer.', kyc: { status: 'VERIFIED', documentType: 'TRADE_LICENSE', documentNumber: 'TL-2022-00312' } },
  },
  {
    user: { name: 'Roksana Parvin',   email: 'roksana@example.com', phone: '01618-990011' },
    client: { clientType: 'INDIVIDUAL', industry: 'Real Estate',       city: 'Narayanganj',country: 'Bangladesh', priority: 'MEDIUM', address: '19 Fatullah, Narayanganj',     designation: 'Property Dealer', businessType: 'Real Estate',       notes: 'Referral client from Tanvir Ahmed.',              kyc: { status: 'PENDING',  documentType: 'NID', documentNumber: '1987-0345678' } },
  },
  {
    user: { name: 'Ariful Haque',     email: 'ariful@example.com',  phone: '01719-001122' },
    client: { clientType: 'COMPANY',    company: 'SwiftLogistics BD', companyPhone: '029-556677', companyEmail: 'ops@swiftbd.com', industry: 'Logistics', city: 'Dhaka', country: 'Bangladesh', priority: 'MEDIUM', address: '101 Demra, Dhaka', contactPerson: 'Ariful Haque', designation: 'Operations Head', businessType: 'Courier & Logistics', website: 'https://swiftbd.com', notes: 'Growing logistics startup, flexible budget.', kyc: { status: 'NOT_SUBMITTED' } },
  },
  {
    user: { name: 'Sumaiya Khatun',   email: 'sumaiya@example.com', phone: '01820-112233' },
    client: { clientType: 'INDIVIDUAL', industry: 'Beauty & Wellness', city: 'Dhaka',      country: 'Bangladesh', priority: 'VIP',    address: '8 Uttara Sector 7, Dhaka',     designation: 'Founder',        businessType: 'Beauty Salon Chain', notes: 'VIP client — regular monthly campaigns.',        kyc: { status: 'VERIFIED', documentType: 'NID', documentNumber: '1990-0456789' } },
  },
]

// ─── Run ──────────────────────────────────────────────────────────────────────

await mongoose.connect(MONGODB_URI, { bufferCommands: false })
console.log('Connected to MongoDB.\n')

const PASSWORD = 'Client@1234'
const hashed   = await bcrypt.hash(PASSWORD, 12)

let created = 0
let skipped = 0

for (const { user, client } of CLIENTS) {
  const existing = await User.findOne({ email: user.email })
  if (existing) {
    console.log(`  ⚠  Skipped (already exists): ${user.name} <${user.email}>`)
    skipped++
    continue
  }

  const newUser = await User.create({
    name:     user.name,
    email:    user.email,
    password: hashed,
    phone:    user.phone,
    role:     'CLIENT',
    isActive: true,
  })

  const clientDoc = await new Client({
    userId:        newUser._id,
    clientType:    client.clientType,
    company:       client.company       ?? null,
    companyPhone:  client.companyPhone  ?? null,
    companyEmail:  client.companyEmail  ?? null,
    contactPerson: client.contactPerson ?? null,
    designation:   client.designation  ?? null,
    businessType:  client.businessType ?? null,
    industry:      client.industry     ?? null,
    priority:      client.priority     ?? 'MEDIUM',
    address:       client.address      ?? null,
    city:          client.city         ?? null,
    country:       client.country      ?? 'Bangladesh',
    vatNumber:     client.vatNumber    ?? null,
    website:       client.website      ?? null,
    notes:         client.notes        ?? null,
    kyc:           client.kyc          ?? { status: 'NOT_SUBMITTED' },
  }).save()  // pre-save hook generates clientCode

  console.log(`  ✓  Created: ${user.name.padEnd(20)} ${clientDoc.clientCode}  [${client.priority}]  ${client.clientType === 'COMPANY' ? client.company : '—'}`)
  created++
}

console.log(`\nDone — ${created} created, ${skipped} skipped.`)
console.log(`\nAll client login password: ${PASSWORD}`)

await mongoose.disconnect()
process.exit(0)
