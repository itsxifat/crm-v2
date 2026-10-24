/**
 * app/api/accounts/_lib/pl.js — server-side P&L helpers shared by the finance
 * report routes (accounts summary, P&L report, units report, dashboard stats,
 * revenue report).
 *
 * `_lib` is a private folder (underscore prefix), so Next.js never routes it.
 *
 * The Transaction collection is both the cash ledger and the P&L source:
 *   • only rows whose `kind` is OPERATING / NON_CASH (or missing — legacy) count;
 *     transfers, capital, drawings, loans, tax payments/refunds, asset
 *     purchases/sales and adjustments move money but never touch the P&L;
 *   • the P&L value is `plAmountBDT` (e.g. a client receipt net of the VAT it
 *     carries), falling back to `amountBDT`, then to `amount` for BDT rows;
 *   • a reversal row (reverseMoneyEntry: opposite `type`, `reversalOf` set)
 *     reduces the side of the row it reverses instead of inflating the other
 *     side — reversing a 10,000 expense lowers expenses by 10,000 rather than
 *     adding 10,000 of income;
 *   • a NON_CASH INCOME row in a depreciation category is a contra-expense: the
 *     write-back of depreciation a monthly run posted for days after an asset's
 *     disposal (inventory doDispose). It reduces the depreciation charge — never
 *     income or revenue — and a reversal of it adds the charge back.
 */

import { BASE_CURRENCY } from '@/lib/currencies'
import { isPl, plAmountBDT, plFilter, KIND_LABELS, NON_PL_KINDS } from '@/lib/finance/constants'

export { plFilter, isPl, plAmountBDT, KIND_LABELS, NON_PL_KINDS }

/** Fields every P&L computation needs from a Transaction (for `.select()`), incl. its business unit. */
export const PL_SELECT = 'type kind amount amountBDT plAmountBDT currency category expenseCategory reversalOf date unit'

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

/**
 * P&L contribution of one ledger row.
 * @returns {null | { side: 'INCOME'|'EXPENSE', amount: number, unconverted: boolean, sign: 1|-1, contra: boolean }}
 *   null ⇒ the row does not touch the P&L (non-P&L kind or unknown type).
 *   amount is signed: a reversal row yields a negative amount on the side of
 *   the row it reverses; a contra row (depreciation written back) a negative
 *   amount on the EXPENSE side. sign is that sign (apply it to the row's
 *   original-currency amount too). unconverted ⇒ foreign-currency row with no BDT
 *   figure (amount 0; callers report it separately instead of summing face value as BDT).
 */
export function plEffect(tx) {
  if (!tx || (tx.type !== 'INCOME' && tx.type !== 'EXPENSE')) return null
  if (!isPl(tx)) return null
  const isReversal = !!tx.reversalOf
  // type of the original posting (a reversal row carries the opposite type)
  const origType = isReversal ? (tx.type === 'INCOME' ? 'EXPENSE' : 'INCOME') : tx.type
  // Depreciation written back on a disposal: reduces the charge, it is not income.
  // (DEPRECIATION_CATEGORIES is a module constant defined below — read at call time.)
  const contra = origType === 'INCOME' && tx.kind === 'NON_CASH' && DEPRECIATION_CATEGORIES.includes(tx.category)
  const side = contra ? 'EXPENSE' : origType
  const sign = (isReversal ? -1 : 1) * (contra ? -1 : 1)
  const value = plAmountBDT(tx)
  if (value === null) return { side, amount: 0, unconverted: true, sign, contra }
  return { side, amount: sign * value, unconverted: false, sign, contra }
}

/**
 * Cash value of a row in BDT (what actually moved), or null for a foreign row
 * without a BDT figure. Used for the non-P&L movement breakdown.
 */
export function cashAmountBDT(tx) {
  if (tx?.amountBDT !== null && tx?.amountBDT !== undefined && tx.amountBDT !== '') {
    const n = Number(tx.amountBDT)
    if (Number.isFinite(n)) return n
  }
  if ((tx?.currency || BASE_CURRENCY) === BASE_CURRENCY) return Number(tx?.amount) || 0
  return null
}

/** Sum income / expense / profit over a list of rows. */
export function sumPl(rows) {
  let income = 0
  let expense = 0
  let incomeCount = 0
  let expenseCount = 0
  let unconvertedCount = 0
  for (const tx of rows) {
    const e = plEffect(tx)
    if (!e) continue
    if (e.unconverted) { unconvertedCount++; continue }
    if (e.side === 'INCOME') { income += e.amount; incomeCount++ } else { expense += e.amount; expenseCount++ }
  }
  income = round2(income)
  expense = round2(expense)
  return { income, expense, profit: round2(income - expense), incomeCount, expenseCount, unconvertedCount }
}

/**
 * Cash movements that are deliberately left out of the P&L, grouped by kind:
 * [{ kind, label, inflow, outflow, count, unconvertedCount }] (BDT), sorted by size.
 */
export function nonPlBreakdown(rows) {
  const map = {}
  for (const tx of rows) {
    if (isPl(tx)) continue
    const kind = tx.kind || 'OPERATING'
    if (!map[kind]) map[kind] = { kind, label: KIND_LABELS[kind] ?? kind, inflow: 0, outflow: 0, count: 0, unconvertedCount: 0 }
    const m = map[kind]
    m.count++
    const bdt = cashAmountBDT(tx)
    if (bdt === null) { m.unconvertedCount++; continue }
    if (tx.type === 'INCOME') m.inflow += bdt
    else if (tx.type === 'EXPENSE') m.outflow += bdt
  }
  return Object.values(map)
    .map(m => ({ ...m, inflow: round2(m.inflow), outflow: round2(m.outflow) }))
    .sort((a, b) => (b.inflow + b.outflow) - (a.inflow + a.outflow))
}

/** Categories treated as depreciation & amortisation (non-cash) for EBITDA. */
export const DEPRECIATION_CATEGORIES = ['Depreciation', 'Asset Impairment', 'Amortisation', 'Amortization']

/** Σ P&L expense of depreciation-type NON_CASH rows (BDT), net of reversals and of write-backs (contra rows). */
export function depreciationTotal(rows) {
  let total = 0
  for (const tx of rows) {
    if (tx.kind !== 'NON_CASH') continue
    if (!DEPRECIATION_CATEGORIES.includes(tx.category)) continue
    const e = plEffect(tx)
    if (!e || e.unconverted || e.side !== 'EXPENSE') continue
    total += e.amount
  }
  return round2(total)
}

/** Ledger categories of interest paid / earned (money movements & loan instalments). */
export const INTEREST_EXPENSE_CATEGORIES = ['Interest Expense']
export const INTEREST_INCOME_CATEGORIES = ['Interest Income']

/** Σ P&L interest expense and interest income (BDT), reversals netted. */
export function interestTotals(rows) {
  let expense = 0
  let income = 0
  for (const tx of rows) {
    const e = plEffect(tx)
    if (!e || e.unconverted) continue
    if (e.side === 'EXPENSE' && INTEREST_EXPENSE_CATEGORIES.includes(tx.category)) expense += e.amount
    else if (e.side === 'INCOME' && INTEREST_INCOME_CATEGORIES.includes(tx.category)) income += e.amount
  }
  return { expense: round2(expense), income: round2(income) }
}

/**
 * EBITDA = net profit + net interest expense + depreciation & amortisation.
 * (Income tax is not a P&L row here — tax payments are non-P&L movements.)
 */
export function ebitdaOf(netProfit, rows, depreciation = depreciationTotal(rows)) {
  const interest = interestTotals(rows)
  return {
    ebitda: round2(Number(netProfit) + depreciation + interest.expense - interest.income),
    interestExpense: interest.expense,
    interestIncome: interest.income,
  }
}

export { round2 }
