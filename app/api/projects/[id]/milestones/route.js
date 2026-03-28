import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Milestone } from '@/models'
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

    await connectDB()

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
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const allowedRoles = ['SUPER_ADMIN', 'MANAGER']
    if (!allowedRoles.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

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
