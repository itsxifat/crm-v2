export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import { User, Freelancer } from '@/models'
import bcrypt from 'bcryptjs'
import { validateStrongPassword } from '@/lib/passwordPolicy'

// GET /api/freelancers/invite/[token] — public, validate token
export async function GET(request, { params }) {
  try {
    await connectDB()

    const { token } = await params

    const freelancer = await Freelancer.findOne({
      inviteToken: token,
      inviteTokenExpiry: { $gt: new Date() },
    }).populate({ path: 'userId', select: 'name email' }).lean()

    if (!freelancer) {
      return NextResponse.json({ valid: false, error: 'Invalid or expired invitation link' }, { status: 404 })
    }

    return NextResponse.json({
      valid: true,
      email: freelancer.userId?.email,
      name:  freelancer.userId?.name,
      type:  freelancer.type,
    })
  } catch (err) {
    console.error('[GET /api/freelancers/invite/[token]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/freelancers/invite/[token] — public, set password
export async function POST(request, { params }) {
  try {
    await connectDB()

    const { token } = await params
    const { password } = await request.json()

    const pwError = validateStrongPassword(typeof password === 'string' ? password : '')
    if (pwError) {
      return NextResponse.json({ error: pwError }, { status: 422 })
    }

    if (typeof token !== 'string' || !token) {
      return NextResponse.json({ valid: false, error: 'Invalid or expired invitation link' }, { status: 404 })
    }

    const hashedPassword = await bcrypt.hash(password, 12)

    // Consume the token atomically so it can only ever be used once.
    const freelancer = await Freelancer.findOneAndUpdate(
      { inviteToken: token, inviteTokenExpiry: { $gt: new Date() } },
      { $set: { inviteAccepted: true }, $unset: { inviteToken: '', inviteTokenExpiry: '' } },
      { new: true }
    ).populate({ path: 'userId', select: 'id email' })

    if (!freelancer || !freelancer.userId) {
      return NextResponse.json({ valid: false, error: 'Invalid or expired invitation link' }, { status: 404 })
    }

    await User.findByIdAndUpdate(freelancer.userId._id, { password: hashedPassword })

    return NextResponse.json({ success: true, email: freelancer.userId.email })
  } catch (err) {
    console.error('[POST /api/freelancers/invite/[token]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
