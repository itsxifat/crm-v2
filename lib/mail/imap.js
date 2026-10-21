// Server-only: pooled IMAP connections + connection tests.
//
// One pooled client per (account, channel). The 'sync' channel carries background
// folder syncs; the default 'ui' channel serves interactive requests (open message,
// attachments, actions) so a long sync never blocks a user click. The IDLE watcher
// in worker.js uses its own dedicated connection. State lives on globalThis so the
// worker (instrumentation bundle) and API routes share one pool per process.
import { AsyncLocalStorage } from 'async_hooks'
import { ImapFlow } from 'imapflow'
import connectDB from '@/lib/mongodb'
import { loadAccountWithSecret, imapConfig, smtpTransport } from './credentials'

const POOL_IDLE_MS = 2 * 60 * 1000
const FAILED_CONNECT_COOLDOWN_MS = 15000 // don't hammer a server (or trip lockouts) after a failed login
const CONNECT_ERROR_CODES = new Set([
  'NoConnection', 'EConnectionClosed', 'ETIMEOUT', 'CONNECT_TIMEOUT', 'GREETING_TIMEOUT', 'UPGRADE_TIMEOUT',
  'ECONNREFUSED', 'ECONNRESET', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT', 'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE',
  'ETHROTTLE', 'ClosedAfterConnectText', 'ClosedAfterConnectTLS', 'StateLogout',
])
const CERT_CODES = new Set([
  'CERT_HAS_EXPIRED', 'DEPTH_ZERO_SELF_SIGNED_CERT', 'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE',
  'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_TLS_CERT_ALTNAME_INVALID', 'CERT_NOT_YET_VALID',
])

const pool = globalThis.__crmMailImapPool ?? (globalThis.__crmMailImapPool = new Map())
const als = globalThis.__crmMailImapScope ?? (globalThis.__crmMailImapScope = new AsyncLocalStorage())
const connectFailures = globalThis.__crmMailImapFailures ?? (globalThis.__crmMailImapFailures = new Map())

/** Error carrying an HTTP-ish status for API routes. */
export function mailError(message, status = 502, extra = {}) {
  return Object.assign(new Error(message), { status, ...extra })
}

/** True for errors that mean the whole connection is unusable (vs. one failed command). */
export function isConnectionError(err) {
  if (!err) return false
  return !!(err.mailConnect || err.authenticationFailed || err.tlsFailed || CONNECT_ERROR_CODES.has(err.code) || CERT_CODES.has(err.code))
}

/** Human message for an IMAP/SMTP/network error. Never includes credentials. */
export function friendlyMailError(err, { host } = {}) {
  if (!err) return 'Unknown error'
  if (err.friendly) return err.friendly
  const code = String(err.code || '')
  const text = [err.responseText, err.response, err.message].find(v => typeof v === 'string' && v.trim()) || ''
  const where = host ? ` (${host})` : ''

  if (err.authenticationFailed || err.serverResponseCode === 'AUTHENTICATIONFAILED' || code === 'EAUTH' || err.responseCode === 535 ||
      /authenticationfailed|authentication failed|invalid credentials|login failed|invalid login|username and password|password incorrect/i.test(text)) {
    if (/application-specific|app password|apppassword/i.test(text)) return 'Authentication failed — this account requires an app password'
    if (/web ?login required|enable imap|imap.*disabled|IMAP access/i.test(text)) return 'Authentication failed — IMAP access is disabled for this mailbox'
    return 'Authentication failed — check username/password'
  }
  if (code === 'ENOTFOUND' || code === 'EAI_AGAIN' || code === 'EDNS') return `Server not found${where} — check the host name`
  if (code === 'ECONNREFUSED') return `Connection refused${where} — check host and port`
  if (CERT_CODES.has(code)) return 'Server certificate is invalid or does not match the host name'
  if (err.tlsFailed || /wrong version number|ssl3_get_record|tls|ssl|handshake/i.test(text) || code === 'EPROTO' || code.startsWith('ERR_SSL')) {
    return 'TLS handshake failed — check the security setting (SSL/TLS vs STARTTLS) and port'
  }
  if (['CONNECT_TIMEOUT', 'GREETING_TIMEOUT', 'UPGRADE_TIMEOUT', 'ETIMEDOUT', 'ETIMEOUT'].includes(code) || /timed? ?out/i.test(text)) {
    return `Connection timed out${where} — check host, port and firewall`
  }
  if (code === 'EHOSTUNREACH' || code === 'ENETUNREACH') return `Server unreachable${where}`
  if (code === 'ECONNRESET' || code === 'EPIPE') return 'Connection reset by the server'
  if (code === 'ETHROTTLE') return 'Server is throttling requests — try again later'
  if (code === 'NoConnection' || code === 'EConnectionClosed' || code === 'ClosedAfterConnectText' || code === 'ClosedAfterConnectTLS') {
    return 'Connection closed by the server'
  }
  if (code === 'ESOCKET' || code === 'ECONNECTION') return `Could not connect${where}${text ? ` — ${text.slice(0, 160)}` : ''}`
  return (text || 'Mail server error').replace(/\s+/g, ' ').slice(0, 300)
}

function attachErrorLogging(client, label) {
  // An unhandled 'error' event would crash the process.
  client.on('error', err => {
    if (!client.__crmQuiet) console.warn(`[mail-imap] ${label}: ${friendlyMailError(err)}`)
  })
}

function closeClient(client) {
  if (!client || client.__crmClosing) return
  client.__crmClosing = true
  client.__crmQuiet = true
  const hard = setTimeout(() => { try { client.close() } catch { /* already closed */ } }, 5000)
  hard.unref?.()
  Promise.resolve()
    .then(() => (client.usable ? client.logout() : client.close()))
    .catch(() => { try { client.close() } catch { /* already closed */ } })
    .finally(() => clearTimeout(hard))
}

async function openClient(accountId) {
  await connectDB()
  const account = await loadAccountWithSecret(accountId)
  if (!account) throw mailError('Mailbox not found', 404)
  const client = new ImapFlow(imapConfig(account, { disableAutoIdle: true }))
  attachErrorLogging(client, account.email)
  try {
    await client.connect()
  } catch (err) {
    client.__crmQuiet = true
    try { client.close() } catch { /* not connected */ }
    throw Object.assign(err, { mailConnect: true, friendly: friendlyMailError(err, { host: account.imap?.host }) })
  }
  return client
}

async function acquire(key, accountId) {
  let entry = pool.get(key)
  if (entry?.client && (!entry.client.usable || entry.client.__crmClosing)) {
    closeClient(entry.client)
    pool.delete(key)
    entry = null
  }
  if (!entry) {
    entry = { client: null, connecting: null, users: 0, timer: null }
    pool.set(key, entry)
  }
  entry.users++
  clearTimeout(entry.timer)
  entry.timer = null
  try {
    if (!entry.client) {
      if (!entry.connecting) {
        const failed = connectFailures.get(String(accountId))
        if (failed && Date.now() - failed.at < FAILED_CONNECT_COOLDOWN_MS) throw failed.err
        entry.connecting = openClient(accountId)
          .then(client => {
            if (pool.get(key) !== entry) { closeClient(client); throw mailError('Mailbox connection was reset', 503) }
            entry.client = client
            connectFailures.delete(String(accountId))
            client.on('close', () => { if (pool.get(key) === entry && entry.client === client) entry.client = null })
            return client
          }, err => {
            if (err?.mailConnect) connectFailures.set(String(accountId), { at: Date.now(), err })
            throw err
          })
          .finally(() => { entry.connecting = null })
      }
      await entry.connecting
    }
    if (!entry.client) throw mailError('Connection closed by the server', 502, { mailConnect: true })
    return entry
  } catch (err) {
    release(key, entry)
    throw err
  }
}

function release(key, entry) {
  entry.users = Math.max(0, entry.users - 1)
  if (entry.users > 0) return
  clearTimeout(entry.timer)
  entry.timer = setTimeout(() => {
    if (entry.users > 0) return
    if (pool.get(key) === entry) pool.delete(key)
    closeClient(entry.client)
  }, POOL_IDLE_MS)
  entry.timer.unref?.()
}

/**
 * Run fn(client) on a pooled, connected ImapFlow client for the account.
 * Use client.getMailboxLock (or withMailbox) inside for folder operations, and
 * never nest withImap/withMailbox calls on the same channel (mailbox locks queue).
 * opts.channel: 'ui' (default) | 'sync'.
 */
export async function withImap(accountId, fn, { channel = 'ui' } = {}) {
  // A nested call on a channel this async context already holds would queue behind its
  // own mailbox lock forever — give it a separate connection instead.
  const active = als.getStore()
  let key = `${accountId}:${channel}`
  while (active?.has(key)) key += '+'
  const scope = new Set(active || [])
  scope.add(key)

  return als.run(scope, async () => {
    const entry = await acquire(key, accountId)
    try {
      return await fn(entry.client)
    } catch (err) {
      if (isConnectionError(err) && entry.client && !entry.client.usable) {
        if (pool.get(key) === entry) pool.delete(key)
        closeClient(entry.client)
      }
      throw err
    } finally {
      release(key, entry)
    }
  })
}

/** Lock `path` on the pooled client, run fn(client, lock), always release the lock. */
export async function withMailbox(accountId, path, fn, opts = {}) {
  return withImap(accountId, async client => {
    const lock = await client.getMailboxLock(path)
    try {
      return await fn(client, lock)
    } finally {
      lock.release()
    }
  }, opts)
}

/** Drop pooled clients of an account (after credential change / delete). */
export function closeAccountClients(accountId) {
  connectFailures.delete(String(accountId))
  const prefix = `${accountId}:`
  for (const [key, entry] of pool) {
    if (!key.startsWith(prefix)) continue
    pool.delete(key)
    clearTimeout(entry.timer)
    if (entry.client) closeClient(entry.client)
  }
}

/** Try IMAP login + LIST with unsaved credentials → { ok: true, folders } | { ok: false, error }. */
export async function testImapConnection({ imap, username, password, email } = {}) {
  if (!imap?.host) return { ok: false, error: 'IMAP host is required' }
  if (!password) return { ok: false, error: 'Password is required' }
  let client
  try {
    client = new ImapFlow(imapConfig({ imap, username, email, secret: password }, { disableAutoIdle: true, socketTimeout: 30000 }))
    client.__crmQuiet = true
    client.on('error', () => {})
    await client.connect()
    const folders = await client.list()
    return { ok: true, folders: folders.filter(f => !f.flags?.has('\\NonExistent')).length }
  } catch (err) {
    return { ok: false, error: friendlyMailError(err, { host: imap.host }) }
  } finally {
    if (client) closeClient(client)
  }
}

/** Verify SMTP login with unsaved credentials → { ok: true } | { ok: false, error }. */
export async function testSmtpConnection({ smtp, username, password, email } = {}) {
  if (!smtp?.host) return { ok: false, error: 'SMTP host is required' }
  if (!password) return { ok: false, error: 'Password is required' }
  let transport
  try {
    transport = smtpTransport({ smtp, username, email, secret: password }, { socketTimeout: 30000 })
    await transport.verify()
    return { ok: true }
  } catch (err) {
    return { ok: false, error: friendlyMailError(err, { host: smtp.host }) }
  } finally {
    try { transport?.close() } catch { /* ignore */ }
  }
}
