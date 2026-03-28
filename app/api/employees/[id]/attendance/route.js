import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import Attendance from '@/models/Attendance'
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
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const { searchParams } = new URL(request.url)
    const month = searchParams.get('month')
    const year  = searchParams.get('year')

    const filter = { employeeId: params.id }
    if (month) {
      const [y, m] = month.split('-').map(Number)
      filter.date = { $gte: new Date(y, m - 1, 1), $lt: new Date(y, m, 1) }
    } else if (year) {
      filter.date = { $gte: new Date(Number(year), 0, 1), $lt: new Date(Number(year) + 1, 0, 1) }
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
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const allowedRoles = ['SUPER_ADMIN', 'MANAGER']
    if (!allowedRoles.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const body   = await request.json()
    const parsed = attendanceSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    const { date, checkIn, checkOut, status, notes } = parsed.data

    const dayStart = new Date(date); dayStart.setHours(0,0,0,0)
    const dayEnd   = new Date(date); dayEnd.setHours(23,59,59,999)

    const existing = await Attendance.findOne({
      employeeId: params.id,
      date: { $gte: dayStart, $lte: dayEnd },
    })

    const updateData = {
      checkIn:  checkIn  ? new Date(checkIn)  : null,
      checkOut: checkOut ? new Date(checkOut) : null,
      status,
      notes,
    }

    let record
    if (existing) {
      record = await Attendance.findByIdAndUpdate(existing._id, updateData, { new: true })
    } else {
      record = await new Attendance({ employeeId: params.id, date: new Date(date), ...updateData }).save()
    }

    return NextResponse.json({ data: record }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/employees/[id]/attendance]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
