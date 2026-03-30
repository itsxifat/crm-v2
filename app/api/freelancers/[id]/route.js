export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { User, Freelancer, Task, Timesheet, WithdrawalRequest, Earning, Agreement, Document } from '@/models'
import { z } from 'zod'

const updateSchema = z.object({
  name:        z.string().min(1).optional(),
  phone:       z.string().optional().nullable(),
  skills:      z.string().optional().nullable(),
  bio:         z.string().optional().nullable(),
  hourlyRate:  z.number().positive().optional().nullable(),
  rateType:    z.string().optional().nullable(),
  paypalEmail: z.string().email().optional().nullable(),
  bkashNumber: z.string().optional().nullable(),
  bankDetails: z.string().optional().nullable(),
  isActive:    z.boolean().optional(),
})

// GET /api/freelancers/[id]
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const freelancer = await Freelancer.findById(params.id)
      .populate({ path: 'userId', select: 'id name email avatar phone isActive createdAt' })

    if (!freelancer) return NextResponse.json({ error: 'Freelancer not found' }, { status: 404 })

    const [tasks, timesheets, withdrawals, agreements, documents, earnings] = await Promise.all([
      Task.find({ assignedFreelancerId: params.id }).sort({ createdAt: -1 })
        .populate({ path: 'projectId', select: 'id name' }),
      Timesheet.find({ freelancerId: params.id }).sort({ date: -1 }).limit(50)
        .populate({ path: 'taskId', select: 'id title', populate: { path: 'projectId', select: 'name' } }),
      WithdrawalRequest.find({ freelancerId: params.id }).sort({ createdAt: -1 }),
      Agreement.find({ freelancerId: params.id }).sort({ createdAt: -1 }),
      Document.find({ freelancerId: params.id }).sort({ createdAt: -1 }),
      Earning.find({ freelancerId: params.id }).sort({ createdAt: -1 }),
    ])

    return NextResponse.json({
      data: { ...freelancer.toJSON(), tasks, timesheets, withdrawals, agreements, documents, earnings },
    })
  } catch (err) {
    console.error('[GET /api/freelancers/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/freelancers/[id]
export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const allowedRoles = ['SUPER_ADMIN', 'MANAGER']
    if (!allowedRoles.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const body   = await request.json()
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    const { name, phone, isActive, ...freelancerData } = parsed.data

    const freelancer = await Freelancer.findById(params.id).lean()
    if (!freelancer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await Promise.all([
      Freelancer.findByIdAndUpdate(params.id, freelancerData),
      User.findByIdAndUpdate(freelancer.userId, {
        ...(name     && { name }),
        ...(phone    !== undefined && { phone }),
        ...(isActive !== undefined && { isActive }),
      }),
    ])

    const updated = await Freelancer.findById(params.id)
      .populate({ path: 'userId', select: 'id name email avatar' })

    return NextResponse.json({ data: updated })
  } catch (err) {
    console.error('[PUT /api/freelancers/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/freelancers/[id]
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    if (session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const freelancer = await Freelancer.findById(params.id).lean()
    if (!freelancer) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await User.findByIdAndDelete(freelancer.userId)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/freelancers/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
