export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { canDo, canDoAny } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { invalidateFinanceSettingsCache } from '@/lib/finance/settings'
import { loadBillDetail, settleReceivedBill } from '../../_lib/purchases'
import { errorResponse, readJson } from '../../_lib/http'

// POST /api/inventory/purchases/[id]/payment
// Body: { payment: { mode: 'PAY_NOW'|'REQUEST'|'PAID_OUTSIDE', accountId?, paymentMethod?, channel?, paidAt?, reference?, proofUrl?, note? } }
// Settles a RECEIVED bill whose payment is UNPAID (never requested, or the request was rejected),
// or pays now a bill whose payment request is still pending in Accounts.
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canDoAny(session, ['inventory.purchase', 'finance.payments.confirm'])) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await readJson(request)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    // Requesting a payment or marking a bill paid outside is a purchasing action;
    // paying now is a finance action (checked again inside).
    if (body.payment?.mode !== 'PAY_NOW' && !canDo(session, 'inventory.purchase')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()
    invalidateFinanceSettingsCache()
    const result = await settleReceivedBill({ billId: params.id, body, session, request })
    const data = await loadBillDetail(params.id)

    logActivity({
      userId: session.user.id,
      userRole: session.user.role,
      action: 'PAYMENT',
      entity: 'PURCHASE_BILL',
      entityId: params.id,
      changes: JSON.stringify({
        billNo: data?.billNo ?? null,
        paymentStatus: { from: result.previousStatus, to: result.payment.status },
        mode: result.payment.mode,
        accountId: result.payment.accountId ?? null,
        expenseId: result.payment.expenseId ? String(result.payment.expenseId) : null,
        amount: data?.netPayable ?? null,
      }),
      request,
    })

    return NextResponse.json({ data, warning: result.warning ?? null })
  } catch (err) {
    return errorResponse(err, '[POST /api/inventory/purchases/[id]/payment]')
  }
}
