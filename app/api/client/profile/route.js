export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { User } from '@/models'
import { validateStrongPassword } from '@/lib/passwordPolicy'

// PATCH /api/client/profile — set/change own password
export async function PATCH(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || session.user.role !== 'CLIENT')
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const { oldPassword, newPassword } = await request.json()

    const pwError = validateStrongPassword(newPassword)
    if (pwError) return NextResponse.json({ error: pwError }, { status: 422 })

    await connectDB()
    const bcrypt = (await import('bcryptjs')).default

    const user = await User.findById(session.user.id).select('+password')
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    // First-time set (just activated via OTP) doesn't require the old password —
    // the authenticated session is sufficient. Voluntary changes still do.
    if (!user.mustChangePassword) {
      if (!oldPassword) return NextResponse.json({ error: 'Current password is required' }, { status: 422 })
      const valid = await bcrypt.compare(oldPassword, user.password)
      if (!valid) return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })
    }

    user.password = await bcrypt.hash(newPassword, 12)
    user.mustChangePassword = false
    await user.save()

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[PATCH /api/client/profile]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
