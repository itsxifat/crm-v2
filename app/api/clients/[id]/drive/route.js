export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Client, EncloudLink } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { getEncloudSettings, encloudReady } from '@/lib/integrations/settings'
import { encloud } from '@/lib/encloud/client'
import { syncClient } from '@/lib/encloud/sync'

const fail = (error, status) => NextResponse.json({ error }, { status })

async function driveState(client) {
  const settings = await getEncloudSettings()
  const enabled = encloudReady(settings)
  const link = await EncloudLink.findOne({ kind: 'CLIENT', refId: client._id }).lean()
  const out = {
    enabled,
    folder:   link?.folderId ? { id: link.folderId, url: link.folderUrl } : null,
    openDue:  link?.remote?.openDue ?? 0,
    projects: [],
    syncedAt: link?.syncedAt ?? null,
    error:    link?.error ?? null,
    liveError: null,
  }
  if (enabled && link?.folderId) {
    try {
      const r = await encloud.getClient(String(client._id), { settings })
      out.folder   = r.folder ? { id: r.folder.id, url: r.folder.url } : out.folder
      out.openDue  = Number(r.open_due) || 0
      out.projects = (r.projects ?? []).map(p => ({ crmId: p.crm_id, name: p.name, folderUrl: p.folder?.url ?? null }))
    } catch (err) {
      out.liveError = err?.message || 'encloud did not answer'
    }
  }
  return out
}

// GET /api/clients/:id/drive — the client's folder in encloud and what is locked there.
export async function GET(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'sales.customers.view')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return fail('Not found', 404)
    await connectDB()
    const client = await Client.findById(params.id).select('_id').lean()
    if (!client) return fail('Not found', 404)
    return NextResponse.json({ data: await driveState(client) })
  } catch (err) {
    console.error('[GET /api/clients/:id/drive]', err)
    return fail('Internal server error', 500)
  }
}

// POST /api/clients/:id/drive — create / update the client's folder in encloud now.
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'sales.customers.update')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return fail('Not found', 404)
    await connectDB()
    const client = await Client.findById(params.id).select('_id company clientCode').lean()
    if (!client) return fail('Not found', 404)
    if (!encloudReady(await getEncloudSettings())) return fail('Connect encloud in Configuration → Integrations first', 409)
    try {
      await syncClient(client._id, { force: true })
    } catch (err) {
      return fail(err?.message || 'encloud could not be reached', 502)
    }
    logActivity({
      userId: session.user.id, userRole: session.user.role, action: 'SYNC', entity: 'CLIENT',
      entityId: String(client._id), changes: JSON.stringify({ client: client.company ?? client.clientCode, to: 'encloud' }), request,
    })
    return NextResponse.json({ data: await driveState(client) })
  } catch (err) {
    console.error('[POST /api/clients/:id/drive]', err)
    return fail('Internal server error', 500)
  }
}
