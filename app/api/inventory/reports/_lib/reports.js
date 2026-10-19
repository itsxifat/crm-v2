/**
 * Inventory report builders (server). Every builder returns the same shape so
 * one table component and one CSV writer handle all of them:
 *
 *   { type, title, description, range, fiscalYearStartMonth, filters,
 *     summary: [{ label, value, type }],
 *     sections: [{ key, title, description, columns: [{ key, label, type, total }],
 *                  groups?: [{ key, label, sublabel, rows, totals }], rows?, totals? }],
 *     notes: [string], warnings: [string], generatedAt }
 *
 * Column types: text | tag | money | number | percent | date | status.
 * Dates are 'YYYY-MM-DD' (Dhaka); money is BDT rounded to 2 decimals.
 */

import mongoose from 'mongoose'
import {
  Asset, AssetEvent, DepreciationRun, StockItem, StockMovement, Transaction, Vendor, User,
} from '@/models'
import {
  ASSET_STATUSES, TERMINAL_STATUSES, HELD_STATUSES, CONDITION_META, ACK_META,
  DAMAGE_CAUSE_LABELS, RECOVERY_METHOD_LABELS, RECOVERY_STATUS_META, DISPOSAL_TYPES,
} from '@/lib/inventory/constants'
import {
  effectiveAccumulated, taxDepreciationSchedule, taxClassOf, fiscalYearLabelOf,
  periodLabelOf, periodOfDate, taxAcquisitionDate,
} from '@/lib/inventory/depreciationMath'
import { loadTaxCostAdditions } from '@/lib/inventory/depreciation'
import { recoveryProgress } from '@/lib/inventory/actions'
import { TAX_DEPRECIATION_CLASSES } from '@/lib/tax/catalog'
import { periodsBetween, taxPeriodOf, dayKeyLabel, isDayKey, fiscalYearOf } from '@/lib/finance/fiscal'
import { parseDhakaDay, dhakaDayStart } from '@/lib/dhakaTime'
import {
  round2, num, httpError, idStr, dayKeyOrNull, isTruthy, resolveRange, fiscalRangeOf,
  loadEmployeeMap, employeeLabel, loadDepartmentMap, loadLocationMap, loadCategoryMap,
} from './common'
import { buildAssetHistories, loadCapitalisedAssets, sumBefore, sumBetween, acquisitionDateOf } from './history'

export const REPORT_TYPES = [
  'register', 'custodian', 'location', 'warranty', 'book-depreciation', 'tax-depreciation',
  'disposals', 'damage', 'maintenance', 'stock-valuation', 'low-stock', 'consumption', 'ppe-movement',
]

const ASSET_LIST_FIELDS = 'assetTag name categoryId brand model serialNumber status condition locationId assignedEmployeeId assignedDepartmentId assignedAt expectedReturnDate acknowledgement purchase cost isCapitalized availableForUseDate depreciation taxClass taxRatePct opening warrantyExpiry warrantyNotes disposal createdAt isArchived'

// ── small helpers ────────────────────────────────────────────────────────────

const assetHref = (a) => `/admin/inventory/assets/${String(a._id)}`
const brandModel = (a) => [a.brand, a.model].filter(Boolean).join(' ') || null

function optObjectId(sp, key, label) {
  const v = sp.get(key)
  if (!v) return null
  if (!mongoose.isValidObjectId(v)) throw httpError(400, `Invalid ${label}`)
  return v
}

function intParam(sp, key, { min, max, fallback }) {
  const raw = sp.get(key)
  if (raw === null || raw === '') return fallback
  const n = Number(raw)
  if (!Number.isInteger(n) || n < min || n > max) throw httpError(422, `${key} must be a whole number between ${min} and ${max}`)
  return n
}

function enumParam(sp, key, values, fallback) {
  const v = sp.get(key)
  if (!v) return fallback
  if (!values.includes(v)) throw httpError(422, `${key} must be one of ${values.join(', ')}`)
  return v
}

/** Totals of the summable columns (money / number with total !== false). */
function totalsOf(rows, columns) {
  const out = {}
  for (const c of columns) {
    if (!['money', 'number'].includes(c.type) || c.total === false) continue
    let s = 0
    let any = false
    for (const r of rows) {
      const v = r[c.key]
      if (v === null || v === undefined || v === '') continue
      const n = Number(v)
      if (Number.isFinite(n)) { s += n; any = true }
    }
    out[c.key] = any ? (c.type === 'money' ? round2(s) : Math.round(s * 10000) / 10000) : 0
  }
  return out
}

/** Group rows by a key, keep insertion order of first appearance, sort by label. */
function groupRows(rows, keyFn, labelFn, columns, { sort = true, sublabelFn = null } = {}) {
  const map = new Map()
  for (const r of rows) {
    const k = keyFn(r) ?? '__none'
    if (!map.has(k)) map.set(k, { key: String(k), label: labelFn(r), sublabel: sublabelFn ? sublabelFn(r) : null, rows: [] })
    map.get(k).rows.push(r)
  }
  const groups = [...map.values()]
  for (const g of groups) g.totals = totalsOf(g.rows, columns)
  if (sort) groups.sort((a, b) => String(a.label).localeCompare(String(b.label)))
  return groups
}

function categoryLabel(cat) {
  if (!cat) return 'Uncategorised'
  return cat.code ? `${cat.name} (${cat.code})` : cat.name
}

function custodianLabel(a, empMap, deptMap) {
  if (a.assignedEmployeeId) return employeeLabel(empMap.get(idStr(a.assignedEmployeeId))) ?? 'Employee'
  if (a.assignedDepartmentId) {
    const d = deptMap.get(idStr(a.assignedDepartmentId))
    return d ? `${d.name} (department)` : 'Department'
  }
  return null
}

function section(key, title, columns, { rows = null, groups = null, description = null, totals = undefined } = {}) {
  const s = { key, title, description, columns }
  if (groups) {
    s.groups = groups
    const all = groups.flatMap(g => g.rows)
    s.totals = totals === undefined ? totalsOf(all, columns) : totals
    s.rowCount = all.length
  } else {
    s.rows = rows || []
    s.totals = totals === undefined ? totalsOf(s.rows, columns) : totals
    s.rowCount = s.rows.length
  }
  return s
}

async function assetRefs(assets) {
  const [catMap, locMap, empMap, deptMap] = await Promise.all([
    loadCategoryMap(),
    loadLocationMap(),
    loadEmployeeMap(assets.map(a => a.assignedEmployeeId).filter(Boolean)),
    loadDepartmentMap(assets.map(a => a.assignedDepartmentId).filter(Boolean)),
  ])
  return { catMap, locMap, empMap, deptMap }
}

// ── 1. Asset register ────────────────────────────────────────────────────────

async function registerReport(sp) {
  const categoryId = optObjectId(sp, 'categoryId', 'category')
  const locationId = optObjectId(sp, 'locationId', 'location')
  const includeDisposed = isTruthy(sp.get('includeDisposed'))
  const statuses = (sp.get('status') || '').split(',').map(s => s.trim()).filter(Boolean)
  for (const s of statuses) if (!ASSET_STATUSES.includes(s)) throw httpError(422, `Unknown status ${s}`)

  const filter = { isArchived: { $ne: true } }
  if (categoryId) filter.categoryId = categoryId
  if (locationId) filter.locationId = locationId
  if (statuses.length) filter.status = { $in: statuses }
  else if (!includeDisposed) filter.status = { $nin: TERMINAL_STATUSES }

  const assets = await Asset.find(filter).select(ASSET_LIST_FIELDS).sort({ assetTag: 1 }).lean()
  const { catMap, locMap, empMap, deptMap } = await assetRefs(assets)

  const heldCols = [
    { key: 'tag', label: 'Tag', type: 'tag' },
    { key: 'name', label: 'Asset', type: 'text' },
    { key: 'brandModel', label: 'Brand / model', type: 'text' },
    { key: 'serial', label: 'Serial no.', type: 'text' },
    { key: 'status', label: 'Status', type: 'status' },
    { key: 'condition', label: 'Condition', type: 'text' },
    { key: 'location', label: 'Location', type: 'text' },
    { key: 'custodian', label: 'Custodian', type: 'text' },
    { key: 'acquired', label: 'In use from', type: 'date' },
    { key: 'cost', label: 'Cost', type: 'money' },
    { key: 'accumulated', label: 'Accum. depreciation', type: 'money' },
    { key: 'bookValue', label: 'Net book value', type: 'money' },
  ]
  const memoCols = heldCols.filter(c => !['accumulated', 'bookValue'].includes(c.key))
  const disposedCols = [
    { key: 'tag', label: 'Tag', type: 'tag' },
    { key: 'name', label: 'Asset', type: 'text' },
    { key: 'status', label: 'Disposal', type: 'status' },
    { key: 'disposalDate', label: 'Date', type: 'date' },
    { key: 'cost', label: 'Cost', type: 'money' },
    { key: 'accumulated', label: 'Accum. depreciation', type: 'money' },
    { key: 'bookValue', label: 'NBV at disposal', type: 'money' },
    { key: 'proceeds', label: 'Proceeds (excl. VAT)', type: 'money' },
    { key: 'gainLoss', label: 'Gain / (loss)', type: 'money' },
  ]

  const capitalised = []
  const memo = []
  const disposed = []
  for (const a of assets) {
    const cat = catMap.get(idStr(a.categoryId))
    const base = {
      _id: String(a._id),
      _href: assetHref(a),
      _group: idStr(a.categoryId),
      _groupLabel: categoryLabel(cat),
      tag: a.assetTag,
      name: a.name,
      brandModel: brandModel(a),
      serial: a.serialNumber ?? null,
      status: a.status,
      condition: CONDITION_META[a.condition]?.label ?? a.condition ?? null,
      location: a.locationId ? (locMap.get(idStr(a.locationId))?.path ?? null) : null,
      custodian: custodianLabel(a, empMap, deptMap),
      acquired: dayKeyOrNull(acquisitionDateOf(a)),
      cost: round2(num(a.cost)),
    }
    if (TERMINAL_STATUSES.includes(a.status)) {
      const acc = effectiveAccumulated(a)
      const nbv = a.disposal?.bookValue !== null && a.disposal?.bookValue !== undefined ? round2(num(a.disposal.bookValue)) : round2(num(a.cost) - acc)
      const proceeds = a.disposal?.proceeds !== null && a.disposal?.proceeds !== undefined ? round2(num(a.disposal.proceeds)) : 0
      disposed.push({
        ...base,
        disposalDate: dayKeyOrNull(a.disposal?.date),
        accumulated: a.isCapitalized === false ? null : round2(num(a.cost) - nbv),
        bookValue: a.isCapitalized === false ? null : nbv,
        proceeds,
        gainLoss: a.disposal?.gainLoss !== null && a.disposal?.gainLoss !== undefined ? round2(num(a.disposal.gainLoss)) : round2(proceeds - (a.isCapitalized === false ? 0 : nbv)),
      })
    } else if (a.isCapitalized === false) {
      memo.push(base)
    } else {
      const acc = effectiveAccumulated(a)
      capitalised.push({ ...base, accumulated: acc, bookValue: round2(num(a.cost) - acc) })
    }
  }

  const byCat = (cols) => (rows) => groupRows(rows, r => r._group, r => r._groupLabel, cols)
  const sections = [
    section('capitalised', 'Capitalised assets (property, plant & equipment)', heldCols, {
      groups: byCat(heldCols)(capitalised),
      description: 'Assets carried on the balance sheet at cost less accumulated depreciation.',
    }),
  ]
  if (memo.length) {
    sections.push(section('expensed', 'Expensed items — memo register', memoCols, {
      groups: byCat(memoCols)(memo),
      description: 'Items below the capitalisation threshold (or marked not to capitalise). Their cost was expensed; they are tracked for custody only.',
    }))
  }
  if (includeDisposed || statuses.some(s => TERMINAL_STATUSES.includes(s))) {
    sections.push(section('disposed', 'Disposed assets', disposedCols, { rows: disposed }))
  }

  const capTotals = sections[0].totals
  return {
    title: 'Fixed asset register',
    description: 'Every asset on the register with cost, accumulated depreciation and net book value.',
    summary: [
      { label: 'Capitalised assets', value: capitalised.length, type: 'number' },
      { label: 'Cost', value: capTotals.cost ?? 0, type: 'money' },
      { label: 'Accumulated depreciation', value: capTotals.accumulated ?? 0, type: 'money' },
      { label: 'Net book value', value: capTotals.bookValue ?? 0, type: 'money' },
      { label: 'Expensed items (memo)', value: memo.length, type: 'number' },
    ],
    sections,
    filters: { categoryId, locationId, status: statuses.join(',') || null, includeDisposed },
  }
}

// ── 2. Custodian (assets by employee) ────────────────────────────────────────

async function custodianReport(sp) {
  const employeeId = optObjectId(sp, 'employeeId', 'employee')
  const categoryId = optObjectId(sp, 'categoryId', 'category')
  const filter = {
    isArchived: { $ne: true },
    status: { $in: HELD_STATUSES },
    $or: [{ assignedEmployeeId: { $ne: null } }, { assignedDepartmentId: { $ne: null } }],
  }
  if (employeeId) { delete filter.$or; filter.assignedEmployeeId = employeeId }
  if (categoryId) filter.categoryId = categoryId

  const assets = await Asset.find(filter).select(ASSET_LIST_FIELDS).sort({ assetTag: 1 }).lean()
  const { catMap, locMap, empMap, deptMap } = await assetRefs(assets)
  const cols = [
    { key: 'tag', label: 'Tag', type: 'tag' },
    { key: 'name', label: 'Asset', type: 'text' },
    { key: 'category', label: 'Category', type: 'text' },
    { key: 'serial', label: 'Serial no.', type: 'text' },
    { key: 'status', label: 'Status', type: 'status' },
    { key: 'condition', label: 'Condition', type: 'text' },
    { key: 'assignedAt', label: 'Assigned on', type: 'date' },
    { key: 'expectedReturn', label: 'Return due', type: 'date' },
    { key: 'ack', label: 'Acknowledgement', type: 'text' },
    { key: 'cost', label: 'Cost', type: 'money' },
    { key: 'bookValue', label: 'Net book value', type: 'money' },
  ]
  const rows = assets.map(a => {
    const emp = a.assignedEmployeeId ? empMap.get(idStr(a.assignedEmployeeId)) : null
    const dept = !emp && a.assignedDepartmentId ? deptMap.get(idStr(a.assignedDepartmentId)) : null
    const groupKey = emp ? `e:${emp.id}` : dept ? `d:${dept.id}` : `x:${idStr(a.assignedEmployeeId || a.assignedDepartmentId)}`
    return {
      _id: String(a._id),
      _href: assetHref(a),
      _group: groupKey,
      _groupLabel: emp ? employeeLabel(emp) : dept ? `${dept.name} (department)` : 'Unknown custodian',
      _groupSub: emp ? [emp.designation, emp.department].filter(Boolean).join(' · ') || null : null,
      tag: a.assetTag,
      name: a.name,
      category: categoryLabel(catMap.get(idStr(a.categoryId))),
      serial: a.serialNumber ?? null,
      status: a.status,
      condition: CONDITION_META[a.condition]?.label ?? a.condition ?? null,
      assignedAt: dayKeyOrNull(a.assignedAt),
      expectedReturn: dayKeyOrNull(a.expectedReturnDate),
      ack: ACK_META[a.acknowledgement?.status]?.label ?? null,
      cost: round2(num(a.cost)),
      bookValue: a.isCapitalized === false ? null : round2(num(a.cost) - effectiveAccumulated(a)),
      _location: a.locationId ? locMap.get(idStr(a.locationId))?.path : null,
    }
  })
  const groups = groupRows(rows, r => r._group, r => r._groupLabel, cols, { sublabelFn: r => r._groupSub })
  for (const g of groups) g.sublabel = [g.sublabel, `${g.rows.length} item${g.rows.length === 1 ? '' : 's'}`].filter(Boolean).join(' · ')
  const pendingAck = rows.filter(r => r.ack === ACK_META.PENDING.label).length
  return {
    title: 'Assets by custodian',
    description: 'Equipment held by each employee or department — use it for exit clearance and periodic confirmation.',
    summary: [
      { label: 'Custodians', value: groups.length, type: 'number' },
      { label: 'Assets held', value: rows.length, type: 'number' },
      { label: 'Awaiting acknowledgement', value: pendingAck, type: 'number' },
      { label: 'Cost', value: totalsOf(rows, cols).cost ?? 0, type: 'money' },
    ],
    sections: [section('custodian', null, cols, { groups })],
    filters: { employeeId, categoryId },
  }
}

// ── 3. Assets by location ────────────────────────────────────────────────────

async function locationReport(sp) {
  const locationId = optObjectId(sp, 'locationId', 'location')
  const categoryId = optObjectId(sp, 'categoryId', 'category')
  const filter = { isArchived: { $ne: true }, status: { $nin: TERMINAL_STATUSES } }
  if (categoryId) filter.categoryId = categoryId
  const assets0 = await Asset.find(filter).select(ASSET_LIST_FIELDS).sort({ assetTag: 1 }).lean()
  const { catMap, locMap, empMap, deptMap } = await assetRefs(assets0)

  // A location filter includes its sub-locations.
  let assets = assets0
  if (locationId) {
    const wanted = new Set([locationId])
    let grew = true
    while (grew) {
      grew = false
      for (const l of locMap.values()) {
        if (l.parentId && wanted.has(l.parentId) && !wanted.has(l.id)) { wanted.add(l.id); grew = true }
      }
    }
    assets = assets0.filter(a => a.locationId && wanted.has(idStr(a.locationId)))
  }

  const cols = [
    { key: 'tag', label: 'Tag', type: 'tag' },
    { key: 'name', label: 'Asset', type: 'text' },
    { key: 'category', label: 'Category', type: 'text' },
    { key: 'serial', label: 'Serial no.', type: 'text' },
    { key: 'status', label: 'Status', type: 'status' },
    { key: 'custodian', label: 'Custodian', type: 'text' },
    { key: 'condition', label: 'Condition', type: 'text' },
    { key: 'lastAudit', label: 'Last audit', type: 'date' },
    { key: 'cost', label: 'Cost', type: 'money' },
    { key: 'bookValue', label: 'Net book value', type: 'money' },
  ]
  const rows = assets.map(a => {
    const loc = a.locationId ? locMap.get(idStr(a.locationId)) : null
    return {
      _id: String(a._id),
      _href: assetHref(a),
      _group: loc ? loc.id : '__none',
      _groupLabel: loc ? loc.path : 'No location recorded',
      tag: a.assetTag,
      name: a.name,
      category: categoryLabel(catMap.get(idStr(a.categoryId))),
      serial: a.serialNumber ?? null,
      status: a.status,
      custodian: custodianLabel(a, empMap, deptMap),
      condition: CONDITION_META[a.condition]?.label ?? a.condition ?? null,
      lastAudit: dayKeyOrNull(a.lastAuditAt),
      cost: round2(num(a.cost)),
      bookValue: a.isCapitalized === false ? null : round2(num(a.cost) - effectiveAccumulated(a)),
    }
  })
  const groups = groupRows(rows, r => r._group, r => r._groupLabel, cols)
  for (const g of groups) g.sublabel = `${g.rows.length} item${g.rows.length === 1 ? '' : 's'}`
  return {
    title: 'Assets by location',
    description: 'Where every asset is kept — the starting list for a physical count.',
    summary: [
      { label: 'Locations', value: groups.filter(g => g.key !== '__none').length, type: 'number' },
      { label: 'Assets', value: rows.length, type: 'number' },
      { label: 'Without a location', value: rows.filter(r => r._group === '__none').length, type: 'number' },
    ],
    sections: [section('location', null, cols, { groups })],
    filters: { locationId, categoryId },
  }
}

// ── 4. Warranty expiry ───────────────────────────────────────────────────────

async function warrantyReport(sp) {
  const days = intParam(sp, 'days', { min: 1, max: 1825, fallback: 90 })
  const includeExpired = isTruthy(sp.get('includeExpired'))
  const today = dhakaDayStart(new Date())
  const until = dhakaDayStart(new Date(), days + 1)
  const filter = {
    isArchived: { $ne: true },
    status: { $nin: TERMINAL_STATUSES },
    warrantyExpiry: includeExpired ? { $ne: null, $lt: until } : { $gte: today, $lt: until },
  }
  const assets = await Asset.find(filter).select(ASSET_LIST_FIELDS).sort({ warrantyExpiry: 1 }).lean()
  const { catMap, locMap, empMap, deptMap } = await assetRefs(assets)
  const cols = [
    { key: 'tag', label: 'Tag', type: 'tag' },
    { key: 'name', label: 'Asset', type: 'text' },
    { key: 'category', label: 'Category', type: 'text' },
    { key: 'serial', label: 'Serial no.', type: 'text' },
    { key: 'custodian', label: 'Custodian', type: 'text' },
    { key: 'location', label: 'Location', type: 'text' },
    { key: 'vendor', label: 'Supplier', type: 'text' },
    { key: 'expiry', label: 'Warranty ends', type: 'date' },
    { key: 'daysLeft', label: 'Days left', type: 'number', total: false },
    { key: 'notes', label: 'Warranty notes', type: 'text' },
  ]
  const DAY = 24 * 60 * 60 * 1000
  const rows = assets.map(a => ({
    _id: String(a._id),
    _href: assetHref(a),
    tag: a.assetTag,
    name: a.name,
    category: categoryLabel(catMap.get(idStr(a.categoryId))),
    serial: a.serialNumber ?? null,
    custodian: custodianLabel(a, empMap, deptMap),
    location: a.locationId ? locMap.get(idStr(a.locationId))?.path ?? null : null,
    vendor: a.purchase?.vendorName ?? null,
    expiry: dayKeyOrNull(a.warrantyExpiry),
    daysLeft: Math.round((dhakaDayStart(a.warrantyExpiry).getTime() - today.getTime()) / DAY),
    notes: a.warrantyNotes ?? null,
  }))
  return {
    title: 'Warranty expiry',
    description: `Assets whose warranty ends within the next ${days} days${includeExpired ? ' (including already expired)' : ''}.`,
    summary: [
      { label: 'Within 30 days', value: rows.filter(r => r.daysLeft >= 0 && r.daysLeft <= 30).length, type: 'number' },
      { label: `Within ${days} days`, value: rows.filter(r => r.daysLeft >= 0).length, type: 'number' },
      ...(includeExpired ? [{ label: 'Already expired', value: rows.filter(r => r.daysLeft < 0).length, type: 'number' }] : []),
    ],
    sections: [section('warranty', null, cols, { rows, totals: null })],
    filters: { days, includeExpired },
  }
}

// ── 5. Book depreciation (per asset per month) ───────────────────────────────

async function bookDepreciationReport(sp, ctx) {
  const range = resolveRange(sp, ctx.startMonth)
  const fromPeriod = taxPeriodOf(range.start)
  const toPeriod = taxPeriodOf(parseDhakaDay(range.endDay).start)
  const periods = periodsBetween(fromPeriod, toPeriod)
  if (periods.length > 36) throw httpError(422, 'Choose a range of at most 36 months')
  const categoryId = optObjectId(sp, 'categoryId', 'category')

  const assets = await loadCapitalisedAssets(categoryId ? { categoryId } : {})
  const [histories, catMap] = await Promise.all([buildAssetHistories(assets), loadCategoryMap()])
  const periodSet = new Set(periods)

  const cols = [
    { key: 'tag', label: 'Tag', type: 'tag' },
    { key: 'name', label: 'Asset', type: 'text' },
    ...periods.map(p => ({ key: `p_${p}`, label: periodLabelOf(p), type: 'money' })),
    { key: 'total', label: 'Total', type: 'money' },
  ]
  const rows = []
  for (const a of assets) {
    const h = histories.get(String(a._id))
    if (!h) continue
    const amounts = {}
    let total = 0
    for (const x of h.acc) {
      if (x.kind !== 'DEP' || !x.period || !periodSet.has(x.period)) continue
      amounts[`p_${x.period}`] = round2((amounts[`p_${x.period}`] || 0) + x.amount)
      total = round2(total + x.amount)
    }
    if (Math.abs(total) < 0.005 && !Object.values(amounts).some(v => Math.abs(v) >= 0.005)) continue
    const cat = catMap.get(idStr(a.categoryId))
    const row = { _id: String(a._id), _href: assetHref(a), _group: idStr(a.categoryId), _groupLabel: categoryLabel(cat), tag: a.assetTag, name: a.name, total }
    for (const p of periods) row[`p_${p}`] = amounts[`p_${p}`] ?? 0
    rows.push(row)
  }
  const groups = groupRows(rows, r => r._group, r => r._groupLabel, cols)

  const runs = await DepreciationRun.find({ period: { $gte: fromPeriod, $lte: toPeriod } }).select('-lines').sort({ period: 1 }).lean()
  const userIds = [...new Set(runs.map(r => idStr(r.runBy)).filter(Boolean))]
  const users = userIds.length ? await User.find({ _id: { $in: userIds } }).select('name').lean() : []
  const userMap = new Map(users.map(u => [String(u._id), u.name]))
  const runCols = [
    { key: 'period', label: 'Month', type: 'text' },
    { key: 'runStatus', label: 'Status', type: 'text' },
    { key: 'assets', label: 'Assets', type: 'number' },
    { key: 'amount', label: 'Amount posted', type: 'money' },
    { key: 'postedOn', label: 'Posted on', type: 'date' },
    { key: 'postedBy', label: 'Posted by', type: 'text' },
  ]
  const runRows = runs.map(r => ({
    _id: String(r._id),
    period: periodLabelOf(r.period),
    runStatus: r.status === 'POSTED' ? 'Posted' : r.status === 'POSTING' ? 'Posting / interrupted' : 'Reversed',
    assets: r.assetCount ?? 0,
    amount: r.status === 'POSTED' ? round2(num(r.totalAmount)) : 0,
    postedOn: dayKeyOrNull(r.createdAt),
    postedBy: r.runBy ? (userMap.get(String(r.runBy)) ?? 'User') : 'Scheduler',
  }))

  const total = round2(rows.reduce((s, r) => s + r.total, 0))
  const warnings = []
  const missing = periods.filter(p => p < periodOfDate(new Date()) && !runs.some(r => r.period === p && r.status === 'POSTED'))
  if (missing.length && runs.length) warnings.push(`No posted run for ${missing.map(periodLabelOf).join(', ')} — later runs catch those months up and show them in the month they were posted.`)
  if (!runs.length) warnings.push('No depreciation run has been posted in this range yet.')

  return {
    title: 'Book depreciation by asset and month',
    description: 'Depreciation charged per asset in each month, as posted by the monthly runs (plus depreciation charged on disposal).',
    range,
    summary: [
      { label: 'Depreciation charged', value: total, type: 'money' },
      { label: 'Assets', value: rows.length, type: 'number' },
      { label: 'Runs posted', value: runs.filter(r => r.status === 'POSTED').length, type: 'number' },
    ],
    sections: [
      section('assets', 'Charge by asset', cols, { groups }),
      section('runs', 'Depreciation runs', runCols, { rows: runRows }),
    ],
    notes: [
      'A run catches up months it missed, so a catch-up amount appears in the month it was posted (the same month as in the ledger).',
    ],
    warnings,
    filters: { categoryId },
  }
}

// ── 6. Tax depreciation (Third Schedule) ─────────────────────────────────────

async function taxDepreciationReport(sp, ctx) {
  const range = fiscalRangeOf(sp.get('fy'), ctx.startMonth)
  const fy = range.fy
  const assets = await loadCapitalisedAssets()
  // Later capitalised repairs / cost corrections join the income year they were
  // made in, so a year already filed is not restated.
  const additionsBy = await loadTaxCostAdditions(assets.map(a => a._id))

  const cols = [
    { key: 'tag', label: 'Tag', type: 'tag' },
    { key: 'name', label: 'Asset', type: 'text' },
    { key: 'acquired', label: 'Acquired', type: 'date' },
    { key: 'taxCost', label: 'Cost for tax', type: 'money' },
    { key: 'rate', label: 'Rate %', type: 'percent' },
    { key: 'openingWdv', label: 'WDV b/f', type: 'money' },
    { key: 'additions', label: 'Additions', type: 'money' },
    { key: 'disposals', label: 'Disposals (WDV)', type: 'money' },
    { key: 'allowance', label: 'Depreciation allowance', type: 'money' },
    { key: 'closingWdv', label: 'WDV c/f', type: 'money' },
    { key: 'proceeds', label: 'Sale proceeds', type: 'money' },
    { key: 'balancing', label: 'Taxable gain / (loss)', type: 'money' },
    { key: 'note', label: 'Note', type: 'text' },
  ]

  const rows = []
  let noOpeningWdv = 0
  let estimatedAcquisition = 0
  for (const a of assets) {
    const sched = taxDepreciationSchedule(a, {
      startMonth: ctx.startMonth,
      toFiscalYear: fy,
      costAdditions: additionsBy.get(String(a._id)) ?? [],
    })
    const r = sched.find(x => x.fy === fy)
    if (!r) continue
    const cls = taxClassOf(a.taxClass)
    const classKey = TAX_DEPRECIATION_CLASSES[a.taxClass] ? a.taxClass : 'OTHER'
    // Same acquisition date as the schedule (an opening asset without dates: its opening as-of date).
    const acquired = taxAcquisitionDate(a)
    if (!a.purchase?.date && !a.availableForUseDate && !(a.opening?.isExisting && a.opening?.asOfDate)) estimatedAcquisition++
    const acqFy = fiscalYearLabelOf(acquired, ctx.startMonth)
    const hasOpeningWdv = a.opening?.taxWdv !== null && a.opening?.taxWdv !== undefined
    if (a.opening?.isExisting && !hasOpeningWdv) noOpeningWdv++
    const isAdditionYear = !hasOpeningWdv && acqFy === fy
    const disposedFy = a.disposal?.date ? fiscalYearLabelOf(a.disposal.date, ctx.startMonth) : null
    const isDisposalYear = disposedFy === fy
    const cap = Number(cls.costCap) > 0 ? Number(cls.costCap) : null
    // Cost for tax at the end of this income year (after its additions, capped).
    const taxCost = r.taxCost !== null && r.taxCost !== undefined
      ? round2(r.taxCost)
      : round2(cap ? Math.min(num(a.cost), cap) : num(a.cost))

    const openingWdv = isAdditionYear ? 0 : r.openingWdv
    const additions = round2((isAdditionYear ? r.openingWdv : 0) + num(r.additions))
    // In the year of disposal no allowance is given, so the WDV disposed of is the
    // WDV brought forward plus that year's additions.
    const disposals = isDisposalYear ? r.closingWdv : 0
    const allowance = isDisposalYear ? 0 : r.allowance
    const closingWdv = isDisposalYear ? 0 : r.closingWdv
    let proceeds = null
    let balancing = null
    const notes = r.note ? [r.note] : []
    if (isDisposalYear) {
      proceeds = round2(num(a.disposal?.proceeds))
      balancing = round2(proceeds - disposals)
      if (proceeds > taxCost) notes.push(`Proceeds exceed cost: Tk ${round2(proceeds - taxCost).toLocaleString('en-IN')} is a capital gain, Tk ${round2(taxCost - disposals).toLocaleString('en-IN')} business income`)
    }
    rows.push({
      _id: String(a._id),
      _href: assetHref(a),
      _group: classKey,
      _groupLabel: `${cls.label} — ${cls.method === 'SL' ? `${cls.rate}% straight-line` : `${cls.rate}% WDV`}`,
      tag: a.assetTag,
      name: a.name,
      acquired: dayKeyOrNull(acquired),
      taxCost,
      rate: r.rate,
      openingWdv,
      additions,
      disposals,
      allowance,
      closingWdv,
      proceeds,
      balancing,
      note: notes.join('; ') || null,
    })
  }
  const classOrder = Object.keys(TAX_DEPRECIATION_CLASSES)
  const groups = groupRows(rows, r => r._group, r => r._groupLabel, cols, { sort: false })
  groups.sort((x, y) => classOrder.indexOf(x.key) - classOrder.indexOf(y.key))
  for (const g of groups) g.sublabel = `${g.rows.length} asset${g.rows.length === 1 ? '' : 's'}`
  const sec = section('classes', 'Depreciation allowance by Third Schedule class', cols, { groups })
  // Rate is not summable; a class subtotal shows the class rate instead.
  for (const g of groups) g.totals.rate = g.rows[0]?.rate ?? null

  const summaryCols = [
    { key: 'cls', label: 'Class', type: 'text' },
    { key: 'rate', label: 'Rate %', type: 'percent' },
    { key: 'assets', label: 'Assets', type: 'number' },
    { key: 'openingWdv', label: 'WDV b/f', type: 'money' },
    { key: 'additions', label: 'Additions', type: 'money' },
    { key: 'disposals', label: 'Disposals (WDV)', type: 'money' },
    { key: 'allowance', label: 'Allowance', type: 'money' },
    { key: 'closingWdv', label: 'WDV c/f', type: 'money' },
  ]
  const summaryRows = groups.map(g => ({
    _id: g.key,
    cls: TAX_DEPRECIATION_CLASSES[g.key]?.label ?? g.key,
    rate: g.totals.rate,
    assets: g.rows.length,
    openingWdv: g.totals.openingWdv,
    additions: g.totals.additions,
    disposals: g.totals.disposals,
    allowance: g.totals.allowance,
    closingWdv: g.totals.closingWdv,
  }))

  const warnings = []
  if (noOpeningWdv) warnings.push(`${noOpeningWdv} opening-register asset(s) have no opening tax WDV, so their WDV is rebuilt from cost since acquisition. Enter the WDV carried forward in last year's return for these assets (Opening import or asset edit).`)
  if (estimatedAcquisition) warnings.push(`${estimatedAcquisition} asset(s) have no purchase or in-use date; the date they were added to the register is used as the acquisition date.`)

  return {
    title: `Tax depreciation schedule — income year ${fy}`,
    description: 'Depreciation allowance under the Income Tax Act 2023, Third Schedule, grouped by asset class. Attach to the income-tax return.',
    range,
    summary: [
      { label: 'WDV brought forward', value: sec.totals.openingWdv ?? 0, type: 'money' },
      { label: 'Additions', value: sec.totals.additions ?? 0, type: 'money' },
      { label: 'Depreciation allowance', value: sec.totals.allowance ?? 0, type: 'money' },
      { label: 'WDV carried forward', value: sec.totals.closingWdv ?? 0, type: 'money' },
    ],
    sections: [
      section('summary', 'Summary by class', summaryCols, { rows: summaryRows }),
      sec,
    ],
    notes: [
      'Written-down value method per income year (July–June); a full year\'s allowance in the year of acquisition and none in the year of disposal (Third Schedule para 7).',
      'Software is amortised straight-line on cost (20% developed in Bangladesh, 10% foreign). Passenger-vehicle cost for tax is capped at Tk 30,00,000 (para 3(1)).',
      'Capitalised repairs and cost corrections are added to the WDV of the income year they were made in (a full year\'s allowance on them that year, none in the year of disposal); earlier years are not restated.',
      'Disposals: taxable gain / (loss) = sale proceeds − WDV. Use the higher of proceeds and fair market value where the law requires it.',
      'Allowance is not available for an income year in which the asset was not used for the business (para 2(9)(b)) — adjust manually if that applies.',
    ],
    warnings,
    filters: { fy },
  }
}

// ── 7. Disposals ─────────────────────────────────────────────────────────────

async function disposalsReport(sp, ctx) {
  const range = resolveRange(sp, ctx.startMonth)
  const assets = await Asset.find({
    isArchived: { $ne: true },
    'disposal.type': { $in: DISPOSAL_TYPES },
    'disposal.date': { $gte: range.start, $lt: range.next },
  }).select(ASSET_LIST_FIELDS).sort({ 'disposal.date': 1 }).lean()
  const catMap = await loadCategoryMap()
  const cols = [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'tag', label: 'Tag', type: 'tag' },
    { key: 'name', label: 'Asset', type: 'text' },
    { key: 'category', label: 'Category', type: 'text' },
    { key: 'type', label: 'Disposal', type: 'status' },
    { key: 'buyer', label: 'Buyer', type: 'text' },
    { key: 'cost', label: 'Cost', type: 'money' },
    { key: 'accumulated', label: 'Accum. depreciation', type: 'money' },
    { key: 'bookValue', label: 'NBV at disposal', type: 'money' },
    { key: 'proceeds', label: 'Proceeds (excl. VAT)', type: 'money' },
    { key: 'vat', label: 'Output VAT', type: 'money' },
    { key: 'gainLoss', label: 'Gain / (loss)', type: 'money' },
    { key: 'reason', label: 'Reason', type: 'text' },
  ]
  const rows = assets.map(a => {
    const d = a.disposal || {}
    const capitalised = a.isCapitalized !== false
    const nbv = !capitalised ? 0 : (d.bookValue !== null && d.bookValue !== undefined ? round2(num(d.bookValue)) : round2(num(a.cost) - effectiveAccumulated(a)))
    const proceeds = round2(num(d.proceeds))
    return {
      _id: String(a._id),
      _href: assetHref(a),
      date: dayKeyOrNull(d.date),
      tag: a.assetTag,
      name: a.name,
      category: categoryLabel(catMap.get(idStr(a.categoryId))),
      type: d.type || a.status,
      buyer: [d.buyerName, d.buyerBin ? `BIN ${d.buyerBin}` : null].filter(Boolean).join(' · ') || null,
      cost: round2(num(a.cost)),
      accumulated: capitalised ? round2(num(a.cost) - nbv) : 0,
      bookValue: nbv,
      proceeds,
      vat: round2(num(d.vatAmount)),
      gainLoss: d.gainLoss !== null && d.gainLoss !== undefined ? round2(num(d.gainLoss)) : round2(proceeds - nbv),
      reason: d.reason ?? null,
    }
  })
  const t = totalsOf(rows, cols)
  return {
    title: 'Asset disposals',
    description: 'Assets sold, scrapped, written off or donated, with the gain or loss against net book value.',
    range,
    summary: [
      { label: 'Disposals', value: rows.length, type: 'number' },
      { label: 'Proceeds', value: t.proceeds ?? 0, type: 'money' },
      { label: 'NBV disposed', value: t.bookValue ?? 0, type: 'money' },
      { label: 'Net gain / (loss)', value: t.gainLoss ?? 0, type: 'money' },
    ],
    sections: [section('disposals', null, cols, { rows })],
    notes: ['Gain or loss on disposal is other income / expense, not revenue. Output VAT on sales is reported through the VAT return.'],
  }
}

// ── 8. Damage, loss & recovery register ─────────────────────────────────────

/** Staff events that mean an employee's self-reported problem has been dealt with. */
const SELF_REPORT_FOLLOW_UPS = ['DAMAGE_REPORTED', 'REPAIR_SENT', 'REPAIR_COMPLETED', 'RETURNED', 'LOST', 'STOLEN', 'FOUND',
  'WRITTEN_OFF', 'SCRAPPED', 'SOLD', 'DONATED', 'RECOVERY_UPDATED']

function recoveryTargetId(ev) {
  const d = ev.details || {}
  return idStr(d.eventId ?? d.damageEventId ?? d.damageEvent ?? d.targetEventId ?? null)
}

async function damageReport(sp, ctx) {
  const range = resolveRange(sp, ctx.startMonth)
  const employeeId = optObjectId(sp, 'employeeId', 'employee')
  const statusFilter = enumParam(sp, 'recoveryStatus', ['PENDING', 'RECOVERED', 'WAIVED', 'NOT_APPLICABLE', 'AWAITING_ASSESSMENT'], null)

  const events = await AssetEvent.find({
    type: { $in: ['DAMAGE_REPORTED', 'LOST', 'STOLEN'] },
    date: { $gte: range.start, $lt: range.next },
  }).sort({ date: 1, createdAt: 1 }).lean()
  const assetIds = [...new Set(events.map(e => String(e.assetId)))]
  const [assets, updates] = await Promise.all([
    assetIds.length ? Asset.find({ _id: { $in: assetIds } }).select('assetTag name categoryId assignedEmployeeId cost depreciation opening isCapitalized').lean() : [],
    assetIds.length ? AssetEvent.find({ type: 'RECOVERY_UPDATED', assetId: { $in: assetIds } }).sort({ date: 1, createdAt: 1 }).lean() : [],
  ])
  const assetMap = new Map(assets.map(a => [String(a._id), a]))

  // Employee self-reports (My Assets) carry no assessment. Once staff acted on one
  // (an assessment pointing at it, details.assessed, or any later staff event on
  // the asset) the staff record is the register entry; until then it is listed
  // as "awaiting assessment".
  const selfReports = events.filter(e => e.details?.reportedByEmployee && !e.details?.recovery)
  const linkedReports = new Set(events.map(e => idStr(e.details?.reportEventId)).filter(Boolean))
  const followUps = selfReports.length
    ? await AssetEvent.find({
      assetId: { $in: [...new Set(selfReports.map(e => e.assetId))] },
      type: { $in: SELF_REPORT_FOLLOW_UPS },
      'details.reportedByEmployee': { $ne: true },
      createdAt: { $gte: selfReports.reduce((m, e) => (e.createdAt < m ? e.createdAt : m), selfReports[0].createdAt) },
    }).select('assetId createdAt').lean()
    : []
  const selfReportAssessed = (e) => e.details?.assessed === true || linkedReports.has(String(e._id)) ||
    followUps.some(f => String(f.assetId) === String(e.assetId) && new Date(f.createdAt) > new Date(e.createdAt))

  // Attach each recovery update to its damage event (explicit id, else the latest earlier case of that asset).
  const byEvent = new Map()
  const casesByAsset = new Map()
  for (const e of events) {
    const k = String(e.assetId)
    if (!casesByAsset.has(k)) casesByAsset.set(k, [])
    casesByAsset.get(k).push(e)
  }
  for (const u of updates) {
    let target = recoveryTargetId(u)
    if (!target) {
      const cases = (casesByAsset.get(String(u.assetId)) || []).filter(c => new Date(c.date) <= new Date(u.date) && !(c.details?.reportedByEmployee && !c.details?.recovery))
      target = cases.length ? String(cases[cases.length - 1]._id) : null
    }
    if (!target) continue
    if (!byEvent.has(target)) byEvent.set(target, [])
    byEvent.get(target).push(u)
  }

  const empIds = []
  for (const e of events) {
    const d = e.details || {}
    if (d.responsibleEmployeeId) empIds.push(d.responsibleEmployeeId)
    if (e.fromEmployeeId) empIds.push(e.fromEmployeeId)
    const a = assetMap.get(String(e.assetId))
    if (a?.assignedEmployeeId) empIds.push(a.assignedEmployeeId)
  }
  const empMap = await loadEmployeeMap(empIds)

  const cols = [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'tag', label: 'Tag', type: 'tag' },
    { key: 'name', label: 'Asset', type: 'text' },
    { key: 'kind', label: 'Event', type: 'text' },
    { key: 'cause', label: 'Cause', type: 'text' },
    { key: 'responsible', label: 'Responsible employee', type: 'text' },
    { key: 'description', label: 'Description / enquiry', type: 'text' },
    { key: 'assessedLoss', label: 'Assessed loss', type: 'money' },
    { key: 'liabilityPct', label: 'Liability %', type: 'percent' },
    { key: 'method', label: 'Recovery method', type: 'text' },
    { key: 'recoverable', label: 'To recover', type: 'money' },
    { key: 'recovered', label: 'Recovered', type: 'money' },
    { key: 'outstanding', label: 'Still to recover', type: 'money' },
    { key: 'recoveryStatus', label: 'Recovery status', type: 'text' },
    { key: 'gdNumber', label: 'GD no.', type: 'text' },
    { key: 'reportedBy', label: 'Recorded by', type: 'text' },
  ]

  const rows = []
  for (const e of events) {
    const d = e.details || {}
    const a = assetMap.get(String(e.assetId))
    const selfReport = Boolean(d.reportedByEmployee) && !d.recovery
    if (selfReport && selfReportAssessed(e)) continue
    const respId = idStr(d.responsibleEmployeeId) ||
      (selfReport ? idStr(d.reporterEmployeeId) : e.type === 'DAMAGE_REPORTED' ? null : idStr(e.fromEmployeeId))
    if (employeeId && respId !== employeeId) continue
    const rec = d.recovery || {}
    const assessed = selfReport ? null : firstNum(d.assessedLoss, e.amount)
    const liability = firstNum(d.liabilityPct)
    let recoverable = firstNum(rec.amount)
    if (recoverable === null && assessed !== null && liability !== null) recoverable = round2(assessed * liability / 100)
    // update_recovery also writes the outcome onto the damage event itself, so the
    // RECOVERY_UPDATED events are the source when present (never both): every
    // instalment adds what it recovered (a part payment keeps the case PENDING) and
    // the update recorded last decides the status (recoveryProgress).
    const ups = byEvent.get(String(e._id)) || []
    const progress = recoveryProgress(d.recovery, ups)
    const status = selfReport ? 'AWAITING_ASSESSMENT'
      : progress.status || (e.type === 'DAMAGE_REPORTED' ? (recoverable > 0 ? 'PENDING' : 'NOT_APPLICABLE') : 'NOT_APPLICABLE')
    const method = progress.method || null
    const recovered = progress.recoveredAmount ?? (status === 'RECOVERED' ? recoverable ?? 0 : 0)
    const outstanding = status === 'PENDING' && recoverable !== null ? round2(Math.max(0, recoverable - recovered)) : null
    if (statusFilter && status !== statusFilter) continue
    // Staff records keep the description both as the event note and in details (the
    // timeline and employee views read either) — list each text once, then the extra
    // note staff added and the enquiry findings.
    const texts = [...new Set([d.description, e.notes, d.extraNotes].map(s => (typeof s === 'string' ? s.trim() : '')).filter(Boolean))]
    if (d.enquiryNote) texts.push(`Enquiry: ${d.enquiryNote}`)
    const kindLabel = e.type === 'DAMAGE_REPORTED'
      ? (d.reportedByEmployee ? `${d.reportType === 'NOT_WORKING' ? 'Fault' : 'Damage'} (reported by employee)` : 'Damage')
      : `${e.type === 'LOST' ? 'Lost' : 'Stolen'}${selfReport ? ' (reported by employee, unconfirmed)' : ''}`
    rows.push({
      _id: String(e._id),
      _href: a ? assetHref(a) : null,
      date: dayKeyOrNull(e.date),
      tag: a?.assetTag ?? null,
      name: a?.name ?? '(deleted asset)',
      kind: kindLabel,
      cause: d.cause ? (DAMAGE_CAUSE_LABELS[d.cause] ?? d.cause) : null,
      responsible: respId ? (employeeLabel(empMap.get(respId)) ?? null) : null,
      description: texts.join(' — ') || null,
      assessedLoss: assessed,
      liabilityPct: liability,
      method: method ? (RECOVERY_METHOD_LABELS[method] ?? method) : null,
      recoverable,
      recovered,
      outstanding,
      recoveryStatus: status === 'AWAITING_ASSESSMENT' ? 'Awaiting assessment' : (RECOVERY_STATUS_META[status]?.label ?? status),
      gdNumber: d.gdNumber ?? null,
      reportedBy: e.createdByName ?? null,
    })
  }
  const t = totalsOf(rows, cols)
  return {
    title: 'Damage, loss & recovery register',
    description: 'Damage and loss of company property with the employee responsible and any recovery — the register required for deductions under the Bangladesh Labour Act 2006, s.125 and s.127.',
    range,
    summary: [
      { label: 'Cases', value: rows.length, type: 'number' },
      { label: 'Assessed loss', value: t.assessedLoss ?? 0, type: 'money' },
      { label: 'Recovered', value: t.recovered ?? 0, type: 'money' },
      { label: 'Recovery outstanding', value: t.outstanding ?? 0, type: 'money' },
    ],
    sections: [section('damage', null, cols, { rows })],
    notes: [
      'Labour Act s.125(2)(c) / s.127: a deduction for damage or loss is allowed only when it was directly caused by the worker\'s neglect or default, must not exceed the loss, and only after the worker was given a chance to explain. Keep the enquiry note with each case.',
    ],
    filters: { employeeId, recoveryStatus: statusFilter },
  }
}

function firstNum(...vals) {
  for (const v of vals) {
    if (v === null || v === undefined || v === '') continue
    const n = Number(v)
    if (Number.isFinite(n)) return round2(n)
  }
  return null
}

// ── 9. Maintenance (repairs) ─────────────────────────────────────────────────

async function maintenanceReport(sp, ctx) {
  const range = resolveRange(sp, ctx.startMonth)
  const groupBy = enumParam(sp, 'groupBy', ['vendor', 'asset', 'category'], 'vendor')
  const events = await AssetEvent.find({ type: 'REPAIR_COMPLETED', date: { $gte: range.start, $lt: range.next } })
    .sort({ date: 1, createdAt: 1 }).lean()
  const assetIds = [...new Set(events.map(e => String(e.assetId)))]
  const vendorIds = [...new Set(events.map(e => idStr(e.vendorId)).filter(Boolean))]
  const [assets, vendors, catMap] = await Promise.all([
    assetIds.length ? Asset.find({ _id: { $in: assetIds } }).select('assetTag name categoryId').lean() : [],
    vendorIds.length ? Vendor.find({ _id: { $in: vendorIds } }).select('company').lean() : [],
    loadCategoryMap(),
  ])
  const assetMap = new Map(assets.map(a => [String(a._id), a]))
  const vendorMap = new Map(vendors.map(v => [String(v._id), v.company]))
  const cols = [
    { key: 'date', label: 'Completed', type: 'date' },
    { key: 'tag', label: 'Tag', type: 'tag' },
    { key: 'name', label: 'Asset', type: 'text' },
    { key: 'vendor', label: 'Repairer', type: 'text' },
    { key: 'repairRef', label: 'Repair ref.', type: 'text' },
    { key: 'cost', label: 'Cost', type: 'money' },
    { key: 'capitalised', label: 'Capitalised', type: 'money' },
    { key: 'expensed', label: 'Expensed', type: 'money' },
    { key: 'notes', label: 'Notes', type: 'text' },
  ]
  const rows = events.map(e => {
    const d = e.details || {}
    const a = assetMap.get(String(e.assetId))
    const cost = firstNum(e.amount, d.cost) ?? 0
    const capitalise = d.capitalize === true || d.capitalise === true
    const vendor = (e.vendorId && vendorMap.get(idStr(e.vendorId))) || d.vendorName || null
    const cat = a ? catMap.get(idStr(a.categoryId)) : null
    const groupKey = groupBy === 'vendor' ? (vendor || '__none') : groupBy === 'asset' ? String(e.assetId) : (idStr(a?.categoryId) || '__none')
    const groupLabel = groupBy === 'vendor' ? (vendor || 'Repairer not recorded') : groupBy === 'asset' ? (a ? `${a.assetTag} — ${a.name}` : '(deleted asset)') : categoryLabel(cat)
    return {
      _id: String(e._id),
      _href: a ? assetHref(a) : null,
      _group: groupKey,
      _groupLabel: groupLabel,
      date: dayKeyOrNull(e.date),
      tag: a?.assetTag ?? null,
      name: a?.name ?? '(deleted asset)',
      vendor,
      repairRef: d.repairRef ?? null,
      cost,
      capitalised: capitalise ? cost : 0,
      expensed: capitalise ? 0 : cost,
      notes: e.notes ?? null,
    }
  })
  const groups = groupRows(rows, r => r._group, r => r._groupLabel, cols)
  for (const g of groups) g.sublabel = `${g.rows.length} repair${g.rows.length === 1 ? '' : 's'}`
  const t = totalsOf(rows, cols)
  return {
    title: 'Repairs & maintenance',
    description: `Completed repairs and their cost, grouped by ${groupBy}.`,
    range,
    summary: [
      { label: 'Repairs', value: rows.length, type: 'number' },
      { label: 'Total cost', value: t.cost ?? 0, type: 'money' },
      { label: 'Capitalised', value: t.capitalised ?? 0, type: 'money' },
      { label: 'Expensed', value: t.expensed ?? 0, type: 'money' },
    ],
    sections: [section('repairs', null, cols, { groups })],
    filters: { groupBy },
  }
}

// ── 10. Stock valuation ─────────────────────────────────────────────────────

async function stockValuationReport(sp) {
  const asOfDay = sp.get('asOf') || null
  if (asOfDay && !isDayKey(asOfDay)) throw httpError(422, 'asOf must be a date (YYYY-MM-DD)')
  const categoryId = optObjectId(sp, 'categoryId', 'category')
  const filter = categoryId ? { categoryId } : {}
  const items = await StockItem.find(filter).sort({ name: 1 }).lean()
  const [catMap, locMap] = await Promise.all([loadCategoryMap(), loadLocationMap()])
  const warnings = []

  let valued = items.map(it => ({ it, qty: num(it.qtyOnHand), avg: num(it.avgCost), value: round2(num(it.stockValue)) }))
  if (asOfDay) {
    const next = parseDhakaDay(asOfDay).next
    const moves = items.length ? await StockMovement.find({ stockItemId: { $in: items.map(i => i._id) }, date: { $lt: next } })
      .select('stockItemId direction qty unitCost date createdAt').sort({ date: 1, createdAt: 1 }).lean() : []
    const by = new Map()
    for (const m of moves) {
      const k = String(m.stockItemId)
      if (!by.has(k)) by.set(k, [])
      by.get(k).push(m)
    }
    let negative = 0
    valued = items.map(it => {
      let q = 0
      let avg = 0
      for (const m of by.get(String(it._id)) || []) {
        const mq = num(m.qty)
        if (m.direction === 'IN') {
          const base = Math.max(q, 0)
          avg = base + mq > 0 ? (base * avg + mq * num(m.unitCost)) / (base + mq) : num(m.unitCost)
          q += mq
        } else {
          q -= mq
        }
      }
      if (q < -0.00005) negative++
      q = Math.round(q * 10000) / 10000
      avg = Math.round(avg * 10000) / 10000
      return { it, qty: q, avg, value: round2(Math.max(q, 0) * avg) }
    })
    if (negative) warnings.push(`${negative} item(s) show a negative quantity on ${dayKeyLabel(asOfDay)} because issues were back-dated before their receipts — check those items' movements.`)
  }

  const cols = [
    { key: 'sku', label: 'SKU', type: 'text' },
    { key: 'name', label: 'Item', type: 'text' },
    { key: 'unit', label: 'Unit', type: 'text' },
    { key: 'location', label: 'Location', type: 'text' },
    { key: 'qty', label: 'On hand', type: 'number' },
    { key: 'avgCost', label: 'Average cost', type: 'money', total: false },
    { key: 'value', label: 'Value', type: 'money' },
    { key: 'reorderLevel', label: 'Reorder level', type: 'number', total: false },
  ]
  const rows = valued
    .filter(v => v.it.isActive !== false || Math.abs(v.qty) > 0.00005)
    .map(({ it, qty, avg, value }) => {
      const cat = it.categoryId ? catMap.get(idStr(it.categoryId)) : null
      return {
        _id: String(it._id),
        _href: `/admin/inventory/stock?item=${String(it._id)}`,
        _group: idStr(it.categoryId) || '__none',
        _groupLabel: categoryLabel(cat),
        sku: it.sku,
        name: it.isActive === false ? `${it.name} (inactive)` : it.name,
        unit: it.unit || 'pcs',
        location: it.locationId ? locMap.get(idStr(it.locationId))?.path ?? null : null,
        qty,
        avgCost: round2(avg),
        value,
        reorderLevel: num(it.reorderLevel),
      }
    })
  const groups = groupRows(rows, r => r._group, r => r._groupLabel, cols)
  const t = totalsOf(rows, cols)
  return {
    title: asOfDay ? `Stock valuation as at ${dayKeyLabel(asOfDay)}` : 'Stock valuation',
    description: 'Consumable stock on hand at moving weighted-average cost (IAS 2).',
    summary: [
      { label: 'Items', value: rows.length, type: 'number' },
      { label: 'Stock value', value: t.value ?? 0, type: 'money' },
      { label: 'Out of stock', value: rows.filter(r => r.qty <= 0).length, type: 'number' },
    ],
    sections: [section('stock', null, cols, { groups })],
    notes: asOfDay ? ['Quantities and average cost are rebuilt from the movements dated on or before this date, in date order.'] : [],
    warnings,
    filters: { asOf: asOfDay, categoryId },
  }
}

// ── 11. Low stock ────────────────────────────────────────────────────────────

async function lowStockReport() {
  const items = await StockItem.find({
    isActive: { $ne: false },
    $or: [
      { $expr: { $and: [{ $gt: ['$reorderLevel', 0] }, { $lte: ['$qtyOnHand', '$reorderLevel'] }] } },
      { qtyOnHand: { $lte: 0 } },
    ],
  }).sort({ name: 1 }).lean()
  const vendorIds = [...new Set(items.map(i => idStr(i.preferredVendorId)).filter(Boolean))]
  const [catMap, vendors] = await Promise.all([
    loadCategoryMap(),
    vendorIds.length ? Vendor.find({ _id: { $in: vendorIds } }).select('company').lean() : [],
  ])
  const vendorMap = new Map(vendors.map(v => [String(v._id), v.company]))
  const cols = [
    { key: 'sku', label: 'SKU', type: 'text' },
    { key: 'name', label: 'Item', type: 'text' },
    { key: 'category', label: 'Category', type: 'text' },
    { key: 'unit', label: 'Unit', type: 'text' },
    { key: 'qty', label: 'On hand', type: 'number', total: false },
    { key: 'reorderLevel', label: 'Reorder level', type: 'number', total: false },
    { key: 'suggested', label: 'Suggested order', type: 'number', total: false },
    { key: 'vendor', label: 'Preferred supplier', type: 'text' },
    { key: 'estCost', label: 'Est. cost', type: 'money' },
  ]
  const rows = items.map(it => {
    const qty = num(it.qtyOnHand)
    const level = num(it.reorderLevel)
    const suggested = Math.max(num(it.reorderQty), Math.max(0, level - qty), qty <= 0 && level <= 0 ? 1 : 0)
    return {
      _id: String(it._id),
      _href: `/admin/inventory/stock?item=${String(it._id)}`,
      sku: it.sku,
      name: it.name,
      category: it.categoryId ? categoryLabel(catMap.get(idStr(it.categoryId))) : null,
      unit: it.unit || 'pcs',
      qty,
      reorderLevel: level,
      suggested,
      vendor: it.preferredVendorId ? vendorMap.get(idStr(it.preferredVendorId)) ?? null : null,
      estCost: round2(suggested * num(it.avgCost)),
      _shortfall: level - qty,
    }
  }).sort((a, b) => b._shortfall - a._shortfall)
  return {
    title: 'Low stock',
    description: 'Consumables at or below their reorder level, or out of stock.',
    summary: [
      { label: 'Items to reorder', value: rows.length, type: 'number' },
      { label: 'Out of stock', value: rows.filter(r => r.qty <= 0).length, type: 'number' },
      { label: 'Estimated reorder cost', value: totalsOf(rows, cols).estCost ?? 0, type: 'money' },
    ],
    sections: [section('low', null, cols, { rows })],
    notes: ['Suggested order = the item\'s reorder quantity, or enough to get back to the reorder level, whichever is more. Estimated at the current average cost.'],
  }
}

// ── 12. Consumption ──────────────────────────────────────────────────────────

async function consumptionReport(sp, ctx) {
  const range = resolveRange(sp, ctx.startMonth)
  const groupBy = enumParam(sp, 'groupBy', ['employee', 'department', 'month', 'item'], 'employee')
  const employeeId = optObjectId(sp, 'employeeId', 'employee')
  const filter = { type: { $in: ['ISSUE', 'RETURN'] }, date: { $gte: range.start, $lt: range.next } }
  if (employeeId) filter.employeeId = employeeId
  const moves = await StockMovement.find(filter).select('stockItemId type qty totalCost unitCost employeeId departmentId date').sort({ date: 1 }).lean()
  const itemIds = [...new Set(moves.map(m => String(m.stockItemId)))]
  const [items, empMap, deptMap] = await Promise.all([
    itemIds.length ? StockItem.find({ _id: { $in: itemIds } }).select('sku name unit').lean() : [],
    loadEmployeeMap(moves.map(m => m.employeeId).filter(Boolean)),
    loadDepartmentMap(moves.map(m => m.departmentId).filter(Boolean)),
  ])
  const itemMap = new Map(items.map(i => [String(i._id), i]))

  const groupOf = (m) => {
    if (groupBy === 'employee') {
      const e = m.employeeId ? empMap.get(idStr(m.employeeId)) : null
      if (e) return { key: `e:${e.id}`, label: employeeLabel(e) }
      const d = m.departmentId ? deptMap.get(idStr(m.departmentId)) : null
      return d ? { key: `d:${d.id}`, label: `${d.name} (department)` } : { key: '__none', label: 'Not issued to a person' }
    }
    if (groupBy === 'department') {
      const d = m.departmentId ? deptMap.get(idStr(m.departmentId)) : null
      if (d) return { key: `d:${d.id}`, label: d.name }
      const e = m.employeeId ? empMap.get(idStr(m.employeeId)) : null
      return e?.department ? { key: `s:${e.department}`, label: e.department } : { key: '__none', label: 'No department' }
    }
    if (groupBy === 'month') {
      const p = periodOfDate(m.date)
      return { key: p, label: periodLabelOf(p) }
    }
    const it = itemMap.get(String(m.stockItemId))
    return { key: String(m.stockItemId), label: it ? `${it.name} (${it.sku})` : '(deleted item)' }
  }

  const cols = [
    ...(groupBy === 'item' ? [{ key: 'who', label: 'Issued to', type: 'text' }] : [{ key: 'item', label: 'Item', type: 'text' }]),
    { key: 'unit', label: 'Unit', type: 'text' },
    { key: 'issued', label: 'Issued', type: 'number' },
    { key: 'returned', label: 'Returned', type: 'number' },
    { key: 'net', label: 'Net used', type: 'number' },
    { key: 'value', label: 'Value', type: 'money' },
  ]
  const agg = new Map()
  for (const m of moves) {
    const g = groupOf(m)
    const it = itemMap.get(String(m.stockItemId))
    let subKey
    let subLabel
    if (groupBy === 'item') {
      const e = m.employeeId ? empMap.get(idStr(m.employeeId)) : null
      const d = m.departmentId ? deptMap.get(idStr(m.departmentId)) : null
      subKey = e ? `e:${e.id}` : d ? `d:${d.id}` : '__none'
      subLabel = e ? employeeLabel(e) : d ? `${d.name} (department)` : 'Not recorded'
    } else {
      subKey = String(m.stockItemId)
      subLabel = it ? `${it.name} (${it.sku})` : '(deleted item)'
    }
    const k = `${g.key}|${subKey}`
    if (!agg.has(k)) agg.set(k, { _id: k, _group: g.key, _groupLabel: g.label, sub: subLabel, unit: it?.unit || 'pcs', issued: 0, returned: 0, value: 0 })
    const row = agg.get(k)
    const q = num(m.qty)
    const v = num(m.totalCost) || round2(q * num(m.unitCost))
    if (m.type === 'ISSUE') { row.issued += q; row.value += v } else { row.returned += q; row.value -= v }
  }
  const rows = [...agg.values()].map(r => ({
    _id: r._id,
    _group: r._group,
    _groupLabel: r._groupLabel,
    [groupBy === 'item' ? 'who' : 'item']: r.sub,
    unit: r.unit,
    issued: Math.round(r.issued * 10000) / 10000,
    returned: Math.round(r.returned * 10000) / 10000,
    net: Math.round((r.issued - r.returned) * 10000) / 10000,
    value: round2(r.value),
  })).sort((a, b) => String(a[groupBy === 'item' ? 'who' : 'item']).localeCompare(String(b[groupBy === 'item' ? 'who' : 'item'])))
  const groups = groupRows(rows, r => r._group, r => r._groupLabel, cols, { sort: groupBy !== 'month' })
  if (groupBy === 'month') groups.sort((a, b) => a.key.localeCompare(b.key))
  // Quantities are only additive within one item (grouping by item); elsewhere a
  // group mixes different items and units, so only the value is totalled.
  const qtyKeys = ['issued', 'returned', 'net']
  if (groupBy !== 'item') for (const g of groups) for (const k of qtyKeys) g.totals[k] = null
  const sec = section('consumption', null, cols, { groups })
  if (groupBy !== 'item' || groups.length > 1) for (const k of qtyKeys) sec.totals[k] = null
  return {
    title: 'Consumable usage',
    description: `Stock issued (net of returns), grouped by ${groupBy}.`,
    range,
    summary: [
      { label: 'Issues', value: moves.filter(m => m.type === 'ISSUE').length, type: 'number' },
      { label: 'Returns', value: moves.filter(m => m.type === 'RETURN').length, type: 'number' },
      { label: 'Net value used', value: sec.totals.value ?? 0, type: 'money' },
    ],
    sections: [sec],
    filters: { groupBy, employeeId },
  }
}

// ── 13. PPE movement schedule ────────────────────────────────────────────────

async function ppeMovementReport(sp, ctx) {
  const range = fiscalRangeOf(sp.get('fy'), ctx.startMonth)
  const S = range.start
  const N = range.next
  const assets = await loadCapitalisedAssets()
  const [histories, catMap] = await Promise.all([buildAssetHistories(assets), loadCategoryMap()])

  const blank = () => ({
    cOpen: 0, cIn: 0, cAdd: 0, cAdj: 0, cDisp: 0, cClose: 0,
    aOpen: 0, aIn: 0, aCharge: 0, aImp: 0, aDisp: 0, aClose: 0, count: 0,
  })
  const byCat = new Map()
  let unexplained = 0
  let terminalWithoutDate = 0
  for (const a of assets) {
    const h = histories.get(String(a._id))
    if (!h) continue
    const end = h.disposalEnd
    if (!end && TERMINAL_STATUSES.includes(a.status)) terminalWithoutDate++
    if (end && end <= S) continue // disposed before the year
    // Disposal dates are "end of the disposal day" (exclusive), so a disposal on the
    // last day of the year gives end === N.
    const disposedInYear = Boolean(end && end > S && end <= N)
    const inYearEnd = disposedInYear ? end : N
    const r = {
      cOpen: sumBefore(h.cost, S),
      cIn: sumBetween(h.cost, S, inYearEnd, ['OPENING']),
      cAdd: sumBetween(h.cost, S, inYearEnd, ['ACQ']),
      cAdj: sumBetween(h.cost, S, inYearEnd, ['ADJ']),
      aOpen: sumBefore(h.acc, S),
      aIn: sumBetween(h.acc, S, inYearEnd, ['OPENING']),
      aCharge: sumBetween(h.acc, S, inYearEnd, ['DEP']),
      aImp: sumBetween(h.acc, S, inYearEnd, ['IMP']),
    }
    r.cDisp = disposedInYear ? sumBefore(h.cost, end) : 0
    r.aDisp = disposedInYear ? sumBefore(h.acc, end) : 0
    r.cClose = disposedInYear ? 0 : sumBefore(h.cost, N)
    r.aClose = disposedInYear ? 0 : sumBefore(h.acc, N)
    const touched = Object.values(r).some(v => Math.abs(v) >= 0.005)
    if (!touched) continue
    if (h.unexplainedCost || h.unexplainedAcc) unexplained++
    const k = idStr(a.categoryId) || '__none'
    if (!byCat.has(k)) byCat.set(k, blank())
    const t = byCat.get(k)
    for (const key of Object.keys(r)) t[key] = round2(t[key] + r[key])
    t.count++
  }

  const catRows = [...byCat.entries()].map(([k, t]) => ({ k, label: categoryLabel(catMap.get(k)), t }))
    .sort((x, y) => x.label.localeCompare(y.label))

  const openLabel = `At ${dayKeyLabel(range.startDay)}`
  const closeLabel = `At ${dayKeyLabel(range.endDay)}`
  const anyIn = catRows.some(c => Math.abs(c.t.cIn) >= 0.005 || Math.abs(c.t.aIn) >= 0.005)
  const anyAdj = catRows.some(c => Math.abs(c.t.cAdj) >= 0.005)
  const anyImp = catRows.some(c => Math.abs(c.t.aImp) >= 0.005)

  const costCols = [
    { key: 'category', label: 'Category', type: 'text' },
    { key: 'open', label: openLabel, type: 'money' },
    ...(anyIn ? [{ key: 'in', label: 'Opening register (go-live)', type: 'money' }] : []),
    { key: 'add', label: 'Additions', type: 'money' },
    ...(anyAdj ? [{ key: 'adj', label: 'Capitalised repairs / revaluation', type: 'money' }] : []),
    { key: 'disp', label: 'Disposals', type: 'money' },
    { key: 'close', label: closeLabel, type: 'money' },
  ]
  const accCols = [
    { key: 'category', label: 'Category', type: 'text' },
    { key: 'open', label: openLabel, type: 'money' },
    ...(anyIn ? [{ key: 'in', label: 'Opening register (go-live)', type: 'money' }] : []),
    { key: 'charge', label: 'Charge for the year', type: 'money' },
    ...(anyImp ? [{ key: 'imp', label: 'Impairment', type: 'money' }] : []),
    { key: 'disp', label: 'Eliminated on disposal', type: 'money' },
    { key: 'close', label: closeLabel, type: 'money' },
  ]
  const nbvCols = [
    { key: 'category', label: 'Category', type: 'text' },
    { key: 'assets', label: 'Assets', type: 'number' },
    { key: 'open', label: openLabel, type: 'money' },
    { key: 'close', label: closeLabel, type: 'money' },
  ]
  const costRows = catRows.map(c => ({ _id: c.k, category: c.label, open: c.t.cOpen, in: c.t.cIn, add: c.t.cAdd, adj: c.t.cAdj, disp: c.t.cDisp, close: c.t.cClose }))
  const accRows = catRows.map(c => ({ _id: c.k, category: c.label, open: c.t.aOpen, in: c.t.aIn, charge: c.t.aCharge, imp: c.t.aImp, disp: c.t.aDisp, close: c.t.aClose }))
  const nbvRows = catRows.map(c => ({ _id: c.k, category: c.label, assets: c.t.count, open: round2(c.t.cOpen - c.t.aOpen), close: round2(c.t.cClose - c.t.aClose) }))
  const costSec = section('cost', 'Cost', costCols, { rows: costRows })
  const accSec = section('accumulated', 'Accumulated depreciation & impairment', accCols, { rows: accRows })
  const nbvSec = section('nbv', 'Net book value', nbvCols, { rows: nbvRows })

  // Cross-check the year's charge against the 'Depreciation' expense in the ledger.
  const warnings = []
  const ledger = await Transaction.aggregate([
    { $match: { category: 'Depreciation', date: { $gte: S, $lt: N } } },
    { $group: { _id: '$type', total: { $sum: { $convert: { input: { $ifNull: ['$amountBDT', '$amount'] }, to: 'double', onError: 0, onNull: 0 } } } } },
  ])
  const ledgerDep = round2(ledger.reduce((s, g) => s + (g._id === 'INCOME' ? -g.total : g.total), 0))
  const charge = accSec.totals.charge ?? 0
  if (ctx.settings?.inventory?.postDepreciationToLedger !== false && Math.abs(ledgerDep - charge) > 1) {
    warnings.push(`Charge for the year (Tk ${charge.toLocaleString('en-IN')}) differs from the 'Depreciation' expense in the ledger for the same year (Tk ${ledgerDep.toLocaleString('en-IN')}). Check depreciation posted outside the asset register or runs posted while ledger posting was off.`)
  }
  if (unexplained) warnings.push(`${unexplained} asset(s) have cost or accumulated depreciation that cannot be traced to a run, disposal or adjustment record; the difference is shown at acquisition.`)
  if (terminalWithoutDate) warnings.push(`${terminalWithoutDate} disposed asset(s) have no disposal date and are still included at cost.`)
  const goLive = ctx.settings?.goLiveDate
  if (goLive && goLive > range.startDay && goLive <= range.endDay) {
    warnings.push(`Go-live (${dayKeyLabel(goLive)}) falls inside this year — the opening register is shown in its own column and depreciation before go-live is not in the charge for the year.`)
  } else if (goLive && goLive > range.endDay) {
    warnings.push(`This year ends before go-live (${dayKeyLabel(goLive)}); opening-register assets are not included.`)
  }

  return {
    title: `Property, plant & equipment — movement schedule FY ${range.fy}`,
    description: 'Opening + additions − disposals = closing, for cost and for accumulated depreciation, by category (IAS 16.73). Capitalised assets only.',
    range,
    summary: [
      { label: 'Cost at year end', value: costSec.totals.close ?? 0, type: 'money' },
      { label: 'Accumulated depreciation', value: accSec.totals.close ?? 0, type: 'money' },
      { label: 'Net book value', value: nbvSec.totals.close ?? 0, type: 'money' },
      { label: 'Charge for the year', value: charge, type: 'money' },
    ],
    sections: [costSec, accSec, nbvSec],
    notes: [
      'Additions are dated when the asset is available for use; disposals remove cost and accumulated depreciation on the disposal date.',
      'Depreciation is attributed to the month it was posted, matching the ledger.',
    ],
    warnings,
    filters: { fy: range.fy },
  }
}

// ── dispatcher ───────────────────────────────────────────────────────────────

const BUILDERS = {
  'register': registerReport,
  'custodian': custodianReport,
  'location': locationReport,
  'warranty': warrantyReport,
  'book-depreciation': bookDepreciationReport,
  'tax-depreciation': taxDepreciationReport,
  'disposals': disposalsReport,
  'damage': damageReport,
  'maintenance': maintenanceReport,
  'stock-valuation': stockValuationReport,
  'low-stock': lowStockReport,
  'consumption': consumptionReport,
  'ppe-movement': ppeMovementReport,
}

/**
 * Build a report. `ctx` = { settings, startMonth }.
 * Strips the private `_group*` fields from rows before returning.
 */
export async function buildReport(type, searchParams, ctx) {
  const builder = BUILDERS[type]
  if (!builder) throw httpError(422, `Unknown report type. Use one of: ${REPORT_TYPES.join(', ')}`)
  const res = await builder(searchParams, ctx)
  const clean = (r) => {
    const out = {}
    for (const [k, v] of Object.entries(r)) {
      if (k === '_id' || k === '_href' || !k.startsWith('_')) out[k] = v
    }
    return out
  }
  for (const s of res.sections) {
    if (s.groups) for (const g of s.groups) g.rows = g.rows.map(clean)
    if (s.rows) s.rows = s.rows.map(clean)
  }
  return {
    type,
    title: res.title,
    description: res.description ?? null,
    range: res.range ? { mode: res.range.mode, fy: res.range.fy ?? null, startDay: res.range.startDay, endDay: res.range.endDay, label: res.range.label } : null,
    fiscalYearStartMonth: ctx.startMonth,
    currentFiscalYear: fiscalYearOf(new Date(), ctx.startMonth),
    filters: res.filters ?? {},
    summary: res.summary ?? [],
    sections: res.sections,
    notes: res.notes ?? [],
    warnings: res.warnings ?? [],
    generatedAt: new Date().toISOString(),
  }
}

