export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { User } from '@/models'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { blindIndex } from '@/lib/encryption'

const createUserSchema = z.object({
  email:    z.string().email(),
  password: z.string().min(8, 'Password must be at least 8 characters'),
  name:     z.string().min(1),
  role:     z.enum(['SUPER_ADMIN','MANAGER','EMPLOYEE','FREELANCER','CLIENT','VENDOR']),
  phone:    z.string().optional().nullable(),
})

// GET /api/users
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const adminRoles = ['SUPER_ADMIN', 'MANAGER']
    if (!adminRoles.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const { searchParams } = new URL(request.url)
    const role   = searchParams.get('role')
    const roles  = searchParams.get('roles')
    const search = searchParams.get('search')
    const page   = parseInt(searchParams.get('page')  ?? '1',  10)
    const limit  = parseInt(searchParams.get('limit') ?? '20', 10)
    const skip   = (page - 1) * limit

    const filter = {}
    if (roles) filter.role = { $in: roles.split(',').map(r => r.trim()) }
    else if (role) filter.role = role
    if (search) {
      filter.$or = [
        { name:  { $regex: search, $options: 'i' } },
        { email: { $regex: search, $options: 'i' } },
      ]
    }

    const [users, total] = await Promise.all([
      User.find(filter)
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .select('-password'),
      User.countDocuments(filter),
    ])

    return NextResponse.json({
      data: users,
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  } catch (err) {
    console.error('[GET /api/users]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/users
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    if (session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Forbidden – Super Admin only' }, { status: 403 })
    }

    await connectDB()

    const body   = await request.json()
    const parsed = createUserSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    // Email is encrypted; use the blind index for the duplicate check.
    const emailToken = blindIndex(parsed.data.email, 'users', 'email')
    const existing = await User.findOne({ emailIdx: emailToken }).select('_id').lean()
    if (existing) {
      return NextResponse.json({ error: 'Email already in use' }, { status: 409 })
    }

    const hashedPassword = await bcrypt.hash(parsed.data.password, 12)
    const user = await new User({ ...parsed.data, password: hashedPassword }).save()

    return NextResponse.json({ data: user }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/users]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
