export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import connectDB from '@/lib/mongodb'
import { OrganizerNote } from '@/models'
import { logActivity } from '@/lib/logActivity'
import { authorize, VIEW, MANAGE, readJson, validationFailed, handleError, actor, fieldError } from '@/lib/organizer/http'
import { parsePaging } from '@/lib/organizer/validation'
import { createNoteSchema, hasBody, noteFilter, queryNotes } from '@/lib/organizer/notes'
import { requireOrganizer, assertProjectForOrganizer, hydrateNotes } from '@/lib/organizer/refs'
import { ENTITY } from '@/lib/organizer/constants'

// GET /api/organizer/notes?organizerIds=&projectIds=&clientId=&tags=&pinned=1&search=
//   &sort=updated|created|title|organizer&dir=&pinnedFirst=0&page=&limit=
export async function GET(request) {
  try {
    const { denied } = await authorize(VIEW)
    if (denied) return denied
    await connectDB()

    const sp = new URL(request.url).searchParams
    const { page, limit, skip } = parsePaging(sp)
    const match = await noteFilter(sp)
    const { rows, total } = await queryNotes(match, sp, { skip, limit })

    return NextResponse.json({
      data: await hydrateNotes(rows),
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  } catch (err) {
    return handleError(err, '[GET /api/organizer/notes]')
  }
}

// POST /api/organizer/notes
export async function POST(request) {
  try {
    const { session, denied } = await authorize(MANAGE)
    if (denied) return denied
    await connectDB()

    const parsed = createNoteSchema.safeParse(await readJson(request))
    if (!parsed.success) return validationFailed(parsed.error)
    const body = parsed.data
    if (!hasBody(body.title, body.content)) throw fieldError('content', 'Add a title or some content')

    const org = await requireOrganizer(body.organizerId)
    if (body.projectId) await assertProjectForOrganizer(body.projectId, org)

    const note = await OrganizerNote.create({
      organizerId: org._id,
      projectId:   body.projectId ?? null,
      title:       body.title ?? '',
      content:     body.content ?? '',
      color:       body.color ?? 'zinc',
      pinned:      body.pinned ?? false,
      tags:        body.tags ?? [],
      createdBy:   session.user.id,
      updatedBy:   session.user.id,
    })

    logActivity({
      ...actor(session, request),
      action:   'CREATE',
      entity:   ENTITY.NOTE,
      entityId: note._id.toString(),
      changes:  JSON.stringify({ title: note.title, organizer: org.name }),
    })

    const [data] = await hydrateNotes([note.toObject()])
    return NextResponse.json({ data }, { status: 201 })
  } catch (err) {
    return handleError(err, '[POST /api/organizer/notes]')
  }
}
