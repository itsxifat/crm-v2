export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Transaction } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { parseDhakaDay, dhakaParts } from '@/lib/dhakaTime'
import {
  plEffect, nonPlBreakdown, depreciationTotal, ebitdaOf, PL_SELECT, round2,
} from '@/app/api/accounts/_lib/pl'

// GET /api/accounts/pl-report?startDate=&endDate=
// Profit & loss by Asia/Dhaka month. Only P&L rows count (kind OPERATING /
// NON_CASH, or legacy rows without a kind) at their P&L value (plAmountBDT ⇒
// amountBDT ⇒ amount for BDT rows). INCOME rows are income, EXPENSE rows are
// expense; reversal rows reduce the side they reverse. Non-P&L cash movements
// (transfers, capital, loans, tax payments, asset purchases…) are returned
// separately in `nonPl` for reference.
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
      if (Object.values(filter.date).some(d => Number.isNaN(d.getTime())))
        return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
    }

    const transactions = await Transaction.find(filter).select(PL_SELECT).sort({ date: 1 }).lean()

    const months = {}
    let unconvertedCount = 0
    for (const tx of transactions) {
      const effect = plEffect(tx)
      if (!effect) continue                                   // not a P&L row
      if (effect.unconverted) { unconvertedCount++; continue } // foreign row with no BDT figure
      const { year, month } = dhakaParts(tx.date)
      const key = `${year}-${String(month + 1).padStart(2, '0')}`
      if (!months[key]) {
        months[key] = { month: key, income: {}, expense: {}, totalIncome: 0, totalExpense: 0 }
      }
      const m   = months[key]
      const cat = tx.category || 'Uncategorised'
      if (effect.side === 'INCOME') {
        m.income[cat] = (m.income[cat] ?? 0) + effect.amount
        m.totalIncome += effect.amount
      } else {
        m.expense[cat] = (m.expense[cat] ?? 0) + effect.amount
        m.totalExpense += effect.amount
      }
    }

    const roundMap = (obj) => Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, round2(v)]))
    const rows = Object.values(months)
      .map(m => {
        const totalIncome  = round2(m.totalIncome)
        const totalExpense = round2(m.totalExpense)
        return {
          month:     m.month,
          income:    roundMap(m.income),
          expense:   roundMap(m.expense),
          totalIncome,
          totalExpense,
          netProfit: round2(totalIncome - totalExpense),
        }
      })
      .sort((a, b) => a.month.localeCompare(b.month))

    const totalIncome  = round2(rows.reduce((s, r) => s + r.totalIncome,  0))
    const totalExpense = round2(rows.reduce((s, r) => s + r.totalExpense, 0))
    const netProfit    = round2(totalIncome - totalExpense)
    const depreciation = depreciationTotal(transactions)
    const { ebitda, interestExpense, interestIncome } = ebitdaOf(netProfit, transactions, depreciation)

    return NextResponse.json({
      data: {
        rows,
        summary: {
          totalIncome,
          totalExpense,
          netProfit,
          margin:    totalIncome > 0 ? (netProfit / totalIncome) * 100 : 0,
          depreciation,
          interestExpense,
          interestIncome,
          ebitda,
          unconvertedCount,
        },
        nonPl:  nonPlBreakdown(transactions),
        period: { startDate, endDate },
      },
    })
  } catch (err) {
    console.error('[GET /api/accounts/pl-report]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
