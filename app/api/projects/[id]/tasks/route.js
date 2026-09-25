export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Task, Comment, Attachment, Timesheet, Employee, Freelancer, Project } from '@/models'
import { canAccess } from '@/lib/permissions'
import { canDo } from '@/lib/rbac'
import { getMyCompanyIds } from '@/lib/clientAccess'
import { isValidObjectId } from '@/lib/objectId'
import { TASK_ASSIGNEE_SELECT } from '@/lib/taskAccess'
import { createNotification } from '@/lib/createNotification'
import { z } from 'zod'

const createTaskSchema = z.object({
  title:                z.string().min(1),
  description:          z.string().optional().nullable(),
  status:               z.enum(['TODO','IN_PROGRESS','IN_REVIEW','COMPLETED','CANCELLED']).default('TODO'),
  priority:             z.enum(['LOW','MEDIUM','HIGH','URGENT']).default('MEDIUM'),
  dueDate:              z.string().optional().nullable(),
  estimatedHours:       z.number().positive().optional().nullable(),
  // Tasks are for in-house employees only.
  assignedEmployeeId:   z.string().optional().nullable(),
  isClientVisible:      z.boolean().default(false),
  tags:                 z.string().optional().nullable(),
})

// GET /api/projects/[id]/tasks
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const { role } = session.user
    if (!['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE', 'FREELANCER', 'CLIENT'].includes(role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')

    const filter = { projectId: params.id }
    if (status) filter.status = status

    if (role === 'EMPLOYEE') {
      const employee = await Employee.findOne({ userId: session.user.id }).lean()
      if (employee) filter.assignedEmployeeId = employee._id
      else filter._id = null // no employee record → show nothing
    } else if (role === 'FREELANCER') {
      const freelancer = await Freelancer.findOne({ userId: session.user.id }).lean()
      if (freelancer) filter.assignedFreelancerId = freelancer._id
      else filter._id = null
    } else if (role === 'CLIENT') {
      // Clients may only see client-visible tasks of their own companies' projects.
      const [project, myCompanyIds] = await Promise.all([
        Project.findById(params.id).select('clientId').lean(),
        getMyCompanyIds(session.user.id),
      ])
      const allowed = project?.clientId && myCompanyIds.some(id => String(id) === String(project.clientId))
      if (!allowed) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      filter.isClientVisible = true
    }

    const tasks = await Task.find(filter)
      .sort({ status: 1, position: 1, createdAt: 1 })
      .populate({ path: 'assignedEmployeeId',   select: TASK_ASSIGNEE_SELECT, populate: { path: 'userId', select: 'id name avatar' } })
      .populate({ path: 'assignedFreelancerId', select: TASK_ASSIGNEE_SELECT, populate: { path: 'userId', select: 'id name avatar' } })

    const taskIds = tasks.map(t => t._id)
    const [commentCounts, attachmentCounts, timesheetCounts] = await Promise.all([
      Comment.aggregate([{ $match: { taskId: { $in: taskIds } } }, { $group: { _id: '$taskId', count: { $sum: 1 } } }]),
      Attachment.aggregate([{ $match: { taskId: { $in: taskIds } } }, { $group: { _id: '$taskId', count: { $sum: 1 } } }]),
      Timesheet.aggregate([{ $match: { taskId: { $in: taskIds } } }, { $group: { _id: '$taskId', count: { $sum: 1 } } }]),
    ])
    const commentMap    = Object.fromEntries(commentCounts.map(c => [c._id.toString(), c.count]))
    const attachmentMap = Object.fromEntries(attachmentCounts.map(a => [a._id.toString(), a.count]))
    const timesheetMap  = Object.fromEntries(timesheetCounts.map(t => [t._id.toString(), t.count]))

    const enriched = tasks.map(t => ({
      ...t.toJSON(),
      _count: {
        comments:    commentMap[t._id.toString()]    ?? 0,
        attachments: attachmentMap[t._id.toString()] ?? 0,
        timesheets:  timesheetMap[t._id.toString()]  ?? 0,
      },
    }))

    return NextResponse.json({ data: enriched })
  } catch (err) {
    console.error('[GET /api/projects/[id]/tasks]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/projects/[id]/tasks
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canAccess(session, 'tasks', 'create'))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()

    const body   = await request.json()
    const parsed = createTaskSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    // Assigning a task to someone needs the separate 'Assign Tasks' permission.
    if (parsed.data.assignedEmployeeId) {
      if (!canDo(session, 'tasks.assign'))
        return NextResponse.json({ error: 'You do not have permission to assign tasks' }, { status: 403 })
      if (!isValidObjectId(parsed.data.assignedEmployeeId))
        return NextResponse.json({ error: 'Invalid assignee' }, { status: 400 })
    }

    if (!(await Project.exists({ _id: params.id })))
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const data = { ...parsed.data, projectId: params.id }
    if (data.dueDate) data.dueDate = new Date(data.dueDate)

    // Get max position for status column
    const maxPosTask = await Task.findOne({ projectId: params.id, status: data.status })
      .sort({ position: -1 })
      .select('position')
      .lean()
    data.position = (maxPosTask?.position ?? 0) + 1

    const task = await new Task(data).save()
    await task.populate([
      { path: 'assignedEmployeeId',   select: TASK_ASSIGNEE_SELECT, populate: { path: 'userId', select: 'id name avatar' } },
      { path: 'assignedFreelancerId', select: TASK_ASSIGNEE_SELECT, populate: { path: 'userId', select: 'id name avatar' } },
    ])

    // Notify the assigned employee so the task actually surfaces for them to accept.
    if (task.assignedEmployeeId) {
      const assigneeUserId = task.assignedEmployeeId?.userId?._id ?? task.assignedEmployeeId?.userId?.id
      if (assigneeUserId) {
        createNotification({
          userId:  assigneeUserId.toString(),
          title:   'New task assigned',
          message: `You've been assigned "${task.title}". Review and accept it.`,
          type:    'TASK',
          link:    '/admin/tasks',
        }).catch(() => {})
      }
    }

    return NextResponse.json({
      data: { ...task.toJSON(), _count: { comments: 0, attachments: 0 } },
    }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/projects/[id]/tasks]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
