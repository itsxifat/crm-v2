/**
 * Server-only helpers shared by the money-account routes
 * (app/api/finance/accounts/route.js and app/api/finance/accounts/[id]/**).
 * `_lib` is a private folder — Next.js never routes it.
 */

import { NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { z } from 'zod'
import { Employee, MoneyAccount, Reconciliation, Transaction, User } from '@/models'
import { isValidObjectId } from '@/lib/objectId'
import { maskList, MONEY_ACCOUNT_PII } from '@/lib/pii'
import { isValidCurrency } from '@/lib/currencies'
import { parseDhakaDay, dhakaDayKey } from '@/lib/dhakaTime'
import {
  getAccountBalances, accountTypeGroup, accountTypeLabel,
  MONEY_ACCOUNT_TYPE_VALUES, MFS_PROVIDER_VALUES, WALLET_TYPE_VALUES, CASH_ACCOUNT_TYPES,
  defaultAllowNegative,
} from '@/lib/finance/ledger'

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
export const EPS = 0.005

// ── Errors ───────────────────────────────────────────────────────────────────

/** Map a thrown error to a JSON response: lib errors carry .status; everything else is a 500. */
export function errorResponse(err, tag) {
  const status = Number(err?.status)
  if (status >= 400 && status < 500) {
    const body = { error: err.message || 'Request failed' }
    if (typeof err.code === 'string') body.code = err.code
    if (err.field) body.field = err.field
    if (err.available !== undefined) body.available = err.available
    if (err.details) body.details = err.details
    return NextResponse.json(body, { status })
  }
  if (err?.code === 11000) {
    return NextResponse.json({ error: 'A record with the same unique value already exists' }, { status: 409 })
  }
  console.error(tag, err)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

export function httpError(status, message, extra = null) {
  const err = new Error(message)
  err.status = status
  if (extra) Object.assign(err, extra)
  return err
}

/** 422 with a zod-like `details.fieldErrors` payload for a single field. */
export function fieldError(field, message) {
  return NextResponse.json(
    { error: message, details: { formErrors: [], fieldErrors: { [field]: [message] } } },
    { status: 422 },
  )
}

export const DUPLICATE_NAME_MESSAGE = 'An active account with this name already exists'

/** True when an E11000 came from the active-name index (models/MoneyAccount.js), not the code index. */
export function isDuplicateNameError(err) {
  return err?.code === 11000 && !!(err.keyPattern?.name || /name_active_ci_unique/.test(String(err.message)))
}

// ── Validation ───────────────────────────────────────────────────────────────

const emptyToNull = (v) => (typeof v === 'string' && v.trim() === '' ? null : v)
const optStr = (max) => z.preprocess(emptyToNull, z.string().trim().max(max, `Max ${max} characters`).nullable().optional())

/** '' / undefined → undefined, null stays null, '1,234.5' → 1234.5 (non-numeric strings pass through to fail). */
export const toNumber = (v) => {
  if (v === '' || v === undefined) return undefined
  if (v === null) return null
  if (typeof v === 'string') {
    const n = Number(v.replace(/[,\s]/g, ''))
    return Number.isFinite(n) ? n : v
  }
  return v
}
const NUM = { invalid_type_error: 'Must be a number', required_error: 'Required' }
/** Optional money field; preprocess is outermost so '' and null are handled before optional(). */
export const optMoney = (check = null, message = 'Invalid amount') => z.preprocess(
  toNumber,
  (check ? z.number(NUM).finite('Must be a number').refine(check, message) : z.number(NUM).finite('Must be a number')).nullable().optional(),
)
/** Required money field. */
export const reqMoney = (check = null, message = 'Invalid amount') => z.preprocess(
  toNumber,
  check ? z.number(NUM).finite('Must be a number').refine(check, message) : z.number(NUM).finite('Must be a number'),
)
const objectIdOrNull = z.preprocess(
  emptyToNull,
  z.string().refine(isValidObjectId, 'Invalid id').nullable().optional(),
)

const SWIFT_RE = /^[A-Z]{4}[A-Z]{2}[A-Z0-9]{2}([A-Z0-9]{3})?$/

const accountShape = {
  name:          z.string({ required_error: 'Name is required' }).trim().min(1, 'Name is required').max(100, 'Max 100 characters'),
  code:          z.preprocess(emptyToNull, z.string().trim().max(12, 'Max 12 characters')
    .regex(/^[A-Za-z0-9_-]+$/, 'Letters, digits, - and _ only').nullable().optional()),
  type:          z.enum(MONEY_ACCOUNT_TYPE_VALUES, { errorMap: () => ({ message: 'Choose the account type' }) }),
  bankName:      optStr(120),
  branchName:    optStr(120),
  accountName:   optStr(120),
  accountNumber: optStr(40),
  routingNumber: z.preprocess(
    (v) => (typeof v === 'string' ? (v.replace(/\s+/g, '') || null) : v),
    z.string().regex(/^\d{9}$/, 'Routing number is 9 digits').nullable().optional(),
  ),
  swiftCode:     z.preprocess(
    (v) => (typeof v === 'string' ? (v.replace(/\s+/g, '').toUpperCase() || null) : v),
    z.string().regex(SWIFT_RE, 'SWIFT/BIC is 8 or 11 characters, e.g. BRAKBDDH').nullable().optional(),
  ),
  mfsProvider:   z.preprocess(emptyToNull, z.enum(MFS_PROVIDER_VALUES).nullable().optional()),
  walletType:    z.preprocess(emptyToNull, z.enum(WALLET_TYPE_VALUES).nullable().optional()),
  currency:      z.preprocess(
    (v) => (typeof v === 'string' ? v.trim().toUpperCase() : v),
    z.string().refine(isValidCurrency, 'Unsupported currency'),
  ).optional(),
  openingBalance:   optMoney(),
  openingDate:      z.preprocess(emptyToNull, z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a valid date').nullable().optional()),
  openingReference: optStr(120),
  isBankingChannel: z.boolean().optional(),
  allowNegative:    z.boolean().optional(),
  creditLimit:      optMoney(n => n >= 0, 'Cannot be negative'),
  custodianEmployeeId: objectIdOrNull,
  custodianUserId:     objectIdOrNull,
  linkedPaymentMethods: z.array(z.string().trim().min(1).max(40)).max(30, 'Too many payment methods').optional(),
  isDefault:        z.boolean().optional(),
  color:            z.preprocess(emptyToNull, z.string().regex(/^#[0-9a-fA-F]{6}$/, 'Use a #RRGGBB colour').nullable().optional()),
  notes:            optStr(1000),
}

export const createAccountSchema = z.object(accountShape)
export const updateAccountSchema = z.object({
  ...accountShape,
  status: z.enum(['ACTIVE']).optional(), // restore an archived account (archive = DELETE)
}).partial()

const BANK_NAME_REQUIRED = ['BANK_CURRENT', 'BANK_SAVINGS']

/** Normalise a BD mobile wallet number: '+880 1712-345678' → '01712345678'. */
export function normalizeWalletNumber(raw) {
  let d = String(raw ?? '').replace(/\D/g, '')
  if (d.startsWith('880')) d = d.slice(2)
  else if (d.startsWith('88') && d.length >= 13) d = d.slice(2)
  return d
}

/**
 * Cross-field rules on the merged (existing + patch) account values.
 * Returns { field: message } (empty object when valid) and normalises in place.
 */
export function crossValidate(v) {
  const errors = {}
  if (v.type === 'MFS') {
    if (!v.mfsProvider) errors.mfsProvider = 'Choose the wallet provider'
    if (v.accountNumber && !String(v.accountNumber).includes('•')) {
      const w = normalizeWalletNumber(v.accountNumber)
      if (!/^01\d{9,10}$/.test(w)) errors.accountNumber = 'Wallet number should look like 01XXXXXXXXX'
      else v.accountNumber = w
    }
  } else {
    v.mfsProvider = null
    v.walletType = null
    if (v.accountNumber && !String(v.accountNumber).includes('•')
      && !/^[0-9A-Za-z][0-9A-Za-z \-/.]{0,39}$/.test(String(v.accountNumber))) {
      errors.accountNumber = 'Use digits, letters, spaces, - / . only'
    }
  }
  if (BANK_NAME_REQUIRED.includes(v.type) && !v.bankName) errors.bankName = 'Bank name is required'
  if (v.openingDate) {
    const day = parseDhakaDay(v.openingDate)
    if (!day || dhakaDayKey(day.start) !== v.openingDate) errors.openingDate = 'Use a valid date'
    else if (v.openingDate > dhakaDayKey(new Date())) errors.openingDate = 'Opening date cannot be in the future'
  }
  const allowNegative = v.allowNegative ?? defaultAllowNegative(v.type)
  const opening = Number(v.openingBalance) || 0
  if (!allowNegative && opening < -(Number(v.creditLimit) || 0) - EPS) {
    errors.openingBalance = 'This account cannot go below its overdraft limit — allow overdraft first'
  }
  if (!CASH_ACCOUNT_TYPES.includes(v.type)) {
    v.custodianUserId = null
  }
  if (CASH_ACCOUNT_TYPES.includes(v.type)) v.isBankingChannel = false
  return errors
}

/** zod-like 422 response from a { field: message } map. */
export function crossErrorResponse(errors) {
  const fieldErrors = Object.fromEntries(Object.entries(errors).map(([k, m]) => [k, [m]]))
  const first = Object.values(errors)[0]
  return NextResponse.json({ error: first || 'Validation failed', details: { formErrors: [], fieldErrors } }, { status: 422 })
}

/**
 * Resolve the custodian user from a PeoplePicker employee id or a user id.
 * Returns undefined when neither key was sent (leave unchanged), null to clear.
 */
export async function resolveCustodian(data) {
  const hasEmp = Object.prototype.hasOwnProperty.call(data, 'custodianEmployeeId')
  const hasUser = Object.prototype.hasOwnProperty.call(data, 'custodianUserId')
  if (!hasEmp && !hasUser) return undefined
  if (data.custodianEmployeeId) {
    const emp = await Employee.findById(data.custodianEmployeeId).select('userId').lean()
    if (!emp?.userId) throw httpError(422, 'Custodian employee not found', { field: 'custodianEmployeeId' })
    return emp.userId
  }
  if (data.custodianUserId) {
    const user = await User.findById(data.custodianUserId).select('role isActive').lean()
    if (!user || !['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'].includes(user.role)) {
      throw httpError(422, 'Custodian must be a staff member', { field: 'custodianUserId' })
    }
    return user._id
  }
  return null
}

// ── Read model ───────────────────────────────────────────────────────────────

/** Number of ledger rows (any date) per account id. */
export async function transactionCounts(ids) {
  const out = new Map()
  if (!ids.length) return out
  const rows = await Transaction.aggregate([
    { $match: { accountId: { $in: ids } } },
    { $group: { _id: '$accountId', n: { $sum: 1 } } },
  ])
  for (const r of rows) out.set(String(r._id), r.n)
  return out
}

async function custodianMap(docs) {
  const userIds = [...new Set(docs.map(d => d.custodianUserId).filter(Boolean).map(String))]
  const out = new Map()
  if (!userIds.length) return out
  const [users, employees] = await Promise.all([
    User.find({ _id: { $in: userIds } }).select('name avatar').lean(),
    Employee.find({ userId: { $in: userIds } }).select('userId designation department').lean(),
  ])
  const empByUser = new Map(employees.map(e => [String(e.userId), e]))
  for (const u of users) {
    const emp = empByUser.get(String(u._id))
    out.set(String(u._id), {
      userId: String(u._id),
      employeeId: emp ? String(emp._id) : null,
      name: u.name,
      avatar: u.avatar ?? null,
      sub: emp ? [emp.designation, emp.department].filter(Boolean).join(' · ') : '',
    })
  }
  return out
}

async function inProgressMap(ids) {
  const out = new Map()
  if (!ids.length) return out
  const rows = await Reconciliation.find({ accountId: { $in: ids }, status: 'IN_PROGRESS' })
    .select('accountId statementDate statementBalance createdAt').lean()
  for (const r of rows) {
    out.set(String(r.accountId), {
      id: String(r._id),
      statementDate: r.statementDate,
      statementBalance: r.statementBalance,
      startedAt: r.createdAt,
    })
  }
  return out
}

/**
 * Plain, masked account objects with live balances:
 * { ...account, id, typeLabel, group, balance, clearedBalance, inflow, outflow, unclearedCount,
 *   lastTxDate, txCount, custodian, reconciliationInProgress, available }
 */
export async function enrichAccounts(session, docs) {
  if (!docs.length) return []
  const ids = docs.map(d => d._id)
  const [balances, counts, recon, custodians] = await Promise.all([
    getAccountBalances({ accountIds: ids }),
    transactionCounts(ids),
    inProgressMap(ids),
    custodianMap(docs),
  ])
  const rows = docs.map(d => {
    const id = String(d._id)
    const { _id, __v, ...rest } = d
    const b = balances.get(id)
    const opening = round2(Number(d.openingBalance) || 0)
    const balance = b?.balance ?? opening
    const allowNegative = d.allowNegative ?? defaultAllowNegative(d.type)
    const creditLimit = Number(d.creditLimit) || 0
    return {
      ...rest,
      id,
      currency: d.currency || 'BDT',
      custodianUserId: d.custodianUserId ? String(d.custodianUserId) : null,
      createdBy: d.createdBy ? String(d.createdBy) : null,
      typeLabel: accountTypeLabel(d.type),
      group: accountTypeGroup(d.type),
      allowNegative,
      creditLimit,
      openingBalance: opening,
      balance,
      clearedBalance: b?.clearedBalance ?? opening,
      inflow: b?.inflow ?? 0,
      outflow: b?.outflow ?? 0,
      unclearedCount: b?.unclearedCount ?? 0,
      lastTxDate: b?.lastTxDate ?? null,
      txCount: counts.get(id) ?? 0,
      // Spendable before the overdraft guard refuses a payment (null = unlimited).
      available: allowNegative ? null : round2(balance + creditLimit),
      custodian: d.custodianUserId ? (custodians.get(String(d.custodianUserId)) ?? null) : null,
      reconciliationInProgress: recon.get(id) ?? null,
    }
  })
  return maskList(session, rows, MONEY_ACCOUNT_PII)
}

/** One account (lean) + enrichment, or null. */
export async function loadAccount(session, id) {
  if (!isValidObjectId(id)) return null
  const doc = await MoneyAccount.findById(id).lean()
  if (!doc) return null
  const [row] = await enrichAccounts(session, [doc])
  return row
}

const GROUP_KEYS = ['bank', 'cash', 'mfs', 'other']

/**
 * Header totals over ACTIVE accounts. BDT accounts roll up into `bdt`
 * (by group); other currencies are listed per currency and excluded from the BDT total.
 */
export function computeTotals(rows) {
  const active = rows.filter(r => r.status === 'ACTIVE')
  const bdt = { total: 0, cleared: 0, bank: 0, cash: 0, mfs: 0, other: 0, accountCount: 0 }
  const groupCounts = { bank: 0, cash: 0, mfs: 0, other: 0 }
  const foreign = new Map()
  let negativeCount = 0
  let unclearedCount = 0
  let neverReconciled = 0
  for (const r of active) {
    const g = GROUP_KEYS.includes(r.group) ? r.group : 'other'
    if (r.balance < -EPS) negativeCount += 1
    unclearedCount += r.unclearedCount || 0
    if (!r.lastReconciledDate && g !== 'cash') neverReconciled += 1
    if ((r.currency || 'BDT') === 'BDT') {
      groupCounts[g] += 1 // BDT accounts only — these feed the BDT group tiles
      bdt.total += r.balance
      bdt.cleared += r.clearedBalance
      bdt[g] += r.balance
      bdt.accountCount += 1
    } else {
      const f = foreign.get(r.currency) ?? { currency: r.currency, total: 0, cleared: 0, accountCount: 0, accounts: [] }
      f.total += r.balance
      f.cleared += r.clearedBalance
      f.accountCount += 1
      f.accounts.push({ id: r.id, name: r.name, balance: r.balance })
      foreign.set(r.currency, f)
    }
  }
  for (const k of Object.keys(bdt)) if (k !== 'accountCount') bdt[k] = round2(bdt[k])
  return {
    baseCurrency: 'BDT',
    bdt,
    groupCounts,
    foreign: [...foreign.values()].map(f => ({ ...f, total: round2(f.total), cleared: round2(f.cleared) }))
      .sort((a, b) => a.currency.localeCompare(b.currency)),
    activeCount: active.length,
    foreignCount: active.length - bdt.accountCount,
    archivedCount: rows.length - active.length,
    negativeCount,
    unclearedCount,
    neverReconciled,
  }
}

/** Fields that are safe to put in the audit log diff (account numbers are summarised). */
const LOGGED_FIELDS = [
  'name', 'code', 'type', 'bankName', 'branchName', 'accountName', 'swiftCode', 'mfsProvider', 'walletType',
  'currency', 'openingBalance', 'openingDate', 'openingReference', 'isBankingChannel', 'allowNegative',
  'creditLimit', 'custodianUserId', 'linkedPaymentMethods', 'isDefault', 'status', 'color', 'notes',
]

function comparable(v) {
  if (v === undefined || v === null || v === '') return null
  if (v instanceof Date) return dhakaDayKey(v)
  if (v instanceof mongoose.Types.ObjectId) return String(v)
  if (Array.isArray(v)) return JSON.stringify(v.map(String))
  return v
}

/** { field: { from, to } } for changed fields between two plain account objects. */
export function diffAccount(before, after) {
  const changes = {}
  for (const f of LOGGED_FIELDS) {
    const a = comparable(before?.[f])
    const b = comparable(after?.[f])
    if (JSON.stringify(a) !== JSON.stringify(b)) changes[f] = { from: a, to: b }
  }
  if (String(before?.accountNumber ?? '') !== String(after?.accountNumber ?? '')) {
    changes.accountNumber = { from: before?.last4 ? `••${before.last4}` : null, to: after?.last4 ? `••${after.last4}` : null }
  }
  if (String(before?.routingNumber ?? '') !== String(after?.routingNumber ?? '')) {
    changes.routingNumber = 'changed'
  }
  return changes
}

/** Dhaka day key of a stored date (or null). */
export function dayKeyOrNull(d) {
  if (!d) return null
  const date = new Date(d)
  return Number.isNaN(date.getTime()) ? null : dhakaDayKey(date)
}
