/**
 * Server-only helpers for the money-movement routes (private folder, never routed).
 *
 * A movement = the ledger row(s) POST /api/finance/movements posts on one account:
 * capital, drawings, loans (a repayment may be principal + interest rows), bank
 * charges, interest, other income and balance adjustments. Rows posted since
 * Transaction.movementKind / movementId exist carry both; older rows are
 * recognised by their kind / category (the "legacy" filters below).
 */

import { ProjectExpense, ProjectPayment } from '@/models'
import { isValidObjectId } from '@/lib/objectId'
import {
  INTEREST_EXPENSE_CATEGORY, MOVEMENT_KIND_VALUES, MOVEMENT_TX_KINDS,
} from '@/components/finance/movementKinds'

const OTHER_INCOME_CATEGORY = 'Other Income'
// Categories an unmarked OPERATING movement row can have (custom other-income
// categories cannot be told apart from ordinary income, so they are not listed).
const LEGACY_CATEGORIES = ['Bank Charges', 'Interest Income', INTEREST_EXPENSE_CATEGORY]

/** Cash direction a legacy filter looks for — a reversal row mirrors its original's type. */
const dir = (type) => ({ $or: [
  { type, reversalOf: null },
  { type: type === 'INCOME' ? 'EXPENSE' : 'INCOME', reversalOf: { $ne: null } },
] })

const LEGACY_FILTERS = {
  CAPITAL_IN:      { kind: 'CAPITAL' },
  DRAWING:         { kind: 'DRAWING' },
  LOAN_IN:         { $and: [{ kind: 'LOAN' }, dir('INCOME')] },
  LOAN_REPAYMENT:  { $or: [{ $and: [{ kind: 'LOAN' }, dir('EXPENSE')] }, { category: INTEREST_EXPENSE_CATEGORY }] },
  BANK_CHARGE:     { category: 'Bank Charges', kind: 'OPERATING' },
  INTEREST_INCOME: { category: 'Interest Income' },
  OTHER_INCOME:    { $and: [{ category: OTHER_INCOME_CATEGORY, kind: 'OPERATING' }, dir('INCOME')] },
  ADJUSTMENT_IN:   { $and: [{ kind: 'ADJUSTMENT' }, dir('INCOME')] },
  ADJUSTMENT_OUT:  { $and: [{ kind: 'ADJUSTMENT' }, dir('EXPENSE')] },
}

export const isMovementKind = (kind) => Object.prototype.hasOwnProperty.call(LEGACY_FILTERS, kind)

/** Transaction filter for one movement kind: marked rows by movementKind, older rows by shape. */
export function kindFilter(kind) {
  return { $or: [{ movementKind: kind }, { $and: [{ movementKind: null }, LEGACY_FILTERS[kind]] }] }
}

/** Transaction filter for every movement row (any kind, reversals included). */
export const MOVEMENT_FILTER = { $or: [
  { movementKind: { $in: MOVEMENT_KIND_VALUES } },
  { $and: [{ movementKind: null }, { $or: [
    { kind: { $in: MOVEMENT_TX_KINDS } },
    { category: { $in: LEGACY_CATEGORIES } },
    { category: OTHER_INCOME_CATEGORY, kind: 'OPERATING' },
  ] }] },
] }

/** Movement preset a ledger row came from (unmarked rows: the most likely one). */
export function movementKindOf(tx) {
  if (tx.movementKind) return tx.movementKind
  // Judge a reversal by its original's direction (a reversed loan received is still a loan received).
  const type = tx.reversalOf ? (tx.type === 'INCOME' ? 'EXPENSE' : 'INCOME') : tx.type
  if (tx.kind === 'CAPITAL') return 'CAPITAL_IN'
  if (tx.kind === 'DRAWING') return 'DRAWING'
  if (tx.kind === 'LOAN') return type === 'INCOME' ? 'LOAN_IN' : 'LOAN_REPAYMENT'
  if (tx.kind === 'ADJUSTMENT') return type === 'INCOME' ? 'ADJUSTMENT_IN' : 'ADJUSTMENT_OUT'
  if (tx.category === 'Bank Charges') return 'BANK_CHARGE'
  if (tx.category === 'Interest Income') return 'INTEREST_INCOME'
  if (tx.category === INTEREST_EXPENSE_CATEGORY) return 'LOAN_REPAYMENT'
  return 'OTHER_INCOME'
}

/** True when the row has the shape of a money movement (same rule as MOVEMENT_FILTER). */
function isMovementRow(tx) {
  if (!tx?.accountId || tx.transferId) return false
  if (tx.movementKind) return MOVEMENT_KIND_VALUES.includes(tx.movementKind)
  const kind = tx.kind || 'OPERATING'
  if (MOVEMENT_TX_KINDS.includes(kind)) return true
  if (kind !== 'OPERATING') return false
  return LEGACY_CATEGORIES.includes(tx.category) || tx.category === OTHER_INCOME_CATEGORY
}

/**
 * Ids (strings) of UNMARKED rows that belong to an expense payment (payExpense
 * stores the expense id in `reference`) or a confirmed client payment — those are
 * corrected where they were recorded, never here. Marked rows were posted by the
 * movements route itself, so they are never linked and need no lookup.
 */
export async function linkedRowIds(rows) {
  const legacy = rows.filter(r => !r.movementKind)
  if (!legacy.length) return new Set()
  const refs = [...new Set(legacy.map(r => r.reference).filter(r => r && isValidObjectId(r)).map(String))]
  const [expenses, payments] = await Promise.all([
    refs.length ? ProjectExpense.find({ _id: { $in: refs } }).select('_id').lean() : [],
    ProjectPayment.find({ transactionId: { $in: legacy.map(r => r._id) } }).select('transactionId').lean(),
  ])
  const expenseIds = new Set(expenses.map(e => String(e._id)))
  const out = new Set(payments.map(p => String(p.transactionId)))
  for (const r of legacy) if (r.reference && expenseIds.has(String(r.reference))) out.add(String(r._id))
  return out
}

/**
 * Why `tx` cannot be reversed as a money movement — { status, message } — or null.
 * `linked`: the Set from linkedRowIds(). Whether it was reversed already is checked
 * separately (and enforced by the unique index on Transaction.reversalOf).
 */
export function reverseProblem(tx, linked = new Set()) {
  if (tx?.transferId) {
    return { status: 409, message: 'This entry is part of a transfer — reverse the transfer instead' }
  }
  if (!isMovementRow(tx)) return { status: 404, message: 'Money movement not found' }
  if (tx.reversalOf) return { status: 409, message: 'This entry is itself a reversal and cannot be reversed again' }
  if (tx.invoiceId || tx.projectId || tx.assetId || tx.purchaseBillId || linked.has(String(tx._id))) {
    return {
      status: 409,
      message: 'This entry belongs to an invoice, expense, client payment, asset or purchase bill — correct it where it was recorded',
    }
  }
  // Unmarked rows carry tax entries only as the AIT on an interest receipt.
  if (!tx.movementKind && (tx.taxEntryIds ?? []).length && tx.category !== 'Interest Income') {
    return { status: 409, message: 'This entry carries tax entries from another record — correct it where it was recorded' }
  }
  return null
}
