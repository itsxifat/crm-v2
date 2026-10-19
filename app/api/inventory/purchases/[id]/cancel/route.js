export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { requirePerm } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { cancelBill, loadBillDetail } from '../../_lib/purchases'
import { errorResponse, readJson } from '../../_lib/http'

// POST /api/inventory/purchases/[id]/cancel   Body: { reason }
// DRAFT → CANCELLED; or RECEIVED → CANCELLED when nothing happened downstream: the created assets
// are untouched (they are deleted), the consumables are still on hand (reversed with ADJUST_OUT)
// and the bill is not paid (a pending payment request is rejected).
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'inventory.purchase')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()
    const body = (await readJson(request)) ?? {}
    const result = await cancelBill({ billId: params.id, body, session })
    const data = await loadBillDetail(params.id)

    logActivity({
      userId: session.user.id,
      userRole: session.user.role,
      action: 'STATUS_CHANGE',
      entity: 'PURCHASE_BILL',
      entityId: params.id,
      changes: JSON.stringify({
        billNo: data?.billNo ?? null,
        status: { from: result.from, to: 'CANCELLED' },
        reason: body.reason ?? null,
        removedAssets: result.removedAssets,
        reversedStockLines: result.reversedStock,
        rejectedExpense: result.rejectedExpense,
      }),
      request,
    })

    return NextResponse.json({ data, warnings: result.warnings })
  } catch (err) {
    return errorResponse(err, '[POST /api/inventory/purchases/[id]/cancel]')
  }
}
