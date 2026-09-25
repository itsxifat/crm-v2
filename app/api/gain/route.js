export const dynamic = 'force-dynamic'

/**
 * GET /api/gain
 *
 * One-time bootstrap: visit this URL to create the super admin account.
 * Only works while no SUPER_ADMIN exists; it never modifies existing users and
 * seals itself permanently right after the account is created.
 */

import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import { User, Setting } from '@/models'
import { ciEquals } from '@/lib/searchMatch'

const ADMIN_EMAIL    = process.env.GAIN_ADMIN_EMAIL    || process.env.ADMIN_EMAIL    || 'admin@example.com'
const ADMIN_PASSWORD = process.env.GAIN_ADMIN_PASSWORD || process.env.ADMIN_PASSWORD || null
const ADMIN_NAME     = process.env.GAIN_ADMIN_NAME     || 'Super Admin'

export async function GET() {
  if (!ADMIN_PASSWORD) {
    return NextResponse.json(
      { error: 'GAIN_ADMIN_PASSWORD environment variable is not set. Set it before using this endpoint.' },
      { status: 400 }
    )
  }

  await connectDB()

  // Check if sealed (admin already changed their password)
  const sealed = await Setting.findOne({ key: 'gain_disabled' })
  if (sealed?.value === 'true') {
    return NextResponse.json(
      { message: 'This endpoint has been permanently disabled. The admin account is secured.' },
      { status: 410 }
    )
  }

  const seal = () => Setting.findOneAndUpdate(
    { key: 'gain_disabled' },
    { key: 'gain_disabled', value: 'true', group: 'security' },
    { upsert: true }
  )

  // Bootstrap only: once any super admin exists, never touch existing accounts
  // (no password resets, promotions or re-activations) — seal and stop.
  if (await User.exists({ role: 'SUPER_ADMIN' })) {
    await seal()
    return NextResponse.json(
      { message: 'This endpoint has been permanently disabled. The admin account is secured.' },
      { status: 410 }
    )
  }

  // Never modify (or promote) an existing user that happens to hold ADMIN_EMAIL.
  if (await User.exists({ email: ciEquals(ADMIN_EMAIL) })) {
    return NextResponse.json(
      { error: 'A user with the configured admin email already exists. Bootstrap refused.' },
      { status: 409 }
    )
  }

  const bcrypt = (await import('bcryptjs')).default

  await new User({
    name:     ADMIN_NAME,
    email:    ADMIN_EMAIL,
    password: await bcrypt.hash(ADMIN_PASSWORD, 12),
    role:     'SUPER_ADMIN',
    isActive: true,
  }).save()

  // Seal immediately after the one-time creation.
  await seal()

  return NextResponse.json({
    success: true,
    message: 'Super admin account is ready. Log in and change your password immediately.',
    email:   ADMIN_EMAIL,
    warning: 'Change your password from the Account page. This endpoint is now permanently disabled.',
  })
}
