export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { requireMailUser, getUsableAccount } from '@/lib/mail/access'
import { syncAccount } from '@/lib/mail/sync'
import { mailError } from '../../../_lib/http'

const WAIT_MS = 25000

// POST /api/mail/accounts/[id]/sync — "Sync now". Waits up to ~25s, then lets it finish in the background.
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireMailUser(session)
    if (denied) return denied

    await connectDB()
    const { account, error } = await getUsableAccount(session, params.id, '_id isActive assignedUsers')
    if (error) return error

    const run = syncAccount(String(account._id), { reason: 'manual' })
    run.catch(() => {})
    let timer
    const timeout = new Promise(resolve => { timer = setTimeout(() => resolve({ queued: true }), WAIT_MS) })
    const result = await Promise.race([run, timeout])
    clearTimeout(timer)

    if (result?.queued) return NextResponse.json({ data: { queued: true } })
    return NextResponse.json({ data: { newMessages: Number(result?.newMessages) || 0 } })
  } catch (err) {
    return mailError(err, '[POST /api/mail/accounts/[id]/sync]')
  }
}
