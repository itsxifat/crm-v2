/**
 * lib/organizer/notes.js — SERVER-ONLY note helpers: request schemas and the
 * filter / sort pipeline behind GET /api/organizer/notes.
 */
import { z } from 'zod'
import { Organizer, OrganizerNote } from '@/models'
import { ciContains } from '@/lib/searchMatch'
import {
  objectIdSchema, nullableIdSchema, paletteSchema, tagsSchema,
  parseIdList, parseTagList, parseSearch, parseDir,
} from './validation.js'
import { organizerScope, toObjectIds } from './refs.js'

// ── request schemas ──────────────────────────────────────────────────────────

const nullToEmpty = (v) => (v === null ? '' : v)

const noteFields = {
  organizerId: objectIdSchema,
  title:       z.preprocess(nullToEmpty, z.string().trim().max(200, 'At most 200 characters')),
  content:     z.preprocess(nullToEmpty, z.string().max(50000, 'At most 50,000 characters')),
  color:       paletteSchema,
  pinned:      z.boolean(),
  tags:        tagsSchema,
  projectId:   nullableIdSchema,
}

export const createNoteSchema = z.object(noteFields).partial().required({ organizerId: true })
export const updateNoteSchema = z.object(noteFields).partial()

/** A note needs a title or some content. */
export function hasBody(title, content) {
  return !!(String(title ?? '').trim() || String(content ?? '').trim())
}

// ── list query ───────────────────────────────────────────────────────────────

export const NOTE_SORTS = ['updated', 'created', 'title', 'organizer']
const NOTHING = { _id: { $in: [] } }
const HELPER_FIELDS = { _org: 0, _orgName: 0, _title: 0 }

/** Mongo match for the notes list query string. */
export async function noteFilter(sp) {
  const and = []

  const scope = await organizerScope(sp)
  if (scope) and.push(scope.length ? { organizerId: { $in: toObjectIds(scope) } } : NOTHING)

  const projectIds = parseIdList(sp.get('projectIds') ?? sp.get('projectId'))
  if (projectIds) and.push({ projectId: { $in: toObjectIds(projectIds) } })

  const tags = parseTagList(sp.get('tags'))
  if (tags) and.push({ tags: { $in: tags } })

  const pinned = (sp.get('pinned') ?? '').trim().toLowerCase()
  if (pinned === '1' || pinned === 'true') and.push({ pinned: true })

  const search = parseSearch(sp.get('search'))
  if (search) and.push({ $or: [{ title: ciContains(search) }, { content: ciContains(search) }, { tags: ciContains(search) }] })

  return and.length ? { $and: and } : {}
}

/** One page of notes (lean rows) + total. Pinned first unless pinnedFirst=0. */
export async function queryNotes(match, sp, { skip, limit }) {
  const sortKey = NOTE_SORTS.includes(sp.get('sort')) ? sp.get('sort') : 'updated'
  const dir = parseDir(sp.get('dir'), sortKey === 'title' || sortKey === 'organizer' ? 'asc' : 'desc') === 'asc' ? 1 : -1
  const pf = (sp.get('pinnedFirst') ?? '').trim().toLowerCase()
  const pinnedFirst = !(pf === '0' || pf === 'false')

  const stages = []
  let sort
  switch (sortKey) {
    case 'created': sort = { createdAt: dir, _id: dir }; break
    case 'title':
      stages.push({ $addFields: { _title: { $toLower: { $ifNull: ['$title', ''] } } } })
      sort = { _title: dir, updatedAt: -1, _id: -1 }
      break
    case 'organizer':
      stages.push(
        { $lookup: { from: Organizer.collection.name, localField: 'organizerId', foreignField: '_id', as: '_org' } },
        { $addFields: { _orgName: { $toLower: { $ifNull: [{ $arrayElemAt: ['$_org.name', 0] }, ''] } } } },
      )
      sort = { _orgName: dir, updatedAt: -1, _id: -1 }
      break
    case 'updated':
    default: sort = { updatedAt: dir, _id: dir }
  }
  if (pinnedFirst) sort = { pinned: -1, ...sort }

  const [facet] = await OrganizerNote.aggregate([
    { $match: match },
    ...stages,
    { $sort: sort },
    { $facet: {
      rows:  [{ $skip: skip }, { $limit: limit }, { $project: HELPER_FIELDS }],
      total: [{ $count: 'n' }],
    } },
  ])
  return { rows: facet?.rows ?? [], total: facet?.total?.[0]?.n ?? 0 }
}
