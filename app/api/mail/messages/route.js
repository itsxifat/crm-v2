export const dynamic = 'force-dynamic'
import mongoose from 'mongoose'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { MailFolder, MailMessage } from '@/models'
import { requireMailUser, resolveAccountScope } from '@/lib/mail/access'
import { FOLDER_ROLES, MAIL_VIEWS, MESSAGE_ACTIONS, MAIL_LIMITS } from '@/lib/mail/constants'
import { parseSearchQuery, searchFilter } from '@/lib/mail/search'
import { applyMessageAction } from '@/lib/mail/actions'
import { toListItem } from '@/lib/mail/serialize'
import { mailError, readJson, jsonError, isValidObjectId, encodeCursor, decodeCursor, afterCursor } from '../_lib/http'
import { LIST_FIELDS, LIST_PROJECTION, HIDDEN_ROLES } from '../_lib/messages'

const toObjectId = id => new mongoose.Types.ObjectId(id)
const SORT = { date: -1, _id: -1 }

function emptyPage() {
  return NextResponse.json({ data: [], meta: { total: 0, nextCursor: null, hasMoreRemote: false } })
}

// GET /api/mail/messages
//   accountId=<id|all> + one of folderId | role | view, q (search operators), threads=1, cursor, limit (≤100)
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireMailUser(session)
    if (denied) return denied

    const sp = new URL(request.url).searchParams
    const folderId = sp.get('folderId') || null
    const role = sp.get('role') ? sp.get('role').toUpperCase() : null
    const view = sp.get('view') || null
    const q = (sp.get('q') || '').trim().slice(0, 500)
    const threads = sp.get('threads') === '1' || sp.get('threads') === 'true'
    const limit = Math.min(100, Math.max(1, parseInt(sp.get('limit'), 10) || MAIL_LIMITS.pageSize))
    const cursorRaw = sp.get('cursor')
    const cursor = cursorRaw ? decodeCursor(cursorRaw) : null
    if (cursorRaw && !cursor) return jsonError('Invalid cursor', 400)
    if (role && !FOLDER_ROLES.includes(role)) return jsonError('Unknown folder', 400)
    if (view && !MAIL_VIEWS.includes(view)) return jsonError('Unknown view', 400)
    if (folderId && !isValidObjectId(folderId)) return jsonError('Folder not found', 404)

    await connectDB()
    const scope = await resolveAccountScope(session, sp.get('accountId'))
    if (!scope) return jsonError('Mailbox not found', 404)
    // Scheduled mail lives in the outbox (GET /api/mail/outbox), not the message index.
    if (!scope.length || view === 'scheduled') return emptyPage()

    const and = [{ accountId: { $in: scope } }]

    const parsed = q ? parseSearchQuery(q) : null
    const inRole = parsed?.inRole && FOLDER_ROLES.includes(String(parsed.inRole).toUpperCase())
      ? String(parsed.inRole).toUpperCase()
      : null

    // Location: an `in:` operator overrides the folder / role being viewed.
    let folder = null
    if (inRole) {
      and.push({ folderRole: inRole })
    } else if (folderId) {
      folder = await MailFolder.findById(folderId).select('accountId oldestUid').lean()
      if (!folder || !scope.some(id => String(id) === String(folder.accountId))) return jsonError('Folder not found', 404)
      and.push({ folderId: folder._id })
    } else if (role || !(view || q)) {
      const r = role || 'INBOX'
      and.push({ folderRole: r })
      // One mailbox → the role is a single folder, so "load older from server" applies.
      if (scope.length === 1 && !view) {
        folder = await MailFolder.findOne({ accountId: scope[0], role: r }).select('accountId oldestUid').lean()
      }
    } else {
      and.push({ folderRole: { $nin: HIDDEN_ROLES } })
    }

    if (view === 'starred') and.push({ flagged: true })
    else if (view === 'unread') and.push({ seen: false })
    else if (view === 'attachments') and.push({ hasAttachments: true })

    if (parsed) {
      // inRole was applied above; keep the search lib from adding a second, conflicting location.
      const frag = searchFilter({ ...parsed, inRole: null })
      if (frag && Object.keys(frag).length) and.push(frag)
    }

    const baseFilter = { $and: and }
    const pageFilter = cursor ? { $and: [...and, afterCursor(cursor, toObjectId)] } : baseFilter

    let rows
    let total
    if (threads) {
      const threadKey = { a: '$accountId', t: { $ifNull: ['$threadKey', { $toString: '$_id' }] } }
      const [page, counted] = await Promise.all([
        MailMessage.aggregate([
          { $match: baseFilter },
          { $project: LIST_PROJECTION },  // drop html/text before grouping
          { $sort: SORT },
          { $group: {
            _id: threadKey,
            doc: { $first: '$$ROOT' },
            threadCount: { $sum: 1 },
            threadUnread: { $sum: { $cond: ['$seen', 0, 1] } },
          } },
          { $replaceRoot: { newRoot: { $mergeObjects: ['$doc', { threadCount: '$threadCount', threadUnread: '$threadUnread' }] } } },
          ...(cursor ? [{ $match: afterCursor(cursor, toObjectId) }] : []),
          { $sort: SORT },
          { $limit: limit + 1 },
        ]).allowDiskUse(true),
        MailMessage.aggregate([
          { $match: baseFilter },
          { $group: { _id: threadKey } },
          { $count: 'n' },
        ]).allowDiskUse(true),
      ])
      rows = page
      total = counted[0]?.n ?? 0
    } else {
      ;[rows, total] = await Promise.all([
        MailMessage.find(pageFilter).select(LIST_FIELDS).sort(SORT).limit(limit + 1).lean(),
        MailMessage.countDocuments(baseFilter),
      ])
    }

    const hasMore = rows.length > limit
    if (hasMore) rows = rows.slice(0, limit)

    return NextResponse.json({
      data: rows.map(toListItem),
      meta: {
        total,
        nextCursor: hasMore ? encodeCursor(rows[rows.length - 1]) : null,
        hasMoreRemote: !!folder && Number(folder.oldestUid) > 1,
      },
    })
  } catch (err) {
    return mailError(err, '[GET /api/mail/messages]')
  }
}

// PATCH /api/mail/messages — { ids: [], action, folderId? } bulk actions
export async function PATCH(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireMailUser(session)
    if (denied) return denied

    const body = await readJson(request)
    if (!body || typeof body !== 'object') return jsonError('Invalid JSON body', 400)

    const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map(String))] : []
    if (!ids.length) return jsonError('Select at least one message', 422)
    if (ids.length > 500) return jsonError('Too many messages selected (max 500)', 422)
    if (ids.some(id => !isValidObjectId(id))) return jsonError('Invalid message id', 400)

    const action = body.action
    if (!MESSAGE_ACTIONS.includes(action)) return jsonError('Unknown action', 422)
    const folderId = body.folderId ? String(body.folderId) : undefined
    if (action === 'move' && !isValidObjectId(folderId)) return jsonError('Choose a folder to move to', 422)

    await connectDB()
    const result = await applyMessageAction(session, { ids, action, folderId })
    return NextResponse.json({ data: { updated: Number(result?.updated) || 0, failed: result?.failed ?? [] } })
  } catch (err) {
    return mailError(err, '[PATCH /api/mail/messages]')
  }
}
