export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Comment } from '@/models'
import { z } from 'zod'

const commentSchema = z.object({
  content:    z.string().min(1),
  isInternal: z.boolean().default(true),
})

// GET /api/tasks/[id]/comments
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const comments = await Comment.find({ taskId: params.id })
      .sort({ createdAt: 1 })
      .populate({ path: 'authorId', select: 'id name avatar role' })

    return NextResponse.json({ data: comments })
  } catch (err) {
    console.error('[GET /api/tasks/[id]/comments]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/tasks/[id]/comments
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const body   = await request.json()
    const parsed = commentSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    const comment = await new Comment({
      ...parsed.data,
      taskId:   params.id,
      authorId: session.user.id,
    }).save()

    await comment.populate({ path: 'authorId', select: 'id name avatar role' })

    return NextResponse.json({ data: comment }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/tasks/[id]/comments]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
