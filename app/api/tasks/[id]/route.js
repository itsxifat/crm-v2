export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Task, Timesheet, Comment, Attachment, Employee, Freelancer } from '@/models'
import { canAccess } from '@/lib/permissions'
import { logActivity } from '@/lib/logActivity'
import { createNotification } from '@/lib/createNotification'
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

    // Enforce visibility by role
    const { role } = session.user
    if (role === 'EMPLOYEE') {
      const employee = await Employee.findOne({ userId: session.user.id }).lean()
      const assignedId = task.assignedEmployeeId?._id ?? task.assignedEmployeeId
      if (!employee || assignedId?.toString() !== employee._id.toString()) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    } else if (role === 'FREELANCER') {
      const freelancer = await Freelancer.findOne({ userId: session.user.id }).lean()
      const assignedId = task.assignedFreelancerId?._id ?? task.assignedFreelancerId
      if (!freelancer || assignedId?.toString() !== freelancer._id.toString()) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    } else if (role === 'CLIENT') {
      if (!task.isClientVisible) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

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
    if (!canAccess(session, 'tasks', 'update'))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await connectDB()

    const body   = await request.json()
    const parsed = updateTaskSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    const data = { ...parsed.data }
    if (data.dueDate) data.dueDate = new Date(data.dueDate)

    // (Re)assigning to an employee resets the acceptance flow.
    if (data.assignedEmployeeId !== undefined) {
      data.assignmentStatus = 'ASSIGNED'
      data.acceptedAt = null
      data.declinedAt = null
    }

    const task = await Task.findByIdAndUpdate(params.id, data, { new: true })
      .populate({ path: 'assignedEmployeeId',   populate: { path: 'userId', select: 'id name avatar' } })
      .populate({ path: 'assignedFreelancerId', populate: { path: 'userId', select: 'id name avatar' } })

    // Notify the (new) assignee so the task surfaces for them to accept.
    if (data.assignedEmployeeId && task?.assignedEmployeeId?.userId) {
      const uid = task.assignedEmployeeId.userId._id ?? task.assignedEmployeeId.userId.id
      if (uid) {
        createNotification({
          userId:  uid.toString(),
          title:   'Task assigned to you',
          message: `You've been assigned "${task.title}". Review and accept it.`,
          type:    'TASK',
          link:    '/admin/tasks',
        }).catch(() => {})
      }
    }

    const [commentCount, attachmentCount] = await Promise.all([
      Comment.countDocuments({ taskId: params.id }),
      Attachment.countDocuments({ taskId: params.id }),
    ])

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   data.status ? 'STATUS_CHANGE' : 'UPDATE',
      entity:   'TASK',
      entityId: params.id,
      changes:  JSON.stringify({ title: task?.title, ...(data.status ? { status: data.status } : {}) }),
      request,
    })

    return NextResponse.json({
      data: { ...task.toJSON(), _count: { comments: commentCount, attachments: attachmentCount } },
    })
  } catch (err) {
    console.error('[PUT /api/tasks/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/tasks/[id] — assignee accepts or declines the task.
export async function PATCH(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()
    const { action } = await request.json()
    if (!['accept', 'decline'].includes(action)) {
      return NextResponse.json({ error: 'action must be "accept" or "decline"' }, { status: 422 })
    }

    const task = await Task.findById(params.id)
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

    // Only the assigned employee (or a manager/admin) may accept/decline.
    const isManager = ['SUPER_ADMIN', 'MANAGER'].includes(session.user.role)
    if (!isManager) {
      const employee = await Employee.findOne({ userId: session.user.id }).select('_id').lean()
      if (!employee || String(task.assignedEmployeeId) !== String(employee._id)) {
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      }
    }

    if (action === 'accept') {
      task.assignmentStatus = 'ACCEPTED'
      task.acceptedAt = new Date()
    } else {
      task.assignmentStatus = 'DECLINED'
      task.declinedAt = new Date()
    }
    await task.save()

    return NextResponse.json({ data: task.toJSON() })
  } catch (err) {
    console.error('[PATCH /api/tasks/[id]]', err)
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
    const deleted = await Task.findByIdAndDelete(params.id)

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'DELETE',
      entity:   'TASK',
      entityId: params.id,
      changes:  deleted ? JSON.stringify({ title: deleted.title }) : null,
      request,
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/tasks/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
