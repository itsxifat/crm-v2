/**
 * Purchase bills (I2) — SERVER-ONLY helpers shared by the /api/inventory/purchases routes.
 *
 *  - input validation + line / bill totals (VAT per line, other costs, TDS/VDS, net payable)
 *  - default input-VAT creditability
 *  - serialisation (list rows and the populated detail view)
 *  - lazy payment-status sync with the linked ProjectExpense (finance pays it in Accounts)
 *  - receiving: ASSET lines → tagged assets (createAssets), CONSUMABLE lines → stock IN
 *    (moveStock PURCHASE), EXPENSE lines → nothing extra; then the payment
 *    (PAY_NOW / REQUEST / PAID_OUTSIDE). All-or-nothing with compensation.
 *  - settling the payment of an already received bill
 *  - cancelling (DRAFT, or RECEIVED while nothing downstream has happened)
 *
 * Errors carry `.status` (and optionally `.details`) for the routes to return as-is.
 */

import mongoose from 'mongoose'
import { z } from 'zod'
import {
  PurchaseBill, Vendor, AssetCategory, StockItem, StockMovement, InventoryLocation, Employee,
  Asset, AssetEvent, ProjectExpense, MoneyAccount, User,
} from '@/models'
import { isValidObjectId } from '@/lib/objectId'
import { canDo } from '@/lib/rbac'
import { dhakaDayKey, dhakaDate, parseDhakaDay } from '@/lib/dhakaTime'
import { getFinanceSettings, assertBooksOpen } from '@/lib/finance/settings'
import { channelFromPaymentMethod, normalizeChannel, isBankingChannel } from '@/lib/finance/constants'
import { BIN_REGEX, normalizeBin, isValidBin, treatmentForRate, ITC_BANKING_THRESHOLD } from '@/lib/tax/catalog'
import {
  createAssets, MAX_ASSETS_PER_BATCH, PURCHASE_LINE_TYPES, SUPPLIER_VAT_TYPES, TERMINAL_STATUSES, round2,
  UPLOAD_URL_RE, computeAssetCost,
} from '@/lib/inventory/assets'
import { moveStock } from '@/lib/inventory/stock'
import { payExpenseNow, billWithholdingSet } from '@/lib/expensePayment'
import { createNotification } from '@/lib/createNotification'

// ── basics ───────────────────────────────────────────────────────────────────

export function httpError(status, message, extra = {}) {
  const err = new Error(message)
  err.status = status
  Object.assign(err, extra)
  return err
}

const round4 = (n) => Math.round((Number(n) + Number.EPSILON) * 10000) / 10000
const num = (v) => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}
const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '')
const escapeRegex = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
const sid = (v) => (v === null || v === undefined ? null : String(v?._id ?? v))

export const todayKey = () => dhakaDayKey(new Date())

/** Date for a 'YYYY-MM-DD' Dhaka day; today keeps the current time (keeps timelines ordered). */
function dayToDate(key) {
  if (!key) return null
  if (key === todayKey()) return new Date()
  return parseDhakaDay(key)?.start ?? null
}

/** Dhaka day + N months (day clamped to the target month's last day), as 'YYYY-MM-DD'. */
function addMonthsKey(key, months) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(key ?? ''))
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2]) - 1 + Number(months)
  const lastDay = new Date(Date.UTC(y, mo + 1, 0)).getUTCDate()
  const d = Math.min(Number(m[3]), lastDay)
  return dhakaDayKey(dhakaDate(y, mo, d, 12))
}

/** Zod error → 422 with a readable first message ("Line 2: Quantity must be more than 0"). */
export function validationError(zodError) {
  const issue = zodError.issues?.[0]
  let message = issue?.message || 'Validation failed'
  if (issue?.path?.[0] === 'lines' && Number.isInteger(issue.path[1])) message = `Line ${issue.path[1] + 1}: ${message}`
  else if (issue?.path?.[0] === 'payment' && issue.path[1]) message = `Payment: ${message}`
  return httpError(422, message, { details: zodError.flatten() })
}

// ── input schemas ────────────────────────────────────────────────────────────

const optText = (max, label = 'Value') => z.preprocess(
  v => (blank(v) ? null : String(v).trim()),
  z.string().max(max, `${label} is too long (max ${max} characters)`).nullable(),
).optional()

const optId = (label) => z.preprocess(
  v => {
    if (blank(v)) return null
    if (typeof v === 'object') return v.id ?? (v._id ? String(v._id) : null)
    return String(v).trim()
  },
  z.string().refine(isValidObjectId, `Invalid ${label}`).nullable(),
).optional()

const toDayKey = (v) => {
  if (blank(v)) return null
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? 'invalid' : dhakaDayKey(v)
  const s = String(v).trim()
  if (/^\d{4}-\d{2}-\d{2}T/.test(s)) {
    const d = new Date(s)
    return Number.isNaN(d.getTime()) ? s : dhakaDayKey(d)
  }
  return s
}

const dayKey = (label) => z.string({ required_error: `${label} is required`, invalid_type_error: `${label} is required` })
  .regex(/^\d{4}-\d{2}-\d{2}$/, `${label} must be a valid date`)
  .refine(s => Boolean(parseDhakaDay(s)), `${label} must be a valid date`)

const optDay = (label) => z.preprocess(toDayKey, dayKey(label).nullable()).optional()

const money = (label, max = 1e11) => z.preprocess(
  v => (blank(v) ? 0 : v),
  z.coerce.number({ invalid_type_error: `${label} must be a number` })
    .finite(`${label} must be a number`).min(0, `${label} cannot be negative`).max(max, `${label} is too large`),
)

const optMoney = (label) => z.preprocess(
  v => (blank(v) ? null : v),
  z.coerce.number({ invalid_type_error: `${label} must be a number` })
    .finite(`${label} must be a number`).min(0, `${label} cannot be negative`).max(1e11, `${label} is too large`).nullable(),
).optional()

const optRate = (label) => z.preprocess(
  v => (blank(v) ? null : v),
  z.coerce.number({ invalid_type_error: `${label} must be a number` })
    .finite().min(0, `${label} cannot be negative`).max(100, `${label} cannot exceed 100%`).nullable(),
).optional()

const optBool = z.preprocess(
  v => (v === 'true' ? true : v === 'false' ? false : (blank(v) ? null : v)),
  z.boolean().nullable(),
).optional()

const serialList = z.preprocess(
  v => {
    if (blank(v)) return []
    const raw = Array.isArray(v) ? v : String(v).split(/[\r\n,]+/)
    return raw.map(s => (s === null || s === undefined ? '' : String(s).trim())).filter(Boolean)
  },
  z.array(z.string().max(100, 'Serial numbers are at most 100 characters')).max(MAX_ASSETS_PER_BATCH),
).optional()

const lineSchema = z.object({
  lineType:         z.enum(PURCHASE_LINE_TYPES, { errorMap: () => ({ message: 'Choose Asset, Consumable or Expense' }) }),
  categoryId:       optId('category'),
  stockItemId:      optId('stock item'),
  description:      z.preprocess(v => (blank(v) ? '' : String(v).trim()), z.string().min(1, 'Description is required').max(300, 'Description is too long')),
  brand:            optText(100, 'Brand'),
  model:            optText(100, 'Model'),
  qty:              z.coerce.number({ invalid_type_error: 'Quantity must be a number' }).finite('Quantity must be a number')
    .positive('Quantity must be more than 0').max(1000000, 'Quantity is too large'),
  unit:             optText(20, 'Unit'),
  unitPrice:        money('Unit price', 1e10),
  vatRate:          z.preprocess(v => (blank(v) ? 0 : v), z.coerce.number({ invalid_type_error: 'VAT % must be a number' })
    .finite().min(0, 'VAT % cannot be negative').max(100, 'VAT % cannot exceed 100')),
  vatAmount:        optMoney('VAT amount'),
  sdAmount:         money('SD amount'),
  capitalize:       optBool,
  serialNumbers:    serialList,
  locationId:       optId('location'),
  assignEmployeeId: optId('employee'),
  warrantyMonths:   z.preprocess(v => (blank(v) ? null : v), z.coerce.number({ invalid_type_error: 'Warranty must be a number of months' })
    .int('Warranty must be whole months').min(0).max(240, 'Warranty is at most 240 months').nullable()).optional(),
}).passthrough()

const withholdingTds = z.object({
  section: optText(40, 'TDS section'),
  rate:    optRate('TDS rate'),
  amount:  money('TDS amount'),
  higherRateApplied: optBool,
}).partial().nullable().optional()

const withholdingVds = z.object({
  serviceCode: optText(40, 'VAT service code'),
  rate:        optRate('VDS rate'),
  amount:      money('VDS amount'),
}).partial().nullable().optional()

export const billInputSchema = z.object({
  vendorId:          optId('vendor'),
  vendorName:        optText(200, 'Supplier name'),
  supplierBin:       z.preprocess(
    v => (blank(v) ? null : String(v).replace(/\s+/g, '')),
    z.string().regex(BIN_REGEX, 'Supplier BIN must be 9 or 13 digits, e.g. 000123456-0101').nullable(),
  ).optional(),
  supplierVatType:   z.preprocess(v => (blank(v) ? null : String(v).toUpperCase()), z.enum(SUPPLIER_VAT_TYPES).nullable()).optional(),
  supplierInvoiceNo: optText(100, 'Supplier invoice no.'),
  mushakNo:          optText(100, 'Mushak-6.3 no.'),
  mushakDate:        optDay('Mushak-6.3 date'),
  billDate:          z.preprocess(toDayKey, dayKey('Bill date')),
  currency:          z.preprocess(v => (blank(v) ? 'BDT' : String(v).trim().toUpperCase()),
    z.literal('BDT', { errorMap: () => ({ message: 'Purchase bills are recorded in BDT — convert foreign-currency bills at the payment rate' }) })),
  lines:             z.array(lineSchema, { invalid_type_error: 'Add at least one line' }).min(1, 'Add at least one line').max(200, 'A bill can have at most 200 lines'),
  otherCosts:        money('Other costs'),
  vatCreditable:     optBool,
  tds:               withholdingTds,
  vds:               withholdingVds,
  attachments:       z.preprocess(
    v => (Array.isArray(v) ? v.map(s => (typeof s === 'string' ? s.trim() : '')).filter(Boolean) : []),
    z.array(z.string().trim().max(500).regex(UPLOAD_URL_RE, 'Attachments must be uploaded files'))
      .max(20, 'At most 20 attachments'),
  ).optional(),
  notes:             optText(2000, 'Notes'),
})

const paymentInputSchema = z.object({
  mode:          z.enum(['PAY_NOW', 'REQUEST', 'PAID_OUTSIDE'], { errorMap: () => ({ message: 'Choose how this bill is paid' }) }),
  accountId:     optId('money account'),
  paymentMethod: optText(40, 'Payment method'),
  channel:       optText(30, 'Channel'),
  paidAt:        optDay('Payment date'),
  reference:     optText(120, 'Payment reference'),
  proofUrl:      z.preprocess(
    v => (blank(v) ? null : String(v).trim()),
    z.string().regex(UPLOAD_URL_RE, 'Upload the payment proof with the upload button').nullable(),
  ).optional(),
  note:          optText(500, 'Note'),
})

export const receiveInputSchema = z.object({
  receivedAt: optDay('Received date'),
  payment:    paymentInputSchema,
})

export const paymentBodySchema = z.object({ payment: paymentInputSchema })

export const cancelInputSchema = z.object({
  reason: optText(500, 'Reason'),
})

// ── totals ───────────────────────────────────────────────────────────────────

/**
 * Taxable base (qty × unit price), SD, VAT (given or computed) and line total.
 * VAT is charged on the SD-inclusive value (same rule as lib/invoiceTotals).
 */
export function computeLine(line) {
  const qty = num(line.qty)
  const base = round2(qty * num(line.unitPrice))
  const sdAmount = round2(num(line.sdAmount))
  const vatAmount = line.vatAmount === null || line.vatAmount === undefined || line.vatAmount === ''
    ? round2((base + sdAmount) * num(line.vatRate) / 100)
    : round2(num(line.vatAmount))
  return { base, vatAmount, sdAmount, lineTotal: round2(base + vatAmount + sdAmount) }
}

export function computeTotals(lines, otherCosts = 0) {
  let subtotal = 0
  let vatTotal = 0
  let sdTotal = 0
  for (const l of lines) {
    const c = computeLine(l)
    subtotal += c.base
    vatTotal += c.vatAmount
    sdTotal += c.sdAmount
  }
  subtotal = round2(subtotal)
  vatTotal = round2(vatTotal)
  sdTotal = round2(sdTotal)
  const other = round2(num(otherCosts))
  return { subtotal, vatTotal, sdTotal, otherCosts: other, total: round2(subtotal + vatTotal + sdTotal + other) }
}

/**
 * Other costs (delivery, installation…) shared over the goods lines (ASSET and
 * CONSUMABLE) pro rata to their value, in whole paisa so the shares add up
 * exactly. Expense-only bills keep other costs as expense (all zeros).
 */
export function allocateOtherCosts(lines, otherCosts) {
  const out = lines.map(() => 0)
  const cents = Math.round(round2(num(otherCosts)) * 100)
  if (cents <= 0) return out
  const goods = lines
    .map((l, i) => ({ i, base: l.lineType === 'EXPENSE' ? 0 : round2(num(l.qty) * num(l.unitPrice)) }))
    .filter(g => g.base > 0)
  const sum = goods.reduce((s, g) => s + g.base, 0)
  if (!(sum > 0)) return out
  let used = 0
  goods.forEach((g, k) => {
    const share = k === goods.length - 1 ? cents - used : Math.floor((cents * g.base) / sum)
    used += share
    out[g.i] = share / 100
  })
  return out
}

/**
 * `amount` split into `n` whole-paisa parts that add up to it exactly (the first
 * parts carry the leftover paisa, one each). Never negative for amount ≥ 0.
 */
export function splitPaisa(amount, n) {
  const count = Math.max(1, Math.floor(num(n)))
  const cents = Math.round(round2(num(amount)) * 100)
  const share = Math.floor(cents / count)
  const extra = cents - share * count
  return Array.from({ length: count }, (_, k) => (share + (k < extra ? 1 : 0)) / 100)
}

/** Per-unit cost parts used for stock (BDT). Assets use splitPaisa per cost component. */
export function unitCostParts(line, { vatCreditable, otherShare }) {
  const qty = num(line.qty) || 1
  const vatPerUnit = round4(num(line.vatAmount) / qty)
  const otherPerUnit = round4((num(otherShare) + num(line.sdAmount)) / qty)
  const unitPrice = num(line.unitPrice)
  return {
    unitPrice,
    vatPerUnit,
    otherPerUnit,
    unitCost: round4(unitPrice + (vatCreditable ? 0 : vatPerUnit) + otherPerUnit),
  }
}

// ── validation against the database ──────────────────────────────────────────

/** Categories / stock items / locations / employees referenced by the lines, keyed by id. */
async function loadLineRefs(lines) {
  const ids = (key) => [...new Set(lines.map(l => sid(l[key])).filter(Boolean))]
  const [categories, stockItems, locations, employees] = await Promise.all([
    AssetCategory.find({ _id: { $in: ids('categoryId') } }).lean(),
    StockItem.find({ _id: { $in: ids('stockItemId') } }).lean(),
    InventoryLocation.find({ _id: { $in: ids('locationId') } }).select('name isActive').lean(),
    Employee.find({ _id: { $in: ids('assignEmployeeId') } })
      .select('userId resigned isActive').populate({ path: 'userId', select: 'name isActive' }).lean(),
  ])
  const byId = (rows) => new Map(rows.map(r => [String(r._id), r]))
  return { categories: byId(categories), stockItems: byId(stockItems), locations: byId(locations), employees: byId(employees) }
}

function lineError(i, message) {
  return httpError(422, `Line ${i + 1}: ${message}`)
}

/**
 * Checks every line against current master data and normalises it for storage.
 * Throws 422 with the first problem.
 */
function normalizeLines(lines, refs) {
  const serialsSeen = new Map()
  return lines.map((l, i) => {
    const lineType = l.lineType
    let categoryId = sid(l.categoryId)
    let stockItemId = lineType === 'CONSUMABLE' ? sid(l.stockItemId) : null
    const category = categoryId ? refs.categories.get(categoryId) : null
    if (categoryId && !category) throw lineError(i, 'Category not found')
    if (category && category.isActive === false) throw lineError(i, `Category "${category.name}" is inactive`)

    if (lineType === 'ASSET') {
      if (!category) throw lineError(i, 'Choose the asset category')
      if (category.type !== 'ASSET') throw lineError(i, `"${category.name}" is a consumable category — use a Consumable line`)
      if (!Number.isInteger(Number(l.qty))) throw lineError(i, 'Asset quantity must be a whole number')
      if (Number(l.qty) > MAX_ASSETS_PER_BATCH) throw lineError(i, `At most ${MAX_ASSETS_PER_BATCH} assets per line`)
    }

    if (lineType === 'CONSUMABLE') {
      if (stockItemId) {
        const item = refs.stockItems.get(stockItemId)
        if (!item) throw lineError(i, 'Stock item not found')
        if (item.isActive === false) throw lineError(i, `Stock item "${item.name}" is inactive`)
        if (item.categoryId) categoryId = String(item.categoryId)
      }
      const cat = categoryId ? (refs.categories.get(categoryId) ?? null) : null
      if (!stockItemId && !cat) throw lineError(i, 'Choose the consumable category or an existing stock item')
      if (cat && cat.type !== 'CONSUMABLE' && !stockItemId) throw lineError(i, `"${cat.name}" is an asset category — use an Asset line`)
    }

    const serials = lineType === 'ASSET' ? (l.serialNumbers ?? []) : []
    if (serials.length > Number(l.qty)) throw lineError(i, `${serials.length} serial numbers for a quantity of ${l.qty}`)
    for (const s of serials) {
      const key = s.toUpperCase()
      if (serialsSeen.has(key)) throw lineError(i, `Serial number ${s} is entered more than once`)
      serialsSeen.set(key, i)
    }

    const locationId = sid(l.locationId)
    if (locationId) {
      const loc = refs.locations.get(locationId)
      if (!loc) throw lineError(i, 'Location not found')
      if (loc.isActive === false) throw lineError(i, `Location "${loc.name}" is inactive`)
    }

    const assignEmployeeId = lineType === 'ASSET' ? sid(l.assignEmployeeId) : null
    if (assignEmployeeId) {
      const emp = refs.employees.get(assignEmployeeId)
      if (!emp) throw lineError(i, 'Employee not found')
      if (emp.resigned || emp.isActive === false || emp.userId?.isActive === false) {
        throw lineError(i, `${emp.userId?.name ?? 'This employee'} is no longer active — choose someone else`)
      }
    }

    const c = computeLine(l)
    const unit = lineType === 'ASSET'
      ? 'pcs'
      : (l.unit || (stockItemId ? refs.stockItems.get(stockItemId)?.unit : null) || (lineType === 'CONSUMABLE' ? 'pcs' : null))

    const out = {
      lineType,
      categoryId: categoryId || null,
      stockItemId: stockItemId || null,
      description: l.description,
      brand: lineType === 'EXPENSE' ? null : (l.brand ?? null),
      model: lineType === 'EXPENSE' ? null : (l.model ?? null),
      qty: lineType === 'ASSET' ? Number(l.qty) : round4(Number(l.qty)),
      unit,
      unitPrice: round4(num(l.unitPrice)),
      vatRate: round4(num(l.vatRate)),
      vatAmount: c.vatAmount,
      sdAmount: c.sdAmount,
      lineTotal: c.lineTotal,
      capitalize: lineType === 'ASSET' && typeof l.capitalize === 'boolean' ? l.capitalize : null,
      serialNumbers: serials,
      locationId: lineType === 'EXPENSE' ? null : (locationId || null),
      assignEmployeeId: assignEmployeeId || null,
      warrantyMonths: lineType === 'ASSET' && l.warrantyMonths !== null && l.warrantyMonths !== undefined ? Number(l.warrantyMonths) : null,
      assetIds: [],
      stockMovementId: null,
    }
    // Keep the line's own _id on edits so links survive a re-save.
    if (l._id && isValidObjectId(String(l._id))) out._id = String(l._id)
    else if (typeof l.id === 'string' && isValidObjectId(l.id)) out._id = l.id
    return out
  })
}

/**
 * Default input-VAT claim: every line's category allows ITC, the company is VAT
 * registered with a standard-rated supply, the supplier is VAT registered and
 * there is VAT on the bill.
 */
export function defaultVatCreditable({ lines, categories, settings, supplierVatType, vatTotal }) {
  if (!(vatTotal > 0)) return false
  if (settings?.vat?.registrationType !== 'REGISTERED') return false
  if ((settings?.vat?.defaultSalesTreatment ?? 'STANDARD') !== 'STANDARD') return false
  if ((supplierVatType ?? 'REGISTERED') !== 'REGISTERED') return false
  return lines.every(l => {
    const cat = l.categoryId ? categories.get(String(l.categoryId)) : null
    return Boolean(cat?.inputVatCreditable)
  })
}

/** VAT can never be claimed in these situations, whatever the user ticked. */
function vatClaimBlocked({ settings, supplierVatType, vatTotal }) {
  return !(vatTotal > 0) ||
    settings?.vat?.registrationType !== 'REGISTERED' ||
    (supplierVatType ?? 'REGISTERED') !== 'REGISTERED'
}

/**
 * Validate a create/update body and build the stored bill fields.
 * @returns {Promise<{ doc: object, vendor: object|null }>}
 */
export async function buildBillDoc(body) {
  const parsed = billInputSchema.safeParse(body ?? {})
  if (!parsed.success) throw validationError(parsed.error)
  const data = parsed.data
  const settings = await getFinanceSettings()
  const today = todayKey()

  if (data.billDate > today) throw httpError(422, 'Bill date cannot be in the future')
  if (data.mushakDate && data.mushakDate > today) throw httpError(422, 'Mushak-6.3 date cannot be in the future')

  // ── supplier ──
  let vendor = null
  if (data.vendorId) {
    vendor = await Vendor.findById(data.vendorId)
      .select('company bin vatRegistrationType payeeType hasPsr defaultTdsSection defaultVatServiceCode').lean()
    if (!vendor) throw httpError(422, 'Vendor not found')
  }
  const vendorName = data.vendorName ?? vendor?.company ?? null
  if (!vendorName) throw httpError(422, 'Choose a vendor or type the supplier name')
  const supplierVatType = data.supplierVatType ?? vendor?.vatRegistrationType ?? 'REGISTERED'
  const rawBin = data.supplierBin ?? vendor?.bin ?? null
  const supplierBin = rawBin ? (normalizeBin(rawBin) || rawBin) : null

  // ── lines ──
  const refs = await loadLineRefs(data.lines)
  const lines = normalizeLines(data.lines, refs)
  const totals = computeTotals(lines, data.otherCosts)

  // ── withholding ──
  const tds = {
    section: data.tds?.section ?? null,
    rate: data.tds?.rate ?? null,
    amount: round2(num(data.tds?.amount)),
    higherRateApplied: Boolean(data.tds?.higherRateApplied),
  }
  const vds = {
    serviceCode: data.vds?.serviceCode ?? null,
    rate: data.vds?.rate ?? null,
    amount: round2(num(data.vds?.amount)),
  }
  if (!tds.section) { tds.rate = null; tds.higherRateApplied = false; if (tds.amount > 0) throw httpError(422, 'Select the TDS section for the TDS amount') }
  if (!vds.serviceCode) { vds.rate = null; if (vds.amount > 0) throw httpError(422, 'Select the VAT service code for the VDS amount') }
  if (vds.amount > totals.vatTotal + 0.005) throw httpError(422, 'VDS cannot be more than the VAT on the bill')
  const netPayable = round2(totals.total - tds.amount - vds.amount)
  if (netPayable < -0.005) throw httpError(422, 'Withholding (TDS + VDS) cannot be more than the bill total')

  // ── VAT credit ──
  let vatCreditable = typeof data.vatCreditable === 'boolean'
    ? data.vatCreditable
    : defaultVatCreditable({ lines, categories: refs.categories, settings, supplierVatType, vatTotal: totals.vatTotal })
  if (vatClaimBlocked({ settings, supplierVatType, vatTotal: totals.vatTotal })) vatCreditable = false

  const doc = {
    vendorId: data.vendorId ?? null,
    vendorName,
    supplierBin,
    supplierVatType,
    supplierInvoiceNo: data.supplierInvoiceNo ?? null,
    mushakNo: data.mushakNo ?? null,
    mushakDate: data.mushakDate ? parseDhakaDay(data.mushakDate).start : null,
    billDate: parseDhakaDay(data.billDate).start,
    currency: 'BDT',
    lines,
    subtotal: totals.subtotal,
    vatTotal: totals.vatTotal,
    sdTotal: totals.sdTotal,
    otherCosts: totals.otherCosts,
    total: totals.total,
    vatCreditable,
    tds,
    vds,
    netPayable: Math.max(0, netPayable),
    attachments: data.attachments ?? [],
    notes: data.notes ?? null,
  }
  return { doc, vendor }
}

// ── serialisation ────────────────────────────────────────────────────────────

const dayOf = (d) => (d ? dhakaDayKey(d) : null)

function serializeLine(l) {
  const { _id, ...rest } = l
  return {
    ...rest,
    id: sid(_id),
    categoryId: sid(rest.categoryId),
    stockItemId: sid(rest.stockItemId),
    locationId: sid(rest.locationId),
    assignEmployeeId: sid(rest.assignEmployeeId),
    stockMovementId: sid(rest.stockMovementId),
    assetIds: (rest.assetIds ?? []).map(sid),
    serialNumbers: rest.serialNumbers ?? [],
  }
}

/** Lean PurchaseBill → API shape (ids as strings, plus day keys for the date fields). */
export function serializeBill(b) {
  if (!b) return null
  const { _id, __v, lines, payment, tds, vds, ...rest } = b
  return {
    ...rest,
    id: sid(_id),
    vendorId: sid(rest.vendorId),
    createdBy: sid(rest.createdBy),
    cancelledBy: sid(rest.cancelledBy),
    billDay: dayOf(rest.billDate),
    mushakDay: dayOf(rest.mushakDate),
    receivedDay: dayOf(rest.receivedAt),
    lines: (lines ?? []).map(serializeLine),
    tds: { section: tds?.section ?? null, rate: tds?.rate ?? null, amount: num(tds?.amount), higherRateApplied: Boolean(tds?.higherRateApplied) },
    vds: { serviceCode: vds?.serviceCode ?? null, rate: vds?.rate ?? null, amount: num(vds?.amount) },
    payment: {
      mode: payment?.mode ?? 'REQUEST',
      status: payment?.status ?? 'UNPAID',
      // The account a bill was paid from — none until it is PAID (older reversed bills kept it).
      accountId: payment?.status === 'PAID' ? sid(payment?.accountId) : null,
      paymentMethod: payment?.paymentMethod ?? null,
      expenseId: sid(payment?.expenseId),
      transactionId: sid(payment?.transactionId),
    },
    assetCount: (lines ?? []).reduce((s, l) => s + (l.assetIds?.length ?? 0), 0),
  }
}

// ── payment status sync (finance pays / rejects the request in Accounts) ─────

/**
 * Bring payment.status of REQUESTED bills in line with their ProjectExpense:
 * PAID/AUTHORIZED ⇒ PAID (+ transaction id on the bill and its assets, and the
 * VDS / TDS / net payable Accounts actually applied — billWithholdingSet);
 * REJECTED or deleted ⇒ UNPAID (the bill can be paid or re-requested).
 * Mutates the passed lean bills so the response is current.
 */
export async function syncBillPayments(bills) {
  const pending = (bills ?? []).filter(b => b?.status === 'RECEIVED' && b.payment?.status === 'REQUESTED' && b.payment?.expenseId)
  if (!pending.length) return
  const expenses = await ProjectExpense.find({ _id: { $in: pending.map(b => b.payment.expenseId) } })
    .select('status accountsTransactionId accountId paymentMethod tax currency amount').lean()
  const byId = new Map(expenses.map(e => [String(e._id), e]))
  const ops = []
  const assetOps = []
  for (const b of pending) {
    const e = byId.get(String(b.payment.expenseId))
    let set = null
    if (!e || e.status === 'REJECTED') {
      // Nothing was paid: no account / method to show ("Paid from" is for PAID only).
      set = { 'payment.status': 'UNPAID', 'payment.accountId': null, 'payment.paymentMethod': null }
      b.payment.status = 'UNPAID'
      b.payment.accountId = null
      b.payment.paymentMethod = null
    } else if (['PAID', 'AUTHORIZED'].includes(e.status)) {
      set = {
        'payment.status': 'PAID',
        'payment.transactionId': e.accountsTransactionId ?? null,
        'payment.accountId': e.accountId ?? b.payment.accountId ?? null,
        'payment.paymentMethod': e.paymentMethod ?? b.payment.paymentMethod ?? null,
      }
      b.payment.status = 'PAID'
      b.payment.transactionId = e.accountsTransactionId ?? null
      b.payment.accountId = e.accountId ?? b.payment.accountId ?? null
      b.payment.paymentMethod = e.paymentMethod ?? b.payment.paymentMethod ?? null
      // Withholding as paid (Accounts may have changed VDS / TDS at payment).
      for (const [path, value] of Object.entries(billWithholdingSet(e))) {
        set[path] = value
        const [head, tail] = path.split('.')
        if (tail) b[head] = { ...(b[head] ?? {}), [tail]: value }
        else b[head] = value
      }
      if (e.accountsTransactionId) {
        assetOps.push({
          updateMany: {
            filter: { 'purchase.billId': b._id },
            update: { $set: { 'purchase.expenseId': e._id, 'purchase.transactionId': e.accountsTransactionId } },
          },
        })
      }
    }
    if (set) {
      ops.push({ updateOne: { filter: { _id: b._id, 'payment.status': 'REQUESTED', 'payment.expenseId': b.payment.expenseId }, update: { $set: set } } })
    }
  }
  try {
    if (ops.length) await PurchaseBill.bulkWrite(ops, { ordered: false })
    if (assetOps.length) await Asset.bulkWrite(assetOps, { ordered: false })
  } catch (err) {
    console.error('[purchases] payment sync failed', err)
  }
}

// ── detail view ──────────────────────────────────────────────────────────────

/** Asset purchase fields needed (with `cost`) by billCostOf. */
const BILL_COST_FIELDS = 'purchase.unitCost purchase.vatAmount purchase.vatCapitalized purchase.otherCosts'

/**
 * What an asset cost on its purchase bill (unit price + capitalised VAT + share of
 * other costs) — not its current cost, which also carries repairs / upgrades
 * capitalised later. Falls back to the current cost when the purchase part is empty.
 */
function billCostOf(asset) {
  return computeAssetCost(asset?.purchase ?? {}) || num(asset?.cost)
}

/** Populated detail of one bill (lines with categories, stock items, assets, movements; expense). */
export async function loadBillDetail(id) {
  const bill = await PurchaseBill.findById(id).lean()
  if (!bill) return null
  await syncBillPayments([bill])

  const lines = bill.lines ?? []
  const ids = (pick) => [...new Set(lines.flatMap(l => [].concat(pick(l) ?? [])).map(sid).filter(Boolean))]

  const [vendor, categories, stockItems, locations, employees, assets, movements, expense, creator, account] = await Promise.all([
    bill.vendorId
      ? Vendor.findById(bill.vendorId).select('company bin vatRegistrationType payeeType hasPsr defaultTdsSection defaultVatServiceCode').lean()
      : null,
    AssetCategory.find({ _id: { $in: ids(l => l.categoryId) } }).select('name code type capitalize inputVatCreditable requiresAcknowledgement isActive').lean(),
    StockItem.find({ _id: { $in: ids(l => l.stockItemId) } }).select('sku name unit qtyOnHand avgCost isActive').lean(),
    InventoryLocation.find({ _id: { $in: ids(l => l.locationId) } }).select('name code').lean(),
    Employee.find({ _id: { $in: ids(l => l.assignEmployeeId) } }).select('userId employeeId designation department')
      .populate({ path: 'userId', select: 'name avatar' }).lean(),
    Asset.find({ $or: [{ _id: { $in: ids(l => l.assetIds) } }, { 'purchase.billId': bill._id }] })
      .select(`assetTag name status serialNumber cost isCapitalized assignedEmployeeId acknowledgement.status depreciation.accumulated ${BILL_COST_FIELDS}`).lean(),
    StockMovement.find({ $or: [{ _id: { $in: ids(l => l.stockMovementId) } }, { purchaseBillId: bill._id }] })
      .select('movementNo stockItemId type direction qty unitCost totalCost date reason').sort({ createdAt: 1 }).lean(),
    bill.payment?.expenseId
      ? ProjectExpense.findById(bill.payment.expenseId)
        .select('expenseId title status amount amountBDT netPayable expenseInvoiceNo paidAt paidBy reviewNote accountsTransactionId accountId category tax.netPayable')
        .populate('paidBy', 'name').lean()
      : null,
    bill.createdBy ? User.findById(bill.createdBy).select('name').lean() : null,
    // "Paid from" — only for a bill that is paid (a reversed / unpaid one has no source account).
    bill.payment?.status === 'PAID' && bill.payment?.accountId
      ? MoneyAccount.findById(bill.payment.accountId).select('name type last4 currency').lean()
      : null,
  ])

  const map = (rows) => new Map(rows.map(r => [String(r._id), r]))
  const catMap = map(categories)
  const itemMap = map(stockItems)
  const locMap = map(locations)
  const empMap = map(employees)
  const assetMap = map(assets)
  const moveMap = map(movements)

  const out = serializeBill(bill)
  out.lines = out.lines.map((l) => {
    const cat = l.categoryId ? catMap.get(l.categoryId) : null
    const item = l.stockItemId ? itemMap.get(l.stockItemId) : null
    const loc = l.locationId ? locMap.get(l.locationId) : null
    const emp = l.assignEmployeeId ? empMap.get(l.assignEmployeeId) : null
    const mv = l.stockMovementId ? moveMap.get(l.stockMovementId) : null
    return {
      ...l,
      category: cat ? { id: String(cat._id), name: cat.name, code: cat.code, type: cat.type, capitalize: cat.capitalize, inputVatCreditable: cat.inputVatCreditable } : null,
      stockItem: item ? { id: String(item._id), sku: item.sku, name: item.name, unit: item.unit, qtyOnHand: item.qtyOnHand, avgCost: item.avgCost, isActive: item.isActive } : null,
      location: loc ? { id: String(loc._id), name: loc.name, code: loc.code ?? null } : null,
      assignEmployee: emp ? { id: String(emp._id), name: emp.userId?.name ?? 'Employee', avatar: emp.userId?.avatar ?? null, sub: [emp.designation, emp.department].filter(Boolean).join(' · ') || 'Employee', type: 'EMPLOYEE' } : null,
      assets: l.assetIds.map(aid => assetMap.get(aid)).filter(Boolean).map(a => ({
        id: String(a._id), assetTag: a.assetTag, name: a.name, status: a.status, serialNumber: a.serialNumber ?? null,
        cost: num(a.cost), isCapitalized: a.isCapitalized !== false, acknowledgement: a.acknowledgement?.status ?? null,
      })),
      stockMovement: mv ? { id: String(mv._id), movementNo: mv.movementNo, qty: mv.qty, unitCost: mv.unitCost, totalCost: mv.totalCost, date: mv.date } : null,
    }
  })
  out.movements = movements.map(m => ({
    id: String(m._id), movementNo: m.movementNo, stockItemId: sid(m.stockItemId), type: m.type, direction: m.direction,
    qty: m.qty, unitCost: m.unitCost, totalCost: m.totalCost, date: m.date, reason: m.reason ?? null,
  }))
  out.capitalizedAmount = round2(assets.filter(a => a.isCapitalized !== false).reduce((s, a) => s + billCostOf(a), 0))
  out.vendor = vendor ? {
    id: String(vendor._id), company: vendor.company, bin: vendor.bin ?? null, vatRegistrationType: vendor.vatRegistrationType ?? null,
    payeeType: vendor.payeeType ?? 'COMPANY', hasPsr: Boolean(vendor.hasPsr),
    defaultTdsSection: vendor.defaultTdsSection ?? null, defaultVatServiceCode: vendor.defaultVatServiceCode ?? null,
  } : null
  out.expense = expense ? {
    id: String(expense._id), expenseId: expense.expenseId ?? null, title: expense.title, status: expense.status,
    amount: num(expense.amount), netPayable: expense.tax?.netPayable ?? null, expenseInvoiceNo: expense.expenseInvoiceNo ?? null,
    paidAt: expense.paidAt ?? null, paidBy: expense.paidBy?.name ?? null, reviewNote: expense.reviewNote ?? null,
    transactionId: sid(expense.accountsTransactionId), category: expense.category,
  } : null
  out.account = account ? { id: String(account._id), name: account.name, type: account.type, last4: account.last4 ?? null, currency: account.currency } : null
  out.createdByName = creator?.name ?? null
  out.cancelledByName = null
  if (bill.cancelledBy) {
    const canceller = await User.findById(bill.cancelledBy).select('name').lean().catch(() => null)
    out.cancelledByName = canceller?.name ?? null
  }
  out.cancelledDay = dayOf(bill.cancelledAt)
  return out
}

// ── payment ──────────────────────────────────────────────────────────────────

/** Default payment-method code for an account (used for the expense / ledger row). */
function defaultMethodFor(account) {
  if (!account) return null
  if (['CASH', 'PETTY_CASH'].includes(account.type)) return 'CASH'
  if (account.type === 'MFS' && account.mfsProvider) return account.mfsProvider
  if (account.type === 'CARD') return 'CARD'
  if (account.type === 'GATEWAY') return 'ONLINE'
  return 'BANK_TRANSFER'
}

/**
 * Validate the payment part of a receive / settle request.
 * PAY_NOW needs finance.payments.confirm, an ACTIVE BDT money account, a payment
 * date inside open books and a reference or proof (same rule as Accounts).
 */
export async function preparePayment(input, { session }) {
  const mode = input.mode
  if (mode !== 'PAY_NOW') {
    return { mode, paymentMethod: input.paymentMethod ?? null, note: input.note ?? null }
  }
  if (!canDo(session, 'finance.payments.confirm')) {
    throw httpError(403, 'Paying now needs the "Confirm payments" permission — send the bill to Accounts instead')
  }
  if (!input.accountId) throw httpError(422, 'Select the money account to pay from')
  const account = await MoneyAccount.findById(input.accountId).select('name type currency status mfsProvider isBankingChannel').lean()
  if (!account) throw httpError(422, 'Money account not found')
  if (account.status !== 'ACTIVE') throw httpError(422, `${account.name} is archived — choose an active account`)
  if ((account.currency ?? 'BDT') !== 'BDT') throw httpError(422, `${account.name} is a ${account.currency} account — pay BDT bills from a BDT account`)

  const today = todayKey()
  const paidKey = input.paidAt ?? today
  if (paidKey > today) throw httpError(422, 'Payment date cannot be in the future')
  const locked = await assertBooksOpen(paidKey)
  if (locked) throw httpError(409, locked)
  if (!input.reference && !input.proofUrl) {
    throw httpError(422, 'Enter the payment reference (transaction ID, cheque no. or memo no.) or upload the payment proof')
  }

  const paymentMethod = input.paymentMethod ?? defaultMethodFor(account)
  const channel = normalizeChannel(input.channel) ?? channelFromPaymentMethod(paymentMethod, account)
  return {
    mode,
    account,
    accountId: String(account._id),
    paymentMethod,
    channel,
    bankingChannel: isBankingChannel({ channel, account }),
    paidKey,
    paidAtDate: dayToDate(paidKey),
    reference: input.reference ?? null,
    proofUrl: input.proofUrl ?? null,
    note: input.note ?? null,
  }
}

/**
 * VAT Act s.46: input VAT on a supply above Tk 1,00,000 is not creditable unless
 * it is paid through a bank / MFS. The bill's assets are costed on the claim, so
 * a cash PAY_NOW of a VAT-creditable bill over the limit is refused up front.
 */
function assertItcPaymentChannel(bill, prepared) {
  if (prepared?.mode !== 'PAY_NOW' || prepared.bankingChannel !== false) return
  if (!bill.vatCreditable || !(num(bill.vatTotal) > 0)) return
  if (num(bill.total) > Number(ITC_BANKING_THRESHOLD ?? 100000)) {
    throw httpError(422, 'Input VAT on a bill above Tk 1,00,000 is only creditable when paid through a bank or MFS — pay from a bank/MFS account, or untick "VAT creditable" on the draft')
  }
}

/**
 * "Paid outside" creates no expense, so a VAT-creditable bill's input VAT would
 * reach neither the VAT return (no tax entry) nor the asset / stock cost (left
 * out because it was to be claimed). Refused: the VAT must land in one of them.
 * @param {{ received?: boolean }} opts  received: the bill is already RECEIVED (no longer editable)
 */
function assertPaidOutsideVat(bill, prepared, { received = false } = {}) {
  if (prepared?.mode !== 'PAID_OUTSIDE') return
  if (!bill.vatCreditable || !(num(bill.vatTotal) > 0)) return
  throw httpError(422, received
    ? 'This bill claims its input VAT, which is only recorded when the bill is paid through Accounts — pay it now or send it to Accounts. If it really was paid outside, cancel the bill, untick "VAT creditable" (the VAT then goes into the asset cost) and receive it again'
    : 'This bill claims its input VAT, which is only recorded when the bill is paid through Accounts — pay it now or send it to Accounts, or untick "VAT creditable" on the draft so the VAT goes into the asset cost')
}

/**
 * VDS / TDS withheld on a bill are still owed to NBR. "Paid outside" covers only the
 * supplier payment and creates no expense, so the withholding (VDS_PAYABLE /
 * TDS_PAYABLE: deposit, return, certificates) would never be recorded. Refused for
 * bills dated on / after go-live; older bills are covered by the opening VDS / TDS
 * payable balances.
 * @param {{ received?: boolean }} opts  received: the bill is already RECEIVED (no longer editable)
 */
async function assertPaidOutsideWithholding(bill, prepared, { received = false } = {}) {
  if (prepared?.mode !== 'PAID_OUTSIDE') return
  if (!(num(bill.vds?.amount) > 0) && !(num(bill.tds?.amount) > 0)) return
  const { goLiveDate } = await getFinanceSettings()
  if (goLiveDate && dhakaDayKey(bill.billDate) < goLiveDate) return
  throw httpError(422, received
    ? 'The VDS / TDS withheld on this bill must be recorded for deposit, the return and certificates — pay it now or send it to Accounts. If nothing was actually withheld, cancel the bill, clear the withholding and receive it again'
    : 'The VDS / TDS withheld on this bill must be recorded for deposit, the return and certificates — pay it now or send it to Accounts, or clear the withholding on the draft if nothing was withheld')
}

// ── payment lock (one receive / settlement of a bill's payment at a time) ────

const PAYMENT_LOCK_TTL_MS = 10 * 60 * 1000

/** Filter part: nobody holds the bill's payment lock (or the holder's claim is stale). */
function paymentUnlocked(now = new Date()) {
  return {
    $or: [
      { 'payment.lockId': null },
      { 'payment.lockedAt': null },
      { 'payment.lockedAt': { $lt: new Date(now.getTime() - PAYMENT_LOCK_TTL_MS) } },
    ],
  }
}

/** Is a (lean) bill's payment currently claimed by another request? */
function paymentLockActive(bill, now = new Date()) {
  const p = bill?.payment
  if (!p?.lockId || !p.lockedAt) return false
  return new Date(p.lockedAt).getTime() >= now.getTime() - PAYMENT_LOCK_TTL_MS
}

/** VAT rate of the line carrying the most VAT (null when the bill has no VAT). */
function dominantVatRate(lines) {
  let best = null
  for (const l of lines ?? []) {
    if (num(l.vatAmount) > 0 && (!best || num(l.vatAmount) > num(best.vatAmount))) best = l
  }
  return best ? num(best.vatRate) : null
}

/** The ProjectExpense that carries a purchase bill into the Accounts payment pipeline. */
async function createBillExpense(bill, { session, capitalizedAmountBDT, vendor }) {
  const total = round2(num(bill.total))
  const capitalized = round2(Math.min(num(capitalizedAmountBDT), total))
  const payeeType = vendor?.payeeType ?? 'COMPANY'
  const rates = [...new Set((bill.lines ?? []).filter(l => num(l.vatAmount) > 0).map(l => num(l.vatRate)))]
  const domRate = dominantVatRate(bill.lines)
  const billDay = dhakaDayKey(bill.billDate)
  const notes = [
    `Purchase bill ${bill.billNo} dated ${billDay}`,
    bill.supplierInvoiceNo ? `Supplier invoice ${bill.supplierInvoiceNo}` : null,
    bill.mushakNo ? `Mushak-6.3 ${bill.mushakNo}` : null,
    bill.notes || null,
  ].filter(Boolean).join(' · ')

  const expense = await new ProjectExpense({
    origin: bill.vendorId ? 'VENDOR' : 'OTHER',
    projectId: null,
    title: `Purchase ${bill.billNo} — ${bill.vendorName ?? 'Supplier'}`,
    amount: total,
    currency: 'BDT',
    amountBDT: total,
    category: capitalized >= total / 2 && capitalized > 0 ? 'Asset Purchase' : 'Office Supplies',
    subcategory: null,
    date: bill.billDate,
    notes: notes.slice(0, 2000),
    invoiceUrl: bill.attachments?.[0] ?? null,
    vendorId: bill.vendorId ?? null,
    paidToName: bill.vendorId ? null : (bill.vendorName ?? null),
    submittedBy: session.user.id,
    status: 'PENDING',
    tax: {
      vatAmount: round2(num(bill.vatTotal)),
      vatRate: rates.length === 1 ? rates[0] : null,
      vatCreditable: Boolean(bill.vatCreditable),
      treatment: num(bill.vatTotal) > 0 && domRate !== null ? treatmentForRate(domRate) : null,
      supplierBin: bill.supplierBin ?? null,
      supplierVatType: bill.supplierVatType ?? 'REGISTERED',
      mushakNo: bill.mushakNo ?? null,
      mushakDate: bill.mushakDate ?? null,
      vatServiceCode: bill.vds?.serviceCode ?? null,
      vdsRate: bill.vds?.rate ?? null,
      vdsAmount: round2(num(bill.vds?.amount)),
      tdsSection: bill.tds?.section ?? null,
      tdsRate: bill.tds?.rate ?? null,
      tdsAmount: round2(num(bill.tds?.amount)),
      payeeType,
      hasPsr: vendor ? Boolean(vendor.hasPsr) : null,
      higherRateApplied: Boolean(bill.tds?.higherRateApplied),
      netPayable: round2(num(bill.netPayable)),
      taxDeductible: true,
    },
    capitalizedAmountBDT: capitalized,
    purchaseBillId: bill._id,
  }).save()
  return expense
}

/**
 * PAY_NOW through the shared Accounts sequence (lib/expensePayment.payExpenseNow:
 * claim PENDING → PAID atomically, EXV voucher number, ledger entry for the net
 * cash, input VAT / VDS / TDS tax entries; the claim is released on failure).
 * @returns {Promise<{ expense, transaction, warnings: string[] }>}
 */
async function payBillExpense(expenseId, prepared, session, request) {
  const res = await payExpenseNow(expenseId, {
    paymentMethod: prepared.paymentMethod ?? undefined,
    paymentProofUrl: prepared.proofUrl ?? undefined,
    paymentTxnId: prepared.reference ?? undefined,
    accountId: prepared.accountId,
    channel: prepared.channel ?? undefined,
    paidAt: prepared.paidKey,
    note: prepared.note ?? undefined,
  }, session, { requireProof: true, request })
  const warnings = (res?.warnings ?? []).map(w => (typeof w === 'string' ? w : w?.message)).filter(Boolean)
  return { expense: res.expense, transaction: res.transaction, warnings }
}

/** Re-read an expense after a failed pay: did money move anyway? */
async function paidDespiteError(expenseId) {
  const e = await ProjectExpense.findById(expenseId).select('status accountsTransactionId').lean()
  return e && ['PAID', 'AUTHORIZED'].includes(e.status) && e.accountsTransactionId ? e : null
}

/**
 * Settle a bill's payment. Returns the new payment subdoc plus the expense it
 * created (if any). `track.expenseId` is set as soon as an expense exists so a
 * caller can compensate.
 */
async function settlePayment({ bill, prepared, session, request = null, capitalizedAmountBDT, vendor, track, existingExpenseId = null }) {
  if (prepared.mode === 'PAID_OUTSIDE') {
    return {
      payment: { mode: 'PAID_OUTSIDE', status: 'PAID', accountId: null, paymentMethod: prepared.paymentMethod ?? null, expenseId: null, transactionId: null },
      warning: null,
    }
  }

  let expenseId = existingExpenseId
  if (!expenseId) {
    const expense = await createBillExpense(bill, { session, capitalizedAmountBDT, vendor })
    expenseId = expense._id
    track.expenseId = expenseId
    track.expenseCreated = true
  }

  if (prepared.mode === 'REQUEST') {
    return {
      payment: { mode: 'REQUEST', status: 'REQUESTED', accountId: null, paymentMethod: prepared.paymentMethod ?? null, expenseId, transactionId: null },
      warning: null,
    }
  }

  // PAY_NOW
  try {
    const paid = await payBillExpense(expenseId, prepared, session, request)
    track.paid = true
    return {
      payment: {
        mode: 'PAY_NOW', status: 'PAID', accountId: prepared.accountId,
        paymentMethod: paid.expense?.paymentMethod ?? prepared.paymentMethod,
        expenseId, transactionId: paid.transaction?._id ?? paid.expense?.accountsTransactionId ?? null,
      },
      warning: paid.warnings.length ? paid.warnings.join(' ') : null,
    }
  } catch (err) {
    const moved = await paidDespiteError(expenseId)
    if (!moved) throw err
    // The ledger entry exists — the payment stands; report the follow-up failure.
    console.error('[purchases] payment posted but a follow-up step failed', err)
    track.paid = true
    return {
      payment: {
        mode: 'PAY_NOW', status: 'PAID', accountId: prepared.accountId, paymentMethod: prepared.paymentMethod,
        expenseId, transactionId: moved.accountsTransactionId,
      },
      warning: `Payment recorded, but a follow-up step failed: ${err.message}`,
    }
  }
}

// ── receiving ────────────────────────────────────────────────────────────────

/** Re-validate a stored DRAFT bill against current master data before receiving it. */
async function validateForReceive(bill) {
  const lines = bill.lines ?? []
  if (!lines.length) throw httpError(422, 'The bill has no lines')
  const refs = await loadLineRefs(lines)
  normalizeLines(lines.map(l => ({ ...l, categoryId: sid(l.categoryId), stockItemId: sid(l.stockItemId), locationId: sid(l.locationId), assignEmployeeId: sid(l.assignEmployeeId) })), refs)

  lines.forEach((l, i) => {
    if (l.lineType === 'ASSET' && (l.serialNumbers?.length ?? 0) > 0 && l.serialNumbers.length !== Number(l.qty)) {
      throw lineError(i, `Enter all ${l.qty} serial numbers (one per asset) or leave the list empty — ${l.serialNumbers.length} given`)
    }
  })

  // Input VAT is creditable only against a Mushak-6.3 from a supplier with a valid BIN
  // (the assets / stock are costed without the VAT on the strength of the claim).
  if (bill.vatCreditable && num(bill.vatTotal) > 0) {
    if (!isValidBin(bill.supplierBin)) {
      throw httpError(422, "Enter the supplier's BIN (9 or 13 digits, e.g. 000123456-0101) to claim the input VAT, or untick \"VAT creditable\"")
    }
    if (!String(bill.mushakNo ?? '').trim()) {
      throw httpError(422, "Enter the supplier's Mushak-6.3 number to claim the input VAT, or untick \"VAT creditable\"")
    }
  }

  // Serial numbers already on the register.
  const serials = lines.flatMap(l => (l.lineType === 'ASSET' ? l.serialNumbers ?? [] : []))
  if (serials.length) {
    const variants = [...new Set(serials.flatMap(s => [s, s.toUpperCase(), s.toLowerCase()]))]
    const clash = await Asset.findOne({ serialNumber: { $in: variants }, status: { $nin: TERMINAL_STATUSES } }).select('assetTag serialNumber').lean()
    if (clash) throw httpError(422, `Serial number ${clash.serialNumber} is already on asset ${clash.assetTag}`)
  }
  return refs
}

/** Find (by name within the category) or create the stock item for a consumable line. */
async function stockItemForLine(line, bill, session) {
  if (line.stockItemId) return { itemId: String(line.stockItemId), created: false }
  const existing = await StockItem.findOne({
    name: { $regex: `^${escapeRegex(line.description.trim())}$`, $options: 'i' },
    categoryId: line.categoryId ?? null,
    isActive: true,
  }).select('_id').lean()
  if (existing) return { itemId: String(existing._id), created: false }
  const item = await new StockItem({
    name: line.description.trim(),
    categoryId: line.categoryId ?? null,
    unit: line.unit || 'pcs',
    preferredVendorId: bill.vendorId ?? null,
    locationId: line.locationId ?? null,
    createdBy: session.user.id,
    notes: `Created from purchase bill ${bill.billNo}`,
  }).save()
  return { itemId: String(item._id), created: true }
}

async function rollbackReceive({ bill, track, session }) {
  const userId = session?.user?.id ?? null
  const step = async (label, fn) => {
    try { await fn() } catch (e) { console.error(`[purchases] receive rollback — ${label} failed`, e) }
  }
  if (track.expenseId && track.expenseCreated && !track.paid) {
    await step('expense', () => ProjectExpense.deleteOne({ _id: track.expenseId, status: 'PENDING' }))
  }
  if (track.assetIds.length) {
    await step('asset events', () => AssetEvent.deleteMany({ assetId: { $in: track.assetIds } }))
    await step('assets', () => Asset.deleteMany({ _id: { $in: track.assetIds } }))
  }
  for (const s of [...track.stock].reverse()) {
    if (s.itemCreated) {
      await step('stock movements', () => StockMovement.deleteMany({ stockItemId: s.itemId }))
      await step('stock item', () => StockItem.deleteOne({ _id: s.itemId }))
    } else {
      await step('stock reversal', () => moveStock({
        stockItemId: s.itemId, type: 'ADJUST_OUT', qty: s.qty, reverseUnitCost: s.unitCost, date: s.dateKey, purchaseBillId: bill._id,
        reason: `Receipt of ${bill.billNo} rolled back after an error`, reference: bill.billNo, userId,
      }))
    }
  }
  await step('bill status', () => PurchaseBill.updateOne(
    { _id: bill._id, status: 'RECEIVED' },
    { $set: { status: 'DRAFT', receivedAt: null, 'payment.lockId': null, 'payment.lockedAt': null } },
  ))
}

/** Tell each assignee about the equipment assigned to them on receipt. */
async function notifyAssignees(assignees, bill) {
  for (const [, a] of assignees) {
    if (!a.userId) continue
    createNotification({
      userId: a.userId,
      title: 'New equipment assigned to you',
      message: `${a.count} item${a.count === 1 ? '' : 's'} from purchase ${bill.billNo} ${a.count === 1 ? 'has' : 'have'} been assigned to you${a.ackPending ? ' — please acknowledge receipt in My Assets' : ''}.`,
      type: 'ASSET',
      link: '/admin/my-assets',
    }).catch(() => {})
  }
}

/**
 * DRAFT → RECEIVED. Creates the assets and stock, then settles the payment.
 * @returns {Promise<{ bill: object, warning: string|null, created: { assets: number, stockLines: number } }>}
 */
export async function receiveBill({ billId, body, session, request = null }) {
  const parsed = receiveInputSchema.safeParse(body ?? {})
  if (!parsed.success) throw validationError(parsed.error)
  const { receivedAt: receivedInput, payment: paymentInput } = parsed.data

  const bill = await PurchaseBill.findById(billId).lean()
  if (!bill) throw httpError(404, 'Not found')
  if (bill.status !== 'DRAFT') {
    throw httpError(409, bill.status === 'RECEIVED' ? 'This bill has already been received' : 'A cancelled bill cannot be received')
  }

  const today = todayKey()
  const receivedKey = receivedInput ?? today
  if (receivedKey > today) throw httpError(422, 'Received date cannot be in the future')
  const locked = await assertBooksOpen(receivedKey)
  if (locked) throw httpError(409, locked)

  await validateForReceive(bill)
  if (bill.lines.some(l => l.lineType === 'ASSET' && l.assignEmployeeId) && !canDo(session, 'inventory.assign')) {
    throw httpError(403, 'Assigning assets on receipt needs the "Assign, return & transfer assets" permission — clear the assignee or ask someone who can assign')
  }
  const prepared = await preparePayment(paymentInput, { session })
  assertItcPaymentChannel(bill, prepared)
  assertPaidOutsideVat(bill, prepared)
  await assertPaidOutsideWithholding(bill, prepared)
  const vendor = bill.vendorId ? await Vendor.findById(bill.vendorId).select('company payeeType hasPsr').lean() : null

  // Claim DRAFT → RECEIVED (also refuses a bill edited since it was read) and hold
  // the payment lock until the payment is saved, so a settle / cancel of the now
  // RECEIVED bill cannot run while this request is still creating its expense.
  const lockId = new mongoose.Types.ObjectId()
  const claimed = await PurchaseBill.findOneAndUpdate(
    { _id: bill._id, status: 'DRAFT', updatedAt: bill.updatedAt },
    { $set: { status: 'RECEIVED', receivedAt: dayToDate(receivedKey), 'payment.lockId': lockId, 'payment.lockedAt': new Date() } },
    { new: true },
  ).lean()
  if (!claimed) throw httpError(409, 'This bill was changed by someone else — reload it and try again')

  const settings = await getFinanceSettings()
  const threshold = Number(settings?.inventory?.capitalizationThreshold ?? 10000) || 0
  const alloc = allocateOtherCosts(bill.lines, bill.otherCosts)
  const billDay = dhakaDayKey(bill.billDate)
  const track = { assetIds: [], stock: [], expenseId: null, expenseCreated: false, paid: false }
  const lineSets = {}
  const assignees = new Map()
  let capitalized = 0
  let assetsCreated = 0
  let stockLines = 0
  let result

  try {
    for (const [i, line] of bill.lines.entries()) {
      const parts = unitCostParts(line, { vatCreditable: Boolean(bill.vatCreditable), otherShare: alloc[i] })

      if (line.lineType === 'ASSET') {
        // Each cost component is split over the line's units in whole paisa, so the
        // assets add up to exactly what the bill charged (no per-unit rounding drift).
        const n = Number(line.qty)
        const unitSplit = splitPaisa(round2(n * num(line.unitPrice)), n)
        const vatSplit = splitPaisa(line.vatAmount, n)
        const otherSplit = splitPaisa(round2(num(alloc[i]) + num(line.sdAmount)), n)
        const perAsset = unitSplit.map((u, k) => ({ unitCost: u, vatAmount: vatSplit[k], otherCosts: otherSplit[k] }))
        const assets = await createAssets({
          base: {
            name: line.description,
            categoryId: sid(line.categoryId),
            brand: line.brand ?? null,
            model: line.model ?? null,
            condition: 'NEW',
            locationId: sid(line.locationId),
            assignedEmployeeId: sid(line.assignEmployeeId),
            purchase: {
              billId: String(bill._id),
              vendorId: sid(bill.vendorId),
              vendorName: bill.vendorName ?? null,
              invoiceRef: bill.supplierInvoiceNo ?? bill.billNo,
              mushakNo: bill.mushakNo ?? null,
              date: billDay,
              currency: 'BDT',
              ...perAsset[0],
              vatCapitalized: !bill.vatCreditable,
            },
            ...(typeof line.capitalize === 'boolean' ? { isCapitalized: line.capitalize } : {}),
            availableForUseDate: receivedKey,
            warrantyExpiry: line.warrantyMonths ? addMonthsKey(receivedKey, line.warrantyMonths) : null,
            notes: `Received on purchase bill ${bill.billNo}`,
          },
          quantity: n,
          perAsset,
          serialNumbers: line.serialNumbers ?? [],
          session,
          eventType: 'RECEIVED',
          date: receivedKey,
        })
        for (const a of assets) {
          track.assetIds.push(a._id)
          if (a.isCapitalized !== false) capitalized += num(a.cost)
        }
        assetsCreated += assets.length
        lineSets[`lines.${i}.assetIds`] = assets.map(a => a._id)
        if (typeof line.capitalize !== 'boolean') {
          // Record what the policy decided, so the bill shows it.
          lineSets[`lines.${i}.capitalize`] = assets[0] ? assets[0].isCapitalized !== false : null
        }

        const empId = sid(line.assignEmployeeId)
        if (empId && assets.length) {
          const a0 = assets[0]
          const entry = assignees.get(empId) ?? { userId: a0.assignedUserId ? String(a0.assignedUserId) : null, count: 0, ackPending: false }
          entry.count += assets.length
          entry.ackPending = entry.ackPending || assets.some(a => a.acknowledgement?.status === 'PENDING')
          assignees.set(empId, entry)
        }
      } else if (line.lineType === 'CONSUMABLE') {
        const { itemId, created } = await stockItemForLine(line, bill, session)
        if (created) track.stock.push({ itemId, itemCreated: true, qty: line.qty, dateKey: receivedKey })
        const moved = await moveStock({
          stockItemId: itemId,
          type: 'PURCHASE',
          qty: line.qty,
          unitCost: parts.unitCost,
          date: receivedKey,
          purchaseBillId: String(bill._id),
          reason: `Purchase ${bill.billNo}${bill.vendorName ? ` — ${bill.vendorName}` : ''}`,
          reference: bill.supplierInvoiceNo ?? bill.billNo,
          userId: session.user.id,
        })
        if (!created) track.stock.push({ itemId, itemCreated: false, qty: line.qty, dateKey: receivedKey, unitCost: moved.movement.unitCost })
        stockLines += 1
        lineSets[`lines.${i}.stockItemId`] = itemId
        lineSets[`lines.${i}.stockMovementId`] = moved.movement._id
      }
    }
    capitalized = round2(capitalized)

    result = await settlePayment({ bill: claimed, prepared, session, request, capitalizedAmountBDT: capitalized, vendor, track })
  } catch (err) {
    await rollbackReceive({ bill, track, session })
    throw err
  }

  // ── link everything (payment has settled — never roll back past this point) ──
  const payment = result.payment
  try {
    const linked = await PurchaseBill.updateOne({ _id: bill._id, 'payment.lockId': lockId }, {
      $set: {
        ...lineSets,
        payment: {
          mode: payment.mode,
          status: payment.status,
          accountId: payment.accountId ?? null,
          paymentMethod: payment.paymentMethod ?? null,
          expenseId: payment.expenseId ?? null,
          transactionId: payment.transactionId ?? null,
          lockId: null,
          lockedAt: null,
        },
      },
    })
    if (!linked.matchedCount) {
      // Our claim went stale and another request took the payment over: keep its
      // payment, but still save the line links.
      console.error('[purchases] receive — payment lock lost', String(bill._id))
      if (Object.keys(lineSets).length) await PurchaseBill.updateOne({ _id: bill._id }, { $set: lineSets })
      result.warning = [result.warning, "The bill's payment changed while it was being received — reload to check"].filter(Boolean).join('. ')
    }
    if (track.assetIds.length && payment.expenseId) {
      await Asset.updateMany(
        { _id: { $in: track.assetIds } },
        { $set: { 'purchase.expenseId': payment.expenseId, ...(payment.transactionId ? { 'purchase.transactionId': payment.transactionId } : {}) } },
      )
    }
  } catch (err) {
    console.error('[purchases] linking the received bill failed', err)
    result.warning = [result.warning, 'The bill was received but some links could not be saved — reload to check'].filter(Boolean).join('. ')
  }

  notifyAssignees(assignees, bill).catch(() => {})

  return {
    billId: String(bill._id),
    warning: result.warning ?? null,
    created: { assets: assetsCreated, stockLines, capitalized, threshold },
    payment,
  }
}

// ── settling the payment of a received bill ──────────────────────────────────

/** Σ bill cost of the bill's capitalized assets (BDT; later capitalised repairs excluded). */
async function capitalizedForBill(billId) {
  const rows = await Asset.find({ 'purchase.billId': billId, isCapitalized: { $ne: false } }).select(`cost ${BILL_COST_FIELDS}`).lean()
  return round2(rows.reduce((s, a) => s + billCostOf(a), 0))
}

/**
 * Pay / request / mark paid a RECEIVED bill whose payment is UNPAID (never
 * requested, or the request was rejected), or pay now a REQUESTED bill whose
 * expense is still pending.
 */
export async function settleReceivedBill({ billId, body, session, request = null }) {
  const parsed = paymentBodySchema.safeParse(body ?? {})
  if (!parsed.success) throw validationError(parsed.error)

  const bill = await PurchaseBill.findById(billId).lean()
  if (!bill) throw httpError(404, 'Not found')
  if (bill.status !== 'RECEIVED') throw httpError(409, bill.status === 'DRAFT' ? 'Receive the bill first' : 'This bill is cancelled')
  await syncBillPayments([bill])

  const status = bill.payment?.status ?? 'UNPAID'
  const mode = parsed.data.payment.mode
  if (status === 'PAID') throw httpError(409, 'This bill is already paid')
  if (status === 'REQUESTED' && mode !== 'PAY_NOW') throw httpError(409, 'Payment is already requested — Accounts will pay it, or pay it now')

  const prepared = await preparePayment(parsed.data.payment, { session })
  assertItcPaymentChannel(bill, prepared)
  assertPaidOutsideVat(bill, prepared, { received: true })
  await assertPaidOutsideWithholding(bill, prepared, { received: true })
  const vendor = bill.vendorId ? await Vendor.findById(bill.vendorId).select('company payeeType hasPsr').lean() : null
  const capitalized = await capitalizedForBill(bill._id)
  const track = { assetIds: [], stock: [], expenseId: null, expenseCreated: false, paid: false }

  // Claim the bill's payment (atomically, on the state read above) so two requests
  // cannot both create an expense / pay; released on failure, cleared on save.
  const lockId = new mongoose.Types.ObjectId()
  const now = new Date()
  const claim = await PurchaseBill.updateOne(
    {
      _id: bill._id, status: 'RECEIVED',
      'payment.status': status === 'UNPAID' ? { $in: ['UNPAID', null] } : status,
      'payment.expenseId': bill.payment?.expenseId ?? null,
      ...paymentUnlocked(now),
    },
    { $set: { 'payment.lockId': lockId, 'payment.lockedAt': now } },
  )
  if (!claim.matchedCount) {
    const current = await PurchaseBill.findById(bill._id).select('payment').lean()
    throw httpError(409, paymentLockActive(current)
      ? 'This bill is already being settled — wait a moment, then reload it'
      : 'This bill was changed by someone else — reload it and try again')
  }
  const release = () => PurchaseBill.updateOne(
    { _id: bill._id, 'payment.lockId': lockId },
    { $set: { 'payment.lockId': null, 'payment.lockedAt': null } },
  ).catch(e => console.error('[purchases] payment lock release failed', e))

  let result
  try {
    result = await settlePayment({
      bill, prepared, session, request, capitalizedAmountBDT: capitalized, vendor, track,
      existingExpenseId: status === 'REQUESTED' ? bill.payment.expenseId : null,
    })
  } catch (err) {
    if (track.expenseId && track.expenseCreated && !track.paid) {
      await ProjectExpense.deleteOne({ _id: track.expenseId, status: 'PENDING' })
        .catch(e => console.error('[purchases] expense cleanup failed', e))
    }
    await release()
    throw err
  }

  const p = result.payment
  const updated = await PurchaseBill.findOneAndUpdate(
    { _id: bill._id, 'payment.lockId': lockId },
    { $set: { payment: { mode: p.mode, status: p.status, accountId: p.accountId ?? null, paymentMethod: p.paymentMethod ?? null, expenseId: p.expenseId ?? null, transactionId: p.transactionId ?? null, lockId: null, lockedAt: null } } },
    { new: true },
  ).lean()
  if (!updated) {
    console.error('[purchases] bill payment changed concurrently', String(bill._id))
    result.warning = [result.warning, 'The bill changed while saving the payment — reload to check'].filter(Boolean).join('. ')
  }
  if (p.expenseId) {
    await Asset.updateMany(
      { 'purchase.billId': bill._id },
      { $set: { 'purchase.expenseId': p.expenseId, ...(p.transactionId ? { 'purchase.transactionId': p.transactionId } : {}) } },
    ).catch(e => console.error('[purchases] asset payment link failed', e))
  }
  return { billId: String(bill._id), previousStatus: status, payment: p, warning: result.warning ?? null }
}

// ── cancelling ───────────────────────────────────────────────────────────────

/** Event types that are part of receiving an asset (anything else means it has a history). */
function onlyCreationEvents(events) {
  return events.every(e => ['RECEIVED', 'CREATED'].includes(e.type) || (e.type === 'ASSIGNED' && e.details?.atCreation === true))
}

/**
 * DRAFT → CANCELLED, or RECEIVED → CANCELLED while nothing has happened
 * downstream: assets untouched since receipt (deleted), consumables still on
 * hand (reversed with ADJUST_OUT), payment not made (pending request rejected).
 */
export async function cancelBill({ billId, body, session }) {
  const parsed = cancelInputSchema.safeParse(body ?? {})
  if (!parsed.success) throw validationError(parsed.error)
  const reason = parsed.data.reason ?? null

  const bill = await PurchaseBill.findById(billId).lean()
  if (!bill) throw httpError(404, 'Not found')
  if (bill.status === 'CANCELLED') throw httpError(409, 'This bill is already cancelled')

  const cancelFields = { cancelReason: reason, cancelledAt: new Date(), cancelledBy: session.user.id ?? null }

  if (bill.status === 'DRAFT') {
    const res = await PurchaseBill.findOneAndUpdate({ _id: bill._id, status: 'DRAFT' }, { $set: { status: 'CANCELLED', ...cancelFields } }, { new: true }).lean()
    if (!res) throw httpError(409, 'This bill was changed by someone else — reload it and try again')
    return { billId: String(bill._id), from: 'DRAFT', removedAssets: [], reversedStock: 0, rejectedExpense: null, warnings: [] }
  }

  // ── RECEIVED ──
  if (!reason || reason.length < 5) throw httpError(422, 'Give a reason for cancelling a received bill (at least 5 characters)')
  if (paymentLockActive(bill)) throw httpError(409, "This bill's payment is being processed — wait a moment, then reload it")
  await syncBillPayments([bill])
  const payment = bill.payment ?? {}
  let expense = null
  if (payment.expenseId) expense = await ProjectExpense.findById(payment.expenseId).select('status').lean()
  if (expense && ['PAID', 'AUTHORIZED'].includes(expense.status)) {
    throw httpError(409, 'This bill has been paid — reverse the payment in Accounts before cancelling it')
  }
  if (payment.status === 'PAID' && payment.mode !== 'PAID_OUTSIDE') {
    throw httpError(409, 'This bill has been paid — reverse the payment in Accounts before cancelling it')
  }

  const assetIds = (bill.lines ?? []).flatMap(l => l.assetIds ?? [])
  const assets = await Asset.find({ $or: [{ _id: { $in: assetIds } }, { 'purchase.billId': bill._id }] })
    .select('assetTag status depreciation.accumulated isArchived disposal').lean()
  const events = assets.length
    ? await AssetEvent.find({ assetId: { $in: assets.map(a => a._id) } }).select('assetId type details').lean()
    : []
  const eventsByAsset = new Map()
  for (const e of events) {
    const k = String(e.assetId)
    if (!eventsByAsset.has(k)) eventsByAsset.set(k, [])
    eventsByAsset.get(k).push(e)
  }
  const blocked = assets.filter(a =>
    !['IN_STOCK', 'ASSIGNED'].includes(a.status) ||
    num(a.depreciation?.accumulated) > 0.005 ||
    !onlyCreationEvents(eventsByAsset.get(String(a._id)) ?? []))
  if (blocked.length) {
    const tags = blocked.slice(0, 5).map(a => a.assetTag).join(', ')
    throw httpError(409, `Assets from this bill have been used since receipt (${tags}${blocked.length > 5 ? '…' : ''}) — handle them individually instead of cancelling the bill`)
  }

  const stockLines = (bill.lines ?? []).filter(l => l.lineType === 'CONSUMABLE' && l.stockItemId && l.stockMovementId)
  if (stockLines.length) {
    const items = await StockItem.find({ _id: { $in: stockLines.map(l => l.stockItemId) } }).select('name qtyOnHand unit').lean()
    const itemMap = new Map(items.map(it => [String(it._id), it]))
    const need = new Map()
    for (const l of stockLines) need.set(String(l.stockItemId), (need.get(String(l.stockItemId)) ?? 0) + num(l.qty))
    for (const [itemId, qty] of need) {
      const it = itemMap.get(itemId)
      if (it && num(it.qtyOnHand) + 0.00005 < qty) {
        throw httpError(409, `Only ${num(it.qtyOnHand)} ${it.unit || 'pcs'} of "${it.name}" is left (${qty} were received) — some was already issued`)
      }
    }
  }

  const claimed = await PurchaseBill.findOneAndUpdate(
    { _id: bill._id, status: 'RECEIVED', updatedAt: bill.updatedAt, ...paymentUnlocked() },
    { $set: { status: 'CANCELLED', ...cancelFields } },
    { new: true },
  ).lean()
  if (!claimed) throw httpError(409, 'This bill was changed by someone else — reload it and try again')

  // Withdraw the pending payment request FIRST (atomically): if Accounts paid it in
  // the meantime, undo the claim and stop before any asset or stock is removed.
  let rejectedExpense = null
  if (payment.expenseId && expense?.status === 'PENDING') {
    const rejected = await ProjectExpense.findOneAndUpdate(
      { _id: payment.expenseId, status: 'PENDING' },
      { $set: { status: 'REJECTED', reviewedBy: session.user.id, reviewedAt: new Date(), reviewNote: `Purchase bill ${bill.billNo} cancelled${reason ? ` — ${reason}` : ''}`.slice(0, 500) } },
      { new: true },
    ).lean()
    if (rejected) {
      rejectedExpense = String(rejected._id)
    } else {
      await PurchaseBill.updateOne(
        { _id: bill._id, status: 'CANCELLED' },
        { $set: { status: 'RECEIVED', cancelReason: bill.cancelReason ?? null, cancelledAt: bill.cancelledAt ?? null, cancelledBy: bill.cancelledBy ?? null } },
      ).catch(e => console.error('[purchases] cancel — claim release failed', e))
      throw httpError(409, 'The payment request changed in Accounts while cancelling (it may have been paid) — reload the bill and check')
    }
  }

  const warnings = []
  let reversed = 0
  // Take the stock out at the cost it came in at, so the purchase's effect on the
  // moving average is unwound (falls back to the current average if the movement is
  // gone, or — in moveStock — when the stock on hand can no longer bear that cost).
  let costById = new Map()
  if (stockLines.length) {
    try {
      const pm = await StockMovement.find({ _id: { $in: stockLines.map(l => l.stockMovementId) } }).select('unitCost').lean()
      costById = new Map(pm.map(m => [String(m._id), m.unitCost]))
    } catch (err) {
      console.error('[purchases] cancel — purchase movements lookup failed', err)
    }
  }
  for (const l of stockLines) {
    try {
      const out = await moveStock({
        stockItemId: String(l.stockItemId), type: 'ADJUST_OUT', qty: l.qty, reverseUnitCost: costById.get(String(l.stockMovementId)) ?? null,
        date: todayKey(), purchaseBillId: String(bill._id),
        reason: `Purchase ${bill.billNo} cancelled${reason ? ` — ${reason}` : ''}`.slice(0, 500), reference: bill.billNo, userId: session.user.id,
      })
      reversed += 1
      if (out.reversedAtAverage) {
        warnings.push(`Stock for "${l.description}" was taken out at the current average cost (Tk ${round2(out.movement.unitCost)} per ${l.unit || 'unit'}) instead of its purchase cost — the stock on hand has been used or restocked since this bill was received`)
      }
    } catch (err) {
      console.error('[purchases] cancel — stock reversal failed', err)
      warnings.push(`Stock for "${l.description}" could not be reversed: ${err.message}`)
    }
  }

  const removedTags = assets.map(a => a.assetTag)
  if (assets.length) {
    const ids = assets.map(a => a._id)
    try {
      await AssetEvent.deleteMany({ assetId: { $in: ids } })
      await Asset.deleteMany({ _id: { $in: ids } })
    } catch (err) {
      console.error('[purchases] cancel — asset removal failed', err)
      warnings.push(`Some assets could not be removed: ${err.message}`)
    }
  }

  const lineSets = {}
  ;(bill.lines ?? []).forEach((l, i) => { if (l.assetIds?.length) lineSets[`lines.${i}.assetIds`] = [] })
  await PurchaseBill.updateOne({ _id: bill._id }, {
    $set: {
      ...lineSets,
      ...(payment.mode !== 'PAID_OUTSIDE' && payment.status !== 'PAID'
        ? { 'payment.status': 'UNPAID', 'payment.accountId': null, 'payment.paymentMethod': null }
        : {}),
    },
  }).catch(e => console.error('[purchases] cancel — bill cleanup failed', e))

  return { billId: String(bill._id), from: 'RECEIVED', removedAssets: removedTags, reversedStock: reversed, rejectedExpense, warnings }
}

// ── list ─────────────────────────────────────────────────────────────────────

/** Mongo filter for the list endpoint. */
export function listFilter(searchParams) {
  const filter = {}
  const vendorId = searchParams.get('vendorId')
  if (vendorId) {
    if (!isValidObjectId(vendorId)) throw httpError(400, 'Invalid vendor id')
    filter.vendorId = vendorId
  }
  const status = searchParams.get('status')
  if (status) {
    const list = status.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
    filter.status = list.length === 1 ? list[0] : { $in: list }
  }
  const paymentStatus = searchParams.get('paymentStatus')
  if (paymentStatus) {
    const list = paymentStatus.split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
    filter['payment.status'] = list.length === 1 ? list[0] : { $in: list }
  }
  const search = (searchParams.get('search') ?? '').trim()
  if (search) {
    const re = { $regex: escapeRegex(search.slice(0, 100)), $options: 'i' }
    filter.$or = [{ billNo: re }, { vendorName: re }, { supplierInvoiceNo: re }, { mushakNo: re }, { 'lines.description': re }]
  }
  const start = parseDhakaDay(searchParams.get('startDate') ?? '')
  const end = parseDhakaDay(searchParams.get('endDate') ?? '')
  if (start || end) {
    filter.billDate = {}
    if (start) filter.billDate.$gte = start.start
    if (end) filter.billDate.$lt = end.next
  }
  return filter
}
