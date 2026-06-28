export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import { User, CompanyMembership, PasswordResetRequest } from '@/models'

// POST /api/account-recovery/request  { email }
// A client asks for a password reset. We DON'T email anything or reveal whether
// the account exists — the request is queued for staff approval.
export async function POST(request) {
  try {
    await connectDB()
    const { email } = await request.json()
    const normalized = String(email ?? '').trim().toLowerCase()

    const generic = NextResponse.json({
      success: true,
      message: 'If an account exists for that email, your reset request has been submitted for review.',
    })

    if (!normalized) return generic

    const user = await User.findOne({ email: normalized, role: 'CLIENT' }).select('_id email isActive').lean()
    if (!user) return generic

    // Skip duplicate pending requests.
    const pending = await PasswordResetRequest.findOne({ userId: user._id, status: 'PENDING' }).lean()
    if (pending) return generic

    const membership = await CompanyMembership.findOne({ userId: user._id, status: 'ACTIVE' }).select('clientId').lean()

    await PasswordResetRequest.create({
      userId:   user._id,
      clientId: membership?.clientId ?? null,
      email:    user.email,
      status:   'PENDING',
    })

    return generic
  } catch (err) {
    console.error('[POST /api/account-recovery/request]', err)
    // Still return generic success to avoid leaking anything.
    return NextResponse.json({ success: true, message: 'Your request has been submitted.' })
  }
}
