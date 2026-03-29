import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Project } from '@/models'

// Who can edit the brief: SUPER_ADMIN, MANAGER, or the project's own projectManager
async function canEdit(session, projectId) {
  if (['SUPER_ADMIN', 'MANAGER'].includes(session.user.role)) return true
  const project = await Project.findById(projectId).select('projectManagerId').lean()
  return project?.projectManagerId?.toString() === session.user.id
}

// GET /api/projects/:id/brief
export async function GET(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    await connectDB()

    const project = await Project.findById(params.id)
      .select('brief briefUpdatedAt briefUpdatedBy')
      .populate('briefUpdatedBy', 'name avatar')
      .lean()

    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({
      brief:           project.brief ?? null,
      briefUpdatedAt:  project.briefUpdatedAt ?? null,
      briefUpdatedBy:  project.briefUpdatedBy ?? null,
    })
  } catch (err) {
    console.error('[GET /api/projects/:id/brief]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/projects/:id/brief
export async function PATCH(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    await connectDB()

    const allowed = await canEdit(session, params.id)
    if (!allowed) return NextResponse.json({ error: 'Only the project manager can edit the brief' }, { status: 403 })

    const { brief } = await request.json()
    if (typeof brief !== 'string') return NextResponse.json({ error: 'brief must be a string' }, { status: 422 })

    const project = await Project.findByIdAndUpdate(
      params.id,
      { brief: brief.trim() || null, briefUpdatedAt: new Date(), briefUpdatedBy: session.user.id },
      { new: true }
    ).select('brief briefUpdatedAt briefUpdatedBy').populate('briefUpdatedBy', 'name avatar')

    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({
      brief:           project.brief,
      briefUpdatedAt:  project.briefUpdatedAt,
      briefUpdatedBy:  project.briefUpdatedBy,
    })
  } catch (err) {
    console.error('[PATCH /api/projects/:id/brief]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
