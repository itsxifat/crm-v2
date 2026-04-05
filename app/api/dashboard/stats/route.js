export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import {
  Lead, Project, Client, Task, Invoice, WithdrawalRequest,
  Transaction, Employee, Attendance, Leave,
} from '@/models'

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!['SUPER_ADMIN', 'MANAGER'].includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await connectDB()

    const { searchParams } = new URL(request.url)
    const drillMonth = searchParams.get('drillMonth')

    const now             = new Date()
    const thisMonthStart  = new Date(now.getFullYear(), now.getMonth(), 1)
    const thisMonthEnd    = new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59)
    const lastMonthStart  = new Date(now.getFullYear(), now.getMonth() - 1, 1)
    const lastMonthEnd    = new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59)
    const todayStart      = new Date(now.getFullYear(), now.getMonth(), now.getDate())
    const todayEnd        = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59)

    const pctChange = (cur, prev) => prev > 0 ? Math.round(((cur - prev) / prev) * 100) : (cur > 0 ? 100 : 0)

    // ── All parallel base queries ────────────────────────────────────────────
    const [
      totalLeads, newLeadsThisMonth, leadsLastMonth,
      activeProjects, totalProjects, projectsByStatus, projectsByVenture,
      totalClients, newClientsThisMonth,
      openTasks, overdueTasks, completedTasksThisMonth,
      invoiceStatAgg,
      pendingWithdrawals,
      totalEmployees, activeEmployees,
      pendingLeaves,
      recentProjects,
      recentLeads,
      recentInvoices,
      upcomingTasks,
      todayAttendance,
    ] = await Promise.all([
      Lead.countDocuments(),
      Lead.countDocuments({ createdAt: { $gte: thisMonthStart } }),
      Lead.countDocuments({ createdAt: { $gte: lastMonthStart, $lte: lastMonthEnd } }),

      Project.countDocuments({ status: { $in: ['IN_PROGRESS', 'ACTIVE', 'IN_REVIEW', 'REVISION', 'FEEDBACK', 'SUBMITTED'] } }),
      Project.countDocuments(),
      Project.aggregate([{ $group: { _id: '$status', count: { $sum: 1 } } }]),
      Project.aggregate([{ $group: { _id: '$venture', count: { $sum: 1 } } }]),

      Client.countDocuments(),
      Client.countDocuments({ createdAt: { $gte: thisMonthStart } }),

      Task.countDocuments({ status: { $in: ['TODO', 'IN_PROGRESS', 'IN_REVIEW'] } }),
      Task.countDocuments({ status: { $in: ['TODO', 'IN_PROGRESS'] }, dueDate: { $lt: now } }),
      Task.countDocuments({ status: 'COMPLETED', updatedAt: { $gte: thisMonthStart } }),

      Invoice.aggregate([{ $group: { _id: '$status', count: { $sum: 1 }, total: { $sum: '$total' } } }]),

      WithdrawalRequest.countDocuments({ status: 'PENDING' }),

      Employee.countDocuments(),
      Employee.countDocuments({ isActive: true }),

      Leave.countDocuments({ status: 'PENDING' }),

      Project.find({ status: { $in: ['IN_PROGRESS', 'ACTIVE', 'IN_REVIEW'] } })
        .sort({ updatedAt: -1 }).limit(5)
        .populate({ path: 'clientId', populate: { path: 'userId', select: 'name' } })
        .select('name projectCode status venture deadline currentPeriodEnd projectType clientId budget paidAmount')
        .lean(),

      Lead.find().sort({ createdAt: -1 }).limit(5)
        .select('name company status value source createdAt').lean(),

      Invoice.find({ status: { $in: ['SENT', 'OVERDUE', 'PARTIALLY_PAID'] } })
        .sort({ dueDate: 1 }).limit(5)
        .populate({ path: 'clientId', populate: { path: 'userId', select: 'name' } })
        .select('invoiceNumber status total dueDate clientId').lean(),

      Task.find({ status: { $in: ['TODO', 'IN_PROGRESS'] }, dueDate: { $gte: now } })
        .sort({ dueDate: 1 }).limit(5)
        .populate({ path: 'projectId', select: 'name' })
        .select('title status priority dueDate projectId').lean(),

      Attendance.countDocuments({ date: { $gte: todayStart, $lte: todayEnd }, status: 'PRESENT' }),
    ])

    // ── Monthly financials ───────────────────────────────────────────────────
    const [
      incomeThisMonth, incomeLastMonth,
      expenseThisMonth, expenseLastMonth,
      txCountThisMonth, txCountLastMonth,
    ] = await Promise.all([
      Transaction.aggregate([{ $match: { type: 'INCOME',  date: { $gte: thisMonthStart, $lte: thisMonthEnd } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      Transaction.aggregate([{ $match: { type: 'INCOME',  date: { $gte: lastMonthStart, $lte: lastMonthEnd } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      Transaction.aggregate([{ $match: { type: 'EXPENSE', date: { $gte: thisMonthStart, $lte: thisMonthEnd } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      Transaction.aggregate([{ $match: { type: 'EXPENSE', date: { $gte: lastMonthStart, $lte: lastMonthEnd } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      Transaction.countDocuments({ date: { $gte: thisMonthStart, $lte: thisMonthEnd } }),
      Transaction.countDocuments({ date: { $gte: lastMonthStart, $lte: lastMonthEnd } }),
    ])

    const incomeThis  = incomeThisMonth[0]?.total  ?? 0
    const incomeLast  = incomeLastMonth[0]?.total  ?? 0
    const expenseThis = expenseThisMonth[0]?.total ?? 0
    const expenseLast = expenseLastMonth[0]?.total ?? 0
    const profitThis  = incomeThis  - expenseThis
    const profitLast  = incomeLast  - expenseLast

    const financials = {
      income:       { value: incomeThis,  prevValue: incomeLast,  change: pctChange(incomeThis,  incomeLast)  },
      expense:      { value: expenseThis, prevValue: expenseLast, change: pctChange(expenseThis, expenseLast) },
      profit:       { value: profitThis,  prevValue: profitLast,  change: pctChange(profitThis,  profitLast)  },
      grossMargin:  { value: incomeThis  > 0 ? Math.round((profitThis  / incomeThis)  * 100) : 0 },
      expenseRatio: { value: incomeThis  > 0 ? Math.round((expenseThis / incomeThis)  * 100) : 0 },
      transactions: { value: txCountThisMonth, prevValue: txCountLastMonth, change: pctChange(txCountThisMonth, txCountLastMonth) },
    }

    // ── 6-month trends ───────────────────────────────────────────────────────
    const expenseTrend = [], revenueVsProfit = []
    for (let i = 5; i >= 0; i--) {
      const start = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const end   = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59)
      const [incAgg, expAgg] = await Promise.all([
        Transaction.aggregate([{ $match: { type: 'INCOME',  date: { $gte: start, $lte: end } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
        Transaction.aggregate([{ $match: { type: 'EXPENSE', date: { $gte: start, $lte: end } } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
      ])
      const rev = incAgg[0]?.total ?? 0
      const exp = expAgg[0]?.total ?? 0
      const label = { month: start.toLocaleString('default', { month: 'short', year: '2-digit' }), key: `${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}` }
      expenseTrend.push({ ...label, expense: exp })
      revenueVsProfit.push({ ...label, revenue: rev, profit: rev - exp })
    }

    // ── Lead pipeline ────────────────────────────────────────────────────────
    const leadPipeline = await Lead.aggregate([
      { $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: '$value' } } },
    ])

    // ── Drill-down ───────────────────────────────────────────────────────────
    let dailyData = null
    if (drillMonth) {
      const [yr, mo] = drillMonth.split('-').map(Number)
      const monthStart = new Date(yr, mo - 1, 1)
      const monthEnd   = new Date(yr, mo, 0, 23, 59, 59)
      const txInMonth  = await Transaction.find({ date: { $gte: monthStart, $lte: monthEnd } }).select('type amount date').lean()
      const daysInMonth = new Date(yr, mo, 0).getDate()
      dailyData = []
      for (let d = 1; d <= daysInMonth; d++) {
        const dayTx   = txInMonth.filter(tx => new Date(tx.date).getDate() === d)
        const income  = dayTx.filter(t => t.type === 'INCOME').reduce((s, t) => s + t.amount, 0)
        const expense = dayTx.filter(t => t.type === 'EXPENSE').reduce((s, t) => s + t.amount, 0)
        dailyData.push({ day: d, income, expense, profit: income - expense, txCount: dayTx.length })
      }
    }

    const invoiceByStatus = Object.fromEntries(invoiceStatAgg.map(s => [s._id, { count: s.count, total: s.total }]))
    const projectStatusMap = Object.fromEntries(projectsByStatus.map(s => [s._id, s.count]))
    const projectVentureMap = Object.fromEntries(projectsByVenture.map(s => [s._id, s.count]))
    const leadPipelineMap = Object.fromEntries(leadPipeline.map(s => [s._id, { count: s.count, value: s.value ?? 0 }]))

    return NextResponse.json({
      data: {
        leads:        { total: totalLeads, newThisMonth: newLeadsThisMonth, lastMonth: leadsLastMonth, pipeline: leadPipelineMap },
        projects:     { active: activeProjects, total: totalProjects, byStatus: projectStatusMap, byVenture: projectVentureMap },
        clients:      { total: totalClients, newThisMonth: newClientsThisMonth },
        tasks:        { open: openTasks, overdue: overdueTasks, completedThisMonth: completedTasksThisMonth },
        invoices:     invoiceByStatus,
        financials,
        expenseTrend,
        revenueVsProfit,
        dailyData,
        pendingWithdrawals,
        hr: { total: totalEmployees, active: activeEmployees, pendingLeaves, todayAttendance },
        recentProjects,
        recentLeads,
        recentInvoices,
        upcomingTasks,
      },
    })
  } catch (err) {
    console.error('[GET /api/dashboard/stats]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
