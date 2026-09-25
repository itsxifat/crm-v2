export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import Lead from '@/models/Lead'
import Employee from '@/models/Employee'
import { requirePerm, canDo } from '@/lib/rbac'
import { maskMoney } from '@/lib/pii'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'sales.leads.view')
    if (denied) return denied

    await connectDB()

    // Employees only see stats for leads assigned to them (matches /api/leads)
    const filter = {}
    if (session.user.role === 'EMPLOYEE') {
      const employee = await Employee.findOne({ userId: session.user.id }).lean()
      // No Employee profile → no assigned leads (null would match every unassigned lead)
      if (!employee) {
        return NextResponse.json({ data: { total: 0, won: 0, lost: 0, newCount: 0, pipelineValue: 0 } })
      }
      filter.assignedToId = employee._id
    }

    const [total, won, lost, newCount, pipelineLeads] = await Promise.all([
      Lead.countDocuments(filter),
      Lead.countDocuments({ ...filter, status: 'WON' }),
      Lead.countDocuments({ ...filter, status: 'LOST' }),
      Lead.countDocuments({ ...filter, status: 'NEW' }),
      Lead.find({ ...filter, status: { $nin: ['WON', 'LOST'] } }).select('value'),
    ])

    const pipelineSum   = pipelineLeads.reduce((s, l) => s + (Number(l.value) || 0), 0)
    // Lead value is masked for roles without pii.financial.view (see LEAD_PII)
    const pipelineValue = canDo(session, 'pii.financial.view') ? pipelineSum : maskMoney(pipelineSum)

    return NextResponse.json({ data: { total, won, lost, newCount, pipelineValue } })
  } catch (err) {
    console.error('[GET /api/leads/stats]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
