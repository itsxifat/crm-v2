export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Lead } from '@/models'
import { requirePerm, canDo } from '@/lib/rbac'
import { maskMoney } from '@/lib/pii'
import { parseDhakaDay } from '@/lib/dhakaTime'

// GET /api/reports/leads
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'analytics.reports.view')
    if (denied) return denied

    await connectDB()

    const { searchParams } = new URL(request.url)
    const startDate = searchParams.get('startDate')
    const endDate   = searchParams.get('endDate')

    const filter = {}
    if (startDate || endDate) {
      filter.createdAt = {}
      // Date-only values are whole Asia/Dhaka calendar days (endDate inclusive)
      if (startDate) filter.createdAt.$gte = parseDhakaDay(startDate)?.start ?? new Date(startDate)
      if (endDate) {
        const day = parseDhakaDay(endDate)
        if (day) filter.createdAt.$lt  = day.next
        else     filter.createdAt.$lte = new Date(endDate)
      }
      if (Object.values(filter.createdAt).some(d => Number.isNaN(d.getTime())))
        return NextResponse.json({ error: 'Invalid date' }, { status: 400 })
    }

    const leads = await Lead.find(filter).select('status source value').lean()

    const stages = ['NEW', 'CONTACTED', 'PROPOSAL_SENT', 'NEGOTIATION', 'WON', 'LOST']
    const stageCounts = {}
    stages.forEach(s => { stageCounts[s] = 0 })
    leads.forEach(l => { stageCounts[l.status] = (stageCounts[l.status] ?? 0) + 1 })

    const sourceMap = {}
    leads.forEach(l => {
      const src = l.source ?? 'Unknown'
      if (!sourceMap[src]) sourceMap[src] = { source: src, total: 0, won: 0, lost: 0, value: 0 }
      sourceMap[src].total += 1
      if (l.status === 'WON')  { sourceMap[src].won  += 1; sourceMap[src].value += Number(l.value) || 0 }
      if (l.status === 'LOST')   sourceMap[src].lost  += 1
    })

    const total          = leads.length
    const won            = stageCounts['WON']  ?? 0
    const conversionRate = total > 0 ? (won / total) * 100 : 0
    const totalValue     = leads.filter(l => l.status === 'WON').reduce((s, l) => s + (Number(l.value) || 0), 0)

    const funnelData = stages.map(s => ({
      stage: s,
      count: stageCounts[s] ?? 0,
      rate:  total > 0 ? ((stageCounts[s] ?? 0) / total) * 100 : 0,
    }))

    // Lead values are masked for roles without pii.financial.view (see LEAD_PII)
    const showValue = canDo(session, 'pii.financial.view')
    const money     = (v) => (showValue ? v : maskMoney(v))
    const bySource  = Object.values(sourceMap).map(r => ({ ...r, value: money(r.value) }))

    return NextResponse.json({
      data: {
        funnelData,
        bySource,
        summary: {
          total,
          won,
          lost:           stageCounts['LOST'] ?? 0,
          conversionRate: Math.round(conversionRate * 10) / 10,
          totalValue:     money(totalValue),
          avgDealValue:   money(won > 0 ? totalValue / won : 0),
        },
        period: { startDate, endDate },
      },
    })
  } catch (err) {
    console.error('[GET /api/reports/leads]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
