export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import { Asset, AssetCategory, AssetEvent, Employee, InventoryLocation, StockItem, StockMovement } from '@/models'
import { canDoAny, requirePerm } from '@/lib/rbac'
import { logActivity } from '@/lib/logActivity'
import { getFinanceSettings } from '@/lib/finance/settings'
import { isDayKey, addDays, dayKeyLabel, fiscalYearOf } from '@/lib/finance/fiscal'
import { createAssets, ensureCategoriesSeeded, openingCostStages, CONDITIONS } from '@/lib/inventory/assets'
import { parseDhakaDay } from '@/lib/dhakaTime'
import { moveStock } from '@/lib/inventory/stock'
import { errorResponse, round2, num, escapeRegex, isTruthy } from '../reports/_lib/common'

const MAX_ASSET_ROWS = 2000
const MAX_STOCK_ROWS = 1000
const FY_RE = /^(\d{4})-(\d{2})$/

// ── cell parsers (CSV values arrive as strings) ─────────────────────────────

const text = (v, max = 300) => {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s ? s.slice(0, max) : null
}

/** '1,25,000.50', '৳ 1,25,000', 'Tk 500' → number; '' → null; NaN → undefined (invalid). */
function parseAmount(v) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : undefined
  const s = String(v).replace(/[,\s৳]/g, '').replace(/^(tk|bdt)\.?/i, '').replace(/^\((.*)\)$/, '-$1')
  if (!s) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : undefined
}

/** 'YYYY-MM-DD', 'DD/MM/YYYY', 'DD-MM-YYYY', 'DD.MM.YYYY', 'YYYY/MM/DD' → 'YYYY-MM-DD'; '' → null; bad → undefined. */
function parseDay(v) {
  if (v === null || v === undefined || v === '') return null
  const s = String(v).trim()
  if (!s) return null
  let y; let m; let d
  let match = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})$/.exec(s)
  if (match) { [, y, m, d] = match } else {
    match = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/.exec(s)
    if (!match) return undefined
    ;[, d, m, y] = match
  }
  const key = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return isDayKey(key) ? key : undefined
}

function fyValid(fy) {
  const m = FY_RE.exec(fy)
  return Boolean(m) && (Number(m[1]) + 1) % 100 === Number(m[2])
}

/** Optional yes/no cell → true/false/null; invalid → undefined. */
function parseYesNo(v) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'boolean') return v
  const s = String(v).trim().toLowerCase()
  if (['yes', 'y', 'true', '1'].includes(s)) return true
  if (['no', 'n', 'false', '0'].includes(s)) return false
  return undefined
}

// ── context ─────────────────────────────────────────────────────────────────

async function openingContext(asOfOverride) {
  const settings = await getFinanceSettings()
  const goLive = settings.goLiveDate || null
  const defaultAsOf = goLive ? addDays(goLive, -1) : null
  const asOfDate = asOfOverride || defaultAsOf
  const startMonth = settings.fiscalYearStartMonth || 7
  const taxFy = asOfDate ? fiscalYearOf(addDays(asOfDate, 1), startMonth) : null
  return { settings, goLive, defaultAsOf, asOfDate, taxFy, startMonth }
}

async function referenceData() {
  const [categories, locations] = await Promise.all([
    AssetCategory.find({}).select('name code type isActive capitalize taxClass').lean(),
    InventoryLocation.find({}).select('name code isActive').lean(),
  ])
  const catByCode = new Map()
  const catByName = new Map()
  for (const c of categories) {
    catByCode.set(String(c.code).toUpperCase(), c)
    catByName.set(String(c.name).trim().toLowerCase(), c)
  }
  const locByCode = new Map()
  const locByName = new Map()
  for (const l of locations) {
    if (l.code) locByCode.set(String(l.code).toUpperCase(), l)
    const k = String(l.name).trim().toLowerCase()
    if (!locByName.has(k)) locByName.set(k, l)
    else locByName.set(k, null) // ambiguous name
  }
  return { categories, locations, catByCode, catByName, locByCode, locByName }
}

// ── GET: opening register status ────────────────────────────────────────────

// GET /api/inventory/opening — opening-register totals and import defaults
export async function GET() {
  try {
    const session = await getServerSession(authOptions)
    if (!session) return NextResponse.json({ error: 'Unauthorised' }, { status: 401 })
    if (!canDoAny(session, ['inventory.view', 'inventory.manage', 'finance.opening.manage'])) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
    }
    await connectDB()
    await ensureCategoriesSeeded()
    const ctx = await openingContext(null)
    const [assetAgg, stockAgg, ref] = await Promise.all([
      Asset.aggregate([
        { $match: { 'opening.isExisting': true, isArchived: { $ne: true } } },
        // Cost at go-live: repairs capitalised since then are later additions, not opening values.
        ...openingCostStages(parseDhakaDay(ctx.goLive)?.start ?? null),
        { $group: {
          _id: '$categoryId',
          count: { $sum: 1 },
          cost: { $sum: { $cond: [{ $ne: ['$isCapitalized', false] }, '$openingCost', 0] } },
          accumulated: { $sum: { $cond: [{ $ne: ['$isCapitalized', false] }, '$opening.accumulatedDepreciation', 0] } },
          expensed: { $sum: { $cond: [{ $eq: ['$isCapitalized', false] }, 1, 0] } },
          withTaxWdv: { $sum: { $cond: [{ $ne: [{ $ifNull: ['$opening.taxWdv', null] }, null] }, 1, 0] } },
        } },
      ]),
      StockMovement.aggregate([
        { $match: { type: 'OPENING' } },
        { $group: { _id: null, items: { $addToSet: '$stockItemId' }, value: { $sum: '$totalCost' } } },
      ]),
      referenceData(),
    ])
    const catById = new Map(ref.categories.map(c => [String(c._id), c]))
    const byCategory = assetAgg.map(r => ({
      code: catById.get(String(r._id))?.code ?? null,
      name: catById.get(String(r._id))?.name ?? 'Uncategorised',
      count: r.count,
      cost: round2(r.cost),
      accumulated: round2(r.accumulated),
      bookValue: round2(r.cost - r.accumulated),
      expensed: r.expensed,
    })).sort((a, b) => a.name.localeCompare(b.name))
    const sum = (k) => round2(byCategory.reduce((s, r) => s + r[k], 0))
    return NextResponse.json({
      data: {
        goLiveDate: ctx.goLive,
        asOfDate: ctx.defaultAsOf,
        taxWdvFiscalYear: ctx.taxFy,
        openingLocked: Boolean(ctx.settings.openingLocked),
        capitalizationThreshold: ctx.settings.inventory?.capitalizationThreshold ?? 10000,
        assets: {
          count: byCategory.reduce((s, r) => s + r.count, 0),
          cost: sum('cost'),
          accumulated: sum('accumulated'),
          bookValue: sum('bookValue'),
          withTaxWdv: assetAgg.reduce((s, r) => s + r.withTaxWdv, 0),
          byCategory,
        },
        stock: { items: stockAgg[0]?.items?.length ?? 0, value: round2(stockAgg[0]?.value ?? 0) },
        categories: ref.categories.filter(c => c.isActive !== false)
          .map(c => ({ code: c.code, name: c.name, type: c.type || 'ASSET' }))
          .sort((a, b) => a.code.localeCompare(b.code)),
        locations: ref.locations.filter(l => l.isActive !== false)
          .map(l => ({ code: l.code ?? null, name: l.name }))
          .sort((a, b) => a.name.localeCompare(b.name)),
      },
    })
  } catch (err) {
    return errorResponse(err, '[GET /api/inventory/opening]')
  }
}

// ── POST: validate (dry run) / import ───────────────────────────────────────

async function validateAssetRows(rows, ctx, ref, issues) {
  const threshold = Number(ctx.settings.inventory?.capitalizationThreshold ?? 10000) || 0
  const err = (row, field, message) => issues.errors.push({ section: 'assets', row, field, message })
  const warn = (row, message) => issues.warnings.push({ section: 'assets', row, message })

  // Employees referenced by staff ID.
  const empKeys = [...new Set(rows.map(r => text(r?.employeeEmployeeId ?? r?.employeeId, 60)).filter(Boolean))]
  const employees = empKeys.length
    ? await Employee.find({ employeeId: { $in: empKeys.map(k => new RegExp(`^${escapeRegex(k)}$`, 'i')) } })
      .select('employeeId userId').populate('userId', 'name').lean()
    : []
  const empByKey = new Map()
  for (const e of employees) {
    const k = String(e.employeeId).toLowerCase()
    empByKey.set(k, empByKey.has(k) ? null : e)
  }

  // Serial numbers: unique within the file and on the register.
  const serials = rows.map(r => text(r?.serialNumber, 120)).filter(Boolean)
  const existingSerials = serials.length
    ? await Asset.find({ serialNumber: { $in: serials.map(s => new RegExp(`^${escapeRegex(s)}$`, 'i')) } }).select('serialNumber assetTag').lean()
    : []
  const serialOwner = new Map(existingSerials.map(a => [String(a.serialNumber).toLowerCase(), a.assetTag]))
  const seenSerials = new Map()

  const valid = []
  rows.forEach((raw, i) => {
    const n = i + 1
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { err(n, 'row', 'Row is not an object'); return }
    const before = issues.errors.length
    const name = text(raw.name, 200)
    if (!name) err(n, 'name', 'Asset name is required')

    const catKey = text(raw.categoryCode ?? raw.category, 80)
    let category = null
    if (!catKey) err(n, 'categoryCode', 'Category code is required')
    else {
      category = ref.catByCode.get(catKey.toUpperCase()) || ref.catByName.get(catKey.toLowerCase()) || null
      if (!category) err(n, 'categoryCode', `Unknown category "${catKey}"`)
      else if (category.isActive === false) err(n, 'categoryCode', `Category "${category.name}" is inactive`)
      else if (category.type === 'CONSUMABLE') err(n, 'categoryCode', `"${category.name}" is a consumable category — put it in the stock section`)
    }

    const cost = parseAmount(raw.cost)
    if (cost === null) err(n, 'cost', 'Cost is required')
    else if (cost === undefined || cost < 0) err(n, 'cost', 'Cost must be a positive amount')
    let acc = parseAmount(raw.accumulatedDepreciation)
    if (acc === undefined || (acc !== null && acc < 0)) { err(n, 'accumulatedDepreciation', 'Accumulated depreciation must be 0 or more'); acc = 0 }
    acc = acc ?? 0
    if (typeof cost === 'number' && cost >= 0 && acc > cost + 0.005) err(n, 'accumulatedDepreciation', 'Accumulated depreciation cannot exceed the cost')
    let taxWdv = parseAmount(raw.taxWdv)
    if (taxWdv === undefined || (taxWdv !== null && taxWdv < 0)) { err(n, 'taxWdv', 'Tax WDV must be 0 or more'); taxWdv = null }
    if (taxWdv !== null && typeof cost === 'number' && taxWdv > cost + 0.005) err(n, 'taxWdv', 'Tax WDV cannot exceed the cost')
    let taxFy = text(raw.taxWdvFiscalYear, 9)
    if (taxFy && !fyValid(taxFy)) { err(n, 'taxWdvFiscalYear', 'Income year must look like 2026-27'); taxFy = null }
    if (taxWdv !== null && !taxFy) taxFy = ctx.taxFy

    const purchaseDate = parseDay(raw.purchaseDate)
    if (purchaseDate === undefined) err(n, 'purchaseDate', 'Purchase date must be YYYY-MM-DD or DD/MM/YYYY')
    else if (purchaseDate && purchaseDate > ctx.asOfDate) err(n, 'purchaseDate', `Purchase date is after the opening date (${dayKeyLabel(ctx.asOfDate)}) — record it as a new purchase instead`)
    else if (!purchaseDate) warn(n, 'No purchase date — tax depreciation will treat the opening date as the acquisition date unless a tax WDV is given')
    const warrantyExpiry = parseDay(raw.warrantyExpiry)
    if (warrantyExpiry === undefined) err(n, 'warrantyExpiry', 'Warranty expiry must be a date')

    let condition = text(raw.condition, 20)
    if (condition) {
      condition = condition.toUpperCase()
      if (!CONDITIONS.includes(condition)) err(n, 'condition', `Condition must be one of ${CONDITIONS.join(', ')}`)
    }

    const locKey = text(raw.locationCode ?? raw.location, 100)
    let location = null
    if (locKey) {
      location = ref.locByCode.get(locKey.toUpperCase()) || ref.locByName.get(locKey.toLowerCase()) || null
      if (!location) err(n, 'locationCode', `Unknown location "${locKey}" (use the location code)`)
      else if (location.isActive === false) err(n, 'locationCode', `Location "${location.name}" is inactive`)
    }

    const empKey = text(raw.employeeEmployeeId ?? raw.employeeId, 60)
    let employee = null
    if (empKey) {
      employee = empByKey.get(empKey.toLowerCase())
      if (employee === undefined) err(n, 'employeeEmployeeId', `No employee with ID "${empKey}"`)
      else if (employee === null) err(n, 'employeeEmployeeId', `More than one employee has ID "${empKey}"`)
    }

    const serial = text(raw.serialNumber, 120)
    if (serial) {
      const k = serial.toLowerCase()
      if (serialOwner.has(k)) err(n, 'serialNumber', `Serial ${serial} is already on the register (${serialOwner.get(k)})`)
      if (seenSerials.has(k)) err(n, 'serialNumber', `Serial ${serial} is repeated (also row ${seenSerials.get(k)})`)
      else seenSerials.set(k, n)
    }

    const capitalizeCell = parseYesNo(raw.capitalized ?? raw.capitalize)
    if (capitalizeCell === undefined) err(n, 'capitalized', 'Capitalised must be yes or no')

    if (issues.errors.length > before) return
    const isCapitalized = typeof capitalizeCell === 'boolean'
      ? capitalizeCell
      : category.capitalize !== false && cost >= threshold
    if (!isCapitalized && (acc > 0 || taxWdv !== null)) {
      warn(n, 'Not capitalised (below the threshold or marked No) — accumulated depreciation and tax WDV are ignored')
    }
    if (isCapitalized && taxWdv === null) warn(n, 'No opening tax WDV — the tax schedule will be rebuilt from cost since the purchase date (or the opening date when none is given)')
    valid.push({
      row: n,
      name,
      category,
      brand: text(raw.brand, 100),
      model: text(raw.model, 100),
      serial,
      purchaseDate,
      cost: round2(cost),
      accumulated: isCapitalized ? round2(acc) : 0,
      taxWdv: isCapitalized && taxWdv !== null ? round2(taxWdv) : null,
      taxFy: isCapitalized && taxWdv !== null ? taxFy : null,
      location,
      employee,
      condition: condition || null,
      warrantyExpiry,
      notes: text(raw.notes, 1000),
      isCapitalized,
    })
  })

  // Likely duplicates of assets already in the opening register (same name, category, cost).
  if (valid.length) {
    const existing = await Asset.find({ 'opening.isExisting': true, name: { $in: [...new Set(valid.map(v => v.name))] } })
      .select('name categoryId cost assetTag').lean()
    const keyOf = (name, cat, cost) => `${String(name).toLowerCase()}|${String(cat)}|${round2(cost)}`
    const known = new Map(existing.map(a => [keyOf(a.name, a.categoryId, a.cost), a.assetTag]))
    for (const v of valid) {
      const tag = known.get(keyOf(v.name, v.category._id, v.cost))
      if (tag && !v.serial) warn(v.row, `Looks like ${tag} already imported (same name, category and cost)`)
    }
  }
  return valid
}

async function validateStockRows(rows, ctx, ref, issues) {
  const err = (row, field, message) => issues.errors.push({ section: 'stock', row, field, message })
  const skus = [...new Set(rows.map(r => text(r?.sku, 40)?.toUpperCase()).filter(Boolean))]
  const existing = skus.length ? await StockItem.find({ sku: { $in: skus } }).lean() : []
  const bySku = new Map(existing.map(i => [i.sku, i]))
  const moved = existing.length
    ? new Set((await StockMovement.distinct('stockItemId', { stockItemId: { $in: existing.map(i => i._id) } })).map(String))
    : new Set()
  const seen = new Map()
  const valid = []
  rows.forEach((raw, i) => {
    const n = i + 1
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) { err(n, 'row', 'Row is not an object'); return }
    const before = issues.errors.length
    const sku = text(raw.sku, 40)?.toUpperCase() || null
    const item = sku ? bySku.get(sku) : null
    const name = text(raw.name, 200)
    if (!item && !name) err(n, 'name', 'Item name is required for a new item')
    if (sku && !/^[A-Z0-9][A-Z0-9_.-]{0,39}$/.test(sku)) err(n, 'sku', 'SKU may use letters, digits, ".", "-" and "_"')
    if (sku) {
      if (seen.has(sku)) err(n, 'sku', `SKU ${sku} is repeated (also row ${seen.get(sku)})`)
      else seen.set(sku, n)
    }
    if (item && (moved.has(String(item._id)) || num(item.qtyOnHand) !== 0)) {
      err(n, 'sku', `${sku} already has stock movements — correct it with a stock adjustment instead`)
    }
    const catKey = text(raw.categoryCode ?? raw.category, 80)
    let category = null
    if (catKey) {
      category = ref.catByCode.get(catKey.toUpperCase()) || ref.catByName.get(catKey.toLowerCase()) || null
      if (!category) err(n, 'categoryCode', `Unknown category "${catKey}"`)
      else if (category.type !== 'CONSUMABLE') err(n, 'categoryCode', `"${category.name}" is an asset category — consumable stock needs a consumable category`)
    }
    const qty = parseAmount(raw.qty ?? raw.quantity)
    if (qty === null || qty === undefined || !(qty > 0)) err(n, 'qty', 'Quantity must be more than 0')
    const unitCost = parseAmount(raw.unitCost)
    if (unitCost === null || unitCost === undefined || unitCost < 0) err(n, 'unitCost', 'Unit cost must be 0 or more')
    const unit = text(raw.unit, 20)
    const reorderLevel = parseAmount(raw.reorderLevel)
    if (reorderLevel === undefined || (reorderLevel !== null && reorderLevel < 0)) err(n, 'reorderLevel', 'Reorder level must be 0 or more')
    const locKey = text(raw.locationCode ?? raw.location, 100)
    let location = null
    if (locKey) {
      location = ref.locByCode.get(locKey.toUpperCase()) || ref.locByName.get(locKey.toLowerCase()) || null
      if (!location) err(n, 'locationCode', `Unknown location "${locKey}"`)
    }
    if (issues.errors.length > before) return
    valid.push({
      row: n, sku, item, name: name || item?.name, category, qty: Math.round(qty * 10000) / 10000,
      unitCost: Math.round(unitCost * 10000) / 10000, unit: unit || item?.unit || 'pcs',
      reorderLevel: reorderLevel ?? null, location, value: round2(qty * unitCost),
    })
  })
  return valid
}

async function rollback({ assetIds, createdItemIds, touchedItems }) {
  const tasks = []
  if (assetIds.length) {
    tasks.push(AssetEvent.deleteMany({ assetId: { $in: assetIds } }))
    tasks.push(Asset.deleteMany({ _id: { $in: assetIds } }))
  }
  if (createdItemIds.length) {
    tasks.push(StockMovement.deleteMany({ stockItemId: { $in: createdItemIds } }))
    tasks.push(StockItem.deleteMany({ _id: { $in: createdItemIds } }))
  }
  for (const t of touchedItems) {
    tasks.push(StockMovement.deleteOne({ _id: t.movementId }))
    tasks.push(StockItem.updateOne({ _id: t.itemId }, { $set: { qtyOnHand: 0, avgCost: 0, stockValue: 0 } }))
  }
  const results = await Promise.allSettled(tasks)
  for (const r of results) if (r.status === 'rejected') console.error('[POST /api/inventory/opening] rollback step failed', r.reason)
}

// POST /api/inventory/opening — { rows?, stockRows?, dryRun, asOfDate? } (inventory.manage)
export async function POST(request) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'inventory.manage')
    if (denied) return denied

    let body
    try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 }) }
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    const rows = Array.isArray(body.rows) ? body.rows : []
    const stockRows = Array.isArray(body.stockRows) ? body.stockRows : []
    const dryRun = body.dryRun === undefined ? true : isTruthy(body.dryRun)
    if (!rows.length && !stockRows.length) return NextResponse.json({ error: 'Nothing to import — add asset rows or stock rows' }, { status: 422 })
    if (rows.length > MAX_ASSET_ROWS) return NextResponse.json({ error: `At most ${MAX_ASSET_ROWS} assets per import — split the file` }, { status: 422 })
    if (stockRows.length > MAX_STOCK_ROWS) return NextResponse.json({ error: `At most ${MAX_STOCK_ROWS} stock items per import — split the file` }, { status: 422 })
    let asOfOverride = null
    if (body.asOfDate) {
      asOfOverride = parseDay(body.asOfDate)
      if (!asOfOverride) return NextResponse.json({ error: 'Opening date must be YYYY-MM-DD' }, { status: 422 })
    }

    await connectDB()
    await ensureCategoriesSeeded()
    const ctx = await openingContext(asOfOverride)
    if (ctx.settings.openingLocked) {
      return NextResponse.json({ error: 'Opening balances are locked — unlock them in Finance → Opening Balances to import more' }, { status: 409 })
    }
    if (!ctx.asOfDate) {
      return NextResponse.json({ error: 'Set the go-live date in Finance → Opening Balances first (or give an opening date)' }, { status: 422 })
    }
    if (ctx.goLive && ctx.asOfDate >= ctx.goLive) {
      return NextResponse.json({ error: `The opening date must be before go-live (${dayKeyLabel(ctx.goLive)})` }, { status: 422 })
    }

    const ref = await referenceData()
    const issues = { errors: [], warnings: [] }
    const assets = await validateAssetRows(rows, ctx, ref, issues)
    const stock = await validateStockRows(stockRows, ctx, ref, issues)

    const assetTotals = {
      count: assets.length,
      cost: round2(assets.filter(a => a.isCapitalized).reduce((s, a) => s + a.cost, 0)),
      accumulated: round2(assets.reduce((s, a) => s + a.accumulated, 0)),
      expensedCount: assets.filter(a => !a.isCapitalized).length,
      expensedCost: round2(assets.filter(a => !a.isCapitalized).reduce((s, a) => s + a.cost, 0)),
    }
    assetTotals.bookValue = round2(assetTotals.cost - assetTotals.accumulated)
    const stockTotals = { count: stock.length, value: round2(stock.reduce((s, r) => s + r.value, 0)) }

    const preview = {
      asOfDate: ctx.asOfDate,
      taxWdvFiscalYear: ctx.taxFy,
      assets: {
        ...assetTotals,
        rows: assets.map(a => ({
          row: a.row,
          name: a.name,
          category: `${a.category.name} (${a.category.code})`,
          serialNumber: a.serial,
          purchaseDate: a.purchaseDate,
          cost: a.cost,
          accumulated: a.accumulated,
          bookValue: round2(a.cost - a.accumulated),
          taxWdv: a.taxWdv,
          taxWdvFiscalYear: a.taxFy,
          isCapitalized: a.isCapitalized,
          location: a.location?.name ?? null,
          employee: a.employee ? `${a.employee.userId?.name ?? ''} (${a.employee.employeeId})`.trim() : null,
          condition: a.condition ?? 'GOOD',
        })),
      },
      stock: {
        ...stockTotals,
        rows: stock.map(s => ({
          row: s.row, sku: s.sku, name: s.name, existing: Boolean(s.item), category: s.category?.name ?? null,
          unit: s.unit, qty: s.qty, unitCost: s.unitCost, value: s.value, location: s.location?.name ?? null,
        })),
      },
      errors: issues.errors,
      warnings: issues.warnings,
      valid: issues.errors.length === 0,
    }

    if (dryRun) return NextResponse.json({ data: { dryRun: true, ...preview } })
    if (issues.errors.length) {
      return NextResponse.json({
        error: `${issues.errors.length} problem${issues.errors.length === 1 ? '' : 's'} found — nothing was imported. Fix them and try again.`,
        data: { dryRun: true, ...preview },
      }, { status: 422 })
    }

    // ── import (all-or-nothing, compensated) ──
    const created = { assetIds: [], createdItemIds: [], touchedItems: [] }
    const createdAssets = []
    const createdStock = []
    let current = null
    try {
      for (const a of assets) {
        current = `Asset row ${a.row}`
        const docs = await createAssets({
          base: {
            name: a.name,
            categoryId: String(a.category._id),
            brand: a.brand,
            model: a.model,
            serialNumber: a.serial,
            condition: a.condition || 'GOOD',
            locationId: a.location ? String(a.location._id) : null,
            assignedEmployeeId: a.employee ? String(a.employee._id) : null,
            assignedAt: ctx.asOfDate,
            acknowledgement: { status: 'NOT_REQUIRED' },
            purchase: { date: a.purchaseDate, unitCost: a.cost, vatAmount: 0, otherCosts: 0, currency: 'BDT' },
            cost: a.cost,
            isCapitalized: a.isCapitalized,
            availableForUseDate: a.purchaseDate,
            opening: {
              isExisting: true,
              asOfDate: ctx.asOfDate,
              accumulatedDepreciation: a.accumulated,
              taxWdv: a.taxWdv,
              taxWdvFiscalYear: a.taxFy,
            },
            warrantyExpiry: a.warrantyExpiry,
            notes: a.notes,
          },
          quantity: 1,
          serialNumbers: a.serial ? [a.serial] : [],
          session,
          eventType: 'OPENING',
          date: ctx.asOfDate,
        })
        for (const d of docs) {
          created.assetIds.push(d._id)
          createdAssets.push({ id: String(d._id), assetTag: d.assetTag, name: d.name, row: a.row })
        }
      }

      for (const s of stock) {
        current = `Stock row ${s.row}`
        let itemId
        if (s.item) {
          itemId = s.item._id
          const set = {}
          if (s.category) set.categoryId = s.category._id
          if (s.location) set.locationId = s.location._id
          if (s.reorderLevel !== null) set.reorderLevel = s.reorderLevel
          if (Object.keys(set).length) await StockItem.updateOne({ _id: itemId }, { $set: set })
        } else {
          const doc = await new StockItem({
            ...(s.sku ? { sku: s.sku } : {}),
            name: s.name,
            categoryId: s.category?._id ?? null,
            unit: s.unit,
            reorderLevel: s.reorderLevel ?? 0,
            locationId: s.location?._id ?? null,
            createdBy: session.user.id,
          }).save()
          itemId = doc._id
          created.createdItemIds.push(itemId)
        }
        const { item, movement } = await moveStock({
          stockItemId: itemId,
          type: 'OPENING',
          qty: s.qty,
          unitCost: s.unitCost,
          date: ctx.asOfDate,
          reason: 'Opening stock',
          reference: 'Opening import',
          userId: session.user.id,
        })
        if (s.item) created.touchedItems.push({ itemId, movementId: movement._id })
        createdStock.push({ id: String(item._id), sku: item.sku, name: item.name, qty: s.qty, value: s.value, row: s.row })
      }
    } catch (e) {
      await rollback(created)
      if (current && e?.status && typeof e.message === 'string') e.message = `${current}: ${e.message} — nothing was imported`
      if (e?.status || e?.name === 'ValidationError' || e?.code === 11000) {
        return errorResponse(e, '[POST /api/inventory/opening]')
      }
      throw e
    }

    logActivity({
      userId: session.user.id,
      userRole: session.user.role,
      action: 'IMPORT',
      entity: 'OPENING_BALANCE',
      entityId: null,
      changes: JSON.stringify({
        kind: 'inventory-opening',
        asOfDate: ctx.asOfDate,
        assets: assetTotals,
        stock: stockTotals,
        tags: createdAssets.slice(0, 50).map(a => a.assetTag),
      }),
      request,
    })

    return NextResponse.json({
      data: {
        dryRun: false,
        ...preview,
        created: { assets: createdAssets, stockItems: createdStock },
      },
    }, { status: 201 })
  } catch (err) {
    return errorResponse(err, '[POST /api/inventory/opening]')
  }
}

