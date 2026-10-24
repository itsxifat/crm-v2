export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Project, ProjectExpense, Freelancer, Vendor, Employee } from '@/models'
import { requireStaff } from '@/lib/rbac'
import { canAccess } from '@/lib/permissions'
import { canAccessProject, canViewProjectFinancials } from '@/lib/projectAccess'
import { isValidObjectId } from '@/lib/objectId'
import { isValidCurrency } from '@/lib/currencies'
import { logActivity } from '@/lib/logActivity'
import { buildExpenseTax, supplierVatTypeOf } from '@/lib/expensePayment'
import { COMPANY_UNIT, ventureUnit } from '@/lib/units'

// GET /api/projects/:id/expenses — internal cost data: staff who can view the
// project AND project financials (same gate as GET /api/projects/:id).
export async function GET(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requireStaff(session)
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!canViewProjectFinancials(session))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await connectDB()

    if (!(await Project.exists({ _id: params.id })))
      return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!(await canAccessProject(session, params.id)))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const expenses = await ProjectExpense.find({ projectId: params.id })
      .sort({ createdAt: -1 })
      .populate('submittedBy', 'name avatar')
      .populate('reviewedBy', 'name')
      .populate({ path: 'accountId', select: 'name type bankName last4 mfsProvider currency' })

    return NextResponse.json({ data: expenses.map(e => e.toJSON()) })
  } catch (err) {
    console.error('[GET expenses]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/projects/:id/expenses — same gate as company/project expenses on
// POST /api/expenses (accounts.addTransaction), plus access to this project.
// Body: { title, category, subcategory?, amount (> 0, gross bill incl. VAT), currency?,
//   amountBDT? (BDT equivalent for non-BDT; else entered when paid), date?, notes?,
//   invoiceUrl?, freelancerId | agencyId | vendorId | paidToEmployeeId (at most one), paidToName?,
//   tax? (same shape as ProjectExpense.tax — VAT in the bill, VDS / TDS to withhold) }
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requireStaff(session)
    if (denied) return denied
    if (!canAccess(session, 'accounts', 'addTransaction'))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await connectDB()

    const project = await Project.findById(params.id)
    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (!(await canAccessProject(session, project)))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (!title) return NextResponse.json({ error: 'A title is required' }, { status: 422 })
    if (title.length > 300) return NextResponse.json({ error: 'The title is too long (max 300 characters)' }, { status: 422 })
    const category = typeof body.category === 'string' ? body.category.trim() : ''
    if (!category) return NextResponse.json({ error: 'A category is required' }, { status: 422 })

    // An expense that enters the pay pipeline must have something to pay.
    const amount = Number(body.amount)
    if (!Number.isFinite(amount) || amount <= 0)
      return NextResponse.json({ error: 'Amount must be greater than zero' }, { status: 422 })

    const currency = String(body.currency || 'BDT').trim().toUpperCase()
    if (!isValidCurrency(currency)) return NextResponse.json({ error: 'Invalid currency' }, { status: 422 })
    let amountBDT = currency === 'BDT' ? amount : null
    if (currency !== 'BDT' && body.amountBDT !== undefined && body.amountBDT !== null && body.amountBDT !== '') {
      const bdt = Number(body.amountBDT)
      if (!Number.isFinite(bdt) || bdt <= 0) return NextResponse.json({ error: 'BDT-equivalent must be a positive number' }, { status: 422 })
      amountBDT = bdt
    }

    const date = body.date ? new Date(body.date) : new Date()
    if (Number.isNaN(date.getTime())) return NextResponse.json({ error: 'Invalid date' }, { status: 422 })

    // Payee references must be well-formed and exist (at most one payee).
    const payeeRefs = [
      ['freelancerId',     Freelancer],
      ['agencyId',         Freelancer],
      ['vendorId',         Vendor],
      ['paidToEmployeeId', Employee],
    ].filter(([key]) => body[key])
    if (payeeRefs.length > 1)
      return NextResponse.json({ error: 'Select a single payee' }, { status: 422 })
    let vendor = null
    for (const [key, Model] of payeeRefs) {
      const found = isValidObjectId(body[key])
        ? await Model.findById(body[key]).select(key === 'vendorId' ? 'vatRegistrationType' : '_id').lean()
        : null
      if (!found) return NextResponse.json({ error: 'Selected payee not found' }, { status: 422 })
      if (key === 'vendorId') vendor = found
    }

    let tax
    try {
      tax = buildExpenseTax(body.tax, { amount })
    } catch (err) {
      if (err.status) return NextResponse.json({ error: err.message, field: err.field }, { status: err.status })
      throw err
    }
    // Supplier VAT status not given ⇒ the vendor's (decides the input-VAT credit, s.46).
    if (tax && !tax.supplierVatType) tax.supplierVatType = supplierVatTypeOf(vendor)

    const expense = await new ProjectExpense({
      projectId:        params.id,
      origin:           'PROJECT',
      venture:          project.venture ?? null,
      // A project's costs belong to its venture (snapshot, like `venture`).
      unit:             ventureUnit(project.venture || null) || COMPANY_UNIT,
      title,
      amount,
      currency,
      amountBDT,
      category,
      subcategory:      typeof body.subcategory === 'string' && body.subcategory.trim() ? body.subcategory.trim() : null,
      date,
      notes:            typeof body.notes === 'string' && body.notes.trim() ? body.notes.trim() : null,
      invoiceUrl:       typeof body.invoiceUrl === 'string' && body.invoiceUrl.trim() ? body.invoiceUrl.trim() : null,
      freelancerId:     body.freelancerId     ?? null,
      agencyId:         body.agencyId         ?? null,
      vendorId:         body.vendorId         ?? null,
      paidToEmployeeId: body.paidToEmployeeId ?? null,
      paidToName:       typeof body.paidToName === 'string' && body.paidToName.trim() ? body.paidToName.trim().slice(0, 200) : null,
      ...(tax !== undefined && { tax }),
      submittedBy:      session.user.id,
      status:           'PENDING',
    }).save()

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'CREATE',
      entity:   'EXPENSE',
      entityId: expense._id.toString(),
      changes:  JSON.stringify({
        expenseId: expense.expenseId ?? null, projectId: params.id, title, category, amount, currency,
        ...(tax && { vat: tax.vatAmount, vds: tax.vdsAmount, tds: tax.tdsAmount, netPayable: tax.netPayable }),
      }),
      request,
    })

    return NextResponse.json({ data: expense.toJSON() }, { status: 201 })
  } catch (err) {
    console.error('[POST expenses]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
