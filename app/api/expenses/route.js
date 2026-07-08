export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { ProjectExpense, Employee } from '@/models'
import { requirePerm, canDo } from '@/lib/rbac'
import { canAccess } from '@/lib/permissions'

// GET /api/expenses?status=PENDING&origin=&venture=&mine=&page=&limit=
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!['SUPER_ADMIN','MANAGER','EMPLOYEE'].includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await connectDB()

    const { searchParams } = new URL(request.url)
    const page    = parseInt(searchParams.get('page')  ?? '1',  10)
    const limit   = parseInt(searchParams.get('limit') ?? '20', 10)
    const status  = searchParams.get('status')
    const origin  = searchParams.get('origin')
    const venture = searchParams.get('venture')
    const category = searchParams.get('category')
    const subcategory = searchParams.get('subcategory')
    const startDate = searchParams.get('startDate')
    const endDate   = searchParams.get('endDate')
    const mine    = searchParams.get('mine') === 'true'
    const skip    = (page - 1) * limit

    const filter = {}
    if (status)  filter.status  = status
    if (origin)  filter.origin  = origin
    if (venture) filter.venture = venture
    if (category) filter.category = category
    if (subcategory) filter.subcategory = subcategory
    // Date range on the expense `date` (inclusive of the whole end day).
    if (startDate || endDate) {
      filter.date = {}
      if (startDate) filter.date.$gte = new Date(`${startDate}T00:00:00.000`)
      if (endDate)   filter.date.$lte = new Date(`${endDate}T23:59:59.999`)
    }
    // Only payment-confirmers see the whole queue; everyone else sees only their own.
    if (mine || !canDo(session, 'finance.payments.confirm')) filter.submittedBy = session.user.id

    const [expenses, total] = await Promise.all([
      ProjectExpense.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip).limit(limit)
        .populate('submittedBy', 'name avatar email')
        .populate('reviewedBy', 'name')
        .populate({ path: 'projectId', select: 'name venture clientId', populate: { path: 'clientId', populate: { path: 'userId', select: 'name' } } }),
      ProjectExpense.countDocuments(filter),
    ])

    return NextResponse.json({
      data: expenses.map(e => e.toJSON()),
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  } catch (err) {
    console.error('[GET /api/expenses]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/expenses — create a PENDING expense request that enters the shared
// Review → Paid → Authorized pipeline. No ledger Transaction is written here; it
// is created only when the request is marked Paid (see lib/expensePayment.js).
// Two sources, distinguished by `origin`:
//   • REIMBURSEMENT (default): an employee's out-of-pocket spend, submitted from
//     "My Expenses". Gated on finance.expenses.submit; linked to their Employee.
//   • Company / project expense (origin PROJECT | VENDOR | OTHER): logged by an
//     accounts user from Add Transaction. Gated on accounts.addTransaction.
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    await connectDB()

    const body = await request.json()

    const isReimbursement = !body.origin || body.origin === 'REIMBURSEMENT'
    if (isReimbursement) {
      const denied = requirePerm(session, 'finance.expenses.submit')
      if (denied) return denied
    } else if (!canAccess(session, 'accounts', 'addTransaction')) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const amount = Number(body.amount)
    if (!body.title?.trim()) return NextResponse.json({ error: 'A reason / title is required' }, { status: 422 })
    if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: 'Amount must be a positive number' }, { status: 422 })

    // Every expense must be classified. "Reimbursement" is NOT a category — it's the
    // `origin` marker; the category/subcategory say what the money was spent on.
    const category    = (body.category ?? '').trim()
    const subcategory = (body.subcategory ?? '').trim() || null
    if (!category) return NextResponse.json({ error: 'A category is required' }, { status: 422 })

    const invoiceUrl = body.invoiceUrl ?? null
    const notes      = (body.notes ?? '').trim()
    // Anti-fraud: an out-of-pocket reimbursement with no proof needs a detailed note.
    if (isReimbursement && !invoiceUrl && notes.length < 30)
      return NextResponse.json({ error: 'Without an attached proof you must describe the expense in detail (at least 30 characters).' }, { status: 422 })

    const currency  = body.currency ?? 'BDT'
    // Reimbursements get their BDT-equivalent at pay time; company expenses enter it up front.
    const amountBDT = currency === 'BDT' ? amount : (isReimbursement ? null : (Number(body.amountBDT) || null))

    let origin           = 'REIMBURSEMENT'   // the "this is a reimbursement" marker
    let paidToEmployeeId = null
    if (isReimbursement) {
      // Link the reimbursement to the submitter's Employee record (payout target).
      const employee = await Employee.findOne({ userId: session.user.id }).select('_id').lean()
      paidToEmployeeId = employee?._id ?? null
    } else {
      const allowed = ['PROJECT', 'VENDOR', 'OTHER']
      origin = allowed.includes(body.origin) ? body.origin : (body.projectId ? 'PROJECT' : 'OTHER')
    }

    const expense = await new ProjectExpense({
      origin,
      projectId:        body.projectId ?? null,
      title:            body.title.trim(),
      amount,
      currency,
      amountBDT,
      category,
      subcategory,
      date:             body.date ? new Date(body.date) : new Date(),
      notes:            notes || null,
      invoiceUrl,
      paidToEmployeeId,
      submittedBy:      session.user.id,
      status:           'PENDING',
    }).save()

    return NextResponse.json({ data: expense.toJSON() }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/expenses]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
