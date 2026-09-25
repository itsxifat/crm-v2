export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Transaction } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { parseDhakaDay, dhakaParts } from '@/lib/dhakaTime'
import { BASE_CURRENCY } from '@/lib/currencies'

// GET /api/accounts/pl-report?startDate=&endDate=
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'finance.reports.view')
    if (denied) return denied

    await connectDB()

    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate')
    const endDate   = searchParams.get('endDate')

    // Date-only filters are Asia/Dhaka calendar days; the end day is inclusive.
    const filter = {}
    if (startDate || endDate) {
      filter.date = {}
      if (startDate) filter.date.$gte = parseDhakaDay(startDate)?.start ?? new Date(startDate)
      if (endDate) {
        const end = parseDhakaDay(endDate)
        if (end) filter.date.$lt  = end.next
        else     filter.date.$lte = new Date(endDate)
      }
    }

    const transactions = await Transaction.find(filter).sort({ date: 1 }).lean()

    const months = {}
    transactions.forEach(tx => {
      // Roll up in BDT — amountBDT falls back to the original amount for BDT rows
      // only; a foreign row with no BDT-equivalent can't be summed as BDT.
      const amt = tx.amountBDT != null
        ? (Number(tx.amountBDT) || 0)
        : ((tx.currency || BASE_CURRENCY) === BASE_CURRENCY ? (Number(tx.amount) || 0) : null)
      if (amt == null) return
      // Month buckets follow the business timezone (Asia/Dhaka).
      const { year, month } = dhakaParts(tx.date)
      const key = `${year}-${String(month + 1).padStart(2, '0')}`
      if (!months[key]) {
        months[key] = { month: key, income: {}, expense: {}, totalIncome: 0, totalExpense: 0 }
      }
      const m = months[key]
      if (tx.type === 'INCOME') {
        m.income[tx.category] = (m.income[tx.category] ?? 0) + amt
        m.totalIncome += amt
      } else {
        m.expense[tx.category] = (m.expense[tx.category] ?? 0) + amt
        m.totalExpense += amt
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
