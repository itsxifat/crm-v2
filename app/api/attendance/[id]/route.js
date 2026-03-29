import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Attendance } from '@/models'
import { z } from 'zod'

const updateSchema = z.object({
  checkIn:  z.string().datetime().optional().nullable(),
  checkOut: z.string().datetime().optional().nullable(),
  status:   z.enum(['PRESENT', 'ABSENT', 'LATE', 'HALF_DAY', 'ON_LEAVE']).optional(),
  notes:    z.string().optional().nullable(),
})

// PUT /api/attendance/[id]
export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!['SUPER_ADMIN', 'MANAGER'].includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await connectDB()

    const body   = await request.json()
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success)
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })

    const update = {}
    if ('checkIn'  in parsed.data) update.checkIn  = parsed.data.checkIn  ? new Date(parsed.data.checkIn)  : null
    if ('checkOut' in parsed.data) update.checkOut = parsed.data.checkOut ? new Date(parsed.data.checkOut) : null
    if ('status'   in parsed.data) update.status   = parsed.data.status
    if ('notes'    in parsed.data) update.notes    = parsed.data.notes ?? null

    const record = await Attendance.findByIdAndUpdate(params.id, update, { new: true })
      .populate({ path: 'employeeId', populate: { path: 'userId', select: 'name avatar' } })

    if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({ data: record })
  } catch (err) {
    console.error('[PUT /api/attendance/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/attendance/[id]
export async function DELETE(_, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!['SUPER_ADMIN', 'MANAGER'].includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await connectDB()

    const record = await Attendance.findByIdAndDelete(params.id)
    if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/attendance/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
