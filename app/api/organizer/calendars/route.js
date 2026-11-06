export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import connectDB from '@/lib/mongodb'
import { OrganizerCalendar } from '@/models'
import { logActivity } from '@/lib/logActivity'
import { authorize, VIEW, MANAGE, readJson, validationFailed, handleError, actor } from '@/lib/organizer/http'
import { paletteSchema, optionalText, objectIdSchema } from '@/lib/organizer/validation'
import { hydrateCalendars, organizerScope, requireOrganizer, nextPosition, toObjectIds } from '@/lib/organizer/refs'
import { byOrganizerThenPosition } from '@/lib/organizer/serialize'
import { ENTITY } from '@/lib/organizer/constants'

const createSchema = z.object({
  organizerId: objectIdSchema,
  name:        z.string().trim().min(1, 'Name is required').max(80, 'At most 80 characters'),
  color:       paletteSchema.optional(),
  description: optionalText(2000),
})

// GET /api/organizer/calendars?organizerIds=&clientId=
export async function GET(request) {
  try {
    const { denied } = await authorize(VIEW)
    if (denied) return denied
    await connectDB()

    const scope = await organizerScope(new URL(request.url).searchParams)
    const filter = scope ? { organizerId: { $in: toObjectIds(scope) } } : {}
    const docs = await OrganizerCalendar.find(filter).sort({ position: 1, createdAt: 1 }).limit(2000).lean()

    const data = await hydrateCalendars(docs)
    // Stable sort keeps creation order for equal positions.
    data.sort(byOrganizerThenPosition)
    return NextResponse.json({ data })
  } catch (err) {
    return handleError(err, '[GET /api/organizer/calendars]')
  }
}

// POST /api/organizer/calendars
export async function POST(request) {
  try {
    const { session, denied } = await authorize(MANAGE)
    if (denied) return denied
    await connectDB()

    const parsed = createSchema.safeParse(await readJson(request))
    if (!parsed.success) return validationFailed(parsed.error)
    const body = parsed.data

    const org = await requireOrganizer(body.organizerId)
    const cal = await OrganizerCalendar.create({
      organizerId: org._id,
      name:        body.name,
      color:       body.color ?? 'blue',
      description: body.description ?? null,
      position:    await nextPosition(OrganizerCalendar, { organizerId: org._id }),
      createdBy:   session.user.id,
    })

    logActivity({
      ...actor(session, request),
      action:   'CREATE',
      entity:   ENTITY.CALENDAR,
      entityId: cal._id.toString(),
      changes:  JSON.stringify({ name: cal.name, organizer: org.name }),
    })

    const [data] = await hydrateCalendars([cal.toObject()])
    return NextResponse.json({ data }, { status: 201 })
  } catch (err) {
    return handleError(err, '[POST /api/organizer/calendars]')
  }
}
