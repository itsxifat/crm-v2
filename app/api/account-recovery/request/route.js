export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import { User } from '@/models'
import { hit } from '@/lib/rateLimit'
import { clientIpFromHeaders } from '@/lib/clientIp'
import { sendPasswordResetCodeEmail } from '@/lib/mailer'
import { logActivity } from '@/lib/logActivity'
import {
  normalizeEmail, isValidEmail, findUserByEmail, generateCode, hashCode, dhakaStamp,
  OTP_TTL_MS, RESEND_COOLDOWN_MS, SEND_WINDOW_MS, MAX_SENDS_PER_WINDOW,
} from '@/lib/passwordReset'

// POST /api/account-recovery/request  { email }
// Emails a 6-digit reset code to any active account (staff, client, freelancer,
// vendor). The response is identical whether or not the account exists, and the
// email is sent in the background so timing doesn't reveal it either.
export async function POST(request) {
  const ip = clientIpFromHeaders(h => request.headers.get(h), 'unknown')
  const rl = hit(`pwreset:request:${ip}`, 10, 15 * 60 * 1000)
  if (!rl.ok) {
    return NextResponse.json(
      { error: `Too many requests. Try again in ${Math.ceil(rl.retryAfter / 60)} min.` },
      { status: 429, headers: { 'Retry-After': String(rl.retryAfter) } },
    )
  }

  const body  = await request.json().catch(() => ({}))
  const email = normalizeEmail(body?.email)
  if (!isValidEmail(email)) return NextResponse.json({ error: 'Enter a valid email address' }, { status: 422 })

  const generic = NextResponse.json({ success: true, cooldown: RESEND_COOLDOWN_MS / 1000 })

  try {
    await connectDB()
    const user = await findUserByEmail(email, '_id email name role isActive resetOtpSentAt resetOtpWindowStart resetOtpSendCount')
    if (!user || !user.isActive) return generic

    const now = new Date()
    if (user.resetOtpSentAt && now - new Date(user.resetOtpSentAt) < RESEND_COOLDOWN_MS) return generic

    let windowStart = user.resetOtpWindowStart ? new Date(user.resetOtpWindowStart) : null
    let sendCount   = user.resetOtpSendCount ?? 0
    if (!windowStart || now - windowStart > SEND_WINDOW_MS) { windowStart = now; sendCount = 0 }
    if (sendCount >= MAX_SENDS_PER_WINDOW) return generic

    const code = generateCode()
    // Conditional on resetOtpSentAt being unchanged, so two concurrent requests
    // can't both issue (and email) a code.
    const claimed = await User.findOneAndUpdate(
      { _id: user._id, resetOtpSentAt: user.resetOtpSentAt ?? null },
      { $set: {
        resetOtp:            hashCode(user._id.toString(), code),
        resetOtpExpiry:      new Date(now.getTime() + OTP_TTL_MS),
        resetOtpAttempts:    0,
        resetOtpSentAt:      now,
        resetOtpWindowStart: windowStart,
        resetOtpSendCount:   sendCount + 1,
        // A new code voids any half-finished reset.
        resetTokenHash:      null,
        resetTokenExpiry:    null,
      } },
      { projection: { _id: 1 } },
    ).lean()
    if (!claimed) return generic

    sendPasswordResetCodeEmail({
      to: user.email, name: user.name, code, minutes: OTP_TTL_MS / 60000, requestedAt: dhakaStamp(now),
    }).catch(err => console.warn('[account-recovery/request] email failed:', err.message))

    logActivity({
      userId: user._id.toString(), userRole: user.role,
      action: 'PASSWORD_RESET_CODE_SENT', entity: 'USER', entityId: user._id.toString(), request,
    })

    return generic
  } catch (err) {
    console.error('[POST /api/account-recovery/request]', err)
    return generic
  }
}
