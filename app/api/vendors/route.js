export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Vendor, VendorPayment, Purchase } from '@/models'
import { searchEncrypted } from '@/lib/searchMatch'
import { logActivity } from '@/lib/logActivity'
import { maskList, VENDOR_PII } from '@/lib/pii'
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

    // company/contactName/email are encrypted → DB regex can't match; filter in JS
    let vendors, total
    if (search) {
      ;({ docs: vendors, total } = await searchEncrypted(Vendor, {
        baseFilter: {}, search, fields: ['company', 'contactName', 'email'],
        page, limit, sort: { createdAt: -1 },
      }))
    } else {
      ;[vendors, total] = await Promise.all([
        Vendor.find({}).skip(skip).limit(limit).sort({ createdAt: -1 }),
        Vendor.countDocuments({}),
      ])
    }

    const vendorIds = vendors.map(v => v._id)
    const [purchaseCounts, purchaseTotals, payments] = await Promise.all([
      Purchase.aggregate([
        { $match: { vendorId: { $in: vendorIds } } },
        { $group: { _id: '$vendorId', count: { $sum: 1 }, total: { $sum: '$totalAmount' } } },
      ]),
      Purchase.aggregate([
        { $match: { vendorId: { $in: vendorIds }, status: 'received' } },
        { $group: { _id: '$vendorId', total: { $sum: '$totalAmount' } } },
      ]),
      VendorPayment.find({ vendorId: { $in: vendorIds } }).select('vendorId amount status').lean(),
    ])

    const purchaseCountMap = Object.fromEntries(purchaseCounts.map(p => [p._id.toString(), p]))
    const purchaseTotalMap = Object.fromEntries(purchaseTotals.map(p => [p._id.toString(), p.total]))

    const enriched = vendors.map(v => {
      const pInfo = purchaseCountMap[v._id.toString()]
      return {
        ...v.toJSON(),
        purchaseCount:       pInfo?.count ?? 0,
        totalPurchaseAmount: pInfo?.total ?? 0,
        receivedAmount:      purchaseTotalMap[v._id.toString()] ?? 0,
        payments: payments.filter(p => p.vendorId.toString() === v._id.toString()),
      }
    })

    return NextResponse.json({
      data: maskList(session, enriched, VENDOR_PII),
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

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'CREATE',
      entity:   'VENDOR',
      entityId: vendor._id.toString(),
      changes:  JSON.stringify({ name: vendor.name ?? vendor.companyName ?? null }),
      request,
    })

    return NextResponse.json({ data: vendor }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/vendors]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
