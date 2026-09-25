export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Project } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { allowedStatusTransitions } from '@/lib/projectStatus'

// PATCH /api/projects/:id/status
export async function PATCH(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'projects.update')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await connectDB()

    const { status, note } = await request.json()
    const project = await Project.findById(params.id)
    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // Transitions are limited to the project's own lifecycle (FIXED vs MONTHLY).
    // RENEWED is never set here — renewal goes through POST /:id/renew.
    const allowed = allowedStatusTransitions(project)
    if (!allowed.includes(status)) {
      return NextResponse.json(
        { error: `Cannot transition from ${project.status} to ${status}` },
        { status: 422 }
      )
    }

    project.status = status
    if (status === 'CANCELLED') {
      project.cancelledAt  = new Date()
      project.cancelReason = note ?? null
    }
    await project.save()

    return NextResponse.json({ data: { status: project.status } })
  } catch (err) {
    console.error('[PATCH /api/projects/:id/status]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
