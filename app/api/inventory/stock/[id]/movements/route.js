export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { StockItem, StockMovement, Employee, Department, Project } from '@/models'
import { canDo } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { assertBooksOpen } from '@/lib/finance/settings'
import { moveStock } from '@/lib/inventory/stock'
import {
  movementSchema, MOVEMENT_PERMISSION, serializeItem, serializeMovement, ITEM_POPULATE, MOVEMENT_POPULATE,
  notifyLowStock, validationError, httpError, todayKey,
} from '../../_lib/stock'
import { errorResponse, readJson } from '../../../purchases/_lib/http'

const AUDIT_ACTION = { ISSUE: 'ASSIGN', RETURN: 'RETURN', ADJUST_IN: 'UPDATE', ADJUST_OUT: 'UPDATE', DAMAGED: 'WRITE_OFF', OPENING: 'CREATE' }

// POST /api/inventory/stock/[id]/movements
// Body: { type: 'ISSUE'|'RETURN'|'ADJUST_IN'|'ADJUST_OUT'|'DAMAGED'|'OPENING', qty, unitCost?, employeeId?,
//         departmentId?, projectId?, reason?, reference?, date?: 'YYYY-MM-DD' }
// ISSUE / RETURN need inventory.assign; adjustments, damage and opening stock need inventory.manage.
// Purchases come only from purchase bills.
export async function POST(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    const body = await readJson(request)
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    const parsed = movementSchema.safeParse(body)
    if (!parsed.success) throw validationError(parsed.error)
    const d = parsed.data

    if (!canDo(session, MOVEMENT_PERMISSION[d.type])) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })

    await connectDB()
    const item = await StockItem.findById(params.id).select('sku name unit isActive qtyOnHand').lean()
    if (!item) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (item.isActive === false && ['ISSUE', 'OPENING'].includes(d.type)) {
      throw httpError(422, `${item.name} is inactive — reactivate it first`)
    }

    // ── per-type rules ──
    if (d.type === 'ISSUE' && !d.employeeId && !d.departmentId && !d.projectId) {
      throw httpError(422, 'Choose who the stock is issued to (employee, department or project)')
    }
    if (['ADJUST_IN', 'ADJUST_OUT', 'DAMAGED'].includes(d.type) && (!d.reason || d.reason.length < 3)) {
      throw httpError(422, 'Give a reason for the adjustment (e.g. stock count difference, expired, broken)')
    }
    if (d.type === 'OPENING') {
      if (d.unitCost === null || d.unitCost === undefined) throw httpError(422, 'Enter the unit cost of the opening stock')
      if (await StockMovement.exists({ stockItemId: item._id })) {
        throw httpError(422, 'Opening stock can only be entered before any other movement — use Adjustment (+) instead')
      }
    }

    const dateKey = d.date ?? todayKey()
    if (dateKey > todayKey()) throw httpError(422, 'Date cannot be in the future')
    const locked = await assertBooksOpen(dateKey)
    if (locked) throw httpError(409, locked)

    // ── references ──
    const [emp, dep, prj] = await Promise.all([
      d.employeeId ? Employee.findById(d.employeeId).select('userId').populate({ path: 'userId', select: 'name' }).lean() : null,
      d.departmentId ? Department.findById(d.departmentId).select('name').lean() : null,
      d.projectId ? Project.findById(d.projectId).select('name projectCode').lean() : null,
    ])
    if (d.employeeId && !emp) throw httpError(422, 'Employee not found')
    if (d.departmentId && !dep) throw httpError(422, 'Department not found')
    if (d.projectId && !prj) throw httpError(422, 'Project not found')

    const result = await moveStock({
      stockItemId: item._id,
      type: d.type,
      qty: d.qty,
      unitCost: ['ADJUST_IN', 'OPENING', 'RETURN'].includes(d.type) ? d.unitCost : undefined,
      date: dateKey,
      employeeId: d.employeeId ?? null,
      departmentId: d.departmentId ?? null,
      projectId: d.projectId ?? null,
      reason: d.reason ?? null,
      reference: d.reference ?? null,
      userId: session.user.id,
    })

    const alerted = await notifyLowStock(result)

    logActivity({
      userId: session.user.id,
      userRole: session.user.role,
      action: AUDIT_ACTION[d.type] ?? 'UPDATE',
      entity: 'STOCK_ITEM',
      entityId: String(item._id),
      changes: JSON.stringify({
        sku: item.sku,
        movement: result.movement.movementNo,
        type: d.type,
        qty: d.qty,
        qtyOnHand: { from: result.qtyBefore, to: result.item.qtyOnHand },
        value: result.movement.totalCost,
        to: emp?.userId?.name ?? dep?.name ?? prj?.name ?? null,
        reason: d.reason ?? null,
      }),
      request,
    })

    const [fresh, mv] = await Promise.all([
      StockItem.findById(item._id).populate(ITEM_POPULATE).lean(),
      StockMovement.findById(result.movement._id).populate(MOVEMENT_POPULATE).lean(),
    ])
    return NextResponse.json({
      data: { item: serializeItem(fresh), movement: serializeMovement(mv) },
      lowStockAlert: alerted,
    }, { status: 201 })
  } catch (err) {
    return errorResponse(err, '[POST /api/inventory/stock/[id]/movements]')
  }
}
