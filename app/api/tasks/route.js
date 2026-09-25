export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Task, Project, Employee, Freelancer, Comment, Attachment } from '@/models'
import { resolveActiveClient } from '@/lib/clientAccess'
import { createNotification } from '@/lib/createNotification'
import { searchEncrypted } from '@/lib/searchMatch'
import { logActivity } from '@/lib/logActivity'
import { canDo, requirePerm } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { TASK_ASSIGNEE_SELECT } from '@/lib/taskAccess'
import { z } from 'zod'

const createTaskSchema = z.object({
  projectId:            z.string().min(1),
  title:                z.string().min(1),
  description:          z.string().optional().nullable(),
  status:               z.enum(['TODO','IN_PROGRESS','IN_REVIEW','COMPLETED','CANCELLED']).default('TODO'),
  priority:             z.enum(['LOW','MEDIUM','HIGH','URGENT']).default('MEDIUM'),
  dueDate:              z.string().datetime().optional().nullable(),
  estimatedHours:       z.number().positive().optional().nullable(),
  assignedEmployeeId:   z.string().optional().nullable(),
  isClientVisible:      z.boolean().default(false),
  position:             z.number().int().default(0),
})

// GET /api/tasks
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    // Only staff, assigned freelancers and clients have a task view; everyone
    // else (VENDOR, unknown roles) gets nothing.
    if (!['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE', 'FREELANCER', 'CLIENT'].includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await connectDB()

    const { searchParams } = new URL(request.url)
    const page      = parseInt(searchParams.get('page')      ?? '1',  10)
    const limit     = parseInt(searchParams.get('limit')     ?? '50', 10)
    const projectId = searchParams.get('projectId')
    const status    = searchParams.get('status')
    const search    = searchParams.get('search')
    const priority  = searchParams.get('priority')
    const skip      = (page - 1) * limit

    // title/description are encrypted → DB regex can't match them (handled in JS below)
    const filter = {}
    if (projectId) filter.projectId = projectId
    if (status)    filter.status    = status
    if (['LOW', 'MEDIUM', 'HIGH', 'URGENT'].includes(priority)) filter.priority = priority

    // A missing profile must match nothing — filtering on `null` would match
    // every unassigned task.
    if (session.user.role === 'FREELANCER') {
      const freelancer = await Freelancer.findOne({ userId: session.user.id }).select('_id').lean()
      if (freelancer) filter.assignedFreelancerId = freelancer._id
      else filter._id = null
    }

    if (session.user.role === 'EMPLOYEE') {
      const employee = await Employee.findOne({ userId: session.user.id }).select('_id').lean()
      if (employee) filter.assignedEmployeeId = employee._id
      else filter._id = null
    }

    if (session.user.role === 'CLIENT') {
      filter.isClientVisible = true
      const { clientId } = await resolveActiveClient(session)
      const clientProjects = clientId
        ? await Project.find({ clientId }).distinct('_id')
        : []
      filter.projectId = { $in: clientProjects }
    }

    const sort = { position: 1, createdAt: -1 }
    const populate = [
      { path: 'projectId', select: 'id name' },
      { path: 'assignedEmployeeId', select: TASK_ASSIGNEE_SELECT, populate: { path: 'userId', select: 'name avatar' } },
      { path: 'assignedFreelancerId', select: TASK_ASSIGNEE_SELECT, populate: { path: 'userId', select: 'name avatar' } },
    ]

    let tasks, total
    if (search) {
      ;({ docs: tasks, total } = await searchEncrypted(Task, {
        baseFilter: filter, search, fields: ['title', 'description'],
        page, limit, sort, populate,
      }))
    } else {
      ;[tasks, total] = await Promise.all([
        Task.find(filter).skip(skip).limit(limit).sort(sort)
          .populate(populate[0]).populate(populate[1]).populate(populate[2]),
        Task.countDocuments(filter),
      ])
    }

    const taskIds = tasks.map(t => t._id)
    const [commentCounts, attachmentCounts] = await Promise.all([
      Comment.aggregate([{ $match: { taskId: { $in: taskIds } } }, { $group: { _id: '$taskId', count: { $sum: 1 } } }]),
      Attachment.aggregate([{ $match: { taskId: { $in: taskIds } } }, { $group: { _id: '$taskId', count: { $sum: 1 } } }]),
    ])
    const commentMap    = Object.fromEntries(commentCounts.map(c => [c._id.toString(), c.count]))
    const attachmentMap = Object.fromEntries(attachmentCounts.map(a => [a._id.toString(), a.count]))

    const enriched = tasks.map(t => ({
      ...t.toJSON(),
      _count: {
        comments:    commentMap[t._id.toString()]    ?? 0,
        attachments: attachmentMap[t._id.toString()] ?? 0,
      },
    }))

    return NextResponse.json({
      data: enriched,
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  } catch (err) {
    console.error('[GET /api/tasks]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/tasks
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const denied = requirePerm(session, 'tasks.create')
    if (denied) return denied

    await connectDB()

    const body   = await request.json()
    const parsed = createTaskSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    if (!isValidObjectId(parsed.data.projectId))
      return NextResponse.json({ error: 'Invalid project' }, { status: 400 })
    // Assigning a task to someone needs the separate 'Assign Tasks' permission.
    if (parsed.data.assignedEmployeeId) {
      if (!canDo(session, 'tasks.assign'))
        return NextResponse.json({ error: 'You do not have permission to assign tasks' }, { status: 403 })
      if (!isValidObjectId(parsed.data.assignedEmployeeId))
        return NextResponse.json({ error: 'Invalid assignee' }, { status: 400 })
    }
    if (!(await Project.exists({ _id: parsed.data.projectId })))
      return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const data = { ...parsed.data }
    if (data.dueDate) data.dueDate = new Date(data.dueDate)

    const task = await new Task(data).save()
    await task.populate([
      { path: 'projectId', select: 'name' },
      { path: 'assignedEmployeeId', select: TASK_ASSIGNEE_SELECT, populate: { path: 'userId', select: 'name id' } },
    ])

    // Notify assigned employee or freelancer
    const assignedUserId = task.assignedEmployeeId?.userId?.id
    if (assignedUserId && assignedUserId !== session.user.id) {
      await createNotification({
        userId:  assignedUserId,
        title:   'New task assigned',
        message: `"${task.title}" in project ${task.projectId?.name ?? '—'}`,
        type:    'TASK',
        link:    `/admin/tasks`,
      })
    }

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'CREATE',
      entity:   'TASK',
      entityId: task._id.toString(),
      changes:  JSON.stringify({ title: task.title, project: task.projectId?.name ?? null }),
      request,
    })

    return NextResponse.json({ data: task }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/tasks]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
