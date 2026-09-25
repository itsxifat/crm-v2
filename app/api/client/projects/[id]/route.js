export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Project, Task, Milestone, Document } from '@/models'
import { resolveActiveClient } from '@/lib/clientAccess'
import { isValidObjectId } from '@/lib/objectId'

export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session || session.user.role !== 'CLIENT')
      return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Project not found' }, { status: 404 })

    await connectDB()

    const { client, error } = await resolveActiveClient(session)
    if (error === 'SELECT_COMPANY') return NextResponse.json({ error: 'SELECT_COMPANY' }, { status: 409 })
    if (!client) return NextResponse.json({ error: 'Client not found' }, { status: 404 })

    // Explicit projection of client-safe fields only (same as the list route) —
    // never expose approvedExpenses, team, tags, cancelReason, etc.
    const project = await Project.findOne({ _id: params.id, clientId: client._id })
      .select('projectCode name description category subcategory projectType status priority startDate deadline currentPeriodStart currentPeriodEnd nextBillingDate budget paidAmount currency updatedAt')
      .lean()
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
      // Only documents filed for this client — never internal freelancer /
      // vendor paperwork that merely references the project.
      Document.find({ projectId: project._id, clientId: client._id })
        .select('name description fileUrl mimeType createdAt')
        .sort({ createdAt: -1 })
        .lean(),
    ])

    const serialize = (doc) => ({
      ...doc,
      id: doc._id.toString(),
      _id: undefined,
    })

    const budget     = project.budget     ?? 0   // budget IS the project value
    const paidAmount = project.paidAmount ?? 0
    const dueAmount  = Math.max(0, budget - paidAmount)

    return NextResponse.json({
      project: {
        ...project,
        id: project._id.toString(),
        _id: undefined,
        endDate: project.deadline ?? null,
        budget,
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
