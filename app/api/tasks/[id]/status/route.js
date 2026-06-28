export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Task, Comment, Attachment } from '@/models'
import { canAccess } from '@/lib/permissions'
import { logActivity } from '@/lib/logActivity'
import { z } from 'zod'

const statusSchema = z.object({
  status:   z.enum(['TODO','IN_PROGRESS','IN_REVIEW','COMPLETED','CANCELLED']),
  position: z.number().int().optional(),
})

// PATCH /api/tasks/[id]/status
export async function PATCH(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canAccess(session, 'tasks', 'update'))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await connectDB()

    const body   = await request.json()
    const parsed = statusSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    const { status, position } = parsed.data
    const updateData = { status }
    if (position !== undefined) updateData.position = position

    const task = await Task.findByIdAndUpdate(params.id, updateData, { new: true })
      .populate({ path: 'assignedEmployeeId',   populate: { path: 'userId', select: 'id name avatar' } })
      .populate({ path: 'assignedFreelancerId', populate: { path: 'userId', select: 'id name avatar' } })

    const [commentCount, attachmentCount] = await Promise.all([
      Comment.countDocuments({ taskId: params.id }),
      Attachment.countDocuments({ taskId: params.id }),
    ])

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'STATUS_CHANGE',
      entity:   'TASK',
      entityId: params.id,
      changes:  JSON.stringify({ title: task?.title, status }),
      request,
    })

    return NextResponse.json({
      data: { ...task.toJSON(), _count: { comments: commentCount, attachments: attachmentCount } },
    })
  } catch (err) {
    console.error('[PATCH /api/tasks/[id]/status]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
