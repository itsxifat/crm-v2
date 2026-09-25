export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { requirePerm, canDo } from '@/lib/rbac'
import connectDB from '@/lib/mongodb'
import Attendance from '@/models/Attendance'
import Employee from '@/models/Employee'
import { isValidObjectId } from '@/lib/objectId'
import { dhakaDate } from '@/lib/dhakaTime'
import { isOwnEmployeeRecord, upsertAttendance } from '@/lib/hrAccess'
import { z } from 'zod'

const attendanceSchema = z.object({
  date:     z.string().datetime(),
  checkIn:  z.string().datetime().optional().nullable(),
  checkOut: z.string().datetime().optional().nullable(),
  status:   z.enum(['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'ON_LEAVE']),
  notes:    z.string().optional().nullable(),
})

// GET /api/employees/[id]/attendance
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'hr.attendance.view')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()

    // View-only holders may read only their own attendance.
    if (!canDo(session, 'hr.attendance.manage') && !(await isOwnEmployeeRecord(session, params.id)))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    const { searchParams } = new URL(request.url)
    const month = searchParams.get('month')
    const year  = searchParams.get('year')

    const filter = { employeeId: params.id }
    // Month / year boundaries in the business timezone (Asia/Dhaka).
    if (month && /^\d{4}-\d{2}$/.test(month)) {
      const [y, m] = month.split('-').map(Number)
      filter.date = { $gte: dhakaDate(y, m - 1, 1), $lt: dhakaDate(y, m, 1) }
    } else if (year && /^\d{4}$/.test(year)) {
      filter.date = { $gte: dhakaDate(Number(year), 0, 1), $lt: dhakaDate(Number(year) + 1, 0, 1) }
    }

    const attendance = await Attendance.find(filter).sort({ date: -1 })
    return NextResponse.json({ data: attendance })
  } catch (err) {
    console.error('[GET /api/employees/[id]/attendance]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/employees/[id]/attendance
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'hr.attendance.manage')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()

    if (!(await Employee.exists({ _id: params.id })))
      return NextResponse.json({ error: 'Employee not found' }, { status: 404 })
    if (session.user.role !== 'SUPER_ADMIN' && await isOwnEmployeeRecord(session, params.id))
      return NextResponse.json({ error: 'You cannot edit your own attendance' }, { status: 403 })

    const body   = await request.json()
    const parsed = attendanceSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    const { date, checkIn, checkOut, status, notes } = parsed.data

    const updateData = {
      checkIn:  checkIn  ? new Date(checkIn)  : null,
      checkOut: checkOut ? new Date(checkOut) : null,
      status,
      notes:    notes ?? null,
    }

    const record = await upsertAttendance(params.id, date, updateData)

    return NextResponse.json({ data: record }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/employees/[id]/attendance]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
