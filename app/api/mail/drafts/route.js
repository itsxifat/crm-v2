export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { requireMailUser, getUsableAccount } from '@/lib/mail/access'
import { validateComposePayload, saveDraft } from '@/lib/mail/send'
import { mailError, readJson, jsonError } from '../_lib/http'

// POST /api/mail/drafts — save (or replace, via draftId) a server draft. Recipients optional.
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireMailUser(session)
    if (denied) return denied

    const body = await readJson(request)
    if (!body || typeof body !== 'object') return jsonError('Invalid JSON body', 400)

    const check = validateComposePayload(body, { forDraft: true })
    if (!check?.ok) return jsonError(check?.error || 'Invalid draft', 400)

    await connectDB()
    const { error } = await getUsableAccount(session, check.payload.accountId, '_id isActive assignedUsers')
    if (error) return error

    const res = await saveDraft(session, check.payload)
    const draftId = res?.draftId ? String(res.draftId) : null
    return NextResponse.json({ data: { draftId } })
  } catch (err) {
    return mailError(err, '[POST /api/mail/drafts]')
  }
}
