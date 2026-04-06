export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Client, Project, Task, Milestone, Document } from '@/models'

export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || session.user.role !== 'CLIENT')
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const client = await Client.findOne({ userId: session.user.id }).lean()
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

    const project = await Project.findOne({ _id: params.id, clientId: client._id }).lean()
    if (!project) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    const [tasks, milestones, documents] = await Promise.all([
      Task.find({ projectId: project._id, isClientVisible: true })
        .select('title status dueDate')
        .sort({ position: 1, createdAt: 1 })
        .lean(),
      Milestone.find({ projectId: project._id })
        .select('title description dueDate completed')
        .sort({ dueDate: 1 })
        .lean(),
      Document.find({ projectId: project._id })
        .select('name description fileUrl mimeType createdAt')
        .sort({ createdAt: -1 })
        .lean(),
    ])

    const serialize = (doc) => ({
      ...doc,
      id: doc._id.toString(),
      _id: undefined,
    })

    const budget    = project.budget    ?? 0
    const discount  = project.discount  ?? 0
    const paidAmount = project.paidAmount ?? 0
    const dueAmount  = Math.max(0, budget - discount - paidAmount)

    return NextResponse.json({
      project: {
        ...project,
        id: project._id.toString(),
        _id: undefined,
        endDate: project.deadline ?? null,
        budget,
        discount,
        paidAmount,
        dueAmount,
        tasks: tasks.map(serialize),
        milestones: milestones.map(serialize),
        documents: documents.map(serialize),
      },
    })
  } catch (err) {
    console.error('[GET /api/client/projects/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
