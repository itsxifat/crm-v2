export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { MailAccount } from '@/models'
import { logActivity } from '@/lib/logActivity'
import { requireMailUser, requireMailManager, canManageMail, accessibleAccountFilter } from '@/lib/mail/access'
import { encryptMailPassword } from '@/lib/mail/credentials'
import { toAccountItem } from '@/lib/mail/serialize'
import { mailError, readJson, jsonError } from '../_lib/http'
import { buildAccountFields, testCredentials, testFailureMessage, inboxUnread, loadManageItem, afterAccountChange } from '../_lib/accounts'

// GET /api/mail/accounts?manage=1
// Staff: the active mailboxes they can use. manage=1 (mail.manage): every account incl. inactive, with admin fields.
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireMailUser(session)
    if (denied) return denied

    const { searchParams } = new URL(request.url)
    const manage = searchParams.get('manage') === '1' || searchParams.get('manage') === 'true'
    if (manage && !canManageMail(session)) return jsonError('Forbidden', 403)

    await connectDB()
    const q = MailAccount.find(manage ? {} : accessibleAccountFilter(session)).sort({ name: 1, email: 1 })
    if (manage) q.populate({ path: 'assignedUsers', select: 'name email avatar role' })
    const accounts = await q.lean()

    const unread = await inboxUnread(accounts.map(a => a._id))
    return NextResponse.json({
      data: accounts.map(a => toAccountItem(a, { unread: unread.get(String(a._id)) || 0, manage })),
    })
  } catch (err) {
    return mailError(err, '[GET /api/mail/accounts]')
  }
}

// POST /api/mail/accounts — add a mailbox (mail.manage). Tests IMAP + SMTP first unless skipTest.
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireMailManager(session)
    if (denied) return denied

    const body = await readJson(request)
    if (!body || typeof body !== 'object') return jsonError('Invalid JSON body', 400)

    await connectDB()
    const { fields, password } = await buildAccountFields(body)

    if (await MailAccount.exists({ email: fields.email })) {
      return jsonError('A mailbox with this email already exists', 409)
    }

    let test = null
    if (body.skipTest !== true) {
      test = await testCredentials({ email: fields.email, username: fields.username, password, imap: fields.imap, smtp: fields.smtp })
      if (!test.imap.ok || !test.smtp.ok) {
        return NextResponse.json({ error: testFailureMessage(test), test }, { status: 422 })
      }
    }

    const account = await MailAccount.create({
      ...fields,
      password: encryptMailPassword(password),
      createdBy: session.user.id,
      sync: { status: fields.syncEnabled === false ? 'PAUSED' : 'PENDING' },
    })
    const id = String(account._id)

    logActivity({
      userId: session.user.id,
      userRole: session.user.role,
      action: 'CREATE',
      entity: 'MAIL_ACCOUNT',
      entityId: id,
      changes: JSON.stringify({ name: fields.name, email: fields.email, provider: fields.provider, assignedUsers: fields.assignedUsers.length, skipTest: body.skipTest === true }),
      request,
    })

    afterAccountChange(id, { sync: fields.isActive !== false && fields.syncEnabled !== false, reason: 'created' })

    const data = await loadManageItem(id)
    return NextResponse.json({ data, meta: { test } }, { status: 201 })
  } catch (err) {
    if (err?.code === 11000) return jsonError('A mailbox with this email already exists', 409)
    return mailError(err, '[POST /api/mail/accounts]')
  }
}
