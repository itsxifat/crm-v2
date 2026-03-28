import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Transaction } from '@/models'

// GET /api/accounts/pl-report?startDate=&endDate=
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

    const filter = {}
    if (startDate || endDate) {
      filter.date = {}
      if (startDate) filter.date.$gte = new Date(startDate)
      if (endDate)   filter.date.$lte = new Date(endDate)
    }

    const transactions = await Transaction.find(filter).sort({ date: 1 }).lean()

    const months = {}
    transactions.forEach(tx => {
      const key = `${tx.date.getFullYear()}-${String(tx.date.getMonth() + 1).padStart(2, '0')}`
      if (!months[key]) {
        months[key] = { month: key, income: {}, expense: {}, totalIncome: 0, totalExpense: 0 }
      }
      const m = months[key]
      if (tx.type === 'INCOME') {
        m.income[tx.category] = (m.income[tx.category] ?? 0) + tx.amount
        m.totalIncome += tx.amount
      } else {
        m.expense[tx.category] = (m.expense[tx.category] ?? 0) + tx.amount
        m.totalExpense += tx.amount
      }
    })

    const rows = Object.values(months)
      .map(m => ({ ...m, netProfit: m.totalIncome - m.totalExpense }))
      .sort((a, b) => a.month.localeCompare(b.month))

    const totalIncome  = rows.reduce((s, r) => s + r.totalIncome,  0)
    const totalExpense = rows.reduce((s, r) => s + r.totalExpense, 0)

    return NextResponse.json({
      data: {
        rows,
        summary: {
          totalIncome,
          totalExpense,
          netProfit: totalIncome - totalExpense,
          margin:    totalIncome > 0 ? ((totalIncome - totalExpense) / totalIncome) * 100 : 0,
        },
        period: { startDate, endDate },
      },
    })
  } catch (err) {
    console.error('[GET /api/accounts/pl-report]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
