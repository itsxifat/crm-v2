export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Purchase, Vendor } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { z } from 'zod'

const schema = z.object({
  vendorId:    z.string().min(1),
  item:        z.string().min(1),
  description: z.string().optional().nullable(),
  quantity:    z.number().min(0).optional(),
  unitPrice:   z.number().min(0),
  totalAmount: z.number().min(0),
  date:        z.string().min(1),
  category:    z.string().optional().nullable(),
  status:      z.enum(['pending', 'received', 'cancelled']).optional(),
  invoiceRef:  z.string().optional().nullable(),
  notes:       z.string().optional().nullable(),
})

// GET /api/purchases?vendorId=…&page=1&limit=20
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'hr.vendors.manage')
    if (denied) return denied

    await connectDB()

    const { searchParams } = new URL(request.url)
    const vendorId = searchParams.get('vendorId')
    const page     = parseInt(searchParams.get('page')  ?? '1',  10)
    const limit    = parseInt(searchParams.get('limit') ?? '50', 10)
    const skip     = (page - 1) * limit

    if (vendorId && !isValidObjectId(vendorId)) return NextResponse.json({ error: 'Invalid vendor id' }, { status: 400 })
    const filter = vendorId ? { vendorId } : {}

    const [purchases, total] = await Promise.all([
      Purchase.find(filter).sort({ date: -1 }).skip(skip).limit(limit).lean(),
      Purchase.countDocuments(filter),
    ])

    return NextResponse.json({
      data: purchases.map(p => ({ ...p, id: p._id.toString() })),
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  } catch (err) {
    console.error('[GET /api/purchases]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/purchases
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'hr.vendors.manage')
    if (denied) return denied

    await connectDB()

    const body   = await request.json()
    const parsed = schema.safeParse(body)
    if (!parsed.success)
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })

    if (!isValidObjectId(parsed.data.vendorId) || !(await Vendor.exists({ _id: parsed.data.vendorId })))
      return NextResponse.json({ error: 'Vendor not found' }, { status: 422 })

    const purchase = await new Purchase({ ...parsed.data, date: new Date(parsed.data.date) }).save()
    return NextResponse.json({ data: purchase }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/purchases]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
