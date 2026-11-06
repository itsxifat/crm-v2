export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import connectDB from '@/lib/mongodb'
import { OrganizerTodoList, OrganizerTodo } from '@/models'
import { logActivity } from '@/lib/logActivity'
import { isValidObjectId } from '@/lib/objectId'
import { authorize, VIEW, MANAGE, readJson, validationFailed, handleError, actor, jsonError } from '@/lib/organizer/http'
import { paletteSchema } from '@/lib/organizer/validation'
import { hydrateLists } from '@/lib/organizer/refs'
import { ENTITY } from '@/lib/organizer/constants'

const updateSchema = z.object({
  name:     z.string().trim().min(1, 'Name is required').max(80, 'At most 80 characters').optional(),
  color:    paletteSchema.optional(),
  position: z.number().finite().optional(),
})

const notFound = () => jsonError('List not found', 404)

// GET /api/organizer/lists/[id]
export async function GET(request, { params }) {
  try {
    const { denied } = await authorize(VIEW)
    if (denied) return denied
    if (!isValidObjectId(params.id)) return notFound()
    await connectDB()

    const list = await OrganizerTodoList.findById(params.id).lean()
    if (!list) return notFound()
    const [data] = await hydrateLists([list])
    return NextResponse.json({ data })
  } catch (err) {
    return handleError(err, '[GET /api/organizer/lists/[id]]')
  }
}

// PATCH /api/organizer/lists/[id]
export async function PATCH(request, { params }) {
  try {
    const { session, denied } = await authorize(MANAGE)
    if (denied) return denied
    if (!isValidObjectId(params.id)) return notFound()
    await connectDB()

    const parsed = updateSchema.safeParse(await readJson(request))
    if (!parsed.success) return validationFailed(parsed.error)

    const update = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined))
    const list = await OrganizerTodoList.findByIdAndUpdate(params.id, update, { new: true, runValidators: true }).lean()
    if (!list) return notFound()

    logActivity({
      ...actor(session, request),
      action:   'UPDATE',
      entity:   ENTITY.LIST,
      entityId: params.id,
      changes:  JSON.stringify({ name: list.name, ...update }),
    })

    const [data] = await hydrateLists([list])
    return NextResponse.json({ data })
  } catch (err) {
    return handleError(err, '[PATCH /api/organizer/lists/[id]]')
  }
}

// DELETE /api/organizer/lists/[id] — deletes its to-dos too
export async function DELETE(request, { params }) {
  try {
    const { session, denied } = await authorize(MANAGE)
    if (denied) return denied
    if (!isValidObjectId(params.id)) return notFound()
    await connectDB()

    const list = await OrganizerTodoList.findByIdAndDelete(params.id)
    if (!list) return notFound()
    const { deletedCount } = await OrganizerTodo.deleteMany({ listId: list._id })

    logActivity({
      ...actor(session, request),
      action:   'DELETE',
      entity:   ENTITY.LIST,
      entityId: params.id,
      changes:  JSON.stringify({ name: list.name, todos: deletedCount }),
    })

    return NextResponse.json({ data: { id: params.id } })
  } catch (err) {
    return handleError(err, '[DELETE /api/organizer/lists/[id]]')
  }
}
