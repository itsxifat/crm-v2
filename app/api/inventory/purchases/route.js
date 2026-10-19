export const dynamic = 'force-dynamic'
import mongoose from 'mongoose'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { PurchaseBill } from '@/models'
import { requirePerm, canDoAny } from '@/lib/rbac'
import { logActivity } from '@/lib/logActivity'
import { dhakaMonthStart } from '@/lib/dhakaTime'
import {
  buildBillDoc, listFilter, loadBillDetail, serializeBill, syncBillPayments,
} from './_lib/purchases'
import { errorResponse, readJson } from './_lib/http'

const VIEW_PERMS = ['inventory.view', 'inventory.purchase']

/** Counters for the list page header (optionally for one vendor). */
async function billSummary(vendorId) {
  // Bring pending payment requests up to date first (bounded).
  const requested = await PurchaseBill.find({ status: 'RECEIVED', 'payment.status': 'REQUESTED', ...(vendorId ? { vendorId } : {}) })
    .select('status payment').limit(500).lean()
  await syncBillPayments(requested)

  const match = vendorId ? { vendorId: new mongoose.Types.ObjectId(String(vendorId)) } : {}
  const monthStart = dhakaMonthStart(new Date())
  const isReceived = { $eq: ['$status', 'RECEIVED'] }
  const amount = (field) => ({ $convert: { input: `$${field}`, to: 'double', onError: 0, onNull: 0 } })
  const [row] = await PurchaseBill.aggregate([
    ...(vendorId ? [{ $match: match }] : []),
    {
      $group: {
        _id: null,
        drafts:          { $sum: { $cond: [{ $eq: ['$status', 'DRAFT'] }, 1, 0] } },
        draftAmount:     { $sum: { $cond: [{ $eq: ['$status', 'DRAFT'] }, amount('total'), 0] } },
        requested:       { $sum: { $cond: [{ $and: [isReceived, { $eq: ['$payment.status', 'REQUESTED'] }] }, 1, 0] } },
        requestedAmount: { $sum: { $cond: [{ $and: [isReceived, { $eq: ['$payment.status', 'REQUESTED'] }] }, amount('netPayable'), 0] } },
        unpaid:          { $sum: { $cond: [{ $and: [isReceived, { $eq: ['$payment.status', 'UNPAID'] }] }, 1, 0] } },
        unpaidAmount:    { $sum: { $cond: [{ $and: [isReceived, { $eq: ['$payment.status', 'UNPAID'] }] }, amount('netPayable'), 0] } },
        monthCount:      { $sum: { $cond: [{ $and: [isReceived, { $gte: ['$receivedAt', monthStart] }] }, 1, 0] } },
        monthAmount:     { $sum: { $cond: [{ $and: [isReceived, { $gte: ['$receivedAt', monthStart] }] }, amount('total'), 0] } },
      },
    },
  ])
  const r2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100
  return {
    drafts: row?.drafts ?? 0,
    draftAmount: r2(row?.draftAmount),
    requested: row?.requested ?? 0,
    requestedAmount: r2(row?.requestedAmount),
    unpaid: row?.unpaid ?? 0,
    unpaidAmount: r2(row?.unpaidAmount),
    monthCount: row?.monthCount ?? 0,
    monthAmount: r2(row?.monthAmount),
  }
}

// GET /api/inventory/purchases?vendorId=&status=DRAFT,RECEIVED&paymentStatus=&search=&startDate=&endDate=&page=&limit=&summary=1
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canDoAny(session, VIEW_PERMS)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await connectDB()
    const { searchParams } = new URL(request.url)
    const page  = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)
    const limit = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10) || 20))
    const filter = listFilter(searchParams)

    const [rows, total] = await Promise.all([
      PurchaseBill.find(filter).sort({ billDate: -1, createdAt: -1 }).skip((page - 1) * limit).limit(limit).lean(),
      PurchaseBill.countDocuments(filter),
    ])
    await syncBillPayments(rows)

    const body = {
      data: rows.map(serializeBill),
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
    }
    if (searchParams.get('summary') === '1') body.summary = await billSummary(filter.vendorId ?? null)
    return NextResponse.json(body)
  } catch (err) {
    return errorResponse(err, '[GET /api/inventory/purchases]')
  }
}

// POST /api/inventory/purchases — create a DRAFT purchase bill
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'inventory.purchase')
    if (denied) return denied

    await connectDB()
    const body = await readJson(request)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })

    const { doc } = await buildBillDoc(body)
    const bill = await new PurchaseBill({ ...doc, status: 'DRAFT', createdBy: session.user.id }).save()

    logActivity({
      userId: session.user.id,
      userRole: session.user.role,
      action: 'CREATE',
      entity: 'PURCHASE_BILL',
      entityId: bill._id.toString(),
      changes: JSON.stringify({
        billNo: bill.billNo, vendor: bill.vendorName, lines: bill.lines.length,
        total: bill.total, vatTotal: bill.vatTotal, netPayable: bill.netPayable,
      }),
      request,
    })

    return NextResponse.json({ data: await loadBillDetail(bill._id) }, { status: 201 })
  } catch (err) {
    return errorResponse(err, '[POST /api/inventory/purchases]')
  }
}
