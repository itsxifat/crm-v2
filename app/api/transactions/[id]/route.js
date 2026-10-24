export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Transaction, ProjectExpense, ProjectPayment } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { logActivity } from '@/lib/logActivity'
import { isValidCurrency, BASE_CURRENCY, formatMoney } from '@/lib/currencies'
import { isValidObjectId } from '@/lib/objectId'
import { dhakaDayKey } from '@/lib/dhakaTime'
import { assertBooksOpen, requireAccountIfLive } from '@/lib/finance/settings'
import {
  getAccountBalances, computeAccountAmount, accountAmountOf, channelFromPaymentMethod, normalizeChannel,
} from '@/lib/finance/ledger'
import {
  loadPostingAccount, parseBusinessDate, sameBusinessDay, httpErrorPayload, round2, reverseClientSettlement,
} from '@/lib/paymentLedger'
import { createNotification } from '@/lib/createNotification'
import { getConfig } from '@/lib/getConfig'
import { isValidUnit } from '@/lib/units'
import { financeScope } from '@/lib/finance/scope'
import { inScope } from '@/app/api/accounts/_lib/unitScope'
import { z } from 'zod'

const optStr = (max) => z.string().max(max).optional().nullable()

const updateSchema = z.object({
  type:        z.enum(['INCOME', 'EXPENSE']).optional(),
  category:    z.string().min(1).optional(),
  amount:      z.coerce.number().positive().optional(),
  description: z.string().min(1).optional(),
  date:        z.string().optional(),
  reference:       z.string().optional().nullable(),
  currency:        z.string().optional(),
  amountBDT:       z.coerce.number().positive().optional().nullable(),
  expenseCategory: z.string().optional().nullable(),  // subcategory
  paymentMethod:    z.string().optional().nullable(),
  projectId:        z.string().optional().nullable(),
  invoiceId:        z.string().optional().nullable(),
  clientId:         z.string().optional().nullable(),
  vendorId:         z.string().optional().nullable(),
  vendor:           z.string().optional().nullable(),
  freelancerId:     z.string().optional().nullable(),
  agencyId:         z.string().optional().nullable(),
  paidToEmployeeId: z.string().optional().nullable(),
  paidToName:       z.string().optional().nullable(),
  paidBy:           z.string().optional().nullable(),
  accountManager:   z.string().optional().nullable(),
  receiptUrl:       z.string().optional().nullable(),
  // The ledger id is immutable; accepted only so an unchanged value can be echoed back.
  txnId:            z.string().optional().nullable(),
  // Money account: may be set on rows that have none (legacy), or moved on
  // unlinked, unreconciled rows. accountAmount is always recomputed here.
  accountId:        optStr(64),
  // Only OPERATING is accepted (manual income); other kinds are system rows.
  kind:             z.enum(['OPERATING']).optional().nullable(),
  channel:          optStr(40),
  cheque:           z.object({ no: optStr(60), date: optStr(40), bank: optStr(120) }).optional().nullable(),
  // Business unit (venture / product / Company): re-tagged under the rules of
  // planRetag below, never cleared (an empty value leaves it as it is).
  unit:             optStr(80),
})

// Fields that drive side effects on linked records (invoice paidAmount/status,
// project paidAmount/approvedExpenses, expense/payment records). They cannot be
// changed on a linked row, because a bare update would not re-sync those records.
const LINKED_LOCKED_FIELDS = ['type', 'amount', 'currency', 'amountBDT', 'invoiceId', 'projectId']

// System rows (transfers, tax-linked settlements, asset & depreciation postings,
// reversals, non-operating kinds) additionally keep their date.
const SYSTEM_LOCKED_FIELDS = [...LINKED_LOCKED_FIELDS, 'date']

// Fields that define the bank-statement line of a cleared / reconciled row (or
// one ticked in a reconciliation in progress).
const RECONCILED_LOCKED_FIELDS = ['type', 'kind', 'amount', 'accountAmount', 'amountBDT', 'currency', 'date', 'accountId']

// Fields that may still be edited inside a locked (closed) period.
const LOCK_EXEMPT_FIELDS = ['description', 'reference', 'receiptUrl', 'accountManager', 'paidBy']

const POPULATE = [
  { path: 'paidBy',         select: 'name avatar' },
  { path: 'accountManager', select: 'name avatar' },
  { path: 'createdBy',      select: 'name' },
  { path: 'projectId',      select: 'name projectCode venture' },
  { path: 'accountId',      select: 'name type last4 currency bankName mfsProvider' },
  { path: 'counterAccountId', select: 'name type last4 currency' },
]

const idStr = v => (v == null || v === '' ? null : String(v?._id ?? v))

const fail = (error, status, extra = {}) => NextResponse.json({ error, ...extra }, { status })

/**
 * Re-tag an entry to another business unit (lib/units.js). Allowed in open
 * periods; in a locked period only while the entry is Unassigned (null). The
 * other half of a reversal pair moves with it, so the unit's P&L still nets to
 * zero, under the same rules. Users who see only their own venture can move
 * entries only between units they see.
 * @returns {Promise<{ rows: object[] } | { error: NextResponse }>} rows = entries whose unit changes
 */
async function planRetag(existing, unit, scope) {
  if (!isValidUnit(unit, await getConfig())) return { error: fail('Unknown venture or product', 422, { field: 'unit' }) }
  if (!inScope(scope, unit)) return { error: fail('You can only assign entries to your own venture.', 403, { field: 'unit' }) }

  const paired = await Transaction.find({
    $or: [{ reversalOf: existing._id }, ...(existing.reversalOf ? [{ _id: existing.reversalOf }] : [])],
  }).select('txnId date unit').lean()
  const rows = [existing, ...paired].filter(r => (r.unit ?? null) !== unit)
  for (const r of rows) {
    const which = r === existing ? 'This entry' : `Its paired ${existing.reversalOf ? 'original' : 'reversal'} entry ${r.txnId ?? ''}`.trim()
    if (!inScope(scope, r.unit ?? null)) return { error: fail(`${which} belongs to a venture you cannot see; ask a finance administrator to change it.`, 403) }
    if (r.unit == null) continue
    const locked = await assertBooksOpen(r.date)
    if (locked) {
      return { error: fail(`${locked} — ${which.charAt(0).toLowerCase()}${which.slice(1)} already has a venture / product, which cannot be changed in a locked period.`, 409, { code: 'BOOKS_LOCKED', field: 'unit' }) }
    }
  }
  return { rows }
}

function normalizeChequeInput(cheque) {
  if (!cheque) return null
  const no = cheque.no?.trim() || null
  const bank = cheque.bank?.trim() || null
  const date = cheque.date ? parseBusinessDate(cheque.date) : null
  if (cheque.date && !date) return undefined // invalid
  if (!no && !bank && !date) return null
  return { no, date, bank }
}

// GET /api/transactions/[id]
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'finance.transactions.view')   // financial record
    if (denied) return denied

    if (!isValidObjectId(params.id)) return fail('Not found', 404)

    await connectDB()

    const transaction = await Transaction.findById(params.id).populate(POPULATE)
    if (!transaction) return fail('Not found', 404)
    // Outside the viewer's finance scope (another venture) ⇒ as if it did not exist.
    if (!inScope(await financeScope(session), transaction.unit ?? null)) return fail('Not found', 404)

    return NextResponse.json({ data: transaction })
  } catch (err) {
    console.error('[GET /api/transactions/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/transactions/[id]
// Body: any subset of the schema above. Money-account rules:
//  - accountId can be set on rows without one (legacy rows, incl. linked payment rows)
//    unless the row is NON_CASH / a system row or reconciled;
//  - moving a row between accounts (or clearing it) is only possible on unlinked,
//    unreconciled rows, and clearing is refused for entries dated on/after go-live;
//  - accountAmount is recomputed; a CLEARED row goes back to UNCLEARED when its
//    account or amount changes.
// Books lock: rows dated inside a locked period (and moves into one) only allow
// description / reference / receipt / account-manager / paid-by edits.
// unit: re-tags the entry (and its reversal pair) as PATCH { unit } does.
export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'finance.transactions.update')
    if (denied) return denied

    if (!isValidObjectId(params.id)) return fail('Not found', 404)

    await connectDB()

    let body
    try { body = await request.json() } catch { return fail('Invalid JSON body', 400) }
    const parsed = updateSchema.safeParse(body ?? {})
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    const existing = await Transaction.findById(params.id).lean()
    if (!existing) return fail('Not found', 404)
    const scope = await financeScope(session)
    if (!inScope(scope, existing.unit ?? null)) return fail('Not found', 404)

    const { date, txnId, accountId: bodyAccountId, kind: bodyKind, channel: bodyChannel, cheque: bodyCheque, unit: bodyUnit, ...rest } = parsed.data
    const existingKind = existing.kind || 'OPERATING'

    // Business unit: its own rules (planRetag), not the field locks below.
    const unitTarget = bodyUnit?.trim() || null
    let retag = null
    if (unitTarget && unitTarget !== (existing.unit ?? null)) {
      retag = await planRetag(existing, unitTarget, scope)
      if (retag.error) return retag.error
    }

    // txnId is the system ledger id: never cleared (a null would also collide on
    // the unique sparse index) and never renamed. External references belong in
    // the `reference` field.
    if (txnId && txnId.trim() && txnId.trim() !== (existing.txnId ?? '')) {
      return fail('Transaction ID cannot be changed. Put external references in the Reference field.', 422)
    }
    if (bodyKind && bodyKind !== existingKind) {
      return fail(`This is a ${existingKind.toLowerCase().replace(/_/g, ' ')} entry; its kind cannot be changed here.`, 422)
    }

    // Date: compared as Dhaka calendar days, so re-sending the same day is a no-op.
    // The edit form pre-fills the day as `date.slice(0, 10)` of the stored ISO
    // string — the UTC day. For rows stored at Dhaka midnight / evening (transfers,
    // back-dated expense payments, movements: 18:00–23:59 UTC) that is the PREVIOUS
    // Dhaka day; echoing it back unchanged must not move the entry a day earlier.
    let txDate
    if (date) {
      txDate = parseBusinessDate(date)
      if (!txDate) return fail('Invalid date', 422)
      if (existing.date) {
        const stored = new Date(existing.date)
        const sent = String(date).trim()
        const echoedUtcDay = /^\d{4}-\d{2}-\d{2}$/.test(sent) && !Number.isNaN(stored.getTime()) &&
          stored.toISOString().slice(0, 10) === sent
        if (sameBusinessDay(txDate, stored) || echoedUtcDay) txDate = undefined
      }
      // Money cannot move on a day that has not happened yet (Asia/Dhaka) — a
      // future row would sit in today's balances. Only checked when the date moves.
      if (txDate && dhakaDayKey(txDate) > dhakaDayKey(new Date())) {
        return fail('The date cannot be in the future', 422, { field: 'date' })
      }
    }
    const finalDate = txDate ?? existing.date

    // Final currency / amounts after the edit, with amountBDT recomputed.
    const currency = rest.currency ?? existing.currency ?? BASE_CURRENCY
    if (!isValidCurrency(currency)) return fail('Unsupported currency', 422)
    const amount = rest.amount ?? Number(existing.amount)
    let amountBDT
    if (currency === BASE_CURRENCY) {
      amountBDT = amount
    } else {
      const currencyOrAmountChanged = currency !== (existing.currency ?? BASE_CURRENCY) || amount !== Number(existing.amount)
      amountBDT = rest.amountBDT ?? (currencyOrAmountChanged ? null : existing.amountBDT)
      if (!(Number(amountBDT) > 0)) {
        return fail('Enter the BDT-equivalent for a non-BDT transaction', 422)
      }
    }

    const update = { ...rest, currency, amount, amountBDT }
    if (txDate) update.date = txDate
    for (const [k, v] of Object.entries(update)) if (v === '') update[k] = null
    // ObjectId reference fields: a malformed id would otherwise fail as a 500 CastError.
    const badRef = ['projectId', 'invoiceId', 'agencyId', 'paidToEmployeeId', 'paidBy', 'accountManager']
      .find(k => update[k] != null && !isValidObjectId(update[k]))
    if (badRef) return fail(`Invalid ${badRef}`, 422, { field: badRef })

    // Money account requested
    const accountProvided = bodyAccountId !== undefined
    if (accountProvided) update.accountId = bodyAccountId?.trim() || null
    if (bodyChannel !== undefined) update.channel = normalizeChannel(bodyChannel)
    if (bodyCheque !== undefined) {
      const chq = normalizeChequeInput(bodyCheque)
      if (chq === undefined) return fail('Invalid cheque date', 422)
      update.cheque = chq
    }

    // Expenses must go through the expense-request pipeline, so an entry can't be
    // turned into an EXPENSE by editing it.
    if (update.type === 'EXPENSE' && existing.type !== 'EXPENSE') {
      return fail('An income entry cannot be changed into an expense.', 422)
    }

    // Rows linked to an invoice, an expense (payExpense sets reference = expense id)
    // or a confirmed project payment: block edits to the fields that drive their
    // side effects, since this update would not re-sync those records.
    const [linkedExpense, linkedPayment, reversed] = await Promise.all([
      existing.reference && isValidObjectId(existing.reference)
        ? ProjectExpense.exists({ _id: existing.reference })
        : null,
      ProjectPayment.exists({ transactionId: existing._id }),
      Transaction.exists({ reversalOf: existing._id }),
    ])
    // Structural rows belong to another record's double entry (transfer legs, asset
    // postings, reversals, non-operating kinds); tax-linked rows carry TaxEntries.
    const isStructural = !!(
      existing.transferId || existing.assetId || existing.purchaseBillId || existing.reversalOf || reversed ||
      existingKind !== 'OPERATING'
    )
    const hasTaxLinks = Array.isArray(existing.taxEntryIds) && existing.taxEntryIds.length > 0
    const isSystemRow = isStructural || hasTaxLinks
    const isLinked = !!(existing.invoiceId || linkedExpense || linkedPayment || isSystemRow)

    const changed = (k) => {
      if (!(k in update)) return false
      const after = update[k]
      // Legacy BDT rows may have no amountBDT; their BDT value is the amount.
      const before = (k === 'amountBDT' && existing.amountBDT == null && (existing.currency ?? BASE_CURRENCY) === BASE_CURRENCY)
        ? existing.amount
        : existing[k]
      if (k === 'amount' || k === 'amountBDT') {
        if (before == null && after == null) return false
        return Math.abs((Number(after) || 0) - (Number(before) || 0)) > 0.001
      }
      if (k === 'date') return !!after && !sameBusinessDay(after, before)
      if (k === 'cheque') return JSON.stringify(after ?? null) !== JSON.stringify(before ?? null)
      return idStr(after) !== idStr(before)
    }
    const changedKeys = Object.keys(update).filter(changed)

    if (isLinked) {
      const locked = (isSystemRow ? SYSTEM_LOCKED_FIELDS : LINKED_LOCKED_FIELDS).filter(k => changedKeys.includes(k))
      if (locked.length) {
        // A client receipt booked against an invoice is corrected by reversing it
        // (PATCH { action:'reverse' }) and recording it again.
        const hint = existing.type === 'INCOME' && (existing.invoiceId || linkedPayment) && !existing.reversalOf && !reversed
          ? ' To correct a client receipt, reverse it (Accounts → Payment confirmations / Transactions → "Reverse") and record it again.'
          : ''
        return fail(`This transaction is linked to an invoice, expense, payment or another ledger record; ${locked.join(', ')} cannot be edited here.${hint}`, 422)
      }
    }

    // Reconciliation: a reconciled row is part of a closed bank statement, a CLEARED
    // row has been matched to the bank, and a row ticked in an in-progress
    // reconciliation must be unticked before it changes. (Legacy rows without a
    // clearStatus are uncleared.)
    const clearStatus = existing.clearStatus || 'UNCLEARED'
    const reconciled = clearStatus === 'RECONCILED'
    const inReconciliation = !!existing.reconciliationId
    const cleared = clearStatus !== 'UNCLEARED'
    const statementKeys = RECONCILED_LOCKED_FIELDS.filter(k => changedKeys.includes(k))
    if ((cleared || inReconciliation) && statementKeys.length) {
      const what = statementKeys.join(', ')
      return fail(reconciled
        ? `This entry is reconciled with a bank statement; ${what} cannot be changed. Undo the reconciliation first.`
        : inReconciliation
          ? `This entry is ticked in a reconciliation in progress; untick it there before changing ${what}.`
          : `This entry is cleared against a bank statement; ${what} cannot be changed here.`, 409, { code: 'RECONCILED' })
    }

    // Books lock (closed periods) on the current and the new date.
    const lockedOld = await assertBooksOpen(existing.date)
    if (lockedOld) {
      const blocked = changedKeys.filter(k => !LOCK_EXEMPT_FIELDS.includes(k))
      if (blocked.length) return fail(`${lockedOld} — only the description, reference and receipt can be edited.`, 409, { code: 'BOOKS_LOCKED' })
    }
    if (changedKeys.includes('date')) {
      const lockedNew = await assertBooksOpen(finalDate)
      if (lockedNew) return fail(`${lockedNew} — the entry cannot be moved into a locked period.`, 409, { code: 'BOOKS_LOCKED' })
    }

    // ── Money account & account amount ──
    const accountChanged = changedKeys.includes('accountId')
    const finalAccountId = accountChanged ? update.accountId : idStr(existing.accountId)
    const amountsChanged = ['amount', 'currency', 'amountBDT'].some(k => changedKeys.includes(k))
    if (accountChanged) {
      if (existingKind === 'NON_CASH') return fail('Non-cash entries (depreciation, withholding, write-offs) have no money account.', 422)
      if (isStructural) return fail('The money account of this entry is set by the record that created it and cannot be changed here.', 422)
      if (isLinked && existing.accountId) {
        return fail('This entry is linked to an invoice, expense or payment; its money account can only be set while it has none.', 422)
      }
    }
    // Go-live rule: a row left without a money account may not be cleared of its
    // account, nor moved to a date on/after go-live. (Non-cash rows never carry one.)
    if (!finalAccountId && existingKind !== 'NON_CASH' && (accountChanged || changedKeys.includes('date'))) {
      const missing = await requireAccountIfLive(finalDate, null)
      if (missing) return fail(missing, 422, { code: 'ACCOUNT_REQUIRED', field: 'accountId' })
    }
    if (finalAccountId && (accountChanged || amountsChanged || changedKeys.includes('date') || changedKeys.includes('type'))) {
      let account
      try {
        account = await loadPostingAccount(finalAccountId, { currency, date: finalDate })
      } catch (err) {
        const mapped = httpErrorPayload(err)
        if (mapped) return NextResponse.json(mapped.body, { status: mapped.status })
        throw err
      }
      let accountAmount
      try {
        accountAmount = round2(computeAccountAmount({ account, amount, currency, amountBDT }))
      } catch (err) {
        return fail(err.message, err.status ?? 422, { field: 'accountId' })
      }
      update.accountAmount = accountAmount

      // Overdraft guard for money going OUT of an account that may not go negative.
      const finalType = update.type ?? existing.type
      if (finalType === 'EXPENSE' && account.allowNegative === false) {
        const bal = (await getAccountBalances({ accountIds: [account._id] })).get(String(account._id))
        const balance = bal?.balance ?? (Number(account.openingBalance) || 0)
        // This row's current effect on the same account is already in the balance.
        const current = !accountChanged && existing.type === 'EXPENSE' && idStr(existing.accountId) === String(account._id)
          ? (Number(accountAmountOf(existing, account)) || 0)
          : 0
        const limit = Number(account.creditLimit) || 0
        if (balance + current - accountAmount < -limit - 0.005) {
          return fail(`Insufficient balance in ${account.name}: available ${formatMoney(balance + current + limit, account.currency || 'BDT')}`, 409, { code: 'INSUFFICIENT_FUNDS' })
        }
      }
      if (accountChanged && !update.channel && !existing.channel) {
        update.channel = channelFromPaymentMethod(update.paymentMethod ?? existing.paymentMethod, account)
      }
    } else if (accountChanged && !finalAccountId) {
      update.accountAmount = null
    }
    if (accountChanged || (finalAccountId && amountsChanged)) {
      if (existing.clearStatus === 'CLEARED') {
        update.clearStatus = 'UNCLEARED'
        update.clearedDate = null
      }
    }

    // P&L amount: simple rows keep plAmountBDT in step with amountBDT; rows with
    // a separate P&L split (VAT carved out) cannot be re-valued here.
    if (amountsChanged && existing.plAmountBDT != null) {
      const oldBDT = existing.amountBDT ?? ((existing.currency ?? BASE_CURRENCY) === BASE_CURRENCY ? Number(existing.amount) : null)
      if (oldBDT != null && Math.abs(Number(existing.plAmountBDT) - Number(oldBDT)) < 0.005) {
        update.plAmountBDT = round2(Number(amountBDT))
      } else {
        return fail('This entry carries a separate P&L amount (e.g. VAT carved out); its amount cannot be changed here.', 422)
      }
    }

    // The unit goes in after the field locks above (it has its own rules).
    if (retag) update.unit = unitTarget

    const transaction = await Transaction.findByIdAndUpdate(
      params.id,
      { $set: update },
      { new: true }
    ).populate(POPULATE)
    const pairedRetagged = retag ? retag.rows.filter(r => String(r._id) !== String(existing._id)) : []
    if (pairedRetagged.length) {
      await Transaction.updateMany({ _id: { $in: pairedRetagged.map(r => r._id) } }, { $set: { unit: unitTarget } })
    }

    // Audit a before/after diff of the fields that actually changed.
    const diff = {}
    for (const k of changedKeys) {
      if (k === 'date') {
        diff.date = { from: existing.date ? new Date(existing.date).toISOString() : null, to: new Date(update.date).toISOString() }
      } else {
        diff[k] = { from: existing[k] ?? null, to: update[k] ?? null }
      }
    }
    if ('accountAmount' in update && Number(update.accountAmount) !== Number(existing.accountAmount)) {
      diff.accountAmount = { from: existing.accountAmount ?? null, to: update.accountAmount ?? null }
    }
    if (update.clearStatus && update.clearStatus !== existing.clearStatus) {
      diff.clearStatus = { from: existing.clearStatus ?? null, to: update.clearStatus }
    }
    if (retag) {
      diff.unit = { from: existing.unit ?? null, to: unitTarget }
      if (pairedRetagged.length) diff.unitAlsoOn = pairedRetagged.map(r => r.txnId ?? String(r._id))
    }

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'UPDATE',
      entity:   'TRANSACTION',
      entityId: params.id,
      changes:  JSON.stringify(diff),
      request,
    })

    return NextResponse.json({ data: transaction })
  } catch (err) {
    const mapped = httpErrorPayload(err)
    if (mapped) return NextResponse.json(mapped.body, { status: mapped.status })
    console.error('[PUT /api/transactions/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

const reverseSchema = z.object({
  action: z.literal('reverse'),
  reason: z.string().trim().min(5, 'Give a reason (at least 5 characters)').max(500),
})

// PATCH /api/transactions/[id]  { unit }  (finance.transactions.update)
// Re-tags the entry to another venture / product / Company — any entry, linked
// or not, reconciled or not: allowed in open periods; in a locked period only
// while the entry is Unassigned. Its reversal pair moves with it (planRetag).
// Returns { data: the entry }.
async function retagUnit(request, session, id, rawUnit) {
  const unit = typeof rawUnit === 'string' ? rawUnit.trim() : ''
  if (!unit) return fail('Choose the venture or product', 422, { field: 'unit' })

  await connectDB()
  const existing = await Transaction.findById(id).lean()
  if (!existing) return fail('Not found', 404)
  const scope = await financeScope(session)
  if (!inScope(scope, existing.unit ?? null)) return fail('Not found', 404)

  const plan = await planRetag(existing, unit, scope)
  if (plan.error) return plan.error

  if (plan.rows.length) {
    await Transaction.updateMany({ _id: { $in: plan.rows.map(r => r._id) } }, { $set: { unit } })
    const paired = plan.rows.filter(r => String(r._id) !== String(existing._id))
    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'UPDATE',
      entity:   'TRANSACTION',
      entityId: String(existing._id),
      changes:  JSON.stringify({
        unit: { from: existing.unit ?? null, to: unit },
        ...(paired.length ? { unitAlsoOn: paired.map(r => r.txnId ?? String(r._id)) } : {}),
      }),
      request,
    })
  }

  const transaction = await Transaction.findById(id).populate(POPULATE)
  return NextResponse.json({ data: transaction })
}

// PATCH /api/transactions/[id]  { action:'reverse', reason }  (finance.payments.confirm)
// Reverses a client receipt booked against an invoice (wrong amount, account,
// date…): a reversing entry dated today, the settled amount taken back off the
// invoice (status recomputed) and the P&L amount off the project. A row that
// belongs to a confirmed payment confirmation is reversed as that payment (its
// VDS / TDS entries are voided and it is marked REVERSED). The original row stays
// in the ledger — the ledger is immutable; corrections are reversals.
// A body with `unit` (and no action 'reverse') is a re-tag, see retagUnit above.
export async function PATCH(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return fail('Unauthorised', 401)
    if (!isValidObjectId(params.id)) return fail('Not found', 404)

    let raw
    try { raw = await request.json() } catch { return fail('Invalid JSON body', 400) }
    const isRetag = !!raw && typeof raw === 'object' && raw.action !== 'reverse' && Object.hasOwn(raw, 'unit')
    const denied  = requirePerm(session, isRetag ? 'finance.transactions.update' : 'finance.payments.confirm')
    if (denied) return denied
    if (isRetag) return await retagUnit(request, session, params.id, raw.unit)

    const parsed = reverseSchema.safeParse(raw ?? {})
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }
    await connectDB()

    let result
    try {
      result = await reverseClientSettlement({ transactionId: params.id, reason: parsed.data.reason, userId: session.user.id })
    } catch (err) {
      const mapped = httpErrorPayload(err)
      if (mapped) return NextResponse.json(mapped.body, { status: mapped.status })
      throw err
    }

    const tx = result.transaction
    const pp = result.payment
    if (pp?.submittedBy && String(pp.submittedBy) !== session.user.id) {
      await createNotification({
        userId:  String(pp.submittedBy),
        title:   'Payment reversed',
        message: `The confirmed payment of ${formatMoney(Number(tx.amount) || 0, tx.currency || BASE_CURRENCY)} was reversed. Reason: ${parsed.data.reason}`,
        type:    'PAYMENT',
        link:    pp.invoiceId ? `/admin/invoices/${pp.invoiceId}` : '/admin/accounts?tab=confirmations',
      }).catch(err => console.error('[PATCH /api/transactions/[id]] notification failed', err))
    }

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'REVERSE',
      entity:   pp ? 'PROJECT_PAYMENT' : 'TRANSACTION',
      entityId: pp ? String(pp._id) : String(tx._id),
      changes:  JSON.stringify({
        ...(pp ? { status: { from: 'CONFIRMED', to: 'REVERSED' } } : {}),
        reason:            parsed.data.reason,
        transaction:       tx.txnId ?? String(tx._id),
        reversal:          result.reversal?.txnId ?? (result.reversal ? String(result.reversal._id) : null),
        amount:            Number(tx.amount) || 0,
        currency:          tx.currency || BASE_CURRENCY,
        settled:           result.settled,
        vdsAmount:         result.vds,
        tdsAmount:         result.tds,
        invoiceId:         tx.invoiceId ? String(tx.invoiceId) : null,
        invoiceStatus:     result.invoice ? result.invoice.status : null,
        taxEntriesVoided:  result.voidedEntries.map(v => v.entryNo),
        projectId:         result.projectId,
        projectReducedBDT: result.projectReducedBDT,
      }),
      request,
    })

    const reversal = result.reversal ? await Transaction.findById(result.reversal._id).populate(POPULATE) : null
    return NextResponse.json({
      data: reversal,
      reversal: {
        original:      { id: String(tx._id), txnId: tx.txnId ?? null },
        transaction:   result.reversal ? { id: String(result.reversal._id), txnId: result.reversal.txnId ?? null } : null,
        paymentId:     pp ? String(pp._id) : null,
        voidedEntries: result.voidedEntries,
        invoice:       result.invoice ? {
          id:         String(result.invoice._id),
          status:     result.invoice.status,
          paidAmount: Number(result.invoice.paidAmount) || 0,
          total:      Number(result.invoice.total) || 0,
        } : null,
        projectReducedBDT: result.projectReducedBDT,
      },
    })
  } catch (err) {
    const mapped = httpErrorPayload(err)
    if (mapped) return NextResponse.json(mapped.body, { status: mapped.status })
    console.error('[PATCH /api/transactions/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Transactions are an immutable financial ledger — there is intentionally NO DELETE
// handler. A transaction can never be deleted through the API. Do not add one.
