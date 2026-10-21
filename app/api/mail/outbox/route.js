export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { requireMailUser, resolveAccountScope } from '@/lib/mail/access'
import { listScheduled } from '@/lib/mail/send'
import { toOutboxItem } from '@/lib/mail/serialize'
import { mailError, jsonError } from '../_lib/http'

// GET /api/mail/outbox?accountId=<id|all> — scheduled sends still waiting
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireMailUser(session)
    if (denied) return denied

    await connectDB()
    const scope = await resolveAccountScope(session, new URL(request.url).searchParams.get('accountId'))
    if (!scope) return jsonError('Mailbox not found', 404)
    if (!scope.length) return NextResponse.json({ data: [] })

    const rows = await listScheduled(session, scope)
    return NextResponse.json({ data: (rows || []).map(toOutboxItem) })
  } catch (err) {
    return mailError(err, '[GET /api/mail/outbox]')
  }
}
