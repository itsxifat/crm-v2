export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Project } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'

// POST /api/projects/:id/cancel
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'projects.update')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    await connectDB()

    const { reason } = await request.json()
    const project = await Project.findByIdAndUpdate(
      params.id,
      { status: 'CANCELLED', cancelledAt: new Date(), cancelReason: reason ?? null },
      { new: true }
    )
    if (!project) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    return NextResponse.json({ data: project.toJSON() })
  } catch (err) {
    console.error('[POST cancel]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
