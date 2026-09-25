export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Leave, Employee } from '@/models'
import { requirePerm, canDo } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { getOwnEmployeeId, checkLeaveRange } from '@/lib/hrAccess'
import { z } from 'zod'

// Only what the leaves UI shows — never the full Employee (salary, NID…).
const EMP_POPULATE = {
  path: 'employeeId', select: 'employeeId designation department position userId',
  populate: { path: 'userId', select: 'name avatar' },
}

const createSchema = z.object({
  employeeId: z.string().min(1),
  type:       z.enum(['ANNUAL', 'SICK', 'CASUAL', 'MATERNITY', 'PATERNITY', 'UNPAID', 'OTHER']),
  startDate:  z.string().datetime(),
  endDate:    z.string().datetime(),
  reason:     z.string().optional().nullable(),
})

// GET /api/leaves?status=&employeeId=&type=
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'hr.leaves.view')
    if (denied) return denied

    await connectDB()

    const { searchParams } = new URL(request.url)
    const status     = searchParams.get('status')
    const employeeId = searchParams.get('employeeId')
    const type       = searchParams.get('type')

    const filter = {}
    if (status)     filter.status     = String(status)
    if (employeeId) {
      if (!isValidObjectId(employeeId)) return NextResponse.json({ data: [] })
      filter.employeeId = employeeId
    }
    if (type)       filter.type       = String(type)

    // Without approve rights (e.g. EMPLOYEE) only the caller's own leaves are visible.
    if (!canDo(session, 'hr.leaves.approve')) {
      const ownId = await getOwnEmployeeId(session)
      if (!ownId || (filter.employeeId && String(filter.employeeId) !== String(ownId))) {
        return NextResponse.json({ data: [] })
      }
      filter.employeeId = ownId
    }

    const leaves = await Leave.find(filter)
      .sort({ createdAt: -1 })
      .populate(EMP_POPULATE)
      .lean()

    return NextResponse.json({ data: leaves })
  } catch (err) {
    console.error('[GET /api/leaves]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/leaves  — admin files a leave on behalf of an employee
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'hr.leaves.view')
    if (denied) return denied

    await connectDB()

    const body   = await request.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success)
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })

    const { employeeId, type, startDate, endDate, reason } = parsed.data

    if (!isValidObjectId(employeeId))
      return NextResponse.json({ error: 'Invalid employee' }, { status: 400 })
    if (!(await Employee.exists({ _id: employeeId })))
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 })

    // Filing for someone else needs approve rights; anyone with leave access may
    // file their own (it starts PENDING and needs another approver).
    if (!canDo(session, 'hr.leaves.approve')) {
      const ownId = await getOwnEmployeeId(session)
      if (!ownId || String(ownId) !== String(employeeId))
        return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    const rangeError = await checkLeaveRange(employeeId, startDate, endDate)
    if (rangeError) return NextResponse.json({ error: rangeError }, { status: 422 })

    const leave = await Leave.create({
      employeeId,
      type,
      startDate: new Date(startDate),
      endDate:   new Date(endDate),
      reason:    reason ?? null,
      status:    'PENDING',
    })

    await leave.populate(EMP_POPULATE)

    return NextResponse.json({ data: leave }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/leaves]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
