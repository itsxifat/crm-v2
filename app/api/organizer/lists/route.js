export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import connectDB from '@/lib/mongodb'
import { OrganizerTodoList } from '@/models'
import { logActivity } from '@/lib/logActivity'
import { authorize, VIEW, MANAGE, readJson, validationFailed, handleError, actor } from '@/lib/organizer/http'
import { paletteSchema, objectIdSchema } from '@/lib/organizer/validation'
import { hydrateLists, organizerScope, requireOrganizer, nextPosition, toObjectIds } from '@/lib/organizer/refs'
import { byOrganizerThenPosition } from '@/lib/organizer/serialize'
import { ENTITY } from '@/lib/organizer/constants'

const createSchema = z.object({
  organizerId: objectIdSchema,
  name:        z.string().trim().min(1, 'Name is required').max(80, 'At most 80 characters'),
  color:       paletteSchema.optional(),
})

// GET /api/organizer/lists?organizerIds=&clientId=
export async function GET(request) {
  try {
    const { denied } = await authorize(VIEW)
    if (denied) return denied
    await connectDB()

    const scope = await organizerScope(new URL(request.url).searchParams)
    const filter = scope ? { organizerId: { $in: toObjectIds(scope) } } : {}
    const docs = await OrganizerTodoList.find(filter).sort({ position: 1, createdAt: 1 }).limit(2000).lean()

    const data = await hydrateLists(docs)
    data.sort(byOrganizerThenPosition)
    return NextResponse.json({ data })
  } catch (err) {
    return handleError(err, '[GET /api/organizer/lists]')
  }
}

// POST /api/organizer/lists
export async function POST(request) {
  try {
    const { session, denied } = await authorize(MANAGE)
    if (denied) return denied
    await connectDB()

    const parsed = createSchema.safeParse(await readJson(request))
    if (!parsed.success) return validationFailed(parsed.error)
    const body = parsed.data

    const org = await requireOrganizer(body.organizerId)
    const list = await OrganizerTodoList.create({
      organizerId: org._id,
      name:        body.name,
      color:       body.color ?? 'zinc',
      position:    await nextPosition(OrganizerTodoList, { organizerId: org._id }),
      createdBy:   session.user.id,
    })

    logActivity({
      ...actor(session, request),
      action:   'CREATE',
      entity:   ENTITY.LIST,
      entityId: list._id.toString(),
      changes:  JSON.stringify({ name: list.name, organizer: org.name }),
    })

    const [data] = await hydrateLists([list.toObject()])
    return NextResponse.json({ data }, { status: 201 })
  } catch (err) {
    return handleError(err, '[POST /api/organizer/lists]')
  }
}
