export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Notification } from '@/models'

// PATCH /api/notifications/[id] – mark single notification as read
export async function PATCH(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const notif = await Notification.findOneAndUpdate(
      { _id: params.id, userId: session.user.id },
      { isRead: true },
      { new: true }
    )

    if (!notif) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ data: notif })
  } catch (err) {
    console.error('[PATCH /api/notifications/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/notifications/[id]
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()
    await Notification.findOneAndDelete({ _id: params.id, userId: session.user.id })
    return NextResponse.json({ success: true })
  } catch (err) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
