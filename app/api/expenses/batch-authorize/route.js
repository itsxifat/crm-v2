export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { ProjectExpense } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { authorizeExpense, computeBatchRef } from '@/lib/expensePayment'

// POST /api/expenses/batch-authorize
// Authorizes a group of PAID expenses against ONE combined invoice: they all
// share the uploaded authorized-invoice scan and a batch reference, and move to
// AUTHORIZED together.  { ids: [...], signedInvoiceUrl }
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'finance.payments.confirm')
    if (denied) return denied
    await connectDB()

    const { ids, signedInvoiceUrl } = await request.json()
    if (!Array.isArray(ids) || ids.length === 0)
      return NextResponse.json({ error: 'Select at least one paid expense' }, { status: 422 })
    if (!signedInvoiceUrl)
      return NextResponse.json({ error: 'Upload the scan of the authorized combined invoice first' }, { status: 422 })

    const expenses = await ProjectExpense.find({ _id: { $in: ids }, status: 'PAID' })
    if (expenses.length === 0)
      return NextResponse.json({ error: 'None of the selected expenses are paid & awaiting authorization' }, { status: 422 })

    const batchInvoiceNo = computeBatchRef(expenses)

    for (const expense of expenses) {
      await authorizeExpense(expense, { userId: session.user.id, signedInvoiceUrl, batchInvoiceNo })
    }

    return NextResponse.json({
      data: { authorized: expenses.length, skipped: ids.length - expenses.length, batchInvoiceNo },
    })
  } catch (err) {
    console.error('[POST /api/expenses/batch-authorize]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
