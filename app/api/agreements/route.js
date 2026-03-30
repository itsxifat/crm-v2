export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Agreement } from '@/models'
import { z } from 'zod'

const createSchema = z.object({
  title:        z.string().min(1),
  type:         z.string().min(1),
  content:      z.string().optional().nullable(),
  fileUrl:      z.string().optional().nullable(),
  status:       z.enum(['DRAFT','SENT','SIGNED','EXPIRED','CANCELLED']).default('DRAFT'),
  expiryDate:   z.string().optional().nullable(),
  clientId:     z.string().optional().nullable(),
  freelancerId: z.string().optional().nullable(),
  vendorId:     z.string().optional().nullable(),
  projectId:    z.string().optional().nullable(),
})

// GET /api/agreements
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const { searchParams } = new URL(request.url)
    const page   = parseInt(searchParams.get('page')  ?? '1',  10)
    const limit  = parseInt(searchParams.get('limit') ?? '20', 10)
    const status = searchParams.get('status')
    const skip   = (page - 1) * limit

    const filter = {}
    if (status) filter.status = status

    const [agreements, total] = await Promise.all([
      Agreement.find(filter)
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .populate({ path: 'clientId',     populate: { path: 'userId', select: 'name' } })
        .populate({ path: 'freelancerId', populate: { path: 'userId', select: 'name' } })
        .populate({ path: 'vendorId', select: 'id company' }),
      Agreement.countDocuments(filter),
    ])

    return NextResponse.json({
      data: agreements,
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  } catch (err) {
    console.error('[GET /api/agreements]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/agreements
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const allowedRoles = ['SUPER_ADMIN', 'MANAGER']
    if (!allowedRoles.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const body   = await request.json()
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    const { expiryDate, ...rest } = parsed.data
    const agreement = await new Agreement({
      ...rest,
      expiryDate: expiryDate ? new Date(expiryDate) : null,
      createdBy:  session.user.id,
    }).save()

    return NextResponse.json({ data: agreement }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/agreements]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
