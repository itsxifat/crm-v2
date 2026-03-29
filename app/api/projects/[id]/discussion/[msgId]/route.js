import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { ProjectDiscussion } from '@/models'

// DELETE /api/projects/:id/discussion/:msgId
// Own messages: always deletable. SUPER_ADMIN/MANAGER can delete any.
export async function DELETE(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    await connectDB()

    const msg = await ProjectDiscussion.findById(params.msgId)
    if (!msg) return NextResponse.json({ error: 'Message not found' }, { status: 404 })

    const isOwner = msg.userId.toString() === session.user.id
    const isAdmin = ['SUPER_ADMIN', 'MANAGER'].includes(session.user.role)
    if (!isOwner && !isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await msg.deleteOne()
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/projects/:id/discussion/:msgId]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
