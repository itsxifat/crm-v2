export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { ProjectExpense } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { settleExpenseAsPaid, computeBatchRef } from '@/lib/expensePayment'

// POST /api/expenses/batch-pay
// Marks a group of APPROVED expenses PAID against ONE combined authorized invoice:
// they all share the uploaded signed-scan and a batch reference. Body:
//   { ids: [...], signedInvoiceUrl, paymentMethod?, paymentNote? }
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'finance.payments.confirm')
    if (denied) return denied
    await connectDB()

    const { ids, signedInvoiceUrl, paymentMethod, paymentNote } = await request.json()
    if (!Array.isArray(ids) || ids.length === 0)
      return NextResponse.json({ error: 'Select at least one approved expense' }, { status: 422 })
    if (!signedInvoiceUrl)
      return NextResponse.json({ error: 'Upload the signed & sealed combined invoice scan first' }, { status: 422 })

    const expenses = await ProjectExpense.find({ _id: { $in: ids }, status: 'APPROVED' })
    if (expenses.length === 0)
      return NextResponse.json({ error: 'None of the selected expenses are approved & unpaid' }, { status: 422 })

    const batchInvoiceNo = computeBatchRef(expenses)

    for (const expense of expenses) {
      await settleExpenseAsPaid(expense, {
        userId: session.user.id, signedInvoiceUrl, paymentMethod, paymentNote, batchInvoiceNo,
      })
    }

    return NextResponse.json({
      data: { paid: expenses.length, skipped: ids.length - expenses.length, batchInvoiceNo },
    })
  } catch (err) {
    console.error('[POST /api/expenses/batch-pay]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
