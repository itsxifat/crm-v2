export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import { OrganizerEvent, OrganizerCalendar } from '@/models'
import { logActivity } from '@/lib/logActivity'
import { isValidObjectId } from '@/lib/objectId'
import {
  authorize, VIEW, MANAGE, readJson, validationFailed, handleError, actor, jsonError, HttpError, fieldError,
} from '@/lib/organizer/http'
import { parseYMD } from '@/lib/organizer/dates'
import { isOccurrenceStart } from '@/lib/organizer/recurrence'
import {
  updateEventSchema, parseEventDate, defaultEnd, normaliseRepeat,
} from '@/lib/organizer/events'
import {
  requireOrganizer, assertProjectForOrganizer, projectFitsOrganizer, hydrateEvent,
} from '@/lib/organizer/refs'
import { ENTITY } from '@/lib/organizer/constants'

const notFound = () => jsonError('Event not found', 404)

// GET /api/organizer/events/[id] — the event (series master) in occurrence shape
export async function GET(request, { params }) {
  try {
    const { denied } = await authorize(VIEW)
    if (denied) return denied
    if (!isValidObjectId(params.id)) return notFound()
    await connectDB()

    const ev = await OrganizerEvent.findById(params.id).lean()
    if (!ev) return notFound()
    return NextResponse.json({ data: await hydrateEvent(ev) })
  } catch (err) {
    return handleError(err, '[GET /api/organizer/events/[id]]')
  }
}

// PATCH /api/organizer/events/[id] — edits the whole series
export async function PATCH(request, { params }) {
  try {
    const { session, denied } = await authorize(MANAGE)
    if (denied) return denied
    if (!isValidObjectId(params.id)) return notFound()
    await connectDB()

    const parsed = updateEventSchema.safeParse(await readJson(request))
    if (!parsed.success) return validationFailed(parsed.error)
    const p = parsed.data

    const ev = await OrganizerEvent.findById(params.id)
    if (!ev) return notFound()

    // Moving to another calendar — the organizer follows the calendar.
    const prevOrganizerId = String(ev.organizerId)
    if (p.calendarId !== undefined && p.calendarId !== String(ev.calendarId)) {
      const cal = await OrganizerCalendar.findById(p.calendarId).select('organizerId').lean()
      if (!cal) throw new HttpError(422, 'Calendar not found')
      ev.calendarId = cal._id
      ev.organizerId = cal.organizerId
    }
    const organizerChanged = String(ev.organizerId) !== prevOrganizerId
    const org = await requireOrganizer(ev.organizerId)

    // Timing
    const oldStart = ev.start
    const oldEnd = ev.end
    const allDay = p.allDay ?? ev.allDay
    const allDayChanged = allDay !== ev.allDay
    if (allDayChanged && p.start === undefined)
      throw fieldError('start', 'Start is required when switching all-day on or off')

    const start = p.start !== undefined ? parseEventDate(p.start, allDay, 'start') : oldStart
    let end
    if (p.end) end = parseEventDate(p.end, allDay, 'end')
    else if (p.end === null || allDayChanged) end = defaultEnd(start, allDay)
    else if (p.start !== undefined) end = new Date(start.getTime() + (oldEnd.getTime() - oldStart.getTime())) // keep the duration
    else end = oldEnd
    if (end < start) throw fieldError('end', 'End must be on or after start')

    const rep = normaliseRepeat({
      repeat:         p.repeat ?? ev.repeat,
      repeatInterval: p.repeatInterval ?? ev.repeatInterval,
      repeatUntil:    p.repeatUntil !== undefined ? (p.repeatUntil ? parseYMD(p.repeatUntil) : null) : ev.repeatUntil,
      start,
      allDay,
    })

    const timingChanged = allDayChanged || rep.repeat !== ev.repeat ||
      start.getTime() !== oldStart.getTime() || end.getTime() !== oldEnd.getTime()

    ev.allDay = allDay
    ev.start = start
    ev.end = end
    ev.repeat = rep.repeat
    ev.repeatInterval = rep.repeatInterval
    ev.repeatUntil = rep.repeatUntil
    // Skipped occurrences only make sense for the unchanged series.
    if (timingChanged || rep.repeat === 'NONE') ev.exDates = []

    // Project — must match the organizer's client; a move that orphans it clears it.
    if (p.projectId !== undefined) {
      if (p.projectId) await assertProjectForOrganizer(p.projectId, org)
      ev.projectId = p.projectId ?? null
    } else if (organizerChanged && ev.projectId && !(await projectFitsOrganizer(ev.projectId, org))) {
      ev.projectId = null
    }

    for (const k of ['title', 'description', 'location', 'color']) {
      if (p[k] !== undefined) ev[k] = p[k]
    }

    await ev.save()

    logActivity({
      ...actor(session, request),
      action:   'UPDATE',
      entity:   ENTITY.EVENT,
      entityId: params.id,
      changes:  JSON.stringify({ title: ev.title, ...p }),
    })

    return NextResponse.json({ data: await hydrateEvent(ev.toObject()) })
  } catch (err) {
    return handleError(err, '[PATCH /api/organizer/events/[id]]')
  }
}

// DELETE /api/organizer/events/[id]                 → the whole series
// DELETE /api/organizer/events/[id]?occurrence=ISO  → skip just that occurrence of a recurring event
export async function DELETE(request, { params }) {
  try {
    const { session, denied } = await authorize(MANAGE)
    if (denied) return denied
    if (!isValidObjectId(params.id)) return notFound()
    await connectDB()

    const ev = await OrganizerEvent.findById(params.id)
    if (!ev) return notFound()

    // An unencoded '+06:00' offset arrives as ' 06:00' — put the plus back.
    const occurrence = (new URL(request.url).searchParams.get('occurrence') ?? '').trim().replace(' ', '+')
    if (occurrence && ev.repeat !== 'NONE') {
      const at = new Date(occurrence)
      if (Number.isNaN(at.getTime())) return jsonError('Invalid occurrence', 422)
      if (!isOccurrenceStart(ev, at)) return jsonError('Not an occurrence of this event', 422)

      await OrganizerEvent.updateOne({ _id: ev._id }, { $addToSet: { exDates: at } })

      logActivity({
        ...actor(session, request),
        action:   'UPDATE',
        entity:   ENTITY.EVENT,
        entityId: params.id,
        changes:  JSON.stringify({ title: ev.title, skippedOccurrence: at.toISOString() }),
      })
      return NextResponse.json({ data: { id: params.id, occurrence: at.toISOString() } })
    }

    await ev.deleteOne()

    logActivity({
      ...actor(session, request),
      action:   'DELETE',
      entity:   ENTITY.EVENT,
      entityId: params.id,
      changes:  JSON.stringify({ title: ev.title }),
    })
    return NextResponse.json({ data: { id: params.id } })
  } catch (err) {
    return handleError(err, '[DELETE /api/organizer/events/[id]]')
  }
}
