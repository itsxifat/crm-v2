export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { ProjectExpense } from '@/models'
import { requirePerm, canDo } from '@/lib/rbac'
import { payExpense, authorizeExpense, unwindExpenseLinks } from '@/lib/expensePayment'
import { isValidObjectId } from '@/lib/objectId'

// Paid-invoice number, assigned when paid. Scheme: EXV-YYMM-#### (monthly atomic counter).
function nextVoucherNo() {
  return ProjectExpense.nextNumber('expenseInvoiceNo', 'EXV')
}

// GET /api/expenses/:id — single expense (staff; non-confirmers only see their own)
export async function GET(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
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

// PATCH /api/expenses/:id — pay | authorize | reject (finance.payments.confirm)
export async function PATCH(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'finance.payments.confirm')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await connectDB()

    const { action, note, accountManager, currency, amountBDT,
            paymentMethod, paymentProofUrl, paymentTxnId, signedInvoiceUrl } = await request.json()

    const expense = await ProjectExpense.findById(params.id)
    if (!expense) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // ─── PAY ─── PENDING → PAID. The payment has been made; record it (method +
    // txn id / proof), create the ledger entry, and make the paid invoice printable.
    if (action === 'pay') {
      if (expense.status !== 'PENDING') return NextResponse.json({ error: 'Only pending expenses can be paid' }, { status: 422 })
      if (!paymentMethod) return NextResponse.json({ error: 'Select the payment method' }, { status: 422 })
      if (!paymentProofUrl && !paymentTxnId?.trim())
        return NextResponse.json({ error: 'Provide a transaction ID or upload payment proof' }, { status: 422 })

      // Claim the PENDING → PAID transition atomically: a double-click or two
      // accountants paying at once can only ever produce one ledger entry.
      const claimed = await ProjectExpense.findOneAndUpdate(
        { _id: expense._id, status: 'PENDING' },
        { $set: { status: 'PAID', paidBy: session.user.id, paidAt: new Date() } },
        { new: true },
      )
      if (!claimed) return NextResponse.json({ error: 'Only pending expenses can be paid' }, { status: 422 })

      try {
        claimed.reviewedBy = session.user.id
        claimed.reviewedAt = new Date()
        claimed.reviewNote = note ?? null

        // Actual spend currency + BDT-equivalent (both kept — taxes are in BDT).
        claimed.currency  = currency ?? claimed.currency ?? 'BDT'
        claimed.amountBDT = (amountBDT ?? claimed.amountBDT ?? claimed.amount) || 0

        if (!claimed.expenseInvoiceNo) claimed.expenseInvoiceNo = await nextVoucherNo()

        await payExpense(claimed, {
          userId: session.user.id, paymentMethod,
          paymentProofUrl: paymentProofUrl ?? null, paymentTxnId: paymentTxnId?.trim() || null,
          accountManager,
        })
      } catch (err) {
        // No ledger entry was written — release the claim so it can be retried.
        if (!claimed.accountsTransactionId) {
          await ProjectExpense.updateOne(
            { _id: claimed._id, status: 'PAID', accountsTransactionId: null },
            { $set: { status: 'PENDING', paidBy: null, paidAt: null } },
          )
        }
        throw err
      }
      return NextResponse.json({ data: claimed.toJSON() })
    }

    // ─── AUTHORIZE ─── PAID → AUTHORIZED. Requires the scan of the printed &
    // authorized (signed & sealed) invoice. No ledger change.
    if (action === 'authorize') {
      if (expense.status !== 'PAID') return NextResponse.json({ error: 'Only paid expenses can be authorized' }, { status: 422 })
      const scan = signedInvoiceUrl ?? expense.signedInvoiceUrl
      if (!scan) return NextResponse.json({ error: 'Upload the scan of the authorized (signed & sealed) invoice' }, { status: 422 })

      await authorizeExpense(expense, { userId: session.user.id, signedInvoiceUrl: scan })
      return NextResponse.json({ data: expense.toJSON() })
    }

    // ─── REJECT ─── only before payment (nothing to reverse in the ledger).
    // Linked salary slip / freelancer payment request / salary payout are
    // unwound so they don't get stuck behind a rejected expense.
    if (action === 'reject') {
      const rejected = await ProjectExpense.findOneAndUpdate(
        { _id: expense._id, status: 'PENDING' },
        { $set: { status: 'REJECTED', reviewedBy: session.user.id, reviewedAt: new Date(), reviewNote: note ?? null } },
        { new: true },
      )
      if (!rejected) return NextResponse.json({ error: 'Only pending expenses can be rejected' }, { status: 422 })
      await unwindExpenseLinks(rejected)
      return NextResponse.json({ data: rejected.toJSON() })
    }

    return NextResponse.json({ error: 'Unknown action' }, { status: 422 })
  } catch (err) {
    console.error('[PATCH /api/expenses/:id]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/expenses/:id — remove an expense that was never paid (PENDING or
// REJECTED). A PAID / AUTHORIZED expense already has a ledger entry and settled
// linked records (salary slip, payout, freelancer assignment); deleting it would
// leave the books inconsistent, so it must be reversed with a counter-entry.
export async function DELETE(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'finance.payments.confirm')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await connectDB()

    const expense = await ProjectExpense.findOneAndDelete({ _id: params.id, status: { $in: ['PENDING', 'REJECTED'] } })
    if (!expense) {
      const exists = await ProjectExpense.exists({ _id: params.id })
      if (!exists) return NextResponse.json({ error: 'Not found' }, { status: 404 })
      return NextResponse.json({ error: 'A paid or authorized expense cannot be deleted — record a reversing entry instead' }, { status: 409 })
    }
    await unwindExpenseLinks(expense)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/expenses/:id]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
