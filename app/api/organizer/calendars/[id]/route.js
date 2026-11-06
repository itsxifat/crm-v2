export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import connectDB from '@/lib/mongodb'
import { OrganizerCalendar, OrganizerEvent } from '@/models'
import { logActivity } from '@/lib/logActivity'
import { isValidObjectId } from '@/lib/objectId'
import { authorize, VIEW, MANAGE, readJson, validationFailed, handleError, actor, jsonError } from '@/lib/organizer/http'
import { paletteSchema, optionalText } from '@/lib/organizer/validation'
import { hydrateCalendars } from '@/lib/organizer/refs'
import { ENTITY } from '@/lib/organizer/constants'

const updateSchema = z.object({
  name:        z.string().trim().min(1, 'Name is required').max(80, 'At most 80 characters').optional(),
  color:       paletteSchema.optional(),
  description: optionalText(2000),
  position:    z.number().finite().optional(),
})

const notFound = () => jsonError('Calendar not found', 404)

// GET /api/organizer/calendars/[id]
export async function GET(request, { params }) {
  try {
    const { denied } = await authorize(VIEW)
    if (denied) return denied
    if (!isValidObjectId(params.id)) return notFound()
    await connectDB()

    const cal = await OrganizerCalendar.findById(params.id).lean()
    if (!cal) return notFound()
    const [data] = await hydrateCalendars([cal])
    return NextResponse.json({ data })
  } catch (err) {
    return handleError(err, '[GET /api/organizer/calendars/[id]]')
  }
}

// PATCH /api/organizer/calendars/[id]
export async function PATCH(request, { params }) {
  try {
    const { session, denied } = await authorize(MANAGE)
    if (denied) return denied
    if (!isValidObjectId(params.id)) return notFound()
    await connectDB()

    const parsed = updateSchema.safeParse(await readJson(request))
    if (!parsed.success) return validationFailed(parsed.error)

    const update = Object.fromEntries(Object.entries(parsed.data).filter(([, v]) => v !== undefined))
    const cal = await OrganizerCalendar.findByIdAndUpdate(params.id, update, { new: true, runValidators: true }).lean()
    if (!cal) return notFound()

    logActivity({
      ...actor(session, request),
      action:   'UPDATE',
      entity:   ENTITY.CALENDAR,
      entityId: params.id,
      changes:  JSON.stringify({ name: cal.name, ...update }),
    })

    const [data] = await hydrateCalendars([cal])
    return NextResponse.json({ data })
  } catch (err) {
    return handleError(err, '[PATCH /api/organizer/calendars/[id]]')
  }
}

// DELETE /api/organizer/calendars/[id] — deletes its events too
export async function DELETE(request, { params }) {
  try {
    const { session, denied } = await authorize(MANAGE)
    if (denied) return denied
    if (!isValidObjectId(params.id)) return notFound()
    await connectDB()

    const cal = await OrganizerCalendar.findByIdAndDelete(params.id)
    if (!cal) return notFound()
    const { deletedCount } = await OrganizerEvent.deleteMany({ calendarId: cal._id })

    logActivity({
      ...actor(session, request),
      action:   'DELETE',
      entity:   ENTITY.CALENDAR,
      entityId: params.id,
      changes:  JSON.stringify({ name: cal.name, events: deletedCount }),
    })

    return NextResponse.json({ data: { id: params.id } })
  } catch (err) {
    return handleError(err, '[DELETE /api/organizer/calendars/[id]]')
  }
}
