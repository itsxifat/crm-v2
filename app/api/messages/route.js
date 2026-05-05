export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Message } from '@/models'

// GET /api/messages?userId=xxx — get messages between current user and userId
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const { searchParams } = new URL(request.url)
    const otherUserId = searchParams.get('userId')
    const page  = parseInt(searchParams.get('page')  ?? '1',  10)
    const limit = parseInt(searchParams.get('limit') ?? '50', 10)
    const skip  = (page - 1) * limit

    const filter = otherUserId
      ? {
          $or: [
            { senderId: session.user.id, receiverId: otherUserId },
            { senderId: otherUserId,     receiverId: session.user.id },
          ],
        }
      : {
          $or: [
            { senderId:   session.user.id },
            { receiverId: session.user.id },
          ],
        }

    const [messages, total] = await Promise.all([
      Message.find(filter)
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: 1 })
        .populate({ path: 'senderId',   select: 'id name avatar role' })
        .populate({ path: 'receiverId', select: 'id name avatar role' }),
      Message.countDocuments(filter),
    ])

    // Mark messages as read
    if (otherUserId) {
      await Message.updateMany(
        { senderId: otherUserId, receiverId: session.user.id, isRead: false },
        { isRead: true }
      )
    }

    return NextResponse.json({
      data: messages,
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  } catch (err) {
    console.error('[GET /api/messages]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/messages
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const body = await request.json()
    const { receiverId, content } = body

    if (!receiverId || !content?.trim()) {
      return NextResponse.json({ error: 'receiverId and content are required' }, { status: 422 })
    }

    const message = await new Message({
      senderId:   session.user.id,
      receiverId,
      content:    content.trim(),
    }).save()

    await message.populate([
      { path: 'senderId',   select: 'id name avatar role' },
      { path: 'receiverId', select: 'id name avatar role' },
    ])

    return NextResponse.json({ data: message }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/messages]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
