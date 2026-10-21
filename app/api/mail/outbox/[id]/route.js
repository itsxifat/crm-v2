export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { MailOutbox } from '@/models'
import { requireMailUser, canManageMail } from '@/lib/mail/access'
import { cancelOutbox } from '@/lib/mail/send'
import { mailError, jsonError, isValidObjectId } from '../../_lib/http'

// DELETE /api/mail/outbox/[id] — undo / cancel a queued send. Returns the payload to reopen the composer.
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireMailUser(session)
    if (denied) return denied
    if (!isValidObjectId(params.id)) return jsonError('Message not found', 404)

    await connectDB()
    const outbox = await MailOutbox.findById(params.id).select('accountId userId status').lean()
    if (!outbox || (String(outbox.userId) !== String(session.user.id) && !canManageMail(session))) {
      return jsonError('Message not found', 404)
    }
    if (outbox.status !== 'QUEUED') {
      return jsonError(outbox.status === 'SENT' || outbox.status === 'SENDING' ? 'Too late — the message was already sent' : 'This message is no longer queued', 409)
    }

    const res = await cancelOutbox(session, String(outbox._id))
    // Accept either the payload itself or the cancelled outbox doc.
    const payload = res && typeof res === 'object' && res.payload && (res.status || res._id) ? res.payload : res
    return NextResponse.json({
      data: { payload: { ...(payload || {}), accountId: String(payload?.accountId ?? outbox.accountId) } },
    })
  } catch (err) {
    return mailError(err, '[DELETE /api/mail/outbox/[id]]')
  }
}
