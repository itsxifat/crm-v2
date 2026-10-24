export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Project, Client, User, CompanyMembership, EncloudLink } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { canAccessProject } from '@/lib/projectAccess'
import { getEncloudSettings, encloudReady } from '@/lib/integrations/settings'
import { encloud } from '@/lib/encloud/client'
import { syncProject } from '@/lib/encloud/sync'
import { z } from 'zod'

const fail = (error, status) => NextResponse.json({ error }, { status })
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/** Everyone the client is: the company email, the account holder and every active member. */
async function clientEmails(clientId) {
  const client = await Client.findById(clientId).select('companyEmail userId').lean()
  if (!client) return []
  const members = await CompanyMembership.find({ clientId, status: 'ACTIVE' }).select('userId').lean()
  const ids = [client.userId, ...members.map(m => m.userId)].filter(Boolean)
  const users = ids.length ? await User.find({ _id: { $in: ids }, isActive: { $ne: false } }).select('email').lean() : []
  return [...new Set([client.companyEmail, ...users.map(u => u.email)]
    .map(e => String(e ?? '').trim().toLowerCase())
    .filter(e => EMAIL_RE.test(e)))]
}

const bodySchema = z.object({
  // Send to the client's own addresses (resolved here, never shown to staff without contact access).
  toClient:      z.boolean().default(true),
  emails:        z.array(z.string().trim().toLowerCase().email().max(200)).max(50).default([]),
  access:        z.enum(['restricted', 'public']).default('restricted'),
  expiresInDays: z.number().int().min(1).max(3650).nullable().optional(),   // null = never; missing = encloud default
  allowDownload: z.boolean().default(true),
  password:      z.string().min(8).max(200).nullable().optional(),
  notify:        z.boolean().default(true),
  message:       z.string().trim().max(2000).default(''),
  setAsClientLink: z.boolean().default(true),
})

// POST /api/projects/:id/drive/shares — share the project's folder from encloud.
// "restricted": only the given people, each confirming their email with a
// one-time code; "public": anyone with the link. An unpaid invoice of the
// project keeps the files locked until it is paid (encloud asks for payment).
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'projects.update')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return fail('Not found', 404)
    await connectDB()
    const project = await Project.findById(params.id).select('name clientId driveLink projectManagerId teamMembers').lean()
    if (!project) return fail('Not found', 404)
    if (!(await canAccessProject(session, project))) return fail('Forbidden', 403)
    const settings = await getEncloudSettings()
    if (!encloudReady(settings)) return fail('Connect encloud in Configuration → Integrations first', 409)

    let raw
    try { raw = await request.json() } catch { return fail('Invalid JSON body', 400) }
    const parsed = bodySchema.safeParse(raw ?? {})
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return fail(issue?.path?.[0] === 'password' ? 'The password needs at least 8 characters' : `Check ${issue?.path?.join('.') || 'the form'}: ${issue?.message ?? 'invalid'}`, 422)
    }
    const d = parsed.data
    const emails = [...new Set([...(d.toClient ? await clientEmails(project.clientId) : []), ...d.emails])].slice(0, 100)
    if (d.access === 'restricted' && emails.length === 0) {
      return fail('This client has no email address yet. Add one to the client, or type the email to share with.', 422)
    }

    // The folder must exist in encloud first.
    const link = await EncloudLink.findOne({ kind: 'PROJECT', refId: project._id }).select('folderId').lean()
    try {
      if (!link?.folderId) await syncProject(project._id, { force: true, settings })
    } catch (err) {
      return fail(err?.message || 'encloud could not be reached', 502)
    }

    let share
    try {
      share = await encloud.shareProject(String(project._id), {
        access:         d.access,
        emails:         d.access === 'restricted' ? emails : [],
        ...(d.expiresInDays === undefined ? {} : { expires_at: d.expiresInDays === null ? null : new Date(Date.now() + d.expiresInDays * 86_400_000).toISOString() }),
        allow_download: d.allowDownload,
        password:       d.password || null,
        notify:         d.notify && d.access === 'restricted',
        message:        d.message,
        label:          `From the CRM by ${session.user.name ?? 'staff'}`.slice(0, 200),
      }, { settings })
    } catch (err) {
      return fail(err?.message || 'encloud could not make the link', err?.status && err.status < 500 ? 422 : 502)
    }

    if (d.setAsClientLink && share?.url) await Project.updateOne({ _id: project._id }, { $set: { driveLink: share.url } })
    logActivity({
      userId: session.user.id, userRole: session.user.role, action: 'CREATE', entity: 'PROJECT_SHARE',
      entityId: String(project._id),
      changes: JSON.stringify({ project: project.name, shareId: share?.id ?? null, access: d.access, recipients: emails.length, notify: d.notify }),
      request,
    })
    return NextResponse.json({ data: share }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/projects/:id/drive/shares]', err)
    return fail('Internal server error', 500)
  }
}
