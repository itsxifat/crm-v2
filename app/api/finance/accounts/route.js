export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { MoneyAccount } from '@/models'
import { canDoAny, requirePerm } from '@/lib/rbac'
import { logActivity } from '@/lib/logActivity'
import { stripMaskedValues } from '@/lib/pii'
import { dhakaDayKey, parseDhakaDay } from '@/lib/dhakaTime'
import { getFinanceSettings } from '@/lib/finance/settings'
import { dayKeyLabel } from '@/lib/finance/fiscal'
import { MONEY_ACCOUNT_TYPE_VALUES } from '@/lib/finance/ledger'
import { ciEquals } from '@/lib/searchMatch'
import {
  createAccountSchema, crossValidate, crossErrorResponse, resolveCustodian, enrichAccounts,
  computeTotals, loadAccount, errorResponse, fieldError, isDuplicateNameError, DUPLICATE_NAME_MESSAGE, EPS,
} from './[id]/_lib/accountData'

const VIEW_PERMS = ['finance.accounts.view', 'finance.accounts.manage', 'finance.accounts.reconcile']
const GROUP_ORDER = ['bank', 'cash', 'mfs', 'other']

function sortAccounts(rows) {
  return rows.sort((a, b) =>
    (GROUP_ORDER.indexOf(a.group) - GROUP_ORDER.indexOf(b.group))
    || (Number(b.status === 'ACTIVE') - Number(a.status === 'ACTIVE'))
    || (Number(!!b.isDefault) - Number(!!a.isDefault))
    || (MONEY_ACCOUNT_TYPE_VALUES.indexOf(a.type) - MONEY_ACCOUNT_TYPE_VALUES.indexOf(b.type))
    || String(a.name).localeCompare(String(b.name)))
}

// GET /api/finance/accounts?status=ACTIVE|ARCHIVED|all
// → { data: [account + balances (masked)], totals, settings, meta }
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canDoAny(session, VIEW_PERMS)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await connectDB()

    const { searchParams } = new URL(request.url)
    const rawStatus = String(searchParams.get('status') ?? 'ACTIVE').toUpperCase()
    const status = ['ACTIVE', 'ARCHIVED', 'ALL'].includes(rawStatus) ? rawStatus : 'ACTIVE'

    // Accounts are few (tens), so enrich all of them once: totals always come from ACTIVE ones.
    const [docs, settings] = await Promise.all([
      MoneyAccount.find({}).lean(),
      getFinanceSettings(),
    ])
    const all = await enrichAccounts(session, docs)
    const totals = computeTotals(all)
    const data = sortAccounts(status === 'ALL' ? all : all.filter(a => a.status === status))

    return NextResponse.json({
      data,
      totals,
      settings: {
        openingLocked: !!settings.openingLocked,
        goLiveDate:    settings.goLiveDate ?? null,
        lockedUntil:   settings.lockedUntil ?? null,
        fiscalYearStartMonth: settings.fiscalYearStartMonth ?? 7,
        baseCurrency:  'BDT',
      },
      meta: { page: 1, limit: data.length, total: data.length, pages: 1, archivedCount: totals.archivedCount },
    })
  } catch (err) {
    return errorResponse(err, '[GET /api/finance/accounts]')
  }
}

// POST /api/finance/accounts — create a money account
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'finance.accounts.manage')
    if (denied) return denied

    await connectDB()

    const raw = await request.json().catch(() => null)
    if (!raw || typeof raw !== 'object') return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    const parsed = createAccountSchema.safeParse(stripMaskedValues(raw))
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }
    const data = parsed.data
    const settings = await getFinanceSettings()

    const openingGiven = Math.abs(Number(data.openingBalance) || 0) > EPS || !!data.openingDate || !!data.openingReference
    if (settings.openingLocked && openingGiven) {
      return NextResponse.json({
        error: 'Opening balances are locked. Create the account with a zero opening balance and record the first deposit as a transfer or capital movement.',
        code: 'OPENING_LOCKED',
      }, { status: 409 })
    }

    const custodian = await resolveCustodian(data)
    // New accounts start at the go-live date (entries before it are already in
    // the opening balance). A go-live date still in the future is left unset —
    // an opening date may not be in the future.
    const today = dhakaDayKey(new Date())
    const defaultOpeningDate = settings.goLiveDate && settings.goLiveDate <= today ? settings.goLiveDate : null
    const merged = {
      ...data,
      currency: data.currency ?? 'BDT',
      custodianUserId: custodian ?? null,
      openingBalance: Number(data.openingBalance) || 0,
      openingDate: data.openingDate ?? defaultOpeningDate,
    }
    const errors = crossValidate(merged)
    if (Object.keys(errors).length) return crossErrorResponse(errors)

    // Same-named active accounts (e.g. two cash boxes, which have no last4) cannot be
    // told apart in account pickers. The unique index catches two simultaneous saves.
    if (await MoneyAccount.exists({ status: 'ACTIVE', name: ciEquals(merged.name) })) {
      return fieldError('name', DUPLICATE_NAME_MESSAGE)
    }

    // Books lock: a non-zero opening balance dated inside the locked period (or
    // undated, i.e. counting from the beginning) would change closed balances.
    const lockedUntil = settings.lockedUntil
    if (lockedUntil && Math.abs(merged.openingBalance) > EPS && (!merged.openingDate || merged.openingDate <= lockedUntil)) {
      return NextResponse.json({
        error: `Books are locked up to ${dayKeyLabel(lockedUntil)} — an opening balance must be dated after that. Set a later opening date, or record the first deposit as a transfer or capital movement.`,
        code: 'BOOKS_LOCKED',
        field: 'openingDate',
      }, { status: 409 })
    }

    // The first active account in a currency becomes its default (used by account pickers).
    let isDefault = merged.isDefault
    if (isDefault === undefined) {
      isDefault = !(await MoneyAccount.exists({ currency: merged.currency, status: 'ACTIVE', isDefault: true }))
    }

    const account = new MoneyAccount({
      name:             merged.name,
      code:             merged.code ?? undefined,
      type:             merged.type,
      bankName:         merged.bankName ?? null,
      branchName:       merged.branchName ?? null,
      routingNumber:    merged.routingNumber ?? null,
      swiftCode:        merged.swiftCode ?? null,
      accountName:      merged.accountName ?? null,
      accountNumber:    merged.accountNumber ?? null,
      mfsProvider:      merged.mfsProvider ?? null,
      walletType:       merged.walletType ?? null,
      currency:         merged.currency,
      openingBalance:   merged.openingBalance,
      openingDate:      merged.openingDate ? parseDhakaDay(merged.openingDate).start : null,
      openingReference: merged.openingReference ?? null,
      isBankingChannel: merged.isBankingChannel ?? null,
      allowNegative:    merged.allowNegative ?? null,
      creditLimit:      merged.creditLimit ?? 0,
      custodianUserId:  merged.custodianUserId ?? null,
      linkedPaymentMethods: merged.linkedPaymentMethods ?? [],
      isDefault:        !!isDefault,
      color:            merged.color ?? null,
      notes:            merged.notes ?? null,
      status:           'ACTIVE',
      createdBy:        session.user.id,
    })

    try {
      await account.save()
    } catch (err) {
      if (isDuplicateNameError(err)) return fieldError('name', DUPLICATE_NAME_MESSAGE)
      if (err?.code === 11000) return NextResponse.json({ error: 'That account code is already in use' }, { status: 409 })
      if (err?.name === 'ValidationError') {
        const fieldErrors = Object.fromEntries(Object.entries(err.errors ?? {}).map(([k, e]) => [k, [e.message]]))
        return NextResponse.json({ error: Object.values(err.errors ?? {})[0]?.message ?? 'Validation failed', details: { formErrors: [], fieldErrors } }, { status: 422 })
      }
      throw err
    }

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'CREATE',
      entity:   'MONEY_ACCOUNT',
      entityId: account._id.toString(),
      changes:  JSON.stringify({
        name: account.name, type: account.type, currency: account.currency,
        bankName: account.bankName, mfsProvider: account.mfsProvider, last4: account.last4,
        openingBalance: account.openingBalance, openingDate: merged.openingDate ?? null,
        isDefault: account.isDefault,
      }),
      request,
    })

    const data_ = await loadAccount(session, account._id.toString())
    return NextResponse.json({ data: data_ }, { status: 201 })
  } catch (err) {
    return errorResponse(err, '[POST /api/finance/accounts]')
  }
}
