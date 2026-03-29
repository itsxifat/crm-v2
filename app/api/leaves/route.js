export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Leave } from '@/models'
import { z } from 'zod'

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
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!['SUPER_ADMIN', 'MANAGER'].includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await connectDB()

    const { searchParams } = new URL(request.url)
    const status     = searchParams.get('status')
    const employeeId = searchParams.get('employeeId')
    const type       = searchParams.get('type')

    const filter = {}
    if (status)     filter.status     = status
    if (employeeId) filter.employeeId = employeeId
    if (type)       filter.type       = type

    const leaves = await Leave.find(filter)
      .sort({ createdAt: -1 })
      .populate({ path: 'employeeId', populate: { path: 'userId', select: 'name avatar' } })
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
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!['SUPER_ADMIN', 'MANAGER'].includes(session.user.role))
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await connectDB()

    const body   = await request.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success)
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })

    const { employeeId, type, startDate, endDate, reason } = parsed.data

    const leave = await Leave.create({
      employeeId,
      type,
      startDate: new Date(startDate),
      endDate:   new Date(endDate),
      reason:    reason ?? null,
      status:    'PENDING',
    })

    await leave.populate({ path: 'employeeId', populate: { path: 'userId', select: 'name avatar' } })

    return NextResponse.json({ data: leave }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/leaves]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
