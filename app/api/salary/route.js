export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { User, Employee, SalarySlip, ProjectExpense } from '@/models'
import { normalizeDeptCode } from '@/models/Employee'
import { requirePerm, canDo } from '@/lib/rbac'
import { ciEquals, ciContains } from '@/lib/searchMatch'
import { maskMoney } from '@/lib/pii'
import { isValidCurrency } from '@/lib/currencies'
import { isValidObjectId } from '@/lib/objectId'
import { dhakaParts, dhakaDate } from '@/lib/dhakaTime'

// Current payroll period in the business timezone (Asia/Dhaka), not server UTC.
function currentPeriod() {
  const { year, month } = dhakaParts()
  return `${year}-${String(month + 1).padStart(2, '0')}`
}

// 'YYYY-MM' with a real month (01-12).
function isValidPeriod(period) {
  const m = /^(\d{4})-(\d{2})$/.exec(period)
  return !!m && Number(m[2]) >= 1 && Number(m[2]) <= 12
}

// GET /api/salary?period=YYYY-MM&department=&venture=&status=&search=&page=&limit=
// Employee-centric payroll list for one period: every matching employee, plus
// whichever salary slip (if any) exists for that period, merged into one row.
// Filtering/pagination happens in-memory after the merge (same pattern the
// freelancer finance rollups use — see lib/freelancerBalance.js) since salary
// status only exists once the slip + expense are joined.
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'finance.salary.view')
    if (denied) return denied
    await connectDB()

    const { searchParams } = new URL(request.url)
    const period     = searchParams.get('period') || currentPeriod()
    if (!isValidPeriod(period)) return NextResponse.json({ error: 'Period must be in YYYY-MM format' }, { status: 422 })
    const department = searchParams.get('department')
    const venture    = searchParams.get('venture')
    const search     = searchParams.get('search')
    const status     = searchParams.get('status') // NOT_GENERATED|PENDING|PAID|AUTHORIZED|REJECTED
    const empStatus  = searchParams.get('empStatus') === 'all' ? 'all' : 'active'
    const page       = parseInt(searchParams.get('page')  ?? '1',  10)
    const limit      = parseInt(searchParams.get('limit') ?? '20', 10)

    const filter = {}
    if (empStatus === 'active') {
      // "Active" for a period = not resigned, OR resigned on/after the period
      // started (their final month), OR already has a slip for this period —
      // so final-month slips can be generated and past totals stay complete.
      const [py, pm] = period.split('-').map(Number)
      const slipEmployeeIds = await SalarySlip.distinct('employeeId', { period })
      filter.$and = [{ $or: [
        { resigned: { $ne: true } },
        { resignDate: { $gte: dhakaDate(py, pm - 1, 1) } },
        { _id: { $in: slipEmployeeIds } },
      ] }]
    }
    if (department) {
      const code = normalizeDeptCode(department)
      filter.department = code ? ciEquals(code) : ciContains(department)
    }
    if (venture) filter.venture = venture
    if (search) {
      const matchingUsers = await User.find({
        $or: [{ name: ciContains(search) }, { email: ciContains(search) }],
      }).select('_id').lean()
      filter.$or = [
        { userId:     { $in: matchingUsers.map(u => u._id) } },
        { employeeId: ciContains(search) },
      ]
    }

    const employees = await Employee.find(filter)
      .populate('userId', 'name email avatar')
      .sort({ createdAt: -1 })
      .lean()

    const slips = await SalarySlip.find({ period, employeeId: { $in: employees.map(e => e._id) } })
      .populate({ path: 'expenseId', select: 'status amountBDT paidAt paymentMethod paymentTxnId expenseId expenseInvoiceNo signedInvoiceUrl' })
      .lean()
    const slipByEmployee = new Map(slips.map(s => [s.employeeId.toString(), s]))

    // Base salary is financial PII: visible to payroll operators (who need it to
    // generate slips) and to pii.financial.view holders only.
    const canSeeSalary = canDo(session, 'pii.financial.view') || canDo(session, 'finance.salary.pay')

    let rows = employees.map(e => {
      const slip = slipByEmployee.get(e._id.toString()) ?? null
      const salaryStatus = slip ? (slip.expenseId?.status ?? 'PENDING') : 'NOT_GENERATED'
      return {
        id:          e._id.toString(),
        name:        e.userId?.name ?? '—',
        avatar:      e.userId?.avatar ?? null,
        employeeId:  e.employeeId ?? null,
        department:  e.department ?? null,
        position:    e.position ?? null,
        designation: e.designation ?? null,
        venture:     e.venture ?? null,
        resigned:    !!e.resigned,
        baseSalary:  canSeeSalary ? (e.salary ?? null) : maskMoney(e.salary ?? null),
        slip: slip ? {
          id:        slip._id.toString(),
          slipNo:    slip.slipNo,
          netPay:    slip.netPay,
          currency:  slip.currency,
          amountBDT: slip.amountBDT,
          expense:   slip.expenseId ?? null,
        } : null,
        salaryStatus,
      }
    })

    // Summary reflects the department/venture/search scope regardless of the
    // status filter, so the stat cards stay a stable reference while filtering.
    const summary = {
      totalEmployees: employees.length,
      notGenerated:   rows.filter(r => r.salaryStatus === 'NOT_GENERATED').length,
      pending:        rows.filter(r => r.salaryStatus === 'PENDING').length,
      paidCount:      rows.filter(r => ['PAID', 'AUTHORIZED'].includes(r.salaryStatus)).length,
      paidAmountBDT:  rows
        .filter(r => ['PAID', 'AUTHORIZED'].includes(r.salaryStatus))
        // Prefer the BDT actually paid (written to the expense on payment) over
        // the generation-time estimate on the slip.
        .reduce((sum, r) => sum + (r.slip?.expense?.amountBDT ?? r.slip?.amountBDT ?? r.slip?.netPay ?? 0), 0),
    }

    if (status) rows = rows.filter(r => r.salaryStatus === status)

    const total = rows.length
    const skip  = (page - 1) * limit
    const data  = rows.slice(skip, skip + limit)

    return NextResponse.json({
      data, meta: { page, limit, total, pages: Math.max(1, Math.ceil(total / limit)) }, summary, period,
    })
  } catch (err) {
    console.error('[GET /api/salary]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/salary — generate a payslip + linked SALARY-origin ProjectExpense
// for one employee/period. The expense is created PENDING and flows through the
// normal Review → Paid → Authorized pipeline from Accounts, exactly like every
// other expense (and the existing freelancer temp-salary flow).
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'finance.salary.pay')
    if (denied) return denied
    await connectDB()

    const body       = await request.json()
    const employeeId = body.employeeId
    const period     = String(body.period ?? '').trim()

    if (!employeeId) return NextResponse.json({ error: 'Employee is required' }, { status: 422 })
    if (!isValidObjectId(employeeId)) return NextResponse.json({ error: 'Invalid employee' }, { status: 400 })
    if (!isValidPeriod(period)) return NextResponse.json({ error: 'Period must be in YYYY-MM format' }, { status: 422 })
    if (period > currentPeriod()) return NextResponse.json({ error: 'Cannot generate a salary slip for a future period' }, { status: 422 })

    const employee = await Employee.findById(employeeId).populate('userId', 'name')
    if (!employee) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })

    const existing = await SalarySlip.findOne({ employeeId, period }).lean()
    if (existing) return NextResponse.json({ error: `A salary slip for ${period} already exists for this employee` }, { status: 409 })

    const rawItems = Array.isArray(body.items) ? body.items : []
    const items = rawItems
      .map(it => ({
        type:   it.type === 'DEDUCTION' ? 'DEDUCTION' : 'EARNING',
        label:  String(it.label ?? '').trim(),
        amount: Number(it.amount),
      }))
      .filter(it => it.label && Number.isFinite(it.amount) && it.amount > 0)

    const baseSalary       = Number(employee.salary) || 0
    const earningsTotal    = items.filter(i => i.type === 'EARNING').reduce((s, i) => s + i.amount, 0)
    const deductionsTotal  = items.filter(i => i.type === 'DEDUCTION').reduce((s, i) => s + i.amount, 0)
    const grossEarnings    = baseSalary + earningsTotal
    const netPay           = grossEarnings - deductionsTotal

    if (netPay <= 0) return NextResponse.json({ error: 'Net pay must be greater than zero' }, { status: 422 })

    const currency  = body.currency || 'BDT'
    if (!isValidCurrency(currency)) return NextResponse.json({ error: 'Invalid currency' }, { status: 422 })
    // Employee.salary is a Taka amount — it can't be summed with foreign-currency
    // items and relabelled as that currency.
    if (currency !== 'BDT' && baseSalary > 0)
      return NextResponse.json({ error: "This employee's base salary is in BDT — generate the slip in BDT" }, { status: 422 })
    const rawBDT    = Number(body.amountBDT)
    const amountBDT = currency === 'BDT' ? netPay : (Number.isFinite(rawBDT) && rawBDT > 0 ? rawBDT : null)
    if (currency !== 'BDT' && !amountBDT)
      return NextResponse.json({ error: 'Enter the BDT-equivalent for this foreign-currency salary' }, { status: 422 })

    const note = String(body.note ?? '').trim() || null

    const slip = await new SalarySlip({
      employeeId, period, baseSalary, items,
      grossEarnings, totalDeductions: deductionsTotal, netPay,
      currency, amountBDT, note,
      generatedBy: session.user.id,
    }).save()

    try {
      const expense = await new ProjectExpense({
        origin:      'SALARY',
        projectId:   null,
        title:       `Salary — ${period} — ${employee.userId?.name ?? 'Employee'}`,
        amount:      netPay,
        currency,
        amountBDT,
        category:    'Salary',
        subcategory: 'Employee Salary',
        date:        new Date(),
        notes:       note,
        paidToEmployeeId:     employeeId,
        employeeSalarySlipId: slip._id,
        submittedBy: session.user.id,
        status:      'PENDING',
      }).save()

      slip.expenseId = expense._id
      await slip.save()
    } catch (err) {
      await SalarySlip.deleteOne({ _id: slip._id })
      throw err
    }

    await slip.populate({ path: 'expenseId', select: 'status expenseId expenseInvoiceNo' })
    return NextResponse.json({ data: slip.toJSON() }, { status: 201 })
  } catch (err) {
    if (err?.code === 11000) {
      return NextResponse.json({ error: 'A salary slip for this employee and period already exists' }, { status: 409 })
    }
    console.error('[POST /api/salary]', err)
    return NextResponse.json({ error: err.message || 'Internal server error' }, { status: 500 })
  }
}
