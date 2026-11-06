export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import { OrganizerTodo, OrganizerTodoList } from '@/models'
import { logActivity } from '@/lib/logActivity'
import { authorize, VIEW, MANAGE, readJson, validationFailed, handleError, actor, HttpError } from '@/lib/organizer/http'
import { parsePaging } from '@/lib/organizer/validation'
import { parseYMD } from '@/lib/organizer/dates'
import {
  createTodoSchema, todoFilters, queryTodos, priorityRankOf, completedAtFor,
} from '@/lib/organizer/todos'
import {
  requireOrganizer, assertProjectForOrganizer, assertAssignee, nextPosition, hydrateTodos,
} from '@/lib/organizer/refs'
import { notifyTodoAssignee } from '@/lib/organizer/notify'
import { ENTITY } from '@/lib/organizer/constants'

// GET /api/organizer/todos — filters, sort/dir, page/limit (see lib/organizer/todos.js)
// → { data, meta: { page, limit, total, pages, counts: { OPEN, IN_PROGRESS, DONE, overdue } } }
export async function GET(request) {
  try {
    const { session, denied } = await authorize(VIEW)
    if (denied) return denied
    await connectDB()

    const sp = new URL(request.url).searchParams
    const { page, limit, skip } = parsePaging(sp)
    const { baseMatch, fullMatch } = await todoFilters(sp, session)
    const { rows, total, counts } = await queryTodos({
      baseMatch, fullMatch, sort: sp.get('sort'), dir: sp.get('dir'), skip, limit,
    })

    return NextResponse.json({
      data: await hydrateTodos(rows),
      meta: { page, limit, total, pages: Math.ceil(total / limit), counts },
    })
  } catch (err) {
    return handleError(err, '[GET /api/organizer/todos]')
  }
}

// POST /api/organizer/todos
export async function POST(request) {
  try {
    const { session, denied } = await authorize(MANAGE)
    if (denied) return denied
    await connectDB()

    const parsed = createTodoSchema.safeParse(await readJson(request))
    if (!parsed.success) return validationFailed(parsed.error)
    const body = parsed.data

    const list = await OrganizerTodoList.findById(body.listId).select('organizerId name').lean()
    if (!list) throw new HttpError(422, 'List not found')
    const org = await requireOrganizer(list.organizerId)

    if (body.projectId) await assertProjectForOrganizer(body.projectId, org)
    if (body.assigneeId) await assertAssignee(body.assigneeId)

    const status = body.status ?? 'OPEN'
    const priority = body.priority ?? 'MEDIUM'
    const todo = await OrganizerTodo.create({
      organizerId:  org._id,
      listId:       list._id,
      projectId:    body.projectId ?? null,
      title:        body.title,
      notes:        body.notes ?? null,
      status,
      priority,
      priorityRank: priorityRankOf(priority),
      dueDate:      body.dueDate ? parseYMD(body.dueDate) : null,
      assigneeId:   body.assigneeId ?? null,
      tags:         body.tags ?? [],
      position:     await nextPosition(OrganizerTodo, { listId: list._id }),
      completedAt:  completedAtFor(status, null, null),
      createdBy:    session.user.id,
    })

    await notifyTodoAssignee({ assigneeId: todo.assigneeId, actorId: session.user.id, todoTitle: todo.title, organizer: org })

    logActivity({
      ...actor(session, request),
      action:   'CREATE',
      entity:   ENTITY.TODO,
      entityId: todo._id.toString(),
      changes:  JSON.stringify({ title: todo.title, list: list.name, organizer: org.name }),
    })

    const [data] = await hydrateTodos([todo.toObject()])
    return NextResponse.json({ data }, { status: 201 })
  } catch (err) {
    return handleError(err, '[POST /api/organizer/todos]')
  }
}
