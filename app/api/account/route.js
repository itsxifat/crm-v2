export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { User, Setting } from '@/models'
import { validateStrongPassword } from '@/lib/passwordPolicy'

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
        // The login email is an identity claim that staff onboarding flows trust
        // (existing accounts are linked to companies by email). Without a
        // verification step, only a SUPER_ADMIN may change their own; everyone
        // else asks an administrator.
        if (session.user.role !== 'SUPER_ADMIN')
          return NextResponse.json({ error: 'Your login email can only be changed by an administrator' }, { status: 403 })
        const taken = await User.exists({ email: next, _id: { $ne: user._id } })
        if (taken) return NextResponse.json({ error: 'That email is already in use' }, { status: 409 })
        user.email = next
      }
    }

    // Phone is also a login identifier — require a real phone number (digits,
    // spaces, dashes, optional leading +) so it can never shadow a Client ID, and
    // keep it unique so it cannot hijack another account's phone login.
    const nextPhone = phone ? String(phone).trim() : null
    if (nextPhone && nextPhone !== user.phone) {
      if (!/^\+?[0-9][0-9\s-]{5,19}$/.test(nextPhone))
        return NextResponse.json({ error: 'Enter a valid phone number' }, { status: 422 })
      const phoneTaken = await User.exists({ phone: nextPhone, _id: { $ne: user._id } })
      if (phoneTaken) return NextResponse.json({ error: 'That phone number is already in use' }, { status: 409 })
    }

    user.name  = String(name).trim()
    user.phone = nextPhone
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
    const pwError = validateStrongPassword(typeof newPassword === 'string' ? newPassword : '')
    if (pwError)
      return NextResponse.json({ error: pwError }, { status: 422 })
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
