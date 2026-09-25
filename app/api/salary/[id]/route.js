export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { SalarySlip, ProjectExpense } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { maskDoc, EMPLOYEE_PII } from '@/lib/pii'
import { isValidObjectId } from '@/lib/objectId'

// GET /api/salary/:id — single slip (used to refresh the detail/print view)
export async function GET(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'finance.salary.view')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await connectDB()

    // Only the employee fields a payslip needs — never the full HR record
    // (NID / passport / address / documents / hrNotes).
    const slip = await SalarySlip.findById(params.id)
      .populate({
        path: 'employeeId',
        select: 'employeeId department designation position venture hireDate salary userId',
        populate: { path: 'userId', select: 'name email' },
      })
      .populate('expenseId')
    if (!slip) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const data = slip.toJSON()
    if (data.employeeId && typeof data.employeeId === 'object') maskDoc(session, data.employeeId, EMPLOYEE_PII)
    return NextResponse.json({ data })
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
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await connectDB()

    const { action, note } = await request.json()
    if (action !== 'cancel') return NextResponse.json({ error: 'Unsupported action' }, { status: 422 })

    const slip = await SalarySlip.findById(params.id)
    if (!slip) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (slip.expenseId) {
      // Conditional update so a payment committed concurrently can never be
      // overwritten with REJECTED. An expense already rejected in Accounts is
      // fine to cancel (frees the period).
      const rejected = await ProjectExpense.findOneAndUpdate(
        { _id: slip.expenseId, status: 'PENDING' },
        { $set: {
          status:     'REJECTED',
          reviewedBy: session.user.id,
          reviewedAt: new Date(),
          reviewNote: note || 'Salary slip cancelled',
        } },
      )
      if (!rejected) {
        const current = await ProjectExpense.findById(slip.expenseId).select('status').lean()
        if (current && current.status !== 'REJECTED')
          return NextResponse.json({ error: 'Only a salary not yet paid can be cancelled' }, { status: 409 })
      }
    }
    await slip.deleteOne()

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[PATCH /api/salary/:id]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
