export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { requirePerm } from '@/lib/rbac'
import crypto from 'crypto'
import connectDB from '@/lib/mongodb'
import { User, PasswordResetRequest } from '@/models'
import { sendPasswordResetEmail } from '@/lib/mailer'
import { logActivity } from '@/lib/logActivity'
import { isValidObjectId } from '@/lib/objectId'

// PATCH /api/password-reset-requests/[id]  { action: 'approve' | 'reject', note? }
export async function PATCH(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'sales.customers.passwordReset')
    if (denied) return denied

    await connectDB()

    const { action, note } = await request.json()
    if (!['approve', 'reject'].includes(action))
      return NextResponse.json({ error: 'action must be approve or reject' }, { status: 422 })

    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    const existing = await PasswordResetRequest.findById(params.id).select('status userId').lean()
    if (!existing) return NextResponse.json({ error: 'Request not found' }, { status: 404 })
    if (existing.status !== 'PENDING')
      return NextResponse.json({ error: `Request already ${existing.status.toLowerCase()}` }, { status: 409 })

    // Resolve the user before claiming so a missing account doesn't leave the
    // request stuck in APPROVED without a token.
    const user = action === 'approve' ? await User.findById(existing.userId) : null
    if (action === 'approve' && !user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    // Atomically claim the request — only one concurrent reviewer can move it out of PENDING.
    const reqDoc = await PasswordResetRequest.findOneAndUpdate(
      { _id: params.id, status: 'PENDING' },
      { $set: {
        status:     action === 'reject' ? 'REJECTED' : 'APPROVED',
        reviewedBy: session.user.id,
        reviewedAt: new Date(),
        note:       note || null,
      } },
      { new: true }
    )
    if (!reqDoc) return NextResponse.json({ error: 'Request already reviewed' }, { status: 409 })

    if (action === 'reject') {
      logActivity({
        userId: session.user.id, userRole: session.user.role,
        action: 'PASSWORD_RESET_REJECT', entity: 'CLIENT', entityId: reqDoc.clientId?.toString() ?? reqDoc.userId.toString(),
        changes: JSON.stringify({ email: reqDoc.email }), request,
      })
      return NextResponse.json({ success: true, status: 'REJECTED' })
    }

    // approve → issue a single-use 24h reset token + email the client a link
    const resetToken = crypto.randomBytes(32).toString('hex')
    user.passwordResetToken  = resetToken
    user.passwordResetExpiry = new Date(Date.now() + 24 * 60 * 60 * 1000)
    await user.save()

    let emailSent = false
    try {
      await sendPasswordResetEmail({
        to:   user.email,
        name: user.name,
        link: `${process.env.NEXT_PUBLIC_APP_URL}/reset-password/${resetToken}`,
      })
      emailSent = true
    } catch (e) {
      console.warn('[reset approve] email failed:', e.message)
    }

    logActivity({
      userId: session.user.id, userRole: session.user.role,
      action: 'PASSWORD_RESET_APPROVE', entity: 'CLIENT', entityId: reqDoc.clientId?.toString() ?? user._id.toString(),
      changes: JSON.stringify({ email: user.email, emailSent }), request,
    })

    return NextResponse.json({ success: true, status: 'APPROVED', emailSent })
  } catch (err) {
    console.error('[PATCH /api/password-reset-requests/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
