// Server-only: compose validation, the outbox (undo / schedule send), SMTP dispatch and IMAP drafts.
// Errors are thrown as Error with `.status` (400/403/404/409/422) + a human message; routes return `err.status ?? 500`.
//
// Every send goes through MailOutbox: the API queues it, and whoever claims it
// first (the worker's processDueOutbox, the API's opportunistic call, or an
// immediate dispatch) sends it. The claim is one atomic findOneAndUpdate, so a
// message is never sent twice; once SMTP accepts it, it is never retried.
import { randomUUID } from 'crypto'
// Explicit index.js: a bare directory import breaks if this ever runs as native ESM
import MailComposer from 'nodemailer/lib/mail-composer/index.js'
import { MailAccount, MailFolder, MailMessage, MailOutbox } from '@/models'
import { isValidObjectId } from '@/lib/objectId'
import { createNotification } from '@/lib/createNotification'
import { MAIL_LIMITS } from '@/lib/mail/constants'
import { isStaff, canUseAccount, canManageMail, accessibleAccountIds } from '@/lib/mail/access'
import { loadAccountWithSecret, smtpTransport, fromHeader } from '@/lib/mail/credentials'
import { withImap, friendlyMailError } from '@/lib/mail/imap'
import { syncFolder, downloadAttachment, computeThreadKey, normalizeMsgId } from '@/lib/mail/sync'
import { htmlToText } from '@/lib/mail/sanitize'
import { readMailUpload, statMailUpload, sanitizeFilename } from '@/lib/mail/uploads'
import { ensureRoleFolder, deleteRemoteMessages, mailServerMessage } from '@/lib/mail/actions'

const MODES = ['new', 'reply', 'replyAll', 'forward', 'draft']
const DAY_MS = 24 * 60 * 60 * 1000
const MAX_ATTEMPTS = 3
const RETRY_DELAY_MS = 60 * 1000
const STUCK_MS = 5 * 60 * 1000
const MAX_SCHEDULE_MS = 366 * DAY_MS
const MAX_HTML_CHARS = 5 * 1024 * 1024
const MAX_ATTACHMENTS = 50
const MAX_INLINE = 30
const MAX_REFERENCES = 30
const OUTBOX_BATCH = 25
const OUTBOX_CONCURRENCY = 3

const UPLOAD_ID_RE = /^[a-f0-9-]{36}$/
const ADDRESS_RE = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:".]{2,}$/
// Images quoted from a stored message point at our attachment route; recipients can't load
// those, so they are embedded as cid: parts when sending.
const INLINE_SRC_RE = /(\bsrc\s*=\s*["'])(?:https?:\/\/[^"'/\s]+)?\/api\/mail\/messages\/([a-f0-9]{24})\/attachments\/(\d+)(?:\?[^"']*)?(["'])/gi

function mailError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

// Never worth retrying (missing mailbox / attachment, server said 5xx).
function permanentError(message, status = 422) {
  const err = mailError(status, message)
  err.permanent = true
  return err
}

function background(label, fn) {
  Promise.resolve()
    .then(fn)
    .catch(err => console.error(`[mail/send] ${label}`, err?.message || err))
}

function domainOf(email) {
  return String(email || '').split('@')[1]?.trim().toLowerCase() || 'localhost'
}

function plainText(html) {
  try {
    return String(htmlToText(String(html ?? '')) ?? '')
  } catch {
    return String(html ?? '').replace(/<[^>]*>/g, ' ')
  }
}

function snippetOf(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim().slice(0, 200)
}

function iso(d) {
  if (!d) return null
  const t = new Date(d)
  return Number.isNaN(t.getTime()) ? null : t.toISOString()
}

// ─── Validation ──────────────────────────────────────────────────────────────

function parseRecipient(entry) {
  if (typeof entry === 'string') {
    const m = /^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/.exec(entry)
    return m ? { name: m[1], address: m[2] } : { name: '', address: entry }
  }
  if (entry && typeof entry === 'object') return { name: entry.name, address: entry.address }
  return null
}

function normalizeRecipients(value, { lenient }) {
  if (value == null || value === '') return { list: [] }
  let items = value
  if (typeof value === 'string') items = value.split(/[,;\n]+/)
  if (!Array.isArray(items)) return { error: 'Invalid recipients' }
  if (items.length > MAIL_LIMITS.maxRecipients * 2) return { error: `Too many recipients (max ${MAIL_LIMITS.maxRecipients})` }

  const list = []
  for (const entry of items) {
    const r = parseRecipient(entry)
    if (!r) return { error: 'Invalid recipients' }
    const address = String(r.address ?? '').trim().replace(/^<|>$/g, '').trim()
    if (!address) continue
    if (address.length > 254 || !ADDRESS_RE.test(address)) {
      // Drafts keep autosaving while a bad chip is on screen; just leave it out of the draft.
      if (lenient) continue
      return { error: `"${address.slice(0, 80)}" isn't a valid email address` }
    }
    const name = String(r.name ?? '').replace(/[\r\n\t"]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 200)
    list.push({ name, address })
  }
  return { list }
}

function optionalId(v) {
  if (v == null || v === '') return { id: null }
  return isValidObjectId(v) ? { id: String(v) } : { error: true }
}

/**
 * Validate a compose payload (POST /api/mail/send and /api/mail/drafts body).
 * @returns {{ ok: true, payload: object } | { ok: false, error: string }}
 */
export function validateComposePayload(body, { forDraft = false } = {}) {
  const fail = error => ({ ok: false, error })
  if (!body || typeof body !== 'object' || Array.isArray(body)) return fail('Invalid message')

  const accountId = String(body.accountId ?? '')
  if (!isValidObjectId(accountId)) return fail('Choose a mailbox to send from')

  const lists = {}
  for (const key of ['to', 'cc', 'bcc']) {
    const res = normalizeRecipients(body[key], { lenient: forDraft })
    if (res.error) return fail(res.error)
    lists[key] = res.list
  }
  // One copy per person even if they're listed in both To and Cc
  const seen = new Set()
  for (const key of ['to', 'cc', 'bcc']) {
    lists[key] = lists[key].filter(r => {
      const k = r.address.toLowerCase()
      if (seen.has(k)) return false
      seen.add(k)
      return true
    })
  }
  if (!forDraft && !seen.size) return fail('Add at least one recipient')
  if (seen.size > MAIL_LIMITS.maxRecipients) return fail(`Too many recipients (max ${MAIL_LIMITS.maxRecipients})`)

  if (body.subject != null && typeof body.subject !== 'string') return fail('Invalid subject')
  const subject = String(body.subject ?? '').replace(/[\r\n\t]+/g, ' ').trim()
  if (subject.length > 998) return fail('Subject is too long')

  if (body.html != null && typeof body.html !== 'string') return fail('Invalid message body')
  const html = String(body.html ?? '')
  if (html.length > MAX_HTML_CHARS) return fail('Message is too large')

  const rawAtts = body.attachments ?? []
  if (!Array.isArray(rawAtts)) return fail('Invalid attachments')
  if (rawAtts.length > MAX_ATTACHMENTS) return fail(`Too many attachments (max ${MAX_ATTACHMENTS})`)
  const attachments = []
  const attKeys = new Set()
  for (const a of rawAtts) {
    let item
    const idx = typeof a?.idx === 'number' ? a.idx : /^\d{1,4}$/.test(String(a?.idx ?? '')) ? Number(a.idx) : NaN
    if (a?.type === 'upload' && UPLOAD_ID_RE.test(String(a.id ?? ''))) {
      item = { type: 'upload', id: String(a.id) }
    } else if (a?.type === 'message' && isValidObjectId(a.messageId) && Number.isInteger(idx) && idx >= 0) {
      item = { type: 'message', messageId: String(a.messageId), idx }
    } else {
      return fail('Invalid attachment')
    }
    const key = item.type === 'upload' ? `u:${item.id}` : `m:${item.messageId}:${item.idx}`
    if (attKeys.has(key)) continue
    attKeys.add(key)
    attachments.push(item)
  }

  const mode = body.mode == null || body.mode === '' ? 'new' : body.mode
  if (!MODES.includes(mode)) return fail('Invalid mode')

  const reply = optionalId(body.inReplyToId)
  if (reply.error) return fail('Invalid original message')
  const draft = optionalId(body.draftId)
  if (draft.error) return fail('Invalid draft')

  let sendAt = null
  if (!forDraft && body.sendAt != null && body.sendAt !== '') {
    const d = new Date(body.sendAt)
    if (Number.isNaN(d.getTime())) return fail('Invalid send time')
    // A minute of slack for "pick date & time" right at the current minute
    if (d.getTime() < Date.now() - 60 * 1000) return fail('Pick a time in the future')
    if (d.getTime() > Date.now() + MAX_SCHEDULE_MS) return fail('You can schedule up to a year ahead')
    sendAt = d
  }

  let undoSeconds = 0
  if (!forDraft && !sendAt) {
    if (body.undoSeconds == null || body.undoSeconds === '') {
      undoSeconds = MAIL_LIMITS.undoSendSeconds
    } else {
      const n = Number(body.undoSeconds)
      if (!Number.isFinite(n) || n < 0 || n > 30) return fail('Invalid undo delay')
      undoSeconds = Math.round(n)
    }
  }

  return {
    ok: true,
    payload: {
      accountId,
      to: lists.to,
      cc: lists.cc,
      bcc: lists.bcc,
      subject,
      html,
      attachments,
      mode,
      inReplyToId: reply.id,
      draftId: draft.id,
      sendAt,
      undoSeconds,
    },
  }
}

// ─── Shared helpers ──────────────────────────────────────────────────────────

async function loadSendAccount(session, accountId) {
  if (!isStaff(session)) throw mailError(403, 'Forbidden')
  if (!isValidObjectId(accountId)) throw mailError(404, 'Mailbox not found')
  const account = await MailAccount.findById(accountId)
    .select('email name fromName isActive assignedUsers options')
    .lean()
  if (!account || !canUseAccount(session, account)) throw mailError(404, 'Mailbox not found')
  if (!account.isActive) throw mailError(422, 'This mailbox is inactive')
  return account
}

function extractInlineRefs(html) {
  const refs = []
  const keys = new Set()
  for (const m of String(html ?? '').matchAll(INLINE_SRC_RE)) {
    const key = `${m[2]}:${m[3]}`
    if (keys.has(key)) continue
    keys.add(key)
    refs.push({ messageId: m[2], idx: Number(m[3]) })
    if (refs.length >= MAX_INLINE) break
  }
  return refs
}

function threadHeaders(inReplyTo, references) {
  const parent = normalizeMsgId(inReplyTo)
  if (!parent) return null
  const refs = []
  for (const r of [...(references ?? []), parent]) {
    const id = normalizeMsgId(r)
    if (id && !refs.includes(id)) refs.push(id)
  }
  // Keep the root (threading anchor) plus the most recent ancestors
  const trimmed = refs.length > MAX_REFERENCES ? [refs[0], ...refs.slice(-(MAX_REFERENCES - 1))] : refs
  return { inReplyTo: parent, references: trimmed }
}

/**
 * Check every id the payload points at against what the session may use, and
 * enrich it into the stored outbox/draft payload (attachment names + sizes,
 * verified inline images, threading headers, whether to mark the original answered).
 */
async function preparePayload(session, payload, account) {
  const userId = String(session.user.id)
  const allowed = new Set((await accessibleAccountIds(session)).map(String))
  const atts = payload.attachments ?? []
  const inlineRefs = extractInlineRefs(payload.html)

  const ids = [...new Set([
    ...atts.filter(a => a.type === 'message').map(a => a.messageId),
    ...inlineRefs.map(r => r.messageId),
    payload.inReplyToId,
    payload.draftId,
  ].filter(Boolean))]
  const rows = ids.length
    ? await MailMessage.find({ _id: { $in: ids } })
      .select('accountId folderRole attachments messageId inReplyTo references')
      .lean()
    : []
  const byId = new Map(rows.filter(r => allowed.has(String(r.accountId))).map(r => [String(r._id), r]))

  let total = 0
  const attachments = []
  for (const a of atts) {
    if (a.type === 'upload') {
      const meta = await statMailUpload(userId, a.id)
      if (!meta) throw mailError(422, 'An attachment is no longer available, attach it again')
      total += meta.size
      attachments.push({ type: 'upload', id: a.id, filename: meta.filename, contentType: meta.contentType, size: meta.size })
    } else {
      const att = byId.get(a.messageId)?.attachments?.find(x => x.idx === a.idx)
      if (!att) throw mailError(422, 'An attachment of the original message is no longer available')
      total += att.size || 0
      attachments.push({
        type: 'message',
        messageId: a.messageId,
        idx: a.idx,
        filename: sanitizeFilename(att.filename),
        contentType: att.contentType || 'application/octet-stream',
        size: att.size || 0,
      })
    }
  }
  if (total > MAIL_LIMITS.totalAttachmentBytes) {
    throw mailError(422, `Attachments are too large (max ${Math.round(MAIL_LIMITS.totalAttachmentBytes / (1024 * 1024))} MB in total)`)
  }

  const inline = inlineRefs.filter(r => byId.get(r.messageId)?.attachments?.some(x => x.idx === r.idx))

  // The original may have been re-indexed or deleted meanwhile; sending must not fail over threading.
  let inReplyToId = payload.inReplyToId && byId.has(payload.inReplyToId) ? payload.inReplyToId : null
  const draft = payload.draftId ? byId.get(payload.draftId) : null
  const draftId = draft && draft.folderRole === 'DRAFTS' ? payload.draftId : null

  let thread = null
  let fromDraft = false
  if (inReplyToId) {
    const orig = byId.get(inReplyToId)
    thread = threadHeaders(orig.messageId, orig.references)
  } else if (draftId && draft.inReplyTo) {
    // Reopened reply drafts only carry In-Reply-To / References in their own headers.
    thread = threadHeaders(draft.inReplyTo, draft.references)
    fromDraft = !!thread
    const orig = thread && await MailMessage.findOne({
      accountId: draft.accountId,
      messageId: thread.inReplyTo,
      folderRole: { $nin: ['DRAFTS', 'SENT'] },
    }).select('_id').lean()
    if (orig) inReplyToId = String(orig._id)
  }

  const mode = payload.mode || 'new'
  const markAnswered = !!inReplyToId && (
    mode === 'reply' || mode === 'replyAll' ||
    (fromDraft && !/^\s*(fwd?|fw)\s*:/i.test(payload.subject || ''))
  )

  return {
    accountId: String(account._id),
    to: payload.to ?? [],
    cc: payload.cc ?? [],
    bcc: payload.bcc ?? [],
    subject: payload.subject ?? '',
    html: payload.html ?? '',
    text: plainText(payload.html),
    attachments,
    mode,
    inReplyToId,
    draftId,
    undoSeconds: payload.undoSeconds ?? 0,
    sendAt: iso(payload.sendAt),
    inline,
    thread,
    markAnswered,
  }
}

async function toBuffer(dl) {
  if (!dl) return null
  if (Buffer.isBuffer(dl.buffer)) return dl.buffer
  if (dl.buffer) return Buffer.from(dl.buffer)
  if (!dl.stream) return null
  const chunks = []
  let size = 0
  for await (const chunk of dl.stream) {
    size += chunk.length
    if (size > MAIL_LIMITS.totalAttachmentBytes * 2) throw permanentError('An attachment is too large')
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
  }
  return Buffer.concat(chunks)
}

async function resolveAttachments(list, userId) {
  const out = []
  for (const a of list ?? []) {
    if (a.type === 'upload') {
      const up = await readMailUpload(userId, a.id)
      if (!up) throw permanentError(`Attachment "${a.filename || 'file'}" is no longer available`)
      out.push({ filename: up.filename, contentType: up.contentType, content: up.buffer, contentDisposition: 'attachment' })
    } else {
      let dl
      try {
        dl = await downloadAttachment(a.messageId, a.idx)
      } catch (err) {
        const e = mailError(422, `Couldn't fetch attachment "${a.filename || 'file'}": ${mailServerMessage(err)}`)
        // 404 = the source message is gone; only server/network trouble is worth a retry
        e.permanent = err?.status === 404
        throw e
      }
      const content = await toBuffer(dl)
      if (!content) throw permanentError(`Attachment "${a.filename || 'file'}" is no longer available`)
      out.push({
        filename: sanitizeFilename(dl.filename || a.filename),
        contentType: dl.contentType || a.contentType || 'application/octet-stream',
        content,
        contentDisposition: 'attachment',
      })
    }
  }
  return out
}

async function embedInline(html, inline, domain) {
  if (!inline?.length || !html) return { html, related: [] }
  const allowed = new Set(inline.map(r => `${r.messageId}:${r.idx}`))
  const cids = new Map()
  const related = []
  for (const r of inline) {
    const key = `${r.messageId}:${r.idx}`
    try {
      const dl = await downloadAttachment(r.messageId, r.idx)
      const content = await toBuffer(dl)
      if (!content) continue
      const cid = `${randomUUID()}@${domain}`
      cids.set(key, cid)
      related.push({
        filename: sanitizeFilename(dl.filename || 'image'),
        contentType: dl.contentType || 'application/octet-stream',
        content,
        cid,
        contentDisposition: 'inline',
      })
    } catch (err) {
      // A missing quoted image shouldn't block the send; it just stays a broken link.
      console.error('[mail/send] inline image', key, err?.message || err)
    }
  }
  const out = html.replace(INLINE_SRC_RE, (match, pre, id, idx, post) => {
    const key = `${id}:${idx}`
    return allowed.has(key) && cids.has(key) ? `${pre}cid:${cids.get(key)}${post}` : match
  })
  return { html: out, related }
}

/**
 * Build the MIME tree. text/plain + text/html are always both present, which
 * keeps the part layout predictable (see mimeParts).
 */
async function composeMime(account, p, { userId, messageId, date }) {
  const domain = domainOf(account.email)
  const { html, related } = await embedInline(p.html, p.inline, domain)
  const attached = await resolveAttachments(p.attachments, userId)
  const text = p.text ?? plainText(p.html)

  const opts = {
    from: fromHeader(account),
    to: p.to ?? [],
    cc: p.cc ?? [],
    bcc: p.bcc ?? [],
    subject: p.subject || '',
    text: text && text.trim() ? text : ' ',
    html: html && html.trim() ? html : '<div><br></div>',
    messageId: `<${messageId}>`,
    date,
    attachments: [...related, ...attached],
    // Compose HTML is user input: never let it make nodemailer read files or fetch URLs
    disableFileAccess: true,
    disableUrlAccess: true,
  }
  if (p.thread?.inReplyTo) {
    opts.inReplyTo = `<${p.thread.inReplyTo}>`
    opts.references = (p.thread.references?.length ? p.thread.references : [p.thread.inReplyTo]).map(r => `<${r}>`)
  }
  const node = new MailComposer(opts).compile()
  return { node, html: opts.html, text: opts.text, related, attached }
}

// IMAP part ids for nodemailer's tree:
//   alternative[text, html]                               (no files)
//   alternative[text, related[html, img…]]                (inline only)   → img i = 2.(i+2)
//   mixed[alternative[text, html], file…]                 (files only)    → file j = j+2
//   mixed[alternative[text, related[html, img…]], file…]  (both)          → img i = 1.2.(i+2), file j = j+2
function mimeParts(inlineCount, fileCount) {
  const inline = []
  const files = []
  for (let j = 0; j < fileCount; j++) files.push(String(j + 2))
  for (let i = 0; i < inlineCount; i++) inline.push(fileCount ? `1.2.${i + 2}` : `2.${i + 2}`)
  return { inline, files }
}

function lowerList(list) {
  return (list ?? []).map(r => ({ name: r.name || '', address: String(r.address || '').toLowerCase() }))
}

// ─── Outbox ──────────────────────────────────────────────────────────────────

/**
 * Queue a validated compose payload. Dispatches right away when there is no
 * undo delay and no schedule. Returns the outbox doc (lean, current state).
 */
export async function queueMessage(session, payload) {
  const account = await loadSendAccount(session, payload?.accountId)
  const prepared = await preparePayload(session, payload, account)

  const now = Date.now()
  const scheduled = !!payload.sendAt
  const undo = scheduled ? 0 : Math.min(30, Math.max(0, Math.round(Number(payload.undoSeconds) || 0)))
  const sendAt = scheduled
    ? new Date(Math.max(new Date(payload.sendAt).getTime(), now))
    : new Date(now + undo * 1000)

  const doc = await MailOutbox.create({
    accountId: account._id,
    userId: session.user.id,
    status: 'QUEUED',
    sendAt,
    scheduled,
    payload: prepared,
  })

  if (!scheduled && undo === 0) {
    await sendOutboxItem(doc._id)
    return (await MailOutbox.findById(doc._id).lean()) ?? doc.toObject()
  }
  // Fire right when the undo window closes instead of waiting for the next
  // dispatcher tick; the atomic claim makes this a no-op if it was cancelled
  // or the worker got there first.
  if (!scheduled) {
    const t = setTimeout(() => { sendOutboxItem(doc._id).catch(() => {}) }, undo * 1000 + 100)
    t.unref?.()
  }
  return doc.toObject()
}

function smtpErrorMessage(err) {
  if (err?.permanent || (err?.status && !err.mailConnect && !err.friendly)) return err.message
  if (err?.code === 'EENVELOPE') {
    const response = String(err.response || '').replace(/\s+/g, ' ').trim()
    return response ? `Recipient rejected: ${response}` : 'The recipients were rejected'
  }
  return friendlyMailError(err) || 'Sending failed'
}

async function handleSendFailure(item, err) {
  const message = smtpErrorMessage(err).slice(0, 500)
  const code = Number(err?.responseCode)
  const permanent = !!err?.permanent || (code >= 500 && code < 600)

  if (!permanent && item.attempts < MAX_ATTEMPTS) {
    await MailOutbox.updateOne(
      { _id: item._id, status: 'SENDING' },
      { $set: { status: 'QUEUED', sendAt: new Date(Date.now() + RETRY_DELAY_MS), lockedAt: null, lastError: message } }
    )
    return { ok: false, status: 'QUEUED', error: message }
  }

  await MailOutbox.updateOne(
    { _id: item._id, status: 'SENDING' },
    { $set: { status: 'FAILED', lockedAt: null, lastError: message } }
  )
  await notifyFailed(item, message)
  return { ok: false, status: 'FAILED', error: message }
}

function notifyFailed(item, message) {
  const subject = String(item.payload?.subject || '(no subject)').slice(0, 120)
  return createNotification({
    userId: item.userId,
    title: 'Email not sent',
    message: `"${subject}" couldn't be sent: ${message}`,
    type: 'MAIL',
    link: '/admin/mail?view=scheduled',
  })
}

async function markOriginalAnswered(messageId) {
  const msg = await MailMessage.findById(messageId).select('accountId folderPath uid uidValidity answered').lean()
  if (!msg || msg.answered) return
  const ok = await withImap(msg.accountId, async client => {
    const lock = await client.getMailboxLock(msg.folderPath)
    try {
      if (String(client.mailbox?.uidValidity) !== String(msg.uidValidity)) return false
      return client.messageFlagsAdd([msg.uid], ['\\Answered'], { uid: true })
    } finally {
      lock.release()
    }
  })
  if (ok) await MailMessage.updateOne({ _id: msg._id }, { $set: { answered: true }, $addToSet: { flags: '\\Answered' } })
}

/** Permanently remove a stored draft (server + local). Access must be checked by the caller. */
async function removeDraft(draftId) {
  const d = await MailMessage.findById(draftId).select('accountId folderPath folderRole uid uidValidity').lean()
  if (!d || d.folderRole !== 'DRAFTS') return false
  await deleteRemoteMessages(d.accountId, d.folderPath, d.uidValidity, [d.uid])
  await MailMessage.deleteOne({ _id: d._id })
  return true
}

async function afterSend(account, item, mime) {
  const p = item.payload || {}
  let sentFolder = null

  if (account.options?.saveSentCopy !== false) {
    try {
      sentFolder = await ensureRoleFolder(account._id, 'SENT')
      // The SMTP copy omits Bcc; the Sent copy keeps it so the sender can see who was Bcc'd
      mime.node.keepBcc = true
      const copy = await mime.node.build()
      await withImap(account._id, client => client.append(sentFolder.path, copy, ['\\Seen'], new Date()))
    } catch (err) {
      console.error('[mail/send] save sent copy', err?.message || err)
      await MailOutbox.updateOne({ _id: item._id }, {
        $set: { lastError: `Sent, but the copy couldn't be saved to Sent: ${mailServerMessage(err)}`.slice(0, 500) },
      })
    }
  }

  if (p.markAnswered && p.inReplyToId) {
    try {
      await markOriginalAnswered(p.inReplyToId)
    } catch (err) {
      console.error('[mail/send] mark answered', err?.message || err)
    }
  }

  if (p.draftId) {
    try {
      await removeDraft(p.draftId)
    } catch (err) {
      console.error('[mail/send] delete draft', err?.message || err)
    }
  }

  // Gmail / Microsoft save their own Sent copy; either way the Sent view needs a refresh.
  background('sync sent', async () => {
    const folder = sentFolder ?? await MailFolder.findOne({ accountId: account._id, role: 'SENT' }).select('_id').lean()
    if (folder) await syncFolder(account._id, folder._id)
  })
}

/**
 * Claim and send one outbox item. Safe to call from anywhere at any time: it
 * only proceeds if the item is QUEUED and due.
 * @returns {Promise<{ ok: boolean, status: 'SENT'|'QUEUED'|'FAILED'|'SKIPPED', error?: string }>}
 */
export async function sendOutboxItem(outboxId) {
  if (!isValidObjectId(outboxId)) return { ok: false, status: 'SKIPPED' }
  const now = new Date()
  const item = await MailOutbox.findOneAndUpdate(
    { _id: outboxId, status: 'QUEUED', sendAt: { $lte: now } },
    { $set: { status: 'SENDING', lockedAt: now }, $inc: { attempts: 1 } },
    { new: true }
  ).lean()
  if (!item) return { ok: false, status: 'SKIPPED' }

  const p = item.payload || {}
  let account
  let mime
  let messageId
  let info
  try {
    account = await loadAccountWithSecret(item.accountId)
    if (!account) throw permanentError('This mailbox no longer exists')
    if (!account.isActive) throw permanentError('This mailbox is inactive')

    const rcpt = [...(p.to ?? []), ...(p.cc ?? []), ...(p.bcc ?? [])].map(r => r.address).filter(Boolean)
    if (!rcpt.length) throw permanentError('Add at least one recipient', 400)

    messageId = `${randomUUID()}@${domainOf(account.email)}`
    mime = await composeMime(account, p, { userId: String(item.userId), messageId, date: new Date() })
    mime.node.keepBcc = false
    const raw = await mime.node.build()

    const transport = smtpTransport(account)
    try {
      info = await transport.sendMail({ envelope: { from: account.email, to: rcpt }, raw })
    } finally {
      transport.close()
    }
  } catch (err) {
    console.error('[mail/send] send failed', String(item._id), err?.code || '', err?.message || err)
    return handleSendFailure(item, err)
  }

  // SMTP accepted it: record that first so nothing below can cause a resend.
  const rejected = (info?.rejected ?? []).map(String).filter(Boolean)
  await MailOutbox.updateOne({ _id: item._id }, {
    $set: {
      status: 'SENT',
      sentAt: new Date(),
      sentMessageId: normalizeMsgId(messageId),
      lockedAt: null,
      lastError: rejected.length ? `Not delivered to: ${rejected.join(', ')}`.slice(0, 500) : null,
    },
  })

  try {
    await afterSend(account, item, mime)
  } catch (err) {
    console.error('[mail/send] after send', err?.message || err)
  }
  return { ok: true, status: 'SENT' }
}

async function failStuck(cutoff) {
  const dead = await MailOutbox.find({
    status: 'SENDING',
    attempts: { $gte: MAX_ATTEMPTS },
    $or: [{ lockedAt: { $lt: cutoff } }, { lockedAt: null }],
  }).select('_id userId payload.subject').lean()
  for (const d of dead) {
    const res = await MailOutbox.updateOne(
      { _id: d._id, status: 'SENDING' },
      { $set: { status: 'FAILED', lockedAt: null, lastError: 'Sending was interrupted' } }
    )
    if (res.modifiedCount) await notifyFailed(d, 'Sending was interrupted')
  }
}

/**
 * Send every due QUEUED item (bounded batch, 3 at a time) and recover items
 * stuck in SENDING for > 5 min (process died mid-send).
 * Concurrent calls in one process share the same run.
 * @returns {Promise<{ due: number, sent: number, failed: number, retrying: number }>}
 */
export function processDueOutbox() {
  if (globalThis.__crmMailOutboxRun) return globalThis.__crmMailOutboxRun

  const run = (async () => {
    const cutoff = new Date(Date.now() - STUCK_MS)
    await MailOutbox.updateMany(
      { status: 'SENDING', attempts: { $lt: MAX_ATTEMPTS }, $or: [{ lockedAt: { $lt: cutoff } }, { lockedAt: null }] },
      { $set: { status: 'QUEUED', lockedAt: null, lastError: 'Sending was interrupted, retrying' } }
    )
    await failStuck(cutoff)

    const due = await MailOutbox.find({ status: 'QUEUED', sendAt: { $lte: new Date() } })
      .sort({ sendAt: 1 })
      .limit(OUTBOX_BATCH)
      .select('_id')
      .lean()

    const stats = { due: due.length, sent: 0, failed: 0, retrying: 0 }
    const queue = due.map(d => d._id)
    const worker = async () => {
      while (queue.length) {
        const id = queue.shift()
        try {
          const res = await sendOutboxItem(id)
          if (res.status === 'SENT') stats.sent++
          else if (res.status === 'FAILED') stats.failed++
          else if (res.status === 'QUEUED') stats.retrying++
        } catch (err) {
          console.error('[mail/send] outbox item', String(id), err?.message || err)
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(OUTBOX_CONCURRENCY, queue.length) }, worker))
    return stats
  })().finally(() => {
    globalThis.__crmMailOutboxRun = null
  })

  globalThis.__crmMailOutboxRun = run
  return run
}

function canControlOutbox(session, item) {
  return String(item.userId) === String(session.user.id) || canManageMail(session)
}

/** The compose fields of an outbox payload, shaped for reopening the composer. */
function composerPayload(item) {
  const p = item.payload || {}
  return {
    accountId: String(item.accountId),
    to: p.to ?? [],
    cc: p.cc ?? [],
    bcc: p.bcc ?? [],
    subject: p.subject ?? '',
    html: p.html ?? '',
    attachments: (p.attachments ?? []).map(a => (a.type === 'upload'
      ? { type: 'upload', id: a.id, filename: a.filename, size: a.size, contentType: a.contentType }
      : { type: 'message', messageId: a.messageId, idx: a.idx, filename: a.filename, size: a.size, contentType: a.contentType })),
    mode: p.mode ?? 'new',
    inReplyToId: p.inReplyToId ?? null,
    draftId: p.draftId ?? null,
    sendAt: item.scheduled ? iso(item.sendAt) : null,
    undoSeconds: p.undoSeconds ?? MAIL_LIMITS.undoSendSeconds,
  }
}

/** Undo / cancel a queued (or failed) send → compose payload for reopening the composer. */
export async function cancelOutbox(session, outboxId) {
  if (!isStaff(session)) throw mailError(403, 'Forbidden')
  if (!isValidObjectId(outboxId)) throw mailError(404, 'Message not found')
  const item = await MailOutbox.findById(outboxId).select('userId status').lean()
  if (!item || !canControlOutbox(session, item)) throw mailError(404, 'Message not found')

  const res = await MailOutbox.findOneAndUpdate(
    { _id: item._id, status: { $in: ['QUEUED', 'FAILED'] } },
    { $set: { status: 'CANCELLED', lockedAt: null } },
    { new: true }
  ).lean()
  if (!res) {
    const now = await MailOutbox.findById(item._id).select('status').lean()
    const sent = ['SENT', 'SENDING'].includes(now?.status)
    throw mailError(409, sent ? 'Too late, the message was already sent' : 'This message is no longer queued')
  }
  return composerPayload(res)
}

/**
 * Outbox items to show in the "Scheduled" view: scheduled sends still waiting,
 * plus undo-delayed sends that failed once and are retrying.
 * Staff see their own; mail managers see everything in scope.
 */
export async function listScheduled(session, accountIds) {
  if (!isStaff(session)) return []
  const allowed = (await accessibleAccountIds(session)).map(String)
  const requested = Array.isArray(accountIds) && accountIds.length ? accountIds.map(String) : allowed
  const scope = requested.filter(id => allowed.includes(id))
  if (!scope.length) return []

  const filter = {
    accountId: { $in: scope },
    status: { $in: ['QUEUED', 'SENDING'] },
    $or: [{ scheduled: true }, { lastError: { $ne: null } }],
  }
  if (!canManageMail(session)) filter.userId = session.user.id
  return MailOutbox.find(filter).sort({ sendAt: 1 }).limit(200).lean()
}

// ─── Drafts ──────────────────────────────────────────────────────────────────

// Draft saves of one user run one at a time: autosave and "save on close" can
// overlap, and each save replaces the previous copy (APPEND new, delete old).
const draftLocks = new Map()
// old draft id → newer draft id, so a save still holding a stale id deletes the right copy
const replacedDrafts = new Map()

async function withDraftLock(key, fn) {
  const prev = draftLocks.get(key) ?? Promise.resolve()
  const run = prev.catch(() => {}).then(fn)
  draftLocks.set(key, run)
  try {
    return await run
  } finally {
    if (draftLocks.get(key) === run) draftLocks.delete(key)
  }
}

function latestDraftId(id) {
  let cur = id
  for (let i = 0; i < 50 && replacedDrafts.has(cur); i++) cur = replacedDrafts.get(cur).id
  return cur
}

function rememberReplaced(oldId, newId) {
  const now = Date.now()
  replacedDrafts.set(String(oldId), { id: String(newId), at: now })
  if (replacedDrafts.size > 500) {
    for (const [k, v] of replacedDrafts) if (now - v.at > 30 * 60 * 1000) replacedDrafts.delete(k)
  }
}

async function upsertDraftRow({ account, folder, prepared, mime, raw, messageId, date, uid, uidValidity }) {
  const msgId = normalizeMsgId(messageId)
  const inReplyTo = prepared.thread?.inReplyTo ?? null
  const references = prepared.thread?.references ?? []
  const parts = mimeParts(mime.related.length, mime.attached.length)
  // Same order as the MIME tree (inline images live inside part 1/2, files follow)
  const attachments = [
    ...mime.related.map((a, i) => ({
      idx: i, part: parts.inline[i], filename: a.filename, contentType: a.contentType,
      size: a.content.length, cid: a.cid, inline: true,
    })),
    ...mime.attached.map((a, j) => ({
      idx: mime.related.length + j, part: parts.files[j], filename: a.filename, contentType: a.contentType,
      size: a.content.length, cid: null, inline: false,
    })),
  ]
  const from = fromHeader(account)
  const doc = {
    accountId: account._id,
    folderId: folder._id,
    folderPath: folder.path,
    folderRole: 'DRAFTS',
    uid,
    uidValidity,
    messageId: msgId,
    inReplyTo,
    references,
    threadKey: computeThreadKey({ messageId: msgId, inReplyTo, references }),
    subject: prepared.subject,
    snippet: snippetOf(prepared.text),
    from: typeof from === 'string' ? { name: '', address: from.toLowerCase() } : { name: from.name, address: from.address.toLowerCase() },
    to: lowerList(prepared.to),
    cc: lowerList(prepared.cc),
    bcc: lowerList(prepared.bcc),
    replyTo: [],
    date,
    receivedAt: date,
    seen: true,
    flagged: false,
    answered: false,
    draft: true,
    flags: ['\\Draft', '\\Seen'],
    size: raw.length,
    hasAttachments: mime.attached.length > 0,
    attachments,
    priority: 'normal',
    listUnsubscribe: null,
    bodyFetched: true,
    html: mime.html,
    text: mime.text,
  }
  const key = { folderId: folder._id, uidValidity, uid }
  try {
    return await MailMessage.findOneAndUpdate(key, { $set: doc }, { upsert: true, new: true, setDefaultsOnInsert: true })
      .select('_id').lean()
  } catch (err) {
    // A folder sync inserted the same uid between our find and insert: theirs is as good as ours
    if (err?.code !== 11000) throw err
    return MailMessage.findOne(key).select('_id').lean()
  }
}

/**
 * Save the compose state as a server draft (APPEND to Drafts with \Draft \Seen),
 * replacing `payload.draftId`. → { draftId } (null only if the server stored it
 * but the copy couldn't be found again).
 */
export async function saveDraft(session, payload) {
  const account = await loadSendAccount(session, payload?.accountId)
  const userId = String(session.user.id)

  return withDraftLock(`draft:${userId}`, async () => {
    const prevId = payload.draftId ? latestDraftId(String(payload.draftId)) : null
    const prepared = await preparePayload(session, { ...payload, draftId: prevId, sendAt: null, undoSeconds: 0 }, account)

    const date = new Date()
    const messageId = `${randomUUID()}@${domainOf(account.email)}`
    // Built (and old-draft attachments downloaded) before anything is deleted
    const mime = await composeMime(account, prepared, { userId, messageId, date })
    mime.node.keepBcc = true
    const raw = await mime.node.build()

    const folder = await ensureRoleFolder(account._id, 'DRAFTS')
    let stored
    try {
      stored = await withImap(account._id, async client => {
        const r = await client.append(folder.path, raw, ['\\Draft', '\\Seen'], date)
        if (!r) throw mailError(422, "The mail server didn't accept the draft")
        let uidValidity = r.uidValidity ?? null
        // Without UIDPLUS imapflow may still find the uid when Drafts is the selected mailbox
        if (r.uid && uidValidity == null && client.mailbox?.path === r.destination) uidValidity = client.mailbox.uidValidity
        return { uid: r.uid ?? null, uidValidity: uidValidity != null ? String(uidValidity) : null }
      })
    } catch (err) {
      throw mailError(422, `Couldn't save the draft: ${mailServerMessage(err)}`)
    }

    if (prepared.draftId) {
      try {
        await removeDraft(prepared.draftId)
      } catch (err) {
        console.error('[mail/send] replace draft', err?.message || err)
      }
    }

    let row = null
    if (stored.uid && stored.uidValidity) {
      row = await upsertDraftRow({ account, folder, prepared, mime, raw, messageId, date, ...stored })
    } else {
      await syncFolder(account._id, folder._id)
      row = await MailMessage.findOne({ folderId: folder._id, messageId: normalizeMsgId(messageId) }).select('_id').lean()
    }

    const draftId = row ? String(row._id) : null
    if (prevId && draftId) rememberReplaced(prevId, draftId)
    return { draftId }
  })
}

/** Discard a draft permanently (server + local) → { ok: true }. Already-gone drafts succeed. */
export async function deleteDraft(session, messageId) {
  if (!isStaff(session)) throw mailError(403, 'Forbidden')
  if (!isValidObjectId(messageId)) throw mailError(404, 'Draft not found')

  return withDraftLock(`draft:${session.user.id}`, async () => {
    const id = latestDraftId(String(messageId))
    const d = await MailMessage.findById(id).select('accountId folderPath folderRole uid uidValidity').lean()
    if (!d) return { ok: true }
    const account = await MailAccount.findById(d.accountId).select('isActive assignedUsers').lean()
    if (!canUseAccount(session, account)) throw mailError(404, 'Draft not found')
    if (d.folderRole !== 'DRAFTS') throw mailError(422, 'Only drafts can be discarded')

    try {
      await deleteRemoteMessages(d.accountId, d.folderPath, d.uidValidity, [d.uid])
    } catch (err) {
      throw mailError(422, `Couldn't discard the draft: ${mailServerMessage(err)}`)
    }
    await MailMessage.deleteOne({ _id: d._id })
    return { ok: true }
  })
}
