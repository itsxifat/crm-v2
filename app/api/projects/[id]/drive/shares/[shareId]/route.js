export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Project } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { canAccessProject } from '@/lib/projectAccess'
import { getEncloudSettings, encloudReady } from '@/lib/integrations/settings'
import { encloud } from '@/lib/encloud/client'

const fail = (error, status) => NextResponse.json({ error }, { status })

// DELETE /api/projects/:id/drive/shares/:shareId — turns the shared link off in
// encloud (everyone loses access at once). Only a link of this project's folder.
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'projects.update')
    if (denied) return denied
    const shareId = Number(params.shareId)
    if (!isValidObjectId(params.id) || !Number.isSafeInteger(shareId) || shareId <= 0) return fail('Not found', 404)
    await connectDB()
    const project = await Project.findById(params.id).select('name driveLink projectManagerId teamMembers').lean()
    if (!project) return fail('Not found', 404)
    if (!(await canAccessProject(session, project))) return fail('Forbidden', 403)
    const settings = await getEncloudSettings()
    if (!encloudReady(settings)) return fail('Connect encloud in Configuration → Integrations first', 409)

    let share
    try {
      const remote = await encloud.getProject(String(project._id), { settings })
      share = (remote.shares ?? []).find(s => Number(s.id) === shareId)
      if (!share) return fail('That link is not one of this project’s links', 404)
      await encloud.revokeShare(shareId, { settings })
    } catch (err) {
      return fail(err?.message || 'encloud could not be reached', 502)
    }

    if (share.url && project.driveLink === share.url) await Project.updateOne({ _id: project._id }, { $set: { driveLink: null } })
    logActivity({
      userId: session.user.id, userRole: session.user.role, action: 'CANCEL', entity: 'PROJECT_SHARE',
      entityId: String(project._id), changes: JSON.stringify({ project: project.name, shareId }), request,
    })
    return NextResponse.json({ ok: true })
  } catch (err) {
    console.error('[DELETE /api/projects/:id/drive/shares/:shareId]', err)
    return fail('Internal server error', 500)
  }
}
