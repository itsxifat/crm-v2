export const dynamic = 'force-dynamic'

/**
 * GET /api/gain
 *
 * One-time bootstrap: visit this URL to create the super admin account.
 * Once the super admin changes their password from the account page,
 * this endpoint is permanently sealed and returns a message.
 */

import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import { User, Setting } from '@/models'
import { blindIndex } from '@/lib/encryption'

const ADMIN_EMAIL    = 'admin@enfinito.com'
const ADMIN_PASSWORD = 'enfinito1234'
const ADMIN_NAME     = 'Super Admin'

export async function GET() {
  await connectDB()

  // Check if sealed (admin already changed their password)
  const sealed = await Setting.findOne({ key: 'gain_disabled' })
  if (sealed?.value === 'true') {
    return NextResponse.json(
      { message: 'This endpoint has been permanently disabled. The admin account is secured.' },
      { status: 410 }
    )
  }

  const bcrypt = (await import('bcryptjs')).default

  // Create or reset the super admin account
  const emailToken = blindIndex(ADMIN_EMAIL, 'users', 'email')
  const existing = await User.findOne({ emailIdx: emailToken }).select('+emailIdx')

  if (existing) {
    // Reset password back to default (idempotent re-visit)
    existing.password = await bcrypt.hash(ADMIN_PASSWORD, 12)
    existing.role     = 'SUPER_ADMIN'
    existing.isActive = true
    await existing.save()
  } else {
    await new User({
      name:     ADMIN_NAME,
      email:    ADMIN_EMAIL,
      password: await bcrypt.hash(ADMIN_PASSWORD, 12),
      role:     'SUPER_ADMIN',
      isActive: true,
    }).save()
  }

  return NextResponse.json({
    success:  true,
    message:  'Super admin account is ready. Log in and change your password immediately.',
    email:    ADMIN_EMAIL,
    password: ADMIN_PASSWORD,
    warning:  'Change your password from the Account page — this endpoint will then be permanently disabled.',
  })
}
