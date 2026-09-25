export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Freelancer } from '@/models'
import { requirePerm } from '@/lib/rbac'

// GET /api/freelancers/[id]/pricing — staff with hr.freelancers.manage
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    // Internal rate cards: staff with freelancer-management permission only
    // (requirePerm rejects CLIENT / FREELANCER / VENDOR).
    const denied = requirePerm(session, 'hr.freelancers.manage')
    if (denied) return denied

    await connectDB()

    const { id } = await params
    const freelancer = await Freelancer.findById(id)
      .populate({ path: 'pricing.categoryId', select: 'id name unit defaultPrice description' })
      .select('pricing')
      .lean()

    if (!freelancer) return NextResponse.json({ error: 'Freelancer not found' }, { status: 404 })

    return NextResponse.json({ data: freelancer.pricing ?? [] })
  } catch (err) {
    console.error('[GET /api/freelancers/[id]/pricing]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PATCH /api/freelancers/[id]/pricing — SUPER_ADMIN or MANAGER
export async function PATCH(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    if (!['SUPER_ADMIN', 'MANAGER'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const { id } = await params
    const { pricing } = await request.json()

    if (!Array.isArray(pricing)) {
      return NextResponse.json({ error: 'pricing must be an array' }, { status: 422 })
    }

    const sanitized = pricing.map(p => ({
      categoryId: p.categoryId,
      price:      p.price  ?? null,
      note:       p.note   ?? null,
    }))

    const freelancer = await Freelancer.findByIdAndUpdate(
      id,
      { pricing: sanitized },
      { new: true }
    ).populate({ path: 'pricing.categoryId', select: 'id name unit defaultPrice description' })

    if (!freelancer) return NextResponse.json({ error: 'Freelancer not found' }, { status: 404 })

    return NextResponse.json({ data: freelancer.pricing })
  } catch (err) {
    console.error('[PATCH /api/freelancers/[id]/pricing]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
