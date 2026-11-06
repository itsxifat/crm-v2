/**
 * lib/organizer/serialize.js — the JSON shapes the organizer API returns.
 * Pure: every function takes a (lean or hydrated) document plus a `refs` bundle
 * of Maps (id → small ref object) built by lib/organizer/refs.js loadRefs().
 *
 * Refs: organizer/calendar/list {id,name,color} · project {id,name}
 *       client {id,name} · user {id,name,avatar}
 */
import { toYMD } from './dates.js'

export const idOf = (v) => (v === null || v === undefined ? null : String(v._id ?? v))
export const isoOf = (d) => {
  if (!d) return null
  const dt = d instanceof Date ? d : new Date(d)
  return Number.isNaN(dt.getTime()) ? null : dt.toISOString()
}

const pick = (map, id) => (id ? map?.get(String(id)) ?? null : null)

// ── ref shapers ──────────────────────────────────────────────────────────────
export const colorRef   = (doc) => ({ id: idOf(doc._id ?? doc.id), name: doc.name, color: doc.color })
export const projectRef = (doc) => ({ id: idOf(doc._id ?? doc.id), name: doc.name })
export const userRef    = (doc) => ({ id: idOf(doc._id ?? doc.id), name: doc.name, avatar: doc.avatar || null })

/** Sort comparator for serialized calendars / lists: organizer name, then position (stable). */
export function byOrganizerThenPosition(a, b) {
  return String(a.organizer?.name ?? '').localeCompare(String(b.organizer?.name ?? ''), undefined, { sensitivity: 'base' })
    || String(a.organizerId).localeCompare(String(b.organizerId))
    || ((a.position ?? 0) - (b.position ?? 0))
}

// ── entities ─────────────────────────────────────────────────────────────────

export const EMPTY_ORGANIZER_COUNTS = Object.freeze({
  calendars: 0, events: 0, upcomingEvents: 0, todoLists: 0, todosOpen: 0, todosOverdue: 0, todosDone: 0, notes: 0,
})

/** Organizer → { id, name, description, color, status, pinned, createdAt, updatedAt, client, projects, counts } */
export function serializeOrganizer(o, refs, counts) {
  return {
    id:          idOf(o._id ?? o.id),
    name:        o.name,
    description: o.description ?? null,
    color:       o.color ?? 'zinc',
    status:      o.status ?? 'ACTIVE',
    pinned:      !!o.pinned,
    createdAt:   isoOf(o.createdAt),
    updatedAt:   isoOf(o.updatedAt),
    client:      pick(refs.clients, o.clientId),
    projects:    (o.projectIds ?? []).map(id => pick(refs.projects, id)).filter(Boolean),
    counts:      { ...EMPTY_ORGANIZER_COUNTS, ...(counts ?? {}) },
  }
}

/** Calendar → { id, organizerId, name, color, description, position, eventCount, organizer } */
export function serializeCalendar(c, refs, eventCount = 0) {
  return {
    id:          idOf(c._id ?? c.id),
    organizerId: idOf(c.organizerId),
    name:        c.name,
    color:       c.color ?? 'blue',
    description: c.description ?? null,
    position:    c.position ?? 0,
    eventCount,
    organizer:   pick(refs.organizers, c.organizerId),
  }
}

/** List → { id, organizerId, name, color, position, openCount, doneCount, organizer } */
export function serializeList(l, refs, counts) {
  return {
    id:          idOf(l._id ?? l.id),
    organizerId: idOf(l.organizerId),
    name:        l.name,
    color:       l.color ?? 'zinc',
    position:    l.position ?? 0,
    openCount:   counts?.open ?? 0,
    doneCount:   counts?.done ?? 0,
    organizer:   pick(refs.organizers, l.organizerId),
  }
}

/**
 * One occurrence of an event (a non-recurring event is its own single occurrence).
 * `occ` = { start: Date, end: Date } from lib/organizer/recurrence.js expandEvent().
 */
export function serializeOccurrence(ev, occ, refs) {
  const id = idOf(ev._id ?? ev.id)
  const repeat = ev.repeat ?? 'NONE'
  const isRecurring = repeat !== 'NONE'
  const calendar = pick(refs.calendars, ev.calendarId)
  const start = isoOf(occ?.start ?? ev.start)
  return {
    id,
    key:            isRecurring ? `${id}:${start}` : id,
    title:          ev.title,
    description:    ev.description ?? null,
    location:       ev.location ?? null,
    allDay:         !!ev.allDay,
    start,
    end:            isoOf(occ?.end ?? ev.end),
    color:          ev.color || calendar?.color || 'blue',
    colorOverride:  ev.color ?? null,
    repeat,
    repeatInterval: ev.repeatInterval ?? 1,
    repeatUntil:    isoOf(ev.repeatUntil),
    isRecurring,
    occurrenceStart: start,
    seriesStart:    isoOf(ev.start),
    seriesEnd:      isoOf(ev.end),
    organizer:      pick(refs.organizers, ev.organizerId),
    calendar,
    project:        pick(refs.projects, ev.projectId),
    createdBy:      pick(refs.users, ev.createdBy),
    createdAt:      isoOf(ev.createdAt),
    updatedAt:      isoOf(ev.updatedAt),
  }
}

/** To-do → { id, title, notes, status, priority, dueDate 'YYYY-MM-DD'|null, tags, position, completedAt, … refs } */
export function serializeTodo(t, refs) {
  return {
    id:          idOf(t._id ?? t.id),
    title:       t.title,
    notes:       t.notes ?? null,
    status:      t.status ?? 'OPEN',
    priority:    t.priority ?? 'MEDIUM',
    dueDate:     toYMD(t.dueDate),
    tags:        t.tags ?? [],
    position:    t.position ?? 0,
    completedAt: isoOf(t.completedAt),
    createdAt:   isoOf(t.createdAt),
    updatedAt:   isoOf(t.updatedAt),
    organizer:   pick(refs.organizers, t.organizerId),
    list:        pick(refs.lists, t.listId),
    project:     pick(refs.projects, t.projectId),
    assignee:    pick(refs.users, t.assigneeId),
    createdBy:   pick(refs.users, t.createdBy),
  }
}

/** Note → { id, title, content, color, pinned, tags, createdAt, updatedAt, organizer, project, createdBy, updatedBy } */
export function serializeNote(n, refs) {
  return {
    id:        idOf(n._id ?? n.id),
    title:     n.title ?? '',
    content:   n.content ?? '',
    color:     n.color ?? 'zinc',
    pinned:    !!n.pinned,
    tags:      n.tags ?? [],
    createdAt: isoOf(n.createdAt),
    updatedAt: isoOf(n.updatedAt),
    organizer: pick(refs.organizers, n.organizerId),
    project:   pick(refs.projects, n.projectId),
    createdBy: pick(refs.users, n.createdBy),
    updatedBy: pick(refs.users, n.updatedBy),
  }
}
