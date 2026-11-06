export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import connectDB from '@/lib/mongodb'
import { Organizer, OrganizerCalendar, OrganizerTodoList, Client, User } from '@/models'
import { logActivity } from '@/lib/logActivity'
import { ciContains } from '@/lib/searchMatch'
import { isValidObjectId } from '@/lib/objectId'
import { authorize, VIEW, MANAGE, readJson, validationFailed, handleError, actor } from '@/lib/organizer/http'
import { paletteSchema, optionalText, objectIdSchema, nullableIdSchema, parseSearch } from '@/lib/organizer/validation'
import { hydrateOrganizers, hydrateOrganizer, assertClientExists, assertProjectsForClient } from '@/lib/organizer/refs'
import { ORGANIZER_LIST_CAP, ORGANIZER_STATUSES, ENTITY } from '@/lib/organizer/constants'

const createSchema = z.object({
  name:           z.string().trim().min(1, 'Name is required').max(120, 'At most 120 characters'),
  description:    optionalText(2000),
  color:          paletteSchema.optional(),
  clientId:       nullableIdSchema,
  projectIds:     z.array(objectIdSchema).max(200).optional().nullable(),
  createDefaults: z.boolean().optional(),
})

// Pinned organizers always lead; then the chosen order (newest id last as tie-break).
const SORTS = {
  pinned:  { pinned: -1, updatedAt: -1, _id: -1 },
  updated: { pinned: -1, updatedAt: -1, _id: -1 },
  created: { pinned: -1, createdAt: -1, _id: -1 },
  name:    { pinned: -1, name: 1, _id: -1 },
}

// GET /api/organizer/organizers?search=&status=ACTIVE|ARCHIVED|ALL&clientId=&sort=
export async function GET(request) {
  try {
    const { denied } = await authorize(VIEW)
    if (denied) return denied
    await connectDB()

    const sp = new URL(request.url).searchParams
    const and = []

    const status = (sp.get('status') ?? 'ACTIVE').trim().toUpperCase()
    if (status !== 'ALL') and.push({ status: ORGANIZER_STATUSES.includes(status) ? status : 'ACTIVE' })

    const clientId = (sp.get('clientId') ?? '').trim()
    if (clientId === 'none') and.push({ clientId: null })
    else if (clientId) and.push(isValidObjectId(clientId) ? { clientId } : { _id: { $in: [] } })

    const search = parseSearch(sp.get('search'))
    if (search) {
      // Name / description, or the client's display name.
      const users = await User.find({ role: 'CLIENT', name: ciContains(search) }).select('_id').limit(200).lean()
      const clients = await Client.find({
        $or: [
          { company: ciContains(search) },
          { contactPerson: ciContains(search) },
          ...(users.length ? [{ userId: { $in: users.map(u => u._id) } }] : []),
        ],
      }).select('_id').limit(500).lean()
      and.push({
        $or: [
          { name: ciContains(search) },
          { description: ciContains(search) },
          ...(clients.length ? [{ clientId: { $in: clients.map(c => c._id) } }] : []),
        ],
      })
    }

    const sortKey = SORTS[sp.get('sort')] ? sp.get('sort') : 'pinned'
    let query = Organizer.find(and.length ? { $and: and } : {}).sort(SORTS[sortKey]).limit(ORGANIZER_LIST_CAP)
    if (sortKey === 'name') query = query.collation({ locale: 'en', strength: 2 })
    const docs = await query.lean()

    return NextResponse.json({ data: await hydrateOrganizers(docs) })
  } catch (err) {
    return handleError(err, '[GET /api/organizer/organizers]')
  }
}

// POST /api/organizer/organizers
export async function POST(request) {
  try {
    const { session, denied } = await authorize(MANAGE)
    if (denied) return denied
    await connectDB()

    const parsed = createSchema.safeParse(await readJson(request))
    if (!parsed.success) return validationFailed(parsed.error)
    const body = parsed.data

    await assertClientExists(body.clientId)
    const projectIds = await assertProjectsForClient(body.projectIds ?? [], body.clientId)

    const org = await Organizer.create({
      name:        body.name,
      description: body.description ?? null,
      color:       body.color ?? 'zinc',
      clientId:    body.clientId ?? null,
      projectIds,
      createdBy:   session.user.id,
    })

    if (body.createDefaults !== false) {
      await Promise.all([
        OrganizerCalendar.create({ organizerId: org._id, name: 'General', color: 'blue', position: 0, createdBy: session.user.id }),
        OrganizerTodoList.create({ organizerId: org._id, name: 'To-do', color: 'zinc', position: 0, createdBy: session.user.id }),
      ])
    }

    logActivity({
      ...actor(session, request),
      action:   'CREATE',
      entity:   ENTITY.ORGANIZER,
      entityId: org._id.toString(),
      changes:  JSON.stringify({ name: org.name, clientId: body.clientId ?? null, projects: projectIds.length }),
    })

    return NextResponse.json({ data: await hydrateOrganizer(org.toObject()) }, { status: 201 })
  } catch (err) {
    return handleError(err, '[POST /api/organizer/organizers]')
  }
}
