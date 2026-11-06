export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import { User } from '@/models'
import { hit } from '@/lib/rateLimit'
import { clientIpFromHeaders } from '@/lib/clientIp'
import {
  normalizeEmail, isValidEmail, findUserByEmail, hashCode, safeEqualHex, newResetToken, hashToken,
  OTP_MAX_ATTEMPTS, RESET_TOKEN_TTL_MS,
} from '@/lib/passwordReset'

const invalid = () => NextResponse.json({ error: 'Incorrect or expired code' }, { status: 400 })

// POST /api/account-recovery/verify  { email, code }
// Checks the emailed code. A correct code is burned and exchanged for a
// short-lived, single-use reset token. Every failure looks the same.
export async function POST(request) {
  const body  = await request.json().catch(() => ({}))
  const email = normalizeEmail(body?.email)
  const code  = String(body?.code ?? '').trim()

  // No forwarded client IP → key by email (see request/route.js).
  const ip = clientIpFromHeaders(h => request.headers.get(h), null)
  const rl = hit(`pwreset:verify:${ip ?? `email:${email}`}`, 30, 15 * 60 * 1000)
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${Math.ceil(rl.retryAfter / 60)} min.` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    )
  }

  if (!isValidEmail(email) || !/^\d{6}$/.test(code)) return NextResponse.json({ error: 'Enter the 6-digit code' }, { status: 422 })

  try {
    await connectDB()
    const user = await findUserByEmail(email, '_id isActive')
    if (!user || !user.isActive) return invalid()

    const now = new Date()
    // Reserve one attempt atomically BEFORE comparing, so parallel guesses can't
    // exceed the per-code budget.
    const reserved = await User.findOneAndUpdate(
      {
        _id: user._id, isActive: true,
        resetOtp: { $type: 'string' },
        resetOtpExpiry: { $gt: now },
        resetOtpAttempts: { $lt: OTP_MAX_ATTEMPTS },
      },
      { $inc: { resetOtpAttempts: 1 } },
      { new: true, projection: { resetOtp: 1 } },
    ).lean()
    if (!reserved) return invalid()

    if (!safeEqualHex(reserved.resetOtp, hashCode(user._id.toString(), code))) return invalid()

    const resetToken = newResetToken()
    const consumed = await User.findOneAndUpdate(
      { _id: user._id, resetOtp: reserved.resetOtp },
      { $set: {
        resetOtp: null, resetOtpExpiry: null, resetOtpAttempts: 0,
        resetTokenHash:   hashToken(resetToken),
        resetTokenExpiry: new Date(now.getTime() + RESET_TOKEN_TTL_MS),
      } },
      { projection: { _id: 1 } },
    ).lean()
    if (!consumed) return invalid()

    return NextResponse.json({ success: true, resetToken, expiresIn: RESET_TOKEN_TTL_MS / 1000 })
  } catch (err) {
    console.error('[POST /api/account-recovery/verify]', err)
    return NextResponse.json({ error: 'Something went wrong. Try again.' }, { status: 500 })
  }
}
