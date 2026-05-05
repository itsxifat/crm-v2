export const dynamic = 'force-dynamic'

import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { User, Setting } from '@/models'

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
