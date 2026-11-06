export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import { OrganizerEvent, OrganizerCalendar } from '@/models'
import { logActivity } from '@/lib/logActivity'
import {
  authorize, VIEW, MANAGE, readJson, validationFailed, handleError, actor, jsonError, HttpError, fieldError,
} from '@/lib/organizer/http'
import { parseIdList, parseSearch } from '@/lib/organizer/validation'
import { parseYMD, DAY_MS } from '@/lib/organizer/dates'
import {
  createEventSchema, parseEventDate, defaultEnd, normaliseRepeat, findOccurrences,
} from '@/lib/organizer/events'
import {
  organizerScope, requireOrganizer, assertProjectForOrganizer, hydrateOccurrences, hydrateEvent,
} from '@/lib/organizer/refs'
import { EVENT_SPAN_MAX_DAYS, ENTITY } from '@/lib/organizer/constants'

// GET /api/organizer/events?from=ISO&to=ISO&organizerIds=&calendarIds=&projectIds=&clientId=&search=
// → occurrences overlapping [from, to), recurring series expanded, sorted by start.
export async function GET(request) {
  try {
    const { denied } = await authorize(VIEW)
    if (denied) return denied

    const sp = new URL(request.url).searchParams
    // An unencoded '+06:00' offset arrives as ' 06:00' — put the plus back.
    const fromRaw = (sp.get('from') ?? '').trim().replace(' ', '+')
    const toRaw = (sp.get('to') ?? '').trim().replace(' ', '+')
    if (!fromRaw || !toRaw) return jsonError('from and to are required', 422)
    const from = new Date(fromRaw)
    const to = new Date(toRaw)
    if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) return jsonError('from and to must be ISO dates', 422)
    if (to <= from) return jsonError('to must be after from', 422)
    if (to - from > EVENT_SPAN_MAX_DAYS * DAY_MS) return jsonError(`The range is limited to ${EVENT_SPAN_MAX_DAYS} days`, 422)

    await connectDB()
    const scopeIds = await organizerScope(sp)
    const calendarIds = parseIdList(sp.get('calendarIds') ?? sp.get('calendarId'))
    const projectIds = parseIdList(sp.get('projectIds') ?? sp.get('projectId'))
    if ([scopeIds, calendarIds, projectIds].some(ids => ids && !ids.length)) {
      return NextResponse.json({ data: [], meta: { truncated: false } })
    }

    const { pairs, truncated } = await findOccurrences({
      from, to, scopeIds, calendarIds, projectIds, search: parseSearch(sp.get('search')),
    })
    return NextResponse.json({ data: await hydrateOccurrences(pairs), meta: { truncated } })
  } catch (err) {
    return handleError(err, '[GET /api/organizer/events]')
  }
}

// POST /api/organizer/events
export async function POST(request) {
  try {
    const { session, denied } = await authorize(MANAGE)
    if (denied) return denied
    await connectDB()

    const parsed = createEventSchema.safeParse(await readJson(request))
    if (!parsed.success) return validationFailed(parsed.error)
    const body = parsed.data

    const cal = await OrganizerCalendar.findById(body.calendarId).select('organizerId name').lean()
    if (!cal) throw new HttpError(422, 'Calendar not found')
    const org = await requireOrganizer(cal.organizerId)

    const allDay = body.allDay
    const start = parseEventDate(body.start, allDay, 'start')
    const end = body.end ? parseEventDate(body.end, allDay, 'end') : defaultEnd(start, allDay)
    if (end < start) throw fieldError('end', 'End must be on or after start')

    const rep = normaliseRepeat({
      repeat: body.repeat,
      repeatInterval: body.repeatInterval,
      repeatUntil: body.repeatUntil ? parseYMD(body.repeatUntil) : null,
      start,
      allDay,
    })
    if (body.projectId) await assertProjectForOrganizer(body.projectId, org)

    const ev = await OrganizerEvent.create({
      organizerId: org._id,
      calendarId:  cal._id,
      projectId:   body.projectId ?? null,
      title:       body.title,
      description: body.description ?? null,
      location:    body.location ?? null,
      allDay,
      start,
      end,
      ...rep,
      exDates:     [],
      color:       body.color ?? null,
      createdBy:   session.user.id,
    })

    logActivity({
      ...actor(session, request),
      action:   'CREATE',
      entity:   ENTITY.EVENT,
      entityId: ev._id.toString(),
      changes:  JSON.stringify({ title: ev.title, calendar: cal.name, organizer: org.name, start: ev.start, repeat: ev.repeat }),
    })

    return NextResponse.json({ data: await hydrateEvent(ev.toObject()) }, { status: 201 })
  } catch (err) {
    return handleError(err, '[POST /api/organizer/events]')
  }
}
