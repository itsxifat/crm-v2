export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { User } from '@/models'

// GET /api/users/:userId
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const allowed = ['SUPER_ADMIN', 'MANAGER']
    if (!allowed.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const { userId } = await params
    const user = await User.findById(userId).select('-password').lean()
    if (!user) return NextResponse.json({ error: 'User not found' }, { status: 404 })

    return NextResponse.json({
      data: {
        id:        user._id.toString(),
        name:      user.name,
        email:     user.email,
        role:      user.role,
        avatar:    user.avatar ?? null,
        phone:     user.phone ?? null,
        isActive:  user.isActive,
        lastLogin: user.lastLogin ?? null,
        createdAt: user.createdAt,
      },
    })
  } catch (err) {
    console.error('[GET /api/users/:userId]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
