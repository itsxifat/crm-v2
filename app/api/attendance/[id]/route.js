export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Attendance } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { isOwnEmployeeRecord } from '@/lib/hrAccess'
import { z } from 'zod'

const EMP_POPULATE = {
  path: 'employeeId', select: 'employeeId designation department position userId',
  populate: { path: 'userId', select: 'name avatar' },
}

// Load the record and refuse edits to the caller's own attendance (Super Admin excepted).
async function loadEditable(session, id) {
  if (!isValidObjectId(id)) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  const existing = await Attendance.findById(id).select('employeeId').lean()
  if (!existing) return { error: NextResponse.json({ error: 'Not found' }, { status: 404 }) }
  if (session.user.role !== 'SUPER_ADMIN' && await isOwnEmployeeRecord(session, existing.employeeId))
    return { error: NextResponse.json({ error: 'You cannot edit your own attendance' }, { status: 403 }) }
  return { existing }
}

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
    const denied  = requirePerm(session, 'hr.attendance.manage')
    if (denied) return denied

    await connectDB()

    const { error } = await loadEditable(session, params.id)
    if (error) return error

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
      .populate(EMP_POPULATE)

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
    const denied  = requirePerm(session, 'hr.attendance.manage')
    if (denied) return denied

    await connectDB()

    const { error } = await loadEditable(session, params.id)
    if (error) return error

    const record = await Attendance.findByIdAndDelete(params.id)
    if (!record) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/attendance/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
