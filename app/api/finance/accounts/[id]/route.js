export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import {
  MoneyAccount, Transaction, Reconciliation, ProjectPayment, ProjectExpense, PurchaseBill, CreditNote, Asset,
} from '@/models'
import { canDoAny, requirePerm } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { stripMaskedValues } from '@/lib/pii'
import { parseDhakaDay } from '@/lib/dhakaTime'
import { getFinanceSettings } from '@/lib/finance/settings'
import { dayKeyLabel } from '@/lib/finance/fiscal'
import { getAccountBalances, accountTypeGroup, accountTypeLabel } from '@/lib/finance/ledger'
import { formatMoney } from '@/lib/currencies'
import { ciEquals } from '@/lib/searchMatch'
import {
  updateAccountSchema, crossValidate, crossErrorResponse, resolveCustodian, loadAccount,
  errorResponse, diffAccount, dayKeyOrNull, fieldError, isDuplicateNameError, DUPLICATE_NAME_MESSAGE, EPS,
} from './_lib/accountData'

const RESTORE_NAME_TAKEN = 'Another active account already uses this name — rename one of them before restoring this account'

const VIEW_PERMS = ['finance.accounts.view', 'finance.accounts.manage', 'finance.accounts.reconcile']

// GET /api/finance/accounts/[id] → { data: account + balances (masked), settings }
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canDoAny(session, VIEW_PERMS)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()
    const [account, settings] = await Promise.all([loadAccount(session, params.id), getFinanceSettings()])
    if (!account) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({
      data: account,
      settings: {
        openingLocked: !!settings.openingLocked,
        goLiveDate:    settings.goLiveDate ?? null,
        lockedUntil:   settings.lockedUntil ?? null,
        fiscalYearStartMonth: settings.fiscalYearStartMonth ?? 7,
        baseCurrency:  'BDT',
      },
    })
  } catch (err) {
    return errorResponse(err, '[GET /api/finance/accounts/[id]]')
  }
}

// PUT /api/finance/accounts/[id] — partial update (status:'ACTIVE' restores an archived account)
export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'finance.accounts.manage')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()

    const raw = await request.json().catch(() => null)
    if (!raw || typeof raw !== 'object') return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    const parsed = updateAccountSchema.safeParse(stripMaskedValues(raw))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }
    const data = parsed.data

    const account = await MoneyAccount.findById(params.id)
    if (!account) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const before = account.toObject()

    const has = (k) => Object.prototype.hasOwnProperty.call(data, k)
    const settings = await getFinanceSettings()

    // ── Opening balance rules ──
    const balanceChanged = has('openingBalance') && Math.abs((Number(data.openingBalance) || 0) - (Number(before.openingBalance) || 0)) > EPS
    const dateChanged = has('openingDate') && (data.openingDate ?? null) !== dayKeyOrNull(before.openingDate)
    const refChanged = has('openingReference') && (data.openingReference ?? null) !== (before.openingReference ?? null)
    if ((balanceChanged || dateChanged || refChanged) && settings.openingLocked) {
      return NextResponse.json({ error: 'Opening balances are locked', code: 'OPENING_LOCKED' }, { status: 409 })
    }
    // Books lock: same rule as the opening-balance wizard — the old or new
    // opening date (or no date = from the beginning) inside the locked period.
    if ((balanceChanged || dateChanged) && settings.lockedUntil) {
      const lockedUntil = settings.lockedUntil
      const beforeDate = dayKeyOrNull(before.openingDate)
      const afterDate = has('openingDate') ? (data.openingDate ?? null) : beforeDate
      if (!beforeDate || beforeDate <= lockedUntil || !afterDate || afterDate <= lockedUntil) {
        return NextResponse.json({
          error: `Books are locked up to ${dayKeyLabel(lockedUntil)} — this account's opening balance falls in the locked period. Unlock the period first.`,
          code: 'BOOKS_LOCKED',
        }, { status: 409 })
      }
    }
    if ((balanceChanged || dateChanged)
      && await Reconciliation.exists({ accountId: account._id, status: { $in: ['COMPLETED', 'IN_PROGRESS'] } })) {
      return NextResponse.json({
        error: 'This account has reconciliations — cancel or undo them before changing its opening balance or date',
      }, { status: 409 })
    }

    // ── Currency / type rules ──
    const currencyChanged = has('currency') && data.currency !== (before.currency || 'BDT')
    const typeChanged = has('type') && data.type !== before.type
    if (currencyChanged || typeChanged) {
      const txCount = await Transaction.countDocuments({ accountId: account._id })
      if (currencyChanged && txCount > 0) {
        return NextResponse.json({
          error: `The currency cannot change: this account already has ${txCount} transaction${txCount === 1 ? '' : 's'}`,
        }, { status: 409 })
      }
      if (typeChanged && txCount > 0 && accountTypeGroup(data.type) !== accountTypeGroup(before.type)) {
        return NextResponse.json({
          error: `This account already has transactions — it can't become "${accountTypeLabel(data.type)}". Create a new account instead.`,
        }, { status: 409 })
      }
    }

    // ── Merge + cross-field validation ──
    const custodian = await resolveCustodian(data)
    const merged = {
      ...before,
      openingDate: dayKeyOrNull(before.openingDate),
      ...data,
      custodianUserId: custodian === undefined ? (before.custodianUserId ?? null) : custodian,
    }
    delete merged.custodianEmployeeId
    const errors = crossValidate(merged)
    if (Object.keys(errors).length) return crossErrorResponse(errors)

    // Active names are unique (ignoring case). Checked only when this account takes a
    // new name or comes back from the archive, so editing other fields of an account
    // that already shares a name (created before this rule) keeps working.
    const restoring = has('status') && data.status === 'ACTIVE' && before.status !== 'ACTIVE'
    const nameChanged = has('name') && String(merged.name ?? '').trim().toLowerCase() !== String(before.name ?? '').trim().toLowerCase()
    if ((restoring || (nameChanged && before.status === 'ACTIVE'))
      && await MoneyAccount.exists({ _id: { $ne: account._id }, status: 'ACTIVE', name: ciEquals(merged.name) })) {
      return fieldError('name', restoring && !nameChanged ? RESTORE_NAME_TAKEN : DUPLICATE_NAME_MESSAGE)
    }

    const SIMPLE = [
      'name', 'type', 'bankName', 'branchName', 'accountName', 'accountNumber', 'routingNumber', 'swiftCode',
      'currency', 'openingReference', 'allowNegative', 'creditLimit', 'linkedPaymentMethods', 'isDefault', 'color', 'notes',
    ]
    for (const k of SIMPLE) if (has(k)) account[k] = merged[k] ?? (k === 'creditLimit' ? 0 : (k === 'linkedPaymentMethods' ? [] : null))
    if (has('code')) account.code = merged.code ?? undefined
    if (has('openingBalance')) account.openingBalance = Number(merged.openingBalance) || 0
    if (has('openingDate')) account.openingDate = merged.openingDate ? parseDhakaDay(merged.openingDate).start : null
    account.mfsProvider = merged.mfsProvider ?? null
    account.walletType = merged.walletType ?? null
    account.custodianUserId = merged.custodianUserId ?? null
    if (has('isBankingChannel')) account.isBankingChannel = merged.isBankingChannel
    else if (typeChanged) account.isBankingChannel = null // model re-derives from the new type
    if (typeChanged && !has('allowNegative')) account.allowNegative = null
    if (has('status') && data.status === 'ACTIVE') account.status = 'ACTIVE'

    try {
      await account.save()
    } catch (err) {
      if (isDuplicateNameError(err)) return fieldError('name', restoring && !nameChanged ? RESTORE_NAME_TAKEN : DUPLICATE_NAME_MESSAGE)
      if (err?.code === 11000) return NextResponse.json({ error: 'That account code is already in use' }, { status: 409 })
      if (err?.name === 'ValidationError') {
        const fieldErrors = Object.fromEntries(Object.entries(err.errors ?? {}).map(([k, e]) => [k, [e.message]]))
        return NextResponse.json({ error: Object.values(err.errors ?? {})[0]?.message ?? 'Validation failed', details: { formErrors: [], fieldErrors } }, { status: 422 })
      }
      throw err
    }

    const changes = diffAccount(before, account.toObject())
    if (Object.keys(changes).length) {
      logActivity({
        userId:   session.user.id,
        userRole: session.user.role,
        action:   has('status') && before.status === 'ARCHIVED' && account.status === 'ACTIVE' ? 'RESTORE' : 'UPDATE',
        entity:   'MONEY_ACCOUNT',
        entityId: account._id.toString(),
        changes:  JSON.stringify(changes),
        request,
      })
    }

    return NextResponse.json({ data: await loadAccount(session, account._id.toString()) })
  } catch (err) {
    return errorResponse(err, '[PUT /api/finance/accounts/[id]]')
  }
}

// DELETE /api/finance/accounts/[id] — archive (balance must be 0).
//   ?force=1      archive even when some transactions are still uncleared
//   ?permanent=1  hard delete — only for an account with no history at all
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'finance.accounts.manage')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()
    const account = await MoneyAccount.findById(params.id)
    if (!account) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { searchParams } = new URL(request.url)
    const force = searchParams.get('force') === '1'
    const permanent = searchParams.get('permanent') === '1'
    const id = account._id

    if (permanent) {
      const refs = await Promise.all([
        Transaction.exists({ $or: [{ accountId: id }, { counterAccountId: id }] }),
        Reconciliation.exists({ accountId: id }),
        ProjectPayment.exists({ accountId: id }),
        ProjectExpense.exists({ accountId: id }),
        PurchaseBill.exists({ 'payment.accountId': id }),
        CreditNote.exists({ refundAccountId: id }),
        Asset.exists({ 'disposal.accountId': id }),
      ])
      if (refs.some(Boolean)) {
        return NextResponse.json({ error: 'This account has history (transactions, payments or reconciliations) — archive it instead' }, { status: 409 })
      }
      if (Math.abs(Number(account.openingBalance) || 0) > EPS) {
        return NextResponse.json({ error: 'This account has an opening balance — archive it instead' }, { status: 409 })
      }
      await MoneyAccount.deleteOne({ _id: id })
      logActivity({
        userId:   session.user.id,
        userRole: session.user.role,
        action:   'DELETE',
        entity:   'MONEY_ACCOUNT',
        entityId: id.toString(),
        changes:  JSON.stringify({ name: account.name, type: account.type, currency: account.currency }),
        request,
      })
      return NextResponse.json({ success: true, deleted: true })
    }

    if (account.status === 'ARCHIVED') return NextResponse.json({ error: 'This account is already archived' }, { status: 409 })

    if (await Reconciliation.exists({ accountId: id, status: 'IN_PROGRESS' })) {
      return NextResponse.json({ error: 'Finish or cancel the reconciliation in progress before archiving' }, { status: 409 })
    }

    const bal = (await getAccountBalances({ accountIds: [id] })).get(String(id))
    const balance = bal?.balance ?? (Number(account.openingBalance) || 0)
    if (Math.abs(balance) > EPS) {
      return NextResponse.json({
        error: `This account still shows ${formatMoney(balance, account.currency || 'BDT')}. Transfer the balance out (or record an adjustment) before archiving.`,
        code: 'NON_ZERO_BALANCE',
        balance,
      }, { status: 409 })
    }
    const uncleared = bal?.unclearedCount ?? 0
    if (uncleared > 0 && !force) {
      return NextResponse.json({
        error: `${uncleared} transaction${uncleared === 1 ? ' is' : 's are'} not cleared yet. Archive anyway?`,
        code: 'UNCLEARED_ITEMS',
        unclearedCount: uncleared,
      }, { status: 409 })
    }

    const wasDefault = account.isDefault
    account.status = 'ARCHIVED'
    await account.save()

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'ARCHIVE',
      entity:   'MONEY_ACCOUNT',
      entityId: id.toString(),
      changes:  JSON.stringify({ name: account.name, status: { from: 'ACTIVE', to: 'ARCHIVED' }, wasDefault, unclearedCount: uncleared }),
      request,
    })

    return NextResponse.json({ data: await loadAccount(session, id.toString()) })
  } catch (err) {
    return errorResponse(err, '[DELETE /api/finance/accounts/[id]]')
  }
}
