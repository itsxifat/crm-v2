// Server-only: background mail worker (started from instrumentation.js).
//
//   - Leader election through a Mongo lease (raw collection `mail_worker_lease`), so
//     only one process runs it (PM2 cluster, dev reloads, several hosts).
//   - Leader keeps one IDLE connection per realtime account on INBOX → new mail is
//     indexed within a second; periodic full syncs cover other folders + flag changes.
//   - Outbox dispatcher every 5s, upload cleanup hourly.
//
// State lives on globalThis: the worker (instrumentation bundle) and API routes
// (which call notifyAccountChanged) are separate module instances in one process.
import os from 'os'
import crypto from 'crypto'
import mongoose from 'mongoose'
import { ImapFlow } from 'imapflow'
import connectDB from '@/lib/mongodb'
import { MailAccount, MailFolder } from '@/models'
import { loadAccountWithSecret, imapConfig } from './credentials'
import { friendlyMailError, closeAccountClients } from './imap'
import { syncAccount, syncFolder } from './sync'

const LEASE_COLLECTION = 'mail_worker_lease'
const LEASE_ID = 'mail-worker'
const LEASE_TTL_MS = 30_000
const LEASE_RENEW_MS = 10_000
const SCHEDULER_MS = 5_000
const OUTBOX_MS = 5_000
const REFRESH_MS = 60_000
const CLEANUP_MS = 60 * 60_000
const MAX_CONCURRENT_SYNCS = 3
const IDLE_DEBOUNCE_MS = 150
const BACKOFF_MIN_MS = 5_000
const BACKOFF_MAX_MS = 5 * 60_000
const AUTH_BACKOFF_MS = 60_000
const STABLE_CONNECTION_MS = 60_000
const ERROR_LOG_REPEAT_MS = 30 * 60_000

const G = globalThis

function intervalMs() {
  const sec = parseInt(process.env.MAIL_SYNC_INTERVAL_SEC, 10)
  return (Number.isFinite(sec) ? Math.min(3600, Math.max(30, sec)) : 120) * 1000
}

function log(msg) {
  console.log(`[mail-worker] ${msg}`)
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (err) { return err?.code === 'EPERM' }
}

// Timer jobs run every few seconds; repeat the same failure at most every 30 min.
const lastFailure = new Map()
function logFailure(label, err) {
  const msg = `${label}: ${err?.message || err}`
  const prev = lastFailure.get(label)
  if (prev && prev.msg === msg && Date.now() - prev.at < ERROR_LOG_REPEAT_MS) return
  lastFailure.set(label, { msg, at: Date.now() })
  log(msg)
}

/** Run an async job from a timer/event without ever letting it throw. */
function safe(label, fn) {
  return (...args) => {
    try {
      Promise.resolve(fn(...args)).catch(err => logFailure(label, err))
    } catch (err) {
      logFailure(label, err)
    }
  }
}

function setIdleFlag(accountId, idle) {
  return MailAccount.updateOne(
    { _id: accountId },
    { $set: { 'sync.idle': idle, 'sync.idleSince': idle ? new Date() : null } },
    { timestamps: false },
  ).catch(() => {})
}

function fingerprint(acc) {
  return crypto.createHash('sha256')
    .update(JSON.stringify([acc.imap?.host, acc.imap?.port, acc.imap?.secure, acc.username, acc.email, acc.password]))
    .digest('hex')
}

// ─── IDLE watcher (one dedicated connection per account) ─────────────────────

function createWatcher(st, accountId, fp) {
  const w = {
    accountId,
    fp,
    email: null,
    client: null,
    stopped: false,
    unsupported: false,   // server has no IDLE: don't keep retrying
    connecting: false,
    idle: false,
    error: null,
    lastEventAt: null,
    connectedAt: 0,
    backoff: BACKOFF_MIN_MS,
    retryTimer: null,
    debounceTimer: null,
    inboxRef: 'INBOX',
    lastLogged: null,
    lastLoggedAt: 0,
  }

  const logError = msg => {
    if (msg === w.lastLogged && Date.now() - w.lastLoggedAt < ERROR_LOG_REPEAT_MS) return
    w.lastLogged = msg
    w.lastLoggedAt = Date.now()
    log(`${w.email || accountId}: ${msg}`)
  }

  const runInboxSync = safe('idle sync', async () => {
    if (w.stopped || !st.leader) return
    const r = await syncFolder(accountId, w.inboxRef)
    await MailAccount.updateOne(
      { _id: accountId },
      { $set: { 'sync.lastSyncAt': new Date(), 'sync.lastSuccessAt': new Date() }, ...(r.newMessages && { $inc: { 'sync.messageCount': r.newMessages } }) },
      { timestamps: false },
    )
  })

  const schedule = () => {
    w.lastEventAt = new Date()
    clearTimeout(w.debounceTimer)
    // Servers send bursts (EXISTS + FETCH + EXPUNGE); one sync per burst.
    w.debounceTimer = setTimeout(runInboxSync, IDLE_DEBOUNCE_MS)
    w.debounceTimer.unref?.()
  }

  const scheduleReconnect = () => {
    if (w.stopped || !st.leader) return
    clearTimeout(w.retryTimer)
    const delay = w.backoff
    w.backoff = Math.min(w.backoff * 2, BACKOFF_MAX_MS)
    w.retryTimer = setTimeout(safe('idle reconnect', connect), delay)
    w.retryTimer.unref?.()
    return delay
  }

  const onClose = client => {
    if (w.client !== client) return
    w.client = null
    w.idle = false
    setIdleFlag(accountId, false)
    if (w.stopped) return
    if (Date.now() - w.connectedAt > STABLE_CONNECTION_MS) w.backoff = BACKOFF_MIN_MS
    const delay = scheduleReconnect()
    logError(`IDLE connection closed${w.error ? ` (${w.error})` : ''} — reconnecting in ${Math.round(delay / 1000)}s`)
  }

  async function connect() {
    if (w.stopped || w.connecting || w.client || !st.leader) return
    w.connecting = true
    let client = null
    try {
      await connectDB()
      const account = await loadAccountWithSecret(accountId)
      if (!account || !account.isActive || !account.syncEnabled || account.options?.realtime === false) {
        w.stopped = true
        return
      }
      w.email = account.email
      const inbox = await MailFolder.findOne({ accountId: account._id, role: 'INBOX' }).select('_id path').lean()
      w.inboxRef = inbox?._id || 'INBOX'

      client = new ImapFlow(imapConfig(account, {
        autoIdleDelay: 1000,          // enter IDLE right after SELECT
        maxIdleTime: 4 * 60_000,      // re-issue IDLE regularly (NATs, server timeouts)
      }))
      client.on('error', err => { w.error = friendlyMailError(err) })
      client.on('close', () => onClose(client))
      client.on('exists', ev => { if (ev.count > ev.prevCount) schedule() })
      client.on('expunge', schedule)
      client.on('flags', schedule)

      await client.connect()
      if (w.stopped || !st.leader) {
        client.logout().catch(() => {})
        return
      }
      if (!client.capabilities.has('IDLE')) {
        // Without IDLE ImapFlow would only poll; the periodic sync already covers that.
        w.error = 'Server does not support IDLE — using periodic sync'
        w.stopped = true
        w.unsupported = true
        logError(w.error)
        client.logout().catch(() => {})
        return
      }
      await client.mailboxOpen(inbox?.path || 'INBOX')
      w.client = client
      w.idle = true
      w.error = null
      w.connectedAt = Date.now()
      w.lastLogged = null
      await setIdleFlag(accountId, true)
      log(`live: ${account.email}`)
      // Catch up on anything that arrived while we were disconnected.
      schedule()
    } catch (err) {
      const msg = friendlyMailError(err)
      w.error = msg
      if (client) {
        try { client.close() } catch { /* not connected */ }
      }
      if (err?.authenticationFailed || /authentication failed/i.test(msg)) w.backoff = Math.max(w.backoff, AUTH_BACKOFF_MS)
      const delay = scheduleReconnect()
      if (delay) logError(`${msg} — retry in ${Math.round(delay / 1000)}s`)
    } finally {
      w.connecting = false
    }
  }

  w.start = () => safe('idle connect', connect)()

  w.stop = () => {
    w.stopped = true
    clearTimeout(w.retryTimer)
    clearTimeout(w.debounceTimer)
    const client = w.client
    w.client = null
    if (w.idle) setIdleFlag(accountId, false)
    w.idle = false
    if (client) {
      client.logout().catch(() => { try { client.close() } catch { /* closed */ } })
    }
  }

  return w
}

// ─── Worker state ────────────────────────────────────────────────────────────

function createWorker() {
  const st = {
    running: true,
    leader: false,
    startedAt: new Date(),
    instanceId: `${os.hostname()}:${process.pid}:${crypto.randomBytes(4).toString('hex')}`,
    lastLeaseOkAt: 0,
    leaseBusy: false,
    refreshBusy: false,
    outboxBusy: false,
    cleanupBusy: false,
    timers: [],
    leaderTimers: [],
    accounts: new Map(),   // id → { id, email, nextSyncAt, queued, syncing, again, lastResult }
    watchers: new Map(),   // id → watcher
    queue: [],
    activeSyncs: 0,
  }

  const every = (list, ms, label, fn) => {
    const t = setInterval(safe(label, fn), ms)
    t.unref?.()
    list.push(t)
  }

  // ── Leader election ──
  async function tryLease() {
    const coll = mongoose.connection.db.collection(LEASE_COLLECTION)
    const now = new Date()
    try {
      await coll.findOneAndUpdate(
        { _id: LEASE_ID, $or: [{ holder: st.instanceId }, { expiresAt: { $lt: now } }] },
        { $set: { holder: st.instanceId, host: os.hostname(), pid: process.pid, renewedAt: now, expiresAt: new Date(now.getTime() + LEASE_TTL_MS) } },
        { upsert: true },
      )
      return true
    } catch (err) {
      // The upsert collides on _id when another process holds the lease.
      if (err?.code !== 11000) throw err
      // A restart on the same host leaves the dead process's lease behind; take
      // it over at once instead of pausing sync until the TTL runs out.
      const cur = await coll.findOne({ _id: LEASE_ID })
      if (!cur || cur.host !== os.hostname() || cur.pid === process.pid || pidAlive(cur.pid)) return false
      const res = await coll.updateOne(
        { _id: LEASE_ID, holder: cur.holder },
        { $set: { holder: st.instanceId, host: os.hostname(), pid: process.pid, renewedAt: now, expiresAt: new Date(now.getTime() + LEASE_TTL_MS) } },
      )
      if (res.modifiedCount) log(`took over the lease from exited pid ${cur.pid}`)
      return res.modifiedCount === 1
    }
  }

  async function leaseTick() {
    if (st.leaseBusy || !st.running) return
    st.leaseBusy = true
    try {
      await connectDB()
      const got = await tryLease()
      st.lastLeaseOkAt = Date.now()
      if (got && !st.leader) becomeLeader()
      else if (!got && st.leader) stepDown('lease taken by another process')
    } catch (err) {
      if (st.leader && Date.now() - st.lastLeaseOkAt > LEASE_TTL_MS) stepDown(`lease renew failed: ${err?.message || err}`)
      else if (!st.leader) log(`lease check failed: ${err?.message || err}`)
    } finally {
      st.leaseBusy = false
    }
  }

  async function resetStaleFlags() {
    // Left behind by a crashed/restarted leader.
    const stale = new Date(Date.now() - 10 * 60_000)
    await MailAccount.updateMany({ 'sync.idle': true }, { $set: { 'sync.idle': false, 'sync.idleSince': null } }, { timestamps: false })
    await MailAccount.updateMany({ 'sync.status': 'SYNCING', 'sync.lastSyncAt': { $lt: stale }, 'sync.lastSuccessAt': { $ne: null } }, { $set: { 'sync.status': 'OK' } }, { timestamps: false })
    await MailAccount.updateMany({ 'sync.status': 'SYNCING', 'sync.lastSyncAt': { $lt: stale } }, { $set: { 'sync.status': 'PENDING' } }, { timestamps: false })
  }

  function becomeLeader() {
    st.leader = true
    log(`leader (${st.instanceId}), full sync every ${intervalMs() / 1000}s`)
    safe('leader start', async () => {
      await resetStaleFlags()
      await refreshAccounts()
    })()
    every(st.leaderTimers, REFRESH_MS, 'refresh accounts', refreshAccounts)
    every(st.leaderTimers, SCHEDULER_MS, 'scheduler', schedulerTick)
    every(st.leaderTimers, OUTBOX_MS, 'outbox', runOutbox)
    every(st.leaderTimers, CLEANUP_MS, 'upload cleanup', runCleanup)
    const first = setTimeout(safe('upload cleanup', runCleanup), 2 * 60_000)
    first.unref?.()
    st.leaderTimers.push(first)
  }

  function stepDown(reason) {
    if (!st.leader) return
    st.leader = false
    log(`stepped down: ${reason}`)
    for (const t of st.leaderTimers) { clearInterval(t); clearTimeout(t) }
    st.leaderTimers = []
    for (const w of st.watchers.values()) w.stop()
    st.watchers.clear()
    st.accounts.clear()
    st.queue = []
  }

  // ── Accounts / watchers ──
  function applyAccount(acc, { stagger = 0, forceRestart = false } = {}) {
    const id = String(acc._id)
    const shouldSync = acc.isActive && acc.syncEnabled
    const shouldWatch = shouldSync && acc.options?.realtime !== false
    const fp = fingerprint(acc)

    if (!shouldSync) {
      st.accounts.delete(id)
      if (acc.isActive && !acc.syncEnabled && acc.sync?.status !== 'PAUSED') {
        MailAccount.updateOne({ _id: acc._id }, { $set: { 'sync.status': 'PAUSED' } }, { timestamps: false }).catch(() => {})
      }
    } else if (!st.accounts.has(id)) {
      st.accounts.set(id, { id, email: acc.email, nextSyncAt: Date.now() + stagger, queued: false, syncing: false, again: false, failures: 0, lastResult: null })
    } else {
      st.accounts.get(id).email = acc.email
    }

    const w = st.watchers.get(id)
    if (!shouldWatch) {
      if (w) { w.stop(); st.watchers.delete(id) }
      return
    }
    // Restart when credentials/server changed, the watcher stopped, or a restart was asked for while it's down.
    if (w && w.fp === fp && (w.unsupported || (!w.stopped && !(forceRestart && !w.idle)))) return
    if (w) w.stop()
    const next = createWatcher(st, id, fp)
    st.watchers.set(id, next)
    next.start()
  }

  async function refreshAccounts() {
    if (!st.leader || st.refreshBusy) return
    st.refreshBusy = true
    try {
      await connectDB()
      const rows = await MailAccount.find({}).select('+password').lean()
      const ids = new Set(rows.map(r => String(r._id)))
      let k = 0
      for (const acc of rows) {
        const isNew = !st.accounts.has(String(acc._id))
        applyAccount(acc, { stagger: isNew ? Math.min(intervalMs(), 3000 + 4000 * k++) : 0 })
      }
      for (const id of [...st.accounts.keys()]) if (!ids.has(id)) st.accounts.delete(id)
      for (const [id, w] of [...st.watchers]) {
        if (!ids.has(id)) { w.stop(); st.watchers.delete(id) }
      }
    } finally {
      st.refreshBusy = false
    }
  }

  // ── Periodic syncs (bounded concurrency) ──
  function enqueue(id, reason, { front = false } = {}) {
    const a = st.accounts.get(id)
    if (!a) return
    if (a.syncing) { a.again = true; return }
    if (a.queued) {
      if (front) { st.queue = st.queue.filter(q => q.id !== id); st.queue.unshift({ id, reason }) }
      return
    }
    a.queued = true
    if (front) st.queue.unshift({ id, reason })
    else st.queue.push({ id, reason })
    pump()
  }

  function pump() {
    while (st.leader && st.activeSyncs < MAX_CONCURRENT_SYNCS && st.queue.length) {
      const { id, reason } = st.queue.shift()
      const a = st.accounts.get(id)
      if (!a) continue
      a.queued = false
      a.syncing = true
      st.activeSyncs++
      syncAccount(id, { reason })
        .then(r => {
          a.lastResult = r
          a.failures = r?.error ? a.failures + 1 : 0
          if (r?.error && r.error !== a.lastLoggedError) log(`sync ${a.email}: ${r.error}`)
          a.lastLoggedError = r?.error || null
        })
        .catch(err => {
          a.failures++
          logFailure(`sync ${a.email}`, err)
        })
        .finally(() => {
          a.syncing = false
          st.activeSyncs--
          // Back off on failing accounts (bad password → avoid server lockouts), max 30 min.
          const backoff = Math.min(2 ** Math.max(0, a.failures - 1), 15)
          a.nextSyncAt = Date.now() + Math.min(intervalMs() * backoff, 30 * 60_000) * (1 + Math.random() * 0.1)
          if (a.again && st.accounts.get(id) === a) {
            a.again = false
            enqueue(id, 'changed', { front: true })
          }
          pump()
        })
    }
  }

  function schedulerTick() {
    if (!st.leader) return
    const now = Date.now()
    for (const a of st.accounts.values()) {
      if (!a.queued && !a.syncing && a.nextSyncAt <= now) enqueue(a.id, 'periodic')
    }
    pump()
  }

  // ── Outbox + cleanup (other agents' modules, imported lazily so a failure there can't stop syncing) ──
  async function runOutbox() {
    if (!st.leader || st.outboxBusy) return
    st.outboxBusy = true
    try {
      await connectDB()
      const { processDueOutbox } = await import('./send')
      await processDueOutbox()
    } finally {
      st.outboxBusy = false
    }
  }

  async function runCleanup() {
    if (!st.leader || st.cleanupBusy) return
    st.cleanupBusy = true
    try {
      const { cleanupOldUploads } = await import('./uploads')
      await cleanupOldUploads()
    } finally {
      st.cleanupBusy = false
    }
  }

  // ── Public hooks ──
  st.notify = async accountId => {
    const id = String(accountId)
    if (!st.leader) return // the leader's refresh loop picks the change up within a minute
    await connectDB()
    const acc = await MailAccount.findById(id).select('+password').lean()
    if (!acc) {
      st.accounts.delete(id)
      const w = st.watchers.get(id)
      if (w) { w.stop(); st.watchers.delete(id) }
      closeAccountClients(id)
      return
    }
    applyAccount(acc, { stagger: 0, forceRestart: true })
    if (st.accounts.has(id)) enqueue(id, 'changed', { front: true })
  }

  st.status = () => {
    const accounts = {}
    for (const [id, w] of st.watchers) accounts[id] = { idle: w.idle, lastEventAt: w.lastEventAt, error: w.error }
    for (const [id, a] of st.accounts) {
      accounts[id] = { idle: false, lastEventAt: null, error: null, ...accounts[id], syncing: a.syncing, nextSyncAt: new Date(a.nextSyncAt) }
    }
    return { running: st.running, leader: st.leader, startedAt: st.startedAt, accounts }
  }

  st.start = () => {
    every(st.timers, LEASE_RENEW_MS, 'lease', leaseTick)
    safe('lease', leaseTick)()
  }

  return st
}

/** Start the background worker (idempotent; no-op when MAIL_SYNC_WORKER=off or during `next build`). */
export function startMailWorker() {
  if (process.env.MAIL_SYNC_WORKER === 'off') return
  if (process.env.NEXT_PHASE === 'phase-production-build') return
  if (G.__crmMailWorker) return
  const st = createWorker()
  G.__crmMailWorker = st
  log(`started (pid ${process.pid})`)
  st.start()
}

/** Restart an account's IDLE watcher and kick a sync (after create/update/delete/assign). */
export function notifyAccountChanged(accountId) {
  if (!accountId) return
  // Fallback start for runtimes where instrumentation didn't run (e.g. some dev setups).
  if (!G.__crmMailWorker) startMailWorker()
  const st = G.__crmMailWorker
  if (st?.notify) safe('notify', st.notify)(accountId)
}

/** { running, leader, startedAt, accounts: { [id]: { idle, lastEventAt, error, syncing?, nextSyncAt? } } } */
export function getWorkerStatus() {
  const st = G.__crmMailWorker
  if (!st?.status) return { running: false, leader: false, startedAt: null, accounts: {} }
  return st.status()
}
