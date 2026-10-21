// Server-only: IMAP → local index sync (folders, messages, flags, bodies).
//
// Messages are keyed by (folderId, uidValidity, uid) and always upserted, so every
// operation here is safe to re-run. Concurrency: syncs of one folder are serialised
// (and coalesced) in-process; syncAccount runs once per account at a time.
import mongoose from 'mongoose'
import { simpleParser } from 'mailparser'
import connectDB from '@/lib/mongodb'
import { MailAccount, MailFolder, MailMessage } from '@/models'
import { FOLDER_ROLES, NON_SYNCED_ROLES, MAIL_LIMITS } from './constants'
import { withImap, withMailbox, mailError, isConnectionError, friendlyMailError } from './imap'
import { htmlToText } from './sanitize'

const EAGER_BODY_MAX_BYTES = 1.5 * 1024 * 1024  // new mail up to this size is downloaded + parsed during sync
const EAGER_FIRST_SYNC = 50                       // …but only the newest N on a folder's first sync
const FULL_PARSE_MAX_BYTES = 5 * 1024 * 1024     // ensureBody: parse full source up to this size
const META_CHUNK = 100
const SOURCE_BATCH_COUNT = 25
const SOURCE_BATCH_BYTES = 8 * 1024 * 1024
const HTML_MAX_CHARS = 3_000_000
const TEXT_MAX_CHARS = 1_000_000
const ATTACHMENT_MAX_BYTES = 60 * 1024 * 1024

const META_QUERY = {
  uid: true,
  flags: true,
  envelope: true,
  bodyStructure: true,
  internalDate: true,
  size: true,
  headers: ['references', 'x-priority', 'importance', 'priority', 'x-msmail-priority', 'list-unsubscribe'],
}

const PARSER_OPTIONS = { skipHtmlToText: true, skipImageLinks: true, keepCidLinks: true, skipTextLinks: true }

const ROLE_ORDER = { INBOX: 0, SENT: 1, DRAFTS: 2, SPAM: 3, TRASH: 4, ARCHIVE: 5, CUSTOM: 6 }

const SPECIAL_USE_ROLES = {
  '\\inbox': 'INBOX', '\\sent': 'SENT', '\\drafts': 'DRAFTS', '\\junk': 'SPAM',
  '\\trash': 'TRASH', '\\archive': 'ARCHIVE', '\\all': 'ALL', '\\flagged': 'FLAGGED',
}

const NAME_ROLES = [
  ['SENT', /^(sent|sent items|sent messages|sent mail|sent-mail)$/i],
  ['DRAFTS', /^drafts?$/i],
  ['SPAM', /^(junk|spam|junk e-?mail|junk mail|bulk mail)$/i],
  ['TRASH', /^(trash|deleted|deleted items|deleted messages|bin|recycle bin)$/i],
  ['ARCHIVE', /^(archive|archives)$/i],
  ['FLAGGED', /^(starred|flagged)$/i],
]

// Shared across bundles (worker vs API routes) so the in-process guards really are process-wide.
const lanes = globalThis.__crmMailSyncLanes ?? (globalThis.__crmMailSyncLanes = new Map())
const accountRuns = globalThis.__crmMailAccountRuns ?? (globalThis.__crmMailAccountRuns = new Map())
const bodyInflight = globalThis.__crmMailBodyInflight ?? (globalThis.__crmMailBodyInflight = new Map())

const empty = () => ({ newMessages: 0, newIds: [] })

// ─── Small helpers ───────────────────────────────────────────────────────────

/** Strip <>, trim, lowercase. First <id> wins when a header holds several. */
export function normalizeMsgId(v) {
  if (v == null) return null
  const s = String(v)
  const m = s.match(/<([^<>]+)>/)
  const id = (m ? m[1] : s).replace(/\s+/g, '').toLowerCase()
  return id || null
}

function parseIdList(v) {
  if (!v) return []
  const raw = Array.isArray(v) ? v.join(' ') : String(v)
  const ids = raw.includes('<') ? (raw.match(/<[^<>]+>/g) || []) : raw.split(/[\s,]+/)
  const out = []
  for (const id of ids) {
    const n = normalizeMsgId(id)
    if (n && !out.includes(n)) out.push(n)
  }
  // keep the root (first) and the most recent ancestors
  return out.length > 50 ? [out[0], ...out.slice(-49)] : out
}

/** Conversation root: references[0] || inReplyTo || messageId (all normalised). */
export function computeThreadKey({ messageId, inReplyTo, references } = {}) {
  const refs = parseIdList(references)
  return refs[0] || normalizeMsgId(inReplyTo) || normalizeMsgId(messageId) || null
}

function toDate(v) {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

function addr(a) {
  return { name: String(a?.name || '').trim().slice(0, 200), address: String(a?.address || '').trim().toLowerCase().slice(0, 320) }
}

function addrList(list) {
  return (list || []).filter(a => a?.address).slice(0, 300).map(addr)
}

function firstAddr(list) {
  const a = (list || []).find(x => x?.address || x?.name)
  return a ? addr(a) : null
}

function parseHeaderLines(buf) {
  const out = Object.create(null)
  if (!buf) return out
  const str = Buffer.isBuffer(buf) ? buf.toString('utf8') : String(buf)
  for (const line of str.replace(/\r?\n[ \t]+/g, ' ').split(/\r?\n/)) {
    const i = line.indexOf(':')
    if (i <= 0) continue
    const key = line.slice(0, i).trim().toLowerCase()
    if (!(key in out)) out[key] = line.slice(i + 1).trim()
  }
  return out
}

function priorityOf(h) {
  const xp = parseInt(h['x-priority'], 10)
  if (xp === 1 || xp === 2) return 'high'
  if (xp === 4 || xp === 5) return 'low'
  const imp = String(h.importance || h['x-msmail-priority'] || '').toLowerCase()
  if (imp.startsWith('high')) return 'high'
  if (imp.startsWith('low')) return 'low'
  const pr = String(h.priority || '').toLowerCase()
  if (pr === 'urgent') return 'high'
  if (pr === 'non-urgent') return 'low'
  return 'normal'
}

function flagState(flagSet) {
  const flags = [...(flagSet || [])].map(String)
  const has = f => flags.some(x => x.toLowerCase() === f)
  return { flags, seen: has('\\seen'), flagged: has('\\flagged'), answered: has('\\answered'), draft: has('\\draft') }
}

function sameList(a = [], b = []) {
  if (a.length !== b.length) return false
  const s = new Set(a)
  return b.every(x => s.has(x))
}

function uniqSorted(nums) {
  return [...new Set(nums.filter(n => Number.isInteger(n) && n > 0))].sort((x, y) => x - y)
}

/** [1,2,3,7,9,10] → "1:3,7,9:10" */
function packUids(uids) {
  const sorted = uniqSorted(uids)
  const parts = []
  for (let i = 0; i < sorted.length; i++) {
    const start = sorted[i]
    while (i + 1 < sorted.length && sorted[i + 1] === sorted[i] + 1) i++
    parts.push(start === sorted[i] ? String(start) : `${start}:${sorted[i]}`)
  }
  return parts.join(',')
}

function chunks(arr, n) {
  const out = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

function clampInt(v, min, max, fallback) {
  const n = parseInt(v, 10)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

function makeSnippet(text) {
  return String(text || '')
    .replace(/[\u200B-\u200D\u2060\uFEFF\u034F\u00AD]/g, '')
    .replace(/[\u0000-\u0008\u000B\u000E-\u001F\u007F]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200)
}

const EXT_BY_TYPE = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'application/pdf': 'pdf',
  'text/calendar': 'ics', 'message/rfc822': 'eml', 'text/plain': 'txt', 'text/html': 'html', 'text/csv': 'csv',
}

function defaultFilename(type, idx) {
  if (type === 'text/calendar') return 'invite.ics'
  const ext = EXT_BY_TYPE[type]
  return `attachment-${idx + 1}${ext ? `.${ext}` : ''}`
}

function decodedSize(node) {
  const size = Number(node.size) || 0
  return node.encoding === 'base64' ? Math.round(size * 0.74) : size
}

/** Attachment metadata from an imapflow BODYSTRUCTURE tree. */
function structureAttachments(root) {
  const out = []
  const walk = node => {
    if (!node) return
    const type = String(node.type || '').toLowerCase()
    if (type.startsWith('multipart/') && node.childNodes?.length) {
      node.childNodes.forEach(walk)
      return
    }
    const disposition = String(node.disposition || '').toLowerCase()
    const filename = node.dispositionParameters?.filename || node.parameters?.name || ''
    if (type === 'message/rfc822') {
      const subject = node.envelope?.subject
      out.push({
        idx: out.length, part: node.part || '1',
        filename: filename || `${String(subject || 'message').replace(/[\\/:*?"<>|\r\n]+/g, ' ').trim().slice(0, 120) || 'message'}.eml`,
        contentType: type, size: Number(node.size) || 0, cid: null, inline: false,
      })
      return
    }
    if ((type === 'text/plain' || type === 'text/html') && disposition !== 'attachment' && !filename) return
    if (type.startsWith('multipart/')) return
    const cid = node.id ? String(node.id).trim().replace(/^<|>$/g, '') || null : null
    out.push({
      idx: out.length,
      part: node.part || '1',
      filename: filename || defaultFilename(type, out.length),
      contentType: type || 'application/octet-stream',
      size: decodedSize(node),
      cid,
      inline: !!cid && type.startsWith('image/') && disposition !== 'attachment',
    })
  }
  walk(root)
  return out
}

/** The displayable text/plain and text/html leaves of a BODYSTRUCTURE tree. */
function pickBodyParts(root) {
  let text = null
  let html = null
  const walk = node => {
    if (!node || (text && html)) return
    const type = String(node.type || '').toLowerCase()
    if (type === 'message/rfc822') return
    if (type.startsWith('multipart/')) {
      (node.childNodes || []).forEach(walk)
      return
    }
    const disposition = String(node.disposition || '').toLowerCase()
    if (disposition === 'attachment' || node.dispositionParameters?.filename || node.parameters?.name) return
    if (type === 'text/plain' && !text) text = node
    else if (type === 'text/html' && !html) html = node
  }
  walk(root)
  return { text, html }
}

function decodeQP(str) {
  const s = str.replace(/=\r?\n/g, '')
  const bytes = []
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '=' && /^[0-9a-f]{2}$/i.test(s.substr(i + 1, 2))) {
      bytes.push(parseInt(s.substr(i + 1, 2), 16))
      i += 2
    } else {
      bytes.push(s.charCodeAt(i) & 0xff)
    }
  }
  return Buffer.from(bytes)
}

function decodeCharset(buf, charset) {
  let label = String(charset || 'utf-8').trim().replace(/^["']|["']$/g, '').toLowerCase()
  if (label === 'us-ascii' || label === 'ascii' || label === 'unicode-1-1-utf-7') label = 'utf-8'
  try {
    return new TextDecoder(label).decode(buf).replace(/\uFFFD+$/, '')
  } catch {
    return buf.toString('utf8')
  }
}

/** Decode a (possibly truncated) raw body part fetched with BODY.PEEK[part]. */
function decodePart(buf, node, binary) {
  let raw = buf
  const enc = String(node.encoding || '').toLowerCase()
  if (!binary) {
    if (enc === 'base64') {
      const s = buf.toString('latin1').replace(/[^A-Za-z0-9+/]/g, '')
      raw = Buffer.from(s.slice(0, s.length - (s.length % 4)), 'base64')
    } else if (enc === 'quoted-printable') {
      raw = decodeQP(buf.toString('latin1'))
    }
  }
  return decodeCharset(raw, node.parameters?.charset)
}

async function streamToBuffer(stream) {
  const parts = []
  for await (const chunk of stream) parts.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  return Buffer.concat(parts)
}

/** Full RFC822 source → { html, text, snippet, attachments } (raw, unsanitised HTML). */
async function parseSource(source) {
  const parsed = await simpleParser(source, PARSER_OPTIONS)
  const html = typeof parsed.html === 'string' && parsed.html.trim() ? parsed.html.slice(0, HTML_MAX_CHARS) : null
  const textPart = typeof parsed.text === 'string' ? parsed.text : ''
  return {
    html,
    text: (textPart || (html ? htmlToText(html) : '')).slice(0, TEXT_MAX_CHARS),
    snippet: makeSnippet(textPart || (html ? htmlToText(html, { links: false }) : '')),
    attachments: (parsed.attachments || []).map((a, idx) => {
      const contentType = String(a.contentType || 'application/octet-stream').toLowerCase()
      return {
        idx,
        part: a.partId || null,
        filename: a.filename || defaultFilename(contentType, idx),
        contentType,
        size: a.size || a.content?.length || 0,
        cid: a.cid || null,
        inline: !!a.cid && contentType.startsWith('image/') && a.contentDisposition !== 'attachment',
      }
    }),
  }
}

/**
 * Run fn serially per key. With coalesce, a request made while another coalescing
 * run is still *queued* shares that run (it will see the latest server state anyway).
 */
function serial(key, fn, { coalesce = false } = {}) {
  let lane = lanes.get(key)
  if (!lane) {
    lane = { tail: Promise.resolve(), pending: null, size: 0 }
    lanes.set(key, lane)
  }
  if (coalesce && lane.pending) return lane.pending
  lane.size++
  const run = lane.tail.then(() => {
    if (lane.pending === run) lane.pending = null
    return fn()
  })
  if (coalesce) lane.pending = run
  lane.tail = run.then(() => {}, () => {}).then(() => {
    lane.size--
    if (!lane.size && lanes.get(key) === lane) lanes.delete(key)
  })
  return run
}

function setAccountSync(accountId, fields) {
  const $set = {}
  for (const [k, v] of Object.entries(fields)) $set[`sync.${k}`] = v
  return MailAccount.updateOne({ _id: accountId }, { $set }, { timestamps: false })
}

// ─── Folders ─────────────────────────────────────────────────────────────────

function roleFor(entry) {
  if (String(entry.path).toUpperCase() === 'INBOX') return 'INBOX'
  const su = SPECIAL_USE_ROLES[String(entry.specialUse || '').toLowerCase()]
  if (su) return su
  if (/^\[(gmail|google mail)\][/.]all mail$/i.test(entry.path)) return 'ALL'
  return 'CUSTOM'
}

/** LIST → upsert MailFolder rows (+ roles); drop local folders gone from the server. Returns folders. */
export async function syncFolders(accountId) {
  await connectDB()
  const listed = await withImap(accountId, client => client.list(), { channel: 'sync' })
  const entries = (listed || []).filter(e => e?.path && !e.flags?.has('\\NonExistent'))
  // An empty LIST is a server glitch, not "every folder was deleted".
  if (!entries.length) throw mailError('The server returned no folders', 502)

  const rows = entries.map(e => {
    const flags = e.flags || new Set()
    return {
      path: e.path,
      name: e.name || e.path,
      parentPath: e.parentPath || null,
      delimiter: e.delimiter || '/',
      role: roleFor(e),
      specialUse: e.specialUse || (flags.has('\\Important') ? '\\Important' : null),
      noSelect: flags.has('\\Noselect') || flags.has('\\NoSelect'),
      subscribed: e.subscribed !== false,
      depth: (e.parent || []).length,
    }
  })

  // One folder per standard role; name matching only for servers without SPECIAL-USE.
  const taken = new Set()
  for (const r of rows) {
    if (r.role === 'CUSTOM') continue
    if (taken.has(r.role)) r.role = 'CUSTOM'
    else taken.add(r.role)
  }
  for (const r of rows) {
    if (r.role !== 'CUSTOM' || r.noSelect) continue
    if (r.depth > 1 || (r.depth === 1 && String(r.parentPath).toUpperCase() !== 'INBOX')) continue
    const hit = NAME_ROLES.find(([role, re]) => !taken.has(role) && re.test(r.name))
    if (hit) {
      r.role = hit[0]
      taken.add(hit[0])
    }
  }

  const accId = new mongoose.Types.ObjectId(String(accountId))
  const existing = await MailFolder.find({ accountId: accId }).select('_id path role').lean()
  const byPath = new Map(existing.map(f => [f.path, f]))

  await MailFolder.bulkWrite(rows.map(({ depth, ...r }) => ({
    updateOne: { filter: { accountId: accId, path: r.path }, update: { $set: r }, upsert: true },
  })), { ordered: false })

  // Keep the denormalised MailMessage.folderRole in step when a role changes.
  for (const r of rows) {
    const prev = byPath.get(r.path)
    if (prev && prev.role !== r.role) await MailMessage.updateMany({ folderId: prev._id }, { $set: { folderRole: r.role } })
  }

  const listedPaths = new Set(rows.map(r => r.path))
  const gone = existing.filter(f => !listedPaths.has(f.path)).map(f => f._id)
  if (gone.length) {
    await MailMessage.deleteMany({ folderId: { $in: gone } })
    await MailFolder.deleteMany({ _id: { $in: gone } })
  }

  return MailFolder.find({ accountId: accId }).lean()
}

async function resolveFolder(accountId, ref) {
  const accId = new mongoose.Types.ObjectId(String(accountId))
  const id = ref?._id ?? ref
  const find = async () => {
    if (mongoose.isObjectIdOrHexString(id)) {
      const f = await MailFolder.findOne({ _id: id, accountId: accId }).lean()
      if (f) return f
    }
    const s = String(id ?? '')
    if (!s) return null
    return (await MailFolder.findOne({ accountId: accId, path: s }).lean()) ||
      (FOLDER_ROLES.includes(s) && s !== 'CUSTOM' ? await MailFolder.findOne({ accountId: accId, role: s }).lean() : null)
  }
  let folder = await find()
  if (!folder && !mongoose.isObjectIdOrHexString(id)) {
    await syncFolders(accountId)
    folder = await find()
  }
  return folder
}

// ─── Messages ────────────────────────────────────────────────────────────────

function buildRow(m, meta, body, snippet) {
  const env = m.envelope || {}
  const headers = parseHeaderLines(m.headers)
  const messageId = normalizeMsgId(env.messageId)
  const inReplyTo = normalizeMsgId(env.inReplyTo)
  const references = parseIdList(headers.references)
  const attachments = structureAttachments(m.bodyStructure)
  const row = {
    accountId: meta.accountId,
    folderId: meta.folderId,
    folderPath: meta.folderPath,
    folderRole: meta.folderRole,
    uid: m.uid,
    uidValidity: meta.uidValidity,
    messageId,
    inReplyTo,
    references,
    // Messages without any Message-ID still need a unique conversation key.
    threadKey: computeThreadKey({ messageId, inReplyTo, references }) || `local-${meta.folderId}-${meta.uidValidity}-${m.uid}`,
    subject: String(env.subject || '').replace(/[\r\n]+/g, ' ').trim().slice(0, 998),
    from: firstAddr(env.from) || firstAddr(env.sender) || { name: '', address: '' },
    to: addrList(env.to),
    cc: addrList(env.cc),
    bcc: addrList(env.bcc),
    replyTo: addrList(env.replyTo),
    date: toDate(env.date) || toDate(m.internalDate),
    receivedAt: toDate(m.internalDate),
    ...flagState(m.flags),
    size: Number(m.size) || 0,
    hasAttachments: attachments.some(a => !a.inline),
    attachments,
    priority: priorityOf(headers),
    listUnsubscribe: headers['list-unsubscribe'] ? headers['list-unsubscribe'].slice(0, 2000) : null,
  }
  if (body) {
    row.html = body.html
    row.text = body.text
    row.snippet = body.snippet
    row.bodyFetched = true
  } else {
    row.snippet = snippet || ''
  }
  return row
}

async function upsertRows(rows) {
  if (!rows.length) return { inserted: 0, newIds: [] }
  const ops = rows.map(row => ({
    updateOne: {
      filter: { folderId: row.folderId, uidValidity: row.uidValidity, uid: row.uid },
      update: row.bodyFetched ? { $set: row } : { $set: row, $setOnInsert: { bodyFetched: false } },
      upsert: true,
    },
  }))
  let result
  try {
    result = await MailMessage.bulkWrite(ops, { ordered: false })
  } catch (err) {
    // Another process syncing the same folder can race the same upsert (E11000) — the row exists either way.
    const writeErrors = err.writeErrors || []
    const onlyDupes = err.code === 11000 || (writeErrors.length > 0 && writeErrors.every(e => (e.code ?? e.err?.code) === 11000))
    if (!onlyDupes) throw err
    result = err.result
  }
  const newIds = Object.values(result?.upsertedIds || {})
  return { inserted: Number(result?.upsertedCount) || newIds.length, newIds }
}

/** Download + parse full sources (batched) → Map uid → parsed body. */
async function fetchEagerBodies(client, metas) {
  const out = new Map()
  let batch = []
  let bytes = 0
  const flush = async () => {
    if (!batch.length) return
    const uids = batch
    batch = []
    bytes = 0
    let rows
    try {
      rows = await client.fetchAll(packUids(uids), { uid: true, source: true }, { uid: true })
    } catch (err) {
      if (isConnectionError(err)) throw err
      return
    }
    const wanted = new Set(uids)
    for (const r of rows) {
      if (!r.source || !wanted.has(r.uid) || out.has(r.uid)) continue
      try { out.set(r.uid, await parseSource(r.source)) } catch { /* falls back to a snippet */ }
    }
  }
  for (const m of metas) {
    batch.push(m.uid)
    bytes += Number(m.size) || 0
    if (batch.length >= SOURCE_BATCH_COUNT || bytes >= SOURCE_BATCH_BYTES) await flush()
  }
  await flush()
  return out
}

/** Snippets from the first few KB of each message's text part → Map uid → snippet. */
async function fetchSnippets(client, metas) {
  const out = new Map()
  const groups = new Map()
  for (const m of metas) {
    const { text, html } = pickBodyParts(m.bodyStructure)
    const node = text || html
    if (!node) continue
    // A single-part message has no part number; its body is TEXT.
    const part = node.part || 'TEXT'
    if (!groups.has(part)) groups.set(part, [])
    groups.get(part).push({ uid: m.uid, node })
  }
  for (const [part, items] of groups) {
    const maxLength = items.some(i => i.node.type === 'text/html') ? 16384 : 4096
    for (const group of chunks(items, META_CHUNK)) {
      let rows
      try {
        rows = await client.fetchAll(packUids(group.map(i => i.uid)), { uid: true, bodyParts: [{ key: part, maxLength }] }, { uid: true })
      } catch (err) {
        if (isConnectionError(err)) throw err
        continue
      }
      const nodes = new Map(group.map(i => [i.uid, i.node]))
      for (const r of rows) {
        const node = nodes.get(r.uid)
        const buf = r.bodyParts?.size ? r.bodyParts.values().next().value : null
        if (!node || !buf || out.has(r.uid)) continue
        const decoded = decodePart(buf, node, r.binaryParts?.size > 0)
        out.set(r.uid, makeSnippet(node.type === 'text/html' ? htmlToText(decoded, { links: false }) : decoded))
      }
    }
  }
  return out
}

/** Fetch metadata (+ bodies/snippets) for UIDs and upsert rows. Newest first. */
async function importMessages(client, uids, meta, { eagerLimit = Infinity } = {}) {
  const eager = new Set(eagerLimit === Infinity ? uids : eagerLimit > 0 ? uids.slice(-eagerLimit) : [])
  let inserted = 0
  const newIds = []
  for (const chunk of chunks([...uids].reverse(), META_CHUNK)) {
    const wanted = new Set(chunk)
    const seen = new Set()
    // fetchAll may include unsolicited FETCH rows (flag updates for other messages) — keep only ours.
    const fetched = (await client.fetchAll(packUids(chunk), META_QUERY, { uid: true }))
      .filter(m => wanted.has(m.uid) && m.envelope && !seen.has(m.uid) && seen.add(m.uid))
    if (!fetched.length) continue
    const bodies = await fetchEagerBodies(client, fetched.filter(m => eager.has(m.uid) && (Number(m.size) || 0) <= EAGER_BODY_MAX_BYTES))
    const snippets = await fetchSnippets(client, fetched.filter(m => !bodies.has(m.uid)))
    const res = await upsertRows(fetched.map(m => buildRow(m, meta, bodies.get(m.uid), snippets.get(m.uid))))
    inserted += res.inserted
    newIds.push(...res.newIds)
  }
  return { inserted, newIds }
}

async function countUnseen(client) {
  try {
    const r = await client.search({ seen: false }, { uid: true, returnOptions: ['COUNT'] })
    if (Array.isArray(r)) return r.length
    if (r && typeof r === 'object') return Number(r.count) || 0
  } catch (err) {
    if (isConnectionError(err)) throw err
  }
  return null
}

/** Flag changes + expunges for messages we already hold (UIDs ≤ prevLastUid). */
async function reconcileKnown(client, known, { prevLastUid, oldestUid, storedModseq, selectModseq, exists, newCount }) {
  const low = known.reduce((m, k) => Math.min(m, k.uid), Infinity)
  const range = `${low}:${prevLastUid}`
  const condstore = !!(storedModseq && selectModseq && (client.enabled?.has('CONDSTORE') || client.enabled?.has('QRESYNC')))

  let flagRows = []
  let present = null
  if (condstore) {
    if (storedModseq !== selectModseq) {
      flagRows = await client.fetchAll(range, { uid: true, flags: true }, { uid: true, changedSince: BigInt(storedModseq) })
    }
  } else {
    flagRows = await client.fetchAll(range, { uid: true, flags: true }, { uid: true })
    present = new Set(flagRows.map(r => r.uid))
  }

  const byUid = new Map(known.map(k => [k.uid, k]))
  const ops = []
  for (const r of flagRows) {
    const k = byUid.get(r.uid)
    if (!k || !r.flags) continue
    const f = flagState(r.flags)
    if (k.seen !== f.seen || k.flagged !== f.flagged || k.answered !== f.answered || k.draft !== f.draft || !sameList(k.flags, f.flags)) {
      ops.push({ updateOne: { filter: { _id: k._id }, update: { $set: f } } })
    }
  }
  if (ops.length) await MailMessage.bulkWrite(ops, { ordered: false })

  if (!present) {
    // Whole folder held locally and the counts add up → nothing was expunged.
    if (oldestUid === 1 && exists === known.length + newCount) return
    const found = await client.search({ uid: range }, { uid: true })
    if (!Array.isArray(found)) return // server refused the search: never treat that as "all deleted"
    present = new Set(found)
  }
  const gone = known.filter(k => !present.has(k.uid)).map(k => k._id)
  if (gone.length) await MailMessage.deleteMany({ _id: { $in: gone } })
}

async function syncSelected(client, account, folder, opts) {
  const mb = client.mailbox
  const uidValidity = String(mb.uidValidity)
  const selectModseq = mb.highestModseq != null && !mb.noModseq ? String(mb.highestModseq) : null
  const exists = Number(mb.exists) || 0
  let lastUid = folder.lastUid || 0
  let oldestUid = folder.oldestUid ?? null
  let storedModseq = folder.highestModseq || null

  if (folder.uidValidity && folder.uidValidity !== uidValidity) {
    console.warn(`[mail-sync] ${folder.path}: UIDVALIDITY changed, resyncing folder`)
    await MailMessage.deleteMany({ folderId: folder._id })
    lastUid = 0
    oldestUid = null
    storedModseq = null
  }

  const meta = { accountId: folder.accountId, folderId: folder._id, folderPath: folder.path, folderRole: folder.role, uidValidity }
  const out = empty()
  const saveState = fields => MailFolder.updateOne({ _id: folder._id }, {
    $set: { uidValidity, uidNext: mb.uidNext ?? null, highestModseq: selectModseq, lastSyncAt: new Date(), ...fields },
  })

  if (!exists) {
    await MailMessage.deleteMany({ folderId: folder._id })
    await saveState({ lastUid, oldestUid: 1, total: 0, unread: 0 })
    return out
  }

  // 1. New messages
  const prevLastUid = lastUid
  let newUids
  let reachedFirst = false
  if (!prevLastUid) {
    const limit = clampInt(opts.initialSyncLimit ?? account.options?.initialSyncLimit, 1, 5000, MAIL_LIMITS.defaultInitialSync)
    const startSeq = Math.max(1, exists - limit + 1)
    reachedFirst = startSeq === 1
    newUids = (await client.fetchAll(`${startSeq}:*`, { uid: true })).map(m => m.uid)
  } else {
    // "n:*" always matches the newest message even when n is beyond it, hence the filter.
    newUids = (await client.fetchAll(`${prevLastUid + 1}:*`, { uid: true }, { uid: true })).map(m => m.uid).filter(u => u > prevLastUid)
  }
  newUids = uniqSorted(newUids)
  if (newUids.length) {
    const res = await importMessages(client, newUids, meta, { eagerLimit: prevLastUid ? Infinity : EAGER_FIRST_SYNC })
    out.newMessages = res.inserted
    out.newIds = res.newIds
    lastUid = Math.max(lastUid, newUids[newUids.length - 1])
    if (oldestUid == null || newUids[0] < oldestUid) oldestUid = newUids[0]
  }
  // oldestUid = 1 marks "nothing older on the server" (no load-older needed).
  if (reachedFirst) oldestUid = 1

  // 2. Flags + deletions of messages we already had
  if (prevLastUid) {
    const known = await MailMessage.find({ folderId: folder._id, uidValidity, uid: { $lte: prevLastUid } })
      .select('_id uid seen flagged answered draft flags').lean()
    if (known.length) {
      await reconcileKnown(client, known, { prevLastUid, oldestUid, storedModseq, selectModseq, exists, newCount: newUids.length })
    }
  }

  // 3. Counters
  const unread = await countUnseen(client)
  await saveState({ lastUid, oldestUid, total: exists, ...(unread != null && { unread }) })
  return out
}

/**
 * Incremental sync of one folder (id, path, or role name).
 * opts.initialSyncLimit overrides the account setting for a first sync.
 * Returns { newMessages, newIds }.
 */
export async function syncFolder(accountId, folderIdOrPath, opts = {}) {
  await connectDB()
  const f0 = await resolveFolder(accountId, folderIdOrPath)
  if (!f0) throw mailError('Folder not found', 404)
  if (f0.noSelect) return empty()

  return serial(String(f0._id), async () => {
    const account = await MailAccount.findById(accountId).select('options').lean()
    if (!account) throw mailError('Mailbox not found', 404)
    try {
      return await withMailbox(accountId, f0.path, async client => {
        // getMailboxLock reuses an already-selected mailbox without a new SELECT, so its
        // counters/modseq could be stale. Re-select for fresh state.
        await client.mailboxOpen(f0.path)
        const folder = await MailFolder.findById(f0._id).lean()
        if (!folder) return empty()
        return syncSelected(client, account, folder, opts)
      }, { channel: 'sync' })
    } catch (err) {
      if (err?.mailboxMissing) {
        await syncFolders(accountId).catch(() => {})
        return empty()
      }
      throw err
    }
  }, { coalesce: true })
}

async function runAccountSync(accountId, reason) {
  const started = Date.now()
  let newMessages = 0
  try {
    await connectDB()
    const account = await MailAccount.findById(accountId).select('email isActive syncEnabled sync.status').lean()
    if (!account) return { newMessages: 0, skipped: true }
    if (!account.isActive || !account.syncEnabled) {
      if (!account.syncEnabled && account.sync?.status !== 'PAUSED') await setAccountSync(accountId, { status: 'PAUSED' })
      return { newMessages: 0, skipped: true }
    }
    await setAccountSync(accountId, { status: 'SYNCING', lastSyncAt: new Date() })

    const folders = await syncFolders(accountId)
    const syncable = folders
      .filter(f => !f.noSelect && !NON_SYNCED_ROLES.includes(f.role) && f.specialUse !== '\\Important')
      .sort((a, b) => (ROLE_ORDER[a.role] ?? 9) - (ROLE_ORDER[b.role] ?? 9) || a.path.localeCompare(b.path))

    const failures = []
    for (const f of syncable) {
      try {
        const r = await syncFolder(accountId, f._id)
        newMessages += r.newMessages
      } catch (err) {
        if (isConnectionError(err)) throw err
        failures.push({ folder: f, err })
      }
    }

    const messageCount = await MailMessage.countDocuments({ accountId: account._id })
    const inboxFailed = failures.some(x => x.folder.role === 'INBOX')
    const now = new Date()
    const update = { status: inboxFailed ? 'ERROR' : 'OK', lastSyncAt: now, messageCount }
    if (!inboxFailed) update.lastSuccessAt = now
    if (failures.length) {
      update.lastError = `${failures[0].folder.name}: ${friendlyMailError(failures[0].err)}`
      update.lastErrorAt = now
      console.warn(`[mail-sync] ${account.email}: ${failures.length} folder(s) failed — ${update.lastError}`)
    } else {
      update.lastError = null
    }
    await setAccountSync(accountId, update)
    if (newMessages && reason !== 'idle') {
      console.log(`[mail-sync] ${account.email}: +${newMessages} new (${reason || 'sync'}, ${Date.now() - started}ms)`)
    }
    return { newMessages, ...(failures.length && { error: update.lastError }) }
  } catch (err) {
    const message = friendlyMailError(err)
    await setAccountSync(accountId, { status: 'ERROR', lastError: message, lastErrorAt: new Date(), lastSyncAt: new Date() }).catch(() => {})
    return { newMessages, error: message }
  }
}

/**
 * Full sync of an account: folders, then every syncable folder (INBOX first).
 * Never throws — failures are recorded in account.sync and returned as `error`.
 * Concurrent calls for the same account share one run. Returns { newMessages, error? }.
 */
export async function syncAccount(accountId, { reason } = {}) {
  const key = String(accountId)
  const running = accountRuns.get(key)
  if (running) return running
  const p = runAccountSync(key, reason).finally(() => {
    if (accountRuns.get(key) === p) accountRuns.delete(key)
  })
  accountRuns.set(key, p)
  return p
}

/** Fetch the next `count` older messages below folder.oldestUid → { loaded, hasMore }. */
export async function loadOlder(accountId, folderId, count = 100) {
  await connectDB()
  if (!mongoose.isObjectIdOrHexString(folderId)) return { loaded: 0, hasMore: false }
  const f0 = await MailFolder.findOne({ _id: folderId, accountId }).lean()
  if (!f0 || f0.noSelect) return { loaded: 0, hasMore: false }
  const n = clampInt(count, 1, 500, 100)

  return serial(String(f0._id), () => withMailbox(accountId, f0.path, async client => {
    const folder = await MailFolder.findById(f0._id).lean()
    if (!folder) return { loaded: 0, hasMore: false }
    const uidValidity = String(client.mailbox.uidValidity)
    if (folder.uidValidity && folder.uidValidity !== uidValidity) {
      // Folder was reset on the server; a normal sync rebuilds it.
      syncFolder(accountId, folder._id).catch(() => {})
      return { loaded: 0, hasMore: false }
    }
    let below = folder.oldestUid
    if (below == null) {
      const lowest = await MailMessage.findOne({ folderId: folder._id, uidValidity }).sort({ uid: 1 }).select('uid').lean()
      below = lowest?.uid ?? (folder.lastUid ? folder.lastUid + 1 : null)
    }
    if (!below || below <= 1) return { loaded: 0, hasMore: false }

    const found = await client.search({ uid: `1:${below - 1}` }, { uid: true })
    const older = Array.isArray(found) ? uniqSorted(found).filter(u => u < below) : []
    if (!older.length) {
      if (Array.isArray(found)) await MailFolder.updateOne({ _id: folder._id }, { $set: { oldestUid: 1 } })
      return { loaded: 0, hasMore: false }
    }
    const uids = older.slice(-n)
    const meta = { accountId: folder.accountId, folderId: folder._id, folderPath: folder.path, folderRole: folder.role, uidValidity }
    await importMessages(client, uids, meta, { eagerLimit: 0 })
    const hasMore = older.length > uids.length
    await MailFolder.updateOne({ _id: folder._id }, { $set: { oldestUid: hasMore ? uids[0] : 1, uidValidity } })
    return { loaded: uids.length, hasMore }
  }, { channel: 'ui' }))
}

// ─── Bodies & downloads ──────────────────────────────────────────────────────

function gone() {
  return mailError('Message no longer exists on the server', 404)
}

function assertSameMailbox(client, msg) {
  if (String(client.mailbox?.uidValidity) !== String(msg.uidValidity)) {
    syncFolder(msg.accountId, msg.folderId).catch(() => {})
    throw gone()
  }
}

async function readPartText(client, uid, part, maxBytes) {
  try {
    const dl = await client.download(String(uid), part, { uid: true, maxBytes })
    if (!dl?.content) return null
    // Text parts arrive decoded and converted to UTF-8.
    return (await streamToBuffer(dl.content)).toString('utf8')
  } catch (err) {
    if (isConnectionError(err)) throw err
    return null
  }
}

function toApiError(err) {
  if (err?.status) return err
  if (err?.mailboxMissing) return mailError('Folder no longer exists on the server', 404)
  return mailError(friendlyMailError(err), 502, { cause: err })
}

/**
 * MailMessage _id → lean message with +html +text. Downloads and caches the body on
 * first open. Returns null when the message isn't in the index; throws (err.status
 * 404 when gone from the server, 502 on IMAP failure).
 */
export async function ensureBody(messageId) {
  await connectDB()
  const msg = await MailMessage.findById(messageId).select('+html +text').lean()
  if (!msg) return null
  if (msg.bodyFetched) return msg

  const key = String(msg._id)
  if (bodyInflight.has(key)) return bodyInflight.get(key)

  const p = (async () => {
    let body
    try {
      body = await withMailbox(msg.accountId, msg.folderPath, async client => {
        assertSameMailbox(client, msg)
        if ((Number(msg.size) || 0) <= FULL_PARSE_MAX_BYTES) {
          const fetched = await client.fetchOne(String(msg.uid), { uid: true, source: true }, { uid: true })
          if (!fetched?.source) throw gone()
          return parseSource(fetched.source)
        }
        // Huge message: only its text parts (attachments are downloaded on demand).
        const st = await client.fetchOne(String(msg.uid), { uid: true, bodyStructure: true }, { uid: true })
        if (!st?.bodyStructure) throw gone()
        const { html: htmlNode, text: textNode } = pickBodyParts(st.bodyStructure)
        const html = htmlNode ? await readPartText(client, msg.uid, htmlNode.part || '1', 4 * 1024 * 1024) : null
        const text = textNode ? await readPartText(client, msg.uid, textNode.part || '1', 1024 * 1024) : null
        return {
          html: html ? html.slice(0, HTML_MAX_CHARS) : null,
          text: (text || (html ? htmlToText(html) : '')).slice(0, TEXT_MAX_CHARS),
          snippet: makeSnippet(text || (html ? htmlToText(html, { links: false }) : '')),
          attachments: structureAttachments(st.bodyStructure),
        }
      }, { channel: 'ui' })
    } catch (err) {
      throw toApiError(err)
    }

    const $set = { bodyFetched: true, html: body.html, text: body.text }
    if (!msg.snippet && body.snippet) $set.snippet = body.snippet
    if (!msg.attachments?.length && body.attachments?.length) {
      $set.attachments = body.attachments
      $set.hasAttachments = body.attachments.some(a => !a.inline)
    }
    return MailMessage.findByIdAndUpdate(msg._id, { $set }, { new: true }).select('+html +text').lean()
  })().finally(() => bodyInflight.delete(key))

  bodyInflight.set(key, p)
  return p
}

/**
 * Attachment bytes → { buffer, filename, contentType, size } (buffered; the IMAP
 * download has to finish while the mailbox lock is held). Null if the message or
 * attachment index is unknown; throws like ensureBody on IMAP problems.
 */
export async function downloadAttachment(messageId, idx) {
  await connectDB()
  const msg = await MailMessage.findById(messageId).select('accountId folderId folderPath uid uidValidity attachments size').lean()
  if (!msg) return null
  const att = (msg.attachments || []).find(a => a.idx === Number(idx))
  if (!att) return null

  try {
    const buffer = await withMailbox(msg.accountId, msg.folderPath, async client => {
      assertSameMailbox(client, msg)
      if (att.part) {
        try {
          const dl = await client.download(String(msg.uid), att.part, { uid: true, maxBytes: ATTACHMENT_MAX_BYTES })
          if (dl?.content) return await streamToBuffer(dl.content)
        } catch (err) {
          if (isConnectionError(err)) throw err
        }
      }
      // Fallback: parse the whole message and pick the attachment out of it.
      const fetched = await client.fetchOne(String(msg.uid), { uid: true, source: true }, { uid: true })
      if (!fetched?.source) throw gone()
      const parsed = await simpleParser(fetched.source, PARSER_OPTIONS)
      const list = parsed.attachments || []
      const cid = att.cid ? att.cid.toLowerCase() : null
      const hit = (att.part && list.find(a => a.partId === att.part)) ||
        (cid && list.find(a => a.cid && a.cid.toLowerCase() === cid)) ||
        list.find(a => a.filename && a.filename === att.filename) ||
        list[att.idx]
      if (!hit) throw mailError('Attachment not found', 404)
      return hit.content
    }, { channel: 'ui' })
    return { buffer, filename: att.filename, contentType: att.contentType, size: buffer.length }
  } catch (err) {
    throw toApiError(err)
  }
}

/** Full RFC822 source as a Buffer (null if the message isn't in the index). */
export async function downloadRaw(messageId) {
  await connectDB()
  const msg = await MailMessage.findById(messageId).select('accountId folderId folderPath uid uidValidity').lean()
  if (!msg) return null
  try {
    return await withMailbox(msg.accountId, msg.folderPath, async client => {
      assertSameMailbox(client, msg)
      const dl = await client.download(String(msg.uid), undefined, { uid: true })
      if (dl?.content) return streamToBuffer(dl.content)
      const fetched = await client.fetchOne(String(msg.uid), { uid: true, source: true }, { uid: true })
      if (!fetched?.source) throw gone()
      return fetched.source
    }, { channel: 'ui' })
  } catch (err) {
    throw toApiError(err)
  }
}
