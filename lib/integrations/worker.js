// Server-only: background work of the Enfinito Pay and encloud integrations
// (started from instrumentation.js).
//
//   every minute — encloud: push recent changes, retry failures, re-check unpaid
//                  invoices (lock dates); Enfinito Pay: ask about checkouts with no
//                  answer yet, book paid payments not booked yet
//   every hour   — encloud: a full pass, catching anything a missed trigger left
//
// One process runs it: a Mongo lease (raw collection `integrations_worker_lease`),
// as the mail worker does. State lives on globalThis (dev reloads, separate bundles).
import os from 'os'
import crypto from 'crypto'
import mongoose from 'mongoose'
import connectDB from '@/lib/mongodb'
import { sweepEncloud } from '@/lib/encloud/sync'
import { reconcileOnlinePayments } from '@/lib/onlinePayments'

const LEASE_COLLECTION = 'integrations_worker_lease'
const LEASE_ID = 'integrations-worker'
const LEASE_TTL_MS = 3 * 60_000
const TICK_MS = 60_000
const FULL_MS = 60 * 60_000
const FIRST_TICK_MS = 20_000

const G = globalThis

function log(msg) {
  console.log(`[integrations-worker] ${msg}`)
}

function pidAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false
  try { process.kill(pid, 0); return true } catch (err) { return err?.code === 'EPERM' }
}

async function tryLease(owner) {
  const coll = mongoose.connection.db.collection(LEASE_COLLECTION)
  const now = new Date()
  const lease = { holder: owner, host: os.hostname(), pid: process.pid, renewedAt: now, expiresAt: new Date(now.getTime() + LEASE_TTL_MS) }
  try {
    await coll.findOneAndUpdate(
      { _id: LEASE_ID, $or: [{ holder: owner }, { expiresAt: { $lt: now } }] },
      { $set: lease },
      { upsert: true },
    )
    return true
  } catch (err) {
    // The upsert collides on _id while another process holds the lease.
    if (err?.code !== 11000) throw err
    // A restart on the same host leaves the exited process's lease behind:
    // take it over at once instead of pausing until it expires.
    const cur = await coll.findOne({ _id: LEASE_ID })
    if (!cur || cur.host !== os.hostname() || cur.pid === process.pid || pidAlive(cur.pid)) return false
    const res = await coll.updateOne({ _id: LEASE_ID, holder: cur.holder }, { $set: lease })
    return res.modifiedCount === 1 ? { takenFrom: cur.pid } : false
  }
}

/** One pass of everything; also used by POST /api/cron/integrations. */
export async function runIntegrationsPass({ full = false, since = null } = {}) {
  await connectDB()
  const out = {}
  try { out.encloud = await sweepEncloud(full ? { full: true } : { since }) } catch (err) { out.encloudError = err?.message || String(err) }
  try { out.payments = await reconcileOnlinePayments() } catch (err) { out.paymentsError = err?.message || String(err) }
  return out
}

export function startIntegrationsWorker() {
  if (G.__integrationsWorker) return
  const st = G.__integrationsWorker = {
    owner:      `${os.hostname()}:${process.pid}:${crypto.randomBytes(4).toString('hex')}`,
    leader:     false,
    busy:       false,
    since:      null,
    lastFullAt: 0,
    lastError:  null,
  }

  const tick = async () => {
    if (st.busy) return
    st.busy = true
    try {
      await connectDB()
      const got = await tryLease(st.owner)
      const leader = !!got
      if (leader !== st.leader) {
        log(!leader ? 'lease held by another process' : got.takenFrom ? `took over the lease from exited pid ${got.takenFrom}` : 'took the lease')
      }
      st.leader = leader
      if (!leader) return
      const started = Date.now()
      const full = started - st.lastFullAt > FULL_MS
      const r = await runIntegrationsPass({ full, since: st.since })
      if (full) st.lastFullAt = started
      // Overlap a little, so a change saved during the pass is seen next time.
      st.since = new Date(started - 2 * 60_000)
      const msg = r.encloudError || r.paymentsError
      if (msg && msg !== st.lastError) log(msg)
      st.lastError = msg ?? null
    } catch (err) {
      const msg = err?.message || String(err)
      if (msg !== st.lastError) log(`pass failed: ${msg}`)
      st.lastError = msg
    } finally {
      st.busy = false
    }
  }

  setTimeout(tick, FIRST_TICK_MS).unref?.()
  setInterval(tick, TICK_MS).unref?.()
}
