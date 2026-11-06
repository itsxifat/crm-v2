export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import { OrganizerTodo, OrganizerTodoList } from '@/models'
import { logActivity } from '@/lib/logActivity'
import { isValidObjectId } from '@/lib/objectId'
import {
  authorize, VIEW, MANAGE, readJson, validationFailed, handleError, actor, jsonError, HttpError,
} from '@/lib/organizer/http'
import { parseYMD } from '@/lib/organizer/dates'
import { updateTodoSchema, priorityRankOf, completedAtFor } from '@/lib/organizer/todos'
import {
  requireOrganizer, assertProjectForOrganizer, projectFitsOrganizer, assertAssignee, nextPosition, hydrateTodos,
} from '@/lib/organizer/refs'
import { notifyTodoAssignee } from '@/lib/organizer/notify'
import { ENTITY } from '@/lib/organizer/constants'

const notFound = () => jsonError('To-do not found', 404)

// GET /api/organizer/todos/[id]
export async function GET(request, { params }) {
  try {
    const { denied } = await authorize(VIEW)
    if (denied) return denied
    if (!isValidObjectId(params.id)) return notFound()
    await connectDB()

    const todo = await OrganizerTodo.findById(params.id).lean()
    if (!todo) return notFound()
    const [data] = await hydrateTodos([todo])
    return NextResponse.json({ data })
  } catch (err) {
    return handleError(err, '[GET /api/organizer/todos/[id]]')
  }
}

// PATCH /api/organizer/todos/[id] — partial; listId moves it (the organizer follows the list)
export async function PATCH(request, { params }) {
  try {
    const { session, denied } = await authorize(MANAGE)
    if (denied) return denied
    if (!isValidObjectId(params.id)) return notFound()
    await connectDB()

    const parsed = updateTodoSchema.safeParse(await readJson(request))
    if (!parsed.success) return validationFailed(parsed.error)
    const p = parsed.data

    const todo = await OrganizerTodo.findById(params.id)
    if (!todo) return notFound()

    // Move to another list.
    const prevOrganizerId = String(todo.organizerId)
    let moved = false
    if (p.listId !== undefined && p.listId !== String(todo.listId)) {
      const list = await OrganizerTodoList.findById(p.listId).select('organizerId').lean()
      if (!list) throw new HttpError(422, 'List not found')
      todo.listId = list._id
      todo.organizerId = list.organizerId
      moved = true
    }
    const organizerChanged = String(todo.organizerId) !== prevOrganizerId
    const org = await requireOrganizer(todo.organizerId)

    if (p.position !== undefined) todo.position = p.position
    else if (moved) todo.position = await nextPosition(OrganizerTodo, { listId: todo.listId })

    // Project — must match the organizer's client; a move that orphans it clears it.
    if (p.projectId !== undefined) {
      if (p.projectId) await assertProjectForOrganizer(p.projectId, org)
      todo.projectId = p.projectId ?? null
    } else if (organizerChanged && todo.projectId && !(await projectFitsOrganizer(todo.projectId, org))) {
      todo.projectId = null
    }

    let assigneeChanged = false
    if (p.assigneeId !== undefined && String(p.assigneeId ?? '') !== String(todo.assigneeId ?? '')) {
      if (p.assigneeId) await assertAssignee(p.assigneeId)
      todo.assigneeId = p.assigneeId ?? null
      assigneeChanged = true
    }

    const statusChanged = p.status !== undefined && p.status !== todo.status
    if (statusChanged) {
      todo.completedAt = completedAtFor(p.status, todo.status, todo.completedAt)
      todo.status = p.status
    }
    if (p.priority !== undefined) {
      todo.priority = p.priority
      todo.priorityRank = priorityRankOf(p.priority)
    }
    if (p.dueDate !== undefined) todo.dueDate = p.dueDate ? parseYMD(p.dueDate) : null
    for (const k of ['title', 'notes', 'tags']) {
      if (p[k] !== undefined) todo[k] = p[k]
    }

    await todo.save()

    if (assigneeChanged && todo.assigneeId) {
      await notifyTodoAssignee({ assigneeId: todo.assigneeId, actorId: session.user.id, todoTitle: todo.title, organizer: org })
    }

    logActivity({
      ...actor(session, request),
      action:   statusChanged ? 'STATUS_CHANGE' : 'UPDATE',
      entity:   ENTITY.TODO,
      entityId: params.id,
      changes:  JSON.stringify({ title: todo.title, ...p }),
    })

    const [data] = await hydrateTodos([todo.toObject()])
    return NextResponse.json({ data })
  } catch (err) {
    return handleError(err, '[PATCH /api/organizer/todos/[id]]')
  }
}

// DELETE /api/organizer/todos/[id]
export async function DELETE(request, { params }) {
  try {
    const { session, denied } = await authorize(MANAGE)
    if (denied) return denied
    if (!isValidObjectId(params.id)) return notFound()
    await connectDB()

    const todo = await OrganizerTodo.findByIdAndDelete(params.id)
    if (!todo) return notFound()

    logActivity({
      ...actor(session, request),
      action:   'DELETE',
      entity:   ENTITY.TODO,
      entityId: params.id,
      changes:  JSON.stringify({ title: todo.title }),
    })
    return NextResponse.json({ data: { id: params.id } })
  } catch (err) {
    return handleError(err, '[DELETE /api/organizer/todos/[id]]')
  }
}
