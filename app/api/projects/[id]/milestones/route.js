export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Milestone, Project } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { canAccessProject } from '@/lib/projectAccess'
import { z } from 'zod'

const milestoneSchema = z.object({
  title:       z.string().min(1),
  description: z.string().optional().nullable(),
  dueDate:     z.string().optional().nullable(),
})

// GET /api/projects/[id]/milestones
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()

    if (!(await canAccessProject(session, params.id)))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const milestones = await Milestone.find({ projectId: params.id }).sort({ dueDate: 1 })
    return NextResponse.json({ data: milestones })
  } catch (err) {
    console.error('[GET /api/projects/[id]/milestones]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/projects/[id]/milestones
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'projects.update')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()

    if (!(await Project.exists({ _id: params.id })))
      return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body   = await request.json()
    const parsed = milestoneSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    const data = { ...parsed.data, projectId: params.id }
    if (data.dueDate) data.dueDate = new Date(data.dueDate)

    const milestone = await new Milestone(data).save()
    return NextResponse.json({ data: milestone }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/projects/[id]/milestones]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
