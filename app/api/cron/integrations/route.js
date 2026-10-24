export const dynamic = 'force-dynamic'
import { timingSafeEqual } from 'crypto'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { runIntegrationsPass } from '@/lib/integrations/worker'

// Constant-time comparison of the scheduler secret.
function secretMatches(given, expected) {
  if (!given || !expected) return false
  const a = Buffer.from(String(given))
  const b = Buffer.from(String(expected))
  return a.length === b.length && timingSafeEqual(a, b)
}

// POST /api/cron/integrations — one pass of the integrations' background work:
// encloud sync of recent changes and retries, Enfinito Pay checkouts with no
// answer yet. The built-in worker (instrumentation.js) already does this every
// minute; this is for deployments that turn it off (INTEGRATIONS_WORKER=off).
//   POST /api/cron/integrations   header  x-cron-secret: $CRON_SECRET   (?full=1 for a full encloud pass)
export async function POST(request) {
  try {
    const viaCron = secretMatches(request.headers.get('x-cron-secret'), process.env.CRON_SECRET)
    if (!viaCron) {
      const session = await getServerSession(authOptions)
      if (!session || session.user.role !== 'SUPER_ADMIN') return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    const full = new URL(request.url).searchParams.get('full') === '1'
    const since = full ? null : new Date(Date.now() - 10 * 60_000)
    return NextResponse.json({ data: await runIntegrationsPass({ full, since }) })
  } catch (err) {
    console.error('[POST /api/cron/integrations]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
