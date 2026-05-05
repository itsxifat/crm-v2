export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import Lead from '@/models/Lead'

// POST /api/leads/[id]/comments  — add a comment
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const { text } = await request.json()
    if (!text?.trim()) return NextResponse.json({ error: 'Comment text is required' }, { status: 422 })

    await connectDB()

    const lead = await Lead.findByIdAndUpdate(
      params.id,
      {
        $push: {
          comments: {
            text:       text.trim(),
            authorId:   session.user.id,
            authorName: session.user.name ?? session.user.email,
          },
        },
      },
      { new: true }
    )

    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    const added = lead.comments[lead.comments.length - 1]
    return NextResponse.json({ data: added }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/leads/[id]/comments]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/leads/[id]/comments?commentId=xxx  — remove a comment
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const { searchParams } = new URL(request.url)
    const commentId = searchParams.get('commentId')
    if (!commentId) return NextResponse.json({ error: 'commentId required' }, { status: 422 })

    await connectDB()

    const lead = await Lead.findById(params.id)
    if (!lead) return NextResponse.json({ error: 'Lead not found' }, { status: 404 })

    const comment = lead.comments.id(commentId)
    if (!comment) return NextResponse.json({ error: 'Comment not found' }, { status: 404 })

    // Only the author or an admin can delete
    const isOwner = comment.authorId.toString() === session.user.id
    const isAdmin = ['SUPER_ADMIN', 'MANAGER'].includes(session.user.role)
    if (!isOwner && !isAdmin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    comment.deleteOne()
    await lead.save()

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/leads/[id]/comments]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
