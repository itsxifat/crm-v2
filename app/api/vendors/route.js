export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Vendor, VendorPayment, ProjectVendor } from '@/models'
import { z } from 'zod'

const createVendorSchema = z.object({
  company:     z.string().min(1),
  contactName: z.string().optional().nullable(),
  email:       z.string().email().optional().nullable(),
  phone:       z.string().optional().nullable(),
  serviceType: z.string().optional().nullable(),
  address:     z.string().optional().nullable(),
  website:     z.string().url().optional().nullable(),
  notes:       z.string().optional().nullable(),
})

// GET /api/vendors
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    const allowedRoles = ['SUPER_ADMIN', 'MANAGER']
    if (!allowedRoles.includes(session.user.role)) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()

    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search')
    const page   = parseInt(searchParams.get('page')  ?? '1',  10)
    const limit  = parseInt(searchParams.get('limit') ?? '20', 10)
    const skip   = (page - 1) * limit

    const filter = {}
    if (search) {
      filter.$or = [
        { company:     { $regex: search, $options: 'i' } },
        { contactName: { $regex: search, $options: 'i' } },
        { email:       { $regex: search, $options: 'i' } },
      ]
    }

    const [vendors, total] = await Promise.all([
      Vendor.find(filter).skip(skip).limit(limit).sort({ createdAt: -1 }),
      Vendor.countDocuments(filter),
    ])

    const vendorIds = vendors.map(v => v._id)
    const [projectCounts, payments] = await Promise.all([
      ProjectVendor.aggregate([
        { $match: { vendorId: { $in: vendorIds } } },
        { $group: { _id: '$vendorId', count: { $sum: 1 } } },
      ]),
      VendorPayment.find({ vendorId: { $in: vendorIds } }).select('vendorId amount status').lean(),
    ])

    const projectCountMap = Object.fromEntries(projectCounts.map(p => [p._id.toString(), p.count]))

    const enriched = vendors.map(v => ({
      ...v.toJSON(),
      projectVendorCount: projectCountMap[v._id.toString()] ?? 0,
      payments: payments.filter(p => p.vendorId.toString() === v._id.toString()),
    }))

    return NextResponse.json({
      data: enriched,
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    })
  } catch (err) {
    console.error('[GET /api/vendors]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/vendors
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
    const parsed = createVendorSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    const vendor = await new Vendor(parsed.data).save()
    return NextResponse.json({ data: vendor }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/vendors]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
