export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { SalarySlip, ProjectExpense } from '@/models'
import { requirePerm } from '@/lib/rbac'

// GET /api/salary/:id — single slip (used to refresh the detail/print view)
export async function GET(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'finance.salary.view')
    if (denied) return denied
    await connectDB()

    const slip = await SalarySlip.findById(params.id)
      .populate({ path: 'employeeId', populate: { path: 'userId', select: 'name email' } })
      .populate('expenseId')
    if (!slip) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({ data: slip.toJSON() })
  } catch (err) {
    console.error('[GET /api/salary/:id]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/salary/:id — action: 'cancel'. Only before the linked expense is
// paid (nothing to reverse yet). Rejects the expense (kept as an audit record)
// and deletes the slip so the period frees up for a corrected regeneration.
export async function PATCH(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'finance.salary.pay')
    if (denied) return denied
    await connectDB()

    const { action, note } = await request.json()
    if (action !== 'cancel') return NextResponse.json({ error: 'Unsupported action' }, { status: 422 })

    const slip = await SalarySlip.findById(params.id)
    if (!slip) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const expense = slip.expenseId ? await ProjectExpense.findById(slip.expenseId) : null
    if (expense && expense.status !== 'PENDING') {
      return NextResponse.json({ error: 'Only a salary not yet paid can be cancelled' }, { status: 409 })
    }

    if (expense) {
      expense.status     = 'REJECTED'
      expense.reviewedBy = session.user.id
      expense.reviewedAt = new Date()
      expense.reviewNote = note || 'Salary slip cancelled'
      await expense.save()
    }
    await slip.deleteOne()

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[PATCH /api/salary/:id]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
