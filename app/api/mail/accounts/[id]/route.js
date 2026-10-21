export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { MailAccount, MailFolder, MailMessage, MailOutbox } from '@/models'
import { logActivity } from '@/lib/logActivity'
import { requireMailManager } from '@/lib/mail/access'
import { encryptMailPassword, loadAccountWithSecret } from '@/lib/mail/credentials'
import { mailError, readJson, jsonError, isValidObjectId } from '../../_lib/http'
import { buildAccountFields, testCredentials, testFailureMessage, loadManageItem, afterAccountChange } from '../../_lib/accounts'

// GET /api/mail/accounts/[id] (mail.manage)
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireMailManager(session)
    if (denied) return denied
    if (!isValidObjectId(params.id)) return jsonError('Mailbox not found', 404)

    await connectDB()
    const data = await loadManageItem(params.id)
    if (!data) return jsonError('Mailbox not found', 404)
    return NextResponse.json({ data })
  } catch (err) {
    return mailError(err, '[GET /api/mail/accounts/[id]]')
  }
}

// PATCH /api/mail/accounts/[id] — partial update (mail.manage). Empty/absent password keeps the stored one.
export async function PATCH(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireMailManager(session)
    if (denied) return denied
    if (!isValidObjectId(params.id)) return jsonError('Mailbox not found', 404)

    const body = await readJson(request)
    if (!body || typeof body !== 'object') return jsonError('Invalid JSON body', 400)

    await connectDB()
    const existing = await MailAccount.findById(params.id).lean()
    if (!existing) return jsonError('Mailbox not found', 404)

    const { fields, password, credentialsChanged } = await buildAccountFields(body, existing)

    if (fields.email && await MailAccount.exists({ email: fields.email, _id: { $ne: existing._id } })) {
      return jsonError('A mailbox with this email already exists', 409)
    }

    let test = null
    if (credentialsChanged && body.skipTest !== true) {
      const stored = password ? null : await loadAccountWithSecret(existing._id)
      test = await testCredentials({
        email: fields.email ?? existing.email,
        username: fields.username ?? existing.username,
        password: password || stored?.secret || '',
        imap: fields.imap ?? existing.imap,
        smtp: fields.smtp ?? existing.smtp,
      })
      if (!test.imap.ok || !test.smtp.ok) {
        return NextResponse.json({ error: testFailureMessage(test), test }, { status: 422 })
      }
    }

    const set = { ...fields }
    if (password) set.password = encryptMailPassword(password)

    const wasLive = existing.isActive !== false && existing.syncEnabled !== false
    const isActive = fields.isActive ?? existing.isActive !== false
    const syncEnabled = fields.syncEnabled ?? existing.syncEnabled !== false
    if (fields.syncEnabled === false && existing.syncEnabled !== false) {
      set['sync.status'] = 'PAUSED'
      set['sync.idle'] = false
    } else if (fields.syncEnabled === true && existing.syncEnabled === false) {
      set['sync.status'] = 'PENDING'
    }
    if (fields.isActive === false) set['sync.idle'] = false

    // A different server or login is a different mailbox: drop the old local index
    // so it gets rebuilt from scratch instead of mixing two mailboxes' UIDs.
    const nextUser = String(fields.username ?? existing.username).toLowerCase()
    const nextHost = String((fields.imap ?? existing.imap)?.host || '').toLowerCase()
    const repointed = nextUser !== String(existing.username).toLowerCase()
      || nextHost !== String(existing.imap?.host || '').toLowerCase()
    if (repointed) {
      await Promise.all([
        MailMessage.deleteMany({ accountId: existing._id }),
        MailFolder.deleteMany({ accountId: existing._id }),
      ])
      set['sync.messageCount'] = 0
      set['sync.status'] = syncEnabled ? 'PENDING' : 'PAUSED'
    }

    if (Object.keys(set).length) await MailAccount.updateOne({ _id: existing._id }, { $set: set })

    logActivity({
      userId: session.user.id,
      userRole: session.user.role,
      action: 'UPDATE',
      entity: 'MAIL_ACCOUNT',
      entityId: String(existing._id),
      changes: JSON.stringify({ fields: Object.keys(fields), passwordChanged: !!password, skipTest: body.skipTest === true }),
      request,
    })

    const live = isActive && syncEnabled
    afterAccountChange(existing._id, {
      closeClients: credentialsChanged || !live,
      sync: live && (credentialsChanged || !wasLive),
      reason: 'updated',
    })

    const data = await loadManageItem(existing._id)
    return NextResponse.json({ data, meta: { test } })
  } catch (err) {
    if (err?.code === 11000) return jsonError('A mailbox with this email already exists', 409)
    return mailError(err, '[PATCH /api/mail/accounts/[id]]')
  }
}

// DELETE /api/mail/accounts/[id] — removes the mailbox and its local index/outbox (server mail is untouched).
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireMailManager(session)
    if (denied) return denied
    if (!isValidObjectId(params.id)) return jsonError('Mailbox not found', 404)

    await connectDB()
    const existing = await MailAccount.findById(params.id).select('name email').lean()
    if (!existing) return jsonError('Mailbox not found', 404)

    // Account first so the worker / an in-flight sync stops seeing it, then the rows.
    await MailAccount.deleteOne({ _id: existing._id })
    afterAccountChange(existing._id, { closeClients: true })
    await Promise.all([
      MailMessage.deleteMany({ accountId: existing._id }),
      MailFolder.deleteMany({ accountId: existing._id }),
      MailOutbox.deleteMany({ accountId: existing._id }),
    ])

    logActivity({
      userId: session.user.id,
      userRole: session.user.role,
      action: 'DELETE',
      entity: 'MAIL_ACCOUNT',
      entityId: String(existing._id),
      changes: JSON.stringify({ name: existing.name, email: existing.email }),
      request,
    })

    return NextResponse.json({ data: { ok: true } })
  } catch (err) {
    return mailError(err, '[DELETE /api/mail/accounts/[id]]')
  }
}
