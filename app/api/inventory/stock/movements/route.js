export const dynamic = 'force-dynamic'
import mongoose from 'mongoose'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { StockMovement } from '@/models'
import { canDoAny } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { parseDhakaDay, dhakaDayKey } from '@/lib/dhakaTime'
import { STOCK_MOVEMENT_TYPES, STOCK_MOVEMENT_META } from '@/lib/inventory/constants'
import { codeContains } from '@/lib/codes'
import { serializeMovement, MOVEMENT_POPULATE, csvResponse, escapeRegex, todayKey } from '../_lib/stock'
import { errorResponse } from '../../purchases/_lib/http'

const VIEW_PERMS = ['inventory.view', 'inventory.manage', 'inventory.assign']
const ID_FILTERS = ['stockItemId', 'employeeId', 'departmentId', 'projectId', 'purchaseBillId']

// GET /api/inventory/stock/movements?stockItemId=&type=ISSUE,RETURN&direction=IN|OUT&employeeId=&departmentId=
//     &projectId=&purchaseBillId=&search=&start=YYYY-MM-DD&end=YYYY-MM-DD&page=&limit=&format=csv
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canDoAny(session, VIEW_PERMS)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await connectDB()
    const { searchParams } = new URL(request.url)
    const csv = searchParams.get('format') === 'csv'
    const page = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)
    const limit = csv ? 20000 : Math.min(200, Math.max(1, parseInt(searchParams.get('limit') ?? '50', 10) || 50))

    const filter = {}
    for (const key of ID_FILTERS) {
      const v = searchParams.get(key)
      if (!v) continue
      if (!isValidObjectId(v)) return NextResponse.json({ error: `Invalid ${key}` }, { status: 400 })
      filter[key] = new mongoose.Types.ObjectId(v)
    }
    const types = (searchParams.get('type') ?? '').split(',').map(s => s.trim().toUpperCase()).filter(t => STOCK_MOVEMENT_TYPES.includes(t))
    if (types.length) filter.type = types.length === 1 ? types[0] : { $in: types }
    const direction = (searchParams.get('direction') ?? '').toUpperCase()
    if (['IN', 'OUT'].includes(direction)) filter.direction = direction
    const search = (searchParams.get('search') ?? '').trim()
    if (search) {
      const re = { $regex: escapeRegex(search.slice(0, 100)), $options: 'i' }
      // Movement numbers and references (bill / project / asset numbers) match with
      // separators ignored: SM-2610-00001 = SM261000001.
      const code = codeContains(search.slice(0, 100))
      filter.$or = [...(code ? [{ movementNo: code }, { reference: code }] : [{ reference: re }]), { reason: re }]
    }
    const start = parseDhakaDay(searchParams.get('start') ?? searchParams.get('startDate') ?? '')
    const end = parseDhakaDay(searchParams.get('end') ?? searchParams.get('endDate') ?? '')
    if (start || end) {
      filter.date = {}
      if (start) filter.date.$gte = start.start
      if (end) filter.date.$lt = end.next
    }

    const [rows, total, totals] = await Promise.all([
      StockMovement.find(filter).sort({ date: -1, createdAt: -1 }).skip(csv ? 0 : (page - 1) * limit).limit(limit)
        .populate(MOVEMENT_POPULATE).lean(),
      StockMovement.countDocuments(filter),
      StockMovement.aggregate([
        { $match: filter },
        { $group: { _id: '$direction', value: { $sum: '$totalCost' }, qty: { $sum: '$qty' }, count: { $sum: 1 } } },
      ]),
    ])
    const data = rows.map(serializeMovement)

    if (csv) {
      return csvResponse(`stock-movements-${todayKey()}.csv`,
        ['Date', 'Movement no.', 'SKU', 'Item', 'Type', 'Direction', 'Qty', 'Unit', 'Unit cost (BDT)', 'Value (BDT)', 'Balance when recorded', 'Employee', 'Department', 'Project', 'Purchase bill', 'Reason', 'Reference', 'Recorded by'],
        data.map(m => [
          m.date ? dhakaDayKey(m.date) : '', m.movementNo ?? '', m.item?.sku ?? '', m.item?.name ?? '',
          STOCK_MOVEMENT_META[m.type]?.label ?? m.type, m.direction, m.qty, m.item?.unit ?? '', m.unitCost, m.totalCost,
          m.qtyAfter ?? '', m.employee?.name ?? '', m.department?.name ?? '', m.project?.name ?? '', m.purchaseBill?.billNo ?? '',
          m.reason ?? '', m.reference ?? '', m.createdBy?.name ?? '',
        ]))
    }

    const r2 = (n) => Math.round((Number(n || 0) + Number.EPSILON) * 100) / 100
    const inRow = totals.find(t => t._id === 'IN')
    const outRow = totals.find(t => t._id === 'OUT')
    return NextResponse.json({
      data,
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
      totals: {
        inValue: r2(inRow?.value), inCount: inRow?.count ?? 0,
        outValue: r2(outRow?.value), outCount: outRow?.count ?? 0,
      },
    })
  } catch (err) {
    return errorResponse(err, '[GET /api/inventory/stock/movements]')
  }
}
