export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { MailOutbox } from '@/models'
import { requireMailUser, canManageMail, getUsableAccount } from '@/lib/mail/access'
import { sendOutboxItem } from '@/lib/mail/send'
import { mailError, jsonError, isValidObjectId } from '../../../_lib/http'

// POST /api/mail/outbox/[id]/send-now — dispatch a scheduled / undo-delayed message immediately
export async function POST(request, { params }) {
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
    const { error } = await getUsableAccount(session, outbox.accountId, '_id isActive assignedUsers')
    if (error) return error
    if (outbox.status !== 'QUEUED') return jsonError('This message is no longer queued', 409)

    // Make it due now; sendOutboxItem claims it atomically (QUEUED & sendAt ≤ now).
    const due = await MailOutbox.updateOne({ _id: outbox._id, status: 'QUEUED' }, { $set: { sendAt: new Date() } })
    if (!due.modifiedCount && !due.matchedCount) return jsonError('This message is no longer queued', 409)

    await sendOutboxItem(String(outbox._id))
    const after = await MailOutbox.findById(outbox._id).select('status lastError').lean()
    return NextResponse.json({ data: { status: after?.status ?? 'SENT', lastError: after?.lastError || null } })
  } catch (err) {
    return mailError(err, '[POST /api/mail/outbox/[id]/send-now]')
  }
}
