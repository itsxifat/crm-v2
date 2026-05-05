export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { PricingCategory } from '@/models'

// PATCH /api/pricing-categories/[id] — SUPER_ADMIN or MANAGER
export async function PATCH(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    if (!['SUPER_ADMIN', 'MANAGER'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const { id } = await params
    const body = await request.json()

    const allowed = ['name', 'description', 'unit', 'defaultPrice', 'isActive']
    const update = {}
    for (const key of allowed) {
      if (key in body) update[key] = body[key]
    }

    if (update.name !== undefined && !update.name?.trim()) {
      return NextResponse.json({ error: 'Name cannot be empty' }, { status: 422 })
    }

    const category = await PricingCategory.findByIdAndUpdate(id, update, { new: true })
    if (!category) return NextResponse.json({ error: 'Category not found' }, { status: 404 })

    return NextResponse.json({ data: category })
  } catch (err) {
    console.error('[PATCH /api/pricing-categories/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/pricing-categories/[id] — soft delete, SUPER_ADMIN only
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    if (session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const { id } = await params
    const category = await PricingCategory.findByIdAndUpdate(id, { isActive: false }, { new: true })
    if (!category) return NextResponse.json({ error: 'Category not found' }, { status: 404 })

    return NextResponse.json({ data: category })
  } catch (err) {
    console.error('[DELETE /api/pricing-categories/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
