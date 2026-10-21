export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { MailFolder, MailMessage } from '@/models'
import { requireMailUser, resolveAccountScope, getUsableAccount } from '@/lib/mail/access'
import { STANDARD_FOLDERS, NON_SYNCED_ROLES } from '@/lib/mail/constants'
import { createFolder } from '@/lib/mail/actions'
import { toFolderItem } from '@/lib/mail/serialize'
import { mailError, readJson, jsonError, isValidObjectId } from '../_lib/http'

const ROLE_RANK = new Map(STANDARD_FOLDERS.map((f, i) => [f.role, i]))

function rank(role) {
  return ROLE_RANK.has(role) ? ROLE_RANK.get(role) : STANDARD_FOLDERS.length
}

// Segment-wise so a parent always precedes its children ("A", "A/B", "A-C" — not "A", "A-C", "A/B").
function comparePaths(a, b) {
  const sa = String(a.path).toLowerCase().split(a.delimiter || '/')
  const sb = String(b.path).toLowerCase().split(b.delimiter || '/')
  for (let i = 0; i < Math.min(sa.length, sb.length); i++) {
    if (sa[i] !== sb[i]) return sa[i] < sb[i] ? -1 : 1
  }
  return sa.length - sb.length
}

// GET /api/mail/folders?accountId=<id|all>
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireMailUser(session)
    if (denied) return denied

    await connectDB()
    const accountId = new URL(request.url).searchParams.get('accountId')
    const scope = await resolveAccountScope(session, accountId)
    if (!scope) return jsonError('Mailbox not found', 404)
    if (!scope.length) return NextResponse.json({ data: [] })

    // ALL / FLAGGED mirror other folders and are never synced locally — they would always look empty.
    const [folders, unreadRows] = await Promise.all([
      MailFolder.find({ accountId: { $in: scope }, role: { $nin: NON_SYNCED_ROLES } })
        .select('accountId path name parentPath delimiter role unread total noSelect').lean(),
      MailMessage.aggregate([
        { $match: { accountId: { $in: scope }, seen: false } },
        { $group: { _id: '$folderId', n: { $sum: 1 } } },
      ]),
    ])
    const unread = new Map(unreadRows.map(r => [String(r._id), r.n]))
    const accountOrder = new Map(scope.map((id, i) => [String(id), i]))

    folders.sort((a, b) =>
      rank(a.role) - rank(b.role)
      || (accountOrder.get(String(a.accountId)) ?? 0) - (accountOrder.get(String(b.accountId)) ?? 0)
      || comparePaths(a, b))

    return NextResponse.json({ data: folders.map(f => toFolderItem(f, unread.get(String(f._id)) || 0)) })
  } catch (err) {
    return mailError(err, '[GET /api/mail/folders]')
  }
}

// POST /api/mail/folders — { accountId, name, parentId? }
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireMailUser(session)
    if (denied) return denied

    const body = await readJson(request)
    if (!body || typeof body !== 'object') return jsonError('Invalid JSON body', 400)
    const name = typeof body.name === 'string' ? body.name.trim() : ''
    if (!name) return jsonError('Folder name is required', 422)
    if (name.length > 200) return jsonError('Folder name is too long', 422)
    const parentId = body.parentId || null
    if (parentId && !isValidObjectId(parentId)) return jsonError('Parent folder not found', 404)

    await connectDB()
    const { account, error } = await getUsableAccount(session, body.accountId, '_id isActive assignedUsers')
    if (error) return error

    if (parentId) {
      const parent = await MailFolder.exists({ _id: parentId, accountId: account._id })
      if (!parent) return jsonError('Parent folder not found', 404)
    }

    const folder = await createFolder(session, { accountId: String(account._id), name, parentId })
    return NextResponse.json({ data: toFolderItem(folder, 0) }, { status: 201 })
  } catch (err) {
    return mailError(err, '[POST /api/mail/folders]')
  }
}
