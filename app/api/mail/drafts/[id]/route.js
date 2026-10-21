export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { requireMailUser } from '@/lib/mail/access'
import { deleteDraft } from '@/lib/mail/send'
import { mailError, jsonError } from '../../_lib/http'
import { loadUsableMessage } from '../../_lib/guards'

// DELETE /api/mail/drafts/[id] — discard a server draft permanently
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireMailUser(session)
    if (denied) return denied

    await connectDB()
    const { message, error } = await loadUsableMessage(session, params.id, 'folderRole')
    if (error) return error
    if (message.folderRole !== 'DRAFTS') return jsonError('Only drafts can be discarded', 422)

    await deleteDraft(session, String(message._id))
    return NextResponse.json({ data: { ok: true } })
  } catch (err) {
    return mailError(err, '[DELETE /api/mail/drafts/[id]]')
  }
}
