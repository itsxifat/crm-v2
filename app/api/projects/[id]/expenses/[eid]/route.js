export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { ProjectExpense } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { unwindExpenseLinks } from '@/lib/expensePayment'
import { isValidObjectId } from '@/lib/objectId'

// Approve / mark-paid / reject now live on the unified endpoint: PATCH /api/expenses/:id
// (it also handles project-less salary & reimbursement expenses). This route only
// deletes an unpaid (PENDING / REJECTED) expense of THIS project — same rules as
// DELETE /api/expenses/:id: a PAID / AUTHORIZED expense has a ledger entry and
// must be reversed with a counter-entry instead.
export async function DELETE(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'finance.payments.confirm')
    if (denied) return denied
    if (!isValidObjectId(params.id) || !isValidObjectId(params.eid))
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await connectDB()

    const scope   = { _id: params.eid, projectId: params.id }
    const expense = await ProjectExpense.findOneAndDelete({ ...scope, status: { $in: ['PENDING', 'REJECTED'] } })
    if (!expense) {
      if (!(await ProjectExpense.exists(scope))) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json({ error: 'A paid or authorized expense cannot be deleted — record a reversing entry instead' }, { status: 409 })
    }
    await unwindExpenseLinks(expense)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE expense]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
