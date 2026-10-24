export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { User, Employee, SalarySlip, ProjectExpense } from '@/models'
import { normalizeDeptCode } from '@/models/Employee'
import { requirePerm, canDo } from '@/lib/rbac'
import { ciEquals, ciContains } from '@/lib/searchMatch'
import { codeContains } from '@/lib/codes'
import { maskMoney } from '@/lib/pii'
import { isValidCurrency } from '@/lib/currencies'
import { isValidObjectId } from '@/lib/objectId'
import { dhakaParts, dhakaDate } from '@/lib/dhakaTime'
import { logActivity } from '@/lib/logActivity'
import { buildExpenseTax, expenseSettlement } from '@/lib/expensePayment'
import { applyDueRevisions, salaryForPeriod, salariesForPeriod } from '@/lib/hr/salaryRevisions'
import { COMPANY_UNIT, ventureUnit } from '@/lib/units'

// Income tax deducted from salary is TDS under ITA 2023 s.86.
const SALARY_TDS_SECTION = '86-SALARY'
const MAX_ITEMS = 50

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

/**
 * Cash actually paid to the employee (BDT) and the income tax withheld (BDT)
 * for a paid salary expense. Falls back to the slip figures for legacy rows.
 */
function paidFigures(slip) {
  const exp = slip?.expense
  if (exp && exp.amount != null) {
    const fig = expenseSettlement(exp)
    return { netBDT: fig.netBDT, taxBDT: fig.tdsBDT }
  }
  return { netBDT: exp?.amountBDT ?? slip?.amountBDT ?? slip?.netPay ?? 0, taxBDT: 0 }
}

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
      // Employee IDs match with separators ignored (EN-DEV2610001 = ENDEV2610001).
      const code = codeContains(search)
      filter.$or = [
        { userId:     { $in: matchingUsers.map(u => u._id) } },
        ...(code ? [{ employeeId: code }] : []),
      ]
    }

    await applyDueRevisions()
    const employees = await Employee.find(filter)
      .populate('userId', 'name email avatar')
      .sort({ createdAt: -1 })
      .lean()
    // The salary of THIS period (a raise from a later month does not apply to it).
    const periodSalaries = await salariesForPeriod(employees, period)

    const slips = await SalarySlip.find({ period, employeeId: { $in: employees.map(e => e._id) } })
      .populate({
        path: 'expenseId',
        select: 'status amount currency amountBDT tax paidAt paymentMethod paymentTxnId expenseId expenseInvoiceNo signedInvoiceUrl accountId channel',
        populate: { path: 'accountId', select: 'name type last4 bankName mfsProvider' },
      })
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
        // Whether an e-TIN is on file (needed for the s.86 salary certificate) — never the TIN itself.
        hasTin:      !!(typeof e.tin === 'string' && e.tin.trim()),
        baseSalary:  canSeeSalary ? (periodSalaries.get(String(e._id)) ?? null) : maskMoney(periodSalaries.get(String(e._id)) ?? null),
        slip: slip ? {
          id:           slip._id.toString(),
          slipNo:       slip.slipNo,
          netPay:       slip.netPay,
          taxDeduction: slip.taxDeduction ?? 0,
          currency:     slip.currency,
          amountBDT:    slip.amountBDT,
          expense:      slip.expenseId ?? null,
        } : null,
        salaryStatus,
      }
    })

    // Summary reflects the department/venture/search scope regardless of the
    // status filter, so the stat cards stay a stable reference while filtering.
    // Paid = cash actually paid to employees (BDT written on payment, net of
    // income tax withheld); the withheld tax is reported separately.
    const paidRows = rows.filter(r => ['PAID', 'AUTHORIZED'].includes(r.salaryStatus))
    const paidTotals = paidRows.reduce((t, r) => {
      const f = paidFigures(r.slip)
      t.net += Number(f.netBDT) || 0
      t.tax += Number(f.taxBDT) || 0
      return t
    }, { net: 0, tax: 0 })
    const summary = {
      totalEmployees: employees.length,
      notGenerated:   rows.filter(r => r.salaryStatus === 'NOT_GENERATED').length,
      pending:        rows.filter(r => r.salaryStatus === 'PENDING').length,
      paidCount:      paidRows.length,
      paidAmountBDT:  round2(paidTotals.net),
      taxDeductedBDT: round2(paidTotals.tax),
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
// Body: { employeeId, period:'YYYY-MM', items:[{ type:'EARNING'|'DEDUCTION', label, amount,
//   isTax?: boolean (DEDUCTION only — income tax withheld, TDS s.86) }], currency?, amountBDT?
//   (BDT equivalent of the NET pay, non-BDT only), note? }
// With income tax: slip.taxDeduction = Σ isTax deductions; the expense amount is
// netPay + taxDeduction with tax { tdsSection:'86-SALARY', tdsAmount, tdsBase: grossEarnings,
// netPayable: netPay }, so paying it moves netPay in cash and records a TDS_PAYABLE
// for the tax on the gross salary.
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'finance.salary.pay')
    if (denied) return denied
    await connectDB()

    let body
    try {
      body = await request.json()
    } catch {
      return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
    }
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
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

    if (body.items !== undefined && !Array.isArray(body.items))
      return NextResponse.json({ error: 'Items must be a list' }, { status: 422 })
    const rawItems = Array.isArray(body.items) ? body.items : []
    if (rawItems.length > MAX_ITEMS) return NextResponse.json({ error: `At most ${MAX_ITEMS} earning/deduction lines` }, { status: 422 })
    const items = rawItems
      .map(it => {
        const type = it?.type === 'DEDUCTION' ? 'DEDUCTION' : 'EARNING'
        return {
          type,
          label:  String(it?.label ?? '').trim().slice(0, 120),
          amount: round2(Number(it?.amount)),
          // Only a deduction can be income tax withheld at source (s.86).
          isTax:  type === 'DEDUCTION' && (it?.isTax === true || it?.isTax === 'true'),
        }
      })
      .filter(it => it.label && Number.isFinite(it.amount) && it.amount > 0)

    // The salary in effect in the slip's own month — not today's, which may already include a later raise.
    const baseSalary       = round2(Number(await salaryForPeriod(employee, period)) || 0)
    const earningsTotal    = round2(items.filter(i => i.type === 'EARNING').reduce((s, i) => s + i.amount, 0))
    const deductionsTotal  = round2(items.filter(i => i.type === 'DEDUCTION').reduce((s, i) => s + i.amount, 0))
    const taxDeduction     = round2(items.filter(i => i.isTax).reduce((s, i) => s + i.amount, 0))
    const grossEarnings    = round2(baseSalary + earningsTotal)
    const netPay           = round2(grossEarnings - deductionsTotal)

    if (netPay <= 0) return NextResponse.json({ error: 'Net pay must be greater than zero' }, { status: 422 })

    const currency  = String(body.currency || 'BDT').toUpperCase()
    if (!isValidCurrency(currency)) return NextResponse.json({ error: 'Invalid currency' }, { status: 422 })
    // Employee.salary is a Taka amount — it can't be summed with foreign-currency
    // items and relabelled as that currency.
    if (currency !== 'BDT' && baseSalary > 0)
      return NextResponse.json({ error: "This employee's base salary is in BDT — generate the slip in BDT" }, { status: 422 })
    const rawBDT    = Number(body.amountBDT)
    const amountBDT = currency === 'BDT' ? netPay : (Number.isFinite(rawBDT) && rawBDT > 0 ? round2(rawBDT) : null)
    if (currency !== 'BDT' && !amountBDT)
      return NextResponse.json({ error: 'Enter the BDT-equivalent for this foreign-currency salary' }, { status: 422 })

    // Income tax withheld (s.86) stays a salary cost but is paid to the
    // government, not the employee: the expense is the salary before tax
    // (net pay + tax) with the tax as TDS, so the cash paid is the net pay.
    const expenseAmount    = round2(netPay + taxDeduction)
    const expenseAmountBDT = currency === 'BDT' ? expenseAmount : round2(amountBDT * expenseAmount / netPay)
    let expenseTax
    if (taxDeduction > 0) {
      try {
        expenseTax = buildExpenseTax({
          tdsSection: SALARY_TDS_SECTION,
          tdsAmount:  taxDeduction,
          // s.86 TDS is on the salary paid (gross earnings), not on the expense
          // amount (net pay + tax) — the certificate / WHT return show this base.
          tdsBase:    grossEarnings,
          payeeType:  'INDIVIDUAL',
          taxDeductible: true,
        }, { amount: expenseAmount })
      } catch (err) {
        if (err.status) return NextResponse.json({ error: err.message }, { status: err.status })
        throw err
      }
    }

    const note = String(body.note ?? '').trim().slice(0, 2000) || null

    const slip = await new SalarySlip({
      employeeId, period, baseSalary, items,
      grossEarnings, totalDeductions: deductionsTotal, netPay, taxDeduction,
      currency, amountBDT, note,
      generatedBy: session.user.id,
    }).save()

    let expense
    try {
      expense = await new ProjectExpense({
        origin:      'SALARY',
        projectId:   null,
        // Salaries follow the employee's venture; staff with none are a shared cost.
        unit:        ventureUnit(employee.venture || null) || COMPANY_UNIT,
        title:       `Salary — ${period} — ${employee.userId?.name ?? 'Employee'}`,
        amount:      expenseAmount,
        currency,
        amountBDT:   expenseAmountBDT,
        category:    'Salary',
        subcategory: 'Employee Salary',
        date:        new Date(),
        notes:       note,
        paidToEmployeeId:     employeeId,
        employeeSalarySlipId: slip._id,
        ...(expenseTax && { tax: expenseTax }),
        submittedBy: session.user.id,
        status:      'PENDING',
      }).save()

      slip.expenseId = expense._id
      await slip.save()
    } catch (err) {
      await SalarySlip.deleteOne({ _id: slip._id })
      if (expense?._id) await ProjectExpense.deleteOne({ _id: expense._id, status: 'PENDING' }).catch(() => {})
      throw err
    }

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'CREATE',
      entity:   'SALARY_SLIP',
      entityId: slip._id.toString(),
      changes:  JSON.stringify({
        slipNo: slip.slipNo, employeeId, period, grossEarnings, totalDeductions: deductionsTotal,
        taxDeduction, netPay, currency, expenseId: expense.expenseId ?? null,
      }),
      request,
    })

    await slip.populate({ path: 'expenseId', select: 'status expenseId expenseInvoiceNo amount tax' })
    return NextResponse.json({ data: slip.toJSON() }, { status: 201 })
  } catch (err) {
    if (err?.code === 11000) {
      return NextResponse.json({ error: 'A salary slip for this employee and period already exists' }, { status: 409 })
    }
    console.error('[POST /api/salary]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
