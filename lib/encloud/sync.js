/**
 * lib/encloud/sync.js — SERVER-ONLY. Keeps encloud (Enfinito's client-file
 * drive) in step with the CRM:
 *
 *   client  → its folder, Clients/<name>                          PUT /clients/{id}
 *   project → a folder inside the client's                        PUT /projects/{id}
 *   invoice → while unpaid, a "due" that locks the client's files  PUT /dues/{id}
 *             until it is paid: the project's folder, or every folder of the
 *             client when the invoice has no project
 *
 * The CRM owns the money, so the due follows the invoice:
 *   issued with a balance (BDT)  → open, amount = what is still due
 *   paid                         → paid (mark-paid, paid_via "crm")
 *   draft / cancelled / unlocked → cancelled
 * Only a change on the CRM side is pushed (wanted ≠ last pushed), so a due that
 * was waived or reopened in encloud stays that way until the invoice changes here
 * (or staff press "Sync now", which makes encloud match the CRM again).
 *
 * Failures are kept on the EncloudLink with a growing retry delay; the worker
 * (lib/integrations/worker.js) retries them and sweeps recent changes.
 */
import crypto from 'node:crypto'
import connectDB from '@/lib/mongodb'
import { Client, Project, Invoice, User, EncloudLink } from '@/models'
import { encloud } from '@/lib/encloud/client'
import { getEncloudSettings, encloudReady } from '@/lib/integrations/settings'
import { invoiceOutstanding, round2, PAYABLE_INVOICE_STATUSES } from '@/lib/paymentLedger'
import { dhakaDayKey } from '@/lib/dhakaTime'

/** paid_via the CRM sends with mark-paid; encloud echoes it back on due.paid. */
export const CRM_PAID_VIA = 'crm'

const RETRY_MINUTES = [1, 5, 15, 60, 180, 720]
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const hashOf = (v) => crypto.createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 32)
const text = (v, max) => {
  const s = String(v ?? '').replace(/\s+/g, ' ').trim()
  return s ? s.slice(0, max) : null
}
const email = (v) => {
  const s = String(v ?? '').trim().toLowerCase()
  return s.length <= 200 && EMAIL_RE.test(s) ? s : null
}
const humanize = (status) => {
  const s = String(status ?? '').toLowerCase().replace(/_/g, ' ').trim()
  return s ? (s[0].toUpperCase() + s.slice(1)).slice(0, 40) : 'Active'
}
const message = (err) => String(err?.message || err || 'Unknown error').slice(0, 300)

// One sync at a time per record in this process (the worker and API routes are
// separate module instances, hence globalThis).
const queues = globalThis.__encloudSyncQueues ?? (globalThis.__encloudSyncQueues = new Map())
function serial(key, fn) {
  const prev = queues.get(key) ?? Promise.resolve()
  const run = prev.catch(() => {}).then(fn)
  queues.set(key, run)
  run.catch(() => {}).finally(() => { if (queues.get(key) === run) queues.delete(key) })
  return run
}

async function readySettings(settings) {
  const s = settings ?? await getEncloudSettings()
  return encloudReady(s) ? s : null
}

const linkOf = (kind, refId) => EncloudLink.findOne({ kind, refId }).lean()

async function recordFailure(kind, refId, err) {
  const link = await EncloudLink.findOneAndUpdate(
    { kind, refId },
    { $setOnInsert: { kind, refId } },
    { upsert: true, new: true },
  ).lean()
  const attempts = (link.attempts ?? 0) + 1
  const wait = RETRY_MINUTES[Math.min(attempts - 1, RETRY_MINUTES.length - 1)]
  await EncloudLink.updateOne({ _id: link._id }, {
    $set: { error: message(err), errorAt: new Date(), attempts, nextAttemptAt: new Date(Date.now() + wait * 60_000) },
  })
}

const SYNCED = () => ({ syncedAt: new Date(), error: null, errorAt: null, attempts: 0, nextAttemptAt: null })

// ─────────────────────────────────────────────────────────────────────────────
// Clients & projects
// ─────────────────────────────────────────────────────────────────────────────

/** The client's name as the CRM lists it: company, else contact person, else the account holder. */
export function clientDisplayName(client, user = null) {
  return text(client?.company, 200) || text(client?.contactPerson, 200) || text(user?.name, 200) || text(client?.clientCode, 200) || 'Client'
}

async function clientBody(client) {
  const user = client.userId ? await User.findById(client.userId).select('name email phone').lean() : null
  return {
    name:  clientDisplayName(client, user),
    // encloud prefills its Enfinito Pay checkout with these.
    email: email(client.companyEmail) ?? email(user?.email),
    phone: text(client.companyPhone, 40) ?? text(user?.phone, 40),
  }
}

/**
 * Creates or updates the client in encloud (their folder is made there).
 * Without `force`, only clients that are already linked — or every active one
 * when "create folders automatically" is on — are pushed, and only when their
 * name, email or phone changed.
 */
export async function syncClient(clientId, { force = false, settings } = {}) {
  const s = await readySettings(settings)
  if (!s) return { skipped: 'off' }
  return serial(`client:${clientId}`, async () => {
    await connectDB()
    const client = await Client.findById(clientId).lean()
    if (!client) return { skipped: 'missing' }
    const link = await linkOf('CLIENT', client._id)
    if (!link?.folderId && !force && (!s.autoFolders || client.isActive === false)) return { skipped: 'not linked' }

    const body = await clientBody(client)
    const hash = hashOf(body)
    if (!force && link?.folderId && link.pushedHash === hash && !link.error) return { skipped: 'unchanged', link }
    try {
      const r = await encloud.putClient(String(client._id), body, { settings: s })
      const saved = await EncloudLink.findOneAndUpdate(
        { kind: 'CLIENT', refId: client._id },
        {
          $set: {
            folderId: r.folder?.id ?? null, folderUrl: r.folder?.url ?? null, pushedHash: hash,
            remote: { openDue: Number(r.open_due) || 0, at: new Date() }, ...SYNCED(),
          },
          $setOnInsert: { kind: 'CLIENT', refId: client._id },
        },
        { upsert: true, new: true },
      ).lean()
      return { ok: true, link: saved, remote: r }
    } catch (err) {
      await recordFailure('CLIENT', client._id, err)
      throw err
    }
  })
}

async function ensureClient(clientId, s) {
  const link = await linkOf('CLIENT', clientId)
  if (!link?.folderId) await syncClient(clientId, { force: true, settings: s })
}

/** Creates or updates the project (and, first, its client) in encloud. */
export async function syncProject(projectId, { force = false, settings } = {}) {
  const s = await readySettings(settings)
  if (!s) return { skipped: 'off' }
  return serial(`project:${projectId}`, async () => {
    await connectDB()
    const project = await Project.findById(projectId).select('name status clientId').lean()
    if (!project) return { skipped: 'missing' }
    const link = await linkOf('PROJECT', project._id)
    if (!link?.folderId && !force && (!s.autoFolders || project.status === 'CANCELLED')) return { skipped: 'not linked' }

    const body = { client_id: String(project.clientId), name: text(project.name, 200) || 'Project', status: humanize(project.status) }
    const hash = hashOf(body)
    if (!force && link?.folderId && link.pushedHash === hash && !link.error) return { skipped: 'unchanged', link }
    try {
      await ensureClient(project.clientId, s)
      let r
      try {
        r = await encloud.putProject(String(project._id), body, { settings: s })
      } catch (err) {
        if (err.status !== 404) throw err
        // The client is gone from encloud (removed there): make it again, then retry once.
        await syncClient(project.clientId, { force: true, settings: s })
        r = await encloud.putProject(String(project._id), body, { settings: s })
      }
      const saved = await EncloudLink.findOneAndUpdate(
        { kind: 'PROJECT', refId: project._id },
        {
          $set: {
            folderId: r.folder?.id ?? null, folderUrl: r.folder?.url ?? null, pushedHash: hash,
            remote: { files: Number(r.files) || 0, bytes: Number(r.bytes) || 0, openDue: Number(r.open_due) || 0, at: new Date() },
            ...SYNCED(),
          },
          $setOnInsert: { kind: 'PROJECT', refId: project._id },
        },
        { upsert: true, new: true },
      ).lean()
      return { ok: true, link: saved, remote: r }
    } catch (err) {
      await recordFailure('PROJECT', project._id, err)
      throw err
    }
  })
}

async function ensureProject(projectId, s) {
  const link = await linkOf('PROJECT', projectId)
  if (!link?.folderId) await syncProject(projectId, { force: true, settings: s })
}

// ─────────────────────────────────────────────────────────────────────────────
// Dues (one per unpaid invoice)
// ─────────────────────────────────────────────────────────────────────────────

const INVOICE_FIELDS = 'invoiceNumber status currency total paidAmount dueDate clientId projectId projectIds'

/**
 * The project an invoice's due locks: its project, or the first of the legacy
 * projectIds — never a project of another client (such a due locks the whole
 * client instead).
 */
async function dueProject(invoice) {
  const pid = invoice.projectId ?? invoice.projectIds?.[0] ?? null
  if (!pid) return null
  const p = await Project.findById(pid).select('name clientId').lean()
  return p && String(p.clientId) === String(invoice.clientId) ? p : null
}

/**
 * What the invoice wants its encloud due to be:
 *   { status: 'open', amount } | { status: 'paid' } | { status: 'cancelled', why }
 */
export function wantedDue(invoice, { settings, link = null, today = dhakaDayKey() }) {
  if (!invoice) return { status: 'cancelled', why: 'The invoice was deleted' }
  if (String(invoice.currency || 'BDT').toUpperCase() !== 'BDT') return { status: 'cancelled', why: 'Only taka (BDT) invoices lock files' }
  const balance = round2(invoiceOutstanding(invoice))
  const payable = PAYABLE_INVOICE_STATUSES.includes(invoice.status)
  if (invoice.status === 'PAID' || (payable && balance <= 0.01)) return { status: 'paid' }
  if (!payable) return { status: 'cancelled', why: invoice.status === 'DRAFT' ? 'The invoice is a draft' : 'The invoice is cancelled' }
  if (!settings.lockDues) return { status: 'cancelled', why: 'Locking files for unpaid invoices is off' }
  if (link?.mode === 'OFF') return { status: 'cancelled', why: link.offReason || 'Unlocked by staff' }
  if (settings.lockWhen === 'OVERDUE' && invoice.status !== 'OVERDUE'
      && !(invoice.dueDate && dhakaDayKey(new Date(invoice.dueDate)) < today)) {
    return { status: 'cancelled', why: 'Files lock once the invoice is overdue' }
  }
  return { status: 'open', amount: balance }
}

function sameDue(a, b) {
  if (!a || !b) return !a && !b
  if (a.status !== b.status) return false
  if (a.status !== 'open') return true
  return Math.abs(Number(a.amount) - Number(b.amount)) < 0.005
    && a.clientId === b.clientId && (a.projectId ?? null) === (b.projectId ?? null)
    && a.reference === b.reference && a.description === b.description
}

/** encloud's view of a due, as of `asOf` (an answer's arrival, or an event's creation). */
export const remoteOfDue = (due, asOf = new Date()) => due ? ({
  status:  due.status,
  amount:  Number(due.amount) || 0,
  paidVia: due.paid_via ?? null,
  paidAt:  due.paid_at ?? null,
  asOf,
}) : null

// encloud stamps its events on the same clock; this allows for a little skew.
const ECHO_WINDOW_MS = 30_000

/**
 * Is an encloud event saying "the due is now `status`", created at `at`, the
 * echo of one of the CRM's own pushes? Matched on status and time, so a late
 * echo of an older push is still recognised after newer pushes.
 */
export function isOwnDueChange(link, status, at) {
  const t = new Date(at).getTime()
  return (link?.pushes ?? []).some(p => p.status === status
    && t >= new Date(p.from).getTime() - ECHO_WINDOW_MS
    && t <= (p.to ? new Date(p.to).getTime() : Date.now()) + ECHO_WINDOW_MS)
}

async function pushDue(crmId, wanted, s) {
  if (wanted.status === 'open') {
    await ensureClient(wanted.clientId, s)
    if (wanted.projectId) await ensureProject(wanted.projectId, s)
    const body = {
      client_id:   wanted.clientId,
      project_id:  wanted.projectId,
      amount:      wanted.amount,
      currency:    'BDT',
      reference:   wanted.reference,
      description: wanted.description,
    }
    try {
      return await encloud.putDue(crmId, body, { settings: s })
    } catch (err) {
      if (err.status === 409 && err.code === 'due_closed') {
        // Paid or cancelled in encloud before: open it again for the new balance.
        await encloud.reopenDue(crmId, { settings: s })
        return encloud.putDue(crmId, body, { settings: s })
      }
      if (err.status === 404) {
        // The client or project is missing in encloud: make them again, retry once.
        await syncClient(wanted.clientId, { force: true, settings: s })
        if (wanted.projectId) await syncProject(wanted.projectId, { force: true, settings: s })
        return encloud.putDue(crmId, body, { settings: s })
      }
      throw err
    }
  }
  const close = wanted.status === 'paid'
    ? () => encloud.markDuePaid(crmId, CRM_PAID_VIA, { settings: s })
    : () => encloud.cancelDue(crmId, { settings: s })
  try {
    return await close()
  } catch (err) {
    if (err.status === 404) return null                   // never made in encloud
    if (err.status === 409) return encloud.getDue(crmId, { settings: s }).catch(() => null)  // already closed there
    throw err
  }
}

/**
 * Brings the invoice's due in encloud in line with the invoice. No-op when
 * nothing changed on the CRM side since the last push (unless `force`).
 */
export async function syncInvoiceDue(invoiceId, { force = false, settings } = {}) {
  const s = await readySettings(settings)
  if (!s) return { skipped: 'off' }
  return serial(`due:${invoiceId}`, async () => {
    await connectDB()
    const invoice = await Invoice.findById(invoiceId).select(INVOICE_FIELDS).lean()
    const link = await linkOf('DUE', invoiceId)
    const wanted = wantedDue(invoice, { settings: s, link })
    const known = link?.pushed || link?.target || link?.remote
    if (!known && wanted.status !== 'open') return { skipped: 'no due', wanted }

    if (wanted.status === 'open') {
      const project = await dueProject(invoice)
      wanted.clientId    = String(invoice.clientId)
      wanted.projectId   = project ? String(project._id) : null
      wanted.reference   = text(invoice.invoiceNumber, 100) || ''
      wanted.description = text(project ? `${project.name} · balance due` : 'Balance due', 500) || ''
    }
    if (!force && sameDue(wanted, link?.pushed) && !link?.error) return { skipped: 'unchanged', wanted }

    // Log the push before making it: encloud's event about it (even a late one)
    // is then recognised as an echo, not as a change made in encloud.
    const from = new Date()
    await EncloudLink.updateOne(
      { kind: 'DUE', refId: invoiceId },
      {
        $set: { target: wanted },
        $push: { pushes: { $each: [{ status: wanted.status, from, to: null }], $slice: -10 } },
        $setOnInsert: { kind: 'DUE', refId: invoiceId },
      },
      { upsert: true },
    )
    try {
      const due = await pushDue(String(invoiceId), wanted, s)
      await EncloudLink.updateOne(
        { kind: 'DUE', refId: invoiceId, 'pushes.from': from },
        { $set: { 'pushes.$.to': new Date(), pushed: wanted, ...(due ? { remote: remoteOfDue(due) } : {}), ...SYNCED() } },
      )
      return { ok: true, wanted, due }
    } catch (err) {
      await EncloudLink.updateOne({ kind: 'DUE', refId: invoiceId, 'pushes.from': from }, { $set: { 'pushes.$.to': new Date() } }).catch(() => {})
      await recordFailure('DUE', invoiceId, err)
      throw err
    }
  })
}

// ─────────────────────────────────────────────────────────────────────────────
// Triggers & sweeps
// ─────────────────────────────────────────────────────────────────────────────

const RUNNERS = { client: syncClient, project: syncProject, invoice: syncInvoiceDue }

/**
 * Fire-and-forget sync after a change in the CRM (API routes call this after
 * their write). Never throws and never delays the response; a failure is kept
 * on the link and retried by the worker.
 */
export function syncSoon(kind, id) {
  if (!id || !RUNNERS[kind]) return
  const t = setTimeout(() => {
    RUNNERS[kind](String(id)).catch(err => console.warn(`[encloud] ${kind} ${id} not synced: ${message(err)}`))
  }, 50)
  t.unref?.()
}

/** Every invoice the sweep should look at: payable BDT ones, ones with a due, and recent changes. */
async function dueCandidates({ since = null, full = false }) {
  const now = new Date()
  const ids = new Set()
  const add = rows => rows.forEach(r => ids.add(String(r._id ?? r.refId)))
  add(await Invoice.find({ status: { $in: PAYABLE_INVOICE_STATUSES }, currency: { $in: ['BDT', null] } }).select('_id').lean())
  add(await EncloudLink.find({
    kind: 'DUE',
    $or: [{ 'pushed.status': 'open' }, { 'target.status': 'open' }, { 'remote.status': 'open' }, { nextAttemptAt: { $lte: now } }],
  }).select('refId').lean())
  if (since && !full) add(await Invoice.find({ updatedAt: { $gte: since } }).select('_id').lean())
  return [...ids]
}

/**
 * One pass: records changed since `since` (or all, with `full`), plus failed
 * ones whose retry time has come. Returns counts.
 */
export async function sweepEncloud({ since = null, full = false } = {}) {
  const s = await readySettings()
  if (!s) return null
  await connectDB()
  const now = new Date()
  const changed = full || !since ? {} : { updatedAt: { $gte: since } }
  const counts = { clients: 0, projects: 0, dues: 0, errors: 0 }
  const run = async (fn, id, key) => {
    try {
      const r = await fn(id, { settings: s })
      if (r?.ok) counts[key] += 1
    } catch {
      counts.errors += 1
    }
  }

  const retry = async kind => (await EncloudLink.find({ kind, nextAttemptAt: { $lte: now } }).select('refId').lean()).map(l => String(l.refId))

  const clientIds = new Set(await retry('CLIENT'))
  if (full || since) {
    const rows = await Client.find(full ? { isActive: { $ne: false } } : changed).select('_id').lean()
    rows.forEach(r => clientIds.add(String(r._id)))
  }
  for (const id of clientIds) await run(syncClient, id, 'clients')

  const projectIds = new Set(await retry('PROJECT'))
  if (full || since) {
    const rows = await Project.find(changed).select('_id').lean()
    rows.forEach(r => projectIds.add(String(r._id)))
  }
  for (const id of projectIds) await run(syncProject, id, 'projects')

  // Dues: work out locally which ones differ from what was pushed, then sync only those.
  const candidates = await dueCandidates({ since, full })
  if (candidates.length) {
    const [invoices, links] = await Promise.all([
      Invoice.find({ _id: { $in: candidates } }).select(INVOICE_FIELDS).lean(),
      EncloudLink.find({ kind: 'DUE', refId: { $in: candidates } }).lean(),
    ])
    const invById = new Map(invoices.map(i => [String(i._id), i]))
    const linkById = new Map(links.map(l => [String(l.refId), l]))
    const today = dhakaDayKey()
    for (const id of candidates) {
      const link = linkById.get(id) ?? null
      const wanted = wantedDue(invById.get(id) ?? null, { settings: s, link, today })
      const due = link?.nextAttemptAt && link.nextAttemptAt <= now
      const pushed = link?.pushed ?? null
      // Open dues carry refs only known after reading the project, so compare
      // status + amount here; syncInvoiceDue does the full comparison.
      const differs = !pushed
        ? wanted.status === 'open' || !!link?.target
        : wanted.status !== pushed.status || (wanted.status === 'open' && Math.abs(wanted.amount - Number(pushed.amount)) >= 0.005)
      if (full || due || differs) await run(syncInvoiceDue, id, 'dues')
    }
  }
  return counts
}
