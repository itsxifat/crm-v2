export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import Lead from '@/models/Lead'
import Employee from '@/models/Employee'

export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const filter = {}
    if (session.user.role === 'EMPLOYEE') {
      const employee = await Employee.findOne({ userId: session.user.id }).lean()
      if (employee) filter.assignedToId = employee._id
    }

    const [total, won, lost, newCount, pipelineLeads] = await Promise.all([
      Lead.countDocuments(filter),
      Lead.countDocuments({ ...filter, status: 'WON' }),
      Lead.countDocuments({ ...filter, status: 'LOST' }),
      Lead.countDocuments({ ...filter, status: 'NEW' }),
      Lead.find({ ...filter, status: { $nin: ['WON', 'LOST'] } }).select('value'),
    ])

    const pipelineValue = pipelineLeads.reduce((s, l) => s + (l.value ?? 0), 0)

    return NextResponse.json({ data: { total, won, lost, newCount, pipelineValue } })
  } catch (err) {
    console.error('[GET /api/leads/stats]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
