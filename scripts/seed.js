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

// ─── Inline schema helpers ────────────────────────────────────────────────────
const { Schema } = mongoose

const transform = (_, ret) => {
  ret.id = ret._id?.toString()
  delete ret._id
  delete ret.__v
  delete ret.password
  return ret
}
const opts = { timestamps: true, toJSON: { virtuals: true, transform } }

// Users
const UserSchema = new Schema(
  { email: String, password: String, name: String, role: String, avatar: String, phone: String, isActive: { type: Boolean, default: true }, lastLogin: Date },
  opts
)
const User = mongoose.models.User ?? mongoose.model('User', UserSchema)

// Employees
const EmployeeSchema = new Schema(
  { userId: { type: Schema.Types.ObjectId, ref: 'User' }, employeeId: String, department: String, jobTitle: String, salary: Number, currency: { type: String, default: 'USD' }, startDate: Date, endDate: Date, isActive: { type: Boolean, default: true }, address: String, emergencyContact: String },
  opts
)
const Employee = mongoose.models.Employee ?? mongoose.model('Employee', EmployeeSchema)

// Clients
const ClientSchema = new Schema(
  { userId: { type: Schema.Types.ObjectId, ref: 'User' }, company: String, industry: String, website: String, address: String, notes: String, isActive: { type: Boolean, default: true } },
  opts
)
const Client = mongoose.models.Client ?? mongoose.model('Client', ClientSchema)

// Freelancers
const FreelancerSchema = new Schema(
  { userId: { type: Schema.Types.ObjectId, ref: 'User' }, skills: [String], portfolio: String, hourlyRate: Number, currency: { type: String, default: 'USD' }, walletBalance: { type: Number, default: 0 }, isActive: { type: Boolean, default: true } },
  opts
)
const Freelancer = mongoose.models.Freelancer ?? mongoose.model('Freelancer', FreelancerSchema)

// Vendors
const VendorSchema = new Schema(
  { company: String, contactName: String, email: String, phone: String, serviceType: String, address: String, website: String, notes: String },
  opts
)
const Vendor = mongoose.models.Vendor ?? mongoose.model('Vendor', VendorSchema)

// Projects
const ProjectSchema = new Schema(
  { name: String, description: String, clientId: { type: Schema.Types.ObjectId, ref: 'Client' }, status: { type: String, default: 'PLANNING' }, priority: { type: String, default: 'MEDIUM' }, startDate: Date, endDate: Date, budget: Number, actualCost: Number, currency: { type: String, default: 'USD' }, tags: String },
  opts
)
const Project = mongoose.models.Project ?? mongoose.model('Project', ProjectSchema)

// Leads
const LeadSchema = new Schema(
  { name: String, email: String, phone: String, company: String, source: String, status: { type: String, default: 'NEW' }, value: Number, currency: { type: String, default: 'USD' }, assignedTo: { type: Schema.Types.ObjectId, ref: 'Employee' }, notes: String },
  opts
)
const Lead = mongoose.models.Lead ?? mongoose.model('Lead', LeadSchema)

// Settings
const SettingSchema = new Schema({ key: { type: String, unique: true }, value: String, group: { type: String, default: 'general' } }, opts)
const Setting = mongoose.models.Setting ?? mongoose.model('Setting', SettingSchema)

// ─── Seed data ────────────────────────────────────────────────────────────────

async function seed() {
  await mongoose.connect(MONGODB_URI, { bufferCommands: false })
  console.log('Connected to MongoDB')

  // ── Users ────────────────────────────────────────────────────────────────────
  const password = await bcrypt.hash('password123', 12)

  const existingAdmin = await User.findOne({ email: 'admin@en-tech.agency' })
  if (existingAdmin) {
    console.log('Database already seeded (admin user exists). Skipping.')
    await mongoose.disconnect()
    return
  }

  const [superAdmin, manager, empUser1, empUser2, clientUser1, clientUser2, freelancerUser1, vendorUser1] = await User.insertMany([
    { email: 'admin@en-tech.agency',   password, name: 'Super Admin',    role: 'SUPER_ADMIN' },
    { email: 'manager@en-tech.agency', password, name: 'Alex Manager',   role: 'MANAGER' },
    { email: 'john@en-tech.agency',    password, name: 'John Developer', role: 'EMPLOYEE' },
    { email: 'sarah@en-tech.agency',   password, name: 'Sarah Designer', role: 'EMPLOYEE' },
    { email: 'acme@client.com',        password, name: 'ACME Corp',      role: 'CLIENT' },
    { email: 'techstart@client.com',   password, name: 'TechStart Inc',  role: 'CLIENT' },
    { email: 'mike@freelance.com',     password, name: 'Mike Freelancer',role: 'FREELANCER' },
    { email: 'contact@aws-vendor.com', password, name: 'AWS Vendor',     role: 'VENDOR' },
  ])

  // ── Employees ────────────────────────────────────────────────────────────────
  const [emp1, emp2] = await Employee.insertMany([
    { userId: empUser1._id, employeeId: 'EMP001', department: 'Engineering', jobTitle: 'Senior Developer', salary: 85000, startDate: new Date('2022-01-15') },
    { userId: empUser2._id, employeeId: 'EMP002', department: 'Design',      jobTitle: 'UI/UX Designer',   salary: 72000, startDate: new Date('2022-03-01') },
  ])

  // ── Clients ───────────────────────────────────────────────────────────────────
  const [client1, client2] = await Client.insertMany([
    { userId: clientUser1._id, company: 'ACME Corporation',  industry: 'Manufacturing', website: 'https://acme.com' },
    { userId: clientUser2._id, company: 'TechStart Inc',     industry: 'Technology',   website: 'https://techstart.io' },
  ])

  // ── Freelancers ───────────────────────────────────────────────────────────────
  const [freelancer1] = await Freelancer.insertMany([
    { userId: freelancerUser1._id, skills: ['React', 'Node.js', 'MongoDB'], hourlyRate: 75, walletBalance: 1500 },
  ])

  // ── Vendors ───────────────────────────────────────────────────────────────────
  const [vendor1] = await Vendor.insertMany([
    { company: 'AWS Solutions', contactName: 'AWS Vendor', email: 'contact@aws-vendor.com', serviceType: 'Cloud Services', phone: '+1-555-0100' },
  ])

  // ── Projects ──────────────────────────────────────────────────────────────────
  const [proj1, proj2] = await Project.insertMany([
    {
      name:      'ACME E-Commerce Platform',
      description: 'Full-stack e-commerce site rebuild with React + Node.js',
      clientId:  client1._id,
      status:    'IN_PROGRESS',
      priority:  'HIGH',
      startDate: new Date('2024-01-10'),
      endDate:   new Date('2024-06-30'),
      budget:    120000,
      currency:  'USD',
      tags:      'ecommerce,react,nodejs',
    },
    {
      name:      'TechStart Mobile App',
      description: 'Cross-platform mobile app for inventory management',
      clientId:  client2._id,
      status:    'PLANNING',
      priority:  'MEDIUM',
      startDate: new Date('2024-03-01'),
      endDate:   new Date('2024-09-30'),
      budget:    80000,
      currency:  'USD',
      tags:      'mobile,react-native',
    },
  ])

  // ── Leads ─────────────────────────────────────────────────────────────────────
  await Lead.insertMany([
    { name: 'David Smith',    email: 'david@startup.com', company: 'Startup Co',     source: 'LinkedIn',    status: 'NEW',          value: 35000 },
    { name: 'Emma Johnson',   email: 'emma@bigco.com',    company: 'BigCo Ltd',      source: 'Referral',    status: 'CONTACTED',    value: 75000 },
    { name: 'Chris Williams', email: 'chris@sme.com',     company: 'SME Business',   source: 'Website',     status: 'PROPOSAL_SENT',value: 22000 },
    { name: 'Laura Davis',    email: 'laura@fintech.com', company: 'FinTech Corp',   source: 'Conference',  status: 'WON',          value: 150000 },
    { name: 'Tom Brown',      email: 'tom@agency.com',    company: 'Agency Group',   source: 'Cold Email',  status: 'LOST',         value: 18000 },
  ])

  // ── Settings ──────────────────────────────────────────────────────────────────
  await Setting.insertMany([
    { key: 'company_name',    value: 'En-Tech Agency',              group: 'general' },
    { key: 'company_email',   value: 'hello@en-tech.agency',        group: 'general' },
    { key: 'company_phone',   value: '+1 (555) 000-0000',           group: 'general' },
    { key: 'company_address', value: '123 Business Ave, New York',  group: 'general' },
    { key: 'default_currency',value: 'USD',                         group: 'billing' },
    { key: 'invoice_prefix',  value: 'INV',                         group: 'billing' },
    { key: 'tax_rate',        value: '10',                          group: 'billing' },
    { key: 'theme_color',     value: '#3B82F6',                     group: 'appearance' },
  ])

  console.log('✅ Database seeded successfully!')
  console.log('\nLogin credentials (all use password: password123):')
  console.log('  Super Admin:  admin@en-tech.agency')
  console.log('  Manager:      manager@en-tech.agency')
  console.log('  Employee:     john@en-tech.agency')
  console.log('  Client:       acme@client.com')
  console.log('  Freelancer:   mike@freelance.com')

  await mongoose.disconnect()
}

seed().catch(err => {
  console.error('Seed failed:', err)
  process.exit(1)
})
