/**
 * lib/combinedInvoice.js
 *
 * Everything that turns a project's many invoices into one consolidated view.
 *
 * Design rule: NOTHING monetary is ever stored on the CombinedInvoice document.
 * Totals, paid amounts, dues and the child list are recomputed from the live
 * Invoice docs on every read, so a combined invoice can never drift out of sync
 * with its children — editing, paying or cancelling a child is reflected on the
 * very next load with no sync job, hook or cron involved.
 */

import mongoose from 'mongoose'
import { Invoice, CombinedInvoice, Project, ProjectPayment } from '@/models'

/**
 * Statuses that never contribute to a combined invoice:
 *   DRAFT     — not issued to the client yet, so not billable
 *   CANCELLED — voided
 * Keeping DRAFT out also means admin and client portals show identical figures,
 * since the client portal never exposes drafts.
 */
export const NON_BILLABLE_STATUSES = ['DRAFT', 'CANCELLED']

/** Minimum number of billable invoices before a project earns a combined invoice. */
export const COMBINE_THRESHOLD = 2

const n = (v) => {
  const x = Number(v)
  return Number.isFinite(x) ? x : 0
}
const round2 = (v) => Math.round(n(v) * 100) / 100

export function toObjectId(id) {
  if (id instanceof mongoose.Types.ObjectId) return id
  try { return new mongoose.Types.ObjectId(String(id)) } catch { return id }
}

/**
 * Matches an invoice belonging to `projectId` in EITHER the current singular
 * `projectId` field OR the legacy `projectIds` array.
 */
export function projectInvoiceFilter(projectId) {
  const oid = toObjectId(projectId)
  return { $or: [{ projectId: oid }, { projectIds: oid }] }
}

/** Amounts for a single invoice, normalised and rounded. */
export function invoiceMoney(inv) {
  const total = round2(inv?.total)
  const paid  = Math.min(round2(inv?.paidAmount), total)
  return {
    subtotal:  round2(inv?.subtotal),
    taxAmount: round2(inv?.taxAmount),
    discount:  round2(inv?.discount),
    total,
    paidAmount: paid,
    due: round2(Math.max(0, total - paid)),
  }
}

/** Sum a list of invoice-like objects into one set of rollup figures. */
export function rollUp(invoices = []) {
  const t = invoices.reduce((acc, inv) => {
    const m = invoiceMoney(inv)
    acc.subtotal   += m.subtotal
    acc.taxAmount  += m.taxAmount
    acc.discount   += m.discount
    acc.total      += m.total
    acc.paidAmount += m.paidAmount
    return acc
  }, { subtotal: 0, taxAmount: 0, discount: 0, total: 0, paidAmount: 0 })

  const total = round2(t.total)
  const paid  = round2(t.paidAmount)
  return {
    invoiceCount: invoices.length,
    subtotal:  round2(t.subtotal),
    taxAmount: round2(t.taxAmount),
    discount:  round2(t.discount),
    total,
    paidAmount: paid,
    due: round2(Math.max(0, total - paid)),
    paidPct: total > 0 ? Math.min(100, Math.round((paid / total) * 100)) : 0,
  }
}

/**
 * Overall state of a combined invoice, derived from its children.
 * Priority: fully paid → any child overdue → part paid → issued.
 */
export function deriveStatus(children = [], totals) {
  if (children.length === 0) return 'EMPTY'
  if (totals.total > 0 && totals.due <= 0.01) return 'PAID'

  const now = new Date()
  const anyOverdue = children.some(c =>
    c.status === 'OVERDUE' ||
    (c.dueDate && new Date(c.dueDate) < now && c.due > 0.01)
  )
  if (anyOverdue) return 'OVERDUE'
  if (totals.paidAmount > 0) return 'PARTIALLY_PAID'
  return 'SENT'
}

/**
 * Currency for the rollup: the children's currency when they all agree, else
 * BDT with a `mixed` flag so the UI can warn that the figures span currencies.
 * (There is no FX table in the app, so mixed amounts are summed as-is.)
 */
function resolveCurrency(children, fallback = 'BDT') {
  const set = new Set(children.map(c => c.currency ?? 'BDT'))
  if (set.size === 0) return { currency: fallback, mixed: false }
  if (set.size === 1) return { currency: [...set][0], mixed: false }
  return { currency: 'BDT', mixed: true }
}

/**
 * Load a project's invoices, oldest first.
 * @param {string} projectId
 * @param {object} opts
 * @param {boolean} opts.billableOnly  drop DRAFT/CANCELLED (default true)
 * @param {boolean} opts.populate      hydrate project/creator refs (default true)
 */
export async function findProjectInvoices(projectId, { billableOnly = true, populate = true } = {}) {
  const filter = projectInvoiceFilter(projectId)
  if (billableOnly) filter.status = { $nin: NON_BILLABLE_STATUSES }

  let q = Invoice.find(filter).sort({ issueDate: 1, createdAt: 1 })
  if (populate) {
    q = q
      .populate('projectId',  'name projectCode venture category')
      .populate('projectIds', 'name projectCode venture category')
      .populate('createdBy', 'name')
  }
  return q
}

/** Shape a child invoice for the combined view (money + the fields the UI needs). */
export function serialiseChild(inv) {
  const j = typeof inv.toJSON === 'function' ? inv.toJSON() : inv
  return {
    id:            j.id ?? j._id?.toString(),
    invoiceNumber: j.invoiceNumber,
    status:        j.status,
    issueDate:     j.issueDate ?? null,
    dueDate:       j.dueDate ?? null,
    paidAt:        j.paidAt ?? null,
    currency:      j.currency ?? 'BDT',
    taxRate:       n(j.taxRate),
    items:         Array.isArray(j.items) ? j.items : [],
    notes:         j.notes ?? null,
    projectId:     j.projectId ?? null,
    projectIds:    j.projectIds ?? [],
    ...invoiceMoney(j),
  }
}

/**
 * Build the full, live combined-invoice payload.
 *
 * @param {object} combinedDoc  a CombinedInvoice document (hydrated or lean)
 * @param {object} opts.includePayments  attach confirmed payments across children
 * @returns {Promise<object>} everything the print view and the API need
 */
export async function buildCombined(combinedDoc, { includePayments = true } = {}) {
  if (!combinedDoc) return null

  const projectId = combinedDoc.projectId?._id ?? combinedDoc.projectId
  const invoices  = await findProjectInvoices(projectId)
  const children  = invoices.map(serialiseChild)
  const totals    = rollUp(children)

  const { currency, mixed: mixedCurrency } = resolveCurrency(children, combinedDoc.currency ?? 'BDT')

  // Every draft still sitting against this project — surfaced to admins so it is
  // obvious why an unissued invoice is missing from the totals.
  const excludedCount = await Invoice.countDocuments({
    ...projectInvoiceFilter(projectId),
    status: { $in: NON_BILLABLE_STATUSES },
  })

  let payments = []
  if (includePayments && children.length > 0) {
    payments = await ProjectPayment.find({
      invoiceId: { $in: children.map(c => toObjectId(c.id)) },
      status:    'CONFIRMED',
    })
      .sort({ paymentDate: -1 })
      .populate('confirmedBy', 'name')
      .lean()
    payments = payments.map(p => ({ ...p, id: p._id.toString() }))
  }

  const issueDates = children.map(c => c.issueDate).filter(Boolean).map(d => new Date(d))
  const dueDates   = children.map(c => c.dueDate).filter(Boolean).map(d => new Date(d))

  const base = typeof combinedDoc.toJSON === 'function'
    ? combinedDoc.toJSON()
    : { ...combinedDoc, id: combinedDoc._id?.toString() }

  return {
    ...base,
    isCombined: true,
    currency,
    mixedCurrency,
    status: deriveStatus(children, totals),
    issueDate: issueDates.length ? new Date(Math.min(...issueDates)) : (base.issuedAt ?? null),
    dueDate:   dueDates.length   ? new Date(Math.max(...dueDates))   : null,
    children,
    totals,
    excludedCount,
    payments,
  }
}

/**
 * Count how many billable invoices a project has.
 */
export async function countBillableInvoices(projectId) {
  return Invoice.countDocuments({
    ...projectInvoiceFilter(projectId),
    status: { $nin: NON_BILLABLE_STATUSES },
  })
}

/**
 * Make sure a project that needs a combined invoice has one.
 *
 * Called after any change that can alter a project's invoice set (create,
 * status change, delete). Safe to call repeatedly and safe to call for projects
 * that will never qualify — it is a no-op in both cases.
 *
 * @param {string} projectId
 * @param {object} opts
 * @param {string} opts.createdBy  user id to stamp on a newly created record
 * @param {boolean} opts.force     create even below COMBINE_THRESHOLD (manual "Generate")
 * @returns {Promise<object|null>} the CombinedInvoice document, or null
 */
export async function ensureCombinedInvoice(projectId, { createdBy = null, force = false } = {}) {
  if (!projectId) return null

  const existing = await CombinedInvoice.findOne({ projectId: toObjectId(projectId) })
  if (existing) return existing

  // Count everything except CANCELLED here — a project with two invoices where
  // one is still DRAFT is about to qualify, and pre-creating avoids a confusing
  // "combined appears only after you hit Send" experience.
  const count = await Invoice.countDocuments({
    ...projectInvoiceFilter(projectId),
    status: { $ne: 'CANCELLED' },
  })
  if (!force && count < COMBINE_THRESHOLD) return null
  if (count === 0) return null

  const project = await Project.findById(projectId).select('clientId currency').lean()
  if (!project) return null

  try {
    return await new CombinedInvoice({
      projectId: toObjectId(projectId),
      clientId:  project.clientId,
      currency:  project.currency ?? 'BDT',
      createdBy,
    }).save()
  } catch (err) {
    // Unique index on projectId — another request won the race; use theirs.
    if (err?.code === 11000) return CombinedInvoice.findOne({ projectId: toObjectId(projectId) })
    throw err
  }
}

/**
 * Per-project invoice rollups for a set of projects, in one round trip.
 * Used by the invoice list's "group by project" view and the project pages.
 *
 * @returns {Promise<Map<string, object>>} projectId → { count, total, paid, due, … }
 */
export async function summariseProjects(projectIds = []) {
  const ids = projectIds.filter(Boolean).map(toObjectId)
  if (ids.length === 0) return new Map()

  const invoices = await Invoice.find({
    $or: [{ projectId: { $in: ids } }, { projectIds: { $in: ids } }],
  }).select('projectId projectIds status total paidAmount dueDate currency').lean()

  const byProject = new Map(ids.map(id => [id.toString(), []]))
  for (const inv of invoices) {
    const owner = inv.projectId ?? inv.projectIds?.[0]
    const key   = owner?.toString()
    if (key && byProject.has(key)) byProject.get(key).push(inv)
  }

  const out = new Map()
  for (const [key, list] of byProject) {
    const billable = list.filter(i => !NON_BILLABLE_STATUSES.includes(i.status))
    const totals   = rollUp(billable)
    out.set(key, {
      ...totals,
      allCount:   list.length,
      draftCount: list.filter(i => i.status === 'DRAFT').length,
      status:     deriveStatus(billable.map(i => ({ ...i, ...invoiceMoney(i) })), totals),
    })
  }
  return out
}
