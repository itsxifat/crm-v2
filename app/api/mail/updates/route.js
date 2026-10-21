export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { MailAccount, MailMessage } from '@/models'
import { requireMailUser, accessibleAccountIds } from '@/lib/mail/access'
import { processDueOutbox } from '@/lib/mail/send'
import { toListItem } from '@/lib/mail/serialize'
import { mailError } from '../_lib/http'
import { LIST_FIELDS } from '../_lib/messages'

const DAY_MS = 24 * 60 * 60 * 1000

// Every open mailbox polls this; dispatching due outbox items here is a cheap
// backstop for when the worker isn't running — throttled per process.
let lastOutboxKick = 0
function kickOutbox() {
  const t = Date.now()
  if (t - lastOutboxKick < 3000) return
  lastOutboxKick = t
  Promise.resolve().then(() => processDueOutbox()).catch(() => {})
}

function iso(d) {
  return d ? new Date(d).toISOString() : null
}

// GET /api/mail/updates?since=<ISO> — polling endpoint: new INBOX mail, unread counts, sync state.
// Pass the returned `now` as the next `since`.
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireMailUser(session)
    if (denied) return denied

    await connectDB()
    kickOutbox()

    const now = new Date()
    const sinceRaw = new URL(request.url).searchParams.get('since')
    let since = sinceRaw ? new Date(sinceRaw) : null
    if (since && Number.isNaN(since.getTime())) since = null
    if (since && since > now) since = now
    if (since && now - since > DAY_MS) since = new Date(now - DAY_MS)

    const ids = await accessibleAccountIds(session)
    if (!ids.length) {
      return NextResponse.json({ data: { now: now.toISOString(), newCount: 0, latest: [], unread: {}, sync: {} } })
    }

    // Created since the last poll AND recently received — so initial syncs / "load older" don't count as new mail.
    const newFilter = since && {
      accountId: { $in: ids },
      folderRole: 'INBOX',
      seen: false,
      createdAt: { $gt: since },
      $or: [
        { receivedAt: { $gte: new Date(since - DAY_MS) } },
        { receivedAt: null, date: { $gte: new Date(since - DAY_MS) } },
      ],
    }

    const [accounts, unreadRows, latest, newCount] = await Promise.all([
      MailAccount.find({ _id: { $in: ids } }).select('sync').lean(),
      MailMessage.aggregate([
        { $match: { accountId: { $in: ids }, seen: false, folderRole: { $ne: 'TRASH' } } },
        { $group: { _id: { a: '$accountId', f: '$folderId' }, role: { $first: '$folderRole' }, n: { $sum: 1 } } },
      ]),
      newFilter ? MailMessage.find(newFilter).select(LIST_FIELDS).sort({ createdAt: -1, _id: -1 }).limit(5).lean() : [],
      newFilter ? MailMessage.countDocuments(newFilter) : 0,
    ])

    // Every accessible account gets an entry so counts can drop back to zero client-side.
    const unread = {}
    const sync = {}
    for (const a of accounts) {
      const key = String(a._id)
      unread[key] = { total: 0, folders: {} }
      sync[key] = {
        status: a.sync?.status || 'PENDING',
        idle: !!a.sync?.idle,
        lastSyncAt: iso(a.sync?.lastSyncAt),
        lastError: a.sync?.lastError || null,
      }
    }
    for (const r of unreadRows) {
      const entry = unread[String(r._id.a)]
      if (!entry) continue
      entry.folders[String(r._id.f)] = r.n
      // `total` matches accountItem.unread (INBOX unseen); spam is counted per folder only.
      if (r.role === 'INBOX') entry.total += r.n
    }

    return NextResponse.json({
      data: { now: now.toISOString(), newCount, latest: latest.map(toListItem), unread, sync },
    })
  } catch (err) {
    return mailError(err, '[GET /api/mail/updates]')
  }
}
