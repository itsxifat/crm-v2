/**
 * lib/organizer/todos.js — SERVER-ONLY to-do helpers: request schemas, the
 * filter / sort pipeline behind GET /api/organizer/todos, and the write rules
 * (priorityRank, completedAt) shared by the create / update / reorder routes.
 */
import { z } from 'zod'
import { Organizer, OrganizerTodo } from '@/models'
import { isValidObjectId } from '@/lib/objectId'
import { ciContains } from '@/lib/searchMatch'
import { HttpError } from './http.js'
import { duePresetFilter, dhakaToday, parseYMD, DUE_PRESETS } from './dates.js'
import { TODO_STATUSES, TODO_PRIORITIES, PRIORITY_RANK } from './constants.js'
import {
  objectIdSchema, nullableIdSchema, nullableYmdSchema, optionalText, tagsSchema,
  parseIdList, parseEnumList, parseTagList, parseSearch, parseDir,
} from './validation.js'
import { organizerScope, toObjectIds, overdueExpr } from './refs.js'

// ── request schemas ──────────────────────────────────────────────────────────

const todoFields = {
  title:      z.string().trim().min(1, 'Title is required').max(300, 'At most 300 characters'),
  notes:      optionalText(5000),
  status:     z.enum(TODO_STATUSES),
  priority:   z.enum(TODO_PRIORITIES),
  dueDate:    nullableYmdSchema,
  assigneeId: nullableIdSchema,
  tags:       tagsSchema,
  projectId:  nullableIdSchema,
}

export const createTodoSchema = z.object({
  listId: objectIdSchema,
  ...todoFields,
  status:   todoFields.status.optional(),
  priority: todoFields.priority.optional(),
  tags:     todoFields.tags.optional(),
})

export const updateTodoSchema = z.object({
  ...todoFields,
  listId:   objectIdSchema,
  position: z.number().finite(),
}).partial()

export const reorderSchema = z.object({
  listId: objectIdSchema,
  ids:    z.array(objectIdSchema).min(1, 'Nothing to reorder').max(1000),
})

// ── write rules ──────────────────────────────────────────────────────────────

export function priorityRankOf(priority) {
  return PRIORITY_RANK[priority] ?? PRIORITY_RANK.MEDIUM
}

/** completedAt for a status change: stamped on the move into DONE, cleared when leaving it. */
export function completedAtFor(nextStatus, prevStatus, prevCompletedAt) {
  if (nextStatus !== 'DONE') return null
  return prevStatus === 'DONE' && prevCompletedAt ? prevCompletedAt : new Date()
}

// ── list query ───────────────────────────────────────────────────────────────

export const TODO_SORTS = ['due', 'priority', 'created', 'updated', 'title', 'organizer', 'status', 'position']
const ASC_BY_DEFAULT = new Set(['due', 'title', 'organizer', 'position', 'status'])
const NOTHING = { _id: { $in: [] } }

/**
 * Filters from the query string.
 * Returns { baseMatch (everything except status), fullMatch (with status) }.
 */
export async function todoFilters(sp, session) {
  const and = []

  const scope = await organizerScope(sp)
  if (scope) and.push({ organizerId: { $in: toObjectIds(scope) } })

  const listIds = parseIdList(sp.get('listIds') ?? sp.get('listId'))
  if (listIds) and.push({ listId: { $in: toObjectIds(listIds) } })

  const projectIds = parseIdList(sp.get('projectIds') ?? sp.get('projectId'))
  if (projectIds) and.push({ projectId: { $in: toObjectIds(projectIds) } })

  // Assignees: ids, 'me' (the caller) and 'none' (unassigned).
  const assigneeRaw = (sp.get('assigneeIds') ?? sp.get('assigneeId') ?? '').trim()
  if (assigneeRaw) {
    const ids = new Set()
    let unassigned = false
    for (const token of assigneeRaw.split(',').map(s => s.trim()).filter(Boolean)) {
      const t = token.toLowerCase()
      if (t === 'me') ids.add(String(session.user.id))
      else if (t === 'none') unassigned = true
      else if (isValidObjectId(token)) ids.add(token)
    }
    const or = []
    if (ids.size) or.push({ assigneeId: { $in: toObjectIds([...ids]) } })
    if (unassigned) or.push({ assigneeId: null })
    and.push(or.length ? { $or: or } : NOTHING)
  }

  const priorities = parseEnumList(sp.get('priority'), TODO_PRIORITIES)
  if (priorities) and.push(priorities.length ? { priority: { $in: priorities } } : NOTHING)

  const tags = parseTagList(sp.get('tags'))
  if (tags) and.push({ tags: { $in: tags } })

  const due = (sp.get('due') ?? '').trim().toLowerCase()
  if (due && DUE_PRESETS.includes(due)) and.push(duePresetFilter(due))

  const dueFromRaw = (sp.get('dueFrom') ?? '').trim()
  if (dueFromRaw) {
    const d = parseYMD(dueFromRaw)
    if (!d) throw new HttpError(422, 'dueFrom must be YYYY-MM-DD')
    and.push({ dueDate: { $gte: d } })
  }
  const dueToRaw = (sp.get('dueTo') ?? '').trim()
  if (dueToRaw) {
    const d = parseYMD(dueToRaw)
    if (!d) throw new HttpError(422, 'dueTo must be YYYY-MM-DD')
    and.push({ dueDate: { $lte: d } })
  }

  const search = parseSearch(sp.get('search'))
  if (search) and.push({ $or: [{ title: ciContains(search) }, { notes: ciContains(search) }] })

  const statuses = parseEnumList(sp.get('status'), TODO_STATUSES)
  const baseMatch = and.length ? { $and: and } : {}
  const statusClause = statuses ? (statuses.length ? { status: { $in: statuses } } : NOTHING) : null
  const fullMatch = statusClause ? { $and: [...and, statusClause] } : baseMatch
  return { baseMatch, fullMatch }
}

/**
 * Aggregation stages sorting to-dos (before pagination).
 * Null due dates always sort last on `due`; ties: priorityRank desc, createdAt desc.
 */
export function todoSortStages(sortParam, dirParam) {
  const sortKey = TODO_SORTS.includes(sortParam) ? sortParam : 'due'
  const dir = parseDir(dirParam, ASC_BY_DEFAULT.has(sortKey) ? 'asc' : 'desc') === 'asc' ? 1 : -1
  const ties = { priorityRank: -1, createdAt: -1, _id: -1 }

  const stages = []
  const add = { _noDue: { $cond: [{ $eq: [{ $ifNull: ['$dueDate', null] }, null] }, 1, 0] } }
  let sort
  switch (sortKey) {
    case 'priority': sort = { priorityRank: dir, _noDue: 1, dueDate: 1, createdAt: -1, _id: -1 }; break
    case 'created':  sort = { createdAt: dir, _id: dir }; break
    case 'updated':  sort = { updatedAt: dir, ...ties }; break
    case 'title':
      add._title = { $toLower: { $ifNull: ['$title', ''] } }
      sort = { _title: dir, ...ties }
      break
    case 'organizer':
      stages.push({ $lookup: { from: Organizer.collection.name, localField: 'organizerId', foreignField: '_id', as: '_org' } })
      add._orgName = { $toLower: { $ifNull: [{ $arrayElemAt: ['$_org.name', 0] }, ''] } }
      sort = { _orgName: dir, ...ties }
      break
    case 'status':
      add._statusRank = { $switch: {
        branches: [
          { case: { $eq: ['$status', 'OPEN'] }, then: 1 },
          { case: { $eq: ['$status', 'IN_PROGRESS'] }, then: 2 },
        ],
        default: 3,
      } }
      sort = { _statusRank: dir, ...ties }
      break
    case 'position': sort = { position: dir, ...ties }; break
    case 'due':
    default:         sort = { _noDue: 1, dueDate: dir, ...ties }
  }
  stages.push({ $addFields: add }, { $sort: sort })
  return stages
}

const HELPER_FIELDS = { _org: 0, _orgName: 0, _noDue: 0, _title: 0, _statusRank: 0 }

/** One page of to-dos (lean rows) + total + status counts over `baseMatch`. */
export async function queryTodos({ baseMatch, fullMatch, sort, dir, skip, limit }) {
  const [facet, countRows] = await Promise.all([
    OrganizerTodo.aggregate([
      { $match: fullMatch },
      ...todoSortStages(sort, dir),
      { $facet: {
        rows:  [{ $skip: skip }, { $limit: limit }, { $project: HELPER_FIELDS }],
        total: [{ $count: 'n' }],
      } },
    ]),
    OrganizerTodo.aggregate([
      { $match: baseMatch },
      { $group: {
        _id: null,
        OPEN:        { $sum: { $cond: [{ $eq: ['$status', 'OPEN'] }, 1, 0] } },
        IN_PROGRESS: { $sum: { $cond: [{ $eq: ['$status', 'IN_PROGRESS'] }, 1, 0] } },
        DONE:        { $sum: { $cond: [{ $eq: ['$status', 'DONE'] }, 1, 0] } },
        overdue:     { $sum: { $cond: [overdueExpr(dhakaToday()), 1, 0] } },
      } },
    ]),
  ])
  const c = countRows[0] ?? {}
  return {
    rows:  facet[0]?.rows ?? [],
    total: facet[0]?.total?.[0]?.n ?? 0,
    counts: { OPEN: c.OPEN ?? 0, IN_PROGRESS: c.IN_PROGRESS ?? 0, DONE: c.DONE ?? 0, overdue: c.overdue ?? 0 },
  }
}
