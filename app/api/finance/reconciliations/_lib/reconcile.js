/**
 * Server-only reconciliation helpers (private folder, never routed).
 *
 * Model: while a Reconciliation is IN_PROGRESS, ticked ledger rows carry
 * clearStatus CLEARED + reconciliationId = session. Completing turns them
 * RECONCILED. Balances are always recomputed from the ledger:
 *   opening (of the session) = account opening + Σ rows RECONCILED by earlier sessions
 *   cleared balance          = opening + Σ rows ticked in this session
 *   difference               = statement balance − cleared balance  (must be 0 to finish)
 */

import { MoneyAccount, Reconciliation, Transaction, User } from '@/models'
import { dhakaDayStart, dhakaDayKey, parseDhakaDay } from '@/lib/dhakaTime'
import { addDays, dayKeyLabel } from '@/lib/finance/fiscal'
import { accountAmountOf } from '@/lib/finance/ledger'

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
export const EPS = 0.005
export const MAX_ROWS = 3000

export function httpError(status, message, extra = null) {
  const err = new Error(message)
  err.status = status
  if (extra) Object.assign(err, extra)
  return err
}

const num = (field) => ({ $convert: { input: `$${field}`, to: 'double', onError: 0, onNull: 0 } })
const numOrNull = (field) => ({ $convert: { input: `$${field}`, to: 'double', onError: null, onNull: null } })

/** $-expression for a row's magnitude in the account currency (mirrors constants.accountAmountOf). */
function valueExpr(currency) {
  return {
    $let: {
      vars: { aa: numOrNull('accountAmount') },
      in: {
        $cond: [
          { $ne: ['$$aa', null] },
          '$$aa',
          { $cond: [
            { $eq: [{ $ifNull: ['$currency', 'BDT'] }, { $literal: currency || 'BDT' }] },
            num('amount'),
            { $ifNull: [numOrNull('amountBDT'), num('amount')] },
          ] },
        ],
      },
    },
  }
}

/** Σ in / Σ out (account currency) over rows matching `match`. */
export async function sumFlows(match, currency) {
  const [row] = await Transaction.aggregate([
    { $match: match },
    { $project: { type: 1, v: valueExpr(currency) } },
    { $group: {
      _id: null,
      inflow:  { $sum: { $cond: [{ $eq: ['$type', 'INCOME'] }, '$v', 0] } },
      outflow: { $sum: { $cond: [{ $eq: ['$type', 'EXPENSE'] }, '$v', 0] } },
      count:   { $sum: 1 },
    } },
  ])
  return { inflow: round2(row?.inflow ?? 0), outflow: round2(row?.outflow ?? 0), count: row?.count ?? 0 }
}

/** Ledger window a statement covers: { openingStart|null, next } (rows dated in [openingStart, next)). */
export function statementWindow(statementDate, account) {
  const key = dhakaDayKey(statementDate)
  const next = parseDhakaDay(key).next
  const openingStart = account.openingDate ? dhakaDayStart(account.openingDate) : null
  return { openingStart, next, key }
}

function windowDate({ openingStart, next }) {
  const date = { $lt: next }
  if (openingStart) date.$gte = openingStart
  return date
}

/** Live figures for an IN_PROGRESS session. */
export async function liveSummary(recon, account) {
  const currency = account.currency || 'BDT'
  const base = { accountId: account._id }
  if (account.openingDate) base.date = { $gte: dhakaDayStart(account.openingDate) }
  const [prior, session] = await Promise.all([
    sumFlows({ ...base, clearStatus: 'RECONCILED', reconciliationId: { $ne: recon._id } }, currency),
    sumFlows({ ...base, reconciliationId: recon._id, clearStatus: { $in: ['CLEARED', 'RECONCILED'] } }, currency),
  ])
  const openingBalance = round2((Number(account.openingBalance) || 0) + prior.inflow - prior.outflow)
  const clearedBalance = round2(openingBalance + session.inflow - session.outflow)
  return {
    openingBalance,
    clearedIn:      session.inflow,
    clearedOut:     session.outflow,
    clearedCount:   session.count,
    clearedBalance,
    statementBalance: round2(recon.statementBalance),
    difference:     round2((Number(recon.statementBalance) || 0) - clearedBalance),
  }
}

/** Figures stored on a COMPLETED / UNDONE session (snapshot at completion). */
export function storedSummary(recon) {
  return {
    openingBalance:   round2(recon.openingBalance ?? 0),
    clearedIn:        null,
    clearedOut:       null,
    clearedCount:     Array.isArray(recon.transactionIds) ? recon.transactionIds.length : 0,
    clearedBalance:   round2(recon.clearedBalance ?? 0),
    statementBalance: round2(recon.statementBalance ?? 0),
    difference:       round2(recon.difference ?? 0),
  }
}

/** Latest COMPLETED reconciliation of an account (optionally excluding one id). */
export async function lastCompleted(accountId, { excludeId = null } = {}) {
  const filter = { accountId, status: 'COMPLETED' }
  if (excludeId) filter._id = { $ne: excludeId }
  return Reconciliation.findOne(filter).sort({ statementDate: -1, completedAt: -1 }).lean()
}

/** Copy the latest COMPLETED session onto the account (or clear it). */
export async function syncAccountLastReconciled(accountId) {
  const latest = await lastCompleted(accountId)
  await MoneyAccount.updateOne(
    { _id: accountId },
    { $set: {
      lastReconciledDate:    latest?.statementDate ?? null,
      lastReconciledBalance: latest ? round2(latest.statementBalance) : null,
    } },
  )
  return latest
}

/**
 * Validate a statement date ('YYYY-MM-DD') for an account. Returns an error
 * message or null. Must be a real day, not in the future, not before the day
 * before the account's opening date, and after the last completed reconciliation.
 */
export async function statementDateProblem(dayKey, account, { excludeId = null } = {}) {
  const day = parseDhakaDay(dayKey)
  if (!day || dhakaDayKey(day.start) !== dayKey) return 'Enter a valid statement date'
  if (dayKey > dhakaDayKey(new Date())) return 'The statement date cannot be in the future'
  if (account.openingDate) {
    const minKey = addDays(dhakaDayKey(account.openingDate), -1)
    if (dayKey < minKey) return `The statement date cannot be before the account's opening balance date (${dayKeyLabel(account.openingDate)})`
  }
  const last = await lastCompleted(account._id, { excludeId })
  if (last && dayKey <= dhakaDayKey(last.statementDate)) {
    return `The account is already reconciled up to ${dayKeyLabel(last.statementDate)} — pick a later statement date`
  }
  return null
}

function shapeRow(tx, account, reconId) {
  const counter = tx.counterAccountId && typeof tx.counterAccountId === 'object' && tx.counterAccountId.name
    ? tx.counterAccountId.name : null
  return {
    id:              String(tx._id),
    txnId:           tx.txnId ?? null,
    date:            tx.date,
    type:            tx.type,
    kind:            tx.kind || 'OPERATING',
    category:        tx.category,
    expenseCategory: tx.expenseCategory ?? null,
    description:     tx.description,
    reference:       tx.reference ?? null,
    channel:         tx.channel ?? null,
    cheque:          tx.cheque && (tx.cheque.no || tx.cheque.bank || tx.cheque.date) ? tx.cheque : null,
    party:           tx.paidToName ?? tx.vendor ?? null,
    counterAccount:  counter,
    transferId:      tx.transferId ?? null,
    amount:          round2(accountAmountOf(tx, account)),
    clearStatus:     tx.clearStatus || 'UNCLEARED',
    cleared:         !!(reconId && tx.reconciliationId && String(tx.reconciliationId) === String(reconId)),
  }
}

const ROW_SELECT = 'txnId date type kind category expenseCategory description reference channel cheque paidToName vendor counterAccountId transferId amount currency amountBDT accountAmount clearStatus reconciliationId createdAt'

/**
 * Rows to show in a session.
 * IN_PROGRESS: every row in the statement window that is not reconciled elsewhere
 * (ticked rows have cleared:true). COMPLETED/UNDONE: the rows that were cleared.
 */
export async function sessionRows(recon, account) {
  if (recon.status === 'IN_PROGRESS') {
    const win = statementWindow(recon.statementDate, account)
    const filter = {
      accountId: account._id,
      date: windowDate(win),
      $or: [
        { reconciliationId: recon._id },
        { reconciliationId: null, clearStatus: { $ne: 'RECONCILED' } },
      ],
    }
    const [docs, total, laterUncleared] = await Promise.all([
      Transaction.find(filter).sort({ date: 1, createdAt: 1, _id: 1 }).limit(MAX_ROWS)
        .select(ROW_SELECT).populate('counterAccountId', 'name').lean(),
      Transaction.countDocuments(filter),
      Transaction.countDocuments({ accountId: account._id, date: { $gte: win.next }, clearStatus: { $ne: 'RECONCILED' } }),
    ])
    return {
      rows: docs.map(d => shapeRow(d, account, recon._id)),
      total,
      truncated: total > docs.length,
      laterUncleared,
    }
  }
  const ids = Array.isArray(recon.transactionIds) ? recon.transactionIds : []
  const docs = ids.length
    ? await Transaction.find({ _id: { $in: ids } }).sort({ date: 1, createdAt: 1, _id: 1 }).limit(MAX_ROWS)
      .select(ROW_SELECT).populate('counterAccountId', 'name').lean()
    : []
  return {
    rows: docs.map(d => ({ ...shapeRow(d, account, null), cleared: true })),
    total: ids.length,
    truncated: ids.length > docs.length,
    laterUncleared: 0,
  }
}

/**
 * Rows dated within the statement window that were NOT cleared as of this
 * session (deposits in transit / unpresented payments) — for the BRS report.
 */
export async function outstandingRows(recon, account) {
  const win = statementWindow(recon.statementDate, account)
  let thisIds = []
  let earlierFilter
  if (recon.status === 'IN_PROGRESS') {
    const ticked = await Transaction.find({ reconciliationId: recon._id }).select('_id').lean()
    thisIds = ticked.map(t => t._id)
    earlierFilter = { clearStatus: 'RECONCILED' }
  } else {
    thisIds = Array.isArray(recon.transactionIds) ? recon.transactionIds : []
    const cutoff = recon.completedAt ?? recon.updatedAt ?? new Date()
    const earlier = await Reconciliation.find({
      accountId: account._id, status: 'COMPLETED', _id: { $ne: recon._id }, completedAt: { $lt: cutoff },
    }).select('_id').lean()
    earlierFilter = { clearStatus: 'RECONCILED', reconciliationId: { $in: earlier.map(e => e._id) } }
  }
  const docs = await Transaction.find({
    accountId: account._id,
    date: windowDate(win),
    _id: { $nin: thisIds },
    $nor: [earlierFilter],
  }).sort({ date: 1, createdAt: 1 }).limit(MAX_ROWS).select(ROW_SELECT).populate('counterAccountId', 'name').lean()
  return docs.map(d => shapeRow(d, account, null))
}

/** Plain reconciliation for API responses (with user names when a map is given). */
export function shapeRecon(r, users = new Map()) {
  const name = (id) => (id ? (users.get(String(id)) ?? null) : null)
  return {
    id:               String(r._id),
    accountId:        String(r.accountId?._id ?? r.accountId),
    statementDate:    r.statementDate,
    statementBalance: round2(r.statementBalance),
    openingBalance:   round2(r.openingBalance ?? 0),
    clearedBalance:   round2(r.clearedBalance ?? 0),
    difference:       round2(r.difference ?? 0),
    status:           r.status,
    itemCount:        Array.isArray(r.transactionIds) ? r.transactionIds.length : 0,
    attachmentUrl:    r.attachmentUrl ?? null,
    notes:            r.notes ?? null,
    completedBy:      name(r.completedBy),
    completedAt:      r.completedAt ?? null,
    undoneBy:         name(r.undoneBy),
    undoneAt:         r.undoneAt ?? null,
    undoReason:       r.undoReason ?? null,
    createdBy:        name(r.createdBy),
    createdAt:        r.createdAt ?? null,
    updatedAt:        r.updatedAt ?? null,
  }
}

/** Map of user id → name for the user refs on a set of reconciliations. */
export async function userNames(recons) {
  const ids = new Set()
  for (const r of recons) for (const f of ['completedBy', 'undoneBy', 'createdBy']) if (r[f]) ids.add(String(r[f]))
  if (!ids.size) return new Map()
  const users = await User.find({ _id: { $in: [...ids] } }).select('name').lean()
  return new Map(users.map(u => [String(u._id), u.name]))
}
