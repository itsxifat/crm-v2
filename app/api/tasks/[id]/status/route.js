export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Task, Comment, Attachment, Employee } from '@/models'
import { requirePerm, requireStaff } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { TASK_ASSIGNEE_SELECT } from '@/lib/taskAccess'
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
    const notStaff = requireStaff(session)
    if (notStaff) return notStaff
    const denied = requirePerm(session, 'tasks.update')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

    await connectDB()

    const body   = await request.json()
    const parsed = statusSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    const { status, position } = parsed.data
    const updateData = { status }
    if (position !== undefined) updateData.position = position

    // Employees may only move tasks assigned to them.
    const filter = { _id: params.id }
    if (session.user.role === 'EMPLOYEE') {
      const employee = await Employee.findOne({ userId: session.user.id }).select('_id').lean()
      if (!employee) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      filter.assignedEmployeeId = employee._id
    }

    const task = await Task.findOneAndUpdate(filter, updateData, { new: true })
      .populate({ path: 'assignedEmployeeId',   select: TASK_ASSIGNEE_SELECT, populate: { path: 'userId', select: 'id name avatar' } })
      .populate({ path: 'assignedFreelancerId', select: TASK_ASSIGNEE_SELECT, populate: { path: 'userId', select: 'id name avatar' } })
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

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
      changes:  JSON.stringify({ title: task.title, status }),
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
