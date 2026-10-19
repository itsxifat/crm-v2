export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { requirePerm } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { invalidateFinanceSettingsCache } from '@/lib/finance/settings'
import { loadBillDetail, receiveBill } from '../../_lib/purchases'
import { errorResponse, readJson } from '../../_lib/http'

// POST /api/inventory/purchases/[id]/receive
// Body: { receivedAt?: 'YYYY-MM-DD', payment: { mode: 'PAY_NOW'|'REQUEST'|'PAID_OUTSIDE', accountId?, paymentMethod?,
//         channel?, paidAt?: 'YYYY-MM-DD', reference?, proofUrl?, note? } }
// DRAFT → RECEIVED: creates the assets (one per unit) and stock receipts, then pays now, sends a
// payment request to Accounts, or records that it was paid outside the system.
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'inventory.purchase')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()
    const body = await readJson(request)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

    // Period locks and go-live must be current for the receive checks.
    invalidateFinanceSettingsCache()
    const result = await receiveBill({ billId: params.id, body, session, request })

    const data = await loadBillDetail(params.id)
    logActivity({
      userId: session.user.id,
      userRole: session.user.role,
      action: 'STATUS_CHANGE',
      entity: 'PURCHASE_BILL',
      entityId: params.id,
      changes: JSON.stringify({
        billNo: data?.billNo ?? null,
        status: { from: 'DRAFT', to: 'RECEIVED' },
        assetsCreated: result.created.assets,
        stockLines: result.created.stockLines,
        capitalized: result.created.capitalized,
        payment: { mode: result.payment.mode, status: result.payment.status, accountId: result.payment.accountId ?? null },
        expenseId: result.payment.expenseId ? String(result.payment.expenseId) : null,
      }),
      request,
    })

    return NextResponse.json({ data, warning: result.warning ?? null, created: result.created })
  } catch (err) {
    return errorResponse(err, '[POST /api/inventory/purchases/[id]/receive]')
  }
}
