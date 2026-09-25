export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { requirePerm, requireManager } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { maskDoc, VENDOR_PII, restoreMaskedValues } from '@/lib/pii'
import connectDB from '@/lib/mongodb'
import { Vendor, VendorPayment, Purchase, Agreement, Document, ProjectExpense } from '@/models'
import { logActivity } from '@/lib/logActivity'
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
    const denied = requirePerm(session, 'hr.vendors.manage')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })

    await connectDB()

    const vendor = await Vendor.findById(params.id)
    if (!vendor) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })

    const [purchases, legacyPayments, vendorExpenses, agreements, documents] = await Promise.all([
      Purchase.find({ vendorId: params.id }).sort({ date: -1 }),
      VendorPayment.find({ vendorId: params.id }).sort({ date: -1 }),
      // Vendors are actually paid through the expense pipeline (PAID/AUTHORIZED).
      ProjectExpense.find({ vendorId: params.id, status: { $in: ['PAID', 'AUTHORIZED'] } })
        .select('title amount amountBDT date paidAt expenseInvoiceNo expenseId paymentTxnId').lean(),
      Agreement.find({ vendorId: params.id }).sort({ createdAt: -1 }),
      Document.find({ vendorId: params.id }).sort({ createdAt: -1 }),
    ])

    const payments = [
      ...legacyPayments.map(p => p.toJSON()),
      ...vendorExpenses.map(e => ({
        id:          e._id.toString(),
        amount:      e.amountBDT ?? e.amount ?? 0,
        date:        e.paidAt ?? e.date,
        description: [e.expenseInvoiceNo ?? e.expenseId, e.title].filter(Boolean).join(' · '),
        reference:   e.paymentTxnId ?? null,
        status:      'paid',
      })),
    ].sort((a, b) => new Date(b.date) - new Date(a.date))

    const totalPaid = payments.filter(p => p.status === 'paid').reduce((sum, p) => sum + p.amount, 0)
    const totalPurchased = purchases.filter(p => p.status !== 'cancelled').reduce((sum, p) => sum + p.totalAmount, 0)

    return NextResponse.json({
      data: maskDoc(session, { ...vendor.toJSON(), purchases, payments, agreements, documents, totalPaid, totalPurchased }, VENDOR_PII),
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
    const denied = requirePerm(session, 'hr.vendors.manage')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })

    await connectDB()

    const existing = await Vendor.findById(params.id).lean()
    if (!existing) return NextResponse.json({ error: 'Vendor not found' }, { status: 404 })

    // Never write masked PII placeholders (e.g. 'j•••@g••.com') back over real data.
    const body   = restoreMaskedValues(await request.json(), existing)
    const parsed = updateVendorSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }

    const vendor = await Vendor.findByIdAndUpdate(params.id, parsed.data, { new: true })

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'UPDATE',
      entity:   'VENDOR',
      entityId: params.id,
      changes:  JSON.stringify({ name: vendor?.company ?? null }),
      request,
    })

    return NextResponse.json({ data: vendor ? maskDoc(session, vendor.toJSON(), VENDOR_PII) : null })
  } catch (err) {
    console.error('[PUT /api/vendors/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// DELETE /api/vendors/[id]
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireManager(session)
    if (denied) return denied

    if (session.user.role !== 'SUPER_ADMIN') {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }

    await connectDB()
    const deleted = await Vendor.findByIdAndDelete(params.id)

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'DELETE',
      entity:   'VENDOR',
      entityId: params.id,
      changes:  deleted ? JSON.stringify({ name: deleted.company ?? null }) : null,
      request,
    })

    return NextResponse.json({ success: true })
  } catch (err) {
    console.error('[DELETE /api/vendors/[id]]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
