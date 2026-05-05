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

    // aggregate() bypasses Mongoose post-find hooks so encrypted amounts return 0 — use find().lean()
    const [allTx, receivableInvoices] = await Promise.all([
      Transaction.find(dateFilter).select('type amount category').lean(),
      Invoice.find({ status: { $in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] } })
        .select('total paidAmount')
        .lean(),
    ])

    let totalRevenue = 0, totalExpenses = 0, incomeCount = 0, expenseCount = 0
    const expenseCategoryMap = {}, incomeCategoryMap = {}

    for (const tx of allTx) {
      const amt = Number(tx.amount) || 0
      if (tx.type === 'INCOME') {
        totalRevenue += amt
        incomeCount++
        if (tx.category) incomeCategoryMap[tx.category] = (incomeCategoryMap[tx.category] ?? 0) + amt
      } else if (tx.type === 'EXPENSE') {
        totalExpenses += amt
        expenseCount++
        if (tx.category) expenseCategoryMap[tx.category] = (expenseCategoryMap[tx.category] ?? 0) + amt
      }
    }

    const netProfit = totalRevenue - totalExpenses
    const outstandingReceivables = receivableInvoices.reduce(
      (sum, inv) => sum + ((Number(inv.total) || 0) - (Number(inv.paidAmount) || 0)), 0
    )

    const expenseByCategory = Object.entries(expenseCategoryMap)
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount)
    const incomeByCategory = Object.entries(incomeCategoryMap)
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount)

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
      if (tx.type === 'INCOME')  monthlyMap[key].income  += Number(tx.amount) || 0
      if (tx.type === 'EXPENSE') monthlyMap[key].expense += Number(tx.amount) || 0
    })
    const monthlyData = Object.values(monthlyMap).sort((a, b) => a.month.localeCompare(b.month))

    return NextResponse.json({
      data: {
        totalRevenue,
        totalExpenses,
        netProfit,
        outstandingReceivables,
        monthlyData,
        expenseByCategory,
        incomeByCategory,
        grossMargin:        totalRevenue > 0 ? ((totalRevenue - totalExpenses) / totalRevenue * 100) : 0,
        expenseRatio:       totalRevenue > 0 ? (totalExpenses / totalRevenue * 100) : 0,
        ebitda:             netProfit,
        avgMonthlyRevenue:  monthlyData.length > 0 ? monthlyData.reduce((s, d) => s + (d.income  || 0), 0) / monthlyData.length : 0,
        avgMonthlyExpense:  monthlyData.length > 0 ? monthlyData.reduce((s, d) => s + (d.expense || 0), 0) / monthlyData.length : 0,
        incomeCount,
        expenseCount,
      },
    })
  } catch (err) {
    console.error('[GET /api/accounts/summary]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
