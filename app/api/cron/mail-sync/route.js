export const dynamic = 'force-dynamic'
import { timingSafeEqual } from 'crypto'
import { getServerSession } from 'next-auth'
import { NextResponse } from 'next/server'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { MailAccount } from '@/models'
import { requireMailManager } from '@/lib/mail/access'
import { syncAccount } from '@/lib/mail/sync'
import { processDueOutbox } from '@/lib/mail/send'

const CONCURRENCY = 3

// Constant-time comparison of the scheduler secret.
function secretMatches(given, expected) {
  if (!given || !expected) return false
  const a = Buffer.from(String(given))
  const b = Buffer.from(String(expected))
  return a.length === b.length && timingSafeEqual(a, b)
}

// Fallback scheduler for deployments where the in-process mail worker can't run
// (serverless, MAIL_SYNC_WORKER=off). Syncs every active account and dispatches
// due outbox items. Point a cron (e.g. every 2 minutes) at:
//   POST /api/cron/mail-sync   with header  x-cron-secret: $CRON_SECRET
// A signed-in mail manager can also trigger it manually (POST only).
export async function POST(request) {
  try {
    if (!secretMatches(request.headers.get('x-cron-secret'), process.env.CRON_SECRET)) {
      // Manual trigger: POST only (a GET could be fired by a cross-site link).
      if (request.method !== 'POST') return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
      const session = await getServerSession(authOptions)
      const denied = requireMailManager(session)
      if (denied) return denied
    }

    await connectDB()
    const accounts = await MailAccount.find({ isActive: true, syncEnabled: true }).select('_id email').lean()

    const results = []
    const queue = [...accounts]
    const worker = async () => {
      while (queue.length) {
        const acc = queue.shift()
        const started = Date.now()
        const r = await syncAccount(acc._id, { reason: 'cron' })
        results.push({
          accountId: String(acc._id),
          email: acc.email,
          newMessages: r?.newMessages ?? 0,
          error: r?.error ?? null,
          skipped: !!r?.skipped,
          ms: Date.now() - started,
        })
      }
    }
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, queue.length) }, worker))

    let outbox
    try {
      outbox = await processDueOutbox()
    } catch (err) {
      console.error('[cron/mail-sync] outbox', err)
      outbox = { error: err?.message || 'Outbox dispatch failed' }
    }

    return NextResponse.json({ data: { accounts: results, outbox } })
  } catch (err) {
    console.error('[cron/mail-sync]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Convenience GET for schedulers that only issue GET requests (secret only).
export async function GET(request) {
  return POST(request)
}
