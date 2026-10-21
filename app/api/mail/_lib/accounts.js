// Mail account input validation + response loading (private folder — not a route).
import mongoose from 'mongoose'
import { MailAccount, MailMessage, User } from '@/models'
import { MAIL_PROVIDERS, MAIL_LIMITS, providerPreset } from '@/lib/mail/constants'
import { testImapConnection, testSmtpConnection, closeAccountClients } from '@/lib/mail/imap'
import { syncAccount } from '@/lib/mail/sync'
import { notifyAccountChanged } from '@/lib/mail/worker'
import { sanitizeEmailHtml } from '@/lib/mail/sanitize'
import { toAccountItem } from '@/lib/mail/serialize'
import { isValidObjectId } from './http'

const STAFF_ROLES = ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE']
const EMAIL_RE = /^[^\s@<>()",;:\\]+@[^\s@<>()",;:\\]+\.[^\s@<>()",;:\\]+$/
const HOSTNAME_RE = /^(?=.{1,253}$)[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?(\.[a-z0-9_]([a-z0-9_-]*[a-z0-9_])?)*$/i
const IP_RE = /^\[?[0-9a-f:.]+\]?$/i
const COLOR_RE = /^#[0-9a-f]{6}$/i

export function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

function str(v, max, label) {
  if (v === undefined || v === null) return ''
  if (typeof v !== 'string') throw httpError(422, `${label} must be text`)
  const s = v.trim()
  if (s.length > max) throw httpError(422, `${label} is too long`)
  return s
}

function bool(v, fallback) {
  if (typeof v === 'boolean') return v
  if (v === 'true' || v === 1 || v === '1') return true
  if (v === 'false' || v === 0 || v === '0') return false
  return fallback
}

export function normalizeEmail(v) {
  const email = str(v, 320, 'Email').toLowerCase()
  if (!email) throw httpError(422, 'Email is required')
  if (!EMAIL_RE.test(email)) throw httpError(422, 'Email address is invalid')
  return email
}

/** { host, port, secure } validated; `fallback` fills absent parts (preset or stored values). */
export function normalizeServer(input, fallback, label, tlsPort) {
  const src = input && typeof input === 'object' ? input : {}
  const host = String(src.host ?? fallback?.host ?? '').trim().toLowerCase()
  if (!host) throw httpError(422, `${label} host is required`)
  if (host.length > 253 || !(HOSTNAME_RE.test(host) || IP_RE.test(host))) throw httpError(422, `${label} host is invalid`)
  const port = Number(src.port ?? fallback?.port)
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw httpError(422, `${label} port must be between 1 and 65535`)
  const secure = bool(src.secure, fallback?.secure ?? port === tlsPort)
  return { host, port, secure }
}

function clampSyncLimit(v, fallback) {
  const n = Math.round(Number(v))
  if (!Number.isFinite(n)) return fallback
  return Math.min(5000, Math.max(50, n))
}

/** Active staff User ids (deduped, order kept). Accepts ids or { id } objects. */
export async function resolveAssignedUsers(list) {
  if (!Array.isArray(list)) throw httpError(422, 'Assigned users must be a list')
  const ids = [...new Set(list.map(v => String(v?.id ?? v?._id ?? v ?? '')))]
  if (ids.some(id => !isValidObjectId(id))) throw httpError(422, 'Invalid user in assigned users')
  if (!ids.length) return []
  if (ids.length > 500) throw httpError(422, 'Too many assigned users')
  const users = await User.find({ _id: { $in: ids }, role: { $in: STAFF_ROLES }, isActive: { $ne: false } }).select('_id').lean()
  if (users.length !== ids.length) throw httpError(422, 'Assigned users must be active staff members')
  return ids.map(id => new mongoose.Types.ObjectId(id))
}

/**
 * Validate a create (existing = null) or partial update body.
 * → { fields (Mongo-ready, no password), password (plaintext or ''), credentialsChanged }
 */
export async function buildAccountFields(body, existing = null) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw httpError(400, 'Invalid JSON body')
  const isCreate = !existing
  const has = k => body[k] !== undefined
  const fields = {}

  const email = isCreate || has('email') ? normalizeEmail(body.email) : existing.email
  if (isCreate || email !== existing.email) fields.email = email

  let provider = existing?.provider || 'custom'
  if (isCreate || has('provider')) {
    provider = MAIL_PROVIDERS[body.provider] ? body.provider : 'custom'
    fields.provider = provider
  }
  const preset = providerPreset(provider, email)

  if (isCreate || has('name')) fields.name = str(body.name, 100, 'Name') || email
  if (isCreate || has('fromName')) fields.fromName = str(body.fromName, 200, 'From name')

  if (isCreate || has('username')) {
    fields.username = str(body.username, 320, 'Username') || email
  } else if (fields.email && existing.username === existing.email) {
    // Username tracked the old address — keep it in step.
    fields.username = email
  }

  const password = has('password') && body.password !== null ? String(body.password) : ''
  if (password.length > 1024) throw httpError(422, 'Password is too long')
  if (isCreate && !password) throw httpError(422, 'Password is required')

  if (isCreate || has('imap')) fields.imap = normalizeServer(body.imap, isCreate ? preset.imap : { ...preset.imap, ...existing.imap }, 'IMAP', 993)
  if (isCreate || has('smtp')) fields.smtp = normalizeServer(body.smtp, isCreate ? preset.smtp : { ...preset.smtp, ...existing.smtp }, 'SMTP', 465)

  if (isCreate || has('signature')) {
    const raw = body.signature == null ? '' : String(body.signature)
    if (raw.length > 50000) throw httpError(422, 'Signature is too long')
    // Signatures are injected into other users' composers — never trust the HTML.
    fields.signature = raw.trim() ? sanitizeEmailHtml(raw, { allowRemote: true }).html : ''
  }

  if (isCreate || has('color')) {
    fields.color = typeof body.color === 'string' && COLOR_RE.test(body.color) ? body.color.toLowerCase() : (existing?.color || '#18181b')
  }

  if (isCreate || has('isActive')) fields.isActive = bool(body.isActive, existing?.isActive ?? true)
  if (isCreate || has('syncEnabled')) fields.syncEnabled = bool(body.syncEnabled, existing?.syncEnabled ?? true)

  if (isCreate || has('options')) {
    const o = body.options && typeof body.options === 'object' ? body.options : {}
    const prev = existing?.options || {}
    fields.options = {
      saveSentCopy: bool(o.saveSentCopy, prev.saveSentCopy ?? preset.saveSentCopy),
      realtime: bool(o.realtime, prev.realtime ?? true),
      initialSyncLimit: clampSyncLimit(o.initialSyncLimit, prev.initialSyncLimit ?? MAIL_LIMITS.defaultInitialSync),
    }
  }

  if (isCreate || has('assignedUsers')) fields.assignedUsers = await resolveAssignedUsers(body.assignedUsers ?? [])

  const sameServer = (a, b) => !!a && !!b && a.host === b.host && Number(a.port) === Number(b.port) && !!a.secure === !!b.secure
  const credentialsChanged = isCreate || !!password
    || (fields.email !== undefined && fields.email !== existing.email)
    || (fields.username !== undefined && fields.username !== existing.username)
    || (fields.imap !== undefined && !sameServer(fields.imap, existing.imap))
    || (fields.smtp !== undefined && !sameServer(fields.smtp, existing.smtp))

  return { fields, password, credentialsChanged }
}

function failed(error) {
  return { ok: false, error: error?.message || String(error || 'Connection failed') }
}

/** Run the IMAP and SMTP checks in parallel. Never throws. */
export async function testCredentials({ email, username, password, imap, smtp }) {
  const [imapRes, smtpRes] = await Promise.all([
    testImapConnection({ imap, username, password, email }).then(r => r || failed('No response'), failed),
    testSmtpConnection({ smtp, username, password, email }).then(r => r || failed('No response'), failed),
  ])
  return { imap: imapRes, smtp: smtpRes }
}

export function testFailureMessage(test) {
  const parts = []
  if (!test.imap?.ok) parts.push(`IMAP: ${test.imap?.error || 'connection failed'}`)
  if (!test.smtp?.ok) parts.push(`SMTP: ${test.smtp?.error || 'connection failed'}`)
  return parts.join(' · ') || 'Connection test failed'
}

/** Map(accountId → INBOX unseen count). */
export async function inboxUnread(accountIds) {
  if (!accountIds.length) return new Map()
  const rows = await MailMessage.aggregate([
    { $match: { accountId: { $in: accountIds }, folderRole: 'INBOX', seen: false } },
    { $group: { _id: '$accountId', n: { $sum: 1 } } },
  ])
  return new Map(rows.map(r => [String(r._id), r.n]))
}

/**
 * Post-save side effects. Never throws: a worker hiccup must not fail an
 * already-committed admin change. The sync is kicked here too because the
 * worker leader may live in another process.
 */
export function afterAccountChange(id, { closeClients = false, sync = false, reason = 'updated' } = {}) {
  const key = String(id)
  if (closeClients) {
    try { closeAccountClients(key) } catch (err) { console.error('[mail] closeAccountClients', err) }
  }
  try { notifyAccountChanged(key) } catch (err) { console.error('[mail] notifyAccountChanged', err) }
  if (sync) Promise.resolve().then(() => syncAccount(key, { reason })).catch(() => {})
}

/** accountItem(manage) for one account, or null. */
export async function loadManageItem(id) {
  const acc = await MailAccount.findById(id).populate({ path: 'assignedUsers', select: 'name email avatar role' }).lean()
  if (!acc) return null
  const unread = await inboxUnread([acc._id])
  return toAccountItem(acc, { unread: unread.get(String(acc._id)) || 0, manage: true })
}
