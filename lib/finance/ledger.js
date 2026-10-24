/**
 * lib/finance/ledger.js — SERVER-ONLY money ledger.
 *
 * `Transaction` is both the cash ledger (rows with accountId move money in a
 * MoneyAccount) and the P&L source (rows whose kind is in PL_KINDS). Every new
 * money row should be written through postMoneyEntry() so locks, go-live
 * rules, account currency and overdraft limits are enforced in one place.
 *
 * Errors thrown here carry `.status` (400 / 404 / 409 / 422) for routes:
 *   catch (err) { if (err.status) return NextResponse.json({ error: err.message }, { status: err.status }) … }
 *
 * Re-exports every pure helper from ./constants.
 */

import { randomUUID } from 'crypto'
import mongoose from 'mongoose'
import connectDB from '@/lib/mongodb'
import { MoneyAccount, Project, Transaction } from '@/models'
import { isValidObjectId } from '@/lib/objectId'
import { COMPANY_UNIT, parseUnit, ventureUnit } from '@/lib/units'
import { dhakaDayStart, dhakaDayKey, parseDhakaDay } from '@/lib/dhakaTime'
import { formatMoney } from '@/lib/currencies'
import { assertBooksOpen, requireAccountIfLive } from './settings'
import { dayKeyLabel } from './fiscal'
import {
  TX_KINDS, PL_KINDS, CASH_ACCOUNT_TYPES,
  computeAccountAmount, channelFromPaymentMethod, normalizeChannel, accountAmountOf,
} from './constants'

export * from './constants'

const EPS = 0.005
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

function ledgerError(message, status = 422, extra = null) {
  const err = new Error(message)
  err.status = status
  if (extra) Object.assign(err, extra)
  return err
}

function finiteOrNull(v) {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

function idOf(v) {
  if (v === null || v === undefined || v === '') return null
  return v?._id ?? v
}

function toObjectId(v) {
  const raw = idOf(v)
  if (raw === null) return null
  if (raw instanceof mongoose.Types.ObjectId) return raw
  return isValidObjectId(raw) ? new mongoose.Types.ObjectId(String(raw)) : null
}

/** Date | 'YYYY-MM-DD' (Dhaka midnight) | ISO string → Date, else null. */
function toDate(value) {
  if (value === null || value === undefined || value === '') return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  if (typeof value === 'string') {
    const day = parseDhakaDay(value)
    if (day) return day.start
  }
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Start of the Dhaka day for a filter bound (string or Date). */
function dayStartOf(value) {
  if (typeof value === 'string') {
    const day = parseDhakaDay(value)
    if (day) return day.start
  }
  const d = toDate(value)
  return d ? dhakaDayStart(d) : null
}

/** Start of the Dhaka day AFTER `value` (exclusive upper bound). */
function dayNextOf(value) {
  if (typeof value === 'string') {
    const day = parseDhakaDay(value)
    if (day) return day.next
  }
  const d = toDate(value)
  return d ? dhakaDayStart(d, 1) : null
}

const num = (field) => ({ $convert: { input: `$${field}`, to: 'double', onError: 0, onNull: 0 } })
const numOrNull = (field) => ({ $convert: { input: `$${field}`, to: 'double', onError: null, onNull: null } })

/**
 * Aggregation expression for a row's magnitude in its account's currency —
 * the $-equivalent of constants.accountAmountOf(): accountAmount when stored;
 * else amount when the row currency matches the account; else amountBDT ?? amount.
 * `accountCurrency` is a literal or an expression resolving to the account's currency.
 */
function accountValueExpr(accountCurrency) {
  return {
    $let: {
      vars: { aa: numOrNull('accountAmount') },
      in: {
        $cond: [
          { $ne: ['$$aa', null] },
          '$$aa',
          {
            $cond: [
              { $eq: [{ $ifNull: ['$currency', 'BDT'] }, accountCurrency] },
              num('amount'),
              { $ifNull: [numOrNull('amountBDT'), num('amount')] },
            ],
          },
        ],
      },
    },
  }
}

const CLEARED_STATES = ['CLEARED', 'RECONCILED']

/** Sum inflow/outflow (account currency) over rows matching `match` for one account. */
async function sumFlows(match, accountCurrency) {
  const [row] = await Transaction.aggregate([
    { $match: match },
    { $project: { type: 1, v: accountValueExpr({ $literal: accountCurrency || 'BDT' }) } },
    { $group: {
      _id: null,
      inflow:  { $sum: { $cond: [{ $eq: ['$type', 'INCOME'] }, '$v', 0] } },
      outflow: { $sum: { $cond: [{ $eq: ['$type', 'EXPENSE'] }, '$v', 0] } },
      count:   { $sum: 1 },
    } },
  ])
  return { inflow: round2(row?.inflow ?? 0), outflow: round2(row?.outflow ?? 0), count: row?.count ?? 0 }
}

function normalizeCheque(cheque) {
  if (!cheque || typeof cheque !== 'object') return null
  const no   = cheque.no == null ? '' : String(cheque.no).trim()
  const bank = cheque.bank == null ? '' : String(cheque.bank).trim()
  const date = toDate(cheque.date)
  if (!no && !bank && !date) return null
  return { no: no || null, date: date ?? null, bank: bank || null }
}

// Fields postMoneyEntry computes itself or that must never come from callers.
const RESERVED_FIELDS = new Set([
  '_id', 'id', '__v', 'createdAt', 'updatedAt',
  'type', 'kind', 'category', 'amount', 'currency', 'amountBDT', 'date', 'description',
  'accountId', 'accountAmount', 'channel', 'plAmountBDT', 'cheque', 'createdBy',
  'clearStatus', 'clearedDate', 'reconciliationId', 'unit',
])

/** The caller's unit, trimmed: a string ⇒ it; undefined / null / '' ⇒ null (resolve it). */
function givenUnit(data) {
  const raw = data.unit
  if (raw === undefined || raw === null || raw === '') return null
  const unit = typeof raw === 'string' ? raw.trim() : raw
  if (!parseUnit(unit)) throw ledgerError(`Unknown venture / product: ${String(raw)}`, 422, { field: 'unit' })
  return unit
}

/**
 * Business unit (lib/units.js) of a new row: the caller's string as given; else
 * the project's venture (projectId); else COMPANY. Never null, except that the
 * mirror of an old Unassigned row (reversalOf with unit null) stays Unassigned
 * so the pair nets to zero there.
 */
async function resolveUnit(data, given) {
  if (given) return given
  if (data.reversalOf && data.unit === null) return null
  const projectId = toObjectId(data.projectId)
  if (projectId) {
    const project = await Project.findById(projectId).select('venture').lean()
    const unit = ventureUnit(project?.venture)
    if (unit) return unit
  }
  return COMPANY_UNIT
}

// ─────────────────────────────────────────────────────────────────────────────
// Balances & statements
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Balances per money account, from ONE aggregation over Transaction.
 * Rows count when they carry the account's id and are dated on/after the
 * account's openingDate (when set) and before the day after `asOf` (when set).
 *
 * @param {{ accountIds?: Array<string|ObjectId>|null, asOf?: Date|string|null }} [opts]
 * @returns {Promise<Map<string, { balance, inflow, outflow, count, clearedBalance, unclearedCount, lastTxDate, openingBalance, currency }>>}
 *   keyed by account id string; every requested account is present (zero rows ⇒ balance = openingBalance).
 */
export async function getAccountBalances({ accountIds = null, asOf = null } = {}) {
  await connectDB()
  const result = new Map()

  const accountFilter = {}
  if (accountIds !== null && accountIds !== undefined) {
    const list = (Array.isArray(accountIds) ? accountIds : [accountIds]).map(toObjectId).filter(Boolean)
    if (!list.length) return result
    accountFilter._id = { $in: list }
  }
  const accounts = await MoneyAccount.find(accountFilter).select('openingBalance openingDate currency').lean()
  if (!accounts.length) return result

  let asOfNext = null
  if (asOf !== null && asOf !== undefined && asOf !== '') {
    asOfNext = dayNextOf(asOf)
    if (!asOfNext) throw ledgerError('Invalid as-of date', 422)
  }

  const branches = []
  const withoutOpening = []
  for (const a of accounts) {
    if (a.openingDate) {
      const date = { $gte: dhakaDayStart(a.openingDate) }
      if (asOfNext) date.$lt = asOfNext
      branches.push({ accountId: a._id, date })
    } else {
      withoutOpening.push(a._id)
    }
  }
  if (withoutOpening.length) {
    const branch = { accountId: withoutOpening.length === 1 ? withoutOpening[0] : { $in: withoutOpening } }
    if (asOfNext) branch.date = { $lt: asOfNext }
    branches.push(branch)
  }
  const match = branches.length === 1 ? branches[0] : { $or: branches }

  // Account currency per row: literal 'BDT' unless some account is foreign.
  const foreign = accounts.filter(a => (a.currency || 'BDT') !== 'BDT')
  const accountCurrency = foreign.length
    ? { $switch: { branches: foreign.map(a => ({ case: { $eq: ['$accountId', a._id] }, then: { $literal: a.currency } })), default: 'BDT' } }
    : { $literal: 'BDT' }

  const rows = await Transaction.aggregate([
    { $match: match },
    { $project: {
      accountId: 1, type: 1, date: 1,
      v: accountValueExpr(accountCurrency),
      cleared: { $in: [{ $ifNull: ['$clearStatus', 'UNCLEARED'] }, CLEARED_STATES] },
    } },
    { $addFields: {
      inV:  { $cond: [{ $eq: ['$type', 'INCOME'] }, '$v', 0] },
      outV: { $cond: [{ $eq: ['$type', 'EXPENSE'] }, '$v', 0] },
    } },
    { $group: {
      _id:            '$accountId',
      inflow:         { $sum: '$inV' },
      outflow:        { $sum: '$outV' },
      count:          { $sum: 1 },
      clearedIn:      { $sum: { $cond: ['$cleared', '$inV', 0] } },
      clearedOut:     { $sum: { $cond: ['$cleared', '$outV', 0] } },
      unclearedCount: { $sum: { $cond: ['$cleared', 0, 1] } },
      lastTxDate:     { $max: '$date' },
    } },
  ])
  const byId = new Map(rows.map(r => [String(r._id), r]))

  for (const a of accounts) {
    const id = String(a._id)
    const r = byId.get(id)
    const opening = Number(a.openingBalance) || 0
    const inflow  = round2(r?.inflow ?? 0)
    const outflow = round2(r?.outflow ?? 0)
    result.set(id, {
      balance:        round2(opening + inflow - outflow),
      inflow,
      outflow,
      count:          r?.count ?? 0,
      clearedBalance: round2(opening + (r?.clearedIn ?? 0) - (r?.clearedOut ?? 0)),
      unclearedCount: r?.unclearedCount ?? 0,
      lastTxDate:     r?.lastTxDate ?? null,
      openingBalance: round2(opening),
      currency:       a.currency || 'BDT',
    })
  }
  return result
}

function serializeAccount(account) {
  if (!account) return null
  const { _id, __v, ...rest } = account
  return { ...rest, id: String(_id) }
}

/**
 * Account statement for a date range (Dhaka days, inclusive).
 *
 * @param {string} accountId
 * @param {{ startDate?: string|Date, endDate?: string|Date, page?: number, limit?: number }} [opts]
 * @returns {Promise<{ account, openingBalance, closingBalance, totals:{inflow,outflow}, rows, meta:{page,limit,total,pages}, openingDate, preOpeningCount }>}
 *   openingBalance = balance at the start of the range (account opening + rows from openingDate up to startDate).
 *   rows: [{ ...tx, id, inAmount, outAmount, running, excluded }] oldest first; rows dated before the
 *   account's openingDate are listed with excluded:true and do not move the running balance.
 */
export async function getAccountStatement(accountId, { startDate = null, endDate = null, page = 1, limit = 100 } = {}) {
  await connectDB()
  if (!isValidObjectId(idOf(accountId))) throw ledgerError('Not found', 404)
  const account = await MoneyAccount.findById(idOf(accountId)).lean()
  if (!account) throw ledgerError('Not found', 404)

  const aid = account._id
  const currency = account.currency || 'BDT'
  const openingDate = account.openingDate ? dhakaDayStart(account.openingDate) : null

  const start = startDate ? dayStartOf(startDate) : null
  if (startDate && !start) throw ledgerError('Invalid start date', 422)
  const endNext = endDate ? dayNextOf(endDate) : null
  if (endDate && !endNext) throw ledgerError('Invalid end date', 422)
  if (start && endNext && start >= endNext) throw ledgerError('Start date must be on or before the end date', 422)

  const pg  = Math.max(1, parseInt(page, 10) || 1)
  const lim = Math.min(1000, Math.max(1, parseInt(limit, 10) || 100))
  const skip = (pg - 1) * lim

  // Rows shown: everything in the requested range (pre-opening rows flagged).
  const rangeFilter = { accountId: aid }
  if (start || endNext) {
    rangeFilter.date = {}
    if (start) rangeFilter.date.$gte = start
    if (endNext) rangeFilter.date.$lt = endNext
  }

  // Rows that count: in range AND on/after the opening date.
  const countedStart = start && openingDate ? (start > openingDate ? start : openingDate) : (start ?? openingDate)
  const countedFilter = { accountId: aid }
  if (countedStart || endNext) {
    countedFilter.date = {}
    if (countedStart) countedFilter.date.$gte = countedStart
    if (endNext) countedFilter.date.$lt = endNext
  }

  // Balance before the range: opening + counted rows in [openingDate, start).
  const openingBase = Number(account.openingBalance) || 0
  let openingBalance = round2(openingBase)
  if (start && (!openingDate || start > openingDate)) {
    const before = { accountId: aid, date: { $lt: start } }
    if (openingDate) before.date.$gte = openingDate
    const f = await sumFlows(before, currency)
    openingBalance = round2(openingBase + f.inflow - f.outflow)
  }

  const sort = { date: 1, createdAt: 1, _id: 1 }
  const [total, rangeFlows, preOpeningCount, docs] = await Promise.all([
    Transaction.countDocuments(rangeFilter),
    sumFlows(countedFilter, currency),
    openingDate ? Transaction.countDocuments({ accountId: aid, date: { $lt: openingDate } }) : Promise.resolve(0),
    Transaction.find(rangeFilter)
      .sort(sort)
      .skip(skip)
      .limit(lim)
      .populate('counterAccountId', 'name type currency last4')
      .populate('createdBy', 'name')
      .lean(),
  ])

  // Running balance at the top of this page = opening + counted rows on earlier pages.
  let running = openingBalance
  if (skip > 0) {
    const pipeline = [
      { $match: rangeFilter },
      { $sort: sort },
      { $limit: skip },
    ]
    if (openingDate) pipeline.push({ $match: { date: { $gte: openingDate } } })
    pipeline.push(
      { $project: { type: 1, v: accountValueExpr({ $literal: currency }) } },
      { $group: {
        _id: null,
        inflow:  { $sum: { $cond: [{ $eq: ['$type', 'INCOME'] }, '$v', 0] } },
        outflow: { $sum: { $cond: [{ $eq: ['$type', 'EXPENSE'] }, '$v', 0] } },
      } },
    )
    const [prior] = await Transaction.aggregate(pipeline)
    running = round2(openingBalance + (prior?.inflow ?? 0) - (prior?.outflow ?? 0))
  }

  const rows = docs.map(tx => {
    const v = round2(accountAmountOf(tx, account))
    const excluded = !!(openingDate && tx.date && new Date(tx.date) < openingDate)
    const inAmount  = tx.type === 'INCOME' ? v : 0
    const outAmount = tx.type === 'EXPENSE' ? v : 0
    if (!excluded) running = round2(running + inAmount - outAmount)
    return { ...tx, id: String(tx._id), inAmount, outAmount, running, excluded }
  })

  return {
    account:         serializeAccount(account),
    openingDate:     account.openingDate ?? null,
    openingBalance,
    closingBalance:  round2(openingBalance + rangeFlows.inflow - rangeFlows.outflow),
    totals:          { inflow: rangeFlows.inflow, outflow: rangeFlows.outflow },
    preOpeningCount,
    rows,
    meta: { page: pg, limit: lim, total, pages: Math.ceil(total / lim) },
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Posting
// ─────────────────────────────────────────────────────────────────────────────

/** Overdraft guard for an OUT movement: throws 409 when the account would breach its limit. */
async function assertFunds(account, outAmount) {
  if (account.allowNegative !== false) return
  const bal = (await getAccountBalances({ accountIds: [account._id] })).get(String(account._id))
  const balance = bal?.balance ?? (Number(account.openingBalance) || 0)
  const limit = Number(account.creditLimit) || 0
  if (balance - outAmount < -limit - EPS) {
    throw ledgerError(
      `Insufficient balance in ${account.name}: available ${formatMoney(balance + limit, account.currency || 'BDT')}`,
      409,
      { code: 'INSUFFICIENT_FUNDS', available: round2(balance + limit) },
    )
  }
}

/**
 * Create one Transaction row with all ledger rules applied.
 *
 * data = Transaction fields: { type, kind?, category, amount, currency?, amountBDT?, date,
 *   accountId?|null, description, plAmountBDT?, channel?, paymentMethod?, cheque?, tax?,
 *   accountAmount? (explicit, account currency), counterAccountId?, transferId?, unit?, ...links }
 *
 * Rules: books lock (assertBooksOpen) unless allowLocked; go-live ⇒ accountId required
 * (except NON_CASH); NON_CASH rows never carry an account; account must exist & be ACTIVE and
 * the date must not precede its openingDate; accountAmount via computeAccountAmount; channel
 * defaults from paymentMethod/account; accounts with allowNegative=false may not go below
 * −creditLimit; non-P&L kinds get plAmountBDT 0; BDT rows get amountBDT = amount.
 * unit (lib/units.js): a 'VENTURE:<id>' / 'PRODUCT:<id>' / 'COMPANY' string is stored as
 * given (its shape is checked, not the config — routes validate a person's choice with
 * isValidUnit); absent ⇒ VENTURE:<project.venture> when projectId names a project with a
 * venture, else COMPANY.
 *
 * Throws Error with .status 409 (locked, archived account, insufficient funds, duplicate txnId —
 * the original Mongo error is rethrown with .status so `err.code === 11000` still works) or 422.
 * `dryRun` (use preflightMoneyEntry): run every check above and stop before writing — returns null.
 * @returns {Promise<import('mongoose').Document>} the saved Transaction document
 */
export async function postMoneyEntry(data = {}, { userId = null, allowLocked = false, skipAccountRequirement = false, dryRun = false } = {}) {
  await connectDB()
  if (!data || typeof data !== 'object') throw ledgerError('Transaction data is required')

  const type = String(data.type ?? '').trim().toUpperCase()
  if (type !== 'INCOME' && type !== 'EXPENSE') throw ledgerError('Transaction type must be INCOME or EXPENSE')

  const kind = data.kind ? String(data.kind).trim().toUpperCase() : 'OPERATING'
  if (!TX_KINDS.includes(kind)) throw ledgerError(`Unknown transaction kind: ${data.kind}`)

  const category = typeof data.category === 'string' ? data.category.trim() : ''
  if (!category) throw ledgerError('Category is required')

  const date = toDate(data.date)
  if (!date) throw ledgerError('A valid date is required')

  const unitGiven = givenUnit(data)

  const rawAmount = finiteOrNull(data.amount)
  if (rawAmount === null || rawAmount < 0) throw ledgerError('Amount must be a positive number')
  const amount = round2(rawAmount)

  const currency = String(data.currency || 'BDT').trim().toUpperCase()
  let amountBDT = finiteOrNull(data.amountBDT)
  if (amountBDT !== null) {
    if (amountBDT < 0) throw ledgerError('BDT amount cannot be negative')
    amountBDT = round2(amountBDT)
  } else if (currency === 'BDT') {
    amountBDT = amount
  }

  const accountRef = idOf(data.accountId)
  if (kind === 'NON_CASH' && accountRef) throw ledgerError('Non-cash entries cannot be posted to a money account')
  if (kind === 'NON_CASH' && amountBDT === null) throw ledgerError('Non-cash entries need a BDT amount')
  if (kind === 'TRANSFER' && !accountRef) throw ledgerError('Transfers need a money account')
  if (accountRef && !(amount > 0)) throw ledgerError('Amount must be greater than zero')
  // Money cannot move on a day that has not happened yet — a future row would sit in
  // today's balances (getAccountBalances has no upper bound) and in assertFunds.
  if (accountRef && dhakaDayKey(date) > dhakaDayKey(new Date())) {
    throw ledgerError('The date cannot be in the future', 422, { field: 'date' })
  }

  if (!allowLocked) {
    const locked = await assertBooksOpen(date)
    if (locked) throw ledgerError(locked, 409, { code: 'BOOKS_LOCKED' })
  }
  // skipAccountRequirement: internal — set only by reverseMoneyEntry for the mirror of a
  // pre-go-live row that never had an account (it moves no cash, so it needs none).
  if (kind !== 'NON_CASH' && !skipAccountRequirement) {
    const missing = await requireAccountIfLive(date, accountRef)
    if (missing) throw ledgerError(missing, 422, { code: 'ACCOUNT_REQUIRED', field: 'accountId' })
  }

  // P&L amount
  let plAmount = finiteOrNull(data.plAmountBDT)
  if (!PL_KINDS.includes(kind)) {
    plAmount = 0
  } else if (plAmount !== null) {
    if (plAmount < -EPS) throw ledgerError('P&L amount cannot be negative')
    plAmount = Math.max(0, round2(plAmount))
  } else if (kind === 'NON_CASH') {
    plAmount = amountBDT
  }

  // Money account
  let account = null
  let accountAmount = null
  let channel = normalizeChannel(data.channel)
  if (accountRef) {
    if (!isValidObjectId(accountRef)) throw ledgerError('Invalid money account', 422, { field: 'accountId' })
    account = await MoneyAccount.findById(accountRef).lean()
    if (!account) throw ledgerError('Money account not found', 422, { field: 'accountId' })
    if (account.status !== 'ACTIVE') throw ledgerError(`${account.name} is archived — choose an active account`, 409, { field: 'accountId' })
    if (account.openingDate && date < dhakaDayStart(account.openingDate)) {
      throw ledgerError(
        `Date is before ${account.name}'s opening balance date (${dayKeyLabel(account.openingDate)}) — earlier movements are already in its opening balance`,
        422, { field: 'date' },
      )
    }
    const explicit = finiteOrNull(data.accountAmount)
    accountAmount = explicit !== null && explicit > 0
      ? round2(explicit)
      : round2(computeAccountAmount({ account, amount, currency, amountBDT }))
    if (!channel) channel = channelFromPaymentMethod(data.paymentMethod, account)
    if (type === 'EXPENSE') await assertFunds(account, accountAmount)
  } else if (!channel && kind !== 'NON_CASH' && data.paymentMethod) {
    channel = channelFromPaymentMethod(data.paymentMethod, null)
  }
  if (dryRun) return null

  // Remaining caller fields (links, references, tax breakdown…); '' ⇒ null.
  const extra = {}
  for (const [k, v] of Object.entries(data)) {
    if (RESERVED_FIELDS.has(k) || v === undefined) continue
    extra[k] = v === '' ? null : v
  }

  const description = (data.description == null ? '' : String(data.description).trim()) || category
  const clearStatus = data.clearStatus === 'CLEARED' && account ? 'CLEARED' : 'UNCLEARED'
  const unit = await resolveUnit(data, unitGiven)

  const tx = new Transaction({
    ...extra,
    type,
    kind,
    category,
    amount,
    currency,
    amountBDT,
    date,
    description,
    accountId:     account?._id ?? null,
    accountAmount,
    channel,
    plAmountBDT:   plAmount,
    cheque:        normalizeCheque(data.cheque),
    unit,
    clearStatus,
    clearedDate:   clearStatus === 'CLEARED' ? (toDate(data.clearedDate) ?? date) : null,
    createdBy:     idOf(data.createdBy) ?? userId ?? null,
  })

  try {
    await tx.save()
  } catch (err) {
    if (err?.code === 11000) {
      err.status = 409
      if (err.keyPattern?.txnId || /txnId/.test(String(err.message))) err.message = 'Transaction ID already exists'
      else if (err.keyPattern?.reversalOf || /reversalOf/.test(String(err.message))) err.message = 'This entry has already been reversed'
    } else if (err?.name === 'ValidationError' || err?.name === 'CastError') {
      err.status = 422
    }
    throw err
  }

  // Concurrency guard: two simultaneous withdrawals may both pass assertFunds.
  if (account && type === 'EXPENSE' && account.allowNegative === false) {
    try {
      await assertFunds(account, 0)
    } catch (err) {
      await Transaction.deleteOne({ _id: tx._id }).catch(e => console.error('[ledger] compensating delete failed', e))
      throw err
    }
  }

  return tx
}

/**
 * The checks postMoneyEntry(data, opts) would apply — books lock, go-live account
 * requirement, account exists / ACTIVE / opening date, currency, overdraft — without
 * writing anything. For flows that must refuse BEFORE they create other records
 * (e.g. a numbered credit note). Throws exactly what postMoneyEntry would throw.
 * @returns {Promise<null>}
 */
export async function preflightMoneyEntry(data = {}, opts = {}) {
  return postMoneyEntry(data, { ...opts, dryRun: true })
}

/**
 * Transfer between two money accounts: OUT leg (EXPENSE, kind TRANSFER) on the
 * source, IN leg (INCOME, kind TRANSFER) on the destination, sharing a
 * transferId; optional fee row (EXPENSE OPERATING 'Bank Charges') on the source.
 * Every row's unit is COMPANY.
 * Different currencies need `toAmount` (received amount in the destination
 * currency). Rows already written are deleted if a later one fails.
 *
 * @returns {Promise<{ transferId: string, legs: [outTx, inTx], feeTx: object|null }>}
 */
export async function createTransfer({
  fromAccountId, toAccountId, amount, toAmount = null, date = new Date(), fee = 0,
  channel = null, reference = null, description = null, cheque = null, userId = null, amountBDT = null,
  reversalOf = null,
} = {}) {
  await connectDB()
  const fromRef = idOf(fromAccountId)
  const toRef   = idOf(toAccountId)
  if (!isValidObjectId(fromRef) || !isValidObjectId(toRef)) throw ledgerError('Select both the source and destination accounts')
  if (String(fromRef) === String(toRef)) throw ledgerError('Choose two different accounts')

  const [from, to] = await Promise.all([MoneyAccount.findById(fromRef).lean(), MoneyAccount.findById(toRef).lean()])
  if (!from || !to) throw ledgerError('Money account not found', 422)
  if (from.status !== 'ACTIVE') throw ledgerError(`${from.name} is archived — choose an active account`, 409)
  if (to.status !== 'ACTIVE') throw ledgerError(`${to.name} is archived — choose an active account`, 409)

  const when = date === null || date === undefined || date === '' ? new Date() : toDate(date)
  if (!when) throw ledgerError('A valid date is required')

  const outAmt = round2(finiteOrNull(amount) ?? 0)
  if (!(outAmt > 0)) throw ledgerError('Amount must be greater than zero')
  const feeAmt = round2(finiteOrNull(fee) ?? 0)
  if (feeAmt < 0) throw ledgerError('Fee cannot be negative')

  const fromCur = from.currency || 'BDT'
  const toCur   = to.currency || 'BDT'
  let inAmt
  if (fromCur === toCur) {
    const given = finiteOrNull(toAmount)
    inAmt = given === null ? outAmt : round2(given)
    if (Math.abs(inAmt - outAmt) > EPS) throw ledgerError('Both accounts use the same currency, so the received amount must equal the amount sent')
  } else {
    inAmt = round2(finiteOrNull(toAmount) ?? 0)
    if (!(inAmt > 0)) throw ledgerError(`Enter the amount received in ${toCur}`, 422, { field: 'toAmount' })
  }

  // BDT value of the movement (same for both legs).
  let bdt = null
  if (fromCur === 'BDT') bdt = outAmt
  else if (toCur === 'BDT') bdt = inAmt
  else {
    bdt = finiteOrNull(amountBDT)
    if (bdt !== null) bdt = round2(bdt)
    // Neither side is BDT: without a BDT value the legs and the fee row would carry no
    // BDT figure and the fee would drop out of the P&L. A reversal copies its original's
    // value and is exempt, so a transfer saved without one can still be reversed.
    if (!(bdt > 0) && !reversalOf) {
      const msg = `Enter the BDT value of this ${fromCur} → ${toCur} transfer`
      throw ledgerError(msg, 422, { field: 'amountBDT', details: { formErrors: [], fieldErrors: { amountBDT: [msg] } } })
    }
  }
  const feeBDT = feeAmt > 0
    ? (fromCur === 'BDT' ? feeAmt : (bdt !== null ? round2(feeAmt * bdt / outAmt) : null))
    : 0

  // Check the whole outflow (amount + fee) up front for a clear message.
  if (from.allowNegative === false) await assertFunds(from, round2(outAmt + feeAmt))

  const ch = normalizeChannel(channel)
    ?? (CASH_ACCOUNT_TYPES.includes(from.type) || CASH_ACCOUNT_TYPES.includes(to.type) ? 'CASH' : 'INTERNAL')
  const ref  = reference == null || String(reference).trim() === '' ? null : String(reference).trim()
  const desc = (description == null ? '' : String(description).trim()) || `Transfer: ${from.name} → ${to.name}`
  const transferId = randomUUID()
  const chq = normalizeCheque(cheque)

  // Accounts are company-wide: both legs and the fee row belong to Company / shared.
  const common = { kind: 'TRANSFER', category: 'Transfer', date: when, transferId, reference: ref, channel: ch, cheque: chq, plAmountBDT: 0, unit: COMPANY_UNIT }
  const created = []
  try {
    const outTx = await postMoneyEntry({
      ...common,
      type: 'EXPENSE', accountId: from._id, counterAccountId: to._id,
      amount: outAmt, currency: fromCur, amountBDT: bdt, accountAmount: outAmt,
      description: desc,
      reversalOf: reversalOf?.out ?? null,
    }, { userId })
    created.push(outTx)

    const inTx = await postMoneyEntry({
      ...common,
      type: 'INCOME', accountId: to._id, counterAccountId: from._id,
      amount: inAmt, currency: toCur, amountBDT: bdt, accountAmount: inAmt,
      description: desc,
      reversalOf: reversalOf?.in ?? null,
    }, { userId })
    created.push(inTx)

    let feeTx = null
    if (feeAmt > 0) {
      feeTx = await postMoneyEntry({
        type: 'EXPENSE', kind: 'OPERATING', category: 'Bank Charges',
        date: when, transferId, reference: ref, channel: ch,
        accountId: from._id, counterAccountId: to._id,
        amount: feeAmt, currency: fromCur, amountBDT: feeBDT, accountAmount: feeAmt,
        plAmountBDT: feeBDT,
        unit: COMPANY_UNIT,
        description: `Transfer fee — ${desc}`,
      }, { userId })
      created.push(feeTx)
    }

    return { transferId, legs: [outTx, inTx], feeTx }
  } catch (err) {
    if (created.length) {
      await Transaction.deleteMany({ _id: { $in: created.map(d => d._id) } })
        .catch(e => console.error('[ledger] transfer compensating delete failed', transferId, e))
    }
    throw err
  }
}

/**
 * Post the mirror image of an existing row (opposite type, same kind/account/
 * amounts) linked via reversalOf — the ledger is immutable, so corrections are
 * reversals. Refuses rows that are already reversed or are themselves reversals.
 * A money-movement row's reversal keeps its movementKind (so it lists beside the
 * original); `movementId` groups the mirror rows of one movement reversal. The
 * mirror keeps the original's unit — null too (an old Unassigned row), so the pair
 * nets to zero in the same venture / product.
 * @returns {Promise<import('mongoose').Document>} the reversal Transaction
 */
export async function reverseMoneyEntry(transactionId, { userId = null, date = new Date(), reason = '', movementId = null } = {}) {
  await connectDB()
  if (!isValidObjectId(idOf(transactionId))) throw ledgerError('Not found', 404)
  const orig = await Transaction.findById(idOf(transactionId)).lean()
  if (!orig) throw ledgerError('Not found', 404)
  if (orig.reversalOf) throw ledgerError('This entry is itself a reversal', 409)
  if (await Transaction.exists({ reversalOf: orig._id })) throw ledgerError('This entry has already been reversed', 409)

  const note = reason ? String(reason).trim() : ''
  return postMoneyEntry({
    type:             orig.type === 'INCOME' ? 'EXPENSE' : 'INCOME',
    kind:             orig.kind || 'OPERATING',
    category:         orig.category,
    expenseCategory:  orig.expenseCategory ?? null,
    amount:           orig.amount,
    currency:         orig.currency || 'BDT',
    amountBDT:        orig.amountBDT,
    accountId:        orig.accountId ?? null,
    accountAmount:    orig.accountAmount ?? null,
    counterAccountId: orig.counterAccountId ?? null,
    plAmountBDT:      orig.plAmountBDT,
    channel:          orig.channel ?? null,
    date,
    description:      `Reversal of ${orig.txnId ?? orig._id}${note ? ` — ${note}` : ''}`,
    reference:        orig.reference ?? null,
    projectId:        orig.projectId ?? null,
    invoiceId:        orig.invoiceId ?? null,
    clientId:         orig.clientId ?? null,
    vendorId:         orig.vendorId ?? null,
    assetId:          orig.assetId ?? null,
    purchaseBillId:   orig.purchaseBillId ?? null,
    unit:             orig.unit ?? null,
    movementKind:     orig.movementKind ?? undefined,
    movementId:       movementId ?? undefined,
    reversalOf:       orig._id,
  }, { userId, skipAccountRequirement: !orig.accountId })
}
