export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { User } from '@/models'

// PATCH /api/client/profile — change own password
export async function PATCH(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || session.user.role !== 'CLIENT')
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const { oldPassword, newPassword } = await request.json()

    if (!oldPassword || !newPassword)
      return NextResponse.json({ error: 'oldPassword and newPassword are required' }, { status: 422 })
    if (newPassword.length < 8)
      return NextResponse.json({ error: 'New password must be at least 8 characters' }, { status: 422 })

    await connectDB()
    const bcrypt = (await import('bcryptjs')).default

    const user = await User.findById(session.user.id).select('+password')
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    const valid = await bcrypt.compare(oldPassword, user.password)
    if (!valid) return NextResponse.json({ error: 'Current password is incorrect' }, { status: 400 })

    user.password = await bcrypt.hash(newPassword, 10)
    await user.save()

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[PATCH /api/client/profile]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
