export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Asset, AssetAudit, AssetCategory, User } from '@/models'
import { SCOPE_INDEX } from '@/models/AssetAudit'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { codeContains } from '@/lib/codes'
import { ensureCategoriesSeeded } from '@/lib/inventory/assets'
import { NON_TERMINAL_STATUSES, AUDIT_STATUSES } from '@/lib/inventory/constants'
import { auditGuard, oid, locationMap, descendantIds, locationPath, MAX_AUDIT_LINES } from './_lib/audit'
import { z } from 'zod'

const optionalId = z.preprocess(
  v => (v === '' || v === undefined ? null : v),
  z.string().refine(isValidObjectId, 'Invalid id').nullable(),
)

const createSchema = z.object({
  name:          z.string().trim().max(120, 'Keep the name under 120 characters').optional().nullable(),
  locationId:    optionalId.optional(),
  categoryId:    optionalId.optional(),
  includeRepair: z.boolean().optional().default(false),
  includeLost:   z.boolean().optional().default(false),
  notes:         z.string().trim().max(2000).optional().nullable(),
})

const flag = (v) => v === '1' || v === 'true'

/** Statuses an audit expects to find on the floor. */
function scopeStatuses({ includeRepair = false, includeLost = false } = {}) {
  return NON_TERMINAL_STATUSES.filter(s =>
    (includeRepair || s !== 'IN_REPAIR') && (includeLost || !['LOST', 'STOLEN'].includes(s)))
}

/** Mongo filter for the assets an audit with this scope expects (location includes sub-locations). */
async function scopeFilter({ locationId, categoryId, includeRepair, includeLost }, locs) {
  const filter = { status: { $in: scopeStatuses({ includeRepair, includeLost }) }, isArchived: { $ne: true } }
  if (categoryId) filter.categoryId = oid(categoryId)
  if (locationId) filter.locationId = { $in: descendantIds(locationId, locs ?? await locationMap()).map(oid) }
  return filter
}

const MONTH = (d) => new Date(d).toLocaleDateString('en-GB', { month: 'short', year: 'numeric', timeZone: 'Asia/Dhaka' })

/** The IN_PROGRESS audit for exactly this scope (other than `exceptId`), or null. */
function runningAudit(locationId, categoryId, exceptId = null) {
  return AssetAudit.findOne({
    status: 'IN_PROGRESS',
    locationId: locationId ?? null,
    categoryId: categoryId ?? null,
    ...(exceptId ? { _id: { $ne: exceptId } } : {}),
  }).sort({ _id: 1 }).select('auditNo').lean()
}

/** 409 for "this scope already has a running audit" (auditId lets the page offer to open it). */
function scopeClash(clash) {
  return NextResponse.json({
    error: `${clash?.auditNo ? `Audit ${clash.auditNo}` : 'An audit'} is already running for this scope — continue it or cancel it first`,
    ...(clash ? { auditId: String(clash._id) } : {}),
  }, { status: 409 })
}

/** E11000 raised by the one-running-audit-per-scope index (not the auditNo one). */
function isScopeDuplicate(err) {
  if (err?.code !== 11000) return false
  const keys = Object.keys(err.keyPattern ?? err.keyValue ?? {})
  return keys.includes('locationId') || keys.includes('categoryId') || String(err.message ?? '').includes(SCOPE_INDEX)
}

// GET /api/inventory/audits
//   ?options=1                                   → { data: { locations, categories } } for the new-audit form
//   ?preview=1&locationId&categoryId&includeRepair=1&includeLost=1 → { data: { expected, byStatus } }
//   ?status=IN_PROGRESS|COMPLETED|CANCELLED&search=&page=&limit= → { data: [audit rows], meta }
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = auditGuard(session)
    if (denied) return denied

    await connectDB()
    const { searchParams } = new URL(request.url)

    if (flag(searchParams.get('options'))) {
      await ensureCategoriesSeeded()
      const [locs, categories] = await Promise.all([
        locationMap(),
        AssetCategory.find({ isActive: { $ne: false }, type: { $ne: 'CONSUMABLE' } }).sort({ sortOrder: 1, name: 1 }).select('name code').lean(),
      ])
      const locations = [...locs.values()]
        .filter(l => l.isActive)
        .map(l => ({ id: l.id, name: l.name, code: l.code, type: l.type, parentId: l.parentId, path: locationPath(l.id, locs) }))
        .sort((a, b) => a.path.localeCompare(b.path))
      return NextResponse.json({
        data: {
          locations,
          categories: categories.map(c => ({ id: String(c._id), name: c.name, code: c.code })),
        },
      })
    }

    if (flag(searchParams.get('preview'))) {
      const locationId = searchParams.get('locationId') || null
      const categoryId = searchParams.get('categoryId') || null
      if ((locationId && !isValidObjectId(locationId)) || (categoryId && !isValidObjectId(categoryId))) {
        return NextResponse.json({ error: 'Invalid location or category' }, { status: 400 })
      }
      const filter = await scopeFilter({
        locationId, categoryId,
        includeRepair: flag(searchParams.get('includeRepair')),
        includeLost: flag(searchParams.get('includeLost')),
      })
      const rows = await Asset.aggregate([{ $match: filter }, { $group: { _id: '$status', n: { $sum: 1 } } }])
      const byStatus = Object.fromEntries(rows.map(r => [r._id, r.n]))
      return NextResponse.json({ data: { expected: rows.reduce((s, r) => s + r.n, 0), byStatus } })
    }

    const page   = Math.max(1, parseInt(searchParams.get('page') ?? '1', 10) || 1)
    const limit  = Math.min(100, Math.max(1, parseInt(searchParams.get('limit') ?? '20', 10) || 20))
    const status = searchParams.get('status')
    const search = (searchParams.get('search') ?? '').trim()

    const filter = {}
    if (status) {
      if (!AUDIT_STATUSES.includes(status)) return NextResponse.json({ error: 'Invalid status' }, { status: 400 })
      filter.status = status
    }
    if (search) {
      const rx = { $regex: search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), $options: 'i' }
      // Audit numbers match with separators ignored (AUD-2610-001 = AUD2610001).
      const no = codeContains(search)
      filter.$or = [...(no ? [{ auditNo: no }] : []), { name: rx }]
    }

    const [rows, total, counts, locs] = await Promise.all([
      AssetAudit.find(filter)
        .select('-lines')
        .sort({ createdAt: -1 })
        .skip((page - 1) * limit)
        .limit(limit)
        .populate({ path: 'categoryId', select: 'name code' })
        .lean(),
      AssetAudit.countDocuments(filter),
      AssetAudit.aggregate([{ $group: { _id: '$status', n: { $sum: 1 } } }]),
      locationMap(),
    ])

    const userIds = [...new Set(rows.flatMap(r => [r.createdBy, r.completedBy]).filter(Boolean).map(String))]
    const users = userIds.length ? await User.find({ _id: { $in: userIds } }).select('name').lean() : []
    const userName = new Map(users.map(u => [String(u._id), u.name]))

    const data = rows.map(r => ({
      id:          String(r._id),
      auditNo:     r.auditNo ?? null,
      name:        r.name,
      status:      r.status,
      location:    r.locationId ? { id: String(r.locationId), name: locationPath(r.locationId, locs) } : null,
      category:    r.categoryId && typeof r.categoryId === 'object' ? { id: String(r.categoryId._id), name: r.categoryId.name } : null,
      summary:     r.summary ?? { total: 0, found: 0, missing: 0, wrongLocation: 0, damaged: 0, pending: 0 },
      unexpectedCount: (r.unexpected ?? []).length,
      startedAt:   r.startedAt ?? r.createdAt,
      completedAt: r.completedAt ?? null,
      createdByName:   r.createdBy ? userName.get(String(r.createdBy)) ?? null : null,
      completedByName: r.completedBy ? userName.get(String(r.completedBy)) ?? null : null,
      notes:       r.notes ?? null,
    }))

    return NextResponse.json({
      data,
      meta: {
        page, limit, total, pages: Math.max(1, Math.ceil(total / limit)),
        counts: Object.fromEntries(counts.map(c => [c._id, c.n])),
      },
    })
  } catch (err) {
    console.error('[GET /api/inventory/audits]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}

// POST /api/inventory/audits  { name?, locationId?, categoryId?, includeRepair?, includeLost?, notes? }
// Starts a session and snapshots the assets expected in scope (non-terminal,
// not archived; location scope includes sub-locations).
// → 201 { data: { id, auditNo, expected } }
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = auditGuard(session)
    if (denied) return denied

    let body
    try { body = await request.json() } catch { body = {} }
    const parsed = createSchema.safeParse(body ?? {})
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }
    const { locationId = null, categoryId = null, includeRepair, includeLost } = parsed.data

    await connectDB()

    const locs = await locationMap()
    const location = locationId ? locs.get(String(locationId)) : null
    if (locationId && !location) return NextResponse.json({ error: 'Location not found' }, { status: 422 })
    const category = categoryId ? await AssetCategory.findById(categoryId).select('name code type').lean() : null
    if (categoryId && !category) return NextResponse.json({ error: 'Category not found' }, { status: 422 })

    // One running audit per scope — two would double-count and write duplicate audit events.
    // Fast path here; the partial unique index on AssetAudit settles a simultaneous start.
    const clash = await runningAudit(locationId, categoryId)
    if (clash) return scopeClash(clash)

    const filter = await scopeFilter({ locationId, categoryId, includeRepair, includeLost }, locs)
    const total = await Asset.countDocuments(filter)
    if (total === 0) return NextResponse.json({ error: 'No assets are registered in this scope' }, { status: 422 })
    if (total > MAX_AUDIT_LINES) {
      return NextResponse.json({ error: `${total} assets are in scope — pick a location or category to keep each audit under ${MAX_AUDIT_LINES}` }, { status: 422 })
    }

    const assets = await Asset.find(filter).select('assetTag name locationId assignedEmployeeId').sort({ assetTag: 1 }).lean()
    const scopeLabel = [location ? locationPath(location.id, locs) : 'All locations', category?.name].filter(Boolean).join(' · ')
    const name = parsed.data.name?.trim() || `${scopeLabel} — ${MONTH(new Date())}`

    let audit
    try {
      audit = await new AssetAudit({
        name,
        locationId: locationId ?? null,
        categoryId: categoryId ?? null,
        status:     'IN_PROGRESS',
        startedAt:  new Date(),
        lines: assets.map(a => ({
          assetId:            a._id,
          assetTag:           a.assetTag,
          assetName:          a.name,
          expectedLocationId: a.locationId ?? null,
          expectedEmployeeId: a.assignedEmployeeId ?? null,
          result:             'PENDING',
        })),
        notes:     parsed.data.notes?.trim() || null,
        createdBy: session.user.id,
      }).save()
    } catch (err) {
      // Only the scope index means "already running" (auditNo is unique too).
      if (isScopeDuplicate(err)) return scopeClash(await runningAudit(locationId, categoryId))
      throw err
    }

    // The index cannot be built while a database still holds two running audits for
    // one scope (left by the old race). Until it exists, a later starter backs out
    // here — so at most one of two simultaneous starts survives (with the index in
    // place this never finds anything).
    const rival = await runningAudit(locationId, categoryId, audit._id)
    if (rival) {
      await AssetAudit.deleteOne({ _id: audit._id, status: 'IN_PROGRESS' })
      return scopeClash(rival)
    }

    logActivity({
      userId:   session.user.id,
      userRole: session.user.role,
      action:   'CREATE',
      entity:   'ASSET_AUDIT',
      entityId: String(audit._id),
      changes:  JSON.stringify({ auditNo: audit.auditNo, name, scope: scopeLabel, expected: assets.length, includeRepair, includeLost }),
      request,
    })

    return NextResponse.json({ data: { id: String(audit._id), auditNo: audit.auditNo, expected: assets.length } }, { status: 201 })
  } catch (err) {
    console.error('[POST /api/inventory/audits]', err)
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 })
  }
}
