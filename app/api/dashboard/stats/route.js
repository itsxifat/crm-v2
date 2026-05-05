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
    const sixMonthsAgo    = new Date(now.getFullYear(), now.getMonth() - 5, 1)

    const pctChange = (cur, prev) => prev > 0 ? Math.round(((cur - prev) / prev) * 100) : (cur > 0 ? 100 : 0)
    const sumAmt    = (txs) => txs.reduce((s, t) => s + (Number(t.amount) || 0), 0)

    // ── All parallel base queries ────────────────────────────────────────────
    const [
      totalLeads, newLeadsThisMonth, leadsLastMonth,
      activeProjects, totalProjects, projectsByStatus, projectsByVenture,
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

      // find().lean() triggers post-find decryption hooks; aggregate() does not
      Invoice.find().select('status total').lean(),

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

    // ── Invoice stats grouped by status (JS reduce — aggregate $sum bypasses decryption) ──
    const invoiceByStatus = {}
    for (const inv of allInvoices) {
      const s = inv.status ?? 'UNKNOWN'
      if (!invoiceByStatus[s]) invoiceByStatus[s] = { count: 0, total: 0 }
      invoiceByStatus[s].count++
      invoiceByStatus[s].total += Number(inv.total) || 0
    }

    // ── Fetch 6 months of transactions once — aggregate $sum on encrypted amounts returns 0 ──
    const [allTx6m, txCountThisMonth, txCountLastMonth] = await Promise.all([
      Transaction.find({ date: { $gte: sixMonthsAgo } }).select('type amount date').lean(),
      Transaction.countDocuments({ date: { $gte: thisMonthStart, $lte: thisMonthEnd } }),
      Transaction.countDocuments({ date: { $gte: lastMonthStart, $lte: lastMonthEnd } }),
    ])

    // ── Monthly financials ───────────────────────────────────────────────────
    const inThisMonth = allTx6m.filter(t => t.date >= thisMonthStart && t.date <= thisMonthEnd)
    const inLastMonth = allTx6m.filter(t => t.date >= lastMonthStart && t.date <= lastMonthEnd)

    const incomeThis  = sumAmt(inThisMonth.filter(t => t.type === 'INCOME'))
    const incomeLast  = sumAmt(inLastMonth.filter(t => t.type === 'INCOME'))
    const expenseThis = sumAmt(inThisMonth.filter(t => t.type === 'EXPENSE'))
    const expenseLast = sumAmt(inLastMonth.filter(t => t.type === 'EXPENSE'))
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

    // ── 6-month trends (reuse allTx6m — no extra DB calls needed) ───────────
    const expenseTrend = [], revenueVsProfit = []
    for (let i = 5; i >= 0; i--) {
      const start   = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const end     = new Date(now.getFullYear(), now.getMonth() - i + 1, 0, 23, 59, 59)
      const monthTx = allTx6m.filter(tx => tx.date >= start && tx.date <= end)
      const rev     = sumAmt(monthTx.filter(t => t.type === 'INCOME'))
      const exp     = sumAmt(monthTx.filter(t => t.type === 'EXPENSE'))
      const label   = { month: start.toLocaleString('default', { month: 'short', year: '2-digit' }), key: `${start.getFullYear()}-${String(start.getMonth()+1).padStart(2,'0')}` }
      expenseTrend.push({ ...label, expense: exp })
      revenueVsProfit.push({ ...label, revenue: rev, profit: rev - exp })
    }

    // ── Lead pipeline (JS reduce — Lead.value is encrypted) ─────────────────
    const allLeads = await Lead.find().select('status value').lean()
    const leadPipelineMap = {}
    for (const lead of allLeads) {
      const s = lead.status ?? 'UNKNOWN'
      if (!leadPipelineMap[s]) leadPipelineMap[s] = { count: 0, value: 0 }
      leadPipelineMap[s].count++
      leadPipelineMap[s].value += Number(lead.value) || 0
    }

    // ── Drill-down ───────────────────────────────────────────────────────────
    let dailyData = null
    if (drillMonth) {
      const [yr, mo] = drillMonth.split('-').map(Number)
      const monthStart  = new Date(yr, mo - 1, 1)
      const monthEnd    = new Date(yr, mo, 0, 23, 59, 59)
      const txInMonth   = await Transaction.find({ date: { $gte: monthStart, $lte: monthEnd } }).select('type amount date').lean()
      const daysInMonth = new Date(yr, mo, 0).getDate()
      dailyData = []
      for (let d = 1; d <= daysInMonth; d++) {
        const dayTx   = txInMonth.filter(tx => new Date(tx.date).getDate() === d)
        const income  = sumAmt(dayTx.filter(t => t.type === 'INCOME'))
        const expense = sumAmt(dayTx.filter(t => t.type === 'EXPENSE'))
        dailyData.push({ day: d, income, expense, profit: income - expense, txCount: dayTx.length })
      }
    }

    const projectStatusMap  = Object.fromEntries(projectsByStatus.map(s => [s._id, s.count]))
    const projectVentureMap = Object.fromEntries(projectsByVenture.map(s => [s._id, s.count]))

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
