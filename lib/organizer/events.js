/**
 * lib/organizer/events.js — SERVER-ONLY event helpers: request date parsing and
 * the occurrence query behind GET /api/organizer/events.
 */
import { z } from 'zod'
import { OrganizerEvent } from '@/models'
import { ciContains } from '@/lib/searchMatch'
import { fieldError } from './http.js'
import { addDays, dhakaDayOf, parseYMD, DAY_MS } from './dates.js'
import { expandEvent, MAX_OCCURRENCES } from './recurrence.js'
import { RECURRING, toObjectIds } from './refs.js'
import { REPEAT_VALUES } from './constants.js'
import { objectIdSchema, nullableIdSchema, nullableYmdSchema, optionalText, paletteSchema } from './validation.js'

const HOUR_MS = 3_600_000
const isoDateTime = z.string().datetime({ offset: true })

// ── request schemas ──────────────────────────────────────────────────────────
// start / end are checked per mode (all-day vs timed) by parseEventDate().

const blankToNull = (v) => (v === '' ? null : v)
const blankToUndefined = (v) => (v === '' || v === null ? undefined : v)

const eventFields = {
  calendarId:     objectIdSchema,
  title:          z.string().trim().min(1, 'Title is required').max(200, 'At most 200 characters'),
  description:    optionalText(5000),
  location:       optionalText(300),
  allDay:         z.boolean(),
  start:          z.string().min(1, 'Start is required'),
  end:            z.preprocess(blankToNull, z.string().nullable()).optional(),
  projectId:      nullableIdSchema,
  repeat:         z.enum(REPEAT_VALUES),
  repeatInterval: z.preprocess(blankToUndefined, z.coerce.number().int().min(1).max(365).optional()),
  repeatUntil:    nullableYmdSchema,
  color:          z.preprocess(blankToNull, paletteSchema.nullable()).optional(),
}

export const createEventSchema = z.object({
  ...eventFields,
  allDay: eventFields.allDay.optional().default(false),
  repeat: eventFields.repeat.optional(),
})

export const updateEventSchema = z.object(eventFields).partial()

/**
 * Parse an event start/end value for the given mode:
 *   all-day → 'YYYY-MM-DD' → UTC midnight;  timed → ISO date-time with offset.
 */
export function parseEventDate(value, allDay, field) {
  if (allDay) {
    const d = parseYMD(value)
    if (!d) throw fieldError(field, 'Use a YYYY-MM-DD date')
    return d
  }
  if (typeof value !== 'string' || !isoDateTime.safeParse(value).success)
    throw fieldError(field, 'Use an ISO date-time')
  return new Date(value)
}

/** Default end when none is given: the same day (all-day) or one hour later (timed). */
export function defaultEnd(start, allDay) {
  return allDay ? new Date(start) : new Date(start.getTime() + HOUR_MS)
}

/** UTC midnight of the calendar day a series starts on (UTC day for all-day, Dhaka day for timed). */
export function seriesStartDay(start, allDay) {
  return allDay ? new Date(Math.floor(start.getTime() / DAY_MS) * DAY_MS) : dhakaDayOf(start)
}

/**
 * Normalised recurrence fields; throws 422 when repeatUntil falls before the start day.
 * repeat NONE → interval 1, no until, no exclusions.
 */
export function normaliseRepeat({ repeat, repeatInterval, repeatUntil, start, allDay }) {
  if (!repeat || repeat === 'NONE') return { repeat: 'NONE', repeatInterval: 1, repeatUntil: null }
  const interval = Math.min(365, Math.max(1, Math.floor(Number(repeatInterval) || 1)))
  if (repeatUntil && repeatUntil < seriesStartDay(start, allDay))
    throw fieldError('repeatUntil', 'Repeat until must be on or after the start date')
  return { repeat, repeatInterval: interval, repeatUntil: repeatUntil ?? null }
}

/**
 * Occurrences overlapping [from, to), earliest first, capped at 1000.
 *   scopeIds / calendarIds / projectIds: null = no filter, [] = nothing.
 * Returns { pairs: [{ ev, occ: { start, end } }], truncated }.
 */
export async function findOccurrences({ from, to, scopeIds = null, calendarIds = null, projectIds = null, search = '' }) {
  const base = []
  if (scopeIds)    base.push({ organizerId: { $in: toObjectIds(scopeIds) } })
  if (calendarIds) base.push({ calendarId: { $in: toObjectIds(calendarIds) } })
  if (projectIds)  base.push({ projectId: { $in: toObjectIds(projectIds) } })
  if (search) base.push({ $or: [{ title: ciContains(search) }, { description: ciContains(search) }, { location: ciContains(search) }] })

  // Non-recurring: start < to and end >= from (all-day: end is the inclusive last
  // day's midnight, so its exclusive end end + 1 day must pass from).
  const singleFilter = {
    $and: [
      ...base,
      { repeat: { $nin: RECURRING } },
      { start: { $lt: to } },
      { $or: [
        { allDay: true, end: { $gt: addDays(from, -1) } },
        { allDay: { $ne: true }, end: { $gte: from } },
      ] },
    ],
  }
  // Recurring candidates: started before `to` and not finished before `from`
  // (last allowed start day + duration + slack for the day / all-day end).
  const seriesFilter = {
    $and: [
      ...base,
      { repeat: { $in: RECURRING } },
      { start: { $lt: to } },
      { $or: [
        { repeatUntil: null },
        { $expr: { $gte: [{ $add: ['$repeatUntil', { $subtract: ['$end', '$start'] }, 2 * DAY_MS] }, from] } },
      ] },
    ],
  }

  const [singles, series] = await Promise.all([
    OrganizerEvent.find(singleFilter).sort({ start: 1, _id: 1 }).limit(MAX_OCCURRENCES + 1).lean(),
    OrganizerEvent.find(seriesFilter).limit(5000).lean(),
  ])

  const pairs = singles.map(ev => ({ ev, occ: { start: ev.start, end: ev.end } }))
  for (const ev of series) {
    for (const occ of expandEvent(ev, from, to, { limit: MAX_OCCURRENCES })) pairs.push({ ev, occ })
  }
  pairs.sort((a, b) =>
    (new Date(a.occ.start) - new Date(b.occ.start)) ||
    (Number(!!b.ev.allDay) - Number(!!a.ev.allDay)) ||
    String(a.ev.title).localeCompare(String(b.ev.title)))

  return { pairs: pairs.slice(0, MAX_OCCURRENCES), truncated: pairs.length > MAX_OCCURRENCES }
}
