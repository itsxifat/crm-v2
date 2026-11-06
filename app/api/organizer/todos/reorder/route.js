export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import { OrganizerTodo, OrganizerTodoList, Project } from '@/models'
import { logActivity } from '@/lib/logActivity'
import { authorize, MANAGE, readJson, validationFailed, handleError, actor, HttpError } from '@/lib/organizer/http'
import { reorderSchema } from '@/lib/organizer/todos'
import { requireOrganizer, hydrateTodos, uniqIds } from '@/lib/organizer/refs'
import { ENTITY } from '@/lib/organizer/constants'

// POST /api/organizer/todos/reorder { listId, ids: [todoId…] }
// Sets position = index for those to-dos and puts them all in listId (a to-do
// coming from another list moves, its organizer following the list).
// → { data: Todo[] } in the given order.
export async function POST(request) {
  try {
    const { session, denied } = await authorize(MANAGE)
    if (denied) return denied
    await connectDB()

    const parsed = reorderSchema.safeParse(await readJson(request))
    if (!parsed.success) return validationFailed(parsed.error)
    const ids = [...new Set(parsed.data.ids)]

    const list = await OrganizerTodoList.findById(parsed.data.listId).select('organizerId name').lean()
    if (!list) throw new HttpError(422, 'List not found')
    const org = await requireOrganizer(list.organizerId)

    const todos = await OrganizerTodo.find({ _id: { $in: ids } }).select('organizerId listId projectId').lean()
    if (todos.length !== ids.length) throw new HttpError(422, 'Some to-dos were not found')
    const byId = new Map(todos.map(t => [String(t._id), t]))

    // To-dos arriving from another organizer drop a project that isn't the new client's.
    const clearProject = new Set()
    const crossing = todos.filter(t => String(t.organizerId) !== String(list.organizerId) && t.projectId)
    if (crossing.length && org.clientId) {
      const ok = new Set(uniqIds(await Project.find({
        _id: { $in: crossing.map(t => t.projectId) }, clientId: org.clientId,
      }).distinct('_id')))
      for (const t of crossing) if (!ok.has(String(t.projectId))) clearProject.add(String(t._id))
    }

    let moved = 0
    await OrganizerTodo.bulkWrite(ids.map((id, index) => {
      const t = byId.get(id)
      const isMove = String(t.listId) !== String(list._id)
      if (isMove) moved++
      const set = { position: index }
      if (isMove) Object.assign(set, { listId: list._id, organizerId: list.organizerId })
      if (clearProject.has(id)) set.projectId = null
      // A pure reorder isn't an edit — keep updatedAt.
      return { updateOne: { filter: { _id: id }, update: { $set: set }, timestamps: isMove } }
    }))

    logActivity({
      ...actor(session, request),
      action:   'UPDATE',
      entity:   ENTITY.LIST,
      entityId: String(list._id),
      changes:  JSON.stringify({ name: list.name, reordered: ids.length, moved }),
    })

    const fresh = await OrganizerTodo.find({ _id: { $in: ids } }).lean()
    const order = new Map(ids.map((id, i) => [id, i]))
    fresh.sort((a, b) => order.get(String(a._id)) - order.get(String(b._id)))
    return NextResponse.json({ data: await hydrateTodos(fresh) })
  } catch (err) {
    return handleError(err, '[POST /api/organizer/todos/reorder]')
  }
}
