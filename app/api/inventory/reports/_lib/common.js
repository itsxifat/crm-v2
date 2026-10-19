/**
 * Shared SERVER helpers for the I3 inventory routes (categories, locations,
 * depreciation, summary, opening import, reports). Not a route — the `_lib`
 * folder is private to the app router.
 */

import { NextResponse } from 'next/server'
import mongoose from 'mongoose'
import { Employee, InventoryLocation, AssetCategory, Department } from '@/models'
import { dhakaDayKey, parseDhakaDay } from '@/lib/dhakaTime'
import { isDayKey, dayKeyLabel, fiscalYearOf, fiscalYearRange } from '@/lib/finance/fiscal'

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100

/** Finite number or 0. */
export const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export function httpError(status, message, extra = {}) {
  const err = new Error(message)
  err.status = status
  Object.assign(err, extra)
  return err
}

/**
 * Map a thrown error to the house JSON error shape. Library errors carry
 * `.status` (400/404/409/422); Mongoose validation / cast / duplicate-key
 * errors are translated; anything else is logged and returned as 500.
 */
export function errorResponse(err, tag) {
  const status = Number(err?.status)
  if (status >= 400 && status < 500) {
    const body = { error: err.message || 'Request failed' }
    if (err.details) body.details = err.details
    if (err.code && typeof err.code === 'string') body.code = err.code
    return NextResponse.json(body, { status })
  }
  if (err?.name === 'ValidationError') {
    const first = err.errors ? Object.values(err.errors)[0]?.message : null
    return NextResponse.json({ error: first || 'Validation failed' }, { status: 422 })
  }
  if (err?.name === 'CastError') {
    return NextResponse.json({ error: `Invalid value for ${err.path || 'a field'}` }, { status: 400 })
  }
  if (err?.code === 11000) {
    const field = Object.keys(err.keyPattern ?? err.keyValue ?? {})[0]
    return NextResponse.json({ error: field ? `A record with this ${field} already exists` : 'Duplicate record' }, { status: 409 })
  }
  console.error(tag, err)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

/** String id of an ObjectId / populated doc / string (null when absent). */
export function idStr(v) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'string') return v
  if (v instanceof mongoose.Types.ObjectId) return v.toString()
  if (typeof v === 'object' && v._id) return String(v._id)
  if (typeof v === 'object' && typeof v.id === 'string') return v.id
  return String(v)
}

/** 'YYYY-MM-DD' (Dhaka) of a date-ish value, or null. */
export function dayKeyOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const d = value instanceof Date ? value : new Date(value)
  return Number.isNaN(d.getTime()) ? null : dhakaDayKey(d)
}

export const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** Trimmed string or null. */
export function cleanText(v, max = 500) {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  if (!s) return null
  return s.length > max ? s.slice(0, max) : s
}

/** Truthy flag from query strings / CSV cells ('1', 'true', 'yes', 'y'). */
export function isTruthy(v) {
  if (typeof v === 'boolean') return v
  return ['1', 'true', 'yes', 'y', 'on'].includes(String(v ?? '').trim().toLowerCase())
}

// ── Reference-data lookups ───────────────────────────────────────────────────

/**
 * Employees by id ⇒ Map(id → { id, name, employeeId, department, designation }).
 * The display name lives on the linked User.
 */
export async function loadEmployeeMap(ids) {
  const list = [...new Set((ids || []).map(idStr).filter(id => id && mongoose.isValidObjectId(id)))]
  const map = new Map()
  if (!list.length) return map
  const rows = await Employee.find({ _id: { $in: list } })
    .select('employeeId department designation userId')
    .populate('userId', 'name')
    .lean()
  for (const e of rows) {
    map.set(String(e._id), {
      id: String(e._id),
      name: e.userId?.name ?? null,
      employeeId: e.employeeId ?? null,
      department: e.department ?? null,
      designation: e.designation ?? null,
    })
  }
  return map
}

/** 'Name (EMP-001)' for an employee map entry. */
export function employeeLabel(e) {
  if (!e) return null
  const name = e.name || e.employeeId || 'Employee'
  return e.employeeId && e.name ? `${name} (${e.employeeId})` : name
}

export async function loadDepartmentMap(ids) {
  const list = [...new Set((ids || []).map(idStr).filter(id => id && mongoose.isValidObjectId(id)))]
  const map = new Map()
  if (!list.length) return map
  const rows = await Department.find({ _id: { $in: list } }).select('name').lean()
  for (const d of rows) map.set(String(d._id), { id: String(d._id), name: d.name })
  return map
}

/** All locations ⇒ Map(id → { id, name, code, type, parentId, isActive, path, depth }). */
export async function loadLocationMap() {
  const rows = await InventoryLocation.find({}).select('name code type parentId isActive address notes').lean()
  const byId = new Map(rows.map(r => [String(r._id), r]))
  const map = new Map()
  for (const r of rows) {
    const names = []
    let cursor = r
    const seen = new Set()
    while (cursor && !seen.has(String(cursor._id)) && names.length < 25) {
      seen.add(String(cursor._id))
      names.unshift(cursor.name)
      cursor = cursor.parentId ? byId.get(String(cursor.parentId)) : null
    }
    map.set(String(r._id), {
      id: String(r._id),
      name: r.name,
      code: r.code ?? null,
      type: r.type,
      parentId: r.parentId ? String(r.parentId) : null,
      isActive: r.isActive !== false,
      address: r.address ?? null,
      notes: r.notes ?? null,
      path: names.join(' › '),
      depth: names.length - 1,
    })
  }
  return map
}

/** All categories ⇒ Map(id → lean category). */
export async function loadCategoryMap() {
  const rows = await AssetCategory.find({}).lean()
  return new Map(rows.map(c => [String(c._id), c]))
}

// ── Date ranges ──────────────────────────────────────────────────────────────

const FY_PARAM_RE = /^\d{4}(-\d{2})?$/

/**
 * Report date range from query params: start/end ('YYYY-MM-DD', inclusive)
 * win; otherwise fy ('2026-27'); otherwise the current fiscal year.
 * Returns { mode, fy, start, next, startDay, endDay, label } where start/next
 * are Dhaka-midnight instants (filter with $gte start / $lt next).
 */
export function resolveRange(searchParams, startMonth = 7) {
  const startDay = searchParams.get('start')
  const endDay = searchParams.get('end')
  if (startDay || endDay) {
    if (!isDayKey(startDay) || !isDayKey(endDay)) throw httpError(422, 'Give both start and end dates as YYYY-MM-DD')
    if (startDay > endDay) throw httpError(422, 'The start date must be on or before the end date')
    return {
      mode: 'range',
      fy: null,
      start: parseDhakaDay(startDay).start,
      next: parseDhakaDay(endDay).next,
      startDay,
      endDay,
      label: `${dayKeyLabel(startDay)} – ${dayKeyLabel(endDay)}`,
    }
  }
  const fyParam = searchParams.get('fy')
  if (fyParam && !FY_PARAM_RE.test(fyParam.trim())) throw httpError(422, 'Fiscal year must look like 2026-27')
  const fy = fyParam ? fyParam.trim() : fiscalYearOf(new Date(), startMonth)
  const r = fiscalYearRange(fy, startMonth)
  if (!r) throw httpError(422, 'Invalid fiscal year')
  return {
    mode: 'fy',
    fy: r.fy,
    start: r.start,
    next: r.next,
    startDay: r.startDay,
    endDay: r.endDay,
    label: `FY ${r.fy} (${dayKeyLabel(r.startDay)} – ${dayKeyLabel(r.endDay)})`,
  }
}

/** Fiscal-year range for a label (throws 422 when invalid). */
export function fiscalRangeOf(fyParam, startMonth = 7) {
  const fy = fyParam ? String(fyParam).trim() : fiscalYearOf(new Date(), startMonth)
  if (!FY_PARAM_RE.test(fy)) throw httpError(422, 'Fiscal year must look like 2026-27')
  const r = fiscalYearRange(fy, startMonth)
  if (!r) throw httpError(422, 'Invalid fiscal year')
  return {
    mode: 'fy',
    fy: r.fy,
    start: r.start,
    next: r.next,
    startDay: r.startDay,
    endDay: r.endDay,
    startPeriod: r.startPeriod,
    endPeriod: r.endPeriod,
    label: `FY ${r.fy} (${dayKeyLabel(r.startDay)} – ${dayKeyLabel(r.endDay)})`,
  }
}

export { dayKeyLabel }
