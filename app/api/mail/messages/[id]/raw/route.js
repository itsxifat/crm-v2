export const dynamic = 'force-dynamic'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { requireMailUser } from '@/lib/mail/access'
import { downloadRaw } from '@/lib/mail/sync'
import { mailError, jsonError, contentDisposition } from '../../../_lib/http'
import { loadUsableMessage } from '../../../_lib/guards'

// GET /api/mail/messages/[id]/raw?view=1 — original RFC 822 source (view=1 → plain text in the browser)
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireMailUser(session)
    if (denied) return denied

    await connectDB()
    const { message, error } = await loadUsableMessage(session, params.id, 'subject')
    if (error) return error

    const raw = await downloadRaw(String(message._id))
    if (!raw) return jsonError('Message source not available', 404)
    const body = Buffer.isBuffer(raw) ? raw : Buffer.from(raw)

    const view = new URL(request.url).searchParams.get('view') === '1'
    const base = String(message.subject || 'message').replace(/[\\/:*?"<>|\r\n\t]+/g, ' ').trim().slice(0, 120) || 'message'
    const headers = view
      ? { 'Content-Type': 'text/plain; charset=utf-8', 'Content-Disposition': contentDisposition('inline', `${base}.txt`) }
      : { 'Content-Type': 'message/rfc822', 'Content-Disposition': contentDisposition('attachment', `${base}.eml`) }

    return new Response(body, {
      headers: {
        ...headers,
        'Content-Length': String(body.length),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (err) {
    return mailError(err, '[GET /api/mail/messages/[id]/raw]')
  }
}
