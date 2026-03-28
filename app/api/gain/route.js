export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import connectDB from '@/lib/mongodb'
import { User } from '@/models'

// GET /api/gain  — creates super admin if not exists
export async function GET() {
  await connectDB()

  const email = 'admin@crm.enfinito'
  const existing = await User.findOne({ email })

  if (existing) {
    return NextResponse.json({ ok: true, message: 'User already exists', email })
  }

  const password = await bcrypt.hash('enfinito1234', 12)
  await User.create({
    email,
    password,
    name:     'Super Admin',
    role:     'SUPER_ADMIN',
    isActive: true,
  })

  return NextResponse.json({ ok: true, message: 'Super admin created', email, password: 'enfinito1234' })
}
