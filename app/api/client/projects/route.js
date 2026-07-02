export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Project, Task, Milestone } from '@/models'
import { resolveActiveClient } from '@/lib/clientAccess'

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || session.user.role !== 'CLIENT')
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const { client, error } = await resolveActiveClient(session)
    if (error === 'SELECT_COMPANY') return NextResponse.json({ error: 'SELECT_COMPANY' }, { status: 409 })
    // No company yet (individual client with no workspace) → empty list, not an error.
    if (!client) return NextResponse.json({ projects: [] })

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')

    const filter = { clientId: client._id }
    if (status && status !== 'ALL') filter.status = status

    // Explicit projection of client-safe fields only — never expose internal
    // financials like approvedExpenses / profit to the client.
    const projects = await Project.find(filter)
      .select('projectCode name description category subcategory projectType status priority startDate deadline currentPeriodStart currentPeriodEnd nextBillingDate budget discount paidAmount currency updatedAt')
      .sort({ updatedAt: -1 })
      .lean()

    const projectIds = projects.map(p => p._id)
    const [tasks, milestones] = await Promise.all([
      Task.find({ projectId: { $in: projectIds } }).select('projectId status').lean(),
      Milestone.find({ projectId: { $in: projectIds } })
        .select('projectId title dueDate completed')
        .sort({ dueDate: 1 })
        .lean(),
    ])

    const enriched = projects.map(p => {
      const pTasks      = tasks.filter(t => t.projectId.toString() === p._id.toString())
      const pMilestones = milestones.filter(m => m.projectId.toString() === p._id.toString())
      const completed   = pTasks.filter(t => t.status === 'COMPLETED').length
      const nextMile    = pMilestones.find(m => !m.completed)
      const budget      = Number(p.budget   ?? 0)
      const discount    = Number(p.discount ?? 0)
      const paid        = Number(p.paidAmount ?? 0)
      const netValue    = Math.max(0, budget - discount)
      return {
        ...p,
        id:                 p._id.toString(),
        netValue,
        paidAmount:         paid,
        dueAmount:          Math.max(0, netValue - paid),
        completedTaskCount: completed,
        _count:             { tasks: pTasks.length },
        nextMilestone:      nextMile ?? null,
      }
    })

    return NextResponse.json({ projects: enriched })
  } catch (err) {
    console.error('[GET /api/client/projects]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
