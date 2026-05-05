export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { EditRequest } from '@/models'

function generateOtp() {
  return String(Math.floor(100000 + Math.random() * 900000))
}

// PATCH /api/edit-requests/[id]  — approve or reject (SUPER_ADMIN only)
export async function PATCH(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (session.user.role !== 'SUPER_ADMIN')
      return NextResponse.json({ error: 'Forbidden — only SUPER_ADMIN can review edit requests' }, { status: 403 })

    await connectDB()

    const doc = await EditRequest.findById(params.id)
    if (!doc) return NextResponse.json({ error: 'Edit request not found' }, { status: 404 })
    if (doc.status !== 'PENDING')
      return NextResponse.json({ error: 'Request has already been reviewed' }, { status: 400 })

    const { action, reviewNote } = await request.json()

    if (action === 'APPROVE') {
      const otp = generateOtp()
      doc.otp        = otp
      doc.otpExpiry  = new Date(Date.now() + 30 * 60 * 1000) // 30 mins
      doc.status     = 'APPROVED'
      doc.reviewedBy = session.user.id
      doc.reviewedAt = new Date()
      await doc.save()

      const json = doc.toJSON()
      // Return OTP in the response (visible to owner so they can share it with the manager)
      json.otp = otp
      return NextResponse.json({ data: json })
    }

    if (action === 'REJECT') {
      doc.status     = 'REJECTED'
      doc.reviewedBy = session.user.id
      doc.reviewedAt = new Date()
      doc.reviewNote = reviewNote ?? null
      await doc.save()

      return NextResponse.json({ data: doc.toJSON() })
    }

    return NextResponse.json({ error: 'Invalid action — use APPROVE or REJECT' }, { status: 400 })
  } catch (err) {
    console.error('[edit-requests PATCH]', err)
    return NextResponse.json({ error: err.message ?? 'Server error' }, { status: 500 })
  }
}
