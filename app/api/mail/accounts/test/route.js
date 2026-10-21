export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { requireMailManager } from '@/lib/mail/access'
import { loadAccountWithSecret } from '@/lib/mail/credentials'
import { providerPreset } from '@/lib/mail/constants'
import { mailError, readJson, jsonError, isValidObjectId } from '../../_lib/http'
import { normalizeEmail, normalizeServer, testCredentials } from '../../_lib/accounts'

// POST /api/mail/accounts/test — { email, username, password, imap, smtp, provider?, accountId? }
// Empty password + accountId → the stored password. Always 200 with per-protocol results.
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireMailManager(session)
    if (denied) return denied

    const body = await readJson(request)
    if (!body || typeof body !== 'object') return jsonError('Invalid JSON body', 400)

    const email = normalizeEmail(body.email)
    const preset = providerPreset(body.provider, email)
    const username = String(body.username ?? '').trim() || email
    let password = typeof body.password === 'string' ? body.password : ''

    let stored = null
    if (body.accountId) {
      if (!isValidObjectId(body.accountId)) return jsonError('Mailbox not found', 404)
      await connectDB()
      stored = await loadAccountWithSecret(body.accountId)
      if (!stored) return jsonError('Mailbox not found', 404)
      if (!password) password = stored.secret || ''
    }
    if (!password) return jsonError('Password is required', 422)

    const imap = normalizeServer(body.imap, stored?.imap ?? preset.imap, 'IMAP', 993)
    const smtp = normalizeServer(body.smtp, stored?.smtp ?? preset.smtp, 'SMTP', 465)

    const data = await testCredentials({ email, username, password, imap, smtp })
    return NextResponse.json({ data })
  } catch (err) {
    return mailError(err, '[POST /api/mail/accounts/test]')
  }
}
