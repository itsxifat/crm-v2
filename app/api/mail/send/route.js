export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { MailOutbox } from '@/models'
import { logActivity } from '@/lib/logActivity'
import { requireMailUser, getUsableAccount } from '@/lib/mail/access'
import { validateComposePayload, queueMessage } from '@/lib/mail/send'
import { mailError, readJson, jsonError } from '../_lib/http'

// POST /api/mail/send — compose payload → outbox (undo delay / schedule / immediate)
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireMailUser(session)
    if (denied) return denied

    const body = await readJson(request)
    if (!body || typeof body !== 'object') return jsonError('Invalid JSON body', 400)

    const check = validateComposePayload(body, { forDraft: false })
    if (!check?.ok) return jsonError(check?.error || 'Invalid message', 400)
    const payload = check.payload

    await connectDB()
    const { error } = await getUsableAccount(session, payload.accountId, '_id isActive assignedUsers')
    if (error) return error

    const queued = await queueMessage(session, payload)
    if (!queued?._id) return jsonError('Could not queue the message', 500)
    // queueMessage may have dispatched immediately (no undo delay) — report the current state.
    const outbox = await MailOutbox.findById(queued._id).select('status sendAt scheduled lastError').lean() || queued

    logActivity({
      userId: session.user.id,
      userRole: session.user.role,
      action: 'SEND',
      entity: 'MAIL',
      entityId: String(queued._id),
      changes: JSON.stringify({
        accountId: String(payload.accountId),
        to: (payload.to?.length || 0) + (payload.cc?.length || 0) + (payload.bcc?.length || 0),
        subject: String(payload.subject || '').slice(0, 200),
        scheduled: !!outbox.scheduled,
      }),
      request,
    })

    return NextResponse.json({
      data: {
        id: String(queued._id),
        status: outbox.status,
        sendAt: outbox.sendAt ? new Date(outbox.sendAt).toISOString() : null,
        scheduled: !!outbox.scheduled,
        lastError: outbox.lastError || null,
      },
    })
  } catch (err) {
    return mailError(err, '[POST /api/mail/send]')
  }
}
