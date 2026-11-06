export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import bcrypt from 'bcryptjs'
import connectDB from '@/lib/mongodb'
import { User, Client, PasswordResetRequest } from '@/models'
import { hit } from '@/lib/rateLimit'
import { clientIpFromHeaders } from '@/lib/clientIp'
import { validateStrongPassword } from '@/lib/passwordPolicy'
import { clearLoginLockout } from '@/lib/auth'
import { sendPasswordChangedEmail } from '@/lib/mailer'
import { logActivity } from '@/lib/logActivity'
import { hashToken, dhakaStamp } from '@/lib/passwordReset'

const expired = () => NextResponse.json(
  { error: 'Your reset session expired. Request a new code.', code: 'EXPIRED' },
  { status: 400 },
)

// POST /api/account-recovery/reset  { token, password }
// Sets the new password with the token issued by /verify. Single use; signs the
// account out everywhere else and sends a security notice.
export async function POST(request) {
  const ip = clientIpFromHeaders(h => request.headers.get(h), 'unknown')
  const rl = hit(`pwreset:reset:${ip}`, 20, 15 * 60 * 1000)
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${Math.ceil(rl.retryAfter / 60)} min.` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    )
  }

  const body     = await request.json().catch(() => ({}))
  const token    = typeof body?.token === 'string' ? body.token.trim() : ''
  const password = body?.password
  if (!token || token.length > 200) return expired()

  const pwError = validateStrongPassword(password)
  if (pwError) return NextResponse.json({ error: pwError }, { status: 422 })

  try {
    await connectDB()
    const tokenHash = hashToken(token)
    const user = await User.findOne({
      resetTokenHash: tokenHash, resetTokenExpiry: { $gt: new Date() }, isActive: true,
    }).select('_id email name role phone').lean()
    if (!user) return expired()

    const hashed    = await bcrypt.hash(password, 12)
    const changedAt = new Date()
    const done = await User.findOneAndUpdate(
      { _id: user._id, resetTokenHash: tokenHash, resetTokenExpiry: { $gt: changedAt } },
      { $set: {
        password:           hashed,
        passwordChangedAt:  changedAt,
        mustChangePassword: false,
        resetTokenHash: null, resetTokenExpiry: null,
        resetOtp: null, resetOtpExpiry: null, resetOtpAttempts: 0,
        // Retire every other way in that predates the new password.
        loginOtp: null, loginOtpExpiry: null,
        activationToken: null, activationTokenExpiry: null,
        passwordResetToken: null, passwordResetExpiry: null,
      } },
      { projection: { _id: 1 } },
    ).lean()
    if (!done) return expired()

    // Close out any request still sitting in the old staff-approval queue.
    PasswordResetRequest.updateMany(
      { userId: user._id, status: { $in: ['PENDING', 'APPROVED'] } },
      { $set: { status: 'COMPLETED' } },
    ).catch(err => console.warn('[account-recovery/reset] queue cleanup failed:', err.message))

    const clientCodes = user.role === 'CLIENT'
      ? (await Client.find({ userId: user._id }).select('clientCode').lean()).map(c => c.clientCode)
      : []
    clearLoginLockout({ email: user.email, phone: user.phone, clientCodes })

    sendPasswordChangedEmail({ to: user.email, name: user.name, changedAt: dhakaStamp(changedAt) })
      .catch(err => console.warn('[account-recovery/reset] notice email failed:', err.message))

    logActivity({
      userId: user._id.toString(), userRole: user.role,
      action: 'PASSWORD_RESET', entity: 'USER', entityId: user._id.toString(),
      changes: JSON.stringify({ method: 'EMAIL_CODE' }), request,
    })

    return NextResponse.json({ success: true, email: user.email })
  } catch (err) {
    console.error('[POST /api/account-recovery/reset]', err)
    return NextResponse.json({ error: 'Something went wrong. Try again.' }, { status: 500 })
  }
}
