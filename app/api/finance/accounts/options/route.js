export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { MoneyAccount } from '@/models'
import { canDoAny } from '@/lib/rbac'
import { getAccountBalances, MONEY_ACCOUNT_TYPE_VALUES } from '@/lib/finance/ledger'
import { getFinanceSettings } from '@/lib/finance/settings'
import { dhakaDayKey } from '@/lib/dhakaTime'

// Anyone who records, confirms or pays money needs the account picker.
const OPTION_PERMISSIONS = [
  'finance.accounts.view',
  'finance.accounts.manage',
  'finance.payments.confirm',
  'finance.transactions.create',
  'finance.transactions.view',
  'inventory.purchase',
  'inventory.dispose',      // asset sale / scrap / damage-recovery forms
  'tax.deposits.manage',
  'tax.notes.manage',       // credit-note refunds (Mushak-6.7)
]

const typeOrder = (type) => {
  const i = MONEY_ACCOUNT_TYPE_VALUES.indexOf(type)
  return i === -1 ? MONEY_ACCOUNT_TYPE_VALUES.length : i
}

// GET /api/finance/accounts/options — ACTIVE money accounts with live balances
// for <MoneyAccountSelect>. No full account numbers are returned (last4 only).
// meta.goLiveDate ('YYYY-MM-DD' | null) lets forms ask for an account only on
// dates where the server requires one (requireAccountIfLive).
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canDoAny(session, OPTION_PERMISSIONS)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await connectDB()

    const [accounts, settings] = await Promise.all([
      MoneyAccount.find({ status: 'ACTIVE' })
        .select('name code type currency last4 bankName mfsProvider walletType isBankingChannel isDefault linkedPaymentMethods allowNegative creditLimit color openingBalance openingDate')
        .lean(),
      getFinanceSettings(),
    ])

    const balances = accounts.length
      ? await getAccountBalances({ accountIds: accounts.map(a => a._id) })
      : new Map()

    accounts.sort((a, b) =>
      (Number(!!b.isDefault) - Number(!!a.isDefault))
      || (typeOrder(a.type) - typeOrder(b.type))
      || String(a.name).localeCompare(String(b.name)))

    const data = accounts.map(a => {
      const bal = balances.get(String(a._id))
      return {
        id:                   String(a._id),
        name:                 a.name,
        code:                 a.code ?? null,
        type:                 a.type,
        currency:             a.currency || 'BDT',
        last4:                a.last4 ?? null,
        bankName:             a.bankName ?? null,
        mfsProvider:          a.mfsProvider ?? null,
        walletType:           a.walletType ?? null,
        isBankingChannel:     a.isBankingChannel ?? !['CASH', 'PETTY_CASH'].includes(a.type),
        isDefault:            !!a.isDefault,
        linkedPaymentMethods: Array.isArray(a.linkedPaymentMethods) ? a.linkedPaymentMethods : [],
        allowNegative:        !!a.allowNegative,
        creditLimit:          Number(a.creditLimit) || 0,
        color:                a.color ?? null,
        balance:              bal?.balance ?? (Number(a.openingBalance) || 0),
        openingDate:          a.openingDate ? dhakaDayKey(a.openingDate) : null,
      }
    })

    return NextResponse.json({ data, meta: { goLiveDate: settings.goLiveDate ?? null } })
  } catch (err) {
    console.error('[GET /api/finance/accounts/options]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
