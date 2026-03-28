import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Lead } from '@/models'

// GET /api/reports/leads
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
      filter.createdAt = {}
      if (startDate) filter.createdAt.$gte = new Date(startDate)
      if (endDate)   filter.createdAt.$lte = new Date(endDate)
    }

    const leads = await Lead.find(filter).lean()

    const stages = ['NEW', 'CONTACTED', 'PROPOSAL_SENT', 'NEGOTIATION', 'WON', 'LOST']
    const stageCounts = {}
    stages.forEach(s => { stageCounts[s] = 0 })
    leads.forEach(l => { stageCounts[l.status] = (stageCounts[l.status] ?? 0) + 1 })

    const sourceMap = {}
    leads.forEach(l => {
      const src = l.source ?? 'Unknown'
      if (!sourceMap[src]) sourceMap[src] = { source: src, total: 0, won: 0, lost: 0, value: 0 }
      sourceMap[src].total += 1
      if (l.status === 'WON')  { sourceMap[src].won  += 1; sourceMap[src].value += l.value ?? 0 }
      if (l.status === 'LOST')   sourceMap[src].lost  += 1
    })

    const total          = leads.length
    const won            = stageCounts['WON']  ?? 0
    const conversionRate = total > 0 ? (won / total) * 100 : 0
    const totalValue     = leads.filter(l => l.status === 'WON').reduce((s, l) => s + (l.value ?? 0), 0)

    const funnelData = stages.map(s => ({
      stage: s,
      count: stageCounts[s] ?? 0,
      rate:  total > 0 ? ((stageCounts[s] ?? 0) / total) * 100 : 0,
    }))

    return NextResponse.json({
      data: {
        funnelData,
        bySource: Object.values(sourceMap),
        summary: {
          total,
          won,
          lost:           stageCounts['LOST'] ?? 0,
          conversionRate: Math.round(conversionRate * 10) / 10,
          totalValue,
          avgDealValue: won > 0 ? totalValue / won : 0,
        },
        period: { startDate, endDate },
      },
    })
  } catch (err) {
    console.error('[GET /api/reports/leads]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
