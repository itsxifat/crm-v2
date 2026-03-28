import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Project, ProjectExpense, Transaction } from '@/models'

// PATCH /api/projects/:id/expenses/:eid  — approve or reject
export async function PATCH(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!['SUPER_ADMIN','MANAGER'].includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await connectDB()

    const { action, note, receiptUrl, txnId, accountManager } = await request.json()
    const expense = await ProjectExpense.findById(params.eid)
    if (!expense) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (expense.status !== 'PENDING') return NextResponse.json({ error: 'Already reviewed' }, { status: 422 })

    expense.reviewedBy = session.user.id
    expense.reviewedAt = new Date()
    expense.reviewNote = note ?? null
    if (receiptUrl) expense.receiptUrl = receiptUrl

    if (action === 'approve') {
      const finalReceiptUrl = receiptUrl ?? expense.invoiceUrl ?? null

      // txnId required if no receipt
      if (!finalReceiptUrl && !txnId) {
        return NextResponse.json({
          error: 'Transaction ID is required when no receipt is attached',
        }, { status: 422 })
      }

      expense.status = 'APPROVED'
      const project = await Project.findById(params.id).lean()

      const txn = await new Transaction({
        type:           'EXPENSE',
        category:       expense.category,
        description:    `[${project?.projectCode ?? project?.venture ?? ''}] ${expense.title}`,
        amount:         expense.amount,
        currency:       'BDT',
        date:           expense.date,
        reference:      expense._id.toString(),
        projectId:      params.id,
        receiptUrl:     finalReceiptUrl,
        paymentMethod:  expense.paymentMethod ?? null,
        txnId:          txnId || undefined,   // pre-save hook generates if not provided
        accountManager: accountManager || session.user.id,
        createdBy:      session.user.id,
        vendor:         expense.vendor ?? null,
      }).save()

      expense.syncedToAccounts      = true
      expense.accountsTransactionId = txn._id
      await Project.findByIdAndUpdate(params.id, { $inc: { approvedExpenses: expense.amount } })
    } else {
      expense.status = 'REJECTED'
    }

    await expense.save()
    return NextResponse.json({ data: expense.toJSON() })
  } catch (err) {
    console.error('[PATCH expense]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/projects/:id/expenses/:eid
export async function DELETE(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!['SUPER_ADMIN','MANAGER'].includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await connectDB()

    const expense = await ProjectExpense.findById(params.eid)
    if (!expense) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (expense.status === 'APPROVED') {
      await Project.findByIdAndUpdate(params.id, { $inc: { approvedExpenses: -expense.amount } })
    }
    await expense.deleteOne()
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE expense]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
