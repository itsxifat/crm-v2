export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { User } from '@/models'
import bcrypt from 'bcryptjs'
import { z } from 'zod'
import { ciEquals, ciContains } from '@/lib/searchMatch'
import { canDo } from '@/lib/rbac'
import { maskList, USER_PII } from '@/lib/pii'

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
    const isAdmin    = adminRoles.includes(session.user.role)
    // Assignee lookup for staff who can create/assign tasks (e.g. the project
    // TaskModal): id + name only, limited to assignable roles.
    const isLookup   = !isAdmin && (canDo(session, 'tasks.assign') || canDo(session, 'tasks.create'))
    if (!isAdmin && !isLookup) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const { searchParams } = new URL(request.url)
    const role   = searchParams.get('role')
    const roles  = searchParams.get('roles')
    const search = searchParams.get('search')
    const page   = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)
    const limit  = Math.min(200, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10) || 20))
    const skip   = (page - 1) * limit

    const canSeeContact = canDo(session, 'pii.contact.view')

    const filter = {}
    let roleList = roles ? roles.split(',').map(r => r.trim()).filter(Boolean) : (role ? [role] : null)
    if (isLookup) {
      const assignable = ['EMPLOYEE', 'FREELANCER']
      roleList = roleList ? roleList.filter(r => assignable.includes(r)) : assignable
      filter.isActive = true
    }
    if (roleList) filter.role = { $in: roleList }
    if (search) {
      // Searching hidden contact fields would let callers rebuild masked values.
      filter.$or = canSeeContact && isAdmin
        ? [{ name: ciContains(search) }, { email: ciContains(search) }, { phone: ciContains(search) }]
        : [{ name: ciContains(search) }]
    }

    const [users, total] = await Promise.all([
      User.find(filter)
        .skip(skip)
        .limit(limit)
        .sort({ createdAt: -1 })
        .select(isLookup
          ? 'name avatar role'
          : '-password -loginOtp -loginOtpExpiry -activationToken -activationTokenExpiry -passwordResetToken -passwordResetExpiry'),
      User.countDocuments(filter),
    ])

    const data = maskList(session, users.map(u => u.toJSON()), USER_PII)

    return NextResponse.json({
      data,
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

    const existing = await User.findOne({ email: ciEquals(parsed.data.email) }).select('_id').lean()
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
