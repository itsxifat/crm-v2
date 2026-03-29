/**
 * Create a dummy SUPER_ADMIN user for local development.
 * Run: node scripts/create-super-admin.js
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
if (!MONGODB_URI) {
  console.error('MONGODB_URI is not set.')
  process.exit(1)
}

const userSchema = new mongoose.Schema(
  {
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    password: { type: String, required: true },
    name: { type: String, required: true },
    role: {
      type: String,
      enum: ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE', 'FREELANCER', 'CLIENT', 'VENDOR'],
      default: 'EMPLOYEE',
    },
    avatar: String,
    phone: String,
    isActive: { type: Boolean, default: true },
    lastLogin: Date,
  },
  { timestamps: true }
)

const User = mongoose.models.User || mongoose.model('User', userSchema)

const ADMIN = {
  name: 'Super Admin',
  email: 'admin@entech.com',
  password: 'Admin@1234',
  role: 'SUPER_ADMIN',
}

await mongoose.connect(MONGODB_URI, { bufferCommands: false })

const existing = await User.findOne({ email: ADMIN.email })
if (existing) {
  console.log(`User already exists: ${ADMIN.email}`)
} else {
  const hashed = await bcrypt.hash(ADMIN.password, 12)
  await User.create({ ...ADMIN, password: hashed })
  console.log('Super admin created successfully.')
}

console.log('\n--- Credentials ---')
console.log(`  Email   : ${ADMIN.email}`)
console.log(`  Password: ${ADMIN.password}`)
console.log(`  Role    : ${ADMIN.role}`)
console.log('-------------------\n')
console.log('Login at: http://localhost:3000/login')

await mongoose.disconnect()
process.exit(0)
