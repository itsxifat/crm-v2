/**
 * Consumable stock (I2) — SERVER-ONLY helpers shared by the /api/inventory/stock routes:
 * input schemas, serialisers, the once-per-crossing low-stock alert and CSV output.
 * Quantities and costs are only ever changed through lib/inventory/stock.moveStock.
 */

import { z } from 'zod'
import { StockItem, User, AssetCategory, InventoryLocation, Vendor } from '@/models'
import { isValidObjectId } from '@/lib/objectId'
import { dhakaDayKey, parseDhakaDay } from '@/lib/dhakaTime'
import { createNotification } from '@/lib/createNotification'

export function httpError(status, message, extra = {}) {
  const err = new Error(message)
  err.status = status
  Object.assign(err, extra)
  return err
}

const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const sid = (v) => (v === null || v === undefined ? null : String(v?._id ?? v))
export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
export const todayKey = () => dhakaDayKey(new Date())

/** Zod error → 422 with the first message. */
export function validationError(zodError) {
  const issue = zodError.issues?.[0]
  return httpError(422, issue?.message || 'Validation failed', { details: zodError.flatten() })
}

// ── schemas ──────────────────────────────────────────────────────────────────

const optText = (max, label) => z.preprocess(
  v => (blank(v) ? null : String(v).trim()),
  z.string().max(max, `${label} is too long (max ${max} characters)`).nullable(),
).optional()

const optId = (label) => z.preprocess(
  v => (blank(v) ? null : (typeof v === 'object' ? (v.id ?? (v._id ? String(v._id) : null)) : String(v).trim())),
  z.string().refine(isValidObjectId, `Invalid ${label}`).nullable(),
).optional()

const qtyField = (label) => z.preprocess(
  v => (blank(v) ? 0 : v),
  z.coerce.number({ invalid_type_error: `${label} must be a number` }).finite().min(0, `${label} cannot be negative`).max(1e7, `${label} is too large`),
)

const optDay = (label) => z.preprocess(
  v => {
    if (blank(v)) return null
    if (v instanceof Date) return dhakaDayKey(v)
    const s = String(v).trim()
    // A full ISO instant (e.g. Dhaka midnight = 18:00Z the day before) is read as its Dhaka day.
    if (/^\d{4}-\d{2}-\d{2}T/.test(s)) { const d = new Date(s); return Number.isNaN(d.getTime()) ? s : dhakaDayKey(d) }
    return s.slice(0, 10)
  },
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be a valid date`)
    .refine(s => Boolean(parseDhakaDay(s)), `${label} must be a valid date`).nullable(),
).optional()

export const itemSchema = z.object({
  sku: z.preprocess(
    v => (blank(v) ? null : String(v).trim().toUpperCase()),
    z.string().regex(/^[A-Z0-9][A-Z0-9._-]{0,39}$/, 'SKU may use letters, digits, dot, dash and underscore (max 40)').nullable(),
  ).optional(),
  name:              z.preprocess(v => (blank(v) ? '' : String(v).trim()), z.string().min(1, 'Item name is required').max(200, 'Item name is too long')),
  categoryId:        optId('category'),
  unit:              z.preprocess(v => (blank(v) ? 'pcs' : String(v).trim()), z.string().max(20, 'Unit is too long')),
  reorderLevel:      qtyField('Reorder level'),
  reorderQty:        qtyField('Reorder quantity'),
  preferredVendorId: optId('vendor'),
  locationId:        optId('location'),
  notes:             optText(1000, 'Notes'),
  isActive:          z.boolean().optional(),
  opening: z.object({
    qty:      z.coerce.number({ invalid_type_error: 'Opening quantity must be a number' }).finite().positive('Opening quantity must be more than 0').max(1e7),
    unitCost: z.coerce.number({ invalid_type_error: 'Opening unit cost must be a number' }).finite().min(0, 'Opening unit cost cannot be negative').max(1e9),
    date:     optDay('Opening date'),
  }).nullable().optional(),
})

export const MANUAL_MOVEMENT_TYPES = ['ISSUE', 'RETURN', 'ADJUST_IN', 'ADJUST_OUT', 'DAMAGED', 'OPENING']

/** Permission needed to post each manual movement type. */
export const MOVEMENT_PERMISSION = {
  ISSUE: 'inventory.assign',
  RETURN: 'inventory.assign',
  ADJUST_IN: 'inventory.manage',
  ADJUST_OUT: 'inventory.manage',
  DAMAGED: 'inventory.manage',
  OPENING: 'inventory.manage',
}

export const movementSchema = z.object({
  type:         z.enum(MANUAL_MOVEMENT_TYPES, { errorMap: () => ({ message: 'Choose Issue, Return, Adjustment, Damaged or Opening' }) }),
  qty:          z.coerce.number({ invalid_type_error: 'Quantity must be a number' }).finite('Quantity must be a number')
    .positive('Quantity must be more than 0').max(1e7, 'Quantity is too large'),
  unitCost:     z.preprocess(v => (blank(v) ? null : v), z.coerce.number({ invalid_type_error: 'Unit cost must be a number' })
    .finite().min(0, 'Unit cost cannot be negative').max(1e9).nullable()).optional(),
  employeeId:   optId('employee'),
  departmentId: optId('department'),
  projectId:    optId('project'),
  reason:       optText(500, 'Reason'),
  reference:    optText(120, 'Reference'),
  date:         optDay('Date'),
})

/** Reference checks for stock-item create / update (consumable category, active location, vendor). */
export async function checkItemRefs({ categoryId, locationId, preferredVendorId }) {
  if (categoryId) {
    const cat = await AssetCategory.findById(categoryId).select('name type isActive').lean()
    if (!cat) throw httpError(422, 'Category not found')
    if (cat.isActive === false) throw httpError(422, `Category "${cat.name}" is inactive`)
    if (cat.type !== 'CONSUMABLE') throw httpError(422, `"${cat.name}" is an asset category — stock items use consumable categories`)
  }
  if (locationId) {
    const loc = await InventoryLocation.findById(locationId).select('isActive name').lean()
    if (!loc) throw httpError(422, 'Location not found')
    if (loc.isActive === false) throw httpError(422, `Location "${loc.name}" is inactive`)
  }
  if (preferredVendorId && !(await Vendor.exists({ _id: preferredVendorId }))) throw httpError(422, 'Vendor not found')
}

// ── serialisers ──────────────────────────────────────────────────────────────

/** 'INACTIVE' | 'OUT' | 'LOW' | 'OK' */
export function stockStatus(item) {
  if (item?.isActive === false) return 'INACTIVE'
  const qty = num(item?.qtyOnHand)
  const level = num(item?.reorderLevel)
  if (qty <= 0) return 'OUT'
  if (level > 0 && qty <= level) return 'LOW'
  return 'OK'
}

/** Lean StockItem (categoryId / locationId / preferredVendorId optionally populated) → API shape. */
export function serializeItem(it) {
  if (!it) return null
  const cat = it.categoryId && typeof it.categoryId === 'object' && it.categoryId.name ? it.categoryId : null
  const loc = it.locationId && typeof it.locationId === 'object' && it.locationId.name ? it.locationId : null
  const ven = it.preferredVendorId && typeof it.preferredVendorId === 'object' && it.preferredVendorId.company ? it.preferredVendorId : null
  return {
    id: sid(it._id),
    sku: it.sku,
    name: it.name,
    unit: it.unit || 'pcs',
    categoryId: sid(it.categoryId),
    category: cat ? { id: sid(cat._id), name: cat.name, code: cat.code ?? null, type: cat.type ?? null } : null,
    locationId: sid(it.locationId),
    location: loc ? { id: sid(loc._id), name: loc.name } : null,
    preferredVendorId: sid(it.preferredVendorId),
    preferredVendor: ven ? { id: sid(ven._id), company: ven.company } : null,
    reorderLevel: num(it.reorderLevel),
    reorderQty: num(it.reorderQty),
    qtyOnHand: num(it.qtyOnHand),
    avgCost: num(it.avgCost),
    stockValue: num(it.stockValue),
    isActive: it.isActive !== false,
    notes: it.notes ?? null,
    status: stockStatus(it),
    lowStockNotifiedAt: it.lowStockNotifiedAt ?? null,
    createdAt: it.createdAt ?? null,
    updatedAt: it.updatedAt ?? null,
  }
}

export const ITEM_POPULATE = [
  { path: 'categoryId', select: 'name code type' },
  { path: 'locationId', select: 'name' },
  { path: 'preferredVendorId', select: 'company' },
]

export const MOVEMENT_POPULATE = [
  { path: 'stockItemId', select: 'sku name unit' },
  { path: 'employeeId', select: 'userId employeeId', populate: { path: 'userId', select: 'name' } },
  { path: 'departmentId', select: 'name' },
  { path: 'projectId', select: 'name projectCode' },
  { path: 'purchaseBillId', select: 'billNo' },
  { path: 'createdBy', select: 'name' },
]

/** Lean StockMovement (populated with MOVEMENT_POPULATE) → API shape. */
export function serializeMovement(m) {
  if (!m) return null
  const item = m.stockItemId && typeof m.stockItemId === 'object' && m.stockItemId.sku ? m.stockItemId : null
  const emp = m.employeeId && typeof m.employeeId === 'object' && m.employeeId.userId !== undefined ? m.employeeId : null
  const dep = m.departmentId && typeof m.departmentId === 'object' && m.departmentId.name ? m.departmentId : null
  const prj = m.projectId && typeof m.projectId === 'object' && m.projectId.name ? m.projectId : null
  const bill = m.purchaseBillId && typeof m.purchaseBillId === 'object' && m.purchaseBillId.billNo ? m.purchaseBillId : null
  const by = m.createdBy && typeof m.createdBy === 'object' && m.createdBy.name ? m.createdBy : null
  return {
    id: sid(m._id),
    movementNo: m.movementNo ?? null,
    stockItemId: sid(m.stockItemId),
    item: item ? { id: sid(item._id), sku: item.sku, name: item.name, unit: item.unit || 'pcs' } : null,
    type: m.type,
    direction: m.direction,
    qty: num(m.qty),
    unitCost: num(m.unitCost),
    totalCost: num(m.totalCost),
    qtyAfter: m.qtyAfter ?? null,
    avgCostAfter: m.avgCostAfter ?? null,
    employeeId: sid(m.employeeId),
    employee: emp ? { id: sid(emp._id), name: emp.userId?.name ?? 'Employee', code: emp.employeeId ?? null } : null,
    departmentId: sid(m.departmentId),
    department: dep ? { id: sid(dep._id), name: dep.name } : null,
    projectId: sid(m.projectId),
    project: prj ? { id: sid(prj._id), name: prj.name, code: prj.projectCode ?? null } : null,
    purchaseBillId: sid(m.purchaseBillId),
    purchaseBill: bill ? { id: sid(bill._id), billNo: bill.billNo } : null,
    reason: m.reason ?? null,
    reference: m.reference ?? null,
    date: m.date,
    createdBy: by ? { id: sid(by._id), name: by.name } : null,
    createdAt: m.createdAt ?? null,
  }
}

// ── low-stock alert ──────────────────────────────────────────────────────────

/**
 * After an OUT movement: when the item is now at/below its reorder level (or
 * empty), claim the alert atomically (lowStockNotifiedAt null → now) and notify
 * active managers once. moveStock re-arms the alert when stock is received above
 * the level again.
 */
export async function notifyLowStock(result) {
  try {
    const item = result?.item
    if (!item || result.movement?.direction !== 'OUT' || !result.lowStock) return false
    const claim = await StockItem.updateOne(
      { _id: item._id, lowStockNotifiedAt: null },
      { $set: { lowStockNotifiedAt: new Date() } },
    )
    if (!claim.modifiedCount) return false
    const managers = await User.find({ role: { $in: ['SUPER_ADMIN', 'MANAGER'] }, isActive: { $ne: false } }).select('_id').lean()
    if (!managers.length) return false
    const qty = num(item.qtyOnHand)
    const level = num(item.reorderLevel)
    const unit = item.unit || 'pcs'
    await createNotification({
      userId: managers.map(u => String(u._id)),
      title: qty <= 0 ? `Out of stock: ${item.name}` : `Low stock: ${item.name}`,
      message: qty <= 0
        ? `${item.name} (${item.sku}) has run out.${num(item.reorderQty) > 0 ? ` Suggested reorder: ${num(item.reorderQty)} ${unit}.` : ''}`
        : `${item.name} (${item.sku}) is down to ${qty} ${unit} (reorder level ${level}).${num(item.reorderQty) > 0 ? ` Suggested reorder: ${num(item.reorderQty)} ${unit}.` : ''}`,
      type: 'ASSET',
      link: '/admin/inventory/stock?lowStock=1',
    })
    return true
  } catch (err) {
    console.error('[stock] low-stock alert failed', err)
    return false
  }
}

// ── CSV ──────────────────────────────────────────────────────────────────────

function csvCell(v) {
  if (v === null || v === undefined) return ''
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : ''
  let s = String(v)
  // Neutralise spreadsheet formulas (CSV injection).
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** text/csv download (UTF-8 with BOM so Excel shows ৳ and Bangla text correctly). */
export function csvResponse(filename, header, rows) {
  const body = [header, ...rows].map(r => r.map(csvCell).join(',')).join('\r\n')
  return new Response(`﻿${body}`, {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename.replace(/[^A-Za-z0-9._-]/g, '_')}"`,
    },
  })
}
