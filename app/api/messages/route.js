export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Message, User } from '@/models'
import { isValidObjectId } from '@/lib/objectId'

const STAFF_ROLES = ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE']
const isStaff = role => STAFF_ROLES.includes(role)

// Populate spec for message participants. External users are not shown the
// other party's role.
function participantSelect(session) {
  return isStaff(session.user.role) ? 'id name avatar role' : 'id name avatar'
}

// GET /api/messages?userId=xxx — get messages between current user and userId
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const { searchParams } = new URL(request.url)
    const otherUserId = searchParams.get('userId')
    if (otherUserId && !isValidObjectId(otherUserId)) {
      return NextResponse.json({ error: 'Invalid userId' }, { status: 400 })
    }
    const page  = Math.max(1, parseInt(searchParams.get('page')  ?? '1',  10) || 1)
    const limit = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10) || 50))
    const skip  = (page - 1) * limit
    const select = participantSelect(session)

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

    // Page backwards from the newest message (page 1 = latest `limit`), then
    // return that page in chronological order for display.
    const [newestFirst, total] = await Promise.all([
      Message.find(filter)
        .sort({ createdAt: -1, _id: -1 })
        .skip(skip)
        .limit(limit)
        .populate({ path: 'senderId',   select })
        .populate({ path: 'receiverId', select }),
      Message.countDocuments(filter),
    ])
    const messages = newestFirst.reverse()

    // Mark as read only the messages actually returned to the reader.
    if (otherUserId && messages.length) {
      await Message.updateMany(
        { _id: { $in: messages.map(m => m._id) }, senderId: otherUserId, receiverId: session.user.id, isRead: false },
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

    if (!receiverId || typeof content !== 'string' || !content.trim()) {
      return NextResponse.json({ error: 'receiverId and content are required' }, { status: 422 })
    }
    if (!isValidObjectId(receiverId) || String(receiverId) === String(session.user.id)) {
      return NextResponse.json({ error: 'Invalid receiverId' }, { status: 400 })
    }

    // Who may message whom: staff may message any active user; external users
    // (CLIENT / FREELANCER / VENDOR) may only message active staff — never other
    // clients, freelancers or vendors (no cross-tenant DMs).
    const receiver = await User.findById(receiverId).select('role isActive').lean()
    if (!receiver || !receiver.isActive) {
      return NextResponse.json({ error: 'Recipient not found' }, { status: 404 })
    }
    if (!isStaff(session.user.role) && !isStaff(receiver.role)) {
      return NextResponse.json({ error: 'Recipient not found' }, { status: 404 })
    }

    const message = await new Message({
      senderId:   session.user.id,
      receiverId,
      content:    content.trim(),
    }).save()

    const select = participantSelect(session)
    await message.populate([
      { path: 'senderId',   select },
      { path: 'receiverId', select },
    ])

    return NextResponse.json({ data: message }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/messages]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
