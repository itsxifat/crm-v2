export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Transaction, Invoice } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { parseDhakaDay, dhakaParts, dhakaMonthStart } from '@/lib/dhakaTime'
import { BASE_CURRENCY } from '@/lib/currencies'

// BDT value of a ledger row, or null when a foreign-currency row has no
// BDT-equivalent recorded (its face value is NOT BDT and must not be summed as such).
function txAmountBDT(tx) {
  if (tx.amountBDT != null) return Number(tx.amountBDT) || 0
  if ((tx.currency || BASE_CURRENCY) === BASE_CURRENCY) return Number(tx.amount) || 0
  return null
}

// GET /api/accounts/summary
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'finance.overview.view')
    if (denied) return denied

    await connectDB()

    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate')
    const endDate   = searchParams.get('endDate')

    // Date-only filters are Asia/Dhaka calendar days; the end day is inclusive.
    const dateFilter = {}
    if (startDate || endDate) {
      dateFilter.date = {}
      if (startDate) dateFilter.date.$gte = parseDhakaDay(startDate)?.start ?? new Date(startDate)
      if (endDate) {
        const end = parseDhakaDay(endDate)
        if (end) dateFilter.date.$lt  = end.next
        else     dateFilter.date.$lte = new Date(endDate)
      }
    }

    const [allTx, receivableInvoices] = await Promise.all([
      Transaction.find(dateFilter).select('type amount amountBDT currency category expenseCategory').lean(),
      Invoice.find({ status: { $in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] } })
        .select('total totalBDT paidAmount currency')
        .lean(),
    ])

    let totalRevenue = 0, totalExpenses = 0, incomeCount = 0, expenseCount = 0
    const expenseCategoryMap = {}, incomeCategoryMap = {}
    const expenseSubcategoryMap = {}, incomeSubcategoryMap = {}
    // Per-currency breakdown: original-currency totals + BDT-equivalent totals.
    const currencyMap = {}

    for (const tx of allTx) {
      // All financial metrics roll up in BDT. amountBDT falls back to the
      // original amount for BDT rows only; a foreign row with no BDT-equivalent
      // is shown in the currency breakdown but left out of the BDT totals.
      const bdt = txAmountBDT(tx)
      const amt = bdt ?? 0
      const orig = Number(tx.amount) || 0
      const cur = tx.currency || 'BDT'
      if (!currencyMap[cur]) currencyMap[cur] = { currency: cur, incomeOriginal: 0, expenseOriginal: 0, incomeBDT: 0, expenseBDT: 0, count: 0, unconvertedCount: 0 }
      currencyMap[cur].count++
      if (bdt == null) {
        currencyMap[cur].unconvertedCount++
        if (tx.type === 'INCOME')  currencyMap[cur].incomeOriginal  += orig
        if (tx.type === 'EXPENSE') currencyMap[cur].expenseOriginal += orig
        continue
      }

      if (tx.type === 'INCOME') {
        totalRevenue += amt
        incomeCount++
        currencyMap[cur].incomeOriginal += orig
        currencyMap[cur].incomeBDT      += amt
        if (tx.category)        incomeCategoryMap[tx.category]           = (incomeCategoryMap[tx.category] ?? 0) + amt
        if (tx.expenseCategory) incomeSubcategoryMap[tx.expenseCategory] = (incomeSubcategoryMap[tx.expenseCategory] ?? 0) + amt
      } else if (tx.type === 'EXPENSE') {
        totalExpenses += amt
        expenseCount++
        currencyMap[cur].expenseOriginal += orig
        currencyMap[cur].expenseBDT      += amt
        if (tx.category)        expenseCategoryMap[tx.category]            = (expenseCategoryMap[tx.category] ?? 0) + amt
        if (tx.expenseCategory) expenseSubcategoryMap[tx.expenseCategory]  = (expenseSubcategoryMap[tx.expenseCategory] ?? 0) + amt
      }
    }

    const currencyBreakdown = Object.values(currencyMap).sort((a, b) => b.count - a.count)

    const netProfit = totalRevenue - totalExpenses
    // Outstanding is computed in the invoice's own currency (total and paidAmount
    // are both in `currency`), then converted to BDT: as-is for BDT invoices, via
    // the invoice's totalBDT/total rate otherwise. Foreign invoices with no BDT
    // figure are reported per currency instead of being summed as BDT.
    let outstandingReceivables = 0
    const unconvertedReceivables = {}
    for (const inv of receivableInvoices) {
      const total       = Number(inv.total) || 0
      const outstanding = Math.max(0, total - (Number(inv.paidAmount) || 0))
      if (outstanding <= 0) continue
      const cur = inv.currency || BASE_CURRENCY
      if (cur === BASE_CURRENCY) {
        outstandingReceivables += outstanding
      } else if (Number(inv.totalBDT) > 0 && total > 0) {
        outstandingReceivables += outstanding * (Number(inv.totalBDT) / total)
      } else {
        unconvertedReceivables[cur] = (unconvertedReceivables[cur] ?? 0) + outstanding
      }
    }
    const outstandingReceivablesUnconverted = Object.entries(unconvertedReceivables)
      .map(([currency, amount]) => ({ currency, amount }))

    const expenseByCategory = Object.entries(expenseCategoryMap)
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount)
    const incomeByCategory = Object.entries(incomeCategoryMap)
      .map(([category, amount]) => ({ category, amount }))
      .sort((a, b) => b.amount - a.amount)
    const expenseBySubcategory = Object.entries(expenseSubcategoryMap)
      .map(([subcategory, amount]) => ({ subcategory, amount }))
      .sort((a, b) => b.amount - a.amount)
    const incomeBySubcategory = Object.entries(incomeSubcategoryMap)
      .map(([subcategory, amount]) => ({ subcategory, amount }))
      .sort((a, b) => b.amount - a.amount)

    // Monthly breakdown for last 12 months
    // Month buckets follow the business timezone (Asia/Dhaka).
    const yearAgo = dhakaMonthStart(new Date(), -12)
    const monthlyTx = await Transaction.find({ date: { $gte: yearAgo } })
      .select('type amount amountBDT currency date')
      .sort({ date: 1 })
      .lean()

    const monthlyMap = {}
    monthlyTx.forEach(tx => {
      const { year, month } = dhakaParts(tx.date)
      const key = `${year}-${String(month + 1).padStart(2, '0')}`
      if (!monthlyMap[key]) monthlyMap[key] = { month: key, income: 0, expense: 0 }
      const bdt = txAmountBDT(tx) ?? 0
      if (tx.type === 'INCOME')  monthlyMap[key].income  += bdt
      if (tx.type === 'EXPENSE') monthlyMap[key].expense += bdt
    })
    const monthlyData = Object.values(monthlyMap).sort((a, b) => a.month.localeCompare(b.month))

    return NextResponse.json({
      data: {
        totalRevenue,
        totalExpenses,
        netProfit,
        outstandingReceivables,
        outstandingReceivablesUnconverted,
        monthlyData,
        expenseByCategory,
        incomeByCategory,
        expenseBySubcategory,
        incomeBySubcategory,
        currencyBreakdown,
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
