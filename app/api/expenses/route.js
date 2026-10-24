export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { ProjectExpense, Employee, Project, Vendor } from '@/models'
import { requirePerm, canDo } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { isValidCurrency } from '@/lib/currencies'
import { logActivity } from '@/lib/logActivity'
import { buildExpenseTax, payeeProfilesFor, supplierVatTypeOf, inputVatOutcomesFor } from '@/lib/expensePayment'
import { parseDhakaDay } from '@/lib/dhakaTime'
import { getConfig } from '@/lib/getConfig'
import { isValidUnit, ventureUnit } from '@/lib/units'

const ORIGINS = ['PROJECT', 'FREELANCER', 'AGENCY', 'VENDOR', 'SALARY', 'REIMBURSEMENT', 'OTHER']
const STATUSES = ['PENDING', 'PAID', 'AUTHORIZED', 'REJECTED']

// GET /api/expenses?status=PENDING&origin=&venture=&category=&subcategory=&accountId=
//   &startDate=&endDate=&mine=&page=&limit=
// Confirmers also get `payee` per row (tax profile: payeeType, PSR, BIN, VAT status,
// default TDS section — never the TIN itself) for the payment form. Every row gets
// `inputVat` ({ creditable, nonCreditReason, reasonLabel } — the credit the payment
// recorded, which may differ from the credit requested in tax.vatCreditable; null
// when unpaid or without VAT).
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE'].includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await connectDB()

    const { searchParams } = new URL(request.url)
    const page    = Math.max(1, parseInt(searchParams.get('page')  ?? '1',  10) || 1)
    const limit   = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10) || 20))
    const status  = searchParams.get('status')
    const origin  = searchParams.get('origin')
    const venture = searchParams.get('venture')
    const category = searchParams.get('category')
    const subcategory = searchParams.get('subcategory')
    const accountId = searchParams.get('accountId')
    const startDate = searchParams.get('startDate')
    const endDate   = searchParams.get('endDate')
    const mine    = searchParams.get('mine') === 'true'
    const skip    = (page - 1) * limit

    const filter = {}
    if (status) {
      if (!STATUSES.includes(status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
      filter.status = status
    }
    if (origin) {
      if (!ORIGINS.includes(origin)) return NextResponse.json({ error: 'Invalid origin' }, { status: 400 })
      filter.origin = origin
    }
    if (venture) filter.venture = venture
    if (category) filter.category = category
    if (subcategory) filter.subcategory = subcategory
    if (accountId) {
      if (!isValidObjectId(accountId)) return NextResponse.json({ error: 'Invalid account id' }, { status: 400 })
      filter.accountId = accountId
    }
    // Date range on the expense `date`: Asia/Dhaka calendar days, end day inclusive
    // (not the server's local timezone).
    if (startDate || endDate) {
      filter.date = {}
      if (startDate) {
        const d = parseDhakaDay(startDate)
        if (!d) return NextResponse.json({ error: 'Invalid start date' }, { status: 400 })
        filter.date.$gte = d.start
      }
      if (endDate) {
        const d = parseDhakaDay(endDate)
        if (!d) return NextResponse.json({ error: 'Invalid end date' }, { status: 400 })
        filter.date.$lt = d.next
      }
    }
    // Only payment-confirmers see the whole queue; everyone else sees only their own.
    const canConfirm = canDo(session, 'finance.payments.confirm')
    if (mine || !canConfirm) filter.submittedBy = session.user.id

    const [expenses, total] = await Promise.all([
      ProjectExpense.find(filter)
        .sort({ createdAt: -1 })
        .skip(skip).limit(limit)
        .populate('submittedBy', 'name avatar email')
        .populate('reviewedBy', 'name')
        .populate({ path: 'accountId', select: 'name type bankName last4 mfsProvider currency status' })
        .populate({ path: 'projectId', select: 'name venture clientId', populate: { path: 'clientId', select: 'company clientCode userId', populate: { path: 'userId', select: 'name' } } }),
      ProjectExpense.countDocuments(filter),
    ])

    const [profiles, inputVat] = await Promise.all([
      canConfirm ? payeeProfilesFor(expenses) : null,
      inputVatOutcomesFor(expenses),
    ])
    const data = expenses.map(e => {
      const json = e.toJSON()
      if (profiles) json.payee = profiles.get(String(e._id)) ?? null
      // Input-VAT credit the payment actually recorded (paid rows with VAT; else null).
      json.inputVat = inputVat.get(String(e._id)) ?? null
      return json
    })

    return NextResponse.json({
      data,
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
//     accounts user from Add Transaction. Gated on finance.transactions.create.
//     These may also carry the payee (`vendorId` for VENDOR, or free-text
//     `paidToName`) and the bill's `tax` breakdown (VAT in the bill, VDS / TDS to
//     withhold — same shape as ProjectExpense.tax; netPayable is computed).
// Both need `unit` (lib/units.js: a venture, a product or COMPANY) — the business
// unit the cost belongs to. With a project the unit is always that project's
// venture, whatever was sent.
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    await connectDB()

    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

    const isReimbursement = !body.origin || body.origin === 'REIMBURSEMENT'
    if (isReimbursement) {
      const denied = requirePerm(session, 'finance.expenses.submit')
      if (denied) return denied
    } else {
      const denied = requirePerm(session, 'finance.transactions.create')
      if (denied) return denied
    }

    const amount = Number(body.amount)
    const title = typeof body.title === 'string' ? body.title.trim() : ''
    if (!title) return NextResponse.json({ error: 'A reason / title is required' }, { status: 422 })
    if (title.length > 300) return NextResponse.json({ error: 'The title is too long (max 300 characters)' }, { status: 422 })
    if (!Number.isFinite(amount) || amount <= 0) return NextResponse.json({ error: 'Amount must be a positive number' }, { status: 422 })

    // Every expense must be classified. "Reimbursement" is NOT a category — it's the
    // `origin` marker; the category/subcategory say what the money was spent on.
    const category    = String(body.category ?? '').trim()
    const subcategory = String(body.subcategory ?? '').trim() || null
    if (!category) return NextResponse.json({ error: 'A category is required' }, { status: 422 })

    const invoiceUrl = typeof body.invoiceUrl === 'string' && body.invoiceUrl.trim() ? body.invoiceUrl.trim() : null
    const notes      = String(body.notes ?? '').trim()
    // Anti-fraud: an out-of-pocket reimbursement with no proof needs a detailed note.
    if (isReimbursement && !invoiceUrl && notes.length < 30)
      return NextResponse.json({ error: 'Without an attached proof you must describe the expense in detail (at least 30 characters).' }, { status: 422 })

    const currency  = String(body.currency || 'BDT').trim().toUpperCase()
    if (!isValidCurrency(currency)) return NextResponse.json({ error: 'Invalid currency' }, { status: 422 })
    // Reimbursements get their BDT-equivalent at pay time; company expenses enter it up front.
    let amountBDT = currency === 'BDT' ? amount : null
    if (currency !== 'BDT' && !isReimbursement && body.amountBDT !== undefined && body.amountBDT !== null && body.amountBDT !== '') {
      const bdt = Number(body.amountBDT)
      if (!Number.isFinite(bdt) || bdt <= 0) return NextResponse.json({ error: 'BDT-equivalent must be a positive number' }, { status: 422 })
      amountBDT = bdt
    }

    const date = body.date ? new Date(body.date) : new Date()
    if (Number.isNaN(date.getTime())) return NextResponse.json({ error: 'Invalid date' }, { status: 422 })

    let origin           = 'REIMBURSEMENT'   // the "this is a reimbursement" marker
    let paidToEmployeeId = null
    let projectId        = null
    let project          = null
    let vendorId         = null
    let paidToName       = null
    let vendor           = null
    let tax
    if (isReimbursement) {
      // Link the reimbursement to the submitter's Employee record (payout target).
      const employee = await Employee.findOne({ userId: session.user.id }).select('_id').lean()
      paidToEmployeeId = employee?._id ?? null
      if (body.projectId) {
        project = isValidObjectId(body.projectId) ? await Project.findById(body.projectId).select('venture').lean() : null
        if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 422 })
        projectId = body.projectId
      }
    } else {
      if (body.projectId) {
        project = isValidObjectId(body.projectId) ? await Project.findById(body.projectId).select('venture').lean() : null
        if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 422 })
        projectId = body.projectId
      }
      if (body.vendorId) {
        vendor = isValidObjectId(body.vendorId)
          ? await Vendor.findById(body.vendorId).select('vatRegistrationType').lean()
          : null
        if (!vendor) return NextResponse.json({ error: 'Vendor not found' }, { status: 422 })
        vendorId = body.vendorId
      }
      const allowed = ['PROJECT', 'VENDOR', 'OTHER']
      origin = allowed.includes(body.origin) ? body.origin : (vendorId ? 'VENDOR' : (projectId ? 'PROJECT' : 'OTHER'))
      if (typeof body.paidToName === 'string' && body.paidToName.trim()) {
        paidToName = body.paidToName.trim().slice(0, 200)
      }
      try {
        tax = buildExpenseTax(body.tax, { amount })
      } catch (err) {
        if (err.status) return NextResponse.json({ error: err.message, field: err.field }, { status: err.status })
        throw err
      }
      // Supplier VAT status not given ⇒ the vendor's (decides the input-VAT credit, s.46).
      if (tax && !tax.supplierVatType) tax.supplierVatType = supplierVatTypeOf(vendor)
    }

    // Business unit: the project's venture, else the venture / product / Company chosen.
    const fromProject = ventureUnit(project?.venture || null)
    const unit = fromProject || (typeof body.unit === 'string' ? body.unit.trim() : '')
    if (!unit)
      return NextResponse.json({ error: 'Choose the venture or product this expense is for (or Company / shared)', field: 'unit' }, { status: 422 })
    if (!fromProject && !isValidUnit(unit, await getConfig()))
      return NextResponse.json({ error: 'Unknown venture or product — choose one from the list', field: 'unit' }, { status: 422 })

    const expense = await new ProjectExpense({
      origin,
      projectId,
      unit,
      venture:          project?.venture ?? null,
      title,
      amount,
      currency,
      amountBDT,
      category,
      subcategory,
      date,
      notes:            notes || null,
      invoiceUrl,
      vendorId,
      paidToName,
      paidToEmployeeId,
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
        expenseId: expense.expenseId ?? null, origin, unit, title, category, subcategory, amount, currency,
        ...(tax && { vat: tax.vatAmount, vds: tax.vdsAmount, tds: tax.tdsAmount, netPayable: tax.netPayable }),
      }),
      request,
    })

    return NextResponse.json({ data: expense.toJSON() }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/expenses]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
