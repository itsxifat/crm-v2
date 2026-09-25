export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Transaction, Client } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { dhakaParts, parseDhakaDay } from '@/lib/dhakaTime'

// GET /api/reports/revenue?startDate=&endDate=&groupBy=month&clientId=
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    // Revenue per client is both a report and finance data
    const denied  = requirePerm(session, 'analytics.reports.view') ?? requirePerm(session, 'finance.reports.view')
    if (denied) return denied

    await connectDB()

    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate')
    const endDate   = searchParams.get('endDate')
    const clientId  = searchParams.get('clientId')
    const groupBy   = searchParams.get('groupBy') || 'month'

    const filter = { type: 'INCOME' }
    if (startDate || endDate) {
      filter.date = {}
      // Date-only values are whole Asia/Dhaka calendar days (endDate inclusive)
      if (startDate) filter.date.$gte = parseDhakaDay(startDate)?.start ?? new Date(startDate)
      if (endDate) {
        const day = parseDhakaDay(endDate)
        if (day) filter.date.$lt  = day.next
        else     filter.date.$lte = new Date(endDate)
      }
      if (Object.values(filter.date).some(d => Number.isNaN(d.getTime())))
        return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
    }
    if (clientId) {
      if (!isValidObjectId(clientId)) return NextResponse.json({ error: 'Invalid clientId' }, { status: 400 })
      filter.clientId = clientId
    }

    const transactions = await Transaction.find(filter).sort({ date: 1 }).lean()

    // amount is in the transaction's own currency; amountBDT is what all metrics roll up in
    const amt = (tx) => Number(tx.amountBDT ?? tx.amount) || 0

    const grouped = {}
    transactions.forEach(tx => {
      let key
      const { year, month } = dhakaParts(tx.date) // business-timezone periods
      if (groupBy === 'year')         key = `${year}`
      else if (groupBy === 'quarter') key = `${year} Q${Math.ceil((month + 1) / 3)}`
      else                            key = `${year}-${String(month + 1).padStart(2, '0')}`

      if (!grouped[key]) grouped[key] = { period: key, revenue: 0, count: 0 }
      grouped[key].revenue += amt(tx)
      grouped[key].count   += 1
    })

    const clientRevenue = {}
    transactions.forEach(tx => {
      if (!tx.clientId) return
      const cid = tx.clientId.toString()
      if (!clientRevenue[cid]) clientRevenue[cid] = { clientId: cid, revenue: 0 }
      clientRevenue[cid].revenue += amt(tx)
    })

    const clientIds = Object.keys(clientRevenue)
    if (clientIds.length > 0) {
      const clients = await Client.find({ _id: { $in: clientIds } })
        .populate({ path: 'userId', select: 'name' })
        .lean()
      clients.forEach(c => {
        const cid = c._id.toString()
        if (clientRevenue[cid]) clientRevenue[cid].clientName = c.userId?.name ?? 'Unknown'
      })
    }

    const rows         = Object.values(grouped).sort((a, b) => a.period.localeCompare(b.period))
    const totalRevenue = transactions.reduce((s, tx) => s + amt(tx), 0)

    return NextResponse.json({
      data: {
        rows,
        byClient:         Object.values(clientRevenue).sort((a, b) => b.revenue - a.revenue),
        totalRevenue,
        transactionCount: transactions.length,
        period: { startDate, endDate, groupBy },
      },
    })
  } catch (err) {
    console.error('[GET /api/reports/revenue]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
