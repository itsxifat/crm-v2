export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { PricingCategory } from '@/models'

// GET /api/pricing-categories — any authenticated user
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const categories = await PricingCategory.find({ isActive: true }).sort({ name: 1 })
    return NextResponse.json({ data: categories })
  } catch (err) {
    console.error('[GET /api/pricing-categories]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/pricing-categories — SUPER_ADMIN or MANAGER
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    if (!['SUPER_ADMIN', 'MANAGER'].includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const { name, description, unit, defaultPrice } = await request.json()

    if (!name || !name.trim()) {
      return NextResponse.json({ error: 'Name is required' }, { status: 422 })
    }

    const category = await new PricingCategory({
      name: name.trim(),
      description: description ?? null,
      unit: unit ?? null,
      defaultPrice: defaultPrice ?? null,
    }).save()

    return NextResponse.json({ data: category }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/pricing-categories]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
