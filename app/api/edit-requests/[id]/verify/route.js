import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { EditRequest } from '@/models'

// POST /api/edit-requests/[id]/verify  — verify OTP
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const { otp } = await request.json()
    if (!otp) return NextResponse.json({ valid: false, error: 'OTP is required' }, { status: 400 })

    await connectDB()

    const doc = await EditRequest.findById(params.id)
    if (!doc)
      return NextResponse.json({ valid: false, error: 'Edit request not found' }, { status: 404 })

    if (doc.status !== 'APPROVED')
      return NextResponse.json({ valid: false, error: 'This request has not been approved' }, { status: 400 })

    if (doc.otpUsed)
      return NextResponse.json({ valid: false, error: 'OTP has already been used' }, { status: 400 })

    if (!doc.otpExpiry || new Date() > doc.otpExpiry)
      return NextResponse.json({ valid: false, error: 'OTP has expired' }, { status: 400 })

    if (doc.otp !== String(otp).trim())
      return NextResponse.json({ valid: false, error: 'Invalid OTP' }, { status: 400 })

    // Mark as used
    doc.otpUsed = true
    await doc.save()

    return NextResponse.json({ valid: true })
  } catch (err) {
    console.error('[edit-requests verify POST]', err)
    return NextResponse.json({ valid: false, error: err.message ?? 'Server error' }, { status: 500 })
  }
}
