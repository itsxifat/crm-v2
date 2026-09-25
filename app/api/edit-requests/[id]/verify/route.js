export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { requireStaff } from '@/lib/rbac'
import connectDB from '@/lib/mongodb'
import { EditRequest } from '@/models'
import { isValidObjectId } from '@/lib/objectId'

const MAX_OTP_ATTEMPTS = 5

// POST /api/edit-requests/[id]/verify  — verify OTP
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireStaff(session)
    if (denied) return denied

    const { otp } = await request.json()
    if (!otp) return NextResponse.json({ valid: false, error: 'OTP is required' }, { status: 400 })

    if (!isValidObjectId(params.id))
      return NextResponse.json({ valid: false, error: 'Edit request not found' }, { status: 404 })

    await connectDB()

    const doc = await EditRequest.findById(params.id)
    // Only the requester can redeem their OTP (others could otherwise burn it).
    if (!doc || String(doc.requesterId) !== String(session.user.id))
      return NextResponse.json({ valid: false, error: 'Edit request not found' }, { status: 404 })

    if (doc.status !== 'APPROVED')
      return NextResponse.json({ valid: false, error: 'This request has not been approved' }, { status: 400 })

    if (doc.otpUsed)
      return NextResponse.json({ valid: false, error: 'OTP has already been used' }, { status: 400 })

    if (!doc.otpExpiry || new Date() > doc.otpExpiry)
      return NextResponse.json({ valid: false, error: 'OTP has expired' }, { status: 400 })

    if ((doc.otpAttempts ?? 0) >= MAX_OTP_ATTEMPTS)
      return NextResponse.json({ valid: false, error: 'Too many attempts — please submit a new edit request' }, { status: 429 })

    if (doc.otp !== String(otp).trim()) {
      await EditRequest.updateOne({ _id: doc._id }, { $inc: { otpAttempts: 1 } })
      return NextResponse.json({ valid: false, error: 'Invalid OTP' }, { status: 400 })
    }

    // Mark as used — atomically, so the same OTP can't be redeemed twice.
    const used = await EditRequest.findOneAndUpdate(
      { _id: doc._id, otpUsed: { $ne: true }, otp: doc.otp },
      { $set: { otpUsed: true } }
    )
    if (!used)
      return NextResponse.json({ valid: false, error: 'OTP has already been used' }, { status: 400 })

    return NextResponse.json({ valid: true })
  } catch (err) {
    console.error('[edit-requests verify POST]', err)
    return NextResponse.json({ valid: false, error: err.message ?? 'Server error' }, { status: 500 })
  }
}
