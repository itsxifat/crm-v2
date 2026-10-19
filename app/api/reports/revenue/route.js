export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Transaction, Client } from '@/models'
import { canDoAny } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { dhakaParts, parseDhakaDay } from '@/lib/dhakaTime'
import { plFilter } from '@/lib/finance/ledger'
import { plEffect, PL_SELECT, round2 } from '@/app/api/accounts/_lib/pl'

const GROUP_BY = ['month', 'quarter', 'year']
// Contra-revenue: cash refunded to clients against a credit note (Mushak-6.7) is
// posted as an EXPENSE row in this category and reduces revenue.
const CONTRA_REVENUE_CATEGORIES = ['Sales Returns & Allowances']

// GET /api/reports/revenue?startDate=&endDate=&groupBy=month|quarter|year&clientId=
// Revenue = P&L income: INCOME rows of a P&L kind (OPERATING / NON_CASH, or
// legacy rows without a kind) at their P&L value — a client receipt counts net
// of the VAT/SD it carries, withholding-only settlements (VDS/TDS) count, and
// transfers, capital, loans, tax refunds and asset sales do not. Reversals of
// income (EXPENSE rows with reversalOf) reduce revenue. Foreign rows without a
// BDT figure are left out of the BDT totals and counted in `unconvertedCount`.
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    // Revenue per client is both a report and finance data — either permission.
    if (!canDoAny(session, ['analytics.reports.view', 'finance.reports.view']))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await connectDB()

    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate')
    const endDate   = searchParams.get('endDate')
    const clientId  = searchParams.get('clientId')
    const groupBy   = GROUP_BY.includes(searchParams.get('groupBy')) ? searchParams.get('groupBy') : 'month'

    const and = [
      plFilter(),
      // Income rows, EXPENSE rows that reverse an income row, and client refunds
      // (contra-revenue) with their reversals.
      { $or: [
        { type: 'INCOME', reversalOf: { $in: [null] } },
        { type: 'EXPENSE', reversalOf: { $nin: [null] } },
        { category: { $in: CONTRA_REVENUE_CATEGORIES } },
      ] },
    ]
    if (startDate || endDate) {
      const date = {}
      // Date-only values are whole Asia/Dhaka calendar days (endDate inclusive)
      if (startDate) date.$gte = parseDhakaDay(startDate)?.start ?? new Date(startDate)
      if (endDate) {
        const day = parseDhakaDay(endDate)
        if (day) date.$lt  = day.next
        else     date.$lte = new Date(endDate)
      }
      if (Object.values(date).some(d => Number.isNaN(d.getTime())))
        return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
      and.push({ date })
    }
    if (clientId) {
      if (!isValidObjectId(clientId)) return NextResponse.json({ error: 'Invalid clientId' }, { status: 400 })
      and.push({ clientId })
    }

    const transactions = await Transaction.find({ $and: and })
      .select(`${PL_SELECT} clientId`)
      .sort({ date: 1 })
      .lean()

    const grouped = {}
    const clientRevenue = {}
    let totalRevenue = 0
    let transactionCount = 0
    let unconvertedCount = 0

    for (const tx of transactions) {
      const effect = plEffect(tx)
      if (!effect) continue
      const contra = CONTRA_REVENUE_CATEGORIES.includes(tx.category)
      // Revenue side: income (net of its reversals); refunds (net of theirs) reduce it.
      if (contra ? effect.side !== 'EXPENSE' : effect.side !== 'INCOME') continue
      if (effect.unconverted) { unconvertedCount++; continue }
      const amount = contra ? -effect.amount : effect.amount

      const { year, month } = dhakaParts(tx.date) // business-timezone periods
      let key
      if (groupBy === 'year')         key = `${year}`
      else if (groupBy === 'quarter') key = `${year} Q${Math.ceil((month + 1) / 3)}`
      else                            key = `${year}-${String(month + 1).padStart(2, '0')}`

      if (!grouped[key]) grouped[key] = { period: key, revenue: 0, count: 0 }
      grouped[key].revenue += amount
      if (!tx.reversalOf && !contra) grouped[key].count += 1

      totalRevenue += amount
      if (!tx.reversalOf && !contra) transactionCount += 1

      if (tx.clientId) {
        const cid = String(tx.clientId)
        if (!clientRevenue[cid]) clientRevenue[cid] = { clientId: cid, revenue: 0 }
        clientRevenue[cid].revenue += amount
      }
    }

    const clientIds = Object.keys(clientRevenue).filter(isValidObjectId)
    if (clientIds.length > 0) {
      const clients = await Client.find({ _id: { $in: clientIds } })
        .select('company userId')
        .populate({ path: 'userId', select: 'name' })
        .lean()
      clients.forEach(c => {
        const cid = c._id.toString()
        if (clientRevenue[cid]) clientRevenue[cid].clientName = c.userId?.name ?? c.company ?? 'Unknown'
      })
    }
    for (const c of Object.values(clientRevenue)) {
      if (!c.clientName) c.clientName = 'Unknown'
      c.revenue = round2(c.revenue)
    }

    const rows = Object.values(grouped)
      .map(r => ({ ...r, revenue: round2(r.revenue) }))
      .sort((a, b) => a.period.localeCompare(b.period))

    return NextResponse.json({
      data: {
        rows,
        byClient:         Object.values(clientRevenue).sort((a, b) => b.revenue - a.revenue),
        totalRevenue:     round2(totalRevenue),
        transactionCount,
        unconvertedCount,
        period: { startDate, endDate, groupBy },
      },
    })
  } catch (err) {
    console.error('[GET /api/reports/revenue]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
