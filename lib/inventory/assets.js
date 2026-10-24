/**
 * lib/inventory/assets.js — SERVER-ONLY fixed-asset helpers.
 *
 *  - category seeding (DEFAULT_CATEGORIES with book lives from the Third Schedule classes)
 *  - asset tags  `${tagPrefix}${CATEGORY}${seq5}` (e.g. ENLAP00042), never reused
 *  - the append-only AssetEvent writer
 *  - createAssets: N assets + their events, all-or-nothing (compensating delete)
 *
 * Re-exports every pure constant/helper from ./constants, so server code can
 * import canTransition / computeAssetCost / bookValue / STATUS_META… from here.
 * Client components must import from '@/lib/inventory/constants' instead.
 *
 * Errors carry `.status` (400/404/409/422) for the route to return as-is.
 */

import mongoose from 'mongoose'
import connectDB from '@/lib/mongodb'
import { Asset, AssetCategory, AssetEvent, Employee, InventoryLocation } from '@/models'
import { nextSequence, counterValue } from '@/lib/sequence'
import { isValidObjectId } from '@/lib/objectId'
import { dhakaDayKey, dhakaDayStart, parseDhakaDay } from '@/lib/dhakaTime'
import { getFinanceSettings } from '@/lib/finance/settings'
import { TAX_DEPRECIATION_CLASSES } from '@/lib/tax/catalog'
import {
  ASSET_STATUSES, TERMINAL_STATUSES, HELD_STATUSES, CONDITIONS, EVENT_TYPES, ACK_STATUSES,
  DEPRECIATION_METHODS, DEFAULT_CATEGORIES,
  round2, computeAssetCost, normalizeCategoryCode, normalizeTagPrefix,
} from './constants'

export * from './constants'

/** Most assets one createAssets call may create (one purchase line / one form). */
export const MAX_ASSETS_PER_BATCH = 500

const FALLBACK_LIFE_MONTHS = 60
const PERIOD_RE = /^\d{4}-(0[1-9]|1[0-2])$/
const FY_RE = /^\d{4}-\d{2}$/

// ── small utilities ──────────────────────────────────────────────────────────

function httpError(status, message) {
  const err = new Error(message)
  err.status = status
  return err
}

const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const isPlainObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v) && !(v instanceof Date)

/** String id of an id / ObjectId / document / populated object (null when absent). */
function idOf(v) {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'string') return v.trim() || null
  if (v instanceof mongoose.Types.ObjectId) return v.toString()
  if (typeof v === 'object') {
    if (v._id !== undefined && v._id !== null) return String(v._id)
    if (typeof v.id === 'string') return v.id
  }
  return String(v)
}

/** Optional ObjectId field: null when empty, 400 when malformed. */
function optId(v, field) {
  const id = idOf(v)
  if (!id) return null
  if (!isValidObjectId(id)) throw httpError(400, `Invalid ${field}`)
  return id
}

/** Lenient variant for event logging: a malformed id is dropped (and logged), never fatal. */
function softId(v, field) {
  const id = idOf(v)
  if (!id) return null
  if (isValidObjectId(id)) return id
  console.warn(`[inventory/assets] ignoring invalid ${field}:`, id)
  return null
}

function text(v) {
  if (v === null || v === undefined) return null
  const s = String(v).trim()
  return s ? s : null
}

/** Non-negative money (BDT), rounded; empty ⇒ fallback. */
function money(v, field, fallback = 0) {
  if (v === null || v === undefined || v === '') return fallback
  const n = Number(v)
  if (!Number.isFinite(n)) throw httpError(422, `${field} must be a number`)
  if (n < 0) throw httpError(422, `${field} cannot be negative`)
  return round2(n)
}

/** Date from a Date, a 'YYYY-MM-DD' Dhaka day (start of day) or an ISO string; empty ⇒ null. */
function toDate(v, field) {
  if (v === null || v === undefined || v === '') return null
  if (v instanceof Date) {
    if (Number.isNaN(v.getTime())) throw httpError(422, `Invalid ${field}`)
    return v
  }
  if (typeof v === 'string') {
    const day = parseDhakaDay(v)
    if (day) return day.start
  }
  const d = new Date(v)
  if (Number.isNaN(d.getTime())) throw httpError(422, `Invalid ${field}`)
  return d
}

/** Event timestamp: a date-only value for today keeps the current time (keeps the timeline ordered). */
function eventDate(v) {
  if (v === null || v === undefined || v === '') return new Date()
  if (typeof v === 'string' && parseDhakaDay(v)) {
    if (v.trim() === dhakaDayKey(new Date())) return new Date()
    return parseDhakaDay(v).start
  }
  return toDate(v, 'event date')
}

function cleanStrings(list) {
  if (!Array.isArray(list)) return []
  return list.map(s => (typeof s === 'string' ? s.trim() : '')).filter(Boolean)
}

function isDuplicateKey(err, field) {
  if (!err || err.code !== 11000) return false
  if (!field) return true
  return Boolean(err.keyPattern?.[field] || (err.keyValue && field in err.keyValue) || String(err.message ?? '').includes(field))
}

/** { id, name } of whoever performs the action (next-auth session, user id string, or explicit). */
function actorOf(session, userId = null, userName = null) {
  let id = null
  let name = null
  if (typeof session === 'string') id = session
  else if (session?.user) {
    id = session.user.id ?? null
    name = session.user.name ?? session.user.email ?? null
  }
  if (userId) id = idOf(userId)
  if (userName) name = String(userName)
  return { id: id && isValidObjectId(id) ? id : null, name: name ?? null }
}

/**
 * Normalise a from/to side of an event. Accepts a status string, or an object
 * with { status, locationId, employeeId, departmentId, condition } (aliases
 * assignedEmployeeId / assignedDepartmentId / location / employee are honoured,
 * so an asset snapshot can be passed directly).
 */
function eventSide(side) {
  if (!side) return {}
  if (typeof side === 'string') return ASSET_STATUSES.includes(side) ? { status: side } : {}
  if (typeof side !== 'object') return {}
  return {
    status:       side.status ?? null,
    locationId:   side.locationId ?? side.location ?? null,
    employeeId:   side.employeeId ?? side.assignedEmployeeId ?? side.employee ?? null,
    departmentId: side.departmentId ?? side.assignedDepartmentId ?? side.department ?? null,
    condition:    side.condition ?? null,
  }
}

/** Current custody/state of an asset, ready to pass as `from` / `to` to logAssetEvent. */
export function assetState(asset) {
  if (!asset) return {}
  return {
    status:       asset.status ?? null,
    locationId:   idOf(asset.locationId),
    employeeId:   idOf(asset.assignedEmployeeId),
    departmentId: idOf(asset.assignedDepartmentId),
    condition:    asset.condition ?? null,
  }
}

// ── Categories ───────────────────────────────────────────────────────────────

function seedCategoryDoc(c, index) {
  const cls = TAX_DEPRECIATION_CLASSES?.[c.taxClass] ?? null
  const consumable = c.type === 'CONSUMABLE'
  return {
    name: c.name,
    code: c.code,
    type: c.type ?? 'ASSET',
    taxClass: c.taxClass ?? 'OTHER',
    depreciationMethod: consumable ? 'NONE' : 'STRAIGHT_LINE',
    usefulLifeMonths: Number(cls?.bookLifeMonths) > 0 ? Number(cls.bookLifeMonths) : FALLBACK_LIFE_MONTHS,
    residualPct: 0,
    decliningRatePct: null,
    capitalize: consumable ? false : c.capitalize !== false,
    requiresAcknowledgement: !consumable,
    inputVatCreditable: false,
    description: null,
    isActive: true,
    sortOrder: (index + 1) * 10,
  }
}

let _categoriesSeeded = false
let _seeding = null

/**
 * Seed DEFAULT_CATEGORIES when the AssetCategory collection is empty
 * (usefulLifeMonths from TAX_DEPRECIATION_CLASSES[taxClass].bookLifeMonths).
 * Safe under concurrency (duplicate-key races are ignored) and cheap after the
 * first call in a process.
 * @returns {Promise<{ seeded: boolean, count: number }>}
 */
export async function ensureCategoriesSeeded() {
  if (_categoriesSeeded) return { seeded: false, count: 0 }
  if (!_seeding) {
    _seeding = (async () => {
      await connectDB()
      const existing = await AssetCategory.estimatedDocumentCount()
      if (existing > 0) {
        _categoriesSeeded = true
        return { seeded: false, count: 0 }
      }
      const docs = DEFAULT_CATEGORIES.map(seedCategoryDoc)
      let count = 0
      try {
        const res = await AssetCategory.insertMany(docs, { ordered: false })
        count = res.length
      } catch (err) {
        const dupOnly = err?.code === 11000 ||
          (Array.isArray(err?.writeErrors) && err.writeErrors.length > 0 && err.writeErrors.every(e => (e.code ?? e.err?.code) === 11000))
        if (!dupOnly) throw err
        count = Array.isArray(err.insertedDocs) ? err.insertedDocs.length : 0
      }
      _categoriesSeeded = true
      return { seeded: true, count }
    })().finally(() => { _seeding = null })
  }
  return _seeding
}

// ── Asset tags ───────────────────────────────────────────────────────────────

/**
 * A category's tag series: { series: 'ENLAP' (the tag stem and counter key),
 * prefix: 'EN', code: 'LAP' }. Tags issued before 2026-10 read EN-LAP-00042 and
 * kept their counter under the hyphenated key asset:EN-LAP.
 */
async function tagSeries(categoryCode) {
  const code = normalizeCategoryCode(categoryCode)
  if (!code) throw httpError(422, 'The category has no code — give it a 2–6 character code to generate asset tags')
  const settings = await getFinanceSettings()
  const prefix = normalizeTagPrefix(settings?.inventory?.tagPrefix ?? 'EN')
  return { series: `${prefix}${code}`, prefix, code }
}

/**
 * Highest sequence number already used in a tag series (floor for nextSequence):
 * tags of either shape (ENLAP00042 / EN-LAP-00042), and the old hyphenated
 * counter key. Exactly 5 digits — category codes may end in digits, so LAP must
 * not read ENLAP100001 (LAP1's first tag) as its own number 100001.
 */
async function maxTagNumber({ prefix, code }) {
  const re = `^${prefix ? `${escapeRegex(prefix)}-?` : ''}${escapeRegex(code)}-?[0-9]{5}$`
  const [row] = await Asset.aggregate([
    { $match: { assetTag: { $regex: re } } },
    { $project: { n: { $toInt: { $substrCP: ['$assetTag', { $subtract: [{ $strLenCP: '$assetTag' }, 5] }, 5] } } } },
    { $group: { _id: null, max: { $max: '$n' } } },
  ])
  const max = Number(row?.max ?? 0)
  const legacy = prefix ? await counterValue(`asset:${prefix}-${code}`) : 0
  return Math.max(Number.isFinite(max) ? max : 0, legacy)
}

async function allocateAssetTags(categoryCode, count = 1) {
  await connectDB()
  const tagSet = await tagSeries(categoryCode)
  const maxUsed = await maxTagNumber(tagSet)
  const tags = []
  for (let i = 0; i < count; i++) {
    const seq = await nextSequence(`asset:${tagSet.series}`, maxUsed)
    tags.push(`${tagSet.series}${String(seq).padStart(5, '0')}`)
  }
  return tags
}

/**
 * Next asset tag for a category code: `${settings.inventory.tagPrefix}${CODE}${seq5}`,
 * e.g. 'ENLAP00042'. Atomic (lib/sequence counter `asset:${prefix}${CODE}`,
 * floored at the highest tag already used in either shape), never reissued.
 * @param {string} categoryCode
 * @returns {Promise<string>}
 */
export async function nextAssetTag(categoryCode) {
  const [tag] = await allocateAssetTags(categoryCode, 1)
  return tag
}

// ── Events ───────────────────────────────────────────────────────────────────

function buildEventDoc({ _id, asset, type, date, from, to, amount, details, notes, attachments, transactionId, expenseId, vendorId, departmentId, condition, session, userId, userName }) {
  const assetId = idOf(asset)
  if (!assetId || !isValidObjectId(assetId)) throw httpError(400, 'A valid asset is required to log an asset event')
  if (!EVENT_TYPES.includes(type)) throw httpError(400, `Unknown asset event type: ${type}`)

  let amt = null
  if (amount !== null && amount !== undefined && amount !== '') {
    const n = Number(amount)
    if (!Number.isFinite(n)) throw httpError(422, 'Event amount must be a number')
    amt = round2(n)
  }

  const f = eventSide(from)
  const t = eventSide(to)
  const actor = actorOf(session, userId, userName)
  const doc = {
    assetId,
    type,
    date: eventDate(date),
    fromStatus:     text(f.status),
    toStatus:       text(t.status),
    fromLocationId: softId(f.locationId, 'from.locationId'),
    toLocationId:   softId(t.locationId, 'to.locationId'),
    fromEmployeeId: softId(f.employeeId, 'from.employeeId'),
    toEmployeeId:   softId(t.employeeId, 'to.employeeId'),
    departmentId:   softId(departmentId ?? t.departmentId ?? f.departmentId, 'departmentId'),
    condition:      text(condition ?? t.condition),
    amount:         amt,
    vendorId:       softId(vendorId, 'vendorId'),
    details:        isPlainObject(details) ? details : {},
    attachments:    cleanStrings(attachments),
    notes:          text(notes),
    transactionId:  softId(transactionId, 'transactionId'),
    expenseId:      softId(expenseId, 'expenseId'),
    createdBy:      actor.id,
    createdByName:  actor.name,
  }
  if (_id) doc._id = _id
  return doc
}

/**
 * Append one AssetEvent.
 *
 * @param {object} p
 * @param {object|string} p.asset   Asset doc / lean object / id
 * @param {string} p.type           EVENT_TYPES value
 * @param {Date|string} [p.date]    default now; 'YYYY-MM-DD' = that Dhaka day (today ⇒ now)
 * @param {string|object} [p.from]  status string, or { status, locationId, employeeId, departmentId, condition }
 *                                  (an asset snapshot works too — see assetState())
 * @param {string|object} [p.to]    same shape; to.departmentId / to.condition fill the event's departmentId / condition
 * @param {number} [p.amount]
 * @param {object} [p.details]      type-specific data (damage / repair / recovery …)
 * @param {string} [p.notes]
 * @param {string[]} [p.attachments]
 * @param {string} [p.transactionId]
 * @param {string} [p.expenseId]
 * @param {string} [p.vendorId]
 * @param {object|string} [p.session]  next-auth session (createdBy / createdByName), or a user id
 * @returns {Promise<import('mongoose').Document>} the saved AssetEvent
 */
export async function logAssetEvent({
  asset, type, date, from, to, amount, details, notes, attachments, transactionId, expenseId, vendorId, session,
  departmentId, condition, userId, userName,
} = {}) {
  const doc = buildEventDoc({ asset, type, date, from, to, amount, details, notes, attachments, transactionId, expenseId, vendorId, departmentId, condition, session, userId, userName })
  await connectDB()
  return AssetEvent.create(doc)
}

// ── Asset creation ───────────────────────────────────────────────────────────

function parseSerials(serialNumbers) {
  const raw = Array.isArray(serialNumbers)
    ? serialNumbers
    : typeof serialNumbers === 'string' ? serialNumbers.split(/[\r\n,]+/) : []
  const list = raw.map(s => (s === null || s === undefined ? '' : String(s).trim())).filter(Boolean)
  const seen = new Set()
  for (const s of list) {
    const key = s.toUpperCase()
    if (seen.has(key)) throw httpError(422, `Serial number ${s} is listed more than once`)
    seen.add(key)
  }
  return list
}

/** Day before go-live (Dhaka) — the day the opening register is "as at" (null without a go-live date). */
export function defaultOpeningAsOf(settings) {
  const live = parseDhakaDay(settings?.goLiveDate)
  return live ? dhakaDayStart(live.start, -1) : null
}

/**
 * Why an opening-register asset's dates are not acceptable (null when they are)
 * — the same rules as the opening import (POST /api/inventory/opening):
 *  - the "as of" date must be before go-live: equipment acquired after go-live
 *    comes in through a purchase bill, never the opening position;
 *  - it cannot have been bought after the day the register says it was held.
 * All dates are 'YYYY-MM-DD' Dhaka day keys (null/blank = not given).
 */
export function openingDateError({ goLiveDate, asOfKey, purchaseKey } = {}) {
  if (goLiveDate && asOfKey && asOfKey >= goLiveDate) {
    return `The opening "as of" date must be before go-live (${goLiveDate}) — add equipment acquired after go-live through a purchase bill`
  }
  if (purchaseKey && asOfKey && purchaseKey > asOfKey) {
    return `The purchase date (${purchaseKey}) is after the opening "as of" date (${asOfKey}) — record it as a new purchase instead`
  }
  return null
}

/**
 * Day key the opening register holds an existing asset "as at" (end of that
 * day): the later of opening.asOfDate and the day before go-live (either one
 * alone when the other is not known). The go-live position holds every opening
 * asset as at the day before go-live, so an earlier "as of" date (values taken
 * from older books) must not open a window for a pre-go-live disposal or
 * impairment while the asset still counts in that position; a later one
 * (legacy data) wins. null for an asset that is not in the opening register,
 * or when neither date is known. Nothing can happen to the asset on or before
 * this day — that is the opening position.
 */
export function openingRegisterDay(asset, settings) {
  if (!asset?.opening?.isExisting) return null
  const def = defaultOpeningAsOf(settings)
  const goLiveEve = def ? dhakaDayKey(def) : null
  let asOf = null
  if (asset.opening.asOfDate) {
    const d = new Date(asset.opening.asOfDate)
    if (!Number.isNaN(d.getTime())) asOf = dhakaDayKey(d)
  }
  if (asOf && goLiveEve) return asOf > goLiveEve ? asOf : goLiveEve
  return asOf ?? goLiveEve
}

/**
 * Aggregation stages that add `openingCost` to each Asset: its cost at go-live,
 * i.e. the current cost less repairs capitalised on or after go-live (those are
 * later additions, dated in the year they happened — they never restate the
 * opening position). Keyed on the REPAIR_COMPLETED event, which is written
 * together with the cost change (its VALUE_ADJUSTED companion is best effort).
 * Register corrections (cost edits / COST_CORRECTION) are not subtracted: they
 * correct the opening figure itself and are refused once opening balances are locked.
 * @param {Date|null} goLiveStart  Dhaka midnight of the go-live day (null ⇒ openingCost = cost)
 * @returns {object[]} stages to append after the $match
 */
export function openingCostStages(goLiveStart) {
  const cost = { $ifNull: ['$cost', 0] }
  if (!(goLiveStart instanceof Date) || Number.isNaN(goLiveStart.getTime())) {
    return [{ $addFields: { openingCost: cost } }]
  }
  return [
    {
      $lookup: {
        from: AssetEvent.collection.name,
        let: { assetId: '$_id' },
        pipeline: [
          { $match: { $expr: { $eq: ['$assetId', '$$assetId'] }, type: 'REPAIR_COMPLETED', 'details.capitalize': true, date: { $gte: goLiveStart } } },
          { $group: { _id: null, total: { $sum: { $ifNull: ['$details.cost', { $ifNull: ['$amount', 0] }] } } } },
        ],
        as: 'postGoLiveAdditions',
      },
    },
    {
      $addFields: {
        openingCost: {
          $max: [0, { $subtract: [cost, { $ifNull: [{ $arrayElemAt: ['$postGoLiveAdditions.total', 0] }, 0] }] }],
        },
      },
    },
    { $project: { postGoLiveAdditions: 0 } },
  ]
}

function normalizeDocuments(list) {
  if (!Array.isArray(list)) return []
  return list
    .map(d => (typeof d === 'string' ? { label: null, url: d } : { label: text(d?.label), url: text(d?.url) }))
    .filter(d => d.url)
}

function normalizeInsurance(ins) {
  if (!isPlainObject(ins)) return undefined
  const out = {
    provider:     text(ins.provider),
    policyNo:     text(ins.policyNo),
    expiry:       toDate(ins.expiry, 'insurance expiry'),
    insuredValue: ins.insuredValue === null || ins.insuredValue === undefined || ins.insuredValue === ''
      ? null : money(ins.insuredValue, 'Insured value'),
  }
  return Object.values(out).some(v => v !== null) ? out : undefined
}

async function saveAssetWithTag(doc, categoryCode) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await new Asset(doc).save()
    } catch (err) {
      // A tag created outside the counter (manual import) — take the next one.
      if (isDuplicateKey(err, 'assetTag') && attempt < 3) {
        doc.assetTag = await nextAssetTag(categoryCode)
        continue
      }
      throw err
    }
  }
}

/**
 * Create `quantity` assets from one set of fields, each with its own tag and
 * history. Writes a CREATED event per asset (RECEIVED when it comes from a
 * purchase bill, i.e. base.purchase.billId is set; `eventType` may force
 * CREATED / RECEIVED / OPENING), plus an ASSIGNED event when the asset starts
 * out assigned (acknowledgement PENDING for an employee when the category
 * requires it, except for opening-register assets). All-or-nothing: if any
 * asset or event fails, every asset and event created by this call is deleted
 * and the error is rethrown. Money is NOT moved here.
 *
 * @param {object} p
 * @param {object} p.base   Asset fields: { name, categoryId, brand, model, serialNumber, specs, description,
 *   imageUrl, documents, condition, status, locationId, assignedEmployeeId, assignedDepartmentId,
 *   assignedAt, expectedReturnDate, acknowledgement, purchase:{ billId, vendorId, vendorName, invoiceRef,
 *   mushakNo, date, currency, unitCost, vatAmount, vatCapitalized, otherCosts, expenseId, transactionId },
 *   cost, isCapitalized, availableForUseDate, depreciation:{ method, usefulLifeMonths, residualValue,
 *   decliningRatePct, accumulated, lastPostedPeriod }, taxClass, taxRatePct, opening:{ isExisting, asOfDate,
 *   accumulatedDepreciation, taxWdv, taxWdvFiscalYear }, warrantyExpiry, warrantyNotes, insurance, notes }
 * @param {number} [p.quantity=1]
 * @param {string[]|string} [p.serialNumbers=[]]  one per asset (fewer is fine; more than quantity is an error)
 * @param {object} [p.session]  next-auth session (createdBy)
 * @param {'CREATED'|'RECEIVED'|'OPENING'} [p.eventType]
 * @param {Date|string} [p.date]  date of the creation event (default now)
 * @param {object[]} [p.perAsset]  one entry per asset with its own purchase { unitCost, vatAmount,
 *   otherCosts } (a purchase line's paisa split over its units, so the units add up to the bill).
 *   Each asset's cost (unless base.cost is given), category residual value and creation-event
 *   amount then follow its own figures; capitalisation is still decided once, on base.purchase.
 * @returns {Promise<import('mongoose').Document[]>} the saved Asset documents
 */
export async function createAssets({ base, quantity = 1, serialNumbers = [], session, eventType, date, perAsset = null } = {}) {
  if (!isPlainObject(base)) throw httpError(400, 'Asset details are required')
  await connectDB()

  // ── quantity & serials ──
  const qty = Number(quantity ?? 1)
  if (!Number.isInteger(qty) || qty < 1) throw httpError(422, 'Quantity must be a whole number of at least 1')
  if (qty > MAX_ASSETS_PER_BATCH) throw httpError(422, `At most ${MAX_ASSETS_PER_BATCH} assets can be added at once`)
  const serials = parseSerials(serialNumbers)
  if (serials.length > qty) throw httpError(422, `${serials.length} serial numbers were given for ${qty} asset${qty === 1 ? '' : 's'}`)
  const baseSerial = text(base.serialNumber)
  if (!serials.length && baseSerial && qty === 1) serials.push(baseSerial)

  // ── identity ──
  const name = text(base.name)
  if (!name) throw httpError(422, 'Asset name is required')
  const categoryId = optId(base.categoryId, 'category')
  if (!categoryId) throw httpError(422, 'Category is required')
  const category = await AssetCategory.findById(categoryId).lean()
  if (!category) throw httpError(422, 'Category not found')
  if (category.isActive === false) throw httpError(422, `Category "${category.name}" is inactive`)
  if (category.type === 'CONSUMABLE') {
    throw httpError(422, `"${category.name}" is a consumable category — record it as stock, not as an asset`)
  }

  const settings = await getFinanceSettings()
  const threshold = Number(settings?.inventory?.capitalizationThreshold ?? 10000) || 0

  // ── references ──
  const locationId           = optId(base.locationId, 'location')
  const assignedEmployeeId   = optId(base.assignedEmployeeId, 'employee')
  const assignedDepartmentId = optId(base.assignedDepartmentId, 'department')
  let   assignedUserId       = optId(base.assignedUserId, 'user')
  if (locationId && !(await InventoryLocation.exists({ _id: locationId }))) throw httpError(422, 'Location not found')
  if (assignedEmployeeId) {
    const emp = await Employee.findById(assignedEmployeeId).select('userId').lean()
    if (!emp) throw httpError(422, 'Employee not found')
    if (!assignedUserId && emp.userId) assignedUserId = String(emp.userId)
  }

  // ── purchase & cost ──
  const p = isPlainObject(base.purchase) ? base.purchase : {}
  const purchase = {
    billId:         optId(p.billId, 'purchase bill'),
    vendorId:       optId(p.vendorId, 'vendor'),
    vendorName:     text(p.vendorName),
    invoiceRef:     text(p.invoiceRef),
    mushakNo:       text(p.mushakNo),
    date:           toDate(p.date, 'purchase date'),
    currency:       text(p.currency)?.toUpperCase() ?? 'BDT',
    unitCost:       money(p.unitCost, 'Unit cost'),
    vatAmount:      money(p.vatAmount, 'VAT amount'),
    vatCapitalized: p.vatCapitalized !== false && p.vatCapitalized !== 'false',
    otherCosts:     money(p.otherCosts, 'Other costs'),
    expenseId:      optId(p.expenseId, 'expense'),
    transactionId:  optId(p.transactionId, 'transaction'),
  }
  const cost = base.cost !== null && base.cost !== undefined && base.cost !== ''
    ? money(base.cost, 'Cost')
    : computeAssetCost(purchase)

  const capitalBasis = cost > 0 ? cost : purchase.unitCost
  const isCapitalized = typeof base.isCapitalized === 'boolean'
    ? base.isCapitalized
    : category.capitalize !== false && capitalBasis >= threshold

  // ── opening register ──
  const o = isPlainObject(base.opening) ? base.opening : {}
  const isExisting = o.isExisting === true || o.isExisting === 'true'
  const opening = {
    isExisting,
    asOfDate: toDate(o.asOfDate, 'opening "as of" date') ?? (isExisting ? defaultOpeningAsOf(settings) : null),
    accumulatedDepreciation: isExisting ? money(o.accumulatedDepreciation, 'Opening accumulated depreciation') : 0,
    taxWdv: o.taxWdv === null || o.taxWdv === undefined || o.taxWdv === '' ? null : money(o.taxWdv, 'Opening tax WDV'),
    taxWdvFiscalYear: text(o.taxWdvFiscalYear),
  }
  if (opening.taxWdvFiscalYear && !FY_RE.test(opening.taxWdvFiscalYear)) {
    throw httpError(422, 'Tax WDV income year must look like 2025-26')
  }
  if (isExisting) {
    const dateErr = openingDateError({
      goLiveDate: settings?.goLiveDate || null,
      asOfKey: opening.asOfDate ? dhakaDayKey(opening.asOfDate) : null,
      purchaseKey: purchase.date ? dhakaDayKey(purchase.date) : null,
    })
    if (dateErr) throw httpError(422, dateErr)
  }
  if (opening.accumulatedDepreciation > cost + 0.005) {
    throw httpError(422, 'Opening accumulated depreciation cannot be more than the cost')
  }

  // ── book depreciation ──
  const d = isPlainObject(base.depreciation) ? base.depreciation : {}
  const cls = TAX_DEPRECIATION_CLASSES?.[category.taxClass] ?? null
  const method = DEPRECIATION_METHODS.includes(d.method)
    ? d.method
    : isCapitalized ? (category.depreciationMethod || 'STRAIGHT_LINE') : 'NONE'
  const lifeOverride = Number(d.usefulLifeMonths)
  const usefulLifeMonths = Number.isFinite(lifeOverride) && lifeOverride > 0
    ? Math.round(lifeOverride)
    : Number(category.usefulLifeMonths) > 0 ? Number(category.usefulLifeMonths)
      : Number(cls?.bookLifeMonths) > 0 ? Number(cls.bookLifeMonths) : FALLBACK_LIFE_MONTHS
  const residualValue = d.residualValue !== null && d.residualValue !== undefined && d.residualValue !== ''
    ? money(d.residualValue, 'Residual value')
    : round2(cost * (Number(category.residualPct) || 0) / 100)
  if (residualValue > cost + 0.005) throw httpError(422, 'Residual value cannot be more than the cost')
  let decliningRatePct = null
  if (d.decliningRatePct !== null && d.decliningRatePct !== undefined && d.decliningRatePct !== '') {
    decliningRatePct = Number(d.decliningRatePct)
    if (!Number.isFinite(decliningRatePct) || decliningRatePct <= 0 || decliningRatePct > 100) {
      throw httpError(422, 'Declining-balance rate must be between 0 and 100')
    }
  } else if (category.decliningRatePct !== null && category.decliningRatePct !== undefined) {
    decliningRatePct = Number(category.decliningRatePct)
  }
  const accumulated = d.accumulated !== null && d.accumulated !== undefined && d.accumulated !== ''
    ? money(d.accumulated, 'Accumulated depreciation')
    : opening.accumulatedDepreciation
  if (accumulated > cost + 0.005) throw httpError(422, 'Accumulated depreciation cannot be more than the cost')
  const lastPostedPeriod = typeof d.lastPostedPeriod === 'string' && PERIOD_RE.test(d.lastPostedPeriod) ? d.lastPostedPeriod : null
  const depreciation = {
    method,
    usefulLifeMonths,
    residualValue,
    decliningRatePct,
    accumulated,
    lastPostedPeriod,
    fullyDepreciated: method !== 'NONE' && cost > 0 && accumulated >= round2(cost - residualValue) - 0.005,
  }

  // ── per-unit purchase figures (validated before anything is written) ──
  let units = null
  if (perAsset !== null && perAsset !== undefined) {
    if (!Array.isArray(perAsset) || perAsset.length !== qty) throw httpError(400, 'Per-asset purchase figures must have one entry per asset')
    const fixedCost = base.cost !== null && base.cost !== undefined && base.cost !== ''
    const fixedResidual = d.residualValue !== null && d.residualValue !== undefined && d.residualValue !== ''
    units = perAsset.map((u) => {
      const x = isPlainObject(u) ? u : {}
      const unitPurchase = {
        ...purchase,
        unitCost:   money(x.unitCost, 'Unit cost', purchase.unitCost),
        vatAmount:  money(x.vatAmount, 'VAT amount', purchase.vatAmount),
        otherCosts: money(x.otherCosts, 'Other costs', purchase.otherCosts),
      }
      const unitCost = fixedCost ? cost : computeAssetCost(unitPurchase)
      const unitResidual = fixedResidual ? residualValue : round2(unitCost * (Number(category.residualPct) || 0) / 100)
      if (unitResidual > unitCost + 0.005) throw httpError(422, 'Residual value cannot be more than the cost')
      if (Math.max(accumulated, opening.accumulatedDepreciation) > unitCost + 0.005) {
        throw httpError(422, 'Accumulated depreciation cannot be more than the cost')
      }
      return {
        purchase: unitPurchase,
        cost: unitCost,
        residualValue: unitResidual,
        fullyDepreciated: method !== 'NONE' && unitCost > 0 && accumulated >= round2(unitCost - unitResidual) - 0.005,
      }
    })
  }

  // ── tax class ──
  const taxClass = base.taxClass && TAX_DEPRECIATION_CLASSES?.[base.taxClass] ? base.taxClass : (category.taxClass || 'OTHER')
  let taxRatePct = null
  if (base.taxRatePct !== null && base.taxRatePct !== undefined && base.taxRatePct !== '') {
    taxRatePct = Number(base.taxRatePct)
    if (!Number.isFinite(taxRatePct) || taxRatePct < 0 || taxRatePct > 100) throw httpError(422, 'Tax depreciation rate must be between 0 and 100')
  } else {
    const r = Number(TAX_DEPRECIATION_CLASSES?.[taxClass]?.rate)
    taxRatePct = Number.isFinite(r) ? r : null
  }

  // ── status, custody & acknowledgement ──
  const assigned = Boolean(assignedEmployeeId || assignedDepartmentId)
  const status = base.status ? String(base.status) : assigned ? 'ASSIGNED' : 'IN_STOCK'
  if (!ASSET_STATUSES.includes(status)) throw httpError(422, `Unknown status ${status}`)
  if (TERMINAL_STATUSES.includes(status)) throw httpError(422, 'A new asset cannot start as sold, scrapped, written off or donated')
  if (status === 'ASSIGNED' && !assigned) throw httpError(422, 'Choose the employee or department to assign the asset to')
  if (assigned && !HELD_STATUSES.includes(status)) throw httpError(422, `An asset that is ${status.replace(/_/g, ' ').toLowerCase()} cannot have an assignee`)
  const condition = CONDITIONS.includes(base.condition) ? base.condition : (isExisting ? 'GOOD' : 'NEW')

  const createdAt = eventDate(date)
  const assignedAt = assigned ? (toDate(base.assignedAt, 'assigned date') ?? createdAt) : null
  const requestedAck = isPlainObject(base.acknowledgement) && ACK_STATUSES.includes(base.acknowledgement.status)
    ? base.acknowledgement.status : null
  const ackStatus = requestedAck ?? (
    status === 'ASSIGNED' && assignedEmployeeId && !isExisting && category.requiresAcknowledgement !== false
      ? 'PENDING' : 'NOT_REQUIRED'
  )

  const actor = actorOf(session)
  const creationType = ['CREATED', 'RECEIVED', 'OPENING'].includes(eventType)
    ? eventType
    : purchase.billId ? 'RECEIVED' : 'CREATED'

  const common = {
    name,
    categoryId,
    brand:       text(base.brand),
    model:       text(base.model),
    specs:       text(base.specs),
    description: text(base.description),
    imageUrl:    text(base.imageUrl),
    documents:   normalizeDocuments(base.documents),
    status,
    condition,
    locationId,
    assignedEmployeeId,
    assignedUserId: assignedEmployeeId ? assignedUserId : null,
    assignedDepartmentId,
    assignedAt,
    expectedReturnDate: assigned ? toDate(base.expectedReturnDate, 'expected return date') : null,
    purchase,
    cost,
    isCapitalized,
    availableForUseDate: toDate(base.availableForUseDate, 'available-for-use date') ?? purchase.date ?? null,
    depreciation,
    taxClass,
    taxRatePct,
    opening,
    warrantyExpiry: toDate(base.warrantyExpiry, 'warranty expiry'),
    warrantyNotes:  text(base.warrantyNotes),
    insurance:      normalizeInsurance(base.insurance),
    notes:          text(base.notes),
    createdBy:      actor.id,
    updatedBy:      null,
    isArchived:     false,
  }

  const tags = await allocateAssetTags(category.code, qty)
  const createdIds = []
  const assets = []

  try {
    for (let i = 0; i < qty; i++) {
      const assignEventId = assigned && status === 'ASSIGNED' ? new mongoose.Types.ObjectId() : null
      const unit = units ? units[i] : null
      const assetCost = unit ? unit.cost : cost
      const doc = {
        ...common,
        cost: assetCost,
        assetTag: tags[i],
        serialNumber: serials[i] ?? null,
        purchase: { ...(unit ? unit.purchase : purchase) },
        depreciation: unit
          ? { ...depreciation, residualValue: unit.residualValue, fullyDepreciated: unit.fullyDepreciated }
          : { ...depreciation },
        opening: { ...opening },
        documents: common.documents.map(x => ({ ...x })),
        acknowledgement: {
          status: ackStatus,
          at: null,
          note: null,
          eventId: assignEventId,
        },
      }

      const asset = await saveAssetWithTag(doc, category.code)
      createdIds.push(asset._id)

      const to = { status, locationId, employeeId: assignedEmployeeId, departmentId: assignedDepartmentId, condition }
      await AssetEvent.create(buildEventDoc({
        asset,
        type: creationType,
        date: createdAt,
        // When the asset starts out assigned, the separate ASSIGNED event below records the hand-over.
        to: assignEventId ? { status: 'IN_STOCK', locationId, condition } : to,
        amount: assetCost > 0 ? assetCost : null,
        vendorId: purchase.vendorId,
        transactionId: purchase.transactionId,
        expenseId: purchase.expenseId,
        details: {
          batchSize: qty,
          position: i + 1,
          serialNumber: doc.serialNumber,
          isCapitalized,
          billId: purchase.billId,
          invoiceRef: purchase.invoiceRef,
          ...(isExisting ? {
            opening: {
              asOfDate: opening.asOfDate,
              accumulatedDepreciation: opening.accumulatedDepreciation,
              taxWdv: opening.taxWdv,
              taxWdvFiscalYear: opening.taxWdvFiscalYear,
            },
          } : {}),
        },
        session,
      }))

      if (assignEventId) {
        await AssetEvent.create(buildEventDoc({
          _id: assignEventId,
          asset,
          type: 'ASSIGNED',
          date: assignedAt,
          from: { status: 'IN_STOCK', locationId },
          to,
          details: {
            expectedReturnDate: common.expectedReturnDate,
            acknowledgement: ackStatus,
            atCreation: true,
          },
          session,
        }))
      }

      assets.push(asset)
    }
  } catch (err) {
    // Compensate: remove everything this call created (no multi-document transactions in this app).
    if (createdIds.length) {
      const results = await Promise.allSettled([
        AssetEvent.deleteMany({ assetId: { $in: createdIds } }),
        Asset.deleteMany({ _id: { $in: createdIds } }),
      ])
      for (const r of results) {
        if (r.status === 'rejected') console.error('[inventory/createAssets] rollback failed', r.reason)
      }
    }
    throw err
  }

  return assets
}
