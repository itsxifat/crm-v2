/**
 * lib/inventory/stock.js — SERVER-ONLY consumable stock engine.
 *
 * moveStock() is the only writer of StockItem.qtyOnHand / avgCost / stockValue.
 * Costing is moving weighted average (IAS 2):
 *   IN  : newAvg = (qtyOnHand × avgCost + inQty × unitCost) / (qtyOnHand + inQty)
 *   OUT : valued at the current avgCost (avgCost unchanged); refused when it would
 *         take qtyOnHand below zero (409 'Insufficient stock'). A back-dated OUT is
 *         also refused (422) when it would take the stock below zero at the end of
 *         its day or of any later day (the dated balances the as-of reports use).
 *   OUT with reverseUnitCost (undoing a purchase): valued at that cost and the
 *         average unwound — newAvg = (qty × avg − outQty × cost) / (qty − outQty) —
 *         only when the stock on hand can bear it (something remains and
 *         qty × avg − outQty × cost ≥ 0). Otherwise (the lot was partly consumed,
 *         or nothing would remain) it leaves at the current average like any OUT,
 *         so no more value leaves than is on hand.
 *   stockValue = round2(qtyAfter × avgAfter)
 *
 * Every item update is a single atomic findOneAndUpdate with an aggregation
 * pipeline (no read-modify-write in JS; a purchase reversal applies its
 * unwind-or-average choice only to the exact state it read), so concurrent
 * issues can never oversell or lose an average-cost update. The StockMovement
 * row is written first (it allocates the SM-YYMM-##### number; a back-dated OUT
 * is checked against the dated balances once its row exists) and stamped with
 * qtyAfter / avgCostAfter / unitCost / totalCost afterwards; any failure
 * after the item update is compensated.
 *
 * Quantities are kept to 4 decimals (kg, ltr…), average cost to 4 decimals,
 * money (totalCost, stockValue) to 2 decimals, all rounded half-up.
 */

import mongoose from 'mongoose'
import connectDB from '@/lib/mongodb'
import { StockItem, StockMovement } from '@/models'
import { STOCK_MOVEMENT_TYPES, stockDirectionFor } from '@/lib/inventory/constants'
import { parseDhakaDay, dhakaDayKey, dhakaDayStart } from '@/lib/dhakaTime'

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100
const round4 = (n) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000

/** Value (BDT) a reversal may overshoot the value on hand by before it falls back to the average. */
const UNWIND_TOLERANCE = 0.005
/** Optimistic retries of a reversal OUT when the item moves between its read and its update. */
const REVERSAL_ATTEMPTS = 5

function httpError(status, message, extra = {}) {
  const err = new Error(message)
  err.status = status
  Object.assign(err, extra)
  return err
}

// ── Aggregation-pipeline expression helpers ─────────────────────────────────

/** Field as a double (missing / null / garbage ⇒ 0). */
const N = (field) => ({ $convert: { input: `$${field}`, to: 'double', onError: 0, onNull: 0 } })

/** Half-up rounding identical to the JS round2/round4 helpers: floor((x + ε) × 10^p + 0.5) / 10^p. */
const roundExpr = (expr, places) => {
  const f = 10 ** places
  return { $divide: [{ $floor: { $add: [{ $multiply: [{ $add: [expr, Number.EPSILON] }, f] }, 0.5] } }, f] }
}

function toObjectIdOrNull(value, label) {
  if (value === null || value === undefined || value === '') return null
  const id = value?._id ?? value
  if (!mongoose.isValidObjectId(id)) throw httpError(422, `Invalid ${label}`)
  return id
}

function toMovementDate(value) {
  if (value === null || value === undefined || value === '') return new Date()
  if (value instanceof Date) {
    if (Number.isNaN(value.getTime())) throw httpError(422, 'Invalid date')
    return value
  }
  if (typeof value === 'string') {
    const day = parseDhakaDay(value)
    if (day) return day.start
  }
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) throw httpError(422, 'Invalid date')
  return d
}

const blankToNull = (v) => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s ? s : null
}

/** Movement types that always add stock / always remove it (TRANSFER needs an explicit direction). */
export const STOCK_IN_TYPES = STOCK_MOVEMENT_TYPES.filter(t => stockDirectionFor(t) === 'IN')
export const STOCK_OUT_TYPES = STOCK_MOVEMENT_TYPES.filter(t => stockDirectionFor(t) === 'OUT')

/** true when an item is at or below its reorder level (items with level 0 are low only when empty). */
export function isLowStock(item) {
  const qty = Number(item?.qtyOnHand) || 0
  const level = Number(item?.reorderLevel) || 0
  return level > 0 ? qty <= level : qty <= 0
}

// ── Atomic item updates ─────────────────────────────────────────────────────

/** Pipeline for an IN movement. unitCost null ⇒ received at the current average cost. */
function inPipeline(qty, unitCost) {
  const unit = unitCost === null ? '$__a' : unitCost
  const weightedQty = { $max: ['$__q', 0] }
  const newQty = { $add: ['$__q', qty] }
  return [
    { $set: { __q: N('qtyOnHand'), __a: N('avgCost') } },
    { $set: {
      qtyOnHand: roundExpr(newQty, 4),
      avgCost: {
        $cond: [
          { $gt: [{ $add: [weightedQty, qty] }, 0] },
          roundExpr({
            $divide: [
              { $add: [{ $multiply: [weightedQty, '$__a'] }, { $multiply: [qty, unit] }] },
              { $add: [weightedQty, qty] },
            ],
          }, 4),
          roundExpr(unit, 4),
        ],
      },
    } },
    { $set: {
      stockValue: roundExpr({ $multiply: ['$qtyOnHand', '$avgCost'] }, 2),
      // Re-arm the low-stock alert once stock rises above the reorder level again.
      lowStockNotifiedAt: {
        $cond: [{ $gt: ['$qtyOnHand', N('reorderLevel')] }, null, { $ifNull: ['$lowStockNotifiedAt', null] }],
      },
      updatedAt: '$$NOW',
    } },
    { $unset: ['__q', '__a'] },
  ]
}

/** Pipeline for an OUT movement (filter guarantees qtyOnHand >= qty). */
function outPipeline(qty) {
  return [
    { $set: { qtyOnHand: roundExpr({ $subtract: [N('qtyOnHand'), qty] }, 4) } },
    { $set: {
      stockValue: roundExpr({ $multiply: ['$qtyOnHand', N('avgCost')] }, 2),
      updatedAt: '$$NOW',
    } },
  ]
}

/**
 * Can `qty` at `unitCost` be unwound from qtyOnHand / avgCost? Only when something
 * remains and the value on hand covers the value taken out. Same arithmetic as the
 * condition in unwindInPipeline (keep the two in step).
 */
function canUnwind(qtyOnHand, avgCost, qty, unitCost) {
  return qtyOnHand - qty > 0 && qtyOnHand * avgCost - qty * unitCost >= -UNWIND_TOLERANCE
}

/**
 * Pipeline that takes `qty` out at `unitCost` and unwinds that quantity's effect
 * on the moving average — the exact inverse of inPipeline(qty, unitCost):
 *   avg = (qtyOnHand × avgCost − qty × unitCost) / (qtyOnHand − qty)
 * when the stock can bear it (see canUnwind). Otherwise the average is kept, so
 * the qty leaves at the current average and never more value than is on hand
 * (a nothing-remains reversal takes the whole value on hand).
 */
function unwindInPipeline(qty, unitCost) {
  const remaining = { $subtract: ['$__q', qty] }
  const residual = { $subtract: [{ $multiply: ['$__q', '$__a'] }, { $multiply: [qty, unitCost] }] }
  return [
    { $set: { __q: N('qtyOnHand'), __a: N('avgCost') } },
    { $set: {
      qtyOnHand: roundExpr({ $max: [remaining, 0] }, 4),
      avgCost: {
        $cond: [
          { $and: [{ $gt: [remaining, 0] }, { $gte: [residual, -UNWIND_TOLERANCE] }] },
          { $max: [0, roundExpr({ $divide: [residual, remaining] }, 4)] },
          '$__a',
        ],
      },
    } },
    { $set: { stockValue: roundExpr({ $multiply: ['$qtyOnHand', '$avgCost'] }, 2), updatedAt: '$$NOW' } },
    { $unset: ['__q', '__a'] },
  ]
}

/**
 * Inverse of an applied movement, used only to compensate when the movement
 * record cannot be finalised. OUT ⇒ add the qty back at the current average
 * (average unchanged); IN ⇒ remove the qty and unwind its effect on the average.
 */
async function reverseItemUpdate(itemId, direction, qty, unitCost) {
  if (direction === 'OUT') {
    await StockItem.updateOne({ _id: itemId }, inPipeline(qty, null))
    return
  }
  await StockItem.updateOne({ _id: itemId }, unwindInPipeline(qty, unitCost))
}

/**
 * Reversal-mode OUT (undoing an earlier IN of `qty` at `unitCost`). The IN is
 * unwound when the stock can bear it (canUnwind); otherwise the qty leaves at the
 * current average (outPipeline). The choice is made on the state read and applied
 * only to that exact state (qtyOnHand + avgCost in the filter), retried when the
 * item moved in between — so the movement can be stamped with the value that
 * actually left.
 * @returns {Promise<{ item: object|null, unwound: boolean }>} item null ⇒ not enough on hand
 */
async function reversalOut(itemId, qty, unitCost) {
  for (let attempt = 0; attempt < REVERSAL_ATTEMPTS; attempt++) {
    const cur = await StockItem.findById(itemId).select('qtyOnHand avgCost').lean()
    if (!cur) return { item: null, unwound: false }
    const qtyBefore = Number(cur.qtyOnHand) || 0
    if (!(qtyBefore >= qty)) return { item: null, unwound: false }
    const unwound = canUnwind(qtyBefore, Number(cur.avgCost) || 0, qty, unitCost)
    const item = await StockItem.findOneAndUpdate(
      { _id: itemId, qtyOnHand: cur.qtyOnHand ?? null, avgCost: cur.avgCost ?? null },
      unwound ? unwindInPipeline(qty, unitCost) : outPipeline(qty),
      { new: true },
    )
    if (item) return { item, unwound }
  }
  throw httpError(409, 'This stock item is being updated by someone else — try again')
}

/**
 * Lowest end-of-day balance of an item (Dhaka days) from the day of `when` up to
 * today, over every recorded movement (the caller's own row included).
 * @returns {Promise<{ min: number, minDay: string }>}
 */
async function lowestDatedBalance(itemId, when) {
  const dayKey = dhakaDayKey(when)
  const dayStart = parseDhakaDay(dayKey).start
  const stockItemId = new mongoose.Types.ObjectId(String(itemId))
  const signed = { $cond: [{ $eq: ['$direction', 'IN'] }, '$qty', { $multiply: ['$qty', -1] }] }
  const [[head], days] = await Promise.all([
    StockMovement.aggregate([
      { $match: { stockItemId, date: { $lt: dayStart } } },
      { $group: { _id: null, q: { $sum: signed } } },
    ]),
    StockMovement.aggregate([
      { $match: { stockItemId, date: { $gte: dayStart } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$date', timezone: '+06:00' } }, q: { $sum: signed } } },
      { $sort: { _id: 1 } },
    ]),
  ])
  let balance = round4(head?.q ?? 0)
  let min = null
  let minDay = dayKey
  for (const d of days) {
    balance = round4(balance + (Number(d.q) || 0))
    if (min === null || balance < min) { min = balance; minDay = d._id }
  }
  return { min: min ?? balance, minDay }
}

/**
 * Move consumable stock in or out.
 *
 * @param {object} p
 * @param {string} p.stockItemId
 * @param {string} p.type        STOCK_MOVEMENT_TYPES: OPENING | PURCHASE | ISSUE | RETURN | ADJUST_IN |
 *                               ADJUST_OUT | DAMAGED | TRANSFER
 * @param {'IN'|'OUT'} [p.direction]  implied by the type; required for TRANSFER
 * @param {number} p.qty         > 0 (up to 4 decimals)
 * @param {number} [p.unitCost]  IN only (BDT per unit, excl. creditable VAT). Omitted ⇒ the current
 *                               average cost. Ignored for OUT (valued at the average cost).
 * @param {number} [p.reverseUnitCost]  OUT only — reversal of an earlier IN (cancelled purchase):
 *                               the qty leaves at this (the original IN) unit cost and its effect on
 *                               the moving average is unwound, instead of leaving at the average —
 *                               when the stock on hand can bear it; otherwise it leaves at the
 *                               current average (reversedAtAverage). Exempt from the back-date check.
 * @param {Date|string} [p.date] Date or 'YYYY-MM-DD' (Dhaka day); default now
 * @param {string} [p.employeeId] [p.departmentId] [p.projectId] [p.purchaseBillId]
 * @param {string} [p.reason] [p.reference]
 * @param {string} [p.userId]
 * @returns {Promise<{ item, movement, qtyBefore: number, lowStock: boolean, crossedReorderLevel: boolean, reversedAtAverage: boolean }>}
 *   item / movement are Mongoose documents. crossedReorderLevel is true when an OUT took the
 *   quantity from above the reorder level to at/below it (notify once per crossing — the item's
 *   lowStockNotifiedAt is re-armed automatically when stock is received above the level).
 *   reversedAtAverage is true when a reverseUnitCost OUT left at the average instead.
 * @throws Error with .status — 404 'Stock item not found', 409 'Insufficient stock …'
 *         (err.available, err.requested), 422 validation, 422 when a back-dated OUT would take
 *         the stock below zero on its day or a later one (err.available, err.requested, err.date)
 */
export async function moveStock({
  stockItemId, type, direction, qty, unitCost, reverseUnitCost, date,
  employeeId, departmentId, projectId, purchaseBillId, reason, reference, userId,
} = {}) {
  // ── validate ──
  const itemId = stockItemId?._id ?? stockItemId
  if (!itemId || !mongoose.isValidObjectId(itemId)) throw httpError(404, 'Stock item not found')
  if (!STOCK_MOVEMENT_TYPES.includes(type)) throw httpError(422, `Invalid movement type "${type ?? ''}"`)

  const fixed = stockDirectionFor(type)
  const dir = direction ? String(direction).toUpperCase() : fixed
  if (dir !== 'IN' && dir !== 'OUT') throw httpError(422, 'Direction (IN or OUT) is required for this movement type')
  if (fixed && dir !== fixed) throw httpError(422, `A ${type} movement is always ${fixed}`)

  const q = round4(Number(qty))
  if (!Number.isFinite(q) || q <= 0) throw httpError(422, 'Quantity must be greater than 0')

  let cost = null
  if (dir === 'IN' && unitCost !== null && unitCost !== undefined && unitCost !== '') {
    cost = Number(unitCost)
    if (!Number.isFinite(cost) || cost < 0) throw httpError(422, 'Unit cost must be 0 or more')
    cost = round4(cost)
  }

  let rc = null
  if (reverseUnitCost !== null && reverseUnitCost !== undefined && reverseUnitCost !== '') {
    if (dir !== 'OUT') throw httpError(422, 'A reversal cost applies only to stock going out')
    rc = Number(reverseUnitCost)
    if (!Number.isFinite(rc) || rc < 0) throw httpError(422, 'Reversal unit cost must be 0 or more')
    rc = round4(rc)
  }

  const when = toMovementDate(date)
  const refs = {
    employeeId: toObjectIdOrNull(employeeId, 'employee'),
    departmentId: toObjectIdOrNull(departmentId, 'department'),
    projectId: toObjectIdOrNull(projectId, 'project'),
    purchaseBillId: toObjectIdOrNull(purchaseBillId, 'purchase bill'),
    createdBy: toObjectIdOrNull(userId, 'user'),
  }

  await connectDB()

  if (!(await StockItem.exists({ _id: itemId }))) throw httpError(404, 'Stock item not found')

  // ── 1. movement record first (allocates the movement number, validates refs) ──
  const movement = new StockMovement({
    stockItemId: itemId,
    type,
    direction: dir,
    qty: q,
    unitCost: cost ?? 0,
    totalCost: 0,
    date: when,
    ...refs,
    reason: blankToNull(reason),
    reference: blankToNull(reference),
  })
  try {
    await movement.save()
  } catch (err) {
    if (err?.name === 'ValidationError' || err?.name === 'CastError') {
      const first = err.errors ? Object.values(err.errors)[0]?.message : null
      throw httpError(422, first || err.message)
    }
    throw err
  }

  // ── 1b. a back-dated OUT must not take the stock below zero on its day or later ──
  // Checked after this row is written (write-then-check): of two concurrent
  // back-dated OUTs the later check always sees both rows, so they cannot both
  // pass. Today's OUTs are covered by the atomic qtyOnHand guard below; purchase
  // reversals (rc) are exempt so old data can never block undoing a receipt.
  if (dir === 'OUT' && rc === null && when < dhakaDayStart(new Date())) {
    let low
    try {
      low = await lowestDatedBalance(itemId, when)
    } catch (err) {
      await StockMovement.deleteOne({ _id: movement._id }).catch(e => console.error('[moveStock] movement cleanup failed', e))
      throw err
    }
    if (low.min < -0.00005) {
      await StockMovement.deleteOne({ _id: movement._id }).catch(e => console.error('[moveStock] movement cleanup failed', e))
      const current = await StockItem.findById(itemId).select('unit').lean()
      const unit = current?.unit || 'pcs'
      const dayKey = dhakaDayKey(when)
      const available = Math.max(0, round4(low.min + q))
      throw httpError(422, low.minDay === dayKey
        ? `Only ${available} ${unit} on hand on ${dayKey}, ${q} requested — date this movement on a day the stock was on hand, or reduce the quantity`
        : `Only ${available} ${unit} can leave on ${dayKey} — the stock on ${low.minDay} would go below zero. Date this movement later or reduce the quantity`,
      { available, requested: q, date: low.minDay })
    }
  }

  // ── 2. atomic item update ──
  let item
  let unwound = false
  try {
    if (dir === 'IN') item = await StockItem.findOneAndUpdate({ _id: itemId }, inPipeline(q, cost), { new: true })
    else if (rc === null) item = await StockItem.findOneAndUpdate({ _id: itemId, qtyOnHand: { $gte: q } }, outPipeline(q), { new: true })
    else ({ item, unwound } = await reversalOut(itemId, q, rc))
  } catch (err) {
    await StockMovement.deleteOne({ _id: movement._id }).catch(e => console.error('[moveStock] movement cleanup failed', e))
    throw err
  }

  if (!item) {
    await StockMovement.deleteOne({ _id: movement._id }).catch(e => console.error('[moveStock] movement cleanup failed', e))
    const current = await StockItem.findById(itemId).select('qtyOnHand unit').lean()
    if (!current) throw httpError(404, 'Stock item not found')
    const available = round4(Number(current.qtyOnHand) || 0)
    const unit = current.unit || 'pcs'
    throw httpError(409, `Insufficient stock — ${available} ${unit} on hand, ${q} requested`, { available, requested: q })
  }

  // ── 3. stamp the movement with the resulting balance ──
  const qtyAfter = round4(Number(item.qtyOnHand) || 0)
  const avgAfter = round4(Number(item.avgCost) || 0)
  // A reversal that could not be unwound left at the average (avgAfter = the average before).
  const unitUsed = rc !== null && unwound ? rc : (dir === 'OUT' ? avgAfter : (cost ?? avgAfter))
  try {
    movement.set({
      unitCost: unitUsed,
      totalCost: round2(q * unitUsed),
      qtyAfter,
      avgCostAfter: avgAfter,
    })
    await movement.save()
  } catch (err) {
    try {
      // A reversal-mode OUT is undone by re-adding the qty at the cost it left at (restores the average).
      if (rc !== null) await StockItem.updateOne({ _id: itemId }, inPipeline(q, unitUsed))
      else await reverseItemUpdate(itemId, dir, q, unitUsed)
    } catch (e) {
      console.error('[moveStock] stock reversal failed', e)
    }
    await StockMovement.deleteOne({ _id: movement._id }).catch(e => console.error('[moveStock] movement cleanup failed', e))
    throw err
  }

  const qtyBefore = dir === 'OUT' ? round4(qtyAfter + q) : round4(qtyAfter - q)
  const level = Number(item.reorderLevel) || 0
  const crossedReorderLevel = dir === 'OUT' && qtyBefore > level && qtyAfter <= level

  return {
    item,
    movement,
    qtyBefore,
    lowStock: isLowStock(item),
    crossedReorderLevel,
    reversedAtAverage: rc !== null && !unwound,
  }
}
