export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Project, ProjectExpense } from '@/models'
import { requirePerm, canDo } from '@/lib/rbac'
import { settleExpenseAsPaid } from '@/lib/expensePayment'

// Voucher number, assigned on approve. Scheme: EXV-YYMM-#### (monthly counter).
async function nextVoucherNo() {
  const now    = new Date()
  const yymm   = `${String(now.getFullYear()).slice(-2)}${String(now.getMonth() + 1).padStart(2, '0')}`
  const prefix = `EXV-${yymm}-`
  const count  = await ProjectExpense.countDocuments({ expenseInvoiceNo: { $regex: `^${prefix}` } })
  return `${prefix}${String(count + 1).padStart(4, '0')}`
}

// GET /api/expenses/:id — single expense (staff; non-confirmers only see their own)
export async function GET(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    await connectDB()

    const expense = await ProjectExpense.findById(params.id)
      .populate('submittedBy', 'name avatar email')
      .populate('reviewedBy', 'name')
      .populate('paidBy', 'name')
      .populate({ path: 'projectId', select: 'name venture projectCode' })
    if (!expense) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Non-confirmers may only read their own submissions.
    const canConfirm = canDo(session, 'finance.payments.confirm')
    if (!canConfirm && String(expense.submittedBy?._id ?? expense.submittedBy) !== session.user.id)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    return NextResponse.json({ data: expense.toJSON() })
  } catch (err) {
    console.error('[GET /api/expenses/:id]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/expenses/:id — approve | mark_paid | reject (finance.payments.confirm)
export async function PATCH(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'finance.payments.confirm')
    if (denied) return denied
    await connectDB()

    const { action, note, accountManager, currency, amountBDT,
            paymentMethod, paymentProofUrl, paymentTxnId, signedInvoiceUrl } = await request.json()

    const expense = await ProjectExpense.findById(params.id)
    if (!expense) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // ─── APPROVE ─── PENDING → APPROVED. The payment has been made, so it's
    // recorded here (method + txn id / proof); this makes the voucher printable.
    // No ledger entry yet — that happens once the authorized invoice is uploaded.
    if (action === 'approve') {
      if (expense.status !== 'PENDING') return NextResponse.json({ error: 'Only pending expenses can be approved' }, { status: 422 })
      if (!paymentMethod) return NextResponse.json({ error: 'Select the payment method' }, { status: 422 })
      if (!paymentProofUrl && !paymentTxnId?.trim())
        return NextResponse.json({ error: 'Provide a transaction ID or upload payment proof' }, { status: 422 })

      expense.reviewedBy = session.user.id
      expense.reviewedAt = new Date()
      expense.reviewNote = note ?? null

      expense.paymentMethod   = paymentMethod
      expense.paymentTxnId    = paymentTxnId?.trim() || null
      expense.paymentProofUrl = paymentProofUrl ?? null

      // Approver may set/override the actual spend currency + BDT-equivalent.
      expense.currency  = currency ?? expense.currency ?? 'BDT'
      expense.amountBDT = (amountBDT ?? expense.amountBDT ?? expense.amount) || 0

      if (!expense.expenseInvoiceNo) expense.expenseInvoiceNo = await nextVoucherNo()
      expense.status = 'APPROVED'
      await expense.save()
      return NextResponse.json({ data: expense.toJSON() })
    }

    // ─── MARK PAID ─── APPROVED → PAID. Requires the scan/photo of the printed,
    // authorized (signed & sealed) invoice. Only now is the ledger entry created.
    if (action === 'mark_paid') {
      if (expense.status !== 'APPROVED') return NextResponse.json({ error: 'Only approved expenses can be marked paid' }, { status: 422 })
      const scan = signedInvoiceUrl ?? expense.signedInvoiceUrl
      if (!scan) return NextResponse.json({ error: 'Upload the scan of the authorized (signed & sealed) invoice to mark this paid' }, { status: 422 })

      await settleExpenseAsPaid(expense, { userId: session.user.id, signedInvoiceUrl: scan, accountManager })
      return NextResponse.json({ data: expense.toJSON() })
    }

    // ─── REJECT ─── allowed pre-payment (nothing to reverse).
    if (action === 'reject') {
      if (!['PENDING','APPROVED'].includes(expense.status)) return NextResponse.json({ error: 'Cannot reject a paid expense' }, { status: 422 })
      expense.reviewedBy = session.user.id
      expense.reviewedAt = new Date()
      expense.reviewNote = note ?? null
      expense.status     = 'REJECTED'
      await expense.save()
      return NextResponse.json({ data: expense.toJSON() })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 422 })
  } catch (err) {
    console.error('[PATCH /api/expenses/:id]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/expenses/:id — remove an expense; reverses budget only if it was PAID.
export async function DELETE(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'finance.payments.confirm')
    if (denied) return denied
    await connectDB()

    const expense = await ProjectExpense.findById(params.id)
    if (!expense) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    if (expense.status === 'PAID' && expense.projectId) {
      const proj = await Project.findById(expense.projectId)
      if (proj) {
        const bdt = expense.amountBDT ?? expense.amount ?? 0
        proj.approvedExpenses = Math.max(0, (proj.approvedExpenses ?? 0) - bdt)
        await proj.save()
      }
    }
    await expense.deleteOne()
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/expenses/:id]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
