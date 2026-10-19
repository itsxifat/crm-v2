export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { canDo } from '@/lib/rbac'
import { loadOpeningData } from './_lib/data'
import { requireAny, isSuperAdmin, errorResponse } from '@/app/api/finance/periods/_lib/locks'

const VIEW_PERMISSIONS = ['finance.opening.manage', 'finance.accounts.view', 'finance.periods.lock']

// GET /api/finance/opening-balances
// → { data: { settings, goLiveDate, asOfDate, goLiveFiscalYear, openingLocked, openingLockedAt, openingLockedBy,
//             fxRates, currencies, moneyAccounts[], taxOpenings[], tax:{ totals, counts, taxAssets, taxPayable },
//             assets:{ count, cost, accumulated, bookValue, nonCapitalizedCount, … }, stock:{ items, lines, value },
//             receivables:{ count, amount, currentOutstanding, settledSinceGoLive, unconverted[], invoices[] },
//             position:{ assets:{…}, liabilities:{…}, equity, unconverted[] }, checks[] },
//     meta: { canManage, canUnlock, canLockPeriods } }
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireAny(session, VIEW_PERMISSIONS)
    if (denied) return denied

    const data = await loadOpeningData(session)
    return NextResponse.json({
      data,
      meta: {
        canManage:      canDo(session, 'finance.opening.manage'),
        canUnlock:      canDo(session, 'finance.opening.manage') && isSuperAdmin(session),
        canLockPeriods: canDo(session, 'finance.periods.lock'),
      },
    })
  } catch (err) {
    return errorResponse(err, '[GET /api/finance/opening-balances]')
  }
}
