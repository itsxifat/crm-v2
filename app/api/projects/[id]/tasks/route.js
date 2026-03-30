export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Task, Comment, Attachment, Timesheet } from '@/models'
import { z } from 'zod'

const createTaskSchema = z.object({
  title:                z.string().min(1),
  description:          z.string().optional().nullable(),
  status:               z.enum(['TODO','IN_PROGRESS','IN_REVIEW','COMPLETED','CANCELLED']).default('TODO'),
  priority:             z.enum(['LOW','MEDIUM','HIGH','URGENT']).default('MEDIUM'),
  dueDate:              z.string().optional().nullable(),
  estimatedHours:       z.number().positive().optional().nullable(),
  assignedEmployeeId:   z.string().optional().nullable(),
  assignedFreelancerId: z.string().optional().nullable(),
  isClientVisible:      z.boolean().default(false),
  tags:                 z.string().optional().nullable(),
})

// GET /api/projects/[id]/tasks
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')

    const filter = { projectId: params.id }
    if (status) filter.status = status

    const tasks = await Task.find(filter)
      .sort({ status: 1, position: 1, createdAt: 1 })
      .populate({ path: 'assignedEmployeeId',   populate: { path: 'userId', select: 'id name avatar' } })
      .populate({ path: 'assignedFreelancerId', populate: { path: 'userId', select: 'id name avatar' } })

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

    await connectDB()

    const body   = await request.json()
    const parsed = createTaskSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

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
      { path: 'assignedEmployeeId',   populate: { path: 'userId', select: 'id name avatar' } },
      { path: 'assignedFreelancerId', populate: { path: 'userId', select: 'id name avatar' } },
    ])

    return NextResponse.json({
      data: { ...task.toJSON(), _count: { comments: 0, attachments: 0 } },
    }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/projects/[id]/tasks]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
