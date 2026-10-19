export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Vendor, VendorPayment, Purchase, ProjectExpense } from '@/models'
import { searchEncrypted } from '@/lib/searchMatch'
import { logActivity } from '@/lib/logActivity'
import { maskList, maskDoc, VENDOR_PII } from '@/lib/pii'
import { requirePerm, canDo, canDoAny } from '@/lib/rbac'
import { BIN_REGEX, TIN_REGEX, normalizeBin } from '@/lib/tax/catalog'
import { z } from 'zod'

// ── Tax identity (blank ⇒ null) ───────────────────────────────────────────────
const blankToNull = v => (typeof v === 'string' ? (v.trim() === '' ? null : v.trim()) : v)
const blankToUndefined = v => (v === null || (typeof v === 'string' && v.trim() === '') ? undefined : v)
const binField = z.preprocess(
  v => (typeof v === 'string' ? (v.replace(/\s+/g, '') || null) : v),
  z.string().regex(BIN_REGEX, 'BIN must be 9 or 13 digits, e.g. 000123456-0101')
    .transform(s => normalizeBin(s) || s).nullable().optional(),
)
const tinField = z.preprocess(
  v => (typeof v === 'string' ? (v.replace(/[\s-]+/g, '') || null) : v),
  z.string().regex(TIN_REGEX, 'TIN must be the 12-digit e-TIN').nullable().optional(),
)
const optCode = z.preprocess(blankToNull, z.string().max(40).nullable().optional())

const createVendorSchema = z.object({
  company:     z.string().min(1),
  contactName: z.string().optional().nullable(),
  email:       z.string().email().optional().nullable(),
  phone:       z.string().optional().nullable(),
  serviceType: z.string().optional().nullable(),
  address:     z.string().optional().nullable(),
  website:     z.string().url().optional().nullable(),
  notes:       z.string().optional().nullable(),
  // Tax identity & withholding defaults
  bin:                   binField,
  tin:                   tinField,
  tradeLicense:          z.preprocess(blankToNull, z.string().max(100).nullable().optional()),
  vatRegistrationType:   z.preprocess(blankToNull, z.enum(['REGISTERED', 'TURNOVER', 'UNREGISTERED', 'FOREIGN']).nullable().optional()),
  payeeType:             z.preprocess(blankToUndefined, z.enum(['COMPANY', 'INDIVIDUAL', 'NON_RESIDENT']).optional()),
  hasPsr:                z.boolean().optional(),
  defaultTdsSection:     optCode,
  defaultVatServiceCode: optCode,
})

// Vendor master data is read by vendor managers and by the people who record
// purchase bills or pay vendor bills (they need BIN / VAT status / payee type
// to compute VAT credit, VDS and TDS). Writes stay with hr.vendors.manage.
const VENDOR_READ_PERMS = ['hr.vendors.manage', 'inventory.purchase', 'finance.payments.confirm']

function requireVendorRead(session) {
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!canDoAny(session, VENDOR_READ_PERMS)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return null
}

// GET /api/vendors
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireVendorRead(session)
    if (denied) return denied

    await connectDB()

    const { searchParams } = new URL(request.url)
    const search = searchParams.get('search')
    const page   = parseInt(searchParams.get('page')  ?? '1',  10)
    const limit  = parseInt(searchParams.get('limit') ?? '20', 10)
    const skip   = (page - 1) * limit

    let vendors, total
    if (search) {
      // contactName/email are masked without pii.contact.view — don't let search reveal them.
      ;({ docs: vendors, total } = await searchEncrypted(Vendor, {
        baseFilter: {}, search,
        // BIN is a public business identifier; the e-TIN is identity PII.
        fields: [
          ...(canDo(session, 'pii.contact.view') ? ['company', 'contactName', 'email'] : ['company']),
          'bin',
          ...(canDo(session, 'pii.identity.view') ? ['tin'] : []),
        ],
        page, limit, sort: { createdAt: -1 },
      }))
    } else {
      ;[vendors, total] = await Promise.all([
        Vendor.find({}).skip(skip).limit(limit).sort({ createdAt: -1 }),
        Vendor.countDocuments({}),
      ])
    }

    // Purchase clerks / payment confirmers get the vendor's identity & tax profile
    // only — payment history and purchase totals stay with vendor managers (same
    // rule as GET /api/vendors/[id]), so those queries are not even run for them.
    if (!canDo(session, 'hr.vendors.manage')) {
      const lite = vendors.map(v => ({
        ...v.toJSON(),
        purchaseCount: null, totalPurchaseAmount: null, receivedAmount: null, payments: [],
      }))
      return NextResponse.json({
        data: maskList(session, lite, VENDOR_PII),
        meta: { page, limit, total, pages: Math.ceil(total / limit) },
      })
    }

    const vendorIds = vendors.map(v => v._id)
    const [purchaseCounts, purchaseTotals, payments, expensePayments] = await Promise.all([
      // Count every purchase, but only non-cancelled ones towards the total
      // (matches the vendor detail's totalPurchased).
      Purchase.aggregate([
        { $match: { vendorId: { $in: vendorIds } } },
        { $group: {
          _id:   '$vendorId',
          count: { $sum: 1 },
          total: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 0, '$totalAmount'] } },
        } },
      ]),
      Purchase.aggregate([
        { $match: { vendorId: { $in: vendorIds }, status: 'received' } },
        { $group: { _id: '$vendorId', total: { $sum: '$totalAmount' } } },
      ]),
      VendorPayment.find({ vendorId: { $in: vendorIds } }).select('vendorId amount status').lean(),
      // Vendors are actually paid through the expense pipeline.
      ProjectExpense.find({ vendorId: { $in: vendorIds }, status: { $in: ['PAID', 'AUTHORIZED'] } })
        .select('vendorId amount amountBDT').lean(),
    ])
    const allPayments = [
      ...payments,
      ...expensePayments.map(e => ({ _id: e._id, vendorId: e.vendorId, amount: e.amountBDT ?? e.amount ?? 0, status: 'paid' })),
    ]

    const purchaseCountMap = Object.fromEntries(purchaseCounts.map(p => [p._id.toString(), p]))
    const purchaseTotalMap = Object.fromEntries(purchaseTotals.map(p => [p._id.toString(), p.total]))

    const enriched = vendors.map(v => {
      const pInfo = purchaseCountMap[v._id.toString()]
      return {
        ...v.toJSON(),
        purchaseCount:       pInfo?.count ?? 0,
        totalPurchaseAmount: pInfo?.total ?? 0,
        receivedAmount:      purchaseTotalMap[v._id.toString()] ?? 0,
        payments: allPayments.filter(p => p.vendorId.toString() === v._id.toString()),
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
    const denied = requirePerm(session, 'hr.vendors.manage')
    if (denied) return denied

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
      changes:  JSON.stringify({
        name: vendor.company ?? null,
        bin: vendor.bin ?? null, tin: vendor.tin ? 'set' : null,
        vatRegistrationType: vendor.vatRegistrationType ?? null,
        payeeType: vendor.payeeType ?? null, hasPsr: vendor.hasPsr ?? null,
      }),
      request,
    })

    return NextResponse.json({ data: maskDoc(session, vendor.toJSON(), VENDOR_PII) }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/vendors]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
