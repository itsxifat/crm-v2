export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Leave } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { isOwnEmployeeRecord } from '@/lib/hrAccess'
import { z } from 'zod'

const EMP_POPULATE = {
  path: 'employeeId', select: 'employeeId designation department position userId',
  populate: { path: 'userId', select: 'name avatar' },
}

const approveSchema = z.object({
  status: z.enum(['APPROVED', 'REJECTED']),
})

// PATCH /api/leaves/[id]  — approve or reject
export async function PATCH(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'hr.leaves.approve')
    if (denied) return denied

    await connectDB()

    const body   = await request.json()
    const parsed = approveSchema.safeParse(body)
    if (!parsed.success)
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })

    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const current = await Leave.findById(params.id).select('employeeId status').lean()
    if (!current) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    // No one approves or rejects their own leave (Super Admin excepted).
    if (session.user.role !== 'SUPER_ADMIN' && await isOwnEmployeeRecord(session, current.employeeId))
      return NextResponse.json({ error: 'You cannot approve or reject your own leave' }, { status: 403 })

    // Decide only once: the transition is conditional on the leave still being PENDING.
    const leave = await Leave.findOneAndUpdate(
      { _id: params.id, status: 'PENDING' },
      { status: parsed.data.status, approvedBy: session.user.id, approvedAt: new Date() },
      { new: true }
    ).populate(EMP_POPULATE)

    if (!leave) return NextResponse.json({ error: 'This leave has already been decided' }, { status: 409 })

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
    const denied  = requirePerm(session, 'hr.leaves.approve')
    if (denied) return denied

    await connectDB()

    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const leave = await Leave.findByIdAndDelete(params.id)
    if (!leave) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/leaves/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
