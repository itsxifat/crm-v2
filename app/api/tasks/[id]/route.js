export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Task, Timesheet, Comment, Attachment, Employee, Freelancer } from '@/models'
import { canDo, requirePerm, requireStaff } from '@/lib/rbac'
import { getMyCompanyIds } from '@/lib/clientAccess'
import { isValidObjectId } from '@/lib/objectId'
import { TASK_ASSIGNEE_SELECT, isStaff } from '@/lib/taskAccess'
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

const ASSIGNEE_POPULATE = [
  { path: 'assignedEmployeeId',   select: TASK_ASSIGNEE_SELECT, populate: { path: 'userId', select: 'id name avatar' } },
  { path: 'assignedFreelancerId', select: TASK_ASSIGNEE_SELECT, populate: { path: 'userId', select: 'id name avatar' } },
]

// GET /api/tasks/[id]
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE', 'FREELANCER', 'CLIENT'].includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

    await connectDB()

    const task = await Task.findById(params.id)
      .populate({ path: 'projectId', select: 'id name currency clientId' })
      .populate(ASSIGNEE_POPULATE[0])
      .populate(ASSIGNEE_POPULATE[1])

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
      // Must be client-visible AND belong to one of the caller's companies.
      const myCompanyIds = await getMyCompanyIds(session.user.id)
      const projectClientId = task.projectId?.clientId
      const ownsProject = projectClientId && myCompanyIds.some(id => String(id) === String(projectClientId))
      if (!task.isClientVisible || !ownsProject) {
        return NextResponse.json({ error: 'Task not found' }, { status: 404 })
      }
    }

    // Internal comments and timesheets are for staff only.
    const staff = isStaff(session)
    const commentFilter = { taskId: params.id }
    if (!staff) commentFilter.isInternal = { $ne: true }

    const [timesheets, comments, attachments, commentCount, attachmentCount, timesheetCount] = await Promise.all([
      staff
        ? Timesheet.find({ taskId: params.id })
          .sort({ date: -1 })
          .populate({ path: 'employeeId',   select: TASK_ASSIGNEE_SELECT, populate: { path: 'userId', select: 'name avatar' } })
          .populate({ path: 'freelancerId', select: TASK_ASSIGNEE_SELECT, populate: { path: 'userId', select: 'name avatar' } })
        : [],
      Comment.find(commentFilter)
        .sort({ createdAt: 1 })
        .populate({ path: 'authorId', select: 'id name avatar role' }),
      Attachment.find({ taskId: params.id }).sort({ createdAt: -1 }),
      Comment.countDocuments(commentFilter),
      Attachment.countDocuments({ taskId: params.id }),
      staff ? Timesheet.countDocuments({ taskId: params.id }) : 0,
    ])

    const taskJson = task.toJSON()
    if (taskJson.projectId && typeof taskJson.projectId === 'object') delete taskJson.projectId.clientId

    return NextResponse.json({
      data: {
        ...taskJson,
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
    const notStaff = requireStaff(session)
    if (notStaff) return notStaff
    const denied = requirePerm(session, 'tasks.update')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

    await connectDB()

    const body   = await request.json()
    const parsed = updateTaskSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    const data = { ...parsed.data }
    if (data.dueDate) data.dueDate = new Date(data.dueDate)
    // Freelancer assignment on tasks is deprecated — never settable here.
    delete data.assignedFreelancerId
    if (data.assignedEmployeeId && !isValidObjectId(data.assignedEmployeeId))
      return NextResponse.json({ error: 'Invalid assignee' }, { status: 400 })

    // Employees may only edit tasks assigned to them.
    const filter = { _id: params.id }
    if (session.user.role === 'EMPLOYEE') {
      const employee = await Employee.findOne({ userId: session.user.id }).select('_id').lean()
      if (!employee) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      filter.assignedEmployeeId = employee._id
    }

    const current = await Task.findOne(filter).select('assignedEmployeeId').lean()
    if (!current) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

    // Only an actual change of assignee counts as (re)assignment.
    const assigneeChanged = data.assignedEmployeeId !== undefined &&
      String(current.assignedEmployeeId ?? '') !== String(data.assignedEmployeeId ?? '')
    if (!assigneeChanged) {
      delete data.assignedEmployeeId
    } else {
      if (!canDo(session, 'tasks.assign'))
        return NextResponse.json({ error: 'You do not have permission to assign tasks' }, { status: 403 })
      // (Re)assigning to an employee resets the acceptance flow.
      data.assignmentStatus = 'ASSIGNED'
      data.acceptedAt = null
      data.declinedAt = null
    }

    const task = await Task.findOneAndUpdate(filter, data, { new: true })
      .populate(ASSIGNEE_POPULATE[0])
      .populate(ASSIGNEE_POPULATE[1])
    if (!task) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

    // Notify the (new) assignee so the task surfaces for them to accept.
    if (assigneeChanged && data.assignedEmployeeId && task.assignedEmployeeId?.userId) {
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

    const denied = requirePerm(session, 'tasks.delete')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

    await connectDB()
    const deleted = await Task.findByIdAndDelete(params.id)
    if (!deleted) return NextResponse.json({ error: 'Task not found' }, { status: 404 })

    // Cascade: nothing should keep pointing at a deleted task.
    await Promise.all([
      Comment.deleteMany({ taskId: deleted._id }),
      Timesheet.deleteMany({ taskId: deleted._id }),
      Attachment.deleteMany({ taskId: deleted._id }),
    ])

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'DELETE',
      entity:   'TASK',
      entityId: params.id,
      changes:  JSON.stringify({ title: deleted.title }),
      request,
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/tasks/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
