export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Transaction, Invoice, MoneyAccount, TaxEntry } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { parseDhakaDay, dhakaParts, dhakaMonthStart, dhakaDayKey } from '@/lib/dhakaTime'
import { BASE_CURRENCY } from '@/lib/currencies'
import { getAccountBalances, accountTypeGroup } from '@/lib/finance/ledger'
import { taxPeriodOf, tdsDepositDueDate, addDays } from '@/lib/finance/fiscal'
import {
  plEffect, nonPlBreakdown, depreciationTotal, ebitdaOf, PL_SELECT, round2,
} from '@/app/api/accounts/_lib/pl'

const DAY_RE = /^\d{4}-\d{2}-\d{2}$/

// ── Funds: balances of the money accounts ─────────────────────────────────────
// null asOf ⇒ current balances of the ACTIVE accounts. asOf (a 'YYYY-MM-DD'
// Dhaka day) gives the balances at the end of that day, including accounts
// archived since then (an archived account is listed only when it held money on
// that day). Totals roll up in BDT; foreign-currency accounts are listed and
// totalled per currency but never added to the BDT figures.
async function computeFunds(asOf) {
  const accounts = await MoneyAccount.find(asOf ? {} : { status: 'ACTIVE' })
    .select('name type currency last4 bankName mfsProvider isDefault color openingDate openingBalance status')
    .sort({ isDefault: -1, name: 1 })
    .lean()

  const result = {
    asOf: asOf ?? null,
    count: 0,
    totalBDT: 0,
    byGroup: { bank: 0, cash: 0, mfs: 0, other: 0 },
    foreign: [],
    accounts: [],
  }
  if (!accounts.length) return result

  // The opening balance is the balance at the end of openingDate − 1, so an
  // account counts from that day; one opened later had no balance yet.
  const eligible = asOf
    ? accounts.filter(a => !a.openingDate || addDays(dhakaDayKey(a.openingDate), -1) <= asOf)
    : accounts
  const balances = eligible.length
    ? await getAccountBalances({ accountIds: eligible.map(a => a._id), asOf: asOf ?? null })
    : new Map()

  const foreign = {}
  for (const a of eligible) {
    const id  = String(a._id)
    const bal = balances.get(id)
    const currency = a.currency || BASE_CURRENCY
    const balance  = round2(bal?.balance ?? (Number(a.openingBalance) || 0))
    // An archived account that was empty on the as-of day adds nothing.
    if (a.status === 'ARCHIVED' && Math.abs(balance) < 0.005) continue
    const group    = accountTypeGroup(a.type)
    result.accounts.push({
      id,
      name:           a.name,
      type:           a.type,
      group,
      currency,
      last4:          a.last4 ?? null,
      bankName:       a.bankName ?? null,
      mfsProvider:    a.mfsProvider ?? null,
      color:          a.color ?? null,
      isDefault:      !!a.isDefault,
      balance,
      clearedBalance: round2(bal?.clearedBalance ?? balance),
      unclearedCount: bal?.unclearedCount ?? 0,
      lastTxDate:     bal?.lastTxDate ?? null,
    })
    if (currency === BASE_CURRENCY) {
      result.totalBDT += balance
      result.byGroup[group] += balance
    } else {
      foreign[currency] = (foreign[currency] ?? 0) + balance
    }
  }
  result.count    = result.accounts.length
  result.totalBDT = round2(result.totalBDT)
  for (const k of Object.keys(result.byGroup)) result.byGroup[k] = round2(result.byGroup[k])
  result.foreign  = Object.entries(foreign).map(([currency, balance]) => ({ currency, balance: round2(balance) }))
  return result
}

// ── Tax position (light): open items only, no VAT-return computation ────────
async function computeTaxPosition() {
  const currentPeriod = taxPeriodOf(new Date())
  const today = dhakaDayKey()
  const [facet] = await TaxEntry.aggregate([
    { $match: { status: 'ACTIVE' } },
    { $facet: {
      certificates: [
        { $match: {
          entryType: { $in: ['VDS_RECEIVABLE', 'TDS_RECEIVABLE', 'VDS_PAYABLE', 'TDS_PAYABLE'] },
          'certificate.status': 'PENDING',
        } },
        { $group: { _id: '$entryType', count: { $sum: 1 }, amount: { $sum: '$amount' } } },
      ],
      deposits: [
        { $match: { entryType: { $in: ['TDS_PAYABLE', 'VDS_PAYABLE'] }, 'deposit.status': 'PENDING' } },
        // What is still owed: part payments by challan (deposit.paidAmount) are taken off.
        { $project: { entryType: 1, date: 1, amount: { $max: [0, { $subtract: ['$amount', { $ifNull: ['$deposit.paidAmount', 0] }] }] } } },
      ],
      inputUnclaimed: [
        { $match: {
          entryType: 'INPUT_VAT',
          creditable: true,
          claimPeriod: null,
          $or: [{ claimDeadline: null }, { claimDeadline: { $gte: currentPeriod } }],
        } },
        { $group: { _id: null, count: { $sum: 1 }, amount: { $sum: '$amount' } } },
      ],
    } },
  ])

  const cert = Object.fromEntries((facet?.certificates ?? []).map(r => [r._id, { count: r.count, amount: round2(r.amount) }]))
  const empty = { count: 0, amount: 0 }

  const tdsToDeposit = { count: 0, amount: 0, overdueCount: 0, overdueAmount: 0, oldestDue: null }
  const vdsToDeposit = { count: 0, amount: 0 }
  for (const row of facet?.deposits ?? []) {
    const amount = Number(row.amount) || 0
    if (row.entryType === 'TDS_PAYABLE') {
      tdsToDeposit.count++
      tdsToDeposit.amount += amount
      const due = tdsDepositDueDate(row.date)
      if (due && due < today) {
        tdsToDeposit.overdueCount++
        tdsToDeposit.overdueAmount += amount
        if (!tdsToDeposit.oldestDue || due < tdsToDeposit.oldestDue) tdsToDeposit.oldestDue = due
      }
    } else {
      vdsToDeposit.count++
      vdsToDeposit.amount += amount
    }
  }
  tdsToDeposit.amount        = round2(tdsToDeposit.amount)
  tdsToDeposit.overdueAmount = round2(tdsToDeposit.overdueAmount)
  vdsToDeposit.amount        = round2(vdsToDeposit.amount)

  const input = facet?.inputUnclaimed?.[0]
  return {
    vdsCertificatesPending: cert.VDS_RECEIVABLE ?? empty,   // collect Mushak-6.6 from clients
    tdsCertificatesPending: cert.TDS_RECEIVABLE ?? empty,   // collect TDS certificates from clients
    vdsCertificatesToIssue: cert.VDS_PAYABLE ?? empty,      // we must issue Mushak-6.6
    tdsCertificatesToIssue: cert.TDS_PAYABLE ?? empty,      // we must issue TDS certificates
    tdsToDeposit,
    vdsToDeposit,
    inputVatUnclaimed: { count: input?.count ?? 0, amount: round2(input?.amount ?? 0) },
  }
}

// GET /api/accounts/summary?startDate=&endDate=
// P&L figures count only OPERATING / NON_CASH rows (legacy rows without a kind
// count as OPERATING) using each row's P&L amount (plAmountBDT ⇒ amountBDT ⇒
// amount for BDT). Transfers, capital, loans, tax payments and asset
// purchases/sales are reported separately in `nonPlMovements`.
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
      if (Object.values(dateFilter.date).some(d => Number.isNaN(d.getTime())))
        return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
    }

    // Funds at the end of the period when it ends before today, else current.
    const todayKey  = dhakaDayKey()
    const fundsAsOf = endDate && DAY_RE.test(endDate) && endDate < todayKey ? endDate : null

    const yearAgo = dhakaMonthStart(new Date(), -12)
    const [allTx, receivableInvoices, monthlyTx, funds, taxPosition] = await Promise.all([
      Transaction.find(dateFilter).select(PL_SELECT).lean(),
      Invoice.find({ status: { $in: ['SENT', 'PARTIALLY_PAID', 'OVERDUE'] } })
        .select('total totalBDT paidAmount currency')
        .lean(),
      // Monthly breakdown for the last 12 months (Asia/Dhaka month buckets).
      Transaction.find({ date: { $gte: yearAgo } }).select(PL_SELECT).sort({ date: 1 }).lean(),
      computeFunds(fundsAsOf).catch(err => { console.error('[GET /api/accounts/summary] funds', err); return null }),
      computeTaxPosition().catch(err => { console.error('[GET /api/accounts/summary] taxPosition', err); return null }),
    ])

    let totalRevenue = 0, totalExpenses = 0, incomeCount = 0, expenseCount = 0
    const expenseCategoryMap = {}, incomeCategoryMap = {}
    const expenseSubcategoryMap = {}, incomeSubcategoryMap = {}
    // Per-currency breakdown of the P&L rows: original-currency cash + BDT P&L value.
    const currencyMap = {}

    for (const tx of allTx) {
      const effect = plEffect(tx)
      if (!effect) continue

      const orig = (Number(tx.amount) || 0) * effect.sign  // reversal / write-back sign, as the BDT figure
      const cur  = tx.currency || BASE_CURRENCY
      if (!currencyMap[cur]) currencyMap[cur] = { currency: cur, incomeOriginal: 0, expenseOriginal: 0, incomeBDT: 0, expenseBDT: 0, count: 0, unconvertedCount: 0 }
      const cm = currencyMap[cur]
      cm.count++
      if (effect.unconverted) {
        // A foreign row with no BDT-equivalent: shown per currency, left out of BDT totals.
        cm.unconvertedCount++
        if (effect.side === 'INCOME') cm.incomeOriginal  += orig
        else                          cm.expenseOriginal += orig
        continue
      }

      const amt = effect.amount
      if (effect.side === 'INCOME') {
        totalRevenue += amt
        if (!tx.reversalOf) incomeCount++
        cm.incomeOriginal += orig
        cm.incomeBDT      += amt
        if (tx.category)        incomeCategoryMap[tx.category]           = (incomeCategoryMap[tx.category] ?? 0) + amt
        if (tx.expenseCategory) incomeSubcategoryMap[tx.expenseCategory] = (incomeSubcategoryMap[tx.expenseCategory] ?? 0) + amt
      } else {
        totalExpenses += amt
        if (!tx.reversalOf && !effect.contra) expenseCount++
        cm.expenseOriginal += orig
        cm.expenseBDT      += amt
        if (tx.category)        expenseCategoryMap[tx.category]           = (expenseCategoryMap[tx.category] ?? 0) + amt
        if (tx.expenseCategory) expenseSubcategoryMap[tx.expenseCategory] = (expenseSubcategoryMap[tx.expenseCategory] ?? 0) + amt
      }
    }
    totalRevenue  = round2(totalRevenue)
    totalExpenses = round2(totalExpenses)

    const currencyBreakdown = Object.values(currencyMap)
      .map(c => ({
        ...c,
        incomeOriginal:  round2(c.incomeOriginal),
        expenseOriginal: round2(c.expenseOriginal),
        incomeBDT:       round2(c.incomeBDT),
        expenseBDT:      round2(c.expenseBDT),
      }))
      .sort((a, b) => b.count - a.count)

    const netProfit = round2(totalRevenue - totalExpenses)
    // Outstanding is computed in the invoice's own currency (total and paidAmount
    // are both in `currency`; paidAmount = cash + VDS + TDS + credit notes), then
    // converted to BDT: as-is for BDT invoices, via the invoice's totalBDT/total
    // rate otherwise. Foreign invoices with no BDT figure are reported per currency.
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
    outstandingReceivables = round2(outstandingReceivables)
    const outstandingReceivablesUnconverted = Object.entries(unconvertedReceivables)
      .map(([currency, amount]) => ({ currency, amount: round2(amount) }))

    const toList = (map, key) => Object.entries(map)
      .map(([k, amount]) => ({ [key]: k, amount: round2(amount) }))
      .sort((a, b) => b.amount - a.amount)
    const expenseByCategory    = toList(expenseCategoryMap, 'category')
    const incomeByCategory     = toList(incomeCategoryMap, 'category')
    const expenseBySubcategory = toList(expenseSubcategoryMap, 'subcategory')
    const incomeBySubcategory  = toList(incomeSubcategoryMap, 'subcategory')

    const monthlyMap = {}
    for (const tx of monthlyTx) {
      const effect = plEffect(tx)
      if (!effect || effect.unconverted) continue
      const { year, month } = dhakaParts(tx.date)
      const key = `${year}-${String(month + 1).padStart(2, '0')}`
      if (!monthlyMap[key]) monthlyMap[key] = { month: key, income: 0, expense: 0 }
      if (effect.side === 'INCOME') monthlyMap[key].income  += effect.amount
      else                          monthlyMap[key].expense += effect.amount
    }
    const monthlyData = Object.values(monthlyMap)
      .map(m => ({ ...m, income: round2(m.income), expense: round2(m.expense) }))
      .sort((a, b) => a.month.localeCompare(b.month))

    // Depreciation & amortisation are non-cash P&L charges: EBITDA adds them back,
    // together with net interest (interest paid − interest earned).
    const depreciation = depreciationTotal(allTx)
    const { ebitda, interestExpense, interestIncome } = ebitdaOf(netProfit, allTx, depreciation)

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
        ebitda,
        depreciation,
        interestExpense,
        interestIncome,
        avgMonthlyRevenue:  monthlyData.length > 0 ? monthlyData.reduce((s, d) => s + (d.income  || 0), 0) / monthlyData.length : 0,
        avgMonthlyExpense:  monthlyData.length > 0 ? monthlyData.reduce((s, d) => s + (d.expense || 0), 0) / monthlyData.length : 0,
        incomeCount,
        expenseCount,
        // Cash movements in the period that are not income or expense
        // (transfers, capital, loans, tax deposits, asset purchases/sales…).
        nonPlMovements:     nonPlBreakdown(allTx),
        funds,
        taxPosition,
      },
    })
  } catch (err) {
    console.error('[GET /api/accounts/summary]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
