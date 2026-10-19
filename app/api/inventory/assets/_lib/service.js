/**
 * Server-only helpers shared by the asset API routes (app/api/inventory/assets/**).
 * Private folder (`_lib`) — not a route.
 */

import mongoose from 'mongoose'
import { NextResponse } from 'next/server'
import { canDoAny } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { dhakaDayKey, parseDhakaDay } from '@/lib/dhakaTime'
import { Asset, Employee } from '@/models'
import { bookValue } from '@/lib/inventory/constants'

/** Any inventory permission may read the register (the AssetPicker is used from several modules). */
export const READ_PERMS = ['inventory.view', 'inventory.manage', 'inventory.assign', 'inventory.dispose', 'inventory.audit']

export function httpError(status, message, extra = null) {
  const err = new Error(message)
  err.status = status
  if (extra) Object.assign(err, extra)
  return err
}

/** 401/403 response when the session cannot read the asset register, else null. */
export function guardRead(session) {
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!canDoAny(session, READ_PERMS)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return null
}

/** Map a thrown error to the house JSON error shape. */
export function errorResponse(err, label) {
  if (err?.status && err.status >= 400 && err.status < 500) {
    const body = { error: err.message }
    if (err.details) body.details = err.details
    if (err.code && typeof err.code === 'string') body.code = err.code
    return NextResponse.json(body, { status: err.status })
  }
  if (err?.name === 'ValidationError') {
    const msg = Object.values(err.errors ?? {}).map(e => e.message).join('; ') || 'Validation failed'
    return NextResponse.json({ error: msg }, { status: 422 })
  }
  if (err?.name === 'CastError') return NextResponse.json({ error: `Invalid ${err.path ?? 'value'}` }, { status: 400 })
  if (err?.code === 11000) return NextResponse.json({ error: 'A record with the same unique value already exists' }, { status: 409 })
  console.error(label, err)
  return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
}

/** Replace '' (and whitespace-only strings) with null, deeply. */
export function blankToNull(value) {
  if (typeof value === 'string') return value.trim() === '' ? null : value
  if (Array.isArray(value)) return value.map(blankToNull)
  if (value && typeof value === 'object' && !(value instanceof Date)) {
    const out = {}
    for (const [k, v] of Object.entries(value)) out[k] = blankToNull(v)
    return out
  }
  return value
}

/** Deep copy of a lean document with `_id` → `id` and ObjectIds → strings. */
export function toPlain(value) {
  if (value === null || value === undefined) return value
  if (value instanceof Date) return value
  if (value instanceof mongoose.Types.ObjectId || value?._bsontype === 'ObjectId') return value.toString()
  if (Array.isArray(value)) return value.map(toPlain)
  if (typeof value === 'object') {
    if (Buffer.isBuffer(value)) return value
    const out = {}
    for (const [k, v] of Object.entries(value)) {
      if (k === '__v') continue
      if (k === '_id') { out.id = v === null || v === undefined ? v : String(v); continue }
      out[k] = toPlain(v)
    }
    return out
  }
  return value
}

/** Flatten a populated Employee (userId → name) into a small, PII-free summary. */
export function employeeSummary(emp) {
  if (!emp) return null
  if (typeof emp !== 'object') return { id: String(emp), name: null, employeeId: null }
  const user = emp.userId && typeof emp.userId === 'object' ? emp.userId : null
  return {
    id:          String(emp.id ?? emp._id),
    employeeId:  emp.employeeId ?? null,
    name:        user?.name ?? emp.name ?? null,
    avatar:      user?.avatar ?? null,
    userId:      user ? String(user.id ?? user._id) : (emp.userId ? String(emp.userId) : null),
    designation: emp.designation ?? emp.position ?? null,
    department:  emp.department ?? null,
    isActive:    emp.isActive !== false && emp.resigned !== true,
  }
}

export const EMPLOYEE_POPULATE = {
  path: 'assignedEmployeeId',
  select: 'employeeId designation position department userId isActive resigned',
  populate: { path: 'userId', select: 'name avatar' },
}

export const LIST_POPULATE = [
  { path: 'categoryId', select: 'name code type taxClass' },
  { path: 'locationId', select: 'name code type' },
  EMPLOYEE_POPULATE,
  { path: 'assignedDepartmentId', select: 'name shortCode' },
]

export const DETAIL_POPULATE = [
  { path: 'categoryId', select: 'name code type taxClass depreciationMethod usefulLifeMonths residualPct capitalize requiresAcknowledgement inputVatCreditable isActive' },
  { path: 'locationId', select: 'name code type isActive' },
  EMPLOYEE_POPULATE,
  { path: 'assignedDepartmentId', select: 'name shortCode' },
  { path: 'purchase.vendorId', select: 'company' },
  { path: 'purchase.billId', select: 'billNo status billDate' },
  { path: 'purchase.expenseId', select: 'expenseId status amount' },
  { path: 'disposal.accountId', select: 'name type last4 currency' },
  { path: 'disposal.approvedBy', select: 'name' },
  { path: 'createdBy', select: 'name' },
  { path: 'updatedBy', select: 'name' },
]

/** API shape of a (lean, populated) asset. */
export function serializeAsset(lean) {
  if (!lean) return null
  const a = toPlain(lean)
  if (a.assignedEmployeeId && typeof a.assignedEmployeeId === 'object') {
    a.assignedEmployeeId = employeeSummary(a.assignedEmployeeId)
  }
  a.bookValue = bookValue(a)
  a.acknowledgement = a.acknowledgement ?? { status: 'NOT_REQUIRED', at: null, note: null, eventId: null }
  a.depreciation = a.depreciation ?? {}
  a.purchase = a.purchase ?? {}
  a.opening = a.opening ?? {}
  return a
}

/** Load one asset (lean + populated) or throw 404. */
export async function loadAsset(id, { populate = DETAIL_POPULATE } = {}) {
  if (!isValidObjectId(id)) throw httpError(404, 'Not found')
  let q = Asset.findById(id)
  for (const p of populate) q = q.populate(p)
  const asset = await q.lean()
  if (!asset) throw httpError(404, 'Not found')
  return asset
}

/** The Employee record of the signed-in user (null when none). */
export async function employeeOfSession(session) {
  const uid = session?.user?.id
  if (!uid || !isValidObjectId(uid)) return null
  return Employee.findOne({ userId: uid }).select('_id userId employeeId').lean()
}

/** Today in Dhaka ('YYYY-MM-DD'). */
export const todayKey = () => dhakaDayKey(new Date())

/**
 * Instant to store for an event / assignment on a 'YYYY-MM-DD' day: today keeps
 * the current time (keeps the timeline ordered), other days are Dhaka midnight.
 */
export function eventInstant(dayKey) {
  if (!dayKey || dayKey === todayKey()) return new Date()
  return parseDhakaDay(dayKey)?.start ?? new Date()
}

/** 'YYYY-MM-DD' of a stored date (Dhaka). */
export function dayKeyOf(date) {
  if (!date) return null
  const d = new Date(date)
  return Number.isNaN(d.getTime()) ? null : dhakaDayKey(d)
}

/** CSV cell: quoted, with spreadsheet formula injection neutralised. */
export function csvCell(value) {
  if (value === null || value === undefined) return ''
  let s = value instanceof Date ? dhakaDayKey(value) : String(value)
  if (/^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export function csvLine(cells) {
  return cells.map(csvCell).join(',')
}

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Serial numbers already used by other assets (case-insensitive exact match).
 * @returns {Promise<Array<{ serial, assetTag, id }>>}
 */
export async function findSerialConflicts(serials, { excludeId = null } = {}) {
  const list = [...new Set((serials || []).map(s => String(s ?? '').trim()).filter(Boolean))]
  if (!list.length) return []
  const filter = { $or: list.map(s => ({ serialNumber: { $regex: `^${escapeRegex(s)}$`, $options: 'i' } })) }
  if (excludeId) filter._id = { $ne: excludeId }
  const rows = await Asset.find(filter).select('assetTag serialNumber').limit(20).lean()
  return rows.map(r => ({ serial: r.serialNumber, assetTag: r.assetTag, id: String(r._id) }))
}

/** Company profile from Setting group 'company' (for printed documents). */
export function companyFromSettings(rows) {
  const cfg = {}
  for (const r of rows || []) cfg[r.key] = r.value
  return {
    name:    cfg.company_name    || 'Enfinito Bangladesh',
    address: cfg.company_address || '',
    phone:   cfg.company_phone   || '',
    email:   cfg.company_email   || '',
    website: cfg.company_website || '',
    bin:     cfg.company_bin     || '',
  }
}

/**
 * Absolute app origin for links printed on paper (QR labels): the configured
 * public URL when set, else the origin of the current request.
 */
export function appOrigin(request) {
  for (const raw of [process.env.NEXT_PUBLIC_APP_URL, process.env.NEXTAUTH_URL]) {
    const v = String(raw ?? '').trim()
    if (!v) continue
    try {
      const u = new URL(v)
      if (u.protocol === 'http:' || u.protocol === 'https:') return u.origin
    } catch { /* ignore malformed env */ }
  }
  return new URL(request.url).origin
}

/** Strict security headers for printable HTML routes (only our nonce'd script may run). */
export function printHeaders(nonce, filename) {
  return {
    'Content-Type': 'text/html; charset=utf-8',
    'Content-Security-Policy': `default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; script-src 'nonce-${nonce}'; base-uri 'self'; form-action 'none'; frame-ancestors 'self'`,
    'Content-Disposition': `inline; filename="${String(filename).replace(/[^\w.-]/g, '_')}"`,
  }
}

export const fmtDay = (d) =>
  d ? new Date(d).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'Asia/Dhaka' }) : '—'

export function fmtTk(amount) {
  const n = Number(amount)
  if (!Number.isFinite(n)) return '—'
  return `Tk ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}
