export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { z } from 'zod'
import connectDB from '@/lib/mongodb'
import {
  Organizer, OrganizerCalendar, OrganizerEvent, OrganizerTodoList, OrganizerTodo, OrganizerNote, Project,
} from '@/models'
import { logActivity } from '@/lib/logActivity'
import { isValidObjectId } from '@/lib/objectId'
import { authorize, VIEW, MANAGE, readJson, validationFailed, handleError, actor, jsonError } from '@/lib/organizer/http'
import { paletteSchema, optionalText, objectIdSchema, nullableIdSchema } from '@/lib/organizer/validation'
import {
  hydrateOrganizer, hydrateCalendars, hydrateLists, assertClientExists, assertProjectsForClient, uniqIds,
} from '@/lib/organizer/refs'
import { ORGANIZER_STATUSES, ENTITY } from '@/lib/organizer/constants'

const updateSchema = z.object({
  name:        z.string().trim().min(1, 'Name is required').max(120, 'At most 120 characters').optional(),
  description: optionalText(2000),
  color:       paletteSchema.optional(),
  clientId:    nullableIdSchema,
  projectIds:  z.array(objectIdSchema).max(200).optional().nullable(),
  status:      z.enum(ORGANIZER_STATUSES).optional(),
  pinned:      z.boolean().optional(),
})

const notFound = () => jsonError('Organizer not found', 404)

// GET /api/organizer/organizers/[id] — organizer + its calendars and to-do lists
export async function GET(request, { params }) {
  try {
    const { denied } = await authorize(VIEW)
    if (denied) return denied
    if (!isValidObjectId(params.id)) return notFound()
    await connectDB()

    const org = await Organizer.findById(params.id).lean()
    if (!org) return notFound()

    const [calendars, lists] = await Promise.all([
      OrganizerCalendar.find({ organizerId: org._id }).sort({ position: 1, createdAt: 1 }).lean(),
      OrganizerTodoList.find({ organizerId: org._id }).sort({ position: 1, createdAt: 1 }).lean(),
    ])
    const [data, cals, lsts] = await Promise.all([
      hydrateOrganizer(org),
      hydrateCalendars(calendars),
      hydrateLists(lists),
    ])
    return NextResponse.json({ data: { ...data, calendars: cals, lists: lsts } })
  } catch (err) {
    return handleError(err, '[GET /api/organizer/organizers/[id]]')
  }
}

// PATCH /api/organizer/organizers/[id]
export async function PATCH(request, { params }) {
  try {
    const { session, denied } = await authorize(MANAGE)
    if (denied) return denied
    if (!isValidObjectId(params.id)) return notFound()
    await connectDB()

    const parsed = updateSchema.safeParse(await readJson(request))
    if (!parsed.success) return validationFailed(parsed.error)
    const p = parsed.data

    const org = await Organizer.findById(params.id)
    if (!org) return notFound()

    const clientChanged = p.clientId !== undefined && String(p.clientId ?? '') !== String(org.clientId ?? '')
    const clientId = p.clientId !== undefined ? (p.clientId ?? null) : org.clientId
    if (clientChanged && clientId) await assertClientExists(clientId)

    if (p.projectIds !== undefined) {
      // Newly linked projects are validated strictly; already-linked ones that no
      // longer fit (deleted, or moved to another client) are dropped quietly, so
      // an unrelated edit like a rename never fails on them.
      const existing = new Set(org.projectIds.map(String))
      const incoming = uniqIds(p.projectIds ?? [])
      const added = await assertProjectsForClient(incoming.filter(id => !existing.has(id)), clientId)
      const kept = incoming.filter(id => existing.has(id))
      const stillValid = kept.length
        ? uniqIds(await Project.find({ _id: { $in: kept }, ...(clientId ? { clientId } : {}) }).distinct('_id'))
        : []
      const valid = new Set([...added, ...stillValid])
      org.projectIds = incoming.filter(id => valid.has(id))
    } else if (clientChanged && clientId && org.projectIds.length) {
      // New client: keep only the linked projects that belong to it.
      const keep = new Set(uniqIds(
        await Project.find({ _id: { $in: org.projectIds }, clientId }).distinct('_id'),
      ))
      org.projectIds = org.projectIds.filter(id => keep.has(String(id)))
    }
    if (p.clientId !== undefined) org.clientId = clientId

    for (const k of ['name', 'description', 'color', 'status', 'pinned']) {
      if (p[k] !== undefined) org[k] = p[k]
    }

    // Pinning alone doesn't count as an edit (keeps "recently updated" honest).
    const keys = Object.keys(p).filter(k => p[k] !== undefined)
    const pinOnly = keys.length > 0 && keys.every(k => k === 'pinned')
    await org.save({ timestamps: !pinOnly })

    logActivity({
      ...actor(session, request),
      action:   p.status !== undefined ? 'STATUS_CHANGE' : 'UPDATE',
      entity:   ENTITY.ORGANIZER,
      entityId: params.id,
      changes:  JSON.stringify({ name: org.name, ...p }),
    })

    return NextResponse.json({ data: await hydrateOrganizer(org.toObject()) })
  } catch (err) {
    return handleError(err, '[PATCH /api/organizer/organizers/[id]]')
  }
}

// DELETE /api/organizer/organizers/[id] — cascades calendars, events, lists, to-dos, notes
export async function DELETE(request, { params }) {
  try {
    const { session, denied } = await authorize(MANAGE)
    if (denied) return denied
    if (!isValidObjectId(params.id)) return notFound()
    await connectDB()

    const org = await Organizer.findByIdAndDelete(params.id)
    if (!org) return notFound()

    const organizerId = org._id
    await Promise.all([
      OrganizerCalendar.deleteMany({ organizerId }),
      OrganizerEvent.deleteMany({ organizerId }),
      OrganizerTodoList.deleteMany({ organizerId }),
      OrganizerTodo.deleteMany({ organizerId }),
      OrganizerNote.deleteMany({ organizerId }),
    ])

    logActivity({
      ...actor(session, request),
      action:   'DELETE',
      entity:   ENTITY.ORGANIZER,
      entityId: params.id,
      changes:  JSON.stringify({ name: org.name }),
    })

    return NextResponse.json({ data: { id: params.id } })
  } catch (err) {
    return handleError(err, '[DELETE /api/organizer/organizers/[id]]')
  }
}
