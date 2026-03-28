export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Transaction, Invoice } from '@/models'

// GET /api/accounts/summary
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const allowedRoles = ['SUPER_ADMIN', 'MANAGER']
    if (!allowedRoles.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate')
    const endDate   = searchParams.get('endDate')

    const dateFilter = {}
    if (startDate || endDate) {
      dateFilter.date = {}
      if (startDate) dateFilter.date.$gte = new Date(startDate)
      if (endDate)   dateFilter.date.$lte = new Date(endDate)
    }

    const [incomeAgg, expenseAgg, receivableInvoices] = await Promise.all([
      Transaction.aggregate([
        { $match: { type: 'INCOME', ...dateFilter } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      Transaction.aggregate([
        { $match: { type: 'EXPENSE', ...dateFilter } },
        { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
      ]),
      Invoice.find({ status: { $in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] } })
        .select('total paidAmount')
        .lean(),
    ])

    const totalRevenue  = incomeAgg[0]?.total  ?? 0
    const totalExpenses = expenseAgg[0]?.total  ?? 0
    const netProfit     = totalRevenue - totalExpenses
    const outstandingReceivables = receivableInvoices.reduce(
      (sum, inv) => sum + ((inv.total ?? 0) - (inv.paidAmount ?? 0)), 0
    )

    // Monthly breakdown for last 12 months
    const now     = new Date()
    const yearAgo = new Date(now.getFullYear() - 1, now.getMonth(), 1)
    const monthlyTx = await Transaction.find({ date: { $gte: yearAgo } })
      .select('type amount date')
      .sort({ date: 1 })
      .lean()

    const monthlyMap = {}
    monthlyTx.forEach(tx => {
      const key = `${tx.date.getFullYear()}-${String(tx.date.getMonth() + 1).padStart(2, '0')}`
      if (!monthlyMap[key]) monthlyMap[key] = { month: key, income: 0, expense: 0 }
      if (tx.type === 'INCOME')  monthlyMap[key].income  += tx.amount
      if (tx.type === 'EXPENSE') monthlyMap[key].expense += tx.amount
    })
    const monthlyData = Object.values(monthlyMap).sort((a, b) => a.month.localeCompare(b.month))

    // Expense breakdown by category
    const expenseByCategoryAgg = await Transaction.aggregate([
      { $match: { type: 'EXPENSE', ...dateFilter } },
      { $group: { _id: '$category', amount: { $sum: '$amount' } } },
      { $sort: { amount: -1 } },
    ])

    // Income breakdown by category
    const incomeByCategoryAgg = await Transaction.aggregate([
      { $match: { type: 'INCOME', ...dateFilter } },
      { $group: { _id: '$category', amount: { $sum: '$amount' } } },
      { $sort: { amount: -1 } },
    ])

    return NextResponse.json({
      data: {
        totalRevenue,
        totalExpenses,
        netProfit,
        outstandingReceivables,
        monthlyData,
        expenseByCategory: expenseByCategoryAgg.map(e => ({ category: e._id, amount: e.amount })),
        incomeByCategory:  incomeByCategoryAgg.map(e => ({ category: e._id, amount: e.amount })),
        grossMargin:        totalRevenue > 0 ? ((totalRevenue - totalExpenses) / totalRevenue * 100) : 0,
        expenseRatio:       totalRevenue > 0 ? (totalExpenses / totalRevenue * 100) : 0,
        ebitda:             netProfit,
        avgMonthlyRevenue:  monthlyData.length > 0 ? monthlyData.reduce((s, d) => s + (d.income  || 0), 0) / monthlyData.length : 0,
        avgMonthlyExpense:  monthlyData.length > 0 ? monthlyData.reduce((s, d) => s + (d.expense || 0), 0) / monthlyData.length : 0,
        incomeCount:        incomeAgg[0]?.count  ?? 0,
        expenseCount:       expenseAgg[0]?.count ?? 0,
      },
    })
  } catch (err) {
    console.error('[GET /api/accounts/summary]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
