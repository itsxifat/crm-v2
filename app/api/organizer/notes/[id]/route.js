export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import { OrganizerNote } from '@/models'
import { logActivity } from '@/lib/logActivity'
import { isValidObjectId } from '@/lib/objectId'
import {
  authorize, VIEW, MANAGE, readJson, validationFailed, handleError, actor, jsonError, fieldError,
} from '@/lib/organizer/http'
import { updateNoteSchema, hasBody } from '@/lib/organizer/notes'
import { requireOrganizer, assertProjectForOrganizer, projectFitsOrganizer, hydrateNotes } from '@/lib/organizer/refs'
import { ENTITY } from '@/lib/organizer/constants'

const notFound = () => jsonError('Note not found', 404)

// GET /api/organizer/notes/[id]
export async function GET(request, { params }) {
  try {
    const { denied } = await authorize(VIEW)
    if (denied) return denied
    if (!isValidObjectId(params.id)) return notFound()
    await connectDB()

    const note = await OrganizerNote.findById(params.id).lean()
    if (!note) return notFound()
    const [data] = await hydrateNotes([note])
    return NextResponse.json({ data })
  } catch (err) {
    return handleError(err, '[GET /api/organizer/notes/[id]]')
  }
}

// PATCH /api/organizer/notes/[id] — partial; organizerId moves the note
export async function PATCH(request, { params }) {
  try {
    const { session, denied } = await authorize(MANAGE)
    if (denied) return denied
    if (!isValidObjectId(params.id)) return notFound()
    await connectDB()

    const parsed = updateNoteSchema.safeParse(await readJson(request))
    if (!parsed.success) return validationFailed(parsed.error)
    const p = parsed.data

    const note = await OrganizerNote.findById(params.id)
    if (!note) return notFound()

    const organizerChanged = p.organizerId !== undefined && p.organizerId !== String(note.organizerId)
    const org = await requireOrganizer(organizerChanged ? p.organizerId : note.organizerId)
    if (organizerChanged) note.organizerId = org._id

    // Project — must match the organizer's client; a move that orphans it clears it.
    if (p.projectId !== undefined) {
      if (p.projectId) await assertProjectForOrganizer(p.projectId, org)
      note.projectId = p.projectId ?? null
    } else if (organizerChanged && note.projectId && !(await projectFitsOrganizer(note.projectId, org))) {
      note.projectId = null
    }

    for (const k of ['title', 'content', 'color', 'pinned', 'tags']) {
      if (p[k] !== undefined) note[k] = p[k]
    }
    if (!hasBody(note.title, note.content)) throw fieldError('content', 'Add a title or some content')

    // Pinning alone doesn't count as an edit.
    const keys = Object.keys(p).filter(k => p[k] !== undefined)
    const pinOnly = keys.length > 0 && keys.every(k => k === 'pinned')
    if (!pinOnly) note.updatedBy = session.user.id
    await note.save({ timestamps: !pinOnly })

    logActivity({
      ...actor(session, request),
      action:   'UPDATE',
      entity:   ENTITY.NOTE,
      entityId: params.id,
      changes:  JSON.stringify({ title: note.title, fields: keys }),
    })

    const [data] = await hydrateNotes([note.toObject()])
    return NextResponse.json({ data })
  } catch (err) {
    return handleError(err, '[PATCH /api/organizer/notes/[id]]')
  }
}

// DELETE /api/organizer/notes/[id]
export async function DELETE(request, { params }) {
  try {
    const { session, denied } = await authorize(MANAGE)
    if (denied) return denied
    if (!isValidObjectId(params.id)) return notFound()
    await connectDB()

    const note = await OrganizerNote.findByIdAndDelete(params.id)
    if (!note) return notFound()

    logActivity({
      ...actor(session, request),
      action:   'DELETE',
      entity:   ENTITY.NOTE,
      entityId: params.id,
      changes:  JSON.stringify({ title: note.title }),
    })
    return NextResponse.json({ data: { id: params.id } })
  } catch (err) {
    return handleError(err, '[DELETE /api/organizer/notes/[id]]')
  }
}
