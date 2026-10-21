export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { requireMailUser } from '@/lib/mail/access'
import { MAIL_LIMITS } from '@/lib/mail/constants'
import { saveMailUpload } from '@/lib/mail/uploads'
import { mailError, jsonError } from '../_lib/http'

// POST /api/mail/uploads — multipart `file` → compose attachment reference { id, filename, size, contentType }
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireMailUser(session)
    if (denied) return denied

    let form
    try { form = await request.formData() } catch { return jsonError('Expected a multipart form with a file', 400) }
    const file = form.get('file')
    if (!file || typeof file === 'string' || typeof file.arrayBuffer !== 'function') return jsonError('No file uploaded', 400)
    if (!file.size) return jsonError('The file is empty', 422)
    if (file.size > MAIL_LIMITS.attachmentBytes) {
      return jsonError(`File too large (max ${Math.round(MAIL_LIMITS.attachmentBytes / 1024 / 1024)} MB)`, 422)
    }

    const saved = await saveMailUpload(String(session.user.id), file)
    return NextResponse.json({
      data: { id: saved.id, filename: saved.filename, size: saved.size, contentType: saved.contentType },
    }, { status: 201 })
  } catch (err) {
    return mailError(err, '[POST /api/mail/uploads]')
  }
}
