export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { requirePerm, requireManager, canDoAny } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { maskDoc, VENDOR_PII, restoreMaskedValues } from '@/lib/pii'
import connectDB from '@/lib/mongodb'
import { Vendor, VendorPayment, Purchase, Agreement, Document, ProjectExpense } from '@/models'
import { logActivity } from '@/lib/logActivity'
import { BIN_REGEX, TIN_REGEX, normalizeBin } from '@/lib/tax/catalog'
import { z } from 'zod'

// ── Tax identity (blank ⇒ null) ───────────────────────────────────────────────
const TAX_FIELDS = [
  'bin', 'tin', 'tradeLicense', 'vatRegistrationType', 'payeeType', 'hasPsr',
  'defaultTdsSection', 'defaultVatServiceCode',
]
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

const updateVendorSchema = z.object({
  company:     z.string().min(1).optional(),
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

// Readers: vendor managers + people who record purchase bills / pay vendor bills
// (they need the vendor's BIN, VAT status and payee defaults). Writes stay with
// hr.vendors.manage.
const VENDOR_READ_PERMS = ['hr.vendors.manage', 'inventory.purchase', 'finance.payments.confirm']

// GET /api/vendors/[id]
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canDoAny(session, VENDOR_READ_PERMS)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
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

    // Purchase clerks / payment confirmers only need the vendor's identity & tax
    // profile — agreements, documents and payment history stay with vendor managers.
    const full = canDoAny(session, ['hr.vendors.manage'])
    const body = full
      ? { ...vendor.toJSON(), purchases, payments, agreements, documents, totalPaid, totalPurchased }
      : { ...vendor.toJSON(), purchases: [], payments: [], agreements: [], documents: [], totalPaid: null, totalPurchased: null }
    return NextResponse.json({ data: maskDoc(session, body, VENDOR_PII) })
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

    // From/to diff of the tax identity (the e-TIN itself never goes to the log).
    const taxChanges = {}
    for (const k of TAX_FIELDS) {
      const v = parsed.data[k]
      if (v === undefined) continue
      const prev = existing[k] ?? null
      if (String(prev ?? '') !== String(v ?? '')) {
        taxChanges[k] = k === 'tin' ? (v ? 'updated' : 'cleared') : { from: prev, to: v }
      }
    }

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'UPDATE',
      entity:   'VENDOR',
      entityId: params.id,
      changes:  JSON.stringify({
        name: vendor?.company ?? null,
        ...(Object.keys(taxChanges).length ? { tax: taxChanges } : {}),
      }),
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
