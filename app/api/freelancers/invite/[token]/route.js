import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import { User, Freelancer } from '@/models'
import bcrypt from 'bcryptjs'

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

    if (!password || password.length < 6) {
      return NextResponse.json({ error: 'Password must be at least 6 characters' }, { status: 422 })
    }

    const freelancer = await Freelancer.findOne({
      inviteToken: token,
      inviteTokenExpiry: { $gt: new Date() },
    }).populate({ path: 'userId', select: 'id email' })

    if (!freelancer) {
      return NextResponse.json({ valid: false, error: 'Invalid or expired invitation link' }, { status: 404 })
    }

    const hashedPassword = await bcrypt.hash(password, 12)

    await User.findByIdAndUpdate(freelancer.userId._id, { password: hashedPassword })

    freelancer.inviteAccepted    = true
    freelancer.inviteToken       = null
    freelancer.inviteTokenExpiry = null
    await freelancer.save()

    return NextResponse.json({ success: true, email: freelancer.userId.email })
  } catch (err) {
    console.error('[POST /api/freelancers/invite/[token]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
