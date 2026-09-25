export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Attendance, Employee } from '@/models'
import { requirePerm, canDo } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { dhakaDate } from '@/lib/dhakaTime'
import { getOwnEmployeeId, upsertAttendance } from '@/lib/hrAccess'
import { z } from 'zod'

// Only what the attendance UI shows — never the full Employee (salary, NID…).
const EMP_POPULATE = {
  path: 'employeeId', select: 'employeeId designation department position userId',
  populate: { path: 'userId', select: 'name avatar' },
}

const createSchema = z.object({
  employeeId: z.string().min(1),
  date:       z.string().datetime(),
  checkIn:    z.string().datetime().optional().nullable(),
  checkOut:   z.string().datetime().optional().nullable(),
  status:     z.enum(['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'ON_LEAVE']),
  notes:      z.string().optional().nullable(),
})

// GET /api/attendance?month=YYYY-MM&employeeId=&status=
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'hr.attendance.view')
    if (denied) return denied

    await connectDB()

    const { searchParams } = new URL(request.url)
    const month      = searchParams.get('month')       // YYYY-MM
    const employeeId = searchParams.get('employeeId')
    const status     = searchParams.get('status')

    const filter = {}
    if (employeeId) {
      if (!isValidObjectId(employeeId)) return NextResponse.json({ data: [] })
      filter.employeeId = employeeId
    }
    if (status)     filter.status     = String(status)
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const [y, m]  = month.split('-').map(Number)
      // Month boundaries in the business timezone (Asia/Dhaka).
      filter.date   = { $gte: dhakaDate(y, m - 1, 1), $lt: dhakaDate(y, m, 1) }
    }

    // View-only holders (e.g. EMPLOYEE) see just their own attendance.
    if (!canDo(session, 'hr.attendance.manage')) {
      const ownId = await getOwnEmployeeId(session)
      if (!ownId || (filter.employeeId && String(filter.employeeId) !== String(ownId))) {
        return NextResponse.json({ data: [] })
      }
      filter.employeeId = ownId
    }

    const records = await Attendance.find(filter)
      .sort({ date: -1, createdAt: -1 })
      .populate(EMP_POPULATE)
      .lean()

    return NextResponse.json({ data: records })
  } catch (err) {
    console.error('[GET /api/attendance]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/attendance  — upserts (same employee + same day = update)
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied  = requirePerm(session, 'hr.attendance.manage')
    if (denied) return denied

    await connectDB()

    const body   = await request.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success)
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })

    const { employeeId, date, checkIn, checkOut, status, notes } = parsed.data

    if (!isValidObjectId(employeeId))
      return NextResponse.json({ error: 'Invalid employee' }, { status: 400 })
    const employee = await Employee.findById(employeeId).select('userId').lean()
    if (!employee) return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
    // No one marks their own attendance from here (Super Admin excepted).
    if (String(employee.userId) === String(session.user.id) && session.user.role !== 'SUPER_ADMIN')
      return NextResponse.json({ error: 'You cannot edit your own attendance' }, { status: 403 })

    const updateData = {
      checkIn:  checkIn  ? new Date(checkIn)  : null,
      checkOut: checkOut ? new Date(checkOut) : null,
      status,
      notes: notes ?? null,
    }

    const record = await upsertAttendance(employeeId, date, updateData)

    await record.populate(EMP_POPULATE)

    return NextResponse.json({ data: record }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/attendance]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
