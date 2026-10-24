export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { logActivity } from '@/lib/logActivity'
import { getEncloudSettings, encloudReady } from '@/lib/integrations/settings'
import { sweepEncloud } from '@/lib/encloud/sync'

// POST /api/settings/integrations/sync — a full encloud pass now: every client
// and project gets its folder (when automatic folders are on) and every unpaid
// invoice its due. Runs in the background; GET /api/settings/integrations shows
// progress (fullSyncRunning) and any errors.
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || session.user.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!encloudReady(await getEncloudSettings())) return NextResponse.json({ error: 'Connect encloud first' }, { status: 409 })
    if (globalThis.__encloudFullSync) return NextResponse.json({ started: false, running: true }, { status: 202 })

    globalThis.__encloudFullSync = sweepEncloud({ full: true })
      .then(counts => console.log('[encloud] full sync done', JSON.stringify(counts)))
      .catch(err => console.error('[encloud] full sync failed', err?.message || err))
      .finally(() => { globalThis.__encloudFullSync = null })

    logActivity({
      userId: session.user.id, userRole: session.user.role, action: 'SYNC', entity: 'SETTINGS',
      entityId: 'integrations', changes: JSON.stringify({ encloud: 'full sync' }), request,
    })
    return NextResponse.json({ started: true }, { status: 202 })
  } catch (err) {
    console.error('[POST /api/settings/integrations/sync]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
