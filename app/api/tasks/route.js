import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Task, Project, Employee, Freelancer, Client, Comment, Attachment } from '@/models'
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
  assignedFreelancerId: z.string().optional().nullable(),
  isClientVisible:      z.boolean().default(false),
  position:             z.number().int().default(0),
})

// GET /api/tasks
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const { searchParams } = new URL(request.url)
    const page      = parseInt(searchParams.get('page')      ?? '1',  10)
    const limit     = parseInt(searchParams.get('limit')     ?? '50', 10)
    const projectId = searchParams.get('projectId')
    const status    = searchParams.get('status')
    const search    = searchParams.get('search')
    const skip      = (page - 1) * limit

    const filter = {}
    if (projectId) filter.projectId = projectId
    if (status)    filter.status    = status
    if (search)    filter.title     = { $regex: search, $options: 'i' }

    if (session.user.role === 'FREELANCER') {
      const freelancer = await Freelancer.findOne({ userId: session.user.id }).lean()
      if (freelancer) filter.assignedFreelancerId = freelancer._id
    }

    if (session.user.role === 'EMPLOYEE') {
      const employee = await Employee.findOne({ userId: session.user.id }).lean()
      if (employee) filter.assignedEmployeeId = employee._id
    }

    if (session.user.role === 'CLIENT') {
      filter.isClientVisible = true
      const client = await Client.findOne({ userId: session.user.id }).lean()
      if (client) {
        const clientProjects = await Project.find({ clientId: client._id }).distinct('_id')
        filter.projectId = { $in: clientProjects }
      }
    }

    const [tasks, total] = await Promise.all([
      Task.find(filter)
        .skip(skip)
        .limit(limit)
        .sort({ position: 1, createdAt: -1 })
        .populate({ path: 'projectId', select: 'id name' })
        .populate({ path: 'assignedEmployeeId', populate: { path: 'userId', select: 'name avatar' } })
        .populate({ path: 'assignedFreelancerId', populate: { path: 'userId', select: 'name avatar' } }),
      Task.countDocuments(filter),
    ])

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

    const allowedRoles = ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE']
    if (!allowedRoles.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const body   = await request.json()
    const parsed = createTaskSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    const data = { ...parsed.data }
    if (data.dueDate) data.dueDate = new Date(data.dueDate)

    const task = await new Task(data).save()
    await task.populate([
      { path: 'projectId', select: 'name' },
      { path: 'assignedEmployeeId', populate: { path: 'userId', select: 'name' } },
      { path: 'assignedFreelancerId', populate: { path: 'userId', select: 'name' } },
    ])

    return NextResponse.json({ data: task }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/tasks]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
