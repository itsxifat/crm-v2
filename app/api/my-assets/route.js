export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Asset, AssetEvent, StockMovement } from '@/models'
import { requireStaff } from '@/lib/rbac'
import { HELD_STATUSES } from '@/lib/inventory/constants'
import { employeeForSession, toMyAsset, toReportSummary } from './_lib/shared'

const REPORT_LOOKBACK_DAYS = 90

// GET /api/my-assets — equipment held by the signed-in employee, pending
// acknowledgements, and consumables issued to them. Self-service: any staff
// member, scoped to their own Employee record.
//
// → { data: { employee, assets[], pendingAcknowledgements[], consumables[], summary } }
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    const denied = requireStaff(session)
    if (denied) return denied

    await connectDB()

    const emp = await employeeForSession(session)
    if (!emp) {
      return NextResponse.json({
        data: {
          employee: null,
          assets: [],
          pendingAcknowledgements: [],
          consumables: [],
          summary: { total: 0, pendingAcknowledgement: 0, declined: 0, inRepair: 0, damaged: 0, consumablesIssued: 0 },
        },
      })
    }

    const assets = await Asset.find({
      assignedEmployeeId: emp._id,
      status: { $in: HELD_STATUSES },
      isArchived: { $ne: true },
    })
      .populate({ path: 'categoryId', select: 'name code' })
      .populate({ path: 'locationId', select: 'name code' })
      .sort({ assignedAt: -1, createdAt: -1 })
      .lean()

    const ids = assets.map(a => a._id)
    const since = new Date(Date.now() - REPORT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000)

    const [reports, movements] = await Promise.all([
      ids.length
        ? AssetEvent.find({
          assetId: { $in: ids },
          'details.reportedByEmployee': true,
          createdBy: session.user.id,
          date: { $gte: since },
        }).sort({ date: -1 }).select('assetId type date details notes').lean()
        : [],
      StockMovement.find({ employeeId: emp._id, type: 'ISSUE' })
        .sort({ date: -1, createdAt: -1 })
        .limit(50)
        .populate({ path: 'stockItemId', select: 'name sku unit' })
        .lean(),
    ])

    const lastReportByAsset = new Map()
    for (const r of reports) {
      const key = String(r.assetId)
      if (!lastReportByAsset.has(key)) lastReportByAsset.set(key, toReportSummary(r))
    }

    const data = assets.map(a => toMyAsset(a, { lastReport: lastReportByAsset.get(String(a._id)) ?? null }))
    const pending = data.filter(a => a.acknowledgement.status === 'PENDING')

    const consumables = movements.map(m => ({
      id:         String(m._id),
      movementNo: m.movementNo ?? null,
      date:       m.date,
      item: m.stockItemId && typeof m.stockItemId === 'object'
        ? { id: String(m.stockItemId._id), name: m.stockItemId.name, sku: m.stockItemId.sku }
        : null,
      qty:        m.qty,
      unit:       m.stockItemId?.unit ?? 'pcs',
      reason:     m.reason ?? null,
      reference:  m.reference ?? null,
    }))

    return NextResponse.json({
      data: {
        employee: {
          id:          String(emp._id),
          employeeId:  emp.employeeId ?? null,
          name:        session.user.name ?? null,
          department:  emp.department ?? null,
          designation: emp.designation ?? emp.position ?? null,
        },
        assets: data,
        pendingAcknowledgements: pending,
        consumables,
        summary: {
          total:                 data.length,
          pendingAcknowledgement: pending.length,
          declined:              data.filter(a => a.acknowledgement.status === 'DECLINED').length,
          inRepair:              data.filter(a => a.status === 'IN_REPAIR').length,
          damaged:               data.filter(a => a.status === 'DAMAGED').length,
          consumablesIssued:     consumables.length,
        },
      },
    })
  } catch (err) {
    console.error('[GET /api/my-assets]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
