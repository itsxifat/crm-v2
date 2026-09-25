export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Project, Invoice, Task } from '@/models'
import { requirePerm, canDo } from '@/lib/rbac'

// GET /api/reports/projects
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'analytics.reports.view')
    if (denied) return denied
    // Money columns additionally need finance report access
    const showMoney = canDo(session, 'finance.reports.view')

    await connectDB()

    const projects = await Project.find()
      .sort({ createdAt: -1 })
      .populate({ path: 'clientId', populate: { path: 'userId', select: 'name' } })
      .lean()

    const projectIds = projects.map(p => p._id)

    // aggregate() bypasses Mongoose post-find hooks — Invoice.total and paidAmount are encrypted
    const [invoices, taskCounts] = await Promise.all([
      // Issued invoices only (DRAFT/CANCELLED aren't billed); match both the
      // current projectId and legacy projectIds-array styles.
      Invoice.find({
        status: { $nin: ['DRAFT', 'CANCELLED'] },
        $or: [{ projectId: { $in: projectIds } }, { projectIds: { $in: projectIds } }],
      }).select('projectId projectIds total paidAmount').lean(),
      Task.aggregate([
        { $match: { projectId: { $in: projectIds } } },
        { $group: { _id: '$projectId', count: { $sum: 1 } } },
      ]),
    ])

    const invoiceMap = {}
    for (const inv of invoices) {
      const pid = (inv.projectId ?? inv.projectIds?.[0])?.toString()
      if (!pid) continue
      if (!invoiceMap[pid]) invoiceMap[pid] = { invoiced: 0, collected: 0 }
      invoiceMap[pid].invoiced  += Number(inv.total)      || 0
      invoiceMap[pid].collected += Number(inv.paidAmount) || 0
    }

    const taskCountMap = Object.fromEntries(taskCounts.map(t => [t._id.toString(), t.count]))

    const rows = projects.map(p => {
      const pid        = p._id.toString()
      const budget     = Number(p.budget)     || 0
      const actualCost = Number(p.approvedExpenses) || 0 // project costs live in approvedExpenses
      const invoiced   = invoiceMap[pid]?.invoiced  ?? 0
      const collected  = invoiceMap[pid]?.collected ?? 0
      const profit     = budget > 0 ? budget - actualCost : invoiced - actualCost
      const margin     = budget > 0
        ? (profit / budget) * 100
        : invoiced > 0 ? (profit / invoiced) * 100 : 0

      return {
        id:        pid,
        name:      p.name,
        client:    p.clientId?.userId?.name ?? 'Unknown',
        status:    p.status,
        budget,
        actualCost,
        invoiced,
        collected,
        profit,
        margin:    Math.round(margin * 10) / 10,
        taskCount: taskCountMap[pid] ?? 0,
        startDate: p.startDate,
        endDate:   p.deadline ?? p.currentPeriodEnd ?? null,
      }
    })

    const totalBudget     = rows.reduce((s, r) => s + r.budget,     0)
    const totalActualCost = rows.reduce((s, r) => s + r.actualCost, 0)
    const totalProfit     = rows.reduce((s, r) => s + r.profit,     0)
    const avgMargin       = rows.length > 0 ? rows.reduce((s, r) => s + r.margin, 0) / rows.length : 0

    const MONEY_FIELDS = ['budget', 'actualCost', 'invoiced', 'collected', 'profit', 'margin']
    const outRows = showMoney
      ? rows
      : rows.map(r => { const o = { ...r }; MONEY_FIELDS.forEach(k => { o[k] = null }); return o })

    return NextResponse.json({
      data: {
        rows: outRows,
        summary: {
          totalBudget:     showMoney ? totalBudget     : null,
          totalActualCost: showMoney ? totalActualCost : null,
          totalProfit:     showMoney ? totalProfit     : null,
          avgMargin:       showMoney ? avgMargin       : null,
          projectCount: rows.length,
        },
      },
    })
  } catch (err) {
    console.error('[GET /api/reports/projects]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
