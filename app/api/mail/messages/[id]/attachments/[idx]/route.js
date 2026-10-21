export const dynamic = 'force-dynamic'
import { Readable } from 'node:stream'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { requireMailUser } from '@/lib/mail/access'
import { downloadAttachment } from '@/lib/mail/sync'
import { mailError, jsonError, safeContentType, canInline, contentDisposition } from '../../../../_lib/http'
import { loadUsableMessage } from '../../../../_lib/guards'

function toBody(result) {
  if (result.buffer) return { body: result.buffer, length: result.buffer.length }
  const s = result.stream
  if (s && typeof s.getReader === 'function') return { body: s, length: null }
  if (s && typeof s.pipe === 'function') return { body: Readable.toWeb(s), length: null }
  return null
}

// GET /api/mail/messages/[id]/attachments/[idx]?inline=1
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireMailUser(session)
    if (denied) return denied

    if (!/^\d{1,4}$/.test(String(params.idx))) return jsonError('Attachment not found', 404)
    const idx = Number(params.idx)

    await connectDB()
    const { message, error } = await loadUsableMessage(session, params.id, 'attachments')
    if (error) return error
    const meta = (message.attachments || []).find(a => a.idx === idx)
    if (!meta) return jsonError('Attachment not found', 404)

    const result = await downloadAttachment(String(message._id), idx)
    const payload = result && toBody(result)
    if (!payload) return jsonError('Attachment not found', 404)

    const type = safeContentType(meta.contentType || result.contentType)
    const wantInline = new URL(request.url).searchParams.get('inline') === '1'
    const headers = {
      'Content-Type': type,
      'Content-Disposition': contentDisposition(wantInline && canInline(type) ? 'inline' : 'attachment', meta.filename || result.filename || 'attachment'),
      'Cache-Control': 'private, max-age=3600',
      'X-Content-Type-Options': 'nosniff',
    }
    if (payload.length !== null) headers['Content-Length'] = String(payload.length)

    return new Response(payload.body, { headers })
  } catch (err) {
    return mailError(err, '[GET /api/mail/messages/[id]/attachments/[idx]]')
  }
}
