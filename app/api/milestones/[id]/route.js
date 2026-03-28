import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Milestone } from '@/models'
import { z } from 'zod'

const updateSchema = z.object({
  title:       z.string().min(1).optional(),
  description: z.string().optional().nullable(),
  dueDate:     z.string().optional().nullable(),
  completed:   z.boolean().optional(),
})

// PUT /api/milestones/[id]
export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const body   = await request.json()
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    const data = { ...parsed.data }
    if (data.dueDate) data.dueDate = new Date(data.dueDate)
    if (data.completed) data.completedAt = new Date()

    const milestone = await Milestone.findByIdAndUpdate(params.id, data, { new: true })
    return NextResponse.json({ data: milestone })
  } catch (err) {
    console.error('[PUT /api/milestones/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/milestones/[id]
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const allowedRoles = ['SUPER_ADMIN', 'MANAGER']
    if (!allowedRoles.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()
    await Milestone.findByIdAndDelete(params.id)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/milestones/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/milestones/[id] - toggle complete
export async function PATCH(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const milestone = await Milestone.findById(params.id)
    if (!milestone) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const updated = await Milestone.findByIdAndUpdate(
      params.id,
      {
        completed:   !milestone.completed,
        completedAt: !milestone.completed ? new Date() : null,
      },
      { new: true }
    )

    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error('[PATCH /api/milestones/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
