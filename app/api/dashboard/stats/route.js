export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import mongoose from 'mongoose'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import {
  Lead, Project, Client, Task, Invoice, FreelancerAssignment, SalaryPayout,
  Transaction, Employee, Attendance, Leave, User,
} from '@/models'
import { requireStaff, canDo } from '@/lib/rbac'
import { maskList, maskMoney, LEAD_PII } from '@/lib/pii'
import { dhakaParts, dhakaDate, dhakaMonthStart, dhakaDayStart } from '@/lib/dhakaTime'

const MONTH_SHORT = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

// % change that also behaves for negative baselines (e.g. profit after a loss)
const pctChange = (cur, prev) =>
  prev !== 0 ? Math.round(((cur - prev) / Math.abs(prev)) * 100) : (cur === 0 ? 0 : (cur > 0 ? 100 : -100))
const sumAmt = (txs) => txs.reduce((s, t) => s + (Number(t.amountBDT ?? t.amount) || 0), 0)

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requireStaff(session)
    if (denied) return denied

    // Each block is gated by its own permission; the accounts overview tab reuses
    // this endpoint for its finance cards, so finance.overview.view alone suffices.
    const can = {
      dashboard:   canDo(session, 'dashboard.view'),
      finance:     canDo(session, 'finance.overview.view'),
      leads:       canDo(session, 'sales.leads.view'),
      leadValue:   canDo(session, 'pii.financial.view'),
      projects:    canDo(session, 'projects.view'),
      tasks:       canDo(session, 'tasks.view'),
      clients:     canDo(session, 'sales.customers.view'),
      invoiceList: canDo(session, 'sales.invoices.view'),
      hr:          canDo(session, 'hr.employees.view'),
    }
    if (!can.dashboard && !can.finance)
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    const dash = can.dashboard

    await connectDB()

    const { searchParams } = new URL(request.url)
    const drillMonth = searchParams.get('drillMonth')

    // ── Drill-down: daily breakdown of one Dhaka calendar month ──────────────
    // Answered on its own so switching months doesn't recompute the whole dashboard.
    if (drillMonth) {
      if (!can.finance) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(drillMonth))
        return NextResponse.json({ error: 'Invalid drillMonth' }, { status: 400 })
      const [yr, mo]    = drillMonth.split('-').map(Number)
      const monthStart  = dhakaDate(yr, mo - 1, 1)
      const monthEnd    = dhakaDate(yr, mo, 1)
      const txInMonth   = await Transaction.find({ date: { $gte: monthStart, $lt: monthEnd } }).select('type amount amountBDT date').lean()
      const daysInMonth = new Date(Date.UTC(yr, mo, 0)).getUTCDate()
      const dailyData   = []
      for (let d = 1; d <= daysInMonth; d++) {
        const dayTx   = txInMonth.filter(tx => dhakaParts(tx.date).day === d)
        const income  = sumAmt(dayTx.filter(t => t.type === 'INCOME'))
        const expense = sumAmt(dayTx.filter(t => t.type === 'EXPENSE'))
        dailyData.push({ day: d, income, expense, profit: income - expense, txCount: dayTx.length })
      }
      return NextResponse.json({ data: { dailyData } })
    }

    // ── Scoping: employees only see their own leads / projects / tasks ────────
    const isEmployee   = session.user.role === 'EMPLOYEE'
    const leadFilter   = {}
    const taskFilter   = {}
    const projectScope = {}
    if (isEmployee) {
      const employee = await Employee.findOne({ userId: session.user.id }).select('_id').lean()
      leadFilter.assignedToId       = employee?._id ?? null
      taskFilter.assignedEmployeeId = employee?._id ?? null
      // aggregate() doesn't cast, so use a real ObjectId (never null — that would
      // match every project without a manager)
      if (mongoose.Types.ObjectId.isValid(session.user.id)) {
        const uid = new mongoose.Types.ObjectId(session.user.id)
        projectScope.$or = [{ projectManagerId: uid }, { teamMembers: uid }]
      } else {
        projectScope._id = null
      }
    }

    // ── Business-timezone (Asia/Dhaka) boundaries ─────────────────────────────
    const now            = new Date()
    const thisMonthStart = dhakaMonthStart(now)
    const nextMonthStart = dhakaMonthStart(now, 1)
    const lastMonthStart = dhakaMonthStart(now, -1)
    const todayStart     = dhakaDayStart(now)
    const tomorrowStart  = dhakaDayStart(now, 1)
    const sixMonthsAgo   = dhakaMonthStart(now, -5)
    const in3Days        = new Date(now.getTime() + 3 * 86400000)

    const ACTIVE_PROJECT_STATUSES = ['IN_PROGRESS', 'ACTIVE', 'IN_REVIEW', 'REVISION', 'FEEDBACK', 'SUBMITTED']
    const skip = (cond, fn) => (cond ? fn() : Promise.resolve(null))

    // ── All parallel base queries ────────────────────────────────────────────
    const [
      totalLeads, newLeadsThisMonth, leadsLastMonth,
      activeProjects, totalProjects, projectsByStatus, projectsByVenture, projectsDueSoon,
      totalClients, newClientsThisMonth,
      openTasks, overdueTasks, completedTasksThisMonth,
      allInvoices,
      pendingWithdrawals,
      totalEmployees, activeEmployees,
      pendingLeaves,
      recentProjects,
      recentLeads,
      recentInvoices,
      upcomingTasks,
      todayAttendance,
    ] = await Promise.all([
      skip(dash && can.leads, () => Lead.countDocuments(leadFilter)),
      skip(dash && can.leads, () => Lead.countDocuments({ ...leadFilter, createdAt: { $gte: thisMonthStart } })),
      skip(dash && can.leads, () => Lead.countDocuments({ ...leadFilter, createdAt: { $gte: lastMonthStart, $lt: thisMonthStart } })),

      skip(dash && can.projects, () => Project.countDocuments({ ...projectScope, status: { $in: ACTIVE_PROJECT_STATUSES } })),
      skip(dash && can.projects, () => Project.countDocuments(projectScope)),
      skip(dash && can.projects, () => Project.aggregate([{ $match: projectScope }, { $group: { _id: '$status', count: { $sum: 1 } } }])),
      skip(dash && can.projects, () => Project.aggregate([{ $match: projectScope }, { $group: { _id: '$venture', count: { $sum: 1 } } }])),
      // Active projects whose deadline (or monthly period end) falls in the next 3 days
      skip(dash && can.projects, () => Project.countDocuments({
        $and: [
          projectScope,
          { status: { $in: ACTIVE_PROJECT_STATUSES } },
          { $or: [
            { deadline: { $gte: now, $lte: in3Days } },
            { deadline: null, currentPeriodEnd: { $gte: now, $lte: in3Days } },
          ] },
        ],
      })),

      skip(dash && can.clients, () => Client.countDocuments()),
      skip(dash && can.clients, () => Client.countDocuments({ createdAt: { $gte: thisMonthStart } })),

      skip(dash && can.tasks, () => Task.countDocuments({ ...taskFilter, status: { $in: ['TODO', 'IN_PROGRESS', 'IN_REVIEW'] } })),
      skip(dash && can.tasks, () => Task.countDocuments({ ...taskFilter, status: { $in: ['TODO', 'IN_PROGRESS'] }, dueDate: { $lt: now } })),
      // completedAt is stamped on the transition to COMPLETED (updatedAt moves on
      // any later edit, which re-counted old tasks).
      skip(dash && can.tasks, () => Task.countDocuments({ ...taskFilter, status: 'COMPLETED', completedAt: { $gte: thisMonthStart } })),

      // find().lean() triggers post-find decryption hooks; aggregate() does not
      skip(dash && can.finance, () => Invoice.find().select('status total paidAmount totalBDT dueDate').lean()),

      // Freelancer payouts awaiting account-manager approval (delivered work +
      // pending salary payouts) — replaces the old wallet "withdrawals" metric.
      skip(dash && can.finance, () => Promise.all([
        FreelancerAssignment.countDocuments({ paymentStatus: 'PAYMENT_REQUESTED' }),
        SalaryPayout.countDocuments({ status: 'PENDING' }),
      ]).then(([a, b]) => a + b)),

      skip(dash && can.hr, () => Employee.countDocuments()),
      // Active = not resigned AND the login account is still active
      skip(dash && can.hr, () => Employee.aggregate([
        { $match: { resigned: { $ne: true }, isActive: { $ne: false } } },
        { $lookup: { from: User.collection.name, localField: 'userId', foreignField: '_id', as: 'u' } },
        { $match: { 'u.isActive': true } },
        { $count: 'n' },
      ]).then(r => r[0]?.n ?? 0)),

      skip(dash && can.hr, () => Leave.countDocuments({ status: 'PENDING' })),

      skip(dash && can.projects, () => Project.find({ ...projectScope, status: { $in: ['IN_PROGRESS', 'ACTIVE', 'IN_REVIEW'] } })
        .sort({ updatedAt: -1 }).limit(5)
        .populate({ path: 'clientId', populate: { path: 'userId', select: 'name' } })
        .select('name projectCode status venture deadline currentPeriodEnd projectType clientId budget paidAmount')
        .lean()),

      skip(dash && can.leads, () => Lead.find(leadFilter).sort({ createdAt: -1 }).limit(5)
        .select('name company status value source createdAt').lean()),

      skip(dash && can.invoiceList, () => Invoice.find({ status: { $in: ['SENT', 'OVERDUE', 'PARTIALLY_PAID'] } })
        .sort({ dueDate: 1 }).limit(5)
        .populate({ path: 'clientId', populate: { path: 'userId', select: 'name' } })
        .select('invoiceNumber status total paidAmount currency dueDate clientId').lean()),

      skip(dash && can.tasks, () => Task.find({ ...taskFilter, status: { $in: ['TODO', 'IN_PROGRESS'] }, dueDate: { $gte: now } })
        .sort({ dueDate: 1 }).limit(5)
        .populate({ path: 'projectId', select: 'name' })
        .select('title status priority dueDate projectId').lean()),

      skip(dash && can.hr, () => Attendance.countDocuments({
        date: { $gte: todayStart, $lt: tomorrowStart },
        status: { $in: ['PRESENT', 'LATE', 'HALF_DAY'] },
      })),
    ])

    // ── Invoice stats grouped by status (JS reduce — aggregate $sum bypasses decryption) ──
    // Past-due SENT / PARTIALLY_PAID invoices count as OVERDUE even if nobody has
    // opened them yet (the stored status only flips on GET /api/invoices/[id]).
    // `total` is the gross BDT value, `due` what is still outstanding.
    let invoiceByStatus = null
    if (allInvoices) {
      invoiceByStatus = {}
      for (const inv of allInvoices) {
        let s = inv.status ?? 'UNKNOWN'
        if (['SENT', 'PARTIALLY_PAID'].includes(s) && inv.dueDate && new Date(inv.dueDate) < now) s = 'OVERDUE'
        const total = Number(inv.total) || 0
        const paid  = Math.min(Number(inv.paidAmount) || 0, total)
        const rate  = inv.totalBDT != null && total > 0 ? Number(inv.totalBDT) / total : 1
        if (!invoiceByStatus[s]) invoiceByStatus[s] = { count: 0, total: 0, due: 0 }
        invoiceByStatus[s].count++
        invoiceByStatus[s].total += total * rate
        invoiceByStatus[s].due   += ['PAID', 'CANCELLED', 'DRAFT'].includes(s) ? 0 : Math.max(0, total - paid) * rate
      }
    }

    // ── Finance block ────────────────────────────────────────────────────────
    let financials = null, expenseTrend = null, revenueVsProfit = null
    if (can.finance) {
      // Fetch 6 months of transactions once — aggregate $sum on encrypted amounts returns 0
      const [allTx6m, txCountThisMonth, txCountLastMonth] = await Promise.all([
        Transaction.find({ date: { $gte: sixMonthsAgo } }).select('type amount amountBDT date').lean(),
        Transaction.countDocuments({ date: { $gte: thisMonthStart, $lt: nextMonthStart } }),
        Transaction.countDocuments({ date: { $gte: lastMonthStart, $lt: thisMonthStart } }),
      ])

      const inRange     = (start, end) => allTx6m.filter(t => t.date >= start && t.date < end)
      const inThisMonth = inRange(thisMonthStart, nextMonthStart)
      const inLastMonth = inRange(lastMonthStart, thisMonthStart)

      const incomeThis  = sumAmt(inThisMonth.filter(t => t.type === 'INCOME'))
      const incomeLast  = sumAmt(inLastMonth.filter(t => t.type === 'INCOME'))
      const expenseThis = sumAmt(inThisMonth.filter(t => t.type === 'EXPENSE'))
      const expenseLast = sumAmt(inLastMonth.filter(t => t.type === 'EXPENSE'))
      const profitThis  = incomeThis  - expenseThis
      const profitLast  = incomeLast  - expenseLast

      financials = {
        income:       { value: incomeThis,  prevValue: incomeLast,  change: pctChange(incomeThis,  incomeLast)  },
        expense:      { value: expenseThis, prevValue: expenseLast, change: pctChange(expenseThis, expenseLast) },
        profit:       { value: profitThis,  prevValue: profitLast,  change: pctChange(profitThis,  profitLast)  },
        grossMargin:  { value: incomeThis  > 0 ? Math.round((profitThis  / incomeThis)  * 100) : 0 },
        expenseRatio: { value: incomeThis  > 0 ? Math.round((expenseThis / incomeThis)  * 100) : 0 },
        transactions: { value: txCountThisMonth, prevValue: txCountLastMonth, change: pctChange(txCountThisMonth, txCountLastMonth) },
      }

      // ── 6-month trends (reuse allTx6m — no extra DB calls needed) ─────────
      expenseTrend = []
      revenueVsProfit = []
      for (let i = 5; i >= 0; i--) {
        const start   = dhakaMonthStart(now, -i)
        const end     = dhakaMonthStart(now, -i + 1)
        const { year, month } = dhakaParts(start)
        const monthTx = inRange(start, end)
        const rev     = sumAmt(monthTx.filter(t => t.type === 'INCOME'))
        const exp     = sumAmt(monthTx.filter(t => t.type === 'EXPENSE'))
        const label   = { month: `${MONTH_SHORT[month]} ${String(year).slice(-2)}`, key: `${year}-${String(month + 1).padStart(2, '0')}` }
        expenseTrend.push({ ...label, expense: exp })
        revenueVsProfit.push({ ...label, revenue: rev, profit: rev - exp })
      }
    }

    // ── Lead pipeline (JS reduce — Lead.value is encrypted) ─────────────────
    let leads = null
    if (dash && can.leads) {
      const allLeads = await Lead.find(leadFilter).select('status value').lean()
      const leadPipelineMap = {}
      for (const lead of allLeads) {
        const s = lead.status ?? 'UNKNOWN'
        if (!leadPipelineMap[s]) leadPipelineMap[s] = { count: 0, value: 0 }
        leadPipelineMap[s].count++
        leadPipelineMap[s].value += Number(lead.value) || 0
      }
      // Lead value is masked for roles without pii.financial.view (see LEAD_PII)
      if (!can.leadValue) {
        for (const s of Object.keys(leadPipelineMap)) leadPipelineMap[s].value = maskMoney(leadPipelineMap[s].value)
      }
      leads = { total: totalLeads, newThisMonth: newLeadsThisMonth, lastMonth: leadsLastMonth, pipeline: leadPipelineMap }
    }

    const projects = dash && can.projects ? {
      active:   activeProjects,
      total:    totalProjects,
      dueSoon:  projectsDueSoon,
      byStatus:  Object.fromEntries(projectsByStatus.map(s => [s._id, s.count])),
      byVenture: Object.fromEntries(projectsByVenture.map(s => [s._id, s.count])),
    } : null

    return NextResponse.json({
      data: {
        leads,
        projects,
        clients:      dash && can.clients ? { total: totalClients, newThisMonth: newClientsThisMonth } : null,
        tasks:        dash && can.tasks ? { open: openTasks, overdue: overdueTasks, completedThisMonth: completedTasksThisMonth } : null,
        invoices:     invoiceByStatus,
        financials,
        expenseTrend,
        revenueVsProfit,
        dailyData:    null,
        pendingWithdrawals,
        hr:           dash && can.hr ? { total: totalEmployees, active: activeEmployees, pendingLeaves, todayAttendance } : null,
        recentProjects,
        recentLeads:  recentLeads ? maskList(session, recentLeads, LEAD_PII) : null,
        recentInvoices: recentInvoices
          ? recentInvoices.map(inv => ({ ...inv, due: Math.max(0, (Number(inv.total) || 0) - (Number(inv.paidAmount) || 0)) }))
          : null,
        upcomingTasks,
      },
    })
  } catch (err) {
    console.error('[GET /api/dashboard/stats]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
