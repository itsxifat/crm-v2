export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Client, Project, Task, Milestone } from '@/models'

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || session.user.role !== 'CLIENT')
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const client = await Client.findOne({ userId: session.user.id }).lean()
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')

    const filter = { clientId: client._id }
    if (status && status !== 'ALL') filter.status = status

    const projects = await Project.find(filter)
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
      return {
        ...p,
        id:                 p._id.toString(),
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
