export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { requirePerm, canDo } from '@/lib/rbac'
import connectDB from '@/lib/mongodb'
import Leave from '@/models/Leave'
import Employee from '@/models/Employee'
import { isValidObjectId } from '@/lib/objectId'
import { isOwnEmployeeRecord, checkLeaveRange } from '@/lib/hrAccess'
import { z } from 'zod'

const leaveSchema = z.object({
  type:      z.enum(['ANNUAL', 'SICK', 'CASUAL', 'MATERNITY', 'PATERNITY', 'UNPAID', 'OTHER']),
  startDate: z.string().datetime(),
  endDate:   z.string().datetime(),
  reason:    z.string().optional().nullable(),
})

const approveSchema = z.object({
  status:    z.enum(['APPROVED', 'REJECTED']),
  adminNote: z.string().optional().nullable(),
})

// GET /api/employees/[id]/leaves
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'hr.leaves.view')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()

    // Without approve rights only the caller's own leaves are readable.
    if (!canDo(session, 'hr.leaves.approve') && !(await isOwnEmployeeRecord(session, params.id)))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')

    const filter = { employeeId: params.id }
    if (status) filter.status = String(status)

    const leaves = await Leave.find(filter).sort({ createdAt: -1 })
    return NextResponse.json({ data: leaves })
  } catch (err) {
    console.error('[GET /api/employees/[id]/leaves]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/employees/[id]/leaves
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'hr.leaves.view')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()

    if (!(await Employee.exists({ _id: params.id })))
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
    // Filing for someone else needs approve rights; own leaves start PENDING.
    if (!canDo(session, 'hr.leaves.approve') && !(await isOwnEmployeeRecord(session, params.id)))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const body   = await request.json()
    const parsed = leaveSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    const { type, startDate, endDate, reason } = parsed.data

    const rangeError = await checkLeaveRange(params.id, startDate, endDate)
    if (rangeError) return NextResponse.json({ error: rangeError }, { status: 422 })
    const leave = await new Leave({
      employeeId: params.id,
      type,
      startDate: new Date(startDate),
      endDate:   new Date(endDate),
      reason,
      status:    'PENDING',
    }).save()

    return NextResponse.json({ data: leave }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/employees/[id]/leaves]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/employees/[id]/leaves — approve/reject
export async function PATCH(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'hr.leaves.approve')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()

    const body    = await request.json()
    const leaveId = body.leaveId
    if (!leaveId) return NextResponse.json({ error: 'leaveId is required' }, { status: 400 })
    if (!isValidObjectId(leaveId)) return NextResponse.json({ error: 'Invalid leaveId' }, { status: 400 })

    // No one approves or rejects their own leave (Super Admin excepted).
    if (session.user.role !== 'SUPER_ADMIN' && await isOwnEmployeeRecord(session, params.id))
      return NextResponse.json({ error: 'You cannot approve or reject your own leave' }, { status: 403 })

    const parsed = approveSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    // The leave must belong to this employee and still be PENDING (decided once).
    const leave = await Leave.findOneAndUpdate(
      { _id: leaveId, employeeId: params.id, status: 'PENDING' },
      { status: parsed.data.status, approvedBy: session.user.id, approvedAt: new Date() },
      { new: true }
    )
    if (!leave) return NextResponse.json({ error: 'Leave not found or already decided' }, { status: 409 })

    return NextResponse.json({ data: leave })
  } catch (err) {
    console.error('[PATCH /api/employees/[id]/leaves]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
