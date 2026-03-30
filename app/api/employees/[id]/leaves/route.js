export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import Leave from '@/models/Leave'
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
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const { searchParams } = new URL(request.url)
    const status = searchParams.get('status')

    const filter = { employeeId: params.id }
    if (status) filter.status = status

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
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const body   = await request.json()
    const parsed = leaveSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    const { type, startDate, endDate, reason } = parsed.data
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
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const allowedRoles = ['SUPER_ADMIN', 'MANAGER']
    if (!allowedRoles.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const body    = await request.json()
    const leaveId = body.leaveId
    if (!leaveId) return NextResponse.json({ error: 'leaveId is required' }, { status: 400 })

    const parsed = approveSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    const leave = await Leave.findByIdAndUpdate(
      leaveId,
      { status: parsed.data.status, approvedBy: session.user.id, approvedAt: new Date() },
      { new: true }
    )

    return NextResponse.json({ data: leave })
  } catch (err) {
    console.error('[PATCH /api/employees/[id]/leaves]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
