export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Transaction, Client } from '@/models'

// GET /api/reports/revenue?startDate=&endDate=&groupBy=month&clientId=
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
    const clientId  = searchParams.get('clientId')
    const groupBy   = searchParams.get('groupBy') || 'month'

    const filter = { type: 'INCOME' }
    if (startDate || endDate) {
      filter.date = {}
      if (startDate) filter.date.$gte = new Date(startDate)
      if (endDate)   filter.date.$lte = new Date(endDate)
    }
    if (clientId) filter.clientId = clientId

    const transactions = await Transaction.find(filter).sort({ date: 1 }).lean()

    const grouped = {}
    transactions.forEach(tx => {
      let key
      const d = new Date(tx.date)
      if (groupBy === 'year')         key = `${d.getFullYear()}`
      else if (groupBy === 'quarter') key = `${d.getFullYear()} Q${Math.ceil((d.getMonth() + 1) / 3)}`
      else                            key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`

      if (!grouped[key]) grouped[key] = { period: key, revenue: 0, count: 0 }
      grouped[key].revenue += tx.amount
      grouped[key].count   += 1
    })

    const clientRevenue = {}
    transactions.forEach(tx => {
      if (!tx.clientId) return
      const cid = tx.clientId.toString()
      if (!clientRevenue[cid]) clientRevenue[cid] = { clientId: cid, revenue: 0 }
      clientRevenue[cid].revenue += tx.amount
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
    const totalRevenue = transactions.reduce((s, tx) => s + tx.amount, 0)

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
