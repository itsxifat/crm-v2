import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Project } from '@/models'

const TRANSITIONS = {
  PENDING:       ['IN_PROGRESS', 'CANCELLED', 'ON_HOLD'],
  IN_PROGRESS:   ['IN_REVIEW', 'REVISION', 'ON_HOLD', 'CANCELLED'],
  IN_REVIEW:     ['APPROVED', 'REVISION', 'IN_PROGRESS'],
  REVISION:      ['IN_PROGRESS', 'IN_REVIEW'],
  APPROVED:      ['DELIVERED'],
  DELIVERED:     [],
  ACTIVE:        ['EXPIRING_SOON', 'ON_HOLD', 'CANCELLED'],
  EXPIRING_SOON: ['RENEWED', 'CANCELLED'],
  RENEWED:       ['ACTIVE', 'EXPIRING_SOON'],
  ON_HOLD:       ['IN_PROGRESS', 'ACTIVE', 'CANCELLED'],
  CANCELLED:     [],
}

// PATCH /api/projects/:id/status
export async function PATCH(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!['SUPER_ADMIN','MANAGER'].includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    await connectDB()

    const { status, note } = await request.json()
    const project = await Project.findById(params.id)
    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const allowed = TRANSITIONS[project.status] ?? []
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
