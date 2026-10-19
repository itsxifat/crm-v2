/**
 * Server-only helpers for physical-audit sessions (I4).
 * `_lib` is a private folder: Next.js never routes it.
 */

import mongoose from 'mongoose'
import { NextResponse } from 'next/server'
import { Asset, Employee, InventoryLocation, User } from '@/models'
import { canDoAny } from '@/lib/rbac'

/** Either permission opens audits (the page route accepts both too). */
export const AUDIT_PERMS = ['inventory.audit', 'inventory.manage']

/** Most expected assets one audit session may snapshot (keeps the document well under 16 MB). */
export const MAX_AUDIT_LINES = 5000

/** 401/403 response, or null to proceed. */
export function auditGuard(session) {
  if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
  if (!canDoAny(session, AUDIT_PERMS)) return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  return null
}

export const oid = (v) => new mongoose.Types.ObjectId(String(v))

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/**
 * Turn raw scanner / keyboard input into a lookup key.
 * QR labels encode `${origin}/admin/inventory/assets/tag/EN-LAP-00042`; a link to
 * an asset page carries its id. Anything else is treated as a tag or serial number.
 * @returns {{ tag: string|null, assetId: string|null, raw: string }}
 */
export function parseScan(input) {
  const raw = String(input ?? '').trim()
  if (!raw) return { tag: null, assetId: null, raw }
  const tagUrl = raw.match(/\/assets\/tag\/([^/?#\s]+)/i)
  if (tagUrl) {
    let t = tagUrl[1]
    try { t = decodeURIComponent(t) } catch { /* keep as is */ }
    return { tag: t.replace(/\s+/g, '').toUpperCase(), assetId: null, raw }
  }
  const idUrl = raw.match(/\/assets\/([a-f0-9]{24})(?:[/?#]|$)/i)
  if (idUrl) return { tag: null, assetId: idUrl[1].toLowerCase(), raw }
  return { tag: raw.replace(/\s+/g, '').toUpperCase(), assetId: null, raw }
}

/** Exact, case-insensitive serial-number match (labels missing ⇒ scan the maker's barcode). */
export function serialQuery(serial) {
  return { serialNumber: { $regex: `^${escapeRegex(String(serial).trim())}$`, $options: 'i' } }
}

const countOf = (result) => ({
  $size: { $filter: { input: '$lines', as: 'l', cond: { $eq: ['$$l.result', result] } } },
})

/** Pipeline stage that recomputes `summary` from `lines` (keeps it exact under concurrent scans). */
export const SUMMARY_STAGE = {
  $set: {
    summary: {
      total:         { $size: '$lines' },
      found:         countOf('FOUND'),
      missing:       countOf('MISSING'),
      wrongLocation: countOf('WRONG_LOCATION'),
      damaged:       countOf('DAMAGED'),
      pending:       countOf('PENDING'),
    },
    updatedAt: '$$NOW',
  },
}

/**
 * Pipeline stage that merges `patch` into the line for `assetId`. Every value is
 * wrapped in $literal so user text such as "$100" is never read as a field path.
 */
export function lineMergeStage(assetId, patch) {
  const lit = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, { $literal: v === undefined ? null : v }]))
  return {
    $set: {
      lines: {
        $map: {
          input: '$lines',
          as: 'l',
          in: { $cond: [{ $eq: ['$$l.assetId', oid(assetId)] }, { $mergeObjects: ['$$l', lit] }, '$$l'] },
        },
      },
    },
  }
}

/** All locations as id → { id, name, code, parentId }. Location lists are small. */
export async function locationMap() {
  const rows = await InventoryLocation.find({}).select('name code parentId isActive type').lean()
  return new Map(rows.map(r => [String(r._id), { id: String(r._id), name: r.name, code: r.code ?? null, parentId: r.parentId ? String(r.parentId) : null, isActive: r.isActive !== false, type: r.type }]))
}

/** Location ids of `rootId` and every descendant. */
export function descendantIds(rootId, locs) {
  const root = String(rootId)
  const out = new Set([root])
  let grew = true
  while (grew) {
    grew = false
    for (const l of locs.values()) {
      if (l.parentId && out.has(l.parentId) && !out.has(l.id)) { out.add(l.id); grew = true }
    }
  }
  return [...out]
}

/** True when `childId` is `ancestorId` or sits somewhere below it. */
export function isWithin(childId, ancestorId, locs) {
  if (!childId || !ancestorId) return false
  let cur = String(childId)
  for (let i = 0; cur && i < 50; i++) {
    if (cur === String(ancestorId)) return true
    cur = locs.get(cur)?.parentId ?? null
  }
  return false
}

/** "Head office › Floor 2 › Room A" */
export function locationPath(id, locs) {
  const parts = []
  let cur = id ? String(id) : null
  for (let i = 0; cur && i < 10; i++) {
    const l = locs.get(cur)
    if (!l) break
    parts.unshift(l.name)
    cur = l.parentId
  }
  return parts.join(' › ') || null
}

const str = (v) => (v === null || v === undefined ? null : String(v))

/** One audit line in API shape (needs the lookup maps from buildAuditDetail). */
export function lineView(l, { assets, locs, emps, users }) {
  const a = assets.get(str(l.assetId))
  const emp = l.expectedEmployeeId ? emps.get(str(l.expectedEmployeeId)) : null
  return {
    assetId:          str(l.assetId),
    assetTag:         l.assetTag ?? a?.assetTag ?? null,
    assetName:        l.assetName ?? a?.name ?? null,
    result:           l.result ?? 'PENDING',
    condition:        l.condition ?? null,
    note:             l.note ?? null,
    checkedAt:        l.checkedAt ?? null,
    checkedByName:    l.checkedBy ? users.get(str(l.checkedBy)) ?? null : null,
    expectedLocation: l.expectedLocationId ? { id: str(l.expectedLocationId), name: locationPath(l.expectedLocationId, locs) } : null,
    foundLocation:    l.foundLocationId ? { id: str(l.foundLocationId), name: locationPath(l.foundLocationId, locs) } : null,
    expectedEmployee: emp,
    asset: a ? {
      id:           str(a._id),
      serialNumber: a.serialNumber ?? null,
      brand:        a.brand ?? null,
      model:        a.model ?? null,
      status:       a.status,
      condition:    a.condition ?? null,
      category:     a.categoryId && typeof a.categoryId === 'object' ? { id: str(a.categoryId._id), name: a.categoryId.name, code: a.categoryId.code } : null,
    } : null,
  }
}

/** Lookup maps for a set of lean audit lines. */
export async function lineLookups(lines, extraUserIds = []) {
  const assetIds = [...new Set(lines.map(l => str(l.assetId)).filter(Boolean))]
  const empIds   = [...new Set(lines.map(l => str(l.expectedEmployeeId)).filter(Boolean))]
  const userIds  = [...new Set([...lines.map(l => str(l.checkedBy)), ...extraUserIds.map(str)].filter(Boolean))]
  const [assetRows, empRows, userRows, locs] = await Promise.all([
    assetIds.length
      ? Asset.find({ _id: { $in: assetIds } }).select('assetTag name serialNumber brand model status condition categoryId')
        .populate({ path: 'categoryId', select: 'name code' }).lean()
      : [],
    empIds.length
      ? Employee.find({ _id: { $in: empIds } }).select('employeeId userId').populate({ path: 'userId', select: 'name' }).lean()
      : [],
    userIds.length ? User.find({ _id: { $in: userIds } }).select('name').lean() : [],
    locationMap(),
  ])
  return {
    assets: new Map(assetRows.map(a => [str(a._id), a])),
    emps:   new Map(empRows.map(e => [str(e._id), { id: str(e._id), name: e.userId?.name ?? null, employeeId: e.employeeId ?? null }])),
    users:  new Map(userRows.map(u => [str(u._id), u.name])),
    locs,
  }
}

/** Full API view of an audit document (lean). */
export async function buildAuditDetail(audit) {
  const lines = audit.lines ?? []
  const maps = await lineLookups(lines, [audit.createdBy, audit.completedBy])
  const categoryName = audit.categoryId && typeof audit.categoryId === 'object' ? audit.categoryId.name : null
  return {
    id:          str(audit._id),
    auditNo:     audit.auditNo ?? null,
    name:        audit.name,
    status:      audit.status,
    location:    audit.locationId ? { id: str(audit.locationId?._id ?? audit.locationId), name: locationPath(audit.locationId?._id ?? audit.locationId, maps.locs) } : null,
    category:    audit.categoryId ? { id: str(audit.categoryId?._id ?? audit.categoryId), name: categoryName } : null,
    startedAt:   audit.startedAt ?? audit.createdAt ?? null,
    completedAt: audit.completedAt ?? null,
    createdBy:   audit.createdBy ? { id: str(audit.createdBy), name: maps.users.get(str(audit.createdBy)) ?? null } : null,
    completedBy: audit.completedBy ? { id: str(audit.completedBy), name: maps.users.get(str(audit.completedBy)) ?? null } : null,
    notes:       audit.notes ?? null,
    summary:     summaryOf(lines),
    lines:       lines.map(l => lineView(l, maps)),
    unexpected:  (audit.unexpected ?? []).map((u, index) => ({ index, tag: u.tag ?? null, description: u.description ?? null, note: u.note ?? null })),
    createdAt:   audit.createdAt ?? null,
    updatedAt:   audit.updatedAt ?? null,
  }
}

/** Summary computed from lines (same rules as AssetAudit.recomputeSummary). */
export function summaryOf(lines = []) {
  const s = { total: 0, found: 0, missing: 0, wrongLocation: 0, damaged: 0, pending: 0 }
  for (const l of lines) {
    s.total++
    if (l.result === 'FOUND') s.found++
    else if (l.result === 'MISSING') s.missing++
    else if (l.result === 'WRONG_LOCATION') s.wrongLocation++
    else if (l.result === 'DAMAGED') s.damaged++
    else s.pending++
  }
  return s
}
