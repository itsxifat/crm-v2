/**
 * lib/organizer/refs.js — SERVER-ONLY data helpers for the organizer API:
 * batch-loading refs, hydrating documents into API shapes, per-organizer /
 * calendar / list counts, and the cross-entity checks (client, projects,
 * assignee) every write route shares.
 */
import mongoose from 'mongoose'
import {
  Organizer, OrganizerCalendar, OrganizerEvent, OrganizerTodoList, OrganizerTodo, OrganizerNote,
  Project, Client, User,
} from '@/models'
import { isValidObjectId } from '@/lib/objectId'
import { HttpError } from './http.js'
import { addDays, dhakaToday, DAY_MS } from './dates.js'
import { expandEvent } from './recurrence.js'
import { parseIdList } from './validation.js'
import {
  colorRef, projectRef, userRef,
  serializeOrganizer, serializeCalendar, serializeList, serializeOccurrence, serializeTodo, serializeNote,
} from './serialize.js'

export const STAFF_ROLES = ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE']
export const RECURRING = ['DAILY', 'WEEKLY', 'MONTHLY', 'YEARLY']
const UPCOMING_DAYS = 30

// ── ids ──────────────────────────────────────────────────────────────────────

export function toObjectId(id) {
  return new mongoose.Types.ObjectId(String(id))
}

/** Distinct valid id strings from ids / ObjectIds / populated docs (nullish dropped). */
export function uniqIds(values) {
  const out = new Set()
  for (const v of values ?? []) {
    if (v === null || v === undefined) continue
    const s = String(v._id ?? v)
    if (isValidObjectId(s)) out.add(s)
  }
  return [...out]
}

export function toObjectIds(values) {
  return uniqIds(values).map(toObjectId)
}

// ── refs ─────────────────────────────────────────────────────────────────────

/** Client display name: company, else name, else the linked user's name. */
export function clientDisplayName(client, user) {
  return client?.company || client?.name || user?.name || client?.contactPerson || client?.clientCode || 'Client'
}

async function mapOf(Model, ids, select, shape) {
  const list = uniqIds(ids)
  if (!list.length) return new Map()
  const docs = await Model.find({ _id: { $in: list } }).select(select).lean()
  return new Map(docs.map(d => [String(d._id), shape(d)]))
}

async function clientMap(ids) {
  const list = uniqIds(ids)
  if (!list.length) return new Map()
  const clients = await Client.find({ _id: { $in: list } }).select('company name contactPerson clientCode userId').lean()
  const userIds = uniqIds(clients.map(c => c.userId))
  const users = userIds.length ? await User.find({ _id: { $in: userIds } }).select('name').lean() : []
  const userById = new Map(users.map(u => [String(u._id), u]))
  return new Map(clients.map(c => [
    String(c._id),
    { id: String(c._id), name: clientDisplayName(c, userById.get(String(c.userId))) },
  ]))
}

/** Maps (id → small ref object) for every id passed. */
export async function loadRefs({ organizers = [], calendars = [], lists = [], projects = [], users = [], clients = [] } = {}) {
  const [o, c, l, p, u, cl] = await Promise.all([
    mapOf(Organizer, organizers, 'name color', colorRef),
    mapOf(OrganizerCalendar, calendars, 'name color', colorRef),
    mapOf(OrganizerTodoList, lists, 'name color', colorRef),
    mapOf(Project, projects, 'name', projectRef),
    mapOf(User, users, 'name avatar', userRef),
    clientMap(clients),
  ])
  return { organizers: o, calendars: c, lists: l, projects: p, users: u, clients: cl }
}

// ── counts ───────────────────────────────────────────────────────────────────

async function countBy(Model, field, ids) {
  if (!ids.length) return new Map()
  const rows = await Model.aggregate([
    { $match: { [field]: { $in: ids } } },
    { $group: { _id: `$${field}`, n: { $sum: 1 } } },
  ])
  return new Map(rows.map(r => [String(r._id), r.n]))
}

/** Aggregation expression: open (not DONE) to-do due before `today`. */
export function overdueExpr(today) {
  return {
    $and: [
      { $ne: ['$status', 'DONE'] },
      { $ne: [{ $ifNull: ['$dueDate', null] }, null] },
      { $lt: ['$dueDate', today] },
    ],
  }
}

/**
 * Occurrences starting in the next 30 days per organizer (all-day ones from the
 * start of today, Asia/Dhaka; timed ones from now). Recurring series expanded.
 */
async function upcomingEventCounts(ids, now) {
  if (!ids.length) return new Map()
  const today = dhakaToday(now)
  const horizon = new Date(now.getTime() + UPCOMING_DAYS * DAY_MS)
  const [single, series] = await Promise.all([
    OrganizerEvent.aggregate([
      { $match: {
        organizerId: { $in: ids },
        repeat: { $nin: RECURRING },
        $or: [
          { allDay: true, start: { $gte: today, $lt: horizon } },
          { allDay: { $ne: true }, start: { $gte: now, $lt: horizon } },
        ],
      } },
      { $group: { _id: '$organizerId', n: { $sum: 1 } } },
    ]),
    OrganizerEvent.find({
      organizerId: { $in: ids },
      repeat: { $in: RECURRING },
      start: { $lt: horizon },
      $or: [{ repeatUntil: null }, { repeatUntil: { $gte: addDays(today, -1) } }],
    }).select('organizerId start end allDay repeat repeatInterval repeatUntil exDates').lean(),
  ])
  const map = new Map(single.map(r => [String(r._id), r.n]))
  for (const ev of series) {
    const threshold = ev.allDay ? today.getTime() : now.getTime()
    const n = expandEvent(ev, new Date(threshold), horizon).filter(o => o.start.getTime() >= threshold).length
    if (n) map.set(String(ev.organizerId), (map.get(String(ev.organizerId)) ?? 0) + n)
  }
  return map
}

/** Map organizerId → counts (see serializeOrganizer). */
export async function organizerCounts(organizerIds, now = new Date()) {
  const ids = toObjectIds(organizerIds)
  if (!ids.length) return new Map()
  const today = dhakaToday(now)
  const [calendars, events, lists, notes, todoRows, upcoming] = await Promise.all([
    countBy(OrganizerCalendar, 'organizerId', ids),
    countBy(OrganizerEvent, 'organizerId', ids),
    countBy(OrganizerTodoList, 'organizerId', ids),
    countBy(OrganizerNote, 'organizerId', ids),
    OrganizerTodo.aggregate([
      { $match: { organizerId: { $in: ids } } },
      { $group: {
        _id: '$organizerId',
        open:    { $sum: { $cond: [{ $ne: ['$status', 'DONE'] }, 1, 0] } },
        done:    { $sum: { $cond: [{ $eq: ['$status', 'DONE'] }, 1, 0] } },
        overdue: { $sum: { $cond: [overdueExpr(today), 1, 0] } },
      } },
    ]),
    upcomingEventCounts(ids, now),
  ])
  const todos = new Map(todoRows.map(r => [String(r._id), r]))
  return new Map(ids.map(oid => {
    const id = String(oid)
    const t = todos.get(id)
    return [id, {
      calendars:      calendars.get(id) ?? 0,
      events:         events.get(id) ?? 0,
      upcomingEvents: upcoming.get(id) ?? 0,
      todoLists:      lists.get(id) ?? 0,
      todosOpen:      t?.open ?? 0,
      todosOverdue:   t?.overdue ?? 0,
      todosDone:      t?.done ?? 0,
      notes:          notes.get(id) ?? 0,
    }]
  }))
}

// ── hydration (docs → API shapes) ────────────────────────────────────────────

export async function hydrateOrganizers(docs, now = new Date()) {
  if (!docs.length) return []
  const [refs, counts] = await Promise.all([
    loadRefs({ clients: docs.map(d => d.clientId), projects: docs.flatMap(d => d.projectIds ?? []) }),
    organizerCounts(docs.map(d => d._id), now),
  ])
  return docs.map(d => serializeOrganizer(d, refs, counts.get(String(d._id))))
}

export async function hydrateOrganizer(doc, now = new Date()) {
  return (await hydrateOrganizers([doc], now))[0]
}

export async function hydrateCalendars(docs) {
  if (!docs.length) return []
  const ids = toObjectIds(docs.map(d => d._id))
  const [refs, eventCounts] = await Promise.all([
    loadRefs({ organizers: docs.map(d => d.organizerId) }),
    countBy(OrganizerEvent, 'calendarId', ids),
  ])
  return docs.map(d => serializeCalendar(d, refs, eventCounts.get(String(d._id)) ?? 0))
}

export async function hydrateLists(docs) {
  if (!docs.length) return []
  const ids = toObjectIds(docs.map(d => d._id))
  const [refs, rows] = await Promise.all([
    loadRefs({ organizers: docs.map(d => d.organizerId) }),
    OrganizerTodo.aggregate([
      { $match: { listId: { $in: ids } } },
      { $group: {
        _id: '$listId',
        open: { $sum: { $cond: [{ $ne: ['$status', 'DONE'] }, 1, 0] } },
        done: { $sum: { $cond: [{ $eq: ['$status', 'DONE'] }, 1, 0] } },
      } },
    ]),
  ])
  const counts = new Map(rows.map(r => [String(r._id), r]))
  return docs.map(d => serializeList(d, refs, counts.get(String(d._id))))
}

/** pairs: [{ ev, occ: { start, end } }] → occurrences. */
export async function hydrateOccurrences(pairs) {
  if (!pairs.length) return []
  const evs = pairs.map(p => p.ev)
  const refs = await loadRefs({
    organizers: evs.map(e => e.organizerId),
    calendars:  evs.map(e => e.calendarId),
    projects:   evs.map(e => e.projectId),
    users:      evs.map(e => e.createdBy),
  })
  return pairs.map(p => serializeOccurrence(p.ev, p.occ, refs))
}

/** A whole event (its master occurrence). */
export async function hydrateEvent(ev) {
  return (await hydrateOccurrences([{ ev, occ: { start: ev.start, end: ev.end } }]))[0]
}

export async function hydrateTodos(docs) {
  if (!docs.length) return []
  const refs = await loadRefs({
    organizers: docs.map(d => d.organizerId),
    lists:      docs.map(d => d.listId),
    projects:   docs.map(d => d.projectId),
    users:      docs.flatMap(d => [d.assigneeId, d.createdBy]),
  })
  return docs.map(d => serializeTodo(d, refs))
}

export async function hydrateNotes(docs) {
  if (!docs.length) return []
  const refs = await loadRefs({
    organizers: docs.map(d => d.organizerId),
    projects:   docs.map(d => d.projectId),
    users:      docs.flatMap(d => [d.createdBy, d.updatedBy]),
  })
  return docs.map(d => serializeNote(d, refs))
}

// ── scope & checks ───────────────────────────────────────────────────────────

/**
 * Organizer ids a list request is limited to, from `organizerIds` (or
 * `organizerId`) and `clientId` (organizers of that client). null = no limit;
 * [] = nothing matches.
 *
 * Master views (no organizer, calendar or list named) leave out ARCHIVED
 * organizers unless `includeArchived=1`; naming one explicitly always works.
 */
export async function organizerScope(searchParams) {
  let ids = parseIdList(searchParams.get('organizerIds') ?? searchParams.get('organizerId'))
  const explicit = ids !== null
    || ['calendarIds', 'calendarId', 'listIds', 'listId'].some(k => (searchParams.get(k) ?? '').trim())
  const clientId = (searchParams.get('clientId') ?? '').trim()
  if (clientId) {
    if (!isValidObjectId(clientId)) return []
    const ofClient = (await Organizer.find({ clientId }).select('_id').lean()).map(o => String(o._id))
    ids = ids === null ? ofClient : ids.filter(id => ofClient.includes(id))
  }
  if (!explicit && searchParams.get('includeArchived') !== '1') {
    const filter = { status: { $ne: 'ARCHIVED' } }
    if (ids !== null) filter._id = { $in: toObjectIds(ids) }
    ids = (await Organizer.find(filter).select('_id').lean()).map(o => String(o._id))
  }
  return ids
}

/** Next position (max + 1, 0 for the first) among docs matching `filter`. */
export async function nextPosition(Model, filter) {
  const last = await Model.findOne(filter).sort({ position: -1 }).select('position').lean()
  return (Number.isFinite(last?.position) ? last.position : -1) + 1
}

export async function assertClientExists(clientId) {
  if (!clientId) return
  if (!(await Client.exists({ _id: clientId }))) throw new HttpError(422, 'Client not found')
}

/** Projects must exist and, when the organizer has a client, belong to it. Returns the distinct ids. */
export async function assertProjectsForClient(projectIds, clientId) {
  const ids = uniqIds(projectIds)
  if (!ids.length) return []
  const projects = await Project.find({ _id: { $in: ids } }).select('clientId').lean()
  if (projects.length !== ids.length) throw new HttpError(422, 'Project not found')
  if (clientId && projects.some(p => String(p.clientId) !== String(clientId)))
    throw new HttpError(422, "Projects must belong to the organizer's client")
  return ids
}

/** A projectId on an event / to-do / note: must exist and match the organizer's client (if any). */
export async function assertProjectForOrganizer(projectId, organizer) {
  if (!projectId) return null
  const project = await Project.findById(projectId).select('name clientId').lean()
  if (!project) throw new HttpError(422, 'Project not found')
  if (organizer?.clientId && String(project.clientId) !== String(organizer.clientId))
    throw new HttpError(422, "Project doesn't belong to this organizer's client")
  return project
}

/** Same rule as assertProjectForOrganizer, as a boolean (used when a move may orphan a project). */
export async function projectFitsOrganizer(projectId, organizer) {
  if (!projectId) return true
  if (!organizer?.clientId) return !!(await Project.exists({ _id: projectId }))
  return !!(await Project.exists({ _id: projectId, clientId: organizer.clientId }))
}

/** Assignee must be an active staff user. */
export async function assertAssignee(userId) {
  if (!userId) return null
  const user = await User.findOne({ _id: userId, role: { $in: STAFF_ROLES }, isActive: { $ne: false } })
    .select('name').lean()
  if (!user) throw new HttpError(422, 'Assignee not found')
  return user
}

/** Organizer (lean, with clientId) or a 422/404 HttpError. */
export async function requireOrganizer(organizerId, { status = 422 } = {}) {
  const org = isValidObjectId(organizerId)
    ? await Organizer.findById(organizerId).select('name color clientId status').lean()
    : null
  if (!org) throw new HttpError(status, 'Organizer not found')
  return org
}
