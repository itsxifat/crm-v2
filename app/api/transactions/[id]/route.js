export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Transaction } from '@/models'
import { requireManager } from '@/lib/rbac'
import { logActivity } from '@/lib/logActivity'
import { z } from 'zod'

const updateSchema = z.object({
  type:        z.enum(['INCOME', 'EXPENSE']).optional(),
  category:    z.string().min(1).optional(),
  amount:      z.coerce.number().positive().optional(),
  description: z.string().min(1).optional(),
  date:        z.string().optional(),
  reference:       z.string().optional().nullable(),
  currency:        z.string().optional(),
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
  txnId:            z.string().optional().nullable(),
})

// GET /api/transactions/[id]
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requireManager(session)   // financial record
    if (denied) return denied

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
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const allowedRoles = ['SUPER_ADMIN', 'MANAGER']
    if (!allowedRoles.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const body   = await request.json()
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    const { date, ...rest } = parsed.data
    const transaction = await Transaction.findByIdAndUpdate(
      params.id,
      { ...rest, ...(date && { date: new Date(date) }) },
      { new: true }
    )

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'UPDATE',
      entity:   'TRANSACTION',
      entityId: params.id,
      changes:  JSON.stringify({ type: transaction?.type, amount: transaction?.amount }),
      request,
    })

    return NextResponse.json({ data: transaction })
  } catch (err) {
    console.error('[PUT /api/transactions/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/transactions/[id]
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    if (session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()
    const deleted = await Transaction.findByIdAndDelete(params.id)

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'DELETE',
      entity:   'TRANSACTION',
      entityId: params.id,
      changes:  deleted ? JSON.stringify({ type: deleted.type, amount: deleted.amount }) : null,
      request,
    })

    return NextResponse.json({ message: 'Transaction deleted' })
  } catch (err) {
    console.error('[DELETE /api/transactions/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
