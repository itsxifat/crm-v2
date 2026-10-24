export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Project, EncloudLink } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { canAccessProject } from '@/lib/projectAccess'
import { getEncloudSettings, encloudReady } from '@/lib/integrations/settings'
import { encloud } from '@/lib/encloud/client'
import { syncProject } from '@/lib/encloud/sync'
import { z } from 'zod'

const fail = (error, status) => NextResponse.json({ error }, { status })

async function guard(session, id) {
  if (!isValidObjectId(id)) return { res: fail('Not found', 404) }
  await connectDB()
  const project = await Project.findById(id).select('name status clientId driveLink projectManagerId teamMembers').lean()
  if (!project) return { res: fail('Not found', 404) }
  if (!(await canAccessProject(session, project))) return { res: fail('Forbidden', 403) }
  return { project }
}

/** The project's files: its encloud folder, live counts and shared links, and the client link. */
async function driveState(project, { live = true } = {}) {
  const settings = await getEncloudSettings()
  const enabled = encloudReady(settings)
  const link = await EncloudLink.findOne({ kind: 'PROJECT', refId: project._id }).lean()
  const out = {
    enabled,
    autoFolders: settings.autoFolders !== false,
    driveLink:   project.driveLink ?? null,
    folder:      link?.folderId ? { id: link.folderId, url: link.folderUrl } : null,
    stats:       link?.remote ? { files: link.remote.files ?? 0, bytes: link.remote.bytes ?? 0, openDue: link.remote.openDue ?? 0 } : null,
    shares:      [],
    syncedAt:    link?.syncedAt ?? null,
    error:       link?.error ?? null,
    liveError:   null,
  }
  if (enabled && live && link?.folderId) {
    try {
      const r = await encloud.getProject(String(project._id), { settings })
      out.folder = r.folder ? { id: r.folder.id, url: r.folder.url } : out.folder
      out.stats  = { files: Number(r.files) || 0, bytes: Number(r.bytes) || 0, openDue: Number(r.open_due) || 0 }
      out.shares = Array.isArray(r.shares) ? r.shares : []
      await EncloudLink.updateOne({ _id: link._id }, { $set: { remote: { ...out.stats, at: new Date() } } })
    } catch (err) {
      out.liveError = err?.message || 'encloud did not answer'
    }
  }
  return out
}

// GET /api/projects/:id/drive
export async function GET(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'projects.view')
    if (denied) return denied
    const { project, res } = await guard(session, params.id)
    if (res) return res
    return NextResponse.json({ data: await driveState(project) })
  } catch (err) {
    console.error('[GET /api/projects/:id/drive]', err)
    return fail('Internal server error', 500)
  }
}

const patchSchema = z.object({
  driveLink: z.union([z.literal(''), z.null(), z.string().trim().max(1000).url()]),
})

// PATCH /api/projects/:id/drive — { driveLink }: the link the client gets the files from
// (an encloud shared link, Google Drive, Dropbox…). '' / null clears it.
export async function PATCH(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'projects.update')
    if (denied) return denied
    const { project, res } = await guard(session, params.id)
    if (res) return res
    let raw
    try { raw = await request.json() } catch { return fail('Invalid JSON body', 400) }
    const parsed = patchSchema.safeParse(raw ?? {})
    if (!parsed.success) return fail('Enter a full link, starting with https://', 422)
    const driveLink = parsed.data.driveLink || null
    if (driveLink && !/^https?:\/\//i.test(driveLink)) return fail('Enter a full link, starting with https://', 422)

    await Project.updateOne({ _id: project._id }, { $set: { driveLink } })
    logActivity({
      userId: session.user.id, userRole: session.user.role, action: 'UPDATE', entity: 'PROJECT',
      entityId: String(project._id), changes: JSON.stringify({ driveLink: { from: project.driveLink ?? null, to: driveLink } }), request,
    })
    return NextResponse.json({ data: await driveState({ ...project, driveLink }, { live: false }) })
  } catch (err) {
    console.error('[PATCH /api/projects/:id/drive]', err)
    return fail('Internal server error', 500)
  }
}

// POST /api/projects/:id/drive — { action: 'sync' }: create / update the folder in encloud now.
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'projects.update')
    if (denied) return denied
    const { project, res } = await guard(session, params.id)
    if (res) return res
    if (!encloudReady(await getEncloudSettings())) return fail('Connect encloud in Configuration → Integrations first', 409)
    try {
      await syncProject(project._id, { force: true })
    } catch (err) {
      return fail(err?.message || 'encloud could not be reached', 502)
    }
    logActivity({
      userId: session.user.id, userRole: session.user.role, action: 'SYNC', entity: 'PROJECT',
      entityId: String(project._id), changes: JSON.stringify({ name: project.name, to: 'encloud' }), request,
    })
    return NextResponse.json({ data: await driveState(project) })
  } catch (err) {
    console.error('[POST /api/projects/:id/drive]', err)
    return fail('Internal server error', 500)
  }
}
