export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Attendance, Employee } from '@/models'
import { z } from 'zod'

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
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!['SUPER_ADMIN', 'MANAGER'].includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await connectDB()

    const { searchParams } = new URL(request.url)
    const month      = searchParams.get('month')       // YYYY-MM
    const employeeId = searchParams.get('employeeId')
    const status     = searchParams.get('status')

    const filter = {}
    if (employeeId) filter.employeeId = employeeId
    if (status)     filter.status     = status
    if (month) {
      const [y, m]  = month.split('-').map(Number)
      filter.date   = { $gte: new Date(y, m - 1, 1), $lt: new Date(y, m, 1) }
    }

    const records = await Attendance.find(filter)
      .sort({ date: -1, createdAt: -1 })
      .populate({ path: 'employeeId', populate: { path: 'userId', select: 'name avatar' } })
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
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!['SUPER_ADMIN', 'MANAGER'].includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await connectDB()

    const body   = await request.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success)
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })

    const { employeeId, date, checkIn, checkOut, status, notes } = parsed.data

    const dayStart = new Date(date); dayStart.setHours(0, 0, 0, 0)
    const dayEnd   = new Date(date); dayEnd.setHours(23, 59, 59, 999)

    const updateData = {
      checkIn:  checkIn  ? new Date(checkIn)  : null,
      checkOut: checkOut ? new Date(checkOut) : null,
      status,
      notes: notes ?? null,
    }

    const existing = await Attendance.findOne({ employeeId, date: { $gte: dayStart, $lte: dayEnd } })
    let record
    if (existing) {
      record = await Attendance.findByIdAndUpdate(existing._id, updateData, { new: true })
    } else {
      record = await Attendance.create({ employeeId, date: new Date(date), ...updateData })
    }

    await record.populate({ path: 'employeeId', populate: { path: 'userId', select: 'name avatar' } })

    return NextResponse.json({ data: record }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/attendance]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
