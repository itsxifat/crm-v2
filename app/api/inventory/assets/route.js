export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Asset, AssetCategory, Department, Employee, InventoryLocation, User, Vendor } from '@/models'
import { requirePerm } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { createNotification } from '@/lib/createNotification'
import { ciContains } from '@/lib/searchMatch'
import { codeContains } from '@/lib/codes'
import { dhakaDayStart } from '@/lib/dhakaTime'
import { toInstant } from '@/lib/finance/fiscal'
import { getFinanceSettings } from '@/lib/finance/settings'
import { TAX_DEPRECIATION_CLASSES } from '@/lib/tax/catalog'
import {
  createAssets, ASSET_STATUSES, TERMINAL_STATUSES, CONDITIONS, DEPRECIATION_METHODS, ACK_STATUSES,
  STATUS_META, CONDITION_META, round2, UPLOAD_URL_RE, defaultOpeningAsOf, openingDateError,
} from '@/lib/inventory/assets'
import {
  guardRead, errorResponse, blankToNull, serializeAsset, LIST_POPULATE, csvLine, findSerialConflicts,
  todayKey, dayKeyOf,
} from './_lib/service'

const SORTS = {
  tag:            { assetTag: 1 },
  '-tag':         { assetTag: -1 },
  name:           { name: 1, assetTag: 1 },
  '-name':        { name: -1, assetTag: 1 },
  cost:           { cost: 1, assetTag: 1 },
  '-cost':        { cost: -1, assetTag: 1 },
  status:         { status: 1, assetTag: 1 },
  warranty:       { warrantyExpiry: 1, assetTag: 1 },
  createdAt:      { createdAt: 1 },
  '-createdAt':   { createdAt: -1 },
  purchaseDate:   { 'purchase.date': 1, assetTag: 1 },
  '-purchaseDate':{ 'purchase.date': -1, assetTag: 1 },
}

const DAY_MS = 24 * 60 * 60 * 1000
const CSV_LIMIT = 10000

function splitList(v) {
  return String(v ?? '').split(',').map(s => s.trim()).filter(Boolean)
}

/** Build the Mongo filter from the query string (throws 400 for malformed ids). */
async function buildFilter(sp) {
  const filter = {}
  const and = []
  if (sp.get('archived') !== '1') filter.isArchived = { $ne: true }

  const search = (sp.get('search') ?? '').trim()
  if (search) {
    const rx = ciContains(search)
    // Asset tags and employee IDs match with separators ignored (EN-LAP-00042 = ENLAP00042).
    const code = codeContains(search)
    const or = [...(code ? [{ assetTag: code }] : []), { name: rx }, { serialNumber: rx }, { brand: rx }, { model: rx }]
    // Also match the holder by name (Employee → User) or employee ID.
    const users = await User.find({ name: rx }).select('_id').limit(200).lean()
    const empOr = [...(code ? [{ employeeId: code }] : []), ...(users.length ? [{ userId: { $in: users.map(u => u._id) } }] : [])]
    const emps = empOr.length ? await Employee.find({ $or: empOr }).select('_id').limit(200).lean() : []
    if (emps.length) or.push({ assignedEmployeeId: { $in: emps.map(e => e._id) } })
    and.push({ $or: or })
  }

  for (const [param, field] of [['categoryId', 'categoryId'], ['locationId', 'locationId'], ['assignedEmployeeId', 'assignedEmployeeId'], ['assignedDepartmentId', 'assignedDepartmentId']]) {
    const raw = sp.get(param)
    if (!raw) continue
    const ids = splitList(raw)
    if (ids.some(id => !isValidObjectId(id))) {
      const err = new Error(`Invalid ${param}`)
      err.status = 400
      throw err
    }
    filter[field] = ids.length === 1 ? ids[0] : { $in: ids }
  }

  const statuses = splitList(sp.get('status')).flatMap(s => {
    const u = s.toUpperCase()
    if (u === 'ACTIVE') return ASSET_STATUSES.filter(x => !TERMINAL_STATUSES.includes(x))
    if (u === 'DISPOSED') return TERMINAL_STATUSES
    return ASSET_STATUSES.includes(u) ? [u] : []
  })
  if (sp.get('status') && !statuses.length) {
    const err = new Error('Unknown status')
    err.status = 400
    throw err
  }
  if (statuses.length) filter.status = statuses.length === 1 ? statuses[0] : { $in: [...new Set(statuses)] }

  const conditions = splitList(sp.get('condition')).map(s => s.toUpperCase()).filter(c => CONDITIONS.includes(c))
  if (conditions.length) filter.condition = conditions.length === 1 ? conditions[0] : { $in: conditions }

  // `ack` (dashboard links) and `ackStatus` are aliases; a comma list is allowed.
  const acks = [...new Set(splitList(sp.get('ack') ?? sp.get('ackStatus')).map(s => s.toUpperCase()).filter(a => ACK_STATUSES.includes(a)))]
  if (acks.length) filter['acknowledgement.status'] = acks.length === 1 ? acks[0] : { $in: acks }

  const cap = sp.get('isCapitalized')
  if (cap === 'true') filter.isCapitalized = { $ne: false }
  else if (cap === 'false') filter.isCapitalized = false

  const today = dhakaDayStart(new Date())
  if (sp.get('warrantyExpired') === '1') {
    filter.warrantyExpiry = { $lt: today }
  } else if (sp.get('warrantyExpiringDays')) {
    const days = Math.min(3650, Math.max(0, parseInt(sp.get('warrantyExpiringDays'), 10) || 0))
    filter.warrantyExpiry = { $gte: today, $lt: new Date(today.getTime() + (days + 1) * DAY_MS) }
  }

  if (and.length) filter.$and = and
  return filter
}

function employeeName(emp) {
  return emp && typeof emp === 'object' ? (emp.name ?? '') : ''
}

/** Status counts + totals for the stat cards (non-archived register). */
async function registerSummary() {
  const rows = await Asset.aggregate([
    { $match: { isArchived: { $ne: true } } },
    { $group: {
      _id: '$status',
      count: { $sum: 1 },
      cost: { $sum: { $ifNull: ['$cost', 0] } },
      accumulated: { $sum: { $ifNull: ['$depreciation.accumulated', 0] } },
      pendingAck: { $sum: { $cond: [{ $eq: ['$acknowledgement.status', 'PENDING'] }, 1, 0] } },
    } },
  ])
  const byStatus = {}
  let total = 0, active = 0, cost = 0, accumulated = 0, pendingAck = 0
  for (const r of rows) {
    byStatus[r._id] = { count: r.count, cost: round2(r.cost), bookValue: round2(r.cost - r.accumulated) }
    total += r.count
    pendingAck += r.pendingAck
    if (!TERMINAL_STATUSES.includes(r._id)) {
      active += r.count
      cost += r.cost
      accumulated += r.accumulated
    }
  }
  return {
    total, active, byStatus, pendingAck,
    cost: round2(cost), accumulated: round2(accumulated), bookValue: round2(cost - accumulated),
  }
}

// GET /api/inventory/assets?search=&categoryId=&status=IN_STOCK,ASSIGNED|ACTIVE|DISPOSED&locationId=
//   &assignedEmployeeId=&assignedDepartmentId=&condition=&ack|ackStatus=PENDING,DECLINED&warrantyExpiringDays=&warrantyExpired=1
//   &isCapitalized=true|false&archived=1&page=&limit=&sort=&summary=1&format=csv
export async function GET(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = guardRead(session)
    if (denied) return denied

    await connectDB()
    const sp = new URL(request.url).searchParams
    const filter = await buildFilter(sp)
    const sort = SORTS[sp.get('sort')] ?? SORTS['-createdAt']
    const ids = splitList(sp.get('ids')).filter(isValidObjectId)
    if (ids.length) filter._id = { $in: ids }

    if (sp.get('format') === 'csv') {
      let q = Asset.find(filter).sort(sort).limit(CSV_LIMIT)
      for (const p of LIST_POPULATE) q = q.populate(p)
      q = q.populate({ path: 'purchase.vendorId', select: 'company' })
      const rows = (await q.lean()).map(serializeAsset)
      const header = [
        'Asset tag', 'Name', 'Category', 'Brand', 'Model', 'Serial number', 'Status', 'Condition',
        'Assigned to', 'Employee ID', 'Department', 'Location', 'Assigned on', 'Acknowledgement',
        'Purchase date', 'Vendor', 'Invoice ref', 'Mushak-6.3 no', 'Unit cost', 'VAT', 'VAT capitalized', 'Other costs',
        'Cost', 'Accumulated depreciation', 'Book value', 'Capitalized', 'Depreciation method', 'Useful life (months)',
        'Tax class', 'Tax rate %', 'Opening asset', 'Warranty expiry', 'Disposed on', 'Disposal type', 'Disposal proceeds', 'Gain/loss',
      ]
      const lines = [csvLine(header)]
      for (const a of rows) {
        lines.push(csvLine([
          a.assetTag, a.name, a.categoryId?.name ?? '', a.brand, a.model, a.serialNumber,
          STATUS_META[a.status]?.label ?? a.status, CONDITION_META[a.condition]?.label ?? a.condition,
          employeeName(a.assignedEmployeeId), a.assignedEmployeeId?.employeeId ?? '', a.assignedDepartmentId?.name ?? '',
          a.locationId?.name ?? '', dayKeyOf(a.assignedAt), a.acknowledgement?.status ?? '',
          dayKeyOf(a.purchase?.date), a.purchase?.vendorId?.company ?? a.purchase?.vendorName ?? '', a.purchase?.invoiceRef,
          a.purchase?.mushakNo, a.purchase?.unitCost ?? 0, a.purchase?.vatAmount ?? 0, a.purchase?.vatCapitalized === false ? 'No' : 'Yes',
          a.purchase?.otherCosts ?? 0, a.cost ?? 0, a.depreciation?.accumulated ?? 0, a.bookValue,
          a.isCapitalized === false ? 'No' : 'Yes', a.depreciation?.method ?? '', a.depreciation?.usefulLifeMonths ?? '',
          TAX_DEPRECIATION_CLASSES[a.taxClass]?.label ?? a.taxClass, a.taxRatePct ?? '', a.opening?.isExisting ? 'Yes' : 'No',
          dayKeyOf(a.warrantyExpiry), dayKeyOf(a.disposal?.date), a.disposal?.type ?? '', a.disposal?.proceeds ?? '', a.disposal?.gainLoss ?? '',
        ]))
      }
      logActivity({
        userId: session.user.id, userRole: session.user.role, action: 'EXPORT', entity: 'ASSET',
        changes: JSON.stringify({ rows: rows.length, format: 'csv' }), request,
      })
      return new Response('﻿' + lines.join('\r\n'), {
        headers: {
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="asset-register-${todayKey()}.csv"`,
        },
      })
    }

    const page  = Math.max(1, parseInt(sp.get('page') ?? '1', 10) || 1)
    const limit = Math.min(200, Math.max(1, parseInt(sp.get('limit') ?? '25', 10) || 25))

    let q = Asset.find(filter).sort(sort).skip((page - 1) * limit).limit(limit)
    for (const p of LIST_POPULATE) q = q.populate(p)
    const [rows, total, summary] = await Promise.all([
      q.lean(),
      Asset.countDocuments(filter),
      sp.get('summary') === '1' ? registerSummary() : Promise.resolve(undefined),
    ])

    return NextResponse.json({
      data: rows.map(serializeAsset),
      meta: { page, limit, total, pages: Math.ceil(total / limit) },
      ...(summary ? { summary } : {}),
    })
  } catch (err) {
    return errorResponse(err, '[GET /api/inventory/assets]')
  }
}

// ── POST ─────────────────────────────────────────────────────────────────────

const idField   = z.string().trim().refine(isValidObjectId, 'Invalid id')
const dateField = z.string().trim().refine(v => toInstant(v) !== null, 'Invalid date')
const moneyField = z.coerce.number({ invalid_type_error: 'Must be a number' }).min(0, 'Cannot be negative').max(1e12)
const text = (max) => z.string().trim().max(max)

const createSchema = z.object({
  name:        text(200).min(1, 'Name is required'),
  categoryId:  idField,
  brand:       text(100).optional().nullable(),
  model:       text(100).optional().nullable(),
  serialNumber:  text(120).optional().nullable(),
  serialNumbers: z.union([z.array(text(120).nullable()).max(500), z.string().max(60000)]).optional().nullable(),
  quantity:    z.coerce.number().int('Quantity must be a whole number').min(1).max(500).optional().nullable(),
  specs:       text(2000).optional().nullable(),
  description: text(4000).optional().nullable(),
  condition:   z.enum(CONDITIONS).optional().nullable(),
  locationId:  idField.optional().nullable(),
  assignedEmployeeId:   idField.optional().nullable(),
  assignedDepartmentId: idField.optional().nullable(),
  expectedReturnDate:   dateField.optional().nullable(),
  purchase: z.object({
    vendorId:       idField.optional().nullable(),
    vendorName:     text(200).optional().nullable(),
    invoiceRef:     text(120).optional().nullable(),
    mushakNo:       text(120).optional().nullable(),
    date:           dateField.optional().nullable(),
    unitCost:       moneyField.optional().nullable(),
    vatAmount:      moneyField.optional().nullable(),
    vatCapitalized: z.boolean().optional().nullable(),
    otherCosts:     moneyField.optional().nullable(),
  }).optional().nullable(),
  availableForUseDate: dateField.optional().nullable(),
  warrantyExpiry:      dateField.optional().nullable(),
  warrantyNotes:       text(1000).optional().nullable(),
  insurance: z.object({
    provider:     text(200).optional().nullable(),
    policyNo:     text(120).optional().nullable(),
    expiry:       dateField.optional().nullable(),
    insuredValue: moneyField.optional().nullable(),
  }).optional().nullable(),
  isCapitalized: z.boolean().optional().nullable(),
  depreciation: z.object({
    method:           z.enum(DEPRECIATION_METHODS).optional().nullable(),
    usefulLifeMonths: z.coerce.number().int().min(1).max(1200).optional().nullable(),
    residualValue:    moneyField.optional().nullable(),
    decliningRatePct: z.coerce.number().gt(0).max(100).optional().nullable(),
  }).optional().nullable(),
  taxClass:   z.string().trim().refine(v => Boolean(TAX_DEPRECIATION_CLASSES[v]), 'Unknown tax class').optional().nullable(),
  taxRatePct: z.coerce.number().min(0).max(100).optional().nullable(),
  opening: z.object({
    isExisting:              z.boolean().optional().nullable(),
    asOfDate:                dateField.optional().nullable(),
    accumulatedDepreciation: moneyField.optional().nullable(),
    taxWdv:                  moneyField.optional().nullable(),
    taxWdvFiscalYear:        z.string().trim().regex(/^\d{4}-\d{2}$/, 'Income year must look like 2025-26').optional().nullable(),
  }).optional().nullable(),
  notes:    text(4000).optional().nullable(),
  imageUrl: z.string().trim().regex(UPLOAD_URL_RE, 'Attach the photo with the upload button').optional().nullable(),
  documents: z.array(z.object({
    label: text(120).optional().nullable(),
    url:   z.string().trim().regex(UPLOAD_URL_RE, 'Attach the document with the upload button'),
  })).max(30).optional().nullable(),
})

function serialList(data) {
  const raw = Array.isArray(data.serialNumbers)
    ? data.serialNumbers
    : typeof data.serialNumbers === 'string' ? data.serialNumbers.split(/[\r\n,]+/) : []
  const list = raw.map(s => String(s ?? '').trim()).filter(Boolean)
  if (!list.length && data.serialNumber && (data.quantity ?? 1) === 1) list.push(data.serialNumber.trim())
  return list
}

// POST /api/inventory/assets — add existing / opening / donated assets to the register.
// No money moves here (purchases go through purchase bills).
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'inventory.manage')
    if (denied) return denied

    await connectDB()
    const body = blankToNull(await request.json().catch(() => null))
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    const parsed = createSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }
    const data = parsed.data
    const quantity = data.quantity ?? 1
    const settings = await getFinanceSettings()

    // ── cross-field checks ──
    const category = await AssetCategory.findById(data.categoryId).select('name code type isActive').lean()
    if (!category) return NextResponse.json({ error: 'Category not found' }, { status: 422 })

    const today = todayKey()
    if (data.purchase?.date && dayKeyOf(toInstant(data.purchase.date)) > today) {
      return NextResponse.json({ error: 'Purchase date cannot be in the future' }, { status: 422 })
    }

    const opening = data.opening ?? null
    if (opening?.isExisting) {
      if (settings.openingLocked) {
        return NextResponse.json({ error: 'Opening balances are locked — add this asset through a purchase bill instead, or ask an admin to unlock opening balances' }, { status: 409 })
      }
      if (opening.asOfDate && dayKeyOf(toInstant(opening.asOfDate)) > today) {
        return NextResponse.json({ error: 'The opening "as of" date cannot be in the future' }, { status: 422 })
      }
      // Same rules as the opening import: as of a day before go-live, and not bought
      // after it (a blank as-of date becomes the day before go-live in createAssets).
      const dateErr = openingDateError({
        goLiveDate: settings.goLiveDate || null,
        asOfKey: opening.asOfDate ? dayKeyOf(toInstant(opening.asOfDate)) : dayKeyOf(defaultOpeningAsOf(settings)),
        purchaseKey: data.purchase?.date ? dayKeyOf(toInstant(data.purchase.date)) : null,
      })
      if (dateErr) return NextResponse.json({ error: dateErr }, { status: 422 })
    }

    if (data.locationId) {
      const loc = await InventoryLocation.findById(data.locationId).select('isActive').lean()
      if (!loc) return NextResponse.json({ error: 'Location not found' }, { status: 422 })
      if (loc.isActive === false) return NextResponse.json({ error: 'That location is inactive' }, { status: 422 })
    }

    let employee = null
    if (data.assignedEmployeeId) {
      employee = await Employee.findById(data.assignedEmployeeId).select('userId isActive resigned').lean()
      if (!employee) return NextResponse.json({ error: 'Employee not found' }, { status: 422 })
      if (employee.resigned || employee.isActive === false) return NextResponse.json({ error: 'That employee is no longer active' }, { status: 422 })
    }
    if (data.assignedDepartmentId && !(await Department.exists({ _id: data.assignedDepartmentId, isActive: true }))) {
      return NextResponse.json({ error: 'Department not found' }, { status: 422 })
    }

    const purchase = { ...(data.purchase ?? {}) }
    if (purchase.vendorId) {
      const vendor = await Vendor.findById(purchase.vendorId).select('company').lean()
      if (!vendor) return NextResponse.json({ error: 'Vendor not found' }, { status: 422 })
      if (!purchase.vendorName) purchase.vendorName = vendor.company
    }

    const serials = serialList({ ...data, quantity })
    if (serials.length > quantity) {
      return NextResponse.json({ error: `${serials.length} serial numbers were given for ${quantity} asset${quantity === 1 ? '' : 's'}` }, { status: 422 })
    }
    const conflicts = await findSerialConflicts(serials)
    if (conflicts.length) {
      const c = conflicts[0]
      return NextResponse.json({
        error: `Serial number ${c.serial} is already on asset ${c.assetTag}`,
        details: { conflicts },
      }, { status: 409 })
    }

    const base = {
      name: data.name,
      categoryId: data.categoryId,
      brand: data.brand,
      model: data.model,
      specs: data.specs,
      description: data.description,
      condition: data.condition,
      locationId: data.locationId,
      assignedEmployeeId: data.assignedEmployeeId,
      assignedDepartmentId: data.assignedDepartmentId,
      expectedReturnDate: data.expectedReturnDate,
      purchase,
      availableForUseDate: data.availableForUseDate,
      warrantyExpiry: data.warrantyExpiry,
      warrantyNotes: data.warrantyNotes,
      insurance: data.insurance ?? undefined,
      depreciation: data.depreciation ?? undefined,
      taxClass: data.taxClass,
      taxRatePct: data.taxRatePct,
      opening: opening ?? undefined,
      notes: data.notes,
      imageUrl: data.imageUrl,
      documents: data.documents ?? [],
    }
    if (typeof data.isCapitalized === 'boolean') base.isCapitalized = data.isCapitalized

    const assets = await createAssets({
      base,
      quantity,
      serialNumbers: serials,
      session,
      eventType: opening?.isExisting ? 'OPENING' : undefined,
    })

    const tags = assets.map(a => a.assetTag)
    logActivity({
      userId: session.user.id, userRole: session.user.role, action: 'CREATE', entity: 'ASSET',
      entityId: String(assets[0]._id),
      changes: JSON.stringify({
        name: data.name, category: category.name, count: assets.length,
        tags: tags.length > 20 ? [...tags.slice(0, 20), `+${tags.length - 20} more`] : tags,
        cost: assets[0].cost, opening: Boolean(opening?.isExisting),
      }),
      request,
    })

    if (employee?.userId && assets[0].status === 'ASSIGNED') {
      const ackPending = assets[0].acknowledgement?.status === 'PENDING'
      createNotification({
        userId: String(employee.userId),
        title: assets.length === 1 ? 'Equipment assigned to you' : `${assets.length} items assigned to you`,
        message: `${tags.slice(0, 5).join(', ')}${tags.length > 5 ? '…' : ''} — ${data.name}.${ackPending ? ' Please confirm you received it in My Assets.' : ''}`,
        type: 'ASSET',
        link: '/admin/my-assets',
      }).catch(() => {})
    }

    return NextResponse.json({
      data: assets.map(a => a.toJSON()),
      meta: { count: assets.length, tags },
    }, { status: 201 })
  } catch (err) {
    return errorResponse(err, '[POST /api/inventory/assets]')
  }
}
