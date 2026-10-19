export const dynamic = 'force-dynamic'
import { timingSafeEqual } from 'crypto'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { requirePerm } from '@/lib/rbac'
import { logActivity } from '@/lib/logActivity'
import { runDepreciation, periodOfDate, shiftPeriod, periodLabelOf } from '@/lib/inventory/depreciation'

// Constant-time comparison of the scheduler secret.
function secretMatches(given, expected) {
  if (!given || !expected) return false
  const a = Buffer.from(String(given))
  const b = Buffer.from(String(expected))
  return a.length === b.length && timingSafeEqual(a, b)
}

// Posts book depreciation for the PREVIOUS Dhaka month (missed earlier months
// are caught up inside the run). Idempotent: one DepreciationRun per month, so
// re-running only reports that the month is already posted.
//
// Auth: an external scheduler passing the CRON_SECRET header, OR a signed-in
// user with inventory.depreciation.run hitting it manually (POST only). There
// is no built-in scheduler — point a monthly cron (e.g. the 1st, 02:00 Dhaka) at:
//   POST /api/cron/depreciation   with header  x-cron-secret: $CRON_SECRET
async function run(session, request) {
  await connectDB()
  const period = shiftPeriod(periodOfDate(new Date()), -1)
  const label = periodLabelOf(period)
  try {
    const result = await runDepreciation(period, {
      userId: session?.user?.id ?? null,
      session,
      notes: session ? 'Posted from the scheduled-job endpoint (run manually)' : 'Posted automatically by the monthly scheduler',
    })
    if (session) {
      logActivity({
        userId: session.user.id,
        userRole: session.user.role,
        action: 'DEPRECIATE',
        entity: 'DEPRECIATION',
        entityId: result._id.toString(),
        changes: JSON.stringify({ period, totalAmount: result.totalAmount, assetCount: result.assetCount, via: 'cron-endpoint' }),
        request,
      })
    }
    return {
      period,
      label,
      status: 'posted',
      run: {
        id: result._id.toString(),
        totalAmount: result.totalAmount,
        assetCount: result.assetCount,
        transactionId: result.transactionId ? String(result.transactionId) : null,
      },
    }
  } catch (err) {
    // Already posted / later run exists / books locked / nothing to do — not a failure of the job.
    if (err?.status === 409 || err?.status === 422) return { period, label, status: 'skipped', reason: err.message }
    throw err
  }
}

export async function POST(request) {
  try {
    const validSecret = secretMatches(request.headers.get('x-cron-secret'), process.env.CRON_SECRET)
    let session = null
    if (!validSecret) {
      // Manual trigger: POST only (a GET could be fired by a cross-site link).
      if (request.method !== 'POST') return Response.json({ error: 'Unauthorised' }, { status: 401 })
      session = await getServerSession(authOptions)
      const denied = requirePerm(session, 'inventory.depreciation.run')
      if (denied) return denied
    }
    const out = await run(session, request)
    return Response.json({ ok: true, ...out })
  } catch (err) {
    if (err?.status) return Response.json({ error: err.message }, { status: err.status })
    console.error('[cron/depreciation]', err)
    return Response.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Convenience GET for schedulers that only issue GET requests (secret only).
export async function GET(request) {
  return POST(request)
}
