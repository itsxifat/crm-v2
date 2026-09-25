export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import mongoose from 'mongoose'
import connectDB from '@/lib/mongodb'
import { Message } from '@/models'
import { isValidObjectId } from '@/lib/objectId'

// GET /api/messages/conversations
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const userId = session.user.id
    if (!isValidObjectId(userId)) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const messages = await Message.find({
      $or: [{ senderId: userId }, { receiverId: userId }],
    })
      .sort({ createdAt: -1 })
      .populate({ path: 'senderId',   select: 'id name avatar role' })
      .populate({ path: 'receiverId', select: 'id name avatar role' })

    // Build unique conversation list (latest message per conversation partner)
    const conversationMap = new Map()
    messages.forEach(msg => {
      const senderId   = msg.senderId?._id?.toString()   ?? msg.senderId?.toString()
      const receiverId = msg.receiverId?._id?.toString() ?? msg.receiverId?.toString()
      const partnerId  = senderId === userId ? receiverId : senderId
      const partner    = senderId === userId ? msg.receiverId : msg.senderId

      if (!conversationMap.has(partnerId)) {
        conversationMap.set(partnerId, {
          userId:      partnerId,
          user:        partner,
          lastMessage: msg,
          unreadCount: 0,
        })
      }
    })

    // Count unread messages per conversation. Aggregations are not cast by
    // Mongoose, so the session's string id must be converted to an ObjectId.
    const unreadAgg = await Message.aggregate([
      { $match: { receiverId: new mongoose.Types.ObjectId(userId), isRead: false } },
      { $group: { _id: '$senderId', count: { $sum: 1 } } },
    ])
    unreadAgg.forEach(u => {
      const conv = conversationMap.get(u._id.toString())
      if (conv) conv.unreadCount = u.count
    })

    const conversations = Array.from(conversationMap.values())
      .sort((a, b) => new Date(b.lastMessage.createdAt) - new Date(a.lastMessage.createdAt))

    return NextResponse.json({ data: conversations })
  } catch (err) {
    console.error('[GET /api/messages/conversations]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
