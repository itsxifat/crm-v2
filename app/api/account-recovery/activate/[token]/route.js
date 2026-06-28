export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import { User } from '@/models'
import { setLoginOtp } from '@/lib/clientAccess'
import { sendClientOtpEmail } from '@/lib/mailer'

// Find a CLIENT user holding a still-valid, unused activation token.
async function findByToken(token) {
  if (!token) return null
  return User.findOne({
    activationToken:       token,
    activationTokenExpiry: { $gt: new Date() },
    role:                  'CLIENT',
    mustChangePassword:    true,
    isActive:              true,
  })
}

// GET /api/account-recovery/activate/[token] — validate the magic link
export async function GET(_, { params }) {
  try {
    await connectDB()
    const { token } = await params
    const user = await findByToken(token)
    if (!user) return NextResponse.json({ valid: false, error: 'This activation link is invalid or has expired.' }, { status: 404 })
    return NextResponse.json({ valid: true, email: user.email, name: user.name })
  } catch (err) {
    console.error('[GET /api/account-recovery/activate]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/account-recovery/activate/[token] — email a fresh 6-digit login code
export async function POST(_, { params }) {
  try {
    await connectDB()
    const { token } = await params
    const user = await findByToken(token)
    if (!user) return NextResponse.json({ valid: false, error: 'This activation link is invalid or has expired.' }, { status: 404 })

    const code = await setLoginOtp(user)
    try {
      await sendClientOtpEmail({ to: user.email, name: user.name, code })
    } catch (e) {
      console.warn('[activate POST] OTP email failed:', e.message)
      return NextResponse.json({ error: 'Could not send the login code. Please try again.' }, { status: 502 })
    }

    return NextResponse.json({ success: true, email: user.email })
  } catch (err) {
    console.error('[POST /api/account-recovery/activate]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
