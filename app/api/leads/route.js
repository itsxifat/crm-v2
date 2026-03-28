import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Lead, Employee } from '@/models'
import { z } from 'zod'

const createLeadSchema = z.object({
  name:         z.string().min(1, 'Name is required'),
  email:        z.string().email().optional().nullable(),
  phone:        z.string().optional().nullable(),
  company:      z.string().optional().nullable(),
  industry:     z.string().optional().nullable(),
  source:       z.string().optional().nullable(),
  status:       z.enum(['NEW','CONTACTED','PROPOSAL_SENT','NEGOTIATION','WON','LOST']).default('NEW'),
  value:        z.number().positive().optional().nullable(),
  notes:        z.string().optional().nullable(),
  assignedToId: z.string().optional().nullable(),
  followUpDate: z.string().datetime().optional().nullable(),
})

// GET /api/leads
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const { searchParams } = new URL(request.url)
    const page   = parseInt(searchParams.get('page')  ?? '1',  10)
    const limit  = parseInt(searchParams.get('limit') ?? '20', 10)
    const status = searchParams.get('status')
    const search = searchParams.get('search')
    const skip   = (page - 1) * limit

    const filter = {}
    if (status) filter.status = status
    if (search) {
      filter.$or = [
        { name:    { $regex: search, $options: 'i' } },
        { email:   { $regex: search, $options: 'i' } },
        { company: { $regex: search, $options: 'i' } },
      ]
    }

    // Employees only see leads assigned to them
    if (session.user.role === 'EMPLOYEE') {
      const employee = await Employee.findOne({ userId: session.user.id }).lean()
      if (employee) filter.assignedToId = employee._id
    }

    const [leads, total] = await Promise.all([
      Lead.find(filter)
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .populate({ path: 'assignedToId', populate: { path: 'userId', select: 'name avatar' } }),
      Lead.countDocuments(filter),
    ])

    return NextResponse.json({
      data: leads,
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  } catch (err) {
    console.error('[GET /api/leads]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/leads
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const allowedRoles = ['SUPER_ADMIN', 'MANAGER', 'EMPLOYEE']
    if (!allowedRoles.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const body   = await request.json()
    const parsed = createLeadSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    const data = { ...parsed.data }
    if (data.followUpDate) data.followUpDate = new Date(data.followUpDate)

    const lead = await new Lead(data).save()
    return NextResponse.json({ data: lead }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/leads]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
