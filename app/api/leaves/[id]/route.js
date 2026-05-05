export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Leave } from '@/models'
import { z } from 'zod'

const approveSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
})

// PATCH /api/leaves/[id]  — approve or reject
export async function PATCH(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!['SUPER_ADMIN', 'MANAGER'].includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await connectDB()

    const body   = await request.json()
    const parsed = approveSchema.safeParse(body)
    if (!parsed.success)
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })

    const leave = await Leave.findByIdAndUpdate(
      params.id,
      { status: parsed.data.status, approvedBy: session.user.id, approvedAt: new Date() },
      { new: true }
    ).populate({ path: 'employeeId', populate: { path: 'userId', select: 'name avatar' } })

    if (!leave) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({ data: leave })
  } catch (err) {
    console.error('[PATCH /api/leaves/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/leaves/[id]
export async function DELETE(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!['SUPER_ADMIN', 'MANAGER'].includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await connectDB()

    const leave = await Leave.findByIdAndDelete(params.id)
    if (!leave) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/leaves/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
