// Server-only: message actions (flags / move / delete) and custom folder management.
// Errors are thrown as Error with `.status` (400/403/404/422) + a human message; routes return `err.status ?? 500`.
//
// IMAP is the source of truth: every change is applied on the server first and
// only then mirrored into the local index, so a failed IMAP call never leaves
// the UI showing a state the mailbox doesn't have.
import { MailAccount, MailFolder, MailMessage } from '@/models'
import { isValidObjectId } from '@/lib/objectId'
import { ciEquals } from '@/lib/searchMatch'
import { MESSAGE_ACTIONS, NON_SYNCED_ROLES } from '@/lib/mail/constants'
import { isStaff, canUseAccount, accessibleAccountIds } from '@/lib/mail/access'
import { withImap, friendlyMailError } from '@/lib/mail/imap'
import { syncFolder, syncFolders } from '@/lib/mail/sync'

const MAX_IDS = 500

// Names used when a mailbox lacks a standard folder and we have to create it.
const ROLE_FOLDER_NAMES = { SENT: 'Sent', DRAFTS: 'Drafts', ARCHIVE: 'Archive', TRASH: 'Trash', SPAM: 'Junk' }

const FLAG_ACTIONS = {
  read:   { flag: '\\Seen', add: true, field: 'seen', value: true },
  unread: { flag: '\\Seen', add: false, field: 'seen', value: false },
  star:   { flag: '\\Flagged', add: true, field: 'flagged', value: true },
  unstar: { flag: '\\Flagged', add: false, field: 'flagged', value: false },
}

const MOVE_ROLES = { archive: 'ARCHIVE', trash: 'TRASH', spam: 'SPAM', notSpam: 'INBOX', restore: 'INBOX' }

const ROW_FIELDS = 'accountId folderId folderPath folderRole uid uidValidity seen flagged'

function mailError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

function escapeRegex(s) {
  return String(s ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Human message for IMAP / network failures (our own status-bearing errors pass through). */
export function mailServerMessage(err) {
  if (!err) return 'Mail server error'
  if (err.status && !err.mailConnect && !err.friendly) return err.message
  const msg = friendlyMailError(err)
    .replace(/^\S+\s+(NO|BAD)\s+/i, '')
    .replace(/^\[[^\]]*\]\s*/, '')
    .trim()
  return !msg || msg === 'Command failed' ? 'The mail server rejected the request' : msg
}

function background(label, fn) {
  Promise.resolve()
    .then(fn)
    .catch(err => console.error(`[mail/actions] ${label}`, err?.message || err))
}

// ─── Folder helpers (also used by lib/mail/send.js) ──────────────────────────

async function findRoleFolder(accountId, role) {
  const filter = role === 'INBOX'
    ? { accountId, $or: [{ role: 'INBOX' }, { path: ciEquals('INBOX') }] }
    : { accountId, role }
  // Prefer the folder the server flags as special-use when several share a role.
  return MailFolder.findOne({ ...filter, noSelect: { $ne: true } }).sort({ specialUse: -1, path: 1 }).lean()
}

async function resolveRoleFolder(accountId, role) {
  const existing = await findRoleFolder(accountId, role)
  if (existing) return existing

  if (role === 'INBOX') {
    await syncFolders(accountId)
    const inbox = await findRoleFolder(accountId, 'INBOX')
    if (!inbox) throw mailError(422, 'Inbox not found on the mail server')
    return inbox
  }

  const name = ROLE_FOLDER_NAMES[role]
  if (!name) throw mailError(400, 'Unknown folder')
  let created
  try {
    // imapflow adds the personal namespace prefix (e.g. "INBOX.") when the server needs one
    created = await withImap(accountId, client => client.mailboxCreate(name))
  } catch (err) {
    throw mailError(422, `Couldn't create the ${name} folder: ${mailServerMessage(err)}`)
  }
  await syncFolders(accountId)
  let folder = await findRoleFolder(accountId, role)
  if (!folder && created?.path) {
    // Server didn't flag it special-use and the name mapping missed it: tag it locally.
    folder = await MailFolder.findOneAndUpdate(
      { accountId, path: created.path },
      { $set: { role } },
      { new: true }
    ).lean()
  }
  if (!folder) throw mailError(422, `Couldn't create the ${name} folder`)
  return folder
}

const pendingRoleFolders = new Map()

/** The account's folder with this role (INBOX/SENT/DRAFTS/ARCHIVE/TRASH/SPAM), created on the server if missing. */
export function ensureRoleFolder(accountId, role) {
  const key = `${accountId}:${role}`
  // Concurrent callers share one lookup/CREATE instead of racing to create the same folder.
  if (!pendingRoleFolders.has(key)) {
    pendingRoleFolders.set(key, resolveRoleFolder(accountId, role).finally(() => pendingRoleFolders.delete(key)))
  }
  return pendingRoleFolders.get(key)
}

/**
 * Permanently delete messages (\Deleted + UID EXPUNGE) from one folder.
 * Skips the server call when the folder's UIDVALIDITY changed (the uids would
 * point at different messages). → { deleted, stale }
 */
export async function deleteRemoteMessages(accountId, folderPath, uidValidity, uids) {
  const list = [...new Set((uids ?? []).map(Number).filter(n => Number.isInteger(n) && n > 0))]
  if (!list.length) return { deleted: 0, stale: false }
  return withImap(accountId, async client => {
    const lock = await client.getMailboxLock(folderPath)
    try {
      if (uidValidity != null && String(client.mailbox?.uidValidity) !== String(uidValidity)) {
        return { deleted: 0, stale: true }
      }
      const ok = await client.messageDelete(list, { uid: true })
      if (!ok) throw mailError(422, "The mail server couldn't delete the message")
      return { deleted: list.length, stale: false }
    } finally {
      lock.release()
    }
  })
}

// ─── Message actions ─────────────────────────────────────────────────────────

/** Mirror a successful IMAP MOVE into the local index. Returns true when the target needs a resync. */
async function applyMoveLocally(rows, dest, res) {
  const uidValidity = res?.uidValidity != null ? String(res.uidValidity) : null
  const map = res?.uidMap instanceof Map && res.uidMap.size ? res.uidMap : null

  // No COPYUID (or a folder we never index): drop the rows; the target's sync re-adds them.
  if (!map || !uidValidity || NON_SYNCED_ROLES.includes(dest.role)) {
    await MailMessage.deleteMany({ _id: { $in: rows.map(r => r._id) } })
    return !NON_SYNCED_ROLES.includes(dest.role)
  }

  const mapped = []
  const drop = []
  for (const r of rows) {
    const dst = map.get(r.uid)
    if (dst) mapped.push([r, dst])
    else drop.push(r._id)
  }

  // The destination may already have indexed the moved copy (e.g. INBOX IDLE won the race);
  // keep that row and drop ours rather than collide on the (folderId, uidValidity, uid) index.
  const existing = mapped.length
    ? await MailMessage.find({ folderId: dest._id, uidValidity, uid: { $in: mapped.map(m => m[1]) } }).select('uid').lean()
    : []
  const taken = new Set(existing.map(e => e.uid))

  const ops = []
  for (const [r, dst] of mapped) {
    if (taken.has(dst)) { drop.push(r._id); continue }
    ops.push({
      updateOne: {
        filter: { _id: r._id },
        update: { $set: { folderId: dest._id, folderPath: dest.path, folderRole: dest.role, uid: dst, uidValidity } },
      },
    })
  }
  if (ops.length) {
    try {
      await MailMessage.bulkWrite(ops, { ordered: false })
    } catch (err) {
      const errs = [].concat(err?.writeErrors ?? [])
      if (!errs.length) throw err
      for (const e of errs) {
        const op = ops[e.index ?? e.err?.index]
        if (op) drop.push(op.updateOne.filter._id)
      }
    }
  }
  if (drop.length) await MailMessage.deleteMany({ _id: { $in: drop } })
  return drop.length > 0
}

async function runAccountAction(accountId, rows, action, target) {
  const result = { updated: 0, failed: [] }
  const done = new Set()
  const fail = (list, err) => {
    const error = mailServerMessage(err)
    for (const r of list) {
      if (done.has(String(r._id))) continue
      done.add(String(r._id))
      result.failed.push({ id: String(r._id), error })
    }
  }
  const succeed = list => {
    for (const r of list) done.add(String(r._id))
    result.updated += list.length
  }

  const flagOp = FLAG_ACTIONS[action]
  let work = []          // rows needing an IMAP call
  let mode = null        // 'flag' | 'delete' | 'move'
  let purge = []         // trash on rows already in Trash → permanent delete
  let dest = null

  if (flagOp) {
    mode = 'flag'
    work = rows.filter(r => r[flagOp.field] !== flagOp.value)
    succeed(rows.filter(r => r[flagOp.field] === flagOp.value))
  } else if (action === 'delete') {
    mode = 'delete'
    work = rows
  } else {
    mode = 'move'
    let candidates = rows
    if (action === 'trash') {
      purge = rows.filter(r => r.folderRole === 'TRASH')
      candidates = rows.filter(r => r.folderRole !== 'TRASH')
    }
    const destRole = MOVE_ROLES[action]
    const isNoop = r => (action === 'move' ? String(r.folderId) === String(target._id) : r.folderRole === destRole)
    succeed(candidates.filter(isNoop))
    work = candidates.filter(r => !isNoop(r))
    if (work.length) {
      try {
        dest = target ?? await ensureRoleFolder(accountId, destRole)
      } catch (err) {
        fail(work, err)
        work = []
      }
    }
  }

  const jobs = [
    ...work.map(r => ({ r, op: mode })),
    ...purge.map(r => ({ r, op: 'delete' })),
  ]
  if (!jobs.length) return result

  // One mailbox lock per (source folder, operation)
  const groups = new Map()
  for (const j of jobs) {
    const key = `${j.r.folderId}:${j.op}`
    if (!groups.has(key)) groups.set(key, { folderId: j.r.folderId, path: j.r.folderPath, op: j.op, rows: [] })
    groups.get(key).rows.push(j.r)
  }

  const resync = new Map() // folderId → reason
  try {
    await withImap(accountId, async client => {
      for (const g of groups.values()) {
        let lock
        try {
          lock = await client.getMailboxLock(g.path)
          const current = String(client.mailbox?.uidValidity ?? '')
          const live = g.rows.filter(r => String(r.uidValidity) === current)
          const stale = g.rows.filter(r => String(r.uidValidity) !== current)
          if (stale.length) {
            fail(stale, mailError(422, 'This folder changed on the server, refresh and try again'))
            resync.set(String(g.folderId), 'stale')
          }
          if (!live.length) continue
          const uids = live.map(r => r.uid)
          const ids = live.map(r => r._id)

          if (g.op === 'flag') {
            const fn = flagOp.add ? 'messageFlagsAdd' : 'messageFlagsRemove'
            const ok = await client[fn](uids, [flagOp.flag], { uid: true })
            if (!ok) throw mailError(422, "The mail server didn't accept the change")
            const update = flagOp.add
              ? { $set: { [flagOp.field]: flagOp.value }, $addToSet: { flags: flagOp.flag } }
              : { $set: { [flagOp.field]: flagOp.value }, $pull: { flags: flagOp.flag } }
            await MailMessage.updateMany({ _id: { $in: ids } }, update)
          } else if (g.op === 'delete') {
            const ok = await client.messageDelete(uids, { uid: true })
            if (!ok) throw mailError(422, "The mail server couldn't delete the message")
            await MailMessage.deleteMany({ _id: { $in: ids } })
          } else {
            const res = await client.messageMove(uids, dest.path, { uid: true })
            if (!res) throw mailError(422, `Couldn't move to ${dest.name}`)
            if (await applyMoveLocally(live, dest, res)) resync.set(String(dest._id), 'move')
          }
          succeed(live)
        } catch (err) {
          fail(g.rows, err)
        } finally {
          lock?.release()
        }
      }
    })
  } catch (err) {
    // Connection-level failure: whatever wasn't processed failed
    fail(jobs.map(j => j.r), err)
  }

  for (const folderId of resync.keys()) {
    background(`syncFolder ${folderId}`, () => syncFolder(accountId, folderId))
  }
  return result
}

/**
 * Apply a bulk action to messages.
 * @param {object} session
 * @param {{ ids: string[], action: string, folderId?: string }} input
 * @returns {Promise<{ updated: number, failed: { id: string, error: string }[] }>}
 */
export async function applyMessageAction(session, { ids, action, folderId } = {}) {
  if (!isStaff(session)) throw mailError(403, 'Forbidden')
  if (!MESSAGE_ACTIONS.includes(action)) throw mailError(400, 'Unknown action')

  const list = [...new Set((Array.isArray(ids) ? ids : []).map(String))]
  if (!list.length) throw mailError(400, 'Select at least one message')
  if (list.length > MAX_IDS) throw mailError(400, `Select up to ${MAX_IDS} messages at a time`)

  const failed = []
  const notFound = id => failed.push({ id, error: 'Message not found' })
  const validIds = []
  for (const id of list) {
    if (isValidObjectId(id)) validIds.push(id)
    else notFound(id)
  }

  let target = null
  if (action === 'move') {
    if (!isValidObjectId(folderId)) throw mailError(400, 'Choose a folder')
    target = await MailFolder.findById(folderId).lean()
    const acc = target && await MailAccount.findById(target.accountId).select('isActive assignedUsers').lean()
    if (!target || !canUseAccount(session, acc)) throw mailError(404, 'Folder not found')
    if (target.noSelect || NON_SYNCED_ROLES.includes(target.role)) {
      throw mailError(422, "Messages can't be moved to this folder")
    }
  }

  const allowed = new Set((await accessibleAccountIds(session)).map(String))
  const rows = validIds.length
    ? await MailMessage.find({ _id: { $in: validIds } }).select(ROW_FIELDS).lean()
    : []
  const found = new Set(rows.map(r => String(r._id)))
  for (const id of validIds) if (!found.has(id)) notFound(id)

  const byAccount = new Map()
  for (const r of rows) {
    const acc = String(r.accountId)
    if (!allowed.has(acc)) { notFound(String(r._id)); continue }
    if (target && String(target.accountId) !== acc) {
      failed.push({ id: String(r._id), error: "Messages can't be moved between mailboxes" })
      continue
    }
    if (!byAccount.has(acc)) byAccount.set(acc, [])
    byAccount.get(acc).push(r)
  }

  let updated = 0
  await Promise.all([...byAccount].map(async ([accountId, accRows]) => {
    const res = await runAccountAction(accountId, accRows, action, target)
    updated += res.updated
    failed.push(...res.failed)
  }))
  return { updated, failed }
}

// ─── Folder management ───────────────────────────────────────────────────────

async function loadUsableAccount(session, accountId) {
  if (!isStaff(session)) throw mailError(403, 'Forbidden')
  if (!isValidObjectId(accountId)) throw mailError(404, 'Mailbox not found')
  const account = await MailAccount.findById(accountId).select('email isActive assignedUsers').lean()
  if (!account || !canUseAccount(session, account)) throw mailError(404, 'Mailbox not found')
  if (!account.isActive) throw mailError(422, 'This mailbox is inactive')
  return account
}

async function loadUsableFolder(session, folderId) {
  if (!isStaff(session)) throw mailError(403, 'Forbidden')
  if (!isValidObjectId(folderId)) throw mailError(404, 'Folder not found')
  const folder = await MailFolder.findById(folderId).lean()
  if (!folder) throw mailError(404, 'Folder not found')
  await loadUsableAccount(session, folder.accountId).catch(err => {
    throw err.status === 404 ? mailError(404, 'Folder not found') : err
  })
  return folder
}

function validateFolderName(name, delimiter) {
  const s = String(name ?? '').replace(/\s+/g, ' ').trim()
  if (!s) throw mailError(400, 'Enter a folder name')
  if (s.length > 100) throw mailError(400, 'Folder name is too long')
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f*%"\\]/.test(s)) throw mailError(400, "Folder name contains characters that aren't allowed")
  if (delimiter && s.includes(delimiter)) throw mailError(400, `Folder name can't contain "${delimiter}"`)
  if (/^inbox$/i.test(s)) throw mailError(422, 'That name is reserved')
  return s
}

async function accountDelimiter(accountId) {
  const f = await MailFolder.findOne({ accountId, delimiter: { $nin: [null, ''] } }).select('delimiter').lean()
  return f?.delimiter || '/'
}

async function descendantsOf(folder) {
  const d = folder.delimiter || '/'
  return MailFolder.find({
    accountId: folder.accountId,
    path: { $regex: `^${escapeRegex(folder.path + d)}` },
  }).lean()
}

/** Create a custom folder (optionally under parentId) → MailFolder (lean). */
export async function createFolder(session, { accountId, name, parentId } = {}) {
  const account = await loadUsableAccount(session, accountId)

  let parent = null
  if (parentId) {
    if (!isValidObjectId(parentId)) throw mailError(404, 'Parent folder not found')
    parent = await MailFolder.findOne({ _id: parentId, accountId: account._id }).lean()
    if (!parent) throw mailError(404, 'Parent folder not found')
  }
  const delimiter = parent?.delimiter || await accountDelimiter(account._id)
  const clean = validateFolderName(name, delimiter)
  const path = parent ? `${parent.path}${delimiter}${clean}` : clean

  if (await MailFolder.exists({ accountId: account._id, path: ciEquals(path) })) {
    throw mailError(422, 'A folder with this name already exists')
  }

  let res
  try {
    res = await withImap(account._id, client => client.mailboxCreate(path))
  } catch (err) {
    throw mailError(422, `Couldn't create the folder: ${mailServerMessage(err)}`)
  }
  await syncFolders(account._id)
  if (res && res.created === false) throw mailError(422, 'A folder with this name already exists')

  const finalPath = res?.path || path
  let folder = await MailFolder.findOne({ accountId: account._id, path: finalPath }).lean()
  if (!folder) {
    // Some servers only LIST subscribed folders; make sure the new one shows up anyway.
    const segs = finalPath.split(delimiter)
    folder = (await MailFolder.findOneAndUpdate(
      { accountId: account._id, path: finalPath },
      {
        $setOnInsert: {
          accountId: account._id,
          path: finalPath,
          name: clean,
          parentPath: segs.length > 1 ? segs.slice(0, -1).join(delimiter) : null,
          delimiter,
          role: 'CUSTOM',
        },
      },
      { upsert: true, new: true }
    ).lean())
  }
  return folder
}

/** Rename a CUSTOM folder (keeps its parent) → MailFolder (lean). */
export async function renameFolder(session, folderId, name) {
  const folder = await loadUsableFolder(session, folderId)
  if (folder.role !== 'CUSTOM') throw mailError(422, "System folders can't be renamed")

  const delimiter = folder.delimiter || '/'
  const clean = validateFolderName(name, delimiter)
  const newPath = folder.parentPath ? `${folder.parentPath}${delimiter}${clean}` : clean
  if (newPath === folder.path) return folder
  if (await MailFolder.exists({ accountId: folder.accountId, path: ciEquals(newPath), _id: { $ne: folder._id } })) {
    throw mailError(422, 'A folder with this name already exists')
  }

  const descendants = await descendantsOf(folder)
  let res
  try {
    res = await withImap(folder.accountId, client => client.mailboxRename(folder.path, newPath))
  } catch (err) {
    throw mailError(422, `Couldn't rename the folder: ${mailServerMessage(err)}`)
  }
  const finalPath = res?.newPath || newPath
  const oldPath = folder.path
  const swap = p => (p && (p === oldPath || p.startsWith(oldPath + delimiter)) ? finalPath + p.slice(oldPath.length) : p)

  try {
    await MailFolder.updateOne({ _id: folder._id }, { $set: { path: finalPath, name: clean } })
    await MailMessage.updateMany({ folderId: folder._id }, { $set: { folderPath: finalPath } })
    for (const f of descendants) {
      const p = swap(f.path)
      await MailFolder.updateOne({ _id: f._id }, { $set: { path: p, parentPath: swap(f.parentPath) } })
      await MailMessage.updateMany({ folderId: f._id }, { $set: { folderPath: p } })
    }
  } catch (err) {
    // A concurrent folder sync already picked up the new name; it owns the rows now.
    if (err?.code !== 11000) throw err
  }

  // Most servers keep UIDVALIDITY across RENAME; if not, the folder sync rebuilds it.
  background(`rename resync ${folder._id}`, async () => {
    await syncFolders(folder.accountId)
    const fresh = await MailFolder.findOne({ accountId: folder.accountId, path: finalPath }).select('_id').lean()
    if (fresh) await syncFolder(folder.accountId, fresh._id)
  })

  return (await MailFolder.findById(folder._id).lean())
    ?? (await MailFolder.findOne({ accountId: folder.accountId, path: finalPath }).lean())
}

/** Delete a CUSTOM folder, its subfolders and their local messages → { ok: true } */
export async function deleteFolder(session, folderId) {
  const folder = await loadUsableFolder(session, folderId)
  if (folder.role !== 'CUSTOM') throw mailError(422, "System folders can't be deleted")

  // Children first: many servers refuse to delete a folder that still has subfolders.
  const tree = [folder, ...(await descendantsOf(folder))].sort((a, b) => b.path.length - a.path.length)
  try {
    await withImap(folder.accountId, async client => {
      for (const f of tree) {
        try {
          await client.mailboxDelete(f.path)
        } catch (err) {
          const code = `${err?.serverResponseCode ?? ''} ${err?.responseText ?? ''} ${typeof err?.response === 'string' ? err.response : ''}`
          if (!/NONEXISTENT|does ?n[o']t exist|not exist|no such/i.test(code)) throw err
        }
      }
    })
  } catch (err) {
    throw mailError(422, `Couldn't delete the folder: ${mailServerMessage(err)}`)
  }

  const ids = tree.map(f => f._id)
  await MailMessage.deleteMany({ folderId: { $in: ids } })
  await MailFolder.deleteMany({ _id: { $in: ids } })
  return { ok: true }
}
