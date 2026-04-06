export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Project, Invoice, Task } from '@/models'

// GET /api/reports/projects
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const allowedRoles = ['SUPER_ADMIN', 'MANAGER']
    if (!allowedRoles.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const projects = await Project.find()
      .sort({ createdAt: -1 })
      .populate({ path: 'clientId', populate: { path: 'userId', select: 'name' } })
      .lean()

    const projectIds = projects.map(p => p._id)

    const [invoiceAgg, taskCounts] = await Promise.all([
      Invoice.aggregate([
        { $match: { projectId: { $in: projectIds } } },
        { $group: { _id: '$projectId', invoiced: { $sum: '$total' }, collected: { $sum: '$paidAmount' } } },
      ]),
      Task.aggregate([
        { $match: { projectId: { $in: projectIds } } },
        { $group: { _id: '$projectId', count: { $sum: 1 } } },
      ]),
    ])

    const invoiceMap  = Object.fromEntries(invoiceAgg.map(i => [i._id.toString(), i]))
    const taskCountMap = Object.fromEntries(taskCounts.map(t => [t._id.toString(), t.count]))

    const rows = projects.map(p => {
      const pid      = p._id.toString()
      const budget     = p.budget ?? 0
      const discount   = p.discount ?? 0
      const actualCost = p.actualCost ?? 0
      const invoiced   = invoiceMap[pid]?.invoiced  ?? 0
      const collected  = invoiceMap[pid]?.collected ?? 0
      const profit     = budget > 0 ? budget - discount - actualCost : invoiced - actualCost
      const margin     = budget > 0
        ? (profit / budget) * 100
        : invoiced > 0 ? (profit / invoiced) * 100 : 0

      return {
        id:        pid,
        name:      p.name,
        client:    p.clientId?.userId?.name ?? 'Unknown',
        status:    p.status,
        budget,
        discount,
        actualCost,
        invoiced,
        collected,
        profit,
        margin:    Math.round(margin * 10) / 10,
        taskCount: taskCountMap[pid] ?? 0,
        startDate: p.startDate,
        endDate:   p.endDate,
      }
    })

    const totalBudget     = rows.reduce((s, r) => s + r.budget,     0)
    const totalActualCost = rows.reduce((s, r) => s + r.actualCost, 0)
    const totalProfit     = rows.reduce((s, r) => s + r.profit,     0)

    return NextResponse.json({
      data: {
        rows,
        summary: {
          totalBudget,
          totalActualCost,
          totalProfit,
          avgMargin: rows.length > 0 ? rows.reduce((s, r) => s + r.margin, 0) / rows.length : 0,
          projectCount: rows.length,
        },
      },
    })
  } catch (err) {
    console.error('[GET /api/reports/projects]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
