export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Asset, AssetEvent, StockItem } from '@/models'
import { canDoAny } from '@/lib/rbac'
import { getFinanceSettings } from '@/lib/finance/settings'
import { ensureCategoriesSeeded, ASSET_STATUSES, TERMINAL_STATUSES } from '@/lib/inventory/assets'
import { depreciationStatus } from '@/lib/inventory/depreciation'
import { dhakaDayStart } from '@/lib/dhakaTime'
import {
  errorResponse, round2, num, idStr, dayKeyOrNull, loadEmployeeMap, employeeLabel, loadCategoryMap,
} from '../reports/_lib/common'

const VIEW_PERMS = ['inventory.view', 'inventory.manage']
const N = (field) => ({ $convert: { input: `$${field}`, to: 'double', onError: 0, onNull: 0 } })
const DAY_MS = 24 * 60 * 60 * 1000

// GET /api/inventory/summary — dashboard figures (inventory.view)
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canDoAny(session, VIEW_PERMS)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await connectDB()
    await ensureCategoriesSeeded()

    const now = new Date()
    const today = dhakaDayStart(now)
    const in30 = dhakaDayStart(now, 31)
    const in60 = dhakaDayStart(now, 61)
    const in90 = dhakaDayStart(now, 91)
    const ago30 = dhakaDayStart(now, -30)
    const live = { isArchived: { $ne: true }, status: { $nin: TERMINAL_STATUSES } }

    const [settings, statusRows, categoryRows, ackPendingDocs, ackCounts, warrantyDocs, warrantyCounts,
      overdueCount, stockAgg, recent, damageEvents, recoveryUpdates, depStatus, catMap] = await Promise.all([
      getFinanceSettings(),
      Asset.aggregate([
        { $match: { isArchived: { $ne: true } } },
        { $group: {
          _id: '$status',
          count: { $sum: 1 },
          cost: { $sum: N('cost') },
          capCount: { $sum: { $cond: [{ $ne: ['$isCapitalized', false] }, 1, 0] } },
          capCost: { $sum: { $cond: [{ $ne: ['$isCapitalized', false] }, N('cost'), 0] } },
          capAcc: { $sum: { $cond: [{ $ne: ['$isCapitalized', false] }, N('depreciation.accumulated'), 0] } },
        } },
      ]),
      Asset.aggregate([
        { $match: live },
        { $group: {
          _id: '$categoryId',
          count: { $sum: 1 },
          assigned: { $sum: { $cond: [{ $eq: ['$status', 'ASSIGNED'] }, 1, 0] } },
          inStock: { $sum: { $cond: [{ $eq: ['$status', 'IN_STOCK'] }, 1, 0] } },
          cost: { $sum: N('cost') },
          capCost: { $sum: { $cond: [{ $ne: ['$isCapitalized', false] }, N('cost'), 0] } },
          capAcc: { $sum: { $cond: [{ $ne: ['$isCapitalized', false] }, N('depreciation.accumulated'), 0] } },
        } },
      ]),
      Asset.find({ ...live, status: 'ASSIGNED', 'acknowledgement.status': 'PENDING' })
        .select('assetTag name assignedEmployeeId assignedAt').sort({ assignedAt: 1 }).limit(8).lean(),
      Asset.aggregate([
        { $match: { ...live, 'acknowledgement.status': { $in: ['PENDING', 'DECLINED'] } } },
        { $group: { _id: '$acknowledgement.status', count: { $sum: 1 } } },
      ]),
      Asset.find({ ...live, warrantyExpiry: { $gte: today, $lt: in90 } })
        .select('assetTag name warrantyExpiry assignedEmployeeId').sort({ warrantyExpiry: 1 }).limit(8).lean(),
      Asset.aggregate([
        { $match: { ...live, warrantyExpiry: { $gte: ago30, $lt: in90 } } },
        { $group: {
          _id: null,
          within30: { $sum: { $cond: [{ $and: [{ $gte: ['$warrantyExpiry', today] }, { $lt: ['$warrantyExpiry', in30] }] }, 1, 0] } },
          within60: { $sum: { $cond: [{ $and: [{ $gte: ['$warrantyExpiry', today] }, { $lt: ['$warrantyExpiry', in60] }] }, 1, 0] } },
          within90: { $sum: { $cond: [{ $gte: ['$warrantyExpiry', today] }, 1, 0] } },
          expiredLast30: { $sum: { $cond: [{ $lt: ['$warrantyExpiry', today] }, 1, 0] } },
        } },
      ]),
      Asset.countDocuments({ ...live, status: 'ASSIGNED', expectedReturnDate: { $ne: null, $lt: today } }),
      StockItem.aggregate([
        { $match: { isActive: { $ne: false } } },
        { $group: {
          _id: null,
          items: { $sum: 1 },
          value: { $sum: N('stockValue') },
          lowStock: { $sum: { $cond: [{ $and: [{ $gt: [N('reorderLevel'), 0] }, { $lte: [N('qtyOnHand'), N('reorderLevel')] }, { $gt: [N('qtyOnHand'), 0] }] }, 1, 0] } },
          outOfStock: { $sum: { $cond: [{ $lte: [N('qtyOnHand'), 0] }, 1, 0] } },
        } },
      ]),
      AssetEvent.find({ type: { $ne: 'DEPRECIATION' } }).sort({ date: -1, createdAt: -1 }).limit(10)
        .populate('assetId', 'assetTag name').lean(),
      AssetEvent.find({ type: 'DAMAGE_REPORTED', 'details.recovery.status': 'PENDING' }).select('_id assetId amount details date').lean(),
      AssetEvent.find({ type: 'RECOVERY_UPDATED' }).select('assetId details date').lean(),
      depreciationStatus(),
      loadCategoryMap(),
    ])

    // ── status counts & totals ──
    const byStatus = Object.fromEntries(ASSET_STATUSES.map(s => [s, 0]))
    const totals = { cost: 0, capitalizedCount: 0, capitalizedCost: 0, capitalizedAccumulated: 0, expensedCount: 0, expensedCost: 0 }
    let held = 0
    let disposed = 0
    for (const r of statusRows) {
      byStatus[r._id] = r.count
      if (TERMINAL_STATUSES.includes(r._id)) { disposed += r.count; continue }
      held += r.count
      totals.cost += r.cost
      totals.capitalizedCount += r.capCount
      totals.capitalizedCost += r.capCost
      totals.capitalizedAccumulated += r.capAcc
      totals.expensedCount += r.count - r.capCount
      totals.expensedCost += r.cost - r.capCost
    }
    for (const k of Object.keys(totals)) if (k.endsWith('Cost') || k === 'cost' || k.endsWith('Accumulated')) totals[k] = round2(totals[k])
    totals.capitalizedBookValue = round2(totals.capitalizedCost - totals.capitalizedAccumulated)

    // ── categories ──
    const byCategory = categoryRows.map(r => {
      const c = catMap.get(idStr(r._id))
      return {
        categoryId: idStr(r._id),
        name: c?.name ?? 'Uncategorised',
        code: c?.code ?? null,
        type: c?.type ?? 'ASSET',
        taxClass: c?.taxClass ?? null,
        count: r.count,
        assigned: r.assigned,
        inStock: r.inStock,
        cost: round2(r.cost),
        capitalizedCost: round2(r.capCost),
        accumulated: round2(r.capAcc),
        bookValue: round2(r.capCost - r.capAcc),
      }
    }).sort((a, b) => b.capitalizedCost - a.capitalizedCost || b.count - a.count || a.name.localeCompare(b.name))

    // ── people (acks / warranties) ──
    const empMap = await loadEmployeeMap([...ackPendingDocs, ...warrantyDocs].map(a => a.assignedEmployeeId).filter(Boolean))
    const ackByStatus = Object.fromEntries(ackCounts.map(r => [r._id, r.count]))
    const acknowledgements = {
      pending: ackByStatus.PENDING ?? 0,
      declined: ackByStatus.DECLINED ?? 0,
      items: ackPendingDocs.map(a => ({
        id: String(a._id),
        assetTag: a.assetTag,
        name: a.name,
        employee: employeeLabel(empMap.get(idStr(a.assignedEmployeeId))),
        assignedAt: a.assignedAt ?? null,
        daysWaiting: a.assignedAt ? Math.max(0, Math.floor((now.getTime() - new Date(a.assignedAt).getTime()) / DAY_MS)) : null,
      })),
    }
    const wc = warrantyCounts[0] || {}
    const warranties = {
      within30: wc.within30 ?? 0,
      within60: wc.within60 ?? 0,
      within90: wc.within90 ?? 0,
      expiredLast30: wc.expiredLast30 ?? 0,
      items: warrantyDocs.map(a => ({
        id: String(a._id),
        assetTag: a.assetTag,
        name: a.name,
        expiry: dayKeyOrNull(a.warrantyExpiry),
        daysLeft: Math.round((dhakaDayStart(a.warrantyExpiry).getTime() - today.getTime()) / DAY_MS),
        custodian: a.assignedEmployeeId ? employeeLabel(empMap.get(idStr(a.assignedEmployeeId))) : null,
      })),
    }

    // ── damage recoveries still open (a RECOVERED / WAIVED update closes the case;
    //    a part payment is written as PENDING and leaves it open) ──
    const resolved = new Set()
    for (const u of recoveryUpdates) {
      const d = u.details || {}
      const target = idStr(d.eventId ?? d.damageEventId ?? d.damageEvent ?? d.targetEventId ?? null)
      const st = d.status ?? d.recovery?.status
      if (target && st && st !== 'PENDING') resolved.add(target)
    }
    const openCases = damageEvents.filter(e => !resolved.has(String(e._id)))
    const recoveriesPending = {
      count: openCases.length,
      // the balance still due: case amount less the instalments already recovered (running total on the case)
      amount: round2(openCases.reduce((s, e) => s + Math.max(0, num(e.details?.recovery?.amount ?? 0) - num(e.details?.recovery?.recoveredAmount ?? 0)), 0)),
    }

    const stock = stockAgg[0] || {}
    const data = {
      generatedAt: now.toISOString(),
      settings: {
        capitalizationThreshold: settings.inventory?.capitalizationThreshold ?? 10000,
        depreciationConvention: settings.inventory?.depreciationConvention ?? 'PRORATA_DAYS',
        tagPrefix: settings.inventory?.tagPrefix ?? 'EN',
        postDepreciationToLedger: settings.inventory?.postDepreciationToLedger !== false,
        goLiveDate: settings.goLiveDate ?? null,
        fiscalYearStartMonth: settings.fiscalYearStartMonth ?? 7,
        lockedUntil: settings.lockedUntil ?? null,
      },
      counts: {
        total: held + disposed,
        held,
        disposed,
        byStatus,
        assigned: byStatus.ASSIGNED,
        inStock: byStatus.IN_STOCK,
        inRepair: byStatus.IN_REPAIR,
        damaged: byStatus.DAMAGED,
        lostOrStolen: byStatus.LOST + byStatus.STOLEN,
        retired: byStatus.RETIRED,
        overdueReturns: overdueCount,
      },
      totals,
      byCategory,
      acknowledgements,
      warranties,
      damage: { damaged: byStatus.DAMAGED, recoveriesPending },
      stock: {
        items: stock.items ?? 0,
        value: round2(stock.value ?? 0),
        lowStock: stock.lowStock ?? 0,
        outOfStock: stock.outOfStock ?? 0,
      },
      depreciation: depStatus,
      recentEvents: recent.map(e => ({
        id: String(e._id),
        type: e.type,
        date: e.date,
        assetId: e.assetId?._id ? String(e.assetId._id) : (e.assetId ? String(e.assetId) : null),
        assetTag: e.assetId?.assetTag ?? null,
        assetName: e.assetId?.name ?? null,
        amount: e.amount ?? null,
        notes: e.notes ?? null,
        by: e.createdByName ?? null,
        fromStatus: e.fromStatus ?? null,
        toStatus: e.toStatus ?? null,
      })),
    }
    return NextResponse.json({ data })
  } catch (err) {
    return errorResponse(err, '[GET /api/inventory/summary]')
  }
}
