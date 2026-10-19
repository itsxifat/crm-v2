export const dynamic = 'force-dynamic'
import mongoose from 'mongoose'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Asset, AssetEvent, Employee, StockItem, StockMovement } from '@/models'
import { canDo, canDoAny } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { TERMINAL_STATUSES, HELD_STATUSES, bookValue, round2 } from '@/lib/inventory/constants'
import { EMPLOYEE_RECOVERY_METHODS, recoveryProgress } from '@/lib/inventory/actions'

const VIEW_PERMS = ['hr.employees.view', 'inventory.view']

/** Events that mean a manager has acted on a self-reported problem. */
const FOLLOW_UP_TYPES = ['DAMAGE_REPORTED', 'REPAIR_SENT', 'REPAIR_COMPLETED', 'RETURNED', 'LOST', 'STOLEN', 'FOUND',
  'WRITTEN_OFF', 'SCRAPPED', 'SOLD', 'DONATED', 'RECOVERY_UPDATED']

const ref = (doc, fields) => {
  if (!doc || typeof doc !== 'object' || doc._id === undefined) return null
  const out = { id: String(doc._id) }
  for (const f of fields) out[f] = doc[f] ?? null
  return out
}

const numOrNull = (v) => {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/**
 * Recovery state of a damage event, folding in its RECOVERY_UPDATED events:
 * amount = the case amount (what is to be recovered), recoveredAmount = Σ instalments,
 * outstanding = balance still due while PENDING (see recoveryProgress).
 */
function recoveryOf(ev, updates) {
  const base = ev.details?.recovery
  if (!(base && typeof base === 'object') && !updates.length) return null
  const p = recoveryProgress(base, updates)
  return {
    method: p.method, amount: p.amount, status: p.status, recoveredAmount: p.recoveredAmount,
    outstanding: p.outstanding, waivedAmount: p.waivedAmount, recoveredAt: p.recoveredAt, note: p.note,
  }
}

// GET /api/employees/[id]/assets — the employee's equipment, acknowledgements,
// damage / loss cases with recovery status, consumables issued and returned
// assets (exit clearance view). hr.employees.view or inventory.view; cost and
// book value only with inventory.view.
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canDoAny(session, VIEW_PERMS)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()

    const employee = await Employee.findById(params.id)
      .select('employeeId department designation position isActive resigned resignDate userId')
      .populate({ path: 'userId', select: 'name isActive' })
      .lean()
    if (!employee) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const financials = canDo(session, 'inventory.view')
    const empOid = new mongoose.Types.ObjectId(params.id)

    const [assets, cases, consumableGroups, recentMoves, returnedEvents] = await Promise.all([
      Asset.find({ assignedEmployeeId: empOid, status: { $nin: TERMINAL_STATUSES }, isArchived: { $ne: true } })
        .populate({ path: 'categoryId', select: 'name code' })
        .populate({ path: 'locationId', select: 'name code' })
        .sort({ assignedAt: -1, createdAt: -1 })
        .lean(),
      AssetEvent.find({
        type: { $in: ['DAMAGE_REPORTED', 'LOST', 'STOLEN'] },
        $or: [
          { 'details.responsibleEmployeeId': { $in: [params.id, empOid] } },
          { 'details.reporterEmployeeId': params.id },
          { fromEmployeeId: empOid },
          { toEmployeeId: empOid },
        ],
      })
        .sort({ date: -1 })
        .limit(100)
        .populate({ path: 'assetId', select: 'assetTag name status' })
        .lean(),
      StockMovement.aggregate([
        { $match: { employeeId: empOid, type: { $in: ['ISSUE', 'RETURN'] } } },
        {
          $group: {
            _id: '$stockItemId',
            issued:   { $sum: { $cond: [{ $eq: ['$type', 'ISSUE'] }, '$qty', 0] } },
            returned: { $sum: { $cond: [{ $eq: ['$type', 'RETURN'] }, '$qty', 0] } },
            value:    { $sum: { $cond: [{ $eq: ['$type', 'ISSUE'] }, { $ifNull: ['$totalCost', 0] }, { $multiply: [-1, { $ifNull: ['$totalCost', 0] }] }] } },
            lastIssuedAt: { $max: { $cond: [{ $eq: ['$type', 'ISSUE'] }, '$date', null] } },
            movements: { $sum: 1 },
          },
        },
        { $sort: { lastIssuedAt: -1 } },
        { $limit: 100 },
      ]),
      StockMovement.find({ employeeId: empOid, type: { $in: ['ISSUE', 'RETURN'] } })
        .sort({ date: -1, createdAt: -1 })
        .limit(20)
        .populate({ path: 'stockItemId', select: 'name sku unit' })
        .lean(),
      AssetEvent.find({ type: 'RETURNED', fromEmployeeId: empOid })
        .sort({ date: -1 })
        .limit(30)
        .populate({ path: 'assetId', select: 'assetTag name status' })
        .lean(),
    ])

    // ── damage / loss cases ──
    const caseIds = cases.map(c => c._id)
    const selfReports = cases.filter(c => c.details?.reportedByEmployee)
    const [recoveryUpdates, followUps] = await Promise.all([
      caseIds.length
        ? AssetEvent.find({
          type: 'RECOVERY_UPDATED',
          $or: [
            { 'details.eventId': { $in: [...caseIds, ...caseIds.map(String)] } },
            { 'details.damageEventId': { $in: [...caseIds, ...caseIds.map(String)] } },
          ],
        }).sort({ date: 1, createdAt: 1 }).lean()
        : [],
      selfReports.length
        ? AssetEvent.find({
          assetId: { $in: selfReports.map(c => c.assetId?._id ?? c.assetId) },
          type: { $in: FOLLOW_UP_TYPES },
          'details.reportedByEmployee': { $ne: true },
          date: { $gte: selfReports.reduce((m, c) => (c.date < m ? c.date : m), selfReports[0].date) },
        }).select('assetId type date').lean()
        : [],
    ])

    const updatesFor = (caseId) => recoveryUpdates.filter(u => String(u.details?.eventId ?? u.details?.damageEventId ?? '') === String(caseId))

    const damageCases = cases.map(c => {
      const d = c.details ?? {}
      const assetId = String(c.assetId?._id ?? c.assetId)
      const selfReported = Boolean(d.reportedByEmployee)
      const followedUp = selfReported
        ? followUps.some(f => String(f.assetId) === assetId && new Date(f.date) > new Date(c.date))
        : true
      const recovery = recoveryOf(c, updatesFor(c._id))
      return {
        id:           String(c._id),
        type:         c.type,
        reportType:   d.reportType ?? null,
        date:         c.date,
        asset:        ref(c.assetId, ['assetTag', 'name', 'status']),
        cause:        d.cause ?? null,
        description:  d.description ?? c.notes ?? null,
        liabilityPct: numOrNull(d.liabilityPct),
        assessedLoss: financials ? numOrNull(d.assessedLoss) : null,
        gdNumber:     d.gdNumber ?? null,
        recovery:     recovery
          ? {
            ...recovery,
            amount: financials ? recovery.amount : null,
            recoveredAmount: financials ? recovery.recoveredAmount : null,
            outstanding: financials ? recovery.outstanding : null,
            waivedAmount: financials ? recovery.waivedAmount : null,
          }
          : null,
        isResponsible: String(d.responsibleEmployeeId ?? '') === String(empOid),
        reportedByEmployee: selfReported,
        awaitingAssessment: selfReported && !followedUp,
        photos:       Array.isArray(d.photos) ? d.photos : (c.attachments ?? []),
        createdByName: c.createdByName ?? null,
      }
    })

    // ── assets ──
    const now = Date.now()
    const assetRows = assets.map(a => ({
      id:                 String(a._id),
      assetTag:           a.assetTag,
      name:               a.name,
      category:           ref(a.categoryId, ['name', 'code']),
      brand:              a.brand ?? null,
      model:              a.model ?? null,
      serialNumber:       a.serialNumber ?? null,
      status:             a.status,
      condition:          a.condition ?? null,
      location:           ref(a.locationId, ['name', 'code']),
      assignedAt:         a.assignedAt ?? null,
      expectedReturnDate: a.expectedReturnDate ?? null,
      // Due on the return day (Dhaka midnight) — overdue from the following day.
      overdue:            Boolean(a.expectedReturnDate && new Date(a.expectedReturnDate).getTime() + 86400000 <= now && HELD_STATUSES.includes(a.status)),
      acknowledgement: {
        status: a.acknowledgement?.status ?? 'NOT_REQUIRED',
        at:     a.acknowledgement?.at ?? null,
        note:   a.acknowledgement?.note ?? null,
      },
      lastAuditAt:     a.lastAuditAt ?? null,
      lastAuditResult: a.lastAuditResult ?? null,
      ...(financials ? { cost: round2(a.cost ?? 0), bookValue: bookValue(a), isCapitalized: a.isCapitalized !== false } : {}),
    }))

    // ── consumables ──
    const itemIds = consumableGroups.map(g => g._id).filter(Boolean)
    const items = itemIds.length ? await StockItem.find({ _id: { $in: itemIds } }).select('name sku unit').lean() : []
    const itemById = new Map(items.map(i => [String(i._id), i]))
    const consumableItems = consumableGroups.map(g => {
      const it = itemById.get(String(g._id))
      return {
        stockItem:    it ? { id: String(it._id), name: it.name, sku: it.sku, unit: it.unit ?? 'pcs' } : null,
        issued:       round2(g.issued),
        returned:     round2(g.returned),
        net:          round2(g.issued - g.returned),
        lastIssuedAt: g.lastIssuedAt ?? null,
        movements:    g.movements,
        ...(financials ? { value: round2(g.value) } : {}),
      }
    })
    const recent = recentMoves.map(m => ({
      id:         String(m._id),
      movementNo: m.movementNo ?? null,
      type:       m.type,
      date:       m.date,
      qty:        m.qty,
      item:       ref(m.stockItemId, ['name', 'sku', 'unit']),
      reason:     m.reason ?? null,
      reference:  m.reference ?? null,
      ...(financials ? { totalCost: round2(m.totalCost ?? 0) } : {}),
    }))

    // ── returned history ──
    const returned = returnedEvents.map(e => ({
      id:        String(e._id),
      date:      e.date,
      asset:     ref(e.assetId, ['assetTag', 'name', 'status']),
      condition: e.condition ?? null,
      notes:     e.notes ?? null,
      by:        e.createdByName ?? null,
    }))

    // ── summary & exit clearance ──
    const pending  = assetRows.filter(a => a.acknowledgement.status === 'PENDING')
    const declined = assetRows.filter(a => a.acknowledgement.status === 'DECLINED')
    // Only recoveries this employee owes block exit clearance: cases list every damage
    // on equipment they held, but a recovery is taken from the responsible employee
    // (salary / cash) — an insurer's claim or someone else's liability is not theirs.
    const openRecovery = damageCases.filter(c =>
      c.recovery?.status === 'PENDING' && c.isResponsible && EMPLOYEE_RECOVERY_METHODS.includes(c.recovery?.method))
    const awaiting = damageCases.filter(c => c.awaitingAssessment)
    const reasons = []
    if (assetRows.length) reasons.push(`${assetRows.length} asset${assetRows.length === 1 ? '' : 's'} still issued`)
    if (openRecovery.length) reasons.push(`${openRecovery.length} damage recover${openRecovery.length === 1 ? 'y' : 'ies'} pending`)
    if (awaiting.length) reasons.push(`${awaiting.length} reported problem${awaiting.length === 1 ? '' : 's'} not yet assessed`)

    return NextResponse.json({
      data: {
        employee: {
          id:          String(employee._id),
          name:        employee.userId?.name ?? null,
          employeeId:  employee.employeeId ?? null,
          department:  employee.department ?? null,
          designation: employee.designation ?? employee.position ?? null,
          isActive:    employee.isActive !== false && employee.userId?.isActive !== false,
          resigned:    Boolean(employee.resigned),
          resignDate:  employee.resignDate ?? null,
        },
        assets: assetRows,
        pendingAcknowledgements: pending,
        damageCases,
        consumables: {
          items: consumableItems,
          recent,
          totals: {
            items:  consumableItems.length,
            issued: round2(consumableItems.reduce((s, i) => s + i.issued, 0)),
            ...(financials ? { value: round2(consumableItems.reduce((s, i) => s + (i.value ?? 0), 0)) } : {}),
          },
        },
        returned,
        summary: {
          held:                   assetRows.length,
          pendingAcknowledgement: pending.length,
          declined:               declined.length,
          overdueReturns:         assetRows.filter(a => a.overdue).length,
          openDamageCases:        openRecovery.length,
          awaitingAssessment:     awaiting.length,
          ...(financials ? { recoveryOutstanding: round2(openRecovery.reduce((s, c) => s + (c.recovery?.outstanding ?? 0), 0)) } : {}),
          ...(financials ? { heldCost: round2(assetRows.reduce((s, a) => s + (a.cost ?? 0), 0)), heldBookValue: round2(assetRows.reduce((s, a) => s + (a.bookValue ?? 0), 0)) } : {}),
          clearance: { clear: reasons.length === 0, reasons },
        },
        canViewFinancials: financials,
      },
    })
  } catch (err) {
    console.error('[GET /api/employees/[id]/assets]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
