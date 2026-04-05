export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Vendor, VendorPayment, Purchase, Agreement, Document } from '@/models'
import { z } from 'zod'

const updateVendorSchema = z.object({
  company:     z.string().min(1).optional(),
  contactName: z.string().optional().nullable(),
  email:       z.string().email().optional().nullable(),
  phone:       z.string().optional().nullable(),
  serviceType: z.string().optional().nullable(),
  address:     z.string().optional().nullable(),
  website:     z.string().url().optional().nullable(),
  notes:       z.string().optional().nullable(),
})

// GET /api/vendors/[id]
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    await connectDB()

    const vendor = await Vendor.findById(params.id)
    if (!vendor) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })

    const [purchases, payments, agreements, documents] = await Promise.all([
      Purchase.find({ vendorId: params.id }).sort({ date: -1 }),
      VendorPayment.find({ vendorId: params.id }).sort({ date: -1 }),
      Agreement.find({ vendorId: params.id }).sort({ createdAt: -1 }),
      Document.find({ vendorId: params.id }).sort({ createdAt: -1 }),
    ])

    const totalPaid = payments.filter(p => p.status === 'paid').reduce((sum, p) => sum + p.amount, 0)
    const totalPurchased = purchases.filter(p => p.status !== 'cancelled').reduce((sum, p) => sum + p.totalAmount, 0)

    return NextResponse.json({
      data: { ...vendor.toJSON(), purchases, payments, agreements, documents, totalPaid, totalPurchased },
    })
  } catch (err) {
    console.error('[GET /api/vendors/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// PUT /api/vendors/[id]
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
    const parsed = updateVendorSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    const vendor = await Vendor.findByIdAndUpdate(params.id, parsed.data, { new: true })
    return NextResponse.json({ data: vendor })
  } catch (err) {
    console.error('[PUT /api/vendors/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/vendors/[id]
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })

    if (session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()
    await Vendor.findByIdAndDelete(params.id)
    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/vendors/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
