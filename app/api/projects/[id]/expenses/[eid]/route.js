export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Project, ProjectExpense } from '@/models'
import { requirePerm } from '@/lib/rbac'

// Approve / mark-paid / reject now live on the unified endpoint: PATCH /api/expenses/:id
// (it also handles project-less salary & reimbursement expenses). This route only
// deletes a project expense; budget is reversed only if it had already been PAID.
export async function DELETE(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'finance.payments.confirm')
    if (denied) return denied
    await connectDB()

    const expense = await ProjectExpense.findById(params.eid)
    if (!expense) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (expense.status === 'PAID') {
      const proj = await Project.findById(params.id)
      if (proj) {
        const bdt = expense.amountBDT ?? expense.amount ?? 0
        proj.approvedExpenses = Math.max(0, (proj.approvedExpenses ?? 0) - bdt)
        await proj.save()
      }
    }
    await expense.deleteOne()
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE expense]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
