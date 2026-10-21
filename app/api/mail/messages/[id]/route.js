export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { MailMessage } from '@/models'
import { requireMailUser } from '@/lib/mail/access'
import { ensureBody } from '@/lib/mail/sync'
import { sanitizeEmailHtml, textToHtml } from '@/lib/mail/sanitize'
import { applyMessageAction } from '@/lib/mail/actions'
import { lookupCrmContact } from '@/lib/mail/contacts'
import { toFullMessage, toListItem } from '@/lib/mail/serialize'
import { mailError, jsonError } from '../../_lib/http'
import { loadUsableMessage } from '../../_lib/guards'
import { LIST_FIELDS, HIDDEN_ROLES } from '../../_lib/messages'

const THREAD_LIMIT = 50

/** Conversation around `msg`: same account + threadKey, oldest first, deduped by Message-ID. */
async function loadThread(msg) {
  if (!msg.threadKey) return [toListItem(msg)]
  const filter = { accountId: msg.accountId, threadKey: msg.threadKey }
  // Trash/spam copies only show when the opened message itself lives there.
  if (!HIDDEN_ROLES.includes(msg.folderRole)) filter.folderRole = { $nin: HIDDEN_ROLES }
  // Newest 50, then flip to chronological.
  const rows = await MailMessage.find(filter).select(LIST_FIELDS).sort({ date: -1, _id: -1 }).limit(THREAD_LIMIT).lean()
  rows.reverse()

  const selfId = String(msg._id)
  if (!rows.some(r => String(r._id) === selfId)) rows.push(msg)

  // The same message can sit in two folders (e.g. INBOX + a label folder); keep one, preferring the opened one.
  const byMsgId = new Map()
  for (const r of rows) {
    const key = r.messageId || String(r._id)
    const prev = byMsgId.get(key)
    if (!prev || String(r._id) === selfId) byMsgId.set(key, r)
  }
  const out = rows.filter(r => byMsgId.get(r.messageId || String(r._id)) === r)
  out.sort((a, b) => (new Date(a.date || 0) - new Date(b.date || 0)) || (String(a._id) < String(b._id) ? -1 : 1))
  return out.map(toListItem)
}

// GET /api/mail/messages/[id]?images=1&peek=1
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireMailUser(session)
    if (denied) return denied

    const sp = new URL(request.url).searchParams
    const allowRemote = sp.get('images') === '1'
    const peek = sp.get('peek') === '1'

    await connectDB()
    const { message, error } = await loadUsableMessage(session, params.id)
    if (error) return error

    const id = String(message._id)
    // Mark read alongside the body fetch; a failure here must not block reading.
    const markRead = !peek && !message.seen
      ? applyMessageAction(session, { ids: [id], action: 'read' })
        .then(r => !(r?.failed || []).length)
        .catch(err => { console.error('[GET /api/mail/messages/[id]] mark read', err); return false })
      : Promise.resolve(false)

    const full = await ensureBody(id)
    if (!full) {
      await markRead
      return jsonError('Message not found', 404)
    }

    let html = ''
    let remoteBlocked = false
    if (full.html) {
      const clean = sanitizeEmailHtml(full.html, { allowRemote, messageId: id, attachments: full.attachments || [] })
      html = clean?.html || ''
      remoteBlocked = !!clean?.remoteBlocked
    } else if (full.text) {
      html = textToHtml(full.text)
    }

    const [thread, crm, marked] = await Promise.all([
      loadThread({ ...full, _id: full._id ?? message._id }),
      full.from?.address
        ? lookupCrmContact(full.from.address, session).catch(err => { console.error('[GET /api/mail/messages/[id]] crm', err); return null })
        : null,
      markRead,
    ])

    const data = toFullMessage(full, { html, remoteBlocked, thread, crm })
    if (marked) {
      data.seen = true
      const self = data.thread.find(t => t.id === id)
      if (self) self.seen = true
    }
    return NextResponse.json({ data })
  } catch (err) {
    return mailError(err, '[GET /api/mail/messages/[id]]')
  }
}
