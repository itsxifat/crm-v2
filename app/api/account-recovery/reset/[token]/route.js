export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import connectDB from '@/lib/mongodb'
import { User, PasswordResetRequest } from '@/models'
import { validateStrongPassword } from '@/lib/passwordPolicy'

async function findByToken(token) {
  if (!token) return null
  return User.findOne({
    passwordResetToken:  token,
    passwordResetExpiry: { $gt: new Date() },
  })
}

// GET /api/account-recovery/reset/[token] — validate an approved reset link
export async function GET(_, { params }) {
  try {
    await connectDB()
    const { token } = await params
    const user = await findByToken(token)
    if (!user) return NextResponse.json({ valid: false, error: 'This reset link is invalid or has expired.' }, { status: 404 })
    return NextResponse.json({ valid: true, email: user.email })
  } catch (err) {
    console.error('[GET /api/account-recovery/reset]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/account-recovery/reset/[token]  { password }
export async function POST(request, { params }) {
  try {
    await connectDB()
    const { token } = await params
    const { password } = await request.json()

    const pwError = validateStrongPassword(password)
    if (pwError) return NextResponse.json({ error: pwError }, { status: 422 })

    const user = await findByToken(token)
    if (!user) return NextResponse.json({ error: 'This reset link is invalid or has expired.' }, { status: 404 })

    user.password            = await bcrypt.hash(password, 12)
    user.passwordResetToken  = null
    user.passwordResetExpiry = null
    user.mustChangePassword  = false
    await user.save()

    await PasswordResetRequest.updateMany(
      { userId: user._id, status: 'APPROVED' },
      { $set: { status: 'COMPLETED' } },
    )

    return NextResponse.json({ success: true, email: user.email })
  } catch (err) {
    console.error('[POST /api/account-recovery/reset]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
