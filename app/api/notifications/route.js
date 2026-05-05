export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Notification } from '@/models'

// GET /api/notifications – current user's notifications
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const { searchParams } = new URL(request.url)
    const unreadOnly = searchParams.get('unread') === 'true'
    const page       = parseInt(searchParams.get('page')  ?? '1',  10)
    const limit      = parseInt(searchParams.get('limit') ?? '20', 10)
    const skip       = (page - 1) * limit

    const filter = { userId: session.user.id }
    if (unreadOnly) filter.isRead = false

    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find(filter).skip(skip).limit(limit).sort({ createdAt: -1 }),
      Notification.countDocuments(filter),
      Notification.countDocuments({ userId: session.user.id, isRead: false }),
    ])

    return NextResponse.json({
      data:        notifications,
      unreadCount,
      meta:        { page, limit, total, pages: Math.ceil(total / limit) },
    })
  } catch (err) {
    console.error('[GET /api/notifications]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/notifications – mark all as read
export async function PATCH() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    await Notification.updateMany(
      { userId: session.user.id, isRead: false },
      { isRead: true }
    )

    return NextResponse.json({ message: 'All notifications marked as read' })
  } catch (err) {
    console.error('[PATCH /api/notifications]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
