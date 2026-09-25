export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Task, Comment, Timesheet, Attachment, Employee } from '@/models'
import { requirePerm, requireStaff, canDo } from '@/lib/rbac'
import { createNotification } from '@/lib/createNotification'
import { isValidObjectId } from '@/lib/objectId'

const TASK_STATUSES   = ['TODO', 'IN_PROGRESS', 'IN_REVIEW', 'COMPLETED', 'CANCELLED']
const TASK_PRIORITIES = ['LOW', 'MEDIUM', 'HIGH', 'URGENT']

// PUT /api/projects/:id/tasks/:taskId
export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    // Staff only (freelancers/clients/vendors never edit tasks here).
    const notStaff = requireStaff(session)
    if (notStaff) return notStaff
    const denied = requirePerm(session, 'tasks.update')
    if (denied) return denied
    if (!isValidObjectId(params.id) || !isValidObjectId(params.taskId))
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await connectDB()

    const body = await request.json()
    const { title, description, status, priority, dueDate, assignedEmployeeId } = body ?? {}

    // Partial update: only touch the fields actually sent.
    const update = {}
    if (title !== undefined) {
      if (!String(title ?? '').trim()) return NextResponse.json({ error: 'Title required' }, { status: 422 })
      update.title = String(title).trim()
    }
    if (description !== undefined) update.description = description || null
    if (status !== undefined) {
      if (!TASK_STATUSES.includes(status)) return NextResponse.json({ error: 'Invalid status' }, { status: 422 })
      update.status = status
    }
    if (priority !== undefined) {
      if (!TASK_PRIORITIES.includes(priority)) return NextResponse.json({ error: 'Invalid priority' }, { status: 422 })
      update.priority = priority
    }
    if (dueDate !== undefined) update.dueDate = dueDate ? new Date(dueDate) : null

    // Employees may only edit tasks assigned to them.
    const filter = { _id: params.taskId, projectId: params.id }
    if (session.user.role === 'EMPLOYEE') {
      const employee = await Employee.findOne({ userId: session.user.id }).select('_id').lean()
      if (!employee) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      filter.assignedEmployeeId = employee._id
    }

    // Assignee (in-house Employee id). Only an actual change counts as a
    // (re)assignment: it needs 'tasks.assign' and resets the acceptance flow.
    let assigneeChanged = false
    if (assignedEmployeeId !== undefined) {
      if (assignedEmployeeId && !isValidObjectId(assignedEmployeeId))
        return NextResponse.json({ error: 'Invalid assignee' }, { status: 400 })
      const current = await Task.findOne(filter).select('assignedEmployeeId').lean()
      if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      if (String(current.assignedEmployeeId ?? '') !== String(assignedEmployeeId ?? '')) {
        if (!canDo(session, 'tasks.assign'))
          return NextResponse.json({ error: 'You do not have permission to assign tasks' }, { status: 403 })
        if (assignedEmployeeId && !(await Employee.exists({ _id: assignedEmployeeId })))
          return NextResponse.json({ error: 'Invalid assignee' }, { status: 400 })
        assigneeChanged = true
        update.assignedEmployeeId = assignedEmployeeId || null
        update.assignmentStatus   = 'ASSIGNED'
        update.acceptedAt         = null
        update.declinedAt         = null
      }
    }

    const task = await Task.findOneAndUpdate(filter, update, { new: true, runValidators: true })
    if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Notify the (new) assignee so the task surfaces for them to accept.
    if (assigneeChanged && task.assignedEmployeeId) {
      const assignee = await Employee.findById(task.assignedEmployeeId).select('userId').lean()
      if (assignee?.userId) {
        createNotification({
          userId:  assignee.userId.toString(),
          title:   'Task assigned to you',
          message: `You've been assigned "${task.title}". Review and accept it.`,
          type:    'TASK',
          link:    '/admin/tasks',
        }).catch(() => {})
      }
    }

    return NextResponse.json({ data: task.toJSON() })
  } catch (err) {
    console.error('[PUT task]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/projects/:id/tasks/:taskId
export async function DELETE(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    const denied = requirePerm(session, 'tasks.delete')
    if (denied) return denied
    if (!isValidObjectId(params.id) || !isValidObjectId(params.taskId))
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await connectDB()

    const task = await Task.findOneAndDelete({ _id: params.taskId, projectId: params.id })
    if (!task) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Cascade: nothing should keep pointing at a deleted task.
    await Promise.all([
      Comment.deleteMany({ taskId: task._id }),
      Timesheet.deleteMany({ taskId: task._id }),
      Attachment.deleteMany({ taskId: task._id }),
    ])

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE task]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
