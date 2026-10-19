export const dynamic = 'force-dynamic'
import { NextResponse } from 'next/server'
import { getServerSession } from 'next-auth'
import { z } from 'zod'
import { authOptions } from '@/lib/auth'
import connectDB from '@/lib/mongodb'
import {
  Asset, AssetCategory, AssetEvent, Employee, ProjectExpense, TaxEntry, Transaction, Vendor,
} from '@/models'
import { canDo, canDoAny, requirePerm } from '@/lib/rbac'
import { isValidObjectId } from '@/lib/objectId'
import { logActivity } from '@/lib/logActivity'
import { toInstant } from '@/lib/finance/fiscal'
import { getFinanceSettings } from '@/lib/finance/settings'
import { TAX_DEPRECIATION_CLASSES } from '@/lib/tax/catalog'
import {
  logAssetEvent, CONDITIONS, DEPRECIATION_METHODS, TERMINAL_STATUSES, HELD_STATUSES, computeAssetCost, round2,
  UPLOAD_URL_RE, defaultOpeningAsOf, openingDateError,
} from '@/lib/inventory/assets'
import {
  bookSchedule, taxDepreciationSchedule, depreciationStart, periodOfDate, shiftPeriod, comparePeriods,
  periodLabelOf, fiscalYearLabelOf, fiscalYearLabel, parseFiscalYear, residualValueOf, usefulLifeMonthsOf,
  effectiveAccumulated, loadTaxCostAdditions,
} from '@/lib/inventory/depreciation'
import { availableAssetActions, buildDamageCases } from '@/lib/inventory/actions'
import {
  errorResponse, guardRead, blankToNull, loadAsset, serializeAsset, toPlain, employeeSummary,
  findSerialConflicts, httpError, dayKeyOf, todayKey,
} from '../_lib/service'

const LEDGER_PERMS = ['finance.transactions.view', 'finance.accounts.view', 'finance.overview.view', 'finance.reports.view', 'inventory.dispose']
const TAX_PERMS = ['tax.view', 'tax.manage', 'inventory.dispose']

/** Event types that come with creating an asset (a fresh asset can still be deleted). */
const CREATION_EVENT_TYPES = ['CREATED', 'RECEIVED', 'UPDATED', 'OPENING']

const EMP_POP = (path) => ({ path, select: 'employeeId userId designation position department', populate: { path: 'userId', select: 'name' } })

async function loadEvents(assetId) {
  const events = await AssetEvent.find({ assetId })
    .sort({ date: -1, createdAt: -1 })
    .limit(1000)
    .populate('fromLocationId', 'name code')
    .populate('toLocationId', 'name code')
    .populate(EMP_POP('fromEmployeeId'))
    .populate(EMP_POP('toEmployeeId'))
    .populate('departmentId', 'name')
    .populate('vendorId', 'company')
    .lean()

  // Names of employees held responsible in damage cases.
  const respIds = [...new Set(events
    .map(e => e.details?.responsibleEmployeeId)
    .filter(id => id && isValidObjectId(String(id)))
    .map(String))]
  const respMap = new Map()
  if (respIds.length) {
    const emps = await Employee.find({ _id: { $in: respIds } }).select('employeeId userId').populate('userId', 'name').lean()
    for (const e of emps) respMap.set(String(e._id), employeeSummary(e))
  }

  // Expense requests created by repairs (their payment status shows in the timeline).
  const expIds = [...new Set(events.map(e => e.expenseId).filter(Boolean).map(String))]
  const expMap = new Map()
  if (expIds.length) {
    const exps = await ProjectExpense.find({ _id: { $in: expIds } }).select('expenseId status amount title').lean()
    for (const x of exps) expMap.set(String(x._id), { id: String(x._id), expenseId: x.expenseId, status: x.status, amount: x.amount, title: x.title })
  }

  return events.map(e => {
    const out = toPlain(e)
    out.fromEmployee = e.fromEmployeeId && typeof e.fromEmployeeId === 'object' ? employeeSummary(e.fromEmployeeId) : null
    out.toEmployee = e.toEmployeeId && typeof e.toEmployeeId === 'object' ? employeeSummary(e.toEmployeeId) : null
    out.fromEmployeeId = out.fromEmployee?.id ?? null
    out.toEmployeeId = out.toEmployee?.id ?? null
    const rid = e.details?.responsibleEmployeeId ? String(e.details.responsibleEmployeeId) : null
    if (rid) out.responsibleEmployee = respMap.get(rid) ?? { id: rid, name: e.details?.responsibleEmployeeName ?? null }
    if (out.expenseId && expMap.has(String(out.expenseId))) out.expense = expMap.get(String(out.expenseId))
    return out
  })
}

/** Why the cost / depreciation inputs can no longer be edited (empty ⇒ editable). */
function financialLockReasons(asset, events, hasTx) {
  const reasons = []
  if (TERMINAL_STATUSES.includes(asset.status)) reasons.push('The asset has been disposed of')
  if (asset.depreciation?.lastPostedPeriod) {
    reasons.push(`Depreciation has been posted (through ${periodLabelOf(asset.depreciation.lastPostedPeriod)})`)
  } else if (events.some(e => e.type === 'DEPRECIATION')) {
    reasons.push('Depreciation has been posted')
  }
  if (events.some(e => e.type === 'VALUE_ADJUSTED')) reasons.push('The value has been adjusted')
  if (hasTx) reasons.push('Ledger entries reference this asset')
  return reasons
}

function deleteBlocker(asset, events, hasTx, openingLocked = false) {
  if (asset.purchase?.billId) {
    const no = typeof asset.purchase.billId === 'object' ? asset.purchase.billId.billNo : null
    return `This asset came from purchase bill${no ? ` ${no}` : ''} — cancel the bill instead`
  }
  // Removing an opening-register asset would restate the locked go-live position.
  if (openingLocked && asset.opening?.isExisting) {
    return 'Opening balances are locked — this asset is part of the go-live position (ask an admin to unlock opening balances to remove it)'
  }
  if (hasTx) return 'Ledger entries reference this asset — dispose of it instead'
  if (asset.depreciation?.lastPostedPeriod) return 'Depreciation has been posted — dispose of it instead'
  const other = events.find(e => !CREATION_EVENT_TYPES.includes(e.type) && !(e.type === 'ASSIGNED' && e.details?.atCreation))
  if (other) return 'The asset already has history (assignments, repairs…) — dispose of it instead'
  return null
}

// GET /api/inventory/assets/[id] — asset + events + damage cases + book & tax schedules
export async function GET(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = guardRead(session)
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()
    const [lean, settings] = await Promise.all([loadAsset(params.id), getFinanceSettings()])
    const assetId = lean._id
    const convention = settings.inventory?.depreciationConvention || 'PRORATA_DAYS'
    const startMonth = settings.fiscalYearStartMonth || 7
    const terminal = TERMINAL_STATUSES.includes(lean.status)

    const showLedger = canDoAny(session, LEDGER_PERMS)
    const showTax = canDoAny(session, TAX_PERMS)
    const txIds = [lean.purchase?.transactionId, ...(lean.disposal?.transactionIds ?? [])].filter(Boolean)

    const [events, hasTx, ledgerRows, taxEntryRows, taxCostAdditions] = await Promise.all([
      loadEvents(assetId),
      Transaction.exists({ assetId }),
      showLedger
        ? Transaction.find({ $or: [{ assetId }, ...(txIds.length ? [{ _id: { $in: txIds } }] : [])] })
          .select('txnId type kind category amount currency amountBDT plAmountBDT date description accountId reversalOf')
          .populate('accountId', 'name type last4 currency')
          .sort({ date: -1, createdAt: -1 })
          .limit(200)
          .lean()
        : Promise.resolve(null),
      showTax
        ? TaxEntry.find({ assetId }).select('entryNo entryType status date period baseAmount rate amount partyName partyBin documentNo').sort({ date: -1 }).lean()
        : Promise.resolve(null),
      loadTaxCostAdditions([assetId]),
    ])

    const asset = serializeAsset(lean)

    // ── book depreciation ──
    const current = periodOfDate(new Date())
    const method = lean.depreciation?.method || 'STRAIGHT_LINE'
    const depreciates = lean.isCapitalized !== false && method !== 'NONE' && Number(lean.cost) > 0
    const posted = events
      .filter(e => e.type === 'DEPRECIATION')
      .map(e => ({
        eventId: e.id,
        date: e.date,
        period: e.details?.period ?? periodOfDate(e.date),
        fromPeriod: e.details?.fromPeriod ?? null,
        months: e.details?.months ?? 1,
        amount: e.amount ?? 0,
        accumulatedAfter: e.details?.accumulatedAfter ?? null,
        bookValueAfter: e.details?.bookValueAfter ?? null,
        catchUp: Boolean(e.details?.catchUp),
        disposal: Boolean(e.details?.disposal),
      }))
      .sort((a, b) => String(a.period).localeCompare(String(b.period)) || new Date(a.date) - new Date(b.date))

    let projection = []
    let endPeriod = null
    if (depreciates && !terminal) {
      projection = bookSchedule(lean, { convention, toPeriod: shiftPeriod(current, 12) }).map(r => {
        const cmp = comparePeriods(r.period, current)
        return { ...r, state: cmp < 0 ? 'DUE' : cmp === 0 ? 'CURRENT' : 'PROJECTED' }
      })
      const full = bookSchedule(lean, { convention })
      endPeriod = full.length ? full[full.length - 1].period : null
    }
    const life = usefulLifeMonthsOf(lean)
    const residual = residualValueOf(lean)
    const start = depreciates ? depreciationStart(lean, { convention }) : null
    const book = {
      depreciates,
      convention,
      method,
      usefulLifeMonths: life || null,
      residualValue: residual,
      decliningRatePct: lean.depreciation?.decliningRatePct ?? null,
      monthlyCharge: depreciates
        ? (method === 'STRAIGHT_LINE' && life > 0 ? round2((Number(lean.cost) - residual) / life) : (projection[0]?.amount ?? null))
        : null,
      startPeriod: start?.period ?? null,
      startDate: start?.date ?? null,
      lastPostedPeriod: lean.depreciation?.lastPostedPeriod ?? null,
      accumulated: effectiveAccumulated(lean),
      fullyDepreciated: Boolean(lean.depreciation?.fullyDepreciated),
      endPeriod,
      posted,
      projection,
      currentPeriod: current,
    }

    // ── tax depreciation (Third Schedule, income years) ──
    const curFy = fiscalYearLabelOf(new Date(), startMonth)
    const curStart = parseFiscalYear(curFy)
    // Later capitalised repairs / cost corrections join the income year they
    // happened in, so years already filed keep their figures.
    const scheduleRows = taxDepreciationSchedule(lean, {
      startMonth,
      toFiscalYear: terminal ? undefined : fiscalYearLabel(curStart + 2, startMonth),
      costAdditions: taxCostAdditions.get(String(assetId)) ?? [],
    }).map(r => ({ ...r, projected: parseFiscalYear(r.fy) > curStart }))
    const curRow = scheduleRows.find(r => r.fy === curFy)
    const cls = TAX_DEPRECIATION_CLASSES[lean.taxClass] ?? TAX_DEPRECIATION_CLASSES.OTHER
    const tax = {
      taxClass: lean.taxClass,
      classLabel: cls?.label ?? lean.taxClass,
      rate: Number(lean.taxRatePct) > 0 ? Number(lean.taxRatePct) : (cls?.rate ?? null),
      method: cls?.method === 'SL' ? 'STRAIGHT_LINE' : 'WDV',
      costCap: cls?.costCap ?? null,
      currentFiscalYear: curFy,
      currentWdv: curRow ? curRow.closingWdv : null,
      rows: scheduleRows,
    }

    const lockReasons = financialLockReasons(lean, events, Boolean(hasTx))
    const billNo = lean.purchase?.billId && typeof lean.purchase.billId === 'object' ? lean.purchase.billId.billNo : null
    const blocker = deleteBlocker(lean, events, Boolean(hasTx), Boolean(settings.openingLocked))

    return NextResponse.json({
      data: {
        asset,
        events,
        damageCases: buildDamageCases(events),
        book,
        tax,
        ledger: ledgerRows ? ledgerRows.map(toPlain) : null,
        taxEntries: taxEntryRows ? taxEntryRows.map(toPlain) : null,
        settings: {
          convention,
          fiscalYearStartMonth: startMonth,
          lockedUntil: settings.lockedUntil ?? null,
          openingLocked: Boolean(settings.openingLocked),
          goLiveDate: settings.goLiveDate ?? null,
          capitalizationThreshold: settings.inventory?.capitalizationThreshold ?? 10000,
          postDepreciationToLedger: settings.inventory?.postDepreciationToLedger !== false,
          vatRegistrationType: settings.vat?.registrationType ?? 'REGISTERED',
          defaultSalesRate: settings.vat?.defaultSalesRate ?? 15,
          today: todayKey(),
        },
        financials: {
          locked: lockReasons.length > 0,
          reasons: lockReasons,
          billLocked: Boolean(lean.purchase?.billId),
          billNo,
        },
        deletable: { ok: !blocker, reason: blocker },
        allowedActions: availableAssetActions(asset, (p) => canDo(session, p)).map(a => a.key),
      },
    })
  } catch (err) {
    return errorResponse(err, '[GET /api/inventory/assets/[id]]')
  }
}

// ── PUT (edit details) ───────────────────────────────────────────────────────

const idField    = z.string().trim().refine(isValidObjectId, 'Invalid id')
const dateField  = z.string().trim().refine(v => toInstant(v) !== null, 'Invalid date')
const moneyField = z.coerce.number({ invalid_type_error: 'Must be a number' }).min(0, 'Cannot be negative').max(1e12)
const text = (max) => z.string().trim().max(max)

const updateSchema = z.object({
  name:         text(200).min(1, 'Name is required').optional(),
  categoryId:   idField.optional(),
  brand:        text(100).optional().nullable(),
  model:        text(100).optional().nullable(),
  serialNumber: text(120).optional().nullable(),
  specs:        text(2000).optional().nullable(),
  description:  text(4000).optional().nullable(),
  imageUrl:     text(500).optional().nullable(),
  documents:    z.array(z.object({ label: text(120).optional().nullable(), url: text(500).min(1) })).max(30).optional().nullable(),
  condition:    z.enum(CONDITIONS).optional(),
  warrantyExpiry: dateField.optional().nullable(),
  warrantyNotes:  text(1000).optional().nullable(),
  insurance: z.object({
    provider:     text(200).optional().nullable(),
    policyNo:     text(120).optional().nullable(),
    expiry:       dateField.optional().nullable(),
    insuredValue: moneyField.optional().nullable(),
  }).optional().nullable(),
  notes:              text(4000).optional().nullable(),
  expectedReturnDate: dateField.optional().nullable(),
  taxClass:   z.string().trim().refine(v => Boolean(TAX_DEPRECIATION_CLASSES[v]), 'Unknown tax class').optional(),
  taxRatePct: z.coerce.number().min(0).max(100).optional().nullable(),
  purchase: z.object({
    vendorId:       idField.optional().nullable(),
    vendorName:     text(200).optional().nullable(),
    invoiceRef:     text(120).optional().nullable(),
    mushakNo:       text(120).optional().nullable(),
    date:           dateField.optional().nullable(),
    unitCost:       moneyField.optional().nullable(),
    vatAmount:      moneyField.optional().nullable(),
    vatCapitalized: z.boolean().optional(),
    otherCosts:     moneyField.optional().nullable(),
  }).optional(),
  cost:                moneyField.optional(),
  isCapitalized:       z.boolean().optional(),
  availableForUseDate: dateField.optional().nullable(),
  depreciation: z.object({
    method:           z.enum(DEPRECIATION_METHODS).optional(),
    usefulLifeMonths: z.coerce.number().int().min(1).max(1200).optional().nullable(),
    residualValue:    moneyField.optional().nullable(),
    decliningRatePct: z.coerce.number().gt(0).max(100).optional().nullable(),
  }).optional(),
  opening: z.object({
    isExisting:              z.boolean().optional(),
    asOfDate:                dateField.optional().nullable(),
    accumulatedDepreciation: moneyField.optional().nullable(),
    taxWdv:                  moneyField.optional().nullable(),
    taxWdvFiscalYear:        z.string().trim().regex(/^\d{4}-\d{2}$/, 'Income year must look like 2025-26').optional().nullable(),
  }).optional(),
})

/**
 * Editable fields: [path, group, label, kind]
 *  groups: info (always), tax (not after disposal), purchaseInfo (not after disposal),
 *          financial (only while no depreciation/adjustment/ledger entry exists),
 *          cost (financial + not when the cost comes from a purchase bill), opening (financial + opening not locked)
 */
const FIELDS = [
  ['name', 'core', 'Name', 'text'],
  ['brand', 'core', 'Brand', 'text'],
  ['model', 'core', 'Model', 'text'],
  ['serialNumber', 'core', 'Serial number', 'text'],
  ['condition', 'core', 'Condition', 'text'],
  ['warrantyExpiry', 'core', 'Warranty expiry', 'date'],
  ['insurance', 'core', 'Insurance', 'insurance'],
  ['expectedReturnDate', 'core', 'Expected return', 'date'],
  ['specs', 'info', 'Specifications', 'text'],
  ['description', 'info', 'Description', 'text'],
  ['imageUrl', 'info', 'Photo', 'text'],
  ['documents', 'info', 'Documents', 'documents'],
  ['notes', 'info', 'Notes', 'text'],
  ['warrantyNotes', 'info', 'Warranty notes', 'text'],
  ['taxClass', 'tax', 'Tax depreciation class', 'text'],
  ['taxRatePct', 'tax', 'Tax depreciation rate', 'number'],
  ['purchase.vendorId', 'purchaseInfo', 'Vendor', 'id'],
  ['purchase.vendorName', 'purchaseInfo', 'Vendor name', 'text'],
  ['purchase.invoiceRef', 'purchaseInfo', 'Invoice reference', 'text'],
  ['purchase.mushakNo', 'purchaseInfo', 'Mushak-6.3 number', 'text'],
  ['categoryId', 'financial', 'Category', 'id'],
  ['isCapitalized', 'financial', 'Capitalized', 'bool'],
  ['availableForUseDate', 'financial', 'Available for use', 'date'],
  ['depreciation.method', 'financial', 'Depreciation method', 'text'],
  ['depreciation.usefulLifeMonths', 'financial', 'Useful life (months)', 'number'],
  ['depreciation.residualValue', 'financial', 'Residual value', 'money'],
  ['depreciation.decliningRatePct', 'financial', 'Declining-balance rate', 'number'],
  ['purchase.date', 'cost', 'Purchase date', 'date'],
  ['purchase.unitCost', 'cost', 'Unit cost', 'money'],
  ['purchase.vatAmount', 'cost', 'VAT', 'money'],
  ['purchase.vatCapitalized', 'cost', 'VAT capitalized', 'bool'],
  ['purchase.otherCosts', 'cost', 'Other costs', 'money'],
  ['cost', 'cost', 'Cost', 'money'],
  ['opening.isExisting', 'opening', 'Existing (opening) asset', 'bool'],
  ['opening.asOfDate', 'opening', 'Opening as-of date', 'date'],
  ['opening.accumulatedDepreciation', 'opening', 'Opening accumulated depreciation', 'money'],
  ['opening.taxWdv', 'opening', 'Opening tax WDV', 'money'],
  ['opening.taxWdvFiscalYear', 'opening', 'Opening tax WDV income year', 'text'],
]

/** Fields still editable after the asset is sold / scrapped / written off / donated. */
const TERMINAL_EDITABLE = new Set(['specs', 'description', 'imageUrl', 'documents', 'notes', 'warrantyNotes'])

const has = (obj, path) => {
  let cur = obj
  for (const k of path.split('.')) {
    if (!cur || typeof cur !== 'object' || !Object.prototype.hasOwnProperty.call(cur, k)) return false
    cur = cur[k]
  }
  return true
}
const getIn = (obj, path) => path.split('.').reduce((c, k) => (c == null ? undefined : c[k]), obj)

function convert(kind, v) {
  if (v === undefined || v === null) {
    if (kind === 'bool') return null
    if (kind === 'documents') return []
    return null
  }
  switch (kind) {
    case 'date': return toInstant(v)
    case 'money': return round2(Number(v))
    case 'number': return Number(v)
    case 'bool': return Boolean(v)
    case 'documents': return (v || []).map(d => ({ label: d.label ?? null, url: d.url }))
    case 'insurance': {
      const o = {
        provider: v.provider ?? null,
        policyNo: v.policyNo ?? null,
        expiry: v.expiry ? toInstant(v.expiry) : null,
        insuredValue: v.insuredValue === null || v.insuredValue === undefined ? null : round2(Number(v.insuredValue)),
      }
      return Object.values(o).some(x => x !== null) ? o : null
    }
    default: return typeof v === 'string' ? v.trim() : v
  }
}

/** Comparable form of a stored or incoming value. */
function comparable(kind, v) {
  if (v === undefined || v === null || v === '') {
    if (kind === 'documents') return '[]'
    if (kind === 'bool') return 'null'
    return 'null'
  }
  switch (kind) {
    case 'date': return dayKeyOf(v) ?? 'null'
    case 'money': return String(round2(Number(v)))
    case 'number': return String(Number(v))
    case 'bool': return String(Boolean(v))
    case 'id': return String(v?._id ?? v)
    case 'documents': return JSON.stringify((v || []).map(d => ({ label: d.label ?? null, url: d.url ?? null })))
    case 'insurance': return JSON.stringify({
      provider: v.provider ?? null, policyNo: v.policyNo ?? null,
      expiry: v.expiry ? dayKeyOf(v.expiry) : null,
      insuredValue: v.insuredValue === null || v.insuredValue === undefined ? null : round2(Number(v.insuredValue)),
    })
    default: return String(v)
  }
}

function display(kind, v) {
  if (v === undefined || v === null || v === '') return null
  switch (kind) {
    case 'date': return dayKeyOf(v)
    case 'documents': return `${(v || []).length} document(s)`
    case 'insurance': return [v.provider, v.policyNo].filter(Boolean).join(' · ') || 'set'
    case 'id': return String(v?._id ?? v)
    case 'bool': return v ? 'Yes' : 'No'
    default: {
      const s = String(v)
      return s.length > 120 ? `${s.slice(0, 117)}…` : s
    }
  }
}

// PUT /api/inventory/assets/[id] — edit details (status, custody and location change through actions)
export async function PUT(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'inventory.manage')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()
    const body = blankToNull(await request.json().catch(() => null))
    if (!body || typeof body !== 'object') return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
    for (const k of ['status', 'assignedEmployeeId', 'assignedDepartmentId', 'locationId', 'assetTag', 'disposal']) {
      if (Object.prototype.hasOwnProperty.call(body, k)) {
        const msg = k === 'assetTag'
          ? 'Asset tags cannot be changed once issued'
          : 'Use the asset actions (assign, return, move, dispose…) to change status, custody or location'
        return NextResponse.json({ error: msg }, { status: 422 })
      }
    }
    const parsed = updateSchema.safeParse(body)
    if (!parsed.success) {
      return NextResponse.json({ error: 'Validation failed', details: parsed.error.flatten() }, { status: 422 })
    }
    const data = parsed.data
    // A blank useful life means "keep the current one" (it always has a value).
    if (data.depreciation && data.depreciation.usefulLifeMonths === null) delete data.depreciation.usefulLifeMonths

    const cur = await Asset.findById(params.id).lean()
    if (!cur) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    if (cur.isArchived) return NextResponse.json({ error: 'This asset is archived' }, { status: 409 })

    // Photo / document links must be files uploaded here (no javascript:, data:,
    // external or /api/… links); links already on the asset may be sent back as they are.
    const keptUrls = new Set([cur.imageUrl, ...(cur.documents || []).map(d => d?.url)].filter(Boolean))
    const foreignUrl = (u) => Boolean(u) && !keptUrls.has(u) && !UPLOAD_URL_RE.test(u)
    if (foreignUrl(data.imageUrl)) {
      return NextResponse.json({ error: 'Attach the photo with the upload button' }, { status: 422 })
    }
    if ((data.documents || []).some(d => foreignUrl(d.url))) {
      return NextResponse.json({ error: 'Attach documents with the upload button' }, { status: 422 })
    }

    const [settings, events, hasTx] = await Promise.all([
      getFinanceSettings(),
      AssetEvent.find({ assetId: cur._id }).select('type').lean(),
      Transaction.exists({ assetId: cur._id }),
    ])
    const terminal = TERMINAL_STATUSES.includes(cur.status)
    const lockReasons = financialLockReasons(cur, events, Boolean(hasTx))

    // ── diff ──
    const set = {}
    const changes = []
    for (const [path, group, label, kind] of FIELDS) {
      if (!has(data, path)) continue
      const next = convert(kind, getIn(data, path))
      const prev = getIn(cur, path)
      if (comparable(kind, prev) === comparable(kind, next)) continue
      set[path] = next
      changes.push({ path, group, label, kind, from: display(kind, prev), to: display(kind, next) })
    }
    if (!changes.length) {
      const fresh = serializeAsset(await loadAsset(params.id))
      return NextResponse.json({ data: fresh, meta: { unchanged: true } })
    }

    // ── permission to change each group ──
    const blocked = (msg, list) => NextResponse.json({ error: `${msg}: ${list.map(c => c.label).join(', ')}` }, { status: 409 })
    if (terminal) {
      const bad = changes.filter(c => !TERMINAL_EDITABLE.has(c.path))
      if (bad.length) return blocked('The asset has been disposed of — only notes, documents and descriptions can be edited', bad)
    }
    const fin = changes.filter(c => ['financial', 'cost', 'opening'].includes(c.group))
    if (fin.length && lockReasons.length) {
      return blocked(`${lockReasons[0]} — these can no longer be edited (use "Adjust value" instead)`, fin)
    }
    const costChanges = changes.filter(c => c.group === 'cost' || c.path === 'purchase.vendorId')
    if (costChanges.length && cur.purchase?.billId) {
      return blocked('The cost and vendor come from the purchase bill — correct the bill instead', costChanges)
    }
    const openingChanges = changes.filter(c => c.group === 'opening')
    if (openingChanges.length && settings.openingLocked) {
      return blocked('Opening balances are locked', openingChanges)
    }
    // An opening-register asset's cost and capitalisation are part of the locked
    // go-live position — they cannot be restated once opening balances are locked.
    const openingValueChanges = changes.filter(c => c.group === 'cost' || c.path === 'isCapitalized')
    if (openingValueChanges.length && settings.openingLocked && cur.opening?.isExisting) {
      return blocked('Opening balances are locked — this asset is in the opening register', openingValueChanges)
    }
    if (has(data, 'expectedReturnDate') && set.expectedReturnDate && !(HELD_STATUSES.includes(cur.status) && cur.assignedEmployeeId)) {
      return NextResponse.json({ error: 'An expected return date only applies to an assigned asset' }, { status: 422 })
    }

    // ── referential checks ──
    if (set.categoryId) {
      const cat = await AssetCategory.findById(set.categoryId).select('name type isActive taxClass').lean()
      if (!cat) return NextResponse.json({ error: 'Category not found' }, { status: 422 })
      if (cat.type === 'CONSUMABLE') return NextResponse.json({ error: `"${cat.name}" is a consumable category` }, { status: 422 })
      if (cat.isActive === false) return NextResponse.json({ error: `Category "${cat.name}" is inactive` }, { status: 422 })
      // The tax class follows the new category unless one was chosen explicitly.
      if (!has(data, 'taxClass') && cat.taxClass && cat.taxClass !== cur.taxClass) {
        set.taxClass = cat.taxClass
        changes.push({ path: 'taxClass', group: 'tax', label: 'Tax depreciation class', kind: 'text', from: cur.taxClass, to: cat.taxClass })
      }
    }
    if (set.taxClass && !has(data, 'taxRatePct')) {
      const rate = Number(TAX_DEPRECIATION_CLASSES[set.taxClass]?.rate)
      if (Number.isFinite(rate) && rate !== Number(cur.taxRatePct)) set.taxRatePct = rate
    }
    if (set['purchase.vendorId']) {
      const vendor = await Vendor.findById(set['purchase.vendorId']).select('company').lean()
      if (!vendor) return NextResponse.json({ error: 'Vendor not found' }, { status: 422 })
      if (!has(data, 'purchase.vendorName')) set['purchase.vendorName'] = vendor.company
    }
    if (set.serialNumber) {
      const conflicts = await findSerialConflicts([set.serialNumber], { excludeId: cur._id })
      if (conflicts.length) {
        return NextResponse.json({ error: `Serial number ${conflicts[0].serial} is already on asset ${conflicts[0].assetTag}` }, { status: 409 })
      }
    }
    if (set['purchase.date'] && dayKeyOf(set['purchase.date']) > todayKey()) {
      return NextResponse.json({ error: 'Purchase date cannot be in the future' }, { status: 422 })
    }

    // ── derived financial values ──
    if (fin.length) {
      const purchase = { ...(cur.purchase ?? {}) }
      for (const k of ['unitCost', 'vatAmount', 'vatCapitalized', 'otherCosts', 'date']) {
        if (Object.prototype.hasOwnProperty.call(set, `purchase.${k}`)) purchase[k] = set[`purchase.${k}`]
      }
      const purchaseCostChanged = ['unitCost', 'vatAmount', 'vatCapitalized', 'otherCosts'].some(k => Object.prototype.hasOwnProperty.call(set, `purchase.${k}`))
      let cost = Number(cur.cost) || 0
      if (Object.prototype.hasOwnProperty.call(set, 'cost')) cost = set.cost
      else if (purchaseCostChanged) {
        cost = computeAssetCost({
          unitCost: purchase.unitCost ?? 0,
          vatAmount: purchase.vatAmount ?? 0,
          vatCapitalized: purchase.vatCapitalized !== false,
          otherCosts: purchase.otherCosts ?? 0,
        })
        if (cost !== round2(cur.cost)) {
          set.cost = cost
          changes.push({ path: 'cost', group: 'cost', label: 'Cost', kind: 'money', from: String(cur.cost ?? 0), to: String(cost) })
        }
      }
      if (set['purchase.date'] && !has(data, 'availableForUseDate') && cur.availableForUseDate && cur.purchase?.date
        && dayKeyOf(cur.availableForUseDate) === dayKeyOf(cur.purchase.date)) {
        // Keep "available for use" in step with the purchase date when it simply followed it.
        set.availableForUseDate = set['purchase.date']
      }

      const isCapitalized = Object.prototype.hasOwnProperty.call(set, 'isCapitalized') ? set.isCapitalized !== false : cur.isCapitalized !== false
      let method = Object.prototype.hasOwnProperty.call(set, 'depreciation.method') ? set['depreciation.method'] : (cur.depreciation?.method || 'STRAIGHT_LINE')
      if (!isCapitalized && method !== 'NONE') {
        method = 'NONE'
        set['depreciation.method'] = 'NONE'
      } else if (isCapitalized && cur.isCapitalized === false && method === 'NONE' && !has(data, 'depreciation.method')) {
        const cat = await AssetCategory.findById(set.categoryId ?? cur.categoryId).select('depreciationMethod').lean()
        method = cat?.depreciationMethod && cat.depreciationMethod !== 'NONE' ? cat.depreciationMethod : 'STRAIGHT_LINE'
        set['depreciation.method'] = method
      }
      const residual = Object.prototype.hasOwnProperty.call(set, 'depreciation.residualValue')
        ? (set['depreciation.residualValue'] ?? 0) : (Number(cur.depreciation?.residualValue) || 0)
      if (set['depreciation.residualValue'] === null) set['depreciation.residualValue'] = 0
      if (residual > cost + 0.005) return NextResponse.json({ error: 'Residual value cannot be more than the cost' }, { status: 422 })

      const opening = { ...(cur.opening ?? {}) }
      for (const k of ['isExisting', 'asOfDate', 'accumulatedDepreciation', 'taxWdv', 'taxWdvFiscalYear']) {
        if (Object.prototype.hasOwnProperty.call(set, `opening.${k}`)) opening[k] = set[`opening.${k}`]
      }
      if (set['opening.isExisting'] === null) set['opening.isExisting'] = false
      const isExisting = opening.isExisting === true
      const purchaseDateChanged = Object.prototype.hasOwnProperty.call(set, 'purchase.date')
      let asOfDefaulted = false
      if (isExisting && (openingChanges.length || purchaseDateChanged || Object.prototype.hasOwnProperty.call(set, 'cost'))) {
        // Same rules as the opening import. A blank as-of date means the day before
        // go-live (as on create), so it is never left empty on an opening asset.
        if (!opening.asOfDate) {
          const asOf = defaultOpeningAsOf(settings)
          if (asOf) {
            asOfDefaulted = true
            opening.asOfDate = asOf
            set['opening.asOfDate'] = asOf
            const logged = changes.find(c => c.path === 'opening.asOfDate')
            if (logged) logged.to = display('date', asOf)
            else changes.push({ path: 'opening.asOfDate', group: 'opening', label: 'Opening as-of date', kind: 'date', from: display('date', cur.opening?.asOfDate), to: display('date', asOf) })
          }
        }
        const dateErr = openingDateError({
          goLiveDate: settings.goLiveDate || null,
          asOfKey: dayKeyOf(opening.asOfDate),
          purchaseKey: dayKeyOf(purchase.date),
        })
        if (dateErr) return NextResponse.json({ error: dateErr }, { status: 422 })
      }
      let accumulated = Number(cur.depreciation?.accumulated) || 0
      if (openingChanges.length || Object.prototype.hasOwnProperty.call(set, 'cost')) {
        if (isExisting) {
          const acc = round2(Number(opening.accumulatedDepreciation) || 0)
          if (acc > cost + 0.005) return NextResponse.json({ error: 'Opening accumulated depreciation cannot be more than the cost' }, { status: 422 })
          // (the go-live default may still be ahead, as on create — only a date typed in must not be)
          if (opening.asOfDate && !asOfDefaulted && dayKeyOf(opening.asOfDate) > todayKey()) {
            return NextResponse.json({ error: 'The opening "as of" date cannot be in the future' }, { status: 422 })
          }
          accumulated = acc
          if (set['opening.accumulatedDepreciation'] === null) set['opening.accumulatedDepreciation'] = 0
        } else if (openingChanges.length) {
          // No longer an opening asset: nothing has been posted yet, so it starts from zero.
          accumulated = 0
          set['opening.asOfDate'] = null
          set['opening.accumulatedDepreciation'] = 0
          set['opening.taxWdv'] = null
          set['opening.taxWdvFiscalYear'] = null
        }
        if (accumulated !== (Number(cur.depreciation?.accumulated) || 0)) set['depreciation.accumulated'] = accumulated
      }
      set['depreciation.fullyDepreciated'] = method !== 'NONE' && cost > 0 && accumulated >= round2(cost - residual) - 0.005
    }

    set.updatedBy = session.user.id
    const updated = await Asset.findOneAndUpdate(
      { _id: cur._id, updatedAt: cur.updatedAt },
      { $set: set },
      { new: true, runValidators: true },
    ).lean()
    if (!updated) return NextResponse.json({ error: 'This asset was changed by someone else — reload and try again' }, { status: 409 })

    const summary = changes.map(c => ({ field: c.label, from: c.from, to: c.to }))
    try {
      await logAssetEvent({
        asset: updated,
        type: 'UPDATED',
        from: cur.status,
        to: updated.status,
        details: { changes: summary, financial: fin.length > 0 },
        notes: changes.length === 1 ? `${changes[0].label} updated` : `${changes.length} fields updated`,
        session,
      })
    } catch (e) {
      console.error('[PUT /api/inventory/assets/[id]] event logging failed', e)
    }

    logActivity({
      userId: session.user.id, userRole: session.user.role, action: 'UPDATE', entity: 'ASSET',
      entityId: String(cur._id), changes: JSON.stringify({ tag: cur.assetTag, changes: summary }), request,
    })

    const fresh = serializeAsset(await loadAsset(params.id))
    return NextResponse.json({ data: fresh, meta: { changes: summary } })
  } catch (err) {
    return errorResponse(err, '[PUT /api/inventory/assets/[id]]')
  }
}

// DELETE /api/inventory/assets/[id] — only a mistaken entry with no history; otherwise dispose of it.
export async function DELETE(request, { params }) {
  try {
    const session = await getServerSession(authOptions)
    const denied = requirePerm(session, 'inventory.manage')
    if (denied) return denied
    if (!isValidObjectId(params.id)) return NextResponse.json({ error: 'Not found' }, { status: 404 })

    await connectDB()
    const asset = await Asset.findById(params.id).populate('purchase.billId', 'billNo').lean()
    if (!asset) return NextResponse.json({ error: 'Not found' }, { status: 404 })
    const [events, hasTx, settings] = await Promise.all([
      AssetEvent.find({ assetId: asset._id }).select('type details.atCreation').lean(),
      Transaction.exists({ assetId: asset._id }),
      getFinanceSettings(),
    ])
    const blocker = deleteBlocker(asset, events, Boolean(hasTx), Boolean(settings.openingLocked))
    if (blocker) throw httpError(409, blocker)

    const res = await Asset.deleteOne({ _id: asset._id, updatedAt: asset.updatedAt })
    if (res.deletedCount !== 1) return NextResponse.json({ error: 'This asset was changed by someone else — reload and try again' }, { status: 409 })
    await AssetEvent.deleteMany({ assetId: asset._id })
      .catch(e => console.error('[DELETE /api/inventory/assets/[id]] event cleanup failed', e))

    logActivity({
      userId: session.user.id, userRole: session.user.role, action: 'DELETE', entity: 'ASSET',
      entityId: String(asset._id),
      changes: JSON.stringify({ tag: asset.assetTag, name: asset.name, cost: asset.cost }),
      request,
    })
    return NextResponse.json({ data: { id: String(asset._id), assetTag: asset.assetTag, deleted: true } })
  } catch (err) {
    return errorResponse(err, '[DELETE /api/inventory/assets/[id]]')
  }
}
