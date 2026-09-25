export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Transaction, ProjectExpense, ProjectPayment } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { logActivity } from '@/lib/logActivity'
import { isValidCurrency, BASE_CURRENCY } from '@/lib/currencies'
import { isValidObjectId } from '@/lib/objectId'
import { z } from 'zod'

const updateSchema = z.object({
  type:        z.enum(['INCOME', 'EXPENSE']).optional(),
  category:    z.string().min(1).optional(),
  amount:      z.coerce.number().positive().optional(),
  description: z.string().min(1).optional(),
  date:        z.string().optional(),
  reference:       z.string().optional().nullable(),
  currency:        z.string().optional(),
  amountBDT:       z.coerce.number().positive().optional().nullable(),
  expenseCategory: z.string().optional().nullable(),  // subcategory
  paymentMethod:    z.string().optional().nullable(),
  projectId:        z.string().optional().nullable(),
  invoiceId:        z.string().optional().nullable(),
  clientId:         z.string().optional().nullable(),
  vendorId:         z.string().optional().nullable(),
  vendor:           z.string().optional().nullable(),
  freelancerId:     z.string().optional().nullable(),
  agencyId:         z.string().optional().nullable(),
  paidToEmployeeId: z.string().optional().nullable(),
  paidToName:       z.string().optional().nullable(),
  paidBy:           z.string().optional().nullable(),
  accountManager:   z.string().optional().nullable(),
  receiptUrl:       z.string().optional().nullable(),
  // The ledger id is immutable; accepted only so an unchanged value can be echoed back.
  txnId:            z.string().optional().nullable(),
})

// Fields that drive side effects on linked records (invoice paidAmount/status,
// project paidAmount/approvedExpenses, expense/payment records). They cannot be
// changed on a linked row, because a bare update would not re-sync those records.
const LINKED_LOCKED_FIELDS = ['type', 'amount', 'currency', 'amountBDT', 'invoiceId', 'projectId']

const idStr = v => (v == null || v === '' ? null : String(v))

// GET /api/transactions/[id]
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'finance.transactions.view')   // financial record
    if (denied) return denied

    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()

    const transaction = await Transaction.findById(params.id)
    if (!transaction) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({ data: transaction })
  } catch (err) {
    console.error('[GET /api/transactions/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/transactions/[id]
export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'finance.transactions.update')
    if (denied) return denied

    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()

    const body   = await request.json()
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    const existing = await Transaction.findById(params.id).lean()
    if (!existing) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const { date, txnId, ...rest } = parsed.data

    // txnId is the system ledger id: never cleared (a null would also collide on
    // the unique sparse index) and never renamed. External references belong in
    // the `reference` field.
    if (txnId && txnId.trim() && txnId.trim() !== (existing.txnId ?? '')) {
      return NextResponse.json({ error: 'Transaction ID cannot be changed. Put external references in the Reference field.' }, { status: 422 })
    }

    let txDate
    if (date) {
      txDate = new Date(date)
      if (Number.isNaN(txDate.getTime())) return NextResponse.json({ error: 'Invalid date' }, { status: 422 })
    }

    // Final currency / amounts after the edit, with amountBDT recomputed.
    const currency = rest.currency ?? existing.currency ?? BASE_CURRENCY
    if (!isValidCurrency(currency)) return NextResponse.json({ error: 'Unsupported currency' }, { status: 422 })
    const amount = rest.amount ?? Number(existing.amount)
    let amountBDT
    if (currency === BASE_CURRENCY) {
      amountBDT = amount
    } else {
      const currencyOrAmountChanged = currency !== (existing.currency ?? BASE_CURRENCY) || amount !== Number(existing.amount)
      amountBDT = rest.amountBDT ?? (currencyOrAmountChanged ? null : existing.amountBDT)
      if (!(Number(amountBDT) > 0)) {
        return NextResponse.json({ error: 'Enter the BDT-equivalent for a non-BDT transaction' }, { status: 422 })
      }
    }

    const update = { ...rest, currency, amount, amountBDT }
    if (txDate) update.date = txDate
    for (const [k, v] of Object.entries(update)) if (v === '') update[k] = null

    // Expenses must go through the expense-request pipeline, so an entry can't be
    // turned into an EXPENSE by editing it.
    if (update.type === 'EXPENSE' && existing.type !== 'EXPENSE') {
      return NextResponse.json({ error: 'An income entry cannot be changed into an expense.' }, { status: 422 })
    }

    // Rows linked to an invoice, an expense (payExpense sets reference = expense id)
    // or a confirmed project payment: block edits to the fields that drive their
    // side effects, since this update would not re-sync those records.
    const [linkedExpense, linkedPayment] = await Promise.all([
      existing.reference && isValidObjectId(existing.reference)
        ? ProjectExpense.exists({ _id: existing.reference })
        : null,
      ProjectPayment.exists({ transactionId: existing._id }),
    ])
    const isLinked = !!(existing.invoiceId || linkedExpense || linkedPayment)
    const changed = (k) => {
      if (!(k in update)) return false
      const after = update[k]
      // Legacy BDT rows may have no amountBDT; their BDT value is the amount.
      const before = (k === 'amountBDT' && existing.amountBDT == null && (existing.currency ?? BASE_CURRENCY) === BASE_CURRENCY)
        ? existing.amount
        : existing[k]
      if (k === 'amount' || k === 'amountBDT') {
        if (before == null && after == null) return false
        return Math.abs((Number(after) || 0) - (Number(before) || 0)) > 0.001
      }
      return idStr(after) !== idStr(before)
    }
    if (isLinked) {
      const locked = LINKED_LOCKED_FIELDS.filter(changed)
      if (locked.length) {
        return NextResponse.json({
          error: `This transaction is linked to an invoice, expense or payment; ${locked.join(', ')} cannot be edited here.`,
        }, { status: 422 })
      }
    }

    const transaction = await Transaction.findByIdAndUpdate(
      params.id,
      { $set: update },
      { new: true }
    )

    // Audit a before/after diff of the fields that actually changed.
    const diff = {}
    for (const k of Object.keys(update)) {
      if (k === 'date') {
        const b = existing.date ? new Date(existing.date).toISOString() : null
        const a = update.date.toISOString()
        if (a !== b) diff.date = { from: b, to: a }
      } else if (changed(k)) {
        diff[k] = { from: existing[k] ?? null, to: update[k] ?? null }
      }
    }

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'UPDATE',
      entity:   'TRANSACTION',
      entityId: params.id,
      changes:  JSON.stringify(diff),
      request,
    })

    return NextResponse.json({ data: transaction })
  } catch (err) {
    console.error('[PUT /api/transactions/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// Transactions are an immutable financial ledger — there is intentionally NO DELETE
// handler. A transaction can never be deleted through the API. Do not add one.
