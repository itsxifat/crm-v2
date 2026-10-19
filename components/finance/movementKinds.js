/**
 * components/finance/movementKinds.js — PURE definitions of the "money
 * movement" presets (capital, drawings, loans, bank charges, interest, other
 * income, balance adjustments). Shared by the Movement modal (client) and
 * POST /api/finance/movements (server), so both agree on categories and kinds.
 * No React, no server imports.
 */

export const MOVEMENT_KINDS = [
  {
    value: 'CAPITAL_IN', label: 'Capital introduced', short: 'Capital in',
    direction: 'IN', txKind: 'CAPITAL', category: 'Capital Introduced',
    hint: 'Owner or shareholder money put into the business — not income, never in the P&L.',
    partyLabel: 'Introduced by',
  },
  {
    value: 'DRAWING', label: "Owner's drawing", short: 'Drawing',
    direction: 'OUT', txKind: 'DRAWING', category: "Owner's Drawings",
    hint: 'Owner takes money out for personal use — not a business expense.',
    partyLabel: 'Drawn by',
  },
  {
    value: 'LOAN_IN', label: 'Loan received', short: 'Loan in',
    direction: 'IN', txKind: 'LOAN', category: 'Loan Received',
    hint: 'Loan or overdraft drawdown from a bank, director or other lender — not income.',
    partyLabel: 'Lender',
  },
  {
    value: 'LOAN_REPAYMENT', label: 'Loan repayment', short: 'Loan repaid',
    direction: 'OUT', txKind: 'LOAN', category: 'Loan Repayment',
    hint: 'Enter the full instalment; put the interest part in "Interest included" — only interest is an expense.',
    partyLabel: 'Lender',
  },
  {
    value: 'BANK_CHARGE', label: 'Bank / wallet charge', short: 'Bank charge',
    direction: 'OUT', txKind: 'OPERATING', category: 'Bank Charges',
    hint: 'Maintenance, SMS, excise duty, MFS cash-out or MDR fees — booked as an expense.',
  },
  {
    value: 'INTEREST_INCOME', label: 'Interest received', short: 'Interest',
    direction: 'IN', txKind: 'OPERATING', category: 'Interest Income',
    hint: 'Enter the net credit and the AIT deducted — income is the gross; the AIT is a tax credit.',
  },
  {
    value: 'OTHER_INCOME', label: 'Other income', short: 'Other income',
    direction: 'IN', txKind: 'OPERATING', category: 'Other Income',
    hint: 'Non-sales income (refund, commission, scrap sale…) — client payments go through invoices.',
    partyLabel: 'Received from',
  },
  {
    value: 'ADJUSTMENT_IN', label: 'Balance adjustment (+)', short: 'Adjustment +',
    direction: 'IN', txKind: 'ADJUSTMENT', category: 'Balance Adjustment',
    hint: 'Corrects the book balance to the bank/cash count — not in the P&L; give a reason.',
  },
  {
    value: 'ADJUSTMENT_OUT', label: 'Balance adjustment (−)', short: 'Adjustment −',
    direction: 'OUT', txKind: 'ADJUSTMENT', category: 'Balance Adjustment',
    hint: 'Corrects the book balance to the bank/cash count — not in the P&L; give a reason.',
  },
]

export const MOVEMENT_KIND_VALUES = MOVEMENT_KINDS.map(k => k.value)

export const MOVEMENT_KIND_MAP = Object.fromEntries(MOVEMENT_KINDS.map(k => [k.value, k]))

/** Sub-types for BANK_CHARGE (stored as Transaction.expenseCategory). */
export const BANK_CHARGE_TYPES = [
  { value: 'MAINTENANCE',  label: 'Account maintenance fee' },
  { value: 'SMS',          label: 'SMS / alert charges' },
  { value: 'EXCISE_DUTY',  label: 'Excise duty (govt.)' },
  { value: 'TRANSFER_FEE', label: 'Transfer / remittance fee' },
  { value: 'CHEQUE_BOOK',  label: 'Cheque book / pay order fee' },
  { value: 'CARD_FEE',     label: 'Card fee' },
  { value: 'MFS_CASHOUT',  label: 'MFS cash-out charge' },
  { value: 'MFS_MDR',      label: 'Merchant (MDR) / gateway fee' },
  { value: 'VAT_ON_FEES',  label: 'VAT on bank charges' },
  { value: 'OTHER',        label: 'Other bank charge' },
]

export const BANK_CHARGE_LABELS = Object.fromEntries(BANK_CHARGE_TYPES.map(t => [t.value, t.label]))

/** Category of the interest part of a loan instalment (P&L expense). */
export const INTEREST_EXPENSE_CATEGORY = 'Interest Expense'

/** Section text used on the TDS_RECEIVABLE entry for tax the bank deducted from interest. */
export const BANK_INTEREST_TDS_SECTION = 'Interest (bank)'

/** Every Transaction.category that a movement can create (for listings). */
export const MOVEMENT_CATEGORIES = Array.from(new Set([
  ...MOVEMENT_KINDS.map(k => k.category),
  INTEREST_EXPENSE_CATEGORY,
]))

/** Ledger kinds that only movements (not invoices/expenses) create. */
export const MOVEMENT_TX_KINDS = ['CAPITAL', 'DRAWING', 'LOAN', 'ADJUSTMENT']
