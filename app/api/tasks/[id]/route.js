import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Task, Timesheet, Comment, Attachment } from '@/models'
import { z } from 'zod'

const updateTaskSchema = z.object({
  title:                z.string().min(1).optional(),
  description:          z.string().optional().nullable(),
  status:               z.enum(['TODO','IN_PROGRESS','IN_REVIEW','COMPLETED','CANCELLED']).optional(),
  priority:             z.enum(['LOW','MEDIUM','HIGH','URGENT']).optional(),
  dueDate:              z.string().optional().nullable(),
  estimatedHours:       z.number().positive().optional().nullable(),
  actualHours:          z.number().optional().nullable(),
  assignedEmployeeId:   z.string().optional().nullable(),
  assignedFreelancerId: z.string().optional().nullable(),
  isClientVisible:      z.boolean().optional(),
  position:             z.number().int().optional(),
  tags:                 z.string().optional().nullable(),
})

// GET /api/tasks/[id]
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const task = await Task.findById(params.id)
      .populate({ path: 'projectId', select: 'id name currency' })
      .populate({ path: 'assignedEmployeeId',   populate: { path: 'userId', select: 'id name avatar email' } })
      .populate({ path: 'assignedFreelancerId', populate: { path: 'userId', select: 'id name avatar email' } })

    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

    const [timesheets, comments, attachments, commentCount, attachmentCount, timesheetCount] = await Promise.all([
      Timesheet.find({ taskId: params.id })
        .sort({ date: -1 })
        .populate({ path: 'employeeId',   populate: { path: 'userId', select: 'name avatar' } })
        .populate({ path: 'freelancerId', populate: { path: 'userId', select: 'name avatar' } }),
      Comment.find({ taskId: params.id })
        .sort({ createdAt: 1 })
        .populate({ path: 'authorId', select: 'id name avatar role' }),
      Attachment.find({ taskId: params.id }).sort({ createdAt: -1 }),
      Comment.countDocuments({ taskId: params.id }),
      Attachment.countDocuments({ taskId: params.id }),
      Timesheet.countDocuments({ taskId: params.id }),
    ])

    return NextResponse.json({
      data: {
        ...task.toJSON(),
        timesheets,
        comments,
        attachments,
        _count: { comments: commentCount, attachments: attachmentCount, timesheets: timesheetCount },
      },
    })
  } catch (err) {
    console.error('[GET /api/tasks/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/tasks/[id]
export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const body   = await request.json()
    const parsed = updateTaskSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    const data = { ...parsed.data }
    if (data.dueDate) data.dueDate = new Date(data.dueDate)

    const task = await Task.findByIdAndUpdate(params.id, data, { new: true })
      .populate({ path: 'assignedEmployeeId',   populate: { path: 'userId', select: 'id name avatar' } })
      .populate({ path: 'assignedFreelancerId', populate: { path: 'userId', select: 'id name avatar' } })

    const [commentCount, attachmentCount] = await Promise.all([
      Comment.countDocuments({ taskId: params.id }),
      Attachment.countDocuments({ taskId: params.id }),
    ])

    return NextResponse.json({
      data: { ...task.toJSON(), _count: { comments: commentCount, attachments: attachmentCount } },
    })
  } catch (err) {
    console.error('[PUT /api/tasks/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/tasks/[id]
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const allowedRoles = ['SUPER_ADMIN', 'MANAGER']
    if (!allowedRoles.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()
    await Task.findByIdAndDelete(params.id)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/tasks/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
