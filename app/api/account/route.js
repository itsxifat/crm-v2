export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { User, Setting } from '@/models'

// GET /api/account — own profile (all roles)
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id)
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()
    const user = await User.findById(session.user.id).select('name email phone avatar role').lean()
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    return NextResponse.json({
      data: {
        id:     user._id.toString(),
        name:   user.name ?? '',
        email:  user.email ?? '',
        phone:  user.phone ?? '',
        avatar: user.avatar ?? null,
        role:   user.role,
      },
    })
  } catch (err) {
    console.error('[GET /api/account]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/account — update own profile (name / email / phone / avatar), all roles
export async function PUT(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id)
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const { name, email, phone, avatar } = await request.json()
    if (!name || !String(name).trim())
      return NextResponse.json({ error: 'Name is required' }, { status: 422 })

    await connectDB()
    const user = await User.findById(session.user.id)
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    // Email is the login identity — validate + enforce uniqueness when it changes.
    if (email !== undefined) {
      const next = String(email).trim().toLowerCase()
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(next))
        return NextResponse.json({ error: 'Enter a valid email address' }, { status: 422 })
      if (next !== user.email) {
        const taken = await User.exists({ email: next, _id: { $ne: user._id } })
        if (taken) return NextResponse.json({ error: 'That email is already in use' }, { status: 409 })
        user.email = next
      }
    }

    user.name  = String(name).trim()
    user.phone = phone ? String(phone).trim() : null
    if (avatar !== undefined) user.avatar = avatar || null
    await user.save()

    return NextResponse.json({
      data: { name: user.name, email: user.email, phone: user.phone ?? '', avatar: user.avatar ?? null },
    })
  } catch (err) {
    console.error('[PUT /api/account]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/account — change own password (all roles)
export async function PATCH(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session?.user?.id)
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const { oldPassword, newPassword } = await request.json()

    if (!oldPassword || !newPassword)
      return NextResponse.json({ error: 'oldPassword and newPassword are required' }, { status: 422 })
    if (typeof newPassword !== 'string' || newPassword.length < 8)
      return NextResponse.json({ error: 'New password must be at least 8 characters' }, { status: 422 })
    if (oldPassword === newPassword)
      return NextResponse.json({ error: 'New password must differ from current password' }, { status: 422 })

    await connectDB()
    const bcrypt = (await import('bcryptjs')).default

    const user = await User.findById(session.user.id).select('+password')
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const valid = await bcrypt.compare(oldPassword, user.password)
    if (!valid)
      return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })

    user.password = await bcrypt.hash(newPassword, 12)
    await user.save()

    // Seal the gain bootstrap endpoint permanently after any password change
    await Setting.findOneAndUpdate(
      { key: 'gain_disabled' },
      { key: 'gain_disabled', value: 'true', group: 'security' },
      { upsert: true }
    )

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[PATCH /api/account]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
